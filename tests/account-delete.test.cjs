/* ===========================================================================
   CLOSING AN ACCOUNT -- netlify/functions/account-delete.js (website 80)

   The owner: "when a customer deletes an account, it seems to have no effect
   because they can still sign in with the same credentials." The login
   stayed, because a browser cannot remove one. The function does, with the
   website's own key, against a stand-in for this website's Supabase:

     * a customer's login is removed, and then the profile, the saved
       addresses and the orders' owner are tidied as the browser used to;
     * any login on the admin list is refused, by its id or by its email,
       and so is everything when the admin list cannot be read;
     * a refused or failed close removes nothing at all;
     * Settings > Customer Accounts "customers may not close" is kept;
     * nobody is closed without a token Supabase recognises.
   =========================================================================== */
const http = require('http');
const path = require('path');

let checks = 0, failures = 0;
const is = (c, m, x) => { checks++; if (c) console.log('  ✓ ' + m); else { failures++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); } };

/* ---------------- the stand-in Supabase ---------------- */
const USERS = {
  'customer-jwt': { id: 'cust-1', email: 'Buyer@Mail.test' },
  'owner-jwt': { id: 'owner-1', email: 'owner@shop.test' },
  'former-jwt': { id: 'former-1', email: 'former@shop.test' },
  'samemail-jwt': { id: 'cust-9', email: 'agent@shop.test' }
};
let ADMINS, SETTINGS, CALLS, LOGIN_DELETE, ADMINS_FAIL;
function reset() {
  ADMINS = [
    { id: 'owner-1', email: 'owner@shop.test' },
    { id: 'former-1', email: 'former@shop.test' },      // switched off, still on the list
    { id: 'agent-1', email: 'AGENT@shop.test' }
  ];
  SETTINGS = { 'customer-accounts': { accountsEnabled: true, accountDeletion: true } };
  CALLS = [];
  LOGIN_DELETE = 204;
  ADMINS_FAIL = false;
}
reset();

