#!/usr/bin/env node
/* =====================================================================
   THE BACKUP (website build 92; the enterprise plan's backup build,
   brief §5, E-37 to E-40, E-46; decisions D1, D2, D8)

   Run by GitHub (.github/workflows/backup.yml), never by Netlify, never
   on the shop's own computer:

     node tools/backup/backup.cjs copy     make a copy, check it, keep it
     node tools/backup/backup.cjs drill    open the newest kept copy with
                                           your private key, and restore it

   A COPY, every hour or every two (your choice, D2):
     1. The website's database, read with PostgreSQL's own pg_dump through
        Supabase's session pooler (GitHub's machines only reach Supabase
        that way): the shop's tables with their rules (public), the
        customers' and the team's logins (auth, without sign-in sessions),
        and the pictures' records (storage).
     2. CHECKED BY RESTORING IT, before it is kept: into a fresh, empty
        PostgreSQL on GitHub's machine (tools/backup/scratch-supabase.sql);
        every table of the shop must come back, with exactly the rows the
        copy holds, and the newest order must be there.
     3. Sealed with your public key (tools/backup/envelope.cjs): only your
        private key opens it.
     4. Kept in your storage account (tools/backup/s3.cjs), each file read
        back and its fingerprint compared: copies/<time>/...
     5. The pictures (product photos, chat photos, every file in the
        website's Supabase Storage): new or changed ones only, each sealed.
     6. Old copies let go: every copy for two days, then one a day for
        thirty days. The newest copy that checked out is never let go.
     7. The run written down in the website's database (backup_runs), for
        Admin > Settings > Backups, and in GitHub's own summary of the run.

   Nothing here writes to the shop's database except that one line; a
   restore is never automatic (RECOVERY.md).
   ===================================================================== */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const E = require('./envelope.cjs');
const S3 = require('./s3.cjs');
const PG = require('./pgtools.cjs');

const SCRATCH_DB = 'vq_restore_check';
const KEEP_ALL_HOURS = 48;
const KEEP_DAYS = 30;
const PICTURES_PER_RUN = 300;
const PICTURE_BYTES_PER_RUN = 300 * 1024 * 1024;
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const copyIdOf = (d) => d.toISOString().slice(0, 16).replace(/:/g, '') + 'Z';          // 2026-11-27T0117Z
const timeOfId = (id) => new Date(id.slice(0, 13) + ':' + id.slice(13, 15) + ':00Z');

/* ------------------------------------------------------------------ the setup */
function config(env) {
  env = env || process.env;
  const need = (k) => { const v = String(env[k] || '').trim(); if (!v) throw new Error(k + ' is not set (GitHub > Settings > Secrets and variables > Actions).'); return v; };
  return {
    dbUrl: need('BACKUP_DB_URL'),
    publicKey: String(env.BACKUP_PUBLIC_KEY || '').trim(),
    privateKey: String(env.BACKUP_PRIVATE_KEY || '').trim(),
    s3: { endpoint: need('BACKUP_S3_ENDPOINT'), region: need('BACKUP_S3_REGION'), bucket: need('BACKUP_S3_BUCKET'),
          keyId: need('BACKUP_S3_KEY_ID'), secret: need('BACKUP_S3_SECRET') },
    supabaseUrl: String(env.WEB_SUPABASE_URL || env.SUPABASE_URL || '').trim().replace(/\/+$/, ''),
    serviceKey: String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim(),
    scratchUrl: String(env.BACKUP_SCRATCH_URL || 'postgresql://postgres@localhost:5432/postgres').trim(),
    prefix: String(env.BACKUP_PG || '').trim(),
  };
}

/* ---------------------------------------------------------- 1. the copy itself */
const LIVE_SQL = `select json_build_object(
  'tables', (select coalesce(json_agg(table_name order by table_name), '[]') from information_schema.tables
              where table_schema = 'public' and table_type = 'BASE TABLE'),
  'extensions', (select json_agg(extname order by extname) from pg_extension),
  'newestOrder', (select max(created_at) from public.orders),
  'server', current_setting('server_version'),
  'at', now())`;
