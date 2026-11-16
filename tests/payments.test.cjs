/* ===========================================================================
   ONLINE PAYMENT: THE SERVER FUNCTIONS, DRIVEN FOR REAL

   pay-quote, pay-start, pay-webhook and pay-status, run as Netlify runs
   them, against a stand-in for all three things they talk to: the POS
   (prices and stock), this website's Supabase, and Flutterwave. Most of the
   checks are someone trying to pay less than the price, or to get an order
   marked paid without paying.
   =========================================================================== */
const http = require('http');
const path = require('path');
const crypto = require('crypto');

let checks = 0, failures = 0;
const ok = m => { checks++; console.log('  ✓ ' + m); };
const fail = (m, x) => { checks++; failures++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); };
const is = (c, m, x) => c ? ok(m) : fail(m, x);

/* ---------------- the world the functions live in ---------------- */
const POS = [
  { sku: 'BG-1', name: 'Leather Satchel', category: 'Bags', price: 500, stock: 3, active: true },
  { sku: 'SC-1', name: 'Silk Scarf', category: 'Accessories', price: 300, stock: 10, active: true },
  { sku: 'GONE', name: 'Sold Piece', category: 'Bags', price: 800, stock: 0, active: true },
  { sku: 'OVR', name: 'Overridden', category: 'Bags', price: 1000, stock: 5, active: true },
];
let SETTINGS, META, DB, FLW, MAIL, PRIV, FAIL_ORDER_PATCH = 0, HITS = 0;
function reset() {
  SETTINGS = {
    general: { businessName: 'Vaultique', currency: 'ZMW' },
    pricing: {},
    payments: { onlineEnabled: true, onlineMode: 'test', onlineCard: true, onlineMobile: true },
    delivery: { payDelivery: false, standardFee: '', freeOver: '' },
    contact: { email: 'shop@example.com' },
    notifications: { emailEnabled: true, smtpHost: 'smtp.example.com', senderEmail: 'shop@example.com' },
  };
  META = [];
  DB = { orders: [], order_items: [], payments: [] };
  FLW = { made: [], verify: {}, down: false };   // verify[tx_ref] = transaction as Flutterwave would report it
  MAIL = [];
  PRIV = { notifications: { smtpPassword: 'x' } };
}
reset();

