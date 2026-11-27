// =====================================================================
// LENCO: the payment adapter for Lenco by BroadPay Zambia (website build 88)
//
// Everything this website knows about Lenco is in this file. The rest of
// the payment engine (_pay.js) asks it four things: is Lenco ready for a
// mode, start a mobile money collection, what does Lenco say about one of
// our references, and did a webhook really come from Lenco. Flutterwave's
// code is not touched by any of it.
//
// WHAT IT FOLLOWS: Lenco's API reference, version 2.0
// (https://lenco-api.readme.io/v2.0/reference), read on 25 November 2026.
//
//   Authentication   Authorization: Bearer <API token> on every request.
//   Base address     https://api.lenco.co/access/v2 (the reference's only
//                    server). Lenco's reference names no sandbox address
//                    for the API, so Test mode uses LENCO_API_BASE_TEST,
//                    the address Lenco gives with the sandbox token. Until
//                    it is set, Test mode is not ready: nothing is guessed.
//   Mobile money     POST /collections/mobile-money
//                    { amount, reference, phone, operator, country, bearer }
//                    operator: airtel | mtn | zamtel (Zambia); country zm.
//                    Answers status "pay-offline": the customer approves on
//                    their phone. Then the webhook, or asking again.
//   Cards            Lenco's own payment window (the popup widget,
//                    https://pay.lenco.co/js/v1/inline.js; sandbox
//                    https://pay.sandbox.lenco.co/js/v1/inline.js). Card
//                    details are typed into Lenco's window and never reach
//                    this website. The direct card API (POST
//                    /collections/card) needs PCI DSS certification and the
//                    card number on this server, so it is NOT used.
//   Status           GET /collections/status/:reference. The only word this
//                    website takes on whether money moved.
//   Webhooks         collection.successful, collection.failed and
//                    collection.settled, signed in the X-Lenco-Signature
//                    header: HMAC SHA512 of the event, keyed with the SHA256
//                    hash (hex) of the API token. A signed webhook is still
//                    only a reason to ask (rule 2 of _pay.js).
//   Refunds          Lenco's API has no refund for a collection. A payment
//                    made through Lenco is refunded by the shop from its
//                    Lenco account; this website never claims otherwise.
//   Bank transfer    Lenco's API and window take card and mobile money only.
//
// THE KEYS, in Netlify's environment only, never in a browser:
//   LENCO_SECRET_KEY_LIVE, LENCO_SECRET_KEY_TEST   the API tokens
//   LENCO_PUBLIC_KEY_LIVE, LENCO_PUBLIC_KEY_TEST   the public keys, for
//                                                  Lenco's card window
//   LENCO_API_BASE_TEST                            the sandbox API address
//   LENCO_API_BASE (optional)                      only to override the live
//                                                  address in the reference
// =====================================================================
'use strict';
const crypto = require('crypto');

const LIVE_BASE = 'https://api.lenco.co/access/v2';
const WIDGET = {
  live: 'https://pay.lenco.co/js/v1/inline.js',
  test: 'https://pay.sandbox.lenco.co/js/v1/inline.js',
};
// Lenco's time to answer: "request a payment" and "where is this payment".
// Netlify gives a function ten seconds in all; the rest is the database's.
const T = { start: 7000, ask: 5000 };

// NO SECOND REQUEST WHILE THE FIRST CAN STILL BE APPROVED. Once a request is
// on a customer's phone, Lenco's API has no way to withdraw it, and its
// reference gives no time after which the networks drop it. So for this long
// after a request was sent, no other request is sent for the same order, even
// after the customer pressed Cancel payment (pay-start.js, retry), and only
// then does the checkout ask "Didn't receive approval request?". The same for
// a card while the bank's check is still under way. A request approved after
// all is still the order's payment; a second payment for an order already
// paid is never counted and goes to the shop to refund (_pay.js).
const HOLD = { ms: 90000 };

// The networks Lenco takes in Zambia (the reference's operator values), and
// the prefixes each network's numbers start with. A number with a prefix not
// on this list is left to Lenco to judge; one that belongs to another network
// is refused here, before anybody's phone rings.
const NETWORKS = {
  airtel: { label: 'Airtel Money',  a: 'an', prefixes: ['097', '077'] },
  mtn:    { label: 'MTN MoMo',      a: 'an', prefixes: ['096', '076'] },
  zamtel: { label: 'Zamtel Kwacha', a: 'a',  prefixes: ['095', '075'] },
};
const NETWORK_KEYS = Object.keys(NETWORKS);