const AUTH_SKIP = ['sessions', 'refresh_tokens', 'audit_log_entries', 'flow_state', 'one_time_tokens', 'mfa_challenges',
                   'mfa_amr_claims', 'saml_relay_states', 'schema_migrations'];

async function makeCopy(conn, prefix) {
  const live = await PG.sqlJson(LIVE_SQL, conn, prefix);
  const pub = await PG.must('pg_dump', ['--format=custom', '--no-owner', '--schema=public', '--exclude-table-data=public.rate_events'],
                            { conn, prefix }, 'Copying the shop\'s tables');
  const auth = await PG.must('pg_dump', ['--format=custom', '--no-owner', '--data-only', '--schema=auth']
                               .concat(AUTH_SKIP.map((t) => '--exclude-table-data=auth.' + t)), { conn, prefix }, 'Copying the logins');
  const storage = await PG.must('pg_dump', ['--format=custom', '--no-owner', '--data-only', '--table=storage.buckets', '--table=storage.objects'],
                                { conn, prefix }, 'Copying the pictures\' records');
  return { live, dumps: { public: pub.stdout, auth: auth.stdout, storage: storage.stdout } };
}

/* ------------------------------------------------- 2. checked by restoring it */
async function checkCopy(copy, scratch, prefix, scaffoldSql) {
  const problems = [];
  const admin = PG.withDb(scratch, scratch.PGDATABASE || 'postgres');
  const db = PG.withDb(scratch, SCRATCH_DB);
  const inCopy = await PG.copyContents(copy.dumps.public, prefix);
  const inAuth = await PG.copyContents(copy.dumps.auth, prefix, ['auth.users']);
  const inStorage = await PG.copyContents(copy.dumps.storage, prefix);
  await PG.must('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-c', 'drop database if exists ' + SCRATCH_DB], { conn: admin, prefix }, 'Clearing the check\'s database');
  await PG.must('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-c', 'create database ' + SCRATCH_DB], { conn: admin, prefix }, 'Making the check\'s database');
  try {
    await PG.must('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { conn: db, prefix, input: scaffoldSql }, 'Making the check\'s empty Supabase');
    // The users' ids, from the copy of the logins: the shop's customers and team point at them.
    const users = (inAuth.rows['auth.users'] || []).filter((u) => u.id);
    if (users.length) {
      const lines = users.map((u) => u.id + '\t' + (u.email == null ? '\\N' : u.email)).join('\n') + '\n\\.\n';
      await PG.must('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-c', 'copy auth.users (id, email) from stdin'],
                    { conn: db, prefix, input: lines }, 'Loading the logins\' ids');
    }
    const r = await PG.run('pg_restore', ['--no-owner', '-d', SCRATCH_DB], { conn: db, prefix, input: copy.dumps.public });
    const errors = r.stderr.split('\n').filter((l) => /error:/i.test(l) && !/errors ignored on restore/i.test(l));
    errors.slice(0, 5).forEach((l) => problems.push('restoring: ' + l.replace(/^pg_restore:\s*/, '').slice(0, 240)));
    if (errors.length > 5) problems.push('restoring: ' + (errors.length - 5) + ' more errors');
    // Every table of the shop back (rate_events comes back empty: its rows
    // are the last two days' throttle counts, left out on purpose).
    const restored = (await PG.sqlJson("select coalesce(json_agg(table_name order by table_name), '[]') from information_schema.tables " +
                                       "where table_schema = 'public' and table_type = 'BASE TABLE'", db, prefix)) || [];
    (copy.live.tables || []).forEach((t) => { if (restored.indexOf(t) < 0) problems.push('public.' + t + ': did not come back from the copy'); });
    // And every row the copy holds.
    const tables = Object.keys(inCopy.counts).filter((t) => t.indexOf('public.') === 0);
    const q = 'select json_object_agg(t, n) from (' + (tables.length ? tables.map((t) =>
      "select '" + t + "' as t, (select count(*) from " + t.split('.').map((p) => '"' + p + '"').join('.') + ') as n').join(' union all ') : "select 'none' as t, 0 as n") + ') x';
    const back = (await PG.sqlJson(q, db, prefix)) || {};
    let rows = 0;
    tables.forEach((t) => {
      rows += inCopy.counts[t];
      if (Number(back[t]) !== inCopy.counts[t]) problems.push(t + ': the copy holds ' + inCopy.counts[t] + ' rows, ' + back[t] + ' came back');
    });
    if (copy.live.newestOrder) {
      const newest = await PG.sqlJson('select to_json(max(created_at)) from public.orders', db, prefix);
      if (!newest || new Date(newest) < new Date(copy.live.newestOrder)) problems.push('the newest order is missing from the copy');
    }
    return { ok: problems.length === 0, problems, tables: restored.length, rows,
             counts: { public: inCopy.counts, auth: inAuth.counts, storage: inStorage.counts },
             logins: (inAuth.counts['auth.users'] || 0), files: (inStorage.counts['storage.objects'] || 0) };
  } finally {
    await PG.run('psql', ['-X', '-q', '-c', 'drop database if exists ' + SCRATCH_DB], { conn: admin, prefix });
  }
}

