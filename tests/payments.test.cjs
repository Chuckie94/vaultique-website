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
let SETTINGS, META, DB, FLW, MAIL, HITS, NO_THROTTLE;
/* Signed-in tokens as Supabase would vouch for them (build 77). The owner's
   says how far they got: password only (aal1), or past two-factor (aal2). */
const jwt = (claims) => 'h.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.s';
const OWNER_AAL2 = jwt({ sub: 'owner-1', aal: 'aal2' });
const OWNER_AAL1 = jwt({ sub: 'owner-1', aal: 'aal1' });
const USERS = { 'customer-jwt': 'cust-1', [OWNER_AAL2]: 'owner-1', [OWNER_AAL1]: 'owner-1' };
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
  FLW = { made: [], verify: {} };   // verify[tx_ref] = transaction as Flutterwave would report it
  MAIL = [];
  HITS = {};          // the database's throttle: bucket|key -> count
  NO_THROTTLE = false;
}
reset();

const read = req => new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => r(d)); });
function filters(q) {
  const out = [];
  for (const [k, v] of new URLSearchParams(q)) {
    if (['select', 'order', 'limit'].includes(k)) continue;
    const m = /^(eq|neq|in|gt)\.(.*)$/.exec(v);
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
    if (op === 'in') return v.replace(/^\(|\)$/g, '').split(',').map(s => s.replace(/^"|"$/g, '')).includes(x);
  });
}
let seq = 0;
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  const body = await read(req);
  const send = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(o === undefined ? '' : JSON.stringify(o)); };
  const service = (req.headers.authorization || '') === 'Bearer service-key';

  // the POS
  if (p === '/pos/rest/v1/app_state') return send(200, [{ id: 100, state: { products: POS } }]);

  // Flutterwave
  if (p.startsWith('/flw/')) {
    const flwKey = req.headers.authorization || '';
    if (flwKey !== 'Bearer FLWSECK_TEST-secret' && flwKey !== 'Bearer FLWSECK-live-secret') return send(401, { status: 'error' });
    if (p === '/flw/payments' && req.method === 'POST') {
      const b = JSON.parse(body);
      FLW.made.push(Object.assign({ _key: flwKey }, b));
      return send(200, { status: 'success', data: { link: FLW.link !== undefined ? FLW.link : 'https://checkout.flutterwave.test/pay/' + b.tx_ref } });
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
  if (p === '/web/rest/v1/site_settings_private') return send(200, [{ data: { smtpPassword: 'x' } }]);
  if (p === '/web/rest/v1/product_meta') return send(200, META);
  // Who a signed-in customer is, as Supabase answers it (build 76: the
  // functions ask, rather than taking the browser's word).
  if (p === '/web/auth/v1/user') {
    const id = USERS[String(req.headers.authorization || '').replace(/^Bearer /, '')];
    return id ? send(200, { id, email: id + '@mail.test' }) : send(401, { msg: 'invalid JWT' });
  }
  if (p === '/web/rest/v1/rpc/preview_ok') return send(200, JSON.parse(body || '{}').p_key === 'shop-preview');
  if (p === '/web/rest/v1/rpc/throttle') {
    if (!service) return send(401, {});
    if (NO_THROTTLE) return send(404, { code: 'PGRST202', message: 'Could not find the function public.throttle' });
    const b = JSON.parse(body), k = b.p_bucket + '|' + b.p_key;
    if ((HITS[k] || 0) >= b.p_max) return send(400, { code: 'P0429', message: 'Too many tries just now. Please wait a little and try again.' });
    HITS[k] = (HITS[k] || 0) + 1;
    return send(204);
  }
  if (p === '/web/rest/v1/admins') {
    if (!service) return send(401, {});
    const id = (u.searchParams.get('id') || '').replace('eq.', '');
    return send(200, id === 'owner-1' && u.searchParams.get('role') === 'eq.owner' ? [{ id }] : []);
  }
  if (p === '/web/rest/v1/rpc/place_order') {
    // After supabase-hardening.sql only the service key may call it.
    if (!service) return send(401, { message: 'permission denied for function place_order' });
    const b = JSON.parse(body);
    const id = 'ord-' + (++seq);
    const ref = 'VB-' + String(seq).padStart(5, 'A').slice(-5).replace(/[^A-Z0-9]/g, 'A');
    DB.orders.push(Object.assign({ id, ref, status: 'pending', created_at: new Date().toISOString() }, b.p_order,
      { auth: req.headers.authorization, customer: b.p_customer || null }));
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
  /* Online payment is in Test mode here, which since build 77 is the
     shop's alone: these requests carry the shop's preview key, the way
     the owner tests. A request that says preview: null is a stranger. */
  const post = (fn, b, headers) => fn({ httpMethod: 'POST',
    body: JSON.stringify('preview' in b ? b : Object.assign({ preview: 'shop-preview' }, b)), headers: headers || {} })
    .then(r => ({ code: r.statusCode, body: r.body ? JSON.parse(r.body) : null }));
  const get = (fn, q) => fn({ httpMethod: 'GET', queryStringParameters: q, headers: {} })
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
    is(order && order.total === 1380 && order.auth === 'Bearer service-key' && order.customer === 'cust-1',
       'the order is recorded through place_order with the service key, in the account Supabase vouched for',
       order && JSON.stringify({ auth: order.auth, customer: order.customer }));
    is(order && order.pay_mode === 'test', 'and marked on the order itself as a TEST payment (build 76)');
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
    is(r.body.status === 'pending' && DB.orders[0].payment_status === 'awaiting',
       'K1 paid against a K1,380 order is not "paid"', JSON.stringify(r.body));
    FLW.verify[txRef] = { id: 555, tx_ref: txRef, status: 'successful', amount: 1380, currency: 'USD', payment_type: 'card' };
    r = await get(status, { tx_ref: txRef, transaction_id: '555' });
    is(r.body.status === 'pending', 'nor is the right number in the wrong currency');
    FLW.verify['other'] = { id: 777, tx_ref: 'VB-OTHER-0000000000', status: 'successful', amount: 5000, currency: 'ZMW' };
    r = await get(status, { tx_ref: txRef, transaction_id: '777' });
    is(r.body.status === 'pending', 'nor somebody else\'s payment, however large');
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
    is(MAIL.length === 2 && MAIL[0].to === 'chanda@example.com' && /^\[TEST\]/.test(MAIL[0].subject),
       'the customer is emailed automatically, and a Test-mode payment says [TEST] in the subject (build 77)',
       JSON.stringify(MAIL.map(m => m.to + ': ' + m.subject)));
    is(MAIL[1] && MAIL[1].to === 'shop@example.com' && /^\[TEST\].*no money moved/.test(MAIL[1].subject),
       'and the shop is told, [TEST] and "no money moved" in its subject', MAIL[1] && MAIL[1].subject);
    is(/Delivery: K80/.test(MAIL[0].text) && /TEST payment, no money taken: K1,380 \(mobile money\)/.test(MAIL[0].text) &&
       !/(^|\n)Paid:/.test(MAIL[0].text) && /not a receipt/.test(MAIL[0].text),
       'the email shows the delivery, and calls the payment a test, never "Paid"', MAIL[0].text);
    r = await hook({ httpMethod: 'POST', headers: { 'verif-hash': 'my-secret-hash' },
                     body: JSON.stringify({ data: { id: 555, tx_ref: txRef } }) });
    r = await get(status, { tx_ref: txRef, transaction_id: '555' });
    is(MAIL.length === 2, 'a repeated webhook, and the customer coming back, send nothing twice');
    is(r.body.status === 'paid' && r.body.ref === DB.orders[0].ref && r.body.amountText === 'K1,380' && r.body.test === true,
       'the page they come back to is told: paid, in Test mode', JSON.stringify(r.body));
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
    const mailed = MAIL.length;
    r = await get(status, { tx_ref: tx2, transaction_id: '600' });
    is(r.body.status === 'paid' && o2.status === 'pending' && o2.payment_status === 'paid',
       'but money that arrives after all brings the order back', JSON.stringify(o2));
    const late = MAIL.slice(mailed).find(m => m.to === 'shop@example.com');
    is(late && /^\[CHECK STOCK\]/.test(late.subject) && /PAID LATE/.test(late.text) && /refund/.test(late.text),
       'and the shop is told it came late, so the piece may have sold: check before confirming (build 78)',
       late && (late.subject + ' | ' + late.text.slice(0, 120)));
    const first = MAIL.slice(0, 2).find(m => m.to === 'shop@example.com');
    is(first && !/CHECK STOCK|PAID LATE/.test(first.subject + first.text), 'a payment in time says nothing of the kind');

    console.log('\nTest mode is the shop\'s own (build 77, decision Q3)');
    let before = { made: FLW.made.length, orders: DB.orders.length, pays: DB.payments.length };
    r = await post(quote, { items: ITEMS, fulfilment: 'collection', preview: null });
    is(r.code === 403 && r.body.off, 'a stranger is not even quoted while online payment is in Test mode', JSON.stringify(r));
    r = await post(start, { items: ITEMS, buyer: BUYER, fulfilment: 'collection', preview: null });
    is(r.code === 403 && r.body.off && /WhatsApp/.test(r.body.error), 'nor can they start a payment, and are pointed to WhatsApp');
    r = await post(start, { items: ITEMS, buyer: BUYER, fulfilment: 'collection', preview: 'a-guess' });
    is(r.code === 403, 'a wrong preview key is a stranger too');
    r = await post(start, { items: ITEMS, buyer: BUYER, fulfilment: 'collection', preview: null }, { authorization: 'Bearer customer-jwt' });
    is(r.code === 403, 'and so is a signed-in customer');
    r = await post(start, { items: ITEMS, buyer: BUYER, fulfilment: 'collection', preview: null }, { authorization: 'Bearer ' + OWNER_AAL1 });
    is(r.code === 403, 'and the owner with only a password: a stolen password does not make test payments');
    is(FLW.made.length === before.made && DB.orders.length === before.orders && DB.payments.length === before.pays,
       'none of them recorded anything, or reached Flutterwave');
    r = await post(start, { items: [{ sku: 'SC-1', qty: 1 }], buyer: Object.assign({}, BUYER, { phone: '0955000001' }),
                            fulfilment: 'collection', preview: null }, { authorization: 'Bearer ' + OWNER_AAL2 });
    is(r.code === 200 && FLW.made.length === before.made + 1, 'the owner, past two-factor, may test', JSON.stringify(r));

    console.log('\nIn Live mode, everybody pays, and nothing says TEST');
    SETTINGS.payments.onlineMode = 'live';
    process.env.FLW_SECRET_KEY_LIVE = 'FLWSECK-live-secret';
    r = await post(quote, { items: [{ sku: 'SC-1', qty: 1 }], fulfilment: 'collection', preview: null });
    is(r.code === 200 && r.body.total === 300, 'a stranger is quoted');
    r = await post(start, { items: [{ sku: 'SC-1', qty: 1 }], buyer: Object.assign({}, BUYER, { phone: '0955000002' }),
                            fulfilment: 'collection', preview: null });
    const live = FLW.made[FLW.made.length - 1];
    is(r.code === 200 && live && live._key === 'Bearer FLWSECK-live-secret', 'and pays, with the live key', JSON.stringify(r));
    const liveTx = live.tx_ref;
    FLW.verify[liveTx] = { id: 901, tx_ref: liveTx, status: 'successful', amount: 300, currency: 'ZMW', payment_type: 'card' };
    MAIL = [];
    r = await get(status, { tx_ref: liveTx, transaction_id: '901' });
    is(r.body.status === 'paid' && r.body.test === false, 'the page they come back to is told: paid, for real');
    is(MAIL.length === 2 && /^Payment received/.test(MAIL[0].subject) && /Paid: K300 \(card\)/.test(MAIL[0].text) &&
       /^Paid online: .* K300$/.test(MAIL[1].subject) && !MAIL.some(m => /TEST/.test(m.subject + m.text)),
       'and the emails read as before: "Payment received", "Paid online", no TEST anywhere', JSON.stringify(MAIL.map(m => m.subject)));
    SETTINGS.payments.onlineMode = 'test';
    delete process.env.FLW_SECRET_KEY_LIVE;

    console.log('\nOne connection cannot use up the shop\'s payments (build 77)');
    const here = { 'x-nf-client-connection-ip': '198.51.100.7' };
    let refused = null;
    for (let i = 0; i < 9; i++) {
      r = await post(start, { items: [{ sku: 'SC-1', qty: 1 }], buyer: Object.assign({}, BUYER, { phone: '09770000' + (10 + i) }),
                              fulfilment: 'collection' }, here);
      if (r.code === 429 && refused === null) refused = i + 1;
    }
    is(refused === 9 && /from here/.test(r.body.error), 'eight payments an hour from one connection, whatever phone numbers it types; the ninth is refused',
       'refused at attempt ' + refused);
    r = await post(start, { items: [{ sku: 'SC-1', qty: 1 }], buyer: Object.assign({}, BUYER, { phone: '0966111222' }),
                            fulfilment: 'collection' }, { 'x-nf-client-connection-ip': '203.0.113.20' });
    is(r.code === 200, 'while another customer pays as normal');
    is(require(path.join(F, '_pay')).PER_SHOP_PER_HOUR >= 1000, 'and the shop-wide ceiling is a backstop (1,000 an hour), not something a stranger can reach');
    NO_THROTTLE = true;
    r = await post(start, { items: [{ sku: 'SC-1', qty: 1 }], buyer: Object.assign({}, BUYER, { phone: '0966333444' }),
                            fulfilment: 'collection' }, here);
    is(r.code === 200, 'before supabase-hardening.sql has been run there is no count to ask, and paying carries on');
    NO_THROTTLE = false;

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

    console.log('\nThe customer is only ever sent to a web page (build 78)');
    for (const [what, link] of [['a javascript: address', 'javascript:alert(1)'],
                                ['a page that is not https://', 'http://checkout.flutterwave.test/pay/x'],
                                ['nothing at all', '']]) {
      reset();
      FLW.link = link;
      r = await post(start, { items: [{ sku: 'SC-1', qty: 1 }], buyer: BUYER, fulfilment: 'collection' });
      is(r.code === 502 && !('link' in r.body) && DB.payments[0] && DB.payments[0].status === 'failed' &&
         DB.orders[0] && DB.orders[0].payment_status === 'failed',
         'Flutterwave answering with ' + what + ': nothing is passed on to the browser, and the attempt is closed',
         JSON.stringify({ code: r.code, body: r.body, pay: DB.payments[0] && DB.payments[0].status }));
    }
  } catch (e) {
    fail('threw: ' + (e && e.stack || e));
  } finally {
    server.close();
  }
  console.log('\n' + (failures ? '  ✗ ' + failures + ' of ' + checks + ' checks FAILED'
                                : '  payment functions: all ' + checks + ' checks passed'));
  process.exit(failures ? 1 : 0);
})();
