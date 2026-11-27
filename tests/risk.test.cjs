/* ===========================================================================
   THE FRAUD CHECK (website build 91)

   The engine (_risk.js) on its own, then the payment functions as Netlify
   runs them, against stand-ins for the POS, this website's Supabase (with
   supabase-risk.sql's tables and questions), Lenco and Flutterwave:

     - watching (the starting mode, decision D5): everything scored and
       recorded, nothing held or refused, each case saying what acting would
       have done
     - acting: Critical refused before any gateway is asked, with words that
       say nothing about why; High carried to the payment and held when it is
       paid (never marked paid, the till leaves it alone), one email to the
       shop; a refund the check holds is not sent
     - approving a held payment: marked paid only on the gateway's own word,
       asked again, with the customer's confirmation email, once
     - a WhatsApp order is scored and marked, never refused
     - off, not set up, or the check itself failing: everything goes on
       exactly as before build 91; a payment already held stays held
     - the fifteen-minute watch: the team's activity, approved holds,
       escalations, the record's anchor

   The database's own rules (who reads a case, one case per payment, the
   sealed record) are checked against PostgreSQL in tests/risk.sql.
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
const POS = [
  { sku: 'SC-1', name: 'Silk Scarf', category: 'Accessories', price: 300, stock: 50, active: true },
  { sku: 'BAG', name: 'Leather Tote', category: 'Bags', price: 1200, stock: 5, active: true },
];
let SETTINGS, DB, LENCO, FLW, MAIL, PRIV, RATE, STAFF, EXTRA, BROKEN, ANCHORS, seq = 0;
function reset() {
  SETTINGS = {
    general: { businessName: 'Vaultique', currency: 'ZMW' },
    pricing: {},
    payments: { onlineEnabled: true, onlineMode: 'test', onlineCard: true, onlineMobile: true,
                lencoEnabled: true, lencoAirtel: true, lencoMtn: true, lencoZamtel: true, lencoCard: true, flwEnabled: false },
    delivery: { payDelivery: false, standardFee: '', freeOver: '' },
    contact: { email: 'shop@example.com' },
    notifications: { emailEnabled: true, smtpHost: 'smtp.example.com', senderEmail: 'shop@example.com' },
  };
  DB = { orders: [], order_items: [], payments: [], refunds: [], risk_cases: [], admins: [
    { id: 'owner-1', email: 'owner@example.com', role: 'owner' }] };
  LENCO = { made: [], collections: {} };
  FLW = { made: [], verify: {}, refunds: [] };
  MAIL = [];
  PRIV = { notifications: { smtpPassword: 'x' } };
  RATE = [];
  STAFF = [];
  EXTRA = {};          // counts the stand-in adds to its own, to make a case as risky as wanted
  BROKEN = {};         // a question the stand-in fails: { facts: 404 | 500, cases: 500, casesGet: 500 }
  ANCHORS = 0;
}
reset();

const read = req => new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => r(d)); });
function filters(q) {
  const out = [];
  for (const [k, v] of new URLSearchParams(q)) {
    if (['select', 'order', 'limit'].includes(k)) continue;
    if (k === 'or') { out.push(['or', 'or', v]); continue; }
    const m = /^(eq|neq|in|gt|lt|is)\.(.*)$/.exec(v);
    if (m) out.push([k, m[1], m[2]]);
  }
  return out;
}
function one(row, k, op, v) {
  const x = row[k] == null ? '' : String(row[k]);
  if (op === 'eq') return x === v;
  if (op === 'neq') return x !== v;
  if (op === 'gt') return row[k] != null && x > v;
  if (op === 'lt') return row[k] != null && x < v;
  if (op === 'is') return v === 'null' ? row[k] == null : x === v;
  if (op === 'in') return v.replace(/^\(|\)$/g, '').split(',').map(s => s.replace(/^"|"$/g, '')).includes(x);
  return true;
}
function matches(row, fs) {
  return fs.every(([k, op, v]) => {
    if (op === 'or') {
      // or=(risk_level.is.null,risk_level.in.(low,medium))
      const inner = v.replace(/^\(|\)$/g, '');
      const parts = inner.match(/[a-z_]+\.(?:is|eq|in)\.(?:\([^)]*\)|[^,]+)/g) || [];
      return parts.some((p) => { const m = /^([a-z_]+)\.(is|eq|in)\.(.*)$/.exec(p); return m && one(row, m[1], m[2], m[3]); });
    }
    return one(row, k, op, v);
  });
}
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const digits9 = (p) => String(p || '').replace(/\D/g, '').slice(-9);
/* risk_facts, as supabase-risk.sql answers it, from the stand-in's rows. */
function factsOf(p) {
  const day = ago(86400000);
  const ph = digits9(p.phone), em = String(p.email || '').trim().toLowerCase();
  const out = {};
  if (ph.length >= 7) {
    out.ordersPhone = DB.orders.filter(o => o.created_at > day && digits9(o.phone) === ph).length;
    out.failedPhone = DB.payments.filter(y => y.created_at > day && y.status === 'failed' && digits9(y.phone) === ph).length;
    out.refundsPhone90 = DB.refunds.filter(f => ['refused', 'failed'].indexOf(f.state) < 0 &&
      digits9((DB.orders.find(o => o.id === f.order_id) || {}).phone) === ph).length;
  }
  if (em.indexOf('@') > -1) out.ordersEmail = DB.orders.filter(o => o.created_at > day && String(o.email || '').toLowerCase() === em).length;
  if (p.client) {
    out.ordersClient = RATE.filter(r => r.bucket === 'order' && r.key === p.client).length;
    out.refusedClient = RATE.filter(r => r.bucket === 'refused' && r.key === p.client).length;
  }
  if (p.customer) out.ordersAccount = DB.orders.filter(o => o.customer_id === p.customer).length;
  if (p.order_id) {
    out.paymentRefs = DB.payments.filter(y => y.order_id === p.order_id).length;
    out.failedOrder = DB.payments.filter(y => y.order_id === p.order_id && y.status === 'failed').length;
  }
  const tot = DB.orders.filter(o => o.status !== 'cancelled' && Number(o.total) > 0).map(o => Number(o.total)).sort((a, b) => a - b);
  out.usualTotal = tot.length ? tot[Math.floor(tot.length / 2)] : null;
  out.usualOf = tot.length;
  Object.keys(EXTRA).forEach((k) => { out[k] = (Number(out[k]) || 0) + EXTRA[k]; });
  return out;
}
const ONE = { payment_start: 'tx_ref', payment_paid: 'tx_ref', refund: 'refund_id', order_placed: 'order_id' };

