/* ===========================================================================
   WEBSITE ORDERS AT THE TILL, IN THE BROWSER -- build 76 (platform 508)

   THE OWNER: "This is the website, I want to link its order numbers with the
   platform. The order numbers should be searchable in the platform as online
   orders. Once a transaction has been completed on the platform with that
   order number, the product is sold and show order completed on the website.
   If the customer has an account, a receipt can then appear in a download
   able manner."

   The real index.html, admin.html and assets, and the REAL supabase-js (from
   ../vendor, as tests/admin-session.browser.cjs uses it). Supabase's sign-in
   and tables, and the rewards function, are answered here.

     1. The WhatsApp message starts with the order's number, and points are
        promised on that same number. A slow or failed recording still sends
        the message, without a number, as before. One tap, one order.
     2. A customer's account: the completed order says so, with its receipt
        number, and "Download receipt" gives a real PDF of what the till
        printed. A website whose SQL has not been run yet still lists the
        orders. On a phone.
     3. The admin's Orders tab says when an order was rung up at the shop, and
        when a till is ringing it up now.
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
  console.log('  website orders at the till: skipped (the real supabase-js is not installed here: npm install @supabase/supabase-js@2 in ../vendor)');
  process.exit(0);
}

/* ---------------- the shop ---------------- */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const piece = (o) => Object.assign({ category: 'Bags', size: '', color: '', material: '', available: true,
  lowStock: false, wasPrice: 0, brand: '', description: 'A piece.', details: [], variantGroup: '', maxQty: 5,
  image_url: '/pic/a.png', gallery: [] }, o);
const CATALOGUE = [piece({ name: 'Woven Tote', sku: 'BG-WOTO', price: 1150 }),
                   piece({ name: 'Leather Satchel', sku: 'BG-SATC', price: 3200 })];
let ACCOUNTS_ON = false;
let PLACE = 'ok';             // ok | slow | fail
let PLACED = [];              // every place_order the database was asked for
let HOLDS = [];               // every promise of points
let COLUMNS_THERE = true;     // whether supabase-pos-orders.sql has been run

