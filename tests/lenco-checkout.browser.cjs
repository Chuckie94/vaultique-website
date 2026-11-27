/* ===========================================================================
   THE UNIFIED CHECKOUT, WITH LENCO (website build 88) -- in a real browser

   The owner: "Build a unified checkout selector: on your custom checkout
   page, present clear payment method buttons (Mobile Money, Instant Bank
   Transfer, Debit / Credit Card) rather than forcing customers to pick a
   gateway brand."

   The real index.html and assets/app.js, with the real payment functions
   behind them (pay-quote, pay-start, pay-status), a stand-in for Lenco's API
   that answers as Lenco's reference says, and a stand-in for Lenco's card
   window served at Lenco's own script address (pay.sandbox.lenco.co):

     1. after the total: "How would you like to pay?", with the ways of
        paying the server says can be paid (no gateway named, no Instant
        Bank Transfer while no gateway takes one), the networks the shop
        ticked, and the number from the details; under Mobile Money, "A
        payment approval request will be sent to this number..." and
        "Payments are processed securely by Lenco."; under a card, only
        "Your card details are entered in a secure payment window and are
        never kept by this website." (Lenco is named once the window opens);
     2. a number for the wrong network is caught here, before any phone rings;
     3. mobile money: "Payment Authorisation Required", with Check payment
        status, Choose another payment method and Cancel payment; once a new
        request can be sent, "Didn't receive approval request?" with Try
        again and a Contact us link to the chat; then "Payment Successful",
        View order details, Continue shopping;
     4. "Payment Unsuccessful", in the owner's words, with Try again on the
        same order, Choose another payment method, or WhatsApp;
     5. Cancel payment: "Payment Cancelled", and no new request until the
        first can no longer be approved;
     6. cards: Lenco's window with the public key and our reference, never a
        card field on this page; paid, or closed ("Payment Not Completed");
     7. the line drops: said plainly, and the next press is the same payment;
     8. in Test mode only the shop sees any of it, and it says TEST.
   The shop is in Live mode for most of it, as its customers see it (against
   the same stand-in: nothing here reaches Lenco).

   SHOTS=<folder> keeps a picture of each screen there (phone size).
   =========================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
let checks = 0, failures = 0;
const ok = m => { checks++; console.log('  ✓ ' + m); };
const fail = (m, x) => { checks++; failures++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); };
const is = (c, m, x) => c ? ok(m) : fail(m, x);
const J = (o) => JSON.stringify(o);
const SHOTS = process.env.SHOTS || '';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/json' };
const POS = [
  /* Plenty in stock: every paid order here holds its bag (build 77), and the
     checks pay for several. */
  { sku: 'BG-1', name: 'Leather Satchel', category: 'Bags', price: 500, stock: 40, active: true, unitWeight: 2 },
  { sku: 'SC-1', name: 'Silk Scarf', category: 'Accessories', price: 300, stock: 10, active: true, unitWeight: 1.5 },
];
const SETTINGS = {
  general: { businessName: 'Vaultique Boutique', currency: 'ZMW' },
  payments: { onlineEnabled: true, onlineMode: 'test', onlineCard: true, onlineMobile: true,
              lencoEnabled: true, lencoAirtel: true, lencoMtn: true, lencoZamtel: false, lencoCard: true, flwEnabled: false },
  delivery: { payDelivery: true, standardFee: 80 },
  shopping: { requireName: true, requirePhone: true, requireEmail: false, requireAddress: false },
  contact: { orderNumber: '260970000000', whatsapp: '260970000000' },
};
const DB = { orders: [], order_items: [], payments: [], payment_webhooks: [] };
const PRIV = {};
const LENCO = { made: [], collections: {} };
let seq = 0;
const TOKEN = 'lenco-sandbox-token-browser-0001';
const TOKEN_LIVE = 'lenco-live-token-browser-0002';

