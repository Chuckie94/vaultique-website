/* ===========================================================================
   ONLINE PAYMENT, MADE SAFER (website build 77) -- in a real browser

   The real index.html, admin.html and assets, and the REAL supabase-js (from
   ../vendor, as tests/pos-orders.browser.cjs uses it), on a phone.

     5. The page the customer comes back to from Flutterwave: "Nothing has
        been taken" only on Flutterwave's own word; a customer who left the
        payment page is told an approval on the phone may still arrive, and
        the page keeps checking; a payment that needs attention says so; the
        page checks for two minutes, not twenty seconds.
     2/4. Admin > Orders: a payment that needs attention, with what came in;
        the payment history of an order paid online; a WhatsApp order has
        none; a shop that has not run the SQL is told so.
   =========================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');

let checks = 0, failures = 0;
const is = (c, m, x) => { checks++; if (c) console.log('  ✓ ' + m); else { failures++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); } };
const J = o => JSON.stringify(o);

let SUPABASE_JS = null;
for (const p of [
  // Website 80: the copy the site itself loads (build 79's line keeps it in assets/vendor).
  () => path.join(ROOT, 'assets', 'vendor', 'supabase-js-2.118.0.js'),
  () => require.resolve('@supabase/supabase-js/dist/umd/supabase.js'),
  () => path.resolve(ROOT, '..', 'vendor', 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd', 'supabase.js'),
]) {
  try { const f = p(); if (fs.existsSync(f)) { SUPABASE_JS = fs.readFileSync(f, 'utf8'); break; } } catch (e) {}
}
if (!SUPABASE_JS) {
  console.log('  online payment, build 77, in the browser: skipped (the real supabase-js is not installed here: npm install @supabase/supabase-js@2 in ../vendor)');
  process.exit(0);
}

/* ---------------- the shop ---------------- */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const CATALOGUE = [{ name: 'Silk Scarf', sku: 'SC-1', price: 300, category: 'Accessories', available: true, lowStock: false,
  wasPrice: 0, maxQty: 5, image_url: '/pic/a.png', gallery: [], details: [], description: 'A piece.' }];

/* What the status page answers, scenario by scenario: a function of how many
   times it has been asked. */
let STATUS = () => ({ status: 'pending' });
let ASKED = 0;

