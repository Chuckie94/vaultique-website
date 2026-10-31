/* ===========================================================================
   WHAT A SETTINGS BACKUP HOLDS -- settings/system-maintenance.js, build 78

   The audit of build 73 (W-14): Settings > System & Maintenance > Download a
   backup wrote every private setting into a plain file, the email password
   and the phone-notification keys and their secret among them. Now those
   are never in the file, the screen says so, and restoring an older backup
   that still holds them leaves the ones in use exactly as they are.

   The real admin.html and the real settings page, signed in as the owner.
   Supabase is a stand-in served in place of the library in assets/vendor/:
   it holds the settings below and records every write.
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

/* What this shop's two settings tables hold. The notifications row still
   has a password in it, as a database from before build 77's SQL would. */
const DB = {
  site_settings: [
    { key: 'general', data: { businessName: 'Vaultique Boutique Point' } },
    { key: 'notifications', data: { emailEnabled: true, smtpHost: 'smtp.example.test', senderEmail: 'shop@example.test' } }
  ],
  site_settings_private: [
    { key: 'payments', data: { bankName: 'Example Bank', accountNumber: '0001112223' } },
    { key: 'general', data: { previewKey: 'shop-preview' } },
    { key: 'notifications', data: { smtpUser: 'shop@example.test', smtpPassword: 'pw-in-use-now' } },
    { key: 'chat_push', data: { vapidPublic: 'P'.repeat(87), vapidPrivate: 'K'.repeat(43), secret: 's3cr3t-in-use' } }
  ]
};

const SUPA = `
(function () {
  var D = window.__DB;
  window.__writes = [];
  var session = null;
  function answer(q) {
    if (q.op !== 'select') { window.__writes.push({ table: q.table, op: q.op, payload: q.payload }); return { data: null, error: null }; }
    var rows = (D[q.table] || []).slice();
    q.filters.forEach(function (f) { rows = rows.filter(function (r) { return String(r[f[0]]) === String(f[1]); }); });
    if (q.single) return { data: rows[0] || null, error: null };
    return { data: rows, error: null };
  }
  function builder(t) {
    var q = { table: t, filters: [], op: 'select', payload: null, single: false };
    var b = {};
    ['select','order','limit','range','in','is','or','neq','gte','lte','gt','lt','not','filter','match','ilike','like','contains']
      .forEach(function (k) { b[k] = function () { return b; }; });
    b.eq = function (c, v) { q.filters.push([c, v]); return b; };
    b.single = b.maybeSingle = function () { q.single = true; return b; };
    b.upsert = function (p) { q.op = 'upsert'; q.payload = p; return b; };
    b.insert = function (p) { q.op = 'insert'; q.payload = p; return b; };
    b.update = function (p) { q.op = 'update'; q.payload = p; return b; };
    b.delete = function () { q.op = 'delete'; return b; };
    b.then = function (ok, bad) { return Promise.resolve(answer(q)).then(ok, bad); };
    return b;
  }
  function rpcAnswer(n) {
    if (n === 'admin_gate') return { data: { staff: true, owner: true, active: true, required: false, enrolled: false, aal: 'aal1', ok: true }, error: null };
    if (n === 'my_access') return { data: { is_admin: true, is_owner: true, active: true, must_change_password: false }, error: null };
    if (n === 'is_admin' || n === 'is_shop_owner' || n === 'may') return { data: true, error: null };
    return { data: null, error: null };
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
        signOut: function () { session = null; return Promise.resolve({ error: null }); },
        mfa: {
          getAuthenticatorAssuranceLevel: function () { return Promise.resolve({ data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null }); },
          listFactors: function () { return Promise.resolve({ data: { totp: [], all: [] }, error: null }); }
        }
      },
      from: function (t) { if (t === 'admins') return builder('admins_ok'); return builder(t); },
      rpc: function (n) { var b = builder('rpc'); b.then = function (ok, bad) { return Promise.resolve(rpcAnswer(n)).then(ok, bad); }; return b; },
      channel: function () { var ch = { on: function () { return ch; }, subscribe: function () { return ch; } }; return ch; },
      removeChannel: function () {},
      storage: { from: function () { return { list: function () { return Promise.resolve({ data: [] }); },
                                               getPublicUrl: function () { return { data: { publicUrl: '' } }; } }; } }
    };
  } };
  D.admins_ok = [{ id: 'u1' }];
})();`;

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css',
                '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
