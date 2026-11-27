/* ===========================================================================
   ADMIN > FRAUD & RISK, AND ITS SETTINGS (website build 91) -- in a real browser

   The real admin.html, shell.js, risk.js, settings-ui.js and
   settings/risk.js; Supabase and risk-release are answered here (the harness
   of tests/lenco-admin.browser.cjs, with the fraud check's questions added).

     - the page: what the check is doing (watching, day n of 14), the totals,
       the spread of scores, the cases per day with a legend and every figure,
       the cases waiting, the latest cases, and the sealed record's check
     - Approve, Reject and Escalate, asked in the admin's own dialog; a held
       payment approved is released through risk-release, with the sign-in
     - not set up, or a sign-in without the right: said plainly
     - Settings > Fraud & Risk: every value private (never in the public row,
       never a value in the activity log), the levels kept rising
     - a phone's width: nothing wider than the screen

   SHOTS=<folder> keeps pictures of the page and the settings.
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
  window.__rpc = [];
  function answer(st) {
    if (st.table === 'admins') return { data: [{ id: 'u1' }], error: null };
    if (st.table === 'site_settings' || st.table === 'site_settings_private') {
      var rows = DB[st.table];
      if (st.op === 'upsert') {
        window.__writes.push({ table: st.table, row: JSON.parse(JSON.stringify(st.row)) });
        rows[st.row.key] = st.row.data;
        return { data: null, error: null };
      }
      if (st.key) return { data: rows[st.key] ? { data: rows[st.key] } : null, error: null };
      return { data: Object.keys(rows).map(function (k) { return { key: k, data: rows[k] }; }), error: null };
    }
    if (st.op !== 'select') window.__writes.push({ table: st.table, op: st.op, row: st.row ? JSON.parse(JSON.stringify(st.row)) : null });
    if (st.table === 'risk_cases') {
      if (S.missing) return { data: null, error: { message: 'relation "public.risk_cases" does not exist' } };
      var all = S.cases || [];
      return { data: st.open ? all.filter(function (c) { return c.review_state === 'open' || c.review_state === 'escalated'; }) : all, error: null };
    }
    return { data: st.one ? null : [], error: null, count: 0 };
  }
  function from(table) {
    var st = { table: table, op: 'select', key: null, row: null, one: false, open: false };
    var b = {};
    ['select','neq','gt','gte','lt','lte','order','limit','range','is','or','not','ilike','like','match','filter','contains']
      .forEach(function (k) { b[k] = function () { return b; }; });
    b.in = function (col) { if (col === 'review_state') st.open = true; return b; };
    b.eq = function (col, val) { if (col === 'key') st.key = val; return b; };
    b.single = b.maybeSingle = function () { st.one = true; return b; };
    b.upsert = function (row) { st.op = 'upsert'; st.row = row; return b; };
    b.insert = function (row) { st.op = 'insert'; st.row = row; return b; };
    b.update = function (row) { st.op = 'update'; st.row = row; return b; };
    b.delete = function () { st.op = 'delete'; return b; };
    b.then = function (ok, bad) { return Promise.resolve(answer(st)).then(ok, bad); };
    return b;
  }
  function rpcAnswer(n, a) {
    window.__rpc.push([n, a]);
    if (n === 'my_access') return { data: S.access, error: null };
    if (n === 'risk_summary') {
      if (S.missing) return { data: null, error: { message: 'Could not find the function public.risk_summary(p_days) in the schema cache' } };
      if (S.refused) return { data: { ok: false, why: 'not_allowed' }, error: null };
      return { data: Object.assign({}, S.summary, { days: a.p_days }), error: null };
    }
    if (n === 'risk_decide') {
      var c = (S.cases || []).filter(function (x) { return x.id === a.p_id; })[0];
      if (!c) return { data: { ok: false, why: 'not_found' }, error: null };
      if (a.p_decision === 'reject' && !a.p_note) return { data: { ok: false, why: 'say_why' }, error: null };
      c.review_state = { approve: 'approved', reject: 'rejected', escalate: 'escalated' }[a.p_decision];
      return { data: { ok: true, state: c.review_state, release: a.p_decision === 'approve' && c.action === 'held' && c.moment === 'payment_paid' }, error: null };
    }
    if (n === 'audit_verify') return { data: S.verify || { ok: true, checked: 1204, entries: 1204, lastAt: '2026-11-27T00:10:00Z', anchors: 9 }, error: null };
    return { data: null, error: null };
  }
  window.supabase = { createClient: function () {
    var session = { access_token: 'owner-session-token', user: { id: 'u1', email: 'owner@example.com', email_confirmed_at: 'x' } };
    return {
      auth: {
        getSession: function () { return Promise.resolve({ data: { session: session } }); },
        getUser: function () { return Promise.resolve({ data: { user: session.user } }); },
        onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
        signOut: function () { return Promise.resolve({ error: null }); },
        mfa: {
          getAuthenticatorAssuranceLevel: function () { return Promise.resolve({ data: { currentLevel: 'aal2', nextLevel: 'aal2' }, error: null }); },
          listFactors: function () { return Promise.resolve({ data: { totp: [], all: [] }, error: null }); }
        }
      },
      from: from,
      rpc: function (n, a) { var r = rpcAnswer(n, a || {}); var t = from('rpc'); t.then = function (ok, bad) { return Promise.resolve(r).then(ok, bad); }; return t; },
      channel: function () { var ch = { on: function () { return ch; }, subscribe: function () { return ch; } }; return ch; },
      removeChannel: function () {},
      storage: { from: function () { return { list: function () { return Promise.resolve({ data: [] }); },
        getPublicUrl: function () { return { data: { publicUrl: '' } }; } }; } }
    };
  } };
  window.NATIVE = [];
  window.confirm = function (m) { window.NATIVE.push('confirm: ' + m); return true; };
  window.alert = function (m) { window.NATIVE.push('alert: ' + m); };
  window.prompt = function (m) { window.NATIVE.push('prompt: ' + m); return 'x'; };
})();`;

let RELEASED = [];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
let base = '';
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), p = u.pathname;
  const json = (o, code) => { res.writeHead(code || 200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (p === '/.netlify/functions/risk-release') {
    let b = ''; req.on('data', c => b += c);
    return req.on('end', () => { RELEASED.push({ auth: req.headers.authorization || '', body: JSON.parse(b || '{}') }); json({ status: 'paid' }); });
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
const now = Date.now();
const iso = (ms) => new Date(now - ms).toISOString();
const DAY = (d) => new Date(now - d * 86400000).toISOString().slice(0, 10);
const SUMMARY = {
  ok: true, mode: 'watch', assessed: 42, levels: { low: 30, medium: 7, high: 4, critical: 1 }, held: 0, refused: 0,
  wouldHold: 3, wouldRefuse: 1, open: 2, failedPayments: 9, duplicateAttempts: 5, paidTwice: 1, released: 0,
  histogram: [20, 10, 3, 4, 1, 0, 2, 1, 0, 1], record: { entries: 1204, lastAt: iso(60000) }, watchSince: iso(3 * 86400000 + 3600000),
  refunds: { count: 2, amount: 750 },
  trend: [6, 5, 4, 3, 2, 1, 0].map((d, i) => ({ day: DAY(d), low: 4 + i, medium: i % 3, high: i === 3 ? 2 : 0, critical: i === 5 ? 1 : 0 })),
};
const CASES = [
  { id: '9f0c2b1e-0000-4000-8000-000000000001', at: iso(600000), moment: 'payment_paid', order_ref: 'VB-HX231', tx_ref: 'VB-HX231-0123456789',
    score: 80, level: 'high', mode: 'act', action: 'held', would: 'held', review_state: 'open',
    reasons: [{ signal: 'ordersPhone', points: 30, said: '6 orders from this phone number in a day' },
              { signal: 'failedPayments', points: 30, said: '6 failed payments from this phone number in a day' },
              { signal: 'emailOdd', points: 20, said: 'the email address is a throwaway one (mailinator.com)' }] },
  { id: '9f0c2b1e-0000-4000-8000-000000000002', at: iso(1200000), moment: 'payment_start', order_ref: 'VB-KQ552', tx_ref: 'VB-KQ552-0123456789',
    score: 90, level: 'critical', mode: 'watch', action: 'none', would: 'refused', review_state: 'open',
    reasons: [{ signal: 'ordersEmail', points: 30, said: '6 orders from this email address in a day' },
              { signal: 'ordersPhone', points: 30, said: '6 orders from this phone number in a day' },
              { signal: 'failedPayments', points: 30, said: '6 failed payments from this phone number in a day' }] },
  { id: '9f0c2b1e-0000-4000-8000-000000000003', at: iso(2400000), moment: 'order_placed', order_ref: 'VB-PL100',
    score: 30, level: 'medium', mode: 'watch', action: 'none', would: 'shown', review_state: 'none',
    reasons: [{ signal: 'phoneOdd', points: 20, said: 'the phone number does not look real' }, { signal: 'ordersAccount', points: 10, said: '3 orders from this account in a day' }] },
];

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const errors = [];
  async function open(hash, setup, size) {
    RELEASED = [];
    const ctx = await browser.newContext({ viewport: size || { width: 1100, height: 1400 }, deviceScaleFactor: SHOTS ? 2 : 1 });
    await ctx.addInitScript('window.__SETUP = ' + J(Object.assign({ access: OWNER, pub: {}, priv: {}, summary: SUMMARY,
                                                                    cases: JSON.parse(J(CASES)) }, setup || {})) + ';');
    await ctx.route(/\/assets\/vendor\/supabase-js-[0-9.]+\.js(\?.*)?$/, r => r.fulfill({ status: 200, contentType: 'text/javascript', body: SUPA }));
    await ctx.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(String(e.message || e)));
    await page.goto(base + '/admin.html' + hash, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    return { ctx, page };
  }
  const text = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); return e ? e.innerText.replace(/\s+/g, ' ') : ''; }, sel);

  try {
    console.log('\nThe page');
    let { ctx, page } = await open('#/risk');
    const tab = await page.evaluate(() => { const t = document.querySelector('.tab[data-tab="risk"]'); return t ? t.textContent + '|' + t.classList.contains('active') : ''; });
    is(tab === 'Fraud & Risk|true', 'a tab of its own, Fraud & Risk, open at #/risk', tab);
    await page.waitForSelector('.rk-case', { timeout: 8000 });
    const all = await text(page, '#tab-risk');
    is(/The check is watching/.test(all) && /day 4 of the 14 you decided on \(D5\)/.test(all) && /nothing is held or refused/.test(all),
       'what the check is doing: watching, on day 4 of the 14 decided on', all.slice(0, 400));
    is(/42 Scored/i.test(all) || /42\s*SCORED/i.test(all), 'the number scored', all.slice(0, 600));
    is(/3 would have been, acting/.test(all) && /1 would have been, acting/.test(all), 'what acting would have held and refused, while it watches');
    is(/9\s*Failed payments/i.test(all) && /5\s*Orders tried more than once/i.test(all) && /1 paid twice/.test(all) && /K750\.00/.test(all),
       'failed payments, orders tried more than once, paid twice, and refund activity');
    is(/Suspicious sign-ins/i.test(all) && /counted from build 92/.test(all), 'suspicious sign-ins: said to come with build 92, not shown as nought');
    const hist = await page.evaluate(() => Array.from(document.querySelectorAll('.rk-hist .rk-col')).map(c => c.querySelector('.rk-x').textContent + '=' + c.querySelector('.rk-n').textContent));
    is(hist.length === 10 && hist[0] === '0–9=20' && hist[9] === '90+=1' && hist[5] === '50–59=',
       'the spread of scores: ten bars from 0–9 to 90+, each with its count (none written on an empty one)', J(hist));
    const legend = await text(page, '.rk-wrap .an-legend');
    is(/Low/.test(legend) && /Medium/.test(legend) && /High/.test(legend) && /Critical/.test(legend), 'the cases per day: a legend names every level', legend);
    const rows = await page.evaluate(() => document.querySelectorAll('.rk-table tr').length);
    is(rows === 8, 'and every figure is in a table as well (a header and seven days)', String(rows));
    const queue = await text(page, '.rk-queue');
    is(/High/.test(queue) && /80 points/.test(queue) && /Payment received · VB-HX231/.test(queue) && /Held/.test(queue) &&
       /6 failed payments from this phone number in a day \(30\)/.test(queue),
       'a case waiting: its level in words, its points, what and which order, what was done, and every reason with its points', queue.slice(0, 500));
    is(/Watching: nothing done; acting, it would have refused it/.test(queue), 'a case from watching says what acting would have done');
    is(!/VB-PL100/.test(queue), 'a Medium case is not waiting for anybody');
    is(/VB-PL100/.test(await text(page, '.rk-wrap .card:last-child')), 'but it is among the latest cases');
    const badgeColour = await page.evaluate(() => getComputedStyle(document.querySelector('.rk-queue .rk-lv.rk-high'), '::before').backgroundColor);
    is(/rgb\(151, 64, 30\)/.test(badgeColour), 'each level has its own step of one colour, beside its word', badgeColour);
    if (SHOTS) { await page.screenshot({ path: path.join(SHOTS, 'risk-1-page.png'), fullPage: true }); }

    console.log('\nAnswering a case');
    const native = []; page.on('dialog', d => { native.push(d.message()); d.dismiss().catch(() => {}); });
    await page.click('.rk-queue .rk-case:nth-of-type(1) button:has-text("Approve")');
    await page.waitForSelector('.ask-back.in .ask-card', { timeout: 3000 });
    let asked = await text(page, '.ask-back.in .ask-card');
    is(/Approve this case\?/.test(asked) && /marked paid on the gateway’s word/.test(asked),
       'approving a held payment is asked first, saying it is marked paid only on the gateway’s word', asked);
    if (SHOTS) { await page.waitForTimeout(400); await page.screenshot({ path: path.join(SHOTS, 'risk-2-approve.png') }); }
    await page.click('.ask-back.in .ask-card .ask-row .btn-gold');
    await page.waitForFunction(() => /Approved and released/.test((document.querySelector('.rk-queue .rk-say') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
    let said = await text(page, '.rk-queue .rk-say');
    let rpc = await page.evaluate(() => window.__rpc.filter(r => r[0] === 'risk_decide'));
    is(rpc.length === 1 && rpc[0][1].p_decision === 'approve' && rpc[0][1].p_id === CASES[0].id, 'the answer goes to the database (risk_decide)', J(rpc));
    is(RELEASED.length === 1 && RELEASED[0].body.id === CASES[0].id && RELEASED[0].auth === 'Bearer owner-session-token',
       'then the payment is released through risk-release, with the owner’s own sign-in', J(RELEASED));
    is(/Approved and released: marked paid on the gateway’s word, and the customer emailed/.test(said), 'and the page says what happened', said);
    await page.waitForTimeout(2800);
    await page.waitForSelector('.rk-queue .rk-case', { timeout: 5000 });
    await page.click('.rk-queue .rk-case:nth-of-type(1) button:has-text("Reject")');
    await page.waitForSelector('.ask-back.in .ask-card input', { timeout: 3000 });
    asked = await text(page, '.ask-back.in .ask-card');
    is(/Reject this case\?/.test(asked) && /Why/i.test(asked), 'rejecting asks why, in the admin’s own dialog', asked);
    await page.click('.ask-back.in .ask-card .ask-row .btn-danger, .ask-back.in .ask-card .ask-row .btn-gold');
    await page.waitForTimeout(400);
    let told = await page.evaluate(() => { const c = document.querySelector('.ask-back.in .ask-card'); return c ? c.textContent : ''; });
    is(/A reason is needed to reject a case/.test(told), 'without a reason it is not sent', told);
    await page.click('.ask-back.in .ask-card .ask-row .btn-gold').catch(() => {});
    await page.waitForTimeout(300);
    await page.click('.rk-queue .rk-case:nth-of-type(1) button:has-text("Reject")');
    await page.waitForSelector('.ask-back.in .ask-card input', { timeout: 3000 });
    await page.fill('.ask-back.in .ask-card input', 'Same phone used in six orders; the customer could not be reached');
    await page.click('.ask-back.in .ask-card .ask-row .btn-danger, .ask-back.in .ask-card .ask-row .btn-gold');
    await page.waitForTimeout(500);
    rpc = await page.evaluate(() => window.__rpc.filter(r => r[0] === 'risk_decide'));
    is(rpc.length === 2 && rpc[1][1].p_decision === 'reject' && /could not be reached/.test(rpc[1][1].p_note), 'with one, it is', J(rpc[1]));
    const nativeUsed = await page.evaluate(() => window.NATIVE);
    is(native.length === 0 && nativeUsed.length === 0, 'the browser’s own boxes never appear', J([native, nativeUsed]));

    console.log('\nThe sealed record');
    await page.click('.rk-record button');
    await page.waitForFunction(() => /Intact/.test((document.querySelector('.rk-record .rk-said') || {}).textContent || ''), null, { timeout: 4000 }).catch(() => {});
    said = await text(page, '.rk-record .rk-said');
    is(/Intact: 1,204 entries checked/.test(said) && /9 anchors agree/.test(said), 'checked on request: intact, with how many entries and anchors', said);
    await ctx.close();
    ({ ctx, page } = await open('#/risk', { verify: { ok: false, why: 'seal', at: 212, checked: 212, entries: 1204 } }));
    await page.waitForSelector('.rk-record button');
    await page.click('.rk-record button');
    await page.waitForTimeout(600);
    said = await text(page, '.rk-record .rk-said');
    is(/NOT INTACT: entry 212 has been changed since it was written/.test(said), 'a record touched afterwards is said plainly, with the entry', said);
    await ctx.close();

    console.log('\nNot set up, not allowed');
    ({ ctx, page } = await open('#/risk', { missing: true }));
    is(/Run supabase-risk\.sql/.test(await text(page, '#tab-risk')), 'before its SQL is run, the page says what to run');
    await ctx.close();
    ({ ctx, page } = await open('#/risk', { refused: true }));
    is(/cannot open Fraud & Risk/.test(await text(page, '#tab-risk')) && /Users & Roles/.test(await text(page, '#tab-risk')),
       'a sign-in without the right is told who can, and where that is set');
    await ctx.close();
    ({ ctx, page } = await open('#/risk', { access: { is_admin: true, is_owner: false, active: true, permissions: { chats: true } } }));
    const hasTab = await page.evaluate(() => !!document.querySelector('.tab[data-tab="risk"]'));
    is(!hasTab, 'a role without Fraud & Risk ticked does not have the tab at all');
    await ctx.close();

    console.log('\nOn a phone');
    ({ ctx, page } = await open('#/risk', {}, { width: 390, height: 900 }));
    await page.waitForSelector('.rk-case', { timeout: 8000 });
    const wide = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    is(wide[0] <= wide[1], 'nothing is wider than the screen', J(wide));
    if (SHOTS) { await page.screenshot({ path: path.join(SHOTS, 'risk-3-phone.png'), fullPage: true }); }
    await ctx.close();

    console.log('\nSettings > Fraud & Risk');
    ({ ctx, page } = await open('#/settings/risk'));
    await page.waitForSelector('#f_mode', { timeout: 8000 });
    is(await page.inputValue('#f_mode') === 'watch' && await page.isChecked('#f_alertEmail'), 'with nothing saved: watching, and Critical emailed');
    const opts = await page.evaluate(() => Array.from(document.querySelectorAll('#f_mode option')).map(o => o.textContent));
    is(opts.length === 3 && /^Watch:/.test(opts[0]) && /^Act:/.test(opts[1]) && /^Off:/.test(opts[2]), 'three modes, each saying what it does', J(opts));
    if (SHOTS) { await page.screenshot({ path: path.join(SHOTS, 'risk-4-settings.png'), fullPage: false }); }
    await page.fill('#f_medium', '50');
    await page.fill('#f_high', '40');
    await page.click('#tab-settings button:has-text("Save changes")');
    await page.waitForTimeout(500);
    let w = await page.evaluate(() => window.__writes.filter(x => x.table === 'site_settings_private'));
    is(w.length === 0 && /High must be above Medium/.test(await page.evaluate(() => document.body.innerText)),
       'a High below the Medium is not saved, and says why');
    await page.fill('#f_high', '70');
    await page.selectOption('#f_mode', 'act');
    await page.fill('#f_alertTo', 'alerts@example.com');
    await page.click('#tab-settings button:has-text("Save changes")');
    await page.waitForTimeout(800);
    w = await page.evaluate(() => window.__writes);
    const priv = w.filter(x => x.table === 'site_settings_private' && x.row && x.row.key === 'risk').pop();
    const pub = w.filter(x => x.table === 'site_settings' && x.row && x.row.key === 'risk').pop();
    is(priv && priv.row.data.mode === 'act' && priv.row.data.medium === 50 && priv.row.data.high === 70 && priv.row.data.critical === 90 &&
       priv.row.data.alertTo === 'alerts@example.com' && priv.row.data.w_refused === 25,
       'saved in the private table: the mode, the levels (empty ones as their starting figures), the address, every weight', J(priv && priv.row.data));
    is(!pub || J(pub.row.data) === '{}', 'and nothing of it in the public row anybody can read', J(pub && pub.row.data));
    const logged = w.filter(x => x.table === 'activity_log');
    is(logged.length >= 1 && !logged.some(x => /alerts@example\.com|"act"|: ?70/.test(J(x.row))),
       'the activity log records that it changed, never the values', J(logged.map(x => x.row)));
    await ctx.close();

    is(errors.length === 0, 'no errors on any page', errors.join(' | '));
  } catch (e) { fail('the test itself broke', e && e.stack); }
  finally { await browser.close(); server.close(); }
  console.log(failures ? '\n  ✗ ' + failures + ' of ' + checks + ' checks FAILED' : '\n  fraud & risk admin: all ' + checks + ' checks passed');
  process.exit(failures ? 1 : 0);
})();
