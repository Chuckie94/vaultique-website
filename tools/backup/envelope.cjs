/* =====================================================================
   A COPY ONLY YOU CAN OPEN (website build 92)

   Every file of a backup is sealed before it leaves GitHub's machine:
   a fresh random key for that file (AES-256-GCM, which also proves the
   file has not been changed), and that key locked with your PUBLIC key
   (RSA-OAEP with SHA-256). Only your PRIVATE key, which never goes to
   GitHub or to the website, can unlock it. GitHub holds the public half
   only: someone who got into GitHub could make copies, but could not
   open the ones already made.

   The key pair is made in your own browser (Admin > Settings > Backups,
   "Make my backup key"); the same format as Node's own keys:
     public   PEM, "BEGIN PUBLIC KEY" (SPKI), RSA, 4096 bits
     private  PEM, "BEGIN PRIVATE KEY" (PKCS #8)

   A sealed file:
     VQBK1\n
     {"v":1,"alg":"RSA-OAEP-256/A256GCM","kid":"…","key":"…","iv":"…","made":"…"}\n
     <the file, encrypted><16-byte tag>
   The header line says which key opens it (kid, the start of the public
   key's fingerprint) and nothing about what is inside: names, tables and
   paths are all inside the encrypted part. The header is also bound to
   the encrypted part, so it cannot be swapped.
   ===================================================================== */
'use strict';
const crypto = require('crypto');

const MAGIC = 'VQBK1';
const ALG = 'RSA-OAEP-256/A256GCM';

function pemOf(text, kind) {
  const t = String(text || '').trim();
  if (/-----BEGIN [A-Z ]+-----/.test(t)) return t.replace(/\\n/g, '\n');   // pasted with \n for new lines
  const body = t.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/=]{100,}$/.test(body)) throw new Error('That is not a ' + kind + ' key.');
  return '-----BEGIN ' + kind.toUpperCase() + ' KEY-----\n' + body.match(/.{1,64}/g).join('\n') + '\n-----END ' + kind.toUpperCase() + ' KEY-----\n';
}
function publicKeyFrom(text) {
  let k;
  try { k = crypto.createPublicKey(pemOf(text, 'public')); }
  catch (e) { throw new Error('The backup public key could not be read: ' + (e && e.message)); }
  if (k.asymmetricKeyType !== 'rsa') throw new Error('The backup public key must be an RSA key.');
  if (k.asymmetricKeyDetails.modulusLength < 3072) throw new Error('The backup public key is too short (at least 3072 bits).');
  return k;
}
function privateKeyFrom(text) {
  let k;
  try { k = crypto.createPrivateKey(pemOf(text, 'private')); }
  catch (e) { throw new Error('The backup private key could not be read: ' + (e && e.message)); }
  if (k.asymmetricKeyType !== 'rsa') throw new Error('The backup private key must be an RSA key.');
  return k;
}
/* The key's name: the start of the SHA-256 of the public key. The same
   from either half of the pair. */
function kidOf(key) {
  const pub = key.type === 'private' ? crypto.createPublicKey(key) : key;
  return crypto.createHash('sha256').update(pub.export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16);
}

function seal(data, publicKey, made) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
  const dataKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const wrapped = crypto.publicEncrypt({ key: publicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, dataKey);
  const head = JSON.stringify({ v: 1, alg: ALG, kid: kidOf(publicKey), key: wrapped.toString('base64'), iv: iv.toString('base64'),
                                made: made || new Date().toISOString() });
  const c = crypto.createCipheriv('aes-256-gcm', dataKey, iv);
  c.setAAD(Buffer.from(MAGIC + '\n' + head));
  const body = Buffer.concat([c.update(buf), c.final(), c.getAuthTag()]);
  dataKey.fill(0);
  return Buffer.concat([Buffer.from(MAGIC + '\n' + head + '\n'), body]);
}

function headOf(sealed) {
  const s = Buffer.isBuffer(sealed) ? sealed : Buffer.from(sealed);
  const first = s.indexOf(0x0a);
  const second = first < 0 ? -1 : s.indexOf(0x0a, first + 1);
  if (first < 0 || second < 0 || s.slice(0, first).toString() !== MAGIC) throw new Error('This is not a sealed backup file.');
  let head;
  try { head = JSON.parse(s.slice(first + 1, second).toString()); } catch (e) { throw new Error('This sealed file\'s header is damaged.'); }
  if (head.v !== 1 || head.alg !== ALG) throw new Error('This sealed file was made in a way this tool does not know.');
  return { head, headText: s.slice(first + 1, second).toString(), body: s.slice(second + 1) };
}

function open(sealed, privateKey) {
  const { head, headText, body } = headOf(sealed);
  if (head.kid !== kidOf(privateKey)) {
    throw new Error('This file was sealed for another key (' + head.kid + '); this key is ' + kidOf(privateKey) + '.');
  }
  if (body.length < 16) throw new Error('This sealed file is cut short.');
  let dataKey;
  try {
    dataKey = crypto.privateDecrypt({ key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
                                    Buffer.from(head.key, 'base64'));
  } catch (e) { throw new Error('The key does not open this file.'); }
  const d = crypto.createDecipheriv('aes-256-gcm', dataKey, Buffer.from(head.iv, 'base64'));
  d.setAAD(Buffer.from(MAGIC + '\n' + headText));
  d.setAuthTag(body.slice(body.length - 16));
  try {
    return Buffer.concat([d.update(body.slice(0, body.length - 16)), d.final()]);
  } catch (e) {
    throw new Error('This sealed file has been changed or damaged since it was made: it does not check out.');
  } finally { dataKey.fill(0); }
}

/* A file inside the seal, with its own name and details: what a picture or
   a part of a copy is, kept out of sight with the content. */
function sealNamed(meta, data, publicKey, made) {
  const m = Buffer.from(JSON.stringify(meta || {}));
  const len = Buffer.alloc(4); len.writeUInt32BE(m.length, 0);
  return seal(Buffer.concat([len, m, Buffer.isBuffer(data) ? data : Buffer.from(String(data))]), publicKey, made);
}
function openNamed(sealed, privateKey) {
  const plain = open(sealed, privateKey);
  const n = plain.readUInt32BE(0);
  return { meta: JSON.parse(plain.slice(4, 4 + n).toString()), data: plain.slice(4 + n) };
}

/* A key pair, as the admin page makes one: for the tests and the first drill. */
function makeKeyPair(bits) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: bits || 4096, publicExponent: 0x10001 });
  return { publicPem: publicKey.export({ type: 'spki', format: 'pem' }), privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
}

module.exports = { MAGIC, ALG, publicKeyFrom, privateKeyFrom, kidOf, seal, open, headOf, sealNamed, openNamed, makeKeyPair };
