/* ===========================================================================
   THE POLICIES TAB (website build 90) -- in a real browser

   The owner, 26 November 2026: "Adding a new policy shouldn't take the
   windows to the bottom, instead, a policy window should just appear on
   the screen. Also, the numbers in order should auto correct when a new
   policy is added, instead of editing all the numbers."

     1. The list: compact, numbered 1, 2, 3 ... under its sections, as the
        policies page orders them. No big forms, no number to type.
     2. Add policy: a window over the list, where the page already was; it
        says where the policy will go before anything is saved. Saved:
        the numbers after it move down by themselves, the page does not
        move, the new policy is marked, and one row was written.
     3. A number among another section's policies: the nearest place in
        its own section, and the window says so.
     4. No room between two numbers: every number written again in one
        step (policies_set_order), or row by row before that SQL is run.
     5. The arrows: one policy one place; a whole section one place.
     6. Delete: the numbers after it move up.
     7. Closing with something typed asks first; a sign-in that may not
        change policies is told so, and the window keeps what was typed.
     8. On a phone: the window fits the screen.
     9. The policies page shows them in the order the admin numbers them.

   The real admin.html, policies.js and shell.js; Supabase answered in the
   page (as tests/lenco-admin.browser.cjs does), the shop's page from the
   same rows. SHOTS=<folder> keeps pictures.
   =========================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');

let checks = 0, failures = 0;
const is = (c, m, x) => { checks++; if (c) console.log('  ✓ ' + m); else { failures++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); } };
const J = o => JSON.stringify(o);
const SHOTS = process.env.SHOTS || '';

const SUPA = `
(function () {
  var S = window.__SETUP || {};
  var DB = window.__DB = { policies: S.policies || [] };
  var seq = 100;
  window.__writes = [];
  window.__rpcs = [];
  function sorted() { return DB.policies.slice().sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); }); }
  function answer(st) {
    if (st.table === 'admins') return { data: [{ id: 'u1' }], error: null };
    if (st.table === 'site_settings' || st.table === 'site_settings_private') {
      if (st.op === 'upsert') return { data: null, error: null };
      return { data: st.one ? null : [], error: null };
    }
    if (st.table !== 'policies') return { data: st.one ? null : [], error: null, count: 0 };
    if (st.op === 'select') {
      var rows = sorted();
      if (st.limit) rows = rows.slice(0, st.limit);
      if (st.desc) rows = sorted().reverse().slice(0, st.limit || 1000);
      return { data: JSON.parse(JSON.stringify(rows)), error: null };
    }
    window.__writes.push({ op: st.op, id: st.id, row: st.row ? JSON.parse(JSON.stringify(st.row)) : null });
    if (S.refuse) {
      if (st.op === 'insert') return { data: null, error: { message: 'new row violates row-level security policy for table "policies"' } };
      return { data: [], error: null };
    }
    if (st.op === 'insert') {
      var list = Array.isArray(st.row) ? st.row : [st.row];
      var made = list.map(function (r) { var x = Object.assign({ id: 'n' + (++seq) }, r); DB.policies.push(x); return x; });
      return { data: st.one ? { id: made[0].id } : made.map(function (x) { return { id: x.id }; }), error: null };
    }
    var hit = DB.policies.filter(function (p) { return p.id === st.id; });
    if (st.op === 'update') hit.forEach(function (p) { Object.assign(p, st.row); });
    if (st.op === 'delete') DB.policies = DB.policies.filter(function (p) { return p.id !== st.id; });
    return { data: hit.map(function (p) { return { id: p.id }; }), error: null };
  }
  function from(table) {
    var st = { table: table, op: 'select', id: null, row: null, one: false, limit: 0, desc: false };
    var b = {};
    ['select','neq','gt','gte','lt','lte','range','in','is','or','not','ilike','like','match','filter','contains']
      .forEach(function (k) { b[k] = function () { return b; }; });
    b.order = function (c, o) { if (o && o.ascending === false) st.desc = true; return b; };
    b.limit = function (n) { st.limit = n; return b; };
    b.eq = function (col, val) { if (col === 'id') st.id = val; return b; };
    b.single = b.maybeSingle = function () { st.one = true; return b; };
    b.upsert = function (row) { st.op = 'upsert'; st.row = row; return b; };
    b.insert = function (row) { st.op = 'insert'; st.row = row; return b; };
    b.update = function (row) { st.op = 'update'; st.row = row; return b; };
    b.delete = function () { st.op = 'delete'; return b; };
    b.then = function (ok, bad) { return Promise.resolve(answer(st)).then(ok, bad); };
    return b;
  }
  function rpc(n, args) {
    if (n === 'my_access') return { data: S.access, error: null };
    if (n === 'policies_set_order') {
      window.__rpcs.push(JSON.parse(JSON.stringify(args)));
      if (S.noRpc) return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.policies_set_order(p_ids) in the schema cache' } };
      var ids = args.p_ids || [];
      var have = DB.policies.map(function (p) { return p.id; }).sort().join(',');
      if (ids.slice().sort().join(',') !== have) return { data: { ok: false, why: 'stale' }, error: null };
      var changed = 0;
      ids.forEach(function (id, k) { DB.policies.forEach(function (p) { if (p.id === id && p.sort !== (k + 1) * 10) { p.sort = (k + 1) * 10; changed++; } }); });
      return { data: { ok: true, changed: changed }, error: null };
    }
    return { data: null, error: null };
  }
  window.supabase = { createClient: function () {
    var session = { access_token: 't', user: { id: 'u1', email: 'owner@example.com', email_confirmed_at: 'x' } };
    return {
      auth: {
        getSession: function () { return Promise.resolve({ data: { session: session } }); },
        getUser: function () { return Promise.resolve({ data: { user: session.user } }); },
        onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
        signOut: function () { return Promise.resolve({ error: null }); },
        mfa: {
          getAuthenticatorAssuranceLevel: function () { return Promise.resolve({ data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null }); },
          listFactors: function () { return Promise.resolve({ data: { totp: [], all: [] }, error: null }); }
        }
      },
      from: from,
      rpc: function (n, args) {
        var r = rpc(n, args);
        var t = from('rpc'); t.then = function (ok, bad) { return Promise.resolve(r).then(ok, bad); }; return t;
      },
      channel: function () { var ch = { on: function () { return ch; }, subscribe: function () { return ch; } }; return ch; },
      removeChannel: function () {},
      storage: { from: function () { return { list: function () { return Promise.resolve({ data: [] }); },
        getPublicUrl: function () { return { data: { publicUrl: '' } }; } }; } }
    };
  } };
})();`;

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png',
                '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
let base = '';
let SHOP_POLICIES = [];
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), p = u.pathname;
  const json = o => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (p === '/web/rest/v1/policies') return json(SHOP_POLICIES.slice().sort((a, b) => (a.sort || 0) - (b.sort || 0)));
  if (p === '/api/products') return json({ products: [], count: 0, version: 't' });
  if (p.startsWith('/web/rest/v1/rpc/')) return json(null);
  if (p.startsWith('/web/')) return json([]);
  if (p.startsWith('/.netlify/functions/')) return json({});
  if (p === '/config.js') {
    res.writeHead(200, { 'Content-Type': TYPES['.js'] });
    return res.end('window.VBP_CONFIG={SUPABASE_URL:"' + base + '/web",SUPABASE_ANON_KEY:"anon"};');
  }
  let file = path.join(ROOT, p === '/' ? 'index.html' : p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});

const OWNER = { is_admin: true, is_owner: true, active: true, must_change_password: false };
const pol = (id, section, sort, title, body) => ({ id, section, sort, title, body: body || ('The ' + title.toLowerCase() + ', in full. ').repeat(4) });
const SEED = [
  pol('r1', 'Returns & Exchanges', 10, 'Return Policy'), pol('r2', 'Returns & Exchanges', 20, 'Exchange Policy'),
  pol('r3', 'Returns & Exchanges', 30, 'Damaged or Faulty Items'),
  pol('d1', 'Delivery', 40, 'Delivery Areas'), pol('d2', 'Delivery', 50, 'Delivery Times'),
  pol('p1', 'Payments', 60, 'Payment Methods'), pol('p2', 'Payments', 70, 'Lay-by Payments'),
  // enough to make the page long, as a real shop's is
  ...Array.from({ length: 14 }, (_, i) => pol('c' + (i + 1), 'Customer Care', 80 + i * 10, 'Care note ' + (i + 1)))
];

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const errors = [];
  async function open(setup, viewport) {
    const ctx = await browser.newContext({ viewport: viewport || { width: 1100, height: 820 }, deviceScaleFactor: SHOTS ? 2 : 1 });
    await ctx.addInitScript('window.__SETUP = ' + J(Object.assign({ access: OWNER }, setup)) + ';');
    await ctx.route(/\/assets\/vendor\/supabase-js-[0-9.]+\.js(\?.*)?$/, r => r.fulfill({ status: 200, contentType: 'text/javascript', body: SUPA }));
    await ctx.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await ctx.route('**/fonts.gstatic.com/**', r => r.fulfill({ status: 200, body: '' }));
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(String(e.message || e)));
    await page.goto(base + '/admin.html#/policies', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.pol-row', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(200);
    return { ctx, page };
  }
  const shot = async (page, name) => {
    if (!SHOTS) return;
    await page.mouse.move(1, 1);
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(SHOTS, name + '.png') });
  };
  const list = page => page.evaluate(() => Array.from(document.querySelectorAll('.pol-row')).map(r =>
    r.querySelector('.pol-no').textContent + ' ' + r.querySelector('.pol-t').textContent));
  const heads = page => page.evaluate(() => Array.from(document.querySelectorAll('.pol-sec-head')).map(h =>
    h.querySelector('.pol-sec-name').textContent + ' (' + h.querySelector('.hint').textContent + ')'));
  const db = page => page.evaluate(() => window.__DB.policies.slice().sort((a, b) => (a.sort || 0) - (b.sort || 0)).map(p => p.title + ':' + p.sort));
  const writes = page => page.evaluate(() => window.__writes);
  const rpcs = page => page.evaluate(() => window.__rpcs);
  const where = page => page.textContent('#polw_where');
  const win = page => page.evaluate(() => { const b = document.querySelector('.polw-back'); if (!b) return null;
    const c = b.querySelector('.polw-card').getBoundingClientRect();
    return { top: Math.round(c.top), bottom: Math.round(c.bottom), left: Math.round(c.left), right: Math.round(c.right),
             vw: innerWidth, vh: innerHeight, focus: document.activeElement && document.activeElement.id,
             role: b.getAttribute('role'), title: (b.querySelector('#polwTitle') || {}).textContent }; });
  async function waitList(page, n) { await page.waitForFunction(k => document.querySelectorAll('.pol-row').length === k, n, { timeout: 10000 }).catch(() => {}); await page.waitForTimeout(150); }

  try {
    /* ------------------------------------------------------------------ 1 */
    console.log('\n1. The list');
    let { ctx, page } = await open({ policies: SEED });
    let l = await list(page);
    is(l.length === 21 && l[0] === '1 Return Policy' && l[3] === '4 Delivery Areas' && l[6] === '7 Lay-by Payments' && l[20] === '21 Care note 14',
       'every policy, numbered 1 to 21 in the order the policies page shows', J(l.slice(0, 8)));
    is(J(await heads(page)) === J(['Returns & Exchanges (Numbers 1 to 3)', 'Delivery (Numbers 4 to 5)', 'Payments (Numbers 6 to 7)',
                                   'Customer Care (Numbers 8 to 21)']), 'under their sections, each saying its numbers', J(await heads(page)));
    is(await page.evaluate(() => !document.querySelector('.pl-body, .pl-sort, #polList textarea, #polList input')),
       'no big forms and no number box in the list');
    is(await page.evaluate(() => { const r = document.querySelectorAll('.pol-row'); return r[0].querySelector('.pol-arrow').disabled &&
         !r[1].querySelector('.pol-arrow').disabled && r[2].querySelectorAll('.pol-arrow')[1].disabled; }),
       'up is off for the first of a section, down for the last');
    await shot(page, 'policies-1-list');

    /* ------------------------------------------------------------------ 2 */
    console.log('\n2. Add policy: a window, where the page already is');
    await page.evaluate(() => window.scrollTo({ top: 600, behavior: 'instant' }));
    await page.waitForTimeout(100);
    const y0 = await page.evaluate(() => window.pageYOffset);
    await page.evaluate(() => document.getElementById('polAdd').click());
    await page.waitForSelector('.polw-back.in', { timeout: 5000 }).catch(() => {});
    let w = await win(page);
    is(w && w.role === 'dialog' && w.title === 'Add a policy' && w.top >= 0 && w.bottom <= w.vh && w.focus === 'polw_title',
       'a window on the screen, the title box ready to type in', J(w));
    is(await page.evaluate(() => window.pageYOffset) === y0 && y0 > 0, 'the page did not move: nothing was added at the bottom', y0);
    is(await page.inputValue('#polw_no') === '22' && await page.inputValue('#polw_section') === 'Customer Care' &&
       await where(page) === 'It will be number 22, the last.', 'it starts at the end, in the last section, and says so', await where(page));
    await page.fill('#polw_title', 'Gift Wrapping');
    await page.fill('#polw_section', 'Returns & Exchanges');
    is(await page.inputValue('#polw_no') === '4' && await where(page) === 'It will be number 4. Numbers 4 to 21 each move down one.',
       'choosing a section puts it at the end of that section, and says which numbers move', await where(page));
    await page.fill('#polw_no', '2');
    is(await where(page) === 'It will be number 2. Numbers 2 to 21 each move down one.', 'number 2: there, the rest move down one', await where(page));
    await page.fill('#polw_body', 'We wrap any piece for free.\n\n- Ask at checkout\n- Or in the chat');
    await shot(page, 'policies-2-add-window');
    await page.evaluate(() => window.__writes.length = 0);
    await page.click('.polw-save');
    await page.waitForSelector('.polw-back', { state: 'detached', timeout: 5000 }).catch(() => {});
    await waitList(page, 22);
    l = await list(page);
    is(l[1] === '2 Gift Wrapping' && l[2] === '3 Exchange Policy' && l[21] === '22 Care note 14',
       'saved: number 2, and every number after it moved down one by itself', J(l.slice(0, 4)));
    let wr = await writes(page);
    is(wr.length === 1 && wr[0].op === 'insert' && wr[0].row.sort === 15 && wr[0].row.title === 'Gift Wrapping' &&
       wr[0].row.section === 'Returns & Exchanges' && (await rpcs(page)).length === 0,
       'one row written, numbered between its neighbours (15); nothing else touched', J(wr));
    is(await page.evaluate(() => window.pageYOffset) === y0, 'the page is where it was');
    is(/^"Gift Wrapping" added as number 2\./.test(await page.textContent('#polStat')) &&
       await page.evaluate(() => document.querySelector('.pol-row[data-id]:nth-child(n)') && !!document.querySelector('#polStat .pol-show')),
       'it says so, with "Show it", since number 2 is above where the page is', await page.textContent('#polStat'));
    await page.click('#polStat .pol-show');
    await page.waitForTimeout(250);
    is(await page.evaluate(() => { const r = document.querySelectorAll('.pol-row')[1]; const b = r.getBoundingClientRect();
         return b.top >= 0 && b.bottom <= innerHeight && r.classList.contains('pol-flash'); }), '"Show it" brings it into view, marked');
    await shot(page, 'policies-3-after-add');

    /* ------------------------------------------------------------------ 3 */
    console.log('\n3. A number among another section\'s policies');
    await page.evaluate(() => document.querySelectorAll('.pol-row')[7].querySelector('.pol-edit').click());   // 8 Lay-by Payments
    await page.waitForSelector('.polw-back.in', { timeout: 5000 }).catch(() => {});
    is(await page.textContent('#polwTitle') === 'Edit policy' && await page.inputValue('#polw_no') === '8' &&
       await page.inputValue('#polw_title') === 'Lay-by Payments' && await where(page) === 'It stays number 8.',
       'Edit opens the same window, with its number', await where(page));
    await page.fill('#polw_no', '1');
    is(await where(page) === 'It will be number 7 (not 1: each section stays together, as on the policies page). Number 7 moves down one.',
       'number 1 is among Returns & Exchanges: the first place in Payments instead, and the window says why', await where(page));
    await page.evaluate(() => window.__writes.length = 0);
    await page.click('.polw-save');
    await page.waitForSelector('.polw-back', { state: 'detached', timeout: 5000 }).catch(() => {});
    await waitList(page, 22);
    l = await list(page);
    wr = await writes(page);
    is(l[6] === '7 Lay-by Payments' && l[7] === '8 Payment Methods' && wr.length === 1 && wr[0].op === 'update' && wr[0].row.sort === 55,
       'saved there: one row, 55, between Delivery Times (50) and Payment Methods (60)', J([l.slice(5, 9), wr]));

    /* ------------------------------------------------------------------ 4 */
    console.log('\n4. No room: every number written again');
    await page.evaluate(() => document.getElementById('polAdd').click());
    await page.waitForSelector('.polw-back.in', { timeout: 5000 }).catch(() => {});
    await page.fill('#polw_title', 'About These Policies');
    await page.fill('#polw_section', 'Returns & Exchanges');
    await page.fill('#polw_no', '1');
    await page.evaluate(() => { window.__writes.length = 0; window.__rpcs.length = 0; });
    await page.click('.polw-save');
    await page.waitForSelector('.polw-back', { state: 'detached', timeout: 5000 }).catch(() => {});
    await waitList(page, 23);
    l = await list(page);
    let d = await db(page);
    let rp = await rpcs(page);
    is(l[0] === '1 About These Policies' && l[1] === '2 Return Policy' && rp.length === 1 && rp[0].p_ids.length === 23,
       'number 1, below 10: the whole order sent in one step (policies_set_order)', J([l.slice(0, 3), rp.length]));
    is(d.slice(0, 4).join(' ') === 'About These Policies:10 Return Policy:20 Gift Wrapping:30 Exchange Policy:40' &&
       d.every((x, i) => Number(x.split(':').pop()) === (i + 1) * 10), 'and the numbers stored are 10, 20, 30 ... in that order', J(d.slice(0, 5)));
    await ctx.close();

    console.log('\n   Before supabase-shopping.sql is run');
    ({ ctx, page } = await open({ policies: SEED, noRpc: true }));
    await page.evaluate(() => document.getElementById('polAdd').click());
    await page.waitForSelector('.polw-back.in', { timeout: 5000 }).catch(() => {});
    await page.fill('#polw_title', 'About These Policies');
    await page.fill('#polw_section', 'Returns & Exchanges');
    await page.fill('#polw_no', '1');
    await page.evaluate(() => { window.__writes.length = 0; });
    await page.click('.polw-save');
    await page.waitForSelector('.polw-back', { state: 'detached', timeout: 5000 }).catch(() => {});
    await waitList(page, 22);
    l = await list(page);
    d = await db(page);
    wr = await writes(page);
    is(l[0] === '1 About These Policies' && d.every((x, i) => Number(x.split(':').pop()) === (i + 1) * 10) &&
       wr.filter(x => x.op === 'update').length === 22 && /added as number 1/.test(await page.textContent('#polStat')),
       'the same result, row by row: the new one, then each that changed', J([l.slice(0, 2), wr.length]));

    /* ------------------------------------------------------------------ 5 */
    console.log('\n5. The arrows');
    await page.evaluate(() => { window.__writes.length = 0; document.querySelectorAll('.pol-row')[1].querySelectorAll('.pol-arrow')[1].click(); });
    await page.waitForFunction(() => /now number 3/.test((document.getElementById('polStat') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
    l = await list(page);
    is(l[1] === '2 Exchange Policy' && l[2] === '3 Return Policy' && /"Return Policy" is now number 3\./.test(await page.textContent('#polStat')),
       'down: Return Policy and Exchange Policy change places', J(l.slice(0, 4)));
    await page.evaluate(() => { const h = Array.from(document.querySelectorAll('.pol-sec-head')).find(x => /Payments/.test(x.textContent));
                                h.querySelector('.pol-arrow').click(); });
    await page.waitForFunction(() => /section moved up/.test((document.getElementById('polStat') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
    is(J((await heads(page)).map(h => h.replace(/ \(.*/, ''))) === J(['Returns & Exchanges', 'Payments', 'Delivery', 'Customer Care']) &&
       (await list(page))[4] === '5 Payment Methods', 'a section\'s up arrow: Payments above Delivery, renumbered', J(await heads(page)));

    /* ------------------------------------------------------------------ 6 */
    console.log('\n6. Delete');
    const before = (await list(page)).length;
    await page.evaluate(() => document.querySelectorAll('.pol-row')[0].querySelector('.pol-del').click());
    await page.waitForSelector('.ask-back', { timeout: 5000 }).catch(() => {});
    is(/The policies after it each move up one/.test(await page.textContent('.ask-back')), 'asked first, saying the numbers after it move up');
    await page.click('.ask-back .btn-danger, .ask-back .ask-row button:last-child');
    await waitList(page, before - 1);
    l = await list(page);
    is(l.length === before - 1 && l[0] === '1 Exchange Policy' && l[l.length - 1].indexOf(String(before - 1) + ' ') === 0,
       'gone, and every number after it moved up one', J(l.slice(0, 3)));
    await ctx.close();

    /* ------------------------------------------------------------------ 7 */
    console.log('\n7. Closing with something typed; a sign-in that may not change policies');
    ({ ctx, page } = await open({ policies: SEED }));
    await page.evaluate(() => document.getElementById('polAdd').click());
    await page.waitForSelector('.polw-back.in', { timeout: 5000 }).catch(() => {});
    await page.fill('#polw_title', 'Half written');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.ask-back', { timeout: 5000 }).catch(() => {});
    is(/Close without saving\?/.test(await page.textContent('.ask-back')), 'Escape with something typed: asked first');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    is(!!(await page.$('.polw-back')) && await page.inputValue('#polw_title') === 'Half written', 'kept: the window and what was typed');
    await page.click('.polw-cancel');
    await page.waitForSelector('.ask-back', { timeout: 5000 }).catch(() => {});
    await page.click('.ask-back .ask-row button:last-child');
    await page.waitForSelector('.polw-back', { state: 'detached', timeout: 5000 }).catch(() => {});
    is(!(await page.$('.polw-back')) && (await list(page)).length === 21, 'Close: gone, nothing added');
    await ctx.close();

    ({ ctx, page } = await open({ policies: SEED, refuse: true }));
    await page.evaluate(() => document.querySelectorAll('.pol-row')[0].querySelector('.pol-edit').click());
    await page.waitForSelector('.polw-back.in', { timeout: 5000 }).catch(() => {});
    await page.fill('#polw_title', 'Return Policy (new words)');
    await page.click('.polw-save');
    await page.waitForSelector('.ask-back', { timeout: 5000 }).catch(() => {});
    is(/This sign-in may not change policies/.test(await page.textContent('.ask-back')), 'refused by the database: said so plainly');
    await page.click('.ask-back .ask-row button:last-child');
    await page.waitForTimeout(250);
    is(!!(await page.$('.polw-back')) && await page.inputValue('#polw_title') === 'Return Policy (new words)' &&
       (await list(page))[0] === '1 Return Policy', 'the window stays, with what was typed; the list unchanged');
    await ctx.close();

    /* ------------------------------------------------------------------ 8 */
    console.log('\n8. On a phone');
    ({ ctx, page } = await open({ policies: SEED }, { width: 390, height: 844 }));
    await page.evaluate(() => window.scrollTo({ top: 900, behavior: 'instant' }));
    await page.evaluate(() => document.getElementById('polAdd').click());
    await page.waitForSelector('.polw-back.in', { timeout: 5000 }).catch(() => {});
    w = await win(page);
    is(w && w.left >= 0 && w.right <= w.vw && w.top >= 0 && w.bottom <= w.vh, 'the window fits the screen', J(w));
    const wide = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth,
      over: Array.from(document.querySelectorAll('body *')).filter(e => { const r = e.getBoundingClientRect(); return r.width && r.right > innerWidth + 1; })
              .map(e => e.tagName + '.' + String(e.className).slice(0, 30) + ' [' + (e.textContent || '').trim().slice(0, 40) + '] in ' + (e.parentElement && (e.parentElement.id || e.parentElement.className)) + ' right ' + Math.round(e.getBoundingClientRect().right)).slice(0, 6) }));
    is(wide.sw <= wide.iw, 'nothing wider than the phone', J(wide));
    await page.fill('#polw_title', 'Gift Wrapping');
    await page.fill('#polw_section', 'Delivery');
    await shot(page, 'policies-4-phone-window');
    await ctx.close();

    /* ------------------------------------------------------------------ 9 */
    console.log('\n9. The policies page, in the same order');
    ({ ctx, page } = await open({ policies: SEED }));
    await page.evaluate(() => document.getElementById('polAdd').click());
    await page.waitForSelector('.polw-back.in', { timeout: 5000 }).catch(() => {});
    await page.fill('#polw_title', 'Gift Wrapping');
    await page.fill('#polw_section', 'Delivery');
    await page.fill('#polw_no', '4');
    await page.click('.polw-save');
    await page.waitForSelector('.polw-back', { state: 'detached', timeout: 5000 }).catch(() => {});
    await waitList(page, 22);
    const adminOrder = (await list(page)).map(x => x.replace(/^\d+ /, ''));
    SHOP_POLICIES = await page.evaluate(() => window.__DB.policies);
    const shop = await ctx.newPage();
    shop.on('pageerror', e => errors.push('shop: ' + String(e.message || e)));
    await shop.goto(base + '/policies', { waitUntil: 'domcontentloaded' });
    await shop.waitForSelector('.pol-item', { timeout: 15000 }).catch(() => {});
    const shopOrder = await shop.evaluate(() => Array.from(document.querySelectorAll('.pol-item summary')).map(s => s.firstChild.textContent));
    is(J(shopOrder) === J(adminOrder) && shopOrder[3] === 'Gift Wrapping', 'the customer sees them in the admin\'s order, Gift Wrapping fourth',
       J([shopOrder.slice(0, 6), adminOrder.slice(0, 6)]));
    await ctx.close();

    is(errors.length === 0, 'no script error', errors.join(' | '));
  } catch (e) {
    failures++;
    console.log('  ✗ the run stopped: ' + (e && e.stack || e));
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failures ? '\n  ✗ ' + failures + ' of ' + checks + ' checks FAILED' : '\n  the policies tab: all ' + checks + ' checks passed');
  process.exit(failures ? 1 : 0);
})();
