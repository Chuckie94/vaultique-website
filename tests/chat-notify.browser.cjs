/* ===========================================================================
   TELLING THE CUSTOMER THE SHOP HAS REPLIED -- the chat window, in a browser

   THE OWNER (build 83): "the customer who opens a chat should be able to
   receive a notification when there is a response", and "also notify if the
   customer closed the chat but did not end it and the shop responds to the
   message within an hour".

   In the chat, after the first message: "Get a notification when we reply?"
   and Notify me, which asks the browser's permission and gives the browser's
   notification address to the database for this conversation
   (chat_reply_push_save). Closing the window while still waiting offers it
   again, by the chat button. A reply that arrives while the window is closed
   shows as a note there and as the count in the tab. Tapping the
   notification opens the chat (/?chat=open). The hour is the notification
   function's to keep (tests/chat-push.test.cjs).

   The real index.html and assets/chat.js; the website's Supabase is answered
   here. The browser's push service is a stand-in: a test browser has none.
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

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/json' };
const KEY = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
const TOKEN = 'tok-notify-000000000001';
let CHAT = {}, POLL = null, CALLS = [], ON_LIST = false, KEY_THERE = true;
const body = req => new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => r(d)); });

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'), p = u.pathname;
  const json = (o, st) => { res.writeHead(st || 200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (p === '/api/products') return json({ products: [], count: 0, version: 'n' });
  if (p.indexOf('/rest/v1/rpc/') === 0) {
    const fn = p.slice('/rest/v1/rpc/'.length);
    let args = {}; try { args = JSON.parse(await body(req) || '{}'); } catch (e) {}
    CALLS.push({ fn, args });
    if (fn === 'chat_start') return json(TOKEN);
    if (fn === 'chat_poll') return json(POLL);
    if (fn === 'chat_reply_push_key') return KEY_THERE ? json(KEY) : json({ message: 'Could not find the function' }, 404);
    if (fn === 'chat_reply_push_save') { ON_LIST = args.p_token === TOKEN && /^https:/.test(args.p_endpoint); return json(ON_LIST); }
    if (fn === 'chat_reply_push_has') return json(ON_LIST);
    if (fn === 'chat_reply_push_drop') { ON_LIST = false; return json(null); }
    return json(null);
  }
  if (p === '/rest/v1/site_settings') {
    const key = (u.searchParams.get('key') || '').replace('eq.', '');
    return json(key === 'chat' ? [{ data: CHAT }] : []);
  }
  if (p.indexOf('/rest/v1/') === 0) return json([]);
  if (p === '/config.js') {
    res.writeHead(200, { 'Content-Type': TYPES['.js'] });
    return res.end('window.VBP_CONFIG={SUPABASE_URL:"http://127.0.0.1:' + server.address().port + '",SUPABASE_ANON_KEY:"k"};');
  }
  if (p.indexOf('/.netlify/') === 0) return json({});
  let file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});

/* The browser's side of push, standing in for a push service a test browser
   does not have: a service worker registration whose push manager hands out
   one subscription, and remembers what it was asked. */
const PUSH_STANDIN = () => {
  const sub = {
    endpoint: 'https://push.example/send/abc123',
    toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'BP256dh-test-key-0123456789abcdef', auth: 'auth-test-1234' } }; }
  };
  window.__push = { subscribeKeyLength: 0, unsubscribed: false, registered: 0, asked: 0 };
  /* A browser already subscribed before the customer pressed anything:
     the shop's own phone (Live Chats > Notify me here), with the shop's
     key as it is now, or with a pair since retired. */
  let current = null;
  const had = window.__existing;
  if (had) {
    const b64 = had.key.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - had.key.length % 4) % 4);
    const raw = atob(b64), bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    current = {
      endpoint: had.endpoint, options: { applicationServerKey: bytes.buffer },
      toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'BP256dh-old-key-0123456789abcdef', auth: 'auth-old-1234' } }; },
      unsubscribe: () => { window.__push.unsubscribed = true; current = null; return Promise.resolve(true); }
    };
  }
  /* A headless browser answers "denied" to everything; this one asks, and
     the customer says yes. */
  let perm = 'default';
  const N = function () {};
  Object.defineProperty(N, 'permission', { get: () => perm });
  N.requestPermission = (cb) => { window.__push.asked++; perm = 'granted'; if (cb) cb(perm); return Promise.resolve(perm); };
  window.Notification = N;
  const reg = { pushManager: {
    getSubscription: () => Promise.resolve(current),
    subscribe: (o) => {
      window.__push.subscribeKeyLength = o && o.applicationServerKey ? o.applicationServerKey.length : 0;
      current = Object.assign({ unsubscribe: () => { window.__push.unsubscribed = true; return Promise.resolve(true); } }, sub);
      return Promise.resolve(current);
    } } };
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {
    register: () => { window.__push.registered++; return Promise.resolve(reg); },
    ready: Promise.resolve(reg),
    getRegistration: () => Promise.resolve(reg),
    addEventListener: () => {}, removeEventListener: () => {}
  } });
};
const NO_PUSH = () => { try { delete window.PushManager; } catch (e) {} window.PushManager = undefined; };

