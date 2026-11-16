/* ===========================================================================
   THE ADMIN'S OWN SIGN-IN -- with the real Supabase library, in a real browser

   THE OWNER (a screenshot of Admin > Rewards, build 74): "I can't link a
   customer for rewards." Pressing Link answered "not permitted", in the
   browser's own box.

   Why. The admin and the shop front kept their sign-in in the same slot of
   the browser: supabase-js's default, one slot per Supabase project, and
   both pages talk to the same project from the same address. Signing in to
   the shop as a customer, in another tab, to try Rewards, put the
   customer's sign-in in that slot, and the open admin carried on as that
   customer. The database, quite rightly, said a customer may not link
   anybody. The admin now keeps its sign-in under a name of its own.

   The real admin.html and assets/admin/rewards.js, and the REAL supabase-js
   (installed for this test only, in ../vendor; the site loads it from the
   CDN). Supabase's sign-in and tables, and the rewards function, are
   answered here, and they answer by who is asking, as the real ones do.
   =========================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');

let checks = 0, failures = 0;
const ok = m => { checks++; console.log('  ✓ ' + m); };
const fail = (m, x) => { checks++; failures++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); };
const is = (c, m, x) => c ? ok(m) : fail(m, x);
const J = o => JSON.stringify(o);

let SUPABASE_JS = null;
for (const p of [
  () => require.resolve('@supabase/supabase-js/dist/umd/supabase.js'),
  () => path.resolve(ROOT, '..', 'vendor', 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd', 'supabase.js'),
]) {
  try { const f = p(); if (fs.existsSync(f)) { SUPABASE_JS = fs.readFileSync(f, 'utf8'); break; } } catch (e) {}
}
if (!SUPABASE_JS) {
  console.log('  admin sign-in: skipped (the real supabase-js is not installed here: npm install @supabase/supabase-js@2 in ../vendor)');
  process.exit(0);
}

/* ---------------- Supabase, answering by who is asking ---------------- */
const USERS = {
  'owner@example.com':    { id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.com', admin: true },
  'customer@example.com': { id: '22222222-2222-4222-8222-222222222222', email: 'customer@example.com', admin: false },
};
const PASSWORD = 'the-right-password-1';
const REQUEST = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', user_id: USERS['customer@example.com'].id, kind: 'join',
  name: 'Mwila Banda', email: 'customer@example.com', phone: null, cust_no: null, note: null,
  status: 'waiting', created_at: new Date(Date.now() - 3600000).toISOString(),
};
/* The customer's own order, as the website keeps it. */
const ORDER = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', ref: 'VB-FGQBY', customer_id: USERS['customer@example.com'].id,
  name: 'Mwila Banda', phone: '+260970000000', email: 'customer@example.com', total: 162, status: 'pending',
  fulfilment: 'collection', created_at: new Date(Date.now() - 600000).toISOString(),
  order_items: [{ sku: 'SB-1', name: 'Stitching Bean', price: 162, qty: 1 }],
};
let REFUSE_ORDERS = false, DELETED = false;     // the database's rules saying no, as they do: no rows, no error
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

