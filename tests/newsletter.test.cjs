/* ===========================================================================
   JOINING THE NEWSLETTER -- netlify/functions/newsletter.js (build 76)

   Up to build 75 the website's form put any address that had unsubscribed
   straight back on the list: anybody could undo somebody else's "stop
   sending me these" by typing their address in. Now a new address joins at
   once, and one that unsubscribed is sent a link, through the shop's own
   email, that only its owner can follow. Run as Netlify runs it, against a
   stand-in for this website's Supabase that answers newsletter_join and
   newsletter_confirm the way supabase-hardening.sql does.
   =========================================================================== */
const http = require('http');
const path = require('path');
const crypto = require('crypto');

let checks = 0, failures = 0;
const is = (c, m, x) => { checks++; if (c) console.log('  ✓ ' + m); else { failures++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); } };

let SUBS, MAILS, MAIL_ON, OLD_DB, TOO_MANY, SHOP, CALLS;
function reset() {
  SUBS = {
    'gone@example.com': { email: 'gone@example.com', unsubscribed_at: '2026-09-01T00:00:00Z', rejoin_hash: null, rejoin_at: null },
    'here@example.com': { email: 'here@example.com', unsubscribed_at: null, rejoin_hash: null, rejoin_at: null },
  };
  MAILS = []; MAIL_ON = true; OLD_DB = false; TOO_MANY = false; SHOP = 'Vaultique'; CALLS = [];
}
reset();
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

