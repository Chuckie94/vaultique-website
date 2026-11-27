/* ===========================================================================
   LENCO, THE PRIMARY GATEWAY (website build 88)

   The payment functions run as Netlify runs them, against stand-ins for the
   POS, this website's Supabase, and Lenco. The Lenco stand-in answers the way
   Lenco's API reference (version 2.0) says Lenco answers: Bearer token, the
   /collections/mobile-money request and its fields, /collections/status/
   :reference, the status words (pay-offline, successful, failed), the error
   shape (status false, message, errorCode), and webhooks signed with
   X-Lenco-Signature (HMAC SHA512, keyed with the SHA256 of the API token).
   Its numbers are Lenco's own sandbox test accounts.

   It is a stand-in: it proves what this website does with every answer
   Lenco's reference describes, not that Lenco's servers answer that way.
   That is proved only in Lenco's sandbox, with the shop's own sandbox keys.

   The acceptance list of the brief, numbered as there:
     1-3  Airtel, MTN and Zamtel requests     4  cards: Lenco's window only
     6    verified, then paid                 7  failed     8  pending
     9    timeout (no answer; three hours)    10 the same webhook twice
     11   a webhook not signed by Lenco       12 the wrong amount
     13   the wrong currency                  14 the wrong reference
     15   paid late                           16 the same press twice, a
                                                 second try, paid twice
     17   refunds (Lenco has none)            18 the fifteen-minute check-up
     19   Flutterwave kept, off until switched on
   And the owner's own (build 88, second round): Cancel payment, never a
   second request while the first can still be approved, "Didn't receive
   approval request?" only once a new one can be sent, and cards ready to be
   routed by the customer's answer (a card issued in Zambia, or an
   international card) once a second card gateway exists: never a card
   detail typed on the website, not even the first six digits.
   (5, bank transfer: Lenco's API takes none, so it is never offered.)
   =========================================================================== */
const http = require('http');
const path = require('path');
const crypto = require('crypto');

let checks = 0, failures = 0;
const ok = m => { checks++; console.log('  ✓ ' + m); };
const fail = (m, x) => { checks++; failures++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); };
const is = (c, m, x) => c ? ok(m) : fail(m, x);
const J = (o) => JSON.stringify(o);

const TOKEN_TEST = 'lenco-sandbox-token-0123456789abcdef';
const TOKEN_LIVE = 'lenco-live-token-fedcba9876543210';
const PUB_TEST = 'pub-sandbox-key-123';
const PUB_LIVE = 'pub-live-key-456';

