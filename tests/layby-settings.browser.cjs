/* ===========================================================================
   THE LAYBY SETTINGS -- Admin > Settings > Payments, in a real browser

   THE OWNER: "Layby Deposit Percentage: Default to 30%, but allow an
   authorised administrator to change it ... Validate that the percentage is
   greater than 0% and no more than 100%, and validate that the payment
   duration is a valid positive number of months."

   The real admin.html, settings-ui.js, settings-store.js and payments.js.
   Supabase is a stand-in that keeps the shop's settings rows in memory and
   records every write, so what is checked is exactly what would reach the
   database: the defaults, every refusal, the save itself, the same figures
   read back on another device, and who is allowed to get as far as the page.
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

/* supabase-js, as far as the admin uses it. window.__SETUP (per browser) says
   who is signed in, what the database already holds and whether it refuses. */
const SUPA = `
(function () {
  var S = window.__SETUP || {};
  var DB = { site_settings: S.pub || {}, site_settings_private: S.priv || {} };
  window.__writes = [];
  function answer(st) {
    if (st.table === 'admins') return { data: [{ id: 'u1' }], error: null };
    if (st.table === 'site_settings' || st.table === 'site_settings_private') {
      var rows = DB[st.table];
      if (st.op === 'upsert') {
        window.__writes.push({ table: st.table, row: JSON.parse(JSON.stringify(st.row)) });
        if (S.refuse) return { data: null, error: { message: 'new row violates row-level security policy for table "' + st.table + '"' } };
        rows[st.row.key] = st.row.data;
        return { data: null, error: null };
      }
      if (st.key) return { data: rows[st.key] ? { data: rows[st.key] } : null, error: null };
      return { data: Object.keys(rows).map(function (k) { return { key: k, data: rows[k] }; }), error: null };
    }
    if (st.op !== 'select') window.__writes.push({ table: st.table, op: st.op });
    return { data: st.one ? null : [], error: null, count: 0 };
  }
  function from(table) {
    var st = { table: table, op: 'select', key: null, row: null, one: false };
    var b = {};
    ['select','neq','gt','gte','lt','lte','order','limit','range','in','is','or','not','ilike','like','match','filter','contains']
      .forEach(function (k) { b[k] = function () { return b; }; });
    b.eq = function (col, val) { if (col === 'key') st.key = val; return b; };
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
        mfa: {
          getAuthenticatorAssuranceLevel: function () { return Promise.resolve({ data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null }); },
          listFactors: function () { return Promise.resolve({ data: { totp: [], all: [] }, error: null }); }
        }
      },
      from: from,
      rpc: function (n) {
        var r = n === 'my_access' ? { data: S.access, error: null } : { data: null, error: null };
        var t = from('rpc'); t.then = function (ok, bad) { return Promise.resolve(r).then(ok, bad); }; return t;
      },
      channel: function () { var ch = { on: function () { return ch; }, subscribe: function () { return ch; } }; return ch; },
      removeChannel: function () {},
      storage: { from: function () { return { list: function () { return Promise.resolve({ data: [] }); },
        getPublicUrl: function () { return { data: { publicUrl: '' } }; } }; } }
    };
  } };
})();`;

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
let base = '';
const server = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  const json = o => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (p === '/api/products') return json({ products: [], version: 't' });
  if (p.startsWith('/web/')) return json([]);
  if (p.startsWith('/.netlify/functions/')) return json({});
  if (p === '/config.js') {
    res.writeHead(200, { 'Content-Type': TYPES['.js'] });
    return res.end('window.VBP_CONFIG={SUPABASE_URL:"' + base + '/web",SUPABASE_ANON_KEY:"anon"};');
  }
  let file = path.join(ROOT, p === '/' ? 'index.html' : p);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});

