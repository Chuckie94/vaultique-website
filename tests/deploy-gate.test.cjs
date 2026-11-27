/* ===========================================================================
   THE CHECKS BEFORE EVERY DEPLOY (website build 84) · tools/build-site.cjs, step 6

   Netlify runs tools/build-site.cjs on every deploy. Since build 84 it runs
   the website's own node checks first, and publishes nothing if one fails.
   Here, on copies of the website:

     1. checks that pass: published, and the log says how many ran;
     2. a check that fails: BUILD STOPPED, the failure and its reason in the
        log, nothing published, and the dist/ already there left untouched;
     3. no checks in the repository: stopped, never published without them;
     4. the checks are given none of Netlify's settings: no service key, no
        Flutterwave key, nothing a check could reach the real shop with;
     5. VBP_DEPLOY_GATE = paused publishes without them, and says so first
        and last in the log;
     6. a check that builds a copy of the site does not start them again;
     7. the real thing: the website's own checks, all of them, run by the
        deploy step on a copy of this very folder, as Netlify would.
   =========================================================================== */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let checks = 0, failures = 0;
const ok = (m) => { checks++; console.log('  ✓ ' + m); };
const fail = (m, x) => { checks++; failures++; console.log('  ✗ ' + m + (x ? '\n      ' + String(x).slice(0, 600) : '')); };
const is = (c, m, x) => (c ? ok(m) : fail(m, x));

const ROOT = path.resolve(__dirname, '..');
const BUILD = path.join(ROOT, 'tools', 'build-site.cjs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vbp-gate-'));
const CONFIG = "window.VBP_CONFIG = {\n  SUPABASE_URL: 'https://standin-project.supabase.co',\n  SUPABASE_ANON_KEY: 'standin-public-key'\n};\n";
const SECRETS = {
  SUPABASE_SERVICE_ROLE_KEY: 'SENTINEL-SERVICE-1', WEB_SUPABASE_SERVICE_KEY: 'SENTINEL-SERVICE-2',
  FLW_SECRET_KEY_LIVE: 'SENTINEL-FLW-LIVE', FLW_SECRET_KEY_TEST: 'SENTINEL-FLW-TEST', FLW_WEBHOOK_HASH: 'SENTINEL-HASH',
  POS_REWARDS_KEY: 'SENTINEL-REWARDS', WEB_SUPABASE_URL: 'https://SENTINEL-URL.example',
};

function copy(from, to) {
  const st = fs.lstatSync(from);
  if (st.isSymbolicLink()) return;
  if (st.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const n of fs.readdirSync(from)) {
      if (n === 'node_modules' || n === 'dist' || n === '.git') continue;
      copy(path.join(from, n), path.join(to, n));
    }
  } else { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); }
}

/* The website without its checks, and a stand-in runner that does what it is told. */
function site(name, runner) {
  const dir = path.join(TMP, name);
  fs.rmSync(dir, { recursive: true, force: true });
  for (const n of ['index.html', 'admin.html', 'sw.js', 'manifest.webmanifest', 'assets', 'images']) copy(path.join(ROOT, n), path.join(dir, n));
  copy(BUILD, path.join(dir, 'tools', 'build-site.cjs'));
  fs.writeFileSync(path.join(dir, 'config.js'), CONFIG);
  if (runner) {
    fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'tests', 'run-tests.js'), runner);
  }
  return dir;
}
const RUNNER = (code, lines) =>
  "const fs = require('fs'), path = require('path');\n" +
  "fs.writeFileSync(path.join(__dirname, 'ran.json'), JSON.stringify({ argv: process.argv.slice(2), env: process.env }));\n" +
  'console.log(' + JSON.stringify(lines.join('\n')) + ');\n' +
  'process.exit(' + code + ');\n';
const PASSING = RUNNER(0, ['', '3 node test files, one at a time', '', '  ✓ a.test.cjs  4 checks', '',
                          '  node: 3 of 3 files passed, 9 checks, 0.0 minutes']);
const FAILING = RUNNER(1, ['', '  ✓ a.test.cjs  4 checks', '  ✗ payments.test.cjs   6 checks  payments: 1 of 7 checks FAILED',
                          '        ✗ a payment is marked paid only once',
                          '            it was marked paid twice', '',
                          '  node: 2 of 3 files passed, 10 checks, 0.0 minutes', '  failed: payments.test.cjs']);

/* Netlify's world: its settings in the environment, and no VBP_IN_GATE. */
function deploy(dir, extraEnv, args) {
  const env = Object.assign({}, process.env, SECRETS, extraEnv || {});
  delete env.VBP_IN_GATE;
  delete env.VBP_DEPLOY_GATE;
  Object.assign(env, extraEnv || {});
  const r = spawnSync(process.execPath, [path.join(dir, 'tools', 'build-site.cjs')].concat(args || []),
    { cwd: dir, encoding: 'utf8', env, timeout: 9 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
const ran = (dir) => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'tests', 'ran.json'), 'utf8')); } catch (e) { return null; } };
const published = (dir) => fs.existsSync(path.join(dir, 'dist', 'index.html'));

