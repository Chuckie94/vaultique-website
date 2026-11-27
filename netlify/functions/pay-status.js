// Three questions:
//
//   GET ?tx_ref=...&transaction_id=...
//       Where has this payment got to? Asked by the page the customer
//       comes back to. It never takes the browser's word: settle() asks
//       Flutterwave. Answers with the order reference and amount only.
//       BUILD 77: it asks Flutterwave about one payment at most once every
//       five seconds (settle's pause; the page asks more often than that),
//       and it can answer "review": a payment came in that does not match
//       the order, and the shop has been told.
//
//   GET ?check=1
//       Is online payment set up? For the admin's status line. Answers
//       yes or no for each key, never the keys themselves. Asked with an
//       administrator's sign-in, it also says whether each key looks like
//       the right kind of key and when Flutterwave last reached the
//       webhook: those are for the shop's eyes only.
//
//   POST ?check=1   { action: 'test-keys' }, with an administrator's sign-in
//       Does Flutterwave accept the keys? Each installed key is used to ask
//       Flutterwave about a reference that does not exist: a key it does not
//       recognise is refused (401), a good one gets "not found". Nothing is
//       created or charged. Administrators only, so it cannot be used to
//       make this site call Flutterwave on anybody else's behalf.
//       BUILD 88: Lenco's tokens are asked the same way (lencoTest, lencoLive).
//
// BUILD 88 · ?check=1 also says which ways of paying are on offer right now
// (methods: Mobile Money with its networks, Debit / Credit Card), worked out
// here from the settings and from which keys are in Netlify, so the page
// offers exactly what can be paid. Never a key, and never which gateway is
// behind a way of paying beyond what the page needs to open it.
//
//   POST { action: 'cancel', txRef, attempt }                     BUILD 88
//       The customer pressed Cancel payment while a Lenco payment was
//       waiting. Only the page that started the payment can cancel it: it
//       sends the key it made for that press of Pay. Lenco is asked first,
//       and a payment it has already taken stays paid. Otherwise the attempt
//       is closed here ("customer-cancelled"). Lenco's API cannot withdraw a
//       request already on a phone: no new request is sent for the order until
//       the hold has passed (pay-start.js), the check-up keeps asking Lenco
//       about it, and one approved after all is still the order's payment.
const crypto = require('crypto');
const P = require('./_pay');
const L = require('./_lenco');

const TX = /^VB-[A-Z0-9]{5}-[a-f0-9]{10}$/;
const KEY = /^[A-Za-z0-9_-]{16,64}$/;
function sameKey(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}
const cancelledHere = (pay) => !!(pay && pay.status === 'failed' && pay.detail && pay.detail.reason === 'customer-cancelled');
// Seconds until a new request may be sent for the order (the hold, from when
// this request was sent: pay-start.js holds to the same).
const holdLeft = (pay) => Math.max(0, Math.ceil((L.HOLD.ms - (Date.now() - Date.parse(pay.created_at || 0))) / 1000));
// A request Lenco may still let the customer approve on their phone.
const mayBeOnPhone = (pay, st) => pay.method !== 'card' && !(st && st.notFound) && !(st && st.final) &&
  ['pending', 'pay-offline', 'no-answer'].indexOf(String((st && st.providerState) || pay.provider_status || '')) > -1;

// What the page is told about a Lenco payment (the GET below, and cancel).
function lencoSays(out, r) {
  const pay = r.pay;
  out.method = pay.method || null;
  if (r.status === 'failed') {
    if (cancelledHere(pay)) {
      // Cancelled at the checkout: while its request may still be on the
      // phone, when a new payment may be started.
      out.status = 'cancelled';
      out.retryAfter = mayBeOnPhone(pay, r) ? holdLeft(pay) : 0;
      out.onPhone = out.retryAfter > 0;
    } else {
      out.reason = L.customerReason(r.reason || pay.failure_reason || '', pay.method);
      out.retry = true;
    }
  }
  if (r.status === 'pending' && pay.method !== 'card') {
    out.onPhone = true;
    // When the page may ask "Didn't receive approval request?": the moment a
    // new request becomes possible.
    out.retryAfter = holdLeft(pay);
  }
  if (r.status === 'review' && (r.duplicate || (pay.detail && pay.detail.duplicate))) out.duplicate = true;
  if (heldNow(r)) out.held = true;
  return out;
}
// BUILD 91 · a payment the fraud check holds (_risk.js): the page says only
// that it is being checked, never why.
const heldNow = (r) => !!(r && r.status === 'review' && (r.held || (r.pay && r.pay.detail && r.pay.detail.risk_hold)));