let base = '';
const server = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  const json = o => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (p === '/api/products') return json({ products: [] });
  if (p.indexOf('/.netlify/functions/') === 0) return json({});
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

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript('window.__DB = ' + JSON.stringify(DB) + ';');
  await ctx.route('**/assets/vendor/supabase-js-*', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: SUPA }));
  await ctx.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e)));
  const dialogText = () => page.evaluate(() => { const c = document.querySelector('.ask-card'); return c ? c.textContent : ''; });
  const press = (label) => page.evaluate(l => {
    const b = Array.from(document.querySelectorAll('.ask-card button')).find(x => x.textContent.trim() === l);
    if (b) b.click();
    return !!b;
  }, label);
  try {
    await page.goto(base + '/admin.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => { const e = document.getElementById('login'); return e && !e.classList.contains('hide'); }, null, { timeout: 10000 });
    await page.fill('#email', 'owner@shop.test');
    await page.fill('#password', 'a-long-password');
    await page.click('#loginBtn');
    await page.waitForFunction(() => { const e = document.getElementById('admin'); return e && !e.classList.contains('hide'); }, null, { timeout: 10000 });
    await page.evaluate(() => { location.hash = '#/settings/system-maintenance'; });
    await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).some(b => b.textContent === 'Download a backup'), null, { timeout: 10000 });

    console.log('\nThe screen says what a backup leaves out');
    const card = await page.evaluate(() => {
      const h = Array.from(document.querySelectorAll('h3')).find(x => x.textContent === 'Backup');
      return h ? h.parentNode.textContent : '';
    });
    is(/never in a backup/.test(card) && /email password/.test(card) && /phone-notification keys/.test(card),
       'the Backup card says the email password and the notification keys are never in one', card.slice(0, 400));

    console.log('\nDownloading one');
    await page.evaluate(() => Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Download a backup').click());
    await page.waitForSelector('.ask-card', { timeout: 5000 });
    const warn = await dialogText();
    is(/bank account/.test(warn) && /preview key/.test(warn) && /does\s+not contain the email password/.test(warn),
       'the warning before it says what it does hold, and what it does not', warn);
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), press('I understand, download it')]);
    const file = await dl.path();
    const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
    const text = JSON.stringify(backup);
    is(backup.privateSettings && backup.privateSettings.payments && backup.privateSettings.payments.accountNumber === '0001112223' &&
       backup.privateSettings.general && backup.privateSettings.general.previewKey === 'shop-preview' &&
       backup.settings && backup.settings.general,
       'it still holds every setting, the bank details and the preview key included', Object.keys(backup.privateSettings || {}).join(','));
    is(!('chat_push' in backup.privateSettings) && text.indexOf('s3cr3t-in-use') === -1 && text.indexOf('KKKKKKKK') === -1,
       'but not the notification keys, nor their secret', Object.keys(backup.privateSettings).join(','));
    is(backup.privateSettings.notifications && backup.privateSettings.notifications.smtpUser === 'shop@example.test' &&
       !('smtpPassword' in backup.privateSettings.notifications) && text.indexOf('pw-in-use-now') === -1,
       'nor the email password, though the rest of the email settings are there', JSON.stringify(backup.privateSettings.notifications));
    is(/never in a backup/.test(backup.leftOut || ''), 'and the file says so itself', backup.leftOut);
    await page.waitForFunction(() => /Backup downloaded/.test((document.querySelector('.ask-card') || {}).textContent || ''), null, { timeout: 8000 });
    await press('Close');
    await page.waitForFunction(() => !document.querySelector('.ask-card'), null, { timeout: 5000 }).catch(() => {});

    console.log('\nRestoring an older backup that still holds them');
    const old = {
      vaultique_backup: 1, takenAt: '2026-01-15T10:00:00Z', version: '1.40.0', build: 70,
      settings: { general: { businessName: 'Vaultique (from the backup)' } },
      privateSettings: {
        payments: { bankName: 'Example Bank', accountNumber: '0001112223' },
        notifications: { smtpUser: 'old@example.test', smtpPassword: 'an-old-password' },
        chat_push: { vapidPublic: 'O'.repeat(87), vapidPrivate: 'Q'.repeat(43), secret: 'old-shared-secret' },
        mail_secret: { smtpPassword: 'another-old-password' }
      }
    };
    await page.evaluate(() => { window.__writes.length = 0; });
    await page.setInputFiles('input[type=file][accept=".json,application/json"]',
      { name: 'old-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(old)) });
    await page.waitForFunction(() => /Restore these settings/.test((document.querySelector('.ask-card') || {}).textContent || ''), null, { timeout: 8000 });
    const sure = await dialogText();
    is(/email password\s+and the phone-notification keys, whatever the file holds/.test(sure),
       'the question before restoring says the password and the keys are left alone', sure);
    await press('Restore');
    await page.waitForFunction(() => /Restored/.test((document.querySelector('.ask-card') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    const writes = await page.evaluate(() => window.__writes.map(w => ({ table: w.table, key: w.payload && w.payload.key, data: w.payload && w.payload.data })));
    const priv = writes.filter(w => w.table === 'site_settings_private');
    is(writes.some(w => w.table === 'site_settings' && w.key === 'general') && priv.some(w => w.key === 'payments'),
       'the settings in it are put back', JSON.stringify(writes.map(w => w.table + ':' + w.key)));
    is(!priv.some(w => w.key === 'chat_push' || w.key === 'mail_secret'),
       'but the old notification keys and the old password row are never written', JSON.stringify(priv.map(w => w.key)));
    const n = priv.find(w => w.key === 'notifications');
    is(n && n.data.smtpUser === 'old@example.test' && n.data.smtpPassword === 'pw-in-use-now' && JSON.stringify(writes).indexOf('an-old-password') === -1,
       'and the email settings come back with the password that is in use now, not the old one', n && JSON.stringify(n.data));
    is(errors.length === 0, 'no script errors', errors.slice(0, 2).join(' | '));
  } catch (e) {
    fail('threw: ' + (e && e.stack || e));
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failures ? '\n  ✗ ' + failures + ' of ' + checks + ' checks FAILED'
                       : '\n  settings backup: all ' + checks + ' checks passed');
  process.exit(failures ? 1 : 0);
})();
