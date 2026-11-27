/* =====================================================================
   PostgreSQL's own tools, from Node (website build 92)

   pg_dump, pg_restore and psql, run directly, or inside the PostgreSQL 17
   container GitHub starts for the check (BACKUP_PG="docker exec -i <id>"),
   so that the tools are never older than Supabase's database. The
   connection goes in PG* variables, never on a command line, so the
   database's password is never in a list of running programs or a log.
   ===================================================================== */
'use strict';
const { spawn } = require('child_process');

/* postgresql://user:password@host:port/db?sslmode=require -> PG* variables */
function connFromUrl(url) {
  let u;
  try { u = new URL(String(url || '').trim()); } catch (e) { throw new Error('The database address could not be read.'); }
  if (!/^postgres(ql)?:$/.test(u.protocol)) throw new Error('The database address must begin postgresql://');
  const c = {
    PGHOST: u.hostname, PGPORT: u.port || '5432', PGUSER: decodeURIComponent(u.username || 'postgres'),
    PGPASSWORD: decodeURIComponent(u.password || ''), PGDATABASE: decodeURIComponent((u.pathname || '/postgres').slice(1) || 'postgres'),
  };
  const ssl = u.searchParams.get('sslmode');
  if (ssl) c.PGSSLMODE = ssl;
  else if (/supabase\.(co|com)$/.test(u.hostname)) c.PGSSLMODE = 'require';
  return c;
}
function withDb(conn, db) { return Object.assign({}, conn, { PGDATABASE: db }); }

/* Run one tool. prefix: '' or 'docker exec -i <container>'. */
function run(tool, args, opts) {
  opts = opts || {};
  const conn = opts.conn || {};
  const prefix = String(opts.prefix || process.env.BACKUP_PG || '').trim().split(/\s+/).filter(Boolean);
  let cmd, argv;
  const env = Object.assign({}, process.env, conn);
  if (prefix.length) {
    cmd = prefix[0];
    argv = prefix.slice(1);
    if (cmd === 'docker' && argv[0] === 'exec') {
      const passed = Object.keys(conn).reduce((a, k) => a.concat(['-e', k]), []);
      argv = ['exec'].concat(passed, argv.slice(1));
    }
    argv = argv.concat([tool], args);
  } else {
    cmd = tool;
    argv = args;
  }
  return new Promise((resolve) => {
    const p = spawn(cmd, argv, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [], err = [];
    let outBytes = 0;
    p.stdout.on('data', (d) => { out.push(d); outBytes += d.length; });
    p.stderr.on('data', (d) => err.push(d));
    p.on('error', (e) => resolve({ code: 127, stdout: Buffer.alloc(0), stderr: String(e && e.message) }));
    p.on('close', (code) => resolve({ code, stdout: Buffer.concat(out, outBytes), stderr: Buffer.concat(err).toString() }));
    if (opts.input !== undefined) p.stdin.end(opts.input); else p.stdin.end();
  });
}
async function must(tool, args, opts, what) {
  const r = await run(tool, args, opts);
  if (r.code !== 0) {
    const line = r.stderr.split('\n').filter((l) => /error|fatal|could not|denied|refused/i.test(l)).slice(0, 3).join(' | ') || r.stderr.slice(0, 300);
    throw new Error((what || tool) + ' failed: ' + line.replace(/password=\S+/gi, 'password=…'));
  }
  return r;
}
async function sqlJson(sql, conn, prefix) {
  const r = await must('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', sql], { conn, prefix }, 'A question to the database');
  const t = r.stdout.toString().trim();
  return t ? JSON.parse(t) : null;
}

/* The rows of each table in a copy, counted from the copy itself: its COPY
   blocks, as pg_restore writes them out. Also hands back every row of the
   tables asked for in `keep` (as arrays of { column: value }). */
async function copyContents(dump, prefix, keep) {
  const r = await must('pg_restore', ['--data-only', '-f', '-'], { input: dump, prefix }, 'Reading the copy');
  const lines = r.stdout.toString().split('\n');
  const counts = {}, rows = {};
  let table = null, cols = null, n = 0;
  for (const line of lines) {
    if (table === null) {
      const m = /^COPY ([^ ]+) \(([^)]*)\) FROM stdin;$/.exec(line);
      if (m) { table = m[1].replace(/"/g, ''); cols = m[2].split(',').map((c) => c.trim().replace(/"/g, '')); n = 0;
               if (keep && keep.indexOf(table) > -1) rows[table] = []; }
      continue;
    }
    if (line === '\\.') { counts[table] = n; table = null; continue; }
    n++;
    if (rows[table]) {
      const f = line.split('\t');
      const o = {};
      cols.forEach((c, i) => { o[c] = f[i] === '\\N' ? null : f[i]; });
      rows[table].push(o);
    }
  }
  return { counts, rows };
}

module.exports = { connFromUrl, withDb, run, must, sqlJson, copyContents };
