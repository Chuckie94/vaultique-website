/* ===========================================================================
   SHOPPING (website build 90) -- in a real browser

   The customer portal's shopping build: everything a customer sees.
     1. Compare: two to four pieces, the bar while choosing, the page side by
        side, four at most, Remove; on a phone nothing wider than the screen.
     2. Alerts: signed out, asked to sign in; signed in, "Email me when it's
        back" on a sold-out piece and "Email me if the price drops" on one in
        stock, saved through alert_set with the shop's own price, and stopped.
     3. Questions & answers on a piece, and Ask a question (the live chat).
     4. Reviews from buyers: signed out, "Sign in to review it"; bought,
        Write a review as a verified buyer through review_by_buyer; not
        bought, said so; before supabase-shopping.sql, as before.
     5. The gift list: shared from the account, opened by anyone with the
        link (the pieces and a first name), stopped, and then nothing.
     6. Shopping preferences: sizes and categories saved on the account;
        categories first in the shop, "My sizes", the size marked on a piece.
     7. Recently purchased, and Order again: at today's prices, never more
        than the shop has, what is not on sale said.
     8. Product alerts in the account: waiting and sent, Stop.
     9. The dashboard's new cards; and each switched off in Settings.
   The real index.html, app.js, shopping.js and account.js, with the real
   supabase-js, against a stand-in Supabase. SHOTS=<folder> keeps pictures.
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
  () => path.join(ROOT, 'assets', 'vendor', 'supabase-js-2.118.0.js'),
  () => require.resolve('@supabase/supabase-js/dist/umd/supabase.js'),
]) {
  try { const f = p(); if (fs.existsSync(f)) { SUPABASE_JS = fs.readFileSync(f, 'utf8'); break; } } catch (e) {}
}
if (!SUPABASE_JS) {
  console.log('  shopping in the browser: skipped (the real supabase-js is not installed here)');
  process.exit(0);
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const piece = (o) => Object.assign({ category: 'Bags', size: '', color: '', material: '', available: true,
  lowStock: false, wasPrice: 0, brand: '', description: 'A piece.', details: [], variantGroup: '', maxQty: 5,
  image_url: '/pic/a.png', gallery: [] }, o);
let CATALOGUE;
function catalogue() {
  CATALOGUE = [
    piece({ name: 'Leather Satchel', sku: 'BG-1', price: 500, material: 'Leather', brand: 'Vaultique',
            details: [{ label: 'Strap', value: 'Adjustable' }] }),
    piece({ name: 'Silk Scarf', sku: 'SC-1', price: 300, category: 'Accessories', available: false, maxQty: 0, material: 'Silk' }),
    piece({ name: 'Linen Shirt', sku: 'LS-M', price: 450, category: 'Tops', size: 'M', color: 'White', variantGroup: 'LS' }),
    piece({ name: 'Linen Shirt', sku: 'LS-L', price: 450, category: 'Tops', size: 'L', color: 'White', variantGroup: 'LS' }),
    piece({ name: 'Wool Coat', sku: 'WC-S', price: 1800, category: 'Coats', size: 'S', color: 'Camel', maxQty: 1 }),
    piece({ name: 'Straw Hat', sku: 'HT-1', price: 200, category: 'Accessories', details: [{ label: 'Brim', value: 'Wide' }] }),
  ];
}
catalogue();

const USERS = {
  'buyer@example.com': { id: '22222222-2222-4222-8222-222222222222', email: 'buyer@example.com', name: 'Chanda Banda' },
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
const buyer = USERS['buyer@example.com'].id;
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();

let ORDERS, PROFILE, ALERTS, GIFT, QUESTIONS, REVIEWS, REVIEWED, CALLS, NO_SQL, SETTINGS;
function seed() {
  catalogue();
  const o = (x) => Object.assign({ currency: 'ZMW', customer_id: buyer, name: 'Chanda Banda', phone: '0977000001', fulfilment: 'delivery',
    pos_receipt: null, pos_receipt_no: null, pos_invoice_no: null, pos_sale_id: null, delivered_at: null, dispatched_at: null }, x);
  ORDERS = [
    o({ id: 'o1', ref: 'VB-DONE1', status: 'delivered', total: 950, created_at: ago(60 * 24 * 9), delivered_at: ago(60 * 24 * 7),
        order_items: [{ sku: 'BG-1', name: 'Leather Satchel', price: 500, qty: 1 }, { sku: 'LS-M', name: 'Linen Shirt', price: 450, qty: 1 }] }),
    o({ id: 'o2', ref: 'VB-DONE2', status: 'delivered', total: 2100, created_at: ago(60 * 24 * 30), delivered_at: ago(60 * 24 * 28),
        order_items: [{ sku: 'WC-S', name: 'Wool Coat', price: 1800, qty: 2 }, { sku: 'SC-1', name: 'Silk Scarf', price: 300, qty: 1 },
                      { sku: 'OLD-9', name: 'Velvet Clutch', price: 650, qty: 1 }] }),
  ];
  PROFILE = { id: buyer, name: 'Chanda Banda', phone: '0977000001', wishlist: ['BG-1', 'HT-1'], preferences: null };
  ALERTS = [];
  GIFT = null;
  QUESTIONS = [{ sku: 'BG-1', question: 'Does it fit a laptop?', answer: 'Yes, up to 14 inches.', published: true, sort: 100, created_at: ago(500) }];
  REVIEWS = [];
  REVIEWED = {};
  CALLS = [];
  NO_SQL = false;
  SETTINGS = {
    'customer-accounts': { accountsEnabled: true, orderHistory: true, guestCheckout: true, wishlistFollowsAccount: true },
    shopping: { whatsappCheckout: true, wishlist: true, sharing: true },
    reviews: { showReviews: true, customerReviews: true, autoPublish: true, minAutoRating: 1 },
    contact: { orderNumber: '260970000000', whatsapp: '260970000000' },
  };
}
seed();
const bought = (sku) => ORDERS.some(o => o.status !== 'cancelled' && (o.order_items || []).some(i => i.sku === sku));
const noFn = (name) => ({ code: 'PGRST202', message: 'Could not find the function public.' + name + ' in the schema cache' });

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
      if (!usr || (grant === 'password' && body.password !== PASSWORD)) return send(400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      return send(200, session(usr));
    }
    if (p === '/web/auth/v1/user') { const usr = who(req); return usr ? send(200, userBody(usr)) : send(401, { msg: 'invalid JWT' }); }
    if (p.startsWith('/web/auth/v1/')) return send(200, {});
    const usr = who(req);
    if (p.startsWith('/web/rest/v1/rpc/')) CALLS.push({ fn: p.slice('/web/rest/v1/rpc/'.length), as: usr ? usr.email : 'anon', body });
    if (p === '/web/rest/v1/site_settings') {
      const key = (u.searchParams.get('key') || '').replace('eq.', '');
      if (key) return send(200, SETTINGS[key] ? [{ key, data: SETTINGS[key] }] : []);
      return send(200, Object.keys(SETTINGS).map(k => ({ key: k, data: SETTINGS[k] })));
    }
    if (p === '/web/rest/v1/customers') {
      if (!usr) return send(200, []);
      if (req.method === 'GET') return send(200, [Object.assign({}, PROFILE)]);
      const row = Array.isArray(body) ? body[0] : body;
      if (NO_SQL && row && 'preferences' in row) return send(400, { code: 'PGRST204', message: 'Could not find the preferences column of customers' });
      Object.assign(PROFILE, row || {});
      return send(201, [PROFILE]);
    }
    if (p === '/web/rest/v1/orders') return send(200, usr ? JSON.parse(J(ORDERS)) : []);
    if (p === '/web/rest/v1/reviews') return send(200, REVIEWS);
    if (p === '/web/rest/v1/product_questions') {
      const sku = (u.searchParams.get('sku') || '').replace('eq.', '');
      return send(200, QUESTIONS.filter(q => q.published && (!sku || q.sku === sku)));
    }
    if (p === '/web/rest/v1/product_alerts') {
      if (NO_SQL) return send(404, { code: 'PGRST205', message: 'Could not find the table public.product_alerts in the schema cache' });
      if (!usr) return send(200, []);
      if (req.method === 'DELETE') {
        const id = (u.searchParams.get('id') || '').replace('eq.', '');
        ALERTS = ALERTS.filter(a => a.id !== id);
        return send(204);
      }
      return send(200, ALERTS.slice().reverse());
    }
    if (p === '/web/rest/v1/gift_lists') {
      if (NO_SQL) return send(404, { code: 'PGRST205', message: 'Could not find the table public.gift_lists in the schema cache' });
      return send(200, usr && GIFT ? [{ token: GIFT.token, title: GIFT.title, note: GIFT.note }] : []);
    }
    if (p === '/web/rest/v1/rpc/review_can') {
      if (NO_SQL) return send(404, noFn('review_can(p_sku)'));
      if (!usr) return send(200, { ok: true, can: false, why: 'signin' });
      if (REVIEWED[body.p_sku]) return send(200, { ok: true, can: false, why: 'already' });
      return send(200, bought(body.p_sku) ? { ok: true, can: true } : { ok: true, can: false, why: 'not_bought' });
    }
    if (p === '/web/rest/v1/rpc/review_by_buyer') {
      if (!usr) return send(401, {});
      if (!bought(body.p_sku)) return send(200, { ok: false, why: 'not_bought' });
      if (REVIEWED[body.p_sku]) return send(200, { ok: false, why: 'already' });
      REVIEWED[body.p_sku] = true;
      const name = body.p_name || 'Chanda';
      REVIEWS.unshift({ sku: body.p_sku, name, rating: body.p_rating, comment: body.p_comment, verified: true, approved: true, created_at: new Date().toISOString() });
      return send(200, { ok: true, id: 'rv-1', published: true, name });
    }
    if (p === '/web/rest/v1/rpc/alert_set') {
      if (NO_SQL) return send(404, noFn('alert_set'));
      if (!usr) return send(401, {});
      const id = 'al-' + (++seq);
      ALERTS = ALERTS.filter(a => !(a.sku === body.p_sku && a.kind === body.p_kind));
      ALERTS.push({ id, sku: body.p_sku, kind: body.p_kind, name: body.p_name, price_at: body.p_price, created_at: new Date().toISOString(), sent_at: null, sent_price: null });
      return send(200, { ok: true, id, kind: body.p_kind });
    }
    if (p === '/web/rest/v1/rpc/gift_list_share') {
      if (!usr) return send(401, {});
      const again = !!GIFT;
      GIFT = { token: GIFT ? GIFT.token : 'g'.repeat(8) + 'Ab1_-' + '0123456789abcdef0123456789abcdef'.slice(0, 51), title: body.p_title || null, note: body.p_note || null };
      return send(200, { ok: true, token: GIFT.token, title: GIFT.title, note: GIFT.note, again });
    }
    if (p === '/web/rest/v1/rpc/gift_list_stop') { GIFT = null; return send(200, { ok: true }); }
    if (p === '/web/rest/v1/rpc/gift_list_get') {
      if (!GIFT || body.p_token !== GIFT.token) return send(200, { ok: false, why: 'not_found' });
      return send(200, { ok: true, title: GIFT.title, note: GIFT.note, firstName: 'Chanda', skus: PROFILE.wishlist });
    }
    if (p.startsWith('/web/rest/v1/rpc/')) return send(200, null);
    if (p.startsWith('/web/rest/v1/')) return send(200, []);
    if (p.startsWith('/web/')) return send(200, {});
    if (p === '/api/products') return send(200, { products: CATALOGUE, count: CATALOGUE.length, version: 't' + seq });
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
  const ctx = await browser.newContext({ viewport: viewport || { width: 1200, height: 900 }, deviceScaleFactor: SHOTS ? 2 : 1 });
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
const calls = (fn) => CALLS.filter(c => c.fn === fn);

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const errors = [];
  const watch = (page) => page.on('pageerror', e => errors.push(String(e.message || e)));
  const openPiece = async (page, sku) => {
    await page.goto(base + '/product/' + sku, { waitUntil: 'networkidle' });
    await page.waitForSelector('#view-detail h1', { timeout: 15000 });
    await page.waitForTimeout(300);
  };
  let ctx, page;
  try {
    /* ------------------------------------------------------------------ 1 */
    console.log('\n1. Compare');
    seed();
    ctx = await context(browser); page = await ctx.newPage(); watch(page);
    await openPiece(page, 'BG-1');
    is(await page.textContent('.cmp-btn') === 'Compare' && !(await page.isVisible('#cmpBar')), 'Compare on a piece\'s page; no bar yet');
    await page.click('.cmp-btn');
    is(await page.textContent('.cmp-btn') === 'Comparing ✓' && await page.textContent('#cmpBar .cmp-go') === 'Compare: choose one more',
       'chosen: the bar asks for one more');
    for (const s of ['HT-1', 'SC-1', 'WC-S']) { await openPiece(page, s); await page.click('.cmp-btn'); }
    is(await page.textContent('#cmpBar .cmp-go') === 'Compare 4 pieces', 'four chosen');
    await openPiece(page, 'LS-M');
    await page.click('.cmp-btn');
    is(/Four at most/.test(await page.textContent('.cmp-btn')), 'a fifth: four at most');
    await page.click('#cmpBar .cmp-go');
    await page.waitForSelector('.cmp-table', { timeout: 10000 });
    let cmp = await page.evaluate(() => ({
      url: location.pathname, cols: document.querySelectorAll('.cmp-piece').length,
      rows: [...document.querySelectorAll('.cmp-table tr')].map(tr => tr.querySelector('th') ? tr.querySelector('th').textContent : ''),
      price: [...document.querySelectorAll('.cmp-table tr')].find(tr => (tr.querySelector('th') || {}).textContent === 'Price').innerText,
      bar: !document.getElementById('cmpBar') || document.getElementById('cmpBar').classList.contains('hide'),
      robots: (document.querySelector('meta[name="robots"]') || {}).content || '' }));
    is(cmp.url === '/compare' && cmp.cols === 4 && cmp.rows.indexOf('Availability') > -1 && cmp.rows.indexOf('Material') > -1 &&
       cmp.rows.indexOf('Strap') > -1 && cmp.rows.indexOf('Brim') > -1 && /K\s?500/.test(cmp.price) && /K\s?300/.test(cmp.price),
       'side by side: the price, availability and every detail any of them has', J(cmp));
    is(cmp.bar && /noindex/.test(cmp.robots), 'no bar on the page itself; and not for search engines', J(cmp));
    await shot(page, 'shopping-1-compare');
    await page.evaluate(() => document.querySelectorAll('.cmp-rm')[0].click());
    await page.waitForTimeout(150);
    is(await page.evaluate(() => document.querySelectorAll('.cmp-piece').length) === 3, 'Remove: three left');
    await ctx.close();
    ctx = await context(browser, PHONE); page = await ctx.newPage(); watch(page);
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => localStorage.setItem('vbp_compare', JSON.stringify(['BG-1', 'HT-1', 'SC-1', 'WC-S'])));
    await page.goto(base + '/compare', { waitUntil: 'networkidle' });
    await page.waitForSelector('.cmp-table', { timeout: 10000 });
    is(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'on a phone: the table scrolls inside itself, the page does not');
    await ctx.close();

    /* ------------------------------------------------------------------ 2 */
    console.log('\n2. Alerts');
    seed();
    ctx = await context(browser); page = await ctx.newPage(); watch(page);
    await openPiece(page, 'SC-1');
    is(/Email me when it’s back/.test(await page.textContent('.alert-btn')), 'a sold-out piece: Email me when it\'s back');
    await page.click('.alert-btn');
    is(/Sign in to be emailed/.test(await page.textContent('.alert-msg')) && calls('alert_set').length === 0, 'signed out: asked to sign in, nothing saved');
    await ctx.close();
    ctx = await context(browser); page = await ctx.newPage(); watch(page);
    await signIn(page, 'buyer@example.com');
    await openPiece(page, 'SC-1');
    await page.click('.alert-btn');
    await page.waitForFunction(() => /We’ll email you/.test((document.querySelector('.alert-btn') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    let ac = calls('alert_set')[0];
    is(ac && ac.as === 'buyer@example.com' && ac.body.p_sku === 'SC-1' && ac.body.p_kind === 'back' && ac.body.p_price === null &&
       /We’ll email you when it’s back/.test(await page.textContent('.alert-btn')),
       'signed in: saved as theirs (alert_set), and it says so', J(ac));
    await shot(page, 'shopping-2-alert');
    await page.click('.alert-btn');
    await page.waitForFunction(() => /Stopped/.test((document.querySelector('.alert-msg') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    is(ALERTS.length === 0 && /Email me when it’s back/.test(await page.textContent('.alert-btn')), 'pressed again: stopped');
    await openPiece(page, 'BG-1');
    is(/Email me if the price drops/.test(await page.textContent('.alert-btn')), 'a piece in stock: Email me if the price drops');
    await page.click('.alert-btn');
    await page.waitForTimeout(400);
    ac = calls('alert_set').pop();
    is(ac && ac.body.p_kind === 'price' && ac.body.p_price === 500, 'with the price the shop shows now (500)', J(ac));

    /* ------------------------------------------------------------------ 3 */
    console.log('\n3. Questions & answers');
    let qa = await page.evaluate(() => ({ items: [...document.querySelectorAll('.qa-item')].map(x => x.textContent),
      ask: (document.querySelector('.qa-ask') || {}).textContent || '' }));
    is(qa.items.length === 1 && /Does it fit a laptop\?/.test(qa.items[0]) && /up to 14 inches/.test(qa.items[0]) && /Ask a question/.test(qa.ask),
       'the shop\'s published answer, and Ask a question', J(qa));
    await openPiece(page, 'HT-1');
    is(/No questions yet/.test(await page.textContent('#prodQuestions')), 'none yet: said, with how to ask');

    /* ------------------------------------------------------------------ 4 */
    console.log('\n4. Reviews from buyers');
    await openPiece(page, 'BG-1');
    await page.waitForSelector('#prWrite', { timeout: 8000 }).catch(() => {});
    is(!!(await page.$('#prWrite')) && calls('review_can').some(c => c.body.p_sku === 'BG-1' && c.as === 'buyer@example.com'),
       'bought it: Write a review (asked of the database as the customer)');
    await page.click('#prWrite');
    await page.waitForSelector('#reviewModal.open', { timeout: 5000 });
    is(/Shown as a verified buyer/.test(await page.textContent('#reviewBody')), 'the form says it will show as a verified buyer');
    await page.fill('#rvComment', 'Beautiful leather, worth it.');
    await page.click('#rvSubmit');
    await page.waitForFunction(() => /Your review is posted/.test((document.getElementById('rvMsg') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    const rb = calls('review_by_buyer')[0];
    await page.waitForTimeout(1300);
    const rv = await page.evaluate(() => [...document.querySelectorAll('.pr-item')].map(x => x.textContent.replace(/\s+/g, ' ')));
    is(rb && rb.body.p_sku === 'BG-1' && rb.body.p_rating === 5 && rv.length === 1 && /Verified buyer/.test(rv[0]) &&
       /You have reviewed this piece/.test(await page.textContent('#prodReviews')),
       'sent through review_by_buyer, shown as Verified buyer; then: you have reviewed it', J([rb, rv]));
    await openPiece(page, 'HT-1');
    await page.waitForTimeout(400);
    is(/Reviews are written by customers who bought this piece/.test(await page.textContent('#prodReviews')) && !(await page.$('#prWrite')),
       'not bought: said so, no button');
    await ctx.close();
    ctx = await context(browser); page = await ctx.newPage(); watch(page);
    await openPiece(page, 'BG-1');
    is(/Bought this piece\? Sign in to review it\./.test(await page.textContent('#prodReviews')) && !(await page.$('#prWrite')),
       'signed out: Sign in to review it');
    await ctx.close();
    seed(); NO_SQL = true;
    ctx = await context(browser); page = await ctx.newPage(); watch(page);
    await signIn(page, 'buyer@example.com');
    await openPiece(page, 'HT-1');
    await page.waitForSelector('#prWrite', { timeout: 8000 }).catch(() => {});
    is(!!(await page.$('#prWrite')) && !(await page.$('.alert-line:not(.hide) .alert-btn')),
       'before supabase-shopping.sql: reviews as before, and no alerts offered');
    await ctx.close();
    NO_SQL = false;

    /* ------------------------------------------------------------------ 5 */
    console.log('\n5. The gift list');
    seed();
    ctx = await context(browser, PHONE); page = await ctx.newPage(); watch(page);
    await signIn(page, 'buyer@example.com');
    await page.goto(base + '/account/giftlist', { waitUntil: 'networkidle' });
    await page.waitForSelector('.ac-gift-body .btn-gold', { timeout: 15000 });
    is(/On your wishlist now: 2 pieces/.test(await page.textContent('.ac-gift')) && await page.textContent('.ac-gift-body .btn-gold') === 'Share my wishlist',
       'the wishlist, ready to share');
    await page.fill('#gl_title', 'Chanda\'s birthday');
    await page.click('.ac-gift-body .btn-gold');
    await page.waitForSelector('.ac-gift-link', { timeout: 8000 }).catch(() => {});
    const link = await page.inputValue('.ac-gift-link').catch(() => '');
    is(new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/gift/[A-Za-z0-9_-]{24,64}$').test(link) &&
       calls('gift_list_share')[0].as === 'buyer@example.com', 'shared: a link of its own, made by the database', link);
    await shot(page, 'shopping-3-account-gift-list');
    const g = await context(browser, PHONE); const gp = await g.newPage(); watch(gp);
    await gp.goto(link, { waitUntil: 'networkidle' });
    await gp.waitForSelector('.gift-grid .card, .gift-none', { timeout: 15000 }).catch(() => {});
    const gift = await gp.evaluate(() => ({ title: document.querySelector('.gift-title').textContent,
      cards: [...document.querySelectorAll('.gift-grid .card')].length, robots: (document.querySelector('meta[name="robots"]') || {}).content || '',
      text: document.getElementById('view-gift').innerText }));
    is(gift.title === 'Chanda\'s birthday' && gift.cards === 2 && /noindex/.test(gift.robots) && !/Banda|buyer@|0977/.test(gift.text),
       'opened by anyone: the title and the two pieces; no surname, email or phone; not for search engines', J(gift));
    await shot(gp, 'shopping-4-gift-list');
    await page.click('.ac-gift-stop');
    await page.click('.ac-gift-stop');
    await page.waitForFunction(() => /Stopped/.test((document.querySelector('.ac-gift .ac-msg') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    await gp.goto(link, { waitUntil: 'networkidle' });
    await gp.waitForFunction(() => /not shared any more/.test((document.querySelector('.gift-title') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    is(/not shared any more/.test(await gp.textContent('.gift-title')), 'stopped (two taps): the old link shows nothing');
    await g.close();

    /* ------------------------------------------------------------------ 6 */
    console.log('\n6. Shopping preferences');
    await page.goto(base + '/account/preferences', { waitUntil: 'networkidle' });
    await page.waitForSelector('.ac-chip', { timeout: 15000 });
    const chips = await page.evaluate(() => [...document.querySelectorAll('.ac-chips')].map(r => [...r.querySelectorAll('.ac-chip')].map(c => c.textContent)));
    is(J(chips[0]) === J(['S', 'M', 'L']) && chips[1].indexOf('Tops') > -1, 'the shop\'s own sizes, in the order sizes go, and its categories', J(chips));
    await page.evaluate(() => { const rows = document.querySelectorAll('.ac-chips');
      [...rows[0].querySelectorAll('.ac-chip')].find(c => c.textContent === 'M').click();
      [...rows[1].querySelectorAll('.ac-chip')].find(c => c.textContent === 'Tops').click(); });
    await page.click('.ac-actions .btn-gold');
    await page.waitForFunction(() => /Saved/.test((document.querySelector('.ac-msg') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    is(J(PROFILE.preferences) === J({ sizes: ['M'], categories: ['Tops'] }), 'saved on the account', J(PROFILE.preferences));
    await shot(page, 'shopping-5-preferences');
    await page.goto(base + '/shop', { waitUntil: 'networkidle' });
    await page.waitForSelector('#chips .chip', { timeout: 15000 });
    const sc = await page.evaluate(() => [...document.querySelectorAll('#chips .chip')].map(c => c.textContent));
    is(sc[1] === 'Tops' && sc[sc.length - 1] === 'My sizes', 'their category first; My sizes at the end', J(sc));
    await page.evaluate(() => [...document.querySelectorAll('#chips .chip')].find(c => c.textContent === 'My sizes').click());
    await page.waitForTimeout(250);
    const grid = await page.evaluate(() => [...document.querySelectorAll('#grid .card')].map(c => c.textContent.replace(/\s+/g, ' ').trim()));
    is(!grid.some(t => /Wool Coat/.test(t)) && grid.some(t => /Linen Shirt/.test(t)) && grid.some(t => /Leather Satchel/.test(t)),
       'My sizes: the coat in S is not shown; the shirt in M and the one-size satchel are', J(grid));
    await openPiece(page, 'LS-L');
    is(await page.evaluate(() => { const m = [...document.querySelectorAll('.opt-chip')].find(c => c.textContent.trim() === 'M');
         return !!m && m.classList.contains('opt-mine') && m.title === 'Your size'; }), 'on a piece: their size marked on the picker');

    /* ------------------------------------------------------------------ 7 */
    console.log('\n7. Recently purchased, and Order again');
    await page.goto(base + '/account/purchased', { waitUntil: 'networkidle' });
    await page.waitForSelector('.ac-purchased .card, .ac-purchased .ac-gone', { timeout: 15000 });
    const pur = await page.evaluate(() => ({ cards: document.querySelectorAll('.ac-purchased .card').length,
      gone: (document.querySelector('.ac-gone') || {}).textContent || '' }));
    is(pur.cards === 4 && /Velvet Clutch/.test(pur.gone), 'every piece bought, once; one no longer in the shop listed apart', J(pur));
    await page.goto(base + '/account/orders/VB-DONE2', { waitUntil: 'networkidle' });
    await page.waitForSelector('.ac-again', { timeout: 15000 });
    await page.click('.ac-again');
    await page.waitForSelector('.ac-again-msg', { timeout: 5000 });
    const again = await page.evaluate(() => ({ msg: document.querySelector('.ac-again-msg').innerText,
      cart: JSON.parse(localStorage.getItem('vbp_cart') || '[]') }));
    is(/In your cart, at today’s prices: Wool Coat\./.test(again.msg) && /Fewer than last time.*Wool Coat/.test(again.msg) &&
       /Not on sale just now: Silk Scarf, Velvet Clutch\./.test(again.msg) &&
       again.cart.length === 1 && again.cart[0].sku === 'WC-S' && again.cart[0].qty === 1,
       'the coat back in the cart, one (all the shop has, not the two ordered); the sold-out scarf and the gone clutch said', J(again));
    await page.evaluate(() => { const m = document.querySelector('.ac-again-msg');
      window.scrollTo({ top: m.getBoundingClientRect().top + window.scrollY - 360, behavior: 'instant' }); });
    await shot(page, 'shopping-6-order-again');

    /* ------------------------------------------------------------------ 8 */
    console.log('\n8. Product alerts in the account');
    ALERTS = [{ id: 'a1', sku: 'SC-1', kind: 'back', name: 'Silk Scarf', price_at: null, created_at: ago(60), sent_at: null, sent_price: null },
              { id: 'a2', sku: 'BG-1', kind: 'price', name: 'Leather Satchel', price_at: 550, created_at: ago(600), sent_at: ago(30), sent_price: 500 }];
    await page.goto(base + '/account/alerts', { waitUntil: 'networkidle' });
    await page.waitForSelector('.ac-alert', { timeout: 15000 });
    const al = await page.evaluate(() => [...document.querySelectorAll('.ac-alert')].map(x => x.innerText.replace(/\s+/g, ' ')));
    is(al.length === 2 && /Silk Scarf.*When it is back in stock.*Waiting.*Stop/i.test(al.find(x => /Scarf/.test(x))) &&
       /Leather Satchel.*If the price drops below K\s?550.*Emailed.*at K\s?500.*Remove/i.test(al.find(x => /Satchel/.test(x))),
       'each with what it waits for, waiting or emailed and at what price', J(al));
    await page.evaluate(() => [...document.querySelectorAll('.ac-alert')].find(x => /Scarf/.test(x.textContent)).querySelector('button').click());
    await page.waitForFunction(() => document.querySelectorAll('.ac-alert').length === 1, null, { timeout: 5000 }).catch(() => {});
    is(ALERTS.length === 1 && ALERTS[0].id === 'a2', 'Stop: gone');

    /* ------------------------------------------------------------------ 9 */
    console.log('\n9. The dashboard, and switched off');
    await page.goto(base + '/account', { waitUntil: 'networkidle' });
    await page.waitForSelector('.pt-card', { timeout: 15000 });
    const dash = await page.evaluate(() => ({ cards: [...document.querySelectorAll('.pt-card .pt-t')].map(x => x.textContent),
      rows: [...document.querySelectorAll('.pt-row .pt-t')].map(x => x.textContent) }));
    is(['Recently purchased', 'Product alerts', 'Gift list'].every(t => dash.cards.indexOf(t) > -1) && dash.rows.indexOf('Shopping preferences') > -1,
       'My shopping: Recently purchased, Product alerts, Gift list; My Vault: Shopping preferences', J(dash));
    await ctx.close();
    seed();
    Object.assign(SETTINGS['customer-accounts'], { productAlerts: false, giftLists: false, shoppingPrefs: false, orderAgain: false });
    SETTINGS.shopping.compare = false;
    ctx = await context(browser); page = await ctx.newPage(); watch(page);
    await signIn(page, 'buyer@example.com');
    await openPiece(page, 'SC-1');
    is(!(await page.$('.cmp-btn')) && !(await page.$('.alert-btn')), 'Compare and the alerts off: neither on the piece');
    await page.goto(base + '/account', { waitUntil: 'networkidle' });
    await page.waitForSelector('.pt-card', { timeout: 15000 });
    const off = await page.evaluate(() => [...document.querySelectorAll('.pt-card .pt-t, .pt-row .pt-t')].map(x => x.textContent));
    is(off.indexOf('Product alerts') < 0 && off.indexOf('Gift list') < 0 && off.indexOf('Shopping preferences') < 0 && off.indexOf('Recently purchased') > -1,
       'the dashboard without them', J(off));
    await page.goto(base + '/account/orders/VB-DONE1', { waitUntil: 'networkidle' });
    await page.waitForSelector('.acd .ac-actions', { timeout: 15000 });
    is(!(await page.$('.ac-again')), 'Order again off: not on the order');
    is(errors.length === 0, 'no script error', errors.join(' | '));
  } catch (e) {
    failures++;
    console.log('  ✗ the run stopped: ' + (e && e.stack || e));
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failures ? '\n  ✗ ' + failures + ' of ' + checks + ' checks FAILED' : '\n  shopping in the browser: all ' + checks + ' checks passed');
  process.exit(failures ? 1 : 0);
})();
