/* ===========================================================================
   SETTINGS > LIVE CHAT, BUILD 83 -- the Enquire messages and the customer's
   reply notification, in a real browser

   THE OWNER: "Is there a place i can edit these pre entered messages in
   settings ... Create a setting to edit the phrase for each one of them."
   And: "the customer who opens a chat should be able to receive a
   notification when there is a response ... if the customer closed the
   chat but did not end it and the shop responds to the message within an
   hour".

   The real admin.html, settings-ui.js, settings-store.js and
   settings/chat.js. Supabase is the same stand-in as the layby settings
   test: the settings rows in memory, every write recorded, so what is
   checked is exactly what would reach the database. What the shop front
   does with the words is enquire-chat.browser.cjs; what the notification
   function does with the hours is chat-push.test.cjs.
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


const OWNER = { is_admin: true, is_owner: true, active: true, must_change_password: false };
const ENQ = {
  enquireShop:     ['Shopping made personal (the homepage band)', "I'd like to shop with you."],
  enquireDelivery: ['Delivery', 'I have a question about delivery.'],
  enquireFaq:      ['The end of the questions (FAQ)', 'I have a question.'],
  enquirePolicies: ['The policies page', 'I have a question about your policies.'],
  enquireSoldOut:  ['A sold-out piece', "I'm interested in {product} (SKU: {sku}). Will it be available again?"],
  enquirePrice:    ['A piece whose price is on request', 'Could you tell me the price of {product} (SKU: {sku})?']
};

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const errors = [];

  async function open(setup, viewport) {
    const sharp = process.env.SHOT_DIR && viewport ? { deviceScaleFactor: 2 } : {};
    const ctx = await browser.newContext(Object.assign({ viewport: viewport || { width: 1100, height: 1400 } }, sharp));
    await ctx.addInitScript('window.__SETUP = ' + J(setup) + ';');
    await ctx.route('**/cdn.jsdelivr.net/**', r => {
      if (/supabase-js/.test(r.request().url())) return r.fulfill({ status: 200, contentType: 'text/javascript', body: SUPA });
      return r.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
    });
    await ctx.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await ctx.route('**/cdnjs.cloudflare.com/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    await ctx.route('**/assets/vendor/supabase-js-*', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: SUPA }));
    await ctx.route('**/assets/vendor/leaflet-*/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(String(e.message || e)));
    await page.goto(base + '/admin.html#/settings/chat', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    return { ctx, page };
  }
  const val = (page, id) => page.evaluate(i => { const e = document.getElementById(i); return e ? e.value : null; }, id);
  const errOf = (page, id) => page.evaluate(i => {
    const e = document.getElementById(i);
    const f = e && e.closest('.field');
    return f ? (f.querySelector('.err-txt') || {}).textContent || '' : null;
  }, id);
  const hidden = (page, id) => page.evaluate(i => {
    const e = document.getElementById(i);
    return !e || !!e.closest('.hide');
  }, id);
  const status = page => page.evaluate(() => (document.querySelector('.save-bar .stat') || {}).textContent || '');
  const chatWrites = page => page.evaluate(() => window.__writes.filter(x => x.table === 'site_settings' && x.row && x.row.key === 'chat'));
  const save = async page => { await page.click('.save-bar .btn-gold'); await page.waitForTimeout(400); };
  const card = (page, title) => page.evaluate(t => {
    const c = Array.from(document.querySelectorAll('.card')).find(x => ((x.querySelector('h3') || {}).textContent || '').trim() === t);
    if (!c) return null;
    return {
      note: (c.querySelector('.grp-note') || {}).textContent || '',
      fields: Array.from(c.querySelectorAll('input, textarea')).map(i => {
        const l = c.querySelector('label[for="' + i.id + '"]');
        const sw = i.closest('.sw-row');
        return { id: i.id, type: i.type, label: (l ? l.textContent : sw ? sw.textContent : '').trim(),
                 value: i.type === 'checkbox' ? i.checked : i.value, placeholder: i.placeholder || '' };
      })
    };
  }, title);

  try {
    /* ================================================================== */
    console.log('\nThe owner opens Settings > Live Chat, never saved before');
    let { ctx, page } = await open({ access: OWNER, pub: {}, priv: {} });
    const enq = await card(page, 'Enquire buttons: the message each one starts');
    is(enq && enq.fields.length === 6 && Object.keys(ENQ).every((k, i) => enq.fields[i] && enq.fields[i].id === 'f_' + k),
       'an "Enquire buttons" card with a box for each of the six', J(enq && enq.fields.map(f => f.id)));
    is(enq && Object.keys(ENQ).every((k, i) => enq.fields[i].label === ENQ[k][0]),
       'each named for where the button is: ' + Object.keys(ENQ).map(k => '"' + ENQ[k][0] + '"').join(', '),
       J(enq && enq.fields.map(f => f.label)));
    is(enq && Object.keys(ENQ).every((k, i) => enq.fields[i].placeholder === ENQ[k][1] &&
                                         (enq.fields[i].value === ENQ[k][1] || enq.fields[i].value === '')),
       'each starting from the words that button used until now, different for each, not one phrase for all',
       J(enq && enq.fields.map(f => [f.value, f.placeholder])));
    const words = enq ? new Set(enq.fields.map(f => f.placeholder)) : new Set();
    is(words.size === 6, 'six different messages', J([...words]));
    is(enq && /When the live chat is off, the same words start the WhatsApp message/.test(enq.note) &&
       /Settings > Customer Care/.test(enq.note) && /Leave a box empty/.test(enq.note),
       'the note says where they are used, where the panels\' own are, and what an empty box means', enq && enq.note);
    is(!(await hidden(page, 'f_enquireDelivery')), 'shown whatever the chat switch says (WhatsApp uses them when it is off)');

    const rep = await card(page, 'Telling a customer you have replied');
    const sw = rep && rep.fields.find(f => f.id === 'f_replyPush');
    const hrs = rep && rep.fields.find(f => f.id === 'f_replyPushWithin');
    is(sw && sw.value === true && /Offer customers a notification when you reply/.test(sw.label),
       'a "Telling a customer you have replied" card: the offer is on to begin with', J(rep && rep.fields));
    is(hrs && hrs.value === '1' && /within this many hours/.test(hrs.label),
       'within one hour of their last message, as asked', J(hrs));
    is(rep && /never what/.test(rep.note) && /home screen/.test(rep.note) && /supabase-chat-reply-push\.sql/.test(rep.note),
       'the note says it never shows what was said, the iPhone home-screen rule and the SQL file it needs', rep && rep.note);
    await ctx.close();

    /* ================================================================== */
    console.log('\nWhat it saves');
    ({ ctx, page } = await open({ access: OWNER, pub: {}, priv: {} }));
    await page.fill('#f_enquireDelivery', 'Do you deliver to Kitwe?');
    await page.fill('#f_enquireSoldOut', 'Will {product} ({sku}) be back in stock?');
    await page.fill('#f_enquireFaq', '');
    await page.fill('#f_replyPushWithin', '3');
    await save(page);
    let w = (await chatWrites(page)).pop();
    const d = w && w.row.data;
    is(/Saved/.test(await status(page)) && d && d.enquireDelivery === 'Do you deliver to Kitwe?' &&
       d.enquireSoldOut === 'Will {product} ({sku}) be back in stock?',
       'the delivery and sold-out messages typed go into the Live Chat row', J(d));
    is(d && d.enquireFaq === '', 'an emptied box is saved empty, so the website uses the built-in words', J(d && d.enquireFaq));
    is(d && d.enquireShop === ENQ.enquireShop[1] && d.enquirePolicies === ENQ.enquirePolicies[1] && d.enquirePrice === ENQ.enquirePrice[1],
       'the ones not touched keep their words', J(d));
    is(d && d.replyPushWithin === 3 && d.replyPush === true, '3 hours, kept as a number, with the offer still on', J(d));
    is(d && d.title === 'Chat with us' && d.enabled === true && d.fabText === 'Live chat',
       'and everything else on the page as it was', J(d));
    const saved = d;
    await ctx.close();

    /* ================================================================== */
    console.log('\nWhat it will not save');
    ({ ctx, page } = await open({ access: OWNER, pub: { chat: saved }, priv: {} }));
    for (const [typed, want] of [['73', /Cannot be more than 72/], ['-1', /Cannot be less than 0/],
                                 ['two', /Enter a number/], ['', /cannot be left blank/]]) {
      const before = (await chatWrites(page)).length;
      await page.fill('#f_replyPushWithin', typed);
      await save(page);
      const said = await errOf(page, 'f_replyPushWithin');
      is(want.test(said) && (await chatWrites(page)).length === before,
         'hours "' + typed + '": "' + said + '", and nothing saved', said);
    }
    await page.fill('#f_replyPushWithin', '0');
    await save(page);
    w = (await chatWrites(page)).pop();
    is(w && w.row.data.replyPushWithin === 0, '0 is accepted: any time while the chat is open', J(w && w.row.data));
    await ctx.close();

    /* ================================================================== */
    console.log('\nSwitched off');
    ({ ctx, page } = await open({ access: OWNER, pub: { chat: saved }, priv: {} }));
    await page.locator('#f_replyPush').evaluate(b => b.click());
    await page.waitForTimeout(200);
    is(await hidden(page, 'f_replyPushWithin'), 'with the offer off, the hours box goes away');
    await save(page);
    w = (await chatWrites(page)).pop();
    is(w && w.row.data.replyPush === false && /Saved/.test(await status(page)), 'and saves as off', J(w && w.row.data));
    await ctx.close();

    /* ================================================================== */
    console.log('\nThe same words on another device');
    // A tall phone screen when taking pictures, so a long card is not cut by the admin's top bar.
    ({ ctx, page } = await open({ access: OWNER, pub: { chat: saved }, priv: {} },
                                { width: 390, height: process.env.SHOT_DIR ? 3200 : 900 }));
    is(await val(page, 'f_enquireDelivery') === 'Do you deliver to Kitwe?' && await val(page, 'f_replyPushWithin') === '3' &&
       await val(page, 'f_enquireFaq') === '',
       'read back from the database: the delivery words, 3 hours and the emptied box, on a phone that never saw them typed');
    if (process.env.SHOT_DIR) {
      const a = page.locator('.card').filter({ hasText: 'Enquire buttons: the message each one starts' }).first();
      await a.screenshot({ path: path.join(process.env.SHOT_DIR, 'settings-enquire.png') });
      const b = page.locator('.card').filter({ hasText: 'Telling a customer you have replied' }).first();
      await b.screenshot({ path: path.join(process.env.SHOT_DIR, 'settings-reply-notify.png') });
    }
    await ctx.close();

    /* ================================================================== */
    console.log('\nWho can change them');
    ({ ctx, page } = await open({ access: { is_admin: true, is_owner: false, active: true, permissions: { orders: true, chat: true } },
                                  pub: { chat: saved }, priv: {} }));
    is(!(await page.evaluate(() => !!document.getElementById('f_enquireDelivery'))),
       'staff without Settings on their role: the page does not open for them');
    await ctx.close();

    is(errors.length === 0, 'no script error anywhere', errors.slice(0, 3).join(' | '));
  } catch (e) {
    fail('threw', e && e.stack);
  }
  await browser.close();
  server.close();
  console.log(failures ? '\n  ✗ ' + failures + ' of ' + checks + ' checks FAILED'
                       : '\n  Live Chat settings: all ' + checks + ' checks passed');
  process.exit(failures ? 1 : 0);
})();
