/* =====================================================================
   Vaultique Boutique Point — /.netlify/functions/place-order
   ---------------------------------------------------------------------
   Records a WhatsApp order in the Orders tab (build 76, decision Q2).

   POST { order: { name, phone, email, address, notes, fulfilment },
          items: [{ sku, qty, name }], preview }
   Authorization: the signed-in customer's own token, when there is one.
   -> 200 { id, ref, total }   or an error with a sentence in it

   WHY THIS EXISTS. The browser used to write the order itself, through
   the database's place_order, with whatever prices it sent: a WhatsApp
   order could arrive in the Orders tab saying K1 for anything, and the
   Dashboard added it to Sales. Now the browser says only which pieces and
   how many. The prices come from the catalogue, worked out here by the
   very code that prices an online payment (_pay.js), and the order is
   written with the service key, which since supabase-hardening.sql is
   the only key place_order answers. Who placed it is asked of Supabase
   with the customer's own token, not taken from the browser's word.

   WHAT IT DOES NOT CHANGE. The WhatsApp message is still the order: the
   storefront opens it whether or not this answers, so a slow or failed
   recording never costs a sale. Nothing is refused for being priced on
   request or sold out since; it is recorded as asked for, without a
   price, for the shop to settle in the chat.
   ===================================================================== */
'use strict';
const P = require('./_pay');

function cut(v, n) { return String(v == null ? '' : v).trim().slice(0, n); }

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return P.json(405, { error: 'Use POST.' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return P.json(400, { error: 'That request could not be read.' }); }
  if (!P.serviceKey()) {
    return P.json(503, { error: 'Orders cannot be recorded yet: SUPABASE_SERVICE_ROLE_KEY is not set in Netlify.' });
  }

  const o = body.order || {};
  const order = {
    name: cut(o.name, 120) || null,
    phone: cut(o.phone, 40) || null,
    email: cut(o.email, 160) || null,
    address: cut(o.address, 400) || null,
    notes: cut(o.notes, 600) || null,
    fulfilment: o.fulfilment === 'collection' ? 'collection' : 'delivery',
  };

  try {
    const s = await P.shopSettings();
    if (await P.closedFor(s.general, body.preview)) {
      return P.json(403, { error: 'The shop is not taking orders at the moment.' });
    }
    const q = await P.priceWhatsApp(s, body.items, body.preview);
    if (q.error) return P.json(400, { error: q.error });

    const placed = await P.recordOrder(
      Object.assign({}, order, { total: q.total, currency: q.currency }),
      q.lines, body.preview, await P.customerFrom(event), P.clientAddr(event));
    return P.json(200, { id: placed.id, ref: placed.ref, total: q.total });
  } catch (e) {
    const m = String(e && e.message || '');
    if (/Too many/.test(m)) return P.json(429, { error: 'There have been a lot of orders just now. Please wait a little and try again.' });
    if (/not taking orders/.test(m)) return P.json(403, { error: 'The shop is not taking orders at the moment.' });
    return P.json(502, { error: 'The order could not be recorded just now.' });
  }
};
