// =====================================================================
// THE FRAUD CHECK'S WATCH: every fifteen minutes (netlify.toml). BUILD 91
//
// 1) The team's own activity in the last hour, from the sealed record
//    (supabase-risk.sql, risk_staff_facts): many deletions, changes to the
//    team's logins or roles, or settings changes by one person are scored
//    like everything else (_risk.js), and a case opened for anything above
//    Low, once an hour per person at most.
// 2) Payments the check held and somebody approved in Admin > Fraud &
//    Risk, still waiting: asked of their gateway once more and marked paid
//    on its word, with the customer's confirmation email (the page asks the
//    same at once when Approve is pressed; this is the back-up).
// 3) Cases escalated in Admin > Fraud & Risk: the owner is emailed, once.
// 4) An anchor for the sealed record: where its last entry stood, and its
//    seal, so a record cut short or rewritten from some point on shows.
//
// Before supabase-risk.sql has been run, or with the check off, it reads
// once and stops. Nothing here holds, refuses or sends any payment.
// =====================================================================
const P = require('./_pay');
const RISK = require('./_risk');

const STOP_AFTER_MS = 20000;   // a scheduled function has thirty seconds

async function run() {
  if (!P.serviceKey()) return { skipped: 'no service key' };
  const began = Date.now();
  const cfg = await RISK.settings();
  const out = { mode: cfg.mode };
  try {
    await P.svc('GET', 'risk_cases?select=id&limit=1');
  } catch (e) {
    return { skipped: 'supabase-risk.sql not run yet' };
  }
  if (cfg.mode !== 'off') {
    try { out.staff = await RISK.staffScan(); } catch (e) { out.staff = { error: String(e && e.message).slice(0, 120) }; }
  }
  // Approvals and escalations are answered whatever the mode: a case
  // decided while the check was on is still somebody's money.
  try { out.released = await RISK.releaseApproved(began + STOP_AFTER_MS); } catch (e) { out.released = { error: String(e && e.message).slice(0, 120) }; }
  try { out.escalated = await RISK.mailEscalated(); } catch (e) { out.escalated = { error: String(e && e.message).slice(0, 120) }; }
  try { out.anchor = await P.svc('POST', 'rpc/audit_anchor', {}); } catch (e) { out.anchor = { error: String(e && e.message).slice(0, 120) }; }
  return out;
}

exports.handler = async function () {
  try {
    return { statusCode: 200, body: JSON.stringify(await run()) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: String((e && e.message) || e).slice(0, 200) }) };
  }
};
exports._internals = { run, STOP_AFTER_MS };
