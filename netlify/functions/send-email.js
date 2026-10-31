// Sends one email on behalf of the shop, using the account set up in
// Settings > Notifications. Two things in the admin use it: the test that
// proves those settings work rather than merely storing them, and the
// welcome email sent to a new subscriber from the Subscribers tab. The
// other functions (payments, sign-up, rewards, the newsletter) use its
// sendMail through _mail.js.
//
// One address per request, on purpose. A sender that takes a list is a
// sender that can empty a mailing list into a spam folder by accident,
// and nothing here needs that.
//
// Why this runs here and not in the browser: a browser cannot speak SMTP
// at all, and the SMTP password must never reach one.
//
// WHAT CHANGED IN BUILD 77 (W-12). Until then the admin page sent the
// whole account with every request, password included, and any member of
// staff could point it at any host and port and read the server's replies
// word for word. Now:
//
//   { kind: 'test', to }     the test email. Settings permission (or the
//                            owner). Sent with the account as STORED: the
//                            host, port and password come from the
//                            database, never from the request.
//   { kind: 'welcome', to }  the welcome email, worded in Settings >
//                            Newsletter. Subscribers permission, and only
//                            to an address on the list.
//   anything else            the old form, with the account in the
//                            request: the owner alone, for trying details
//                            before saving them.
//
// Who is asking is asked of the database with the caller's own sign-in
// (may(), supabase-hardening.sql), so a role's ticks and two-factor apply
// here exactly as they do everywhere else. What went wrong comes back as a
// plain category, never the mail server's own words, so this cannot be
// used to read banners off other people's machines.

const net = require('net');
const tls = require('tls');
const { readConfig, settings } = require('./_seo-data');

const CONNECT_MS = 12000;   // a host that never answers must not hang the function
const REPLY_MS = 12000;

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

/* A database question asked with the caller's own sign-in, the way the
   admin page itself asks it. */
async function askAs(token, fn, args) {
  const { url, key } = readConfig();
  if (!token || !url || !key) return { ok: false };
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args || {}),
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
    const missing = res.status === 404 || /PGRST202|Could not find the function/.test(text);
    return { ok: res.ok, data, missing };
  } catch (e) {
    return { ok: false };
  }
}

/* May this person do it? The owner always; anybody else when their role
   has the tick (and they are past two-factor where it is required). On a
   database where supabase-hardening.sql has not been run yet there is no
   such question, and only the owner may. */
async function allowed(token, perm) {
  const r = await askAs(token, 'may', { p_perm: perm });
  if (r.ok) return r.data === true;
  if (r.missing) {
    const o = await askAs(token, 'is_shop_owner', {});
    return o.ok && o.data === true;
  }
  return false;
}
async function isOwner(token) {
  const o = await askAs(token, 'is_shop_owner', {});
  return o.ok && o.data === true;
}

/* What went wrong, in words that say what to fix. The mail server's own
   reply goes to the function log, never back to the page. */
const SAYS = {
  'not-set-up': 'Email is not set up yet. Settings > Notifications needs the details your provider gives you, saved.',
  connect: 'The mail server could not be reached. Check the SMTP host and port in Settings > Notifications.',
  secure: 'A secure connection to the mail server could not be made. Check the Encryption setting: port 465 is usually SSL/TLS, and 587 STARTTLS.',
  greeting: 'The mail server did not accept the connection.',
  login: 'The mail server refused the username or password.',
  sender: 'The mail server refused the sender address. It usually has to be the email account\'s own address.',
  recipient: 'The mail server refused the address it was sent to.',
  message: 'The mail server refused the message itself.',
  other: 'The email could not be sent just now. Please try again in a little while.',
};
function category(e) {
  if (e && e.category) return e.category;
  const code = String((e && e.code) || '');
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|ECONNRESET/.test(code)) return 'connect';
  if (/CERT|SSL|TLS|EPROTO/i.test(code + ' ' + String((e && e.message) || ''))) return 'secure';
  return 'other';
}
function tagged(err, cat) { err.category = cat; return err; }

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
      reject(tagged(new Error(`Could not reach ${opts.host} on port ${opts.port}.`), 'connect'));
    }, CONNECT_MS);
    socket.once(opts.secure ? 'secureConnect' : 'connect', () => { clearTimeout(timer); resolve(socket); });
    socket.once('error', (e) => { clearTimeout(timer); reject(tagged(e, category(e))); });
  });
}