/* --------------------------------------------- 6. which copies are let go */
// ids: copy ids ('2026-11-27T0117Z'); ok: { id: true } for those that checked out.
function toLetGo(ids, ok, now) {
  const t = (now || new Date()).getTime();
  const sorted = ids.slice().sort();
  const newestOk = sorted.filter((id) => ok[id]).pop();
  // Of each day, the first copy that checked out (or the first, if none did).
  const byDay = {};
  sorted.forEach((id) => { (byDay[id.slice(0, 10)] = byDay[id.slice(0, 10)] || []).push(id); });
  const firstOfDay = {};
  Object.keys(byDay).forEach((d) => { firstOfDay[d] = byDay[d].find((x) => ok[x]) || byDay[d][0]; });
  return sorted.filter((id) => {
    if (id === newestOk) return false;
    const age = t - timeOfId(id).getTime();
    if (age < KEEP_ALL_HOURS * 3600000) return false;
    if (age < KEEP_DAYS * 86400000 && firstOfDay[id.slice(0, 10)] === id) return false;
    return true;
  });
}

/* ---------------------------------------------------------- 5. the pictures */
async function supa(cfg, method, p, body) {
  const res = await fetch(cfg.supabaseUrl + p, { method, headers: { apikey: cfg.serviceKey, Authorization: 'Bearer ' + cfg.serviceKey,
                                                                    'Content-Type': 'application/json' },
                                                 body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) throw new Error('Supabase ' + p.split('?')[0] + ' answered ' + res.status);
  return res;
}
async function listPictures(cfg) {
  const buckets = await (await supa(cfg, 'GET', '/storage/v1/bucket')).json();
  const out = [];
  for (const b of buckets || []) {
    const walk = async (prefix, depth) => {
      if (depth > 8) return;
      for (let offset = 0; offset < 100000; offset += 1000) {
        const page = await (await supa(cfg, 'POST', '/storage/v1/object/list/' + encodeURIComponent(b.id),
                                       { prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } })).json();
        for (const e of page || []) {
          const p = (prefix ? prefix + '/' : '') + e.name;
          if (e.id == null && !e.metadata) await walk(p, depth + 1);        // a folder
          else out.push({ bucket: b.id, path: p, size: Number((e.metadata && e.metadata.size) || 0),
                          type: (e.metadata && e.metadata.mimetype) || 'application/octet-stream',
                          version: String((e.metadata && e.metadata.eTag) || '') + '|' + String(e.updated_at || '') });
        }
        if (!page || page.length < 1000) break;
      }
    };
    await walk('', 0);
  }
  return out;
}
const pictureKey = (f) => 'pictures/' + f.bucket + '/' + sha256(f.bucket + '/' + f.path).slice(0, 32) + '-' +
                          sha256(f.version + '|' + f.size).slice(0, 12) + '.vqb';
