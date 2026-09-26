// Two questions, both safe to ask from a browser:
//
//   GET ?tx_ref=...&transaction_id=...
//       Where has this payment got to? Asked by the page the customer
//       comes back to. It never takes the browser's word: settle() asks
//       Flutterwave. Answers with the order reference and amount only.
//
//   GET ?check=1
//       Is online payment set up? For the admin's status line. Answers
//       yes or no for each key, never the keys themselves.
const P = require('./_pay');

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  if (q.check) {
    let formats = true;
    try { P.formats(); } catch (e) { formats = false; }
    return P.json(200, {
      service: !!P.serviceKey(),
      test: !!process.env.FLW_SECRET_KEY_TEST,
      live: !!process.env.FLW_SECRET_KEY_LIVE,
      hash: !!process.env.FLW_WEBHOOK_HASH,
      formats,
    });
  }

  const txRef = String(q.tx_ref || '').slice(0, 80);
  if (!/^VB-[A-Z0-9]{5}-[a-f0-9]{10}$/.test(txRef)) return P.json(400, { error: 'That payment reference could not be read.' });
  try {
    const r = await P.settle(txRef, q.transaction_id);
    if (r.status === 'unknown') return P.json(404, { status: 'unknown' });
    if (r.status === 'paid' && r.fresh && r.pay && r.pay.order_id) {
      const s = await P.shopSettings();
      await P.confirmByEmail(s, r.pay.order_id);
    }
    const s = await P.shopSettings();
    const F = P.formats();
    const style = F.moneyStyle(s.general, s.pricing);
    return P.json(200, {
      status: r.status,
      ref: txRef.split('-').slice(0, 2).join('-'),
      amountText: r.pay ? F.money(Number(r.pay.amount), style) : '',
    });
  } catch (e) {
    return P.json(200, { status: 'pending' });
  }
};
