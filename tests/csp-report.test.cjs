/* ===========================================================================
   WHAT THE SECURITY POLICY WOULD HAVE BLOCKED -- netlify/functions/csp-report.js
   Browsers post a report here for anything the policy would block. The
   function writes one short line per report to the function log, keeps keys
   and references out of it, drops what a visitor's own extensions cause, and
   tells a caller nothing.
   =========================================================================== */
const path = require('path');
let checks = 0, failures = 0;
const is = (c, m, x) => { checks++; if (c) console.log('  ✓ ' + m); else { failures++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); } };

const F = require(path.resolve(__dirname, '../netlify/functions/csp-report.js'));

/* What the function writes, caught rather than printed. */
async function send(body, opts) {
  opts = opts || {};
  const lines = [];
  const was = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  let res;
  try {
    const raw = typeof body === 'string' ? body : JSON.stringify(body);
    res = await F.handler({
      httpMethod: opts.method || 'POST',
      headers: { 'content-type': opts.type || 'application/csp-report' },
      body: opts.base64 ? Buffer.from(raw, 'utf8').toString('base64') : raw,
      isBase64Encoded: !!opts.base64,
    });
  } finally {
    console.log = was;
  }
  return { res, lines };
}

const classic = (o) => ({ 'csp-report': Object.assign({
  'document-uri': 'https://vaultiqueboutique.com/shop?preview=PREVIEW-KEY-123#top',
  'violated-directive': 'script-src-elem',
  'effective-directive': 'script-src-elem',
  'blocked-uri': 'https://evil.example/x.js?token=abc',
  'source-file': 'https://vaultiqueboutique.com/assets/app.js?v=0123456789',
  'line-number': 120,
  'disposition': 'report',
}, o || {}) });

(async () => {
  console.log('\nA report from report-uri, the form every browser sends');
  let r = await send(classic());
  is(r.res.statusCode === 204 && r.res.body === '', 'answered 204, with nothing in the answer');
  is(r.lines.length === 1, 'one line in the log', r.lines.join(' | '));
  const line = r.lines[0] || '';
  is(/^csp script-src-elem blocked https:\/\/evil\.example\/x\.js on vaultiqueboutique\.com\/shop \(from vaultiqueboutique\.com\/assets\/app\.js:120\)$/.test(line),
     'saying what, where from, and on which page', line);
  is(!/PREVIEW-KEY|token=|\?v=|#top/.test(line), 'and no ?query or #fragment: a preview key or a token never reaches the log');

  console.log('\nThe newer Reporting API form');
  r = await send([
    { type: 'csp-violation', url: 'https://vaultiqueboutique.com/admin.html',
      body: { documentURL: 'https://vaultiqueboutique.com/admin.html', effectiveDirective: 'connect-src',
              blockedURL: 'wss://other.supabase.co/realtime/v1/websocket?apikey=SECRET-KEY', disposition: 'report' } },
    { type: 'csp-violation', url: 'https://vaultiqueboutique.com/',
      body: { documentURL: 'https://vaultiqueboutique.com/', effectiveDirective: 'script-src-elem',
              blockedURL: 'inline', sample: 'console.log("hi")', sourceFile: 'https://vaultiqueboutique.com/', lineNumber: 7 } },
    { type: 'deprecation', body: { id: 'x' } },
  ], { type: 'application/reports+json' });
  is(r.lines.length === 2, 'two violations, two lines; the deprecation notice beside them is not one', r.lines.join(' | '));
  is(/^csp connect-src blocked wss:\/\/other\.supabase\.co\/realtime\/v1\/websocket on vaultiqueboutique\.com\/admin\.html$/.test(r.lines[0] || ''),
     'a blocked connection, with its key taken off', r.lines[0]);
  is(/blocked inline on vaultiqueboutique\.com\/ \(from vaultiqueboutique\.com\/:7\) sample "console\.log\("hi"\)"$/.test(r.lines[1] || ''),
     'an inline script, with the browser\'s short sample of it', r.lines[1]);

  console.log('\nThe way Netlify may hand the body over');
  r = await send(classic(), { base64: true });
  is(r.lines.length === 1 && /blocked https:\/\/evil\.example\/x\.js/.test(r.lines[0]), 'base64: read the same');

  console.log('\nReports that are about the visitor\'s browser, not the site');
  for (const [what, o] of [
    ['a Chrome extension', { 'blocked-uri': 'chrome-extension://abcdef/inject.js' }],
    ['a Firefox extension', { 'source-file': 'moz-extension://1234/content.js', 'blocked-uri': 'inline' }],
    ['a Safari extension', { 'blocked-uri': 'safari-web-extension://abc/x.js' }],
    ['Safari\'s hidden extension address', { 'source-file': 'webkit-masked-url://hidden/', 'blocked-uri': 'eval' }],
  ]) {
    r = await send(classic(o));
    is(r.res.statusCode === 204 && r.lines.length === 0, what + ': dropped');
  }

  console.log('\nWhatever else is sent');
  r = await send('{"csp-report": {"blocked-uri": "x"');
  is(r.res.statusCode === 204 && r.lines.length === 0, 'not JSON: 204, nothing written');
  r = await send(classic({ 'script-sample': 'x'.repeat(9000) }));
  is(r.res.statusCode === 204 && r.lines.length === 0, 'more than 8 KB: not read at all');
  r = await send([].concat(...Array.from({ length: 50 }, () => [{ type: 'csp-violation', body: { effectiveDirective: 'img-src', blockedURL: 'https://a.example/p.png', documentURL: 'https://s/' } }])));
  is(r.lines.length === 20, 'fifty reports in one post: twenty lines at most', r.lines.length + ' lines');
  r = await send(classic({ 'blocked-uri': 'https://evil.example/a.js\ncsp fake line', 'effective-directive': 'script-src\r\nX' }));
  is(r.lines.length === 1 && !/[\r\n]/.test(r.lines[0]), 'line breaks inside a report cannot add a line of their own', JSON.stringify(r.lines));
  r = await send(classic({ 'blocked-uri': 'data:image/png;base64,' + 'A'.repeat(500) }));
  is(r.lines.length === 1 && / blocked data: on /.test(r.lines[0]), 'a data: address is written as data:, not copied out', r.lines[0]);
  r = await send(classic({ 'script-sample': 'y'.repeat(300) }));
  is(r.lines.length === 1 && /sample "y{40}"$/.test(r.lines[0]), 'a sample is cut to forty characters');
  r = await send(null);
  is(r.res.statusCode === 204 && r.lines.length === 0, 'an empty post: 204, nothing written');

  r = await send(classic(), { method: 'GET' });
  is(r.res.statusCode === 405 && r.res.headers.Allow === 'POST' && r.lines.length === 0, 'anything but POST: 405');

  console.log(failures ? '\n  ✗ ' + failures + ' of ' + checks + ' checks FAILED' : '\n  policy reports: all ' + checks + ' checks passed');
  process.exit(failures ? 1 : 0);
})();
