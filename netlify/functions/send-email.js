// Sends one email on behalf of the shop, using the account set up in
// Settings > Notifications. Two things use it: the test that proves
// those settings work rather than merely storing them, and the welcome
// email an owner sends a new subscriber from the Subscribers tab.
//
// One address per request, on purpose. A sender that takes a list is a
// sender that can empty a mailing list into a spam folder by accident,
// and nothing here needs that.
//
// Why this runs here and not in the browser:
//
//   - a browser cannot speak SMTP at all. It has no raw sockets, and no
//     amount of arranging in the admin page would change that.
//   - the SMTP password must never reach a customer's browser. It is
//     kept in site_settings_private, which has no public read rule, and
//     it travels from the admin to here over HTTPS and nowhere else.
//
// Nothing is stored here. The credentials arrive with the request, are
// used once, and go when the function returns.
//
// The caller must prove they are an administrator first. Without that
// check anyone could point this at any host and port and read back what
// came out - a scanner running on Netlify's network, paid for by the
// shop. The check is the same one the database uses: ask for a row of
// the admins table with the caller's own token, which the rules answer
// with nothing at all unless they really are an admin.

const net = require('net');
const tls = require('tls');
const { readConfig } = require('./_seo-data');

const CONNECT_MS = 12000;   // a host that never answers must not hang the function
const REPLY_MS = 12000;

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

async function callerIsAdmin(token) {
  if (!token) return false;
  const { url, key } = readConfig();
  if (!url || !key) return false;
  try {
    const res = await fetch(
      `${url.replace(/\/+$/, '')}/rest/v1/admins?select=id&limit=1`,
      { headers: { apikey: key, Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return false;
    const rows = await res.json();
    return Array.isArray(rows) && rows.length > 0;
  } catch (e) {
    return false;
  }
}

// ---------------------------------------------------------------- SMTP

// Reads whole SMTP replies. A reply may run over several lines, and only
// the last one is marked with a space after the code ("250-STARTTLS" then
// "250 HELP"), so anything less than that would act on half an answer.
function replies(socket) {
  let buffer = '';
  let waiting = null;
  let failed = null;

  socket.setEncoding('utf8');
  socket.on('data', (chunk) => { buffer += chunk; settle(); });
  socket.on('error', (e) => { failed = e; settle(); });
  socket.on('close', () => { failed = failed || new Error('The mail server closed the connection.'); settle(); });

  function whole() {
    const lines = buffer.split(/\r?\n/).filter((l) => l.length);
    if (!lines.length) return null;
    return /^\d{3} /.test(lines[lines.length - 1]) ? lines : null;
  }

  function settle() {
    if (!waiting) return;
    if (failed) { const w = waiting; waiting = null; w.reject(failed); return; }
    const lines = whole();
    if (!lines) return;
    const text = buffer;
    buffer = '';
    const w = waiting;
    waiting = null;
    clearTimeout(w.timer);
    w.resolve({ code: parseInt(text.slice(0, 3), 10), text: text.trim() });
  }

  return {
    next() {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => { waiting = null; reject(new Error('The mail server stopped replying.')); },
          REPLY_MS
        );
        waiting = { resolve, reject, timer };
        settle();
      });
    },
  };
}