const read = req => new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => r(d)); });
function filters(q) {
  const out = [];
  for (const [k, v] of new URLSearchParams(q)) {
    if (['select', 'order', 'limit'].includes(k)) continue;
    const m = /^(eq|neq|in|gt|lt|is)\.(.*)$/.exec(v);
    if (m) out.push([k, m[1], m[2]]);
  }
  return out;
}
function matches(row, fs) {
  return fs.every(([k, op, v]) => {
    const x = row[k] == null ? '' : String(row[k]);
    if (op === 'eq') return x === v;
    if (op === 'neq') return x !== v;
    if (op === 'gt') return x > v;
    if (op === 'lt') return x < v;
    if (op === 'is') return v === 'null' ? row[k] == null : x === v;
    if (op === 'in') return v.replace(/^\(|\)$/g, '').split(',').map(s => s.replace(/^"|"$/g, '')).includes(x);
  });
}
let seq = 0;
const server = http.createServer(async (req, res) => {
  HITS++;
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  const body = await read(req);
  const send = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(o === undefined ? '' : JSON.stringify(o)); };
  const service = (req.headers.authorization || '') === 'Bearer service-key';

  // the POS
  if (p === '/pos/rest/v1/app_state') return send(200, [{ id: 100, state: { products: POS } }]);

  // Flutterwave
  if (p.startsWith('/flw/') && FLW.down) return req.socket.destroy();
  if (p.startsWith('/flw/')) {
    if ((req.headers.authorization || '') !== 'Bearer FLWSECK_TEST-secret') return send(401, { status: 'error' });
    if (p === '/flw/payments' && req.method === 'POST') {
      const b = JSON.parse(body);
      FLW.made.push(b);
      return send(200, { status: 'success', data: { link: 'https://checkout.flutterwave.test/pay/' + b.tx_ref } });
    }
    let m = /^\/flw\/transactions\/(\d+)\/verify$/.exec(p);
    if (m) {
      const t = Object.values(FLW.verify).find(v => String(v.id) === m[1]);
      return t ? send(200, { status: 'success', data: t }) : send(404, { status: 'error' });
    }
    if (p === '/flw/transactions/verify_by_reference') {
      const t = FLW.verify[u.searchParams.get('tx_ref')];
      return t ? send(200, { status: 'success', data: t }) : send(404, { status: 'error' });
    }
    return send(404, {});
  }

  // this website's Supabase
  if (p === '/web/rest/v1/site_settings') {
    const key = u.searchParams.get('key').replace('eq.', '');
    return send(200, SETTINGS[key] ? [{ data: SETTINGS[key] }] : []);
  }
  if (p === '/web/rest/v1/site_settings_private') {
    if (!service) return send(401, {});
    if (req.method === 'POST') { const b = JSON.parse(body); PRIV[b.key] = b.data; return send(201); }
    const key = (u.searchParams.get('key') || '').replace('eq.', '');
    return send(200, PRIV[key] ? [{ data: PRIV[key] }] : []);
  }
  if (p === '/web/rest/v1/rpc/is_admin') return send(200, (req.headers.authorization || '') === 'Bearer admin-jwt');
  if (p === '/web/rest/v1/product_meta') return send(200, META);
  if (p === '/web/rest/v1/rpc/place_order') {
    const b = JSON.parse(body);
    const id = 'ord-' + (++seq);
    const ref = 'VB-' + String(seq).padStart(5, 'A').slice(-5).replace(/[^A-Z0-9]/g, 'A');
    DB.orders.push(Object.assign({ id, ref, status: 'pending', created_at: new Date().toISOString() }, b.p_order,
      { auth: req.headers.authorization }));
    b.p_items.forEach(i => DB.order_items.push(Object.assign({ order_id: id }, i)));
    return send(200, { id, ref });
  }
  if (p === '/web/rest/v1/rpc/pay_expire_stale') return service ? send(204) : send(401, {});
  const t = /^\/web\/rest\/v1\/(orders|order_items|payments)$/.exec(p);
  if (t) {
    if (!service) return send(401, {});
    const table = DB[t[1]], fs = filters(u.search.slice(1));
    const minimal = /return=minimal/.test(req.headers.prefer || '');
    if (req.method === 'GET') return send(200, table.filter(r => matches(r, fs)));
    if (req.method === 'POST') {
      const row = Object.assign({ id: 'pay-' + (++seq), status: 'started', created_at: new Date().toISOString() }, JSON.parse(body));
      table.push(row);
      return send(201, [row]);
    }
    if (req.method === 'PATCH' && t[1] === 'orders' && FAIL_ORDER_PATCH > 0) { FAIL_ORDER_PATCH--; return send(500, { message: 'the database is having a moment' }); }
    if (req.method === 'PATCH') {
      const patch = JSON.parse(body), hit = table.filter(r => matches(r, fs));
      hit.forEach(r => Object.assign(r, patch));
      return minimal ? send(204) : send(200, hit);
    }
  }
  send(404, { path: p });
});

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  Object.assign(process.env, {
    WEB_SUPABASE_URL: base + '/web', WEB_SUPABASE_ANON_KEY: 'anon-key',
    POS_SUPABASE_URL: base + '/pos', POS_SUPABASE_KEY: 'pos-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    FLW_SECRET_KEY_TEST: 'FLWSECK_TEST-secret', FLW_WEBHOOK_HASH: 'my-secret-hash',
    FLW_API_BASE: base + '/flw', URL: 'https://vaultiqueboutique.com',
  });
  const F = path.join(__dirname, '..', 'netlify', 'functions');
  require(path.join(F, 'send-email'))._internals.sendMail = async (m) => { MAIL.push(m); };
  const quote = require(path.join(F, 'pay-quote')).handler;
  const start = require(path.join(F, 'pay-start')).handler;
  const hook = require(path.join(F, 'pay-webhook')).handler;
  const status = require(path.join(F, 'pay-status')).handler;
  const reconcile = () => require(path.join(F, 'pay-reconcile'))._internals.run();
  const post = (fn, b, headers) => fn({ httpMethod: 'POST', body: JSON.stringify(b), headers: headers || {} })
    .then(r => ({ code: r.statusCode, body: r.body ? JSON.parse(r.body) : null }));
  const get = (fn, q, headers) => fn({ httpMethod: 'GET', queryStringParameters: q, headers: headers || {} })
    .then(r => ({ code: r.statusCode, body: r.body ? JSON.parse(r.body) : null }));
  const BUYER = { name: 'Chanda', phone: '0977 123456', email: 'chanda@example.com', address: 'Plot 5, Lusaka' };
  const ITEMS = [{ sku: 'BG-1', qty: 2 }, { sku: 'SC-1', qty: 1 }];

  try {
    console.log('\nThe switch');
    SETTINGS.payments.onlineEnabled = false;
    let r = await post(quote, { items: ITEMS, fulfilment: 'collection' });
    is(r.code === 403 && r.body.off, 'switched off, the server refuses to price or take a payment', JSON.stringify(r));
    r = await post(start, { items: ITEMS, buyer: BUYER, fulfilment: 'collection' });
    is(r.code === 403 && FLW.made.length === 0, 'even if somebody calls it directly');
    SETTINGS.payments.onlineEnabled = true;

    console.log('\nThe price is the server\'s');
    r = await post(quote, { items: ITEMS, fulfilment: 'collection', total: 1 });
    is(r.code === 200 && r.body.total === 1300 && r.body.lines.length === 2,
       'two satchels and a scarf come to K1,300, whatever the browser says', JSON.stringify(r.body));
    is(r.body.totalText === 'K1,300', 'written the way the shop writes money', r.body.totalText);
    SETTINGS.pricing = { taxMode: 'excluded', taxRate: 16 };
    r = await post(quote, { items: ITEMS, fulfilment: 'collection' });
    is(r.body.tax === 208 && r.body.total === 1508, 'VAT is added when the shop says prices exclude it', JSON.stringify(r.body));
    SETTINGS.pricing = { overridesEnabled: true };
    META = [{ sku: 'OVR', price_override: 750 }];
    r = await post(quote, { items: [{ sku: 'OVR', qty: 1 }], fulfilment: 'collection' });
    is(r.body.total === 750, 'a website price override is charged, as it is shown', JSON.stringify(r.body));
    SETTINGS.pricing = { promoEnabled: true, promoType: 'percent', promoAmount: 10 };
    META = [];
    r = await post(quote, { items: [{ sku: 'SC-1', qty: 1 }], fulfilment: 'collection' });
    is(r.body.total === 270, 'and so is a shop-wide promotion', JSON.stringify(r.body));
    SETTINGS.pricing = {};

    console.log('\nWhat cannot be sold is not charged for');
    r = await post(quote, { items: [{ sku: 'GONE', qty: 1 }], fulfilment: 'collection' });
    is(r.code === 409 && /sold out/.test(r.body.problems[0]), 'a sold-out piece', JSON.stringify(r.body));
    r = await post(quote, { items: [{ sku: 'BG-1', qty: 4 }], fulfilment: 'collection' });
    is(r.code === 409 && /Only 3/.test(r.body.problems[0]), 'more than the shop has', JSON.stringify(r.body));
    r = await post(quote, { items: [{ sku: 'NOPE', qty: 1 }], fulfilment: 'collection' });
    is(r.code === 409, 'a piece that does not exist');
    META = [{ sku: 'SC-1', hidden: true }];
    r = await post(quote, { items: [{ sku: 'SC-1', qty: 1 }], fulfilment: 'collection' });
    is(r.code === 409, 'a piece hidden in the admin');
    META = [{ sku: 'SC-1', on_request: true }];
    r = await post(quote, { items: [{ sku: 'SC-1', qty: 1 }], fulfilment: 'collection' });
    is(r.code === 409 && /on request/.test(r.body.problems[0]), 'a piece priced on request');
    META = [];
    r = await post(quote, { items: [{ sku: 'SC-1', qty: -2 }], fulfilment: 'collection' });
    is(r.code === 409, 'a negative quantity');

    console.log('\nDelivery');
    r = await post(quote, { items: ITEMS, fulfilment: 'delivery' });
    is(r.body.delivery === 0 && /separately/.test(r.body.deliveryNote),
       'with delivery payment off, it is left out and the customer is told it is separate', JSON.stringify(r.body));
    SETTINGS.delivery = { payDelivery: true, standardFee: 80, freeOver: '' };
    r = await post(quote, { items: ITEMS, fulfilment: 'delivery' });
    is(r.body.delivery === 80 && r.body.total === 1380, 'switched on, the fee is added to the total before paying', JSON.stringify(r.body));
    r = await post(quote, { items: ITEMS, fulfilment: 'collection' });
    is(r.body.delivery === 0 && r.body.total === 1300, 'and never to an order being collected');
    SETTINGS.delivery = { payDelivery: true, standardFee: 80, freeOver: 1000 };
    r = await post(quote, { items: ITEMS, fulfilment: 'delivery' });
    is(r.body.delivery === 0 && r.body.deliveryText === 'Free', '"free delivery over" is honoured');
    SETTINGS.delivery = { payDelivery: true, standardFee: '' };
    r = await post(quote, { items: ITEMS, fulfilment: 'delivery' });
    is(r.code === 409, 'with no fee set, delivery orders are not taken online rather than charged nothing');
    SETTINGS.delivery = { payDelivery: true, standardFee: 80 };

    console.log('\nStarting a payment');
    r = await post(start, { items: ITEMS, buyer: Object.assign({}, BUYER, { email: '' }), fulfilment: 'delivery' });
    is(r.code === 400 && r.body.field === 'email', 'an email address is needed, for the receipt');
    r = await post(start, { items: ITEMS, buyer: Object.assign({}, BUYER, { address: '' }), fulfilment: 'delivery' });
    is(r.code === 400 && r.body.field === 'address', 'and an address, for a delivery');
    r = await post(start, { items: ITEMS, buyer: BUYER, fulfilment: 'delivery', total: 1, amount: 1 },
                   { authorization: 'Bearer customer-jwt' });
    const made = FLW.made[0];
    is(r.code === 200 && /checkout\.flutterwave\.test/.test(r.body.link), 'the customer is sent to Flutterwave\'s own page', JSON.stringify(r.body));
    is(made && made.amount === 1380 && made.currency === 'ZMW', 'Flutterwave is asked for K1,380, not what the browser sent', JSON.stringify(made));
    is(made && made.payment_options === 'card, mobilemoneyzambia', 'card and mobile money are offered');
    is(made && made.redirect_url === 'https://vaultiqueboutique.com/payment-return', 'and the customer comes back to this site');
    const order = DB.orders[0];
    is(order && order.total === 1380 && order.auth === 'Bearer customer-jwt',
       'the order is recorded through place_order, in the customer\'s own account');
    is(order && order.payment_status === 'awaiting' && order.delivery_fee === 80 && order.goods_total === 1300,
       'marked awaiting payment, with the goods and delivery kept apart');
    is(DB.order_items.length === 2 && DB.order_items[0].price === 500, 'with its lines at the server\'s prices');
    const pay = DB.payments[0];
    is(pay && pay.amount === 1380 && pay.tx_ref === made.tx_ref && pay.phone === '0977123456', 'and a payment row to check the answer against');

    console.log('\nSomebody pretending it was paid');
    const txRef = made.tx_ref;
    r = await hook({ httpMethod: 'POST', headers: { 'verif-hash': 'guess' },
                     body: JSON.stringify({ event: 'charge.completed', data: { id: 1, tx_ref: txRef, status: 'successful', amount: 1380, currency: 'ZMW' } }) });
    is(r.statusCode === 401 && DB.orders[0].payment_status === 'awaiting', 'a webhook without the secret hash is ignored');
    r = await hook({ httpMethod: 'POST', headers: { 'verif-hash': 'my-secret-hash' },
                     body: JSON.stringify({ data: { id: 1, tx_ref: txRef, status: 'successful', amount: 1380, currency: 'ZMW' } }) });
    is(DB.orders[0].payment_status === 'awaiting', 'one with the hash is still not believed: Flutterwave has no such payment');
    FLW.verify[txRef] = { id: 555, tx_ref: txRef, status: 'successful', amount: 1, currency: 'ZMW', payment_type: 'card' };
    r = await get(status, { tx_ref: txRef, transaction_id: '555' });
    // BUILD 77 · restated: a payment that does not match its order now
    // "needs attention" (review) instead of waiting as "pending": the shop is
    // told once and the order stays open (supabase-payments.sql's tidy-up no
    // longer cancels it). The point of these three checks stands: never paid.
    is(r.body.status === 'review' && DB.orders[0].payment_status === 'review',
       'K1 paid against a K1,380 order is not "paid"', JSON.stringify(r.body));
    FLW.verify[txRef] = { id: 555, tx_ref: txRef, status: 'successful', amount: 1380, currency: 'USD', payment_type: 'card' };
    r = await get(status, { tx_ref: txRef, transaction_id: '555' });
    is(r.body.status === 'review' && DB.orders[0].payment_status !== 'paid', 'nor is the right number in the wrong currency');
    FLW.verify['other'] = { id: 777, tx_ref: 'VB-OTHER-0000000000', status: 'successful', amount: 5000, currency: 'ZMW' };
    r = await get(status, { tx_ref: txRef, transaction_id: '777' });
    is(r.body.status === 'review' && DB.orders[0].payment_status !== 'paid', 'nor somebody else\'s payment, however large');
    r = await get(status, { tx_ref: 'anything' });
    is(r.code === 400, 'a made-up reference is refused');

    console.log('\nReally paid');
    FLW.verify[txRef] = { id: 555, tx_ref: txRef, status: 'successful', amount: 1380, currency: 'ZMW', payment_type: 'mobilemoneyzambia' };
    delete FLW.verify.other;
    MAIL = [];
    r = await hook({ httpMethod: 'POST', headers: { 'verif-hash': 'my-secret-hash' },
                     body: JSON.stringify({ event: 'charge.completed', data: { id: 555, tx_ref: txRef } }) });
    is(r.statusCode === 200 && DB.orders[0].payment_status === 'paid' && DB.orders[0].paid_amount === 1380,
       'confirmed with Flutterwave, the order is marked paid');
    is(DB.orders[0].pay_channel === 'mobilemoneyzambia' && DB.payments[0].status === 'paid', 'with how it was paid');
    is(MAIL.length === 2 && MAIL[0].to === 'chanda@example.com' && /Payment received/.test(MAIL[0].subject),
       'the customer is emailed a confirmation automatically', JSON.stringify(MAIL.map(m => m.to)));
    is(MAIL[1] && MAIL[1].to === 'shop@example.com' && /K1,380/.test(MAIL[1].subject), 'and the shop is told');
    is(/Delivery: K80/.test(MAIL[0].text) && /Paid: K1,380 \(mobile money\)/.test(MAIL[0].text), 'the email shows the delivery and what was paid', MAIL[0].text);
    r = await hook({ httpMethod: 'POST', headers: { 'verif-hash': 'my-secret-hash' },
                     body: JSON.stringify({ data: { id: 555, tx_ref: txRef } }) });
    r = await get(status, { tx_ref: txRef, transaction_id: '555' });
    is(MAIL.length === 2, 'a repeated webhook, and the customer coming back, send nothing twice');
    is(r.body.status === 'paid' && r.body.ref === DB.orders[0].ref && r.body.amountText === 'K1,380',
       'the page they come back to is told: paid', JSON.stringify(r.body));
    is(!JSON.stringify(r.body).includes('chanda'), 'and nothing personal is in that answer');

    console.log('\nNot paid');
    r = await post(start, { items: [{ sku: 'SC-1', qty: 1 }], buyer: BUYER, fulfilment: 'collection' });
    const tx2 = FLW.made[1].tx_ref;
    FLW.verify[tx2] = { id: 600, tx_ref: tx2, status: 'cancelled', amount: 300, currency: 'ZMW' };
    r = await get(status, { tx_ref: tx2, transaction_id: '600' });
    const o2 = DB.orders.find(o => o.pay_ref === tx2);
    is(r.body.status === 'failed' && o2.status === 'cancelled' && o2.payment_status === 'failed',
       'a cancelled payment cancels its order, so it does not count as a sale');
    FLW.verify[tx2] = { id: 600, tx_ref: tx2, status: 'successful', amount: 300, currency: 'ZMW', payment_type: 'card' };
    r = await get(status, { tx_ref: tx2, transaction_id: '600' });
    is(r.body.status === 'paid' && o2.status === 'pending' && o2.payment_status === 'paid',
       'but money that arrives after all brings the order back', JSON.stringify(o2));

    console.log('\nLimits and readiness');
    for (let i = 0; i < 4; i++) await post(start, { items: [{ sku: 'SC-1', qty: 1 }], buyer: BUYER, fulfilment: 'collection' });
    r = await post(start, { items: [{ sku: 'SC-1', qty: 1 }], buyer: BUYER, fulfilment: 'collection' });
    is(r.code === 429, 'the sixth attempt in an hour from one phone is refused', JSON.stringify(r));
    const key = process.env.FLW_SECRET_KEY_TEST;
    delete process.env.FLW_SECRET_KEY_TEST;
    r = await post(start, { items: [{ sku: 'SC-1', qty: 1 }], buyer: Object.assign({}, BUYER, { phone: '0966000000' }), fulfilment: 'collection' });
    is(r.code === 503 && /WhatsApp/.test(r.body.error), 'with no key installed, customers are pointed to WhatsApp instead');
    r = await get(status, { check: '1' });
    is(r.body.test === false && r.body.hash === true && r.body.service === true && r.body.formats === true,
       'the admin can see which keys are installed', JSON.stringify(r.body));
    process.env.FLW_SECRET_KEY_TEST = key;
    r = await get(status, { check: '1' });
    is(!JSON.stringify(r.body).includes('FLWSECK') && !JSON.stringify(r.body).includes('my-secret-hash'),
       'but never the keys themselves');

    /* ================================================================
       Build 74: what has to hold once real money moves.
       ================================================================ */
    const B = (phone) => Object.assign({}, BUYER, { phone });
    const lastTx = () => FLW.made[FLW.made.length - 1].tx_ref;
    const orderOf = (tx) => DB.orders.find(o => o.pay_ref === tx);
    const payOf = (tx) => DB.payments.find(p => p.tx_ref === tx);
    const mailsFor = (o) => MAIL.filter(m => o && m.subject.indexOf(o.ref) > -1);

    console.log('\nSomebody else\'s failed transaction, put on the address');
    r = await post(start, { items: [{ sku: 'SC-1', qty: 1 }], buyer: B('0960000001'), fulfilment: 'collection' });
    const tx3 = lastTx();
    FLW.verify['someone'] = { id: 801, tx_ref: 'VB-ZZZZZ-0000000000', status: 'failed', amount: 300, currency: 'ZMW' };
    r = await get(status, { tx_ref: tx3, transaction_id: '801' });
    is(r.body.status === 'pending' && orderOf(tx3).payment_status === 'awaiting' && orderOf(tx3).status === 'pending' &&
       payOf(tx3).status === 'started',
       'cancels nothing: a transaction that does not name this payment says nothing about it', JSON.stringify(r.body));
    delete FLW.verify.someone;

    console.log('\nThe price moving between the quote and Pay');
    const had = { orders: DB.orders.length, made: FLW.made.length };
    r = await post(start, { items: [{ sku: 'SC-1', qty: 1 }], buyer: B('0960000002'), fulfilment: 'collection', expect: 250 });
    is(r.code === 409 && r.body.changed && /now K300/.test(r.body.problems[0]) &&
       DB.orders.length === had.orders && FLW.made.length === had.made,
       'quoted K250, now K300: refused with the new total, before any order is made or Flutterwave asked', JSON.stringify(r.body));
    r = await post(start, { items: [{ sku: 'SC-1', qty: 1 }], buyer: B('0960000002'), fulfilment: 'collection', expect: 300 });
    is(r.code === 200 && FLW.made[FLW.made.length - 1].amount === 300, 'the quote at the right price goes ahead');
    r = await post(start, { items: [{ sku: 'SC-1', qty: 1 }], buyer: B('0960000002'), fulfilment: 'collection' });
    is(r.code === 200, 'and a page from before this check, sending no figure, is not refused for it');

    console.log('\nStopping part-way');
    FLW.down = true;
    r = await post(start, { items: [{ sku: 'SC-1', qty: 1 }], buyer: B('0960000003'), fulfilment: 'collection' });
    FLW.down = false;
    const o4 = DB.orders[DB.orders.length - 1], p4 = DB.payments.find(p => p.order_id === o4.id);
    is(r.code === 502 && /Nothing has been charged/.test(r.body.error),
       'Flutterwave unreachable: the customer is told nothing was charged', JSON.stringify(r.body));
    is(o4.status === 'cancelled' && o4.payment_status === 'failed' && p4 && p4.status === 'failed',
       'and the order made a moment before is cancelled at once, not left "awaiting payment"', JSON.stringify({ o4, p4 }));
    FAIL_ORDER_PATCH = 1;
    r = await post(start, { items: [{ sku: 'SC-1', qty: 1 }], buyer: B('0960000012'), fulfilment: 'collection' });
    const o12 = DB.orders[DB.orders.length - 1], p12 = DB.payments.find(p => p.order_id === o12.id);
    is(r.code === 502 && FLW.made.filter(m => m.tx_ref === (p12 && p12.tx_ref)).length === 0 &&
       o12.status === 'cancelled' && p12 && p12.status === 'failed',
       'the database failing as the order is made ready: nobody is sent to pay, and the order and its payment are both closed',
       JSON.stringify({ code: r.code, o12: o12.status, p12: p12 && p12.status }));

    console.log('\nPaid, but the order missed the news');
    r = await post(start, { items: [{ sku: 'SC-1', qty: 1 }], buyer: B('0960000004'), fulfilment: 'collection' });
    const tx5 = lastTx();
    FLW.verify[tx5] = { id: 905, tx_ref: tx5, status: 'successful', amount: 300, currency: 'ZMW', payment_type: 'card' };
    MAIL = [];
    FAIL_ORDER_PATCH = 1;
    r = await get(status, { tx_ref: tx5, transaction_id: '905' });
    is(payOf(tx5).status === 'paid' && orderOf(tx5).payment_status === 'awaiting' && MAIL.length === 0,
       '(the database fails between the payment and its order)', JSON.stringify({ pay: payOf(tx5).status, order: orderOf(tx5).payment_status }));
    r = await get(status, { tx_ref: tx5, transaction_id: '905' });
    is(r.body.status === 'paid' && orderOf(tx5).payment_status === 'paid' && orderOf(tx5).paid_amount === 300,
       'the next time anybody asks, the order is brought up to date', JSON.stringify(orderOf(tx5)));
    is(mailsFor(orderOf(tx5)).length === 2, 'and the confirmation emails, held back with it, go then', JSON.stringify(MAIL.map(m => m.subject)));
    r = await get(status, { tx_ref: tx5, transaction_id: '905' });
    is(mailsFor(orderOf(tx5)).length === 2, 'once');

    console.log('\nThe webhook, signed the newer way');
    r = await post(start, { items: [{ sku: 'SC-1', qty: 1 }], buyer: B('0960000005'), fulfilment: 'collection' });
    const tx6 = lastTx();
    FLW.verify[tx6] = { id: 906, tx_ref: tx6, status: 'successful', amount: 300, currency: 'ZMW', payment_type: 'card' };
    const raw6 = JSON.stringify({ event: 'charge.completed', data: { id: 906, tx_ref: tx6 } });
    r = await hook({ httpMethod: 'POST', headers: { 'flutterwave-signature': 'not-it' }, body: raw6 });
    is(r.statusCode === 401 && orderOf(tx6).payment_status === 'awaiting', 'a signature that is not made with the secret hash is ignored');
    const sig = crypto.createHmac('sha256', 'my-secret-hash').update(raw6).digest('base64');
    r = await hook({ httpMethod: 'POST', headers: { 'flutterwave-signature': sig }, body: raw6 });
    is(r.statusCode === 200 && orderOf(tx6).payment_status === 'paid',
       'one signed with it (flutterwave-signature, HMAC-SHA256) is accepted, and still checked with Flutterwave');
    r = await post(start, { items: [{ sku: 'SC-1', qty: 1 }], buyer: B('0960000006'), fulfilment: 'collection' });
    const tx6b = lastTx();
    FLW.verify[tx6b] = { id: 916, tx_ref: tx6b, status: 'successful', amount: 300, currency: 'ZMW', payment_type: 'card' };
    const raw6b = JSON.stringify({ data: { id: 916, tx_ref: tx6b } });
    r = await hook({ httpMethod: 'POST', headers: { 'Verif-Hash': 'my-secret-hash' }, body: Buffer.from(raw6b).toString('base64'), isBase64Encoded: true });
    is(r.statusCode === 200 && orderOf(tx6b).payment_status === 'paid',
       'the classic verif-hash still works, whatever the header\'s letter case, and a base64-wrapped body too');

    console.log('\nThe readiness line');
    const asAdmin = { authorization: 'Bearer admin-jwt' };
    r = await get(status, { check: '1' }, asAdmin);
    is(r.body.testKeyLooksRight === true && r.body.liveKeyLooksRight === false && !!r.body.lastWebhookAt && !!r.body.lastRefusedAt,
       'says the test key is a secret key, and when the webhook last came and when one was refused', JSON.stringify(r.body));
    const anyone = await get(status, { check: '1' });
    const customer = await get(status, { check: '1' }, { authorization: 'Bearer customer-jwt' });
    is(anyone.body.test === true && !('lastWebhookAt' in anyone.body) && !('testKeyLooksRight' in anyone.body) &&
       !('lastWebhookAt' in customer.body) && !('testKeyLooksRight' in customer.body),
       'asked by anybody else, even a signed-in customer: which keys are installed, and nothing more',
       JSON.stringify([anyone.body, customer.body]));
    const realKey = process.env.FLW_SECRET_KEY_TEST;
    process.env.FLW_SECRET_KEY_TEST = 'FLWPUBK_TEST-abc123-X';
    r = await get(status, { check: '1' }, asAdmin);
    is(r.body.test === true && r.body.testKeyLooksRight === false, 'the public key pasted in by mistake is spotted');
    const statusPost = (b, headers) => status({ httpMethod: 'POST', queryStringParameters: { check: '1' }, body: JSON.stringify(b), headers: headers || {} })
      .then(x => ({ code: x.statusCode, body: x.body ? JSON.parse(x.body) : null }));
    r = await statusPost({ action: 'test-keys' }, { authorization: 'Bearer admin-jwt' });
    is(r.code === 200 && r.body.test === 'refused' && r.body.live === 'missing',
       'and "Check the keys" hears Flutterwave refuse it', JSON.stringify(r.body));
    process.env.FLW_SECRET_KEY_TEST = realKey;
    r = await statusPost({ action: 'test-keys' }, { authorization: 'Bearer admin-jwt' });
    is(r.code === 200 && r.body.test === 'accepted', 'the real secret key is accepted', JSON.stringify(r.body));
    r = await statusPost({ action: 'test-keys' }, { authorization: 'Bearer customer-jwt' });
    const r2 = await statusPost({ action: 'test-keys' }, {});
    is(r.code === 403 && r2.code === 403, 'and only an administrator can ask', JSON.stringify([r, r2]));
    is(!JSON.stringify(r.body).includes('FLWSECK'), 'never showing a key');

    console.log('\nThe fifteen-minute check-up');
    const minutesAgo = (n) => new Date(Date.now() - n * 60000).toISOString();
    r = await post(start, { items: [{ sku: 'SC-1', qty: 1 }], buyer: B('0960000007'), fulfilment: 'collection' });
    const tx7 = lastTx();
    payOf(tx7).created_at = minutesAgo(10);
    FLW.verify[tx7] = { id: 907, tx_ref: tx7, status: 'successful', amount: 300, currency: 'ZMW', payment_type: 'mobilemoneyzambia' };
    r = await post(start, { items: [{ sku: 'SC-1', qty: 1 }], buyer: B('0960000008'), fulfilment: 'collection' });
    const tx8 = lastTx();
    FLW.verify[tx8] = { id: 908, tx_ref: tx8, status: 'successful', amount: 300, currency: 'ZMW', payment_type: 'card' };
    r = await post(start, { items: [{ sku: 'SC-1', qty: 1 }], buyer: B('0960000009'), fulfilment: 'collection' });
    const tx9 = lastTx();
    payOf(tx9).created_at = minutesAgo(20);
    r = await post(start, { items: [{ sku: 'SC-1', qty: 1 }], buyer: B('0960000010'), fulfilment: 'collection' });
    const tx10 = lastTx();
    payOf(tx10).created_at = minutesAgo(60 * 5); payOf(tx10).status = 'expired';
    orderOf(tx10).payment_status = 'expired'; orderOf(tx10).status = 'cancelled';
    FLW.verify[tx10] = { id: 910, tx_ref: tx10, status: 'successful', amount: 300, currency: 'ZMW', payment_type: 'card' };
    MAIL = [];
    let run = await reconcile();
    is(orderOf(tx7).payment_status === 'paid' && orderOf(tx7).pay_channel === 'mobilemoneyzambia' && mailsFor(orderOf(tx7)).length === 2,
       'paid by mobile money while nobody was watching (no webhook, no return): found, marked paid, emails sent', JSON.stringify(run));
    is(orderOf(tx8).payment_status === 'awaiting', 'one started a moment ago is left alone: the customer may still be paying');
    is(orderOf(tx9).payment_status === 'awaiting' && payOf(tx9).status === 'started', 'one nobody paid for is left as it is');
    is(orderOf(tx10).payment_status === 'paid' && orderOf(tx10).status === 'pending',
       'money that arrived after the three-hour tidy-up brings its cancelled order back');
    const mailed = MAIL.length;
    run = await reconcile();
    is(MAIL.length === mailed, 'the next run sends nothing twice', JSON.stringify(run));
    r = await post(start, { items: [{ sku: 'SC-1', qty: 1 }], buyer: B('0960000011'), fulfilment: 'collection' });
    const tx11 = lastTx();
    FLW.verify[tx11] = { id: 911, tx_ref: tx11, status: 'successful', amount: 300, currency: 'ZMW', payment_type: 'card' };
    FAIL_ORDER_PATCH = 1;
    await get(status, { tx_ref: tx11, transaction_id: '911' });
    MAIL = [];
    run = await reconcile();
    is(orderOf(tx11).payment_status === 'paid' && mailsFor(orderOf(tx11)).length === 2 && run.repaired === 1,
       'and a paid payment whose order missed the news is caught up, emails and all', JSON.stringify(run));
    const keyWas = process.env.FLW_SECRET_KEY_TEST;
    delete process.env.FLW_SECRET_KEY_TEST;
    const hitsBefore = HITS;
    run = await reconcile();
    process.env.FLW_SECRET_KEY_TEST = keyWas;
    is(run && run.skipped === 'no Flutterwave key' && HITS === hitsBefore,
       'before Flutterwave is connected, the check-up reads nothing and asks nobody', JSON.stringify([run, HITS - hitsBefore]));
  } catch (e) {
    fail('threw: ' + (e && e.stack || e));
  } finally {
    server.close();
  }
  console.log('\n' + (failures ? '  ✗ ' + failures + ' of ' + checks + ' checks FAILED'
                                : '  payment functions: all ' + checks + ' checks passed'));
  process.exit(failures ? 1 : 0);
})();
