/* ===========================================================================
   CUSTOMERS' REQUESTS, IN THE BROWSER -- website build 87

   THE OWNER, 21 November 2026: the customer portal brings "Order
   cancellation requests", "Return requests", "Exchange requests" and
   "Order issue reporting", and "Every new customer-account feature must
   connect to the Business Platform where appropriate. For example, an
   approved refund must reflect in the website, Flutterwave and the
   Business Platform."

   So a customer only asks; the shop answers (the platform's Online Orders
   from platform 512, or Admin > Orders here); a refund is the platform's
   Online Refund. The database's own rules are checked in
   tests/customer-requests.sql (the real SQL, on PostgreSQL); here the
   pages, with the real index.html, admin.html, assets and supabase-js, and
   a stand-in Supabase that answers as that SQL does. On a phone:

     1. Switched off (Settings > Customer Accounts): no buttons, nothing
        asked of the database for them, and "Message us" as before.
     2. Switched on: each order offers what it may, as the database says:
        cancel before it is prepared; return or exchange within the days
        after delivery; a problem once it is on its way. Nothing on a
        cancelled order. Past the days, it says so.
     3. The form: a reason, the pieces (how many of each), what instead for
        an exchange, more words for "Something else"; each missing one
        said; what is sent is exactly what was chosen.
     4. The request on the order, With the shop, with Send photos; asked
        once of each kind; Withdraw, with a second tap.
     5. A cancel, and Returns & refunds listing every request.
     6. It fits a phone.
     7. Admin > Orders: each request under its order; Decline needs a word
        for the customer; Accept cancels an unpaid order not yet rung up, and
        sends one paid online to the platform's Online Refund.
     8. The customer then sees the shop's answer.
     9. Settings > Customer Accounts: the switch and the days, labels only
        (the owner: "don't add sentences explaining in settings"), the days
        shown only while the switch is on, and saved as set.
   =========================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');

let checks = 0, failures = 0;
const is = (c, m, x) => { checks++; if (c) console.log('  ✓ ' + m); else { failures++; console.log('  ✗ ' + m + (x ? '\n      ' + String(x).slice(0, 700) : '')); } };
const J = o => JSON.stringify(o);

let SUPABASE_JS = null;
for (const p of [
  () => path.join(ROOT, 'assets', 'vendor', 'supabase-js-2.118.0.js'),
  () => require.resolve('@supabase/supabase-js/dist/umd/supabase.js'),
]) {
  try { const f = p(); if (fs.existsSync(f)) { SUPABASE_JS = fs.readFileSync(f, 'utf8'); break; } } catch (e) {}
}
if (!SUPABASE_JS) {
  console.log('  customers\' requests in the browser: skipped (the real supabase-js is not here: assets/vendor/supabase-js-2.118.0.js)');
  process.exit(0);
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const piece = (o) => Object.assign({ category: 'Dresses', size: '', color: '', material: '', available: true,
  lowStock: false, wasPrice: 0, brand: '', description: 'A piece.', details: [], variantGroup: '', maxQty: 5,
  image_url: '/pic/a.png', gallery: [] }, o);
const CATALOGUE = [piece({ name: 'Linen Dress', sku: 'LD-9', price: 1400 }), piece({ name: 'Silk Scarf', sku: 'SC-2', price: 600 })];

const USERS = {
  'buyer@example.com': { id: '22222222-2222-4222-8222-222222222222', email: 'buyer@example.com' },
  'owner@example.com': { id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.com', admin: true },
};
const PASSWORD = 'the-right-password-1';
const b64url = s => Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const TOKENS = {}, REFRESH = {};
let seq = 0;
function userBody(u) {
  const at = '2026-10-01T08:00:00Z';
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
  return { access_token: access, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600,
           refresh_token: refresh, user: userBody(u) };
}
const who = req => TOKENS[String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')] || null;

const D = 86400000;
const at = (min) => new Date(Date.now() - min * 60000).toISOString();
const daysAgo = (n) => new Date(Date.now() - n * D).toISOString();
const buyer = USERS['buyer@example.com'].id;
const RETURN_DAYS = 7;

/* ---- the stand-in's records ----------------------------------------------- */
let ORDERS, REQUESTS, CALLS, REQ_ON, rqSeq, SAVED = [];
function seed() {
  const o = (x) => Object.assign({ currency: 'ZMW', customer_id: buyer, name: 'Test Buyer', phone: '0977000001', email: 'buyer@example.com',
    address: 'Plot 1, Stand-in Road', pos_receipt: null, pos_receipt_no: null, pos_completed_at: null, pos_sale_id: null, paid_at: null,
    payment_method: null, payment_status: null, pay_channel: null, goods_total: null, delivery_fee: null, paid_amount: null,
    ship_note: null, dispatched_at: null, ready_at: null, delivered_at: null, delivered_by: null, auto_deliver_at: null,
    extend_days: null, extend_max: null, extend_used: null, remind_days: null,
    refund_state: null, refund_amount: null, refund_ref: null, refund_note: null, refund_at: null, updated_at: null,
    fulfilment: 'delivery', order_items: [{ sku: 'LD-9', name: 'Linen Dress', price: 1400, qty: 1 }] }, x);
  ORDERS = [
    o({ id: 'o-p01', ref: 'VB-RQP01', status: 'pending', total: 1400, created_at: at(30) }),
    o({ id: 'o-o01', ref: 'VB-RQO01', status: 'pending', total: 1530, created_at: at(60),
        payment_method: 'online', payment_status: 'paid', pay_channel: 'card', paid_at: at(59), paid_amount: 1530,
        goods_total: 1400, delivery_fee: 130 }),
    o({ id: 'o-d01', ref: 'VB-RQD01', status: 'delivered', total: 2600, created_at: daysAgo(6),
        pos_sale_id: 'S-1', pos_receipt_no: 'RCT-0001', pos_completed_at: daysAgo(5), dispatched_at: daysAgo(4),
        delivered_at: daysAgo(2), delivered_by: 'customer',
        order_items: [{ sku: 'LD-9', name: 'Linen Dress', price: 1400, qty: 1 }, { sku: 'SC-2', name: 'Silk Scarf', price: 600, qty: 2 }] }),
    o({ id: 'o-d02', ref: 'VB-RQD02', status: 'delivered', total: 1400, created_at: daysAgo(25),
        pos_sale_id: 'S-2', pos_receipt_no: 'RCT-0002', pos_completed_at: daysAgo(24), dispatched_at: daysAgo(22),
        delivered_at: daysAgo(20), delivered_by: 'auto' }),
    o({ id: 'o-w01', ref: 'VB-RQW01', status: 'dispatched', total: 1400, created_at: daysAgo(3),
        pos_sale_id: 'S-3', pos_receipt_no: 'RCT-0003', pos_completed_at: daysAgo(2), dispatched_at: daysAgo(1),
        auto_deliver_at: new Date(Date.now() + 5 * D).toISOString(), extend_days: 3, extend_max: 2, extend_used: 0 }),
    o({ id: 'o-c01', ref: 'VB-RQC01', status: 'cancelled', total: 900, created_at: daysAgo(9), updated_at: daysAgo(8) }),
  ];
  REQUESTS = [];
  CALLS = [];
  REQ_ON = false;
  rqSeq = 0;
}
seed();
const byRef = ref => ORDERS.find(o => o.ref === ref);