const read = req => new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => r(d)); });
function filters(q) {
  const out = [];
  for (const [k, v] of new URLSearchParams(q)) {
    if (['select', 'order', 'limit'].includes(k)) continue;
    const m = /^(eq|neq|in|gt|lt|is)\.(.*)$/.exec(v); if (m) out.push([k, m[1], m[2]]);
  }
  return out;
}
function matches(row, fs2) {
  return fs2.every(([k, op, v]) => {
    const x = row[k] == null ? '' : String(row[k]);
    if (op === 'eq') return x === v; if (op === 'neq') return x !== v; if (op === 'gt') return x > v; if (op === 'lt') return x < v;
    if (op === 'is') return v === 'null' ? row[k] == null : x === v;
    return v.replace(/^\(|\)$/g, '').split(',').map(s => s.replace(/^"|"$/g, '')).includes(x);
  });
}
function collection(c) {
  return { id: c.id, initiatedAt: c.at, completedAt: c.status === 'successful' ? new Date().toISOString() : null,
           amount: Number(c.amount).toFixed(2), fee: null, bearer: 'merchant', currency: 'ZMW', reference: c.reference,
           lencoReference: c.lref, type: c.type, status: c.status, source: 'api', reasonForFailure: c.reason || null,
           settlementStatus: null, settlement: null,
           mobileMoneyDetails: c.type === 'mobile-money' ? { country: 'zm', phone: c.phone, operator: c.operator, accountName: 'Chanda B', operatorTransactionId: null } : null,
           bankAccountDetails: null, cardDetails: c.type === 'card' ? { firstName: 'Chanda', lastName: 'B', bin: '555555', last4: '4444', cardType: 'Mastercard' } : null };
}
let base = '';
let FN = {};
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  const body = await read(req);
  const send = (code, o, type) => { res.writeHead(code, { 'Content-Type': type || 'application/json' }); res.end(o === undefined ? '' : (typeof o === 'string' ? o : JSON.stringify(o))); };
  const service = (req.headers.authorization || '') === 'Bearer service-key';

  if (p.startsWith('/.netlify/functions/pay-') || p === '/.netlify/functions/place-order') {
    const name = p.split('/').pop();
    const r = await FN[name]({ httpMethod: req.method, body, headers: req.headers,
                               queryStringParameters: Object.fromEntries(u.searchParams) });
    res.writeHead(r.statusCode, r.headers || {}); return res.end(r.body || '');
  }
  if (p === '/api/products') {
    const r = await FN.products({ queryStringParameters: {}, headers: {} });
    res.writeHead(r.statusCode, r.headers); return res.end(r.body);
  }
  if (p === '/pos/rest/v1/app_state') return send(200, [{ id: 100, state: { products: POS } }]);
  /* The stand-in card window says the card was paid, the way Lenco would
     record it: a successful card collection under our reference. */
  if (p === '/__lenco/card-paid') {
    const ref = u.searchParams.get('ref');
    LENCO.collections[ref] = { id: crypto.randomUUID(), at: new Date().toISOString(), amount: Number(u.searchParams.get('amount')),
                               reference: ref, lref: '24' + (++seq), type: 'card', status: 'successful' };
    return send(200, { ok: true });
  }
  if (p.startsWith('/lenco/')) {
    const auth = req.headers.authorization || '';
    if (auth !== 'Bearer ' + TOKEN && auth !== 'Bearer ' + TOKEN_LIVE) return send(401, { status: false, message: 'Invalid token', data: null, errorCode: '09' });
    if (p === '/lenco/collections/mobile-money') {
      const b = JSON.parse(body);
      LENCO.made.push(b);
      const c = { id: crypto.randomUUID(), at: new Date().toISOString(), amount: b.amount, reference: b.reference, lref: '24' + (++seq),
                  type: 'mobile-money', status: 'pay-offline', phone: b.phone, operator: b.operator };
      LENCO.collections[b.reference] = c;
      return send(200, { status: true, message: '', data: collection(c) });
    }
    const m = /^\/lenco\/collections\/status\/(.+)$/.exec(p);
    if (m) {
      const c = LENCO.collections[decodeURIComponent(m[1])];
      return c ? send(200, { status: true, message: '', data: collection(c) }) : send(404, { status: false, message: 'Payment details was not found', data: null });
    }
    return send(404, { status: false, message: 'Not found', data: null });
  }
  if (p === '/web/rest/v1/site_settings') {
    const key = (u.searchParams.get('key') || '').replace('eq.', '');
    return send(200, SETTINGS[key] ? [{ data: SETTINGS[key] }] : []);
  }
  if (p === '/web/rest/v1/site_settings_private') {
    if (!service) return send(401, {});
    if (req.method === 'POST') { const b = JSON.parse(body); PRIV[b.key] = b.data; return send(201); }
    const key = (u.searchParams.get('key') || '').replace('eq.', '');
    return send(200, PRIV[key] ? [{ data: PRIV[key] }] : []);
  }
  if (p === '/web/rest/v1/rpc/place_order') {
    if (!service) return send(401, { message: 'permission denied for function place_order' });
    const b = JSON.parse(body); const id = 'ord-' + (++seq); const ref = 'VB-LNC' + String(seq).padStart(2, '0').slice(-2);
    DB.orders.push(Object.assign({ id, ref, status: 'pending', created_at: new Date().toISOString() }, b.p_order));
    b.p_items.forEach(i => DB.order_items.push(Object.assign({ order_id: id }, i)));
    return send(200, { id, ref });
  }
  if (p === '/web/rest/v1/rpc/pay_expire_stale') return send(204);
  if (p === '/web/rest/v1/rpc/throttle') return send(204);
  if (p === '/web/rest/v1/rpc/preview_ok') return send(200, JSON.parse(body || '{}').p_key === 'shop-preview');
  const t = /^\/web\/rest\/v1\/(orders|order_items|payments|payment_webhooks)$/.exec(p);
  if (t && service) {
    const table = DB[t[1]], fs2 = filters(u.search.slice(1));
    const minimal = /return=minimal/.test(req.headers.prefer || '');
    if (req.method === 'GET') {
      const rows = table.filter(r => matches(r, fs2));
      return send(200, u.searchParams.get('limit') === '0' ? [] : rows);
    }
    if (req.method === 'POST') {
      const b = JSON.parse(body);
      if (t[1] === 'payments' && b.client_key && table.some(r => r.client_key === b.client_key)) {
        return send(409, { code: '23505', message: 'duplicate key value violates unique constraint "payments_client_key"' });
      }
      const row = Object.assign({ id: 'pay-' + (++seq), status: 'started', created_at: new Date().toISOString(), asked_at: null }, b);
      table.push(row);
      return minimal ? send(201) : send(201, [row]);
    }
    if (req.method === 'PATCH') { const patch = JSON.parse(body), hit = table.filter(r => matches(r, fs2)); hit.forEach(r => Object.assign(r, patch)); return minimal ? send(204) : send(200, hit); }
  }
  if (p.startsWith('/web/rest/v1/')) return send(200, []);
  if (p === '/config.js') return send(200, 'window.VBP_CONFIG={SUPABASE_URL:"' + base + '/web",SUPABASE_ANON_KEY:"anon-key"};', TYPES['.js']);
  let file = path.join(ROOT, p);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});

