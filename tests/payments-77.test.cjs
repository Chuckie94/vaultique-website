/* ===========================================================================
   ONLINE PAYMENT, MADE SAFER (website build 77)

   The payment functions run as Netlify runs them, against stand-ins for the
   POS, this website's Supabase and Flutterwave (the same kind of stand-ins
   as payments.test.cjs), through each of build 77's changes:

     1. the fifteen-minute check-up catches a payment that succeeds after a
        failed try, and leaves alone the attempts the site stopped itself;
     2. only the exact amount counts as paid; more, less or another currency
        "needs attention": never paid, the shop told once, the order open;
     3. the status page asks Flutterwave about one payment at most once every
        five seconds; the webhook never waits;
     6. a piece paid for online is held: a second customer is not charged
        for it, until the first order is rung up, completed or cancelled, or
        a week has gone by.

   (4, the payment history, lives in the database: tests/payment-history.sql.
   5, the page after paying: tests/payment-return.browser.cjs.)
   =========================================================================== */
const http = require('http');
const path = require('path');

let checks = 0, failures = 0;
const ok = m => { checks++; console.log('  ✓ ' + m); };
const fail = (m, x) => { checks++; failures++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); };
const is = (c, m, x) => c ? ok(m) : fail(m, x);

/* ---------------- the world the functions live in ---------------- */
const POS = [
  { sku: 'SC-1', name: 'Silk Scarf', category: 'Accessories', price: 300, stock: 50, active: true },
  { sku: 'ONE', name: 'Beaded Clutch', category: 'Bags', price: 400, stock: 1, active: true },
  { sku: 'TRI', name: 'Gold Hoops', category: 'Jewellery', price: 200, stock: 3, active: true },
  { sku: 'LOTS', name: 'Gift Card Sleeve', category: 'Accessories', price: 10, stock: 500, active: true },
];
let SETTINGS, META, DB, FLW, MAIL, PRIV, HITS = 0, ASKED_COLUMN = true, FAIL_HOLD_READ = false;
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
  FLW = { made: [], verify: {}, down: false, asked: {} };   // asked[tx_ref] = how many times Flutterwave was asked
  MAIL = [];
  PRIV = { notifications: { smtpPassword: 'x' } };
  ASKED_COLUMN = true;
  FAIL_HOLD_READ = false;
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
    if (op === 'gt') return row[k] != null && x > v;
    if (op === 'lt') return row[k] != null && x < v;
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
      if (t) FLW.asked[t.tx_ref] = (FLW.asked[t.tx_ref] || 0) + 1;
      return t ? send(200, { status: 'success', data: t }) : send(404, { status: 'error' });
    }
    if (p === '/flw/transactions/verify_by_reference') {
      const ref = u.searchParams.get('tx_ref');
      FLW.asked[ref] = (FLW.asked[ref] || 0) + 1;
      const t = FLW.verify[ref];
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
  if (p === '/web/rest/v1/product_meta') return send(200, META);
  if (p === '/web/rest/v1/rpc/place_order') {
    const b = JSON.parse(body);
    const id = 'ord-' + (++seq);
    const ref = 'VB-' + String(seq).padStart(5, 'A').slice(-5).replace(/[^A-Z0-9]/g, 'A');
    DB.orders.push(Object.assign({ id, ref, status: 'pending', created_at: new Date().toISOString() }, b.p_order));
    b.p_items.forEach(i => DB.order_items.push(Object.assign({ order_id: id }, i)));
    return send(200, { id, ref });
  }
  if (p === '/web/rest/v1/rpc/pay_expire_stale') return service ? send(204) : send(401, {});
  const t = /^\/web\/rest\/v1\/(orders|order_items|payments)$/.exec(p);
  if (t) {
    if (!service) return send(401, {});
    const table = DB[t[1]], fs = filters(u.search.slice(1));
    const minimal = /return=minimal/.test(req.headers.prefer || '');
    if (req.method === 'GET') {
      if (t[1] === 'orders' && FAIL_HOLD_READ && /payment_status=eq\.paid/.test(u.search)) return send(500, { message: 'down' });
      return send(200, table.filter(r => matches(r, fs)));
    }
    if (req.method === 'POST') {
      const row = Object.assign({ id: 'pay-' + (++seq), status: 'started', created_at: new Date().toISOString() },
        t[1] === 'payments' && ASKED_COLUMN ? { asked_at: null } : {}, JSON.parse(body));
      table.push(row);
      return send(201, [row]);
    }
    if (req.method === 'PATCH') {
      const patch = JSON.parse(body);
      if (t[1] === 'payments' && !ASKED_COLUMN && 'asked_at' in patch) return send(400, { message: 'column "asked_at" does not exist' });
      const hit = table.filter(r => matches(r, fs));
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
  const signed = (data) => hook({ httpMethod: 'POST', headers: { 'verif-hash': 'my-secret-hash' }, body: JSON.stringify({ data }) });
  const B = (phone) => ({ name: 'Test Buyer', phone, email: 'buyer@example.com', address: 'Plot 1, Lusaka' });
  const lastPay = () => DB.payments[DB.payments.length - 1];
  const payOf = (tx) => DB.payments.find(x => x.tx_ref === tx);
  const orderOf = (tx) => DB.orders.find(o => o.pay_ref === tx);
  const ago = (ms) => new Date(Date.now() - ms).toISOString();
  let phoneN = 100000;   // ten-figure phone numbers, a fresh one per payment (five an hour per phone)
  const pay = async (items) => {
    const r = await post(start, { items, buyer: B('0970' + (++phoneN)), fulfilment: 'collection' });
    if (r.code !== 200) console.log("      (pay-start said " + r.code + " " + JSON.stringify(r.body) + ")");
    return { r, tx: r.code === 200 ? r.body.txRef : null };
  };

  try {
    /* ------------------------------------------------------------------ 1 */
    console.log('\n1. The check-up catches a payment that succeeds after a failed try');
    let { tx } = await pay([{ sku: 'SC-1', qty: 1 }]);
    FLW.verify[tx] = { id: 1001, tx_ref: tx, status: 'failed', amount: 300, currency: 'ZMW', payment_type: 'mobilemoneyzambia' };
    await signed({ id: 1001, tx_ref: tx });
    is(payOf(tx).status === 'failed' && orderOf(tx).status === 'cancelled' && orderOf(tx).payment_status === 'failed',
       'a first try that fails: the attempt is failed and its order cancelled, as before');
    // The customer tries again on Flutterwave's page and pays. Word of it never arrives.
    FLW.verify[tx] = { id: 1002, tx_ref: tx, status: 'successful', amount: 300, currency: 'ZMW', payment_type: 'mobilemoneyzambia', flw_ref: 'FLW-2' };
    payOf(tx).created_at = ago(10 * 60000);
    MAIL = [];
    let run = await reconcile();
    is(payOf(tx).status === 'paid' && orderOf(tx).payment_status === 'paid' && orderOf(tx).status === 'pending',
       'the check-up asks about it again, finds it paid, and brings its order back', JSON.stringify([run, payOf(tx).status, orderOf(tx)]));
    is(MAIL.length === 2 && MAIL[0].to === 'buyer@example.com' && /Payment received/.test(MAIL[0].subject),
       'and the customer and the shop are told, once', JSON.stringify(MAIL.map(m => m.subject)));
    run = await reconcile();
    is(MAIL.length === 2, 'the next run sends nothing twice');

    // Stopped by this site before any payment page existed: nobody could have paid.
    FLW.down = true;
    await post(start, { items: [{ sku: 'SC-1', qty: 1 }], buyer: B('0970' + (++phoneN)), fulfilment: 'collection' });
    FLW.down = false;
    const stopped = lastPay();
    is(stopped.status === 'failed' && /stopped before the payment page/.test(String((stopped.detail || {}).reason)),
       'an attempt stopped before the payment page is failed by this site, as before', JSON.stringify(stopped.detail));
    FLW.verify[stopped.tx_ref] = { id: 1003, tx_ref: stopped.tx_ref, status: 'successful', amount: 300, currency: 'ZMW' };
    stopped.created_at = ago(10 * 60000);
    await reconcile();
    is(!FLW.asked[stopped.tx_ref] && stopped.status === 'failed',
       'and the check-up never asks Flutterwave about it', JSON.stringify([FLW.asked[stopped.tx_ref], stopped.status]));
    delete FLW.verify[stopped.tx_ref];

    ({ tx } = await pay([{ sku: 'SC-1', qty: 1 }]));
    FLW.verify[tx] = { id: 1004, tx_ref: tx, status: 'cancelled', amount: 300, currency: 'ZMW' };
    await signed({ id: 1004, tx_ref: tx });
    payOf(tx).created_at = ago(80 * 3600000);
    FLW.verify[tx] = { id: 1005, tx_ref: tx, status: 'successful', amount: 300, currency: 'ZMW' };
    await reconcile();
    is(payOf(tx).status === 'failed' && FLW.asked[tx] === 1,
       'one older than three days is not asked about (the same three days as the others; the one ask was the webhook\'s)',
       JSON.stringify([payOf(tx).status, FLW.asked[tx]]));

    /* ------------------------------------------------------------------ 2 */
    console.log('\n2. Only the exact amount counts as paid; anything else needs attention');
    ({ tx } = await pay([{ sku: 'SC-1', qty: 1 }]));
    FLW.verify[tx] = { id: 2001, tx_ref: tx, status: 'successful', amount: 360, currency: 'ZMW', payment_type: 'card', flw_ref: 'FLW-MORE' };
    MAIL = [];
    let r = await get(status, { tx_ref: tx, transaction_id: '2001' });
    is(r.body.status === 'review', 'K360 against a K300 order: the page is told it needs attention', JSON.stringify(r.body));
    is(payOf(tx).status === 'review' && orderOf(tx).payment_status === 'review' && orderOf(tx).status === 'pending',
       'never marked paid: the payment and its order say "needs attention", and the order stays open',
       JSON.stringify([payOf(tx).status, orderOf(tx).payment_status, orderOf(tx).status]));
    is(MAIL.length === 1 && MAIL[0].to === 'shop@example.com' && /needs attention/.test(MAIL[0].subject) &&
       /K360/.test(MAIL[0].text) && /K300/.test(MAIL[0].text) && /FLW-MORE/.test(MAIL[0].text),
       'the shop gets one email, with what came in and what the order is', JSON.stringify(MAIL.map(m => [m.to, m.subject])));
    is(!MAIL.some(m => m.to === 'buyer@example.com'), 'the customer is not sent a "payment received" email');
    is(!JSON.stringify(r.body).includes('Test Buyer') && !JSON.stringify(r.body).includes('0970'),
       'and nothing personal is in the page\'s answer', JSON.stringify(r.body));
    await signed({ id: 2001, tx_ref: tx });
    payOf(tx).asked_at = null;
    r = await get(status, { tx_ref: tx, transaction_id: '2001' });
    payOf(tx).created_at = ago(10 * 60000);
    const asksBefore = FLW.asked[tx] || 0;
    run = await reconcile();
    is(MAIL.length === 1 && r.body.status === 'review', 'a repeated webhook, a return visit and the check-up tell the shop nothing twice',
       JSON.stringify([MAIL.length, r.body]));
    is((FLW.asked[tx] || 0) === asksBefore + 1 && run.review >= 1,
       'the check-up still asks about it, in case Flutterwave now names one that is exactly right', JSON.stringify([asksBefore, FLW.asked[tx], run]));
    // Flutterwave now names a payment for this reference that is exactly right.
    FLW.verify[tx] = { id: 2002, tx_ref: tx, status: 'successful', amount: 300, currency: 'ZMW', payment_type: 'card' };
    MAIL = [];
    await signed({ id: 2002, tx_ref: tx });
    is(payOf(tx).status === 'paid' && orderOf(tx).payment_status === 'paid' && MAIL.length === 2,
       'then it is paid like any other, and the confirmations go', JSON.stringify([payOf(tx).status, orderOf(tx).payment_status, MAIL.length]));

    ({ tx } = await pay([{ sku: 'SC-1', qty: 1 }]));
    FLW.verify[tx] = { id: 2003, tx_ref: tx, status: 'successful', amount: 250, currency: 'ZMW', payment_type: 'card' };
    r = await get(status, { tx_ref: tx, transaction_id: '2003' });
    is(r.body.status === 'review' && payOf(tx).status === 'review', 'less than the order: needs attention', JSON.stringify(r.body));
    FLW.verify[tx] = { id: 2004, tx_ref: tx, status: 'failed', amount: 300, currency: 'ZMW' };
    await signed({ id: 2004, tx_ref: tx });
    payOf(tx).asked_at = null;
    r = await get(status, { tx_ref: tx, transaction_id: '2004' });
    is(r.body.status === 'review' && payOf(tx).status === 'review' && orderOf(tx).status === 'pending',
       'a failed try on top of it does not turn it into "nothing was taken"', JSON.stringify([r.body, payOf(tx).status]));

    ({ tx } = await pay([{ sku: 'SC-1', qty: 1 }]));
    FLW.verify[tx] = { id: 2005, tx_ref: tx, status: 'successful', amount: 300, currency: 'USD', payment_type: 'card' };
    r = await get(status, { tx_ref: tx, transaction_id: '2005' });
    is(r.body.status === 'review', 'the right number in another currency: needs attention', JSON.stringify(r.body));
    is(MAIL.some(m => /needs attention/.test(m.subject) && /USD 300/.test(m.text)), 'and the shop is told it came in dollars');

    ({ tx } = await pay([{ sku: 'SC-1', qty: 1 }]));
    FLW.verify[tx] = { id: 2006, tx_ref: tx, status: 'successful', amount: 299.996, currency: 'zmw', payment_type: 'card' };
    r = await get(status, { tx_ref: tx, transaction_id: '2006' });
    is(r.body.status === 'paid', 'the exact amount (to the ngwee, whatever the case of the currency) is paid', JSON.stringify(r.body));
    ({ tx } = await pay([{ sku: 'SC-1', qty: 1 }]));
    FLW.verify[tx] = { id: 2007, tx_ref: tx, status: 'successful', amount: 300.01, currency: 'ZMW', payment_type: 'card' };
    r = await get(status, { tx_ref: tx, transaction_id: '2007' });
    is(r.body.status === 'review', 'one ngwee over is not', JSON.stringify(r.body));

    /* ------------------------------------------------------------------ 3 */
    console.log('\n3. The status page asks Flutterwave about one payment at most every five seconds');
    ({ tx } = await pay([{ sku: 'SC-1', qty: 1 }]));
    r = await get(status, { tx_ref: tx });
    let r2 = await get(status, { tx_ref: tx });
    is(FLW.asked[tx] === 1 && r.body.status === 'pending' && r2.body.status === 'pending',
       'asked twice in a row, Flutterwave is asked once', JSON.stringify([FLW.asked[tx], r.body, r2.body]));
    payOf(tx).asked_at = ago(6000);
    await get(status, { tx_ref: tx });
    is(FLW.asked[tx] === 2, 'five seconds later it is asked again', JSON.stringify(FLW.asked[tx]));
    await Promise.all([get(status, { tx_ref: tx }), get(status, { tx_ref: tx }), get(status, { tx_ref: tx })]);
    is(FLW.asked[tx] === 2, 'three asks at the same moment, inside the five seconds: none goes to Flutterwave', JSON.stringify(FLW.asked[tx]));
    payOf(tx).asked_at = null;
    await Promise.all([get(status, { tx_ref: tx }), get(status, { tx_ref: tx })]);
    is(FLW.asked[tx] === 3, 'two at the same moment with the turn free: exactly one goes', JSON.stringify(FLW.asked[tx]));
    await signed({ id: 0, tx_ref: tx });
    await signed({ id: 0, tx_ref: tx });
    is(FLW.asked[tx] === 5, 'the webhook never waits: each one asks', JSON.stringify(FLW.asked[tx]));
    FLW.verify[tx] = { id: 3001, tx_ref: tx, status: 'successful', amount: 300, currency: 'ZMW', payment_type: 'card' };
    r = await get(status, { tx_ref: tx, transaction_id: '3001' });
    is(r.body.status === 'pending' && payOf(tx).status === 'started',
       'inside the five seconds the page is told "pending"', JSON.stringify(r.body));
    payOf(tx).asked_at = ago(6000);
    r = await get(status, { tx_ref: tx, transaction_id: '3001' });
    is(r.body.status === 'paid', 'and the next ask let through finds it paid', JSON.stringify(r.body));

    ({ tx } = await pay([{ sku: 'SC-1', qty: 1 }]));
    FLW.verify[tx] = { id: 3002, tx_ref: tx, status: 'failed', amount: 300, currency: 'ZMW' };
    await signed({ id: 3002, tx_ref: tx });
    payOf(tx).asked_at = new Date().toISOString();
    r = await get(status, { tx_ref: tx });
    is(r.body.status === 'pending', 'a paused answer is never "failed": the customer may be paying on a second try', JSON.stringify(r.body));

    ASKED_COLUMN = false;
    ({ tx } = await pay([{ sku: 'SC-1', qty: 1 }]));
    is(!('asked_at' in payOf(tx)), '(a website that has not run supabase-payment-history.sql)');
    r = await get(status, { tx_ref: tx });
    r2 = await get(status, { tx_ref: tx });
    is(FLW.asked[tx] === 2 && r.code === 200 && r2.code === 200,
       'without the new column the page asks every time, as in 76, and nothing fails', JSON.stringify([FLW.asked[tx], r.code, r2.code]));
    ASKED_COLUMN = true;

    /* ------------------------------------------------------------------ 6 */
    console.log('\n6. A piece paid for online is held');
    let a = await pay([{ sku: 'ONE', qty: 1 }]);
    FLW.verify[a.tx] = { id: 6001, tx_ref: a.tx, status: 'successful', amount: 400, currency: 'ZMW', payment_type: 'card' };
    await signed({ id: 6001, tx_ref: a.tx });
    is(orderOf(a.tx).payment_status === 'paid', 'the first customer pays for the only Beaded Clutch');
    r = await post(quote, { items: [{ sku: 'ONE', qty: 1 }], fulfilment: 'collection' });
    is(r.code === 409 && /Beaded Clutch has just sold out/.test(r.body.problems[0]),
       'the second customer\'s quote: it has just sold out', JSON.stringify(r.body));
    const ordersBefore = DB.orders.length, madeBefore = FLW.made.length;
    r = await post(start, { items: [{ sku: 'ONE', qty: 1 }], buyer: B('0970' + (++phoneN)), fulfilment: 'collection' });
    is(r.code === 409 && /sold out/.test(r.body.problems[0]) && DB.orders.length === ordersBefore && FLW.made.length === madeBefore,
       'and pressing Pay anyway: refused, no order made, nothing sent to Flutterwave', JSON.stringify(r.body));
    r = await post(quote, { items: [{ sku: 'SC-1', qty: 2 }], fulfilment: 'collection' });
    is(r.code === 200 && r.body.total === 600, 'everything else is priced exactly as before', JSON.stringify(r.body));

    const t1 = await pay([{ sku: 'TRI', qty: 1 }]);
    FLW.verify[t1.tx] = { id: 6002, tx_ref: t1.tx, status: 'successful', amount: 200, currency: 'ZMW', payment_type: 'card' };
    await signed({ id: 6002, tx_ref: t1.tx });
    r = await post(quote, { items: [{ sku: 'TRI', qty: 3 }], fulfilment: 'collection' });
    is(r.code === 409 && /Only 2 of Gold Hoops are available/.test(r.body.problems[0]),
       'three pairs in stock and one paid for online: two are on offer', JSON.stringify(r.body));
    r = await post(quote, { items: [{ sku: 'TRI', qty: 2 }], fulfilment: 'collection' });
    is(r.code === 200 && r.body.total === 400, 'and two can be paid for', JSON.stringify(r.body));

    const held = orderOf(a.tx);
    const tryOne = async () => (await post(quote, { items: [{ sku: 'ONE', qty: 1 }], fulfilment: 'collection' })).code;
    held.pos_sale_id = 'S-1';
    is(await tryOne() === 200, 'once the till has rung the first order up, the hold is gone (the stock now speaks for itself)');
    delete held.pos_sale_id;
    held.status = 'completed';
    is(await tryOne() === 200, 'once the order is completed');
    held.status = 'cancelled';
    is(await tryOne() === 200, 'once the order is cancelled');
    held.status = 'pending';
    held.created_at = ago(8 * 86400000);
    is(await tryOne() === 200, 'and after seven days at most');
    held.created_at = new Date().toISOString();
    is(await tryOne() === 409, '(and held again when none of those applies)');
    FAIL_HOLD_READ = true;
    is(await tryOne() === 200, 'if the hold cannot be worked out, the payment goes ahead as it did before 77');
    FAIL_HOLD_READ = false;

    r = await post(quote, { items: [{ sku: 'LOTS', qty: 99 }], fulfilment: 'collection' });
    is(r.code === 200, 'a piece with more than the cart can show is never held back by the ceiling', JSON.stringify(r.body));

    const awaiting = await pay([{ sku: 'TRI', qty: 2 }]);
    r = await post(quote, { items: [{ sku: 'TRI', qty: 2 }], fulfilment: 'collection' });
    is(awaiting.r.code === 200 && r.code === 200, 'an order only waiting for its payment holds nothing', JSON.stringify(r.body));
  } catch (e) {
    fail('threw: ' + (e && e.stack || e));
  } finally {
    server.close();
  }
  console.log('\n' + (failures ? '  ✗ ' + failures + ' of ' + checks + ' checks FAILED'
                               : '  online payment, build 77: all ' + checks + ' checks passed'));
  process.exit(failures ? 1 : 0);
})();
