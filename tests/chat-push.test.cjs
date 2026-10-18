/* ===========================================================================
   THE PHONE BUZZ, AS IT LEAVES -- netlify/functions/chat-push.js

   THE OWNER: "chat notifications ... come late on my side long after the
   customer is gone."

   The push left the shop at once, but marked "normal", and a resting Android
   phone holds normal pushes back and hands them over later in a batch. Run
   here against a push service of its own, this checks what every push now
   carries: Urgency: high, so the phone is woken; one Topic per conversation,
   so a phone that was off gets the newest message rather than a backlog; and
   a body that still decrypts, with the browser's own key, to what was meant.
   =========================================================================== */
const http = require('http');
const path = require('path');
const crypto = require('crypto');
let checks = 0, failures = 0;
const is = (c, m, x) => { checks++; if (c) console.log('  ✓ ' + m); else { failures++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); } };

/* A browser's subscription: its key pair, and the secret it shares. */
const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
const authSecret = crypto.randomBytes(16);
/* The shop's VAPID key pair, as the migration makes one. */
const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const jwk = privateKey.export({ format: 'jwk' });
const vapidPublic = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url');

let chatSettings = {};
const pushes = [];
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), p = u.pathname;
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const send = (o, st) => { res.writeHead(st || 200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (p.indexOf('/push/') === 0) { pushes.push({ headers: req.headers, body: Buffer.concat(chunks) }); res.writeHead(201); return res.end(); }
    if (p.endsWith('/site_settings_private')) return send([{ data: { vapidPrivate: jwk.d, vapidPublic, secret: 'hook', subject: 'mailto:shop@test' } }]);
    if (p.endsWith('/chat_conversations')) {
      const id = (u.searchParams.get('id') || '').replace('eq.', '');
      return send([{ id, name: id === 'c1' ? 'Precious' : 'Mutale', assigned_to: null, status: 'open' }]);
    }
    if (p.endsWith('/site_settings')) return send([{ data: chatSettings }]);
    if (p.endsWith('/chat_messages')) return send([{ body: 'Is the black tote still available in Livingstone?' }]);
    if (p.endsWith('/chat_notes')) return send([{ author_id: 'a1', body: '@you can you take this', mentions: ['11111111-1111-1111-1111-111111111111'] }]);
    if (p.endsWith('/chat_agents')) return send([{ display_name: 'Mwila' }]);
    if (p.endsWith('/chat_push') && req.method === 'GET') {
      return send([{ id: 1, endpoint: 'http://127.0.0.1:' + server.address().port + '/push/a',
                     p256dh: ua.getPublicKey().toString('base64url'), auth: authSecret.toString('base64url'), fails: 0 }]);
    }
    send([]);
  });
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  Object.assign(process.env, { WEB_SUPABASE_URL: base, WEB_SUPABASE_ANON_KEY: 'a', SUPABASE_SERVICE_ROLE_KEY: 'svc' });
  const mod = require(path.join(__dirname, '..', 'netlify', 'functions', 'chat-push'));
  const { hkdf, label } = mod._internals;
  const call = (b) => mod.handler({ httpMethod: 'POST', headers: { 'x-chat-hook': 'hook' }, body: JSON.stringify(b) });

  /* What the phone's browser does with what arrives (RFC 8291). */
  function open(buf) {
    const salt = buf.subarray(0, 16);
    const idlen = buf.readUInt8(20);
    const asPublic = buf.subarray(21, 21 + idlen);
    const data = buf.subarray(21 + idlen);
    const shared = ua.computeSecret(asPublic);
    const ikm = hkdf(authSecret, shared, Buffer.concat([label('WebPush: info'), ua.getPublicKey(), asPublic]), 32);
    const cek = hkdf(salt, ikm, label('Content-Encoding: aes128gcm'), 16);
    const nonce = hkdf(salt, ikm, label('Content-Encoding: nonce'), 12);
    const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
    d.setAuthTag(data.subarray(data.length - 16));
    const plain = Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
    return JSON.parse(plain.subarray(0, plain.lastIndexOf(2)).toString('utf8'));
  }

  try {
    console.log('\nA customer writes');
    let r = await call({ kind: 'message', conversation: 'c1', message: 'm1' });
    is(r.statusCode === 200 && JSON.parse(r.body).sent === 1, 'the push is sent', r.body);
    const first = pushes[0] || { headers: {} };
    is(first.headers.urgency === 'high', 'marked Urgency: high, so a resting phone is woken now rather than later', first.headers.urgency);
    is(/^[A-Za-z0-9_-]{1,32}$/.test(first.headers.topic || ''), 'with a Topic the push services accept', first.headers.topic);
    is(first.headers.ttl === '86400' && /^vapid t=/.test(first.headers.authorization || ''), 'still with its time to live and the shop\'s signature');
    const said = open(first.body);
    is(said.title === 'Precious wrote to the shop' && /black tote/.test(said.body) && said.tag === 'chat-c1',
       'and it still opens, with the phone\'s own key, to what the customer wrote', JSON.stringify(said));

    console.log('\nThe same customer again, and somebody else');
    await call({ kind: 'message', conversation: 'c1', message: 'm2' });
    await call({ kind: 'message', conversation: 'c2', message: 'm3' });
    is(pushes[1].headers.topic === first.headers.topic, 'a second message in the same chat has the same Topic, so a backlog becomes the newest one');
    is(pushes[2].headers.topic !== first.headers.topic, 'another customer\'s chat has its own, and is never swallowed');

    console.log('\nA mention');
    await call({ kind: 'mention', conversation: 'c1', note: 'n1' });
    const m = pushes[3] || { headers: {} };
    is(m.headers.urgency === 'high' && m.headers.topic && m.headers.topic !== first.headers.topic,
       'is urgent too, and not swallowed by the customer\'s next message', JSON.stringify(m.headers.topic));

    console.log('\nWith previews switched off');
    chatSettings = { pushPreview: false };
    await call({ kind: 'message', conversation: 'c1', message: 'm4' });
    is(open(pushes[4].body).body === 'Tap to answer.', 'the message itself stays off the lock screen');
  } catch (e) { is(false, 'threw: ' + (e && e.stack)); }
  server.close();
  console.log(failures ? '\n  ✗ ' + failures + ' of ' + checks + ' checks FAILED' : '\n  the phone buzz: all ' + checks + ' checks passed');
  process.exit(failures ? 1 : 0);
})();
