// Flutterwave tells us a payment has moved. Set this address in the
// Flutterwave dashboard (Settings > Webhooks):
//
//   https://<your site>/.netlify/functions/pay-webhook
//
// with the same secret hash as FLW_WEBHOOK_HASH in Netlify. A call without
// that hash (in the verif-hash header, or signed with it in the newer
// flutterwave-signature header) is ignored. A call with it is still not
// believed on its own: settle() asks Flutterwave directly before anything
// is marked paid.
//
// BUILD 81 · Flutterwave's refund notices come here too (Settings >
// Webhooks, "webhook for refunds", the same address). A refund notice is
// never believed on its own either: the refunds it may be about are asked
// about at once (_refund.js), and nothing else is done with it.
const P = require('./_pay');
const R = require('./_refund');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: '' };
  const h = {};
  Object.keys(event.headers || {}).forEach((k) => { h[k.toLowerCase()] = event.headers[k]; });
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : String(event.body || '');

  if (!P.hashMatches(h['verif-hash']) && !P.signatureMatches(raw, h['flutterwave-signature'])) {
    // Something that looks like Flutterwave, with the wrong secret, is
    // worth knowing about: it is how a hash typed differently in the two
    // places shows up. Settings > Payments says so.
    if (h['verif-hash'] || h['flutterwave-signature']) await P.noteWebhook('refused').catch(() => {});
    return { statusCode: 401, body: '' };
  }
  await P.noteWebhook('received').catch(() => {});

  let body;
  try { body = JSON.parse(raw || '{}'); } catch (e) { return { statusCode: 400, body: '' }; }
  if (R.isRefundNotice(body)) {
    try {
      await R.onNotice(body);
      return { statusCode: 200, body: '' };
    } catch (e) {
      return { statusCode: 500, body: '' };   // Flutterwave sends it again later
    }
  }
  const d = body.data || body;
  const txRef = String(d.tx_ref || d.txRef || '');
  if (!txRef) return { statusCode: 200, body: '' };

  try {
    const r = await P.settle(txRef, d.id);
    if (r.status === 'paid' && r.fresh && r.pay && r.pay.order_id) {
      const s = await P.shopSettings();
      await P.confirmByEmail(s, r.pay.order_id, r.pay.mode, r.late);
    }
    return { statusCode: 200, body: '' };
  } catch (e) {
    // A failure here makes Flutterwave send it again later, which is what
    // we want: nothing is lost by a database that was briefly unreachable.
    return { statusCode: 500, body: '' };
  }
};