async function cancel(b) {
  const txRef = String(b.txRef || '').slice(0, 80);
  const attempt = String(b.attempt || '');
  if (!TX.test(txRef) || !KEY.test(attempt)) return P.json(400, { error: 'That payment could not be read.' });
  if (!P.serviceKey()) return P.json(503, { error: 'Please try again in a moment.' });
  const row = ((await P.svc('GET', 'payments?select=*&tx_ref=eq.' + encodeURIComponent(txRef))) || [])[0];
  if (!row || row.provider !== 'lenco' || !sameKey(row.client_key, attempt)) {
    return P.json(403, { error: 'This payment cannot be cancelled from here.' });
  }
  const s = await P.shopSettings();
  const F = P.formats();
  const answer = (r) => lencoSays({
    status: r.status, ref: txRef.split('-').slice(0, 2).join('-'),
    amountText: F.money(Number((r.pay || row).amount), F.moneyStyle(s.general, s.pricing)),
    test: (r.pay || row).mode === 'test',
  }, Object.assign({ pay: row }, r));
  if (row.status === 'paid' || row.status === 'review' || cancelledHere(row)) {
    return P.json(200, answer({ status: row.status === 'failed' ? 'failed' : row.status, pay: row }));
  }
  // Lenco first: money already taken is never "cancelled".
  const st = await P.settle(txRef);
  if (st.status === 'paid' && st.fresh && st.pay && st.pay.order_id) {
    await P.confirmByEmail(s, st.pay.order_id, st.pay.mode, st.late, 'lenco');
  }
  if (st.status === 'paid' || st.status === 'review' || (st.status === 'failed' && !cancelledHere(st.pay))) {
    return P.json(200, answer(st));
  }
  const now = new Date().toISOString();
  await P.failAttempt(row, 'customer-cancelled', { failure_reason: 'Cancelled by the customer at the checkout.' },
    { provider: 'lenco', cancelled_at: now, provider_status_then: st.providerState || row.provider_status || null });
  // Whatever happened at the same moment (a webhook saying paid) is what stands.
  const after = ((await P.svc('GET', 'payments?select=*&tx_ref=eq.' + encodeURIComponent(txRef))) || [])[0] || row;
  if (after.status !== 'failed') return P.json(200, answer({ status: after.status, pay: after }));
  return P.json(200, answer({ status: 'failed', pay: after, notFound: st.notFound, providerState: st.providerState }));
}

async function testKeys(event) {
  const h = event.headers || {};
  const auth = String(h.authorization || h.Authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!(await P.callerIsAdmin(auth))) return P.json(403, { error: 'Administrators only.' });
  const out = {};
  for (const mode of ['test', 'live']) {
    if (!P.flwKey(mode)) { out[mode] = 'missing'; continue; }
    try {
      const probe = 'VB-CHECK-' + crypto.randomBytes(5).toString('hex');
      const r = await P.flw(mode, 'GET', '/transactions/verify_by_reference?tx_ref=' + encodeURIComponent(probe));
      out[mode] = (r.status === 401 || r.status === 403) ? 'refused' : (r.data ? 'accepted' : 'unclear');
    } catch (e) {
      out[mode] = 'unreachable';
    }
  }
  // BUILD 88 · Lenco, the same question: a reference that does not exist.
  const [lt, ll] = await Promise.all([L.keyCheck('test').catch(() => 'unreachable'), L.keyCheck('live').catch(() => 'unreachable')]);
  out.lencoTest = lt;
  out.lencoLive = ll;
  return P.json(200, out);
}

