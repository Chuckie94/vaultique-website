/* ===========================================================================
   THE BACKUP AND THE CHECK AFTER A RESTORE (website build 92), without a database

   The parts that need PostgreSQL (a whole copy, checked by restoring it, and
   the first drill) are tests/backup-cycle.js, run by tools/db-check.sh.
   Here, against stand-ins:

     - the seal: only the private key opens a copy; a changed byte, a changed
       header or another key is refused; nothing readable outside the seal
     - the storage account: every request signed as S3 requires (AWS's own
       published example), lists read page by page, a wrong key refused
     - which copies are let go, and the newest good one never
     - the pictures: each copied once, sealed
     - the GitHub workflow: off until switched on, every two hours unless
       hourly is chosen, the private key only in the drill, PostgreSQL 17
     - after a restore: refunds held until you finish; waiting payments
       confirmed on the gateway's word; payments and refunds made after the
       copy found on Lenco's and Flutterwave's own lists; the owner only
     - RECOVERY.md names every Netlify setting the code reads
   =========================================================================== */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let checks = 0, failures = 0;
const is = (c, m, x) => { checks++; if (c) console.log('  ✓ ' + m); else { failures++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); } };
const J = (o) => JSON.stringify(o);
const ROOT = path.join(__dirname, '..');
const E = require('../tools/backup/envelope.cjs');
const S3 = require('../tools/backup/s3.cjs');
const B = require('../tools/backup/backup.cjs');
const { startS3, startStorage } = require('./backup-standins.js');

