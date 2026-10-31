/* ===========================================================================
   SENDING EMAIL FROM THE ADMIN -- netlify/functions/send-email.js (build 77)

   Until build 77 the admin page sent the shop's whole email account with
   every request, password included, and any member of staff could point
   the function at any host and port and read the server's replies word for
   word (W-12). Now the test and the welcome email are sent with the account
   as STORED, only by people whose role allows it, and what went wrong comes
   back as a plain category. Run as Netlify runs it, against a stand-in for
   this website's Supabase and a small mail server of its own.
   =========================================================================== */
const http = require('http');
const net = require('net');
const path = require('path');

let checks = 0, failures = 0;
const is = (c, m, x) => { checks++; if (c) console.log('  ✓ ' + m); else { failures++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); } };

/* ---- a mail server: records what it is told, refuses what it is set to */
let SMTP = { seen: [], refuseLogin: false };
const smtp = net.createServer((sock) => {
  let data = false, msg = '', mail = { lines: [] };
  sock.write('220 mail.test ready\r\n');
  sock.on('data', (chunk) => {
    for (const line of String(chunk).split('\r\n')) {
      if (!line && !data) continue;
      if (data) {
        if (line === '.') { data = false; mail.body = msg; SMTP.seen.push(mail); sock.write('250 queued as SECRET-QUEUE-ID\r\n'); continue; }
        msg += line + '\n'; continue;
      }
      mail.lines.push(line);
      if (/^EHLO/.test(line)) sock.write('250-mail.test\r\n250 AUTH LOGIN\r\n');
      else if (line === 'AUTH LOGIN') { mail.auth = []; sock.write('334 VXNlcm5hbWU6\r\n'); }
      else if (mail.auth && mail.auth.length < 2) {
        mail.auth.push(Buffer.from(line, 'base64').toString());
        if (mail.auth.length === 1) sock.write('334 UGFzc3dvcmQ6\r\n');
        else sock.write(SMTP.refuseLogin ? '535 5.7.8 Authentication failed for internal-user-db-7\r\n' : '235 ok\r\n');
      }
      else if (/^MAIL FROM/.test(line)) sock.write('250 ok\r\n');
      else if (/^RCPT TO:<refuse@/.test(line)) sock.write('550 5.1.1 mailbox unavailable on host relay-internal-3\r\n');
      else if (/^RCPT TO/.test(line)) sock.write('250 ok\r\n');
      else if (line === 'DATA') { data = true; msg = ''; sock.write('354 go\r\n'); }
      else if (line === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
    }
  });
  sock.on('error', () => {});
});

/* ---- this website's Supabase ---------------------------------------- */
const PEOPLE = {                       // token -> who, and what their role may do
  'owner-tok': { id: 'u-owner', owner: true, may: ['settings', 'subscribers'] },
  'admin-tok': { id: 'u-admin', may: ['settings', 'subscribers', 'orders'] },
  'subs-tok':  { id: 'u-subs', may: ['subscribers'] },
  'agent-tok': { id: 'u-agent', may: ['chats'] },
};
let STORE, OLD_DB, HITS;
function reset() {
  STORE = {
    notifications: { emailEnabled: true, smtpHost: '127.0.0.1', smtpPort: 0, encryption: 'none',
                     smtpUser: 'shop@shop.test', senderEmail: 'shop@shop.test', senderName: 'Vaultique', signature: 'Vaultique, Lusaka' },
    general: { businessName: 'Vaultique' },
    newsletter: { welcomeSubject: 'Welcome to Vaultique', welcomeEmail: 'Thank you for joining us.', footer: 'Reply to come off the list.' },
    mail_secret: { smtpPassword: 'stored-secret' },
    subscribers: [{ email: 'on@list.test', unsubscribed_at: null }, { email: 'left@list.test', unsubscribed_at: '2026-01-01' }],
  };
  OLD_DB = false; HITS = {};
}
reset();
const read = (req) => new Promise((r) => { let d = ''; req.on('data', (c) => d += c); req.on('end', () => r(d)); });
const api = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'), p = u.pathname, body = await read(req);
  const send = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  const tok = String(req.headers.authorization || '').replace('Bearer ', '');
  const me = PEOPLE[tok];
  const service = tok === 'service-key';
  if (p === '/auth/v1/user') return me ? send(200, { id: me.id }) : send(401, {});
  if (p === '/rest/v1/rpc/may') {
    if (OLD_DB) return send(404, { code: 'PGRST202', message: 'Could not find the function public.may(p_perm)' });
    const perm = JSON.parse(body || '{}').p_perm;
    return send(200, !!me && (me.owner || me.may.indexOf(perm) > -1));
  }
  if (p === '/rest/v1/rpc/is_shop_owner') return send(200, !!(me && me.owner));
  if (p === '/rest/v1/rpc/throttle') {
    if (!service) return send(401, {});
    const b = JSON.parse(body), k = b.p_bucket + '|' + b.p_key;
    if ((HITS[k] || 0) >= b.p_max) return send(400, { code: 'P0429', message: 'Too many tries just now.' });
    HITS[k] = (HITS[k] || 0) + 1; return send(204, {});
  }
  if (p === '/rest/v1/site_settings') {
    const key = (u.searchParams.get('key') || '').replace('eq.', '');
    return send(200, STORE[key] ? [{ data: STORE[key] }] : []);
  }
  if (p === '/rest/v1/site_settings_private') {
    if (!service) return send(200, []);
    return send(200, STORE.mail_secret ? [{ key: 'mail_secret', data: STORE.mail_secret }] : [{ key: 'notifications', data: { smtpPassword: 'old-place-pw' } }]);
  }
  if (p === '/rest/v1/subscribers') {
    if (!service) return send(401, {});
    const email = (u.searchParams.get('email') || '').replace('eq.', '');
    return send(200, STORE.subscribers.filter((s) => s.email === email && !s.unsubscribed_at).map((s) => ({ email: s.email })));
  }
  send(404, { path: p });
});