// BUILD 88 · the ways of paying on offer, for the page (no keys, no secrets).
async function offer() {
  try {
    const s = await P.shopSettings();
    const mode = s.pay.onlineMode === 'live' ? 'live' : 'test';
    if (!P.onlineOn(s) || !P.serviceKey()) return { mode, methods: [] };
    return { mode, methods: P.publicMethods(P.routes(s, mode, await P.lencoDbReady())) };
  } catch (e) {
    return { mode: null, methods: [] };
  }
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  if (event.httpMethod === 'POST' && !q.check) {
    let b = {};
    try { b = JSON.parse(event.body || '{}'); } catch (e) { b = {}; }
    if (b.action !== 'cancel') return P.json(400, { error: 'Unknown request.' });
    try { return await cancel(b); }
    catch (e) { return P.json(502, { error: 'The payment could not be cancelled just now. Please try again.' }); }
  }
  if (q.check) {
    if (event.httpMethod === 'POST') {
      let b = {};
      try { b = JSON.parse(event.body || '{}'); } catch (e) { b = {}; }
      if (b.action !== 'test-keys') return P.json(400, { error: 'Unknown request.' });
      return testKeys(event);
    }
    let formats = true;
    try { P.formats(); } catch (e) { formats = false; }
    const testKey = process.env.FLW_SECRET_KEY_TEST || '';
    const liveKey = process.env.FLW_SECRET_KEY_LIVE || '';
    const out = {
      service: !!P.serviceKey(),
      test: !!testKey,
      live: !!liveKey,
      hash: !!process.env.FLW_WEBHOOK_HASH,
      formats,
    };
    // BUILD 88 · what can be paid right now, and Lenco's keys: there or not.
    const on = await offer();
    out.mode = on.mode;
    out.methods = on.methods;
    const ls = L.setup();
    out.lenco = { test: ls.test.mobile, live: ls.live.mobile };
    const h = event.headers || {};
    const token = String(h.authorization || h.Authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (token && await P.callerIsAdmin(token)) {
      // The secret keys from Flutterwave > Settings > API keys start like
      // this. The public key and the encryption key sit beside them on the
      // same page, and pasting one of those instead is an easy slip.
      out.testKeyLooksRight = /^FLWSECK_TEST-/.test(testKey);
      out.liveKeyLooksRight = /^FLWSECK-/.test(liveKey) && !/^FLWSECK_TEST-/.test(liveKey);
      let health = {};
      if (P.serviceKey()) { try { health = await P.payHealth(); } catch (e) { health = {}; } }
      out.lastWebhookAt = health.lastWebhookAt || null;
      out.lastRefusedAt = health.lastRefusedAt || null;
      // BUILD 88 · Lenco, for Settings > Payments: each key there or not
      // (never a value), whether the database has supabase-lenco.sql, when
      // Lenco last reached its webhook, unsigned calls, its last error, and
      // the fifteen-minute check-up's last run.
      out.lencoSetup = ls;
      out.lencoDb = P.serviceKey() ? await P.lencoDbReady() : false;
      out.lencoLastWebhookAt = health.lencoLastWebhookAt || null;
      out.lencoLastRefusedAt = health.lencoLastRefusedAt || null;
      out.lencoRefused = Number(health.lencoRefused) || 0;
      out.lencoLastErrorAt = health.lencoLastErrorAt || null;
      out.lencoLastError = health.lencoLastError || null;
      out.reconcileAt = health.reconcileAt || null;
      out.reconcile = health.reconcile || null;
    }
    return P.json(200, out);
  }

  const txRef = String(q.tx_ref || '').slice(0, 80);
  if (!TX.test(txRef)) return P.json(400, { error: 'That payment reference could not be read.' });
  try {
    const r = await P.settle(txRef, q.transaction_id, { pause: true });
    if (r.status === 'unknown') return P.json(404, { status: 'unknown' });
    if (r.status === 'paid' && r.fresh && r.pay && r.pay.order_id) {
      const s = await P.shopSettings();
      await P.confirmByEmail(s, r.pay.order_id, r.pay.mode, r.late, r.pay.provider);
    }
    const s = await P.shopSettings();
    const F = P.formats();
    const style = F.moneyStyle(s.general, s.pricing);
    const out = {
      status: r.status,
      ref: txRef.split('-').slice(0, 2).join('-'),
      amountText: r.pay ? F.money(Number(r.pay.amount), style) : '',
      /* A Test-mode payment (build 77): the page says no money moved. */
      test: !!(r.pay && r.pay.mode === 'test'),
    };
    // BUILD 88 · a Lenco payment says a little more, for the page that waits
    // with the customer: why it failed, in plain words (Lenco's own reason
    // stays with the shop), whether the request is still on their phone and
    // when a new one could be sent, whether the customer cancelled it here,
    // and whether it was a second payment for an order already paid.
    if (heldNow(r)) out.held = true;
    if (r.pay && r.pay.provider === 'lenco') lencoSays(out, r);
    return P.json(200, out);
  } catch (e) {
    return P.json(200, { status: 'pending' });
  }
};
