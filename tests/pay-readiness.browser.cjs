/* ===========================================================================
   SETTINGS > PAYMENTS: IS ONLINE PAYMENT READY? -- in a real browser

   THE OWNER: "Fix it so that when I connect payment gate it will be
   flawless." Connecting is pasting three keys and a phrase into Netlify and
   Flutterwave. The likeliest slips: the public key pasted instead of the
   secret one, and a webhook hash typed differently in the two places. The
   line at the top of Online payment now says so, says when Flutterwave last
   reached the site, and can ask Flutterwave whether it accepts the keys.

   The real admin.html, settings-ui.js and payments.js; Supabase and the
   pay-status function are answered here.
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

let READY = {};
let ASKED = [], READ_AUTH = [];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
let base = '';
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), p = u.pathname;
  const json = o => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (p === '/.netlify/functions/pay-status') {
    if (req.method === 'POST') {
      let b = ''; req.on('data', c => b += c);
      return req.on('end', () => { ASKED.push({ auth: req.headers.authorization || '', body: b }); json({ test: 'accepted', live: 'missing' }); });
    }
    READ_AUTH.push(req.headers.authorization || '');
    return json(READY);
  }
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

const OWNER = { is_admin: true, is_owner: true, active: true, must_change_password: false };
const PAYMENTS = { onlineEnabled: true, onlineMode: 'test', cashEnabled: true, mobileEnabled: false };

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const errors = [];
  async function open(ready) {
    READY = ready; ASKED = []; READ_AUTH = [];
    const ctx = await browser.newContext({ viewport: { width: 390, height: 1400 } });
    await ctx.addInitScript('window.__SETUP = ' + J({ access: OWNER, pub: { payments: PAYMENTS }, priv: { payments: {} } }) + ';');
    await ctx.route('**/cdn.jsdelivr.net/**', r => {
      if (/supabase-js/.test(r.request().url())) return r.fulfill({ status: 200, contentType: 'text/javascript', body: SUPA });
      return r.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
    });
    // Website 80: the admin loads its own copy of supabase-js (build 79's line
    // keeps it in assets/vendor), so the stand-in answers there as well.
    await ctx.route(/\/assets\/vendor\/supabase-js-[0-9.]+\.js(\?.*)?$/, r => r.fulfill({ status: 200, contentType: 'text/javascript', body: SUPA }));
    await ctx.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await ctx.route('**/cdnjs.cloudflare.com/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(String(e.message || e)));
    await page.goto(base + '/admin.html#/settings/payments', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.pay-ready .pay-ready-note', { timeout: 15000 });
    await page.waitForTimeout(300);
    return { ctx, page };
  }
  const lines = page => page.evaluate(() => Array.from(document.querySelectorAll('.pay-ready .pay-ready-note'))
    .map(n => ({ text: n.textContent.trim(), warn: n.classList.contains('pay-ready-warn') })));

  try {
    console.log('\nThe public key pasted instead of the secret one, and a hash typed differently');
    let { ctx, page } = await open({ service: true, test: true, live: false, hash: true, formats: true,
      testKeyLooksRight: false, liveKeyLooksRight: false,
      lastWebhookAt: '2026-11-14T08:00:00Z', lastRefusedAt: '2026-11-14T09:30:00Z' });
    let l = await lines(page);
    is(l.some(x => x.warn && /test key does not look like a Flutterwave secret key/.test(x.text) && /FLWSECK_TEST-/.test(x.text)),
       'the line says the test key is not a secret key, and what one starts with', J(l));
    const marks = await page.evaluate(() => Array.from(document.querySelectorAll('.pay-ready > span')).map(x => x.className + ':' + x.textContent));
    is(marks.indexOf('no:\u2715 Flutterwave test key') > -1 && /Almost: a key needs another look/.test(l[0].text),
       'with a cross, not a tick, beside that key, and "Almost", not "Ready"', J([marks, l[0]]));
    is(l.some(x => !x.warn && /last reached the webhook/.test(x.text)) &&
       l.some(x => x.warn && /secret hash that does not match/.test(x.text) && /FLW_WEBHOOK_HASH/.test(x.text)),
       'when Flutterwave last got through, and that a later webhook came with the wrong hash', J(l));
    is(READ_AUTH.length >= 1 && READ_AUTH.every(a => a === 'Bearer t'),
       'the setup is asked about with the administrator\'s sign-in: the webhook times are told to the shop only', J(READ_AUTH));
    if (process.env.SHOT) {
      const c = page.locator('.card').filter({ hasText: 'Online payment' }).first();
      await c.screenshot({ path: process.env.SHOT });
    }

    console.log('\nChecking the keys with Flutterwave');
    await page.click('.pay-ready button:has-text("Check the keys with Flutterwave")');
    await page.waitForFunction(() => /Test key:/.test((document.querySelector('.pay-key-said') || {}).textContent || ''), null, { timeout: 10000 });
    const said = await page.textContent('.pay-key-said');
    is(/Test key: accepted ✓/.test(said) && /Live key: not installed/.test(said), 'it answers in words: "' + said.trim() + '"');
    is(ASKED.length === 1 && ASKED[0].auth === 'Bearer t' && /test-keys/.test(ASKED[0].body),
       'asking with the administrator\'s own sign-in, which the server checks', J(ASKED));
    await ctx.close();

    console.log('\nAll set up and working');
    ({ ctx, page } = await open({ service: true, test: true, live: true, hash: true, formats: true,
      testKeyLooksRight: true, liveKeyLooksRight: true, lastWebhookAt: '2026-11-14T10:00:00Z', lastRefusedAt: null }));
    l = await lines(page);
    is(!l.some(x => x.warn) && /Ready/.test(l[0].text), 'no warnings, just Ready and when the webhook last came', J(l));
    await ctx.close();

    console.log('\nWhen the server was not told who is asking');
    ({ ctx, page } = await open({ service: true, test: true, live: false, hash: true, formats: true }));
    l = await lines(page);
    is(/Ready/.test(l[0].text) && !l.some(x => /webhook/i.test(x.text)),
       'Ready, and nothing about the webhook, rather than a wrong "no webhook yet"', J(l));
    await ctx.close();

    console.log('\nNot connected yet');
    ({ ctx, page } = await open({ service: true, test: false, live: false, hash: false, formats: true,
      testKeyLooksRight: false, liveKeyLooksRight: false, lastWebhookAt: null, lastRefusedAt: null }));
    l = await lines(page);
    const button = await page.$('.pay-ready button');
    is(/Not ready yet/.test(l[0].text) && !l.some(x => x.warn) && !button,
       'it says what is missing, with no key warnings and nothing to check yet', J(l));
    await ctx.close();

    is(errors.length === 0, 'no script error anywhere', errors.slice(0, 3).join(' | '));
  } catch (e) {
    fail('threw', e && e.stack);
  }
  await browser.close();
  server.close();
  console.log(failures ? '\n  ✗ ' + failures + ' of ' + checks + ' checks FAILED'
                       : '\n  payment readiness: all ' + checks + ' checks passed');
  process.exit(failures ? 1 : 0);
})();
