/* ===========================================================================
   ONLINE REFUND, THE WEBSITE'S SIDE (website build 81)

   netlify/functions/pay-refund.js and _refund.js, run as Netlify runs them,
   against stand-ins for this website's Supabase and for Flutterwave (never
   the real ones). The database's own rules (the refund only moves forward,
   what it asked never changes) are checked in tests/online-refund.sql; here,
   what the functions do with Flutterwave:

     * only the platform's server, with the door's key, can make them act;
     * a refund is sent once, with the amount written down, never the
       caller's; two calls at once still send it once;
     * a test payment is refunded with the test key;
     * Flutterwave's answer is recorded: completed, pending, a clear no;
     * no answer is never sent again: the refund is looked for in
       Flutterwave's own list, found, or (only after half an hour and two
       looks) taken as never made; a refund already ours is never taken
       twice;
     * a refund notice is a reason to ask Flutterwave, never an answer;
     * the 15-minute check asks about any still open;
     * the customer's email goes once, quickly, and only when asked for.
   =========================================================================== */
const http = require('http');
const path = require('path');
const crypto = require('crypto');

let checks = 0, failures = 0;
const is = (c, m, x) => { checks++; if (c) console.log('  ✓ ' + m); else { failures++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); } };

const DOOR = 'k81-0123456789abcdef0123456789abcdef';
const LIVE_KEY = 'FLWSECK-live-secret', TEST_KEY = 'FLWSECK_TEST-secret';
let DB, FLW, MAIL, MAIL_FAIL, PRIV, HUNG = [];
function reset() {
  DB = { refunds: [], orders: [], payments: [] };
  FLW = { plan: [], sent: [], refunds: {}, seq: 5000, askedById: 0, listed: 0, listDown: false };
  MAIL = []; MAIL_FAIL = false;
  PRIV = { mail_secret: { smtpPassword: 'x' } };
}
reset();
const SETTINGS = {
  general: { businessName: 'Vaultique', currency: 'ZMW' },
  notifications: { emailEnabled: true, smtpHost: 'smtp.example.com', senderEmail: 'shop@example.com' },
};

