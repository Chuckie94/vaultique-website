/* ===========================================================================
   CREATING AN ACCOUNT -- netlify/functions/account-signup.js
   Supabase's auth, the website's database and the email are answered here.
   =========================================================================== */
const path = require('path');
process.env.WEB_SUPABASE_URL = 'https://site.test';
process.env.WEB_SUPABASE_ANON_KEY = 'anon';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'site-service';
process.env.URL = 'https://shop.test';

let checks = 0, failures = 0;
const is = (c, m, x) => { checks++; if (c) console.log('  ✓ ' + m); else { failures++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); } };

let ACCOUNTS = { accountsEnabled: true, registration: 'open', emailVerification: true, passwordMinLength: 8 };
const USERS = {};            // email -> { confirmed, password, meta }
const SENDS = {};
const SENT = [];
let mailWorks = true;
let sqlRun = true;
let hideFromState = '';      // an account made between the two questions
global.fetch = async (url, opts = {}) => {
  const u = new URL(url);
  const ok = (data, status = 200) => ({ ok: status < 300, status, json: async () => data, text: async () => JSON.stringify(data) });
  const b = opts.body ? JSON.parse(opts.body) : {};
  if (u.pathname === '/auth/v1/admin/generate_link') {
    if (opts.headers.Authorization !== 'Bearer site-service') return ok({ msg: 'no' }, 401);
    if (b.type === 'signup') {
      if (USERS[b.email]) return ok({ msg: 'A user with this email address has already been registered' }, 422);
      USERS[b.email] = { confirmed: false, password: b.password, meta: b.data };
    }
    return ok({ action_link: 'https://site.test/auth/v1/verify?token=abc&type=' + b.type + '&redirect_to=' + b.redirect_to });
  }
  if (u.pathname === '/auth/v1/admin/users') {
    USERS[b.email] = { confirmed: true, password: b.password, meta: b.user_metadata };
    return ok({ id: 'x' });
  }
  if (u.pathname === '/rest/v1/rpc/account_signup_state') {
    if (!sqlRun) return ok({ code: 'PGRST202', message: 'Could not find the function public.account_signup_state' }, 404);
    const x = b.p_email === hideFromState ? null : USERS[b.p_email]; return ok(!x ? 'none' : x.confirmed ? 'confirmed' : 'waiting');
  }
  if (u.pathname === '/rest/v1/site_settings') {
    const key = (u.searchParams.get('key') || '').replace('eq.', '');
    if (key === 'customer-accounts') return ok([{ data: ACCOUNTS }]);
    if (key === 'notifications') return ok([{ data: { emailEnabled: true, smtpHost: 'smtp.test', senderEmail: 'noreply@shop.test' } }]);
    return ok([]);
  }
  if (u.pathname === '/rest/v1/site_settings_private') return ok([{ data: { smtpPassword: 'x' } }]);
  if (u.pathname === '/rest/v1/signup_sends') {
    if ((opts.method || 'GET') === 'GET') { const k = u.searchParams.get('k').replace('eq.', ''); return ok(SENDS[k] ? [SENDS[k]] : []); }
    SENDS[b.k] = b; return ok(null, 201);
  }
  return ok({ message: 'unexpected ' + url }, 404);
};
require.cache[require.resolve(path.resolve(__dirname, '../netlify/functions/send-email.js'))] = {
  exports: { _internals: { sendMail: async (m) => { if (!mailWorks) throw new Error('refused'); SENT.push(m); } } }
};
const fn = require(path.resolve(__dirname, '../netlify/functions/account-signup.js'));
let ipN = 0;
const call = async (body, ip) => {
  const r = await fn.handler({ httpMethod: 'POST', headers: { host: 'shop.test', 'x-nf-client-connection-ip': ip || ('10.0.0.' + (++ipN)) }, body: JSON.stringify(body) });
  return { status: r.statusCode, body: JSON.parse(r.body) };
};

