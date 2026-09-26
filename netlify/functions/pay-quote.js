// What an order will cost if paid online: the pieces, any tax, the
// delivery line, and the total. Worked out entirely here (see _pay.js);
// the browser only says which pieces and how many.
//
// POST { items: [{ sku, qty }], fulfilment: 'delivery' | 'collection', town, preview }
const P = require('./_pay');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return P.json(405, { error: 'Use POST.' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return P.json(400, { error: 'That request could not be read.' }); }
  try {
    const s = await P.shopSettings();
    if (!P.onlineOn(s)) return P.json(403, { error: 'Online payment is switched off.', off: true });
    if (P.shopClosed(s.general, body.preview)) return P.json(403, { error: 'The shop is not taking orders at the moment.' });
    const q = await P.priceOrder(s, body.items, body.fulfilment, body.preview, String(body.town || '').slice(0, 60));
    if (q.problems) return P.json(409, { problems: q.problems, deliveryProblem: q.deliveryProblem });
    return P.json(200, q);
  } catch (e) {
    return P.json(502, { error: 'The price could not be worked out just now. Please try again.' });
  }
};