async function copyPictures(cfg, store, publicKey, stopAt) {
  if (!cfg.supabaseUrl || !cfg.serviceKey) return { skipped: 'no Supabase address or service key' };
  const files = await listPictures(cfg);
  const have = new Set((await store.list('pictures/')).map((o) => o.key));
  const missing = files.filter((f) => !have.has(pictureKey(f)));
  let copied = 0, bytes = 0;
  for (const f of missing) {
    if (copied >= PICTURES_PER_RUN || bytes >= PICTURE_BYTES_PER_RUN || (stopAt && Date.now() > stopAt)) break;
    const res = await supa(cfg, 'GET', '/storage/v1/object/' + encodeURIComponent(f.bucket) + '/' + f.path.split('/').map(encodeURIComponent).join('/'));
    const data = Buffer.from(await res.arrayBuffer());
    await store.put(pictureKey(f), E.sealNamed({ bucket: f.bucket, path: f.path, type: f.type, version: f.version }, data, publicKey));
    copied++; bytes += data.length;
  }
  return { total: files.length, copied, waiting: missing.length - copied, bytes };
}

/* ------------------------------------------------- 7. the run, written down */
async function record(cfg, run) {
  if (!cfg.supabaseUrl || !cfg.serviceKey) return false;
  try {
    const res = await fetch(cfg.supabaseUrl + '/rest/v1/backup_runs', {
      method: 'POST', headers: { apikey: cfg.serviceKey, Authorization: 'Bearer ' + cfg.serviceKey, 'Content-Type': 'application/json',
                                 Prefer: 'return=minimal' },
      body: JSON.stringify(run) });
    // Half a year of runs is plenty: older lines go.
    await fetch(cfg.supabaseUrl + '/rest/v1/backup_runs?at=lt.' + encodeURIComponent(new Date(Date.now() - 183 * 86400000).toISOString()), {
      method: 'DELETE', headers: { apikey: cfg.serviceKey, Authorization: 'Bearer ' + cfg.serviceKey, Prefer: 'return=minimal' } }).catch(() => {});
    return res.ok;
  } catch (e) { return false; }
}
function summary(lines) {
  const f = process.env.GITHUB_STEP_SUMMARY;
  if (f) { try { fs.appendFileSync(f, lines.join('\n') + '\n'); } catch (e) { /* only a summary */ } }
  lines.forEach((l) => console.log(l));
}

