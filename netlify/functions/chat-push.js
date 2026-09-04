/* =====================================================================
   Vaultique Boutique Point — making the phone buzz
   ---------------------------------------------------------------------
   The database calls this when a customer writes, or when a conversation
   is handed to somebody. It works out who ought to know, and sends each
   of their devices a push.

   WHY IT IS WRITTEN OUT BY HAND. Web Push is two specifications — RFC
   8291 for the encryption and RFC 8292 for proving the shop sent it —
   and both are short. This package ships no dependencies at all;
   send-email.js speaks SMTP down a raw socket for the same reason. A
   library here would be one more thing to keep up to date for eighty
   lines of arithmetic.

   WHAT IS ENCRYPTED AND TO WHOM. The message is encrypted to a key that
   only the subscribing browser holds. Google's and Mozilla's push
   services carry it and cannot read it. Neither can Netlify's logs: the
   body is ciphertext by the time it leaves here.

   WHO MAY CALL IT. Only the database, which sends a secret in a header.
   That secret lives in site_settings_private — a table with no public
   read policy — and this function reads it with the service role key.
   Nobody has to copy it into two places, so nobody can get it wrong in
   one of them.
   ===================================================================== */
const crypto = require('crypto');
const { readConfig } = require('./_seo-data');

const TTL = 86400;                 // a day. Longer than any shift.
const RECORD_SIZE = 4096;

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body)
  };
}

const b64u = (b) => Buffer.from(b).toString('base64url');
const unb64u = (s) => Buffer.from(String(s), 'base64url');

/* ------------------------------------------------------------ the shop */
function site() {
  const { url, key } = readConfig();
  return { url: String(url || '').replace(/\/+$/, ''), key };
}

function db(cfgUrl, serviceKey, path, init) {
  return fetch(`${cfgUrl}/rest/v1/${path}`, Object.assign({
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json'
    }
  }, init || {}));
}

/* ------------------------------------------------------- RFC 8291, §3.3
   One HKDF step. Web Push never asks for more than 32 bytes, so the
   expand loop that a general implementation needs is one block here. */
function hkdf(salt, ikm, info, len) {
  const prk = crypto.createHmac('sha256', salt).update(ikm).digest();
  const okm = crypto.createHmac('sha256', prk)
    .update(Buffer.concat([info, Buffer.from([1])])).digest();
  return okm.subarray(0, len);
}

const label = (s) => Buffer.concat([Buffer.from(s, 'ascii'), Buffer.from([0])]);

/* The body of one push, encrypted to one browser.

   sub.p256dh is that browser's public key and sub.auth is a secret it
   shares with us alone; both came from the browser when it subscribed.
   A fresh key pair is made for every message, which is what stops two
   pushes to the same device from being linkable by anyone watching. */
function encrypt(plaintext, sub) {
  const uaPublic = unb64u(sub.p256dh);          // 65 bytes, 0x04 || x || y
  const authSecret = unb64u(sub.auth);          // 16 bytes

  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();         // ours, sent in the clear
  const shared = ecdh.computeSecret(uaPublic);

  const keyInfo = Buffer.concat([label('WebPush: info'), uaPublic, asPublic]);
  const ikm = hkdf(authSecret, shared, keyInfo, 32);

  const salt = crypto.randomBytes(16);
  const cek = hkdf(salt, ikm, label('Content-Encoding: aes128gcm'), 16);
  const nonce = hkdf(salt, ikm, label('Content-Encoding: nonce'), 12);

  /* 0x02 marks the last record. One record is all we ever send: a push
     payload the services will carry is far smaller than one block. */
  const padded = Buffer.concat([Buffer.from(plaintext, 'utf8'), Buffer.from([2])]);
  const gcm = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([gcm.update(padded), gcm.final(), gcm.getAuthTag()]);

  const header = Buffer.alloc(5);
  header.writeUInt32BE(RECORD_SIZE, 0);
  header.writeUInt8(asPublic.length, 4);

  return Buffer.concat([salt, header, asPublic, body]);
}

/* ------------------------------------------------------- RFC 8292, §2
   Proof that this shop sent it, signed with the key pair the migration
   put in the database. The audience is the push service's own origin,
   so a token taken from one is no use at another. */
