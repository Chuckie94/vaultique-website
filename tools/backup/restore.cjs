#!/usr/bin/env node
/* =====================================================================
   OPENING A COPY, AND RESTORING IT (website build 92)

   For RECOVERY.md, run by a person on a computer, never by itself:

     node tools/backup/restore.cjs list
         the copies kept, newest first, and whether each checked out
     node tools/backup/restore.cjs open <copy|latest> --key backup-key.pem --out <folder>
         one copy, read from the storage account, checked against its list,
         and opened with your private key into <folder>
     node tools/backup/restore.cjs pictures --key backup-key.pem --out <folder>
         every picture kept, opened, newest version of each, into <folder>
     node tools/backup/restore.cjs into --from <folder> --db <address> --i-have-a-copy-of-what-is-there
         the opened copy restored into a database: a NEW Supabase project's.
         It refuses a database that already has the shop's tables: a restore
         never goes over a working shop.
     node tools/backup/restore.cjs pictures-into --from <folder> --url <https://new.supabase.co> --service-key <key>
         the opened pictures put back into a NEW project's Storage

   The storage account's details come from the same names as on GitHub
   (BACKUP_S3_ENDPOINT, BACKUP_S3_REGION, BACKUP_S3_BUCKET, BACKUP_S3_KEY_ID,
   BACKUP_S3_SECRET), set in the computer's environment for the session.
   ===================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const E = require('./envelope.cjs');
const S3 = require('./s3.cjs');
const PG = require('./pgtools.cjs');

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
function arg(argv, name) { const i = argv.indexOf(name); return i > -1 ? argv[i + 1] : ''; }
function storeFromEnv(env) {
  env = env || process.env;
  return S3.client({ endpoint: env.BACKUP_S3_ENDPOINT, region: env.BACKUP_S3_REGION, bucket: env.BACKUP_S3_BUCKET,
                     keyId: env.BACKUP_S3_KEY_ID, secret: env.BACKUP_S3_SECRET });
}

async function listCopies(store) {
  const keys = await store.list('copies/');
  const ids = Array.from(new Set(keys.map((k) => k.key.split('/')[1]))).filter((x) => /^\d{4}-\d\d-\d\dT\d{4}Z$/.test(x)).sort().reverse();
  const out = [];
  for (const id of ids) {
    let m = null;
    try { m = JSON.parse(((await store.get('copies/' + id + '/manifest.json')) || '').toString()); } catch (e) { m = null; }
    out.push({ id, checked: !!(m && m.checked), kid: m && m.kid, size: keys.filter((k) => k.key.indexOf('copies/' + id + '/') === 0)
                                                                        .reduce((a, k) => a + k.size, 0) });
  }
  return out;
}

async function openCopy(store, which, privateKeyPem, outDir) {
  const privateKey = E.privateKeyFrom(privateKeyPem);
  const copies = await listCopies(store);
  const pick = which === 'latest' ? copies.find((c) => c.checked) : copies.find((c) => c.id === which);
  if (!pick) throw new Error(which === 'latest' ? 'No copy that checked out was found.' : 'No copy ' + which + ' was found.');
  const manifest = JSON.parse((await store.get('copies/' + pick.id + '/manifest.json')).toString());
  fs.mkdirSync(outDir, { recursive: true });
  const parts = {};
  for (const name of Object.keys(manifest.files)) {
    const buf = await store.get('copies/' + pick.id + '/' + name);
    if (!buf || sha256(buf) !== manifest.files[name].sha256) throw new Error(name + ' is not as it was kept: this copy cannot be trusted; try the one before it.');
    const o = E.openNamed(buf, privateKey);
    const file = o.meta.part === 'counts' ? 'counts.json' : o.meta.part + '.dump';
    fs.writeFileSync(path.join(outDir, file), o.data);
    parts[o.meta.part] = file;
  }
  fs.writeFileSync(path.join(outDir, 'copy.json'), JSON.stringify({ copy: pick.id, made: manifest.made, checked: manifest.checked, parts }, null, 2));
  return { id: pick.id, made: manifest.made, parts };
}

async function openPictures(store, privateKeyPem, outDir) {
  const privateKey = E.privateKeyFrom(privateKeyPem);
  const keys = await store.list('pictures/');
  const newest = {};
  let opened = 0;
  for (const k of keys) {
    const o = E.openNamed(await store.get(k.key), privateKey);
    const id = o.meta.bucket + '/' + o.meta.path;
    const at = String(o.meta.version || '').split('|')[1] || '';
    if (newest[id] && newest[id].at >= at) continue;
    newest[id] = { at, meta: o.meta };
    const file = path.join(outDir, o.meta.bucket, ...o.meta.path.split('/'));
    if (path.relative(outDir, file).startsWith('..')) throw new Error('A picture\'s name points outside the folder: ' + id);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, o.data);
    opened++;
  }
  fs.writeFileSync(path.join(outDir, 'pictures.json'), JSON.stringify(Object.keys(newest).map((id) => ({ id, type: newest[id].meta.type })), null, 2));
  return { files: Object.keys(newest).length, opened };
}

/* Into a database: the logins first, then the shop's tables, then the
   pictures' records. A database with the shop's tables already in it is
   refused. */