function upgrade(socket, host) {
  return new Promise((resolve, reject) => {
    const secure = tls.connect({ socket, servername: host }, () => resolve(secure));
    secure.once('error', (e) => reject(tagged(e, 'secure')));
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

  const expect = async (want, what, cat) => {
    const r = await io.next();
    if (!want.includes(r.code)) {
      throw tagged(new Error(`${what} was refused: ${r.text.split(/\r?\n/)[0]}`), cat || 'other');
    }
    return r;
  };
  const send = (line) => new Promise((res, rej) => socket.write(line + '\r\n', (e) => (e ? rej(e) : res())));

  try {
    await expect([220], 'The connection', 'greeting');

    await send('EHLO vaultique-admin');
    await expect([250], 'EHLO');

    if (mode === 'starttls') {
      await send('STARTTLS');
      await expect([220], 'STARTTLS', 'secure');
      socket = await upgrade(socket, cfg.smtpHost);
      io = replies(socket);
      await send('EHLO vaultique-admin');
      await expect([250], 'EHLO');
    }

    if (cfg.smtpUser) {
      await send('AUTH LOGIN');
      await expect([334], 'Signing in', 'login');
      await send(b64(cfg.smtpUser));
      await expect([334], 'The username', 'login');
      await send(b64(cfg.smtpPassword || ''));
      await expect([235], 'The username and password', 'login');
    }

    await send(`MAIL FROM:<${address(cfg.senderEmail)}>`);
    await expect([250], 'The sender address', 'sender');

    await send(`RCPT TO:<${address(cfg.to)}>`);
    await expect([250, 251], 'The recipient address', 'recipient');

    await send('DATA');
    await expect([354], 'DATA', 'message');
    await send(buildMessage(cfg) + '\r\n.');
    await expect([250], 'The message', 'message');

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

const MAILISH = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* Settings > Newsletter's own starting wording, for a shop that has not
   changed it (assets/admin/settings/newsletter.js). */
const WELCOME = {
  welcomeSubject: 'Welcome to the list',
  welcomeEmail: 'Thank you for joining us.\n\n' +
                'You will hear from us when new pieces arrive and when we hold ' +
                'something back for the list before it reaches the shop floor. ' +
                'Never more often than that.\n\n' +
                'If you would like anything found or held, simply reply to this ' +
                'message.',
  footer: 'You are receiving this because you joined our list at ' +
          'vaultiqueboutique.com. Reply to this message to come off it.',
};

/* A send through the stored account, answered in categories. */
async function sendStored(to, subject, text) {
  const M = require('./_mail');
  const a = await M.mailAccount();
  if (!a.ready) return json(200, { sent: false, reason: 'not-set-up', error: SAYS['not-set-up'] });
  try {
    await sendMail(Object.assign(M.accountConfig(a), { to, subject, text: text + '\n\n' + (a.pub.signature || a.shop) }));
    return json(200, { sent: true });
  } catch (e) {
    const cat = category(e);
    console.error('[send-email] not sent (' + cat + '):', e && e.message);
    return json(200, { sent: false, reason: cat, error: SAYS[cat] });
  }
}

/* A few an hour for each person, counted by the database. Before
   supabase-hardening.sql there is nothing to count with, and nothing is
   held up by that. */
async function throttled(bucket, who, max) {
  const P = require('./_pay');
  if (!who || !P.serviceKey()) return false;
  try {
    await P.svc('POST', 'rpc/throttle', { p_bucket: bucket, p_key: who, p_max: max, p_window: '1 hour' }, 'return=minimal');
    return false;
  } catch (e) {
    return /Too many/.test(String(e && e.message));
  }
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' });

  const auth = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();

  // Being unable to ask is not the same as having asked and been told
  // no, and the two need different fixes. Without this the one case
  // reads as the other: a site whose functions cannot reach config.js
  // refuses every send, and tells the owner it is their account.
  const site = readConfig();
  if (!site.url || !site.key) {
    return json(500, {
      error: 'The sender cannot read this website\'s own settings, so it cannot ' +
             'check who is asking. This is a setup problem on the website, not a ' +
             'problem with your account.',
    });
  }

  let req;
  try { req = JSON.parse(event.body || '{}') || {}; }
  catch (e) { return json(400, { error: 'That request could not be read.' }); }
  const to = String(req.to || '').trim();

  /* ---------------------------------------------------- the test email */
  if (req.kind === 'test') {
    if (!(await allowed(token, 'settings'))) {
      return json(403, { error: 'Only somebody who may open Settings can send a test email.' });
    }
    if (!MAILISH.test(to) || to.length > 160) return json(400, { error: 'Enter the address to send the test to.' });
    const who = await require('./_pay').customerFrom(event);
    if (await throttled('mail_test', who, 10)) {
      return json(429, { error: 'That is a lot of test emails in an hour. Please wait a little.' });
    }
    const general = (await settings('general')) || {};
    return sendStored(to,
      'Test message from ' + (general.businessName || 'your website'),
      'This is a test from your website admin.\n\nIf you are reading it, your email settings work.');
  }

  /* -------------------------------------------------- the welcome email */
  if (req.kind === 'welcome') {
    if (!(await allowed(token, 'subscribers'))) {
      return json(403, { error: 'Only somebody who may open Subscribers can send the welcome email.' });
    }
    const P = require('./_pay');
    if (!MAILISH.test(to) || to.length > 200 || !P.serviceKey()) return json(400, { error: 'That address is not on the list.' });
    // Only to somebody on the list who has not left it: this is not a way
    // to email anybody at all.
    const on = await P.svc('GET', 'subscribers?email=eq.' + encodeURIComponent(to) +
                                  '&unsubscribed_at=is.null&select=email').catch(() => []);
    if (!on || !on.length) return json(400, { error: 'That address is not on the list, or has left it.' });
    const who = await P.customerFrom(event);
    if (await throttled('mail_welcome', who, 60)) {
      return json(429, { error: 'That is a lot of welcome emails in an hour. Please wait a little.' });
    }
    const news = Object.assign({}, WELCOME, (await settings('newsletter')) || {});
    const body = [news.welcomeEmail || WELCOME.welcomeEmail, news.footer || '']
      .filter((part) => String(part || '').trim()).join('\n\n');
    return sendStored(on[0].email, news.welcomeSubject || WELCOME.welcomeSubject, body);
  }

  /* ------------------- the old form: trying details before saving them */
  if (!(await isOwner(token))) {
    return json(403, { error: 'Reload the admin page (this one is from an older version of the website), then try again.' });
  }
  const missing = ['smtpHost', 'senderEmail', 'to'].filter((k) => !String(req[k] || '').trim());
  if (missing.length) return json(400, { error: `Still needed: ${missing.join(', ')}.` });
  try {
    await sendMail(req);
    return json(200, { sent: true });
  } catch (e) {
    const cat = category(e);
    console.error('[send-email] not sent (' + cat + '):', e && e.message);
    return json(200, { sent: false, reason: cat, error: SAYS[cat] });
  }
};

// Exported for the tests, which drive the whole conversation against a
// stand-in server rather than a real mailbox.
module.exports._internals = { buildMessage, sendMail, header, replies, category, SAYS };
