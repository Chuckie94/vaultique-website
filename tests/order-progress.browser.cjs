/* ===========================================================================
   AN ORDER'S PROGRESS, IN THE BROWSER -- website build 78 (platform 509)

   THE OWNER: "The user will have to update the goods status whether shipped
   or not and it should appear on the customer's side against that order.
   Once delivered, customer should update and appear on user side."
   And: "Change the word that the customer presses from I have received it
   to confirm delivery."

   The real index.html, admin.html and assets, and the REAL supabase-js (from
   ../vendor, as the other browser tests use it). Supabase's sign-in, tables
   and functions are answered here, following supabase-order-progress.sql.

     1. The customer's account: each order rung up at the shop says where it
        is, step by step (Paid, Preparing, On its way or Ready for collection,
        Delivered or Collected), with the shop's note, the day it will be
        marked delivered, more time, a refund. Ask for more time, then
        Confirm delivery. Orders the till never rang up read as before. A
        website whose SQL has not been run yet lists every order, with no
        button. On a phone.
     2. The private link from the email, signed out: the order alone, the
        same steps and buttons; a wrong link says so. On a phone.
     3. The admin's Orders: where each order is, in a sentence, and the
        filter has the steps.
     4. The admin sign-in check: an owner whose admins list cannot be read is
        let in on the database's own word (build 77 shut them out); a
        customer is told which login was refused.
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
  () => require.resolve('@supabase/supabase-js/dist/umd/supabase.js'),
  () => path.resolve(ROOT, '..', 'vendor', 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd', 'supabase.js'),
]) {
  try { const f = p(); if (fs.existsSync(f)) { SUPABASE_JS = fs.readFileSync(f, 'utf8'); break; } } catch (e) {}
}
if (!SUPABASE_JS) {
  console.log('  order progress in the browser: skipped (the real supabase-js is not installed here: npm install @supabase/supabase-js@2 in ../vendor)');
  process.exit(0);
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const piece = (o) => Object.assign({ category: 'Bags', size: '', color: '', material: '', available: true,
  lowStock: false, wasPrice: 0, brand: '', description: 'A piece.', details: [], variantGroup: '', maxQty: 5,
  image_url: '/pic/a.png', gallery: [] }, o);
const CATALOGUE = [piece({ name: 'Linen Dress', sku: 'LD-9', price: 1400 })];

const USERS = {
  'owner@example.com': { id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.com', admin: true },
  'buyer@example.com': { id: '22222222-2222-4222-8222-222222222222', email: 'buyer@example.com', admin: false },
};
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
  return { access_token: access, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600,
           refresh_token: refresh, user: userBody(u) };
}
const who = req => TOKENS[String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')] || null;

const D = 86400000;
const at = (min) => new Date(Date.now() - min * 60000).toISOString();
const ahead = (ms) => new Date(Date.now() + ms).toISOString();
const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const P0 = { pos_sale_id: null, ship_note: null, dispatched_at: null, ready_at: null, delivered_at: null, delivered_by: null,
  auto_deliver_at: null, extend_days: null, extend_max: null, extend_used: null, remind_days: null,
  refund_state: null, refund_amount: null, refund_ref: null, refund_note: null, refund_at: null, paid_at: null, progress_token: null };
const buyer = USERS['buyer@example.com'].id;
let ORDERS;
function seed() {
  const o = (x) => Object.assign({ currency: 'ZMW', customer_id: buyer, name: 'Test Buyer', phone: '0977000001',
    pos_receipt: null, pos_receipt_no: null, pos_completed_at: null, order_items: [{ sku: 'LD-9', name: 'Linen Dress', price: 1400, qty: 1 }] }, P0, x);
  ORDERS = [
    o({ id: 'o-prep', ref: 'VB-PREP1', status: 'confirmed', total: 1530, fulfilment: 'delivery', created_at: at(300),
        pos_sale_id: 'S-1', pos_receipt_no: 'RCT-0001', pos_completed_at: at(200), paid_at: at(250) }),
    o({ id: 'o-onwy', ref: 'VB-ONWY1', status: 'dispatched', total: 1530, fulfilment: 'delivery', created_at: at(3000),
        pos_sale_id: 'S-2', pos_receipt_no: 'RCT-0002', pos_completed_at: at(2900), paid_at: at(2950),
        dispatched_at: at(1440), ship_note: 'With Courier X', auto_deliver_at: ahead(6 * D), extend_days: 3, extend_max: 2,
        extend_used: 0, remind_days: 2, progress_token: TOKEN }),
    o({ id: 'o-coll', ref: 'VB-COLL1', status: 'ready', total: 800, fulfilment: 'collection', created_at: at(500),
        pos_sale_id: 'S-3', pos_receipt_no: 'RCT-0003', pos_completed_at: at(400), ready_at: at(100),
        ship_note: 'At the Livingstone shop from 10:00' }),
    o({ id: 'o-done', ref: 'VB-DONE1', status: 'completed', total: 600, fulfilment: 'collection', created_at: at(600),
        pos_sale_id: 'S-4', pos_receipt_no: 'RCT-0004', pos_completed_at: at(590) }),
    o({ id: 'o-rfnd', ref: 'VB-RFND1', status: 'delivered', total: 1200, fulfilment: 'delivery', created_at: at(9000),
        pos_sale_id: 'S-5', pos_receipt_no: 'RCT-0005', pos_completed_at: at(8900), dispatched_at: at(8000),
        delivered_at: at(6000), delivered_by: 'auto', refund_state: 'full', refund_amount: 1200, refund_ref: 'FLW-RF-77',
        refund_at: at(60) }),
    o({ id: 'o-open', ref: 'VB-OPEN1', status: 'pending', total: 1400, fulfilment: 'delivery', created_at: at(30) }),
    o({ id: 'o-gst', ref: 'VB-GUEST', customer_id: null, name: 'Guest Shopper', status: 'dispatched', total: 1200,
        fulfilment: 'delivery', created_at: at(4000), pos_sale_id: 'S-6', pos_receipt_no: 'RCT-0006', pos_completed_at: at(3900),
        dispatched_at: at(60), auto_deliver_at: ahead(7 * D), extend_days: 3, extend_max: 2, extend_used: 1, remind_days: 2,
        progress_token: 'f00df00df00df00df00df00df00df00df00df00d',
        order_items: [{ sku: 'SC-2', name: 'Silk Scarf', price: 600, qty: 2 }] }),
  ];
}
seed();
let PROGRESS_THERE = true;    // whether supabase-order-progress.sql has been run
let ADMINS_UNREADABLE = false; // the admins table answers nobody anything (no read rule)
let CALLS = [];
const byId = id => ORDERS.find(o => o.id === id);

/* order_progress_out, as the SQL builds it. */
function out(o) {
  const days = o.extend_days == null ? 3 : o.extend_days, max = o.extend_max == null ? 2 : o.extend_max, used = o.extend_used || 0;
  return { ref: o.ref, status: o.status, fulfilment: o.fulfilment, rungUp: !!o.pos_sale_id,
    paidAt: o.paid_at || o.pos_completed_at, preparingAt: o.pos_completed_at, dispatchedAt: o.dispatched_at, readyAt: o.ready_at,
    deliveredAt: o.delivered_at, deliveredBy: o.delivered_by, note: o.ship_note, autoAt: o.auto_deliver_at,
    remindDays: o.remind_days, remindedAt: null,
    extend: { days, max, used, left: Math.max(0, max - used),
              can: o.status === 'dispatched' && !!o.auto_deliver_at && !o.delivered_at && used < max && days > 0 },
    refund: o.refund_state ? { state: o.refund_state, amount: o.refund_amount, ref: o.refund_ref, note: o.refund_note, at: o.refund_at } : null };
}
/* order_customer_step, as the SQL does it. */
function step(o, action) {
  if (action === 'confirm') {
    if (o.status === 'delivered') return { ok: true, again: true, progress: out(o) };
    if (o.status !== 'dispatched') return { ok: false, why: 'not_on_its_way', progress: out(o) };
    Object.assign(o, { status: 'delivered', delivered_at: new Date().toISOString(), delivered_by: 'customer' });
  } else {
    const w = out(o).extend;
    if (!w.can) return { ok: false, why: o.status !== 'dispatched' ? 'not_on_its_way' : 'no_more_time', progress: out(o) };
    o.auto_deliver_at = new Date(Math.max(Date.parse(o.auto_deliver_at), Date.now()) + (o.extend_days || 3) * D).toISOString();
    o.extend_used = (o.extend_used || 0) + 1;
  }
  return { ok: true, again: false, progress: out(o) };
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css',
                '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
let base = '';
const PROGRESS_SELECT = /dispatched_at|ship_note|auto_deliver_at/;
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
    if (p === '/web/rest/v1/site_settings' && u.searchParams.get('key') === 'eq.customer-accounts') {
      return send(200, [{ data: { accountsEnabled: true, orderHistory: true, guestCheckout: true } }]);
    }
    if (p === '/web/rest/v1/admins') return send(200, usr && usr.admin && !ADMINS_UNREADABLE ? [{ id: usr.id }] : []);
    if (p === '/web/rest/v1/rpc/is_admin') return send(200, !!(usr && usr.admin));
    if (p === '/web/rest/v1/rpc/my_access') {
      return send(200, usr && usr.admin
        ? { is_admin: true, is_owner: true, active: true, role: 'owner', permissions: {}, must_change_password: false }
        : { is_admin: false, is_owner: false, active: false, role: null, permissions: {} });
    }
    if (p === '/web/rest/v1/customers') return send(200, usr ? [{ id: usr.id, name: 'Test Buyer', phone: '0977000001', wishlist: [] }] : []);
    if (p === '/web/rest/v1/orders' && req.method === 'GET') {
      const sel = String(u.searchParams.get('select') || '');
      if (!PROGRESS_THERE && PROGRESS_SELECT.test(sel)) {
        return send(400, { code: '42703', message: 'column orders.ship_note does not exist' });
      }
      const rows = usr && usr.admin ? ORDERS : (usr ? ORDERS.filter(o => o.customer_id === usr.id) : []);
      return send(200, rows.map(o => {
        const r = JSON.parse(J(o));
        /* '*' is every column there is: all of them, or (before the SQL) all but the progress. */
        const every = /(^|,)\s*\*/.test(sel);
        if (every && !PROGRESS_THERE) Object.keys(P0).forEach(k => { if (k !== 'pos_sale_id' && k !== 'paid_at') delete r[k]; });
        if (!every && !PROGRESS_SELECT.test(sel)) Object.keys(P0).forEach(k => { if (k !== 'pos_sale_id' || !/pos_/.test(sel)) delete r[k]; });
        return r;
      }));
    }
    if (p === '/web/rest/v1/rpc/order_confirm_delivery' || p === '/web/rest/v1/rpc/order_extend_delivery') {
      if (!PROGRESS_THERE) return send(404, { message: 'not found' });
      if (!usr) return send(200, { ok: false, why: 'signin' });
      const o = byId(body.p_id);
      if (!o || o.customer_id !== usr.id) return send(200, { ok: false, why: 'not_found' });
      return send(200, step(o, /confirm/.test(p) ? 'confirm' : 'extend'));
    }
    if (p === '/web/rest/v1/rpc/order_progress_link') {
      if (!PROGRESS_THERE) return send(404, { message: 'not found' });
      const o = ORDERS.find(x => x.ref === String(body.p_ref || '').toUpperCase() && x.progress_token && x.progress_token === body.p_token);
      if (!o) return send(200, { ok: false, why: 'not_found' });
      let r = null;
      if (body.p_action === 'confirm' || body.p_action === 'extend') r = step(o, body.p_action);
      return send(200, { ok: r ? r.ok : true, why: r && r.why, done: r && r.ok ? body.p_action : null,
        order: { ref: o.ref, createdAt: o.created_at, firstName: o.name.split(' ')[0], total: o.total, currency: 'ZMW',
                 receiptNo: o.pos_receipt_no, items: o.order_items.map(i => ({ name: i.name, qty: i.qty })) },
        progress: out(o) });
    }
    if (p.startsWith('/web/rest/v1/rpc/')) return send(200, null);
    if (p.startsWith('/web/rest/v1/')) return send(200, []);
    if (p.startsWith('/web/')) return send(200, {});
    if (p === '/api/products') return send(200, { products: CATALOGUE, count: CATALOGUE.length, version: 't' });
    if (p.startsWith('/.netlify/functions/')) return send(200, {});
    if (p.indexOf('/pic/') === 0) { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(PNG); }
    if (p === '/config.js') {
      res.writeHead(200, { 'Content-Type': TYPES['.js'] });
      return res.end('window.VBP_CONFIG={SUPABASE_URL:"' + base + '/web",SUPABASE_ANON_KEY:"anon"};');
    }
    /* Signing in, as the shop's own sign-in does, on this site's address. */
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
  const ctx = await browser.newContext({ viewport: viewport || { width: 1200, height: 900 } });
  await ctx.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'text/javascript',
    body: /\/@supabase\/supabase-js/.test(r.request().url()) ? SUPABASE_JS : '' }));
  await ctx.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await ctx.route('**/fonts.gstatic.com/**', r => r.fulfill({ status: 200, body: '' }));
  await ctx.route('**/cdnjs.cloudflare.com/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  return ctx;
}
const text = el => el.innerText.replace(/\s+/g, ' ').trim();
async function cards(page) {
  return page.evaluate(() => [...document.querySelectorAll('.ac-order')].map(r => ({
    ref: r.getAttribute('data-ref'),
    text: r.innerText.replace(/\s+/g, ' ').trim(),
    badge: (r.querySelector('.ac-status') || {}).textContent || '',
    steps: [...r.querySelectorAll('.pg-step')].map(s => ({ key: s.getAttribute('data-step'), done: s.classList.contains('done'),
                                                           t: s.innerText.replace(/\s+/g, ' ').trim() })),
    buttons: [...r.querySelectorAll('.pg-acts button')].map(b => b.textContent.trim()),
  })));
}
async function signIn(page, email) {
  await page.goto(base + '/__shop.html', { waitUntil: 'load' });
  await page.evaluate((e) => window.SHOP.auth.signInWithPassword({ email: e, password: 'the-right-password-1' }), email);
  await page.goto(base + '/account', { waitUntil: 'networkidle' });
  await page.waitForSelector('.ac-order', { timeout: 15000 });
}

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const errors = [];
  const watch = (page) => page.on('pageerror', e => errors.push(String(e.message || e)));
  try {
    /* ------------------------------------------------------------------ 1 */
    console.log('\n1. The customer\'s account');
    const ctx = await context(browser);
    const page = await ctx.newPage(); watch(page);
    await signIn(page, 'buyer@example.com');
    await page.waitForSelector('.pg-step', { timeout: 15000 });
    let c = await cards(page);
    const card = ref => c.find(x => x.ref === ref) || { text: '', steps: [], buttons: [], badge: '' };
    const prep = card('VB-PREP1');
    is(/^Preparing$/i.test(prep.badge.trim()) && prep.steps.map(s => s.key + (s.done ? '+' : '-')).join(' ') === 'placed+ preparing+ onway- delivered-',
       'rung up, the goods still to go: Preparing, with Paid and Preparing done', J(prep));
    const paidShown = await page.evaluate((iso) => 'Paid ' + window.VBP_PROGRESS.when(iso), byId('o-prep').paid_at);
    const placedShown = await page.evaluate((iso) => 'Paid ' + window.VBP_PROGRESS.when(iso), byId('o-prep').created_at);
    is(prep.steps[0].t === paidShown && paidShown !== placedShown && prep.buttons.length === 0,
       'the first step is Paid, with the date it was paid (not the day it was ordered); nothing to press yet',
       J({ shown: prep.steps[0].t, paid: paidShown, ordered: placedShown, buttons: prep.buttons }));
    const onwy = card('VB-ONWY1');
    is(/^On its way$/i.test(onwy.badge.trim()) && onwy.steps[2].done && /With Courier X/.test(onwy.steps[2].t),
       'on its way: the step done, with the shop\'s note', J(onwy.steps[2]));
    is(/It will be marked delivered on \d+ \w{3} \d{4}, \d\d:\d\d unless you confirm first\./.test(onwy.text)
       && /You can ask for 3 more days, 2 times\./.test(onwy.text),
       'it says the day it will be marked delivered, and the time still to ask for', onwy.text);
    is(J(onwy.buttons) === J(['Confirm delivery', 'Ask for more time']),
       'two buttons: Confirm delivery and Ask for more time', J(onwy.buttons));
    is(c.every(x => !/I have received it/i.test(x.text)), 'nowhere does it say "I have received it"');
    const coll = card('VB-COLL1');
    is(/^Ready for collection$/i.test(coll.badge.trim()) && coll.steps.map(s => s.key).join(' ') === 'placed preparing ready delivered'
       && /At the Livingstone shop from 10:00/.test(coll.text) && /Collected/.test(coll.steps[3].t) && coll.buttons.length === 0,
       'for collection: Ready for collection, with the note, then Collected; nothing for the customer to press', J(coll));
    const done = card('VB-DONE1');
    is(/^Completed$/i.test(done.badge.trim()) && /Completed at the shop · Receipt RCT-0004/.test(done.text) && done.steps.length === 0,
       'taken at the counter: Completed, as in build 76', J(done));
    const prepTxt = prep.text;
    is(/Rung up at the shop · Receipt RCT-0001/.test(prepTxt) && !/Completed at the shop/.test(prepTxt),
       'an order still to go is not called completed: "Rung up at the shop"', prepTxt);
    const rf = card('VB-RFND1');
    is(/^Delivered$/i.test(rf.badge.trim()) && /marked automatically when the days ran out/.test(rf.text)
       && /Refunded: K\s?1,200(\.00)? on \d+ \w{3} \d{4}, \d\d:\d\d \(reference FLW-RF-77\)\./.test(rf.text),
       'delivered by the days running out, and a refund, with its reference', rf.text);
    const open = card('VB-OPEN1');
    is(/^Pending$/i.test(open.badge.trim()) && open.steps.length === 0, 'an order the till never rang up reads as it always did', J(open));

    console.log('\n   Ask for more time, then Confirm delivery');
    CALLS = [];
    await page.click('.ac-order[data-ref="VB-ONWY1"] .pg-extend');
    await page.waitForFunction(() => /Done: 3 more days/.test((document.querySelector('.ac-order[data-ref="VB-ONWY1"] .pg-msg') || {}).textContent || ''), null, { timeout: 10000 });
    c = await cards(page);
    is(CALLS.some(x => x.fn === 'order_extend_delivery' && x.as === 'buyer@example.com' && x.body.p_id === 'o-onwy'),
       'Ask for more time asks the database, as the signed-in customer, for that order', J(CALLS));
    is(/Done: 3 more days\. It will now be marked delivered on \d+ \w{3} \d{4}, \d\d:\d\d\./.test(card('VB-ONWY1').text)
       && /once more\./.test(card('VB-ONWY1').text), 'it says so, with the new day, and once more left', card('VB-ONWY1').text);
    await page.click('.ac-order[data-ref="VB-ONWY1"] .pg-confirm');
    await page.waitForFunction(() => /^Delivered$/i.test(((document.querySelector('.ac-order[data-ref="VB-ONWY1"] .ac-status') || {}).textContent || '').trim()), null, { timeout: 10000 });
    c = await cards(page);
    const after = card('VB-ONWY1');
    is(after.steps[3].done && /confirmed by you/.test(after.steps[3].t) && /Thank you\. Your order is marked delivered\./.test(after.text)
       && after.buttons.length === 0 && byId('o-onwy').delivered_by === 'customer',
       'Confirm delivery: Delivered, confirmed by you, thanked, and nothing more to press', J(after));

    console.log('\n   On a phone');
    seed();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base + '/account', { waitUntil: 'networkidle' });
    await page.waitForSelector('.ac-order[data-ref="VB-ONWY1"] .pg-acts', { timeout: 15000 });
    const fit = await page.evaluate(() => {
      const W = document.documentElement.clientWidth;
      const card = document.querySelector('.ac-order[data-ref="VB-ONWY1"]');
      const cr = card.getBoundingClientRect();
      const inside = [...card.querySelectorAll('.pg-step, .pg-auto, .pg-more, .pg-acts button')]
        .every(e => { const r = e.getBoundingClientRect(); return r.left >= cr.left - 0.5 && r.right <= cr.right + 0.5; });
      const tall = [...card.querySelectorAll('.pg-acts button')].map(b => b.getBoundingClientRect().height);
      return { W, page: document.documentElement.scrollWidth <= W + 1, inside, tall };
    });
    is(fit.page && fit.inside && fit.tall.length === 2 && fit.tall.every(h => h >= 40),
       'the steps and the two buttons fit a phone, and each button is big enough to press', J(fit));

    console.log('\n   A website whose SQL has not been run yet');
    PROGRESS_THERE = false;
    await page.goto(base + '/account', { waitUntil: 'networkidle' });
    /* The list, or its "Nothing yet": either says what the page did. */
    await page.waitForFunction(() => document.querySelector('.ac-order')
      || /Nothing yet/.test((document.querySelector('.ac-list') || {}).textContent || ''), null, { timeout: 15000 }).catch(() => {});
    c = await cards(page);
    is(c.length === 6 && c.every(x => x.steps.length === 0 && x.buttons.length === 0) && /Receipt RCT-0002/.test(card('VB-ONWY1').text),
       'every order is still listed, with its receipt, and no step or button', J(c.map(x => x.ref + ':' + x.badge)));
    PROGRESS_THERE = true;
    await ctx.close();

    /* ------------------------------------------------------------------ 2 */
    console.log('\n2. The private link from the email, signed out');
    seed();
    const ctxL = await context(browser, { width: 390, height: 844 });
    const link = await ctxL.newPage(); watch(link);
    await link.goto(base + '/order/VB-GUEST?t=f00df00df00df00df00df00df00df00df00df00d', { waitUntil: 'networkidle' });
    await link.waitForSelector('#orderModal.open .pg-step', { timeout: 15000 });
    const lk = await link.evaluate(() => {
      const m = document.querySelector('#orderModal'), card = m.querySelector('.modal-card');
      const W = document.documentElement.clientWidth, cr = card.getBoundingClientRect();
      return { text: m.innerText.replace(/\s+/g, ' ').trim(), head: (document.getElementById('olHead') || {}).textContent,
               steps: [...m.querySelectorAll('.pg-step')].map(s => s.getAttribute('data-step') + (s.classList.contains('done') ? '+' : '-')).join(' '),
               buttons: [...m.querySelectorAll('.pg-acts button')].map(b => b.textContent.trim()),
               fits: cr.left >= -0.5 && cr.right <= W + 0.5 && document.documentElement.scrollWidth <= W + 1 };
    });
    is(lk.head === 'VB-GUEST' && /Hello Guest\. Here is where your order is\./.test(lk.text) && /2 × Silk Scarf/.test(lk.text)
       && /Receipt RCT-0006/.test(lk.text), 'the order alone: its number, a greeting, the pieces and the receipt', lk.text);
    is(lk.steps === 'placed+ preparing+ onway+ delivered-' && J(lk.buttons) === J(['Confirm delivery', 'Ask for more time'])
       && /once more\./.test(lk.text), 'the same steps and buttons as the account page, with once more left', J(lk));
    is(lk.fits && !/0977|Plot/.test(lk.text), 'it fits a phone, and shows no phone number or address', J(lk));
    CALLS = [];
    await link.click('#orderModal .pg-extend');
    await link.waitForFunction(() => /Done: 3 more days/.test(document.querySelector('#orderModal').innerText), null, { timeout: 10000 });
    is(CALLS.some(x => x.fn === 'order_progress_link' && x.as === 'anon' && x.body.p_action === 'extend' && x.body.p_ref === 'VB-GUEST'),
       'Ask for more time, by the link alone, with nobody signed in', J(CALLS));
    const noMore = await link.evaluate(() => document.querySelector('#orderModal').innerText.replace(/\s+/g, ' '));
    is(/More time has been given as often as it can be/.test(noMore) && !/Ask for more time/.test(noMore.split('Done:')[0] + ''),
       'the second time used, it says so, and offers no more', noMore);
    await link.click('#orderModal .pg-confirm');
    await link.waitForFunction(() => /Thank you\. Your order is marked delivered\./.test(document.querySelector('#orderModal').innerText), null, { timeout: 10000 });
    is(byId('o-gst').status === 'delivered' && byId('o-gst').delivered_by === 'customer', 'Confirm delivery, behind the link: delivered, by the customer');
    await link.goto(base + '/order/VB-GUEST?t=0000000000000000000000000000000000000000', { waitUntil: 'networkidle' });
    await link.waitForFunction(() => /This link does not open an order/.test((document.getElementById('olLead') || {}).textContent || ''), null, { timeout: 10000 });
    is(true, 'a wrong link says it does not open an order, and nothing else');
    await ctxL.close();

    /* ------------------------------------------------------------------ 3 */
    console.log('\n3. The admin\'s Orders');
    seed();
    Object.assign(byId('o-onwy'), { extend_used: 1 });
    Object.assign(byId('o-prep'), {});
    byId('o-rfnd').delivered_by = 'customer';
    const ctxA = await context(browser);
    const admin = await ctxA.newPage(); watch(admin);
    await admin.goto(base + '/admin.html', { waitUntil: 'domcontentloaded' });
    await admin.waitForSelector('#login:not(.hide)', { timeout: 15000 });
    await admin.fill('#email', 'owner@example.com');
    await admin.fill('#password', PASSWORD);
    await admin.click('#loginBtn');
    await admin.waitForSelector('#admin:not(.hide)', { timeout: 15000 });
    await admin.evaluate(() => { location.hash = '#/orders'; });
    await admin.selectOption('#ordFilter', '');
    await admin.waitForSelector('#ordList .card .progress-line', { timeout: 15000 });
    await admin.waitForTimeout(300);
    const rows = await admin.evaluate(() => [...document.querySelectorAll('#ordList .card')].map(c => ({
      text: c.innerText.replace(/\s+/g, ' '), go: (c.querySelector('.progress-line') || {}).textContent || '',
      rf: (c.querySelector('.refund-line') || {}).textContent || '' })));
    const row = ref => rows.find(r => r.text.indexOf(ref) > -1) || { go: '', rf: '' };
    is(/^On its way since .+ \d\d:\d\d \(With Courier X\) · marked delivered automatically on .+ \d\d:\d\d unless the customer confirms first · more time asked 1 of 2$/.test(row('VB-ONWY1').go),
       'on its way: since when, the note, the day, and more time asked', row('VB-ONWY1').go);
    is(/^Ready for collection since .+ \d\d:\d\d \(At the Livingstone shop from 10:00\)$/.test(row('VB-COLL1').go),
       'ready for collection: since when, and the note', row('VB-COLL1').go);
    is(/^Delivered on .+ \d\d:\d\d, confirmed by the customer$/.test(row('VB-RFND1').go)
       && /^Refunded K\s?1,200(\.00)? on .+ \d\d:\d\d · FLW-RF-77$/.test(row('VB-RFND1').rf),
       'delivered, by whose word, and the refund', J(row('VB-RFND1')));
    is(row('VB-PREP1').go === 'Preparing: rung up at the shop, the goods still to go' && row('VB-OPEN1').go === '' && row('VB-DONE1').go === '',
       'preparing says so; an order not rung up, or taken at the counter, says nothing more', J([row('VB-PREP1').go, row('VB-OPEN1').go]));
    const filter = await admin.evaluate(() => [...document.querySelectorAll('#ordFilter option')].map(o => o.textContent.trim()));
    is(['Ready for collection', 'On its way', 'Delivered'].every(w => filter.indexOf(w) > -1), 'the Orders filter has the steps', J(filter));
    await ctxA.close();

    /* ------------------------------------------------------------------ 4 */
    console.log('\n4. The admin sign-in check');
    ADMINS_UNREADABLE = true;
    const ctxO = await context(browser);
    const own = await ctxO.newPage(); watch(own);
    await own.goto(base + '/admin.html', { waitUntil: 'domcontentloaded' });
    await own.waitForSelector('#login:not(.hide)', { timeout: 15000 });
    await own.fill('#email', 'owner@example.com');
    await own.fill('#password', PASSWORD);
    await own.click('#loginBtn');
    const inOrOut = await Promise.race([
      own.waitForSelector('#admin:not(.hide)', { timeout: 15000 }).then(() => 'in'),
      own.waitForFunction(() => /administrator/i.test((document.getElementById('loginMsg') || {}).textContent || ''), null, { timeout: 15000 }).then(() => 'refused'),
    ]).catch(() => 'nothing');
    is(inOrOut === 'in', 'an owner whose admins list cannot be read is let in on the database\'s own word (build 77 shut them out)', inOrOut);
    await ctxO.close();
    ADMINS_UNREADABLE = false;
    const ctxB = await context(browser);
    const cust = await ctxB.newPage(); watch(cust);
    await cust.goto(base + '/admin.html', { waitUntil: 'domcontentloaded' });
    await cust.waitForSelector('#login:not(.hide)', { timeout: 15000 });
    await cust.fill('#email', 'buyer@example.com');
    await cust.fill('#password', PASSWORD);
    await cust.click('#loginBtn');
    await cust.waitForFunction(() => /list of administrators/.test((document.getElementById('loginMsg') || {}).textContent || ''), null, { timeout: 15000 });
    const said = await cust.evaluate(() => document.getElementById('loginMsg').textContent);
    is(/^The login buyer@example\.com is not on this shop's list of administrators, so the admin stays closed to it\. A customer account signs in on the shop itself, not here\.$/.test(said)
       && !(await cust.$('#admin:not(.hide)')), 'a customer is kept out, and told which login was refused', said);
    await ctxB.close();

    is(errors.length === 0, 'no script error on any page', errors.join(' | '));
  } catch (e) {
    is(false, 'the test itself broke', e && e.stack);
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failures ? '\n  ✗ ' + failures + ' of ' + checks + ' checks FAILED' : '\n  order progress in the browser: all ' + checks + ' checks passed');
  process.exit(failures ? 1 : 0);
})();