function collection(c) {
  return {
    id: c.id, initiatedAt: c.initiatedAt, completedAt: c.completedAt || null, amount: Number(c.amount).toFixed(2), fee: null,
    bearer: 'merchant', currency: 'ZMW', reference: c.reference, lencoReference: c.lencoReference, type: 'mobile-money',
    status: c.status, source: 'api', reasonForFailure: null, settlementStatus: null, settlement: null,
    mobileMoneyDetails: { country: 'zm', phone: c.phone, operator: c.operator, accountName: 'Test', operatorTransactionId: null },
    bankAccountDetails: null, cardDetails: null,
  };
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  const body = await read(req);
  const send = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(o === undefined ? '' : JSON.stringify(o)); };
  const service = (req.headers.authorization || '') === 'Bearer service-key';

  if (p === '/pos/rest/v1/app_state') return send(200, [{ id: 100, state: { products: POS } }]);

  if (p.startsWith('/lenco/')) {
    if ((req.headers.authorization || '') !== 'Bearer ' + TOKEN_TEST) return send(401, { status: false, message: 'Invalid token', errorCode: '09' });
    const q = p.replace(/^\/lenco/, '');
    if (q === '/collections/mobile-money' && req.method === 'POST') {
      const b = JSON.parse(body || '{}');
      LENCO.made.push(b);
      const c = { id: crypto.randomUUID(), initiatedAt: new Date().toISOString(), amount: b.amount, reference: b.reference,
                  lencoReference: String(240000000 + (++seq)), status: 'pay-offline', phone: b.phone, operator: b.operator };
      LENCO.collections[b.reference] = c;
      return send(200, { status: true, message: '', data: collection(c) });
    }
    const m = /^\/collections\/status\/(.+)$/.exec(q);
    if (m) {
      const c = LENCO.collections[decodeURIComponent(m[1])];
      if (!c) return send(404, { status: false, message: 'Payment details was not found', data: null });
      return send(200, { status: true, message: '', data: collection(c) });
    }
    return send(404, { status: false });
  }

  if (p.startsWith('/flw/')) {
    if (p === '/flw/payments' && req.method === 'POST') {
      const b = JSON.parse(body); FLW.made.push(b);
      return send(200, { status: 'success', data: { link: 'https://checkout.flutterwave.test/pay/' + b.tx_ref } });
    }
    if (p === '/flw/transactions/verify_by_reference') {
      const v = FLW.verify[u.searchParams.get('tx_ref')];
      return v ? send(200, { status: 'success', data: v }) : send(404, { status: 'error', message: 'No transaction' });
    }
    const rf = /^\/flw\/transactions\/(\d+)\/refund$/.exec(p);
    if (rf && req.method === 'POST') {
      const b = JSON.parse(body); FLW.refunds.push(Object.assign({ tx: rf[1] }, b));
      return send(200, { status: 'success', data: { id: 7000 + FLW.refunds.length, tx_id: Number(rf[1]), amount_refunded: b.amount,
                                                     status: 'completed', flw_ref: 'FLW-RF-' + FLW.refunds.length, created_at: new Date().toISOString() } });
    }
    return send(404, { status: 'error' });
  }

  if (p === '/web/rest/v1/site_settings') {
    const key = (u.searchParams.get('key') || '').replace('eq.', '');
    return send(200, SETTINGS[key] ? [{ data: SETTINGS[key] }] : []);
  }
  if (p === '/web/rest/v1/site_settings_private') {
    if (!service) return send(401, {});
    const raw = u.searchParams.get('key') || '';
    const keys = raw.startsWith('in.') ? raw.slice(4, -1).split(',') : [raw.replace('eq.', '')];
    return send(200, keys.filter(k => PRIV[k]).map(k => ({ key: k, data: PRIV[k] })));
  }
  if (p === '/web/rest/v1/product_meta') return send(200, []);
  if (p === '/web/rest/v1/rpc/preview_ok') return send(200, JSON.parse(body || '{}').p_key === 'shop-preview');
  if (p === '/web/rest/v1/rpc/throttle') {
    if (!service) return send(401, {});
    const b = JSON.parse(body || '{}'); RATE.push({ bucket: b.p_bucket, key: b.p_key });
    return send(204);
  }
  if (p === '/web/rest/v1/rpc/is_admin') return send(200, /^Bearer (admin|risk)-token$/.test(req.headers.authorization || ''));
  if (p === '/web/rest/v1/rpc/may_risk') return send(200, (req.headers.authorization || '') === 'Bearer risk-token');
  if (p === '/web/rest/v1/rpc/place_order') {
    const b = JSON.parse(body);
    const id = 'ord-' + (++seq);
    const ref = 'VB-R' + String(seq).padStart(4, '0').slice(-4);
    DB.orders.push(Object.assign({ id, ref, status: 'pending', created_at: new Date().toISOString(), customer_id: b.p_customer || null }, b.p_order));
    b.p_items.forEach(i => DB.order_items.push(Object.assign({ order_id: id }, i)));
    if (b.p_client) RATE.push({ bucket: 'order', key: b.p_client });
    return send(200, { id, ref });
  }
  if (p === '/web/rest/v1/rpc/pay_expire_stale') return send(204);
  if (p === '/web/rest/v1/rpc/risk_facts') {
    if (!service) return send(401, {});
    if (BROKEN.facts) return send(BROKEN.facts, BROKEN.facts === 404 ? { code: 'PGRST202', message: 'Could not find the function public.risk_facts' } : { message: 'boom' });
    return send(200, factsOf(JSON.parse(body || '{}').p || {}));
  }
  if (p === '/web/rest/v1/rpc/risk_refund_facts') {
    if (!service) return send(401, {});
    const f = DB.refunds.find(r => r.id === JSON.parse(body || '{}').p_refund) || {};
    return send(200, Object.assign({ hoursSincePaid: f._hours != null ? f._hours : 48, refundsByStaffToday: DB.refunds.filter(r => r.by_name === f.by_name).length,
                                     amount: f.amount, orderId: f.order_id, orderRef: f.order_ref, whole: f.whole }, EXTRA.refund || {}));
  }
  if (p === '/web/rest/v1/rpc/risk_staff_facts') return service ? send(200, STAFF) : send(401, {});
  if (p === '/web/rest/v1/rpc/audit_anchor') { if (!service) return send(401, {}); ANCHORS++; return send(200, { ok: true, anchored: true }); }

  const t = /^\/web\/rest\/v1\/(orders|order_items|payments|refunds|risk_cases|admins)$/.exec(p);
  if (t) {
    if (!service) return send(401, {});
    if (t[1] === 'risk_cases' && BROKEN.cases) return send(404, { code: 'PGRST205', message: 'Could not find the table public.risk_cases' });
    if (t[1] === 'risk_cases' && req.method === 'GET' && BROKEN.casesGet) return send(500, { message: 'down' });
    const table = DB[t[1]], fs = filters(u.search.slice(1));
    const minimal = /return=minimal/.test(req.headers.prefer || '');
    if (req.method === 'GET') {
      let rows = table.filter(r => matches(r, fs));
      if (/desc/.test(u.searchParams.get('order') || '')) rows = rows.slice().reverse();
      const lim = Number(u.searchParams.get('limit'));
      return send(200, u.searchParams.has('limit') ? rows.slice(0, lim) : rows);
    }
    if (req.method === 'POST') {
      const b = JSON.parse(body);
      if (t[1] === 'payments' && b.client_key && table.some(r => r.client_key === b.client_key)) {
        return send(409, { code: '23505', message: 'duplicate key value violates unique constraint "payments_client_key"' });
      }
      if (t[1] === 'risk_cases') {
        const col = ONE[b.moment];
        if (col && b[col] && table.some(r => r.moment === b.moment && r[col] === b[col])) {
          return send(409, { code: '23505', message: 'duplicate key value violates unique constraint "risk_cases_one_' + b.moment + '"' });
        }
      }
      const row = Object.assign({ id: (t[1] === 'risk_cases' ? crypto.randomUUID() : t[1] + '-' + (++seq)), created_at: new Date().toISOString() },
        t[1] === 'payments' ? { status: 'started', provider: 'flutterwave', asked_at: null, detail: null } : {},
        t[1] === 'risk_cases' ? { at: new Date().toISOString(), review_state: 'none', released_at: null, alerted_at: null } : {}, b);
      table.push(row);
      return minimal ? send(201) : send(201, [row]);
    }
    if (req.method === 'PATCH') {
      const patch = JSON.parse(body);
      const hit = table.filter(r => matches(r, fs));
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
    LENCO_SECRET_KEY_TEST: TOKEN_TEST, LENCO_PUBLIC_KEY_TEST: 'pub-test', LENCO_API_BASE_TEST: base + '/lenco',
    URL: 'https://vaultiqueboutique.com',
  });
  delete process.env.LENCO_SECRET_KEY_LIVE;
  const F = path.join(__dirname, '..', 'netlify', 'functions');
  require(path.join(F, 'send-email'))._internals.sendMail = async (m) => { MAIL.push(m); };
  const P = require(path.join(F, '_pay'));
  const L = require(path.join(F, '_lenco'));
  L.T.start = 400; L.T.ask = 400;
  const RISK = require(path.join(F, '_risk'));
  const start = require(path.join(F, 'pay-start')).handler;
  const status = require(path.join(F, 'pay-status')).handler;
  const placeOrder = require(path.join(F, 'place-order')).handler;
  const release = require(path.join(F, 'risk-release')).handler;
  const watch = () => require(path.join(F, 'risk-watch'))._internals.run();
  const reconcile = () => require(path.join(F, 'pay-reconcile'))._internals.run();
  const R = require(path.join(F, '_refund'));
  const call = (fn, method, b, headers, q) => fn({ httpMethod: method, queryStringParameters: q || {},
    body: b === undefined ? undefined : JSON.stringify(b), headers: headers || {} })
    .then(r => ({ code: r.statusCode, body: r.body ? JSON.parse(r.body) : null }));
  const post = (fn, b, h) => call(fn, 'POST', 'preview' in b ? b : Object.assign({ preview: 'shop-preview' }, b), h);
  const caseOf = (moment, tx) => DB.risk_cases.filter(c => c.moment === moment && (!tx || c.tx_ref === tx));
  const payOf = (tx) => DB.payments.find(x => x.tx_ref === tx);
  const orderOf = (tx) => { const y = payOf(tx); return y && DB.orders.find(o => o.id === y.order_id); };
  const keyOf = () => crypto.randomBytes(12).toString('hex');
  const setMode = (mode, extra) => { PRIV.risk = Object.assign({ mode }, extra || {}); RISK.forget(); };
  let n = 0;
  const buyer = (email) => ({ name: 'Test Buyer', phone: '0970' + String(200000 + (++n)), email: email || 'buyer@gmail.com', address: 'Plot 1, Lusaka' });
  const momo = (b, extra) => post(start, Object.assign({ items: [{ sku: 'SC-1', qty: 1 }], buyer: b, fulfilment: 'collection',
    method: 'mobile', network: 'airtel', momo: '0971' + String(300000 + (++n)), attempt: keyOf() }, extra || {}),
    { 'x-nf-client-connection-ip': '10.0.0.' + (n % 250) });
  const paid = (tx) => { const c = LENCO.collections[tx]; c.status = 'successful'; c.completedAt = new Date().toISOString(); };
  const FRAUD_WORDS = /fraud|risk|score|points|suspicious|signal/i;
  const MOST = { ordersPhone: 6, failedPhone: 6, ordersEmail: 6 };   // 30 + 30 + 30 = 90: Critical
  const HIGH = { ordersPhone: 6, failedPhone: 6 };                   // 30 + 30 = 60: High

  try {
    /* ------------------------------------------------------------------ */
    console.log('\nThe engine on its own');
    const D = RISK.merge(null);
    is(D.mode === 'watch' && D.medium === 30 && D.high === 60 && D.critical === 90,
       'with nothing saved it watches (decision D5), with Medium from 30, High from 60, Critical from 90 points');
    is(RISK.merge({ mode: 'act', high: 20, medium: 40, critical: 10 }).high === 41 &&
       RISK.merge({ mode: 'act', high: 20, medium: 40, critical: 10 }).critical === 42,
       'the levels always rise, whatever is saved');
    is(RISK.merge({ mode: 'everything' }).mode === 'watch' && RISK.merge({ w_refused: -5 }).weights.refused === 25 &&
       RISK.merge({ w_refused: 'x' }).weights.refused === 25 && RISK.merge({ w_refused: 0 }).weights.refused === 0,
       'a mode it does not know, or a weight that is not a number, is the default; 0 switches a signal off');
    const single = Object.keys(D.weights).map((k) => [k, D.weights[k] * 2]).filter(([, v]) => v >= D.high);
    is(single.length === 0, 'no single signal reaches High on its own with the starting figures, even at twice its limit', J(single));
    let s = RISK.score('payment_start', {}, { email: 'ann@gmail.com', phone: '0977123456' }, D);
    is(s.level === 'low' && s.score === 0 && s.reasons.length === 0, 'an ordinary payment: Low, no points, no reasons');
    s = RISK.score('payment_start', { ordersPhone: 3 }, {}, D);
    is(s.score === 15 && s.level === 'low' && /3 orders from this phone number in a day/.test(s.reasons[0].said),
       'three orders from one phone in a day: 15 points, said in plain words');
    s = RISK.score('payment_start', { ordersPhone: 6 }, {}, D);
    is(s.score === 30 && s.level === 'medium', 'six (twice the limit): twice the points, Medium');
    s = RISK.score('payment_start', HIGH, { email: 'x@mailinator.com' }, D);
    is(s.level === 'high' && s.score === 80 && s.reasons.some(r => /throwaway/.test(r.said)),
       'six orders and six failed payments from one phone, and a throwaway email: 80 points, High');
    s = RISK.score('payment_start', MOST, { email: 'test@gmail.com' }, D);
    is(s.level === 'critical' && s.score === 110, 'with orders from one email too, and a made-up address: Critical');
    is(RISK.emailOdd('no-at-sign') && RISK.emailOdd('qwerty@gmail.com') && !RISK.emailOdd('chanda.mwansa@gmail.com') && !RISK.emailOdd(''),
       'an email that is not an address, or looks made up, is noticed; a real one and none at all are not');
    is(RISK.phoneOdd('0977777777') && RISK.phoneOdd('0961234567') && RISK.phoneOdd('123') && !RISK.phoneOdd('0977123456') &&
       !RISK.phoneOdd('+260 96 4512378') && !RISK.phoneOdd('0955 818 202'),
       'a phone number of one digit repeated, counting up, or too short, is noticed; real Zambian numbers are not');
    s = RISK.score('payment_start', { usualTotal: 400, usualOf: 30 }, { total: 2400 }, D);
    is(s.reasons.some(r => r.signal === 'basketHigh' && /6 times the shop/.test(r.said)), 'an order six times the shop’s usual is noticed');
    s = RISK.score('payment_start', { usualTotal: 400, usualOf: 5 }, { total: 2400 }, D);
    is(!s.reasons.some(r => r.signal === 'basketHigh'), 'but not before the shop has 20 orders to tell what usual is');
    s = RISK.score('payment_paid', {}, { floor: { level: 'high', score: 70 } }, D);
    is(s.level === 'high' && s.reasons.some(r => r.signal === 'carried'), 'a level carried from the start of the payment is kept when it is paid');
    s = RISK.score('refund', { refundsPhone90: 4, hoursSincePaid: 0.5 }, {}, D);
    is(s.level === 'high' && s.score === 65, 'a refund: four for the same customer in 90 days, asked within the hour of the payment: High');
    s = RISK.score('staff', { deletes: 25, roles: 7 }, {}, D);
    is(s.level === 'critical' && s.score === 100, 'the team: many deletions and role changes in an hour together: Critical');
    is(J(['low', 'medium', 'high', 'critical'].map(l => RISK.actionFor('payment_start', l))) === J(['none', 'shown', 'shown', 'refused']) &&
       J(['low', 'medium', 'high', 'critical'].map(l => RISK.actionFor('payment_paid', l))) === J(['none', 'shown', 'held', 'held']) &&
       J(['low', 'medium', 'high', 'critical'].map(l => RISK.actionFor('refund', l))) === J(['none', 'shown', 'refused', 'refused']) &&
       J(['low', 'medium', 'high', 'critical'].map(l => RISK.actionFor('order_placed', l))) === J(['none', 'shown', 'shown', 'shown']),
       'what each level does at each moment: a start refused only when Critical, a payment held from High, a WhatsApp order never refused');
    is(J(RISK.decide('payment_start', 'critical', 'watch')) === J({ action: 'none', would: 'refused' }) &&
       J(RISK.decide('payment_start', 'critical', 'act')) === J({ action: 'refused', would: 'refused' }),
       'watching, nothing is done and the case says what would have been; acting, it is done');
    is(!FRAUD_WORDS.test(RISK.REFUSED_SAID) && /nothing has been charged/i.test(RISK.REFUSED_SAID),
       'what a refused customer is told says nothing about why, and that nothing was charged');

    /* ------------------------------------------------------------------ */
    console.log('\nWatching (the starting mode)');
    reset();
    EXTRA = MOST;
    let r = await momo(buyer('qwerty@gmail.com'));
    let tx = r.body && r.body.txRef;
    is(r.code === 200 && LENCO.made.length === 1, 'a Critical payment goes ahead while the check watches: the request reaches the phone', J(r.body));
    let c = caseOf('payment_start', tx)[0];
    is(c && c.level === 'critical' && c.mode === 'watch' && c.action === 'none' && c.would === 'refused' && c.review_state === 'open',
       'its case: Critical, watching, nothing done, "would have refused", waiting for review', J(c));
    is(orderOf(tx).risk_level === 'critical', 'the order carries its level, for Admin > Orders');
    is(MAIL.length === 1 && /Fraud check: Critical/.test(MAIL[0].subject) && /only watching/.test(MAIL[0].text) &&
       MAIL[0].to === 'shop@example.com', 'a Critical case is emailed to the shop once, saying the check only watched', J(MAIL.map(m => m.subject)));
    is(!FRAUD_WORDS.test(J(r.body)), 'the customer’s page is told nothing about the check');
    paid(tx);
    r = await call(status, 'GET', undefined, {}, { tx_ref: tx });
    is(r.body.status === 'paid' && payOf(tx).status === 'paid' && orderOf(tx).payment_status === 'paid',
       'paid as usual when Lenco says so', J(r.body));
    c = caseOf('payment_paid', tx)[0];
    is(c && c.mode === 'watch' && c.action === 'none' && c.would === 'held' && c.level === 'critical',
       'the payment’s own case: Critical (carried from its start), nothing done, "would have held"', J(c));
    is(MAIL.some(m => m.to === 'buyer@gmail.com' || /Order|order/.test(m.subject)), 'the customer’s confirmation goes as usual');

    /* ------------------------------------------------------------------ */
    console.log('\nActing: Critical refused before any gateway is asked');
    reset();
    setMode('act');
    EXTRA = MOST;
    r = await momo(buyer('qwerty@gmail.com'));
    is(r.code === 403 && r.body.refused && r.body.error === RISK.REFUSED_SAID && LENCO.made.length === 0,
       'refused with the neutral words, and no request ever reaches the customer’s phone', J(r.body));
    let y = DB.payments[0], o = DB.orders[0];
    is(y && y.status === 'failed' && y.detail.reason === 'risk-refused' && o.status === 'cancelled' && o.payment_status === 'failed',
       'the attempt is closed and its order cancelled, nothing left awaiting payment', J([y, o]));
    c = caseOf('payment_start')[0];
    is(c && c.action === 'refused' && c.mode === 'act' && c.review_state === 'open', 'the case says it was refused, and waits for review');
    is(!FRAUD_WORDS.test(J(r.body)) && !/reasons|ordersPhone/.test(J(r.body)), 'and the answer carries no reason, score or signal');
    // The same press again: the same answer, still nothing sent.
    const again = await post(start, { items: [{ sku: 'SC-1', qty: 1 }], buyer: buyer(), fulfilment: 'collection', method: 'mobile',
                                       network: 'airtel', momo: '0971555001', attempt: y.client_key || 'none' });
    is(again.code === 200 && again.body.refused === true && again.body.reason === RISK.REFUSED_SAID && LENCO.made.length === 0,
       'the same press arriving again gets the same neutral answer, and still nothing reaches the phone', J(again.body));

    console.log('\nActing: a try again is checked like a first try');
    reset();
    setMode('act');
    r = await momo(buyer());
    tx = r.body.txRef;
    LENCO.collections[tx].status = 'failed';
    r = await call(status, 'GET', undefined, {}, { tx_ref: tx });
    is(r.body.status === 'failed' && orderOf(tx).payment_status === 'failed', 'the first try failed on the phone (Lenco says so)', J(r.body));
    EXTRA = MOST;
    const madeBefore = LENCO.made.length;
    r = await post(start, { items: [{ sku: 'SC-1', qty: 1 }], buyer: buyer(), fulfilment: 'collection', method: 'mobile', network: 'airtel',
                            momo: '0971777001', attempt: keyOf(), retry: { txRef: tx } });
    const second = DB.payments.filter(x => x.order_id === payOf(tx).order_id && x.tx_ref !== tx)[0];
    is(r.code === 403 && r.body.refused && r.body.error === RISK.REFUSED_SAID && LENCO.made.length === madeBefore,
       'Try again, now Critical: refused with the same neutral words, and no new request reaches the phone', J(r.body));
    is(second && second.status === 'failed' && second.detail.reason === 'risk-refused' && orderOf(tx).status === 'cancelled' &&
       caseOf('payment_start', second.tx_ref).length === 1, 'the new try is closed, its order cancelled, its case kept', J(second));

    console.log('\nActing: Flutterwave’s way is checked the same');
    reset();
    setMode('act');
    SETTINGS.payments.lencoEnabled = false; SETTINGS.payments.flwEnabled = true;
    EXTRA = MOST;
    r = await post(start, { items: [{ sku: 'SC-1', qty: 1 }], buyer: buyer('qwerty@gmail.com'), fulfilment: 'collection', method: 'card' });
    is(r.code === 403 && FLW.made.length === 0 && !r.body.link, 'a Critical card payment through Flutterwave is refused before its page is made', J(r.body));
    EXTRA = {};
    r = await post(start, { items: [{ sku: 'SC-1', qty: 1 }], buyer: buyer(), fulfilment: 'collection', method: 'card' });
    is(r.code === 200 && FLW.made.length === 1 && /^https:\/\//.test(r.body.link), 'an ordinary one goes to Flutterwave’s page as before', J(r.body));

    /* ------------------------------------------------------------------ */
    console.log('\nActing: High is held when it is paid');
    reset();
    setMode('act');
    EXTRA = HIGH;
    r = await momo(buyer());
    tx = r.body.txRef;
    is(r.code === 200 && LENCO.made.length === 1, 'a High payment starts (only Critical is refused at the start)');
    is(payOf(tx).detail && payOf(tx).detail.risk && payOf(tx).detail.risk.level === 'high', 'its level is carried on the payment');
    EXTRA = {};
    paid(tx);
    MAIL = [];
    r = await call(status, 'GET', undefined, {}, { tx_ref: tx });
    y = payOf(tx); o = orderOf(tx);
    is(r.body.status === 'review' && r.body.held === true && y.status === 'review' && y.detail.risk_hold &&
       o.payment_status === 'review' && o.payment_status !== 'paid',
       'Lenco says paid: the payment is held, "needs attention", never marked paid, so the till leaves it alone', J([r.body, y.status, o.payment_status]));
    is(!FRAUD_WORDS.test(J(r.body)), 'the customer’s page is told only that it is being checked');
    is(MAIL.length === 1 && /Payment held for review/.test(MAIL[0].subject) && MAIL[0].to === 'shop@example.com' &&
       /Approve/.test(MAIL[0].text) && /Lenco/.test(MAIL[0].text), 'one email to the shop, saying how to approve or reject it', J(MAIL.map(m => m.subject)));
    is(!MAIL.some(m => m.to === y.email || /confirm/i.test(m.subject)), 'and no confirmation to the customer while it is held');
    const heldCase = caseOf('payment_paid', tx)[0];
    is(heldCase && heldCase.action === 'held' && heldCase.review_state === 'open' && heldCase.level === 'high', 'its case: held, waiting for review');
    // Asked again for real: as Lenco's webhook does (settle), and by the
    // check-up once the payment is old enough for it to look (three minutes).
    let again2 = await P.settle(tx);
    payOf(tx).created_at = ago(10 * 60000); payOf(tx).asked_at = null;
    const rc = await reconcile();
    is(again2.status === 'review' && rc.checked >= 1 && payOf(tx).status === 'review' && orderOf(tx).payment_status === 'review' &&
       caseOf('payment_paid', tx).length === 1 && MAIL.length === 1,
       'asked again (a webhook, the check-up): still held, one case, no second email', J([again2.status, rc, payOf(tx).status]));
    BROKEN.casesGet = 500;
    again2 = await P.settle(tx);
    BROKEN.casesGet = 0;
    is(again2.status === 'review' && payOf(tx).status === 'review', 'with the cases unreadable for a moment, a held payment stays held', J(again2.status));

    console.log('\nApproving a held payment');
    r = await post(release, { id: heldCase.id }, { authorization: 'Bearer admin-token' });
    is(r.code === 403 && payOf(tx).status === 'review', 'somebody without the Fraud & Risk right cannot release it');
    r = await post(release, { id: heldCase.id }, { authorization: 'Bearer risk-token' });
    is(r.code === 409 && payOf(tx).status === 'review', 'nor can anybody before the case is approved');
    heldCase.review_state = 'approved';
    MAIL = [];
    r = await post(release, { id: heldCase.id }, { authorization: 'Bearer risk-token' });
    y = payOf(tx); o = orderOf(tx);
    is(r.code === 200 && r.body.status === 'paid' && y.status === 'paid' && o.payment_status === 'paid' && !y.detail.risk_hold,
       'approved and released: Lenco asked again, and marked paid on its word', J([r.body, y.status, o.payment_status]));
    is(MAIL.some(m => m.to === 'buyer@gmail.com') && MAIL.some(m => m.to === 'shop@example.com'),
       'the confirmation emails go now, to the customer and the shop', J(MAIL.map(m => [m.to, m.subject])));
    is(!!heldCase.released_at, 'the case says when it was released');
    const sent = MAIL.length;
    await post(release, { id: heldCase.id }, { authorization: 'Bearer risk-token' });
    await P.settle(tx);
    await reconcile();
    is(MAIL.length === sent, 'released again, asked again, or by the check-up: nothing is sent twice');

    console.log('\nThe watch releases an approval the page could not');
    reset();
    setMode('act');
    EXTRA = HIGH;
    r = await momo(buyer());
    tx = r.body.txRef;
    EXTRA = {};
    paid(tx);
    await call(status, 'GET', undefined, {}, { tx_ref: tx });
    is(payOf(tx).status === 'review', 'held');
    caseOf('payment_paid', tx)[0].review_state = 'approved';
    let w = await watch();
    is(payOf(tx).status === 'paid' && w.released && w.released.released === 1 && ANCHORS === 1,
       'the fifteen-minute watch marks it paid on Lenco’s word, and anchors the record', J(w));

    console.log('\nFlutterwave: held and released the same way');
    reset();
    setMode('act');
    SETTINGS.payments.lencoEnabled = false; SETTINGS.payments.flwEnabled = true;
    EXTRA = HIGH;
    r = await post(start, { items: [{ sku: 'SC-1', qty: 1 }], buyer: buyer(), fulfilment: 'collection', method: 'card' });
    tx = r.body.txRef;
    EXTRA = {};
    FLW.verify[tx] = { id: 4445551, tx_ref: tx, status: 'successful', amount: 300, currency: 'ZMW', charged_amount: 300,
                       app_fee: 4.2, payment_type: 'card', flw_ref: 'FLW-MOCK-1' };
    r = await call(status, 'GET', undefined, {}, { tx_ref: tx });
    is(r.body.status === 'review' && r.body.held && payOf(tx).status === 'review' && orderOf(tx).payment_status === 'review',
       'Flutterwave says paid: held', J(r.body));
    caseOf('payment_paid', tx)[0].review_state = 'approved';
    r = await post(release, { id: caseOf('payment_paid', tx)[0].id }, { authorization: 'Bearer risk-token' });
    is(r.body.status === 'paid' && payOf(tx).status === 'paid' && orderOf(tx).paid_amount === 300,
       'approved: verified with Flutterwave again, and paid', J(r.body));

    /* ------------------------------------------------------------------ */
    console.log('\nRefunds');
    reset();
    setMode('act');
    DB.orders.push({ id: 'ord-rf', ref: 'VB-RF01', phone: '0977000111', email: 'r@example.com', total: 500, status: 'confirmed',
                     created_at: new Date().toISOString(), payment_method: 'online', payment_status: 'paid' });
    DB.payments.push({ id: 'pay-rf', order_id: 'ord-rf', tx_ref: 'VB-RF01-aaaaaaaaaa', provider: 'flutterwave', mode: 'test', status: 'paid',
                       amount: 500, currency: 'ZMW', provider_tx_id: '5551', created_at: new Date().toISOString() });
    const refundRow = (id, extra) => Object.assign({ id, request_key: id, order_id: 'ord-rf', order_ref: 'VB-RF01', payment_id: 'pay-rf',
      tx_ref: 'VB-RF01-aaaaaaaaaa', provider_tx_id: '5551', mode: 'test', currency: 'ZMW', amount: 500, whole: true, reason: 'Asked',
      by_name: 'Clerk One', state: 'new', requested_at: new Date().toISOString() }, extra || {});
    EXTRA = { refundsPhone90: 4 };
    DB.refunds.push(refundRow('11111111-aaaa-4aaa-8aaa-000000000001', { _hours: 0.5 }));
    r = await R.send('11111111-aaaa-4aaa-8aaa-000000000001');
    let rf = DB.refunds[0];
    is(rf.state === 'refused' && FLW.refunds.length === 0 && /fraud check/.test(rf.flw_message) && /ask for the refund again/.test(rf.flw_message),
       'a refund it scores High is not sent: refused, and the platform is told why and what to do', J([rf.state, rf.flw_message]));
    c = caseOf('refund')[0];
    is(c && c.action === 'refused' && c.review_state === 'open', 'its case waits for review');
    c.review_state = 'approved';
    DB.refunds.push(refundRow('11111111-aaaa-4aaa-8aaa-000000000002', { _hours: 1 }));
    r = await R.send('11111111-aaaa-4aaa-8aaa-000000000002');
    is(FLW.refunds.length === 1 && DB.refunds[1].state !== 'refused', 'approved, and asked for again by the platform: it is sent', J(DB.refunds[1].state));
    setMode('watch');
    DB.refunds.push(refundRow('11111111-aaaa-4aaa-8aaa-000000000003', { _hours: 0.2, order_id: 'ord-rf' }));
    DB.risk_cases.forEach(x => { x.review_state = 'none'; });
    r = await R.send('11111111-aaaa-4aaa-8aaa-000000000003');
    is(FLW.refunds.length === 2 && caseOf('refund').some(x => x.refund_id === '11111111-aaaa-4aaa-8aaa-000000000003' && x.would === 'refused' && x.action === 'none'),
       'watching, it is sent, and the case says acting would have held it');

    /* ------------------------------------------------------------------ */
    console.log('\nWhatsApp orders');
    reset();
    setMode('act');
    EXTRA = MOST;
    r = await call(placeOrder, 'POST', { order: { name: 'A Buyer', phone: '0977111222', email: 'test@gmail.com' }, items: [{ sku: 'SC-1', qty: 1 }] },
                   { 'x-nf-client-connection-ip': '10.1.1.1' });
    is(r.code === 200 && r.body.ref, 'a Critical WhatsApp order is recorded all the same: it is confirmed by hand before anything is paid', J(r.body));
    c = caseOf('order_placed')[0];
    is(c && c.level === 'critical' && c.action === 'shown' && DB.orders[0].risk_level === 'critical',
       'it is marked for you, with its level on the order');
    EXTRA = {};
    r = await call(placeOrder, 'POST', { order: { name: 'A Buyer', phone: '0977111222' }, items: [{ sku: 'SC-1', qty: -4 }] },
                   { 'x-nf-client-connection-ip': '10.1.1.9' });
    is(r.code === 400 && RATE.some(x => x.bucket === 'refused' && x.key === '10.1.1.9'),
       'a quantity no page sends is refused, and counted against that connection for the next score');
    r = await post(start, { items: [{ sku: 'SC-1', qty: 1 }], buyer: buyer(), fulfilment: 'collection', method: 'mobile', network: 'airtel',
                            momo: '0971444555', attempt: keyOf() }, { 'x-nf-client-connection-ip': '10.1.1.9' });
    c = caseOf('payment_start', r.body && r.body.txRef)[0];
    is(c && c.reasons.some(x => x.signal === 'refused'), 'and that connection’s next payment carries it as a reason', J(c && c.reasons));
    RATE = RATE.filter(x => x.bucket !== 'refused');
    r = await post(start, { items: [{ sku: 'BAG', qty: 9 }], buyer: buyer(), fulfilment: 'collection', method: 'mobile', network: 'airtel',
                            momo: '0971444556', attempt: keyOf() }, { 'x-nf-client-connection-ip': '10.1.1.8' });
    is(r.code === 409 && !RATE.some(x => x.bucket === 'refused'), 'asking for more than is in stock is ordinary, and never counted');

    /* ------------------------------------------------------------------ */
    console.log('\nNever a sale stopped by accident');
    reset();
    setMode('act');
    EXTRA = MOST;
    BROKEN.facts = 404;
    r = await momo(buyer('qwerty@gmail.com'));
    is(r.code === 200 && LENCO.made.length === 1 && DB.risk_cases.length === 0, 'before supabase-risk.sql has been run: the payment goes ahead, nothing scored');
    BROKEN.facts = 500;
    r = await momo(buyer('qwerty@gmail.com'));
    is(r.code === 200 && LENCO.made.length === 2, 'the check’s own question failing: the payment goes ahead');
    BROKEN.facts = 0; BROKEN.cases = true;
    r = await momo(buyer('qwerty@gmail.com'));
    is(r.code === 200 && LENCO.made.length === 3, 'the cases table missing: the payment goes ahead');
    BROKEN.cases = false;
    tx = r.body.txRef;
    paid(tx);
    BROKEN.facts = 500;
    r = await call(status, 'GET', undefined, {}, { tx_ref: tx });
    is(r.body.status === 'paid' && payOf(tx).status === 'paid', 'and a payment the check cannot score when it is paid is marked paid as before');
    BROKEN.facts = 0;
    setMode('off');
    const before = DB.risk_cases.length;
    r = await momo(buyer('qwerty@gmail.com'));
    is(r.code === 200 && DB.risk_cases.length === before, 'off: nothing is scored at all');

    /* ------------------------------------------------------------------ */
    console.log('\nThe fifteen-minute watch');
    reset();
    setMode('watch');
    STAFF = [{ actor: 'staff-7', deletes: 25, roles: 7, settings: 0, changes: 32 }, { actor: 'staff-8', deletes: 1, roles: 0, settings: 2, changes: 3 }];
    w = await watch();
    c = caseOf('staff')[0];
    is(w.staff.cases === 1 && c && c.actor === 'staff-7' && c.level === 'critical' && c.action === 'none' && c.would === 'shown',
       'many deletions and role changes by one person in an hour: a case for that person only', J(w.staff));
    is(MAIL.some(m => /Fraud check: Critical/.test(m.subject) && /Activity by a member of the team/.test(m.text)), 'emailed, as Critical');
    w = await watch();
    is(w.staff.cases === 0 && caseOf('staff').length === 1, 'not a second case for the same person within the hour');
    c.review_state = 'escalated'; c.review_note = 'Please look';
    MAIL = [];
    w = await watch();
    is(w.escalated.mailed === 1 && MAIL.length === 1 && MAIL[0].to === 'owner@example.com' && /escalated/.test(MAIL[0].subject),
       'an escalated case: the owner is emailed', J(MAIL.map(m => [m.to, m.subject])));
    w = await watch();
    is(w.escalated.mailed === 0 && MAIL.length === 1, 'once');
    BROKEN.cases = true;
    w = await watch();
    is(w.skipped && /supabase-risk/.test(w.skipped), 'before supabase-risk.sql has been run, it stops at once');
    BROKEN.cases = false;
    setMode('watch', { alertTo: 'alerts@example.com' });
    STAFF = [{ actor: 'staff-9', deletes: 25, roles: 7, settings: 0, changes: 32 }];
    MAIL = [];
    await watch();
    is(MAIL.some(m => m.to === 'alerts@example.com'), 'with an address in Settings > Fraud & Risk, the emails go there');

    /* ------------------------------------------------------------------ */
    console.log('\nNothing leaks');
    const everySecret = [TOKEN_TEST, 'service-key', 'FLWSECK_TEST-secret', 'my-secret-hash'];
    is(!DB.risk_cases.some(x => everySecret.some(k => J(x).includes(k))), 'no key is ever written into a case');
    is(!DB.risk_cases.some(x => /\b\d{12,19}\b/.test(J(x.reasons))), 'and no card number: none is ever typed on the website');
  } catch (e) {
    fail('the checks stopped: ' + (e && e.stack || e));
  }
  server.close();
  console.log('\n' + (failures ? failures + ' of ' + checks + ' checks FAILED' : 'risk: all ' + checks + ' checks passed'));
  process.exit(failures ? 1 : 0);
})();
