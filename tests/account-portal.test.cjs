/* ===========================================================================
   THE CUSTOMER PORTAL'S OWN RECORDS -- netlify/functions/account-portal.js
   (website 86)

   The account pages ask this function for the records only the shop may
   read: the newsletter list, refunds on their way, and everything for "Download
   my personal data". Run as Netlify runs it, against a stand-in for this
   website's Supabase that holds TWO customers and answers PostgREST's
   filters (eq, in, ilike with its escapes) the way PostgREST does:

     * only a token Supabase recognises gets anything;
     * each customer gets their own rows and never the other's, however the
       address is written (capitals, an underscore that ilike would read as
       "any letter");
     * nothing that proves ownership of something (the chat's token, an
       order's private link) and nothing the team wrote for itself (who made
       a refund, and why) ever leaves;
     * off is at once; on is at once for a new address, and an address that
       left the list is sent a link, and is not put back until it is
       followed (the newsletter form's rule since build 76);
     * every read of the shop's records is made with the website's own key,
       and each customer may ask for the data file ten times an hour.
   =========================================================================== */
'use strict';
const http = require('http');
const path = require('path');

let checks = 0, failures = 0;
const is = (c, m, x) => { checks++; if (c) console.log('  ✓ ' + m); else { failures++; console.log('  ✗ ' + m + (x ? '\n      ' + String(x).slice(0, 600) : '')); } };
const J = JSON.stringify;

