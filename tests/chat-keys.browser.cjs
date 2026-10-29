/* ===========================================================================
   THE SHOP'S OWN NOTIFICATION KEYS -- assets/admin/chat-alerts.js, build 76

   Up to build 75 every copy of the website shipped the same key pair for
   phone notifications, so anybody holding any copy could sign one.
   supabase-hardening.sql retires that pair; the owner's own browser makes
   the new one, and every device moves to it. Run in a real browser (its
   own cryptography makes the pair), with the database and the browser's
   push service scripted, and the pair then used by the very code that
   signs each notification (netlify/functions/chat-push.js).
   =========================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');

let checks = 0, failures = 0;
const is = (c, m, x) => { checks++; if (c) console.log('  ✓ ' + m); else { failures++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); } };

/* The database, and a push service that hands out subscriptions tied to
   the key they were made with, as a real one does. */
const STUB = `
window.DB = { pub: '', priv: '', owner: true, keyErr: null, setCalls: 0, saves: [] };
window.sb = { rpc: function (name, args) {
  return new Promise(function (r) { setTimeout(function () {
    if (name === 'chat_push_key') {
      return r(DB.keyErr ? { data: null, error: { message: DB.keyErr } } : { data: DB.pub || null, error: null });
    }
    if (name === 'chat_push_keys_set') {
      DB.setCalls++;
      if (!DB.owner) return r({ data: null, error: { message: 'Only the shop owner can set up the notification keys.' } });
      if (!/^[A-Za-z0-9_-]{87}$/.test(args.p_public) || !/^[A-Za-z0-9_-]{43}$/.test(args.p_private)) {
        return r({ data: null, error: { message: 'Those are not notification keys.' } });
      }
      if (DB.pub) return r({ data: false, error: null });
      DB.pub = args.p_public; DB.priv = args.p_private;
      return r({ data: true, error: null });
    }
    if (name === 'chat_push_save') { DB.saves.push(args); return r({ data: null, error: null }); }
    if (name === 'chat_push_drop') return r({ data: null, error: null });
    r({ data: null, error: { message: 'Could not find the function public.' + name + ' in the schema cache' } });
  }, 2); }); } };

window.PUSH = { current: null, made: 0, dropped: 0 };
function b64(buf) {
  var b = new Uint8Array(buf), s = '';
  for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
}
function subscription(keyBytes) {
  var n = ++PUSH.made;
  var s = {
    endpoint: 'https://push.example/' + n,
    options: { applicationServerKey: keyBytes ? new Uint8Array(keyBytes).buffer : null },
    toJSON: function () { return { endpoint: s.endpoint, keys: { p256dh: 'p' + n, auth: 'a' + n } }; },
    getKey: function () { return new Uint8Array([1, 2, 3]).buffer; },
    unsubscribe: function () { if (PUSH.current === s) PUSH.current = null; PUSH.dropped++; return Promise.resolve(true); }
  };
  return s;
}
window.subscribedWith = function (key) {   // a device signed up earlier, to a given key
  var raw = atob((key + '='.repeat((4 - key.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  var bytes = new Uint8Array(raw.length);
  for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  PUSH.current = subscription(bytes);
  return PUSH.current.endpoint;
};
window.currentKey = function () {
  return PUSH.current && PUSH.current.options.applicationServerKey ? b64(PUSH.current.options.applicationServerKey) : null;
};
var reg = { pushManager: {
  getSubscription: function () { return Promise.resolve(PUSH.current); },
  subscribe: function (o) { PUSH.current = subscription(o.applicationServerKey); return Promise.resolve(PUSH.current); }
} };
Object.defineProperty(navigator, 'serviceWorker', { configurable: true,
  value: { register: function () { return Promise.resolve(reg); }, ready: Promise.resolve(reg) } });
Object.defineProperty(Notification, 'permission', { configurable: true, get: function () { return 'granted'; } });
Notification.requestPermission = function () { return Promise.resolve('granted'); };
`;

const PAGE = '<!doctype html><meta charset="utf-8"><title>keys</title><script src="/assets/admin/chat-alerts.js"></script>';

const server = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (p === '/' ) { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(PAGE); }
  if (p === '/assets/admin/chat-alerts.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    return res.end(fs.readFileSync(path.join(ROOT, p)));
  }
  res.writeHead(404); res.end();
});