const shopSays = (text, minutesAgo) => ({ id: 's-' + text.length, sender: 'shop', body: text,
  at: new Date(Date.now() - (minutesAgo || 0) * 60000).toISOString() });
const theyAsked = { id: 'c-1', sender: 'customer', body: 'Do you have the tote in tan?', at: new Date(Date.now() - 60000).toISOString() };

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const errors = [];

  async function open(chat, opts) {
    opts = opts || {};
    CHAT = Object.assign({ enabled: true, askName: false }, chat || {});
    POLL = { status: 'open', unread: 0, named: true, seen: false, here: false, typing: false, messages: [theyAsked] };
    CALLS = []; ON_LIST = false; KEY_THERE = opts.keyThere !== false;
    const SHOTS = process.env.SHOTS_DIR || '';
    const WIDE = process.env.SHOTS_WIDE === '1';
    const ctx = await browser.newContext(SHOTS ? (WIDE ? { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }
                                                       : { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
                                               : { viewport: { width: 1200, height: 900 } });
    await ctx.grantPermissions(['notifications'], { origin: base });
    if (opts.existing) await ctx.addInitScript(e => { window.__existing = e; }, opts.existing);
    await ctx.addInitScript(opts.noPush ? NO_PUSH : PUSH_STANDIN);
    if (opts.memo) await ctx.addInitScript(t => localStorage.setItem('vbp_chat', JSON.stringify({ token: t, at: Date.now() })), TOKEN);
    await ctx.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await ctx.route('**/fonts.gstatic.com/**', r => r.fulfill({ status: 200, body: '' }));
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(String(e.message || e)));
    await page.goto(base + (opts.path || '/'), { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    return { ctx, page };
  }
  async function write(page, text) {
    await page.click('#chatFab');
    await page.fill('#chatInput', text);
    await page.press('#chatInput', 'Enter');
    await page.waitForTimeout(1200);
  }
  const bar = page => page.evaluate(() => {
    const b = document.getElementById('chatNotify');
    return b && b.style.display !== 'none' ? b.textContent.replace(/\s+/g, ' ').trim() : '';
  });
  const toastText = page => page.evaluate(() => {
    const t = document.getElementById('chatToast');
    return t && t.classList.contains('in') ? t.textContent.replace(/\s+/g, ' ').trim() : '';
  });
  const called = fn => CALLS.filter(c => c.fn === fn);

  try {
    console.log('\nIn the chat, after the first message');
    let { ctx, page } = await open();
    is(!(await bar(page)), 'nothing is offered before the customer has written');
    await write(page, 'Do you have the tote in tan?');
    let b = await bar(page);
    is(/Get a notification when we reply\?/.test(b) && /Notify me/.test(b), 'then: "Get a notification when we reply?" and Notify me', b);
    if (process.env.SHOTS_DIR) await page.screenshot({ path: path.join(process.env.SHOTS_DIR, 'notify-in-chat.png') });
    await page.click('#chatNotify .chat-ask-ok');
    await page.waitForFunction(() => /We will send you a notification/.test((document.getElementById('chatNotify') || {}).textContent || ''),
      null, { timeout: 5000 });
    const saved = called('chat_reply_push_save')[0] || { args: {} };
    const key = await page.evaluate(() => window.__push.subscribeKeyLength);
    is(saved.args.p_token === TOKEN && saved.args.p_endpoint === 'https://push.example/send/abc123' &&
       saved.args.p_p256dh && saved.args.p_auth && key === 65,
       'pressed, the browser is subscribed with the shop\'s key and its address saved for this conversation', J([saved.args, key]));
    b = await bar(page);
    is(/We will send you a notification when we reply/.test(b) && /Turn off/.test(b), 'and the line says so, with Turn off', b);
    const memo = await page.evaluate(() => JSON.parse(localStorage.getItem('vbp_chat') || 'null'));
    is(memo && memo.notify === true, 'this browser keeps the conversation while it waits for the reply', J(memo));
    await page.click('#chatNotify .chat-ask-no');
    await page.waitForFunction(() => /Get a notification when we reply/.test((document.getElementById('chatNotify') || {}).textContent || ''),
      null, { timeout: 5000 });
    const unsub = await page.evaluate(() => window.__push.unsubscribed);
    is(called('chat_reply_push_drop').length === 1 && !unsub,
       'Turn off takes this browser off the list, and leaves the browser\'s own subscription alone (the shop\'s phone may use it)', J({ unsub }));
    await ctx.close();

    console.log('\nA phone that already has the shop\'s own notifications');
    ({ ctx, page } = await open({}, { existing: { key: KEY, endpoint: 'https://push.example/send/shop-phone' } }));
    await write(page, 'Is the tote still in stock?');
    await page.click('#chatNotify .chat-ask-ok');
    await page.waitForFunction(() => /We will send you a notification/.test((document.getElementById('chatNotify') || {}).textContent || ''),
      null, { timeout: 5000 });
    let st = await page.evaluate(() => window.__push);
    let sv = called('chat_reply_push_save')[0] || { args: {} };
    is(sv.args.p_endpoint === 'https://push.example/send/shop-phone' && !st.unsubscribed && st.subscribeKeyLength === 0,
       'made with the shop\'s key as it is now: that same subscription is used, and the shop\'s own left alone', J([sv.args, st]));
    await ctx.close();
    ({ ctx, page } = await open({}, { existing: { key: Buffer.alloc(65, 7).toString('base64url'), endpoint: 'https://push.example/send/old-pair' } }));
    await write(page, 'Is the tote still in stock?');
    await page.click('#chatNotify .chat-ask-ok');
    await page.waitForFunction(() => /We will send you a notification/.test((document.getElementById('chatNotify') || {}).textContent || ''),
      null, { timeout: 5000 });
    st = await page.evaluate(() => window.__push);
    sv = called('chat_reply_push_save')[0] || { args: {} };
    is(st.unsubscribed && st.subscribeKeyLength === 65 && sv.args.p_endpoint === 'https://push.example/send/abc123',
       'made with a pair since retired, which could never be reached: replaced with one on the shop\'s key, and that one saved', J([sv.args, st]));
    await ctx.close();

    console.log('\nClosed, not ended, while still waiting for an answer');
    ({ ctx, page } = await open());
    await write(page, 'Is it still in stock?');
    await page.click('#chatMin');
    await page.waitForTimeout(300);
    let t = await toastText(page);
    is(/We will reply here soon\. Get a notification when we do\?/.test(t) && /Notify me/.test(t),
       'closing the chat offers the notification by the chat button', t);
    if (process.env.SHOTS_DIR) await page.screenshot({ path: path.join(process.env.SHOTS_DIR, 'notify-on-close.png') });
    await page.click('#chatToast .chat-ask-ok');
    await page.waitForFunction(() => /Done\. We will send you a notification/.test((document.getElementById('chatToast') || {}).textContent || ''),
      null, { timeout: 5000 });
    is(called('chat_reply_push_save').length === 1, 'and Notify me there does the same', J(called('chat_reply_push_save')));

    console.log('\nThe shop replies while the chat is closed');
    POLL = Object.assign({}, POLL, { unread: 1, messages: [theyAsked, shopSays('Yes, in tan and black.')] });
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForFunction(() => /We have replied to your message/.test((document.getElementById('chatToast') || {}).textContent || ''),
      null, { timeout: 6000 });
    t = await toastText(page);
    const title = await page.title();
    is(/We have replied to your message\./.test(t) && /Open chat/.test(t), 'a note by the chat button says the shop has replied', t);
    is(/^\(1\) /.test(title), 'and the tab says (1)', title);
    if (process.env.SHOTS_DIR) await page.screenshot({ path: path.join(process.env.SHOTS_DIR, 'notify-reply-note.png') });
    await page.click('#chatToast .chat-ask-ok');
    await page.waitForTimeout(600);
    const after = await page.evaluate(() => ({ open: document.getElementById('chatPanel').classList.contains('open'),
      title: document.title, toast: (document.getElementById('chatToast') || {}).className }));
    is(after.open && !/^\(\d+\)/.test(after.title) && !/\bin\b/.test(after.toast),
       'Open chat opens it, and the count goes from the tab', J(after));
    await ctx.close();

    console.log('\nTapping the notification');
    ({ ctx, page } = await open({}, { memo: true, path: '/?chat=open' }));
    await page.waitForTimeout(400);
    const tapped = await page.evaluate(() => ({ open: document.getElementById('chatPanel').classList.contains('open'), search: location.search }));
    is(tapped.open && tapped.search === '', 'opens the website with the conversation showing, and the address tidied', J(tapped));
    await ctx.close();

    console.log('\nWhen it is not offered');
    ({ ctx, page } = await open({ replyPush: false }));
    await write(page, 'Hello');
    await page.click('#chatMin'); await page.waitForTimeout(300);
    is(!(await bar(page)) && !(await toastText(page)), 'switched off in Settings > Live Chat: no offer anywhere');
    await ctx.close();
    ({ ctx, page } = await open({}, { noPush: true }));
    await write(page, 'Hello');
    await page.click('#chatMin'); await page.waitForTimeout(300);
    is(!(await bar(page)) && !(await toastText(page)), 'a browser that cannot be told with the website shut: no offer, no broken button');
    await ctx.close();
    ({ ctx, page } = await open({}, { keyThere: false }));
    await write(page, 'Hello');
    is(!(await bar(page)), 'before supabase-chat-reply-push.sql is run: no offer');
    await ctx.close();

    is(errors.length === 0, 'no errors on the page', errors.slice(0, 3).join(' | '));
  } catch (e) {
    fail('the test itself broke', e && e.stack);
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failures ? '\n  ✗ ' + failures + ' of ' + checks + ' checks FAILED'
                       : '\n  telling the customer the shop has replied: all ' + checks + ' checks passed');
  process.exit(failures ? 1 : 0);
})();
