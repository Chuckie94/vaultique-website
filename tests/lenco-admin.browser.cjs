/* ===========================================================================
   SETTINGS > PAYMENTS, WITH LENCO (website build 88) -- in a real browser

   The owner: "In settings, add switches to switch each pay gate on and off."
   And the brief: Lenco as a configurable provider, its mode, the ways of
   paying it has activated, its connection, recent transactions, failed and
   pending payments, webhook activity, the check-up, provider errors; and
   Flutterwave shown apart, kept, and off until it is approved.

   The real admin.html, settings-ui.js and payments.js; Supabase and the
   pay-status function are answered here (the harness of
   tests/pay-readiness.browser.cjs, with the payment tables added).

   SHOTS=<folder> keeps a picture of the Lenco section and the activity.
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
const SHOTS = process.env.SHOTS || '';

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
    /* build 88: the payment activity's three tables */
    if (S.tables && S.tables[st.table]) {
      var t = S.tables[st.table];
      if (t.error) return { data: null, error: { message: t.error } };
      return { data: t.rows || [], error: null };
    }
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
      return req.on('end', () => { ASKED.push({ auth: req.headers.authorization || '', body: b });
        json({ test: 'missing', live: 'missing', lencoTest: 'accepted', lencoLive: 'missing' }); });
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
const PAYMENTS = { onlineEnabled: true, onlineMode: 'test', cashEnabled: true, mobileEnabled: false, lencoEnabled: true,
  lencoAirtel: true, lencoMtn: false, lencoZamtel: false, lencoCard: false, flwEnabled: false };