/* ---------------- the world the functions live in ---------------- */
const POS = [
  { sku: 'SC-1', name: 'Silk Scarf', category: 'Accessories', price: 300, stock: 50, active: true },
  { sku: 'BAG', name: 'Leather Tote', category: 'Bags', price: 1200, stock: 5, active: true },
];
let SETTINGS, META, DB, LENCO, FLW, MAIL, PRIV, LENCO_COLUMNS, HITS = 0;
function reset() {
  SETTINGS = {
    general: { businessName: 'Vaultique', currency: 'ZMW' },
    pricing: {},
    payments: { onlineEnabled: true, onlineMode: 'test', onlineCard: true, onlineMobile: true,
                lencoEnabled: true, lencoAirtel: true, lencoMtn: true, lencoZamtel: true, lencoCard: true,
                flwEnabled: false },
    delivery: { payDelivery: false, standardFee: '', freeOver: '' },
    contact: { email: 'shop@example.com' },
    notifications: { emailEnabled: true, smtpHost: 'smtp.example.com', senderEmail: 'shop@example.com' },
  };
  META = [];
  DB = { orders: [], order_items: [], payments: [], payment_webhooks: [], refunds: [] };
  LENCO = { made: [], collections: {}, asked: {}, down: false, slowMs: 0, auth: [] };
  FLW = { made: [], asked: 0 };
  MAIL = [];
  PRIV = { notifications: { smtpPassword: 'x' } };
  LENCO_COLUMNS = true;
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
const ago = (ms) => new Date(Date.now() - ms).toISOString();
let seq = 0;

/* The collection Lenco keeps for one request, as its reference shows it. */
function collection(c) {
  return {
    id: c.id, initiatedAt: c.initiatedAt, completedAt: c.completedAt || null,
    amount: Number(c.amount).toFixed(2), fee: c.fee || null, bearer: 'merchant', currency: c.currency || 'ZMW',
    reference: c.reference, lencoReference: c.lencoReference, type: c.type, status: c.status, source: 'api',
    reasonForFailure: c.reason || null, settlementStatus: c.status === 'successful' ? 'settled' : null, settlement: null,
    mobileMoneyDetails: c.type === 'mobile-money'
      ? { country: 'zm', phone: c.phone, operator: c.operator, accountName: 'Beata Jean', operatorTransactionId: c.status === 'successful' ? 'MP' + c.lencoReference : null }
      : null,
    bankAccountDetails: null,
    cardDetails: c.type === 'card' ? { firstName: 'Test', lastName: 'Buyer', bin: '555555', last4: '4444', cardType: 'Mastercard' } : null,
  };
}
// Lenco's sandbox test accounts (Test Cards and Accounts): how each ends.
const ENDS = {
  '0961111111': ['successful'], '0971111111': ['successful'], '0951111111': ['successful'],
  '0962222222': ['failed', 'Not enough funds'], '0972222222': ['failed', 'Incorrect Pin'],
  '0966666666': ['failed', 'Transaction Timed Out'],
};
const PREFIX = { airtel: ['097', '077'], mtn: ['096', '076'], zamtel: ['095', '075'] };

const server = http.createServer(async (req, res) => {
  HITS++;
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  const body = await read(req);
  const send = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(o === undefined ? '' : JSON.stringify(o)); };
  const service = (req.headers.authorization || '') === 'Bearer service-key';

  if (p === '/pos/rest/v1/app_state') return send(200, [{ id: 100, state: { products: POS } }]);

  // ---- Lenco, as its API reference describes it ----
  if (p.startsWith('/lenco/')) {
    if (LENCO.down) return req.socket.destroy();
    if (LENCO.slowMs) await new Promise(r => setTimeout(r, LENCO.slowMs));
    const auth = req.headers.authorization || '';
    LENCO.auth.push(auth);
    if (auth !== 'Bearer ' + TOKEN_TEST && auth !== 'Bearer ' + TOKEN_LIVE) {
      return send(401, { status: false, message: 'Invalid or missing token', data: null, errorCode: '09' });
    }
    const q = p.replace(/^\/lenco/, '');
    if (q === '/collections/mobile-money' && req.method === 'POST') {
      const b = JSON.parse(body || '{}');
      LENCO.made.push(b);
      if (typeof b.amount !== 'number' || !(b.amount > 0) || !/^[A-Za-z0-9._-]+$/.test(String(b.reference || '')) ||
          !['airtel', 'mtn', 'zamtel'].includes(b.operator) || (b.country && b.country !== 'zm') ||
          (b.bearer && !['merchant', 'customer'].includes(b.bearer))) {
        return send(400, { status: false, message: 'Validation error', data: null, errorCode: '01' });
      }
      if (LENCO.collections[b.reference]) return send(400, { status: false, message: 'Duplicate reference', data: null, errorCode: '04' });
      if (!PREFIX[b.operator].includes(String(b.phone).slice(0, 3)) && b.phone !== '0950000012') {
        return send(400, { status: false, message: 'Invalid mobile number', data: null, errorCode: '12' });
      }
      const c = { id: crypto.randomUUID(), initiatedAt: new Date().toISOString(), amount: b.amount, currency: 'ZMW',
                  reference: b.reference, lencoReference: String(240000000 + (++seq)), type: 'mobile-money',
                  status: b.phone === '0959999999' ? 'otp-required' : 'pay-offline', phone: b.phone, operator: b.operator,
                  end: ENDS[b.phone] || ['successful'] };
      LENCO.collections[b.reference] = c;
      return send(200, { status: true, message: '', data: collection(c) });
    }
    const m = /^\/collections\/status\/(.+)$/.exec(q);
    if (m && req.method === 'GET') {
      const ref = decodeURIComponent(m[1]);
      LENCO.asked[ref] = (LENCO.asked[ref] || 0) + 1;
      const c = LENCO.collections[ref];
      if (!c) return send(404, { status: false, message: 'Payment details was not found', data: null });
      return send(200, { status: true, message: '', data: collection(c) });
    }
    return send(404, { status: false, message: 'Not found', data: null });
  }

  // ---- Flutterwave: never to be called while it is switched off ----
  if (p.startsWith('/flw/')) {
    FLW.asked++;
    if (p === '/flw/payments' && req.method === 'POST') {
      const b = JSON.parse(body);
      FLW.made.push(b);
      return send(200, { status: 'success', data: { link: 'https://checkout.flutterwave.test/pay/' + b.tx_ref } });
    }
    return send(404, { status: 'error' });
  }

  // ---- this website's Supabase ----
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
  if (p === '/web/rest/v1/rpc/preview_ok') return send(200, JSON.parse(body || '{}').p_key === 'shop-preview');
  if (p === '/web/rest/v1/rpc/throttle') return service ? send(204) : send(401, {});
  if (p === '/web/rest/v1/rpc/is_admin') return send(200, (req.headers.authorization || '') === 'Bearer admin-token');
  if (p === '/web/rest/v1/rpc/place_order') {
    const b = JSON.parse(body);
    const id = 'ord-' + (++seq);
    const ref = 'VB-L' + String(seq).padStart(4, '0').slice(-4);
    DB.orders.push(Object.assign({ id, ref, status: 'pending', created_at: new Date().toISOString() }, b.p_order));
    b.p_items.forEach(i => DB.order_items.push(Object.assign({ order_id: id }, i)));
    return send(200, { id, ref });
  }
  if (p === '/web/rest/v1/rpc/pay_expire_stale') {
    if (!service) return send(401, {});
    const cut = ago(3 * 3600000);
    DB.payments.forEach(x => { if (x.status === 'started' && x.created_at < cut) x.status = 'expired'; });
    DB.orders.forEach(o => {
      if (o.payment_method === 'online' && o.payment_status === 'awaiting' && o.created_at < cut &&
          !DB.payments.some(x => x.order_id === o.id && x.status === 'started' && x.created_at >= cut)) {
        o.payment_status = 'expired'; o.status = 'cancelled';
      }
    });
    return send(204);
  }
  const t = /^\/web\/rest\/v1\/(orders|order_items|payments|payment_webhooks|refunds)$/.exec(p);
  if (t) {
    if (!service) return send(401, {});
    const table = DB[t[1]], fs = filters(u.search.slice(1));
    const minimal = /return=minimal/.test(req.headers.prefer || '');
    const sel = u.searchParams.get('select') || '';
    if (t[1] === 'payments' && !LENCO_COLUMNS && /client_key|provider_ref|failure_reason|verified_at/.test(sel)) {
      return send(400, { code: '42703', message: 'column payments.client_key does not exist' });
    }
    if (req.method === 'GET') {
      let rows = table.filter(r => matches(r, fs));
      if (/created_at\.desc/.test(u.searchParams.get('order') || '')) rows = rows.slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      const lim = Number(u.searchParams.get('limit'));
      return send(200, lim >= 0 && u.searchParams.has('limit') ? rows.slice(0, lim) : rows);
    }
    if (req.method === 'POST') {
      const b = JSON.parse(body);
      // supabase-lenco.sql: one press of Pay, one payment
      if (t[1] === 'payments' && b.client_key && table.some(r => r.client_key === b.client_key)) {
        return send(409, { code: '23505', message: 'duplicate key value violates unique constraint "payments_client_key"' });
      }
      const row = Object.assign({ id: t[1] + '-' + (++seq), created_at: new Date().toISOString() },
        t[1] === 'payments' ? { status: 'started', provider: 'flutterwave', asked_at: null } : {},
        t[1] === 'payment_webhooks' ? { at: new Date().toISOString() } : {}, b);
      table.push(row);
      return minimal ? send(201) : send(201, [row]);
    }
    if (req.method === 'PATCH') {
      const patch = JSON.parse(body);
      const hit = table.filter(r => matches(r, fs));
      // supabase-lenco.sql: an order is paid once
      if (t[1] === 'payments' && patch.status === 'paid' &&
          hit.some(r => r.order_id && DB.payments.some(o => o !== r && o.order_id === r.order_id && o.status === 'paid'))) {
        return send(409, { code: '23505', message: 'duplicate key value violates unique constraint "payments_one_paid"' });
      }
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
    FLW_SECRET_KEY_TEST: 'FLWSECK_TEST-secret', FLW_WEBHOOK_HASH: 'my-secret-hash', FLW_API_BASE: base + '/flw',
    LENCO_SECRET_KEY_TEST: TOKEN_TEST, LENCO_PUBLIC_KEY_TEST: PUB_TEST, LENCO_API_BASE_TEST: base + '/lenco',
    URL: 'https://vaultiqueboutique.com',
  });
  delete process.env.LENCO_SECRET_KEY_LIVE;
  delete process.env.LENCO_PUBLIC_KEY_LIVE;
  const F = path.join(__dirname, '..', 'netlify', 'functions');
  require(path.join(F, 'send-email'))._internals.sendMail = async (m) => { MAIL.push(m); };
  const P = require(path.join(F, '_pay'));
  const L = require(path.join(F, '_lenco'));
  L.T.start = 400;     // Lenco's time to answer, shortened for the checks
  L.T.ask = 400;
  const start = require(path.join(F, 'pay-start')).handler;
  const status = require(path.join(F, 'pay-status')).handler;
  const hook = require(path.join(F, 'lenco-webhook')).handler;
  const reconcile = () => require(path.join(F, 'pay-reconcile'))._internals.run();
  const R = require(path.join(F, '_refund'));
  const post = (fn, b, headers) => fn({ httpMethod: 'POST',
    body: JSON.stringify('preview' in b ? b : Object.assign({ preview: 'shop-preview' }, b)), headers: headers || {} })
    .then(r => ({ code: r.statusCode, body: r.body ? JSON.parse(r.body) : null }));
  const get = (fn, q, headers) => fn({ httpMethod: 'GET', queryStringParameters: q, headers: headers || {} })
    .then(r => ({ code: r.statusCode, body: r.body ? JSON.parse(r.body) : null }));
  const sign = (raw, token) => crypto.createHmac('sha512', crypto.createHash('sha256').update(token).digest('hex')).update(raw).digest('hex');
  const notice = (event, c, token, opts) => {
    const raw = JSON.stringify({ event, data: collection(c) }, null, (opts && opts.spaced) ? 2 : 0);
    const signedRaw = (opts && opts.spaced) ? JSON.stringify(JSON.parse(raw)) : raw;   // Lenco's Node sample: JSON written again
    return hook({ httpMethod: 'POST', headers: { 'X-Lenco-Signature': token === null ? undefined : sign(signedRaw, token || TOKEN_TEST) },
                  body: raw }).then(r => r.statusCode);
  };
  const B = (phone) => ({ name: 'Test Buyer', phone, email: 'buyer@example.com', address: 'Plot 1, Lusaka' });
  const payOf = (tx) => DB.payments.find(x => x.tx_ref === tx);
  const orderOf = (tx) => { const p = payOf(tx); return p && DB.orders.find(o => o.id === p.order_id); };
  const finish = (tx) => { const c = LENCO.collections[tx]; c.status = c.end[0]; c.reason = c.end[1] || null; if (c.status === 'successful') c.completedAt = new Date().toISOString(); };
  const keyOf = () => crypto.randomBytes(12).toString('hex');
  let n = 0;
  /* A number of its own for each request: the shop allows five requests an
     hour to one number (so nobody can flood a phone), and the stand-in ends
     any number not in Lenco's sandbox table as successful. */
  let fresh = 100;
  const airtelNo = () => '0971' + String(100000 + (++fresh)).slice(-6);
  const mtnNo = () => '0961' + String(100000 + (++fresh)).slice(-6);
  const momo = (momoNo, network, extra) => post(start, Object.assign({ items: [{ sku: 'SC-1', qty: 1 }], buyer: B('0970' + String(100000 + (++n))),
    fulfilment: 'collection', method: 'mobile', network, momo: momoNo, attempt: keyOf() }, extra || {}));
  const everySecret = [TOKEN_TEST, TOKEN_LIVE, 'service-key', 'FLWSECK_TEST-secret', 'my-secret-hash'];
  const leaks = (o) => everySecret.filter(s => J(o).includes(s));

  try {
    /* ------------------------------------------------------------------ */
    console.log('\nWhat is offered, and who takes it (routes)');
    P._resetLencoDb();
    let r = await get(status, { check: '1' });
    const ways = (r.body.methods || []).map(m => m.key + ':' + m.via);
    is(J(ways) === J(['mobile:prompt', 'card:window']),
       'Mobile Money by a request to the phone, Debit / Credit Card in Lenco\'s window, in that order', J(r.body.methods));
    const mm = (r.body.methods || [])[0] || {};
    is(J((mm.networks || []).map(x => x.label)) === J(['Airtel Money', 'MTN MoMo', 'Zamtel Kwacha']),
       'the three networks Lenco takes in Zambia, by their names', J(mm.networks));
    is(!(r.body.methods || []).some(m => m.key === 'bank'), '5: Instant Bank Transfer is not offered: no gateway here can take one');
    is(!/lenco|flutterwave/i.test(J((r.body.methods || []).map(m => [m.label, (m.networks || []).map(x => x.label)]))),
       'the ways of paying are named by what the customer uses, never by a gateway');
    const cw = (r.body.methods || [])[1] || {};
    is(mm.processor === 'Lenco' && !('processor' in cw) && cw.issuerChoice === false,
       'Mobile Money says who processes it; a card does not (one day the customer\'s answer may decide), and nothing is asked today', J(r.body.methods));
    is(leaks(r.body).length === 0, 'and nothing secret is in the answer', J(leaks(r.body)));

    SETTINGS.payments.lencoMtn = false; SETTINGS.payments.lencoZamtel = false; SETTINGS.payments.lencoCard = false;
    r = await get(status, { check: '1' });
    is(J((r.body.methods || []).map(m => m.key)) === J(['mobile']) && J(r.body.methods[0].networks.map(x => x.key)) === J(['airtel']),
       'only what the shop ticked as activated on its Lenco account is offered', J(r.body.methods));
    SETTINGS.payments.lencoEnabled = false;
    r = await get(status, { check: '1' });
    is((r.body.methods || []).length === 0, 'Lenco switched off: nothing is offered (Flutterwave is off too)', J(r.body.methods));
    SETTINGS.payments.lencoEnabled = true; SETTINGS.payments.lencoMtn = true; SETTINGS.payments.lencoZamtel = true; SETTINGS.payments.lencoCard = true;
    LENCO_COLUMNS = false; P._resetLencoDb();
    r = await get(status, { check: '1' });
    is((r.body.methods || []).length === 0, 'before supabase-lenco.sql is run, Lenco is not offered', J(r.body.methods));
    LENCO_COLUMNS = true; P._resetLencoDb();
    const base2 = process.env.LENCO_API_BASE_TEST;
    delete process.env.LENCO_API_BASE_TEST;
    r = await get(status, { check: '1' });
    is((r.body.methods || []).length === 0, 'Test mode without the sandbox address Lenco gives: not offered, nothing guessed', J(r.body.methods));
    process.env.LENCO_API_BASE_TEST = base2;

    /* ------------------------------------------------------------------ */
    console.log('\n1-3. A mobile money request, on each network');
    for (const [net, num] of [['airtel', '0971111111'], ['mtn', '0961111111'], ['zamtel', '0951111111']]) {
      LENCO.made = [];
      r = await momo(num, net);
      const sent = LENCO.made[0] || {};
      is(r.code === 200 && r.body.via === 'prompt' && /^VB-L\d{4}-[a-f0-9]{10}$/.test(r.body.txRef) && sent.operator === net,
         net + ': Lenco is asked to send the request (' + num + ')', J([r.code, r.body, sent]));
      is(sent.amount === 300 && sent.reference === r.body.txRef && sent.phone === num && sent.country === 'zm' && sent.bearer === 'merchant',
         net + ': for the server\'s price, our reference, the number as Lenco writes it, Zambia, the fee on the shop', J(sent));
      is(r.body.number === num.slice(0, 2) + '******' + num.slice(-2) && !J(r.body).includes(num),
         net + ': the page is told the number only in part (' + num.slice(0, 2) + '******' + num.slice(-2) + ')', J(r.body.number));
      const p = payOf(r.body.txRef);
      is(p && p.provider === 'lenco' && p.method === 'mobile' && p.network === net && p.channel === 'mobile-money' &&
         p.provider_status === 'pay-offline' && p.provider_ref && p.verified_at && p.mode === 'test',
         net + ': the payment row says Lenco, mobile money, the network, and what Lenco said', J(p));
    }
    is(LENCO.auth.every(a => a === 'Bearer ' + TOKEN_TEST), 'Lenco is always asked with the sandbox token, in Test mode');
    LENCO.made = [];
    r = await momo('0961111111', 'airtel');
    is(r.code === 400 && /MTN MoMo number/.test(r.body.error) && LENCO.made.length === 0,
       'an MTN number with Airtel chosen: refused here, nobody\'s phone rings', J(r.body));
    r = await momo('12345', 'airtel');
    is(r.code === 400 && /ten digits/.test(r.body.error) && LENCO.made.length === 0, 'a number that is not one: refused here', J(r.body));
    r = await momo('+260 97 111 1111', 'airtel');
    is(r.code === 200 && LENCO.made[0] && LENCO.made[0].phone === '0971111111', 'typed +260 97 111 1111: sent as 0971111111', J(LENCO.made[0]));
    SETTINGS.payments.lencoZamtel = false;
    r = await momo('0951111111', 'zamtel');
    is(r.code === 400 && /network/.test(r.body.error), 'a network the shop has not ticked cannot be asked for', J(r.body));
    SETTINGS.payments.lencoZamtel = true;
    r = await post(start, { items: [{ sku: 'SC-1', qty: 1 }], buyer: B('0971111111'), fulfilment: 'collection', method: 'mobile',
                            network: 'airtel', momo: '0971111111', attempt: keyOf(), preview: null });
    is(r.code === 403, 'Test mode is the shop\'s own: without the preview key, refused', J(r.body));

    /* ------------------------------------------------------------------ */
    console.log('\n6. Paid only on Lenco\'s word, asked directly');
    r = await momo(airtelNo(), 'airtel');
    let tx = r.body.txRef;
    let s = await get(status, { tx_ref: tx });
    is(s.body.status === 'pending' && s.body.onPhone === true && payOf(tx).status === 'started',
       '8: while the customer has not approved: pending, "approve it on your phone"', J(s.body));
    is(s.body.retryAfter > 80 && s.body.retryAfter <= 90 && r.body.retryAfter === 90,
       'and when the page may ask "Didn\'t receive approval request?": once a new request can be sent (90 seconds)', J([r.body.retryAfter, s.body.retryAfter]));
    finish(tx);
    MAIL = [];
    payOf(tx).asked_at = null;
    s = await get(status, { tx_ref: tx });
    is(s.body.status === 'paid' && payOf(tx).status === 'paid' && orderOf(tx).payment_status === 'paid',
       'approved: Lenco says successful, for our reference and amount: paid', J([s.body, payOf(tx).status]));
    const pd = payOf(tx);
    is(pd.provider_tx_id && pd.provider_ref && pd.confirmed_at && pd.verified_at && pd.provider_response &&
       pd.provider_response.operatorTxId && pd.detail.lenco_ref === pd.provider_ref && pd.channel === 'mobile-money',
       'with Lenco\'s transaction, its reference, when it confirmed, when it was last asked, and what it said', J(pd));
    is(MAIL.length === 2 && /^\[TEST\]/.test(MAIL[0].subject) && /Lenco's sandbox cards and numbers/.test(MAIL[1].text),
       'the customer and the shop are told once, as TEST, naming Lenco\'s sandbox', J(MAIL.map(m => [m.subject, m.text.slice(0, 60)])));

    /* ------------------------------------------------------------------ */
    console.log('\n7. Failed');
    r = await momo('0962222222', 'mtn');
    tx = r.body.txRef;
    finish(tx);
    s = await get(status, { tx_ref: tx });
    is(s.body.status === 'failed' && s.body.reason === 'We were unable to process your payment due to insufficient funds in ' +
       'your mobile money account. Please load your account to complete the transaction.' && s.body.retry === true,
       'Lenco says failed (Not enough funds): "We were unable to process your payment due to insufficient funds..."', J(s.body));
    is(payOf(tx).status === 'failed' && payOf(tx).failure_reason === 'Not enough funds' &&
       orderOf(tx).status === 'cancelled' && orderOf(tx).payment_status === 'failed',
       'the payment keeps Lenco\'s own reason; the order is cancelled, as walked away from', J([payOf(tx), orderOf(tx)]));
    r = await momo('0959999999', 'zamtel');
    is(r.code === 200 && r.body.status === 'failed' && r.body.unsupported && /additional verification step/.test(r.body.reason),
       'a status Lenco\'s reference does not give for this request: not taken further, nothing claimed', J(r.body));
    r = await momo('0972222222', 'airtel');
    finish(r.body.txRef);
    s = await get(status, { tx_ref: r.body.txRef });
    is(/PIN entered was incorrect/.test(s.body.reason), 'a wrong PIN, said as such', s.body.reason);
    r = await momo('0966666666', 'mtn');
    finish(r.body.txRef);
    s = await get(status, { tx_ref: r.body.txRef });
    is(/not authorised in time/.test(s.body.reason), 'timed out, said as such', s.body.reason);
    is(/insufficient funds on your card/.test(L.customerReason('Not enough funds', 'card')) &&
       !/mobile money/.test(L.customerReason('Declined', 'card')),
       'a card\'s reasons speak of the card, never of mobile money', L.customerReason('Declined', 'card'));

    /* ------------------------------------------------------------------ */
    console.log('\n9. No answer from Lenco, and three hours');
    LENCO.down = true;
    r = await momo(airtelNo(), 'airtel');
    LENCO.down = false;
    tx = r.body.txRef;
    is(r.code === 200 && r.body.uncertain === true && payOf(tx).status === 'started' && payOf(tx).provider_status === 'no-answer',
       'Lenco could not be reached: never called failed (the request may be on the phone)', J([r.body, payOf(tx)]));
    LENCO.collections[tx] = { id: crypto.randomUUID(), initiatedAt: new Date().toISOString(), amount: 300, reference: tx,
                              lencoReference: '249999999', type: 'mobile-money', status: 'successful', phone: '0971111111',
                              operator: 'airtel', completedAt: new Date().toISOString(), end: ['successful'] };
    payOf(tx).created_at = ago(10 * 60000);
    let run = await reconcile();
    is(payOf(tx).status === 'paid' && run.paid >= 1, 'it reached Lenco after all and was paid: the check-up finds it', J([run, payOf(tx).status]));
    r = await momo(airtelNo(), 'airtel');
    tx = r.body.txRef;
    payOf(tx).created_at = ago(3 * 3600000 + 60000);
    orderOf(tx).created_at = ago(3 * 3600000 + 60000);
    await reconcile();
    is(payOf(tx).status === 'expired' && orderOf(tx).status === 'cancelled' && orderOf(tx).payment_status === 'expired',
       'never approved for three hours: the attempt expires and its order is cancelled', J([payOf(tx).status, orderOf(tx)]));

    /* ------------------------------------------------------------------ */
    console.log('\n15. Paid late');
    finish(tx);
    MAIL = [];
    payOf(tx).created_at = ago(3 * 3600000 + 120000);
    await reconcile();
    is(payOf(tx).status === 'paid' && orderOf(tx).payment_status === 'paid' && orderOf(tx).status === 'pending',
       'approved after the order had lapsed: paid, and the order brought back', J([payOf(tx).status, orderOf(tx)]));
    is(MAIL.some(m => /^\[CHECK STOCK\]/.test(m.subject) && /refund the customer from your Lenco account/.test(m.text)),
       'the shop is told [CHECK STOCK], and that a refund would be from its Lenco account', J(MAIL.map(m => m.subject)));

    /* ------------------------------------------------------------------ */
    console.log('\n10, 11. Webhooks: signed by Lenco, then asked of Lenco');
    r = await momo(airtelNo(), 'airtel');
    tx = r.body.txRef;
    let c = LENCO.collections[tx];
    let code = await notice('collection.successful', Object.assign({}, c, { status: 'successful' }));
    is(code === 200 && payOf(tx).status === 'started',
       'a signed notice saying successful, while Lenco itself still says pay-offline: not paid (asked, not believed)', J([code, payOf(tx).status]));
    is((LENCO.asked[tx] || 0) >= 1, 'Lenco was asked about it at once');
    finish(tx);
    MAIL = [];
    code = await notice('collection.successful', c);
    is(code === 200 && payOf(tx).status === 'paid' && MAIL.length === 2, 'signed, and Lenco says successful: paid, emails once', J([code, MAIL.length]));
    code = await notice('collection.successful', c);
    is(code === 200 && MAIL.length === 2, '10: the same notice again changes nothing, and sends nothing twice', J([code, MAIL.length]));
    code = await notice('collection.settled', c);
    is(code === 200 && MAIL.length === 2, 'collection.settled, after: nothing more', J(code));
    const logged = DB.payment_webhooks.filter(w => w.reference === tx);
    is(logged.length === 4 && logged.every(w => w.provider === 'lenco' && w.mode === 'test') && /paid/.test(logged[1].outcome),
       'each signed notice is written down: event, reference, mode, and what the site did', J(logged));

    r = await momo(airtelNo(), 'airtel');
    tx = r.body.txRef;
    c = LENCO.collections[tx];
    finish(tx);
    const before = J(payOf(tx));
    code = await notice('collection.successful', c, 'not-the-token');
    is(code === 401 && J(payOf(tx)) === before, '11: signed with anything but the API token: refused, nothing changed', J(code));
    code = await notice('collection.successful', c, null);
    is(code === 401 && J(payOf(tx)) === before, '11: not signed at all: refused, nothing changed', J(code));
    const raw = JSON.stringify({ event: 'collection.successful', data: collection(c) });
    const forged = raw.replace('"amount":"300.00"', '"amount":"3.00"');
    code = (await hook({ httpMethod: 'POST', headers: { 'x-lenco-signature': sign(raw, TOKEN_TEST) }, body: forged })).statusCode;
    is(forged !== raw && code === 401, '11: a value changed after signing (the amount): refused', J(code));
    is(PRIV['pay-health'] && PRIV['pay-health'].lencoRefused >= 3 && PRIV['pay-health'].lencoLastRefusedAt,
       'refusals are counted, with the time, for Settings > Payments (not kept one by one)', J(PRIV['pay-health']));
    code = await notice('collection.successful', c, TOKEN_TEST, { spaced: true });
    is(code === 200 && payOf(tx).status === 'paid', 'signed over the event written again as JSON (Lenco\'s Node sample): accepted', J(code));
    code = (await hook({ httpMethod: 'POST', headers: { 'x-lenco-signature': sign(JSON.stringify({ event: 'transfer.successful', data: { reference: 'TRF-1' } }), TOKEN_TEST) },
                         body: JSON.stringify({ event: 'transfer.successful', data: { reference: 'TRF-1' } }) })).statusCode;
    is(code === 200 && DB.payment_webhooks.some(w => w.event === 'transfer.successful' && w.outcome === 'ignored'),
       'a transfer notice: acknowledged, written down, nothing done', J(code));
    code = await notice('collection.successful', Object.assign({}, c, { reference: 'VB-ZZZZZ-0123456789' }));
    is(code === 200 && DB.payment_webhooks.some(w => w.reference === 'VB-ZZZZZ-0123456789' && w.outcome === 'not ours'),
       'a notice for a reference this site never made: acknowledged, "not ours"', J(code));

    /* ------------------------------------------------------------------ */
    console.log('\n12-14. The wrong amount, the wrong currency, the wrong reference');
    r = await momo(airtelNo(), 'airtel');
    tx = r.body.txRef;
    LENCO.collections[tx].amount = 299;
    finish(tx);
    MAIL = [];
    s = await get(status, { tx_ref: tx });
    is(s.body.status === 'review' && payOf(tx).status === 'review' && orderOf(tx).payment_status === 'review' && orderOf(tx).status === 'pending',
       '12: K299 for a K300 order: never paid; needs attention, the order open', J([s.body, payOf(tx).status, orderOf(tx)]));
    is(MAIL.length === 1 && /needs attention/.test(MAIL[0].subject) && /Lenco reference/.test(MAIL[0].text) && /Lenco dashboard/.test(MAIL[0].text),
       'the shop is told once, with Lenco\'s reference', J(MAIL.map(m => m.subject)));
    payOf(tx).asked_at = null;
    await get(status, { tx_ref: tx });
    is(MAIL.length === 1, 'and not told twice');
    r = await momo(airtelNo(), 'airtel');
    tx = r.body.txRef;
    LENCO.collections[tx].currency = 'USD';
    finish(tx);
    s = await get(status, { tx_ref: tx });
    is(s.body.status === 'review' && payOf(tx).status === 'review', '13: K300 in another currency: never paid; needs attention', J(s.body));
    r = await momo(airtelNo(), 'airtel');
    tx = r.body.txRef;
    finish(tx);
    LENCO.collections[tx].reference = 'VB-OTHER-0123456789';
    s = await get(status, { tx_ref: tx });
    is(s.body.status === 'pending' && payOf(tx).status === 'started',
       '14: an answer naming another reference says nothing about this payment', J([s.body, payOf(tx).status]));

    /* ------------------------------------------------------------------ */
    console.log('\n16. The same press twice; trying the same order again; paid twice');
    const k = keyOf();
    LENCO.made = [];
    const [a1, a2] = await Promise.all([momo(mtnNo(), 'mtn', { attempt: k }), momo(mtnNo(), 'mtn', { attempt: k })]);
    const third = await momo(mtnNo(), 'mtn', { attempt: k });
    is(a1.body.txRef && a1.body.txRef === a2.body.txRef && third.body.txRef === a1.body.txRef &&
       DB.payments.filter(x => x.client_key === k).length === 1 && LENCO.made.length === 1,
       'one press of Pay arriving three times: one payment, one request to the phone', J([a1.body, a2.body, third.body, LENCO.made.length]));
    r = await momo('0972222222', 'airtel');
    const first = r.body.txRef;
    finish(first);
    await get(status, { tx_ref: first });
    is(orderOf(first).status === 'cancelled', 'a wrong PIN: the first try failed, its order cancelled');
    LENCO.made = [];
    r = await momo(airtelNo(), 'airtel', { retry: { txRef: first }, expect: 300 });
    const second = r.body.txRef;
    const ord = DB.orders.find(o => o.ref === first.split('-').slice(0, 2).join('-'));
    is(r.code === 200 && second !== first && second.indexOf(ord.ref + '-') === 0 && LENCO.made.length === 1,
       'Try again: a new payment for the same order, its own reference', J(r.body));
    is(ord.status === 'pending' && ord.payment_status === 'awaiting' && ord.pay_ref === second &&
       DB.payments.filter(x => x.order_id === ord.id).length === 2 && payOf(first).status === 'failed',
       'the order is waiting for its money again; the first try is kept as it was', J([ord, DB.payments.filter(x => x.order_id === ord.id).map(x => x.status)]));
    r = await momo(airtelNo(), 'airtel', { retry: { txRef: second }, expect: 300 });
    is(r.code === 409 && r.body.wait > 0 && /previous payment request is still active/.test(r.body.error) && LENCO.made.length === 1,
       'and again at once, while that request may still be on the phone: no second request, wait', J(r.body));
    r = await momo(airtelNo(), 'airtel', { retry: { txRef: second }, expect: 999 });
    is(r.code === 409 && r.body.restart, 'a page showing another total starts again, never charges a figure not shown', J(r.body));
    payOf(second).created_at = ago(120000);
    r = await momo(mtnNo(), 'mtn', { retry: { txRef: second }, expect: 300 });
    const third2 = r.body.txRef;
    is(r.code === 200 && third2 && DB.payments.filter(x => x.order_id === ord.id).length === 3,
       'after a minute and a half, a new request is allowed', J(r.body));
    finish(second);
    MAIL = [];
    s = await get(status, { tx_ref: second });
    is(s.body.status === 'paid' && ord.payment_status === 'paid' && MAIL.length === 2, 'the second try is approved: paid', J(s.body));
    finish(third2);
    s = await get(status, { tx_ref: third2 });
    is(s.body.status === 'review' && s.body.duplicate === true && payOf(third2).status === 'review' && payOf(third2).detail.duplicate,
       'the third approved too: never counted; it needs attention, as a second payment', J([s.body, payOf(third2)]));
    is(ord.payment_status === 'paid' && Number(ord.paid_amount) === 300 && DB.payments.filter(x => x.order_id === ord.id && x.status === 'paid').length === 1,
       'the order stays paid once, for K300', J(ord));
    is(MAIL.some(m => /Paid twice, refund one/.test(m.subject) && /refund it to the customer from your Lenco account/.test(m.text)),
       'and the shop is told to refund the second, from its Lenco account', J(MAIL.map(m => m.subject)));
    // Two approvals landing at the same moment: the database's own lock decides.
    r = await momo(airtelNo(), 'airtel');
    const x1 = r.body.txRef;
    const o2 = orderOf(x1);
    const x2 = o2.ref + '-' + crypto.randomBytes(5).toString('hex');
    DB.payments.push({ id: 'pay-x2', order_id: o2.id, tx_ref: x2, mode: 'test', amount: 300, currency: 'ZMW', status: 'started',
                       provider: 'lenco', method: 'mobile', created_at: new Date().toISOString(), asked_at: null });
    LENCO.collections[x2] = Object.assign({}, LENCO.collections[x1], { reference: x2, lencoReference: '248888888' });
    finish(x1); finish(x2);
    await Promise.all([get(status, { tx_ref: x1 }), get(status, { tx_ref: x2 })]);
    const both = [payOf(x1).status, payOf(x2).status].sort();
    is(J(both) === J(['paid', 'review']), 'two approvals at the same moment: one paid, the other held as a second payment', J(both));

    /* ------------------------------------------------------------------ */
    console.log('\nCancel payment, and never two live requests for one order');
    const kc = keyOf();
    r = await momo(airtelNo(), 'airtel', { attempt: kc });
    const ctx = r.body.txRef;
    let cr = await post(status, { action: 'cancel', txRef: ctx, attempt: keyOf() });
    is(cr.code === 403 && payOf(ctx).status === 'started', 'Cancel payment sent with another page\'s key: refused, nothing changed', J(cr.body));
    cr = await post(status, { action: 'cancel', txRef: ctx, attempt: kc });
    is(cr.code === 200 && cr.body.status === 'cancelled' && cr.body.onPhone === true && cr.body.retryAfter > 80 && cr.body.retryAfter <= 90,
       'Cancel payment: cancelled; the page is told the request may still be on the phone, and for how long a new one is held', J(cr.body));
    is(payOf(ctx).status === 'failed' && payOf(ctx).detail.reason === 'customer-cancelled' &&
       payOf(ctx).failure_reason === 'Cancelled by the customer at the checkout.' && orderOf(ctx).status === 'cancelled',
       'the attempt is closed as cancelled by the customer, and its order with it', J([payOf(ctx), orderOf(ctx)]));
    s = await get(status, { tx_ref: ctx });
    is(s.body.status === 'cancelled' && s.body.retryAfter > 0, 'asked about again: cancelled, with the same wait', J(s.body));
    LENCO.made = [];
    r = await momo(airtelNo(), 'airtel', { retry: { txRef: ctx }, expect: 300 });
    is(r.code === 409 && r.body.wait > 0 && LENCO.made.length === 0,
       'Try again at once after Cancel payment: no second request while the first may still be approved', J(r.body));
    r = await post(start, { items: [{ sku: 'SC-1', qty: 1 }], buyer: B(airtelNo()), fulfilment: 'collection', method: 'card',
                            attempt: keyOf(), retry: { txRef: ctx }, expect: 300 });
    is(r.code === 409 && r.body.wait > 0 && !r.body.widget, 'nor a card window for the same order', J(r.body));
    finish(ctx);
    payOf(ctx).created_at = ago(4 * 60000);
    MAIL = [];
    await reconcile();
    is(payOf(ctx).status === 'paid' && orderOf(ctx).payment_status === 'paid' && orderOf(ctx).status === 'pending' && MAIL.length >= 2,
       'approved on the phone after Cancel payment: the check-up finds it, and the order is paid after all', J([payOf(ctx).status, orderOf(ctx)]));

    const kp = keyOf();
    r = await momo(airtelNo(), 'airtel', { attempt: kp });
    finish(r.body.txRef);
    MAIL = [];
    cr = await post(status, { action: 'cancel', txRef: r.body.txRef, attempt: kp });
    is(cr.code === 200 && cr.body.status === 'paid' && payOf(r.body.txRef).status === 'paid' && MAIL.length === 2,
       'Cancel payment once Lenco has the money: paid, never cancelled', J(cr.body));

    const kf = keyOf();
    r = await momo(airtelNo(), 'airtel', { attempt: kf });
    const cf = r.body.txRef;
    await post(status, { action: 'cancel', txRef: cf, attempt: kf });
    LENCO.collections[cf].status = 'failed';
    LENCO.collections[cf].reason = 'Transaction Timed Out';
    LENCO.made = [];
    r = await momo(airtelNo(), 'airtel', { retry: { txRef: cf }, expect: 300 });
    is(r.code === 200 && LENCO.made.length === 1 && payOf(cf).provider_status === 'failed' && payOf(cf).detail.reason === 'customer-cancelled',
       'once Lenco has called the cancelled request failed, a new one is sent at once (the old one keeps why it was closed)', J([r.code, r.body, payOf(cf)]));
    payOf(cf).created_at = ago(10 * 60000);
    const af = LENCO.asked[cf] || 0;
    await reconcile();
    is((LENCO.asked[cf] || 0) === af, 'and the check-up does not ask about it again');

    r = await post(start, { items: [{ sku: 'SC-1', qty: 1 }], buyer: B(airtelNo()), fulfilment: 'collection', method: 'card', attempt: keyOf() });
    const cc = r.body.txRef;
    LENCO.collections[cc] = { id: crypto.randomUUID(), initiatedAt: new Date().toISOString(), amount: 300, reference: cc,
                              lencoReference: '246666666', type: 'card', status: 'pending', end: ['successful'] };
    r = await post(start, { items: [{ sku: 'SC-1', qty: 1 }], buyer: B(airtelNo()), fulfilment: 'collection', method: 'card',
                            attempt: keyOf(), retry: { txRef: cc }, expect: 300 });
    is(r.code === 409 && /card payment is still being processed/.test(r.body.error),
       'a card still in the bank\'s check: no second window for the same order', J(r.body));

    /* ------------------------------------------------------------------ */
    console.log('\n4. Cards: Lenco\'s own window, never a card number here');
    LENCO.made = [];
    r = await post(start, { items: [{ sku: 'BAG', qty: 1 }], buyer: B('0971234567'), fulfilment: 'collection', method: 'card', attempt: keyOf() });
    tx = r.body.txRef;
    const w = r.body.widget || {};
    is(r.code === 200 && r.body.via === 'window' && w.script === 'https://pay.sandbox.lenco.co/js/v1/inline.js' && w.key === PUB_TEST &&
       w.reference === tx && w.amount === 1200 && w.currency === 'ZMW' && J(w.channels) === J(['card']) && w.email === 'buyer@example.com',
       'the page is given what Lenco\'s window needs: the sandbox script, the PUBLIC key, our reference, the server\'s price', J(r.body));
    is(leaks(r.body).length === 0 && LENCO.made.length === 0, 'never the API token; and Lenco\'s card API is not called at all', J(leaks(r.body)));
    is(payOf(tx).method === 'card' && payOf(tx).channel === 'card', 'the payment row says card');
    is(r.body.processor === 'Lenco', 'the processor is named with the window, once the card is going there', J(r.body.processor));
    s = await get(status, { tx_ref: tx });
    is(s.body.status === 'pending' && payOf(tx).provider_status === 'not-found', 'before the window is used Lenco knows nothing of it: pending', J(s.body));
    LENCO.collections[tx] = { id: crypto.randomUUID(), initiatedAt: new Date().toISOString(), amount: 1200, reference: tx, lencoReference: '247777777',
                              type: 'card', status: 'successful', completedAt: new Date().toISOString(), end: ['successful'] };
    payOf(tx).asked_at = null;
    s = await get(status, { tx_ref: tx });
    is(s.body.status === 'paid' && payOf(tx).provider_response.cardLast4 === '4444' && !J(payOf(tx)).includes('5555555555554444'),
       'paid in the window: paid, keeping only the card\'s type and last four figures', J(payOf(tx).provider_response));
    is(payOf(tx).detail.card_bin === '555555' && payOf(tx).detail.card_issuer === null,
       'and its BIN (first six digits, as Lenco gives them after the payment, never typed on the website)', J(payOf(tx).detail));

    console.log('\nCards: Zambian or international, the customer\'s answer (ready, routing nothing yet)');
    const CR = require(path.join(F, '_cardroute'));
    const today = { local: 'lenco', international: null }, later = { local: 'lenco', international: 'dpo' };
    is(CR.cardGateway('international', today).gateway === 'lenco' && CR.cardGateway('international', today).why === 'no international card gateway yet' &&
       CR.needsChoice(today) === false,
       'today every card goes to Lenco, an international one too (and says why), and the checkout asks nothing');
    is(CR.cardGateway('local', later).gateway === 'lenco' && CR.cardGateway('international', later).gateway === 'dpo' &&
       CR.cardGateway('', later).gateway === 'lenco' && CR.needsChoice(later) === true,
       'once an international card gateway exists (a later build): Zambian cards to Lenco, international cards to it, and the customer is asked');
    r = await post(start, { items: [{ sku: 'SC-1', qty: 1 }], buyer: B(airtelNo()), fulfilment: 'collection', method: 'card',
                            attempt: keyOf(), cardIssuer: 'international' });
    const routed = payOf(r.body.txRef);
    is(r.code === 200 && J(routed.detail && routed.detail.card_route) === J({ choice: 'international', gateway: 'lenco', why: 'no international card gateway yet' }),
       'the customer\'s answer is kept with the payment, with the gateway it chose and why', J(routed.detail));
    r = await post(start, { items: [{ sku: 'SC-1', qty: 1 }], buyer: B(airtelNo()), fulfilment: 'collection', method: 'card',
                            attempt: keyOf(), cardIssuer: 'somewhere', bin: '4622943127013705' });
    is(r.code === 200 && !(payOf(r.body.txRef).detail || {}).card_route && !J(DB.payments).includes('462294'),
       'card digits sent to the server by anybody are ignored and kept nowhere; an answer that is not one of the two is no answer', J(payOf(r.body.txRef)));
    process.env.CARD_BINS_ZM = '410000, 555555';
    is(CR.issuerOf('5555551234') === 'ZM' && CR.issuerOf('462294') === 'INTL' && CR.issuerOf('12') === '',
       'from the BIN Lenco gives, with the Zambian list in Netlify: on it, Zambian; off it, international; too short, not known');
    LENCO.collections[routed.tx_ref] = { id: crypto.randomUUID(), initiatedAt: new Date().toISOString(), amount: 300, reference: routed.tx_ref,
                                         lencoReference: '245555555', type: 'card', status: 'successful', completedAt: new Date().toISOString(), end: ['successful'] };
    s = await get(status, { tx_ref: routed.tx_ref });
    const after = payOf(routed.tx_ref).detail || {};
    is(s.body.status === 'paid' && after.card_route && after.card_route.choice === 'international' && after.card_bin === '555555' &&
       after.card_issuer === 'ZM' && after.card_choice_right === false,
       'paid: the answer is kept beside the card\'s BIN, and the shop can see the card was in fact Zambian', J(after));
    delete process.env.CARD_BINS_ZM;
    is(CR.issuerOf('555555') === '', 'without the list nothing is guessed');

    /* ------------------------------------------------------------------ */
    console.log('\n17. Refunds: Lenco\'s API has none, and nothing pretends otherwise');
    DB.refunds.push({ id: '11111111-2222-3333-4444-555555555555', state: 'new', order_id: orderOf(tx).id, order_ref: orderOf(tx).ref,
                      payment_id: payOf(tx).id, tx_ref: tx, provider_tx_id: payOf(tx).provider_tx_id, mode: 'test', amount: 1200,
                      currency: 'ZMW', reason: 'Changed mind', created_at: new Date().toISOString() });
    const flwBefore = FLW.asked;
    const rf = await R.send('11111111-2222-3333-4444-555555555555');
    is(rf.ok && rf.refund && rf.refund.state === 'refused' && /Lenco/.test(rf.refund.message) && FLW.asked === flwBefore,
       'a refund of a Lenco payment is refused with Lenco named, and nothing is sent to Flutterwave', J(rf));

    /* ------------------------------------------------------------------ */
    console.log('\n18. The fifteen-minute check-up');
    r = await momo(mtnNo(), 'mtn');
    tx = r.body.txRef;
    payOf(tx).created_at = ago(10 * 60000);
    finish(tx);
    MAIL = [];
    const asked0 = LENCO.asked[tx] || 0;
    run = await reconcile();
    is(payOf(tx).status === 'paid' && MAIL.length === 2 && (LENCO.asked[tx] || 0) === asked0 + 1,
       'a payment nobody came back for is asked about once, found paid, the emails sent', J([run, payOf(tx).status]));
    const failedOne = DB.payments.find(x => x.provider === 'lenco' && x.status === 'failed' && x.detail && x.detail.reason === 'failed');
    failedOne.created_at = ago(20 * 60000);
    const fa = LENCO.asked[failedOne.tx_ref] || 0;
    await reconcile();
    is((LENCO.asked[failedOne.tx_ref] || 0) === fa, 'a payment Lenco called failed is final, and is not asked about again');
    is(PRIV['pay-health'] && PRIV['pay-health'].reconcileAt && PRIV['pay-health'].reconcile && 'checked' in PRIV['pay-health'].reconcile,
       'each run is kept, for Settings > Payments', J(PRIV['pay-health'] && PRIV['pay-health'].reconcile));

    /* ------------------------------------------------------------------ */
    console.log('\n19. Flutterwave: kept as it was, off until switched on');
    SETTINGS.payments.lencoEnabled = false;
    FLW.made = [];
    r = await post(start, { items: [{ sku: 'SC-1', qty: 1 }], buyer: B('0971234567'), fulfilment: 'collection' });
    is(r.code === 503 && FLW.made.length === 0, 'its keys in Netlify but its switch off: nothing is sent to Flutterwave', J(r.body));
    SETTINGS.payments.flwEnabled = true;
    r = await post(start, { items: [{ sku: 'SC-1', qty: 1 }], buyer: B('0971234567'), fulfilment: 'collection' });
    is(r.code === 200 && /^https:\/\/checkout\.flutterwave\.test\//.test(r.body.link) && FLW.made.length === 1 &&
       FLW.made[0].payment_options === 'card, mobilemoneyzambia',
       'switched on: Flutterwave\'s page, exactly as before build 88', J([r.body, FLW.made[0]]));
    SETTINGS.payments.lencoEnabled = true; SETTINGS.payments.lencoCard = false;
    r = await get(status, { check: '1' });
    is(J((r.body.methods || []).map(m => m.key + ':' + m.via)) === J(['mobile:prompt', 'card:page']),
       'both on, cards not activated at Lenco: mobile money through Lenco, cards on Flutterwave\'s page', J(r.body.methods));
    FLW.made = [];
    r = await post(start, { items: [{ sku: 'SC-1', qty: 1 }], buyer: B('0971234567'), fulfilment: 'collection', method: 'card' });
    is(r.code === 200 && FLW.made.length === 1 && FLW.made[0].payment_options === 'card', 'and Flutterwave\'s page offers only the card', J(FLW.made[0]));
    SETTINGS.payments.flwEnabled = false; SETTINGS.payments.lencoCard = true;

    /* ------------------------------------------------------------------ */
    console.log('\nKeys, asked about without charging anybody');
    r = await post(status, { action: 'test-keys' }, { authorization: 'Bearer admin-token' });
    r = await status({ httpMethod: 'POST', queryStringParameters: { check: '1' }, body: J({ action: 'test-keys' }),
                       headers: { authorization: 'Bearer admin-token' } }).then(x => JSON.parse(x.body));
    is(r.lencoTest === 'accepted' && r.lencoLive === 'missing', 'the sandbox token: accepted; the live one: not installed', J(r));
    process.env.LENCO_SECRET_KEY_TEST = 'a-token-lenco-does-not-know';
    r = await status({ httpMethod: 'POST', queryStringParameters: { check: '1' }, body: J({ action: 'test-keys' }),
                       headers: { authorization: 'Bearer admin-token' } }).then(x => JSON.parse(x.body));
    is(r.lencoTest === 'refused', 'a token Lenco does not know: refused', J(r));
    process.env.LENCO_SECRET_KEY_TEST = TOKEN_TEST;
    const anon = await get(status, { check: '1' });
    const admin = await get(status, { check: '1' }, { authorization: 'Bearer admin-token' });
    is(!('lencoSetup' in anon.body) && admin.body.lencoSetup && admin.body.lencoSetup.test.secret === true &&
       admin.body.lencoDb === true && leaks(admin.body).length === 0,
       'which Lenco keys are there: told to an administrator only, never a value', J([anon.body.lenco, admin.body.lencoSetup]));
  } catch (e) {
    fail('threw: ' + (e && e.stack || e));
  } finally {
    server.close();
  }
  console.log('\n' + (failures ? '  ✗ ' + failures + ' of ' + checks + ' checks FAILED'
                               : '  Lenco, the website\'s side: all ' + checks + ' checks passed'));
  process.exit(failures ? 1 : 0);
})();
