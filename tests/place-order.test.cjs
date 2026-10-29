/* ===========================================================================
   A WHATSAPP ORDER, PRICED BY THE SERVER -- netlify/functions/place-order.js

   Build 76, decision Q2: the browser says which pieces and how many, and
   the price of every line comes from the catalogue, worked out by the same
   code that prices an online payment. The order is written with the service
   key, filed under the customer Supabase vouches for, and throttled per
   connection by the database. Run as Netlify runs it, against stand-ins for
   the POS and this website's Supabase.
   =========================================================================== */
const http = require('http');
const path = require('path');

let checks = 0, failures = 0;
const ok = m => { checks++; console.log('  ✓ ' + m); };
const fail = (m, x) => { checks++; failures++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); };
const is = (c, m, x) => c ? ok(m) : fail(m, x);

const POS = [
  { sku: 'BG-1', name: 'Leather Satchel', category: 'Bags', price: 500, stock: 3, active: true },
  { sku: 'SC-1', name: 'Silk Scarf', category: 'Accessories', price: 300, stock: 10, active: true },
  { sku: 'ASK', name: 'Couture Gown', category: 'Dresses', price: 9000, stock: 1, active: true },
  { sku: 'HID', name: 'Hidden Piece', category: 'Bags', price: 700, stock: 2, active: true },
  { sku: 'GONE', name: 'Sold Piece', category: 'Bags', price: 800, stock: 0, active: true },
];
let SETTINGS, META, CALLS, OLD_DB, TOO_MANY;
function reset() {
  SETTINGS = { general: { businessName: 'Vaultique', currency: 'ZMW' }, pricing: {} };
  META = [{ sku: 'ASK', on_request: true }, { sku: 'HID', hidden: true }];
  CALLS = [];
  OLD_DB = false;
  TOO_MANY = false;
}
reset();

