/* ===========================================================================
   THE NEWSLETTER FORM, AS A VISITOR USES IT -- build 76, in a real browser

   The real index.html and assets/app.js, talking to the real newsletter
   function (netlify/functions/newsletter.js), which talks to a stand-in for
   this website's Supabase. What the visitor is told for a new address, for
   one that unsubscribed earlier, when the shop's email is not working, and
   the old way still working before the SQL or the service key is in place.
   =========================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
let checks = 0, failures = 0;
const is = (c, m, x) => { checks++; if (c) console.log('  ✓ ' + m); else { failures++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); } };

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/json' };
let SUBS, MAILS, MAIL_ON, OLD_RPC_CALLS;
function reset() {
  SUBS = { 'gone@example.com': { email: 'gone@example.com', unsubscribed_at: '2026-09-01' } };
  MAILS = []; MAIL_ON = true; OLD_RPC_CALLS = [];
}
reset();

const read = (req) => new Promise((r) => { let d = ''; req.on('data', (c) => d += c); req.on('end', () => r(d)); });
let base = '', FN = null;
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'), p = u.pathname;
  const body = await read(req);
  const send = (code, o, type) => { res.writeHead(code, { 'Content-Type': type || 'application/json' }); res.end(o === undefined ? '' : (typeof o === 'string' ? o : JSON.stringify(o))); };
  const service = (req.headers.authorization || '') === 'Bearer service-key';

  if (p === '/.netlify/functions/newsletter') {
    const r = await FN({ httpMethod: req.method, body, headers: req.headers, queryStringParameters: Object.fromEntries(u.searchParams) });
    res.writeHead(r.statusCode, r.headers || {}); return res.end(r.body || '');
  }
  if (p === '/web/rest/v1/site_settings') {
    const key = (u.searchParams.get('key') || '').replace('eq.', '');
    if (key === 'general') return send(200, [{ data: { businessName: 'Vaultique', currency: 'ZMW' } }]);
    if (key === 'notifications') return send(200, [{ data: { emailEnabled: MAIL_ON, smtpHost: 'smtp.example', senderEmail: 'shop@example.com' } }]);
    return send(200, []);
  }
  if (p === '/web/rest/v1/site_settings_private' && service) return send(200, [{ data: {} }]);
  if (p === '/web/rest/v1/rpc/newsletter_join' && service) {
    const b = JSON.parse(body), k = b.p_email.toLowerCase(), r = SUBS[k];
    if (!r) { SUBS[k] = { email: b.p_email, unsubscribed_at: null }; return send(200, { state: 'joined' }); }
    if (!r.unsubscribed_at) return send(200, { state: 'already' });
    if (r.asked) return send(200, { state: 'wait' });
    r.asked = true;
    return send(200, { state: 'confirm', token: 'ab'.repeat(24), email: r.email });
  }
  if (p === '/web/rest/v1/subscribers' && service && req.method === 'PATCH') {
    Object.values(SUBS).forEach((s) => { s.asked = false; });
    return send(204);
  }
  if (p === '/web/rest/v1/rpc/subscribe_email') {
    OLD_RPC_CALLS.push(JSON.parse(body));
    return send(200, true);
  }
  if (p.startsWith('/web/rest/v1/')) return send(200, []);
  if (p === '/api/products') return send(200, { products: [] });
  if (p.startsWith('/pos/')) return send(200, [{ id: 1, state: { products: [] } }]);
  if (p === '/config.js') return send(200, 'window.VBP_CONFIG={SUPABASE_URL:"' + base + '/web",SUPABASE_ANON_KEY:"anon-key"};', TYPES['.js']);
  let file = path.join(ROOT, p);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  Object.assign(process.env, {
    WEB_SUPABASE_URL: base + '/web', WEB_SUPABASE_ANON_KEY: 'anon-key',
    POS_SUPABASE_URL: base + '/pos', POS_SUPABASE_KEY: 'pos-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key', URL: base,
  });
  const F = path.join(ROOT, 'netlify', 'functions');
  require(path.join(F, 'send-email'))._internals.sendMail = async (m) => { MAILS.push(m); };
  FN = require(path.join(F, 'newsletter')).handler;

  const browser = await chromium.launch();
  const errors = [];
  async function subscribe(email) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(base + '/');
    await page.waitForSelector('#nlForm', { state: 'attached' });
    await page.locator('#nlEmail').scrollIntoViewIfNeeded();
    await page.fill('#nlEmail', email);
    await page.click('#nlBtn');
    await page.waitForFunction(() => {
      const ok = document.querySelector('#nlSuccess'), bad = document.querySelector('#nlError');
      return (ok && ok.classList.contains('show')) || (bad && bad.classList.contains('show'));
    }, null, { timeout: 10000 });
    const out = await page.evaluate(() => ({
      ok: document.querySelector('#nlSuccess').classList.contains('show'),
      said: document.querySelector('#nlSuccess').textContent,
      err: document.querySelector('#nlError').classList.contains('show') ? document.querySelector('#nlError').textContent : '',
      formHidden: document.querySelector('#nlForm').classList.contains('hide'),
    }));
    await page.close();
    return out;
  }

  try {
    console.log('\nA new address');
    let r = await subscribe('new@example.com');
    is(r.ok && r.formHidden && /on the list/i.test(r.said) && SUBS['new@example.com'], 'is thanked and on the list, as before', JSON.stringify(r));

    console.log('\nAn address that unsubscribed earlier');
    r = await subscribe('gone@example.com');
    is(r.ok && /emailed a link to gone@example\.com/.test(r.said) && SUBS['gone@example.com'].unsubscribed_at,
       'is told to look for the link in that inbox, and stays off the list until it is followed', JSON.stringify(r));
    is(MAILS.length === 1 && MAILS[0].to === 'gone@example.com', 'the link went to that address');
    r = await subscribe('gone@example.com');
    is(r.ok && /a little while ago/.test(r.said) && MAILS.length === 1, 'asked again, it says the link already went, and sends no second one', JSON.stringify(r));

    console.log('\nWhen the shop\'s email is not working');
    reset(); MAIL_ON = false;
    r = await subscribe('gone@example.com');
    is(!r.ok && /could not send the email/.test(r.err), 'the visitor is told plainly, not told to wait for an email that is not coming', JSON.stringify(r));

    console.log('\nThe old way, until everything is in place');
    reset();
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    r = await subscribe('new@example.com');
    is(r.ok && OLD_RPC_CALLS.length === 1 && OLD_RPC_CALLS[0].p_email === 'new@example.com',
       'without the service key in Netlify, the form joins through the database directly, as build 75 did', JSON.stringify(OLD_RPC_CALLS));
    process.env.SUPABASE_SERVICE_ROLE_KEY = key;

    is(!errors.length, 'no errors on the page', errors.join(' | '));
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failures ? '\n  ✗ ' + failures + ' of ' + checks + ' checks FAILED' : '\n  the newsletter form: all ' + checks + ' checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('  ✗ the test itself failed: ' + (e && e.stack || e)); process.exit(1); });