/* A key pair the way the old builds shipped one: made somewhere else. */
function oldPair() {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const j = privateKey.export({ format: 'jwk' });
  return Buffer.concat([Buffer.from([4]), Buffer.from(j.x, 'base64url'), Buffer.from(j.y, 'base64url')]).toString('base64url');
}

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(STUB);
    await page.goto(base + '/');
    await page.waitForFunction(() => !!window.VBP_CHAT_ALERTS);
    const run = (fn, arg) => page.evaluate(fn, arg);
    const reset = (o) => run((o) => { Object.assign(DB, { pub: '', priv: '', owner: true, keyErr: null, setCalls: 0, saves: [] }, o || {});
                                      PUSH.current = null; PUSH.made = 0; PUSH.dropped = 0; }, o);

    console.log('\nThe owner opens Live Chats after the hardening');
    await reset();
    const key = await run(() => VBP_CHAT_ALERTS.ensureKeys(sb));
    const db = await run(() => ({ pub: DB.pub, priv: DB.priv, calls: DB.setCalls }));
    is(key && key === db.pub && db.calls === 1, 'the browser makes a pair and the database keeps it', JSON.stringify(db));
    is(/^[A-Za-z0-9_-]{87}$/.test(db.pub) && /^[A-Za-z0-9_-]{43}$/.test(db.priv),
       'in the form browsers and the database expect (a P-256 public key, and its private half)');

    /* The pair has to work with the code that signs every notification. */
    const { vapidHeader } = require(path.join(ROOT, 'netlify', 'functions', 'chat-push'))._internals;
    const header = vapidHeader('https://fcm.googleapis.com/fcm/send/abc',
                               { vapidPublic: db.pub, vapidPrivate: db.priv, siteUrl: 'https://shop.example' });
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
    let verified = false, claim = {};
    if (m) {
      const pub = Buffer.from(m[4], 'base64url');
      const pk = crypto.createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256',
        x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33, 65).toString('base64url') } });
      verified = crypto.verify('sha256', Buffer.from(m[1] + '.' + m[2]), { key: pk, dsaEncoding: 'ieee-p1363' },
                               Buffer.from(m[3], 'base64url'));
      claim = JSON.parse(Buffer.from(m[2], 'base64url').toString('utf8'));
    }
    is(verified, 'a notification signed with it checks out against its public half, as a push service checks it');
    is(claim.sub === 'https://shop.example', 'and names the website as the shop\'s contact, not anybody\'s email', JSON.stringify(claim));

    const again = await run(() => VBP_CHAT_ALERTS.ensureKeys(sb).then((k) => ({ k, calls: DB.setCalls })));
    is(again.k === key && again.calls === 1, 'opening Live Chats again keeps the same pair: nothing is made twice');

    console.log('\nSomebody else, before the owner has');
    await reset({ owner: false });
    const refused = await run(() => VBP_CHAT_ALERTS.ensureKeys(sb).then(() => 'made', (e) => e.message));
    is(/owner/.test(refused) && /Live Chats/.test(refused), 'is told the owner has to open Live Chats first', refused);
    is(await run(() => DB.pub === ''), 'and nothing is stored');
    const pressed = await run(() => VBP_CHAT_ALERTS.enable(sb).then(() => 'on', (e) => e.message));
    is(/owner/.test(pressed) && await run(() => PUSH.current === null),
       '"Notify me here" says the same, and signs nothing up to a key that does not exist', pressed);

    console.log('\nA device signed up to the retired pair');
    await reset();
    const retired = oldPair();
    await run((k) => subscribedWith(k), retired);
    let r = await run(() => VBP_CHAT_ALERTS.refresh(sb).then((ok) => ({ ok, on: !!PUSH.current, saves: DB.saves.length })));
    is(r.ok === false && !r.on && r.saves === 0,
       'before the owner has made the new pair, it is let go rather than kept looking "on" while it can never buzz', JSON.stringify(r));
    const state = await run(() => VBP_CHAT_ALERTS.state());
    is(state.can && !state.on, 'so the button says "Notify me here" again');

    await reset();
    await run(() => VBP_CHAT_ALERTS.ensureKeys(sb));
    const shopKey = await run(() => DB.pub);
    const oldEndpoint = await run((k) => subscribedWith(k), retired);
    r = await run(() => VBP_CHAT_ALERTS.refresh(sb).then((ok) => ({ ok, key: currentKey(), saves: DB.saves.map((s) => s.p_endpoint) })));
    is(r.ok === true && r.key === shopKey, 'after it, opening Live Chats moves the device to the shop\'s key, asking nobody anything', JSON.stringify(r));
    is(r.saves.length === 1 && r.saves[0] !== oldEndpoint, 'and the database is given the new sign-up, not the dead one');

    await reset();
    await run(() => VBP_CHAT_ALERTS.ensureKeys(sb));
    await run((k) => subscribedWith(k), retired);
    r = await run(() => VBP_CHAT_ALERTS.enable(sb).then(() => ({ key: currentKey(), dropped: PUSH.dropped, saves: DB.saves.length })));
    is(r.key === (await run(() => DB.pub)) && r.dropped === 1 && r.saves === 1,
       'pressing "Notify me here" on it does the same: the old sign-up goes, a new one is made and saved', JSON.stringify(r));

    console.log('\nA device already on the shop\'s key');
    const made = await run(() => PUSH.made);
    r = await run(() => VBP_CHAT_ALERTS.refresh(sb).then((ok) => ({ ok, made: PUSH.made, saves: DB.saves.length })));
    is(r.ok === true && r.made === made && r.saves === 2, 'is left as it is, and only written again (the usual upkeep)', JSON.stringify(r));
    await run(() => { DB.keyErr = 'network down'; });
    r = await run(() => VBP_CHAT_ALERTS.refresh(sb).then((ok) => ({ ok, on: !!PUSH.current, made: PUSH.made })));
    is(r.on && r.made === made, 'and when the database cannot be asked, nothing is torn down');

    console.log('\nOlder database');
    await reset({ keyErr: 'Could not find the function public.chat_push_key without parameters in the schema cache' });
    const msg = await run(() => VBP_CHAT_ALERTS.ensureKeys(sb).then(() => '', (e) => e.message));
    is(/supabase-chat-phase7\.sql/.test(msg), 'before phase 7, it says which file to run', msg);

    is(!errors.length, 'no errors on the page', errors.join(' | '));
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failures ? '\n  ✗ ' + failures + ' of ' + checks + ' checks FAILED' : '\n  the shop\'s own notification keys: all ' + checks + ' checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('  ✗ the test itself failed: ' + (e && e.stack || e)); process.exit(1); });