const read = req => new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => r(d)); });
let seq = 0;
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  const body = await read(req);
  const send = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(o === undefined ? '' : JSON.stringify(o)); };
  const service = (req.headers.authorization || '') === 'Bearer service-key';

  if (p === '/pos/rest/v1/app_state') return send(200, [{ id: 100, state: { products: POS } }]);
  if (p === '/web/rest/v1/site_settings') {
    const key = (u.searchParams.get('key') || '').replace('eq.', '');
    return send(200, SETTINGS[key] ? [{ data: SETTINGS[key] }] : []);
  }
  if (p === '/web/rest/v1/product_meta') return send(200, META);
  if (p === '/web/rest/v1/sold_out_since') return req.method === 'GET' ? send(200, []) : send(201);
  if (p === '/web/rest/v1/rpc/preview_ok') return send(200, JSON.parse(body || '{}').p_key === 'letmein');
  if (p === '/web/auth/v1/user') {
    return (req.headers.authorization || '') === 'Bearer customer-jwt'
      ? send(200, { id: 'cust-1' }) : send(401, { msg: 'invalid JWT' });
  }
  if (p === '/web/rest/v1/rpc/place_order') {
    const b = JSON.parse(body);
    CALLS.push(Object.assign({ auth: req.headers.authorization }, b));
    if (!service) return send(401, { message: 'permission denied for function place_order' });
    if (OLD_DB && 'p_customer' in b) {
      return send(404, { code: 'PGRST202', message: 'Could not find the function public.place_order(p_client, p_customer, p_items, p_order, p_preview) in the schema cache' });
    }
    if (TOO_MANY) return send(400, { code: 'P0429', message: 'Too many tries just now. Please wait a little and try again.' });
    seq++;
    return send(200, { id: 'ord-' + seq, ref: 'VB-TEST' + seq });
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
  });
  const place = require(path.join(__dirname, '..', 'netlify', 'functions', 'place-order')).handler;
  const post = (b, headers) => place({ httpMethod: 'POST', body: JSON.stringify(b), headers: headers || {} })
    .then(r => ({ code: r.statusCode, body: r.body ? JSON.parse(r.body) : null }));
  const BUYER = { name: 'Chanda', phone: '0977 123456', email: 'chanda@example.com', address: 'Plot 5, Lusaka', fulfilment: 'delivery' };

  try {
    console.log('\nThe prices are the catalogue\'s');
    let r = await post({ order: BUYER, items: [{ sku: 'BG-1', qty: 2, price: 1, name: 'Cheap' }, { sku: 'SC-1', qty: 1, price: 1 }], total: 2 });
    let c = CALLS[CALLS.length - 1];
    is(r.code === 200 && /^VB-/.test(r.body.ref), 'the order is recorded and its reference comes back', JSON.stringify(r));
    is(c && c.p_order.total === 1300 && c.p_order.currency === 'ZMW',
       'two satchels and a scarf are recorded at K1,300, not the K2 the browser sent', c && JSON.stringify(c.p_order));
    is(c && c.p_items[0].price === 500 && c.p_items[0].name === 'Leather Satchel' && c.p_items[1].price === 300,
       'every line at its catalogue price, under its catalogue name');
    is(c && c.auth === 'Bearer service-key', 'written with the service key, the only key place_order answers');

    console.log('\nA WhatsApp order is a conversation, so nothing is refused');
    r = await post({ order: BUYER, items: [{ sku: 'ASK', qty: 1 }, { sku: 'SC-1', qty: 2 }] });
    c = CALLS[CALLS.length - 1];
    is(r.code === 200 && c.p_items[0].price === null && c.p_order.total === 600,
       'a piece priced on request is recorded without a price, and left out of the total', JSON.stringify(c && c.p_items));
    r = await post({ order: BUYER, items: [{ sku: 'NOPE', qty: 1, name: 'Something I saw' }, { sku: 'HID', qty: 1 }] });
    c = CALLS[CALLS.length - 1];
    is(r.code === 200 && c.p_items[0].price === null && c.p_items[0].name === 'Something I saw' && c.p_items[1].price === null,
       'a piece no longer on sale, or hidden, is recorded as asked for, without a price', JSON.stringify(c && c.p_items));
    r = await post({ order: BUYER, items: [{ sku: 'GONE', qty: 1 }] });
    c = CALLS[CALLS.length - 1];
    is(r.code === 200 && c.p_items[0].price === 800, 'a piece sold out since is recorded too, for the shop to answer in the chat');

    console.log('\nWho placed it');
    r = await post({ order: BUYER, items: [{ sku: 'BG-1', qty: 1 }] }, { authorization: 'Bearer customer-jwt', 'x-nf-client-connection-ip': '203.0.113.5' });
    c = CALLS[CALLS.length - 1];
    is(c && c.p_customer === 'cust-1', 'a signed-in customer\'s order is filed under the account Supabase vouches for');
    is(c && c.p_client === '203.0.113.5', 'and the connection is passed on for the database\'s throttle');
    r = await post({ order: BUYER, items: [{ sku: 'BG-1', qty: 1 }] }, { authorization: 'Bearer forged' });
    c = CALLS[CALLS.length - 1];
    is(r.code === 200 && c.p_customer === null, 'a token Supabase does not recognise is a guest, not refused');

    console.log('\nThe shop\'s own rules');
    SETTINGS.general.websiteStatus = 'closed';
    let before = CALLS.length;
    r = await post({ order: BUYER, items: [{ sku: 'BG-1', qty: 1 }] });
    is(r.code === 403 && CALLS.length === before, 'while the shop is closed, nothing is recorded');
    r = await post({ order: BUYER, items: [{ sku: 'BG-1', qty: 1 }], preview: 'letmein' });
    is(r.code === 200, 'unless the database says the preview key is right');
    SETTINGS.general.websiteStatus = 'live';
    TOO_MANY = true;
    r = await post({ order: BUYER, items: [{ sku: 'BG-1', qty: 1 }] });
    is(r.code === 429 && /wait a little/.test(r.body.error), 'when the database\'s throttle says too many, the visitor is asked to wait');
    TOO_MANY = false;

    console.log('\nBefore supabase-hardening.sql has been run');
    OLD_DB = true;
    r = await post({ order: BUYER, items: [{ sku: 'SC-1', qty: 1 }] }, { authorization: 'Bearer customer-jwt' });
    c = CALLS[CALLS.length - 1];
    is(r.code === 200 && !('p_customer' in c) && c.p_order.total === 300,
       'the old place_order is used instead, still at the server\'s prices: no order is lost to the upload order');
    OLD_DB = false;

    console.log('\nWhat it refuses');
    r = await place({ httpMethod: 'GET', headers: {} });
    is(r.statusCode === 405, 'anything but POST');
    r = await post({ order: BUYER, items: [] });
    is(r.code === 400, 'an empty order');
    r = await post({ order: BUYER, items: [{ sku: 'BG-1', qty: 0 }] });
    is(r.code === 400, 'a quantity that is not a quantity');
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    r = await post({ order: BUYER, items: [{ sku: 'BG-1', qty: 1 }] });
    is(r.code === 503 && /SUPABASE_SERVICE_ROLE_KEY/.test(r.body.error), 'and says plainly when the service key is missing from Netlify');
    process.env.SUPABASE_SERVICE_ROLE_KEY = key;
  } finally {
    server.close();
  }

  console.log(failures ? '\n  ✗ ' + failures + ' of ' + checks + ' checks FAILED' : '\n  whatsapp orders priced by the server: all ' + checks + ' checks passed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('  ✗ the test itself failed: ' + (e && e.stack || e)); process.exit(1); });