const env = (n) => String(process.env[n] || '').trim();

function secretKey(mode) { return mode === 'live' ? env('LENCO_SECRET_KEY_LIVE') : env('LENCO_SECRET_KEY_TEST'); }
function publicKey(mode) { return mode === 'live' ? env('LENCO_PUBLIC_KEY_LIVE') : env('LENCO_PUBLIC_KEY_TEST'); }

// Only an https address, or this computer's own for the checks.
function cleanBase(v) {
  const s = String(v || '').trim().replace(/\/+$/, '');
  if (/^https:\/\/[^\/\s]+/i.test(s)) return s;
  if (/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(s)) return s;
  return '';
}
function apiBase(mode) {
  return mode === 'live' ? (cleanBase(env('LENCO_API_BASE')) || LIVE_BASE) : cleanBase(env('LENCO_API_BASE_TEST'));
}

// Ready for a mode: the API token and the address. The card window also
// needs the public key (readyFor 'card').
function ready(mode, method) {
  if (!secretKey(mode) || !apiBase(mode)) return false;
  if (method === 'card' && !publicKey(mode)) return false;
  return true;
}
function setup() {
  const one = (mode) => ({
    secret: !!secretKey(mode), public: !!publicKey(mode), base: !!apiBase(mode),
    mobile: ready(mode, 'mobile'), card: ready(mode, 'card'),
  });
  return { test: one('test'), live: one('live') };
}

// ---- asking Lenco, with a time limit ---------------------------------------
async function call(mode, method, p, body, waitMs) {
  const key = secretKey(mode), base = apiBase(mode);
  if (!key || !base) return { ok: false, status: 0, data: null, noKey: true };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), waitMs || T.ask);
  try {
    const res = await fetch(base + p, {
      method,
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ac.signal,
    });
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: null, lost: true, why: e && e.name === 'AbortError' ? 'timeout' : 'line' };
  } finally {
    clearTimeout(timer);
  }
}

// Lenco's own sentence about an answer, for the shop's eyes only (never a key).
function messageOf(a) {
  if (!a) return 'no answer';
  if (a.noKey) return 'no Lenco key for this mode';
  if (a.lost) return a.why === 'timeout' ? 'Lenco did not answer in time' : 'Lenco could not be reached';
  const m = a.data && (a.data.message || (a.data.data && a.data.data.message));
  const code = a.data && a.data.errorCode ? ' (error ' + String(a.data.errorCode).slice(0, 4) + ')' : '';
  return ('Lenco answered ' + a.status + (m ? ': ' + String(m).replace(/\s+/g, ' ').trim().slice(0, 160) : '') + code);
}

// ---- one collection, as this website keeps it ------------------------------
const str = (v, n) => (v === null || v === undefined) ? '' : String(v).slice(0, n || 120);
function collectionOf(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  const mm = d.mobileMoneyDetails && typeof d.mobileMoneyDetails === 'object' ? d.mobileMoneyDetails : null;
  const cd = d.cardDetails && typeof d.cardDetails === 'object' ? d.cardDetails : null;
  return {
    id: str(d.id, 60),
    reference: str(d.reference, 80),
    lencoReference: str(d.lencoReference, 60),
    status: str(d.status, 40).toLowerCase(),
    amount: Number(d.amount),
    currency: str(d.currency, 8).toUpperCase(),
    fee: d.fee === null || d.fee === undefined ? null : str(d.fee, 20),
    bearer: str(d.bearer, 20) || null,
    type: str(d.type, 30) || null,
    reason: d.reasonForFailure ? str(d.reasonForFailure, 200) : null,
    initiatedAt: d.initiatedAt || null,
    completedAt: d.completedAt || null,
    settlementStatus: d.settlementStatus ? str(d.settlementStatus, 20) : null,
    operator: mm ? str(mm.operator, 20) || null : null,
    operatorTxId: mm && mm.operatorTransactionId ? str(mm.operatorTransactionId, 80) : null,
    accountName: mm && mm.accountName ? str(mm.accountName, 80) : null,
    phone: mm && mm.phone ? str(mm.phone, 20) : null,
    cardType: cd && cd.cardType ? str(cd.cardType, 30) : null,
    cardLast4: cd && cd.last4 ? str(cd.last4, 4) : null,
    // The card's first six figures (its BIN: which bank issued it, and
    // where), as Lenco gives it after the payment. With the last four, what
    // card schemes allow a merchant to keep; never the whole number, and
    // never typed on this website (_cardroute.js).
    cardBin: cd && cd.bin && /^\d{6,8}$/.test(String(cd.bin)) ? String(cd.bin).slice(0, 8) : null,
  };
}
// What Lenco said, kept on the payment for the shop (administrators only).
// Never a card number: Lenco sends only the type and the last four figures.
function responseOf(c) {
  if (!c) return null;
  const keep = {};
  Object.keys(c).forEach((k) => { if (c[k] !== null && c[k] !== '' && !(typeof c[k] === 'number' && !isFinite(c[k]))) keep[k] = c[k]; });
  return keep;
}

