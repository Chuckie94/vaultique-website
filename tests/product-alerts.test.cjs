/* ===========================================================================
   PRODUCT ALERTS: THE THIRTY-MINUTE JOB (website build 90)

   netlify/functions/product-alerts.js run as Netlify runs it, against a
   stand-in for the platform's catalogue, this website's Supabase and the
   shop's email (the stand-ins of place-order.test.cjs and
   order-progress.test.cjs):

     1. before supabase-shopping.sql: it stops at once, changes nothing;
     2. back in stock: emailed once, with the piece's link and today's price;
        still sold out, hidden, or gone from the catalogue: waits;
     3. a price drop: only when cheaper than when they asked, at the price
        the shop shows (its own price, not the platform's), never for a
        piece priced on request;
     4. two of one customer's pieces: one email, naming both;
     5. sent once: the next run sends nothing; asked again, it waits again;
     6. no email set up: nothing sent, nothing marked; alerts off in
        Settings: nothing; older than 180 days: let go; no service key:
        nothing at all.
   =========================================================================== */
const http = require('http');
const path = require('path');

let checks = 0, failures = 0;
const is = (c, m, x) => { checks++; if (c) console.log('  ✓ ' + m); else { failures++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); } };
const J = o => JSON.stringify(o);
const D = 86400000;
const ago = ms => new Date(Date.now() - ms).toISOString();

let POS, SETTINGS, PRIV, META, DB, MAIL, NO_TABLE;
function reset() {
  POS = [
    { sku: 'BG-1', name: 'Leather Satchel', category: 'Bags', price: 500, stock: 3, active: true },
    { sku: 'SC-1', name: 'Silk Scarf', category: 'Accessories', price: 300, stock: 0, active: true },
    { sku: 'HT-1', name: 'Straw Hat', category: 'Accessories', price: 200, stock: 4, active: true },
    { sku: 'ASK', name: 'Couture Gown', category: 'Dresses', price: 9000, stock: 1, active: true },
    { sku: 'HID', name: 'Hidden Piece', category: 'Bags', price: 700, stock: 2, active: true },
  ];
  SETTINGS = {
    general: { businessName: 'Vaultique', currency: 'ZMW' },
    pricing: { overridesEnabled: true },     // the website's own prices on (Settings > Pricing)
    notifications: { emailEnabled: true, smtpHost: 'smtp.example.com', senderEmail: 'shop@example.com', signature: 'Vaultique' },
    'customer-accounts': { accountsEnabled: true },
  };
  PRIV = { notifications: { smtpPassword: 'x' } };
  META = [{ sku: 'ASK', on_request: true }, { sku: 'HID', hidden: true }, { sku: 'HT-1', price_override: 150 }];
  DB = { product_alerts: [], customers: [{ id: 'c1', name: 'Chanda Banda' }, { id: 'c2', name: 'Mwila Phiri' }] };
  MAIL = [];
  NO_TABLE = false;
}
reset();
let seq = 0;
const alert = (o) => Object.assign({ id: 'a' + (++seq), customer_id: 'c1', email: 'chanda@example.com', name: null,
                                     price_at: null, created_at: ago(60000), sent_at: null, sent_price: null }, o);