/* ---------------- two customers, side by side ---------------- */
const USERS = {
  'chanda-jwt': { id: 'u-chanda', email: 'Chanda_B@Mail.test', created_at: '2026-10-02T08:00:00Z', email_confirmed_at: '2026-10-02T08:05:00Z',
                  last_sign_in_at: '2026-11-20T09:00:00Z', user_metadata: { name: 'Chanda', consent_at: '2026-10-02T08:00:00Z', other: 'not ours' } },
  'mwila-jwt': { id: 'u-mwila', email: 'mwila@mail.test', created_at: '2026-10-05T08:00:00Z', email_confirmed_at: '2026-10-05T08:05:00Z',
                 user_metadata: {} },
  'new-jwt': { id: 'u-new', email: 'new.person@mail.test', created_at: '2026-11-01T08:00:00Z', email_confirmed_at: '2026-11-01T08:05:00Z',
               user_metadata: {} },
};
let DB, CALLS, MAILS, THROTTLE, MAIL_ON;
function reset() {
  DB = {
    subscribers: [
      /* An address the underscore in chanda_b would match if it were read
         as "any letter", first, and off the list: a lookup that took the
         first match would read and change the wrong person. */
      { email: 'chandaXb@mail.test', created_at: '2026-10-03T08:00:00Z', unsubscribed_at: '2026-10-20T00:00:00Z', rejoin_hash: null, rejoin_at: null },
      { email: 'chanda_b@mail.test', created_at: '2026-10-02T08:00:00Z', unsubscribed_at: null, rejoin_hash: 'secret-a', rejoin_at: null },
      { email: 'mwila@mail.test', created_at: '2026-10-05T08:00:00Z', unsubscribed_at: '2026-11-01T00:00:00Z', rejoin_hash: null, rejoin_at: null },
    ],
    customers: [
      { id: 'u-chanda', name: 'Chanda', phone: '+260 970 000 001', wishlist: ['WF-1'], created_at: '2026-10-02T08:00:00Z', updated_at: '2026-11-01T08:00:00Z' },
      { id: 'u-mwila', name: 'Mwila', phone: '+260 970 000 002', wishlist: [], created_at: '2026-10-05T08:00:00Z', updated_at: '2026-10-05T08:00:00Z' },
    ],
    customer_addresses: [
      { id: 'a1', customer_id: 'u-chanda', label: 'Home', recipient: 'Chanda', phone: '+260 970 000 001', address: 'Plot 1, Stand-in Road', city: 'Lusaka', is_default: true, created_at: '2026-10-02T08:00:00Z' },
      { id: 'a2', customer_id: 'u-mwila', label: 'Work', recipient: 'Mwila', phone: '+260 970 000 002', address: 'Plot 2, Other Road', city: 'Ndola', is_default: true, created_at: '2026-10-05T08:00:00Z' },
    ],
    orders: [
      { id: 'o1', customer_id: 'u-chanda', ref: 'VB-CHA1', status: 'delivered', fulfilment: 'delivery', name: 'Chanda', phone: '+260 970 000 001',
        email: 'chanda_b@mail.test', address: 'Plot 1, Stand-in Road', total: 500, currency: 'ZMW', payment_method: 'online', payment_status: 'paid',
        paid_at: '2026-11-02T10:00:00Z', progress_token: 'private-link-token', pay_ref: 'VBP-x', created_at: '2026-11-02T09:00:00Z',
        refund_state: 'part', refund_amount: 100, refund_ref: 'FLW-R1', refund_at: '2026-11-05T10:00:00Z', dispatch_mailed_at: '2026-11-03T10:00:00Z' },
      { id: 'o2', customer_id: 'u-chanda', ref: 'VB-CHA2', status: 'pending', fulfilment: 'collection', total: 120, currency: 'ZMW',
        created_at: '2026-11-10T09:00:00Z' },
      { id: 'o3', customer_id: 'u-mwila', ref: 'VB-MWI1', status: 'confirmed', fulfilment: 'delivery', total: 900, currency: 'ZMW',
        payment_method: 'online', payment_status: 'paid', created_at: '2026-11-04T09:00:00Z' },
    ],
    order_items: [
      { id: 'i1', order_id: 'o1', sku: 'WF-1', name: 'Stand-in dress', price: 500, qty: 1 },
      { id: 'i2', order_id: 'o2', sku: 'BG-2', name: 'Stand-in bag', price: 120, qty: 1 },
      { id: 'i3', order_id: 'o3', sku: 'SH-3', name: 'Other customer\'s shoes', price: 900, qty: 1 },
    ],
    payments: [
      { id: 'p1', order_id: 'o1', tx_ref: 'VBP-x', mode: 'live', status: 'paid', amount: 500, currency: 'ZMW', channel: 'card',
        phone: '+260 970 000 001', provider_tx_id: '777', detail: { card: { first_6digits: '553188', last_4digits: '2950' } },
        created_at: '2026-11-02T09:59:00Z', updated_at: '2026-11-02T10:00:00Z' },
      { id: 'p3', order_id: 'o3', tx_ref: 'VBP-y', mode: 'live', status: 'paid', amount: 900, currency: 'ZMW', channel: 'card',
        created_at: '2026-11-04T09:59:00Z', updated_at: '2026-11-04T10:00:00Z' },
    ],
    refunds: [
      { id: 'r1', order_id: 'o1', order_ref: 'VB-CHA1', amount: 100, currency: 'ZMW', whole: false, state: 'completed',
        reason: 'Team note: strap loose', by_name: 'A team member', by_role: 'Sales Agent', flw_refund_id: '99', flw_message: 'ok',
        request_key: 'k1', provider_tx_id: '777', requested_at: '2026-11-05T09:00:00Z', completed_at: '2026-11-05T10:00:00Z' },
      { id: 'r2', order_id: 'o1', order_ref: 'VB-CHA1', amount: 50, currency: 'ZMW', whole: false, state: 'pending',
        reason: 'Team note: late', by_name: 'A team member', requested_at: '2026-11-06T09:00:00Z', accepted_at: '2026-11-06T09:05:00Z' },
      { id: 'r3', order_id: 'o3', order_ref: 'VB-MWI1', amount: 900, currency: 'ZMW', whole: true, state: 'new',
        reason: 'Other customer', by_name: 'A team member', requested_at: '2026-11-07T09:00:00Z' },
    ],
    chat_conversations: [
      { id: 'c1', token: 'chat-ownership-token', customer_id: 'u-chanda', name: 'Chanda', phone: null, email: 'chanda_b@mail.test',
        status: 'open', created_at: '2026-11-03T08:00:00Z', last_message_at: '2026-11-03T08:05:00Z' },
      { id: 'c2', token: 'other-token', customer_id: 'u-mwila', name: 'Mwila', status: 'open', created_at: '2026-11-04T08:00:00Z', last_message_at: '2026-11-04T08:00:00Z' },
    ],
    chat_messages: [
      { id: 'm1', conversation_id: 'c1', sender: 'customer', body: 'Is the dress in a 12?', created_at: '2026-11-03T08:00:00Z' },
      { id: 'm2', conversation_id: 'c1', sender: 'shop', body: 'Yes, it is.', created_at: '2026-11-03T08:05:00Z' },
      { id: 'm3', conversation_id: 'c2', sender: 'customer', body: 'Mwila\'s question', created_at: '2026-11-04T08:00:00Z' },
    ],
    rewards_links: [{ user_id: 'u-chanda', cust_no: 'VB0123', how: 'code', linked_at: '2026-10-10T08:00:00Z' }],
    rewards_requests: [{ id: 'q1', user_id: 'u-mwila', kind: 'join', name: 'Mwila', status: 'waiting', note: 'team only', created_at: '2026-10-06T08:00:00Z' }],
    rewards_holds: [{ id: 'h1', user_id: 'u-chanda', cust_no: 'VB0123', order_ref: 'VB-CHA1', points: 100, value: 10, status: 'rung_up', created_at: '2026-11-02T09:00:00Z' }],
    /* Website 87: requests to the shop. Who in the team answered is the team's. */
    order_requests: [
      { id: 'rq1', ref: 'RQ-CHA1AB', order_id: 'o1', order_ref: 'VB-CHA1', customer_id: 'u-chanda', kind: 'return', reason: 'wrong_size',
        detail: 'Too small.', wants: null, items: [{ sku: 'WF-1', name: 'Stand-in dress', qty: 1 }], status: 'accepted',
        answer: 'Bring it in any day.', decided_at: '2026-11-06T10:00:00Z', decided_by: 'staff.member@shop.test', decided_from: 'platform',
        platform_ref: 'ONL-77', done_at: null, shop_told_at: '2026-11-06T09:15:00Z', customer_told: 'accepted', created_at: '2026-11-06T09:00:00Z' },
      { id: 'rq2', ref: 'RQ-MWI1AB', order_id: 'o3', order_ref: 'VB-MWI1', customer_id: 'u-mwila', kind: 'cancel', reason: 'too_slow',
        detail: 'Mwila\'s request', items: [], status: 'requested', created_at: '2026-11-05T09:00:00Z' },
    ],
  };
  CALLS = []; MAILS = []; THROTTLE = {}; MAIL_ON = true;
}
reset();