/* The database's rules, as supabase-customer-requests.sql has them. */
const REASONS = {
  cancel: ['changed_mind', 'ordered_by_mistake', 'too_slow', 'other'],
  return: ['wrong_size', 'not_as_shown', 'damaged', 'quality', 'changed_mind', 'other'],
  exchange: ['wrong_size', 'not_as_shown', 'damaged', 'quality', 'other'],
  problem: ['missing', 'damaged', 'wrong_item', 'quality', 'other'],
};
function windowOf(o, kind) {
  const st = o.status || 'pending';
  if (st === 'cancelled') return 'cancelled';
  if (kind === 'cancel') return (o.pos_sale_id || ['pending', 'confirmed'].indexOf(st) < 0) ? 'too_late' : 'open';
  const got = o.delivered_at || (st === 'completed' ? (o.pos_completed_at || o.updated_at) : null);
  if (kind === 'return' || kind === 'exchange') {
    if (['delivered', 'completed'].indexOf(st) < 0) return 'not_yet';
    if (got && Date.parse(got) < Date.now() - RETURN_DAYS * D) return 'too_late';
    return 'open';
  }
  if (kind === 'problem') {
    if (['dispatched', 'ready', 'delivered', 'completed'].indexOf(st) < 0) return 'not_yet';
    if (got && Date.parse(got) < Date.now() - 30 * D) return 'too_late';
    return 'open';
  }
  return 'unreadable';
}
const out = r => ({ id: r.id, ref: r.ref, orderRef: r.order_ref, kind: r.kind, reason: r.reason, detail: r.detail, wants: r.wants,
  items: r.items, status: r.status, answer: r.answer, createdAt: r.created_at, decidedAt: r.decided_at, doneAt: r.done_at });
