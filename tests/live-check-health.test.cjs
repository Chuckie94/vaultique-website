/* ===========================================================================
   THE LIVE CHECK READS THE HEALTH CHECK (website build 84) · tools/live-check.cjs, section 9

   tools/live-check.cjs is run by hand after a deploy, against the live site.
   Here it is run against a stand-in site on this computer, which answers
   /api/health four ways (everything else: not found). Only its section 9
   is judged:

     1. "working", checks on: two ticks, and nothing more told to anybody;
     2. the deploy checks paused: a cross, saying how to end it;
     3. "not working", and telling anybody more than one word: two crosses;
     4. a site older than build 84 (the shop's own page answers): a note,
        never a cross.
   =========================================================================== */
'use strict';
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

let checks = 0, failures = 0;
const ok = (m) => { checks++; console.log('  ✓ ' + m); };
const fail = (m, x) => { checks++; failures++; console.log('  ✗ ' + m + (x ? '\n      ' + String(x).replace(/\n/g, '\n      ') : '')); };
const is = (c, m, x) => (c ? ok(m) : fail(m, x));

const LIVE = path.resolve(__dirname, '..', 'tools', 'live-check.cjs');
let MODE = 'good';
const ANSWERS = {
  good: { status: 'working', build: 84, version: '1.54.0', deployChecks: 'on', at: 'now' },
  paused: { status: 'working', build: 84, version: '1.54.0', deployChecks: 'paused', at: 'now' },
  leaky: { status: 'not working', build: 84, version: '1.54.0', deployChecks: 'on', at: 'now', settings: [] },
};
const server = http.createServer((req, res) => {
  if (req.url.indexOf('/api/health') === 0) {
    if (MODE === 'old') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<!doctype html><title>The shop</title>'); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(ANSWERS[MODE]));
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('');
});

function run(base) {
  return new Promise((done) => {
    const p = spawn(process.execPath, [LIVE, base], { env: process.env });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    const t = setTimeout(() => p.kill(), 120000);
    p.on('close', () => { clearTimeout(t); done(out); });
  });
}
const section9 = (out) => (/\n9\. The health check[^\n]*\n([\s\S]*?)(\n\s*\n|$)/.exec(out) || [])[1] || '';

(async function main() {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;

  console.log('\nWorking, the checks on');
  MODE = 'good';
  let s = section9(await run(base));
  is(/✓ the health check says: working \(build 84\)/.test(s), '"working": a tick, with the build', s);
  is(/✓ the checks before each deploy: on/.test(s) && /✓ it tells anybody nothing more/.test(s) && !/✗/.test(s),
     'the checks on, and nothing more told to anybody: ticks only', s);

  console.log('\nThe deploy checks paused');
  MODE = 'paused';
  s = section9(await run(base));
  is(/✗ the checks before each deploy are PAUSED \(VBP_DEPLOY_GATE in Netlify\): delete that setting, then Trigger deploy/.test(s),
     'a cross, and how to end it', s);

  console.log('\nNot working, and saying too much');
  MODE = 'leaky';
  s = section9(await run(base));
  is(/✗ the health check says: NOT WORKING/.test(s), '"not working": a cross', s);
  is(/✗ the health check tells anybody more than it should: settings/.test(s), 'telling anybody more than one word: a cross, naming it', s);

  console.log('\nA site older than build 84');
  MODE = 'old';
  s = section9(await run(base));
  is(/! there is no health check yet: the live site is older than build 84/.test(s) && !/✗/.test(s),
     'the shop\'s own page answers: a note, never a cross', s);

  server.close();
  console.log('\n  live check, section 9: ' + (failures ? failures + ' of ' + checks + ' checks FAILED' : 'all ' + checks + ' checks passed'));
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('  ✗ the test itself broke: ' + (e && e.stack || e)); process.exit(1); });