async function restoreInto(fromDir, dbUrl, prefix) {
  const conn = PG.connFromUrl(dbUrl);
  const has = await PG.sqlJson("select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('orders', 'payments', 'site_settings')", conn, prefix);
  if (Number(has) > 0) throw new Error('This database already has the shop\'s tables. A restore never goes over a working database: make a new Supabase project and restore into that (RECOVERY.md).');
  const read = (f) => fs.readFileSync(path.join(fromDir, f));
  const asSql = async (dump) => (await PG.must('pg_restore', ['--no-owner', '-f', '-'], { input: dump, prefix }, 'Reading the copy')).stdout;
  const steps = [];
  // 1. The logins (auth), as Supabase's own guide restores them: triggers off for the load.
  const authSql = await asSql(read('auth.dump'));
  let r = await PG.run('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-c', 'set session_replication_role = replica', '-f', '-'],
                       { conn, prefix, input: authSql });
  steps.push({ step: 'logins', ok: r.code === 0, said: r.code === 0 ? '' : r.stderr.split('\n').filter((l) => /ERROR/.test(l)).slice(0, 3).join(' | ') });
  if (r.code !== 0) return { ok: false, steps };
  // 2. The shop's tables, with their rules, functions and data.
  r = await PG.run('pg_restore', ['--no-owner', '-d', conn.PGDATABASE], { conn, prefix, input: read('public.dump') });
  const errs = r.stderr.split('\n').filter((l) => /error:/i.test(l) && !/errors ignored/.test(l) && !/schema "public" already exists/.test(l));
  steps.push({ step: 'shop', ok: errs.length === 0, said: errs.slice(0, 3).join(' | ') });
  // 3. The pictures' records.
  const stSql = await asSql(read('storage.dump'));
  r = await PG.run('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-c', 'set session_replication_role = replica', '-f', '-'],
                   { conn, prefix, input: stSql });
  steps.push({ step: 'pictures\' records', ok: r.code === 0, said: r.code === 0 ? '' : r.stderr.split('\n').filter((l) => /ERROR/.test(l)).slice(0, 3).join(' | ') });
  // 4. Counted against the copy's own counts.
  let counts = {};
  try { counts = JSON.parse(read('counts.json').toString()).counts.public || {}; } catch (e) { counts = {}; }
  const tables = Object.keys(counts);
  const back = tables.length ? await PG.sqlJson('select json_object_agg(t, n) from (' + tables.map((t) =>
    "select '" + t + "' as t, (select count(*) from " + t.split('.').map((p) => '"' + p + '"').join('.') + ') as n').join(' union all ') + ') x', conn, prefix) : {};
  const differ = tables.filter((t) => Number((back || {})[t]) !== counts[t]);
  steps.push({ step: 'counted', ok: differ.length === 0, said: differ.slice(0, 5).map((t) => t + ' ' + (back || {})[t] + ' of ' + counts[t]).join(', ') });
  return { ok: steps.every((s) => s.ok), steps };
}

async function picturesInto(fromDir, url, serviceKey) {
  const list = JSON.parse(fs.readFileSync(path.join(fromDir, 'pictures.json')).toString());
  const base = String(url).replace(/\/+$/, '');
  const h = { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey };
  let put = 0;
  for (const p of list) {
    const i = p.id.indexOf('/');
    const bucket = p.id.slice(0, i), name = p.id.slice(i + 1);
    const data = fs.readFileSync(path.join(fromDir, bucket, ...name.split('/')));
    const res = await fetch(base + '/storage/v1/object/' + encodeURIComponent(bucket) + '/' + name.split('/').map(encodeURIComponent).join('/'),
                            { method: 'POST', headers: Object.assign({ 'Content-Type': p.type || 'application/octet-stream', 'x-upsert': 'true' }, h), body: data });
    if (!res.ok) throw new Error('Putting back ' + p.id + ' failed: ' + res.status + ' (does the bucket ' + bucket + ' exist in the new project?)');
    put++;
  }
  return { put };
}

module.exports = { listCopies, openCopy, openPictures, restoreInto, picturesInto, storeFromEnv };

if (require.main === module) {
  const argv = process.argv.slice(2);
  (async () => {
    const what = argv[0];
    if (what === 'list') {
      for (const c of await listCopies(storeFromEnv())) console.log(c.id + '  ' + (c.checked ? 'checked out' : 'NOT CHECKED') + '  ' + Math.round(c.size / 1024) + ' KB  key ' + c.kid);
    } else if (what === 'open') {
      const r = await openCopy(storeFromEnv(), argv[1] || 'latest', fs.readFileSync(arg(argv, '--key')).toString(), arg(argv, '--out') || 'opened-copy');
      console.log('Opened the copy of ' + r.id + ' into ' + (arg(argv, '--out') || 'opened-copy') + ': ' + Object.values(r.parts).join(', '));
    } else if (what === 'pictures') {
      const r = await openPictures(storeFromEnv(), fs.readFileSync(arg(argv, '--key')).toString(), arg(argv, '--out') || 'opened-pictures');
      console.log('Opened ' + r.files + ' pictures.');
    } else if (what === 'into') {
      if (argv.indexOf('--i-have-a-copy-of-what-is-there') < 0) {
        console.error('Before a restore, keep a copy of what is there now (RECOVERY.md, step 1), then add --i-have-a-copy-of-what-is-there.');
        process.exit(2);
      }
      const r = await restoreInto(arg(argv, '--from'), arg(argv, '--db'), process.env.BACKUP_PG || '');
      r.steps.forEach((s) => console.log((s.ok ? 'done   ' : 'FAILED ') + s.step + (s.said ? ': ' + s.said : '')));
      process.exit(r.ok ? 0 : 1);
    } else if (what === 'pictures-into') {
      const r = await picturesInto(arg(argv, '--from'), arg(argv, '--url'), arg(argv, '--service-key'));
      console.log('Put back ' + r.put + ' pictures.');
    } else {
      console.error('Usage: see the top of tools/backup/restore.cjs, and RECOVERY.md.');
      process.exit(2);
    }
  })().catch((e) => { console.error(String((e && e.message) || e)); process.exit(1); });
}