/* ---------------- a small PostgREST ---------------- */
const read = (req) => new Promise((r) => { let d = ''; req.on('data', (c) => { d += c; }); req.on('end', () => r(d)); });
function cond(col, op, v) {
  return (row) => {
    const x = row[col] == null ? '' : String(row[col]);
    if (op === 'eq') return x === v;
    if (op === 'neq') return x !== v;
    if (op === 'gt') return row[col] != null && x > v;
    if (op === 'lt') return row[col] != null && x < v;
    if (op === 'is') return v === 'null' ? row[col] == null : x === v;
    if (op === 'in') return v.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, '')).includes(x);
    return false;
  };
}
function filters(search) {
  const fs = [];
  let limit = Infinity;
  for (const [k, v] of new URLSearchParams(search)) {
    if (k === 'select' || k === 'order') continue;
    if (k === 'limit') { limit = Number(v); continue; }
    if (k === 'or') {
      const any = v.replace(/^\(|\)$/g, '').split(',').map((part) => {
        const a = part.indexOf('.'), b = part.indexOf('.', a + 1);
        return cond(part.slice(0, a), part.slice(a + 1, b), part.slice(b + 1));
      });
      fs.push((row) => any.some((f) => f(row)));
      continue;
    }
    const m = /^(eq|neq|in|gt|lt|is)\.(.*)$/.exec(v);
    if (m) fs.push(cond(k, m[1], m[2]));
  }
  return { fs, limit };
}
const accepted = (s) => s === 'pending' || s === 'completed';
// What supabase-online-refund.sql's recorder does to the order, enough for these checks.
function toOrder(row, was) {
  if (accepted(row.state) === accepted(was)) return;
  const o = DB.orders.find((x) => x.id === row.order_id);
  if (!o) return;
  const sum = DB.refunds.filter((r) => r.order_id === o.id && accepted(r.state)).reduce((a, r) => a + Number(r.amount), 0);
  if (sum > 0) {
    Object.assign(o, { refund_state: sum >= Number(o.paid_amount) - 0.005 ? 'full' : 'part', refund_amount: sum,
                       refund_at: new Date().toISOString(),
                       refund_mailed_at: accepted(row.state) ? (row.tell ? null : new Date().toISOString()) : o.refund_mailed_at });
  } else {
    Object.assign(o, { refund_state: null, refund_amount: null, refund_at: null, refund_mailed_at: null });
  }
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  const body = await read(req);
  const send = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(o === undefined ? '' : JSON.stringify(o)); };
  const service = (req.headers.authorization || '') === 'Bearer service-key' && req.headers.apikey === 'service-key';

  // ---- Flutterwave
  if (p.startsWith('/flw/')) {
    const auth = req.headers.authorization || '';
    const mode = auth === 'Bearer ' + LIVE_KEY ? 'live' : auth === 'Bearer ' + TEST_KEY ? 'test' : null;
    if (!mode) return send(401, { status: 'error', message: 'Invalid authorization key' });
    let m = /^\/flw\/transactions\/([^/]+)\/refund$/.exec(p);
    if (m && req.method === 'POST') {
      const b = JSON.parse(body || '{}');
      FLW.sent.push({ tx: m[1], body: b, mode });
      const how = FLW.plan.shift() || 'completed';
      if (how === 'down') return req.socket.destroy();
      if (how === 'hang') { HUNG.push(res); return; }
      if (how === 'error400') return send(400, { status: 'error', message: 'Insufficient balance in your available balance', data: null });
      if (how === 'error429') return send(429, { status: 'error', message: 'Too many requests' });
      if (how === 'error500') return send(500, { status: 'error', message: 'Something went wrong' });
      const id = ++FLW.seq;
      const half = /^half:(.*)$/.exec(how);
      const status = half ? 'completed' : (how === 'made-but-lost' ? 'completed' : how);
      FLW.refunds[id] = { id, tx_id: Number(m[1]), flw_ref: 'URF_' + id, wallet_id: 1, status,
                          amount_refunded: half ? Number(half[1]) : b.amount, destination: 'payment_source',
                          created_at: new Date().toISOString() };
      if (how === 'made-but-lost') return req.socket.destroy();
      return send(200, { status: 'success', message: 'Transaction refund initiated', data: FLW.refunds[id] });
    }
    m = /^\/flw\/refunds\/([^/]+)$/.exec(p);
    if (m) {
      FLW.askedById++;
      const r = FLW.refunds[m[1]];
      return r ? send(200, { status: 'success', message: 'Refund fetched', data: r }) : send(404, { status: 'error', message: 'Refund not found' });
    }
    if (p === '/flw/refunds') {
      FLW.listed++;
      if (FLW.listDown) return send(500, { status: 'error', message: 'down' });
      return send(200, { status: 'success', data: Object.values(FLW.refunds) });
    }
    return send(404, { status: 'error' });
  }

  // ---- this website's Supabase
  if (p === '/web/rest/v1/site_settings') {
    const key = (u.searchParams.get('key') || '').replace('eq.', '');
    return send(200, SETTINGS[key] ? [{ data: SETTINGS[key] }] : []);
  }
  if (p === '/web/rest/v1/site_settings_private') {
    if (!service) return send(401, {});
    if (req.method === 'POST') { const b = JSON.parse(body); PRIV[b.key] = b.data; return send(201); }
    const keys = (u.searchParams.get('key') || '').replace(/^eq\.|^in\.\(|\)$/g, '').split(',');
    return send(200, keys.filter((k) => PRIV[k]).map((k) => ({ key: k, data: PRIV[k] })));
  }
  if (p === '/web/rest/v1/rpc/pos_door_key_ok') {
    if (!service) return send(401, {});
    return send(200, JSON.parse(body || '{}').p_key === DOOR);
  }
  if (p === '/web/rest/v1/rpc/pay_expire_stale') return service ? send(204) : send(401, {});
  const t = /^\/web\/rest\/v1\/(refunds|orders|payments)$/.exec(p);
  if (t) {
    if (!service) return send(401, { message: 'permission denied' });
    const table = DB[t[1]];
    const { fs, limit } = filters(u.search.slice(1));
    const hit = table.filter((r) => fs.every((f) => f(r)));
    if (req.method === 'GET') return send(200, hit.slice(0, limit));
    if (req.method === 'PATCH') {
      const patch = JSON.parse(body || '{}');
      hit.forEach((r) => {
        const was = r.state;
        Object.assign(r, patch);
        if (t[1] === 'refunds') { r.updated_at = new Date().toISOString(); toOrder(r, was); }
      });
      return /return=minimal/.test(req.headers.prefer || '') ? send(204) : send(200, hit);
    }
  }
  send(404, { path: p });
});