(async () => {
  await new Promise((r) => smtp.listen(0, '127.0.0.1', r));
  await new Promise((r) => api.listen(0, '127.0.0.1', r));
  const port = smtp.address().port;
  const base = 'http://127.0.0.1:' + api.address().port;
  Object.assign(process.env, { WEB_SUPABASE_URL: base, WEB_SUPABASE_ANON_KEY: 'anon-key', SUPABASE_SERVICE_ROLE_KEY: 'service-key' });
  const fn = require(path.join(__dirname, '..', 'netlify', 'functions', 'send-email')).handler;
  const post = (tok, b) => fn({ httpMethod: 'POST', headers: tok ? { authorization: 'Bearer ' + tok } : {}, body: JSON.stringify(b) })
    .then((r) => ({ code: r.statusCode, body: JSON.parse(r.body || '{}'), raw: r.body }));
  const stored = () => { STORE.notifications.smtpPort = port; };
  const last = () => SMTP.seen[SMTP.seen.length - 1];

  try {
    stored();
    console.log('\nThe test email, with the account as stored');
    let r = await post('admin-tok', { kind: 'test', to: 'me@shop.test' });
    let m = last();
    is(r.code === 200 && r.body.sent === true, 'somebody who may open Settings sends a test', JSON.stringify(r.body));
    is(m && m.auth && m.auth[1] === 'stored-secret', 'signed in with the password the website keeps, which the page never sent');
    is(m && m.lines.some((l) => l === 'RCPT TO:<me@shop.test>') && /Vaultique, Lusaka/.test(Buffer.from(m.body.split('\n\n').slice(1).join(''), 'base64').toString()),
       'to the address asked for, with the shop\'s signature');
    r = await post('admin-tok', { kind: 'test', to: 'me@shop.test', smtpHost: '10.0.0.9', smtpPort: 22, smtpPassword: 'x' });
    is(r.body.sent === true && last().auth[1] === 'stored-secret', 'a host, port or password in the request is ignored: only the stored account is used');

    console.log('\nWho may');
    r = await post('agent-tok', { kind: 'test', to: 'me@shop.test' });
    is(r.code === 403, 'an Agent who answers chats may not send from here');
    r = await post('subs-tok', { kind: 'test', to: 'me@shop.test' });
    is(r.code === 403, 'nor may somebody ticked only for Subscribers send a test');
    r = await post(null, { kind: 'test', to: 'me@shop.test' });
    is(r.code === 403, 'nor anybody not signed in');

    console.log('\nThe welcome email');
    let before = SMTP.seen.length;
    r = await post('subs-tok', { kind: 'welcome', to: 'on@list.test' });
    m = last();
    const text = m ? Buffer.from(m.body.split('\n\n').slice(1).join(''), 'base64').toString() : '';
    is(r.body.sent === true && SMTP.seen.length === before + 1, 'somebody ticked for Subscribers sends it, without ever seeing the email password', JSON.stringify(r.body));
    is(/Subject: Welcome to Vaultique/.test(m.body) && /Thank you for joining us\./.test(text) && /Reply to come off the list\./.test(text) && /Vaultique, Lusaka/.test(text),
       'worded from Settings > Newsletter, with its footer and the signature', text.slice(0, 120));
    r = await post('subs-tok', { kind: 'welcome', to: 'stranger@else.test' });
    is(r.code === 400 && SMTP.seen.length === before + 1, 'only to somebody on the list: it is not a way to email anybody');
    r = await post('subs-tok', { kind: 'welcome', to: 'left@list.test' });
    is(r.code === 400, 'and not to somebody who left it');
    r = await post('agent-tok', { kind: 'welcome', to: 'on@list.test' });
    is(r.code === 403, 'an Agent may not send it');

    console.log('\nWhat went wrong, in words that say what to fix');
    SMTP.refuseLogin = true;
    r = await post('admin-tok', { kind: 'test', to: 'me@shop.test' });
    is(r.body.sent === false && r.body.reason === 'login' && /username or password/.test(r.body.error), 'a refused password', JSON.stringify(r.body));
    is(!/535|internal-user-db|Authentication failed/.test(r.raw), 'and the mail server\'s own words do not come back', r.raw);
    SMTP.refuseLogin = false;
    r = await post('admin-tok', { kind: 'test', to: 'refuse@shop.test' });
    is(r.body.reason === 'recipient' && !/550|relay-internal/.test(r.raw), 'a refused address', r.raw);
    STORE.notifications.smtpPort = 1;   // nothing listens there
    r = await post('admin-tok', { kind: 'test', to: 'me@shop.test' });
    is(r.body.reason === 'connect' && /could not be reached/.test(r.body.error) && !/127\.0\.0\.1|port 1\b/.test(r.raw),
       'a server that cannot be reached, without saying what was tried', r.raw);
    stored();
    STORE.notifications.emailEnabled = false;
    r = await post('admin-tok', { kind: 'test', to: 'me@shop.test' });
    is(r.body.sent === false && r.body.reason === 'not-set-up', 'email not set up yet');
    STORE.notifications.emailEnabled = true;

    console.log('\nThe old way, for the owner alone');
    before = SMTP.seen.length;
    r = await post('admin-tok', { smtpHost: '127.0.0.1', smtpPort: port, encryption: 'none', senderEmail: 'a@b.test', to: 'c@d.test', subject: 's', text: 't' });
    is(r.code === 403 && /Reload the admin page/.test(r.body.error) && SMTP.seen.length === before,
       'an Administrator\'s page from before build 77, sending the whole account, is told to reload: no host of its choosing');
    r = await post('owner-tok', { smtpHost: '127.0.0.1', smtpPort: port, encryption: 'none', senderEmail: 'a@b.test', to: 'c@d.test', subject: 's', text: 't' });
    is(r.body.sent === true, 'the owner may still try details before saving them');

    console.log('\nNot too many');
    for (let i = 0; i < 12; i++) r = await post('admin-tok', { kind: 'test', to: 'me@shop.test' });
    is(r.code === 429, 'ten test emails an hour for one person, then a polite no');

    console.log('\nBefore supabase-hardening.sql (build 77) has been run');
    reset(); stored(); OLD_DB = true; delete STORE.mail_secret;
    r = await post('admin-tok', { kind: 'test', to: 'me@shop.test' });
    is(r.code === 403, 'with no way to ask about ticks, only the owner may send');
    r = await post('owner-tok', { kind: 'test', to: 'me@shop.test' });
    is(r.body.sent === true && last().auth[1] === 'old-place-pw', 'and the password is read from where it used to be kept');
  } catch (e) {
    is(false, 'the test itself failed: ' + (e && e.stack || e));
  } finally {
    smtp.close(); api.close();
  }
  console.log(failures ? '\n  ✗ ' + failures + ' of ' + checks + ' checks FAILED' : '\n  sending email from the admin: all ' + checks + ' checks passed');
  process.exit(failures ? 1 : 0);
})();
