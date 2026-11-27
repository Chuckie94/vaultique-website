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

   BUILD 84 · TWO THINGS ARE NEVER PASSED OVER IN SILENCE:
     - A CRITICAL FILE (CRITICAL, below: payments, refunds, orders reaching
       the platform, sign-in and security) is never given a second try. It
       fails the run the first time it fails.
     - A FILE THAT SKIPS some or all of its checks, because something it
       needs is not on this computer (a database, a copy of the platform),
       is shown as skipped, never as passed, and named at the end with its
       reason. A critical file that skips fails the run: a check of the
       payments that cannot run has not passed.
   Netlify runs the node checks before every deploy (tools/build-site.cjs,
   step 6), so this is also what decides whether a build is published.

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
/* BUILD 84 · never a second try, and never allowed to skip. Named by the
   file's base name, so a name covers both its node and its browser file. */
const CRITICAL = [
  'account-delete', 'account-portal', 'account-signup', 'admin-escaping', 'admin-session', 'admin-two-factor',
  'build-site', 'cart-stock', 'checkout-choice', 'csp', 'csp-report', 'customer-requests', 'deploy-gate', 'health', 'one-key',
  'online-refund', 'order-progress', 'password-reset', 'pay-readiness', 'payment-return',
  'payments', 'payments-74', 'payments-77', 'place-order', 'portal', 'pos-orders', 'product-door',
  'rewards-door', 'runner', 'safe-links', 'sql-hidden', 'test-orders-sync',
  'lenco', 'lenco-checkout', 'lenco-admin', 'secure-publish',
  'delivery', 'invoice-pdf',
  'shopping', 'product-alerts'
];   // build 86: account-portal and portal, a customer's own records; build 87: customer-requests, which can cancel an order;
     // build 88: Lenco, the checkout and its settings, and what may never be published;
     // build 89: delivery (a customer's instructions, the courier and tracking number, the platform's door) and the invoice;
     // build 90: shopping (the cart, a customer's gift list and alerts) and the alert emails
const critical = (f) => CRITICAL.indexOf(base(f)) > -1;
const started = Date.now();
let failed = 0, checks = 0;
const failures = [], secondTry = [], skipped = [], partSkipped = [];

function run(f) {
  const r = spawnSync(process.execPath, [path.join(HERE, f)], {
    cwd: ROOT, encoding: 'utf8', env: process.env, timeout: MINUTES * 60 * 1000, maxBuffer: 64 * 1024 * 1024
  });
  const out = (r.stdout || '') + (r.stderr || '');
  /* A line saying a part was skipped: the file's own words, not a check
     (a check's line carries its tick or its cross). */
  const skip = out.split('\n').map((l) => l.trim())
    .filter((l) => l && /\bskipped\b/i.test(l) && !/[✓✗]/.test(l));
  return {
    ok: r.status === 0 && !r.error,
    skip: skip.map((l) => l.replace(/^\((.*)\)$/, '$1').slice(0, 200)),   // "(skipped: …)" read as "skipped: …"
    ticks: (out.match(/✓/g) || []).length,
    crosses: crossesOf(out),
    last: out.split('\n').map((l) => l.trim()).filter(Boolean)
      .filter((l) => /\d+ checks (passed|FAILED)|checks? FAILED|skipped/.test(l)).pop() || '',
    why: r.error ? [String(r.error.code === 'ETIMEDOUT' ? 'stopped after ' + MINUTES + ' minutes' : r.error.message)] : [],
    tail: out.trim().split('\n').slice(-6)
  };
}
/* Each ✗ line, with the line or two beneath it that say why: indented
   further, no tick or cross of their own (a test's is(ok, what, why)
   prints the why there: which file, what came back). Until build 83 only
   the ✗ lines were kept, so a run on GitHub named the check that failed
   but not what it had found. */
function crossesOf(out) {
  const lines = out.split('\n');
  const said = [];
  lines.forEach((l, i) => {
    if (!/✗/.test(l)) return;
    said.push(l.trim());
    for (let j = i + 1; j < lines.length && j <= i + 3; j++) {
      if (!/^\s{6,}\S/.test(lines[j]) || /[✓✗]/.test(lines[j])) break;
      said.push('    ' + lines[j].trim().slice(0, 400));
    }
  });
  return said;
}
function reasons(t) {
  const lines = t.why.concat(t.crosses).slice(0, 18);
  return lines.length ? lines : t.tail.map((l) => l.trim());
}

console.log('\n' + files.length + ' ' + kind + ' test files, one at a time\n');
for (const f of files) {
  const t0 = Date.now();
  const first = run(f);
  const t = (!first.ok && TRIES > 1 && !critical(f)) ? run(f) : first;
  const retried = t !== first;
  const secs = Math.round((Date.now() - t0) / 1000);
  checks += t.ticks;
  /* Skipped whole: it passed nothing, and said why. In part: some checks
     ran, and it said what it left out. */
  const whole = t.ok && t.ticks === 0 && t.skip.length > 0;
  const part = t.ok && !whole && t.skip.length > 0;
  const refused = (whole || part) && critical(f);   // a critical check that cannot run fails
  const ok = t.ok && !refused;
  const mark = !ok ? '  ✗ ' : whole ? '  – ' : '  ✓ ';
  console.log(mark + f.padEnd(36) + String(t.ticks).padStart(4) + ' checks  ' + String(secs).padStart(4) + ' s  ' + t.last +
              (retried ? (t.ok ? '  (passed on the second try)' : '  (failed twice)') : '') +
              (!t.ok && critical(f) && TRIES > 1 ? '  (critical: no second try)' : '') +
              (part ? '  (part skipped)' : ''));
  if (retried && t.ok) {
    secondTry.push(f);
    console.log('        the first try:');
    reasons(first).forEach((l) => console.log('        ' + l));
    if (ON_GITHUB) console.log('::warning title=Passed only on the second try::' + f + ': ' + reasons(first)[0]);
  }
  if (whole && !refused) skipped.push(f + ' (' + t.skip[0] + ')');
  if (part && !refused) partSkipped.push(f + ' (' + t.skip[0] + ')');
  if (refused) {
    console.log('        a critical check that could not run has not passed: ' + t.skip[0]);
  }
  if (!ok) {
    failed++;
    failures.push(f);
    if (!t.ok) reasons(t).forEach((l) => console.log('        ' + l));
  }
}
const mins = ((Date.now() - started) / 60000).toFixed(1);
const passed = files.length - failed - skipped.length;
console.log('\n  ' + kind + ': ' + passed + ' of ' + files.length + ' files passed' +
            (skipped.length ? ', ' + skipped.length + ' skipped' : '') + ', ' + checks + ' checks, ' + mins + ' minutes' +
            (skipped.length ? '\n  skipped, nothing in them ran: ' + skipped.join('; ') : '') +
            (partSkipped.length ? '\n  part skipped, the rest passed: ' + partSkipped.join('; ') : '') +
            (secondTry.length ? '\n  passed only on the second try (worth making steadier): ' + secondTry.join(', ') : '') +
            (failed ? '\n  failed: ' + failures.join(', ') : ''));
process.exit(failed ? 1 : 0);