let n = 0;
function refund(o) {
  n++;
  const row = Object.assign({
    id: crypto.randomUUID(), request_key: 'orf-key-' + String(n).padStart(12, '0'),
    order_id: 'ord-' + n, order_ref: 'VB-RF' + String(n).padStart(3, '0'), payment_id: null,
    tx_ref: 'VB-RF' + n + '-aaaa', provider_tx_id: String(900000 + n), mode: 'live', currency: 'ZMW',
    amount: 400, whole: false, rung_up: true, prev_status: null, reason: 'Wrong size', by_name: 'A. Manager',
    by_role: 'Store Manager', platform_ref: 'ORF-2026-' + String(n).padStart(4, '0'), tell: true, state: 'new',
    flw_refund_id: null, flw_status: null, flw_message: null, detail: null,
    requested_at: new Date().toISOString(), sent_at: null, accepted_at: null, completed_at: null, failed_at: null,
    asked_at: null, asks: 0, quiet: 0, updated_at: new Date().toISOString(),
  }, o || {});
  DB.refunds.push(row);
  DB.orders.push({ id: row.order_id, ref: row.order_ref, name: 'Refund Buyer', email: 'buyer' + n + '@example.com',
                   paid_amount: Number(row.amount) * 2, refund_state: null, refund_amount: null, refund_ref: null,
                   refund_note: null, refund_at: null, refund_mailed_at: null });
  return row;
}
const rowOf = (r) => DB.refunds.find((x) => x.id === r.id);
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const sentFor = (r) => FLW.sent.filter((s) => s.tx === r.provider_tx_id).length;

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  Object.assign(process.env, {
    WEB_SUPABASE_URL: base + '/web', WEB_SUPABASE_ANON_KEY: 'anon-key', SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    FLW_SECRET_KEY_LIVE: LIVE_KEY, FLW_SECRET_KEY_TEST: TEST_KEY, FLW_WEBHOOK_HASH: 'my-secret-hash',
    FLW_API_BASE: base + '/flw', URL: 'https://vaultiqueboutique.com',
  });
  const F = path.join(__dirname, '..', 'netlify', 'functions');
  require(path.join(F, 'send-email'))._internals.sendMail = async (m) => { if (MAIL_FAIL) throw new Error('smtp down'); MAIL.push(m); };
  const R = require(path.join(F, '_refund'));
  const T = R._internals.T;
  const handler = require(path.join(F, 'pay-refund')).handler;
  const hook = require(path.join(F, 'pay-webhook')).handler;
  const reconcile = () => require(path.join(F, 'pay-reconcile'))._internals.run();
  const call = (body, key, method) => handler({ httpMethod: method || 'POST',
      headers: key === null ? {} : { 'X-Door-Key': key === undefined ? DOOR : key },
      body: typeof body === 'string' ? body : JSON.stringify(body) })
    .then((r) => ({ code: r.statusCode, body: r.body ? JSON.parse(r.body) : null }));
  const notice = (b, signed) => hook({ httpMethod: 'POST', headers: signed === false ? {} : { 'verif-hash': 'my-secret-hash' },
                                       body: JSON.stringify(b) }).then((r) => r.statusCode);

  try {
    console.log('\nOnly the platform\'s server, with the door\'s key');
    let r = refund();
    is((await call({ id: r.id }, undefined, 'GET')).code === 405, 'anything but POST is refused');
    is((await call({ id: r.id }, null)).code === 401 && (await call({ id: r.id }, 'k81-0123456789abcdef0123456789abcdeX')).code === 401
       && (await call({ id: r.id }, 'short')).code === 401,
       'no key, a wrong key or a short one: refused');
    is(rowOf(r).state === 'new' && FLW.sent.length === 0, 'and nothing was sent to Flutterwave');
    is((await call('{nope')).code === 400 && (await call({})).code === 400 && (await call({ id: 'not-an-id' })).code === 400,
       'something unreadable is refused');
    is((await call({ id: crypto.randomUUID() })).code === 404, 'a refund that was never asked for is not there');
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    is((await call({ id: r.id })).code === 503, 'without the website\'s own key it is not set up, and says so');
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';

    console.log('\nSent once, with the amount written down');
    let a = await call({ id: r.id, amount: 99999, reason: 'typed by somebody else' });
    is(a.code === 200 && a.body.ok && a.body.again === false && a.body.refund.state === 'completed'
       && a.body.refund.flwRefundId && a.body.refund.acceptedAt && a.body.refund.completedAt,
       'Flutterwave refunded it at once: the answer says completed, with its reference and both times', JSON.stringify(a.body));
    is(FLW.sent.length === 1 && FLW.sent[0].body.amount === 400 && FLW.sent[0].mode === 'live'
       && FLW.sent[0].tx === r.provider_tx_id,
       'Flutterwave was asked once, for the K400 written down (not the caller\'s 99,999), on the payment\'s own transaction, with the live key',
       JSON.stringify(FLW.sent));
    is(/ORF-2026-0001/.test(FLW.sent[0].body.comments) && /VB-RF001/.test(FLW.sent[0].body.comments)
       && /Wrong size/.test(FLW.sent[0].body.comments),
       'the comment Flutterwave keeps names the platform\'s refund, the order and the reason');
    is(rowOf(r).state === 'completed' && rowOf(r).sent_at && rowOf(r).detail.flw_ref === 'URF_' + rowOf(r).flw_refund_id
       && rowOf(r).flw_status === 'completed',
       'recorded: completed, when it was sent, Flutterwave\'s refund and its reference');
    a = await call({ id: r.id });
    is(a.body.again === true && a.body.refund.state === 'completed' && FLW.sent.length === 1,
       'asked again (a double press, a lost answer to the platform): the same refund, and nothing sent again');

    r = refund();
    const three = await Promise.all([call({ id: r.id }), call({ id: r.id }), call({ id: r.id })]);
    is(sentFor(r) === 1 && three.filter((x) => x.body.again === false).length === 1,
       'three calls at the same moment: sent exactly once', JSON.stringify(three.map((x) => x.body.again)));

    r = refund({ mode: 'test' });
    a = await call({ id: r.id });
    is(a.body.refund.test === true && FLW.sent[FLW.sent.length - 1].mode === 'test',
       'a test payment is refunded with the test key, and says TEST');

    console.log('\nFlutterwave\'s answer, recorded');
    FLW.plan = ['pending'];
    let p5 = refund();
    a = await call({ id: p5.id });
    is(a.body.refund.state === 'pending' && rowOf(p5).accepted_at && !rowOf(p5).completed_at,
       'on its way: pending, accepted, not completed');
    FLW.refunds[rowOf(p5).flw_refund_id].status = 'completed-momo';
    a = await call({ refresh: [p5.id] });
    is(a.body.ok && a.body.asked === 1 && a.body.changed === 1 && rowOf(p5).state === 'completed' && rowOf(p5).completed_at
       && rowOf(p5).flw_status === 'completed-momo' && rowOf(p5).detail.flw_ref,
       'the platform asks, Flutterwave says completed (mobile money): completed, with the time, and its reference kept',
       JSON.stringify(a.body));
    a = await call({ refresh: [p5.id] });
    is(a.body.asked === 0, 'completed: never asked about again');
    FLW.plan = ['pending'];
    const p6 = refund();
    await call({ id: p6.id });
    let before = FLW.askedById;
    await call({ refresh: [p6.id] });
    is(FLW.askedById === before + 1 && rowOf(p6).state === 'pending', 'still on its way: asked, and still pending');
    before = FLW.askedById;
    await call({ refresh: [p6.id, p6.id, 'not-an-id'] });
    await call({ refresh: [p6.id] });
    is(FLW.askedById === before, 'asked again within seconds: Flutterwave is not asked again yet (one ask at a time)');

    FLW.plan = ['error400'];
    let r7 = refund();
    a = await call({ id: r7.id });
    is(a.body.refund.state === 'refused' && /Insufficient balance/.test(a.body.refund.message) && !rowOf(r7).flw_refund_id,
       'a clear no: refused, with Flutterwave\'s own words, and nothing refunded');
    a = await call({ id: r7.id });
    is(a.body.again && sentFor(r7) === 1, 'refused stays refused: never sent again (a new refund is a new request)');
    FLW.plan = ['error429'];
    let r7b = refund();
    a = await call({ id: r7b.id });
    is(a.body.refund.state === 'refused' && /busy/.test(a.body.refund.message), 'Flutterwave busy: refused, and it says try again in a minute');

    FLW.plan = ['half:150'];
    const r18 = refund({ amount: 300 });
    a = await call({ id: r18.id });
    is(/refunded 150\.00 of the 300\.00 asked/.test(a.body.refund.message || ''), 'Flutterwave refunded less than asked: it says so');

    delete process.env.FLW_SECRET_KEY_LIVE;
    const r17 = refund();
    before = FLW.sent.length;
    a = await call({ id: r17.id });
    is(a.body.refund.state === 'refused' && /no Flutterwave live key/.test(a.body.refund.message) && FLW.sent.length === before,
       'no live key on the website: refused, nothing sent, and it says which key');
    process.env.FLW_SECRET_KEY_LIVE = LIVE_KEY;

    console.log('\nNo answer: never sent again');
    FLW.plan = ['down'];
    const r8 = refund();
    a = await call({ id: r8.id });
    is(a.body.refund.state === 'unknown' && /could not be reached/.test(a.body.refund.message), 'the line dropped: unknown, not refused');
    a = await call({ id: r8.id });
    is(a.body.again && sentFor(r8) === 1, 'and asked again, it is not sent again');
    FLW.plan = ['error500'];
    const r8b = refund();
    a = await call({ id: r8b.id });
    is(a.body.refund.state === 'unknown', 'Flutterwave unwell (500): unknown too');
    T.send = 300;
    FLW.plan = ['hang'];
    const r9 = refund();
    const t0 = Date.now();
    a = await call({ id: r9.id });
    is(a.body.refund.state === 'unknown' && /did not answer in time/.test(a.body.refund.message) && Date.now() - t0 < 3000,
       'Flutterwave too slow: the platform is answered in time (unknown), long before Netlify would stop the function');
    T.send = R.SEND_WAIT_MS;

    FLW.plan = ['made-but-lost'];
    const r10 = refund();
    await call({ id: r10.id });
    is(rowOf(r10).state === 'unknown' && !rowOf(r10).flw_refund_id, 'Flutterwave made it, but the answer was lost: unknown');
    a = await call({ refresh: [r10.id] });
    is(rowOf(r10).state === 'completed' && rowOf(r10).flw_refund_id && a.body.changed === 1 && sentFor(r10) === 1,
       'found in Flutterwave\'s own list: completed, with its reference, and never sent twice');

    FLW.plan = ['down'];
    const r11 = refund();
    await call({ id: r11.id });
    await call({ refresh: [r11.id] });
    is(rowOf(r11).state === 'unknown' && rowOf(r11).quiet === 1, 'not in the list yet: still unknown, one look noted');
    Object.assign(rowOf(r11), { asked_at: ago(60000) });
    await call({ refresh: [r11.id] });
    is(rowOf(r11).state === 'unknown' && rowOf(r11).quiet === 2, 'twice, but only minutes after it was sent: still unknown');
    Object.assign(rowOf(r11), { asked_at: ago(60000), sent_at: ago(31 * 60000) });
    await call({ refresh: [r11.id] });
    is(rowOf(r11).state === 'refused' && /no record/.test(rowOf(r11).flw_message) && sentFor(r11) === 1,
       'half an hour on, still nowhere in Flutterwave\'s list: never made, so refused (and never sent twice)');
    FLW.plan = ['down'];
    const r12 = refund();
    await call({ id: r12.id });
    FLW.listDown = true;
    Object.assign(rowOf(r12), { sent_at: ago(40 * 60000), quiet: 5 });
    await call({ refresh: [r12.id] });
    is(rowOf(r12).state === 'unknown' && rowOf(r12).quiet === 5, 'Flutterwave\'s list cannot be read: nothing is decided');
    FLW.listDown = false;

    // A Try again for the same amount on the same payment: the failed one's
    // Flutterwave refund is ours already, and is never taken for the new one.
    const r13 = refund({ amount: 1000, state: 'failed', provider_tx_id: '777001', flw_refund_id: '9001', sent_at: ago(120000) });
    const r14 = refund({ amount: 1000, state: 'unknown', provider_tx_id: '777001', sent_at: ago(100000) });
    FLW.refunds[9001] = { id: 9001, tx_id: 777001, flw_ref: 'URF_9001', status: 'failed', amount_refunded: 1000, created_at: ago(90000) };
    FLW.refunds[9002] = { id: 9002, tx_id: 777001, flw_ref: 'URF_9002', status: 'pending', amount_refunded: 1000, created_at: ago(80000) };
    await call({ refresh: [r14.id] });
    is(rowOf(r14).flw_refund_id === '9002' && rowOf(r14).state === 'pending' && rowOf(r13).flw_refund_id === '9001',
       'a refund already ours is never taken twice: the new one is matched to its own', JSON.stringify(rowOf(r14)));

    const r15 = refund({ state: 'sending', sent_at: ago(3 * 60000) });
    await call({ refresh: [r15.id] });
    is(rowOf(r15).state === 'unknown' && /lost/.test(rowOf(r15).flw_message),
       '"sending" for minutes (the function was stopped part way): looked into as unknown, never sent again');
    const r16 = refund({ state: 'sending', sent_at: ago(20000) });
    before = FLW.listed;
    await call({ refresh: [r16.id] });
    is(rowOf(r16).state === 'sending' && FLW.listed === before, '"sending" a moment ago: left alone, a send may be under way');

    console.log('\nFlutterwave\'s refund notice: a reason to ask, never an answer');
    FLW.plan = ['pending'];
    const r19 = refund();
    await call({ id: r19.id });
    const fid = rowOf(r19).flw_refund_id;
    before = FLW.askedById;
    let code = await notice({ event: 'refund.completed', data: { id: Number(fid), status: 'completed', tx_id: Number(r19.provider_tx_id) } });
    is(code === 200 && FLW.askedById === before + 1 && rowOf(r19).state === 'pending',
       'a notice saying completed, while Flutterwave itself still says pending: asked, and still pending');
    FLW.refunds[fid].status = 'completed';
    before = FLW.askedById;
    code = await notice({ event: 'refund.completed', data: { id: Number(fid), status: 'completed' } });
    is(code === 200 && FLW.askedById === before + 1 && rowOf(r19).state === 'completed',
       'once Flutterwave says so: completed, at once (the notice does not wait its turn)');
    const r19b = refund({ state: 'pending', flw_refund_id: '424242', accepted_at: ago(1000) });
    FLW.refunds[424242] = { id: 424242, tx_id: Number(r19b.provider_tx_id), status: 'completed', amount_refunded: 400 };
    code = await notice({ event: 'refund.completed', data: { id: 424242 } }, false);
    is(code === 401 && rowOf(r19b).state === 'pending', 'an unsigned notice: refused, and nothing asked');
    code = await notice({ 'event.type': 'Refund', data: { tx_id: Number(r19b.provider_tx_id), status: 'completed' } });
    is(code === 200 && rowOf(r19b).state === 'completed', 'found by its payment\'s transaction number too');
    is(R.isRefundNotice({ event: 'refund.failed', data: {} }) && R.isRefundNotice({ data: { amount_refunded: 5 } })
       && R.isRefundNotice({ data: { status: 'refunded' } }) && !R.isRefundNotice({ event: 'charge.completed', data: { status: 'successful', tx_ref: 'VB-X-1' } }),
       'refund notices are told apart from payment notices (which go to the payment check as before)');

    console.log('\nThe 15-minute check');
    FLW.plan = ['pending'];
    const r20 = refund();
    await call({ id: r20.id });
    FLW.refunds[rowOf(r20).flw_refund_id].status = 'completed';
    const out = await reconcile();
    is(out.refunds && out.refunds.asked >= 1 && rowOf(r20).state === 'completed', 'it asks about refunds still open, and records what Flutterwave says',
       JSON.stringify(out.refunds));

    console.log('\nThe customer\'s email: once, quickly, only when asked for');
    MAIL = [];
    const r21 = refund();
    await call({ id: r21.id });
    a = await call({ refresh: [r21.id] });
    const o21 = DB.orders.find((o) => o.id === r21.order_id);
    is(a.body.told === 1 && MAIL.length === 1 && MAIL[0].to === o21.email && /Your refund for order VB-RF/.test(MAIL[0].subject)
       && /We have refunded/.test(MAIL[0].text) && o21.refund_mailed_at,
       'the refund email (website 78\'s, word for word) goes at the platform\'s next look, and is marked as sent', JSON.stringify(a.body));
    a = await call({ refresh: [r21.id] });
    is(a.body.told === 0 && MAIL.length === 1, 'and never twice');
    const r22 = refund({ tell: false });
    await call({ id: r22.id });
    a = await call({ refresh: [r22.id] });
    is(a.body.told === 0 && MAIL.length === 1, 'not to be told: no email');
    MAIL_FAIL = true;
    const r23 = refund();
    await call({ id: r23.id });
    a = await call({ refresh: [r23.id] });
    const o23 = DB.orders.find((o) => o.id === r23.order_id);
    is(a.body.told === 0 && o23.refund_mailed_at === null, 'an email that could not go is left for the 15-minute check to send');
    MAIL_FAIL = false;
  } catch (e) {
    failures++;
    console.log('  ✗ threw: ' + (e && e.stack || e));
  }
  HUNG.forEach((res) => { try { res.destroy(); } catch (e) { /* gone */ } });
  server.closeAllConnections && server.closeAllConnections();
  server.close();
  console.log('\n' + (failures ? '  ✗ ' + failures + ' of ' + checks + ' checks FAILED'
                                : '  online refund, the website\'s side: all ' + checks + ' checks passed'));
  process.exit(failures ? 1 : 0);
})();