const read = (req) => new Promise((r) => { let d = ''; req.on('data', (c) => d += c); req.on('end', () => r(d)); });
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'), p = u.pathname;
  const body = await read(req);
  const send = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(o === undefined ? '' : JSON.stringify(o)); };
  const service = (req.headers.authorization || '') === 'Bearer service-key';
  if (p === '/web/rest/v1/site_settings') {
    const key = (u.searchParams.get('key') || '').replace('eq.', '');
    if (key === 'general') return send(200, [{ data: { businessName: SHOP } }]);
    if (key === 'notifications') return send(200, [{ data: { emailEnabled: MAIL_ON, smtpHost: 'smtp.example', senderEmail: 'shop@example.com' } }]);
    return send(200, []);
  }
  if (!service) return send(401, { message: 'permission denied' });
  if (p === '/web/rest/v1/site_settings_private') return send(200, [{ data: { smtpPassword: 'x' } }]);
  const b = body ? JSON.parse(body) : {};
  if (p.startsWith('/web/rest/v1/rpc/')) CALLS.push(Object.assign({ fn: p.split('/').pop() }, b));
  if (p === '/web/rest/v1/rpc/newsletter_join') {
    if (OLD_DB) return send(404, { code: 'PGRST202', message: 'Could not find the function public.newsletter_join(p_client, p_email) in the schema cache' });
    if (TOO_MANY) return send(400, { code: 'P0429', message: 'Too many tries just now. Please wait a little and try again.' });
    const k = String(b.p_email).toLowerCase(), r = SUBS[k];
    if (!r) { SUBS[k] = { email: b.p_email, unsubscribed_at: null }; return send(200, { state: 'joined' }); }
    if (!r.unsubscribed_at) return send(200, { state: 'already' });
    if (r.rejoin_at && Date.now() - r.rejoin_at < 3600e3) return send(200, { state: 'wait' });
    const token = crypto.randomBytes(24).toString('hex');
    Object.assign(r, { rejoin_hash: sha(token), rejoin_at: Date.now() });
    return send(200, { state: 'confirm', token, email: r.email });
  }
  if (p === '/web/rest/v1/rpc/newsletter_confirm') {
    const r = Object.values(SUBS).find((s) => s.rejoin_hash && s.rejoin_hash === sha(String(b.p_token)));
    if (!r) return send(200, false);
    Object.assign(r, { unsubscribed_at: null, rejoin_hash: null, rejoin_at: null });
    return send(200, true);
  }
  if (p === '/web/rest/v1/rpc/subscribe_email') {
    const k = String(b.p_email).toLowerCase();
    SUBS[k] = Object.assign(SUBS[k] || { email: b.p_email }, b.p_rejoin ? { unsubscribed_at: null } : {});
    return send(200, true);
  }
  if (p === '/web/rest/v1/subscribers' && req.method === 'PATCH') {
    const r = SUBS[String(u.searchParams.get('email') || '').replace('eq.', '').toLowerCase()];
    if (r) Object.assign(r, b);
    return send(204);
  }
  send(404, { path: p });
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  Object.assign(process.env, {
    WEB_SUPABASE_URL: base + '/web', WEB_SUPABASE_ANON_KEY: 'anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key', URL: 'https://shop.example',
  });
  const F = path.join(__dirname, '..', 'netlify', 'functions');
  require(path.join(F, 'send-email'))._internals.sendMail = async (m) => { MAILS.push(m); };
  const fn = require(path.join(F, 'newsletter')).handler;
  const join = (email, headers) => fn({ httpMethod: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, headers || {}),
                                        body: JSON.stringify({ email }) })
    .then((r) => ({ code: r.statusCode, body: JSON.parse(r.body || '{}') }));
  const open = (token) => fn({ httpMethod: 'GET', headers: {}, queryStringParameters: { confirm: token } });
  const press = (token) => fn({ httpMethod: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
                                isBase64Encoded: true, body: Buffer.from('confirm=' + token).toString('base64'),
                                queryStringParameters: { confirm: token } });

  try {
    console.log('\nA new address, and one on the list already');
    let r = await join('new@example.com', { 'x-nf-client-connection-ip': '203.0.113.9' });
    is(r.code === 200 && r.body.state === 'joined' && SUBS['new@example.com'] && !MAILS.length,
       'a new address joins at once, as before, with no email to answer', JSON.stringify(r));
    is(CALLS[CALLS.length - 1].p_client === '203.0.113.9', 'the connection goes to the database, which throttles per connection');
    r = await join('here@example.com');
    is(r.code === 200 && r.body.state === 'already', 'an address already on the list is told so');

    console.log('\nAn address that unsubscribed');
    r = await join('gone@example.com');
    const mail = MAILS[0] || {};
    const m = /\/\.netlify\/functions\/newsletter\?confirm=([0-9a-f]{48})/.exec(mail.text || '');
    is(r.code === 200 && r.body.state === 'confirm', 'is not put back by being typed in: the form says a link was sent', JSON.stringify(r));
    is(SUBS['gone@example.com'].unsubscribed_at !== null, 'and the address is still off the list');
    is(mail.to === 'gone@example.com' && !!m, 'the link goes to that inbox only, through the shop\'s own email', mail.to);
    is(/^https:\/\/shop\.example\//.test((/https?:\/\/\S+/.exec(mail.text || '') || [''])[0]), 'and points at the website itself');
    is(/Vaultique/.test(mail.subject + mail.text) && !/\{shop\}/.test(mail.subject + mail.text), 'in the shop\'s own name');
    r = await join('gone@example.com');
    is(r.body.state === 'wait' && MAILS.length === 1, 'asked again within the hour: no second email, the form says to look for the first');

    const token = m ? m[1] : '';
    let page = await open(token);
    is(page.statusCode === 200 && /<form method="post">/.test(page.body) && /Yes, send them again/.test(page.body),
       'opening the link shows a page with one button');
    is(SUBS['gone@example.com'].unsubscribed_at !== null,
       'and changes nothing by itself, so an email service checking links for danger cannot rejoin anybody');
    is(/no-referrer/.test(page.headers['Referrer-Policy']) && /default-src 'none'/.test(page.headers['Content-Security-Policy']) &&
       page.headers['Cache-Control'] === 'no-store' && page.headers['X-Robots-Tag'] === 'noindex',
       'the page keeps its link to itself: no referrer, nothing loaded from elsewhere, not cached, not indexed');
    page = await press(token);
    is(page.statusCode === 200 && /back on the list/.test(page.body) && SUBS['gone@example.com'].unsubscribed_at === null,
       'pressing the button puts the address back on the list');
    page = await press(token);
    is(page.statusCode === 410 && /expired/.test(page.body), 'and the link works once');
    page = await press('not-a-token');
    is(page.statusCode === 400, 'a link cut short says so');

    console.log('\nWhen the email cannot be sent');
    reset(); MAIL_ON = false;
    r = await join('gone@example.com');
    is(r.body.state === 'contact' && !MAILS.length, 'the form is told, rather than told to wait for an email that is not coming', JSON.stringify(r));
    MAIL_ON = true;
    r = await join('gone@example.com');
    is(r.body.state === 'confirm' && MAILS.length === 1, 'and the next try, with email working, sends the link at once: no hour lost');

    console.log('\nThe page is the shop\'s, and safe with any name');
    reset(); SHOP = 'Vault<script>alert(1)</script>';
    page = await open('a'.repeat(48));
    is(!/<script>alert/.test(page.body) && /Vault&lt;script&gt;/.test(page.body), 'the shop\'s name is shown as text, never run');

    console.log('\nWhat it refuses, and the way things were');
    reset(); TOO_MANY = true;
    r = await join('someone@example.com');
    is(r.code === 429 && /wait a little/.test(r.body.error), 'when the database\'s throttle says too many, the visitor is asked to wait');
    reset();
    r = await join('not an email');
    is(r.code === 400 && !CALLS.length, 'something that is not an email address goes no further');
    reset(); OLD_DB = true;
    r = await join('gone@example.com');
    is(r.code === 200 && r.body.state === 'joined' && CALLS.some((c) => c.fn === 'subscribe_email' && c.p_rejoin === true),
       'before supabase-hardening.sql has been run, it joins the old way');
    reset();
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    r = await join('new@example.com');
    is(r.code === 503 && r.body.fallback === true, 'without the service key in Netlify, it tells the form to join the old way');
    process.env.SUPABASE_SERVICE_ROLE_KEY = key;
    r = await fn({ httpMethod: 'DELETE', headers: {} });
    is(r.statusCode === 405, 'anything but GET and POST');
  } finally {
    server.close();
  }
  console.log(failures ? '\n  ✗ ' + failures + ' of ' + checks + ' checks FAILED' : '\n  joining the newsletter: all ' + checks + ' checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('  ✗ the test itself failed: ' + (e && e.stack || e)); process.exit(1); });
