/* ===========================================================================
   EVERY CHECK OF ONE KIND, ONE AFTER THE OTHER (build 79)

     node tests/run-tests.js node      the Node checks: tests/*.cjs but not *.browser.cjs
     node tests/run-tests.js browser   the browser checks: tests/*.browser.cjs (Playwright)
     node tests/run-tests.js node product-door send-email    only the files named

   From tests/ with npm: npm run test:node, npm run test:browser, npm test.
   Each file runs on its own, from the website folder, as it would by hand,
   and the line it ends with is shown. A file that fails has its ✗ lines
   shown beneath it, and this ends non-zero, so a computer running it (the
   GitHub workflow in .github/workflows/tests.yml) can tell.

   A browser file that fails is run once more, as Playwright advises for
   checks run on someone else's computer: a busy one can make a page late
   for a check that still pauses for a set time. Passing then, it is named
   at the end as passed only on the second try (on GitHub, as a warning),
   so it can be made steadier; failing again, it fails the run. A real
   fault fails both times. The Node checks are run once.

   The SQL chains and the stand-in Supabase are bash scripts, because they
   need psql: tools/sql-tests.sh and tools/db-check.sh (npm run test:sql).
   =========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const HERE = __dirname;
const ROOT = path.resolve(HERE, '..');
const kind = process.argv[2];
const base = (n) => String(n).replace(/\.cjs$/, '').replace(/\.(test|browser)$/, '');
const only = process.argv.slice(3).map(base);
if (kind !== 'node' && kind !== 'browser') {
  console.log('Usage: node tests/run-tests.js node|browser [names...]');
  process.exit(2);
}

const files = fs.readdirSync(HERE).filter((f) => f.endsWith('.cjs'))
  .filter((f) => (kind === 'browser') === f.endsWith('.browser.cjs'))
  .filter((f) => !only.length || only.indexOf(base(f)) > -1)
  .sort();
if (!files.length) { console.log('No ' + kind + ' tests found' + (only.length ? ' named ' + only.join(', ') : '') + '.'); process.exit(2); }

const MINUTES = kind === 'browser' ? 10 : 5;
const TRIES = kind === 'browser' ? 2 : 1;
const ON_GITHUB = !!process.env.GITHUB_ACTIONS;
const started = Date.now();
let failed = 0, checks = 0;
const failures = [], secondTry = [];

function run(f) {
  const r = spawnSync(process.execPath, [path.join(HERE, f)], {
    cwd: ROOT, encoding: 'utf8', env: process.env, timeout: MINUTES * 60 * 1000, maxBuffer: 64 * 1024 * 1024
  });
  const out = (r.stdout || '') + (r.stderr || '');
  return {
    ok: r.status === 0 && !r.error,
    ticks: (out.match(/✓/g) || []).length,
    crosses: out.split('\n').filter((l) => /✗/.test(l)),
    last: out.split('\n').map((l) => l.trim()).filter(Boolean)
      .filter((l) => /\d+ checks (passed|FAILED)|checks? FAILED|skipped/.test(l)).pop() || '',
    why: r.error ? [String(r.error.code === 'ETIMEDOUT' ? 'stopped after ' + MINUTES + ' minutes' : r.error.message)] : [],
    tail: out.trim().split('\n').slice(-6)
  };
}
function reasons(t) {
  const lines = t.why.concat(t.crosses).slice(0, 12);
  return lines.length ? lines.map((l) => l.trim()) : t.tail;
}

console.log('\n' + files.length + ' ' + kind + ' test files, one at a time\n');
for (const f of files) {
  const t0 = Date.now();
  const first = run(f);
  const t = (!first.ok && TRIES > 1) ? run(f) : first;
  const retried = t !== first;
  const secs = Math.round((Date.now() - t0) / 1000);
  checks += t.ticks;
  console.log((t.ok ? '  ✓ ' : '  ✗ ') + f.padEnd(36) + String(t.ticks).padStart(4) + ' checks  ' + String(secs).padStart(4) + ' s  ' + t.last +
              (retried ? (t.ok ? '  (passed on the second try)' : '  (failed twice)') : ''));
  if (retried && t.ok) {
    secondTry.push(f);
    console.log('        the first try:');
    reasons(first).forEach((l) => console.log('        ' + l));
    if (ON_GITHUB) console.log('::warning title=Passed only on the second try::' + f + ': ' + reasons(first)[0]);
  }
  if (!t.ok) {
    failed++;
    failures.push(f);
    reasons(t).forEach((l) => console.log('        ' + l));
  }
}
const mins = ((Date.now() - started) / 60000).toFixed(1);
console.log('\n  ' + kind + ': ' + (files.length - failed) + ' of ' + files.length + ' files passed, ' + checks + ' checks, ' + mins + ' minutes' +
            (secondTry.length ? '\n  passed only on the second try (worth making steadier): ' + secondTry.join(', ') : '') +
            (failed ? '\n  failed: ' + failures.join(', ') : ''));
process.exit(failed ? 1 : 0);