/* ---------------- PostgREST's filters, as PostgREST reads them ---------------- */
function likeToRegex(pat) {
  /* PostgREST turns * into %; then LIKE: \x is x itself, % any run, _ one letter. */
  let out = '';
  for (let i = 0; i < pat.length; i++) {
    const ch = pat[i];
    if (ch === '\\' && i + 1 < pat.length) { out += pat[++i].replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&'); continue; }
    if (ch === '%' || ch === '*') { out += '.*'; continue; }
    if (ch === '_') { out += '.'; continue; }
    out += ch.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
  }
  return new RegExp('^' + out + '$', 'i');
}
function filterRows(list, params) {
  let out = list.slice();
  for (const [k, v] of params) {
    if (['select', 'order', 'limit'].includes(k)) continue;
    let m;
    if ((m = /^eq\.(.*)$/.exec(v))) out = out.filter((r) => String(r[k]) === m[1]);
    else if ((m = /^in\.\((.*)\)$/.exec(v))) { const set = m[1].split(','); out = out.filter((r) => set.includes(String(r[k]))); }
    else if ((m = /^ilike\.(.*)$/.exec(v))) { const re = likeToRegex(m[1]); out = out.filter((r) => re.test(String(r[k]))); }
    else if (v === 'is.null') out = out.filter((r) => r[k] == null);
    else throw new Error('stand-in does not know the filter ' + k + '=' + v);
  }
  return out;
}
function selectRows(table, list, select) {
  if (!select || select === '*') return list.map((r) => Object.assign({}, r));
  const parts = select.split(/,(?![^(]*\))/);
  return list.map((r) => {
    const o = {};
    for (const part of parts) {
      const emb = /^(\w+)\((.*)\)$/.exec(part);
      if (emb) { o[emb[1]] = DB[emb[1]].filter((x) => x.order_id === r.id).map((x) => selectRows(emb[1], [x], emb[2])[0]); continue; }
      if (part === '*') Object.assign(o, r); else if (part in r) o[part] = r[part]; else o[part] = null;
    }
    return o;
  });
}

const read = (req) => new Promise((r) => { let d = ''; req.on('data', (c) => { d += c; }); req.on('end', () => r(d)); });
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  const body = await read(req);
  const auth = req.headers.authorization || '';
  const service = auth === 'Bearer service-key' && req.headers.apikey === 'service-key';
  const send = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(o === undefined ? '' : J(o)); };
  CALLS.push({ method: req.method, path: p + u.search, service, apikey: req.headers.apikey, body });

  if (p === '/web/auth/v1/user') {
    if (req.headers.apikey !== 'anon-key') return send(401, { msg: 'no apikey' });
    const who = USERS[auth.replace(/^Bearer /, '')];
    return who ? send(200, who) : send(401, { msg: 'invalid JWT' });
  }
  if (p === '/web/rest/v1/site_settings') {
    const key = String(u.searchParams.get('key') || '').replace('eq.', '');
    if (key === 'general') return send(200, [{ data: { businessName: 'Vaultique Boutique Point' } }]);
    if (key === 'notifications') return send(200, [{ data: { emailEnabled: MAIL_ON, smtpHost: 'smtp.example', senderEmail: 'shop@example.com' } }]);
    return send(200, []);
  }
  if (!service) return send(401, { message: 'service key only' });
  if (p === '/web/rest/v1/site_settings_private') return send(200, MAIL_ON ? [{ data: { smtpPassword: 'x' } }] : []);
  if (p === '/web/rest/v1/rpc/throttle') {
    const b = JSON.parse(body || '{}');
    const k = b.p_bucket + '|' + b.p_key;
    THROTTLE[k] = (THROTTLE[k] || 0) + 1;
    return THROTTLE[k] > b.p_max ? send(400, { message: 'Too many requests, please wait' }) : send(204);
  }
  if (p === '/web/rest/v1/rpc/newsletter_join') {
    const b = JSON.parse(body || '{}');
    const r = DB.subscribers.find((x) => x.email.toLowerCase() === String(b.p_email).toLowerCase());
    if (!r) { DB.subscribers.push({ email: b.p_email, created_at: new Date().toISOString(), unsubscribed_at: null }); return send(200, { state: 'joined' }); }
    if (!r.unsubscribed_at) return send(200, { state: 'already' });
    r.rejoin_hash = 'hash'; r.rejoin_at = new Date().toISOString();
    return send(200, { state: 'confirm', token: 'a'.repeat(48), email: r.email });
  }
  const m = /^\/web\/rest\/v1\/(\w+)$/.exec(p);
  if (!m || !DB[m[1]]) return send(404, { code: 'PGRST205', message: 'Could not find the table ' + p });
  const table = m[1];
  const params = [...u.searchParams.entries()];
  let found;
  try { found = filterRows(DB[table], params); } catch (e) { return send(400, { message: e.message }); }
  if (req.method === 'GET') return send(200, selectRows(table, found, u.searchParams.get('select')));
  if (req.method === 'PATCH') { const b = JSON.parse(body || '{}'); found.forEach((r) => Object.assign(r, b)); return send(204); }
  return send(405, {});
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  Object.assign(process.env, {
    WEB_SUPABASE_URL: base + '/web', WEB_SUPABASE_ANON_KEY: 'anon-key', SUPABASE_SERVICE_ROLE_KEY: 'service-key', URL: 'https://shop.example',
  });
  const F = path.join(__dirname, '..', 'netlify', 'functions');
  require(path.join(F, 'send-email'))._internals.sendMail = async (mail) => { MAILS.push(mail); };
  const fn = require(path.join(F, 'account-portal')).handler;
  const ask = (token, body, method) => fn({
    httpMethod: method || 'POST',
    headers: Object.assign({ 'content-type': 'application/json', 'x-nf-client-connection-ip': '203.0.113.9' }, token ? { authorization: 'Bearer ' + token } : {}),
    body: J(body || {}),
  }).then((r) => ({ code: r.statusCode, body: r.body ? JSON.parse(r.body) : null }));
  const dbCalls = () => CALLS.filter((c) => /\/rest\/v1\//.test(c.path) && !/site_settings/.test(c.path));

  try {
    console.log('\nOnly a token Supabase recognises');
    let r = await ask('', { action: 'data' });
    is(r.code === 401, 'nobody signed in: refused', J(r));
    r = await ask('made-up', { action: 'data' });
    is(r.code === 401, 'a token Supabase does not recognise: refused', J(r));
    r = await ask('anon-key', { action: 'data' });
    is(r.code === 401, 'the website\'s public key, sent as if it were a sign-in: refused', J(r));
    r = await ask('chanda-jwt', { action: 'data' }, 'GET');
    is(r.code === 405, 'anything but POST: refused', J(r));
    r = await ask('chanda-jwt', { action: 'delete-everything' });
    is(r.code === 400, 'an action it does not know: refused', J(r));
    is(!dbCalls().length, 'and none of those read a single record', J(dbCalls()));

    console.log('\nThe newsletter, for the account\'s own address only');
    reset();
    r = await ask('chanda-jwt', { action: 'newsletter' });
    is(r.code === 200 && r.body.state === 'on' && r.body.email === 'chanda_b@mail.test',
       'on the list, found whatever the capitals', J(r));
    r = await ask('mwila-jwt', { action: 'newsletter' });
    is(r.code === 200 && r.body.state === 'off', 'left the list: off', J(r));
    r = await ask('new-jwt', { action: 'newsletter' });
    is(r.code === 200 && r.body.state === 'off', 'never on it: off', J(r));

    console.log('\nOff, at once, and only that address');
    reset();
    r = await ask('chanda-jwt', { action: 'newsletter-set', on: false });
    const chanda = DB.subscribers.find((x) => x.email === 'chanda_b@mail.test');
    const lookalike = DB.subscribers.find((x) => x.email === 'chandaXb@mail.test');
    is(r.code === 200 && r.body.state === 'off' && !!chanda.unsubscribed_at, 'taken off the list', J(r));
    is(lookalike.unsubscribed_at === '2026-10-20T00:00:00Z',
       'an address the underscore would match by mistake (chandaXb for chanda_b) is left alone', J(lookalike));
    const patches = CALLS.filter((c) => c.method === 'PATCH');
    is(patches.length === 1 && /subscribers\?email=eq\.chanda_b%40mail\.test$/.test(patches[0].path) && J(Object.keys(JSON.parse(patches[0].body))) === '["unsubscribed_at"]',
       'one change, to that one row, and to nothing but the date it left', J(patches.map((c) => c.path + ' ' + c.body)));
    r = await ask('chanda-jwt', { action: 'newsletter-set', on: false });
    is(r.code === 200 && r.body.state === 'off' && CALLS.filter((c) => c.method === 'PATCH').length === 1, 'asked twice: nothing more is written');

    console.log('\nOn: a new address joins; one that left is sent a link');
    reset();
    r = await ask('new-jwt', { action: 'newsletter-set', on: true });
    is(r.code === 200 && r.body.state === 'on' && DB.subscribers.some((x) => x.email === 'new.person@mail.test' && !x.unsubscribed_at),
       'a new address: on the list at once, as the newsletter form does', J(r));
    r = await ask('mwila-jwt', { action: 'newsletter-set', on: true });
    const mwila = DB.subscribers.find((x) => x.email === 'mwila@mail.test');
    is(r.code === 200 && r.body.state === 'confirm' && !!mwila.unsubscribed_at,
       'an address that left: not put back by a signed-in browser alone', J({ r, mwila }));
    is(MAILS.length === 1 && MAILS[0].to === 'mwila@mail.test' && /\/\.netlify\/functions\/newsletter\?confirm=[0-9a-f]{48}/.test(MAILS[0].text || ''),
       'a link goes to that inbox, through the shop\'s own email, and only following it puts it back', J(MAILS.map((x) => x.to)));
    reset(); MAIL_ON = false;
    r = await ask('mwila-jwt', { action: 'newsletter-set', on: true });
    is(r.code === 502 && /could not be sent/.test(r.body.error) && !!DB.subscribers.find((x) => x.email === 'mwila@mail.test').unsubscribed_at,
       'the shop\'s email not working: it says the link could not be sent, and the address stays off the list', J(r));
    r = await ask('chanda-jwt', { action: 'newsletter-set', on: 'yes' });
    is(r.code === 400, 'anything but yes or no: refused', J(r));

    console.log('\nRefunds: the customer\'s own, without the team\'s notes');
    reset();
    r = await ask('chanda-jwt', { action: 'refunds' });
    const refs = (r.body && r.body.refunds) || [];
    is(r.code === 200 && refs.length === 2 && refs.every((x) => x.order_ref === 'VB-CHA1'),
       'both refunds on their own order, the one on its way included; none of the other customer\'s', J(r));
    is(refs.every((x) => !('reason' in x) && !('by_name' in x) && !('by_role' in x) && !('request_key' in x) && !('flw_refund_id' in x) && !('provider_tx_id' in x)),
       'who in the team made them, why, and the payment service\'s own numbers stay in the shop', J(refs));
    is(refs.some((x) => x.state === 'pending' && x.accepted_at) && refs.some((x) => x.state === 'completed' && x.completed_at),
       'each says where it is: on its way, or refunded', J(refs));
    r = await ask('new-jwt', { action: 'refunds' });
    is(r.code === 200 && J(r.body.refunds) === '[]', 'a customer with no orders: no refunds, and no question about anybody else\'s', J(r));

    console.log('\nDownload my personal data');
    reset();
    r = await ask('chanda-jwt', { action: 'data' });
    const d = r.body || {};
    const text = J(d);
    is(r.code === 200 && d.account && d.account.email === 'chanda_b@mail.test' && d.account.consent_given_at === '2026-10-02T08:00:00Z' && !('other' in d.account),
       'the account: the address, when it was made and confirmed, and when consent was given', J(d.account));
    is(d.details && d.details.name === 'Chanda' && J(d.details.wishlist) === '["WF-1"]' && d.addresses.length === 1 && d.addresses[0].city === 'Lusaka',
       'the details, the wishlist and the saved address', J([d.details, d.addresses]));
    is(d.orders.length === 2 && d.orders.map((o) => o.ref).sort().join() === 'VB-CHA1,VB-CHA2' &&
       d.orders.find((o) => o.ref === 'VB-CHA1').items[0].name === 'Stand-in dress',
       'both of their orders, with what was in them', J(d.orders));
    is(d.payments.length === 1 && d.payments[0].order_ref === 'VB-CHA1' && d.payments[0].channel === 'card' && !('detail' in d.payments[0]),
       'their payment, said as how and how much, never the card\'s digits', J(d.payments));
    is(d.refunds.length === 2 && d.newsletter && d.newsletter.email === 'chanda_b@mail.test' && d.newsletter.left_at === null,
       'their refunds and their newsletter entry', J([d.refunds, d.newsletter]));
    is(d.chats.length === 1 && d.chats[0].messages.length === 2 && d.chats[0].messages[1].body === 'Yes, it is.',
       'their chat with the shop, both sides of it', J(d.chats));
    is(d.rewards && d.rewards.link && d.rewards.link.cust_no === 'VB0123' && d.rewards.points_promised_on_orders.length === 1,
       'their rewards link, and the points promised on an order', J(d.rewards));
    is(Array.isArray(d.requests) && d.requests.length === 1 && d.requests[0].ref === 'RQ-CHA1AB' && d.requests[0].kind === 'return' &&
       d.requests[0].answer === 'Bring it in any day.' && d.requests[0].items[0].name === 'Stand-in dress' &&
       J(Object.keys(d.requests[0])) === J(['ref', 'order_ref', 'kind', 'reason', 'detail', 'wants', 'items', 'status', 'answer', 'created_at', 'decided_at', 'done_at']),
       'website 87: their requests to the shop and its answers, and nothing of who in the team answered', J(d.requests));
    is(!/Mwila|VB-MWI1|u-mwila|Other customer|Ndola/.test(text), 'nothing of the other customer\'s, anywhere in the file');
    is(!/private-link-token|chat-ownership-token|secret-a|rejoin|progress_token|"token"|553188|2950|Team note|A team member|provider_tx_id|dispatch_mailed_at|staff\.member|ONL-77|shop_told_at|customer_told/.test(text),
       'and nothing that proves ownership, no card digits, no team notes, no bookkeeping', text.slice(0, 300));
    is(dbCalls().length > 0 && dbCalls().every((c) => c.service), 'every record read with the website\'s own key, never the customer\'s', J(dbCalls().filter((c) => !c.service)));
    const ownOnly = dbCalls().filter((c) => c.method === 'GET' && /\/(orders|customers|customer_addresses|chat_conversations|rewards_links|rewards_requests|rewards_holds|order_requests)\?/.test(c.path));
    is(ownOnly.length >= 8 && ownOnly.every((c) => /(customer_id|user_id|id)=eq\.u-chanda/.test(c.path)),
       'each table asked for this customer\'s rows by their own id, never all of them', J(ownOnly.map((c) => c.path)));

    console.log('\nNo more than ten files an hour');
    reset();
    let last = null;
    for (let i = 0; i < 11; i++) last = await ask('mwila-jwt', { action: 'data' });
    is(last.code === 429 && /many times this hour/.test(last.body.error), 'the eleventh in an hour is refused, and says why', J(last));
    r = await ask('chanda-jwt', { action: 'data' });
    is(r.code === 200, 'counted for each customer: another customer is not held up', J(r.code));

    console.log('\nNot set up');
    const keep = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    r = await ask('chanda-jwt', { action: 'data' });
    is(r.code === 503 && /not available just now/.test(r.body.error), 'without the website\'s service key: says so, and reads nothing', J(r));
    process.env.SUPABASE_SERVICE_ROLE_KEY = keep;
  } catch (e) {
    failures++;
    console.log('  ✗ the test itself broke: ' + (e && e.stack || e));
  }
  server.close();
  console.log('\n  account portal: ' + (failures ? failures + ' of ' + checks + ' checks FAILED' : 'all ' + checks + ' checks passed'));
  process.exit(failures ? 1 : 0);
})();