/* ---------------------------------------------------------------- the copy run */
async function copyRun(cfg, opts) {
  opts = opts || {};
  const began = Date.now();
  const scaffold = fs.readFileSync(path.join(__dirname, 'scratch-supabase.sql'), 'utf8');
  const run = { kind: 'copy', ok: false, checked: false, copy_id: null, size_bytes: 0, tables: 0, rows: 0, logins: 0,
                pictures_new: 0, pictures_total: 0, copies_kept: 0, seconds: 0, problems: [], detail: {} };
  try {
    if (!cfg.publicKey) throw new Error('BACKUP_PUBLIC_KEY is not set: make your key in Admin > Settings > Backups.');
    const publicKey = E.publicKeyFrom(cfg.publicKey);
    run.detail.kid = E.kidOf(publicKey);
    const store = S3.client(cfg.s3);
    const conn = PG.connFromUrl(cfg.dbUrl);
    const scratch = PG.connFromUrl(cfg.scratchUrl);
    const now = opts.now || new Date();
    const id = copyIdOf(now);
    run.copy_id = id;

    const copy = await makeCopy(conn, cfg.prefix);
    const check = await checkCopy(copy, scratch, cfg.prefix, scaffold);
    run.checked = check.ok;
    run.tables = check.tables; run.rows = check.rows; run.logins = check.logins;
    run.problems = check.problems.slice(0, 20);

    // 3 and 4: sealed, kept, read back.
    const made = now.toISOString();
    const parts = {
      'public.vqb': E.sealNamed({ part: 'public', format: 'pg_dump custom' }, copy.dumps.public, publicKey, made),
      'auth.vqb': E.sealNamed({ part: 'auth', format: 'pg_dump custom, data only' }, copy.dumps.auth, publicKey, made),
      'storage.vqb': E.sealNamed({ part: 'storage', format: 'pg_dump custom, data only' }, copy.dumps.storage, publicKey, made),
      'counts.vqb': E.sealNamed({ part: 'counts' }, JSON.stringify({ live: copy.live, counts: check.counts }), publicKey, made),
    };
    const files = {};
    for (const name of Object.keys(parts)) {
      const key = 'copies/' + id + '/' + name;
      await store.put(key, parts[name]);
      const back = await store.get(key);
      if (!back || sha256(back) !== sha256(parts[name])) throw new Error('The copy kept in storage does not read back the same (' + name + ').');
      files[name] = { size: parts[name].length, sha256: sha256(parts[name]) };
      run.size_bytes += parts[name].length;
    }
    const manifest = { copy: id, made, checked: check.ok, kid: E.kidOf(publicKey), files,
                       server: copy.live.server, tables: check.tables, rows: check.rows };
    await store.put('copies/' + id + '/manifest.json', JSON.stringify(manifest, null, 2), 'application/json');

    // 5. The pictures.
    try {
      const pics = await copyPictures(cfg, store, publicKey, began + 15 * 60000);
      run.pictures_new = pics.copied || 0; run.pictures_total = pics.total || 0;
      run.detail.pictures = pics;
    } catch (e) { run.problems.push('pictures: ' + (e && e.message)); }

    // 6. Old copies let go, only once this one is safely kept.
    const keys = await store.list('copies/');
    const ids = Array.from(new Set(keys.map((k) => k.key.split('/')[1]).filter((x) => /^\d{4}-\d\d-\d\dT\d{4}Z$/.test(x))));
    const ok = {};
    for (const cid of ids) {
      if (cid === id) { ok[cid] = check.ok; continue; }
      try { ok[cid] = !!JSON.parse(((await store.get('copies/' + cid + '/manifest.json')) || '{}').toString()).checked; }
      catch (e) { ok[cid] = false; }
    }
    const goes = toLetGo(ids, ok, now);
    for (const cid of goes) for (const k of keys.filter((x) => x.key.indexOf('copies/' + cid + '/') === 0)) await store.del(k.key);
    run.copies_kept = ids.length - goes.length;
    run.detail.let_go = goes.length;
    run.ok = check.ok;
  } catch (e) {
    run.problems.push(String((e && e.message) || e).slice(0, 400));
  }
  run.seconds = Math.round((Date.now() - began) / 1000);
  await record(cfg, run);
  summary(['### Website backup ' + (run.copy_id || ''),
           run.ok ? '**Kept and checked by restoring it.**' : '**NOT DONE, or not checked: see below.**',
           '', '| | |', '|---|---|',
           '| Tables, rows | ' + run.tables + ', ' + run.rows + ' |', '| Logins | ' + run.logins + ' |',
           '| Size, sealed | ' + Math.round(run.size_bytes / 1024) + ' KB |',
           '| Pictures | ' + run.pictures_new + ' new of ' + run.pictures_total + ' |',
           '| Copies kept | ' + run.copies_kept + ' |', '| Seconds | ' + run.seconds + ' |']
          .concat(run.problems.length ? ['', 'Problems:'].concat(run.problems.map((p) => '- ' + p)) : []));
  return run;
}