// Lenco's word for a collection, in this website's three: paid, failed, or
// still on its way. pay-offline and 3ds-auth-required are on their way.
function stateOf(s) {
  const v = String(s || '').toLowerCase();
  if (v === 'successful') return 'successful';
  if (v === 'failed') return 'failed';
  if (v === 'pending' || v === 'pay-offline' || v === '3ds-auth-required') return 'pending';
  return 'unknown';
}

// What a customer is told when Lenco says a payment failed (the owner's
// wording, 25 November). The test accounts in Lenco's reference give these
// reasons; anything else gets the general sentence. A card is said as a card.
function customerReason(reason, method) {
  const r = String(reason || '');
  if (method === 'card') {
    if (/not enough|insufficient/i.test(r)) {
      return 'We were unable to process your payment due to insufficient funds on your card. Please use another card or choose another payment method.';
    }
    return 'We were unable to process your card payment. Please try again or choose another payment method.';
  }
  if (/not enough|insufficient/i.test(r)) {
    return 'We were unable to process your payment due to insufficient funds in your mobile money account. Please load your account to complete the transaction.';
  }
  if (/limit/i.test(r)) {
    return 'We were unable to process your payment because the amount exceeds your mobile money account limit. Please choose another payment method or contact your mobile money provider.';
  }
  if (/pin/i.test(r)) {
    return 'We were unable to process your payment because the PIN entered was incorrect. Please try again and enter the correct PIN.';
  }
  if (/timed?\s*out|expire/i.test(r)) {
    return 'We were unable to process your payment because the request was not authorised in time. Please try again.';
  }
  if (/unauthori[sz]|declin|reject|cancel|denied/i.test(r)) {
    return 'We were unable to process your payment because the request was declined. Please try again or choose another payment method.';
  }
  if (/invalid amount/i.test(r)) {
    return 'We were unable to process your payment because the amount was not accepted by your network. Please choose another payment method.';
  }
  return 'We were unable to process your payment. Please try again or choose another payment method.';
}

// ---- Zambian mobile money numbers -----------------------------------------------
// Typed any way a customer types them (+260 97 123 4567, 260971234567,
// 0971234567, 971234567), kept the way Lenco's reference writes them:
// ten figures, starting 0.
function localNumber(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (d.length === 12 && d.indexOf('260') === 0) d = '0' + d.slice(3);
  else if (d.length === 9 && /^[79]/.test(d)) d = '0' + d;
  return /^0[79]\d{8}$/.test(d) ? d : '';
}
function networkOf(number) {
  const n = localNumber(number);
  if (!n) return '';
  const pre = n.slice(0, 3);
  for (const k of NETWORK_KEYS) if (NETWORKS[k].prefixes.indexOf(pre) > -1) return k;
  return '';
}
// '' when the number will do for that network, or what is wrong with it.
function numberProblem(network, number) {
  if (!NETWORKS[network]) return 'Please choose your mobile money network.';
  const n = localNumber(number);
  if (!n) return 'Please enter your mobile money number: ten digits, starting with 09 or 07.';
  const belongs = networkOf(n);
  if (belongs && belongs !== network) {
    return 'This is ' + NETWORKS[belongs].a + ' ' + NETWORKS[belongs].label + ' number. Please choose ' + NETWORKS[belongs].label +
           ', or enter your ' + NETWORKS[network].label + ' number.';
  }
  return '';
}
// Shown to the customer as 09******28: the first two figures and the last two.
function masked(number) {
  const n = localNumber(number);
  return n ? n.slice(0, 2) + '******' + n.slice(-2) : '';
}