const now = Date.now();
const iso = (ms) => new Date(now - ms).toISOString();
const TABLES = {
  payments: { rows: [
    { created_at: iso(60000), tx_ref: 'VB-AB123-0123456789', provider: 'lenco', method: 'mobile', network: 'airtel', channel: 'mobile-money',
      status: 'started', provider_status: 'pay-offline', amount: 500, currency: 'ZMW', mode: 'test', verified_at: iso(30000), detail: {} },
    { created_at: iso(600000), tx_ref: 'VB-CD456-0123456789', provider: 'lenco', method: 'mobile', network: 'mtn', channel: 'mobile-money',
      status: 'failed', failure_reason: 'Not enough funds', amount: 300, currency: 'ZMW', mode: 'test', detail: { reason: 'failed', provider: 'lenco' } },
    { created_at: iso(900000), tx_ref: 'VB-EF789-0123456789', provider: 'lenco', method: 'card', channel: 'card', status: 'paid',
      provider_ref: '240720004', amount: 1200, currency: 'ZMW', mode: 'live', detail: { lenco_ref: '240720004' } },
    { created_at: iso(1200000), tx_ref: 'VB-EF789-9876543210', provider: 'lenco', method: 'mobile', network: 'airtel', channel: 'mobile-money',
      status: 'review', amount: 1200, currency: 'ZMW', mode: 'live', detail: { duplicate: true, duplicateOf: 'VB-EF789-0123456789' } },
    { created_at: iso(86400000 * 3), tx_ref: 'VB-GH012-0123456789', provider: 'flutterwave', channel: 'card', status: 'paid',
      amount: 450, currency: 'ZMW', mode: 'live', detail: { flw_ref: 'FLW-1' } }] },
  payment_webhooks: { rows: [
    { at: iso(50000), provider: 'lenco', event: 'collection.successful', reference: 'VB-EF789-0123456789', mode: 'live', outcome: 'paid' },
    { at: iso(40000), provider: 'lenco', event: 'collection.failed', reference: 'VB-CD456-0123456789', mode: 'test', outcome: 'failed' }] },
  payment_settings_audit: { rows: [
    { at: iso(20000), by_email: 'owner@example.com', which: 'public', changed: { lencoEnabled: [false, true], lencoAirtel: [null, true] } },
    { at: iso(10000), by_email: 'owner@example.com', which: 'private', changed: ['bankAccountNumber'] }] },
};
const LENCO_READY = { service: true, test: false, live: false, hash: false, formats: true, mode: 'test', methods: [],
  lenco: { test: true, live: false },
  lencoSetup: { test: { secret: true, public: true, base: true, mobile: true, card: true },
                live: { secret: false, public: false, base: true, mobile: false, card: false } },
  lencoDb: true, lencoLastWebhookAt: iso(50000), lencoLastRefusedAt: iso(5000), lencoRefused: 3,
  lencoLastErrorAt: iso(70000), lencoLastError: 'Lenco answered 401: Invalid or missing token (error 09)',
  reconcileAt: iso(120000), reconcile: { checked: 4, paid: 1, failed: 1, repaired: 0, review: 0 },
  testKeyLooksRight: false, liveKeyLooksRight: false, lastWebhookAt: null, lastRefusedAt: null };

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const errors = [];
  async function open(ready, payments, tables) {
    READY = ready; ASKED = []; READ_AUTH = [];
    const ctx = await browser.newContext({ viewport: { width: 390, height: 1400 }, deviceScaleFactor: SHOTS ? 2 : 1 });
    await ctx.addInitScript('window.__SETUP = ' + J({ access: OWNER, pub: { payments: payments || PAYMENTS }, priv: { payments: {} },
                                                      tables: tables || TABLES }) + ';');
    await ctx.route(/\/assets\/vendor\/supabase-js-[0-9.]+\.js(\?.*)?$/, r => r.fulfill({ status: 200, contentType: 'text/javascript', body: SUPA }));
    await ctx.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(String(e.message || e)));
    await page.goto(base + '/admin.html#/settings/payments', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.lenco-ready', { timeout: 15000 }).catch(() => {});
    await page.waitForSelector('.pay-act .pay-act-row, .pay-act .pay-act-empty', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(300);
    return { ctx, page };
  }
  const titles = page => page.evaluate(() => Array.from(document.querySelectorAll('.card > h3, .card h3')).map(h => h.textContent));
  const shown = (page, name) => page.evaluate(n => { const b = document.getElementById('f_' + n); if (!b) return null;
    const w = b.closest('.field'); return !!(w && w.offsetParent !== null); }, name);
  const card = (page, title) => page.evaluate(t => { const c = Array.from(document.querySelectorAll('.card')).find(x => (x.querySelector('h3') || {}).textContent === t);
    return c ? c.innerText : ''; }, title);

  try {
    console.log('\nA switch for each gateway');
    let { ctx, page } = await open(LENCO_READY);
    const t = await titles(page);
    const iO = t.indexOf('Online payment'), iL = t.indexOf('Lenco'), iF = t.indexOf('Flutterwave'), iA = t.indexOf('Payment activity');
    is(iO > -1 && iL > iO && iF > iL && iA > iF, 'Online payment, then Lenco, then Flutterwave, then Payment activity', J(t));
    is(await shown(page, 'lencoEnabled') && await shown(page, 'flwEnabled'), '"Use Lenco" and "Use Flutterwave": a switch each');
    is(await page.isChecked('#f_lencoEnabled') && !(await page.isChecked('#f_flwEnabled')), 'as saved: Lenco on, Flutterwave off');
    is(await shown(page, 'lencoAirtel') && await shown(page, 'lencoMtn') && await shown(page, 'lencoZamtel') && await shown(page, 'lencoCard'),
       'with Lenco on: what Lenco has activated, network by network, and cards');
    const lc = await card(page, 'Lenco');
    is(/Instant Bank Transfer/.test(lc) && /takes cards and mobile money only/.test(lc) && /has no refund/.test(lc),
       'and two plain notes: no bank transfer through Lenco, and refunds are made from the Lenco account', lc.slice(0, 400));
    is(/Kept for when your Flutterwave merchant account is approved/.test(await card(page, 'Flutterwave')),
       'Flutterwave: kept, and said to be for when it is approved');
    await page.click('label.sw-row:has(#f_lencoEnabled)');
    is(!(await shown(page, 'lencoAirtel')), 'Lenco switched off: its ticks are put away');
    await page.click('label.sw-row:has(#f_lencoEnabled)');
    for (const n of ['lencoAirtel']) await page.click('label.sw-row:has(#f_' + n + ')');
    await page.click('text=Save changes');
    await page.waitForTimeout(400);
    const err = await page.evaluate(() => Array.from(document.querySelectorAll('.err-txt')).map(e => e.textContent).filter(Boolean));
    is(err.some(e => /nothing is ticked as activated/.test(e)), 'on with nothing ticked: not saved, and why', J(err));
    await page.click('label.sw-row:has(#f_lencoMtn)');
    await page.click('label.sw-row:has(#f_flwEnabled)');
    await page.click('text=Save changes');
    await page.waitForFunction(() => (window.__writes || []).some(w => w.table === 'site_settings'), null, { timeout: 5000 }).catch(() => {});
    const w = await page.evaluate(() => (window.__writes || []).filter(x => x.table === 'site_settings').map(x => x.row && x.row.data).pop() || null);
    is(w && w.lencoEnabled === true && w.lencoMtn === true && w.lencoAirtel === false && w.flwEnabled === true,
       'saved: each gateway\'s switch and each tick, in the shop\'s public settings (no key among them)', J(w));
    is(w && !/secret|token|FLWSECK|lenco-sandbox/i.test(J(w)), 'and nothing secret is among them', J(w));
    await ctx.close();

    console.log('\nLenco: ready or not, and why');
    ({ ctx, page } = await open(LENCO_READY));
    const ready = await page.evaluate(() => ({
      marks: Array.from(document.querySelectorAll('.lenco-ready > span')).map(x => x.className + ':' + x.textContent),
      notes: Array.from(document.querySelectorAll('.lenco-ready .lenco-ready-note')).map(n => ({ text: n.textContent.trim(), warn: n.classList.contains('lenco-ready-warn') }))
    }));
    is(ready.marks.indexOf('ok:✓ Sandbox API token') > -1 && ready.marks.indexOf('no:✕ Live API token') > -1 &&
       ready.marks.indexOf('ok:✓ Database (supabase-lenco.sql)') > -1,
       'a tick or a cross for each key and for the database file, never a value', J(ready.marks));
    is(/Ready for Test payments only/.test(ready.notes[0].text), 'in words: ready for Test payments only, and what Live needs', J(ready.notes[0]));
    is(ready.notes.some(n => /lenco-webhook$/.test(n.text) && n.text.indexOf(base + '/.netlify/functions/lenco-webhook') > -1),
       'the webhook address to give Lenco, written out', J(ready.notes));
    is(ready.notes.some(n => n.warn && /without a valid signature/.test(n.text) && /\(3 so far\)/.test(n.text)),
       'unsigned calls to the webhook, counted, as a warning', J(ready.notes));
    is(ready.notes.some(n => n.warn && /Lenco’s last error/.test(n.text) && /401/.test(n.text)), 'Lenco\'s last error, with when', J(ready.notes));
    await page.click('.lenco-ready button:has-text("Check the keys with Lenco")');
    await page.waitForFunction(() => /Sandbox token:/.test((document.querySelector('.lenco-key-said') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
    const said = await page.textContent('.lenco-key-said');
    is(/Sandbox token: accepted ✓/.test(said) && /Live token: not installed/.test(said), 'asking Lenco about the tokens, in words: "' + said.trim() + '"');
    is(ASKED.length === 1 && ASKED[0].auth === 'Bearer t' && /test-keys/.test(ASKED[0].body), 'asked with the administrator\'s own sign-in', J(ASKED));
    is(await page.$('.pay-ready') !== null && /Flutterwave/.test(await page.evaluate(() => document.querySelector('.pay-ready').closest('.card').querySelector('h3').textContent)),
       'Flutterwave\'s own readiness line is in Flutterwave\'s section');
    if (SHOTS) {
      await page.locator('.card').filter({ has: page.locator('h3', { hasText: /^Lenco$/ }) }).first().screenshot({ path: path.join(SHOTS, '7-admin-lenco.png') });
    }

    console.log('\nPayment activity');
    const tabs = await page.$$eval('.pay-act-tab', bs => bs.map(b => b.textContent));
    is(J(tabs) === J(['Recent', 'Waiting', 'Failed', 'Needs attention', 'Notices', 'Check-up & errors', 'Changes']),
       'seven views: recent, waiting, failed, needing attention, notices, the check-up and errors, changes', J(tabs));
    const rows = () => page.$$eval('.pay-act-list .pay-act-row, .pay-act-list .pay-act-empty', rs => rs.map(r => r.innerText.replace(/\s+/g, ' ').trim()));
    let r = await rows();
    is(r.length === 5 && /VB-AB123 · ZMW 500.00 · Mobile Money · Airtel Money · Lenco · TEST/.test(r[0]) && /Waiting for approval on the phone/.test(r[0]),
       'recent: each payment with its order, amount, way of paying, network, gateway and where it is', J(r[0]));
    is(r.some(x => /Flutterwave/.test(x) && /Paid/.test(x)), 'Flutterwave\'s payments are listed with Lenco\'s', J(r));
    if (SHOTS) await page.locator('.pay-act').screenshot({ path: path.join(SHOTS, '8-admin-activity.png') });
    await page.click('.pay-act-tab:has-text("Failed")');
    r = await rows();
    is(r.length === 1 && /Failed · Not enough funds/.test(r[0]), 'failed: with Lenco\'s own reason', J(r));
    await page.click('.pay-act-tab:has-text("Waiting")');
    r = await rows();
    is(r.length === 1 && /VB-AB123/.test(r[0]), 'waiting: the one still on a customer\'s phone', J(r));
    await page.click('.pay-act-tab:has-text("Needs attention")');
    r = await rows();
    is(r.length === 1 && /Paid twice: refund one/.test(r[0]), 'needing attention: a second payment, to refund', J(r));
    await page.click('.pay-act-tab:has-text("Notices")');
    r = await rows();
    is(r.length === 2 && /collection.successful/.test(r[0]) && /the site asked Lenco: paid/.test(r[0]), 'notices: each of Lenco\'s, and what the site did', J(r));
    await page.click('.pay-act-tab:has-text("Check-up")');
    r = await rows();
    is(/check-up last ran/.test(r[0]) && /Asked about 4, found paid 1, failed 1/.test(r[0]) && r.some(x => /401/.test(x)) && r.some(x => /Unsigned calls to the Lenco webhook: 3/.test(x)),
       'the check-up\'s last run, and the gateways\' errors', J(r));
    await page.click('.pay-act-tab:has-text("Changes")');
    r = await rows();
    is(/owner@example.com/.test(r[0]) && /lencoEnabled: false → true/.test(r[0]) && /Private details changed: bankAccountNumber/.test(r[1]),
       'changes: who changed what, from what to what; private details by name only', J(r));
    await ctx.close();

    console.log('\nBefore supabase-lenco.sql');
    ({ ctx, page } = await open(Object.assign({}, LENCO_READY, { lencoDb: false }), PAYMENTS,
      { payments: { rows: [] }, payment_webhooks: { error: 'relation "payment_webhooks" does not exist' },
        payment_settings_audit: { error: 'relation "payment_settings_audit" does not exist' } }));
    const n0 = await page.evaluate(() => Array.from(document.querySelectorAll('.lenco-ready .lenco-ready-note')).map(n => n.textContent)[0] || '');
    is(/Not ready: run supabase-lenco.sql/.test(n0), 'Lenco says to run supabase-lenco.sql', n0);
    await page.click('.pay-act-tab:has-text("Notices")');
    is(/once supabase-lenco.sql has been run/.test((await rows())[0] || ''), 'and the activity says the record starts with it');
    await ctx.close();

    is(errors.length === 0, 'no script error anywhere', errors.slice(0, 3).join(' | '));
  } catch (e) {
    fail('threw: ' + (e && e.stack || e));
  } finally {
    await browser.close();
    server.close();
  }
  console.log('\n' + (failures ? '  ✗ ' + failures + ' of ' + checks + ' checks FAILED'
                               : '  Settings > Payments, with Lenco: all ' + checks + ' checks passed'));
  process.exit(failures ? 1 : 0);
})();