/* What a shop already has in Settings > Payments before the estimate. */
const BEFORE = { cashEnabled: true, cashName: 'Cash', bankEnabled: true, mobileEnabled: true, cardEnabled: false, codEnabled: false };
const PRIVATE = { mobileAccounts: [{ provider: 'Airtel Money', number: '+260 97 1234567', name: 'Vaultique' }] };
const OWNER = { is_admin: true, is_owner: true, active: true, must_change_password: false };

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const errors = [];

  async function open(setup, viewport) {
    const ctx = await browser.newContext({ viewport: viewport || { width: 1100, height: 1400 } });
    await ctx.addInitScript('window.__SETUP = ' + J(setup) + ';');
    await ctx.route('**/cdn.jsdelivr.net/**', r => {
      if (/supabase-js/.test(r.request().url())) return r.fulfill({ status: 200, contentType: 'text/javascript', body: SUPA });
      return r.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
    });
    await ctx.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await ctx.route('**/cdnjs.cloudflare.com/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(String(e.message || e)));
    await page.goto(base + '/admin.html#/settings/payments', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    return { ctx, page };
  }
  const val = (page, id) => page.evaluate(i => { const e = document.getElementById(i); return e ? e.value : null; }, id);
  const errOf = (page, id) => page.evaluate(i => {
    const e = document.getElementById(i);
    const f = e && e.closest('.field');
    return f ? (f.querySelector('.err-txt') || {}).textContent || '' : null;
  }, id);
  const status = page => page.evaluate(() => (document.querySelector('.save-bar .stat') || {}).textContent || '');
  const writes = page => page.evaluate(() => window.__writes);
  async function saveWith(page, deposit, months) {
    await page.fill('#f_laybyDeposit', String(deposit));
    await page.fill('#f_laybyMonths', String(months));
    await page.click('.save-bar .btn-gold');
    await page.waitForTimeout(400);
  }

  try {
    /* ================================================================== */
    console.log('\nThe owner opens Settings > Payments');
    let { ctx, page } = await open({ access: OWNER, pub: { payments: BEFORE }, priv: { payments: PRIVATE } });
    const card = await page.evaluate(() => {
      const c = Array.from(document.querySelectorAll('.card')).find(x => /Layby estimate/.test((x.querySelector('h3') || {}).textContent || ''));
      if (!c) return null;
      const lab = id => { const l = c.querySelector('label[for="' + id + '"]'); return l ? l.textContent.trim() : ''; };
      return { note: (c.querySelector('.grp-note') || {}).textContent || '', dep: lab('f_laybyDeposit'), mon: lab('f_laybyMonths'),
               private: !!c.closest('.shut') || /Not sent to the website/.test(c.textContent) };
    });
    is(card && card.dep === 'Layby deposit percentage *' && card.mon === 'Layby payment duration *',
       'a "Layby estimate" card with the two settings, both required', J(card));
    is(card && /estimate only/.test(card.note) && /does not start a layby/.test(card.note) && !card.private,
       'saying it is display only, on the public side of the page (the product page reads it)', J(card));
    is(await val(page, 'f_laybyDeposit') === '30' && await val(page, 'f_laybyMonths') === '6',
       'never saved before: 30% and 6 months to start from');

    /* ================================================================== */
    console.log('\nWhat it will not save');
    const refusals = [
      ['f_laybyDeposit', '0', 6, /more than 0%/],
      ['f_laybyDeposit', '-10', 6, /more than 0%/],
      ['f_laybyDeposit', '100.5', 6, /cannot be more than 100%/],
      ['f_laybyDeposit', '150', 6, /cannot be more than 100%/],
      ['f_laybyDeposit', '12.555', 6, /two decimal places/],
      ['f_laybyDeposit', 'thirty', 6, /Enter a number/],
      ['f_laybyDeposit', '', 6, /cannot be left blank/],
      ['f_laybyMonths', 30, '0', /whole number of months/],
      ['f_laybyMonths', 30, '-2', /whole number of months/],
      ['f_laybyMonths', 30, '2.5', /whole number of months/],
      ['f_laybyMonths', 30, '121', /more than 120/],
      ['f_laybyMonths', 30, 'six', /Enter a number/],
      ['f_laybyMonths', 30, '', /cannot be left blank/]
    ];
    for (const [id, d, m, want] of refusals) {
      await saveWith(page, d, m);
      const said = await errOf(page, id);
      is(want.test(said) && /fix the highlighted/.test(await status(page)),
         (id === 'f_laybyDeposit' ? 'a deposit of "' + d + '"' : 'a duration of "' + m + '"') + ': "' + said + '"', said);
    }
    /* Opening the admin notes which build is running (Settings > System),
       as it always has. Only the Payments rows are this page's. */
    const toPayments = (await writes(page)).filter(x => x.row && x.row.key === 'payments');
    is(toPayments.length === 0, 'and not one of those reached the database', J(toPayments));

    /* ================================================================== */
    console.log('\nWhat it saves');
    await saveWith(page, '25', '12');
    let w = await writes(page);
    const pub = w.filter(x => x.table === 'site_settings').pop();
    const priv = w.filter(x => x.table === 'site_settings_private').pop();
    is(/Saved/.test(await status(page)) && pub && pub.row.key === 'payments' &&
       pub.row.data.laybyDeposit === 25 && pub.row.data.laybyMonths === 12,
       '25% and 12 months go into the Payments row, as numbers', J(pub && pub.row.data));
    is(pub && pub.row.data.cashName === 'Cash' && pub.row.data.cashEnabled === true && !('mobileAccounts' in pub.row.data) &&
       priv && J(priv.row.data.mobileAccounts) === J(PRIVATE.mobileAccounts),
       'beside everything else on the page, unchanged, with the private details still in their own table');
    const saved = pub && pub.row.data;
    await ctx.close();

    for (const [d, m] of [['100', '1'], ['12.5', '120'], ['0.5', '3']]) {
      ({ ctx, page } = await open({ access: OWNER, pub: { payments: BEFORE }, priv: { payments: PRIVATE } }));
      await saveWith(page, d, m);
      w = (await writes(page)).filter(x => x.table === 'site_settings').pop();
      is(w && w.row.data.laybyDeposit === Number(d) && w.row.data.laybyMonths === Number(m),
         d + '% over ' + m + (m === '1' ? ' month' : ' months') + ' is accepted', J(w && w.row.data));
      await ctx.close();
    }

    /* ================================================================== */
    console.log('\nThe same figures on another device');
    ({ ctx, page } = await open({ access: OWNER, pub: { payments: saved }, priv: { payments: PRIVATE } }, { width: 390, height: 900 }));
    is(await val(page, 'f_laybyDeposit') === '25' && await val(page, 'f_laybyMonths') === '12',
       'read back from the database, not the browser: 25 and 12 on a phone that never saw them typed');
    await ctx.close();
    if (process.env.SHOT_DIR) {
      ({ ctx, page } = await open({ access: OWNER, pub: { payments: BEFORE }, priv: { payments: PRIVATE } }, { width: 390, height: 900 }));
      const c = page.locator('.card').filter({ hasText: 'Layby estimate' }).first();
      await c.screenshot({ path: path.join(process.env.SHOT_DIR, 'layby-settings-phone.png') });
      await ctx.close();
    }

    /* ================================================================== */
    console.log('\nWho can change them');
    ({ ctx, page } = await open({ access: { is_admin: true, is_owner: false, active: true, permissions: { orders: true, products: true } },
                                  pub: { payments: saved }, priv: { payments: PRIVATE } }));
    let seen = await page.evaluate(() => ({
      tab: Array.from(document.querySelectorAll('.tab')).filter(t => t.getAttribute('data-tab') === 'settings' && t.offsetParent !== null).length,
      form: !!document.getElementById('f_laybyDeposit')
    }));
    is(seen.tab === 0 && !seen.form, 'staff whose role has no Settings tick: no Settings tab, and the address alone does not open it', J(seen));
    await ctx.close();
    ({ ctx, page } = await open({ access: { is_admin: true, is_owner: false, active: true, permissions: { settings: true } },
                                  pub: { payments: saved }, priv: { payments: PRIVATE } }));
    await saveWith(page, '35', '4');
    w = (await writes(page)).filter(x => x.table === 'site_settings').pop();
    is(w && w.row.data.laybyDeposit === 35 && w.row.data.laybyMonths === 4,
       'staff whose role has Settings ticked can, like the owner', J(w && w.row.data));
    await ctx.close();
    ({ ctx, page } = await open({ access: OWNER, refuse: true, pub: { payments: saved }, priv: { payments: PRIVATE } }));
    await saveWith(page, '45', '3');
    is(/Could not save|Half of this saved/.test(await status(page)) && /row-level security/.test(await status(page)),
       'and when the database refuses (anybody not an administrator), the page says so: "' + (await status(page)).slice(0, 70) + '…"');
    await ctx.close();

    is(errors.length === 0, 'no script error anywhere', errors.slice(0, 3).join(' | '));
  } catch (e) {
    fail('threw', e && e.stack);
  }
  await browser.close();
  server.close();
  console.log(failures ? '\n  ✗ ' + failures + ' of ' + checks + ' checks FAILED'
                       : '\n  layby settings: all ' + checks + ' checks passed');
  process.exit(failures ? 1 : 0);
})();