/* ---------------- Supabase, answering by who is asking ---------------- */
const USERS = {
  'owner@example.com':  { id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.com', admin: true },
  'buyer@example.com':  { id: '22222222-2222-4222-8222-222222222222', email: 'buyer@example.com', admin: false },
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

const at = (min) => new Date(Date.now() - min * 60000).toISOString();
/* The buyer's orders, as the website keeps them. */
const RECEIPT = {
  v: 1, shop: { name: 'Vaultique Boutique', address: 'Plot 10, Lusaka', contact: '+260 970 000 000' },
  receiptNo: 'RCT-000123', invoiceNo: 'INV-2026-0456', date: at(30), cashier: 'Mary', customer: 'Test Buyer',
  currency: 'ZMW', lines: [{ sku: 'BG-WOTO', name: 'Woven Tote', qty: 1, unit: 1150, total: 1150 },
                           { sku: 'BG-BELT', name: 'Belt (tan) \u2014 large', qty: 2, unit: 75, total: 150 }],
  delivery: 0, total: 1300, points: { points: 500, value: 50 }, amountPaid: 1250,
  payments: [{ method: 'Mobile Money', amount: 1250, ref: 'MM-8841' }], footer: 'Thank you for shopping with us',
};
const MINE = [
  { id: 'o-1', ref: 'VB-3F9K2', status: 'completed', total: 1300, currency: 'ZMW', fulfilment: 'collection', created_at: at(90),
    order_items: [{ sku: 'BG-WOTO', name: 'Woven Tote', price: 1150, qty: 1 }, { sku: 'BG-BELT', name: 'Belt', price: 75, qty: 2 }],
    pos_receipt_no: 'RCT-000123', pos_receipt: RECEIPT, pos_completed_at: at(30) },
  { id: 'o-2', ref: 'VB-7HM4P', status: 'pending', total: 3200, currency: 'ZMW', fulfilment: 'delivery', created_at: at(20),
    order_items: [{ sku: 'BG-SATC', name: 'Leather Satchel', price: 3200, qty: 1 }],
    pos_receipt_no: null, pos_receipt: null, pos_completed_at: null },
];
/* What the admin's Orders tab reads: every order, the till's part included. */
const ALL = [
  Object.assign({}, MINE[0], { name: 'Test Buyer', phone: '0977000001', customer_id: USERS['buyer@example.com'].id,
    pos_sale_id: 'S-1001', pos_invoice_no: 'INV-2026-0456', pos_claim_id: null }),
  Object.assign({}, MINE[1], { name: 'Test Buyer', phone: '0977000001', customer_id: USERS['buyer@example.com'].id,
    pos_sale_id: null, pos_claim_id: 'till-aaaa-0001', pos_claimed_by: 'Mary (Till 1)', pos_claimed_at: at(5) }),
  { id: 'o-3', ref: 'VB-Q2W8E', status: 'pending', total: 450, currency: 'ZMW', fulfilment: 'collection', created_at: at(10),
    name: 'Guest Shopper', phone: '0966000002', customer_id: null, order_items: [{ sku: 'SC-1', name: 'Silk scarf', price: 450, qty: 1 }],
    pos_sale_id: null, pos_claim_id: null },
];

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
    if (p === '/web/rest/v1/rpc/place_order') {
      PLACED.push({ as: usr ? usr.email : 'guest', order: body.p_order });
      const answer = () => send(200, { id: 'new-' + PLACED.length, ref: 'VB-N' + String(PLACED.length).padStart(4, '0') });
      if (PLACE === 'fail') return send(500, { message: 'the database is having a moment' });
      if (PLACE === 'slow') return setTimeout(answer, 7500);
      return answer();
    }
    if (p === '/web/rest/v1/site_settings' && u.searchParams.get('key') === 'eq.customer-accounts') {
      return send(200, ACCOUNTS_ON ? [{ data: { accountsEnabled: true, orderHistory: true, guestCheckout: true } }] : []);
    }
    if (p === '/web/rest/v1/site_settings' && u.searchParams.get('key') === 'eq.shopping') {
      return send(200, [{ data: { rewardsOnline: true } }]);
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
      const sel = String(u.searchParams.get('select') || '');
      /* Before supabase-pos-orders.sql: PostgREST refuses a column that is not there. */
      if (!COLUMNS_THERE && /pos_/.test(sel)) {
        return send(400, { code: '42703', message: 'column orders.pos_receipt_no does not exist' });
      }
      if (usr && usr.admin) return send(200, ALL);
      if (usr) return send(200, MINE.map(o => {
        const r = Object.assign({}, o);
        if (!/pos_/.test(sel)) { delete r.pos_receipt_no; delete r.pos_receipt; delete r.pos_completed_at; }
        return r;
      }));
      return send(200, []);
    }
    if (p.startsWith('/web/rest/v1/rpc/')) return send(200, null);
    if (p.startsWith('/web/rest/v1/')) return send(200, []);
    if (p.startsWith('/web/')) return send(200, {});

    if (p === '/.netlify/functions/rewards') {
      if (!usr) return send(401, { error: 'Please sign in to your account first.' });
      if (body.action === 'status') return send(200, { linked: true, number: 'VB0007', points: 100500, worth: 50.25,
        perK1: 100, canRedeem: true, milestone: { milestone: 100000, reached: 1, next: 200000 }, milestoneValue: 50 });
      if (body.action === 'quote') return send(200, { quote: { points: 60000, value: 30 } });
      if (body.action === 'hold') { HOLDS.push(body); return send(200, { held: { points: 60000, value: 30 }, number: 'VB0007' }); }
      return send(200, {});
    }
    if (p === '/api/products') return send(200, { products: CATALOGUE, count: CATALOGUE.length, version: 't' });
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
  const ctx = await browser.newContext({ viewport: viewport || { width: 1200, height: 900 }, acceptDownloads: true });
  await ctx.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'text/javascript',
    body: /\/@supabase\/supabase-js/.test(r.request().url()) ? SUPABASE_JS : '' }));
  await ctx.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await ctx.route('**/fonts.gstatic.com/**', r => r.fulfill({ status: 200, body: '' }));
  await ctx.route('**/cdnjs.cloudflare.com/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  return ctx;
}
/* window.open answered here: the tab the order form opens, and where it went. */
async function catchTabs(ctx) {
  await ctx.addInitScript(() => {
    window.__opened = [];
    window.open = function (u) {
      const tab = { location: { href: u || '' }, close() { tab.closed = true; } };
      window.__opened.push(tab); return tab;
    };
  });
}
const sentText = async (page) => {
  const tabs = await page.evaluate(() => window.__opened.map(t => ({ href: t.location.href, closed: !!t.closed })));
  const live = tabs.filter(t => !t.closed && /wa\.me/.test(t.href));
  return { tabs, text: live.length ? decodeURIComponent(live[live.length - 1].href.split('text=')[1] || '') : '' };
};
async function order(page, opts) {
  await page.goto(base + '/product/BG-WOTO', { waitUntil: 'networkidle' });
  await page.click('#buyDetail');
  await page.waitForSelector('#odGo', { timeout: 10000 });
  if (await page.$('#od_name')) await page.fill('#od_name', 'Chanda');
  if (await page.$('#od_phone')) await page.fill('#od_phone', '0977000007');
  if (opts && opts.points) { await page.waitForSelector('#od_points', { timeout: 8000 }); await page.check('#od_points'); }
  await page.check('#od_consent');
  if (opts && opts.twice) await page.evaluate(() => { const b = document.getElementById('odGo'); b.click(); b.click(); });
  else await page.click('#odGo');
}

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const errors = [];
  const watch = (page) => page.on('pageerror', e => errors.push(String(e.message || e)));
  try {
    /* ------------------------------------------------------------------ 1 */
    console.log('\n1. The order number in the WhatsApp message');
    const ctx = await context(browser); await catchTabs(ctx);
    const shop = await ctx.newPage(); watch(shop);

    PLACE = 'ok'; PLACED = [];
    await order(shop);
    await shop.waitForFunction(() => window.__opened.some(t => /wa\.me/.test(t.location.href)), null, { timeout: 8000 });
    let s = await sentText(shop);
    is(PLACED.length === 1, 'the order is recorded once', J(PLACED));
    is(/^Order VB-N0001\n\nHello /.test(s.text), 'the message starts with the order number, then the message as before', s.text);
    is(/Woven Tote/.test(s.text) && /Name: Chanda/.test(s.text) && /Phone: 0977000007/.test(s.text),
       'the piece and the details follow, as before', s.text);
    is(s.tabs.length === 1, 'one tab, opened by the tap itself', J(s.tabs));

    PLACE = 'fail'; PLACED = [];
    await order(shop);
    await shop.waitForFunction(() => window.__opened.some(t => /wa\.me/.test(t.location.href)), null, { timeout: 8000 });
    s = await sentText(shop);
    is(!/Order VB-/.test(s.text) && /^Hello /.test(s.text), 'the database refuses: the message still goes, without a number, exactly as before', s.text);

    PLACE = 'slow'; PLACED = [];
    const t0 = Date.now();
    await order(shop);
    await shop.waitForFunction(() => window.__opened.some(t => /wa\.me/.test(t.location.href)), null, { timeout: 12000 });
    const waited = Date.now() - t0;
    s = await sentText(shop);
    is(!/Order VB-/.test(s.text) && waited < 9500, 'a recording that hangs: the message goes after six seconds, without a number (' + waited + ' ms)', s.text);
    await shop.waitForTimeout(2200);
    s = await sentText(shop);
    is(s.tabs.filter(t => /wa\.me/.test(t.href)).length === 1, 'and the late answer opens nothing more', J(s.tabs));

    PLACE = 'ok'; PLACED = [];
    await order(shop, { twice: true });
    await shop.waitForFunction(() => window.__opened.some(t => /wa\.me/.test(t.location.href)), null, { timeout: 8000 });
    await shop.waitForTimeout(500);
    s = await sentText(shop);
    is(PLACED.length === 1 && s.tabs.length === 1, 'two quick taps: one order, one tab', J({ placed: PLACED.length, tabs: s.tabs }));
    await ctx.close();

    console.log('\n   With points, from an account');
    ACCOUNTS_ON = true;
    const ctxP = await context(browser); await catchTabs(ctxP);
    const signin = await ctxP.newPage(); watch(signin);
    await signin.goto(base + '/__shop.html', { waitUntil: 'load' });
    await signin.evaluate(() => window.SHOP.auth.signInWithPassword({ email: 'buyer@example.com', password: 'the-right-password-1' }));
    await signin.close();
    const shopP = await ctxP.newPage(); watch(shopP);
    PLACE = 'ok'; PLACED = []; HOLDS = [];
    await order(shopP, { points: true });
    await shopP.waitForFunction(() => window.__opened.some(t => /wa\.me/.test(t.location.href)), null, { timeout: 8000 });
    s = await sentText(shopP);
    is(PLACED.length === 1 && PLACED[0].as === 'buyer@example.com', 'the order is recorded under the customer\'s account', J(PLACED));
    is(HOLDS.length === 1 && HOLDS[0].orderRef === 'VB-N0001', 'the points are promised on the order\'s own number', J(HOLDS));
    is(/^Order VB-N0001\n/.test(s.text) && /Ref VB-N0001\./.test(s.text) && /customer number VB0007/.test(s.text),
       'the message carries the number at the top and as the points\' reference', s.text);

    PLACE = 'fail'; PLACED = []; HOLDS = [];
    await order(shopP, { points: true });
    await shopP.waitForFunction(() => window.__opened.some(t => /wa\.me/.test(t.location.href)), null, { timeout: 8000 });
    s = await sentText(shopP);
    is(HOLDS.length === 1 && /^RW-[A-Z0-9]{6}$/.test(HOLDS[0].orderRef) && /Ref RW-[A-Z0-9]{6}\./.test(s.text) && !/Order VB-/.test(s.text),
       'not recorded: the points keep a reference of their own, as before', J(HOLDS) + ' ' + s.text);

    /* ------------------------------------------------------------------ 2 */
    console.log('\n2. The customer\'s account, on a phone');
    await shopP.setViewportSize({ width: 390, height: 844 });
    await shopP.goto(base + '/account', { waitUntil: 'networkidle' });
    await shopP.waitForSelector('.ac-order', { timeout: 15000 });
    const card = await shopP.evaluate(() => [...document.querySelectorAll('.ac-order')].map(r => ({
      text: r.innerText.replace(/\s+/g, ' '), button: !!r.querySelector('.ac-receipt'),
      fits: (() => { const b = r.querySelector('.ac-receipt'); if (!b) return null;
        const a = b.getBoundingClientRect(), c = r.getBoundingClientRect(); return a.right <= c.right + 0.5 && a.left >= c.left - 0.5; })() })));
    const done = card.find(c => /VB-3F9K2/.test(c.text)), open = card.find(c => /VB-7HM4P/.test(c.text));
    is(done && /Completed/i.test(done.text) && /Completed at the shop · Receipt RCT-000123/.test(done.text),
       'the order rung up at the shop says Completed, with its receipt number', done && done.text);
    is(done && done.button && done.fits, 'with a Download receipt button, inside the card on a phone', J(done));
    is(open && !open.button && !/Receipt/.test(open.text), 'an order not rung up yet has no receipt and no button', open && open.text);

    const [dl] = await Promise.all([shopP.waitForEvent('download', { timeout: 8000 }),
      shopP.click('.ac-order:has-text("VB-3F9K2") .ac-receipt')]);
    const file = await dl.path();
    const pdf = fs.readFileSync(file).toString('latin1');
    /* A PDF writes ( ) and \ inside its text as \( \) and \\: read as text. */
    const said = pdf.replace(/\\([()\\])/g, '$1');
    is(dl.suggestedFilename() === 'Receipt-RCT-000123.pdf', 'the file is named after the receipt', dl.suggestedFilename());
    is(/^%PDF-1\.4\n/.test(pdf) && /%%EOF\n$/.test(pdf) && /\/BaseFont \/Courier\b/.test(pdf), 'it is a PDF, in the till receipt\'s typeface');
    const xref = Number((pdf.match(/startxref\n(\d+)\n/) || [])[1]);
    is(pdf.slice(xref, xref + 4) === 'xref', 'its index points where it should, so every reader opens it');
    for (const want of ['VAULTIQUE BOUTIQUE', 'Receipt: RCT-000123', 'Invoice: INV-2026-0456', 'Online order: VB-3F9K2',
                        'Cashier: Mary', 'Woven Tote', 'TOTAL', 'Points redeemed (500)', 'AMOUNT PAID', 'Mobile Money', 'MM-8841']) {
      is(said.indexOf(want) > -1, 'it says ' + want);
    }
    is(said.indexOf('Belt (tan) \x97') > -1 && said.indexOf('Belt (tan) ?') < 0, 'a dash in a name comes out as a dash (WinAnsi 0x97), not a question mark');

    console.log('\n   A website whose SQL has not been run yet');
    COLUMNS_THERE = false;
    await shopP.goto(base + '/account', { waitUntil: 'networkidle' });
    await shopP.waitForSelector('.ac-order', { timeout: 15000 });
    const old = await shopP.evaluate(() => [...document.querySelectorAll('.ac-order')].map(r => r.innerText.replace(/\s+/g, ' ')));
    is(old.length === 2 && !(await shopP.$('.ac-receipt')), 'the orders are still listed, without the receipt part', J(old));
    COLUMNS_THERE = true;
    await ctxP.close();
    ACCOUNTS_ON = false;

    /* ------------------------------------------------------------------ 3 */
    console.log('\n3. The admin\'s Orders tab');
    const ctxA = await context(browser);
    const admin = await ctxA.newPage(); watch(admin);
    await admin.goto(base + '/admin.html', { waitUntil: 'domcontentloaded' });
    await admin.waitForSelector('#login:not(.hide)', { timeout: 15000 });
    await admin.fill('#email', 'owner@example.com');
    await admin.fill('#password', PASSWORD);
    await admin.click('#loginBtn');
    await admin.waitForSelector('#admin:not(.hide)', { timeout: 15000 });
    await admin.evaluate(() => { location.hash = '#/orders'; });
    await admin.waitForSelector('#ordList .card', { timeout: 15000 });
    await admin.waitForTimeout(300);
    const rows = await admin.evaluate(() => [...document.querySelectorAll('#ordList .card')].map(c => ({
      text: c.innerText.replace(/\s+/g, ' '), till: (c.querySelector('.till-line') || {}).textContent || '',
      status: (c.querySelector('select') || {}).value, label: (c.querySelector('select option:checked') || {}).textContent })));
    const r1 = rows.find(r => /VB-3F9K2/.test(r.text)), r2 = rows.find(r => /VB-7HM4P/.test(r.text)), r3 = rows.find(r => /VB-Q2W8E/.test(r.text));
    is(r1 && /^Rung up at the shop · Receipt RCT-000123 · Invoice INV-2026-0456 · .+ \d\d:\d\d$/.test(r1.till),
       'rung up at the shop: the receipt, the invoice and when', r1 && r1.till);
    is(r1 && r1.status === 'completed' && /Completed — rung up at the shop/.test(r1.label), 'its status reads Completed — rung up at the shop', r1 && r1.label);
    is(r2 && /^Being rung up at the shop by Mary \(Till 1\), since .+ \d\d:\d\d$/.test(r2.till), 'a till ringing it up now: who, and since when', r2 && r2.till);
    is(r3 && r3.till === '', 'an order the till has not touched says nothing more', r3 && r3.till);
    await ctxA.close();

    is(errors.length === 0, 'no script error on any page', errors.join(' | '));
  } catch (e) {
    is(false, 'the test itself broke', e && e.stack);
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failures ? '\n  ✗ ' + failures + ' of ' + checks + ' checks FAILED' : '\n  website orders at the till: all ' + checks + ' checks passed');
  process.exit(failures ? 1 : 0);
})();
