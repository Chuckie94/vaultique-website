/* ===========================================================================
   THE BACKUP, A WHOLE COPY AND THE FIRST DRILL (website build 92)

   Run on the database tools/db-check.sh has just built: every website SQL
   file, the hardening, and the people and orders its checks wrote, on the
   stand-in Supabase. Here, against PostgreSQL itself and the stand-in
   storage account (tests/backup-standins.js):

     - a copy made with pg_dump, checked by restoring it into an empty
       database, sealed with a key pair made as the admin page makes one,
       kept, and read back
     - the pictures copied once, then only what is new
     - the drill: the copy kept, opened with the private key, restored, every
       table and row as it was
     - a copy that does not restore is said to be so; a copy changed in the
       storage account, or opened with another key, is refused
     - old copies let go as planned, the newest good one never

   Needs: BACKUP_TEST_DB, the database to copy (default: db-check's, as
   postgres with the round trip's password), and BACKUP_TEST_SCRATCH, a server
   for the check (default: the same server). Skips, saying so, without them.
   =========================================================================== */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const B = require('../tools/backup/backup.cjs');
const E = require('../tools/backup/envelope.cjs');
const S3 = require('../tools/backup/s3.cjs');
const PG = require('../tools/backup/pgtools.cjs');
const { startS3, startStorage } = require('./backup-standins.js');

let checks = 0, failures = 0;
const is = (c, m, x) => { checks++; if (c) console.log('  ✓ ' + m); else { failures++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); } };
const J = (o) => JSON.stringify(o);
const DB = process.env.BACKUP_TEST_DB || 'postgresql://postgres:roundtrip-local@127.0.0.1:5432/vbp_db_check';
const SCRATCH = process.env.BACKUP_TEST_SCRATCH || 'postgresql://postgres:roundtrip-local@127.0.0.1:5432/postgres';