const read = (req) => new Promise((r) => { let d = ''; req.on('data', (c) => { d += c; }); req.on('end', () => r(d)); });
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  const body = await read(req);
  const auth = req.headers.authorization || '';
  const service = auth === 'Bearer service-key' && req.headers.apikey === 'service-key';
  const send = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(o === undefined ? '' : JSON.stringify(o)); };
  CALLS.push({ method: req.method, path: p + u.search, service, body });

  if (p === '/web/auth/v1/user') {
    const who = USERS[auth.replace(/^Bearer /, '')];
    return who ? send(200, who) : send(401, { msg: 'invalid JWT' });
  }
  let m = /^\/web\/auth\/v1\/admin\/users\/(.+)$/.exec(p);
  if (m) {
    if (!service) return send(401, {});
    if (req.method !== 'DELETE') return send(405, {});
    return LOGIN_DELETE === 204 ? send(200, {}) : send(LOGIN_DELETE, { msg: 'Database error deleting user' });
  }
  if (p === '/web/rest/v1/site_settings') {
    const key = String(u.searchParams.get('key') || '').replace('eq.', '');
    return send(200, SETTINGS[key] ? [{ data: SETTINGS[key] }] : []);
  }
  if (p === '/web/rest/v1/admins') {
    if (!service) return send(401, {});
    return ADMINS_FAIL ? send(500, { message: 'the database is having a moment' }) : send(200, ADMINS);
  }
  if (/^\/web\/rest\/v1\/(customer_addresses|orders|customers)$/.test(p)) {
    if (!service) return send(401, {});
    return send(204);
  }
  send(404, { path: p });
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  Object.assign(process.env, {
    WEB_SUPABASE_URL: base + '/web', WEB_SUPABASE_ANON_KEY: 'anon-key', SUPABASE_SERVICE_ROLE_KEY: 'service-key'
  });
  const F = path.join(__dirname, '..', 'netlify', 'functions');
  const close = require(path.join(F, 'account-delete')).handler;
  const post = (token, method) => close({ httpMethod: method || 'POST', headers: token ? { authorization: 'Bearer ' + token } : {} })
    .then((r) => ({ code: r.statusCode, body: r.body ? JSON.parse(r.body) : null }));
  const loginDeletes = () => CALLS.filter((c) => c.method === 'DELETE' && /\/auth\/v1\/admin\/users\//.test(c.path));
  const tidying = () => CALLS.filter((c) => /\/rest\/v1\/(customer_addresses|orders|customers)/.test(c.path));

  console.log('\nA customer closes their account');
  let r = await post('customer-jwt');
  is(r.code === 200 && r.body.ok === true, 'the answer is: closed', JSON.stringify(r));
  is(loginDeletes().length === 1 && loginDeletes()[0].path === '/web/auth/v1/admin/users/cust-1' && loginDeletes()[0].service,
     'the login itself is removed, with the website\'s own key, and only that one', JSON.stringify(loginDeletes()));
  const tidy = tidying();
  is(tidy.length === 3 && tidy.every((c) => c.service) &&
     tidy[0].method === 'DELETE' && /customer_addresses\?customer_id=eq\.cust-1$/.test(tidy[0].path) &&
     tidy[1].method === 'PATCH' && /orders\?customer_id=eq\.cust-1$/.test(tidy[1].path) && JSON.parse(tidy[1].body).customer_id === null &&
     tidy[2].method === 'DELETE' && /customers\?id=eq\.cust-1$/.test(tidy[2].path),
     'then the addresses, the orders\' owner and the profile, as the browser used to (the orders themselves stay)',
     JSON.stringify(tidy.map((c) => c.method + ' ' + c.path)));
  is(CALLS.findIndex((c) => /admin\/users/.test(c.path)) < CALLS.findIndex((c) => /customer_addresses/.test(c.path)),
     'the login goes first, so a failure part-way never leaves it behind');

  console.log('\nThe shop\'s own logins are never closed from the shop');
  for (const [token, what] of [['owner-jwt', 'the owner'], ['former-jwt', 'an administrator who is switched off'],
                               ['samemail-jwt', 'a login whose email is on the admin list (any capitals)']]) {
    reset();
    r = await post(token);
    is(r.code === 403 && r.body.admin === true && /Users & Roles/.test(r.body.error) &&
       !loginDeletes().length && !tidying().length,
       what + ': refused, and nothing removed', JSON.stringify(r));
  }
  reset(); ADMINS_FAIL = true;
  r = await post('customer-jwt');
  is(r.code === 502 && /Nothing has been removed/.test(r.body.error) && !loginDeletes().length && !tidying().length,
     'an admin list that cannot be read: nothing is closed', JSON.stringify(r));

  console.log('\nRefused, and nothing removed');
  reset(); SETTINGS['customer-accounts'].accountDeletion = false;
  r = await post('customer-jwt');
  is(r.code === 403 && /message us/.test(r.body.error) && !loginDeletes().length && !tidying().length,
     'Settings > Customer Accounts says customers may not close their account');
  reset();
  r = await post('');
  is(r.code === 401 && !loginDeletes().length, 'nobody signed in');
  r = await post('made-up-token');
  is(r.code === 401 && !loginDeletes().length, 'a token Supabase does not recognise');
  r = await post('anon-key');
  is(r.code === 401 && !loginDeletes().length, 'the website\'s public key, sent as if it were a sign-in');
  r = await post('customer-jwt', 'GET');
  is(r.code === 405 && !loginDeletes().length, 'anything but POST');

  console.log('\nWhen Supabase will not remove the login');
  reset(); LOGIN_DELETE = 500;
  r = await post('customer-jwt');
  is(r.code === 502 && /Nothing has been removed/.test(r.body.error) && loginDeletes().length === 1 && !tidying().length,
     'it says so, and nothing else is touched: the customer can try again');
  reset(); LOGIN_DELETE = 404;
  r = await post('customer-jwt');
  is(r.code === 200 && r.body.ok === true, 'a login already gone (a second press, two tabs) is closed, as asked');

  console.log('\nNot set up');
  reset();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY; delete process.env.WEB_SUPABASE_SERVICE_KEY;
  r = await post('customer-jwt');
  is(r.code === 503 && !CALLS.length, 'without the website\'s key it asks nothing, and says to message the shop');
  process.env.SUPABASE_SERVICE_ROLE_KEY = key;

  server.close();
  console.log('\n' + (failures ? '  ✗ ' + failures + ' of ' + checks + ' checks FAILED'
                                : '  closing an account: all ' + checks + ' checks passed'));
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('  ✗ threw: ' + (e && e.stack || e)); process.exit(1); });
