/* ===========================================================================
   THE RUNNER'S TWO RULES (website build 84) · tests/run-tests.js

   The real runner, copied beside made-up check files that pass, fail, skip,
   or fail only the first time:

     1. a file that passes is a pass, and a file that fails fails the run;
     2. a file that skips all its checks is shown as skipped, never as
        passed, and named at the end with its reason;
     3. a file that skips a part is named too, the rest still counting;
     4. an ordinary browser file that fails once and then passes is a pass,
        named as passed only on the second try;
     5. a critical browser file (payments, sign-in, security) gets no second
        try: it fails the run the first time;
     6. a critical file that skips has not passed: it fails the run.
   =========================================================================== */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let checks = 0, failures = 0;
const ok = (m) => { checks++; console.log('  ✓ ' + m); };
const fail = (m, x) => { checks++; failures++; console.log('  ✗ ' + m + (x ? '\n      ' + String(x).slice(0, 800).replace(/\n/g, '\n      ') : '')); };
const is = (c, m, x) => (c ? ok(m) : fail(m, x));

const RUNNER = path.join(__dirname, 'run-tests.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vbp-runner-'));

/* Each made-up file prints what a real one prints, ticks and crosses included. */
const say = (lines, code) => 'console.log(' + JSON.stringify(lines.join('\n')) + '); process.exit(' + code + ');\n';
const onceThenPass = (name, lines) =>
  "const fs = require('fs'), f = require('path').join(__dirname, " + JSON.stringify(name + '.tried') + ");\n" +
  "if (!fs.existsSync(f)) { fs.writeFileSync(f, '1'); console.log('  \\u2717 the page was late\\n\\n  " + name + ": 1 of 3 checks FAILED'); process.exit(1); }\n" +
  say(lines, 0);
const FILES = {
  'good.test.cjs': say(['  ✓ one', '  ✓ two', '', '  good: all 2 checks passed'], 0),
  'bad.test.cjs': say(['  ✓ one', '  ✗ two', '        what it found', '', '  bad: 1 of 2 checks FAILED'], 1),
  'whole.test.cjs': say(['', 'whole: skipped — set VBP_TEST_DB to a scratch database to run it'], 0),
  'partly.test.cjs': say(['  ✓ one', '', 'Against the platform', '  (skipped: no copy of the platform at /nowhere)', '', '  partly: all 1 checks passed'], 0),
  'words.test.cjs': say(['  ✓ the reminder is skipped once it has been sent', '', '  words: all 1 checks passed'], 0),
};
const BROWSER = {
  'steady.browser.cjs': say(['  ✓ one', '', '  steady: all 1 checks passed'], 0),
  'flaky.browser.cjs': onceThenPass('flaky', ['  ✓ one', '  ✓ two', '  ✓ three', '', '  flaky: all 3 checks passed']),
  'payments.browser.cjs': onceThenPass('payments', ['  ✓ one', '  ✓ two', '  ✓ three', '', '  payments: all 3 checks passed']),
};
const CRITICAL_SKIP = { 'csp.browser.cjs': say(['  csp: skipped (no browser here)'], 0) };

function lane(name, files, kind) {
  const dir = path.join(TMP, name, 'tests');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(RUNNER, path.join(dir, 'run-tests.js'));
  for (const f of Object.keys(files)) fs.writeFileSync(path.join(dir, f), files[f]);
  const env = Object.assign({}, process.env); delete env.GITHUB_ACTIONS;
  const r = spawnSync(process.execPath, [path.join(dir, 'run-tests.js'), kind], { encoding: 'utf8', env, timeout: 120000 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
const lineOf = (out, f) => out.split('\n').filter((l) => l.indexOf(f) > -1 && /^\s+[✓✗–] /.test(l))[0] || '';

console.log('\nNode files: pass, fail, skip, part skip');
let r = lane('node', FILES, 'node');
is(/^\s+✓ good\.test\.cjs/.test(lineOf(r.out, 'good.test.cjs')), 'a file that passes: a pass', lineOf(r.out, 'good.test.cjs'));
is(/^\s+✗ bad\.test\.cjs/.test(lineOf(r.out, 'bad.test.cjs')) && r.code === 1, 'a file that fails: a cross, and the run fails', r.out);
is(/what it found/.test(r.out), 'with what it found beneath it');
is(/^\s+– whole\.test\.cjs/.test(lineOf(r.out, 'whole.test.cjs')), 'a file that skipped everything: a dash, not a tick', lineOf(r.out, 'whole.test.cjs'));
is(/node: 3 of 5 files passed, 1 skipped, /.test(r.out), 'the count says 3 passed and 1 skipped, out of 5 (the skipped one is not counted as passed)', r.out.split('\n').slice(-6).join('\n'));
is(/skipped, nothing in them ran: whole\.test\.cjs \(whole: skipped — set VBP_TEST_DB/.test(r.out), 'and names it at the end, with its reason');
is(/part skipped, the rest passed: partly\.test\.cjs \(skipped: no copy of the platform/.test(r.out) &&
   /\(part skipped\)/.test(lineOf(r.out, 'partly.test.cjs')), 'a file that skipped a part: named too, with its reason');
is(/^\s+✓ words\.test\.cjs/.test(lineOf(r.out, 'words.test.cjs')) && !/part skipped, the rest passed: [^\n]*words/.test(r.out),
   'a check whose own words say "skipped" is a check, not a skip', lineOf(r.out, 'words.test.cjs'));

console.log('\nBrowser files: a second try, but never for a critical one');
r = lane('browser', BROWSER, 'browser');
is(/^\s+✓ flaky\.browser\.cjs.*passed on the second try/.test(lineOf(r.out, 'flaky.browser.cjs')),
   'an ordinary file that fails once, then passes: a pass, said as on the second try', lineOf(r.out, 'flaky.browser.cjs'));
is(/passed only on the second try \(worth making steadier\): flaky\.browser\.cjs/.test(r.out), 'and named at the end');
is(/^\s+✗ payments\.browser\.cjs.*critical: no second try/.test(lineOf(r.out, 'payments.browser.cjs')),
   'a critical file (payments) that fails once: fails, with no second try', lineOf(r.out, 'payments.browser.cjs'));
is(!fs.existsSync(path.join(TMP, 'browser', 'tests', 'payments.tried')) || r.code === 1, 'and the run fails', r.out);
is(/failed: payments\.browser\.cjs/.test(r.out) && !/failed: [^\n]*flaky/.test(r.out), 'only the critical one is named as failed');

console.log('\nA critical file that cannot run has not passed');
r = lane('skipcrit', CRITICAL_SKIP, 'browser');
is(r.code === 1 && /^\s+✗ csp\.browser\.cjs/.test(lineOf(r.out, 'csp.browser.cjs')), 'a critical file that skipped: a cross, and the run fails', r.out);
is(/a critical check that could not run has not passed: csp: skipped \(no browser here\)/.test(r.out), 'saying why');

fs.rmSync(TMP, { recursive: true, force: true });
console.log('\n  the runner: ' + (failures ? failures + ' of ' + checks + ' checks FAILED' : 'all ' + checks + ' checks passed'));
process.exit(failures ? 1 : 0);