let CALLS = [];          // what reached the rewards function, and as whom
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

    // ---- Supabase auth
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

    // ---- the website's tables, by who is asking
    const usr = who(req);
    if (p === '/web/rest/v1/admins') return send(200, usr && usr.admin ? [{ id: usr.id }] : []);
    if (p === '/web/rest/v1/rpc/is_admin') return send(200, !!(usr && usr.admin));
    if (p === '/web/rest/v1/rpc/my_access') {
      return send(200, usr && usr.admin
        ? { is_admin: true, is_owner: true, active: true, role: 'owner', permissions: {}, must_change_password: false }
        : { is_admin: false, is_owner: false, active: false, role: null, permissions: {} });
    }
    /* orders: the owner reads them all, a customer only their own (or_own);
       only an administrator may change one (or_admin). Anybody else's
       change touches no row and is NOT an error, exactly as PostgREST
       answers under row level security. */
    if (p === '/web/rest/v1/orders') {
      if (req.method === 'GET') {
        let rows = usr && (usr.admin || usr.id === ORDER.customer_id) ? [ORDER] : [];
        const st = u.searchParams.get('status');
        if (st && st.indexOf('eq.') === 0) rows = rows.filter(o => o.status === st.slice(3));
        return send(200, rows);
      }
      if (req.method === 'PATCH') {
        const rowsBack = /return=representation/.test(String(req.headers.prefer || ''));
        if (!usr || !usr.admin || REFUSE_ORDERS) return rowsBack ? send(200, []) : send(204);
        Object.assign(ORDER, body);
        return rowsBack ? send(200, [{ id: ORDER.id }]) : send(204);
      }
      if (req.method === 'DELETE') {
        const rowsBack = /return=representation/.test(String(req.headers.prefer || ''));
        if (!usr || !usr.admin || REFUSE_ORDERS) return rowsBack ? send(200, []) : send(204);
        DELETED = true;
        return rowsBack ? send(200, [{ id: ORDER.id }]) : send(204);
      }
    }
    // The request is the customer's own, so both of them can read it.
    if (p === '/web/rest/v1/rewards_requests') return send(200, usr ? [REQUEST] : []);
    if (p.startsWith('/web/rest/v1/rpc/')) return send(200, null);
    if (p.startsWith('/web/rest/v1/')) return send(200, []);
    if (p.startsWith('/web/')) return send(200, {});

    // ---- netlify/functions/rewards.js: the database decides who may link
    if (p === '/.netlify/functions/rewards') {
      CALLS.push({ as: usr ? usr.email : null, body });
      if (!usr || !usr.admin) return send(400, { error: 'not permitted' });
      return send(200, { done: true, emailed: true });
    }
    if (p === '/api/products') return send(200, { products: [], version: 't' });
    if (p.startsWith('/.netlify/functions/')) return send(200, {});

    if (p === '/config.js') {
      res.writeHead(200, { 'Content-Type': TYPES['.js'] });
      return res.end('window.VBP_CONFIG={SUPABASE_URL:"' + base + '/web",SUPABASE_ANON_KEY:"anon"};');
    }
    // A page on the shop's own address that makes its client exactly as
    // the shop front does (assets/app.js, webClient): the defaults.
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

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const errors = [], dialogs = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
    /* One handler: Playwright tries the routes last-registered first, so a
       catch-all added after a specific route would win over it. */
    await ctx.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'text/javascript',
      body: /\/@supabase\/supabase-js/.test(r.request().url()) ? SUPABASE_JS : '' }));
    await ctx.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await ctx.route('**/fonts.gstatic.com/**', r => r.fulfill({ status: 200, body: '' }));
    await ctx.route('**/cdnjs.cloudflare.com/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    const watch = (page) => {
      page.on('pageerror', e => errors.push(String(e.message || e)));
      page.on('dialog', d => { dialogs.push(d.type() + ': ' + d.message()); d.dismiss().catch(() => {}); });
    };

    console.log('\nThe owner in the admin, a customer on the shop, one browser');
    const admin = await ctx.newPage(); watch(admin);
    await admin.goto(base + '/admin.html', { waitUntil: 'domcontentloaded' });
    await admin.waitForSelector('#login:not(.hide)', { timeout: 15000 });
    await admin.fill('#email', 'owner@example.com');
    await admin.fill('#password', PASSWORD);
    await admin.click('#loginBtn');
    await admin.waitForSelector('#admin:not(.hide)', { timeout: 15000 });
    ok('the owner signs in to the admin');

    const shop = await ctx.newPage(); watch(shop);
    await shop.goto(base + '/__shop.html', { waitUntil: 'load' });
    const signedIn = await shop.evaluate(() => window.SHOP.auth.signInWithPassword({
      email: 'customer@example.com', password: 'the-right-password-1' }).then(r => r.data && r.data.user && r.data.user.email));
    is(signedIn === 'customer@example.com', 'a customer signs in on the shop, in another tab of the same browser', signedIn);

    await admin.bringToFront();
    await admin.evaluate(() => { location.hash = '#/rewards'; });
    await admin.waitForSelector('#tab-rewards .rw-num', { timeout: 15000 });
    await admin.fill('#tab-rewards .rw-num', 'VB-CUS-0006');
    CALLS = [];
    await admin.click('#tab-rewards .rw-row-a button:has-text("Link")');
    for (let i = 0; i < 100 && !CALLS.length; i++) await admin.waitForTimeout(50);
    await admin.waitForTimeout(300);
    is(CALLS.length === 1 && CALLS[0].as === 'owner@example.com' && CALLS[0].body.op === 'join_done' &&
       CALLS[0].body.number === 'VB-CUS-0006',
       'Link goes to the database as the owner, not as the customer signed in on the shop', J(CALLS));
    const flash = await admin.evaluate(() => { const f = document.querySelector('.rw-flash'); return f && !f.classList.contains('hide') ? f.textContent : ''; });
    is(/customer has been emailed/.test(flash) && dialogs.length === 0,
       'and the admin says it is done, with no box from the browser', J({ flash, dialogs }));

    const shopStill = await shop.evaluate(() => window.SHOP.auth.getSession().then(r => r.data.session && r.data.session.user.email));
    is(shopStill === 'customer@example.com', 'the shop tab still has its customer: neither sign-in replaces the other', shopStill);

    console.log('\nAn order confirmed in the admin is confirmed for the customer');
    await admin.evaluate(() => { location.hash = '#/orders'; });
    await admin.waitForSelector('#ordList .card select', { timeout: 15000 });
    await admin.selectOption('#ordList .card select', 'confirmed');
    await admin.waitForFunction(() => /Saved|Not saved|Error/.test((document.querySelector('#ordList .card .stat') || {}).textContent || ''),
      null, { timeout: 8000 });
    const saidSaved = await admin.textContent('#ordList .card .stat');
    is(/Saved/.test(saidSaved) && ORDER.status === 'confirmed', 'the owner\'s change reaches the database, and only then says Saved',
       J({ saidSaved, status: ORDER.status }));
    const seen = await shop.evaluate(() => window.SHOP.from('orders').select('ref,status').then(r => r.data && r.data[0] && r.data[0].status));
    is(seen === 'confirmed', 'and the customer, signed in on the shop in the same browser, sees it Confirmed', seen);

    console.log('\nA change the database does not make');
    REFUSE_ORDERS = true;
    await admin.selectOption('#ordList .card select', 'ready');
    await admin.waitForFunction(() => /Not saved/.test((document.querySelector('#ordList .card .stat') || {}).textContent || ''),
      null, { timeout: 8000 });
    await admin.waitForSelector('.ask-back.in .ask-card', { timeout: 3000 });
    const refused = await admin.evaluate(() => ({ sel: document.querySelector('#ordList .card select').value,
      told: document.querySelector('.ask-back.in .ask-card').textContent }));
    is(refused.sel === 'confirmed' && /nothing was saved/.test(refused.told) && ORDER.status === 'confirmed' && dialogs.length === 0,
       'says Not saved, in the admin\'s own dialog, and the box goes back to what the order really is', J(refused));
    await admin.click('.ask-back.in .ask-card .ask-row .btn-gold');
    await admin.waitForTimeout(300);
    await admin.click('#ordList .card button:has-text("Delete")');
    await admin.waitForSelector('.ask-back.in .ask-card .btn-danger', { timeout: 3000 });
    await admin.click('.ask-back.in .ask-card .btn-danger');
    await admin.waitForFunction(() => { const c = document.querySelector('.ask-back.in .ask-card');
      return c && /Not deleted/.test(c.textContent); }, null, { timeout: 8000 });
    const stillListed = await admin.evaluate(() => document.querySelectorAll('#ordList .card select').length);
    is(!DELETED && stillListed === 1, 'a delete the database refuses says so, and the order stays on the list', J({ DELETED, stillListed }));
    await admin.click('.ask-back.in .ask-card .ask-row .btn-gold');
    await admin.waitForTimeout(300);
    REFUSE_ORDERS = false;

    console.log('\nComing back to the admin later');
    await admin.reload({ waitUntil: 'domcontentloaded' });
    await admin.waitForSelector('#admin:not(.hide), #login:not(.hide)', { timeout: 15000 });
    const shown = await admin.evaluate(() => !document.getElementById('admin').classList.contains('hide'));
    is(shown, 'the admin is still signed in, as the owner, after a reload');
    const keys = await admin.evaluate(() => Object.keys(localStorage).filter(k => /auth/.test(k)).sort());
    is(keys.length === 2 && keys.indexOf('sb-127-auth-token') > -1,
       'two sign-ins on this browser, each in its own place: the shop\'s, and the admin\'s', J(keys));

    console.log('\nSigning out of the admin');
    await admin.evaluate(() => window.VBP_ADMIN.sb.auth.signOut({ scope: 'local' }));
    const after = await shop.evaluate(() => window.SHOP.auth.getSession().then(r => r.data.session && r.data.session.user.email));
    is(after === 'customer@example.com', 'leaves the customer on the shop signed in', after);

    await ctx.close();

    console.log('\nThe other way round: the customer first, then the owner');
    const ctx2 = await browser.newContext({ viewport: { width: 390, height: 900 } });
    await ctx2.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'text/javascript',
      body: /\/@supabase\/supabase-js/.test(r.request().url()) ? SUPABASE_JS : '' }));
    await ctx2.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await ctx2.route('**/fonts.gstatic.com/**', r => r.fulfill({ status: 200, body: '' }));
    await ctx2.route('**/cdnjs.cloudflare.com/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    const shop2 = await ctx2.newPage(); watch(shop2);
    await shop2.goto(base + '/__shop.html', { waitUntil: 'load' });
    await shop2.evaluate(() => window.SHOP.auth.signInWithPassword({ email: 'customer@example.com', password: 'the-right-password-1' }));
    const admin2 = await ctx2.newPage(); watch(admin2);
    await admin2.goto(base + '/admin.html', { waitUntil: 'domcontentloaded' });
    await admin2.waitForSelector('#login:not(.hide)', { timeout: 15000 });
    is(true, 'the admin does not open on the customer\'s sign-in: it asks for the owner\'s');
    await admin2.fill('#email', 'owner@example.com');
    await admin2.fill('#password', PASSWORD);
    await admin2.click('#loginBtn');
    await admin2.waitForSelector('#admin:not(.hide)', { timeout: 15000 });
    const shop2Still = await shop2.evaluate(() => window.SHOP.auth.getSession().then(r => r.data.session && r.data.session.user.email));
    is(shop2Still === 'customer@example.com', 'and the owner signing in leaves the customer on the shop exactly as they were', shop2Still);
    await ctx2.close();

    is(errors.length === 0, 'no script error on any page', errors.slice(0, 3).join(' | '));
  } catch (e) {
    fail('threw', e && e.stack);
  }
  await browser.close();
  server.close();
  console.log(failures ? '\n  ✗ ' + failures + ' of ' + checks + ' checks FAILED'
                       : '\n  the admin\'s own sign-in: all ' + checks + ' checks passed');
  process.exit(failures ? 1 : 0);
})();