const read = req => new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => r(d)); });
function filters(q) {
  const out = [];
  for (const [k, v] of new URLSearchParams(q)) {
    if (['select', 'order', 'limit'].includes(k)) continue;
    const m = /^(eq|neq|in|gt|lt|gte|lte|is)\.(.*)$/.exec(v);
    if (m) out.push([k, m[1], m[2]]);
  }
  return out;
}
function matches(row, fs) {
  return fs.every(([k, op, v]) => {
    const x = row[k] == null ? '' : String(row[k]);
    if (op === 'eq') return x === v;
    if (op === 'lt') return row[k] != null && x < v;
    if (op === 'is') return v === 'null' ? row[k] == null : x === v;
    if (op === 'in') return v.replace(/^\(|\)$/g, '').split(',').includes(x);
    return false;
  });
}
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
  if (p === '/web/rest/v1/site_settings_private') {
    if (!service) return send(401, {});
    const key = (u.searchParams.get('key') || '').replace('eq.', '');
    return send(200, PRIV[key] ? [{ data: PRIV[key] }] : []);
  }
  if (p === '/web/rest/v1/product_meta') return send(200, META);
  if (p === '/web/rest/v1/sold_out_since') return req.method === 'GET' ? send(200, []) : send(201);
  if (p === '/web/rest/v1/customers') {
    if (!service) return send(401, {});
    return send(200, DB.customers.filter(r => matches(r, filters(u.search.slice(1)))));
  }
  if (p === '/web/rest/v1/product_alerts') {
    if (!service) return send(401, {});
    if (NO_TABLE) return send(404, { code: 'PGRST205', message: 'Could not find the table public.product_alerts in the schema cache' });
    const fs = filters(u.search.slice(1));
    if (req.method === 'GET') return send(200, DB.product_alerts.filter(r => matches(r, fs)).map(r => Object.assign({}, r)));
    if (req.method === 'PATCH') {
      const patch = JSON.parse(body);
      const hit = DB.product_alerts.filter(r => matches(r, fs));
      hit.forEach(r => Object.assign(r, patch));
      return /return=minimal/.test(req.headers.prefer || '') ? send(204) : send(200, hit);
    }
    if (req.method === 'DELETE') {
      const hit = DB.product_alerts.filter(r => matches(r, fs));
      DB.product_alerts = DB.product_alerts.filter(r => !hit.includes(r));
      return send(200, hit);
    }
  }
  send(404, { path: p });
});

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const at = 'http://127.0.0.1:' + server.address().port;
  Object.assign(process.env, {
    WEB_SUPABASE_URL: at + '/web', WEB_SUPABASE_ANON_KEY: 'anon-key',
    POS_SUPABASE_URL: at + '/pos', POS_SUPABASE_KEY: 'pos-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key', URL: 'https://vaultiqueboutique.com',
  });
  const F = path.join(__dirname, '..', 'netlify', 'functions');
  require(path.join(F, 'send-email'))._internals.sendMail = async (m) => { MAIL.push(m); };
  const fn = require(path.join(F, 'product-alerts'));
  const run = () => fn._internals.run();
  const row = (id) => DB.product_alerts.find(a => a.id === id);

  try {
    console.log('\n1. Before supabase-shopping.sql');
    NO_TABLE = true;
    let r = await run();
    is(/supabase-shopping\.sql/.test(r.skipped || '') && MAIL.length === 0, 'it stops at once and sends nothing', J(r));
    NO_TABLE = false;

    console.log('\n2. Back in stock');
    reset();
    DB.product_alerts.push(alert({ id: 'b1', sku: 'BG-1', kind: 'back', name: 'Leather Satchel' }),
                           alert({ id: 'b2', sku: 'SC-1', kind: 'back', customer_id: 'c2', email: 'mwila@example.com' }),
                           alert({ id: 'b3', sku: 'HID', kind: 'back', customer_id: 'c2', email: 'mwila@example.com' }),
                           alert({ id: 'b4', sku: 'GONE-1', kind: 'back', customer_id: 'c2', email: 'mwila@example.com' }));
    r = await run();
    let m = MAIL.filter(x => x.to === 'chanda@example.com');
    is(m.length === 1 && m[0].subject === 'Back in stock: Leather Satchel' && /Hello Chanda,/.test(m[0].text) &&
       /Leather Satchel is back in stock, at K\s?500/.test(m[0].text) && /https:\/\/vaultiqueboutique\.com\/product\/BG-1/.test(m[0].text) &&
       /https:\/\/vaultiqueboutique\.com\/account\/alerts/.test(m[0].text),
       'in stock again: emailed, with today\'s price, the piece\'s link and where to stop alerts', m[0] && m[0].text);
    is(row('b1').sent_at && Number(row('b1').sent_price) === 500, 'marked sent, with the price it was sent at');
    is(!MAIL.some(x => x.to === 'mwila@example.com') && !row('b2').sent_at && !row('b3').sent_at && !row('b4').sent_at,
       'still sold out, hidden, or no longer in the catalogue: waits', J(MAIL.map(x => x.subject)));

    console.log('\n3. A price drop');
    reset();
    DB.product_alerts.push(alert({ id: 'p1', sku: 'HT-1', kind: 'price', price_at: 200 }),
                           alert({ id: 'p2', sku: 'BG-1', kind: 'price', price_at: 500, customer_id: 'c2', email: 'mwila@example.com' }),
                           alert({ id: 'p3', sku: 'ASK', kind: 'price', price_at: 9500, customer_id: 'c2', email: 'mwila@example.com' }));
    r = await run();
    m = MAIL.filter(x => x.to === 'chanda@example.com');
    is(m.length === 1 && m[0].subject === 'Price drop: Straw Hat' && /Straw Hat is now K\s?150, down from K\s?200 when you asked\./.test(m[0].text),
       'cheaper than when asked, at the shop\'s own price (150, not the platform\'s 200)', m[0] && m[0].text);
    is(!MAIL.some(x => x.to === 'mwila@example.com') && !row('p2').sent_at && !row('p3').sent_at,
       'the same price: waits; priced on request: never', J(MAIL.map(x => x.to)));

    console.log('\n4. Two pieces, one email');
    reset();
    POS[1].stock = 2;   // the scarf is back
    DB.product_alerts.push(alert({ id: 't1', sku: 'BG-1', kind: 'back' }), alert({ id: 't2', sku: 'SC-1', kind: 'back' }),
                           alert({ id: 't3', sku: 'HT-1', kind: 'price', price_at: 180 }));
    r = await run();
    m = MAIL.filter(x => x.to === 'chanda@example.com');
    is(m.length === 1 && m[0].subject === 'News about pieces you asked about' && /Leather Satchel is back/.test(m[0].text) &&
       /Silk Scarf is back/.test(m[0].text) && /Straw Hat is now K\s?150/.test(m[0].text) && r.emails === 1 && r.sent === 3,
       'one email naming all three', m[0] && m[0].text);

    console.log('\n5. Once');
    r = await run();
    is(MAIL.length === 1 && r.due === 0, 'the next run sends nothing', J(r));
    Object.assign(row('t1'), { sent_at: null, sent_price: null, created_at: ago(1000) });   // asked again
    r = await run();
    is(MAIL.length === 2 && MAIL[1].subject === 'Back in stock: Leather Satchel', 'asked again: sent again, once', J(MAIL.map(x => x.subject)));

    console.log('\n6. When nothing may be sent');
    reset();
    SETTINGS.notifications = { emailEnabled: false };
    DB.product_alerts.push(alert({ id: 'n1', sku: 'BG-1', kind: 'back' }));
    r = await run();
    is(MAIL.length === 0 && !row('n1').sent_at, 'no email set up: nothing sent, nothing marked', J(row('n1')));
    reset();
    SETTINGS['customer-accounts'] = { accountsEnabled: true, productAlerts: false };
    DB.product_alerts.push(alert({ id: 'n2', sku: 'BG-1', kind: 'back' }));
    r = await run();
    is(MAIL.length === 0 && !row('n2').sent_at && /alerts are off/.test(r.skipped || ''), 'alerts off in Settings: nothing', J(r));
    reset();
    DB.product_alerts.push(alert({ id: 'o1', sku: 'SC-1', kind: 'back', created_at: ago(181 * D) }), alert({ id: 'o2', sku: 'SC-1', kind: 'back', created_at: ago(10 * D) }));
    r = await run();
    is(!row('o1') && row('o2') && r.expired === 1, 'waiting more than 180 days: let go; the rest wait', J(r));
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    r = await run();
    is(r.skipped === 'no service key', 'no service key: nothing at all');
    process.env.SUPABASE_SERVICE_ROLE_KEY = key;

    console.log('\n7. Handled as Netlify calls it');
    reset();
    const h = await fn.handler({});
    is(h.statusCode === 200 && JSON.parse(h.body).waiting === 0, 'the scheduled call answers 200 with what it did', h.body);
  } catch (e) {
    failures++;
    console.log('  ✗ the run stopped: ' + (e && e.stack || e));
  } finally {
    server.close();
  }
  console.log(failures ? '\n  ✗ ' + failures + ' of ' + checks + ' checks FAILED' : '\n  product alerts: all ' + checks + ' checks passed');
  process.exit(failures ? 1 : 0);
})();