(async () => {
  const conn = PG.connFromUrl(DB);
  const probe = await PG.run('psql', ['-X', '-q', '-A', '-t', '-c', 'select count(*) from public.orders'], { conn });
  if (probe.code !== 0) {
    console.log('  backup cycle: skipped — no database to copy at ' + DB.replace(/:[^:@/]+@/, ':…@') + ' (' + probe.stderr.split('\n')[0] + ')');
    process.exit(0);
  }
  const live = await PG.sqlJson(`select json_build_object('tables', (select count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'),
                                   'users', (select count(*) from auth.users), 'orders', (select count(*) from public.orders))`, conn);
  const s3 = await startS3();
  const pics = await startStorage({ buckets: {
    'product-images': { 'silk-scarf.jpg': { data: crypto.randomBytes(3000), type: 'image/jpeg', at: '2026-11-20T10:00:00Z' } },
    'chat-photos': { 'c-1/c-aa11.jpg': { data: crypto.randomBytes(2000), type: 'image/jpeg', at: '2026-11-21T10:00:00Z' } },
  } });
  const keys = E.makeKeyPair(4096);
  const cfg = { dbUrl: DB, publicKey: keys.publicPem, privateKey: '', s3: s3.cfg, supabaseUrl: pics.url, serviceKey: pics.serviceKey,
                scratchUrl: SCRATCH, prefix: process.env.BACKUP_PG || '' };
  const store = S3.client(s3.cfg);
  try {
    console.log('\nA copy, checked by restoring it, sealed and kept');
    const t0 = Date.now();
    let run = await B.copyRun(cfg, { now: new Date('2026-11-27T01:17:00Z') });
    is(run.ok && run.checked && run.problems.length === 0, 'made, and checked by restoring it into an empty database: nothing failed', J(run.problems));
    is(run.tables === live.tables && run.rows > 0 && run.logins === live.users,
       'every table of the shop (' + live.tables + '), every login (' + live.users + '), ' + run.rows + ' rows', J([run.tables, run.logins, live]));
    const kept = Array.from(s3.st.objects.keys()).filter((k) => k.indexOf('copies/2026-11-27T0117Z/') === 0).sort();
    is(J(kept) === J(['auth.vqb', 'counts.vqb', 'manifest.json', 'public.vqb', 'storage.vqb'].map((n) => 'copies/2026-11-27T0117Z/' + n)),
       'kept in the storage account: the shop\'s tables, the logins, the pictures\' records, the counts, and a list of them', J(kept));
    const manifest = JSON.parse(s3.st.objects.get('copies/2026-11-27T0117Z/manifest.json').body.toString());
    is(manifest.checked === true && manifest.kid === E.kidOf(E.publicKeyFrom(keys.publicPem)) &&
       Object.keys(manifest.files).every((n) => manifest.files[n].sha256 === crypto.createHash('sha256').update(s3.st.objects.get('copies/2026-11-27T0117Z/' + n).body).digest('hex')),
       'its list says it checked out, which key opens it, and each file\'s fingerprint');
    const plain = Array.from(s3.st.objects.values()).map((o) => o.body.toString('latin1')).join('');
    is(!/owner@shop\.test|VB-AH801|CREATE TABLE|orders/.test(plain.replace(/"part":"[a-z]+"/g, '')),
       'nothing in the storage account can be read without the key: no email, no order, no table name', '');
    is(s3.st.refused === 0, 'every request to the storage account carried a signature it accepted');
    is(run.pictures_new === 2 && run.pictures_total === 2, 'the pictures: both copied, sealed', J(run.detail.pictures));
    is(pics.st.runs && pics.st.runs.length === 1 && pics.st.runs[0].kind === 'copy' && pics.st.runs[0].ok === true,
       'the run is written down for Admin > Settings > Backups', J(pics.st.runs));
    console.log('     (the copy took ' + Math.round((Date.now() - t0) / 1000) + ' s here)');

    run = await B.copyRun(cfg, { now: new Date('2026-11-27T02:17:00Z') });
    is(run.ok && run.pictures_new === 0 && pics.st.downloads === 2, 'the next copy: the pictures already kept are not copied again');
    pics.st.buckets['product-images']['new-bag.jpg'] = { data: crypto.randomBytes(1500), type: 'image/jpeg', at: '2026-11-27T02:30:00Z' };
    run = await B.copyRun(cfg, { now: new Date('2026-11-27T03:17:00Z') });
    is(run.ok && run.pictures_new === 1 && run.pictures_total === 3, 'a new picture: copied at the next copy, by itself');

    console.log('\nThe drill: the newest copy opened with your private key, and restored');
    let drill = await B.drillRun(cfg);
    is(!drill.ok && /BACKUP_PRIVATE_KEY/.test(drill.problems[0] || ''), 'without the private key, the drill says it needs it', J(drill.problems));
    drill = await B.drillRun(Object.assign({}, cfg, { privateKey: keys.privatePem }));
    is(drill.ok && drill.copy_id === '2026-11-27T0317Z' && drill.tables === live.tables && drill.logins === live.users,
       'opened and restored: every table, row and login as kept', J([drill.problems, drill.tables]));
    const other = E.makeKeyPair(3072);
    drill = await B.drillRun(Object.assign({}, cfg, { privateKey: other.privatePem }));
    is(!drill.ok && /sealed for another key/.test(drill.problems.join(' ')), 'another key: refused, saying which key the copy needs', J(drill.problems));
    const k = 'copies/2026-11-27T0317Z/public.vqb';
    const good = s3.st.objects.get(k).body;
    const bad = Buffer.from(good); bad[bad.length - 40] ^= 1;
    s3.st.objects.set(k, { body: bad, at: new Date().toISOString() });
    drill = await B.drillRun(Object.assign({}, cfg, { privateKey: keys.privatePem }));
    is(!drill.ok && /not as it was kept/.test(drill.problems.join(' ')), 'DRILL: a copy changed in the storage account is caught', J(drill.problems));
    s3.st.objects.set(k, { body: good, at: new Date().toISOString() });

    console.log('\nA real restore, as RECOVERY.md does it: into a new project, never over a working shop');
    const R = require('../tools/backup/restore.cjs');
    const os = require('os');
    const fs0 = require('fs');
    const dir = fs0.mkdtempSync(path.join(os.tmpdir(), 'vq-restore-'));
    const opened = await R.openCopy(store, 'latest', keys.privatePem, path.join(dir, 'copy'));
    is(opened.id === '2026-11-27T0317Z' && ['public.dump', 'auth.dump', 'storage.dump', 'counts.json'].every((f) => fs0.existsSync(path.join(dir, 'copy', f))),
       'the newest copy that checked out, opened with the private key into a folder', J(opened));
    let refused = '';
    try { await R.restoreInto(path.join(dir, 'copy'), DB, cfg.prefix); } catch (e) { refused = e.message; }
    is(/already has the shop's tables/.test(refused), 'restoring over the working shop is refused, whatever is typed', refused);
    const target = PG.connFromUrl(SCRATCH);
    const admin = PG.withDb(target, target.PGDATABASE);
    await PG.must('psql', ['-X', '-q', '-c', 'drop database if exists vq_new_project'], { conn: admin });
    await PG.must('psql', ['-X', '-q', '-c', 'create database vq_new_project'], { conn: admin });
    const newDb = PG.withDb(target, 'vq_new_project');
    await PG.must('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', '-'],
                  { conn: newDb, input: fs0.readFileSync(path.join(__dirname, 'supabase-standin', 'supabase-standin.sql')) }, 'The new project (stand-in)');
    const newUrl = SCRATCH.replace(/\/[^/?]*(\?.*)?$/, '/vq_new_project');
    const done = await R.restoreInto(path.join(dir, 'copy'), newUrl, cfg.prefix);
    is(done.ok, 'restored into a new (stand-in) Supabase project: the logins, the shop, the pictures\' records, and every count agrees',
       J(done.steps));
    const after = await PG.sqlJson(`select json_build_object('users', (select count(*) from auth.users), 'orders', (select count(*) from public.orders),
                                     'rls', (select bool_and(relrowsecurity) from pg_class where relname in ('orders', 'payments', 'risk_cases', 'audit_chain')),
                                     'anonOrders', has_table_privilege('anon', 'public.orders', 'select'),
                                     'frozen', exists (select 1 from pg_trigger where tgname = 'audit_chain_frozen'))`, newDb);
    is(after.users === live.users && after.orders === live.orders && after.rls === true && after.frozen === true,
       'with its rules: row security on, the sealed record still frozen', J(after));
    const verified = await PG.sqlJson('select public.audit_verify(100000)', newDb).catch(() => null);
    is(verified && verified.ok === true, 'and the sealed record, restored, still checks out entry by entry', J(verified));
    const pics2 = await R.openPictures(store, keys.privatePem, path.join(dir, 'pictures'));
    const back = fs0.readFileSync(path.join(dir, 'pictures', 'chat-photos', 'c-1', 'c-aa11.jpg'));
    is(pics2.files === 3 && back.equals(pics.st.buckets['chat-photos']['c-1/c-aa11.jpg'].data),
       'the pictures opened, each exactly as it was, in its own folder', J(pics2));
    await PG.run('psql', ['-X', '-q', '-c', 'drop database if exists vq_new_project'], { conn: admin });
    fs0.rmSync(dir, { recursive: true, force: true });

    console.log('\nA copy that does not restore is said to be so');
    const copy = await B.makeCopy(conn, cfg.prefix);
    const emptyAuth = await PG.must('pg_dump', ['--format=custom', '--data-only', '--table=auth.no_such_table'], { conn }).catch(() => null);
    const broken = { live: copy.live, dumps: { public: copy.dumps.public, auth: emptyAuth ? emptyAuth.stdout : copy.dumps.storage, storage: copy.dumps.storage } };
    const check = await B.checkCopy(broken, PG.connFromUrl(SCRATCH), cfg.prefix, fs.readFileSync(path.join(__dirname, '..', 'tools', 'backup', 'scratch-supabase.sql'), 'utf8'));
    is(!check.ok && check.problems.some((p) => /foreign key|violates/.test(p)),
       'DRILL: a copy without the logins its customers point at fails the check, with the reason', J(check.problems.slice(0, 2)));

    const scaffold = fs.readFileSync(path.join(__dirname, '..', 'tools', 'backup', 'scratch-supabase.sql'), 'utf8');
    // Rows that do not come back, with no error from the restore: a trigger,
    // put in by the test's own empty database, that quietly drops some orders.
    const dropping = scaffold + `
      create schema if not exists drillx;
      create or replace function drillx.skip_row() returns trigger language plpgsql as $f$ begin return null; end $f$;
      create or replace function drillx.on_create() returns event_trigger language plpgsql as $f$
      declare r record;
      begin
        for r in select * from pg_event_trigger_ddl_commands() where command_tag = 'CREATE TABLE' and object_identity = 'public.orders' loop
          execute 'create trigger drill_skip before insert on public.orders for each row when (new.ref like ''VB-AH80%'') execute function drillx.skip_row()';
        end loop;
      end $f$;
      drop event trigger if exists drill_on_create;
      create event trigger drill_on_create on ddl_command_end execute function drillx.on_create();`;
    const quiet = await B.checkCopy(copy, PG.connFromUrl(SCRATCH), cfg.prefix, dropping);
    is(!quiet.ok && quiet.problems.some((p) => /public\.orders: the copy holds \d+ rows, \d+ came back/.test(p)),
       'DRILL: rows that do not come back are caught by counting them, even when the restore itself reports nothing', J(quiet.problems.slice(0, 2)));

    s3.st.corrupt = true;
    run = await B.copyRun(cfg, { now: new Date('2026-11-27T03:47:00Z') });
    s3.st.corrupt = false;
    is(!run.ok && run.problems.some((p) => /does not read back the same/.test(p)),
       'DRILL: a storage account that keeps something else than it was sent is caught by reading every file back', J(run.problems));
    for (const key of Array.from(s3.st.objects.keys())) if (key.indexOf('copies/2026-11-27T0347Z/') === 0) s3.st.objects.delete(key);

    console.log('\nOld copies let go');
    const ids = Array.from(new Set(Array.from(s3.st.objects.keys()).filter((x) => x.indexOf('copies/') === 0).map((x) => x.split('/')[1])));
    is(ids.length === 3, 'three copies kept so far, all within two days', J(ids));
    const day = (d, h) => '2026-11-' + String(d).padStart(2, '0') + 'T' + String(h).padStart(2, '0') + '17Z';
    for (const d of [20, 21]) for (const h of [1, 9, 17]) {
      const id = day(d, h);
      s3.st.objects.set('copies/' + id + '/manifest.json', { body: Buffer.from(J({ copy: id, checked: !(d === 21 && h === 1) })), at: '' });
      s3.st.objects.set('copies/' + id + '/public.vqb', { body: Buffer.from('x'), at: '' });
    }
    s3.st.objects.set('copies/2026-10-01T0117Z/manifest.json', { body: Buffer.from(J({ checked: true })), at: '' });
    run = await B.copyRun(cfg, { now: new Date('2026-11-27T04:17:00Z') });
    const left = Array.from(new Set(Array.from(s3.st.objects.keys()).filter((x) => x.indexOf('copies/') === 0).map((x) => x.split('/')[1]))).sort();
    is(J(left) === J(['2026-11-20T0117Z', '2026-11-21T0917Z', '2026-11-27T0117Z', '2026-11-27T0217Z', '2026-11-27T0317Z', '2026-11-27T0417Z']),
       'older than two days: one a day (the first that checked out); older than thirty days: gone', J(left));
    is(run.copies_kept === 6, 'the run says how many are kept', String(run.copies_kept));
  } catch (e) {
    is(false, 'the cycle itself broke', e && e.stack);
  } finally {
    await s3.close(); await pics.close();
  }
  console.log(failures ? '\n  ✗ ' + failures + ' of ' + checks + ' checks FAILED' : '\n  backup cycle: all ' + checks + ' checks passed');
  process.exit(failures ? 1 : 0);
})();