function vapidHeader(endpoint, keys) {
  const aud = new URL(endpoint).origin;
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claim = b64u(JSON.stringify({
    aud,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: keys.subject || 'mailto:admin@example.com'
  }));

  const pub = unb64u(keys.vapidPublic);
  const key = crypto.createPrivateKey({
    format: 'jwk',
    key: {
      kty: 'EC', crv: 'P-256',
      d: keys.vapidPrivate,
      x: b64u(pub.subarray(1, 33)),
      y: b64u(pub.subarray(33, 65))
    }
  });

  /* Raw r||s, not DER. A push service will not accept the DER form that
     Node signs with by default, and the failure it gives back says only
     "unauthorized". */
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${claim}`),
                          { key, dsaEncoding: 'ieee-p1363' });

  return `vapid t=${head}.${claim}.${b64u(sig)}, k=${keys.vapidPublic}`;
}

async function pushOne(sub, payload, keys) {
  const body = encrypt(JSON.stringify(payload), sub);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      TTL: String(TTL),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(body.length),
      Authorization: vapidHeader(sub.endpoint, keys)
    },
    body
  });
  return res.status;
}

/* ------------------------------------------------------------- the job */
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' });

  const s = site();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s.url || !serviceKey) {
    /* Said, but said quietly: whoever called this is not a person, and
       the only reader is a log. */
    return json(500, { error: 'not configured' });
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return json(400, { error: 'bad request' }); }

  const keysRes = await db(s.url, serviceKey,
    'site_settings_private?key=eq.chat_push&select=data');
  const keysRows = keysRes.ok ? await keysRes.json() : [];
  const keys = (keysRows[0] && keysRows[0].data) || null;
  if (!keys || !keys.vapidPrivate) return json(500, { error: 'not configured' });

  const sent = (event.headers &&
    (event.headers['x-chat-hook'] || event.headers['X-Chat-Hook'])) || '';
  /* Compared in constant time. The comparison is cheap and the habit is
     the point: a secret checked with === leaks its length and its first
     differing byte to anyone patient. */
  const a = Buffer.from(String(sent));
  const b = Buffer.from(String(keys.secret || ''));
  if (!b.length || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return json(403, { error: 'no' });
  }

  const conversationId = body.conversation;
  if (!conversationId) return json(400, { error: 'bad request' });

  // ---- what to say -----------------------------------------------------
  const convRes = await db(s.url, serviceKey,
    `chat_conversations?id=eq.${encodeURIComponent(conversationId)}` +
    '&select=id,name,phone,email,customer_id,assigned_to,shop_unread,status');
  const conv = convRes.ok ? (await convRes.json())[0] : null;
  if (!conv) return json(200, { sent: 0, why: 'no such conversation' });

  const setRes = await db(s.url, serviceKey, 'site_settings?key=eq.chat&select=data');
  const chatSet = (setRes.ok ? ((await setRes.json())[0] || {}).data : null) || {};
  const showPreview = chatSet.pushPreview !== false;
  const tellEveryone = chatSet.pushAll !== false;

  const who = conv.name || conv.phone || conv.email ||
              (conv.customer_id ? 'A customer' : 'Someone browsing');

  let title, text;
  if (body.kind === 'handover') {
    title = 'A conversation was passed to you';
    text = who + ' is waiting for an answer.';
  } else {
    title = who + ' wrote to the shop';
    text = 'Tap to answer.';
    if (showPreview && body.message) {
      const mRes = await db(s.url, serviceKey,
        `chat_messages?id=eq.${encodeURIComponent(body.message)}&select=body`);
      const m = mRes.ok ? (await mRes.json())[0] : null;
      const said = String((m && m.body) || '').trim();
      if (said) text = said.length > 120 ? said.slice(0, 117) + '…' : said;
    }
  }

  // ---- who to tell -----------------------------------------------------
  /* A conversation somebody is holding is that person's to answer, so
     only they are woken. One nobody has taken is everybody's, which is
     the case where waiting actually happens. */
  let people = null;
  if (body.kind === 'handover' && body.to) {
    people = [body.to];
  } else if (conv.assigned_to) {
    people = [conv.assigned_to];
  } else if (!tellEveryone) {
    /* The shop has asked that a loose conversation wake only the owner.
       There can be more than one row with that role, and all of them
       are told: "owner" is a job, not a person. If the migration that
       adds roles has not been run, this comes back empty — and an empty
       list here would mean nobody is ever told about a new customer,
       which is worse than telling too many. So it falls back to
       everybody, which is what the setting's own default says. */
    const ownRes = await db(s.url, serviceKey, 'admins?role=eq.owner&select=id');
    const owners = ownRes.ok ? await ownRes.json() : [];
    if (owners.length) people = owners.map((o) => o.id);
  }

  let path = 'chat_push?select=id,endpoint,p256dh,auth,fails';
  if (people) {
    path += `&person=in.(${people.map(encodeURIComponent).join(',')})`;
  }
  const subsRes = await db(s.url, serviceKey, path);
  const subs = subsRes.ok ? await subsRes.json() : [];
  if (!subs.length) return json(200, { sent: 0, why: 'nobody is subscribed' });

  const payload = {
    title,
    body: text,
    url: '/admin.html#/chats',
    /* One notification per conversation rather than a pile of them: a
       second message from the same person replaces the first. */
    tag: 'chat-' + conv.id
  };

  let sentCount = 0;
  const dead = [];
  await Promise.all(subs.map(async (sub) => {
    let status = 0;
    try { status = await pushOne(sub, payload, keys); }
    catch (e) { status = 0; }

    if (status >= 200 && status < 300) {
      sentCount++;
      await db(s.url, serviceKey, `chat_push?id=eq.${sub.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ last_ok_at: new Date().toISOString(), fails: 0 })
      }).catch(() => {});
      return;
    }
    /* 404 and 410 are the push service saying this browser is gone for
       good — uninstalled, or notifications turned off. Anything else
       might be a bad afternoon, so it is counted rather than acted on. */
    if (status === 404 || status === 410 || sub.fails >= 2) {
      dead.push(sub.id);
    } else {
      await db(s.url, serviceKey, `chat_push?id=eq.${sub.id}`, {
        method: 'PATCH', body: JSON.stringify({ fails: (sub.fails || 0) + 1 })
      }).catch(() => {});
    }
  }));

  if (dead.length) {
    await db(s.url, serviceKey,
      `chat_push?id=in.(${dead.map(encodeURIComponent).join(',')})`,
      { method: 'DELETE' }).catch(() => {});
  }

  return json(200, { sent: sentCount, dropped: dead.length });
};

/* For the tests. Nothing else reads this. */
exports._internals = { hkdf, encrypt, vapidHeader, label, b64u, unb64u };
