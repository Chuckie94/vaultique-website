/* ===========================================================================
   BEING TOLD A CUSTOMER WROTE -- the desk, in a real browser

   THE OWNER: "chat notifications ... come late on my side long after the
   customer is gone."

   Two ways the desk stayed silent until somebody looked:
     1. Live Chats open in the background: a message arrived live, but the
        list (and with it the chime and the "(2)" in the tab title) waited
        for somebody to come back to the tab.
     2. Any other admin page: a customer writing made no sound and no mark.
   The real assets/admin/chat-alerts.js and live-chat.js, with the database
   and its live channel scripted, and the page's clock moved on by hand.
   =========================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');

let checks = 0, failures = 0;
const is = (c, m, x) => { checks++; if (c) console.log('  ✓ ' + m); else { failures++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); } };

const ME = '22222222-2222-2222-2222-222222222222';
/* The database and Realtime, scripted. LIVE says whether the channel
   connects; HANDLERS holds what each page listens to. */
const STUB = `
var ME = '${ME}';
window.LIVE = window.LIVE !== false;
window.DB = {
  convs: [ { id: 'c-1', name: 'Precious', status: 'open', last_message_at: new Date().toISOString(), shop_unread: 1, assigned_to: null, kind: null } ],
  settings: { deskSound: true, deskVolume: 5 },
  asked: { chat_conversations: 0 }
};
window.HANDLERS = [];
window.DINGS = [];
window.__hidden = false;
Object.defineProperty(document, 'hidden', { configurable: true, get: function () { return window.__hidden; } });
Object.defineProperty(document, 'visibilityState', { configurable: true, get: function () { return window.__hidden ? 'hidden' : 'visible'; } });
window.setHidden = function (h) { window.__hidden = h; document.dispatchEvent(new Event('visibilitychange')); };
function answer(v) { return new Promise(function (r) { setTimeout(function () { r(v); }, 5); }); }
function builder(table) {
  var q = { f: [] }, b = {};
  ['select','order','limit','range','gte','lte','in','neq','or','contains','is'].forEach(function (k) { b[k] = function () { return b; }; });
  b.eq = function (c, v) { q.f.push([c, v]); return b; };
  b.gt = function (c, v) { q.gt = [c, v]; return b; };
  b.maybeSingle = b.single = function () { q.one = true; return b; };
  b.insert = b.update = b.upsert = function () { q.write = true; return b; };
  b.then = function (a, c) {
    var v = { data: [], error: null };
    if (q.write) v.data = null;
    else if (table === 'chat_conversations') {
      DB.asked.chat_conversations++;
      v.data = DB.convs.filter(function (x) { return !q.gt || (Number(x[q.gt[0]]) || 0) > q.gt[1]; });
    }
    else if (table === 'site_settings') v.data = [{ data: DB.settings }];
    else if (table === 'chat_agents') v.data = [{ id: ME, display_name: 'Mwila', status: 'online', last_seen_at: new Date().toISOString() }];
    else if (table === 'admins') v.data = [{ id: ME, role: 'agent' }];
    if (q.one) v.data = (v.data || [])[0] || null;
    return answer(v).then(a, c);
  };
  return b;
}
window.__sb = {
  auth: { getSession: function () { return Promise.resolve({ data: { session: { user: { id: ME, email: 'mwila@shop.test' } } } }); } },
  from: builder,
  rpc: function () { return answer({ data: null, error: null }); },
  channel: function (name) {
    var ch = { name: name, on: function (kind, spec, fn) { HANDLERS.push({ channel: name, spec: spec, fn: fn }); return ch; },
               subscribe: function (cb) { setTimeout(function () { cb && cb(LIVE ? 'SUBSCRIBED' : 'CHANNEL_ERROR'); }, 0); return ch; } };
    return ch;
  },
  removeChannel: function () {}
};
/* A customer writes: the row is saved, and Realtime says so to whoever listens. */
window.customerWrites = function (id, name) {
  var c = DB.convs.filter(function (x) { return x.id === id; })[0];
  if (c) c.shop_unread++;
  else DB.convs.unshift({ id: id, name: name, status: 'open', last_message_at: new Date().toISOString(), shop_unread: 1, assigned_to: null, kind: null });
  if (!LIVE) return;
  HANDLERS.forEach(function (h) {
    if (h.spec && h.spec.table === 'chat_messages') h.fn({ new: { id: 'm' + Math.random(), conversation_id: id, sender: 'customer' } });
  });
};
`;
const page = (extra, body) => `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Vaultique Admin</title>
<link rel="stylesheet" href="/assets/admin/admin.css"></head><body><div class="wrap"><div id="host"></div></div>
<script>${extra || ''}</script>
<script src="/assets/formats.js"></script>
<script src="/assets/admin/registry.js"></script>
<script>${STUB}</script>
<script src="/assets/admin/chat-alerts.js"></script>
<script>(function () { var A = window.VBP_CHAT_ALERTS; A.ding = function (v) { DINGS.push(v); }; })();</script>
<script src="/assets/admin/live-chat.js"></script>
<script>${body}</script>
</body></html>`;
const CHATS_PAGE = (extra) => page(extra, "location.hash = '#/chats'; window.VBP_ADMIN.pages.chats.render(document.getElementById('host'), { sb: window.__sb, navigate: function () {} });");
const ORDERS_PAGE = (extra) => page(extra, "location.hash = '#/orders'; window.VBP_CHAT_ALERTS.watchChats(window.__sb);");

