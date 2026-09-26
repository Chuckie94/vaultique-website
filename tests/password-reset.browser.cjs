/* ===========================================================================
   FORGOT PASSWORD -- the admin and customer accounts, in a real browser

   The real admin.html and index.html. Supabase is a stand-in served in place
   of supabase-js, recording what it is asked; the email itself is Supabase's
   to send (through the shop's own mail service, see SETUP.md), so what is
   checked here is everything on either side of it:

     - "Forgot your password?" asks Supabase to send a link, to the right
       address, and says the same thing whether or not the account exists.
     - Following the link asks for a new password BEFORE anything else,
       after the authenticator code if the account has one.
     - A link that has expired says so.
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

const SUPA = `
(function () {
  var A = window.__AUTH || {};
  window.__calls = { reset: [], update: [], signOut: 0, mfa: 0 };
  var listeners = [];
  var aal = A.mfa ? 'aal1' : 'aal1';
  function thenable(v) {
    var b = {};
    ['select','eq','neq','gte','lte','order','limit','range','in','is','or','single','maybeSingle','upsert','insert','update','delete']
      .forEach(function (k) { b[k] = function () { return b; }; });
    b.then = function (ok, bad) { return Promise.resolve(v).then(ok, bad); };
    return b;
  }
  window.supabase = { createClient: function () {
    var session = A.session ? { access_token: 't', user: { id: 'u1', email: 'owner@example.com', email_confirmed_at: 'x' } } : null;
    var client = {
      auth: {
        getSession: function () { return Promise.resolve({ data: { session: session } }); },
        onAuthStateChange: function (cb) {
          listeners.push(cb);
          if (A.session && A.recovery) setTimeout(function () { cb('PASSWORD_RECOVERY', session); }, 0);
          return { data: { subscription: { unsubscribe: function () {} } } };
        },
        resetPasswordForEmail: function (email, opts) {
          window.__calls.reset.push({ email: email, redirectTo: opts && opts.redirectTo });
          return Promise.resolve({ data: {}, error: A.resetError || null });
        },
        updateUser: function (u) {
          window.__calls.update.push(u);
          return Promise.resolve({ data: { user: session && session.user }, error: null });
        },
        signInWithPassword: function () { return Promise.resolve({ data: {}, error: { message: 'Invalid login credentials' } }); },
        signOut: function () { window.__calls.signOut++; session = null; return Promise.resolve({ error: null }); },
        mfa: {
          getAuthenticatorAssuranceLevel: function () {
            return Promise.resolve({ data: { currentLevel: aal, nextLevel: A.mfa ? 'aal2' : 'aal1' }, error: null });
          },
          listFactors: function () { return Promise.resolve({ data: { totp: [{ id: 'f1', status: 'verified' }], all: [{ id: 'f1', status: 'verified', factor_type: 'totp' }] }, error: null }); },
          challenge: function () { return Promise.resolve({ data: { id: 'c1' }, error: null }); },
          verify: function () { window.__calls.mfa++; aal = 'aal2'; return Promise.resolve({ data: {}, error: null }); }
        }
      },
      from: function (t) {
        if (t === 'admins') return thenable({ data: A.session ? [{ id: 'u1' }] : [], error: null });
        if (t === 'customers') return thenable({ data: A.session ? { id: 'u1', name: 'Chanda' } : null, error: null });
        return thenable({ data: [], error: null });
      },
      rpc: function (n) {
        if (n === 'my_access') return thenable({ data: { is_admin: true, is_owner: true, active: true, must_change_password: false }, error: null });
        return thenable({ data: null, error: null });
      },
      channel: function () { var ch = { on: function () { return ch; }, subscribe: function () { return ch; } }; return ch; },
      removeChannel: function () {},
      storage: { from: function () { return { list: function () { return Promise.resolve({ data: [] }); } }; } }
    };
    return client;
  } };
})();`;

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
let base = '';
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  const json = o => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (p === '/api/products') return json({ products: [], version: 't' });
  if (p === '/web/rest/v1/site_settings') {
    const k = (u.searchParams.get('key') || '').replace('eq.', '');
    if (k === 'customer-accounts') return json([{ data: { accountsEnabled: true } }]);
    return json([]);
  }
  if (p.startsWith('/web/')) return json([]);
  if (p === '/config.js' || p === '/config.js/') {
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
  async function open(url, auth) {
    const ctx = await browser.newContext({ viewport: { width: 400, height: 900 } });
    await ctx.addInitScript('window.__AUTH = ' + JSON.stringify(auth || {}) + ';');
    await ctx.route('**/cdn.jsdelivr.net/**', r => {
      if (/supabase-js/.test(r.request().url())) return r.fulfill({ status: 200, contentType: 'text/javascript', body: SUPA });
      return r.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
    });
    await ctx.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message || e)));
    await page.goto(base + url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    return { ctx, page, errors };
  }
  const shown = (page, id) => page.evaluate(i => { const e = document.getElementById(i); return !!e && !e.classList.contains('hide'); }, id);

  try {
    console.log('\nAdmin: asking for a link');
    {
      const { ctx, page } = await open('/admin.html', {});
      is(await shown(page, 'login') && !!(await page.$('#forgotBtn')), 'the sign-in page has "Forgot your password?"');
      await page.click('#forgotBtn');
      is(/Type your email/.test(await page.textContent('#loginMsg')), 'with no email typed, it asks for one first');
      await page.fill('#email', 'owner@example.com');
      await page.click('#forgotBtn');
      await page.waitForTimeout(300);
      const calls = await page.evaluate(() => window.__calls.reset);
      is(calls.length === 1 && calls[0].email === 'owner@example.com' && calls[0].redirectTo === base + '/admin.html?reset=1',
         'Supabase is asked to send a link that comes back to the admin', JSON.stringify(calls));
      const said = await page.textContent('#loginMsg');
      is(/If owner@example.com belongs to an admin account/.test(said) && /spam/.test(said),
         'and the answer does not say whether the account exists', said);
      is(await page.evaluate(() => document.getElementById('forgotBtn').disabled), 'the button rests for a moment, so it cannot be hammered');
      await ctx.close();
    }
    {
      const { ctx, page } = await open('/admin.html', { resetError: { status: 429, message: 'For security purposes, you can only request this after 60 seconds.' } });
      await page.fill('#email', 'owner@example.com'); await page.click('#forgotBtn'); await page.waitForTimeout(300);
      is(/wait a minute/.test(await page.textContent('#loginMsg')), 'asked twice too quickly, it says to wait');
      await ctx.close();
    }
    {
      const { ctx, page } = await open('/admin.html', { resetError: { status: 500, message: 'Error sending recovery email' } });
      await page.fill('#email', 'owner@example.com'); await page.click('#forgotBtn'); await page.waitForTimeout(300);
      is(/could not be sent/.test(await page.textContent('#loginMsg')), 'if the mail service fails, it says so instead of pretending');
      await ctx.close();
    }

    console.log('\nAdmin: following the link');
    {
      const { ctx, page } = await open('/admin.html?reset=1#access_token=x&type=recovery', { session: true, recovery: true });
      is(await shown(page, 'newpw') && !(await shown(page, 'admin')), 'a new password is asked for before the admin opens');
      is((await page.textContent('#pwHead')) === 'Choose a new password', 'headed "Choose a new password"');
      await page.fill('#pw1', 'short'); await page.fill('#pw2', 'short'); await page.click('#pwBtn');
      is(/eight/.test(await page.textContent('#pwMsg')), 'too short is refused');
      await page.fill('#pw1', 'a-long-new-pass'); await page.fill('#pw2', 'a-long-new-pass'); await page.click('#pwBtn');
      await page.waitForTimeout(700);
      const up = await page.evaluate(() => window.__calls.update);
      is(up.length === 1 && up[0].password === 'a-long-new-pass', 'the new password is saved with Supabase');
      is(!(await shown(page, 'newpw')) && await shown(page, 'admin'), 'and then the admin opens');
      is(!/reset=1/.test(await page.evaluate(() => location.href)), 'with the reset marker tidied out of the address');
      await ctx.close();
    }
    {
      const { ctx, page } = await open('/admin.html?reset=1#access_token=x&type=recovery', { session: true, recovery: true, mfa: true });
      is(await shown(page, 'mfa') && !(await shown(page, 'newpw')), 'with an authenticator set up, the code is asked for first');
      await page.fill('#mfaCode', '123456'); await page.click('#mfaBtn');
      await page.waitForTimeout(500);
      is(await shown(page, 'newpw') && !(await shown(page, 'admin')), 'then the new password, still before the admin');
      await ctx.close();
    }
    {
      const { ctx, page } = await open('/admin.html?reset=1', {});
      is(await shown(page, 'login') && /expired or was already used/.test(await page.textContent('#loginMsg')),
         'a link that has expired says so, on the sign-in page');
      await ctx.close();
    }
    {
      const { ctx, page } = await open('/admin.html', { session: true });
      is(await shown(page, 'admin') && !(await shown(page, 'newpw')), 'an ordinary sign-in is not asked for a new password');
      await ctx.close();
    }

    console.log('\nCustomer accounts');
    {
      const { ctx, page } = await open('/account', {});
      await page.waitForSelector('#ac_email', { timeout: 5000 });
      await page.fill('#ac_email', 'chanda@example.com');
      await page.click('text=Forgotten your password?');
      await page.waitForTimeout(300);
      const calls = await page.evaluate(() => window.__calls.reset);
      is(calls.length === 1 && calls[0].redirectTo === base + '/account?reset=1',
         'the customer\'s link comes back to /account?reset=1 (no #, which used to break it)', JSON.stringify(calls));
      is(/If that address has an account/.test(await page.textContent('#accountBody')), 'and does not say whether the account exists');
      await ctx.close();
    }
    {
      const { ctx, page, errors } = await open('/account?reset=1#access_token=x&type=recovery', { session: true, recovery: true });
      await page.waitForSelector('#ac_reset1', { timeout: 5000 }).catch(() => {});
      const card = await page.evaluate(() => { const h = document.querySelector('#accountBody .ac-card h2'); return h ? h.textContent : ''; });
      is(card === 'Choose a new password', 'following the link, the account page asks for a new password first', card);
      await page.fill('#ac_reset1', 'NewPassword1'); await page.fill('#ac_reset2', 'NewPassword2');
      await page.click('text=Save new password');
      is(/not the same/.test(await page.textContent('#accountBody')), 'two different passwords are refused');
      await page.fill('#ac_reset2', 'NewPassword1');
      await page.click('text=Save new password');
      await page.waitForTimeout(500);
      const up = await page.evaluate(() => window.__calls.update);
      is(up.length === 1 && up[0].password === 'NewPassword1', 'the new password is saved');
      const after = await page.evaluate(() => ({ text: document.getElementById('accountBody').textContent, url: location.href }));
      is(/new password is saved/.test(after.text) && !/Choose a new password/.test(after.text), 'and the account page carries on as normal', after.text.slice(0, 120));
      is(!/reset=1/.test(after.url) && /\/account$/.test(after.url), 'at a tidy address', after.url);
      is(errors.length === 0, 'with no page errors' + (errors.length ? ': ' + errors[0] : ''));
      await ctx.close();
    }
  } catch (e) {
    fail('threw: ' + (e && e.stack || e));
  } finally {
    await browser.close();
    server.close();
  }
  console.log('\n' + (failures ? '  ✗ ' + failures + ' of ' + checks + ' checks FAILED'
                                : '  password reset: all ' + checks + ' checks passed'));
  process.exit(failures ? 1 : 0);
})();