(async () => {
  try {
    /* ------------------------------------------------------------------ */
    console.log('\nThe seal');
    const keys = E.makeKeyPair(3072);
    const pub = E.publicKeyFrom(keys.publicPem), pri = E.privateKeyFrom(keys.privatePem);
    const secret = Buffer.from('COPY public.orders (id, name, phone) FROM stdin;\nVB-001\tChanda Mwansa\t0977123456\n\\.\n');
    const sealed = E.sealNamed({ part: 'public', path: 'chat-photos/c-1/x.jpg' }, secret, pub);
    const opened = E.openNamed(sealed, pri);
    is(opened.data.equals(secret) && opened.meta.path === 'chat-photos/c-1/x.jpg', 'sealed with the public key, opened with the private one, exactly');
    is(!/Chanda|0977|orders|chat-photos/.test(sealed.toString('latin1')), 'nothing inside can be read from the sealed file: no name, number, table or path');
    is(E.headOf(sealed).head.kid === E.kidOf(pri) && E.kidOf(pub) === E.kidOf(pri), 'its first line names the key that opens it (the same name from either half)');
    const flipped = Buffer.from(sealed); flipped[flipped.length - 30] ^= 1;
    let why = ''; try { E.open(flipped, pri); } catch (e) { why = e.message; }
    is(/changed or damaged/.test(why), 'one byte changed anywhere: refused, said plainly', why);
    const head = E.headOf(sealed);
    const forged = Buffer.concat([Buffer.from('VQBK1\n' + head.headText.replace(/"made":"[^"]+"/, '"made":"2020-01-01T00:00:00.000Z"') + '\n'), head.body]);
    why = ''; try { E.open(forged, pri); } catch (e) { why = e.message; }
    is(/changed or damaged/.test(why), 'its first line changed (the date it was made): refused too, the line is bound to the rest', why);
    const other = E.makeKeyPair(3072);
    why = ''; try { E.open(sealed, E.privateKeyFrom(other.privatePem)); } catch (e) { why = e.message; }
    is(/sealed for another key \(/.test(why), 'another key: refused, naming the key the file needs', why);
    const short = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'pem' });
    why = ''; try { E.publicKeyFrom(short); } catch (e) { why = e.message; }
    is(/too short/.test(why), 'a key under 3072 bits is refused', why);
    const oneLine = keys.publicPem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
    is(E.kidOf(E.publicKeyFrom(oneLine)) === E.kidOf(pub) && E.kidOf(E.publicKeyFrom(keys.publicPem.replace(/\n/g, '\\n'))) === E.kidOf(pub),
       'the public half is read however it was pasted into GitHub (one long line, or with \\n)');

    /* ------------------------------------------------------------------ */
    console.log('\nThe storage account');
    const ex = S3.sign({ method: 'GET', path: '/test.txt', query: {}, headers: { host: 'examplebucket.s3.amazonaws.com', range: 'bytes=0-9',
      'x-amz-content-sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'x-amz-date': '20130524T000000Z' },
      region: 'us-east-1', keyId: 'AKIAIOSFODNN7EXAMPLE', secret: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' });
    is(ex.signature === 'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
       'every request is signed exactly as AWS\'s own published example (Signature Version 4)', ex.signature);
    const s3 = await startS3({ pageSize: 2 });
    const store = S3.client(s3.cfg);
    for (const k of ['copies/a/1', 'copies/a/2', 'copies/b/1', 'copies/b/2 with space ü', 'pictures/x']) await store.put(k, Buffer.from(k));
    const listed = await store.list('copies/');
    is(listed.length === 4 && listed.some((o) => o.key === 'copies/b/2 with space ü') && s3.st.calls.filter((c) => c === 'GET /vaultique-backups').length >= 2,
       'lists are read page by page; names with spaces and accents come back as they went', J(listed.map((o) => o.key)));
    is((await store.get('copies/b/2 with space ü')).toString() === 'copies/b/2 with space ü' && (await store.get('copies/none')) === null,
       'read back exactly; a missing one is nothing, not an error');
    await store.del('copies/a/1');
    is(!(await store.list('copies/a/')).some((o) => o.key === 'copies/a/1'), 'and let go');
    const wrong = S3.client(Object.assign({}, s3.cfg, { secret: 'not-the-secret' }));
    why = ''; try { await wrong.put('copies/z', Buffer.from('z')); } catch (e) { why = e.message; }
    is(/403 SignatureDoesNotMatch/.test(why) && !s3.st.objects.has('copies/z'), 'a wrong storage key is refused, with the storage\'s own words', why);
    why = ''; try { S3.client(Object.assign({}, s3.cfg, { endpoint: 's3.example.com' })); } catch (e) { why = e.message; }
    is(/must look like https:\/\//.test(why), 'an address without https:// is caught before anything is sent', why);

    /* ------------------------------------------------------------------ */
    console.log('\nWhich copies are let go');
    const now = new Date('2026-11-27T12:17:00Z');
    const ids = ['2026-10-01T0117Z', '2026-11-20T0117Z', '2026-11-20T0317Z', '2026-11-21T0117Z', '2026-11-21T0317Z',
                 '2026-11-26T0117Z', '2026-11-27T0117Z', '2026-11-27T1017Z'];
    const okAll = {}; ids.forEach((i) => { okAll[i] = true; });
    is(J(B.toLetGo(ids, okAll, now)) === J(['2026-10-01T0117Z', '2026-11-20T0317Z', '2026-11-21T0317Z']),
       'every copy of the last two days kept; before that, the first of each day; past thirty days, none', J(B.toLetGo(ids, okAll, now)));
    const two = ['2026-11-26T0117Z', '2026-11-26T0917Z', '2026-11-27T0117Z'];
    const ok3 = {}; two.forEach((i) => { ok3[i] = true; });
    is(B.toLetGo(two, ok3, now).length === 0, 'two copies of yesterday, 27 and 35 hours old: both kept (every copy for two days, not one)');
    const ok2 = Object.assign({}, okAll, { '2026-11-20T0117Z': false });
    is(B.toLetGo(ids, ok2, now).indexOf('2026-11-20T0117Z') > -1 && B.toLetGo(ids, ok2, now).indexOf('2026-11-20T0317Z') < 0,
       'of a day, the first copy that checked out is the one kept');
    const old = ['2026-09-01T0117Z', '2026-09-02T0117Z'];
    is(J(B.toLetGo(old, { '2026-09-02T0117Z': true }, now)) === J(['2026-09-01T0117Z']),
       'if the copies stopped months ago, the newest good one is still never let go');
    is(B.copyIdOf(new Date('2026-11-27T01:17:42Z')) === '2026-11-27T0117Z' && B.timeOfId('2026-11-27T0117Z').toISOString() === '2026-11-27T01:17:00.000Z',
       'each copy is named by its time, in UTC');

    /* ------------------------------------------------------------------ */
    console.log('\nThe pictures');
    const pics = await startStorage({ buckets: {
      'product-images': { 'a.jpg': { data: Buffer.from('A'), type: 'image/jpeg', at: '2026-11-01T00:00:00Z' },
                          'deep/er/b.png': { data: Buffer.from('B'), type: 'image/png', at: '2026-11-01T00:00:00Z' } },
      'chat-photos': { 'c-9/c-1.jpg': { data: Buffer.from('C'), type: 'image/jpeg', at: '2026-11-02T00:00:00Z' } } } });
    const cfg = { supabaseUrl: pics.url, serviceKey: pics.serviceKey };
    let r = await B.copyPictures(cfg, store, pub);
    const kept = Array.from(s3.st.objects.keys()).filter((k) => k.indexOf('pictures/') === 0 && k !== 'pictures/x');
    is(r.total === 3 && r.copied === 3 && kept.length === 3 && kept.every((k) => /^pictures\/(product-images|chat-photos)\/[0-9a-f]{32}-[0-9a-f]{12}\.vqb$/.test(k)),
       'every picture in every bucket, folders within folders, kept under a name that says nothing', J(kept));
    const one = E.openNamed(s3.st.objects.get(kept.find((k) => k.indexOf('chat-photos') > -1)).body, pri);
    is(one.meta.path === 'c-9/c-1.jpg' && one.data.toString() === 'C', 'opened, each says what it was and where it goes back');
    r = await B.copyPictures(cfg, store, pub);
    is(r.copied === 0 && pics.st.downloads === 3, 'the next run copies nothing already kept');
    pics.st.buckets['product-images']['a.jpg'] = { data: Buffer.from('A2'), type: 'image/jpeg', at: '2026-11-27T00:00:00Z' };
    r = await B.copyPictures(cfg, store, pub);
    is(r.copied === 1, 'a picture replaced is copied again (its old version kept too)');
    r = await B.copyPictures({ supabaseUrl: '', serviceKey: '' }, store, pub);
    is(/no Supabase address/.test(r.skipped || ''), 'without the Supabase address and key, the pictures are skipped, saying why');

    /* ------------------------------------------------------------------ */
    console.log('\nWhat GitHub needs, and the workflow');
    why = ''; try { B.config({}); } catch (e) { why = e.message; }
    is(/BACKUP_DB_URL is not set \(GitHub > Settings > Secrets and variables > Actions\)/.test(why), 'a missing secret is named, with where it is set', why);
    const PG = require('../tools/backup/pgtools.cjs');
    const c = PG.connFromUrl('postgresql://postgres.abcd:p%40ss%3Aw0rd@aws-0-eu-west-1.pooler.supabase.com:5432/postgres');
    is(c.PGUSER === 'postgres.abcd' && c.PGPASSWORD === 'p@ss:w0rd' && c.PGHOST === 'aws-0-eu-west-1.pooler.supabase.com' && c.PGSSLMODE === 'require',
       'the session pooler\'s address is read into PostgreSQL\'s own settings, the password never on a command line, with SSL', J(Object.assign({}, c, { PGPASSWORD: '…' })));
    const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'backup.yml'), 'utf8');
    const code = wf.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    is(/vars\.BACKUP_ON == 'yes'/.test(code) && /github\.event_name == 'workflow_dispatch'/.test(code),
       'nothing runs on the schedule until BACKUP_ON is yes; a manual run always can');
    is(/cron: '17 \*\/2 \* \* \*'/.test(code) && /cron: '17 1-23\/2 \* \* \*'/.test(code) && /vars\.BACKUP_EVERY_HOURS == '1'/.test(code),
       'every two hours, and the hours between only when BACKUP_EVERY_HOURS is 1');
    is(/image: postgres:17/.test(code) && /BACKUP_PG: docker exec -i \$\{\{ job\.services\.scratch\.id \}\}/.test(code),
       'PostgreSQL 17\'s own tools, in the container the copy is checked in');
    is(/permissions:\s*\n\s*contents: read/.test(code) && /cancel-in-progress: false/.test(code) && /timeout-minutes: 30/.test(code),
       'it can only read the repository; a copy is never cut short by the next; thirty minutes at most');
    const priv = code.split('\n').map((l, i) => [i, l]).filter((x) => /BACKUP_PRIVATE_KEY/.test(x[1]));
    const drillAt = code.split('\n').findIndex((l) => /name: The drill/.test(l));
    is(priv.length === 1 && priv[0][0] > drillAt && drillAt > 0, 'the private key is given only to the drill step, and only if you add it for the drill',
       J(priv));
    is(!/secrets\.[A-Z_]+[^}]*\}\}\s*$/m.test(code.split('\n').filter((l) => /^\s*if:|echo/.test(l)).join('\n')),
       'no secret is ever printed or used in a condition');

    /* ------------------------------------------------------------------ */
    console.log('\nRECOVERY.md names every Netlify setting the code reads');
    const rec = fs.readFileSync(path.join(ROOT, 'RECOVERY.md'), 'utf8');
    const names = new Set();
    const scan = (dir) => fs.readdirSync(dir).forEach((f) => {
      const p = path.join(dir, f);
      if (!/\.(c?js)$/.test(f)) return;
      const t = fs.readFileSync(p, 'utf8');
      (t.match(/process\.env\.[A-Z][A-Z0-9_]+/g) || []).forEach((m) => names.add(m.slice(12)));
      (t.match(/(?:env|has|prefixes)\('([A-Z][A-Z0-9_]+)'\)/g) || []).forEach((m) => names.add(/'([A-Z0-9_]+)'/.exec(m)[1]));
    });
    scan(path.join(ROOT, 'netlify', 'functions'));
    const missing = Array.from(names).filter((n) => rec.indexOf('`' + n + '`') < 0);
    is(names.size >= 20 && missing.length === 0, 'all ' + names.size + ' of them, by name', J(missing));
    is(!/=\s*(sk|pk|FLWSECK|eyJ)[A-Za-z0-9_-]{8,}/.test(rec), 'and no value of any');
    is(['A database failure', 'A deletion', 'Corrupted data', 'A failed deploy', 'A stolen admin account', 'A payment gateway failing',
        'The platform link failing', 'Lost settings', 'A failed SQL file', 'Everything down'].every((t, i) => rec.indexOf('### ' + (i + 1) + '. ' + t) > -1),
       'the ten cases of your brief, each with what you see, what to do, and when it is done');

    /* ------------------------------------------------------------------ */
    console.log('\nAfter a restore: the gateways asked, refunds held');
    await afterRestore();
    await s3.close(); await pics.close();
  } catch (e) {
    is(false, 'the checks stopped', e && e.stack);
  }
  console.log(failures ? '\n  ✗ ' + failures + ' of ' + checks + ' checks FAILED' : '\n  backup: all ' + checks + ' checks passed');
  process.exit(failures ? 1 : 0);
})();

/* The website's Supabase, Lenco and Flutterwave, for the check after a restore. */
async function afterRestore() {
  const OWNER = '11111111-1111-4111-8111-111111111111';
  const since = new Date(Date.now() - 6 * 3600000).toISOString();
  const tok = (aal) => 'x.' + Buffer.from(J({ sub: OWNER, aal })).toString('base64url') + '.y';
  const DB = {
    payments: [{ tx_ref: 'VB-WAIT1-0000000001', provider: 'lenco', mode: 'test', status: 'started', amount: 300, currency: 'ZMW',
                 order_id: 'o1', created_at: new Date(Date.now() - 8 * 3600000).toISOString(), detail: null, phone: '0971000001' },
               { tx_ref: 'VB-KNOWN-0000000002', provider: 'flutterwave', mode: 'test', status: 'paid', amount: 500, currency: 'ZMW',
                 order_id: 'o2', provider_tx_id: '777', created_at: since }],
    orders: [{ id: 'o1', ref: 'VB-WAIT1', status: 'pending', payment_status: 'awaiting', payment_method: 'online', total: 300, email: 'w@example.com', name: 'W' },
             { id: 'o2', ref: 'VB-KNOWN', status: 'confirmed', payment_status: 'paid', payment_method: 'online', total: 500 }],
    order_items: [], refunds: [], restore_findings: [], admins: [{ id: OWNER, role: 'owner' }],
    site_settings_private: [], mail: [],
  };
  const LENCO = { 'VB-WAIT1-0000000001': 'successful' };
  const filt = (rows, q) => rows.filter((r) => {
    for (const [k, v] of new URLSearchParams(q)) {
      if (['select', 'order', 'limit', 'on_conflict'].includes(k)) continue;
      const m = /^(eq|in|gt|is)\.(.*)$/.exec(v); if (!m) continue;
      const x = r[k] == null ? '' : String(r[k]);
      if (m[1] === 'eq' && x !== m[2]) return false;
      if (m[1] === 'is' && m[2] === 'null' && r[k] != null) return false;
      if (m[1] === 'gt' && !(x > m[2])) return false;
      if (m[1] === 'in' && m[2].replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, '')).indexOf(x) < 0) return false;
    }
    return true;
  });
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const ch of req) body += ch;
    const u = new URL(req.url, 'http://x');
    const send = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(o === undefined ? '' : J(o)); };
    const p = u.pathname;
    if (p === '/web/auth/v1/user') return /Bearer x\./.test(req.headers.authorization || '') ? send(200, { id: OWNER }) : send(401, {});
    if (p.startsWith('/lenco/')) {
      const q = p.replace('/lenco', '');
      if (q.startsWith('/collections/status/')) {
        const ref = decodeURIComponent(q.split('/').pop());
        return LENCO[ref] ? send(200, { status: true, data: { id: 'c1', reference: ref, lencoReference: '24001', amount: '300.00', currency: 'ZMW',
                                                               type: 'mobile-money', status: LENCO[ref], completedAt: new Date().toISOString() } })
                          : send(404, { status: false, message: 'not found' });
      }
      if (q === '/collections') {
        return send(200, { status: true, data: [
          { id: 'c2', reference: 'VB-LOST1-0000000003', lencoReference: '24002', amount: '1200.00', currency: 'ZMW', type: 'card',
            status: 'successful', initiatedAt: new Date().toISOString(), completedAt: new Date().toISOString() },
          { id: 'c3', reference: 'VB-WAIT1-0000000001', lencoReference: '24001', amount: '300.00', currency: 'ZMW', type: 'mobile-money',
            status: 'successful', initiatedAt: new Date().toISOString(), completedAt: new Date().toISOString() },
          { id: 'c4', reference: 'SOMEONE-ELSE', lencoReference: '24003', amount: '50.00', currency: 'ZMW', type: 'card',
            status: 'successful', initiatedAt: new Date().toISOString(), completedAt: new Date().toISOString() }],
          meta: { total: 3, pageCount: 1, perPage: 10, currentPage: 1 } });
      }
      return send(404, { status: false });
    }
    if (p === '/flw/transactions') return send(200, { status: 'success', meta: { page_info: { total_pages: 1 } }, data: [
      { id: 999, tx_ref: 'VB-LOST2-0000000004', amount: 800, currency: 'ZMW', status: 'successful', created_at: new Date().toISOString(), flw_ref: 'FLW-9' },
      { id: 777, tx_ref: 'VB-KNOWN-0000000002', amount: 500, currency: 'ZMW', status: 'successful', created_at: new Date().toISOString() }] });
    if (p === '/flw/refunds') return send(200, { status: 'success', meta: { page_info: { total_pages: 1 } }, data: [
      { id: 5551, tx_id: 777, amount_refunded: 500, status: 'completed', created_at: new Date().toISOString() }] });
    if (p === '/web/rest/v1/site_settings') {
      const SET = { notifications: { emailEnabled: true, smtpHost: 'smtp.example.com', senderEmail: 'shop@example.com' },
                    contact: { email: 'shop@example.com' }, general: { businessName: 'Vaultique' } };
      const k = (u.searchParams.get('key') || '').replace(/^eq\./, '');
      if (k.indexOf('in.(') === 0) return send(200, k.slice(4, -1).split(',').filter((x) => SET[x]).map((x) => ({ key: x, data: SET[x] })));
      return send(200, SET[k] ? [{ key: k, data: SET[k] }] : []);
    }
    const t = /^\/web\/rest\/v1\/([a-z_]+)$/.exec(p);
    if (t && DB[t[1]]) {
      const rows = DB[t[1]];
      if (req.method === 'GET') return send(200, filt(rows, u.search.slice(1)));
      if (req.method === 'POST') {
        const b = JSON.parse(body);
        (Array.isArray(b) ? b : [b]).forEach((x) => {
          if (t[1] === 'site_settings_private') { const i = rows.findIndex((r) => r.key === x.key); if (i > -1) rows[i] = x; else rows.push(x); }
          else if (t[1] === 'restore_findings') { if (!rows.some((r) => r.kind === x.kind && r.reference === x.reference && r.gateway === x.gateway)) rows.push(x); }
          else rows.push(x);
        });
        return send(201, /minimal/.test(req.headers.prefer || '') ? undefined : rows);
      }
      if (req.method === 'PATCH') { const hit = filt(rows, u.search.slice(1)); hit.forEach((r) => Object.assign(r, JSON.parse(body))); return send(200, hit); }
    }
    if (p === '/web/rest/v1/rpc/throttle' || p === '/web/rest/v1/rpc/pay_expire_stale') return send(204);
    send(404, { path: p });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  Object.assign(process.env, { WEB_SUPABASE_URL: base + '/web', WEB_SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service',
    LENCO_SECRET_KEY_TEST: 'lenco-test-token', LENCO_API_BASE_TEST: base + '/lenco', FLW_SECRET_KEY_TEST: 'FLWSECK_TEST-x', FLW_API_BASE: base + '/flw' });
  delete process.env.LENCO_SECRET_KEY_LIVE; delete process.env.FLW_SECRET_KEY_LIVE;
  const F = path.join(ROOT, 'netlify', 'functions');
  require(path.join(F, 'send-email'))._internals.sendMail = async (m) => { DB.mail.push(m); };
  const fn = require(path.join(F, 'after-restore')).handler;
  const R = require(path.join(F, '_refund'));
  const call = (method, b, aal) => fn({ httpMethod: method, headers: { authorization: 'Bearer ' + tok(aal || 'aal2') }, body: b ? J(b) : undefined })
    .then((r) => ({ code: r.statusCode, body: JSON.parse(r.body || '{}') }));
  try {
    let r = await call('POST', { action: 'start', since }, 'aal1');
    is(r.code === 403, 'the owner only, and only after two-factor', J(r));
    r = await call('POST', { action: 'start', since: '2020-01-01T00:00:00Z' });
    is(r.code === 400 && /last 120 days/.test(r.body.error), 'a copy\'s time that cannot be right is refused', J(r.body));
    r = await call('POST', { action: 'start', since });
    const h = DB.site_settings_private.find((x) => x.key === 'restore_hold');
    is(r.code === 200 && h && h.data.active === true && h.data.since === since, 'refunds are held from the moment the check starts', J(h));
    const pay = DB.payments[0];
    is(r.body.settled === 1 && pay.status === 'paid' && DB.orders[0].payment_status === 'paid',
       'a payment waiting in the copy, confirmed by Lenco: marked paid on its word', J([r.body.settled, pay.status]));
    const f = (kind, ref) => r.body.findings.find((x) => x.kind === kind && x.reference === ref);
    is(f('payment_not_in_copy', 'VB-LOST1-0000000003') && f('payment_not_in_copy', 'VB-LOST1-0000000003').gateway === 'lenco' &&
       f('payment_not_in_copy', 'VB-LOST2-0000000004') && f('payment_not_in_copy', 'VB-LOST2-0000000004').gateway === 'flutterwave',
       'payments Lenco and Flutterwave took after the copy, that the copy has no record of, are found', J(r.body.findings));
    is(!f('payment_not_in_copy', 'VB-KNOWN-0000000002') && !r.body.findings.some((x) => x.reference === 'SOMEONE-ELSE'),
       'not one the copy already holds, nor anything that is not the shop\'s');
    is(f('refund_not_in_copy', 'VB-KNOWN-0000000002') && f('refund_not_in_copy', 'VB-KNOWN-0000000002').amount === 500,
       'a refund Flutterwave made after the copy is found, so it is never made again');
    is(DB.restore_findings.length === r.body.findings.length && DB.mail.some((m) => /After the restore/.test(m.subject) && /VB-LOST1/.test(m.text)),
       'kept for Admin > Settings > Backups, and emailed to the shop', J(DB.mail.map((m) => m.subject)));
    await call('POST', { action: 'start', since });
    is(DB.restore_findings.length === r.body.findings.length, 'asked again, nothing is found twice');
    // A refund asked for while the hold is on.
    DB.refunds.push({ id: 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001', request_key: 'k1', order_id: 'o2', order_ref: 'VB-KNOWN', payment_id: null,
                      tx_ref: 'VB-KNOWN-0000000002', provider_tx_id: '777', mode: 'test', currency: 'ZMW', amount: 500, whole: true,
                      reason: 'asked again', by_name: 'Clerk', state: 'new' });
    await R.send('aaaaaaaa-bbbb-4ccc-8ddd-000000000001');
    const rf = DB.refunds[0];
    is(rf.state === 'refused' && /restored from a copy/.test(rf.flw_message) && /Nothing was sent/.test(rf.flw_message),
       'a refund asked for while the check is open is not sent: the platform is told why', J([rf.state, rf.flw_message]));
    r = await call('GET');
    is(r.code === 200 && r.body.hold.active && r.body.findings.length === DB.restore_findings.length, 'where it stands, for the admin page');
    r = await call('POST', { action: 'finish' });
    const h2 = DB.site_settings_private.find((x) => x.key === 'restore_hold');
    is(r.code === 200 && h2.data.active === false && DB.restore_findings.every((x) => x.resolved_at), 'finished: refunds may be sent again');
  } finally {
    await new Promise((d) => server.close(d));
  }
}