// ---- 1. a mobile money collection ---------------------------------------------------
// The payment row is written before this is called (as for Flutterwave), so a
// prompt that reaches a phone always has a record here to be matched to.
async function startMobile(mode, o) {
  const a = await call(mode, 'POST', '/collections/mobile-money', {
    amount: Number(o.amount),
    reference: o.reference,
    phone: localNumber(o.phone),
    operator: o.network,
    country: 'zm',
    // The customer pays exactly the order's total. A fee borne by the
    // customer would make Lenco's amount differ from the order's, and such a
    // payment is held for the shop to look at, never marked paid.
    bearer: 'merchant',
  }, T.start);
  const c = a.ok && a.data && a.data.status === true ? collectionOf(a.data.data) : null;
  if (c) return { answered: true, c, state: stateOf(c.status), raw: a };
  // A clear refusal: nothing was asked of the customer's phone.
  if (a.status >= 400 && a.status < 500) {
    return { answered: true, refused: true, status: a.status, errorCode: a.data && a.data.errorCode ? String(a.data.errorCode) : '',
             message: messageOf(a), raw: a };
  }
  // No answer, or not one that can be read: Lenco may or may not have sent
  // the prompt. Never called failed: the status is asked until Lenco says.
  return { answered: false, message: messageOf(a), raw: a };
}

// ---- 2. what Lenco says about one of our references ---------------------------------------
// found: Lenco has a collection with this reference (c). notFound: Lenco says
// it has none (404), which is the answer for a card window opened and closed
// without paying. Anything else is no answer, and nothing is decided on it.
async function ask(mode, reference) {
  const a = await call(mode, 'GET', '/collections/status/' + encodeURIComponent(reference), undefined, T.ask);
  if (a.status === 404) return { answered: true, notFound: true, raw: a };
  const c = a.ok && a.data && a.data.status === true ? collectionOf(a.data.data) : null;
  if (c) return { answered: true, found: true, c, state: stateOf(c.status), raw: a };
  return { answered: false, message: messageOf(a), raw: a };
}

// ---- 3. the keys, asked about without charging anybody --------------------------------------
// The status of a reference that does not exist: a token Lenco does not
// recognise is refused (401), a good one is told "not found" (404).
async function keyCheck(mode) {
  if (!secretKey(mode)) return 'missing';
  if (!apiBase(mode)) return 'no-address';
  const a = await call(mode, 'GET', '/collections/status/VB-CHECK-' + crypto.randomBytes(5).toString('hex'), undefined, T.ask);
  if (a.lost) return 'unreachable';
  if (a.status === 401 || a.status === 403) return 'refused';
  if (a.status === 404 || (a.data && typeof a.data.status === 'boolean')) return 'accepted';
  return 'unclear';
}

// ---- 4. webhooks ------------------------------------------------------------------------------
function sameText(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function hashKeyOf(token) { return crypto.createHash('sha256').update(String(token)).digest('hex'); }
// Which mode's token signed this event, or null. Lenco's reference signs the
// event as received (its PHP sample) and as JSON written again (its Node
// sample); both are tried, each compared in constant time.
function signedBy(raw, given) {
  const g = String(given || '').trim().toLowerCase();
  if (!/^[0-9a-f]{128}$/.test(g)) return null;
  const bodies = [String(raw || '')];
  try {
    const again = JSON.stringify(JSON.parse(String(raw || '')));
    if (again !== bodies[0]) bodies.push(again);
  } catch (e) { /* not JSON: only the body as received */ }
  for (const mode of ['live', 'test']) {
    const token = secretKey(mode);
    if (!token) continue;
    const key = hashKeyOf(token);
    for (const b of bodies) {
      if (sameText(crypto.createHmac('sha512', key).update(b).digest('hex'), g)) return mode;
    }
  }
  return null;
}
const COLLECTION_EVENTS = ['collection.successful', 'collection.failed', 'collection.settled'];

// ---- 5. Lenco's card window, as the page opens it ---------------------------------------------
function widget(mode) {
  return { script: mode === 'live' ? WIDGET.live : WIDGET.test, key: publicKey(mode) };
}

module.exports = {
  NETWORKS, NETWORK_KEYS, WIDGET, LIVE_BASE, T, HOLD,
  secretKey, publicKey, apiBase, ready, setup, call, messageOf,
  collectionOf, responseOf, stateOf, customerReason,
  localNumber, networkOf, numberProblem, masked,
  startMobile, ask, keyCheck, hashKeyOf, signedBy, COLLECTION_EVENTS, widget,
  REFUNDS: false,
};