let html = '';
const server = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (p === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(html); }
  const f = path.join(ROOT, p);
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(''); }
  res.writeHead(200, { 'Content-Type': p.endsWith('.css') ? 'text/css' : 'text/javascript' });
  res.end(fs.readFileSync(f));
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch();
  const fresh = async (doc) => {
    html = doc;
    const p = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const errors = [];
    p.on('pageerror', (e) => errors.push(String(e.message || e)));
    await p.clock.install();
    await p.goto(base);
    await p.clock.runFor(1200); await p.waitForTimeout(300);
    return { p, errors };
  };
  const settle = async (p, ms) => { await p.clock.runFor(ms || 600); await p.waitForTimeout(250); await p.clock.runFor(200); await p.waitForTimeout(100); };
  const state = (p) => p.evaluate(() => ({ dings: DINGS.length, title: document.title,
    toast: (document.querySelector('.lc-chat-toast') || {}).textContent || '',
    link: (document.querySelector('.lc-chat-toast a') || {}).getAttribute ? document.querySelector('.lc-chat-toast a').getAttribute('href') : null,
    asked: DB.asked.chat_conversations }));

  try {
    console.log('\nLive Chats open, in a tab at the back');
    let { p, errors } = await fresh(CHATS_PAGE());
    await p.waitForSelector('.lc-row');
    await settle(p);
    await p.evaluate(() => setHidden(true));
    await p.evaluate(() => customerWrites('c-2', 'Mutale'));
    await settle(p);
    let s = await state(p);
    is(s.dings === 1, 'a customer writing chimes at once, though the tab is at the back', JSON.stringify(s));
    is(/^\(2\) /.test(s.title), 'and the tab says (2) straight away', s.title);
    await p.evaluate(() => customerWrites('c-2'));
    await settle(p);
    is((await state(p)).dings === 2, 'every new message chimes, not only the first');
    const before = (await state(p)).asked;
    await p.evaluate(() => setHidden(false));
    await settle(p, 300);
    is((await state(p)).asked > before, 'coming back to the tab fetches what is new at once, not at the next beat');
    is(errors.length === 0, 'no errors on the page' + (errors.length ? ': ' + errors[0] : ''));
    await p.close();

    console.log('\nThe same, with the live channel down');
    ({ p, errors } = await fresh(CHATS_PAGE('window.LIVE = false;')));
    await p.waitForSelector('.lc-row');
    await settle(p);
    await p.evaluate(() => setHidden(true));
    await p.evaluate(() => customerWrites('c-3', 'Bwalya'));
    await settle(p, 32000);
    s = await state(p);
    is(s.dings === 1 && /^\(2\) /.test(s.title), 'a tab at the back still finds the message within half a minute, and chimes', JSON.stringify(s));
    await p.close();

    console.log('\nWorking in Orders');
    ({ p, errors } = await fresh(ORDERS_PAGE()));
    await settle(p);
    s = await state(p);
    is(s.dings === 0 && /^\(1\) /.test(s.title), 'what was already waiting is counted in the tab, without a chime', JSON.stringify(s));
    await p.evaluate(() => customerWrites('c-4', 'Natasha'));
    await settle(p);
    s = await state(p);
    is(s.dings === 1, 'a customer writing chimes on the Orders page too', JSON.stringify(s));
    is(/Natasha wrote in the chat/.test(s.toast) && s.link === '#/chats/c-4', 'with a note in the corner: who, and the way to the chat', JSON.stringify(s));
    is(/^\(2\) /.test(s.title), 'and the tab count goes up', s.title);
    await p.evaluate(() => setHidden(true));
    await p.evaluate(() => customerWrites('c-4'));
    await settle(p);
    is((await state(p)).dings === 2, 'in the background as well');
    await p.evaluate(() => { location.hash = '#/chats'; });
    await settle(p);
    await p.evaluate(() => customerWrites('c-5', 'Kondwani'));
    await settle(p);
    is((await state(p)).dings === 2, 'on Live Chats it stays quiet, because the panel says so itself');
    await p.evaluate(() => { location.hash = '#/orders'; });
    await settle(p);
    is((await state(p)).dings === 2, 'and coming back to Orders does not chime for what was already there');
    is(errors.length === 0, 'no errors on the page' + (errors.length ? ': ' + errors[0] : ''));
    await p.close();

    console.log('\nWith the desk sound switched off, and the live channel down');
    ({ p, errors } = await fresh(ORDERS_PAGE('window.LIVE = false;') .replace('settings: { deskSound: true, deskVolume: 5 }', 'settings: { deskSound: false }')));
    await settle(p);
    await p.evaluate(() => customerWrites('c-6', 'Chilufya'));
    await settle(p, 31000);
    s = await state(p);
    is(s.dings === 0 && /Chilufya wrote in the chat/.test(s.toast) && /^\(2\) /.test(s.title),
       'no sound, as the shop chose, but the note and the count still come, within half a minute', JSON.stringify(s));
    await p.close();
  } catch (e) {
    is(false, 'the test itself broke', e && e.stack);
  } finally {
    await browser.close(); server.close();
  }
  console.log(failures ? '\n  ✗ ' + failures + ' of ' + checks + ' checks FAILED' : '\n  being told a customer wrote: all ' + checks + ' checks passed');
  process.exit(failures ? 1 : 0);
})();