const outFull = r => Object.assign(out(r), { decidedBy: r.decided_by, decidedFrom: r.decided_from, platformRef: r.platform_ref, updatedAt: r.updated_at });
function addRequest(o, kind, reason, x) {
  const r = Object.assign({ id: 'rq-' + (++rqSeq), ref: 'RQ-' + String(1000 + rqSeq) + 'AB', order_id: o.id, order_ref: o.ref,
    customer_id: o.customer_id, kind, reason, detail: null, wants: null, items: [], status: 'requested', answer: null,
    decided_at: null, decided_by: null, decided_from: null, platform_ref: null, done_at: null, shop_told_at: null,
    customer_told: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, x || {});
  REQUESTS.push(r);
  return r;
}
function open(usr, b) {
  if (!usr) return { ok: false, why: 'signin' };
  if (!REQ_ON) return { ok: false, why: 'off' };
  const kind = b.p_kind, reason = b.p_reason;
  const detail = String(b.p_detail || '').trim().slice(0, 1000) || null;
  const wants = String(b.p_wants || '').trim().slice(0, 300) || null;
  if (!REASONS[kind] || REASONS[kind].indexOf(reason) < 0) return { ok: false, why: 'unreadable' };
  if (reason === 'other' && !detail) return { ok: false, why: 'say_more' };
  if (kind === 'exchange' && !wants) return { ok: false, why: 'say_instead' };
  const o = ORDERS.find(x => x.id === b.p_order && x.customer_id === usr.id);
  if (!o) return { ok: false, why: 'not_found' };
  const w = windowOf(o, kind);
  if (w !== 'open') return { ok: false, why: w };
  let items = [];
  if (kind !== 'cancel') {
    const ask = Array.isArray(b.p_items) ? b.p_items : [];
    o.order_items.forEach(line => {
      const q = Math.min(line.qty, Math.max(0, ...ask.filter(a => a.sku === line.sku).map(a => Number(a.qty) || 0), 0));
      if (q > 0) items.push({ sku: line.sku, name: line.name, qty: q });
    });
    if ((kind === 'return' || kind === 'exchange') && !items.length) return { ok: false, why: 'which_pieces' };
  }
  const was = REQUESTS.find(r => r.order_id === o.id && r.kind === kind && (r.status === 'requested' || r.status === 'accepted'));
  if (was) return { ok: true, again: true, request: out(was) };
  return { ok: true, again: false, request: out(addRequest(o, kind, reason, { detail, wants, items })) };
}
function decide(r, decision, answer, by) {
  const to = { accept: 'accepted', decline: 'declined', done: 'done' }[decision];
  if (!to) return { ok: false, why: 'unreadable' };
  if (r.status === to) return { ok: true, again: true, request: outFull(r) };
  if (!((decision === 'accept' && r.status === 'requested') || (decision === 'decline' && ['requested', 'accepted'].indexOf(r.status) > -1)
        || (decision === 'done' && r.status === 'accepted'))) return { ok: false, why: 'not_now', status: r.status };
  answer = String(answer || '').trim() || null;
  if (decision === 'decline' && !answer) return { ok: false, why: 'answer_needed' };
  const now = new Date().toISOString();
  Object.assign(r, { status: to, answer: answer || r.answer, decided_by: by, decided_from: 'admin', updated_at: now });
  if (decision !== 'done') r.decided_at = now; else r.done_at = now;
  let cancelled = false, refund = false;
  if (decision === 'accept' && r.kind === 'cancel') {
    const o = ORDERS.find(x => x.id === r.order_id);
    if (o.payment_method === 'online' && o.payment_status === 'paid') refund = true;
    else if (!o.pos_sale_id && ['pending', 'confirmed'].indexOf(o.status) > -1) {
      o.status = 'cancelled'; r.status = 'done'; r.done_at = now; cancelled = true;
    }
  }
  return { ok: true, again: false, orderCancelled: cancelled, refundFirst: refund, request: outFull(r) };
}

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
    if (p.startsWith('/web/rest/v1/rpc/')) CALLS.push({ fn: p.slice('/web/rest/v1/rpc/'.length), as: usr ? usr.email : 'anon', body });
    if (p === '/web/rest/v1/site_settings' && req.method === 'POST') { SAVED.push(body); return send(201, []); }
    if (p === '/web/rest/v1/site_settings') {
      const key = u.searchParams.get('key');
      if (key === 'eq.customer-accounts') {
        return send(200, [{ data: { accountsEnabled: true, orderHistory: true, guestCheckout: true, customerRequests: REQ_ON, returnDays: RETURN_DAYS } }]);
      }
      if (key === 'eq.general') return send(200, [{ data: { businessName: 'Vaultique Boutique Point' } }]);
      return send(200, []);
    }
    if (p === '/web/rest/v1/admins') return send(200, usr && usr.admin ? [{ id: usr.id }] : []);
    if (p === '/web/rest/v1/rpc/is_admin') return send(200, !!(usr && usr.admin));
    if (p === '/web/rest/v1/rpc/my_access') {
      return send(200, usr && usr.admin
        ? { is_admin: true, is_owner: true, active: true, role: 'owner', permissions: {}, must_change_password: false }
        : { is_admin: false, is_owner: false, active: false, role: null, permissions: {} });
    }
    if (p === '/web/rest/v1/customers') return send(200, usr ? [{ id: usr.id, name: 'Test Buyer', phone: '0977000001', wishlist: [] }] : []);
    if (p === '/web/rest/v1/customer_addresses') return send(200, []);
    if (p === '/web/rest/v1/orders' && req.method === 'GET') {
      const rows = usr && usr.admin ? ORDERS : (usr ? ORDERS.filter(o => o.customer_id === usr.id) : []);
      return send(200, rows.map(o => JSON.parse(J(o))));
    }
    /* The table: the shop's administrators only (its row-level rule). */
    if (p === '/web/rest/v1/order_requests' && req.method === 'GET') {
      if (!usr || !usr.admin) return send(200, []);
      const ids = String(u.searchParams.get('order_id') || '').replace(/^in\.\(|\)$/g, '').split(',').map(s => s.replace(/^"|"$/g, ''));
      return send(200, REQUESTS.filter(r => ids.indexOf(r.order_id) > -1).map(r => JSON.parse(J(r))));
    }
    if (p === '/web/rest/v1/rpc/requests_mine') {
      return send(200, usr ? REQUESTS.filter(r => r.customer_id === usr.id).slice().reverse().map(out) : []);
    }
    if (p === '/web/rest/v1/rpc/request_choices') {
      if (!usr) return send(200, { ok: false, why: 'signin' });
      if (!REQ_ON) return send(200, { ok: false, why: 'off' });
      const o = ORDERS.find(x => x.id === body.p_order && x.customer_id === usr.id);
      if (!o) return send(200, { ok: false, why: 'not_found' });
      const choices = {};
      ['cancel', 'return', 'exchange', 'problem'].forEach(k => {
        const w = windowOf(o, k);
        choices[k] = { can: w === 'open', why: w, reasons: REASONS[k] };
      });
      return send(200, { ok: true, choices });
    }
    if (p === '/web/rest/v1/rpc/request_open') return send(200, open(usr, body));
    if (p === '/web/rest/v1/rpc/request_withdraw') {
      if (!usr) return send(200, { ok: false, why: 'signin' });
      const r = REQUESTS.find(x => x.id === body.p_id && x.customer_id === usr.id);
      if (!r) return send(200, { ok: false, why: 'not_found' });
      if (r.status === 'withdrawn') return send(200, { ok: true, again: true, request: out(r) });
      if (r.status !== 'requested') return send(200, { ok: false, why: 'answered', request: out(r) });
      r.status = 'withdrawn'; r.updated_at = new Date().toISOString();
      return send(200, { ok: true, again: false, request: out(r) });
    }
    if (p === '/web/rest/v1/rpc/request_decide_admin') {
      if (!usr || !usr.admin) return send(200, { ok: false, why: 'not_allowed' });
      const r = REQUESTS.find(x => x.id === body.p_id);
      if (!r) return send(200, { ok: false, why: 'not_found' });
      return send(200, decide(r, body.p_decision, body.p_answer, usr.email));
    }
    if (p.startsWith('/web/rest/v1/rpc/')) return send(200, null);
    if (p.startsWith('/web/rest/v1/')) return send(200, []);
    if (p.startsWith('/web/')) return send(200, {});
    if (p === '/api/products') return send(200, { products: CATALOGUE, count: CATALOGUE.length, version: 't' });
    if (p === '/.netlify/functions/account-portal' && req.method === 'POST') {
      if (!usr) return send(401, { error: 'Please sign in again.' });
      if (body.action === 'refunds') return send(200, { refunds: [] });
      return send(200, {});
    }
    if (p.startsWith('/.netlify/functions/')) return send(200, {});
    if (p.indexOf('/pic/') === 0) { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(PNG); }
    if (p === '/config.js') {
      res.writeHead(200, { 'Content-Type': TYPES['.js'] });
      return res.end('window.VBP_CONFIG={SUPABASE_URL:"' + base + '/web",SUPABASE_ANON_KEY:"anon"};');
    }
    if (p === '/__shop.html') {
      res.writeHead(200, { 'Content-Type': TYPES['.html'] });
      return res.end('<!doctype html><meta charset="utf-8"><title>shop</title>' +
        '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>' +
        '<script>window.SHOP = window.supabase.createClient(' + J(base + '/web') + ', "anon");</script>');
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
async function signIn(page, email) {
  await page.goto(base + '/__shop.html', { waitUntil: 'load' });
  await page.evaluate((e) => window.SHOP.auth.signInWithPassword({ email: e, password: 'the-right-password-1' }), email);
}
const calls = fn => CALLS.filter(c => c.fn === fn);
/* An order's own page, once its requests have been read. */
async function orderPage(page, ref) {
  await page.goto(base + '/account/orders/' + ref, { waitUntil: 'networkidle' });
  await page.waitForSelector('.acd[data-ref="' + ref + '"] .acd-requests[data-ready="yes"]', { state: 'attached', timeout: 15000 });
  return page.evaluate(() => {
    const box = document.querySelector('.acd-requests');
    const t = s => [...box.querySelectorAll(s)].map(e => e.innerText.replace(/\s+/g, ' ').trim());
    return {
      head: t('.acd-h'), asks: [...box.querySelectorAll('.rq-ask')].map(e => e.textContent.trim()), rows: t('.rq-row'), late: t('.rq-late'), said: t('.rq-said-now'),
      states: [...box.querySelectorAll('.rq-row')].map(e => e.getAttribute('data-state')),
      photos: box.querySelectorAll('.rq-photos-btn').length, withdraw: box.querySelectorAll('.rq-withdraw').length,
      askAbout: !!document.querySelector('.acd .ac-ask'),
    };
  });
}
const formState = page => page.evaluate(() => {
  const f = document.querySelector('.rq-form');
  if (!f) return null;
  const shown = e => !!e && e.style.display !== 'none' && e.offsetParent !== null;
  const sel = f.querySelector('select[id$="_reason"]');
  return {
    kinds: [...f.querySelectorAll('.rq-kinds input')].map(i => i.value + (i.checked ? '*' : '')),
    pieces: [...f.querySelectorAll('.rq-piece')].map(p => p.innerText.replace(/\s+/g, ' ').trim()),
    piecesShown: shown(f.querySelector('.rq-pieces')),
    qty: [...f.querySelectorAll('.rq-qty')].map(q => q.value + '/' + q.options.length),
    reasons: [...sel.options].map(o => o.value || '-'),
    wantsShown: shown(f.querySelector('input[id$="_wants"]')),
    detailLabel: (f.querySelector('label[for$="_detail"]') || {}).textContent,
    photos: shown(f.querySelector('.rq-photos')),
    send: f.querySelector('.rq-send').textContent,
    msg: (f.querySelector('.ac-msg') || {}).textContent || '',
    lead: (f.querySelector('.rq-lead') || {}).textContent || '',
  };
});

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const errors = [];
  const watch = (page) => page.on('pageerror', e => errors.push(String(e.message || e)));
  try {
    const ctx = await context(browser);
    const page = await ctx.newPage(); watch(page);
    await signIn(page, 'buyer@example.com');

    /* ------------------------------------------------------------------ 1 */
    console.log('\n1. Switched off');
    let v = await orderPage(page, 'VB-RQD01');
    is(v.asks.length === 0 && v.head.length === 0 && v.rows.length === 0, 'an order delivered two days ago offers no requests while they are off', J(v));
    is(v.askAbout, '"Ask about this order" is still there');
    is(calls('request_choices').length === 0, 'nothing was asked of the database about what may be asked', J(calls('request_choices')));
    await page.goto(base + '/account/refunds', { waitUntil: 'networkidle' });
    await page.waitForSelector('.rq-list[data-ready="yes"]', { state: 'attached', timeout: 15000 });
    const off = await page.evaluate(() => document.getElementById('accountBody').innerText.replace(/\s+/g, ' '));
    is(/Message us with your order number and we will arrange it with you\./.test(off), 'Returns & refunds: "Message us", as before', off.slice(0, 400));
    is(!(await page.$('.rq-orders')), 'and no "My orders" button there');

    /* ------------------------------------------------------------------ 2 */
    console.log('\n2. Switched on: what each order may ask');
    REQ_ON = true;
    await page.goto(base + '/account', { waitUntil: 'networkidle' });   // the settings are read again
    v = await orderPage(page, 'VB-RQP01');
    is(J(v.asks) === J(['Cancel this order']), 'not yet prepared: Cancel this order, and nothing else', J(v));
    v = await orderPage(page, 'VB-RQD01');
    is(J(v.asks) === J(['Return or exchange', 'Report a problem']), 'delivered two days ago: Return or exchange, and Report a problem', J(v));
    v = await orderPage(page, 'VB-RQD02');
    is(J(v.asks) === J(['Report a problem']) && /The days for a return or an exchange have passed/.test(v.late.join(' ')),
       'delivered twenty days ago: a problem only, and the days for a return said to have passed', J(v));
    v = await orderPage(page, 'VB-RQW01');
    is(J(v.asks) === J(['Report a problem']), 'on its way: Report a problem only', J(v));
    v = await orderPage(page, 'VB-RQC01');
    is(v.asks.length === 0 && v.head.length === 0, 'cancelled: nothing', J(v));
    is(calls('request_choices').length >= 5 && calls('request_choices').every(c => c.as === 'buyer@example.com'),
       'what may be asked was asked of the database each time, as the signed-in customer', J(calls('request_choices').length));

    /* ------------------------------------------------------------------ 3 */
    console.log('\n3. The form: a return or an exchange');
    await orderPage(page, 'VB-RQD01');
    await page.click('.rq-ask[data-kinds="return exchange"]');
    let f = await formState(page);
    is(f && J(f.kinds) === J(['return*', 'exchange']), 'Return it or Exchange it, Return chosen first', J(f));
    is(f && f.piecesShown && f.pieces.length === 2 && /Linen Dress/.test(f.pieces[0]) && /Silk Scarf/.test(f.pieces[1]) && J(f.qty) === J(['2/2']),
       'the two pieces, and how many of the scarf (2 of 2)', J(f));
    is(f && J(f.reasons) === J(['-', 'wrong_size', 'not_as_shown', 'damaged', 'quality', 'changed_mind', 'other']) && !f.wantsShown && f.photos,
       'the reasons for a return; no "instead" box; a word about photos', J(f));
    is(!(await page.$('.rq-ask')) || !(await page.isVisible('.rq-offers')), 'the buttons step aside while the form is open');
    await page.click('.rq-send');
    is((await formState(page)).msg === 'Please choose a reason.', 'sent with no reason: "Please choose a reason."');
    await page.selectOption('.rq-form select[id$="_reason"]', 'wrong_size');
    await page.click('.rq-send');
    is((await formState(page)).msg === 'Please tick the pieces.', 'no piece ticked: "Please tick the pieces."');
    await page.check('.rq-kinds input[value="exchange"]');
    f = await formState(page);
    is(f.wantsShown && J(f.reasons) === J(['-', 'wrong_size', 'not_as_shown', 'damaged', 'quality', 'other']) && f.send === 'Send to the shop',
       'Exchange: the "instead" box, and the reasons for an exchange (the reason chosen kept)', J(f));
    is(await page.$eval('.rq-form select[id$="_reason"]', s => s.value) === 'wrong_size', 'the reason chosen is kept on the change');
    const boxes = await page.$$('.rq-piece input[type=checkbox]');
    await boxes[0].check();
    await page.click('.rq-send');
    is((await formState(page)).msg === 'Please say what you would like instead.', 'an exchange with nothing instead: said so');
    await page.fill('.rq-form input[id$="_wants"]', 'The same dress in size M');
    await page.selectOption('.rq-form select[id$="_reason"]', 'other');
    is((await formState(page)).detailLabel === 'Tell us more', '"Something else": Tell us more, no longer "(if you like)"');
    await page.click('.rq-send');
    is((await formState(page)).msg === 'Please tell us a little more, in the box.', '"Something else" with no words: said so');
    is(calls('request_open').length === 0, 'nothing was sent while anything was missing');
    await page.fill('.rq-form textarea[id$="_detail"]', 'The waist is too tight for me.');
    await boxes[1].check();
    await page.selectOption('.rq-qty', '1');
    await page.click('.rq-send');
    await page.waitForSelector('.rq-said-now', { timeout: 10000 });
    const sent = calls('request_open')[0];
    is(sent && sent.as === 'buyer@example.com' && sent.body.p_order === 'o-d01' && sent.body.p_kind === 'exchange' && sent.body.p_reason === 'other' &&
       J(sent.body.p_items) === J([{ sku: 'LD-9', qty: 1 }, { sku: 'SC-2', qty: 1 }]) && sent.body.p_wants === 'The same dress in size M' &&
       sent.body.p_detail === 'The waist is too tight for me.', 'what was sent is exactly what was chosen: the order, the kind, the reason, the pieces and how many, the words', J(sent));

    /* ------------------------------------------------------------------ 4 */
    console.log('\n4. The request on its order');
    v = await page.evaluate(() => {
      const box = document.querySelector('.acd-requests');
      const t = s => [...box.querySelectorAll(s)].map(e => e.innerText.replace(/\s+/g, ' ').trim());
      return { said: t('.rq-said-now'), rows: t('.rq-row'), asks: [...box.querySelectorAll('.rq-ask')].map(e => e.textContent.trim()), photos: box.querySelectorAll('.rq-photos-btn').length };
    });
    is(/^Sent: request RQ-\w+\. The shop will email you its answer, and it shows here\.$/.test(v.said[0] || ''), 'Sent, with its number, and how the answer comes', J(v.said));
    is(v.rows.length === 1 && /^Exchange With the shop/i.test(v.rows[0]) && /It is not as shown|Something else/.test(v.rows[0]) &&
       /Linen Dress, Silk Scarf/.test(v.rows[0]) && /Instead: The same dress in size M/.test(v.rows[0]) && /The waist is too tight for me\./.test(v.rows[0]),
       'the request: Exchange, With the shop, the reason, the pieces, what instead, their words', J(v.rows));
    is(v.photos === 1, 'Send photos beside it (the chat takes photos, with the request\'s number)');
    is(J(v.asks) === J(['Return a piece', 'Report a problem']), 'an exchange asked: a return can still be asked, the exchange not twice', J(v.asks));
    /* Asked again through the database's door, the first stands. */
    const again = open(USERS['buyer@example.com'], { p_order: 'o-d01', p_kind: 'exchange', p_reason: 'wrong_size', p_wants: 'x', p_items: [{ sku: 'LD-9', qty: 1 }] });
    is(again.again === true && REQUESTS.filter(r => r.kind === 'exchange').length === 1, 'asked twice, one request stands (the database\'s rule, as the stand-in has it)');

    await page.click('.rq-withdraw');
    is((await page.textContent('.rq-withdraw')) === 'Withdraw it? Tap again', 'Withdraw: a second tap asked for');
    is(calls('request_withdraw').length === 0, 'one tap withdraws nothing');
    await page.click('.rq-withdraw');
    await page.waitForFunction(() => /Withdrawn\. You can ask again/.test((document.querySelector('.rq-said-now') || {}).textContent || ''), null, { timeout: 10000 });
    v = await orderPage(page, 'VB-RQD01');
    is(calls('request_withdraw').length === 1 && v.states[0] === 'withdrawn' && /^Exchange Withdrawn/i.test(v.rows[0]) &&
       J(v.asks) === J(['Return or exchange', 'Report a problem']), 'withdrawn: shown so, and the exchange may be asked again', J(v));

    /* ------------------------------------------------------------------ 5 */
    console.log('\n5. A cancel, and Returns & refunds');
    await orderPage(page, 'VB-RQP01');
    await page.click('.rq-ask[data-kinds="cancel"]');
    f = await formState(page);
    is(f && !f.piecesShown && !f.wantsShown && !f.photos && f.send === 'Ask to cancel' &&
       J(f.reasons) === J(['-', 'changed_mind', 'ordered_by_mistake', 'too_slow', 'other']) &&
       /If we accept and you paid online, your money comes back the way you paid\./.test(f.lead),
       'cancel: a reason only, "Ask to cancel", and what happens to money paid online', J(f));
    await page.selectOption('.rq-form select[id$="_reason"]', 'ordered_by_mistake');
    await page.click('.rq-send');
    await page.waitForSelector('.rq-said-now', { timeout: 10000 });
    v = await orderPage(page, 'VB-RQP01');
    is(v.rows.length === 1 && /^Cancel the order With the shop/i.test(v.rows[0]) && v.asks.length === 0 && v.photos === 0,
       'the cancel With the shop; not asked twice; no photos for a cancel', J(v));
    /* A paid order's cancel, made as the customer would, for the admin to see. */
    open(USERS['buyer@example.com'], { p_order: 'o-o01', p_kind: 'cancel', p_reason: 'changed_mind' });
    await page.goto(base + '/account/refunds', { waitUntil: 'networkidle' });
    await page.waitForSelector('.rq-list[data-ready="yes"]', { state: 'attached', timeout: 15000 });
    const list = await page.evaluate(() => ({
      rows: [...document.querySelectorAll('.rq-list .rq-row')].map(e => e.innerText.replace(/\s+/g, ' ').trim()),
      opens: [...document.querySelectorAll('.rq-list .rq-row a.ac-link')].map(a => a.getAttribute('href')),
      lead: [...document.querySelectorAll('.ac-card .ac-lead')].map(e => e.textContent).join(' '),
      mine: !!document.querySelector('.rq-orders'),
    }));
    is(list.rows.length === 3 && /^Cancel the order · VB-RQO01/i.test(list.rows[0]) && /^Cancel the order · VB-RQP01/i.test(list.rows[1]) &&
       /^Exchange · VB-RQD01 Withdrawn/i.test(list.rows[2]), 'every request, the newest first, each with its order', J(list.rows));
    is(list.opens.length === 3 && /\/account\/orders\/VB-RQO01$/.test(list.opens[0]), 'each opens its order', J(list.opens));
    is(/open the order in My orders/.test(list.lead) && list.mine, 'how to ask: open the order in My orders, with the button', list.lead);

    /* ------------------------------------------------------------------ 6 */
    console.log('\n6. On a phone');
    await orderPage(page, 'VB-RQD01');
    await page.click('.rq-ask[data-kinds="return exchange"]');
    await page.check('.rq-kinds input[value="exchange"]');
    const fit = await page.evaluate(() => {
      const W = document.documentElement.clientWidth;
      const inside = [...document.querySelectorAll('.rq-form, .rq-form select, .rq-form input, .rq-form textarea, .rq-form .btn, .rq-row')]
        .every(e => { const r = e.getBoundingClientRect(); return r.width === 0 || (r.left >= -0.5 && r.right <= W + 0.5); });
      return { fits: document.documentElement.scrollWidth <= W + 1, inside };
    });
    is(fit.fits && fit.inside, 'the form and the requests fit a phone: nothing off the side, no sideways scrolling', J(fit));
    await ctx.close();

    /* ------------------------------------------------------------------ 7 */
    console.log('\n7. Admin > Orders');
    const ctxA = await context(browser, { width: 1280, height: 900 });
    const admin = await ctxA.newPage(); watch(admin);
    await admin.goto(base + '/admin.html', { waitUntil: 'domcontentloaded' });
    await admin.waitForSelector('#login:not(.hide)', { timeout: 15000 });
    await admin.fill('#email', 'owner@example.com');
    await admin.fill('#password', PASSWORD);
    await admin.click('#loginBtn');
    await admin.waitForSelector('#admin:not(.hide)', { timeout: 15000 });
    await admin.evaluate(() => { location.hash = '#/orders'; });
    await admin.selectOption('#ordFilter', '');
    await admin.waitForSelector('#ordList .ord-rq', { timeout: 15000 });
    const card = ref => admin.evaluate((r) => {
      const c = [...document.querySelectorAll('#ordList .card')].find(x => x.innerText.indexOf(r) > -1);
      if (!c) return null;
      return { boxes: [...c.querySelectorAll('.ord-rq')].map(b => ({ text: b.innerText.replace(/\s+/g, ' ').trim(), state: b.getAttribute('data-state'),
        buttons: [...b.querySelectorAll('button')].map(x => x.textContent) })), status: (c.querySelector('select') || {}).value };
    }, ref);
    let cp = await card('VB-RQP01');
    is(cp && cp.boxes.length === 1 && /^Request RQ-\w+ · Cancel the order Waiting for your answer/.test(cp.boxes[0].text) &&
       /Reason: Ordered it by mistake/.test(cp.boxes[0].text) && J(cp.boxes[0].buttons) === J(['Accept', 'Decline']),
       'the cancel under its order: what was asked, why, and Accept or Decline', J(cp));
    const cd = await card('VB-RQD01');
    is(cd && cd.boxes.length === 1 && cd.boxes[0].state === 'withdrawn' && cd.boxes[0].buttons.length === 0 &&
       /Withdrawn by the customer/.test(cd.boxes[0].text) && /Pieces: Linen Dress, Silk Scarf/.test(cd.boxes[0].text) &&
       /Would like instead: The same dress in size M/.test(cd.boxes[0].text) && /In their words: The waist is too tight for me\./.test(cd.boxes[0].text),
       'the withdrawn exchange: all it said, and nothing to press', J(cd));

    const dialog = async (fill, press) => {
      await admin.waitForSelector('.ask-card', { timeout: 5000 });
      const d = await admin.evaluate(() => ({ title: (document.querySelector('.ask-card h3') || {}).textContent,
        note: (document.querySelector('.ask-card .ask-note') || {}).textContent || '',
        label: (document.querySelector('.ask-card .ask-label') || {}).textContent || '' }));
      if (fill !== null) await admin.fill('.ask-card .ask-input', fill);
      await admin.click('.ask-card .ask-row button:has-text("' + press + '")');
      await admin.waitForSelector('.ask-card', { state: 'detached', timeout: 5000 }).catch(() => {});
      return d;
    };
    const decideCalls = () => calls('request_decide_admin');
    await admin.click('#ordList .card:has-text("VB-RQP01") .ord-rq-decline');
    let dg = await dialog('', 'Decline');
    is(/^Your answer to the customer/.test(dg.label), 'Decline asks for the answer to the customer', J(dg));
    const t1 = await admin.waitForSelector('.ask-card', { timeout: 5000 }).then(() => admin.textContent('.ask-card')).catch(() => '');
    is(/Say why, in a few words/.test(t1) && decideCalls().length === 0, 'declined with no word: refused here, nothing sent', t1);
    await admin.click('.ask-card .ask-row button');
    await admin.waitForSelector('.ask-card', { state: 'detached', timeout: 5000 }).catch(() => {});

    await admin.click('#ordList .card:has-text("VB-RQP01") .ord-rq-accept');
    dg = await dialog('We have cancelled it for you.', 'Accept');
    is(/The order is cancelled at once, as if you set it to Cancelled/.test(dg.note), 'Accept says what happens: cancelled at once', J(dg));
    const t2 = await admin.waitForSelector('.ask-card', { timeout: 5000 }).then(() => admin.textContent('.ask-card')).catch(() => '');
    is(/The order is cancelled, and the customer will be emailed\./.test(t2), 'accepted: the order is cancelled, the customer to be emailed', t2);
    await admin.click('.ask-card .ask-row button');
    await admin.waitForSelector('.ask-card', { state: 'detached', timeout: 5000 }).catch(() => {});
    cp = await card('VB-RQP01');
    const dc = decideCalls()[0];
    is(dc && dc.as === 'owner@example.com' && dc.body.p_decision === 'accept' && dc.body.p_answer === 'We have cancelled it for you.',
       'sent as the signed-in administrator, with the word for the customer', J(dc));
    is(cp && cp.status === 'cancelled' && cp.boxes[0].state === 'done' && cp.boxes[0].buttons.length === 0 &&
       /The answer: We have cancelled it for you\./.test(cp.boxes[0].text) && /Answered .+ by owner@example\.com, here/.test(cp.boxes[0].text),
       'the order shows Cancelled; the request Done, with the answer and who gave it', J(cp));
    is(byRef('VB-RQP01').status === 'cancelled', 'and the order is cancelled in the database');

    await admin.click('#ordList .card:has-text("VB-RQO01") .ord-rq-accept');
    dg = await dialog('', 'Accept');
    is(/paid online.*Sales › Online Refund.*the refund cancels the order/i.test(dg.note), 'a paid order: Accept says to refund it in the platform\'s Online Refund', J(dg));
    const t3 = await admin.waitForSelector('.ask-card', { timeout: 5000 }).then(() => admin.textContent('.ask-card')).catch(() => '');
    is(/Now refund it in the business platform \(Sales › Online Refund\)/.test(t3), 'accepted: the refund is the platform\'s to make', t3);
    await admin.click('.ask-card .ask-row button');
    await admin.waitForSelector('.ask-card', { state: 'detached', timeout: 5000 }).catch(() => {});
    const co = await card('VB-RQO01');
    is(co && co.status === 'pending' && co.boxes[0].state === 'accepted' && J(co.boxes[0].buttons) === J(['Mark done', 'Decline']) &&
       byRef('VB-RQO01').status === 'pending', 'paid online: not cancelled here; the request Accepted, to be marked done after the refund', J(co));
    await admin.click('#ordList .card:has-text("VB-RQO01") .ord-rq-done');
    await dialog('', 'Mark done');
    await admin.waitForFunction(() => {
      const c = [...document.querySelectorAll('#ordList .card')].find(x => x.innerText.indexOf('VB-RQO01') > -1);
      return !!(c && c.querySelector('.ord-rq[data-state="done"]'));
    }, null, { timeout: 10000 }).catch(() => {});
    const co2 = await card('VB-RQO01');
    is(co2 && co2.boxes[0].state === 'done' && co2.boxes[0].buttons.length === 0 && decideCalls().length === 3, 'marked done', J(co2));

    /* ------------------------------------------------------------------ 9 */
    console.log('\n9. Settings > Customer Accounts');
    await admin.evaluate(() => { location.hash = '#/settings/customer-accounts'; });
    await admin.waitForSelector('#f_customerRequests', { state: 'attached', timeout: 15000 });
    const shown = id => admin.evaluate(i => { const e = document.getElementById(i); const f = e && e.closest('.field'); return !!f && !f.classList.contains('hide') && f.offsetParent !== null; }, id);
    const st = await admin.evaluate(() => {
      const sw = document.getElementById('f_customerRequests').closest('.field');
      const days = document.getElementById('f_returnDays').closest('.field');
      return { sw: (sw.querySelector('.sw-lab') || {}).textContent, swHint: !!sw.querySelector('.hint'),
               days: (days.querySelector('label') || {}).textContent, daysHint: !!days.querySelector('.hint'),
               on: document.getElementById('f_customerRequests').checked, value: document.getElementById('f_returnDays').value };
    });
    is(st.sw === 'Let customers ask to cancel, return or exchange, or report a problem' && /^Days after delivery to ask for a return or exchange/.test(st.days || ''),
       'the switch and the days, in plain words', J(st));
    is(!st.swHint && !st.daysHint, 'no sentences explaining them, as the owner asked', J(st));
    is(st.on === true && st.value === '7' && await shown('f_returnDays'), 'as saved: on, 7 days, the days shown', J(st));
    await admin.evaluate(() => document.getElementById('f_customerRequests').click());
    is(!(await shown('f_returnDays')), 'switched off: the days are hidden');
    await admin.evaluate(() => document.getElementById('f_customerRequests').click());
    is(await shown('f_returnDays'), 'switched on again: shown');
    await admin.fill('#f_returnDays', '0');
    const before = SAVED.length;
    await admin.click('.save-bar .btn-gold');
    await admin.waitForTimeout(400);
    const err0 = await admin.evaluate(() => (document.getElementById('f_returnDays').closest('.field').querySelector('.err-txt') || {}).textContent || '');
    is(/Cannot be less than 1/.test(err0) && SAVED.length === before, '0 days: refused, nothing saved', err0);
    await admin.fill('#f_returnDays', '10');
    await admin.click('.save-bar .btn-gold');
    await admin.waitForFunction(n => window.__n === undefined, before).catch(() => {});
    await admin.waitForTimeout(600);
    const saved = SAVED.filter(s => s && s.key === 'customer-accounts').pop();
    is(saved && saved.data && saved.data.customerRequests === true && Number(saved.data.returnDays) === 10 && saved.data.accountsEnabled === true,
       'saved: on, 10 days, and the rest of the section as it was', J(saved));
    await ctxA.close();

    /* ------------------------------------------------------------------ 8 */
    console.log('\n8. The customer sees the shop\'s answer');
    const ctxB = await context(browser);
    const back = await ctxB.newPage(); watch(back);
    await signIn(back, 'buyer@example.com');
    v = await orderPage(back, 'VB-RQP01');
    const badge = await back.textContent('.acd .ac-order-top .ac-status');
    is(v.states[0] === 'done' && /^Cancel the order Done/i.test(v.rows[0]) && /From the shop: We have cancelled it for you\./.test(v.rows[0]) &&
       badge === 'Cancelled' && v.withdraw === 0, 'Done, with the shop\'s word; the order Cancelled; nothing left to withdraw', J([v, badge]));
    is(!/owner@example\.com/.test(J(v)), 'who in the team answered is not shown to the customer');
    await ctxB.close();

    is(errors.length === 0, 'no page errors', errors.join(' | '));
  } catch (e) {
    is(false, 'the test itself broke', e && e.stack);
  }
  await browser.close();
  server.close();
  console.log('\n  customers\' requests: ' + (failures ? failures + ' of ' + checks + ' checks FAILED' : 'all ' + checks + ' checks passed'));
  process.exit(failures ? 1 : 0);
})();
