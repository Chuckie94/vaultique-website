// =====================================================================
// THE PLATFORM'S ONLINE REFUNDS, SENT TO FLUTTERWAVE (website build 81)
//
//   POST { id }               send the refund the platform asked for
//                             through its door (vbp_pos_refund_request,
//                             supabase-online-refund.sql), once
//   POST { refresh: [ids] }   ask Flutterwave where these refunds are now,
//                             and email the customer for any accepted and
//                             not yet told
//
// Only the platform's own server calls this, with the door's key in the
// X-Door-Key header: the same key as the till's door, of which this website
// keeps only a fingerprint. Nothing is taken from the caller but which
// refund: the amount, the payment and the reason are read from the refund
// the door wrote down. The Flutterwave keys stay in this website's Netlify.
// How it is kept safe and quick: _refund.js.
// =====================================================================
'use strict';
const P = require('./_pay');
const R = require('./_refund');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return P.json(405, { ok: false, why: 'post_only' });
  if (!P.serviceKey()) return P.json(503, { ok: false, why: 'not_set_up' });
  const h = {};
  Object.keys(event.headers || {}).forEach((k) => { h[k.toLowerCase()] = event.headers[k]; });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return P.json(400, { ok: false, why: 'unreadable' }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return P.json(400, { ok: false, why: 'unreadable' });
  if (!(await R.keyOk(h['x-door-key']))) return P.json(401, { ok: false, why: 'refused' });

  try {
    if (body.id) {
      const r = await R.send(String(body.id));
      return P.json(r.ok ? 200 : (r.why === 'not_found' ? 404 : 400), r);
    }
    if (Array.isArray(body.refresh)) return P.json(200, await R.refresh(body.refresh));
    return P.json(400, { ok: false, why: 'unreadable' });
  } catch (e) {
    // The database would not answer. A refund taken for sending and not
    // finished stays "sending", and is looked into (never sent again).
    console.error('[pay-refund]', e && e.message);
    return P.json(502, { ok: false, why: 'website_db' });
  }
};
