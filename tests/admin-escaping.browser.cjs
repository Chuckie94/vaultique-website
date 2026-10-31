/* ===========================================================================
   WHAT THE ADMIN PUTS ON ITS OWN PAGES -- assets/admin/shell.js, build 78

   The audit of build 73 (W-19): a product's extra photos and videos were
   written into the page as text, address and all, so an address with a
   quote in it could carry code; and four tabs showed the database's error
   message as code too. Both are things staff, or the database, wrote, but a
   page that runs whatever it is handed is one mistake away from running
   somebody else's.

   The real admin.html and assets/admin/shell.js, signed in as the owner.
   Supabase is a stand-in served in place of the library in assets/vendor/,
   holding a product whose photo and video addresses are booby-trapped, and
   answering the Reviews, Subscribers and Policies tabs with an error whose
   message is code. Anything that runs sets window.__pwned.
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

const TRAP_URL = 'https://img.example.test/a.jpg" onerror="window.__pwned=1';
const TRAP_VID = 'https://media.example.test/a.mp4" onloadstart="window.__pwned=1';
const TRAP_MSG = 'permission denied <img src="x" onerror="window.__pwned=1">';

const SUPA = `
(function () {
  var session = null;
  function thenable(v) {
    var b = {};
    ['select','eq','neq','gte','lte','order','limit','range','in','is','or','single','maybeSingle','upsert','insert','update','delete','contains','gt','lt','not','filter','match','ilike','like']
      .forEach(function (k) { b[k] = function () { return b; }; });
    b.then = function (ok, bad) { return Promise.resolve(v).then(ok, bad); };
    return b;
  }
  var ERR = { data: null, error: { message: ${JSON.stringify(TRAP_MSG)} } };
  window.supabase = { createClient: function () {
    return {
      auth: {
        getSession: function () { return Promise.resolve({ data: { session: session } }); },
        onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
        signInWithPassword: function (c) {
          session = { access_token: 't', user: { id: 'u1', email: c.email } };
          return Promise.resolve({ data: { session: session }, error: null });
        },
        signOut: function () { session = null; return Promise.resolve({ error: null }); },
        mfa: {
          getAuthenticatorAssuranceLevel: function () { return Promise.resolve({ data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null }); },
          listFactors: function () { return Promise.resolve({ data: { totp: [], all: [] }, error: null }); }
        }
      },
      from: function (t) {
        if (t === 'admins') return thenable({ data: [{ id: 'u1' }], error: null });
        if (t === 'product_meta') return thenable({ data: [{ sku: 'VB-1', image_url: '',
          gallery: [${JSON.stringify(TRAP_URL)}, 'https://img.example.test/fine.jpg'],
          videos: [${JSON.stringify(TRAP_VID)}] }], error: null });
        if (t === 'reviews' || t === 'subscribers' || t === 'policies') return thenable(ERR);
        return thenable({ data: [], error: null });
      },
      rpc: function (n) {
        if (n === 'admin_gate') return thenable({ data: { staff: true, owner: true, active: true, required: false,
                                                          enrolled: false, aal: 'aal1', ok: true }, error: null });
        if (n === 'my_access') return thenable({ data: { is_admin: true, is_owner: true, active: true, must_change_password: false }, error: null });
        if (n === 'is_admin' || n === 'is_shop_owner' || n === 'may') return thenable({ data: true, error: null });
        return thenable({ data: null, error: null });
      },
      channel: function () { var ch = { on: function () { return ch; }, subscribe: function () { return ch; } }; return ch; },
      removeChannel: function () {},
      storage: { from: function () { return { list: function () { return Promise.resolve({ data: [] }); },
                                               getPublicUrl: function () { return { data: { publicUrl: '' } }; } }; } }
    };
  } };
})();`;

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css',
                '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
let base = '';
const server = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  const json = o => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (p === '/api/products') return json({ products: [{ sku: 'VB-1', name: 'Silk Wrap Dress', price: 1850, category: 'Dresses' }] });
  if (p.indexOf('/.netlify/functions/') === 0) return json({});
  if (p.indexOf('/web/') === 0) return json([]);
  if (/^\/(img|media)\//.test(p)) { res.writeHead(404); return res.end(); }
  if (p === '/config.js') {
    res.writeHead(200, { 'Content-Type': TYPES['.js'] });
    return res.end('window.VBP_CONFIG={SUPABASE_URL:"' + base + '/web",SUPABASE_ANON_KEY:"anon"};');
  }
  let file = path.join(ROOT, p === '/' ? 'index.html' : p);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await ctx.route('**/assets/vendor/supabase-js-*', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: SUPA }));
  await ctx.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await ctx.route('https://img.example.test/**', r => r.fulfill({ status: 404, body: '' }));
  await ctx.route('https://media.example.test/**', r => r.fulfill({ status: 404, body: '' }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e)));
  try {
    await page.goto(base + '/admin.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => { const e = document.getElementById('login'); return e && !e.classList.contains('hide'); }, null, { timeout: 10000 });
    await page.fill('#email', 'owner@shop.test');
    await page.fill('#password', 'a-long-password');
    await page.click('#loginBtn');
    await page.waitForFunction(() => { const e = document.getElementById('admin'); return e && !e.classList.contains('hide'); }, null, { timeout: 10000 });

    console.log('\nA product\'s extra photos and videos');
    await page.evaluate(() => { location.hash = '#/products'; });
    await page.waitForFunction(() => document.querySelectorAll('#tab-products .gal img').length >= 2, null, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(800);
    const gal = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('#tab-products .gal img'));
      const vids = Array.from(document.querySelectorAll('#tab-products .gal video'));
      return { imgs: imgs.map(i => i.getAttribute('src')), vids: vids.map(v => v.getAttribute('src')),
               handlers: Array.from(document.querySelectorAll('#tab-products .gal *'))
                 .filter(e => Array.from(e.attributes).some(a => /^on/i.test(a.name))).length,
               pwned: window.__pwned === 1 };
    });
    is(gal.imgs.length === 2 && gal.imgs[0] === TRAP_URL && gal.imgs[1] === 'https://img.example.test/fine.jpg',
       'a photo address with a quote in it is kept whole, as an address', JSON.stringify(gal.imgs));
    is(gal.vids.length === 1 && gal.vids[0] === TRAP_VID, 'and a video\'s the same', JSON.stringify(gal.vids));
    is(gal.handlers === 0 && !gal.pwned, 'no event handler on any of them, and nothing ran');

    console.log('\nAn error from the database is shown as words');
    for (const tab of ['reviews', 'subscribers', 'policies']) {
      await page.evaluate(h => { location.hash = h; }, '#/' + tab);
      await page.waitForFunction(t => /permission denied/.test((document.getElementById('tab-' + t) || {}).textContent || ''), tab, { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(300);
      const r = await page.evaluate(t => {
        const host = document.getElementById('tab-' + t);
        return { text: host ? host.textContent : '', imgs: host ? host.querySelectorAll('img[src="x"]').length : -1, pwned: window.__pwned === 1 };
      }, tab);
      is(r.text.indexOf(TRAP_MSG) > -1 && r.imgs === 0 && !r.pwned,
         tab + ': the message is shown exactly as it came, and nothing in it runs', JSON.stringify(r).slice(0, 300));
    }
    is(errors.length === 0, 'no script errors', errors.slice(0, 2).join(' | '));
  } catch (e) {
    fail('threw: ' + (e && e.stack || e));
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failures ? '\n  ✗ ' + failures + ' of ' + checks + ' checks FAILED'
                       : '\n  admin escaping: all ' + checks + ' checks passed');
  process.exit(failures ? 1 : 0);
})();