/* ---------------- Supabase, answering by who is asking ---------------- */
const USERS = { 'owner@example.com': { id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.com', admin: true } };
const PASSWORD = 'the-right-password-1';
const b64url = s => Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const TOKENS = {}, REFRESH = {};
let seq = 0;
function userBody(u) {
  const at = new Date().toISOString();
  return { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: at, phone: '',
    app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [], factors: [],
    created_at: at, updated_at: at };
}
function session(u) {
  const now = Math.floor(Date.now() / 1000), n = ++seq;
  const access = b64url(J({ alg: 'HS256', typ: 'JWT' })) + '.' + b64url(J({
    sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', aal: 'aal1',
    amr: [{ method: 'password', timestamp: now }], session_id: 'sess-' + n, iat: now, exp: now + 3600,
  })) + '.signature';
  const refresh = 'refresh-' + n;
  TOKENS[access] = u; REFRESH[refresh] = u;
  return { access_token: access, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: refresh, user: userBody(u) };
}
const who = req => TOKENS[String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')] || null;
const at = (min) => new Date(Date.now() - min * 60000).toISOString();

const ORDERS = [
  { id: 'o-rev', ref: 'VB-REV01', status: 'pending', total: 300, currency: 'ZMW', fulfilment: 'collection', created_at: at(30),
    name: 'Test Buyer', phone: '0977000001', email: 'buyer@example.com', customer_id: null,
    payment_method: 'online', payment_status: 'review', pay_ref: 'VB-REV01-0123456789', goods_total: 300, delivery_fee: 0, tax_total: 0,
    order_items: [{ sku: 'SC-1', name: 'Silk Scarf', price: 300, qty: 1 }] },
  { id: 'o-paid', ref: 'VB-PAID1', status: 'pending', total: 300, currency: 'ZMW', fulfilment: 'collection', created_at: at(60),
    name: 'Test Buyer', phone: '0977000001', email: 'buyer@example.com', customer_id: null,
    payment_method: 'online', payment_status: 'paid', pay_channel: 'card', paid_amount: 300, pay_ref: 'VB-PAID1-0123456789',
    goods_total: 300, delivery_fee: 0, tax_total: 0, order_items: [{ sku: 'SC-1', name: 'Silk Scarf', price: 300, qty: 1 }] },
  { id: 'o-wa', ref: 'VB-WA001', status: 'pending', total: 300, currency: 'ZMW', fulfilment: 'delivery', created_at: at(90),
    name: 'Guest Shopper', phone: '0966000002', customer_id: null, order_items: [{ sku: 'SC-1', name: 'Silk Scarf', price: 300, qty: 1 }] },
];
const EVENTS = [
  { at: at(60), what: 'order-payment', from_state: null, to_state: 'awaiting', note: null },
  { at: at(60), what: 'payment', from_state: null, to_state: 'started', note: { amount: 300, currency: 'ZMW', mode: 'test' } },
  { at: at(58), what: 'payment', from_state: 'started', to_state: 'paid', note: { flw_ref: 'FLW-9001', amount: 300 } },
  { at: at(58), what: 'order-payment', from_state: 'awaiting', to_state: 'paid', note: { paid: 300, channel: 'card' } },
  // Website 81: an online refund the platform sent, step by step.
  { at: at(30), what: 'refund', from_state: null, to_state: 'new',
    note: { amount: 100, currency: 'ZMW', by: 'A. Manager', role: 'Store Manager', reason: 'Wrong size', platformRef: 'ORF-2026-0001' } },
  { at: at(30), what: 'refund', from_state: 'new', to_state: 'sending', note: { amount: 100 } },
  { at: at(30), what: 'refund', from_state: 'sending', to_state: 'pending', note: { amount: 100, flwRef: 'URF_501', flwRefundId: '501' } },
  { at: at(20), what: 'refund', from_state: 'pending', to_state: 'completed', note: { amount: 100, flwRef: 'URF_501' } },
];
let HISTORY_TABLE = true;

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css',
                '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
let base = '';
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), p = u.pathname;
  let raw = '';
  req.on('data', c => raw += c);
  req.on('end', () => {
    const send = (code, o) => {
      res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(o === undefined ? '' : J(o));
    };
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch (e) {}

    if (p === '/web/auth/v1/token') {
      const grant = u.searchParams.get('grant_type');
      const usr = grant === 'password' ? USERS[body.email] : REFRESH[body.refresh_token];
      if (!usr || (grant === 'password' && body.password !== PASSWORD)) {
        return send(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      }
      return send(200, session(usr));
    }
    if (p === '/web/auth/v1/user') { const usr = who(req); return usr ? send(200, userBody(usr)) : send(401, { msg: 'invalid JWT' }); }
    if (p === '/web/auth/v1/logout') return send(204);
    if (p.startsWith('/web/auth/v1/')) return send(200, {});

    const usr = who(req);
    if (p === '/web/rest/v1/admins') return send(200, usr && usr.admin ? [{ id: usr.id }] : []);
    if (p === '/web/rest/v1/rpc/is_admin') return send(200, !!(usr && usr.admin));
    if (p === '/web/rest/v1/rpc/my_access') {
      return send(200, usr && usr.admin
        ? { is_admin: true, is_owner: true, active: true, role: 'owner', permissions: {}, must_change_password: false }
        : { is_admin: false, is_owner: false, active: false, role: null, permissions: {} });
    }
    if (p === '/web/rest/v1/orders' && req.method === 'GET') return send(200, usr && usr.admin ? ORDERS : []);
    if (p === '/web/rest/v1/payments' && req.method === 'GET') {
      if (!(usr && usr.admin)) return send(200, []);
      if (u.searchParams.get('order_id') === 'eq.o-rev' && u.searchParams.get('status') === 'eq.review') {
        return send(200, [{ amount: 300, currency: 'ZMW', channel: 'card',
          detail: { mismatch: true, amount: 360, currency: 'ZMW', expected: 300, expectedCurrency: 'ZMW' } }]);
      }
      return send(200, []);
    }
    if (p === '/web/rest/v1/payment_events' && req.method === 'GET') {
      if (!HISTORY_TABLE) return send(404, { code: '42P01', message: 'relation "public.payment_events" does not exist' });
      if (!(usr && usr.admin)) return send(200, []);
      return send(200, u.searchParams.get('order_id') === 'eq.o-paid' ? EVENTS : []);
    }
    if (p.startsWith('/web/rest/v1/rpc/')) return send(200, null);
    if (p.startsWith('/web/rest/v1/')) return send(200, []);
    if (p.startsWith('/web/')) return send(200, {});

    if (p === '/.netlify/functions/pay-status') {
      ASKED++;
      return send(200, Object.assign({ ref: 'VB-RET01', amountText: 'K300' }, STATUS(ASKED)));
    }
    if (p === '/api/products') return send(200, { products: CATALOGUE, count: CATALOGUE.length, version: 't' });
    if (p.startsWith('/.netlify/functions/')) return send(200, {});
    if (p.indexOf('/pic/') === 0) { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(PNG); }
    if (p === '/config.js') {
      res.writeHead(200, { 'Content-Type': TYPES['.js'] });
      return res.end('window.VBP_CONFIG={SUPABASE_URL:"' + base + '/web",SUPABASE_ANON_KEY:"anon"};');
    }
    let file = path.join(ROOT, p === '/' ? 'index.html' : p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, 'index.html');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
});

async function context(browser, viewport) {
  const ctx = await browser.newContext({ viewport: viewport || { width: 390, height: 844 } });
  await ctx.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'text/javascript',
    body: /\/@supabase\/supabase-js/.test(r.request().url()) ? SUPABASE_JS : '' }));
  await ctx.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await ctx.route('**/fonts.gstatic.com/**', r => r.fulfill({ status: 200, body: '' }));
  await ctx.route('**/cdnjs.cloudflare.com/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  return ctx;
}
const ERRORS = [];
const watch = (page) => page.on('pageerror', e => ERRORS.push(String(e && e.message || e)));
const said = async (page) => page.evaluate(() => {
  const h = document.querySelector('#prHead'), l = document.querySelector('#prLead'), a = document.querySelector('#prActs');
  return { head: h ? h.textContent : '', lead: l ? l.textContent : '', acts: a ? a.innerText.replace(/\s+/g, ' ').trim() : '' };
});

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    /* ------------------------------------------------------------------ 5 */
    console.log('\n5. The page the customer comes back to, on a phone');
    /* Each scenario on its own page, with the page's clock in the test's hands
       so that two minutes take a moment. */
    async function back(query, answers) {
      ASKED = 0; STATUS = answers;
      const ctx = await context(browser);
      const page = await ctx.newPage(); watch(page);
      await page.clock.install();
      await page.goto(base + '/payment-return?' + query, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#prHead', { timeout: 15000 });
      return { ctx, page };
    }
    async function wait(page, ms) {
      /* The page asks, waits for the answer (real), then sets its next timer
         (on the page's clock): time is moved on a step at a time. */
      for (let t = 0; t < ms; t += 2500) { await page.clock.runFor(2500); await page.waitForTimeout(40); }
    }

    let { ctx, page } = await back('status=successful&tx_ref=VB-RET01-0123456789&transaction_id=900', () => ({ status: 'paid' }));
    await wait(page, 2500);
    let s = await said(page);
    is(s.head === 'Payment received' && /Order VB-RET01 is paid \(K300\)/.test(s.lead), 'paid: Payment received, with the order and the amount', J(s));
    await ctx.close();

    ({ ctx, page } = await back('status=failed&tx_ref=VB-RET01-0123456789&transaction_id=901', () => ({ status: 'failed' })));
    await wait(page, 2500);
    s = await said(page);
    is(s.head === 'The payment did not go through' && /Nothing has been taken/.test(s.lead) && /Try again/i.test(s.acts),
       'Flutterwave says it failed: "Nothing has been taken", and Try again', J(s));
    await ctx.close();

    ({ ctx, page } = await back('status=cancelled&tx_ref=VB-RET01-0123456789&transaction_id=902',
      (n) => (n >= 6 ? { status: 'paid' } : { status: 'pending' })));
    await wait(page, 5000);
    s = await said(page);
    is(s.head === 'The payment was not completed' && /If you approved it on your phone, it may still arrive/.test(s.lead) &&
       /Please do not pay again/.test(s.lead) && !/Nothing has been taken/.test(s.lead) && !/Try again/i.test(s.acts),
       'the customer left Flutterwave\'s page: no "Nothing has been taken", no Try again, an approval may still arrive', J(s));
    const asked = ASKED;
    await wait(page, 15000);
    s = await said(page);
    is(ASKED > asked && s.head === 'Payment received',
       'and the page keeps checking: the approval arrives, and it says Payment received', J([asked, ASKED, s]));
    await ctx.close();

    ({ ctx, page } = await back('status=successful&tx_ref=VB-RET01-0123456789&transaction_id=903', () => ({ status: 'review' })));
    await wait(page, 2500);
    s = await said(page);
    is(s.head === 'We need to check your payment' && /does not match the order/.test(s.lead) &&
       /We will contact you/.test(s.lead) && /Please do not pay again/.test(s.lead) && !/Nothing has been taken/.test(s.lead),
       'a payment that needs attention: we need to check it, we will contact you, do not pay again', J(s));
    await ctx.close();

    ({ ctx, page } = await back('status=successful&tx_ref=VB-RET01-0123456789&transaction_id=904', () => ({ status: 'pending' })));
    await wait(page, 60000);
    s = await said(page);
    is(s.head === 'Checking your payment…', 'after a minute still pending, it is still checking (76 gave up after twenty seconds)', J(s));
    await wait(page, 70000);
    s = await said(page);
    const total = ASKED;
    is(s.head === 'Waiting for confirmation' && /Please do not pay a second time/.test(s.lead),
       'after two minutes: Waiting for confirmation, do not pay a second time', J(s));
    is(total >= 20 && total <= 40, 'asked every 2.5 seconds at first, then every 5: ' + total + ' times in two minutes', String(total));
    await wait(page, 20000);
    is(ASKED === total, 'and then it stops asking', J([total, ASKED]));
    await ctx.close();

    ({ ctx, page } = await back('status=cancelled&tx_ref=VB-RET01-0123456789&transaction_id=905', () => ({ status: 'pending' })));
    await wait(page, 135000);
    s = await said(page);
    is(s.head === 'The payment was not completed', 'left the page and nothing ever came: it still says so after two minutes', J(s));
    await ctx.close();

    /* ------------------------------------------------------------- 2 and 4 */
    console.log('\n2 and 4. Admin > Orders');
    const ctxA = await context(browser, { width: 1200, height: 900 });
    const admin = await ctxA.newPage(); watch(admin);
    await admin.goto(base + '/admin.html', { waitUntil: 'domcontentloaded' });
    await admin.waitForSelector('#login:not(.hide)', { timeout: 15000 });
    await admin.fill('#email', 'owner@example.com');
    await admin.fill('#password', PASSWORD);
    await admin.click('#loginBtn');
    await admin.waitForSelector('#admin:not(.hide)', { timeout: 15000 });
    await admin.evaluate(() => { location.hash = '#/orders'; });
    await admin.waitForSelector('#ordList .card', { timeout: 15000 });
    await admin.waitForTimeout(500);
    const card = (ref) => admin.evaluate((r) => {
      const c = [...document.querySelectorAll('#ordList .card')].find(x => x.innerText.includes(r));
      if (!c) return null;
      return { badge: (c.querySelector('.pay-badge') || {}).textContent || '', attn: (c.querySelector('.pay-attn') || {}).textContent || '',
               hist: !!c.querySelector('.pay-hist-btn'), box: (c.querySelector('.pay-hist') || {}).innerText || '',
               lines: [...c.querySelectorAll('.pay-hist-line')].map(l => ({ at: (l.querySelector('.pay-hist-at') || {}).textContent || '',
                                                                          text: l.textContent })),
               boxOpen: !!c.querySelector('.pay-hist:not(.hide)') };
    }, ref);
    let rev = await card('VB-REV01');
    is(rev && rev.badge === 'Payment needs attention', 'an order whose payment needs attention says so on its badge', J(rev));
    is(rev && /received K360 by card, the order is K300/.test(rev.attn) && /Nothing has been marked paid/.test(rev.attn),
       'and under it: what came in, what the order is, nothing marked paid, check it in Flutterwave', J(rev && rev.attn));
    let wa = await card('VB-WA001');
    is(wa && !wa.hist && !wa.badge, 'a WhatsApp order has no payment badge and no payment history', J(wa));
    await admin.evaluate(() => {
      const c = [...document.querySelectorAll('#ordList .card')].find(x => x.innerText.includes('VB-PAID1'));
      c.querySelector('.pay-hist-btn').click();
    });
    await admin.waitForTimeout(500);
    let paid = await card('VB-PAID1');
    const lines = (paid && paid.lines) || [];
    is(paid && paid.boxOpen && /Order sent to pay online/.test(paid.box) && /Payment started · K300 \(test mode\)/.test(paid.box) &&
       /Paid · K300 · Flutterwave FLW-9001/.test(paid.box) && /Order marked paid/.test(paid.box),
       'Payment history, opened: started, paid with Flutterwave\'s reference, the order sent and marked paid', J(lines));
    is(lines.length === 8 && lines.every(l => /\d\d:\d\d$/.test(l.at)), 'eight lines, each with its date and time', J(lines));
    is(/Refund asked for · K100 · by A\. Manager \(Store Manager\) · Wrong size · ORF-2026-0001/.test(paid.box) &&
       /Refund sent to Flutterwave · K100/.test(paid.box) &&
       /Refund accepted by Flutterwave · K100 · URF_501 · on its way to the customer/.test(paid.box) &&
       /Refund completed · K100 · URF_501/.test(paid.box),
       'website 81: an online refund in the history: who asked and why, sent, accepted with Flutterwave\'s reference, completed', J(lines));

    HISTORY_TABLE = false;
    await admin.evaluate(() => { location.hash = '#/dashboard'; });
    await admin.waitForTimeout(300);
    await admin.evaluate(() => { location.hash = '#/orders'; });
    await admin.waitForSelector('#ordList .card', { timeout: 15000 });
    await admin.waitForTimeout(400);
    await admin.evaluate(() => {
      const c = [...document.querySelectorAll('#ordList .card')].find(x => x.innerText.includes('VB-PAID1'));
      c.querySelector('.pay-hist-btn').click();
    });
    await admin.waitForTimeout(500);
    paid = await card('VB-PAID1');
    is(paid && /starts once supabase-payment-history\.sql has been run/.test(paid.box),
       'a shop that has not run the SQL yet is told where the history comes from, and nothing breaks', J(paid && paid.box));
    HISTORY_TABLE = true;
    await ctxA.close();

    is(ERRORS.length === 0, 'no script error on any page', J(ERRORS));
  } catch (e) {
    is(false, 'threw: ' + (e && e.stack || e));
  } finally {
    await browser.close();
    server.close();
  }
  console.log('\n' + (failures ? '  ✗ ' + failures + ' of ' + checks + ' checks FAILED'
                               : '  online payment, build 77, in the browser: all ' + checks + ' checks passed'));
  process.exit(failures ? 1 : 0);
})();