(async () => {
  console.log('\nA new customer');
  let r = await call({ action: 'signup', email: 'New@Example.com ', password: 'secret123', name: 'Mutale Zulu' });
  is(r.status === 200 && r.body.created && r.body.confirm && r.body.emailed, 'the account is made and the link emailed', JSON.stringify(r.body));
  is(USERS['new@example.com'] && USERS['new@example.com'].confirmed === false, 'the account waits to be confirmed');
  is(USERS['new@example.com'].meta && USERS['new@example.com'].meta.consent_at, 'the consent time is kept on the account');
  is(SENT.length === 1 && SENT[0].to === 'new@example.com' && /verify\?token=/.test(SENT[0].text), 'the email goes to them with the link in it');
  is(/redirect_to=https:\/\/shop\.test\/account/.test(SENT[0].text), 'and the link brings them back to their account page');
  is(SENT[0].senderEmail === 'noreply@shop.test', 'sent from the shop\'s own email (Settings > Notifications)');

  console.log('\nThe link again');
  SENT.length = 0;
  r = await call({ action: 'resend', email: 'new@example.com' });
  is(r.status === 200 && SENT.length === 1 && /type=magiclink/.test(SENT[0].text), 'the link is sent again');
  r = await call({ action: 'resend', email: 'nobody@example.com' });
  is(r.status === 200 && SENT.length === 1, 'an unknown address gets the same answer and no email');
  r = await call({ action: 'resend', email: 'new@example.com' });
  r = await call({ action: 'resend', email: 'new@example.com' });
  is(r.status === 429, 'no more than three links an hour to one address', String(r.status));

  console.log('\nAn address already in use gets the same answer (build 77)');
  const again = (email, extra) => call(Object.assign({ action: 'signup', email, password: 'second-pass2', name: 'Mallory Visitor' }, extra || {}));
  SENT.length = 0;
  const asNew = await again('brand-new@example.com');
  USERS['waits@example.com'] = { confirmed: false, password: 'first-pass1', meta: { name: 'Owner' } };
  USERS['owner@example.com'] = { confirmed: true, password: 'theirs-123', meta: { name: 'Owner' } };
  SENT.length = 0;
  const asWaiting = await again('waits@example.com');
  const toWaiting = SENT.slice();
  SENT.length = 0;
  const asTaken = await again('Owner@Example.com ');
  const toTaken = SENT.slice();
  is(asNew.status === 200 && asNew.body.created && JSON.stringify(asWaiting) === JSON.stringify(asNew) &&
     JSON.stringify(asTaken) === JSON.stringify(asNew),
     'a new address, one waiting to be confirmed and one in use: the very same answer',
     [asNew, asWaiting, asTaken].map((x) => JSON.stringify(x)).join(' / '));
  is(toWaiting.length === 1 && toWaiting[0].to === 'waits@example.com' && /type=magiclink/.test(toWaiting[0].text) &&
     /still waiting to be confirmed/.test(toWaiting[0].text),
     'waiting: its owner is sent a link that confirms it and signs in', JSON.stringify(toWaiting));
  is(USERS['waits@example.com'].password === 'first-pass1' && USERS['owner@example.com'].password === 'theirs-123',
     'and no account\'s password is changed by somebody signing up with its address');
  is(toTaken.length === 1 && toTaken[0].to === 'owner@example.com' && /already an account/.test(toTaken[0].text) &&
     /Sign in here: https:\/\/shop\.test\/account/.test(toTaken[0].text) && /Forgotten your password\?/.test(toTaken[0].text) &&
     !/token=/.test(toTaken[0].text),
     'in use: its owner is told, with where to sign in and how to choose a new password, and no link that does anything',
     JSON.stringify(toTaken));
  is(!/Mallory|second-pass2/.test(toWaiting.concat(toTaken).map((m) => m.subject + ' ' + m.text).join(' ')),
     'nothing typed into the form reaches the owner\'s inbox, not even the name');
  ACCOUNTS.passwordReset = false;
  SENT.length = 0;
  await again('owner@example.com');
  is(SENT.length === 1 && !/on the sign-in page/.test(SENT[0].text) && /Reply to this email/.test(SENT[0].text),
     'with "Offer password reset" off, the email does not send them to it');
  delete ACCOUNTS.passwordReset;
  mailWorks = false;
  const newFails = await again('another-new@example.com');
  const takenFails = await again('owner@example.com');
  mailWorks = true;
  is(newFails.body.emailed === false && JSON.stringify(takenFails) === JSON.stringify(newFails),
     'the email failing: the same answer for both as well', JSON.stringify(newFails) + ' / ' + JSON.stringify(takenFails));
  for (let i = 0; i < 3; i++) r = await again('brand-new@example.com');
  const r2 = await again('owner@example.com');
  is(r.status === 429 && JSON.stringify(r2) === JSON.stringify(r),
     'and the same limit, three emails an hour to one address, in use or not', JSON.stringify(r) + ' / ' + JSON.stringify(r2));
  USERS['race@example.com'] = { confirmed: true, password: 'theirs-123' };
  hideFromState = 'race@example.com';
  SENT.length = 0;
  r = await again('race@example.com');
  hideFromState = '';
  is(JSON.stringify(r) === JSON.stringify(asNew) && SENT.length === 1 && SENT[0].to === 'race@example.com' &&
     /already an account/.test(SENT[0].text),
     'an account made a moment before, between the two questions: the same answer, and its owner told', JSON.stringify(r));
  ACCOUNTS.emailVerification = false;
  r = await again('owner@example.com');
  ACCOUNTS.emailVerification = true;
  is(r.status === 409 && /already an account/.test(r.body.error) && USERS['owner@example.com'].password === 'theirs-123',
     'with "Verify email addresses" off it cannot be the same (the account would be signed straight in): ' +
     'an address in use is said to be, as Supabase\'s own sign-up says it', JSON.stringify(r));

  console.log('\nThe shop\'s rules');
  r = await call({ action: 'signup', email: 'a@example.com', password: 'short', name: 'A' });
  is(r.status === 400 && /at least 8/.test(r.body.error), 'the password rule is checked on the server too');
  r = await call({ action: 'signup', email: 'a@example.com', password: 'secret123', name: '' });
  is(r.status === 400, 'a name is needed');
  ACCOUNTS.registration = 'closed';
  r = await call({ action: 'signup', email: 'a@example.com', password: 'secret123', name: 'A' });
  is(r.status === 403, 'closed registration is respected');
  ACCOUNTS.registration = 'open';
  ACCOUNTS.emailVerification = false;
  SENT.length = 0;
  r = await call({ action: 'signup', email: 'b@example.com', password: 'secret123', name: 'B' });
  is(r.status === 200 && r.body.confirm === false && USERS['b@example.com'].confirmed && SENT.length === 0,
     'with "Verify email addresses" off, the account is ready at once and no email is sent', JSON.stringify(r.body));
  ACCOUNTS.emailVerification = true;

  console.log('\nWhen something is missing');
  mailWorks = false;
  r = await call({ action: 'signup', email: 'c@example.com', password: 'secret123', name: 'C' });
  is(r.status === 200 && r.body.created && r.body.emailed === false && /Send the link again/.test(r.body.error),
     'the email failing still leaves the account, and says how to get the link', JSON.stringify(r.body));
  mailWorks = true;
  sqlRun = false;
  r = await call({ action: 'signup', email: 'd@example.com', password: 'secret123', name: 'D' });
  is(r.status === 503 && r.body.fallback, 'before the SQL is run, the storefront is told to use Supabase\'s own sign-up', JSON.stringify(r.body));
  sqlRun = true;
  for (let i = 0; i < 11; i++) r = await call({ action: 'signup', email: 'e' + i + '@example.com', password: 'secret123', name: 'E' }, '9.9.9.9');
  is(r.status === 429, 'no more than ten sign-ups an hour from one connection', String(r.status));
  is(!JSON.stringify(SENDS).includes('@') && !JSON.stringify(SENDS).includes('9.9.9.9'), 'and the counts keep fingerprints, not addresses');

  console.log(failures ? '\n  ✗ ' + failures + ' of ' + checks + ' checks FAILED' : '\n  account sign-up: all ' + checks + ' checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
