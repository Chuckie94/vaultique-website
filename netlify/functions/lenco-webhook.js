// =====================================================================
// LENCO TELLS US A PAYMENT HAS MOVED (website build 88)
//
// Set this address in the Lenco dashboard (Lenco Pay > webhook URL):
//
//   https://<your site>/.netlify/functions/lenco-webhook
//
// THE RULES IT KEEPS
//
//   1. Signed, or ignored. Lenco signs every event in the X-Lenco-Signature
//      header: HMAC SHA512 of the event, keyed with the SHA256 hash of the
//      API token (Lenco's reference, Webhooks). The token stays in Netlify;
//      the signature is checked against the live token and the test token,
//      in constant time. Anything unsigned, or signed with anything else,
//      is answered 401 and changes nothing. Only a count and a time are
//      kept of those, so a flood of forged calls fills nothing.
//
//   2. Signed is still not paid. A signed event is only a reason to ask
//      Lenco itself (settle() in _pay.js asks GET /collections/status/
//      :reference with the secret key), and only Lenco's own answer about
//      our reference, our amount and our currency marks anything paid.
//
//   3. The same event twice changes nothing twice. settle() only ever moves
//      a payment forward, and only the request that makes the order paid
//      sends the emails. Lenco sends an event again every 30 minutes for a
//      day until it is acknowledged: a 500 here asks for exactly that, when
//      this website's database could not be reached.
//
//   4. Each signed event is written down (payment_webhooks, administrators
//      only, never changed): when, which event, which reference, which mode,
//      and what this website did with it. Settings > Payments shows them.
// =====================================================================
'use strict';
const P = require('./_pay');
const L = require('./_lenco');

const OUR_REF = /^VB-[A-Z0-9]{5}-[a-f0-9]{10}$/;

// Written down, never in the way: a webhook that cannot be logged is still handled.
function logEvent(row) {
  return P.svc('POST', 'payment_webhooks', Object.assign({ provider: 'lenco' }, row), 'return=minimal').catch(() => {});
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: '' };
  const h = {};
  Object.keys(event.headers || {}).forEach((k) => { h[k.toLowerCase()] = event.headers[k]; });
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : String(event.body || '');
  if (raw.length > 100000) return { statusCode: 413, body: '' };

  const mode = L.signedBy(raw, h['x-lenco-signature']);
  if (!mode) {
    // Something unsigned, or signed with another key: counted, so that a
    // token typed differently in Netlify shows in Settings > Payments.
    if (P.serviceKey()) {
      await P.noteHealth({ lencoLastRefusedAt: new Date().toISOString() }, { lencoRefused: 1 }).catch(() => {});
    }
    return { statusCode: 401, body: '' };
  }

  let body;
  try { body = JSON.parse(raw || '{}'); } catch (e) { return { statusCode: 400, body: '' }; }
  const kind = String((body && body.event) || '').slice(0, 60);
  const d = (body && body.data && typeof body.data === 'object') ? body.data : {};
  const reference = String(d.reference || '').slice(0, 80);
  const at = new Date().toISOString();
  await P.noteHealth({ lencoLastWebhookAt: at }).catch(() => {});

  // Not a collection, or not one of ours (a transfer, a payment made outside
  // this website): acknowledged, written down, nothing done.
  if (L.COLLECTION_EVENTS.indexOf(kind) < 0 || !OUR_REF.test(reference)) {
    await logEvent({ event: kind || 'unknown', reference: reference || null, mode, outcome: 'ignored',
                     note: { status: String(d.status || '').slice(0, 30) || null } });
    return { statusCode: 200, body: '' };
  }

  try {
    const r = await P.settle(reference);
    if (r.status === 'unknown') {
      await logEvent({ event: kind, reference, mode, outcome: 'not ours', note: { lencoReference: String(d.lencoReference || '').slice(0, 60) || null } });
      return { statusCode: 200, body: '' };
    }
    if (r.status === 'paid' && r.fresh && r.pay && r.pay.order_id) {
      const s = await P.shopSettings();
      await P.confirmByEmail(s, r.pay.order_id, r.pay.mode, r.late, 'lenco');
    }
    await logEvent({
      event: kind, reference, mode,
      outcome: r.status + (r.fresh ? '' : (r.status === 'paid' ? ' (already)' : '')),
      note: { said: String(d.status || '').slice(0, 30) || null, lencoReference: String(d.lencoReference || '').slice(0, 60) || null,
              asked: true },
    });
    return { statusCode: 200, body: '' };
  } catch (e) {
    // Our database or Lenco could not be reached: Lenco sends it again in
    // 30 minutes, and the fifteen-minute check-up asks Lenco meanwhile.
    await logEvent({ event: kind, reference, mode, outcome: 'error', note: { error: String(e && e.message || '').slice(0, 120) } });
    return { statusCode: 500, body: '' };
  }
};