console.log('\n1. Checks that pass: published');
let dir = site('pass', PASSING);
let r = deploy(dir);
is(r.code === 0 && published(dir), 'the build finishes and the website is published', r.out);
is(/Checks: node: 3 of 3 files passed, 9 checks/.test(r.out), 'the log says how many checks ran before publishing', r.out);
let seen = ran(dir);
is(seen && seen.argv[0] === 'node', 'it ran the node checks (tests/run-tests.js node)', seen && seen.argv.join(' '));

console.log('\n2. A check that fails: nothing published');
dir = site('fail', FAILING);
fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
fs.writeFileSync(path.join(dir, 'dist', 'before.txt'), 'the last deploy');
r = deploy(dir);
is(r.code !== 0 && /BUILD STOPPED: the website's own checks failed/.test(r.out), 'BUILD STOPPED, and why', r.out);
is(/Nothing was published\. The site that was live before this deploy is still live\./.test(r.out),
   'it says the live site is untouched');
is(/payments\.test\.cjs/.test(r.out) && /it was marked paid twice/.test(r.out),
   'the log names the check that failed and what it found', r.out);
is(!published(dir) && fs.existsSync(path.join(dir, 'dist', 'before.txt')),
   'nothing new published, and the dist/ already there left exactly as it was');

console.log('\n3. No checks in the repository: never published without them');
dir = site('none', null);
r = deploy(dir);
is(r.code !== 0 && /tests\/run-tests\.js\) are not in the repository/.test(r.out) && !published(dir),
   'stopped: "the website\'s own checks are not in the repository"', r.out);

console.log('\n4. The checks get none of Netlify\'s settings');
dir = site('env', PASSING);
r = deploy(dir, { SOMETHING_ELSE: 'SENTINEL-OTHER' });
seen = ran(dir) || { env: {} };
const leaked = Object.keys(seen.env).filter((k) => /SENTINEL/.test(String(seen.env[k])));
is(r.code === 0 && leaked.length === 0, 'no key, no address, no other setting reaches them', 'leaked: ' + leaked.join(', '));
is(seen.env.VBP_IN_GATE === '1' && !!seen.env.PATH, 'they are told they are the deploy\'s checks (VBP_IN_GATE), and can still find Node');

console.log('\n5. VBP_DEPLOY_GATE = paused: published without them, and never quietly');
dir = site('paused', FAILING);
r = deploy(dir, { VBP_DEPLOY_GATE: 'paused' });
is(r.code === 0 && published(dir) && !ran(dir), 'published, and the checks were not run', r.out);
const said = (r.out.match(/THE CHECKS WERE NOT RUN/g) || []).length;
is(said >= 2, 'the log says so at the start and again at the end (' + said + ' times)', r.out);
is(/Delete that setting/.test(r.out) && /health check says so too/.test(r.out), 'and how to end it, and that the health check says so');
r = deploy(site('paused2', FAILING), { VBP_DEPLOY_GATE: 'yes please' });
is(r.code !== 0 && /BUILD STOPPED/.test(r.out), 'any other value is not a pause: the checks run, and this one fails', r.out);

console.log('\n6. A check that builds a copy of the site does not start them again');
dir = site('inside', FAILING);
r = deploy(dir, { VBP_IN_GATE: '1' });
is(r.code === 0 && !ran(dir) && /not started again/.test(r.out), 'inside the checks: not run again', r.out);
dir = site('root', FAILING);
r = deploy(dir, {}, ['--root', dir, '--out', path.join(dir, 'dist')]);
is(r.code === 0 && !ran(dir), 'a copy built with --root (the other checks do this): not asked', r.out);
r = deploy(dir, {}, ['--root', dir, '--out', path.join(dir, 'dist'), '--gate']);
is(r.code !== 0 && !!ran(dir), 'with --gate: asked, and this one fails', r.out);

console.log('\n7. The real thing: every node check, run by the deploy step');
if (process.env.VBP_IN_GATE === '1') {
  /* This file is itself being run by a deploy step's checks: that run is
     the real thing, and it is one level up. Nothing more is claimed here. */
  console.log('  (this run is inside the deploy step: the step above it is the real one)');
} else {
  dir = path.join(TMP, 'real');
  copy(ROOT, dir);
  if (!fs.existsSync(path.join(dir, 'config.js'))) fs.writeFileSync(path.join(dir, 'config.js'), CONFIG);
  r = deploy(dir, {}, ['--root', dir, '--out', path.join(dir, 'dist'), '--gate']);
  const line = (/Checks: (node: [^\n]*)/.exec(r.out) || [])[1] || '';
  is(r.code === 0 && published(dir) && /passed/.test(line), 'the website\'s own checks pass inside the deploy step, without any setting, and it publishes: ' + line, r.out.split('\n').slice(-15).join('\n'));
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log('\n  deploy gate: ' + (failures ? failures + ' of ' + checks + ' checks FAILED' : 'all ' + checks + ' checks passed'));
process.exit(failures ? 1 : 0);
