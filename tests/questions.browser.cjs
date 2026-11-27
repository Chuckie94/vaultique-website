/* ===========================================================================
   QUESTIONS & ANSWERS IN THE ADMIN (website build 90) -- in a real browser

   Admin > Reviews has two halves now: the reviews, and the answers the shop
   publishes on pieces' pages (assets/admin/questions.js). Customers ask in
   the live chat; the shop publishes the answers worth keeping.
     1. Reviews first, as before; Questions & answers beside it.
     2. Add an answer: a window on the screen, the piece chosen by its code
        (its name shown), the question, the answer, shown or not. Saved:
        listed, one row written.
     3. Edit, and hide; Delete, asked first.
     4. A sign-in that may not change reviews: said plainly.
     5. Before supabase-shopping.sql: said what to run.
   The real admin.html and scripts; Supabase answered in the page.
   =========================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');

let checks = 0, failures = 0;
const is = (c, m, x) => { checks++; if (c) console.log('  ✓ ' + m); else { failures++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); } };
const J = o => JSON.stringify(o);

const SUPA = `
(function () {
  var S = window.__SETUP || {};
  var DB = window.__DB = { product_questions: S.qa || [], reviews: S.reviews || [] };
  var seq = 10;
  window.__writes = [];
  function answer(st) {
    if (st.table === 'admins') return { data: [{ id: 'u1' }], error: null };
    if (st.table === 'site_settings' || st.table === 'site_settings_private') return { data: st.one ? null : [], error: null };
    if (st.table === 'product_questions' && S.noTable) return { data: null, error: { code: 'PGRST205', message: 'Could not find the table public.product_questions in the schema cache' } };
    if (st.table !== 'product_questions' && st.table !== 'reviews') return { data: st.one ? null : [], error: null };
    var rows = DB[st.table];
    if (st.op === 'select') return { data: JSON.parse(JSON.stringify(rows)), error: null };
    window.__writes.push({ table: st.table, op: st.op, id: st.id, row: st.row ? JSON.parse(JSON.stringify(st.row)) : null });
    if (S.refuse) return st.op === 'insert' ? { data: null, error: { message: 'new row violates row-level security policy for table "product_questions"' } } : { data: [], error: null };
    if (st.op === 'insert') { var x = Object.assign({ id: 'q' + (++seq), sort: 100, created_at: new Date().toISOString() }, st.row); rows.push(x); return { data: [{ id: x.id }], error: null }; }
    var hit = rows.filter(function (r) { return r.id === st.id; });
    if (st.op === 'update') hit.forEach(function (r) { Object.assign(r, st.row); });
    if (st.op === 'delete') DB[st.table] = rows.filter(function (r) { return r.id !== st.id; });
    return { data: hit.map(function (r) { return { id: r.id }; }), error: null };
  }
  function from(table) {
    var st = { table: table, op: 'select', id: null, row: null, one: false };
    var b = {};
    ['select','neq','gt','gte','lt','lte','range','in','is','or','not','ilike','like','match','filter','contains','order','limit']
      .forEach(function (k) { b[k] = function () { return b; }; });
    b.eq = function (col, val) { if (col === 'id') st.id = val; return b; };
    b.single = b.maybeSingle = function () { st.one = true; return b; };
    b.upsert = function (row) { st.op = 'upsert'; st.row = row; return b; };
    b.insert = function (row) { st.op = 'insert'; st.row = row; return b; };
    b.update = function (row) { st.op = 'update'; st.row = row; return b; };
    b.delete = function () { st.op = 'delete'; return b; };
    b.then = function (ok, bad) { return Promise.resolve(answer(st)).then(ok, bad); };
    return b;
  }
  window.supabase = { createClient: function () {
    var session = { access_token: 't', user: { id: 'u1', email: 'owner@example.com', email_confirmed_at: 'x' } };
    return {
      auth: {
        getSession: function () { return Promise.resolve({ data: { session: session } }); },
        getUser: function () { return Promise.resolve({ data: { user: session.user } }); },
        onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
        signOut: function () { return Promise.resolve({ error: null }); },
        mfa: { getAuthenticatorAssuranceLevel: function () { return Promise.resolve({ data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null }); },
               listFactors: function () { return Promise.resolve({ data: { totp: [], all: [] }, error: null }); } }
      },
      from: from,
      rpc: function (n) { var r = n === 'my_access' ? { data: S.access, error: null } : { data: null, error: null };
        var t = from('rpc'); t.then = function (ok, bad) { return Promise.resolve(r).then(ok, bad); }; return t; },
      channel: function () { var ch = { on: function () { return ch; }, subscribe: function () { return ch; } }; return ch; },
      removeChannel: function () {},
      storage: { from: function () { return { list: function () { return Promise.resolve({ data: [] }); }, getPublicUrl: function () { return { data: { publicUrl: '' } }; } }; } }
    };
  } };
})();`;

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
let base = '';
const CATALOGUE = [{ sku: 'BG-1', name: 'Leather Satchel', price: 500, available: true }, { sku: 'HT-1', name: 'Straw Hat', price: 200, available: true }];
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), p = u.pathname;
  const json = o => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (p === '/api/products') return json({ products: CATALOGUE, count: 2, version: 't' });
  if (p.startsWith('/web/')) return json([]);
  if (p.startsWith('/.netlify/functions/')) return json({});
  if (p === '/config.js') { res.writeHead(200, { 'Content-Type': TYPES['.js'] }); return res.end('window.VBP_CONFIG={SUPABASE_URL:"' + base + '/web",SUPABASE_ANON_KEY:"anon"};'); }
  let file = path.join(ROOT, p === '/' ? 'index.html' : p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
const OWNER = { is_admin: true, is_owner: true, active: true, must_change_password: false };

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const errors = [];
  async function open(setup) {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 820 } });
    await ctx.addInitScript('window.__SETUP = ' + J(Object.assign({ access: OWNER }, setup)) + ';');
    await ctx.route(/\/assets\/vendor\/supabase-js-[0-9.]+\.js(\?.*)?$/, r => r.fulfill({ status: 200, contentType: 'text/javascript', body: SUPA }));
    await ctx.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(String(e.message || e)));
    await page.goto(base + '/admin.html#/reviews', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#revShowQa', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(300);
    return { ctx, page };
  }
  const QA = [{ id: 'q1', sku: 'BG-1', question: 'Does it fit a laptop?', answer: 'Yes, up to 14 inches.', published: true, sort: 100 }];
  try {
    console.log('\n1. Two halves');
    let { ctx, page } = await open({ qa: JSON.parse(J(QA)), reviews: [{ id: 'r1', sku: 'BG-1', name: 'Ann', rating: 5, comment: 'Lovely', verified: true, approved: true, created_at: new Date().toISOString() }] });
    is(await page.isVisible('#revList') && !(await page.isVisible('#qaPane')) && await page.getAttribute('#revShowReviews', 'aria-pressed') === 'true',
       'the reviews first, as before');
    await page.click('#revShowQa');
    await page.waitForSelector('.qa-row', { timeout: 8000 }).catch(() => {});
    const row = await page.evaluate(() => (document.querySelector('.qa-row') || {}).innerText || '');
    is(await page.isVisible('#qaPane') && !(await page.isVisible('#revList')) && /BG-1 · Leather Satchel/.test(row) && /Does it fit a laptop\?/.test(row) && /Published/i.test(row),
       'Questions & answers: each with its piece, by code and name', row);

    console.log('\n2. Add an answer');
    await page.click('#qaAdd');
    await page.waitForSelector('.polw-back.in', { timeout: 5000 }).catch(() => {});
    is(await page.textContent('#qawTitle') === 'Add an answer' && await page.isChecked('#qaw_pub'), 'a window on the screen; shown on the piece unless unticked');
    await page.fill('#qaw_sku', 'HT-1');
    await page.waitForTimeout(150);
    is(await page.textContent('#qaw_which') === 'Straw Hat', 'the piece named as its code is typed');
    await page.fill('#qaw_q', 'Is the brim wide?');
    await page.fill('#qaw_a', 'Yes, 12 cm all round.');
    await page.evaluate(() => window.__writes.length = 0);
    await page.click('.polw-save');
    await page.waitForSelector('.polw-back', { state: 'detached', timeout: 5000 }).catch(() => {});
    await page.waitForFunction(() => document.querySelectorAll('.qa-row').length === 2, null, { timeout: 5000 }).catch(() => {});
    let wr = await page.evaluate(() => window.__writes);
    is(wr.length === 1 && wr[0].op === 'insert' && wr[0].row.sku === 'HT-1' && wr[0].row.published === true &&
       /Published on HT-1/.test(await page.textContent('#qaStat')), 'published: one row, listed, and said', J(wr));

    console.log('\n3. Edit, hide, delete');
    await page.evaluate(() => [...document.querySelectorAll('.qa-row')].find(r => /HT-1/.test(r.textContent)).querySelector('.btn').click());
    await page.waitForSelector('.polw-back.in', { timeout: 5000 }).catch(() => {});
    await page.uncheck('#qaw_pub');
    await page.click('.polw-save');
    await page.waitForSelector('.polw-back', { state: 'detached', timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(200);
    is(await page.evaluate(() => /Not shown/i.test([...document.querySelectorAll('.qa-row')].find(r => /HT-1/.test(r.textContent)).textContent)),
       'unticked: kept, but not shown on the piece');
    await page.evaluate(() => [...document.querySelectorAll('.qa-row')].find(r => /HT-1/.test(r.textContent)).querySelectorAll('.btn')[1].click());
    await page.waitForSelector('.ask-back', { timeout: 5000 }).catch(() => {});
    await page.click('.ask-back .ask-row button:last-child');
    await page.waitForFunction(() => document.querySelectorAll('.qa-row').length === 1, null, { timeout: 5000 }).catch(() => {});
    is((await page.evaluate(() => document.querySelectorAll('.qa-row').length)) === 1, 'Delete: asked first, then gone');
    await ctx.close();

    console.log('\n4. Not allowed');
    ({ ctx, page } = await open({ qa: [], refuse: true }));
    await page.click('#revShowQa');
    await page.click('#qaAdd');
    await page.waitForSelector('.polw-back.in', { timeout: 5000 }).catch(() => {});
    await page.fill('#qaw_sku', 'BG-1'); await page.fill('#qaw_q', 'Colour?'); await page.fill('#qaw_a', 'Tan.');
    await page.click('.polw-save');
    await page.waitForSelector('.ask-back', { timeout: 5000 }).catch(() => {});
    is(/row-level security|may not change reviews/.test(await page.textContent('.ask-back')) && !!(await page.$('.polw-back')), 'refused: said, and the window keeps what was typed');
    await ctx.close();

    console.log('\n5. Before supabase-shopping.sql');
    ({ ctx, page } = await open({ noTable: true }));
    await page.click('#revShowQa');
    await page.waitForTimeout(400);
    is(/run supabase-shopping\.sql once/.test(await page.textContent('#qaList')), 'said what to run');
    await ctx.close();
    is(errors.length === 0, 'no script error', errors.join(' | '));
  } catch (e) {
    failures++;
    console.log('  ✗ the run stopped: ' + (e && e.stack || e));
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failures ? '\n  ✗ ' + failures + ' of ' + checks + ' checks FAILED' : '\n  questions & answers in the admin: all ' + checks + ' checks passed');
  process.exit(failures ? 1 : 0);
})();
