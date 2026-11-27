/* ===========================================================================
   AN ORDER'S PROGRESS: THE FIFTEEN-MINUTE CHECK (website build 78)

   netlify/functions/order-progress.js run as Netlify runs it, against a
   stand-in for this website's Supabase (the same kind as payments-77.test.cjs)
   and a stand-in for the shop's email:

     1. before supabase-order-progress.sql: it stops at once, changes nothing;
     2. On its way: emailed once, with the note, the day and the private link;
     3. the reminder: so many days before the day, once, never in the same run;
     4. the day passed: marked delivered, then emailed once; an order the
        customer confirmed a moment ago is left as they said;
     5. delivered by the shop, collected, confirmed by the customer: who is
        told, and who is not;
     6. a refund: emailed once, in the shop's money; not when told not to;
     7. no email set up, no address, old news: nothing sent, nothing marked,
        and delivery still marked; no service key: nothing at all.
     8. BUILD 87 · customers' requests (supabase-customer-requests.sql):
        before that SQL, nothing; the shop told of each new one, once, at
        its own address; one withdrawn first, or too old, not at all; the
        customer told of each answer, once each, with the shop's word the
        first time and with a refusal; a cancel paid online told how the
        money comes back; no email set up, no address: nothing sent,
        nothing marked.
   =========================================================================== */
const http = require('http');
const path = require('path');

let checks = 0, failures = 0;
const ok = m => { checks++; console.log('  ✓ ' + m); };
const fail = (m, x) => { checks++; failures++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); };
const is = (c, m, x) => c ? ok(m) : fail(m, x);
const J = o => JSON.stringify(o);

const H = 3600000, D = 24 * H;
const ago = ms => new Date(Date.now() - ms).toISOString();
const ahead = ms => new Date(Date.now() + ms).toISOString();
const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

let SETTINGS, PRIV, DB, MAIL, NO_COLUMNS, RACE;
function reset() {
  SETTINGS = {
    general: { businessName: 'Vaultique', currency: 'ZMW' },
    pricing: {},
    notifications: { emailEnabled: true, smtpHost: 'smtp.example.com', senderEmail: 'shop@example.com', signature: 'Vaultique' },
  };
  PRIV = { notifications: { smtpPassword: 'x' } };
  DB = { orders: [] };
  MAIL = [];
  NO_COLUMNS = false;
  RACE = null;
}
reset();
const base = (o) => Object.assign({
  name: 'Test Buyer', email: 'buyer@example.com', fulfilment: 'delivery', status: 'dispatched', total: 1530,
  ship_note: null, dispatched_at: ago(10 * 60000), delivered_at: null, delivered_by: null,
  auto_deliver_at: ahead(7 * D), extend_days: 3, extend_max: 2, extend_used: 0, remind_days: 2, reminded_at: null,
  progress_token: TOKEN, dispatch_mailed_at: null, delivered_mailed_at: null,
  refund_state: null, refund_amount: null, refund_ref: null, refund_note: null, refund_at: null, refund_mailed_at: null
}, o);
const order = ref => DB.orders.find(o => o.ref === ref);

