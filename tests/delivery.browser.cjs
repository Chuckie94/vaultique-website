/* ===========================================================================
   DELIVERY, IN THE BROWSER -- website build 89 (the customer portal's
   delivery build; platform 512 records the courier through its door)

   The portal plan: "Delivery: the courier and tracking number shown with the
   order; instructions for delivery at checkout and on the order; the invoice
   to download."

   The real index.html, admin.html and assets, and the REAL supabase-js.
   Supabase's sign-in, tables and functions are answered here, following
   supabase-delivery.sql.

     1. At checkout: "Delivery instructions" asked when the order is to be
        delivered, put away when it is collected; sent with the order and
        written into the WhatsApp message. On a phone.
     2. The customer's order: its instructions, changed until it is on its
        way (and the shop told); the courier, the tracking number, the
        courier's own page (only an https one) and the updates; the invoice
        to download, a real PDF. On a phone.
     3. The private link from the email: the courier and tracking, never the
        instructions.
     4. Admin > Orders: the instructions, and the courier and tracking
        recorded by an administrator until platform 512 does it.
   SHOTS=<folder> keeps a picture of each.
   =========================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const SHOTS = process.env.SHOTS || '';

let checks = 0, failures = 0;
const is = (c, m, x) => { checks++; if (c) console.log('  ✓ ' + m); else { failures++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); } };
const J = o => JSON.stringify(o);

let SUPABASE_JS = null;
for (const p of [
  // Website 80: the copy the site itself loads (build 79's line keeps it in assets/vendor).
  () => path.join(ROOT, 'assets', 'vendor', 'supabase-js-2.118.0.js'),
  () => require.resolve('@supabase/supabase-js/dist/umd/supabase.js'),
  () => path.resolve(ROOT, '..', 'vendor', 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd', 'supabase.js'),
]) {
  try { const f = p(); if (fs.existsSync(f)) { SUPABASE_JS = fs.readFileSync(f, 'utf8'); break; } } catch (e) {}
}
if (!SUPABASE_JS) {
  console.log('  delivery in the browser: skipped (the real supabase-js is not installed here: npm install @supabase/supabase-js@2 in ../vendor)');
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
const CLOSES = [];            // website 80: every press of Close my account that reached the function
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
const buyer = USERS['buyer@example.com'].id;
const RECEIPT = { shop: { name: 'Vaultique Boutique', address: 'Cairo Road, Lusaka', contact: '+260 970 000 000', taxId: '1000000000' },
  receiptNo: 'RCT-0002', invoiceNo: 'INV-0099', date: at(2900), customer: 'Test Buyer',
  lines: [{ sku: 'LD-9', name: 'Linen Dress', qty: 1, unit: 1400, total: 1400 }], delivery: 130, total: 1530,
  amountPaid: 1530, payments: [{ method: 'Cash', amount: 1530 }], footer: 'Thank you for shopping with us.' };
let ORDERS, CALLS, PLACED;
function seed() {
  const o = (x) => Object.assign({ currency: 'ZMW', customer_id: buyer, name: 'Test Buyer', phone: '0977000001', email: 'buyer@example.com',
    address: 'Plot 9, Lusaka', pos_receipt: null, pos_receipt_no: null, pos_invoice_no: null, pos_completed_at: null, pos_sale_id: null,
    paid_at: null, ship_note: null, dispatched_at: null, ready_at: null, delivered_at: null, delivered_by: null, auto_deliver_at: null,
    extend_days: 3, extend_max: 2, extend_used: 0, remind_days: 2, refund_state: null, progress_token: null,
    delivery_instructions: null, instructions_at: null, ship_courier: null, ship_tracking: null, ship_tracking_url: null, ship_updates: null,
    order_items: [{ sku: 'LD-9', name: 'Linen Dress', price: 1400, qty: 1 }] }, x);
  ORDERS = [
    o({ id: 'o-open', ref: 'VB-OPEN1', status: 'pending', total: 1400, fulfilment: 'delivery', created_at: at(30),
        delivery_instructions: 'Blue gate', instructions_at: at(30) }),
    o({ id: 'o-onwy', ref: 'VB-ONWY1', status: 'dispatched', total: 1530, fulfilment: 'delivery', created_at: at(3000),
        pos_sale_id: 'S-2', pos_receipt_no: 'RCT-0002', pos_invoice_no: 'INV-0099', pos_receipt: RECEIPT, pos_completed_at: at(2900),
        paid_at: at(2950), dispatched_at: at(1440), auto_deliver_at: ahead(6 * D), progress_token: TOKEN,
        delivery_instructions: 'Green gate, ask for Mary', instructions_at: at(3000),
        ship_courier: 'Yango', ship_tracking: 'YG-55091', ship_tracking_url: 'https://yango.example/t/YG-55091',
        ship_updates: [{ at: at(1400), text: 'Handed to Yango in Lusaka' }, { at: at(300), text: 'With the rider in Kabulonga' }] }),
    o({ id: 'o-bad', ref: 'VB-BADL1', status: 'dispatched', total: 600, fulfilment: 'delivery', created_at: at(2000),
        pos_sale_id: 'S-3', pos_receipt_no: 'RCT-0003', pos_completed_at: at(1900), dispatched_at: at(60), auto_deliver_at: ahead(6 * D),
        ship_courier: 'Courier Z', ship_tracking: 'Z-1', ship_tracking_url: 'javascript:alert(1)' }),
  ];
  CALLS = [];
  PLACED = [];
}
seed();
const byId = id => ORDERS.find(o => o.id === id);
const shipOut = (o) => (o.ship_courier || o.ship_tracking || o.ship_tracking_url || (o.ship_updates || []).length)
  ? { courier: o.ship_courier, tracking: o.ship_tracking, url: o.ship_tracking_url, updates: o.ship_updates || [] } : null;
function out(o) {
  return { ref: o.ref, status: o.status, fulfilment: o.fulfilment, rungUp: !!o.pos_sale_id, paidAt: o.paid_at || o.pos_completed_at,
    preparingAt: o.pos_completed_at, dispatchedAt: o.dispatched_at, readyAt: o.ready_at, deliveredAt: o.delivered_at,
    deliveredBy: o.delivered_by, note: o.ship_note, autoAt: o.auto_deliver_at, remindDays: o.remind_days, remindedAt: null,
    extend: { days: 3, max: 2, used: 0, left: 2, can: o.status === 'dispatched' }, refund: null, ship: shipOut(o) };
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css',
                '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
let base = '';
const SETTINGS = {
  'customer-accounts': { accountsEnabled: true, orderHistory: true, guestCheckout: true },
  delivery: { deliveryEnabled: true, pickupEnabled: true, pickupUseShopAddress: false, pickupLocation: 'Cairo Road, Lusaka' },
  shopping: { whatsappCheckout: true, requireName: true, requirePhone: true, requireEmail: false, requireAddress: true,
              orderNotes: true, deliveryInstructions: true },
  contact: { orderNumber: '260970000000', whatsapp: '260970000000' },
};
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
    if (p === '/web/rest/v1/site_settings') {
      const key = (u.searchParams.get('key') || '').replace('eq.', '');
      if (key && SETTINGS[key]) return send(200, [{ key, data: SETTINGS[key] }]);
      if (!key) return send(200, Object.keys(SETTINGS).map(k => ({ key: k, data: SETTINGS[k] })));
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
    if (p === '/web/rest/v1/orders' && req.method === 'GET') {
      const rows = usr && usr.admin ? ORDERS : (usr ? ORDERS.filter(o => o.customer_id === usr.id) : []);
      return send(200, JSON.parse(J(rows)));
    }
    /* supabase-delivery.sql's order_set_instructions, as it decides. */
    if (p === '/web/rest/v1/rpc/order_set_instructions') {
      if (!usr) return send(200, { ok: false, why: 'signin' });
      const o = byId(body.p_id);
      if (!o || o.customer_id !== usr.id) return send(200, { ok: false, why: 'not_found' });
      if (o.fulfilment !== 'delivery') return send(200, { ok: false, why: 'collection' });
      if (['pending', 'confirmed'].indexOf(o.status) < 0 || o.dispatched_at) return send(200, { ok: false, why: 'on_its_way' });
      const t = String(body.p_text || '').replace(/\s+/g, ' ').trim();
      if (t.length > 300) return send(200, { ok: false, why: 'too_long' });
      o.delivery_instructions = t || null; o.instructions_at = new Date().toISOString();
      return send(200, { ok: true, again: false, instructions: o.delivery_instructions, at: o.instructions_at });
    }
    /* order_shipping_admin: an administrator only. */
    if (p === '/web/rest/v1/rpc/order_shipping_admin') {
      if (!usr || !usr.admin) return send(200, { ok: false, why: 'not_allowed' });
      const o = byId(body.p_id);
      if (!o) return send(200, { ok: false, why: 'not_found' });
      if (body.p_url && !/^https:\/\//.test(body.p_url)) return send(200, { ok: false, why: 'bad_link' });
      ['courier', 'tracking'].forEach(k => { if (body['p_' + k] != null) o['ship_' + k] = String(body['p_' + k]).trim() || null; });
      if (body.p_url != null) o.ship_tracking_url = String(body.p_url).trim() || null;
      if (body.p_update) o.ship_updates = (o.ship_updates || []).concat([{ at: new Date().toISOString(), text: body.p_update }]);
      return send(200, { ok: true, again: false, delivery: { instructions: o.delivery_instructions, courier: o.ship_courier,
        tracking: o.ship_tracking, trackingUrl: o.ship_tracking_url, updates: o.ship_updates || [] } });
    }
    if (p === '/web/rest/v1/rpc/order_progress_link') {
      const o = ORDERS.find(x => x.ref === String(body.p_ref || '').toUpperCase() && x.progress_token && x.progress_token === body.p_token);
      if (!o) return send(200, { ok: false, why: 'not_found' });
      return send(200, { ok: true, order: { ref: o.ref, createdAt: o.created_at, firstName: o.name.split(' ')[0], total: o.total,
        currency: 'ZMW', receiptNo: o.pos_receipt_no, items: o.order_items.map(i => ({ name: i.name, qty: i.qty })) }, progress: out(o) });
    }
    if (p.startsWith('/web/rest/v1/rpc/')) return send(200, null);
    if (p.startsWith('/web/rest/v1/')) return send(200, []);
    if (p.startsWith('/web/')) return send(200, {});
    if (p === '/api/products') return send(200, { products: CATALOGUE, count: CATALOGUE.length, version: 't' });
    if (p === '/.netlify/functions/place-order' && req.method === 'POST') {
      PLACED.push(body);
      return send(200, { id: 'ord-new', ref: 'VB-NEW01', total: 1400 });
    }
    if (p === '/.netlify/functions/account-portal') return send(200, { ok: true, refunds: [] });
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
  const ctx = await browser.newContext({ viewport: viewport || { width: 1200, height: 900 }, deviceScaleFactor: SHOTS ? 2 : 1, acceptDownloads: true });
  await ctx.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'text/javascript',
    body: /\/@supabase\/supabase-js/.test(r.request().url()) ? SUPABASE_JS : '' }));
  await ctx.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await ctx.route('**/fonts.gstatic.com/**', r => r.fulfill({ status: 200, body: '' }));
  await ctx.route('**/cdnjs.cloudflare.com/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  return ctx;
}
const shot = async (page, name) => {
  if (!SHOTS) return;
  await page.mouse.move(1, 1);
  await page.waitForTimeout(450);
  await page.screenshot({ path: path.join(SHOTS, name + '.png') });
};
async function signIn(page, email) {
  await page.goto(base + '/__shop.html', { waitUntil: 'load' });
  await page.evaluate((e) => window.SHOP.auth.signInWithPassword({ email: e, password: 'the-right-password-1' }), email);
}
const PHONE = { width: 390, height: 844 };

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const errors = [];
  const watch = (page) => page.on('pageerror', e => errors.push(String(e.message || e)));
  try {
    /* ------------------------------------------------------------------ 1 */
    console.log('\n1. At checkout');
    let ctx = await context(browser, PHONE);
    await ctx.addInitScript(() => {
      if (!sessionStorage.getItem('seeded')) { localStorage.setItem('vbp_cart', JSON.stringify([{ sku: 'LD-9', qty: 1 }])); sessionStorage.setItem('seeded', '1'); }
      window.open = function () { window.__tab = { closed: false, close: function () {}, location: {} }; return window.__tab; };
    });
    let page = await ctx.newPage(); watch(page);
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.card', { state: 'attached', timeout: 15000 }).catch(() => {});
    await page.click('#cartBtn');
    await page.waitForSelector('#ctGo', { timeout: 15000 });
    await page.click('#ctGo');
    await page.waitForSelector('#odGo', { timeout: 15000 });
    const shown = () => page.evaluate(() => {
      const box = document.getElementById('od_instructions'), lab = document.querySelector('label[for="od_instructions"]');
      return { box: !!box && !box.classList.contains('hide'), label: lab ? lab.textContent.replace(/\s+/g, ' ').trim() : '',
               ph: box ? box.placeholder : '' };
    });
    let s1 = await shown();
    is(s1.box && s1.label === 'Delivery instructions optional' && /landmark, the gate, the best time to deliver/.test(s1.ph),
       'to be delivered: "Delivery instructions", optional, for the courier', J(s1));
    await page.check('input[name="odHow"][value="collection"]');
    s1 = await shown();
    is(!s1.box, 'to be collected: put away', J(s1));
    await page.check('input[name="odHow"][value="delivery"]');
    await page.fill('#od_name', 'Chanda Banda');
    await page.fill('#od_phone', '0977123456');
    await page.fill('#od_address', 'Plot 12, Kabulonga Road, Lusaka');
    await page.fill('#od_instructions', '  Blue gate,\n call on arrival ');
    await page.evaluate(() => { const b = document.getElementById('od_instructions'); b.value = b.value.replace(/\s+/g, ' ').trim(); });
    if (await page.$('#od_consent')) await page.check('#od_consent');
    await shot(page, 'delivery-1-checkout-instructions');
    await page.click('#odGo');
    await page.waitForFunction(() => window.__tab && window.__tab.location && window.__tab.location.href, null, { timeout: 15000 }).catch(() => {});
    const wa = decodeURIComponent(await page.evaluate(() => (window.__tab && window.__tab.location.href) || ''));
    is(PLACED.length === 1 && PLACED[0].order.instructions === 'Blue gate, call on arrival' && PLACED[0].order.fulfilment === 'delivery',
       'sent with the order, on one line', J(PLACED.map(x => x.order)));
    is(/Delivery instructions: Blue gate, call on arrival/.test(wa) && /Order VB-NEW01/.test(wa),
       'and written into the WhatsApp message, under the order\'s number', wa.slice(0, 300));
    is(errors.length === 0, 'no script error', errors.join(' | '));
    await ctx.close();

    /* ------------------------------------------------------------------ 2 */
    console.log('\n2. The customer\'s order');
    seed();
    ctx = await context(browser, PHONE);
    page = await ctx.newPage(); watch(page);
    await signIn(page, 'buyer@example.com');
    await page.goto(base + '/account/orders/VB-OPEN1', { waitUntil: 'networkidle' });
    await page.waitForSelector('.acd-ins', { timeout: 15000 });
    let ins = await page.evaluate(() => ({ text: (document.querySelector('.acd-ins-txt') || {}).textContent || '',
      btn: (document.querySelector('.acd-ins-edit') || {}).textContent || '' }));
    is(ins.text === 'Blue gate' && ins.btn === 'Change instructions', 'the instructions given at checkout, and Change instructions', J(ins));
    await page.click('.acd-ins-edit');
    await page.fill('#acd_instructions', 'Green gate,\nask for Mary');
    await page.evaluate(() => document.querySelector('.acd-ins').scrollIntoView({ block: 'center', behavior: 'instant' }));
    await shot(page, 'delivery-2-order-change-instructions');
    await page.click('.acd-ins-save');
    await page.waitForFunction(() => /Saved ✓ We have let the shop know\./.test((document.querySelector('.acd-ins-msg') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
    ins = await page.evaluate(() => ({ text: (document.querySelector('.acd-ins-txt') || {}).textContent || '',
      msg: (document.querySelector('.acd-ins-msg') || {}).textContent || '' }));
    const call = CALLS.find(c => c.fn === 'order_set_instructions');
    is(call && call.as === 'buyer@example.com' && call.body.p_id === 'o-open' && /Green gate,\s+ask for Mary/.test(call.body.p_text) &&
       ins.text === 'Green gate, ask for Mary' && ins.msg === 'Saved ✓ We have let the shop know.',
       'changed: asked of the database as the customer, saved, and the shop told', J({ call, ins }));

    await page.goto(base + '/account/orders/VB-ONWY1', { waitUntil: 'networkidle' });
    await page.waitForSelector('.acd-kv', { timeout: 15000 });
    const onwy = await page.evaluate(() => {
      const kv = {};
      const dts = [...document.querySelectorAll('.acd-kv dt')];
      dts.forEach(dt => { kv[dt.textContent] = (dt.nextElementSibling || {}).textContent; });
      return { kv, track: (document.querySelector('.ac-track') || {}).href || '', target: (document.querySelector('.ac-track') || {}).target || '',
        ups: [...document.querySelectorAll('.acd-updates li')].map(li => li.textContent.replace(/\s+/g, ' ').trim()),
        ins: (document.querySelector('.acd-ins-txt') || {}).textContent || '', edit: !!document.querySelector('.acd-ins-edit'),
        invoice: !!document.querySelector('.ac-invoice'), receipt: !!document.querySelector('.ac-receipt'),
        shipInSteps: !!document.querySelector('.acd .pg-ship') };
    });
    is(onwy.kv['Courier'] === 'Yango' && onwy.kv['Tracking number'] === 'YG-55091' && onwy.kv['Invoice'] === 'INV-0099',
       'on its way: the courier, the tracking number and the invoice number', J(onwy.kv));
    is(onwy.track === 'https://yango.example/t/YG-55091' && onwy.target === '_blank',
       'Track your delivery: the courier\'s own page, in a new tab', J([onwy.track, onwy.target]));
    is(onwy.ups.length === 2 && /With the rider in Kabulonga$/.test(onwy.ups[0]) && /Handed to Yango in Lusaka$/.test(onwy.ups[1]),
       'the updates, the newest first', J(onwy.ups));
    is(onwy.ins === 'Green gate, ask for Mary' && !onwy.edit && !onwy.shipInSteps,
       'the instructions shown, no longer to be changed once on its way; the courier said once, not twice', J(onwy));
    await page.evaluate(() => {
      /* The site scrolls smoothly (styles.css), so jump straight there for the picture. */
      const h = [...document.querySelectorAll('.acd-h')].find(x => /Ordering and delivery/.test(x.textContent));
      if (h) window.scrollTo({ top: h.getBoundingClientRect().top + window.scrollY - 80, behavior: 'instant' });
    });
    await shot(page, 'delivery-3-order-on-its-way');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }).catch(() => null), page.click('.ac-invoice')]);
    let pdf = '';
    if (dl) { try { pdf = fs.readFileSync(await dl.path()).toString('latin1'); } catch (e) { pdf = ''; } }
    is(dl && dl.suggestedFilename() === 'Invoice-INV-0099.pdf' && /^%PDF-1\.4/.test(pdf) && /\(INVOICE\) Tj/.test(pdf) && /\(INV-0099\) Tj/.test(pdf),
       'Download invoice: a PDF named after the invoice, saying INVOICE and its number', dl ? dl.suggestedFilename() : 'no download');
    await page.goto(base + '/account/orders/VB-BADL1', { waitUntil: 'networkidle' });
    await page.waitForSelector('.acd-kv', { timeout: 15000 });
    const bad = await page.evaluate(() => ({ link: !!document.querySelector('.ac-track'), invoice: !!document.querySelector('.ac-invoice'),
      courier: [...document.querySelectorAll('.acd-kv dt')].some(d => d.textContent === 'Courier') }));
    is(!bad.link && bad.courier && !bad.invoice, 'a tracking link that is not a plain https page is never shown; no invoice without an invoice number', J(bad));
    is(errors.length === 0, 'no script error', errors.join(' | '));
    await ctx.close();

    /* ------------------------------------------------------------------ 3 */
    console.log('\n3. The private link');
    ctx = await context(browser, PHONE);
    page = await ctx.newPage(); watch(page);
    await page.goto(base + '/order/VB-ONWY1?t=' + TOKEN, { waitUntil: 'networkidle' });
    await page.waitForSelector('#orderModal.open .pg-ship', { timeout: 15000 }).catch(() => {});
    const lk = await page.evaluate(() => {
      const m = document.querySelector('#orderModal');
      return { text: m.innerText.replace(/\s+/g, ' '), track: (m.querySelector('.pg-track') || {}).href || '',
               ups: m.querySelectorAll('.pg-updates li').length };
    });
    is(/Courier: Yango/.test(lk.text) && /Tracking number: YG-55091/.test(lk.text) && lk.track === 'https://yango.example/t/YG-55091' && lk.ups === 2,
       'the courier, the tracking number, the courier\'s page and the updates', lk.text.slice(0, 300));
    is(!/Green gate|Plot 9/.test(lk.text), 'and never the instructions or the address');
    await shot(page, 'delivery-4-private-link');
    await ctx.close();

    /* ------------------------------------------------------------------ 4 */
    console.log('\n4. Admin > Orders');
    ctx = await context(browser);
    page = await ctx.newPage(); watch(page);
    await page.goto(base + '/admin.html', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#login:not(.hide)', { timeout: 15000 });
    await page.fill('#email', 'owner@example.com');
    await page.fill('#password', PASSWORD);
    await page.click('#loginBtn');
    await page.waitForSelector('#admin:not(.hide)', { timeout: 15000 });
    await page.evaluate(() => { location.hash = '#/orders'; });
    await page.selectOption('#ordFilter', '');
    await page.waitForSelector('#ordList .card .ord-ship', { timeout: 15000 }).catch(() => {});
    const card = () => page.evaluate(() => {
      const c = [...document.querySelectorAll('#ordList .card')].find(x => /VB-ONWY1/.test(x.innerText));
      return c ? { text: c.innerText.replace(/\s+/g, ' '), ship: (c.querySelector('.ord-ship-line') || {}).textContent || '' } : null;
    });
    let ac = await card();
    is(ac && /Delivery instructions: Green gate, ask for Mary/.test(ac.text) && /Courier and tracking: Yango, tracking YG-55091/.test(ac.ship),
       'the instructions, and the courier and tracking number', J(ac));
    await page.evaluate(() => {
      const c = [...document.querySelectorAll('#ordList .card')].find(x => /VB-ONWY1/.test(x.innerText));
      c.querySelector('.ord-ship-edit').click();
    });
    await page.waitForSelector('.ord-ship-form', { timeout: 5000 });
    await page.fill('.ord-ship-form .ord-ship-courier', 'Zampost');
    await page.fill('.ord-ship-form .ord-ship-tracking', 'ZP 778/19');
    await page.fill('.ord-ship-form .ord-ship-url', 'https://track.zampost.example/?n=ZP778-19');
    await page.fill('.ord-ship-form .ord-ship-update', 'Moved to Zampost in Lusaka');
    await shot(page, 'delivery-5-admin-courier');
    CALLS = [];
    await page.click('.ord-ship-form .ord-ship-save');
    await page.waitForFunction(() => [...document.querySelectorAll('.ord-ship-line')].some(l => /Zampost/.test(l.textContent)), null, { timeout: 10000 }).catch(() => {});
    const sc = CALLS.find(c => c.fn === 'order_shipping_admin');
    ac = await card();
    is(sc && sc.as === 'owner@example.com' && sc.body.p_id === 'o-onwy' && sc.body.p_courier === 'Zampost' && sc.body.p_tracking === 'ZP 778/19' &&
       sc.body.p_url === 'https://track.zampost.example/?n=ZP778-19' && sc.body.p_update === 'Moved to Zampost in Lusaka',
       'saved through the admin\'s own function, as the administrator', J(sc));
    is(ac && /Courier and tracking: Zampost, tracking ZP 778\/19/.test(ac.ship) && /Moved to Zampost in Lusaka/.test(ac.text),
       'and shown at once, with the update', J(ac && ac.ship));
    is(errors.length === 0, 'no script error', errors.join(' | '));
    await ctx.close();
  } catch (e) {
    is(false, 'the test itself broke', e && e.stack);
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failures ? '\n  ✗ ' + failures + ' of ' + checks + ' checks FAILED' : '\n  delivery in the browser: all ' + checks + ' checks passed');
  process.exit(failures ? 1 : 0);
})();
