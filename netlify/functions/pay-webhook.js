// Flutterwave tells us a payment has moved. Set this address in the
// Flutterwave dashboard (Settings > Webhooks):
//
//   https://<your site>/.netlify/functions/pay-webhook
//
// with the same secret hash as FLW_WEBHOOK_HASH in Netlify. A call without
// that hash is ignored. A call with it is still not believed on its own:
// settle() asks Flutterwave directly before anything is marked paid.
const P = require('./_pay');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: '' };
  const h = event.headers || {};
  if (!P.hashMatches(h['verif-hash'] || h['Verif-Hash'])) return { statusCode: 401, body: '' };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return { statusCode: 400, body: '' }; }
  const d = body.data || body;
  const txRef = String(d.tx_ref || d.txRef || '');
  if (!txRef) return { statusCode: 200, body: '' };

  try {
    const r = await P.settle(txRef, d.id);
    if (r.status === 'paid' && r.fresh && r.pay && r.pay.order_id) {
      const s = await P.shopSettings();
      await P.confirmByEmail(s, r.pay.order_id);
    }
    return { statusCode: 200, body: '' };
  } catch (e) {
    // A failure here makes Flutterwave send it again later, which is what
    // we want: nothing is lost by a database that was briefly unreachable.
    return { statusCode: 500, body: '' };
  }
};