const read = req => new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => r(d)); });
function filters(q) {
  const out = [];
  for (const [k, v] of new URLSearchParams(q)) {
    if (['select', 'order', 'limit'].includes(k)) continue;
    const m = /^(eq|neq|in|gt|lt|gte|lte|is)\.(.*)$/.exec(v);
    if (m) out.push([k, m[1], m[2]]);
  }
  return out;
}
function matches(row, fs) {
  return fs.every(([k, op, v]) => {
    const x = row[k] == null ? '' : String(row[k]);
    if (op === 'eq') return x === v;
    if (op === 'neq') return x !== v;
    if (op === 'gt') return row[k] != null && x > v;
    if (op === 'lt') return row[k] != null && x < v;
    if (op === 'gte') return row[k] != null && x >= v;
    if (op === 'lte') return row[k] != null && x <= v;
    if (op === 'is') return v === 'null' ? row[k] == null : x === v;
    if (op === 'in') return v.replace(/^\(|\)$/g, '').split(',').includes(x);
    return false;
  });
}
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  const body = await read(req);
  const send = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(o === undefined ? '' : JSON.stringify(o)); };
  const service = (req.headers.authorization || '') === 'Bearer service-key';
  if (p === '/web/rest/v1/site_settings') {
    const key = (u.searchParams.get('key') || '').replace('eq.', '');
    return send(200, SETTINGS[key] ? [{ data: SETTINGS[key] }] : []);
  }
  if (p === '/web/rest/v1/site_settings_private') {
    if (!service) return send(401, {});
    const key = (u.searchParams.get('key') || '').replace('eq.', '');
    return send(200, PRIV[key] ? [{ data: PRIV[key] }] : []);
  }
  if (p === '/web/rest/v1/orders') {
    if (!service) return send(401, {});
    if (NO_COLUMNS && /dispatched_at|ship_note/.test(u.search)) return send(400, { message: 'column orders.ship_note does not exist' });
    const fs = filters(u.search.slice(1));
    if (req.method === 'GET') {
      const rows = DB.orders.filter(r => matches(r, fs)).map(r => Object.assign({}, r));
      if (RACE && /status=eq\.dispatched/.test(u.search)) { RACE(); RACE = null; }
      return send(200, rows);
    }
    if (req.method === 'PATCH') {
      const patch = JSON.parse(body);
      const hit = DB.orders.filter(r => matches(r, fs));
      hit.forEach(r => Object.assign(r, patch));
      return /return=minimal/.test(req.headers.prefer || '') ? send(204) : send(200, hit);
    }
  }
  if (p === '/web/rest/v1/order_requests') {
    if (!service) return send(401, {});
    if (!DB.order_requests) return send(404, { code: 'PGRST205', message: 'Could not find the table public.order_requests in the schema cache' });
    const fs = filters(u.search.slice(1));
    if (req.method === 'GET') return send(200, DB.order_requests.filter(r => matches(r, fs)).map(r => JSON.parse(JSON.stringify(r))));
    if (req.method === 'PATCH') {
      const patch = JSON.parse(body);
      const hit = DB.order_requests.filter(r => matches(r, fs));
      hit.forEach(r => Object.assign(r, patch));
      return /return=minimal/.test(req.headers.prefer || '') ? send(204) : send(200, hit);
    }
  }
  send(404, { path: p });
});

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const at = 'http://127.0.0.1:' + server.address().port;
  Object.assign(process.env, {
    WEB_SUPABASE_URL: at + '/web', WEB_SUPABASE_ANON_KEY: 'anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key', URL: 'https://vaultiqueboutique.com',
  });
  const F = path.join(__dirname, '..', 'netlify', 'functions');
  require(path.join(F, 'send-email'))._internals.sendMail = async (m) => { MAIL.push(m); };
  const fn = require(path.join(F, 'order-progress'));
  const run = () => fn._internals.run();
  const mails = to => MAIL.filter(m => m.to === to);

  try {
    console.log('\n1. Before supabase-order-progress.sql');
    NO_COLUMNS = true;
    DB.orders.push(base({ id: 'o1', ref: 'VB-DLV01', auto_deliver_at: ago(H) }));
    let r = await run();
    is(/not set up/.test(r.skipped || '') && MAIL.length === 0 && order('VB-DLV01').status === 'dispatched',
       'it stops at once: nothing sent, nothing marked delivered', J(r));
    const handler = await fn.handler();
    is(handler.statusCode === 200, 'and Netlify is answered without an error');

    console.log('\n2. On its way');
    reset();
    /* Website 86: the day it will be marked delivered is six days from
       whenever the test runs, at 10:30 in Lusaka. Until website 86 it was
       the fixed 23 November 2026, and from 21 November that day fell inside
       the two days before it when a reminder goes, so the second run below
       rightly sent the reminder and the check failed (the deploy step of
       builds 84 and 85 would have stopped on it). */
    const due = new Date(Date.now() + 6 * D); due.setUTCHours(8, 30, 0, 0);
    const dueWords = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lusaka', weekday: 'long', day: 'numeric', month: 'long' })
      .format(due) + ', 10:30';
    DB.orders.push(base({ id: 'o1', ref: 'VB-DLV01', ship_note: 'With Courier X', auto_deliver_at: due.toISOString() }));
    r = await run();
    const m1 = mails('buyer@example.com');
    is(r.onway === 1 && m1.length === 1 && m1[0].subject === 'Your order VB-DLV01 is on its way',
       'the customer is emailed once that it is on its way', J({ r, subjects: MAIL.map(m => m.subject) }));
    is(/Hello Test,/.test(m1[0].text) && /With Courier X/.test(m1[0].text),
       'with their first name and the shop\'s note', m1[0].text);
    is(m1[0].text.indexOf(dueWords) > -1,
       'with the day it will be marked delivered, in Lusaka\'s time (' + dueWords + ')', m1[0].text);
    is(m1[0].text.indexOf('https://vaultiqueboutique.com/order/VB-DLV01?t=' + TOKEN) > -1 && /Confirm delivery/.test(m1[0].text)
       && /Ask for more time/.test(m1[0].text), 'with the private link, and what the two buttons do', m1[0].text);
    is(order('VB-DLV01').dispatch_mailed_at != null, 'marked as told');
    r = await run();
    is(MAIL.length === 1, 'the next run does not tell them again', J(MAIL.map(m => m.subject)));

    console.log('\n3. The reminder');
    reset();
    DB.orders.push(base({ id: 'o2', ref: 'VB-REM01', auto_deliver_at: ahead(D), remind_days: 2 }));
    r = await run();
    is(MAIL.length === 1 && /on its way/.test(MAIL[0].subject),
       'due at the same time as On its way: only On its way goes this run', J(MAIL.map(m => m.subject)));
    r = await run();
    is(MAIL.length === 2 && MAIL[1].subject === 'Has your order VB-REM01 arrived?' && r.reminded === 1,
       'the reminder goes on the next run', J({ r, subjects: MAIL.map(m => m.subject) }));
    is(/will be marked delivered on/.test(MAIL[1].text) && /3 more days, 2 times left/.test(MAIL[1].text)
       && MAIL[1].text.indexOf('/order/VB-REM01?t=') > -1, 'saying the day, the time still to ask for, and the link', MAIL[1].text);
    await run();
    is(MAIL.length === 2 && order('VB-REM01').reminded_at != null, 'once only');
    reset();
    DB.orders.push(base({ id: 'o3', ref: 'VB-REM02', dispatch_mailed_at: ago(2 * D), dispatched_at: ago(2 * D), auto_deliver_at: ahead(5 * D) }));
    await run();
    is(MAIL.length === 0, 'not yet due (5 days to go, the reminder 2 before): nothing');

    console.log('\n4. The day passed');
    reset();
    DB.orders.push(base({ id: 'o4', ref: 'VB-AUTO1', dispatched_at: ago(7 * D), dispatch_mailed_at: ago(7 * D),
                          reminded_at: ago(2 * D), auto_deliver_at: ago(10 * 60000) }));
    r = await run();
    const a = order('VB-AUTO1');
    is(r.delivered === 1 && a.status === 'delivered' && a.delivered_by === 'auto' && a.delivered_at != null,
       'marked delivered, by the website, the day having passed', J({ r, a: { s: a.status, by: a.delivered_by } }));
    is(MAIL.length === 1 && MAIL[0].subject === 'Your order VB-AUTO1 has been delivered'
       && /The days to say it had arrived have passed/.test(MAIL[0].text) && a.delivered_mailed_at != null,
       'and the customer is told once, and why', J(MAIL.map(m => m.subject)));
    await run();
    is(MAIL.length === 1, 'not told twice');
    reset();
    DB.orders.push(base({ id: 'o5', ref: 'VB-RACE1', dispatched_at: ago(7 * D), dispatch_mailed_at: ago(7 * D),
                          reminded_at: ago(2 * D), auto_deliver_at: ago(60000) }));
    RACE = () => Object.assign(order('VB-RACE1'), { status: 'delivered', delivered_at: ago(1000), delivered_by: 'customer',
                                                     delivered_mailed_at: ago(1000) });
    r = await run();
    is(order('VB-RACE1').delivered_by === 'customer' && r.delivered === 0 && MAIL.length === 0,
       'confirmed by the customer a moment before: left as they said, and no email', J({ r, o: order('VB-RACE1').delivered_by }));
    reset();
    DB.orders.push(base({ id: 'o6', ref: 'VB-COL01', fulfilment: 'collection', status: 'ready', dispatched_at: null,
                          auto_deliver_at: null, ready_at: ago(3 * D) }));
    await run();
    is(order('VB-COL01').status === 'ready' && MAIL.length === 0, 'a collection order waiting at the shop is never marked collected by itself');

    console.log('\n5. Delivered by the shop, collected, confirmed by the customer');
    reset();
    DB.orders.push(base({ id: 'o7', ref: 'VB-SHOPD', status: 'delivered', delivered_at: ago(60000), delivered_by: 'shop', dispatch_mailed_at: ago(D) }));
    DB.orders.push(base({ id: 'o8', ref: 'VB-COLD', fulfilment: 'collection', status: 'delivered', delivered_at: ago(60000), delivered_by: 'shop',
                          email: 'collector@example.com', dispatched_at: null }));
    DB.orders.push(base({ id: 'o9', ref: 'VB-CUST', status: 'delivered', delivered_at: ago(60000), delivered_by: 'customer',
                          delivered_mailed_at: ago(60000), email: 'self@example.com' }));
    r = await run();
    is(mails('buyer@example.com').some(m => m.subject === 'Your order VB-SHOPD has been delivered')
       && !/The days to say/.test(mails('buyer@example.com')[0].text), 'delivered by the shop: told, simply', J(MAIL.map(m => m.subject)));
    is(mails('collector@example.com').some(m => m.subject === 'Your order VB-COLD has been collected' && /has been collected\./.test(m.text)),
       'collected: told it was collected', J(MAIL.map(m => m.subject)));
    is(mails('self@example.com').length === 0, 'confirmed by the customer themselves: no email about it');
    reset();
    DB.orders.push(base({ id: 'o10', ref: 'VB-CUST2', status: 'delivered', delivered_at: ago(60000), delivered_by: 'customer',
                          delivered_mailed_at: null, email: 'self2@example.com' }));
    await run();
    is(mails('self2@example.com').length === 0,
       'nor when its "told" mark is missing: what the customer said themselves is never emailed back to them');

    console.log('\n6. A refund (recorded by the platform, build 510)');
    reset();
    DB.orders.push(base({ id: 'r1', ref: 'VB-RF01', status: 'delivered', delivered_at: ago(D), delivered_mailed_at: ago(D),
                          refund_state: 'full', refund_amount: 1530, refund_ref: 'FLW-RF-1', refund_note: 'Returned unworn', refund_at: ago(60000) }));
    DB.orders.push(base({ id: 'r2', ref: 'VB-RF02', email: 'quiet@example.com', status: 'delivered', delivered_at: ago(D), delivered_mailed_at: ago(D),
                          refund_state: 'part', refund_amount: 300, refund_ref: 'FLW-RF-2', refund_at: ago(60000), refund_mailed_at: ago(60000) }));
    r = await run();
    const rf = mails('buyer@example.com');
    is(r.refunds === 1 && rf.length === 1 && rf[0].subject === 'Your refund for order VB-RF01'
       && /K\s?1,530(\.00)?/.test(rf[0].text) && /FLW-RF-1/.test(rf[0].text) && /Returned unworn/.test(rf[0].text),
       'the refund is emailed once, in the shop\'s money, with its reference and note', rf[0] && rf[0].text);
    is(mails('quiet@example.com').length === 0, 'a refund the platform said not to tell about: nothing');
    await run();
    is(mails('buyer@example.com').length === 1 && order('VB-RF01').refund_mailed_at != null, 'once only');

    console.log('\n7. Nothing to send it with, nobody to send it to, news too old');
    reset();
    SETTINGS.notifications.emailEnabled = false;
    DB.orders.push(base({ id: 'n1', ref: 'VB-NOML1' }));
    DB.orders.push(base({ id: 'n2', ref: 'VB-NOML2', dispatched_at: ago(7 * D), dispatch_mailed_at: ago(7 * D), auto_deliver_at: ago(60000) }));
    r = await run();
    is(MAIL.length === 0 && order('VB-NOML1').dispatch_mailed_at == null,
       'email not set up: nothing sent, and nothing marked as told', J(MAIL));
    is(order('VB-NOML2').status === 'delivered' && order('VB-NOML2').delivered_mailed_at == null,
       'and an order whose day has passed is still marked delivered');
    reset();
    DB.orders.push(base({ id: 'n3', ref: 'VB-NOEM', email: null }));
    DB.orders.push(base({ id: 'n4', ref: 'VB-OLD1', dispatched_at: ago(3 * D) }));
    await run();
    is(MAIL.length === 0 && order('VB-NOEM').dispatch_mailed_at == null && order('VB-OLD1').dispatch_mailed_at == null,
       'no address: nothing; sent on its way three days ago and never told: not told now', J(MAIL.map(m => m.to)));
    reset();
    process.env.SUPABASE_SERVICE_ROLE_KEY = '';
    DB.orders.push(base({ id: 'k1', ref: 'VB-NOKEY', auto_deliver_at: ago(H) }));
    r = await run();
    is(r.skipped === 'no service key' && order('VB-NOKEY').status === 'dispatched' && MAIL.length === 0,
       'no service key: nothing at all', J(r));
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';

    console.log('\n8. Customers\' requests (website 87)');
    reset();
    DB.orders.push(base({ id: 'q-o1', ref: 'VB-RQM01', status: 'delivered', delivered_at: ago(2 * D), delivered_mailed_at: ago(2 * D) }));
    r = await run();
    is(r.requestsShop === 0 && r.requestsCustomer === 0 && MAIL.length === 0,
       'before supabase-customer-requests.sql: nothing sent, and the rest of the check runs as before', J(r));
    const rq = (o) => Object.assign({ ref: 'RQ-' + o.id.toUpperCase() + 'AB', kind: 'return', reason: 'wrong_size', detail: null, wants: null,
      items: [{ sku: 'LD-9', name: 'Linen Dress', qty: 1 }], status: 'requested', answer: null, decided_at: null,
      created_at: ago(10 * 60000), updated_at: ago(10 * 60000), shop_told_at: null, customer_told: null }, o);
    SETTINGS.contact = { email: 'desk@example.com' };
    DB.order_requests = [
      rq({ id: 'q1', order_id: 'q-o1', order_ref: 'VB-RQM01', detail: 'Too small for me.' }),
      rq({ id: 'q2', order_id: 'q-o1', order_ref: 'VB-RQM01', kind: 'problem', reason: 'damaged', status: 'withdrawn' }),
      rq({ id: 'q3', order_id: 'q-o1', order_ref: 'VB-RQM01', kind: 'problem', reason: 'missing', created_at: ago(3 * D), updated_at: ago(3 * D) }),
    ];
    r = await run();
    const desk = mails('desk@example.com');
    is(r.requestsShop === 1 && desk.length === 1 && desk[0].subject === 'Customer request: a return from order VB-RQM01',
       'a new request: the shop emailed, once, at the address in Settings > Contact', J([r, desk.map(m => m.subject)]));
    is(desk[0] && /A customer has asked to return pieces from order VB-RQM01\./.test(desk[0].text) && /Customer: Test Buyer/.test(desk[0].text) &&
       /Reason: The size or fit is wrong/.test(desk[0].text) && /Pieces: Linen Dress/.test(desk[0].text) &&
       /In their words: Too small for me\./.test(desk[0].text) && /Request RQ-Q1AB, \w+ \d+ \w+, \d\d:\d\d\./.test(desk[0].text) &&
       /Admin > Orders/.test(desk[0].text) && /Online Orders/.test(desk[0].text),
       'what was asked, why, which pieces, their words, the request\'s number and when, and where to answer it', desk[0] && desk[0].text);
    is(DB.order_requests[0].shop_told_at != null && DB.order_requests[1].shop_told_at == null && DB.order_requests[2].shop_told_at == null,
       'marked told; one withdrawn before the shop was told, and one too old, not sent at all', J(DB.order_requests.map(x => x.shop_told_at)));
    is(mails('buyer@example.com').length === 0, 'the customer is not emailed while the shop has not answered');
    await run();
    is(mails('desk@example.com').length === 1, 'once only');

    Object.assign(DB.order_requests[0], { status: 'accepted', answer: 'Bring it to the shop any day this week.', decided_at: ago(60000), updated_at: ago(60000) });
    r = await run();
    let mine = mails('buyer@example.com');
    is(r.requestsCustomer === 1 && mine.length === 1 && mine[0].subject === 'Your request for order VB-RQM01: accepted' &&
       /^Hello Test,/.test(mine[0].text) && /We have accepted your request to return Linen Dress from your order VB-RQM01\./.test(mine[0].text) &&
       /From the shop: Bring it to the shop any day this week\./.test(mine[0].text) &&
       /https:\/\/vaultiqueboutique\.com\/account\/orders\/VB-RQM01/.test(mine[0].text),
       'accepted: the customer emailed at the order\'s address, with the shop\'s word and the order\'s page', mine[0] && mine[0].text);
    is(DB.order_requests[0].customer_told === 'accepted', 'marked as told: accepted');
    await run();
    is(mails('buyer@example.com').length === 1, 'once only');
    Object.assign(DB.order_requests[0], { status: 'done', updated_at: ago(30000) });
    await run();
    mine = mails('buyer@example.com');
    is(mine.length === 2 && mine[1].subject === 'Your request for order VB-RQM01: done' &&
       /Your return from order VB-RQM01 is done\./.test(mine[1].text) && !/From the shop/.test(mine[1].text) &&
       DB.order_requests[0].customer_told === 'done',
       'done: told again, once, without repeating the word they already had', mine[1] && mine[1].text);

    reset();
    SETTINGS.contact = { email: 'desk@example.com' };
    DB.orders.push(base({ id: 'q-o2', ref: 'VB-RQM02', status: 'cancelled' }));
    DB.orders.push(base({ id: 'q-o3', ref: 'VB-RQM03', status: 'pending', email: 'paid@example.com', payment_method: 'online', payment_status: 'paid' }));
    DB.orders.push(base({ id: 'q-o4', ref: 'VB-RQM04', status: 'delivered', email: 'swap@example.com' }));
    DB.orders.push(base({ id: 'q-o5', ref: 'VB-RQM05', status: 'delivered', email: null }));
    const told = () => ago(60000);
    DB.order_requests = [
      rq({ id: 'q4', order_id: 'q-o2', order_ref: 'VB-RQM02', kind: 'cancel', reason: 'changed_mind', items: [], status: 'done',
           answer: 'Cancelled as you asked.', shop_told_at: told(), updated_at: told() }),
      rq({ id: 'q5', order_id: 'q-o3', order_ref: 'VB-RQM03', kind: 'cancel', reason: 'too_slow', items: [], status: 'accepted',
           shop_told_at: told(), updated_at: told() }),
      rq({ id: 'q6', order_id: 'q-o4', order_ref: 'VB-RQM04', kind: 'exchange', reason: 'quality', wants: 'Another colour',
           status: 'declined', answer: 'We have no other colour, sorry.', shop_told_at: told(), updated_at: told() }),
      rq({ id: 'q7', order_id: 'q-o5', order_ref: 'VB-RQM05', status: 'accepted', shop_told_at: told(), updated_at: told() }),
    ];
    r = await run();
    const c1 = mails('buyer@example.com'), c2 = mails('paid@example.com'), c3 = mails('swap@example.com');
    is(c1.length === 1 && c1[0].subject === 'Your order VB-RQM02 is cancelled' && /Your order VB-RQM02 is cancelled, as you asked\./.test(c1[0].text) &&
       /From the shop: Cancelled as you asked\./.test(c1[0].text), 'a cancel accepted and done at once: one email, "cancelled", with the shop\'s word', c1[0] && c1[0].text);
    is(c2.length === 1 && /We have accepted your request to cancel your order VB-RQM03\./.test(c2[0].text) &&
       /You paid online, so your money comes back the way you paid\. We will email you when the refund is made\./.test(c2[0].text),
       'a cancel of an order paid online: how the money comes back, and that the refund is emailed', c2[0] && c2[0].text);
    is(c3.length === 1 && c3[0].subject === 'Your request for order VB-RQM04: not accepted' &&
       /We are sorry: we could not accept your request to exchange Linen Dress from your order VB-RQM04\./.test(c3[0].text) &&
       /From the shop: We have no other colour, sorry\./.test(c3[0].text), 'declined: said so, with the shop\'s reason', c3[0] && c3[0].text);
    is(r.requestsCustomer === 3 && DB.order_requests[3].customer_told == null, 'an order with no address: nobody emailed, nothing marked', J(r));
    is(mails('desk@example.com').length === 0, 'requests the shop was already told of are not sent to it again');

    reset();
    SETTINGS.notifications.emailEnabled = false;
    DB.orders.push(base({ id: 'q-o6', ref: 'VB-RQM06', status: 'delivered' }));
    DB.order_requests = [
      rq({ id: 'q8', order_id: 'q-o6', order_ref: 'VB-RQM06' }),
      rq({ id: 'q9', order_id: 'q-o6', order_ref: 'VB-RQM06', kind: 'problem', reason: 'missing', status: 'accepted', shop_told_at: ago(60000), updated_at: ago(60000) }),
    ];
    r = await run();
    is(MAIL.length === 0 && DB.order_requests[0].shop_told_at == null && DB.order_requests[1].customer_told == null,
       'email not set up: nothing sent, and nothing marked as told', J(DB.order_requests));
    delete DB.order_requests;
  } catch (e) {
    fail('the test ran to its end', e && e.stack);
  }
  server.close();
  console.log('\n' + (failures ? '  ✗ ' + failures + ' of ' + checks + ' checks FAILED' : '  order progress check: all ' + checks + ' checks passed'));
  process.exit(failures ? 1 : 0);
})();
