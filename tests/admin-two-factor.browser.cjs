/* ===========================================================================
   TWO-FACTOR AT THE ADMIN'S DOOR (build 76) -- in a real browser

   After supabase-hardening.sql the database refuses a sign-in that still
   owes a two-factor code, and refuses the owner, or anybody whose role can
   open Settings, Orders or Subscribers, until they have set two-factor up.
   The admin page asks the database first (admin_gate) and then:

     - must set it up and has not  -> the setup panel, QR code and all,
                                      then straight in once a code works
     - has it, password only so far -> the code panel, then in
     - switched off                  -> told so, and signed out
     - not on the staff at all       -> told so, and signed out
     - a database from before 76     -> exactly the old sign-in

   The real admin.html and assets/admin/shell.js. Supabase is a stand-in
   served in place of the library in assets/vendor/, answering as the
   database would and recording what it was asked.
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

/* window.__DB is the database's side of the story for one test:
     staff, active, required, enrolled  what admin_gate knows
     leftover                           an unconfirmed setup from before
     oldDb                              no admin_gate at all (before 76)  */
const SUPA = `
(function () {
  var D = window.__DB || {};
  var aal = 'aal1';
  var factors = D.enrolled ? [{ id: 'f1', status: 'verified', factor_type: 'totp' }] : [];
  if (D.leftover) factors.push({ id: 'f0', status: 'unverified', factor_type: 'totp' });
  window.__calls = { gate: 0, enroll: 0, unenroll: [], verify: 0, signOut: 0 };
  var session = null;
  function thenable(v) {
    var b = {};
    ['select','eq','neq','gte','lte','order','limit','range','in','is','or','single','maybeSingle','upsert','insert','update','delete','contains','gt','lt','not','filter','match','ilike','like']
      .forEach(function (k) { b[k] = function () { return b; }; });
    b.then = function (ok, bad) { return Promise.resolve(v).then(ok, bad); };
    return b;
  }
  function gateAnswer() {
    var verified = factors.some(function (f) { return f.status === 'verified'; });
    var okNow = !!D.staff && D.active !== false && (aal === 'aal2' || (!D.required && !verified));
    return { staff: !!D.staff, owner: !!D.owner, active: D.active !== false, required: !!D.required,
             enrolled: verified, aal: aal, ok: okNow };
  }
  window.supabase = { createClient: function () {
    return {
      auth: {
        getSession: function () { return Promise.resolve({ data: { session: session } }); },
        onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
        signInWithPassword: function (c) {
          session = { access_token: 't', user: { id: 'u1', email: c.email } };
          return Promise.resolve({ data: { session: session }, error: null });
        },
        signOut: function () { window.__calls.signOut++; session = null; return Promise.resolve({ error: null }); },
        resetPasswordForEmail: function () { return Promise.resolve({ data: {}, error: null }); },
        updateUser: function () { return Promise.resolve({ data: {}, error: null }); },
        mfa: {
          getAuthenticatorAssuranceLevel: function () {
            var verified = factors.some(function (f) { return f.status === 'verified'; });
            return Promise.resolve({ data: { currentLevel: aal, nextLevel: verified ? 'aal2' : aal }, error: null });
          },
          listFactors: function () {
            return Promise.resolve({ data: {
              totp: factors.filter(function (f) { return f.status === 'verified'; }),
              all: factors.slice() }, error: null });
          },
          enroll: function () {
            window.__calls.enroll++;
            if (D.totpOff) return Promise.resolve({ data: null, error: { message: 'MFA enroll is disabled for TOTP' } });
            if (factors.some(function (f) { return f.status === 'unverified'; })) {
              return Promise.resolve({ data: null, error: { message: 'A factor with this friendly name already exists' } });
            }
            factors.push({ id: 'f9', status: 'unverified', factor_type: 'totp' });
            return Promise.resolve({ data: { id: 'f9', totp: {
              qr_code: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
              secret: 'JBSWY3DPEHPK3PXP' } }, error: null });
          },
          unenroll: function (o) {
            window.__calls.unenroll.push(o.factorId);
            factors = factors.filter(function (f) { return f.id !== o.factorId; });
            return Promise.resolve({ data: {}, error: null });
          },
          challenge: function () { return Promise.resolve({ data: { id: 'c1' }, error: null }); },
          verify: function (o) {
            window.__calls.verify++;
            if (o.code !== '123456') return Promise.resolve({ data: null, error: { message: 'Invalid TOTP code entered' } });
            factors.forEach(function (f) { if (f.id === o.factorId) f.status = 'verified'; });
            aal = 'aal2';
            return Promise.resolve({ data: {}, error: null });
          }
        }
      },
      from: function (t) {
        var g = gateAnswer();
        if (t === 'admins') return thenable({ data: (D.oldDb ? D.staff : g.ok) ? [{ id: 'u1' }] : [], error: null });
        if (t === 'orders') return thenable({ data: D.orders || [], error: null });
        return thenable({ data: [], error: null });
      },
      rpc: function (n) {
        if (n === 'admin_gate') {
          window.__calls.gate++;
          if (D.oldDb) return thenable({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.admin_gate' } });
          return thenable({ data: gateAnswer(), error: null });
        }
        if (n === 'my_access') {
          var a = D.oldDb ? true : gateAnswer().ok;
          return thenable({ data: a ? { is_admin: true, is_owner: !!D.owner, active: D.active !== false, must_change_password: false }
                                    : { is_admin: false, is_owner: false, active: false }, error: null });
        }
        if (n === 'is_admin') return thenable({ data: D.oldDb ? !!D.staff : gateAnswer().ok, error: null });
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
  if (p === '/api/products' || p.indexOf('/.netlify/functions/') === 0) return json({ products: [] });
  if (p.indexOf('/web/') === 0) return json([]);
  if (p === '/config.js') {
    res.writeHead(200, { 'Content-Type': TYPES['.js'] });
    return res.end('window.VBP_CONFIG={SUPABASE_URL:"' + base + '/web",SUPABASE_ANON_KEY:"anon"};');
  }
  let file = path.join(ROOT, p === '/' ? 'index.html' : p);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});

const shown = (page, id) => page.evaluate(i => { const e = document.getElementById(i); return !!e && !e.classList.contains('hide'); }, id);
const text = (page, id) => page.evaluate(i => (document.getElementById(i) || {}).textContent || '', id);

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();

  async function signIn(db) {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
    await ctx.addInitScript('window.__DB = ' + JSON.stringify(db) + ';');
    await ctx.route('**/assets/vendor/supabase-js-*', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: SUPA }));
    await ctx.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message || e)));
    await page.goto(base + '/admin.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => { const e = document.getElementById('login'); return e && !e.classList.contains('hide'); }, null, { timeout: 10000 });
    await page.fill('#email', 'owner@shop.test');
    await page.fill('#password', 'a-long-password');
    await page.click('#loginBtn');
    await page.waitForTimeout(700);
    return { ctx, page, errors };
  }

  try {
    console.log('\nThe owner, who must have two-factor and has not set it up');
    {
      const { ctx, page, errors } = await signIn({ staff: true, owner: true, required: true, enrolled: false, leftover: true });
      is(await shown(page, 'mfaSetup') && !(await shown(page, 'admin')), 'is shown the setup panel, and not the admin');
      is(await page.evaluate(() => { const i = document.getElementById('mfaSetupQr'); return !!i && !i.classList.contains('hide') && /^data:image/.test(i.src); }),
         'with the QR code to scan');
      is((await text(page, 'mfaSetupSecret')).trim() === 'JBSWY3DPEHPK3PXP', 'and the code to type in by hand');
      is(await page.evaluate(() => window.__calls.unenroll.indexOf('f0') > -1), 'a half-finished setup from before is cleared first, so a fresh one can start');
      await page.fill('#mfaSetupCode', '000000');
      await page.click('#mfaSetupBtn');
      await page.waitForTimeout(300);
      is(/not accepted|Invalid/i.test(await text(page, 'mfaSetupMsg')) && !(await shown(page, 'admin')), 'a wrong code is refused, and the admin stays shut');
      await page.fill('#mfaSetupCode', '123 456');
      await page.click('#mfaSetupBtn');
      await page.waitForFunction(() => { const e = document.getElementById('admin'); return e && !e.classList.contains('hide'); }, null, { timeout: 8000 }).catch(() => {});
      is(await shown(page, 'admin') && !(await shown(page, 'mfaSetup')), 'the right code turns it on and opens the admin');
      is(await page.evaluate(() => window.__calls.signOut) === 0, 'without signing out and in again');
      is(errors.length === 0, 'no script errors', errors.slice(0, 2).join(' | '));
      await ctx.close();
    }

    console.log('\nAn Administrator who has two-factor, signed in with the password');
    {
      const { ctx, page } = await signIn({ staff: true, required: true, enrolled: true });
      is(await shown(page, 'mfa') && !(await shown(page, 'admin')), 'is asked for the code before anything else');
      await page.fill('#mfaCode', '123456');
      await page.click('#mfaBtn');
      await page.waitForFunction(() => { const e = document.getElementById('admin'); return e && !e.classList.contains('hide'); }, null, { timeout: 8000 }).catch(() => {});
      is(await shown(page, 'admin'), 'and is in once it is right');
      is(await page.evaluate(() => window.__calls.gate) >= 2, 'the database was asked again after the code, at the new level');
      await ctx.close();
    }

    console.log('\nAn Agent who only answers chats and has not set it up');
    {
      const { ctx, page } = await signIn({ staff: true, required: false, enrolled: false });
      await page.waitForFunction(() => { const e = document.getElementById('admin'); return e && !e.classList.contains('hide'); }, null, { timeout: 8000 }).catch(() => {});
      is(await shown(page, 'admin') && !(await shown(page, 'mfaSetup')) && !(await shown(page, 'mfa')),
         'goes straight in: two-factor is optional for that role');
      await ctx.close();
    }

    console.log('\nSomebody switched off');
    {
      const { ctx, page } = await signIn({ staff: true, active: false, required: true, enrolled: false });
      await page.waitForTimeout(300);
      is(await shown(page, 'login') && /switched off/i.test(await text(page, 'loginMsg')),
         'is told they were switched off, not offered two-factor');
      is(await page.evaluate(() => window.__calls.signOut) >= 1 && !(await shown(page, 'admin')), 'and is signed out');
      await ctx.close();
    }

    console.log('\nSomebody who is not on the staff at all (a customer account)');
    {
      const { ctx, page } = await signIn({ staff: false });
      await page.waitForTimeout(300);
      is(await shown(page, 'login') && /not an administrator/i.test(await text(page, 'loginMsg')),
         'is told this is not an administrator account');
      is(await page.evaluate(() => window.__calls.signOut) >= 1, 'and is signed out');
      await ctx.close();
    }

    console.log('\nA project with app codes switched off in Supabase');
    {
      const { ctx, page } = await signIn({ staff: true, owner: true, required: true, enrolled: false, totpOff: true });
      await page.waitForFunction(() => /Supabase/.test((document.getElementById('mfaSetupMsg') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
      const said = await text(page, 'mfaSetupMsg');
      is(/Authentication > Multi-Factor/.test(said) && /TOTP/.test(said) && !(await shown(page, 'admin')),
         'the setup panel says which Supabase setting to switch on, and the admin stays shut', said);
      await ctx.close();
    }

    console.log('\nThe Orders tab, once a test card has been used (build 76)');
    {
      const orders = [
        { id: 'o1', ref: 'VB-TEST1', name: 'Tester', phone: '0970000000', total: 500, currency: 'ZMW', status: 'pending',
          created_at: new Date().toISOString(), payment_method: 'online', payment_status: 'paid', pay_channel: 'card',
          pay_mode: 'test', order_items: [] },
        { id: 'o2', ref: 'VB-LIVE1', name: 'Buyer', phone: '0971111111', total: 700, currency: 'ZMW', status: 'pending',
          created_at: new Date().toISOString(), payment_method: 'online', payment_status: 'paid', pay_channel: 'card',
          pay_mode: 'live', order_items: [] }
      ];
      const { ctx, page } = await signIn({ staff: true, owner: true, required: false, enrolled: false, orders });
      await page.waitForFunction(() => { const e = document.getElementById('admin'); return e && !e.classList.contains('hide'); }, null, { timeout: 8000 }).catch(() => {});
      await page.evaluate(() => { location.hash = '#/orders'; });
      await page.waitForFunction(() => document.querySelectorAll('#ordList .card').length === 2, null, { timeout: 8000 }).catch(() => {});
      const cards = await page.$$eval('#ordList .card', (els) => els.map((e) => e.textContent));
      is(cards.length === 2 && /TEST/.test(cards[0]) && /no money moved/.test(cards[0]),
         'a test payment says TEST, no money moved, beside its "Paid"', JSON.stringify(cards));
      is(cards.length === 2 && !/TEST/.test(cards[1]), 'and a real one does not');
      await ctx.close();
    }

    console.log('\nA database from before build 76 (supabase-hardening.sql not run yet)');
    {
      const { ctx, page } = await signIn({ oldDb: true, staff: true, owner: true });
      await page.waitForFunction(() => { const e = document.getElementById('admin'); return e && !e.classList.contains('hide'); }, null, { timeout: 8000 }).catch(() => {});
      is(await shown(page, 'admin'), 'the sign-in works exactly as before: uploading build 76 first is safe');
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures ? '\n  ✗ ' + failures + ' of ' + checks + ' checks FAILED' : '\n  two-factor at the admin\'s door: all ' + checks + ' checks passed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('  ✗ the test itself failed: ' + (e && e.stack || e)); process.exit(1); });