function connect(opts) {
  return new Promise((resolve, reject) => {
    const socket = opts.secure
      ? tls.connect({ host: opts.host, port: opts.port, servername: opts.host })
      : net.connect({ host: opts.host, port: opts.port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Could not reach ${opts.host} on port ${opts.port}.`));
    }, CONNECT_MS);
    socket.once(opts.secure ? 'secureConnect' : 'connect', () => { clearTimeout(timer); resolve(socket); });
    socket.once('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

function upgrade(socket, host) {
  return new Promise((resolve, reject) => {
    const secure = tls.connect({ socket, servername: host }, () => resolve(secure));
    secure.once('error', reject);
  });
}

function b64(s) { return Buffer.from(String(s), 'utf8').toString('base64'); }

// Anything but plain ASCII in a header has to be encoded, or a subject
// with an accent in it arrives as rubble.
function header(value) {
  const s = String(value || '');
  return /^[\x20-\x7E]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`;
}

function address(value) {
  return String(value || '').trim().replace(/[\r\n<>]/g, '');
}

function buildMessage(m) {
  const date = new Date().toUTCString();
  const from = m.senderName
    ? `${header(m.senderName)} <${address(m.senderEmail)}>`
    : address(m.senderEmail);
  const lines = [
    `From: ${from}`,
    `To: ${address(m.to)}`,
    `Subject: ${header(m.subject)}`,
    `Date: ${date}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    // base64 sidesteps both line-length limits and the leading-dot rule
    'Content-Transfer-Encoding: base64',
  ];
  if (m.replyTo) lines.push(`Reply-To: ${address(m.replyTo)}`);
  // Mail carries CRLF line endings. The body is base64 anyway, which
  // preserves whatever it is handed, so the normalising has to happen
  // before the encoding rather than after it.
  const text = String(m.text || '').replace(/\r?\n/g, '\r\n');
  const body = b64(text).replace(/(.{76})/g, '$1\r\n');
  return lines.join('\r\n') + '\r\n\r\n' + body;
}

async function sendMail(cfg) {
  const port = Number(cfg.smtpPort) || 587;
  const mode = cfg.encryption || (port === 465 ? 'tls' : 'starttls');

  let socket = await connect({ host: cfg.smtpHost, port, secure: mode === 'tls' });
  let io = replies(socket);

  const expect = async (want, what) => {
    const r = await io.next();
    if (!want.includes(r.code)) {
      throw new Error(`${what} was refused: ${r.text.split(/\r?\n/)[0]}`);
    }
    return r;
  };
  const send = (line) => new Promise((res, rej) => socket.write(line + '\r\n', (e) => (e ? rej(e) : res())));

  try {
    await expect([220], 'The connection');

    await send('EHLO vaultique-admin');
    await expect([250], 'EHLO');

    if (mode === 'starttls') {
      await send('STARTTLS');
      await expect([220], 'STARTTLS');
      socket = await upgrade(socket, cfg.smtpHost);
      io = replies(socket);
      await send('EHLO vaultique-admin');
      await expect([250], 'EHLO');
    }

    if (cfg.smtpUser) {
      await send('AUTH LOGIN');
      await expect([334], 'Signing in');
      await send(b64(cfg.smtpUser));
      await expect([334], 'The username');
      await send(b64(cfg.smtpPassword || ''));
      await expect([235], 'The username and password');
    }

    await send(`MAIL FROM:<${address(cfg.senderEmail)}>`);
    await expect([250], 'The sender address');

    await send(`RCPT TO:<${address(cfg.to)}>`);
    await expect([250, 251], 'The recipient address');

    await send('DATA');
    await expect([354], 'DATA');
    await send(buildMessage(cfg) + '\r\n.');
    await expect([250], 'The message');

    // Say goodbye and wait to be answered before dropping the line. The
    // message is already accepted by this point, so a server that simply
    // closes instead of replying has cost us nothing - but hanging up
    // mid-word gets logged as an aborted session by servers that care.
    await send('QUIT');
    await Promise.race([
      io.next().catch(function () { return null; }),
      new Promise(function (r) { setTimeout(r, 2000); }),
    ]);
  } finally {
    try { socket.destroy(); } catch (e) { /* already gone */ }
  }
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' });

  const auth = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!(await callerIsAdmin(token))) {
    return json(403, { error: 'Only an administrator can send email from here.' });
  }

  let cfg;
  try { cfg = JSON.parse(event.body || '{}'); }
  catch (e) { return json(400, { error: 'That request could not be read.' }); }

  const missing = ['smtpHost', 'senderEmail', 'to'].filter((k) => !String(cfg[k] || '').trim());
  if (missing.length) return json(400, { error: `Still needed: ${missing.join(', ')}.` });

  try {
    await sendMail(cfg);
    return json(200, { sent: true });
  } catch (e) {
    // The reason is handed back verbatim: "authentication failed" and
    // "could not be reached" need completely different fixes, and a
    // single "sending failed" would leave an owner guessing between them.
    return json(200, { sent: false, error: e && e.message ? e.message : String(e) });
  }
};

// Exported for the tests, which drive the whole conversation against a
// stand-in server rather than a real mailbox.
module.exports._internals = { buildMessage, sendMail, header, replies };