/* The stand-in for Lenco's card window: the same name and call as Lenco's
   inline.js (window.LencoPay.getPaid), an overlay instead of Lenco's frame.
   window.__lencoAct says what the "customer" does in it. */
const WIDGET = `
window.LencoPay = { getPaid: function (o) {
  window.__lenco = { key: o.key, reference: o.reference, email: o.email, amount: o.amount, currency: o.currency,
                     channels: o.channels, label: o.label, bearer: o.bearer, customer: o.customer };
  var d = document.createElement('div');
  d.id = 'lencoStandIn';
  d.setAttribute('style', 'position:fixed;inset:0;z-index:2147483647;background:rgba(11,31,58,.78);display:flex;align-items:center;justify-content:center;font-family:sans-serif');
  d.innerHTML = '<div style="background:#fff;border-radius:12px;padding:22px 20px;width:300px;box-shadow:0 20px 50px rgba(0,0,0,.35)">' +
    '<div style="font-size:12px;letter-spacing:.12em;color:#888;text-transform:uppercase">Lenco · secure payment window</div>' +
    '<div style="font-size:20px;font-weight:600;margin:8px 0 2px">' + (o.currency || '') + ' ' + Number(o.amount).toFixed(2) + '</div>' +
    '<div style="font-size:13px;color:#555;margin-bottom:14px">' + (o.label || '') + '</div>' +
    '<div style="border:1px solid #ddd;border-radius:8px;padding:10px;color:#999;font-size:13px;margin-bottom:8px">Card number</div>' +
    '<div style="display:flex;gap:8px"><div style="flex:1;border:1px solid #ddd;border-radius:8px;padding:10px;color:#999;font-size:13px">MM / YY</div>' +
    '<div style="flex:1;border:1px solid #ddd;border-radius:8px;padding:10px;color:#999;font-size:13px">CVV</div></div>' +
    '<div style="margin-top:14px;font-size:11px;line-height:1.5;color:#999">Test stand-in for the window that Lenco serves ' +
    'from pay.lenco.co. Card details typed in it go to Lenco, never to the website.</div></div>';
  document.body.appendChild(d);
  var act = window.__lencoAct || 'pay';
  setTimeout(function () {
    if (act === 'pay') {
      fetch('/__lenco/card-paid?ref=' + encodeURIComponent(o.reference) + '&amount=' + o.amount).then(function () {
        d.remove(); o.onSuccess && o.onSuccess({ reference: o.reference });
      });
    } else if (act === 'close') { d.remove(); o.onClose && o.onClose(); }
  }, window.__lencoWait || 600);
} };`;

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  Object.assign(process.env, {
    WEB_SUPABASE_URL: base + '/web', WEB_SUPABASE_ANON_KEY: 'anon-key',
    POS_SUPABASE_URL: base + '/pos', POS_SUPABASE_KEY: 'pos-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key', URL: base,
    LENCO_SECRET_KEY_TEST: TOKEN, LENCO_PUBLIC_KEY_TEST: 'pub-sandbox-browser', LENCO_API_BASE_TEST: base + '/lenco',
    LENCO_SECRET_KEY_LIVE: TOKEN_LIVE, LENCO_PUBLIC_KEY_LIVE: 'pub-live-browser', LENCO_API_BASE: base + '/lenco',
  });
  delete process.env.FLW_SECRET_KEY_TEST;
  delete process.env.FLW_SECRET_KEY_LIVE;
  const F = path.join(ROOT, 'netlify', 'functions');
  require(path.join(F, 'send-email'))._internals.sendMail = async () => {};
  /* The wait before a second request may be sent for the same order: ninety
     seconds on the site, eight here. */
  const L = require(path.join(F, '_lenco'));
  L.HOLD.ms = 8000;
  FN = {
    'pay-quote': require(path.join(F, 'pay-quote')).handler,
    'pay-start': require(path.join(F, 'pay-start')).handler,
    'pay-status': require(path.join(F, 'pay-status')).handler,
    'place-order': require(path.join(F, 'place-order')).handler,
    products: require(path.join(F, 'products')).handler,
  };
  const live = (on) => { SETTINGS.payments.onlineMode = on ? 'live' : 'test'; };
  const browser = await chromium.launch();
  const SCRIPTS_ASKED = [];
  async function open(opts) {
    const stranger = !!(opts && opts.stranger);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: SHOTS ? 2 : 1 });
    await ctx.route('https://pay.sandbox.lenco.co/**', r => { SCRIPTS_ASKED.push(r.request().url()); return r.fulfill({ status: 200, contentType: 'text/javascript', body: WIDGET }); });
    await ctx.route('https://pay.lenco.co/**', r => { SCRIPTS_ASKED.push(r.request().url()); return r.fulfill({ status: 200, contentType: 'text/javascript', body: WIDGET }); });
    await ctx.route('https://wa.me/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>WhatsApp</p>' }));
    await ctx.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    if (opts && opts.before) await opts.before(ctx);
    await ctx.addInitScript(() => {
      if (!sessionStorage.getItem('seeded')) {
        localStorage.setItem('vbp_cart', JSON.stringify([{ sku: 'BG-1', qty: 1 }]));
        sessionStorage.setItem('seeded', '1');
      }
      window.open = function () { return { closed: false, close: function () {}, location: {} }; };
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message || e)));
    await page.goto(base + (stranger ? '/' : '/?preview=shop-preview'), { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.card', { state: 'attached', timeout: 15000 }).catch(() => {});
    return { ctx, page, errors };
  }
  async function toQuote(page, phone) {
    await page.click('#cartBtn');
    await page.waitForSelector('#ctGo', { timeout: 15000 });
    await page.click('#ctGo');
    await page.waitForSelector('#odGo', { timeout: 15000 });
    await page.fill('#od_name', 'Chanda Banda');
    await page.fill('#od_phone', phone || '0977123456');
    if (await page.$('#od_email')) await page.fill('#od_email', 'chanda@example.com');
    if (await page.$('input[name="odHow"][value="collection"]')) await page.check('input[name="odHow"][value="collection"]');
    if (await page.$('#od_consent')) await page.check('#od_consent');
    await page.waitForSelector('#odPay', { timeout: 15000 });
    await page.click('#odPay');
    await page.waitForSelector('.pq-total', { timeout: 15000 });
    await page.waitForSelector('#pqWays .pm-opt', { timeout: 15000 }).catch(() => {});
  }
  /* Each scenario pays from a number of its own: the shop allows five payment
     attempts an hour to one number, so that nobody can flood a phone. */
  /* A picture waits for the borders' short transitions to finish first. */
  const shot = async (page, name) => {
    if (!SHOTS) return;
    await page.mouse.move(1, 1);          // no button caught mid-hover
    await page.waitForTimeout(450);
    await page.screenshot({ path: path.join(SHOTS, name + '.png') });
  };
  const waitText = (page, sel, re, ms) => page.waitForFunction(([s, r]) => new RegExp(r).test((document.querySelector(s) || {}).textContent || ''),
    [sel, re.source], { timeout: ms || 20000 }).catch(() => {});
  const cartCount = (page) => page.evaluate(() => (JSON.parse(localStorage.getItem('vbp_cart') || '[]') || []).length);
  /* What the payment screen says, as the customer sees it. */
  const screen = (page) => page.evaluate(() => {
    const t = (id) => ((document.getElementById(id) || {}).textContent || '').trim();
    const shown = (id) => { const e = document.getElementById(id); return !!e && !e.classList.contains('hide'); };
    return {
      cat: ((document.querySelector('#orderBody .c') || {}).textContent || '').trim(),
      head: t('pwHead'), lead: t('pwLead'), wait: shown('pwWait') ? t('pwWaitTxt') : '',
      help: shown('pwHelp') ? t('pwHelp') : '', msg: t('pwMsg'), note: t('pwNote'),
      btns: Array.from(document.querySelectorAll('#pwActs button')).map(b => b.textContent.trim()),
      off: Array.from(document.querySelectorAll('#pwActs button')).filter(b => b.disabled).map(b => b.id),
    };
  });
  const refOf = (tx) => String(tx || '').split('-').slice(0, 2).join('-');

  try {
    let ctx, page, errors, sc;
    console.log('\n1. Test mode: the shop\'s own, and marked TEST');
    live(false);
    ({ ctx, page } = await open({ stranger: true }));
    await page.click('#cartBtn');
    await page.waitForSelector('#ctGo', { timeout: 15000 });
    await page.click('#ctGo');
    await page.waitForSelector('#odGo', { timeout: 15000 });
    is(!(await page.$('#odPay')), 'a stranger, in Test mode: WhatsApp checkout only');
    await ctx.close();
    ({ ctx, page, errors } = await open());
    await toQuote(page, '0977000001');
    LENCO.made = [];
    await page.click('#pqPay');
    await waitText(page, '#pwHead', /Payment Authorisation Required/);
    sc = await screen(page);
    is(/Test mode/.test(sc.cat) && /sandbox test numbers and cards\. No money will be taken\./.test(sc.note) && LENCO.made.length === 1,
       'the shop, in Test mode: the payment screen says Test mode', J(sc));
    LENCO.collections[LENCO.made[0].reference].status = 'successful';
    await waitText(page, '#pwHead', /Payment Successful/);
    sc = await screen(page);
    is(sc.head === 'Test Payment Successful' && sc.lead === 'Your test payment has been successfully processed. No money was taken.' &&
       /marked TEST in the Orders tab/.test(sc.note), '"Test Payment Successful": no money taken, marked TEST', J(sc));
    is(errors.length === 0, 'no script error', errors.join(' | '));
    await ctx.close();
    live(true);

    console.log('\n2. After the total: how would you like to pay? (Live mode, as customers see it)');
    ({ ctx, page, errors } = await open());
    await toQuote(page);
    const ways = await page.evaluate(() => ({
      head: (document.querySelector('.pm-head') || {}).textContent || '',
      opts: Array.from(document.querySelectorAll('.pm-opt')).map(b => ({ way: b.getAttribute('data-way'),
        name: (b.querySelector('.pm-name') || {}).textContent || '', sub: (b.querySelector('.pm-sub') || {}).textContent || '',
        on: b.getAttribute('aria-checked') })),
      nets: Array.from(document.querySelectorAll('.pm-net')).map(b => ({ net: b.getAttribute('data-net'), text: b.textContent, on: b.getAttribute('aria-checked') })),
      number: (document.getElementById('pm_number') || {}).value || '',
      hint: (document.getElementById('pmHint') || {}).textContent || '',
      note: (document.getElementById('pqNote') || {}).textContent || '',
      askCard: document.querySelectorAll('#pqWays [data-issuer], #pqWays .pm-panel[data-for="card"] input').length,
      cardInputs: document.querySelectorAll('input[autocomplete^="cc-"], input[name*="card" i], input[id*="cvv" i]').length
    }));
    is(/How would you like to pay\?/.test(ways.head) && J(ways.opts.map(o => o.name)) === J(['Mobile Money', 'Debit / Credit Card']),
       'two ways of paying, by name: Mobile Money, Debit / Credit Card', J(ways.opts));
    is(!ways.opts.some(o => /bank/i.test(o.name)), 'no Instant Bank Transfer: no gateway here can take one, so it is not shown');
    is(!ways.opts.some(o => /lenco|flutterwave/i.test(o.name + o.sub)), 'no button names a gateway', J(ways.opts));
    is(ways.opts[0].on === 'true' && /Airtel Money · MTN MoMo/.test(ways.opts[0].sub), 'Mobile Money first and chosen, with its networks under it', J(ways.opts[0]));
    is(J(ways.nets.map(n => n.text)) === J(['Airtel Money', 'MTN MoMo']), 'the networks the shop ticked as activated, and only those', J(ways.nets));
    is(ways.number === '0977123456' && ways.nets[0].on === 'true', 'the number from the details, and the network it belongs to, chosen already', J([ways.number, ways.nets]));
    is(ways.hint === 'A payment approval request will be sent to this number. Please check and verify the phone number is correct before proceeding.',
       'under the number: "A payment approval request will be sent to this number..."', ways.hint);
    is(ways.note === 'Payments are processed securely by Lenco.', 'and "Payments are processed securely by Lenco."', ways.note);
    is(ways.cardInputs === 0 && ways.askCard === 0, 'not one card field on the page, and nothing asked about the card while one gateway takes cards');
    await shot(page, '1-how-would-you-like-to-pay');
    await page.click('.pm-opt[data-way="card"]');
    const cardSel = await page.evaluate(() => ({ note: document.getElementById('pqNote').textContent, all: document.getElementById('orderBody').textContent }));
    is(cardSel.note === 'Your card details are entered in a secure payment window and are never kept by this website.' && !/lenco/i.test(cardSel.all),
       'a card chosen: "Your card details are entered in a secure payment window...", and no gateway named yet', J(cardSel.note));
    await shot(page, '2-card-chosen');
    await page.click('.pm-opt[data-way="mobile"]');
    is((await page.textContent('#pqNote')) === 'Payments are processed securely by Lenco.', 'Mobile Money again: its line again');

    console.log('\n   A number for the wrong network is caught before any phone rings');
    await page.click('.pm-net[data-net="mtn"]');
    LENCO.made = [];
    await page.click('#pqPay');
    await waitText(page, '#pqMsg', /Airtel Money number/, 5000);
    is(/This is an Airtel Money number\. Please choose Airtel Money/.test(await page.textContent('#pqMsg')) && LENCO.made.length === 0,
       'MTN MoMo chosen with an Airtel number: said plainly, nothing sent', await page.textContent('#pqMsg'));
    await page.fill('#pm_number', '0961111111');
    is(await page.getAttribute('.pm-net[data-net="mtn"]', 'aria-checked') === 'true', 'typing an MTN number chooses MTN MoMo');
    await page.fill('#pm_number', '0977123456');

    console.log('\n3. Mobile money: authorisation, then paid');
    await page.click('#pqPay');
    await waitText(page, '#pwHead', /Payment Authorisation Required/);
    sc = await screen(page);
    is(sc.lead === 'A payment approval request has been sent to 09******56. Please check your phone and follow the instructions to ' +
       'authorise the transaction. Once approved, your payment will be processed and your order confirmation will follow.',
       'the owner\'s words, with the number in part (09******56)', sc.lead);
    is(sc.wait === 'Waiting for your approval…' && J(sc.btns) === J(['Check payment status', 'Choose another payment method', 'Cancel payment']) &&
       !sc.help && !/Test/.test(sc.cat), 'Waiting for your approval, with Check payment status, Choose another payment method, Cancel payment', J(sc));
    const sent = LENCO.made[0] || {};
    is(sent.operator === 'airtel' && sent.phone === '0977123456' && sent.amount === 500 && sent.bearer === 'merchant',
       'Lenco was asked for the order\'s total, on Airtel, to that number', J(sent));
    await shot(page, '3-payment-authorisation-required');
    await page.click('#pwCheck');
    await waitText(page, '#pwMsg', /not been authorised yet/, 8000);
    is(/^Your payment has not been authorised yet\. Please check your phone and follow the instructions\.$/.test(await page.textContent('#pwMsg')),
       'Check payment status: asked at once, and the answer said plainly', await page.textContent('#pwMsg'));
    await page.waitForFunction(() => { const h = document.getElementById('pwHelp'); return h && !h.classList.contains('hide'); }, null, { timeout: 20000 }).catch(() => {});
    sc = await screen(page);
    is(sc.help === 'Didn’t receive approval request? Please try again or use another payment method. Contact us' &&
       J(sc.btns) === J(['Try again', 'Check payment status', 'Choose another payment method', 'Cancel payment']),
       'once a new request can be sent: "Didn\'t receive approval request?", Try again, and a Contact us link', J(sc));
    await shot(page, '4-didnt-receive-approval-request');
    const orderRef = refOf(sent.reference);
    await page.evaluate(() => {
      window.__realChat = window.VBP_CHAT;
      window.VBP_CHAT = { state: () => 'on', enquire: (t) => { window.__chatAsked = t; return Promise.resolve(true); } };
    });
    await page.click('#pwContact');
    const chat = await page.evaluate(() => ({ asked: window.__chatAsked || '', lifted: document.documentElement.classList.contains('chat-over-pay'),
                                              still: !!document.getElementById('pwHead') }));
    is(chat.asked === 'Hello, I need help with the payment for my order ' + orderRef + '.' && chat.lifted && chat.still,
       'Contact us: the website chat, with the order number ready to send, above the payment, which stays', J(chat));
    await page.evaluate(() => { window.VBP_CHAT = { state: () => 'off', enquire: () => Promise.resolve(false) }; });
    const [pop] = await Promise.all([ctx.waitForEvent('page', { timeout: 8000 }).catch(() => null), page.click('#pwContact')]);
    if (pop) await pop.waitForLoadState().catch(() => {});
    const popUrl = pop ? pop.url() : '';
    is(/^https:\/\/wa\.me\/260970000000\?text=/.test(popUrl) && decodeURIComponent(popUrl).indexOf(orderRef) > -1 && !!(await page.$('#pwHead')),
       'with the chat switched off: WhatsApp, in a new tab; the payment screen stays', popUrl);
    if (pop) await pop.close();
    await page.evaluate(() => { window.VBP_CHAT = window.__realChat; document.documentElement.classList.remove('chat-over-pay'); });
    LENCO.collections[sent.reference].status = 'successful';
    await waitText(page, '#pwHead', /Payment Successful/);
    sc = await screen(page);
    is(sc.head === 'Payment Successful' && sc.lead === 'Your payment has been successfully processed. Thank you for shopping with Vaultique Boutique.' &&
       J(sc.btns) === J(['View order details', 'Continue shopping']),
       '"Payment Successful", in the owner\'s words, with View order details and Continue shopping', J(sc));
    is(new RegExp('^Order ' + orderRef + ' · K\\s?500').test(sc.note) && /A confirmation has been sent to your email\.$/.test(sc.note),
       'the order number and the amount under it', sc.note);
    is(await cartCount(page) === 0, 'and the cart is emptied');
    await shot(page, '5-payment-successful');
    await page.click('#pwView');
    await page.waitForSelector('#pwDetail:not(.hide)', { timeout: 5000 }).catch(() => {});
    const det = await page.evaluate(() => ({ head: document.getElementById('pwHead').textContent, text: (document.getElementById('pwDetail') || {}).textContent || '',
      btns: Array.from(document.querySelectorAll('#pwActs button')).map(b => b.textContent.trim()) }));
    is(det.head === 'Order Details' && det.text.indexOf(orderRef) > -1 && /Mobile Money \(Airtel Money\)/.test(det.text) &&
       /Leather Satchel × 1/.test(det.text) && /Total paidK\s?500/.test(det.text) && /chanda@example\.com/.test(det.text) && J(det.btns) === J(['Continue shopping']),
       'View order details, without an account: the order, the pieces, how it was paid, the total, where the confirmation went', J(det));
    await shot(page, '6-order-details');
    is(errors.length === 0, 'no script error', errors.join(' | '));
    await ctx.close();

    console.log('\n4. Payment Unsuccessful, then Try again on the same order');
    ({ ctx, page, errors } = await open());
    await toQuote(page, '0962222222');
    LENCO.made = [];
    await page.click('#pqPay');
    await waitText(page, '#pwHead', /Payment Authorisation Required/);
    const first = LENCO.made[0].reference;
    Object.assign(LENCO.collections[first], { status: 'failed', reason: 'Not enough funds' });
    await waitText(page, '#pwHead', /Payment Unsuccessful/);
    sc = await screen(page);
    is(sc.lead === 'We were unable to process your payment due to insufficient funds in your mobile money account. Please load your ' +
       'account to complete the transaction.', '"Payment Unsuccessful", in the owner\'s words', sc.lead);
    is(J(sc.btns) === J(['Try again', 'Choose another payment method', 'Complete your order via WhatsApp']),
       'Try again, Choose another payment method, Complete your order via WhatsApp', J(sc.btns));
    is(await cartCount(page) === 1, 'the cart is kept');
    await shot(page, '7-payment-unsuccessful');
    await page.click('#pwAgain');
    await waitText(page, '#pwHead', /Payment Authorisation Required/);
    const second = LENCO.made[1] && LENCO.made[1].reference;
    is(second && second !== first && second.indexOf(refOf(first) + '-') === 0 && DB.orders.filter(o => o.ref === refOf(first)).length === 1 &&
       DB.payments.filter(x => x.tx_ref.indexOf(refOf(first) + '-') === 0).length === 2,
       'Try again: a new request for the same order (one order, two payments)', J([first, second]));
    LENCO.collections[second].status = 'successful';
    await waitText(page, '#pwHead', /Payment Successful/);
    is(DB.orders.find(o => o.ref === refOf(first)).payment_status === 'paid', 'the second try approved: paid', await page.textContent('#pwHead'));
    is(errors.length === 0, 'no script error', errors.join(' | '));
    await ctx.close();

    console.log('\n5. Cancel payment');
    ({ ctx, page, errors } = await open());
    await toQuote(page, '0977000002');
    LENCO.made = [];
    await page.click('#pqPay');
    await waitText(page, '#pwHead', /Payment Authorisation Required/);
    const cref = LENCO.made[0].reference;
    await page.click('#pwCancel');
    await waitText(page, '#pwHead', /Payment Cancelled/);
    sc = await screen(page);
    is(sc.lead === 'Your payment has been cancelled and no money has been taken. If the approval request is still showing on your ' +
       'phone, please do not authorise it.', '"Payment Cancelled": no money taken, and do not authorise a request still on the phone', sc.lead);
    is(sc.off.indexOf('pwAgain') > -1 && sc.off.indexOf('pwOther') > -1 && sc.off.indexOf('pwWa') < 0 &&
       /^To prevent a double payment, a new payment can be started in \d+ seconds?\.$/.test(sc.msg),
       'Try again and another payment method wait a moment, so the order cannot be paid twice; WhatsApp does not', J(sc));
    const cp = DB.payments.find(x => x.tx_ref === cref);
    is(cp.status === 'failed' && cp.detail.reason === 'customer-cancelled' && LENCO.made.length === 1, 'the attempt is closed as cancelled; nothing new was sent', J(cp));
    await shot(page, '8-payment-cancelled');
    await page.waitForFunction(() => { const b = document.getElementById('pwAgain'); return b && !b.disabled; }, null, { timeout: 20000 }).catch(() => {});
    is((await page.textContent('#pwAgain')) === 'Try again' && (await page.textContent('#pwMsg')) === '', 'then Try again, once the wait is over');
    await page.click('#pwAgain');
    await waitText(page, '#pwHead', /Payment Authorisation Required/);
    is(LENCO.made.length === 2 && LENCO.made[1].reference.indexOf(refOf(cref) + '-') === 0, 'and a new request, for the same order', J(LENCO.made.map(m => m.reference)));
    is(errors.length === 0, 'no script error', errors.join(' | '));
    await ctx.close();

    console.log('\n6. Never two live requests for one order');
    L.HOLD.ms = 60000;
    ({ ctx, page, errors } = await open());
    await toQuote(page, '0977000003');
    LENCO.made = [];
    await page.click('#pqPay');
    await waitText(page, '#pwHead', /Payment Authorisation Required/);
    await page.click('#pwOther');
    await page.waitForSelector('#pqWays .pm-opt', { timeout: 15000 }).catch(() => {});
    await page.waitForFunction(() => { const b = document.getElementById('pqPay'); return b && !b.disabled; }, null, { timeout: 15000 }).catch(() => {});
    await page.click('.pm-opt[data-way="card"]');
    await page.click('#pqPay');
    await waitText(page, '#pqMsg', /still active/, 10000);
    const held = await page.evaluate(() => ({ msg: document.getElementById('pqMsg').textContent, off: document.getElementById('pqPay').disabled,
                                              label: document.getElementById('pqPay').textContent }));
    is(/^Your previous payment request is still active\. Please authorise it on your phone, or wait about \d+ seconds/.test(held.msg) &&
       held.off && /^Pay K\s?500$/.test(held.label) && LENCO.made.length === 1 && !(await page.$('#lencoStandIn')),
       'a card while the request is still on the phone: no window opened, nothing sent, and the customer told why', J(held));
    is(errors.length === 0, 'no script error', errors.join(' | '));
    await ctx.close();
    L.HOLD.ms = 8000;

    console.log('\n7. Cards: the secure window');
    SCRIPTS_ASKED.length = 0;
    ({ ctx, page, errors } = await open());
    await toQuote(page, '0977000004');
    await page.click('.pm-opt[data-way="card"]');
    await page.evaluate(() => { window.__lencoWait = 1500; });
    await page.click('#pqPay');
    await page.waitForSelector('#lencoStandIn', { timeout: 15000 }).catch(() => {});
    const behind = await page.evaluate(() => ({ note: document.getElementById('pqNote').textContent, lead: document.getElementById('pqLead').textContent }));
    is(behind.note === 'Payments are processed securely by Lenco.' && behind.lead === 'Please enter your card details in the secure payment window.',
       'the window open, where the card number goes: now "Payments are processed securely by Lenco."', J(behind));
    await shot(page, '9-card-window');
    const w = await page.evaluate(() => window.__lenco || null);
    is(w && w.key === 'pub-live-browser' && /^VB-LNC\d+-[a-f0-9]{10}$/.test(w.reference) && w.amount === 500 && w.currency === 'ZMW' &&
       J(w.channels) === J(['card']) && w.email === 'chanda@example.com',
       'Lenco\'s window, with the live public key, our reference, the server\'s total, cards only', J(w));
    is(SCRIPTS_ASKED.length >= 1 && SCRIPTS_ASKED.every(x => x === 'https://pay.lenco.co/js/v1/inline.js'),
       'its script from Lenco\'s own address, and nowhere else', J(SCRIPTS_ASKED));
    await waitText(page, '#pwHead', /Payment Successful/);
    is((await page.textContent('#pwHead')) === 'Payment Successful', 'paid in the window: confirmed by the server, then said', await page.textContent('#pwHead'));
    is(errors.length === 0, 'no script error', errors.join(' | '));
    await ctx.close();

    ({ ctx, page, errors } = await open());
    await toQuote(page, '0977000005');
    await page.click('.pm-opt[data-way="card"]');
    await page.evaluate(() => { window.__lencoAct = 'close'; });
    await page.click('#pqPay');
    await waitText(page, '#pwHead', /Payment Not Completed/);
    sc = await screen(page);
    is(sc.lead === 'The secure payment window was closed before the payment was completed. No money has been taken.' &&
       J(sc.btns) === J(['Try again', 'Choose another payment method', 'Complete your order via WhatsApp']),
       'closed without paying: "Payment Not Completed", nothing taken, the same three choices', J(sc));
    await shot(page, '10-payment-not-completed');
    await page.click('#pwOther');
    await page.waitForSelector('#pqWays .pm-opt', { timeout: 15000 }).catch(() => {});
    is(await page.$$eval('#pqWays .pm-opt', bs => bs.length) === 2, 'Choose another payment method: the choice again');
    is(errors.length === 0, 'no script error', errors.join(' | '));
    await ctx.close();

    console.log('\n   Ready for DPO: Zambian or international, the customer\'s answer (never a card detail)');
    /* Only a second card gateway makes the server ask (issuerChoice). There is
       none yet, so the answer the page gets is changed here to show it. */
    ({ ctx, page, errors } = await open({ before: (c) => c.route((u) => /pay-status\?check=1/.test(String(u)), async (r) => {
      const res = await r.fetch();
      const j = await res.json();
      (j.methods || []).forEach((m) => { if (m.key === 'card') m.issuerChoice = true; });
      return r.fulfill({ response: res, json: j });
    }) }));
    await toQuote(page, '0977000007');
    await page.click('.pm-opt[data-way="card"]');
    const iss = await page.evaluate(() => ({
      label: ((document.getElementById('pmIssLbl') || {}).textContent || ''),
      opts: Array.from(document.querySelectorAll('[data-issuer]')).map(b => b.textContent),
      inputs: document.querySelectorAll('#pqWays .pm-panel[data-for="card"] input').length,
      note: (document.getElementById('pqNote') || {}).textContent || '' }));
    is(iss.label === 'Where was your card issued?' && J(iss.opts) === J(['Card issued in Zambia', 'International card']) && iss.inputs === 0,
       'with a second card gateway: "Where was your card issued?", two buttons, and no box to type anything in', J(iss));
    await page.click('#pqPay');
    await waitText(page, '#pqMsg', /where your card was issued/, 5000);
    is((await page.textContent('#pqMsg')) === 'Please choose where your card was issued.' && !(await page.$('#lencoStandIn')),
       'Pay without an answer: asked for it, nothing opened');
    await page.click('[data-issuer="international"]');
    await shot(page, '12-later-card-issued-where');
    const before = DB.payments.length;
    await page.evaluate(() => { window.__lencoAct = 'close'; });
    await page.click('#pqPay');
    await waitText(page, '#pwHead', /Payment Not Completed/);
    const routed = (DB.payments.slice(before).find(x => x.method === 'card') || {}).detail || {};
    is(J(routed.card_route) === J({ choice: 'international', gateway: 'lenco', why: 'no international card gateway yet' }),
       'the answer is sent and kept with the payment; with no international gateway yet, the card still goes to Lenco', J(routed));
    is(errors.length === 0, 'no script error', errors.join(' | '));
    await ctx.close();

    console.log('\n8. The line drops');
    ({ ctx, page, errors } = await open());
    await toQuote(page, '0977000006');
    LENCO.made = [];
    const keys = [];
    let drop = true;
    await page.route('**/.netlify/functions/pay-start', async (route) => {
      const b = JSON.parse(route.request().postData() || '{}');
      keys.push(b.attempt);
      if (drop) { drop = false; await route.fetch().catch(() => {}); return route.abort('failed'); }
      return route.continue();
    });
    await page.click('#pqPay');
    await waitText(page, '#pqMsg', /unable to connect/, 15000);
    const lostMsg = await page.textContent('#pqMsg');
    is(lostMsg === 'We were unable to connect to the payment service. Please check your internet connection and try again.' && LENCO.made.length === 1,
       'the answer lost on the way back (the request had reached Lenco): said plainly', J([lostMsg, LENCO.made.length]));
    await shot(page, '11-connection-problem');
    await page.click('#pqPay');
    await waitText(page, '#pwHead', /Payment Authorisation Required/);
    is(keys.length === 2 && keys[0] === keys[1] && LENCO.made.length === 1,
       'pressed again: the same press of Pay, so the payment already made is shown and no second request is sent', J([keys, LENCO.made.length]));
    let fails = 0;
    const statusAsk = (u) => /pay-status\?tx_ref=/.test(String(u));
    await page.route(statusAsk, r => { fails++; return r.abort('failed'); });
    await waitText(page, '#pwMsg', /trouble connecting/, 25000);
    is((await page.textContent('#pwMsg')) === 'We are having trouble connecting to check your payment. Please check your internet connection. ' +
       'You can check the payment status again at any time.' && fails >= 3,
       'the line drops while waiting: said after a few tries, and the page keeps trying', J(fails));
    await page.unroute(statusAsk);
    LENCO.collections[LENCO.made[0].reference].status = 'successful';
    await waitText(page, '#pwHead', /Payment Successful/, 25000);
    is((await page.textContent('#pwHead')) === 'Payment Successful', 'back on line: the payment is found, and said', await page.textContent('#pwHead'));
    is(errors.length === 0, 'no script error', errors.join(' | '));
    await ctx.close();
  } catch (e) {
    fail('threw: ' + (e && e.stack || e));
  } finally {
    await browser.close();
    server.close();
  }
  console.log('\n' + (failures ? '  ✗ ' + failures + ' of ' + checks + ' checks FAILED'
                               : '  the unified checkout, with Lenco: all ' + checks + ' checks passed'));
  process.exit(failures ? 1 : 0);
})();
