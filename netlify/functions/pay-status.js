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
const crypto = require('crypto');
const P = require('./_pay');

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
  return P.json(200, out);
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
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
    }
    return P.json(200, out);
  }

  const txRef = String(q.tx_ref || '').slice(0, 80);
  if (!/^VB-[A-Z0-9]{5}-[a-f0-9]{10}$/.test(txRef)) return P.json(400, { error: 'That payment reference could not be read.' });
  try {
    const r = await P.settle(txRef, q.transaction_id, { pause: true });
    if (r.status === 'unknown') return P.json(404, { status: 'unknown' });
    if (r.status === 'paid' && r.fresh && r.pay && r.pay.order_id) {
      const s = await P.shopSettings();
      await P.confirmByEmail(s, r.pay.order_id, r.pay.mode, r.late);
    }
    const s = await P.shopSettings();
    const F = P.formats();
    const style = F.moneyStyle(s.general, s.pricing);
    return P.json(200, {
      status: r.status,
      ref: txRef.split('-').slice(0, 2).join('-'),
      amountText: r.pay ? F.money(Number(r.pay.amount), style) : '',
      /* A Test-mode payment (build 77): the page says no money moved. */
      test: !!(r.pay && r.pay.mode === 'test'),
    });
  } catch (e) {
    return P.json(200, { status: 'pending' });
  }
};
