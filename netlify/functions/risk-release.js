// =====================================================================
// RELEASE A HELD PAYMENT, now.  BUILD 91
//
// POST { id }   Authorization: the signed-in administrator's own token
//   -> 200 { status }   paid | review | pending, as the gateway now says
//
// Admin > Fraud & Risk calls this straight after a held payment's case is
// approved (risk_decide, supabase-risk.sql). Only a case that has been
// approved by somebody with the Fraud & Risk right can be released, and
// releasing only asks the payment's gateway about it once more, exactly as
// the payment check-up does: it is marked paid on the gateway's word and the
// customer's confirmation email goes then (settle, _pay.js). Nothing here
// marks anything paid by itself, and the fifteen-minute watch asks again if
// this call is never made.
// =====================================================================
const P = require('./_pay');
const RISK = require('./_risk');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return P.json(405, { error: 'Use POST.' });
  if (!P.serviceKey()) return P.json(503, { error: 'SUPABASE_SERVICE_ROLE_KEY is not set in Netlify.' });
  const h = event.headers || {};
  const token = String(h.authorization || h.Authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!(await P.callerMay(token, 'may_risk'))) return P.json(403, { error: 'Only someone with the Fraud & Risk right can do this.' });
  let b = {};
  try { b = JSON.parse(event.body || '{}'); } catch (e) { b = {}; }
  const id = String(b.id || '');
  if (!UUID.test(id)) return P.json(400, { error: 'That case could not be read.' });
  try {
    const c = ((await P.svc('GET', 'risk_cases?select=*&id=eq.' + encodeURIComponent(id))) || [])[0];
    if (!c) return P.json(404, { error: 'That case was not found.' });
    if (c.moment !== 'payment_paid' || c.action !== 'held') return P.json(400, { error: 'This case holds no payment.' });
    if (c.review_state !== 'approved') return P.json(409, { error: 'Approve the case first.' });
    const r = await RISK.release(c);
    return P.json(200, { status: r.status || 'pending' });
  } catch (e) {
    return P.json(502, { error: 'The gateway could not be asked just now. The payment check-up asks again within 15 minutes.' });
  }
};
