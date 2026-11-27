/* ===========================================================================
   THE CUSTOMER PORTAL, IN THE BROWSER -- website build 86

   THE OWNER, 21 November 2026: "I would make Vaultique's customer account a
   complete customer relationship portal rather than simply a place to view
   orders", "Customer dashboard should be as shown in the screenshots, just
   use Vaultique Boutique Point navy blue for the top color", "The account
   should distinguish between requested, confirmed, paid, fulfilled and
   completed orders", and "A loyalty balance must come from the
   authoritative rewards engine, not an independently maintained website
   balance."

   The real index.html and assets, and the real supabase-js; Supabase's
   sign-in and tables, the rewards function (which asks the platform) and
   the portal's own function are answered here. On a phone:

     1. The dashboard: the navy top with Welcome back and the three figures
        (the orders, the wishlist, and the points as the platform gives
        them), then My shopping, My Vault and Security and privacy, as
        the screenshots have them, without Gift cards, My wallet and Product
        alerts (decision D9, build 90). It fits a phone.
     2. Every page at an address of its own, the phone's back button going
        back, and the way back on each page.
     3. My orders: the ten states an order can be in, each in its own words;
        an order opened in full, with its five steps; one that is not the
        customer's is not shown.
     4. Returns & refunds: every refund, the one still on its way included,
        as the platform and Flutterwave have them.
     5. Recently viewed, Personal details (the page is not drawn again under
        the customer's hands, and "Saved" stays), Notifications.
     6. The password: the one in use asked first, and checked.
     7. Signing out: this device, the other devices, everywhere.
     8. Privacy: the newsletter, yes or no; Download my personal data, with
        the points from the platform in it.
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
  console.log('  the customer portal in the browser: skipped (the real supabase-js is not here: assets/vendor/supabase-js-2.118.0.js)');
  process.exit(0);
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const piece = (o) => Object.assign({ category: 'Dresses', size: '', color: '', material: '', available: true,
  lowStock: false, wasPrice: 0, brand: '', description: 'A piece.', details: [], variantGroup: '', maxQty: 5,
  image_url: '/pic/a.png', gallery: [] }, o);
const CATALOGUE = [piece({ name: 'Linen Dress', sku: 'LD-9', price: 1400 }), piece({ name: 'Silk Scarf', sku: 'SC-2', price: 600 })];

const USERS = {
  'buyer@example.com': { id: '22222222-2222-4222-8222-222222222222', email: 'buyer@example.com' },
  'other@example.com': { id: '33333333-3333-4333-8333-333333333333', email: 'other@example.com' },
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

const at = (min) => new Date(Date.now() - min * 60000).toISOString();
const buyer = USERS['buyer@example.com'].id;
let ORDERS, AUTH, PORTAL, REWARDS_ASKED, NEWS, PASSWORDS_SET;
function seed() {
  const o = (x) => Object.assign({ currency: 'ZMW', customer_id: buyer, name: 'Test Buyer', phone: '0977000001', address: null,
    pos_receipt: null, pos_receipt_no: null, pos_completed_at: null, pos_sale_id: null, paid_at: null,
    payment_method: null, payment_status: null, pay_channel: null, goods_total: null, delivery_fee: null, paid_amount: null,
    ship_note: null, dispatched_at: null, ready_at: null, delivered_at: null, delivered_by: null, auto_deliver_at: null,
    extend_days: null, extend_max: null, extend_used: null, remind_days: null,
    refund_state: null, refund_amount: null, refund_ref: null, refund_note: null, refund_at: null, updated_at: null,
    order_items: [{ sku: 'LD-9', name: 'Linen Dress', price: 1400, qty: 1 }] }, x);
  ORDERS = [
    o({ id: 'o1', ref: 'VB-OPEN1', status: 'pending', total: 1400, fulfilment: 'delivery', created_at: at(30), address: 'Plot 1, Stand-in Road' }),
    o({ id: 'o2', ref: 'VB-WAIT1', status: 'pending', total: 1400, fulfilment: 'delivery', created_at: at(40),
        payment_method: 'online', payment_status: 'awaiting' }),
    o({ id: 'o3', ref: 'VB-FAIL1', status: 'pending', total: 1400, fulfilment: 'delivery', created_at: at(50),
        payment_method: 'online', payment_status: 'failed' }),
    o({ id: 'o4', ref: 'VB-WEBP1', status: 'pending', total: 1530, fulfilment: 'delivery', created_at: at(60),
        payment_method: 'online', payment_status: 'paid', pay_channel: 'mobilemoneyzambia', paid_at: at(59),
        goods_total: 1400, delivery_fee: 130, paid_amount: 1530, address: 'Plot 4, Stand-in Road' }),
    o({ id: 'o5', ref: 'VB-CONF1', status: 'confirmed', total: 1400, fulfilment: 'collection', created_at: at(70) }),
    o({ id: 'o6', ref: 'VB-PREP1', status: 'confirmed', total: 1400, fulfilment: 'delivery', created_at: at(300),
        pos_sale_id: 'S-1', pos_receipt_no: 'RCT-0001', pos_completed_at: at(200), paid_at: at(250) }),
    o({ id: 'o7', ref: 'VB-ONWY1', status: 'dispatched', total: 1400, fulfilment: 'delivery', created_at: at(3000),
        pos_sale_id: 'S-2', pos_receipt_no: 'RCT-0002', pos_completed_at: at(2900), dispatched_at: at(1440), ship_note: 'With Courier X',
        auto_deliver_at: new Date(Date.now() + 5 * 86400000).toISOString(), extend_days: 3, extend_max: 2, extend_used: 0 }),
    o({ id: 'o8', ref: 'VB-RFND1', status: 'delivered', total: 1200, fulfilment: 'delivery', created_at: at(9000),
        payment_method: 'online', payment_status: 'paid', paid_at: at(8990), paid_amount: 1200,
        pos_sale_id: 'S-5', pos_receipt_no: 'RCT-0005', pos_completed_at: at(8900), dispatched_at: at(8000),
        delivered_at: at(6000), delivered_by: 'customer', refund_state: 'part', refund_amount: 200, refund_ref: 'FLW-RF-77', refund_at: at(60),
        order_items: [{ sku: 'SC-2', name: 'Silk Scarf', price: 600, qty: 2 }] }),
    o({ id: 'o9', ref: 'VB-DONE1', status: 'completed', total: 600, fulfilment: 'collection', created_at: at(600),
        pos_sale_id: 'S-4', pos_receipt_no: 'RCT-0004', pos_completed_at: at(590) }),
    o({ id: 'o10', ref: 'VB-CANC1', status: 'cancelled', total: 900, fulfilment: 'delivery', created_at: at(800), updated_at: at(700) }),
    o({ id: 'o11', ref: 'VB-THEIRS', customer_id: USERS['other@example.com'].id, status: 'pending', total: 50, fulfilment: 'delivery', created_at: at(20) }),
  ];
  AUTH = []; PORTAL = []; REWARDS_ASKED = []; NEWS = true; PASSWORDS_SET = [];
}
seed();

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
      AUTH.push({ grant, email: body.email || null, password: body.password || null });
      const usr = grant === 'password' ? USERS[body.email] : REFRESH[body.refresh_token];
      if (!usr || (grant === 'password' && body.password !== PASSWORD)) {
        return send(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      }
      return send(200, session(usr));
    }
    if (p === '/web/auth/v1/user') {
      const usr = who(req);
      if (!usr) return send(401, { msg: 'invalid JWT' });
      if (req.method === 'PUT') { PASSWORDS_SET.push({ as: usr.email, password: body.password }); AUTH.push({ grant: 'update' }); }
      return send(200, userBody(usr));
    }
    if (p === '/web/auth/v1/logout') { AUTH.push({ grant: 'logout', scope: u.searchParams.get('scope'), as: (who(req) || {}).email }); return send(204); }
    if (p.startsWith('/web/auth/v1/')) return send(200, {});

    const usr = who(req);
    if (p === '/web/rest/v1/site_settings') {
      const key = u.searchParams.get('key');
      if (key === 'eq.customer-accounts') return send(200, [{ data: { accountsEnabled: true, orderHistory: true, guestCheckout: true } }]);
      if (key === 'eq.shopping') return send(200, [{ data: { rewardsOnline: true, wishlist: true } }]);
      if (key === 'eq.general') return send(200, [{ data: { businessName: 'Vaultique Boutique Point' } }]);
      return send(200, []);
    }
    if (p === '/web/rest/v1/customers') {
      if (req.method === 'GET') return send(200, usr ? [{ id: usr.id, name: 'Test Buyer', phone: '0977000001', wishlist: ['LD-9', 'SC-2'] }] : []);
      return send(usr ? 201 : 401, usr ? [{ id: usr.id }] : {});
    }
    if (p === '/web/rest/v1/customer_addresses') return send(200, []);
    if (p === '/web/rest/v1/orders' && req.method === 'GET') {
      const rows = usr ? ORDERS.filter(o => o.customer_id === usr.id) : [];
      return send(200, rows.map(o => JSON.parse(J(o))));
    }
    if (p.startsWith('/web/rest/v1/rpc/')) return send(200, null);
    if (p.startsWith('/web/rest/v1/')) return send(200, []);
    if (p.startsWith('/web/')) return send(200, {});
    if (p === '/api/products') return send(200, { products: CATALOGUE, count: CATALOGUE.length, version: 't' });

    /* The rewards function: it asks the platform, which owns the points. */
    if (p === '/.netlify/functions/rewards' && req.method === 'POST') {
      REWARDS_ASKED.push({ as: usr ? usr.email : null, action: body.action });
      if (!usr) return send(401, { error: 'Please sign in to your account first.' });
      if (body.action === 'status') return send(200, { linked: true, number: 'VB0123', points: 850, worth: 85, perK1: 1, canRedeem: true, milestone: null });
      return send(200, {});
    }
    /* The portal's own function (netlify/functions/account-portal.js, tested
       on its own in tests/account-portal.test.cjs). */
    if (p === '/.netlify/functions/account-portal' && req.method === 'POST') {
      PORTAL.push({ as: usr ? usr.email : null, body });
      if (!usr) return send(401, { error: 'Please sign in again.' });
      if (body.action === 'newsletter') return send(200, { state: NEWS ? 'on' : 'off', email: usr.email });
      if (body.action === 'newsletter-set') { NEWS = body.on === true; return send(200, { state: NEWS ? 'on' : 'off', email: usr.email }); }
      if (body.action === 'refunds') {
        return send(200, { refunds: usr.id !== buyer ? [] : [
          { order_ref: 'VB-RFND1', amount: 200, currency: 'ZMW', whole: false, state: 'completed', requested_at: at(100), completed_at: at(60) },
          { order_ref: 'VB-RFND1', amount: 50, currency: 'ZMW', whole: false, state: 'pending', requested_at: at(30), accepted_at: at(29) },
        ] });
      }
      if (body.action === 'data') {
        return send(200, { account: { email: usr.email }, orders: ORDERS.filter(o => o.customer_id === usr.id).map(o => ({ ref: o.ref })), rewards: { link: { cust_no: 'VB0123' } } });
      }
      return send(400, { error: 'That request could not be read.' });
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
  const ctx = await browser.newContext({ viewport: viewport || { width: 390, height: 844 }, acceptDownloads: true });
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
const pageText = (page) => page.evaluate(() => document.getElementById('accountBody').innerText.replace(/\s+/g, ' ').trim());
const until = async (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 15000 }).catch(() => {});

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
    await page.evaluate(() => localStorage.setItem('vbp_recent', JSON.stringify(['SC-2', 'LD-9'])));

    /* ------------------------------------------------------------------ 1 */
    console.log('\n1. The dashboard, on a phone');
    await page.goto(base + '/account', { waitUntil: 'networkidle' });
    await page.waitForSelector('.pt-hero', { timeout: 15000 });
    await until(page, () => /^\d+$/.test(((document.querySelector('.pt-t-points .pt-n') || {}).textContent || '').replace(/,/g, ''))
                        && /^\d\d$/.test((document.querySelector('.pt-t-orders .pt-n') || {}).textContent || ''));
    const d = await page.evaluate(() => {
      const hero = document.querySelector('.pt-hero');
      const t = (s) => [...document.querySelectorAll(s)].map(e => e.innerText.replace(/\s+/g, ' ').trim());
      const tile = (c) => { const e = document.querySelector('.pt-tile.' + c); return e ? { n: e.querySelector('.pt-n').textContent, l: e.querySelector('.pt-l').textContent } : null; };
      const W = document.documentElement.clientWidth;
      const tiles = [...document.querySelectorAll('.pt-tile')].map(e => e.getBoundingClientRect());
      return {
        bg: getComputedStyle(hero).backgroundColor, brand: t('.pt-brand')[0], badge: t('.pt-badge')[0],
        welcome: t('.pt-welcome')[0], sub: t('.pt-sub')[0],
        orders: tile('pt-t-orders'), wish: tile('pt-t-wish'), points: tile('pt-t-points'),
        heads: t('.pt-h'), cards: t('.pt-card'), rows: t('.pt-row'), safe: t('.pt-li'),
        oneRow: tiles.length === 3 && tiles.every(r => Math.abs(r.top - tiles[0].top) < 1),
        fits: document.documentElement.scrollWidth <= W + 1,
        inside: [...document.querySelectorAll('.pt-card, .pt-row, .pt-tile')].every(e => { const r = e.getBoundingClientRect(); return r.left >= -0.5 && r.right <= W + 0.5; }),
      };
    });
    is(d.bg === 'rgb(11, 31, 58)', 'the top is Vaultique navy (#0B1F3A)', d.bg);
    is(d.brand === 'VAULTIQUE' && d.badge === 'Customer portal' && d.welcome === 'Welcome back' &&
       d.sub === 'Your shopping, rewards and account at a glance.', 'VAULTIQUE, Customer portal, Welcome back and the line under it, as in the screenshots', J(d));
    is(d.orders && d.orders.n === '10' && d.orders.l === 'Orders', 'Orders: this customer\'s ten, never another\'s', J(d.orders));
    is(d.wish && d.wish.n === '02' && d.wish.l === 'Wishlist', 'Wishlist: the two pieces saved, written 02 as in the screenshots', J(d.wish));
    is(d.points && d.points.n === '850' && d.points.l === 'Points', 'Points: 850, as the platform says', J(d.points));
    is(REWARDS_ASKED.some(x => x.action === 'status' && x.as === 'buyer@example.com'),
       'the points were asked of the rewards function, as the signed-in customer (it asks the platform; nothing is kept here)', J(REWARDS_ASKED));
    is(J(d.heads) === J(['My shopping', 'My Vault', 'Security and privacy']), 'the three groups, in the screenshots\' order, the second called My Vault (the owner\'s word)', J(d.heads));
    /* Build 90 (the plan's shopping build): Recently purchased, Product
       alerts and the Gift list in My shopping, Shopping preferences in My
       Vault, each on unless Settings switches it off. */
    is(J(d.cards) === J(['My orders Order history and tracking', 'Returns & refunds Manage order issues', 'My wishlist Saved products',
                         'Recently viewed Continue shopping', 'Recently purchased Buy again', 'Product alerts Back in stock, price drops',
                         'Gift list Share your wishlist']),
       'My shopping: orders, returns & refunds, wishlist, recently viewed, and from build 90 recently purchased, product alerts and the gift list, each with its line', J(d.cards));
    is(!d.cards.some(c => /Gift cards/.test(c)) && !d.rows.some(r => /My wallet/.test(r)),
       'no Gift cards or My wallet: switched off in the platform (D9)', J([d.cards, d.rows]));
    is(J(d.rows) === J(['Personal details', 'Address book', 'Rewards & membership', 'Customer support', 'Notifications', 'Shopping preferences']),
       'My Vault: details, address book, rewards, support, notifications, and from build 90 shopping preferences', J(d.rows));
    is(J(d.safe) === J(['Password and authentication', 'Active devices and sessions', 'Privacy and marketing preferences', 'Download my personal data', 'Close my account']),
       'Security and privacy: the five, as in the screenshots', J(d.safe));
    is(d.oneRow && d.fits && d.inside, 'the three figures side by side, and everything fits a phone with nothing off the side', J({ oneRow: d.oneRow, fits: d.fits, inside: d.inside }));

    /* ------------------------------------------------------------------ 2 */
    console.log('\n2. A page of its own, and the way back');
    await page.click('.pt-card[data-page="orders"]');
    await page.waitForSelector('.ac-order', { timeout: 15000 });
    is(new URL(page.url()).pathname === '/account/orders' && (await page.textContent('.pt-title')) === 'My orders',
       'My orders opens at /account/orders, with its title', page.url());
    await page.goBack({ waitUntil: 'networkidle' });
    await page.waitForSelector('.pt-hero', { timeout: 15000 });
    is(new URL(page.url()).pathname === '/account', 'the phone\'s back button goes back to the dashboard', page.url());
    await page.click('.pt-li[data-page="privacy"]');
    await page.waitForSelector('.pt-back', { timeout: 15000 });
    await page.click('.pt-back');
    await page.waitForSelector('.pt-hero', { timeout: 15000 });
    is(new URL(page.url()).pathname === '/account', 'and every page has its own way back, to My account', page.url());
    const robots = await page.goto(base + '/account/notifications', { waitUntil: 'networkidle' })
      .then(() => page.evaluate(() => (document.querySelector('meta[name=robots]') || {}).content || ''));
    is(/noindex/.test(robots), 'no account page is offered to search engines', robots);

    /* ------------------------------------------------------------------ 3 */
    console.log('\n3. My orders: requested, confirmed, paid, fulfilled, completed');
    await page.goto(base + '/account/orders', { waitUntil: 'networkidle' });
    await page.waitForSelector('.ac-order', { timeout: 15000 });
    const badges = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.ac-order')]
      .map(r => [r.getAttribute('data-ref'), (r.querySelector('.ac-status') || {}).textContent])));
    const want = { 'VB-OPEN1': 'Requested', 'VB-WAIT1': 'Awaiting payment', 'VB-FAIL1': 'Payment not completed', 'VB-WEBP1': 'Paid',
                   'VB-CONF1': 'Confirmed', 'VB-PREP1': 'Preparing', 'VB-ONWY1': 'On its way', 'VB-RFND1': 'Delivered',
                   'VB-DONE1': 'Completed', 'VB-CANC1': 'Cancelled' };
    is(J(badges) === J(Object.assign({}, ...Object.keys(badges).map(k => ({ [k]: want[k] })))) && Object.keys(badges).length === 10,
       'each order in its own words: Requested, Awaiting payment, Payment not completed, Paid, Confirmed, Preparing, On its way, Delivered, Completed, Cancelled', J(badges));
    is(!('VB-THEIRS' in badges), 'another customer\'s order is not there');
    is(/Requested: you sent it/.test(await pageText(page)), 'what the words mean is said under the list');
    await page.click('.ac-order[data-ref="VB-OPEN1"] .ac-view');
    await page.waitForSelector('.acd .ac-ref', { timeout: 15000 });
    is(new URL(page.url()).pathname === '/account/orders/VB-OPEN1' && (await page.textContent('.pt-title')) === 'Order VB-OPEN1',
       'View order opens it in full, at its own address', page.url());

    async function detail(ref) {
      await page.goto(base + '/account/orders/' + ref, { waitUntil: 'networkidle' });
      await page.waitForSelector('.acd .ac-ref, .acd .ac-lead', { timeout: 15000 });
      await page.waitForTimeout(150);
      return page.evaluate(() => ({
        title: (document.querySelector('.pt-title') || {}).textContent,
        rail: [...document.querySelectorAll('.oj li')].map(li => li.getAttribute('data-step') + (li.classList.contains('done') ? '+' : '-')).join(' '),
        text: document.querySelector('.acd').innerText.replace(/\s+/g, ' '),
        back: (document.querySelector('.pt-back') || {}).textContent,
        ask: !!document.querySelector('.acd .ac-ask'),
        refunds: [...document.querySelectorAll('.acd .acd-h')].some(h => h.textContent.trim() === 'Refunds'),
      }));
    }
    let x = await detail('VB-OPEN1');
    is(x.title === 'Order VB-OPEN1' && x.rail === 'requested+ confirmed- paid- fulfilled- completed-' &&
       /You sent this order\. We confirm it with you on WhatsApp before anything is paid\./.test(x.text) && /On WhatsApp/.test(x.text),
       'requested: the first step only, and what happens next', J(x));
    is(!x.refunds && !/Refunded/i.test(x.text), 'no refund, so no Refunds part (build 89: it showed an empty "Refunded K0" line)', J(x));
    x = await detail('VB-WEBP1');
    is(x.rail === 'requested+ confirmed+ paid+ fulfilled- completed-' && /On the website, paying online \(mobile money\)/.test(x.text) &&
       /Pieces K\s?1,400/.test(x.text) && /Delivery K\s?130/.test(x.text) && /Paid online K\s?1,530/.test(x.text) && /Plot 4, Stand-in Road/.test(x.text),
       'paid online: three steps done; the pieces, the delivery, what was paid, how, and where it goes', J(x));
    x = await detail('VB-RFND1');
    is(x.rail === 'requested+ confirmed+ paid+ fulfilled+ completed+' && /Refunded/i.test(x.text) && /On its way to you/i.test(x.text) && /FLW-RF-77/.test(x.text)
       && /Delivered \S+, confirmed by you/.test(x.text),
       'delivered and part refunded: every step done, who confirmed it, both refunds as Flutterwave has them, with the reference', J(x));
    is(x.back === 'My orders' && x.ask, 'the way back is to My orders, and "Ask about this order" is there', J(x));
    x = await detail('VB-DONE1');
    is(x.rail === 'requested+ confirmed+ paid+ fulfilled+ completed+' && /Completed at the shop/.test(x.text),
       'taken at the counter: completed, every step done', J(x));
    x = await detail('VB-CANC1');
    is(x.rail === 'requested+ cancelled+' && /This order was cancelled\./.test(x.text), 'cancelled: requested, then cancelled', J(x));
    x = await detail('VB-THEIRS');
    is(/This order is not on your account\./.test(x.text), 'another customer\'s order, asked for by its number: not on your account', J(x));
    x = await detail('VB-ONWY1');
    const onway = await page.evaluate(() => [...document.querySelectorAll('.acd .pg-acts button')].map(b => b.textContent.trim()));
    is(J(onway) === J(['Confirm delivery', 'Ask for more time']), 'on its way: Confirm delivery and Ask for more time are on its page too', J(onway));

    /* ------------------------------------------------------------------ 4 */
    console.log('\n4. Returns & refunds');
    await page.goto(base + '/account/refunds', { waitUntil: 'networkidle' });
    await page.waitForSelector('.ac-refund', { timeout: 15000 });
    const rf = await page.evaluate(() => [...document.querySelectorAll('.ac-refund')].map(r => r.innerText.replace(/\s+/g, ' ')));
    is(rf.length === 2 && rf.some(t => /VB-RFND1 Refunded Part of the order: K\s?200/i.test(t)) && rf.some(t => /On its way to you/i.test(t) && /K\s?50/.test(t)),
       'both refunds: the one made, and the one Flutterwave has accepted and is still on its way', J(rf));
    is(PORTAL.some(p => p.body.action === 'refunds' && p.as === 'buyer@example.com'), 'asked of the website\'s own function, as the customer', J(PORTAL));
    is(/Returns and exchanges/.test(await pageText(page)) && !!(await page.$('.ac-card .ac-ask')),
       'and a way to ask for a return or an exchange: Message us');

    /* ------------------------------------------------------------------ 5 */
    console.log('\n5. Recently viewed, Personal details, Notifications');
    await page.goto(base + '/account/recent', { waitUntil: 'networkidle' });
    await page.waitForSelector('.pt-recent .card', { timeout: 15000 });
    const recent = await page.evaluate(() => [...document.querySelectorAll('.pt-recent .card')].map(c => c.innerText.replace(/\s+/g, ' ')));
    is(recent.length === 2 && /Silk Scarf/.test(recent[0]) && /Linen Dress/.test(recent[1]), 'the pieces looked at on this device, the latest first', J(recent));

    await page.goto(base + '/account/details', { waitUntil: 'networkidle' });
    await page.waitForSelector('#ac_pname', { timeout: 15000 });
    await page.fill('#ac_pname', 'Half-typed name');
    /* Something about the account changes while the customer is typing
       (a new sign-in token, a save elsewhere): the page is not drawn again. */
    await page.evaluate(() => window.VBP_ACCOUNT.saveProfile({ phone: '0977000001' }));
    await page.waitForTimeout(400);
    is((await page.inputValue('#ac_pname')) === 'Half-typed name', 'what the customer is typing is not wiped when something about the account changes (build 86)');
    await page.click('.ac-card .btn-gold');
    await until(page, () => /Saved ✓/.test((document.querySelector('.ac-card .ac-msg') || {}).textContent || ''));
    await page.waitForTimeout(400);
    is(/Saved ✓/.test(await page.textContent('.ac-card .ac-msg')), '"Saved" is said, and stays to be read (before build 86 the page was drawn again over it)');
    is((await page.getAttribute('.ac-card a.ac-link', 'href')) === '/account/password', 'Change password leads to its own page');

    await page.goto(base + '/account/notifications', { waitUntil: 'networkidle' });
    await until(page, () => /You receive our emails/.test(document.getElementById('accountBody').innerText));
    const nt = await pageText(page);
    is(/when you pay online, when it is on its way, before it is marked delivered, once it is delivered or collected, and when a refund is made/.test(nt)
       && /the bell lets this device tell you when we reply/.test(nt) && /You receive our emails about new arrivals and offers, at buyer@example\.com\./.test(nt),
       'the order emails, the chat\'s replies on this device, and the newsletter, as they stand', nt);

    /* ------------------------------------------------------------------ 6 */
    console.log('\n6. The password: the one in use first');
    await page.goto(base + '/account/password', { waitUntil: 'networkidle' });
    await page.waitForSelector('#ac_curpw', { timeout: 15000 });
    AUTH = []; PASSWORDS_SET = [];
    await page.fill('#ac_curpw', 'not-my-password-1');
    await page.fill('#ac_newpw', 'a-brand-new-one-2');
    await page.fill('#ac_newpw2', 'a-brand-new-one-2');
    await page.click('.ac-card .btn-gold');
    await until(page, () => /not the password you use now/.test((document.querySelector('.ac-card .ac-msg') || {}).textContent || ''));
    is(/That is not the password you use now\./.test(await page.textContent('.ac-card .ac-msg')) && PASSWORDS_SET.length === 0,
       'the wrong password in use: refused, and nothing changed', J(AUTH));
    await page.fill('#ac_curpw', PASSWORD);
    await page.click('.ac-card .btn-gold');
    await until(page, () => /Your password is changed/.test((document.querySelector('.ac-card .ac-msg') || {}).textContent || ''));
    const pwOrder = AUTH.map(a => a.grant).join(' ');
    is(/Your password is changed ✓/.test(await page.textContent('.ac-card .ac-msg')) && PASSWORDS_SET.length === 1 &&
       PASSWORDS_SET[0].password === 'a-brand-new-one-2' && /password.*update/.test(pwOrder),
       'the right one: checked with Supabase first, then the new one set, and said so', J({ AUTH, PASSWORDS_SET }));
    is((await page.inputValue('#ac_curpw')) === '' && (await page.inputValue('#ac_newpw')) === '', 'and the boxes are emptied');

    /* ------------------------------------------------------------------ 7 */
    console.log('\n7. Signing out: here, the others, everywhere');
    await page.goto(base + '/account/sessions', { waitUntil: 'networkidle' });
    await page.waitForSelector('.pt-out-others', { timeout: 15000 });
    AUTH = [];
    await page.click('.pt-out-others');
    await until(page, () => /Every other device is signed out/.test(document.getElementById('accountBody').innerText));
    is(AUTH.some(a => a.grant === 'logout' && a.scope === 'others') && !!(await page.$('.pt-out-all')),
       'Sign out of my other devices: the others, and this one stays signed in', J(AUTH));
    AUTH = [];
    await page.click('.pt-out-all');
    await until(page, () => !!document.querySelector('#accountBody input[type=password]'));
    const allOut = await page.evaluate(() => ({ text: document.getElementById('accountBody').innerText, path: location.pathname,
                                                 form: !!document.querySelector('#accountBody input[type=password]') }));
    is(AUTH.some(a => a.grant === 'logout' && a.scope === 'global') && allOut.form && allOut.path === '/account' && /You are signed out of every device\./.test(allOut.text),
       'Sign out everywhere: every device, this one too, said so, back at /account', J({ AUTH, allOut }));

    await signIn(page, 'buyer@example.com');
    await page.goto(base + '/account', { waitUntil: 'networkidle' });
    await page.waitForSelector('.pt-out', { timeout: 15000 });
    AUTH = [];
    await page.click('.pt-out');
    await until(page, () => !!document.querySelector('#accountBody input[type=password]'));
    is(AUTH.some(a => a.grant === 'logout' && a.scope === 'local') && !AUTH.some(a => a.scope === 'global'),
       'Sign out on the dashboard: this device only (until build 86 it was every device)', J(AUTH));

    /* ------------------------------------------------------------------ 8 */
    console.log('\n8. Privacy, and Download my personal data');
    await signIn(page, 'buyer@example.com');
    await page.goto(base + '/account/privacy', { waitUntil: 'networkidle' });
    await page.waitForSelector('.pt-nl-off', { timeout: 15000 });
    await page.click('.pt-nl-off');
    await page.waitForSelector('.pt-nl-on', { timeout: 15000 });
    is(!NEWS && PORTAL.some(p => p.body.action === 'newsletter-set' && p.body.on === false && p.as === 'buyer@example.com') &&
       /Done: we will not send them any more\./.test(await pageText(page)),
       'Stop sending me these: off, through the website\'s function, as the customer', J(PORTAL.slice(-2)));
    await page.click('.pt-nl-on');
    await page.waitForSelector('.pt-nl-off', { timeout: 15000 });
    is(NEWS === true, 'Send me these: on again');

    await page.goto(base + '/account/data', { waitUntil: 'networkidle' });
    await page.waitForSelector('.pt-data', { timeout: 15000 });
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('.pt-data')]);
    const file = await dl.path();
    const got = JSON.parse(fs.readFileSync(file, 'utf8'));
    is(/^Vaultique-my-data-\d{4}-\d\d-\d\d\.json$/.test(dl.suggestedFilename()), 'a file to keep, named for the shop and the day', dl.suggestedFilename());
    is(got.account && got.account.email === 'buyer@example.com' && got.orders.length === 10 && !got.orders.some(o => o.ref === 'VB-THEIRS'),
       'the website\'s records of this customer, and none of another\'s', J(got).slice(0, 300));
    is(got.rewards && got.rewards.points && got.rewards.points.points === 850 && /business platform/.test(got.rewards.points.from),
       'the points in it are the platform\'s, asked at the moment of downloading', J(got.rewards));
    is(got.thisDevice && J(got.thisDevice.recentlyViewed) === J(['SC-2', 'LD-9']), 'and what this device keeps for itself, said as such', J(got.thisDevice));

    await page.goto(base + '/account/close', { waitUntil: 'networkidle' });
    is(!!(await page.waitForSelector('.ac-danger', { timeout: 15000 }).catch(() => null)), 'Close my account has its page, as before');

    await ctx.close();
    is(errors.length === 0, 'no script error on any page', errors.join(' | '));
  } catch (e) {
    is(false, 'the test itself broke', e && e.stack);
  }
  await browser.close();
  server.close();
  console.log('\n  the customer portal: ' + (failures ? failures + ' of ' + checks + ' checks FAILED' : 'all ' + checks + ' checks passed'));
  process.exit(failures ? 1 : 0);
})();