/* ---------------------------------------------------------------- the drill run */
// The newest copy kept, opened with your private key, and restored.
async function drillRun(cfg, opts) {
  opts = opts || {};
  const began = Date.now();
  const scaffold = fs.readFileSync(path.join(__dirname, 'scratch-supabase.sql'), 'utf8');
  const run = { kind: 'drill', ok: false, checked: false, copy_id: null, size_bytes: 0, tables: 0, rows: 0, logins: 0,
                pictures_new: 0, pictures_total: 0, copies_kept: 0, seconds: 0, problems: [], detail: {} };
  try {
    if (!cfg.privateKey) throw new Error('BACKUP_PRIVATE_KEY is not set: the drill opens a copy with your private key (RECOVERY.md, "The drill").');
    const privateKey = E.privateKeyFrom(cfg.privateKey);
    const store = S3.client(cfg.s3);
    const keys = await store.list('copies/');
    const ids = Array.from(new Set(keys.map((k) => k.key.split('/')[1]))).filter((x) => /^\d{4}-\d\d-\d\dT\d{4}Z$/.test(x)).sort();
    let id = null, manifest = null;
    for (const cid of ids.reverse()) {
      const m = await store.get('copies/' + cid + '/manifest.json');
      if (m) { const j = JSON.parse(m.toString()); if (j.checked || opts.anyCopy) { id = cid; manifest = j; break; } }
    }
    if (!id) throw new Error('No copy that checked out was found in the storage account.');
    run.copy_id = id;
    const dumps = {};
    let counts = null;
    for (const name of Object.keys(manifest.files)) {
      const buf = await store.get('copies/' + id + '/' + name);
      if (!buf || sha256(buf) !== manifest.files[name].sha256) throw new Error(name + ' in the copy of ' + id + ' is not as it was kept.');
      run.size_bytes += buf.length;
      const o = E.openNamed(buf, privateKey);
      if (o.meta.part === 'counts') counts = JSON.parse(o.data.toString());
      else dumps[o.meta.part] = o.data;
    }
    const check = await checkCopy({ dumps, live: (counts && counts.live) || {} }, PG.connFromUrl(cfg.scratchUrl), cfg.prefix, scaffold);
    run.checked = check.ok; run.tables = check.tables; run.rows = check.rows; run.logins = check.logins;
    run.problems = check.problems.slice(0, 20);
    if (counts && counts.counts) {
      Object.keys(counts.counts.public || {}).forEach((t) => {
        if (check.counts.public[t] !== counts.counts.public[t]) run.problems.push(t + ': ' + counts.counts.public[t] + ' rows when kept, ' + check.counts.public[t] + ' now');
      });
    }
    run.ok = check.ok && run.problems.length === 0;
    run.detail.made = manifest.made;
  } catch (e) {
    run.problems.push(String((e && e.message) || e).slice(0, 400));
  }
  run.seconds = Math.round((Date.now() - began) / 1000);
  await record(cfg, run);
  summary(['### Backup drill: the copy of ' + (run.copy_id || '?'),
           run.ok ? '**Opened with your key and restored: every table and row as kept.**' : '**THE DRILL DID NOT PASS: see below.**',
           '', 'Tables ' + run.tables + ', rows ' + run.rows + ', logins ' + run.logins + ', ' + run.seconds + ' seconds.']
          .concat(run.problems.length ? ['', 'Problems:'].concat(run.problems.map((p) => '- ' + p)) : []));
  return run;
}

module.exports = { config, makeCopy, checkCopy, toLetGo, copyIdOf, timeOfId, pictureKey, listPictures, copyPictures,
                   copyRun, drillRun, record, KEEP_ALL_HOURS, KEEP_DAYS, SCRATCH_DB };

if (require.main === module) {
  const mode = process.argv[2];
  (async () => {
    let cfg;
    try { cfg = config(); } catch (e) { console.error(e.message); process.exit(2); }
    const run = mode === 'drill' ? await drillRun(cfg) : mode === 'copy' ? await copyRun(cfg) : null;
    if (!run) { console.error('Usage: node tools/backup/backup.cjs copy|drill'); process.exit(2); }
    process.exit(run.ok ? 0 : 1);
  })();
}
