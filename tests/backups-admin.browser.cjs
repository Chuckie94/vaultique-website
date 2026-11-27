/* ===========================================================================
   ADMIN > SETTINGS > BACKUPS (website build 92) -- in a real browser

   The real admin.html, shell.js, settings-ui.js and settings/backups.js;
   Supabase and after-restore answered here (the harness of
   tests/risk.browser.cjs).

     - how the copies are doing: not set up, no copy yet, the last copy
       checked out, or did not (and the last good one), the GitHub minutes,
       the drill due
     - YOUR BACKUP KEY, made in this browser: the private half saved as a
       file and nowhere else; the public half to copy into GitHub; and the
       pair really opens what the backup seals (tools/backup/envelope.cjs)
     - after a restore: refunds held, what the gateways said, finishing
     - a phone's width; the admin's own dialogs only

   SHOTS=<folder> keeps pictures.
   =========================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const E = require('../tools/backup/envelope.cjs');
const ROOT = path.resolve(__dirname, '..');

let checks = 0, failures = 0;
const ok = m => { checks++; console.log('  ✓ ' + m); };
const fail = (m, x) => { checks++; failures++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); };
const is = (c, m, x) => c ? ok(m) : fail(m, x);
const J = o => JSON.stringify(o);
const SHOTS = process.env.SHOTS || '';

const SUPA = `
(function () {
  var S = window.__SETUP || {};
  var DB = { site_settings: S.pub || {}, site_settings_private: S.priv || {} };
  window.__writes = [];
  window.__rpc = [];
  function answer(st) {
    if (st.table === 'admins') return { data: [{ id: 'u1' }], error: null };
    if (st.table === 'site_settings' || st.table === 'site_settings_private') {
      var rows = DB[st.table];
      if (st.op === 'upsert') {
        window.__writes.push({ table: st.table, row: JSON.parse(JSON.stringify(st.row)) });
        rows[st.row.key] = st.row.data;
        return { data: null, error: null };
      }
      if (st.key) return { data: rows[st.key] ? { data: rows[st.key] } : null, error: null };
      return { data: Object.keys(rows).map(function (k) { return { key: k, data: rows[k] }; }), error: null };
    }
    if (st.op !== 'select') window.__writes.push({ table: st.table, op: st.op, row: st.row ? JSON.parse(JSON.stringify(st.row)) : null });
    if (st.table === 'backup_runs') {
      if (S.missing) return { data: null, error: { message: 'Could not find the table public.backup_runs in the schema cache' } };
      return { data: S.runs || [], error: null };
    }
    return { data: st.one ? null : [], error: null, count: 0 };
  }
  function from(table) {
    var st = { table: table, op: 'select', key: null, row: null, one: false, open: false };
    var b = {};
    ['select','neq','gt','gte','lt','lte','order','limit','range','is','or','not','ilike','like','match','filter','contains']
      .forEach(function (k) { b[k] = function () { return b; }; });
    b.in = function (col) { if (col === 'review_state') st.open = true; return b; };
    b.eq = function (col, val) { if (col === 'key') st.key = val; return b; };
    b.single = b.maybeSingle = function () { st.one = true; return b; };
    b.upsert = function (row) { st.op = 'upsert'; st.row = row; return b; };
    b.insert = function (row) { st.op = 'insert'; st.row = row; return b; };
    b.update = function (row) { st.op = 'update'; st.row = row; return b; };
    b.delete = function () { st.op = 'delete'; return b; };
    b.then = function (ok, bad) { return Promise.resolve(answer(st)).then(ok, bad); };
    return b;
  }
  function rpcAnswer(n, a) {
    window.__rpc.push([n, a]);
    if (n === 'my_access') return { data: S.access, error: null };
    if (n === 'risk_summary') {
      if (S.missing) return { data: null, error: { message: 'Could not find the function public.risk_summary(p_days) in the schema cache' } };
      if (S.refused) return { data: { ok: false, why: 'not_allowed' }, error: null };
      return { data: Object.assign({}, S.summary, { days: a.p_days }), error: null };
    }
    if (n === 'risk_decide') {
      var c = (S.cases || []).filter(function (x) { return x.id === a.p_id; })[0];
      if (!c) return { data: { ok: false, why: 'not_found' }, error: null };
      if (a.p_decision === 'reject' && !a.p_note) return { data: { ok: false, why: 'say_why' }, error: null };
      c.review_state = { approve: 'approved', reject: 'rejected', escalate: 'escalated' }[a.p_decision];
      return { data: { ok: true, state: c.review_state, release: a.p_decision === 'approve' && c.action === 'held' && c.moment === 'payment_paid' }, error: null };
    }
    if (n === 'audit_verify') return { data: S.verify || { ok: true, checked: 1204, entries: 1204, lastAt: '2026-11-27T00:10:00Z', anchors: 9 }, error: null };
    return { data: null, error: null };
  }
  window.supabase = { createClient: function () {
    var session = { access_token: 'owner-session-token', user: { id: 'u1', email: 'owner@example.com', email_confirmed_at: 'x' } };
    return {
      auth: {
        getSession: function () { return Promise.resolve({ data: { session: session } }); },
        getUser: function () { return Promise.resolve({ data: { user: session.user } }); },
        onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
        signOut: function () { return Promise.resolve({ error: null }); },
        mfa: {
          getAuthenticatorAssuranceLevel: function () { return Promise.resolve({ data: { currentLevel: 'aal2', nextLevel: 'aal2' }, error: null }); },
          listFactors: function () { return Promise.resolve({ data: { totp: [], all: [] }, error: null }); }
        }
      },
      from: from,
      rpc: function (n, a) { var r = rpcAnswer(n, a || {}); var t = from('rpc'); t.then = function (ok, bad) { return Promise.resolve(r).then(ok, bad); }; return t; },
      channel: function () { var ch = { on: function () { return ch; }, subscribe: function () { return ch; } }; return ch; },
      removeChannel: function () {},
      storage: { from: function () { return { list: function () { return Promise.resolve({ data: [] }); },
        getPublicUrl: function () { return { data: { publicUrl: '' } }; } }; } }
    };
  } };
  window.NATIVE = [];
  window.confirm = function (m) { window.NATIVE.push('confirm: ' + m); return true; };
  window.alert = function (m) { window.NATIVE.push('alert: ' + m); };
  window.prompt = function (m) { window.NATIVE.push('prompt: ' + m); return 'x'; };
})();`;

let AFTER = { hold: null, findings: [] }, AFTER_CALLS = [];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
let base = '';
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), p = u.pathname;
  const json = (o, code) => { res.writeHead(code || 200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (p === '/.netlify/functions/after-restore') {
    let b = ''; req.on('data', c => b += c);
    return req.on('end', () => {
      const body = b ? JSON.parse(b) : null;
      AFTER_CALLS.push({ method: req.method, auth: req.headers.authorization || '', body });
      if (req.method === 'GET') return json(AFTER);
      if (body.action === 'start') { AFTER.hold = { active: true, since: body.since, checkedAt: new Date().toISOString() }; return json({ settled: 1, findings: AFTER.findings }); }
      if (body.action === 'finish') { AFTER.hold = Object.assign({}, AFTER.hold, { active: false }); return json({ finished: true }); }
      json({ error: 'Unknown request.' }, 400);
    });
  }
  if (p === '/api/products') return json({ products: [], version: 't' });
  if (p.startsWith('/web/')) return json([]);
  if (p.startsWith('/.netlify/functions/')) return json({});
  if (p === '/config.js') {
    res.writeHead(200, { 'Content-Type': TYPES['.js'] });
    return res.end('window.VBP_CONFIG={SUPABASE_URL:"' + base + '/web",SUPABASE_ANON_KEY:"anon"};');
  }
  let file = path.join(ROOT, p === '/' ? 'index.html' : p);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});

const OWNER = { is_admin: true, is_owner: true, active: true, must_change_password: false };
const now = Date.now();
const iso = (ms) => new Date(now - ms).toISOString();
// The copy's name is made from its time, as tools/backup/backup.cjs makes it (2026-11-27T0117Z).
const copyId = (ms) => iso(ms).slice(0, 16).replace(/:/g, '') + 'Z';
const run = (ms, o) => Object.assign({ at: iso(ms), kind: 'copy', ok: true, checked: true, copy_id: copyId(ms), size_bytes: 612000,
  tables: 54, rows: 12345, logins: 210, pictures_new: 0, pictures_total: 340, copies_kept: 31, seconds: 38, problems: [], detail: { kid: '1a2b3c4d5e6f7081' } }, o || {});
const RUNS = [run(40 * 60000, { pictures_new: 2 })].concat(Array.from({ length: 11 }, (_, i) => run((i + 1) * 2 * 3600000 + 40 * 60000)));

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const errors = [];
  async function open(setup, size) {
    AFTER_CALLS = [];
    const ctx = await browser.newContext({ viewport: size || { width: 1100, height: 1300 }, deviceScaleFactor: SHOTS ? 2 : 1, acceptDownloads: true });
    await ctx.addInitScript('window.__SETUP = ' + J(Object.assign({ access: OWNER, pub: {}, priv: {}, runs: RUNS }, setup || {})) + ';');
    await ctx.route(/\/assets\/vendor\/supabase-js-[0-9.]+\.js(\?.*)?$/, r => r.fulfill({ status: 200, contentType: 'text/javascript', body: SUPA }));
    await ctx.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(String(e.message || e)));
    await page.goto(base + '/admin.html#/settings/backups', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.bk-status h3', { timeout: 10000 });
    await page.waitForTimeout(500);
    return { ctx, page };
  }
  const text = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); return e ? e.innerText.replace(/\s+/g, ' ') : ''; }, sel);

  try {
    console.log('\nHow the copies are doing');
    let { ctx, page } = await open({ missing: true });
    is(/Run supabase-backup\.sql \(it is in the chat\)/.test(await text(page, '.bk-status')), 'before its SQL is run: which SQL, and that it is in the chat');
    await ctx.close();
    ({ ctx, page } = await open({ runs: [] }));
    const none = await text(page, '.bk-status');
    is(/No copy yet/.test(none) && /no copy of the shop outside Supabase/.test(none) && /SETUP\.md/.test(none),
       'no copy yet: said plainly, with what it means and where the steps are', none);
    await ctx.close();
    ({ ctx, page } = await open());
    const s = await text(page, '.bk-status');
    is(/The last copy, 40 minutes ago, checked out by restoring it/.test(s), 'the last copy: when, and that it checked out by restoring it', s.slice(0, 200));
    is(/54 tables, 12,345 rows, 210 logins/.test(s) && /598 KB/.test(s) && /340 kept, 2 new in this copy/.test(s) && /31 \(every copy for two days/.test(s),
       'what it holds, its size, the pictures, how many copies are kept', s);
    is(/Sealed for key\s*1a2b3c4d5e6f7081/.test(s), 'which key opens it, so you can tell you have the right private key');
    is(/12 copies, all checked out/.test(s) && /about 720 a month at this rate/.test(s),
       'the last day, and the GitHub minutes at this rate (12 a day, each 38 s and GitHub\'s own 45, counted as 2 minutes, × 30)', s);
    is(/The last drill\s*not yet/.test(s) && /A drill is due/.test(await text(page, '.bk-status')), 'no drill yet: one is due, every three months');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'backups-1-status.png'), fullPage: true });
    await ctx.close();
    ({ ctx, page } = await open({ runs: [run(20 * 60000, { ok: false, checked: false, problems: ['public.orders: the copy holds 40 rows, 39 came back'] }),
                                        run(140 * 60000), run(80 * 86400000, { kind: 'drill' })] }));
    const bad = await text(page, '.bk-status');
    is(/THE LAST COPY, 20 MINUTES AGO, DID NOT CHECK OUT/.test(bad) && /the copy holds 40 rows, 39 came back/.test(bad) &&
       /The last good copy/.test(bad) && /2 hours ago/.test(bad), 'a copy that did not check out: in red, why, and the last good one', bad);
    is(/The last drill\s*\d/.test(bad) && !/A drill is due/.test(bad), 'a drill within three months: shown, nothing due');
    await ctx.close();

    console.log('\nYour backup key, made in this browser');
    ({ ctx, page } = await open());
    const native = []; page.on('dialog', d => { native.push(d.message()); d.dismiss().catch(() => {}); });
    await page.click('button:has-text("Make my backup key")');
    await page.waitForSelector('.ask-back.in .ask-card', { timeout: 3000 });
    const asked = await text(page, '.ask-back.in .ask-card');
    is(/Make a new backup key\?/.test(asked) && /Copies already made still need the old one/.test(asked), 'asked first, saying old copies need the old key', asked);
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('.ask-back.in .ask-card .ask-row .btn-gold')]);
    await page.waitForSelector('.bk-pub', { timeout: 30000 });
    const privPem = fs.readFileSync(await dl.path(), 'utf8');
    const pubPem = await page.inputValue('.bk-pub');
    const made = await text(page, '.bk-made');
    const kid = E.kidOf(E.publicKeyFrom(pubPem));
    is(/^vaultique-backup-private-key-[0-9a-f]{16}\.pem$/.test(dl.suggestedFilename()) && dl.suggestedFilename().indexOf(kid) > -1,
       'the private half is saved to this computer as a file named with its key', dl.suggestedFilename());
    is(/BEGIN PRIVATE KEY/.test(privPem) && /BEGIN PUBLIC KEY/.test(pubPem) && !/PRIVATE/.test(pubPem) && made.indexOf('Key ' + kid) > -1,
       'the public half shown to copy into GitHub, never the private one; the key named the same as the backup names it', made.slice(0, 160));
    const pk = E.privateKeyFrom(privPem);
    const back = E.openNamed(E.sealNamed({ part: 'public' }, Buffer.from('every order'), E.publicKeyFrom(pubPem)), pk);
    is(back.data.toString() === 'every order' && E.publicKeyFrom(pubPem).asymmetricKeyDetails.modulusLength === 4096,
       'and the pair really works: what the backup seals with the public half, the private half opens (RSA, 4096 bits)');
    const sent = AFTER_CALLS.concat(await page.evaluate(() => window.__writes || [])).map(J).join(' ');
    is(sent.indexOf('PRIVATE KEY') < 0 && sent.indexOf(privPem.slice(40, 80)) < 0, 'the private half was sent nowhere: not to the website, not to Supabase');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'backups-2-key.png'), fullPage: false });
    await ctx.close();

    console.log('\nAfter a restore');
    AFTER = { hold: { active: true, since: '2026-11-27T01:17:00.000Z', checkedAt: iso(5 * 60000) },
              findings: [{ kind: 'payment_not_in_copy', gateway: 'lenco', mode: 'live', reference: 'VB-LOST1-0000000003', amount: 1200, currency: 'ZMW', happened_at: iso(3600000) },
                         { kind: 'refund_not_in_copy', gateway: 'flutterwave', mode: 'live', reference: 'VB-KNOWN-0000000002', amount: 500, currency: 'ZMW' }] };
    ({ ctx, page } = await open());
    await page.waitForSelector('.bk-findings li', { timeout: 5000 });
    const a = await text(page, '.bk-after');
    is(/Refunds are held: the website was restored from the copy of/.test(await text(page, '.bk-after .bk-due')), 'refunds held: said at the top', a.slice(0, 300));
    is(/Paid after the copy: its order was lost; contact the customer · VB-LOST1-0000000003 · ZMW 1200 · Lenco/.test(a) &&
       /Refunded after the copy: do not refund it again · VB-KNOWN-0000000002/.test(a), 'what the gateways said, line by line, in plain words', a);
    // The picture: refunds held, and what the gateways said, before the restore is finished.
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'backups-3-after.png'), fullPage: true });
    await page.click('button:has-text("Check the gateways now")');
    is(/Choose when the copy you restored was made/.test(await text(page, '.bk-say')), 'without the copy\'s time, nothing is asked');
    await page.fill('.bk-since', '2026-11-27T03:17');
    await page.click('button:has-text("Check the gateways now")');
    await page.waitForFunction(() => /confirmed/.test((document.querySelector('.bk-say') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
    const start = AFTER_CALLS.find(c => c.body && c.body.action === 'start');
    is(start && /^Bearer owner-session-token$/.test(start.auth) && /^2026-11-27T\d\d:17:00\.000Z$/.test(start.body.since),
       'asked with the owner\'s own sign-in, and the copy\'s time', J(start));
    await page.click('button:has-text("The restore is finished")');
    await page.waitForSelector('.ask-back.in .ask-card', { timeout: 3000 });
    is(/make sure every refund on the list has been recorded on the platform/.test(await text(page, '.ask-back.in .ask-card')),
       'finishing asks first: every refund on the list recorded on the platform');
    await page.click('.ask-back.in .ask-card .ask-row .btn-gold');
    await page.waitForFunction(() => !document.querySelector('.bk-after .bk-due'), null, { timeout: 5000 }).catch(() => {});
    is(AFTER_CALLS.some(c => c.body && c.body.action === 'finish') && !(await page.$('.bk-after .bk-due')) &&
       !(await page.$('button:has-text("The restore is finished")')),
       'finished: refunds no longer held', J(AFTER_CALLS.map(c => c.method + ' ' + (c.body && c.body.action))) + ' ' + (await text(page, '.bk-after')).slice(0, 200));
    is(native.length === 0, 'the browser\'s own boxes never appear');
    await ctx.close();

    console.log('\nOn a phone');
    ({ ctx, page } = await open({}, { width: 390, height: 900 }));
    const wide = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    is(wide[0] <= wide[1], 'nothing is wider than the screen', J(wide));
    await ctx.close();
    is(errors.length === 0, 'no errors on any page', errors.join(' | '));
  } catch (e) { fail('the test itself broke', e && e.stack); }
  finally { await browser.close(); server.close(); }
  console.log(failures ? '\n  ✗ ' + failures + ' of ' + checks + ' checks FAILED' : '\n  backups admin: all ' + checks + ' checks passed');
  process.exit(failures ? 1 : 0);
})();
