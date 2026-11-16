// =====================================================================
// THE PAYMENT CHECK-UP: every fifteen minutes (netlify.toml).
//
// A payment is normally settled in one of two ways: the customer comes
// back to the site from Flutterwave's page, or Flutterwave calls the
// webhook. Either can fail to happen. A customer pays by mobile money and
// puts the phone away; the webhook was set up with a hash typed slightly
// differently, or Flutterwave could not reach the site for a while.
// Without this, that order would sit "awaiting payment" and, after three
// hours, be cancelled as walked away from, with the money already taken.
//
// So every fifteen minutes this asks Flutterwave about every attempt from
// the last three days that has not been heard back about, and settles each
// one exactly as the webhook would (settle() in _pay.js), confirmation
// email included. It also makes sure every paid payment's order says paid.
// Nothing here takes anybody's word but Flutterwave's, asked with the
// secret key.
// =====================================================================
const P = require('./_pay');

const LOOK_BACK_HOURS = 72;   // money that arrives late is still the customer's
const QUIET_MINUTES = 3;      // somebody may still be on the payment page
const MAX_PER_RUN = 25;       // a scheduled function has thirty seconds
const STOP_AFTER_MS = 20000;

const ago = (ms) => new Date(Date.now() - ms).toISOString();
const enc = encodeURIComponent;

async function run() {
  if (!P.serviceKey()) return { skipped: 'no service key' };
  // Online payment not connected yet: there is nobody to ask, so nothing is read.
  if (!P.flwKey('test') && !P.flwKey('live')) return { skipped: 'no Flutterwave key' };
  const began = Date.now();
  const out = { checked: 0, paid: 0, failed: 0, repaired: 0 };

  // 1) Attempts nobody has heard back about, newest first.
  const open = await P.svc('GET', 'payments?select=*&status=in.(started,expired)' +
    '&created_at=gt.' + enc(ago(LOOK_BACK_HOURS * 3600000)) +
    '&created_at=lt.' + enc(ago(QUIET_MINUTES * 60000)) +
    '&order=created_at.desc&limit=' + MAX_PER_RUN);
  let s = null;
  for (const pay of open || []) {
    if (Date.now() - began > STOP_AFTER_MS) break;
    out.checked++;
    try {
      const r = await P.settle(pay.tx_ref);
      if (r.status === 'paid') {
        out.paid++;
        if (r.fresh && r.pay && r.pay.order_id) {
          s = s || await P.shopSettings();
          await P.confirmByEmail(s, r.pay.order_id);
        }
      } else if (r.status === 'failed') {
        out.failed++;
      }
    } catch (e) { /* the next run asks again */ }
  }

  // 2) Paid payments whose order did not catch up. settle() brings the
  //    order up to date and says whether it was this call that did, in
  //    which case the confirmation emails have not gone yet.
  const paid = await P.svc('GET', 'payments?select=*&status=eq.paid' +
    '&updated_at=gt.' + enc(ago(LOOK_BACK_HOURS * 3600000)) + '&order=updated_at.desc&limit=100');
  const ids = (paid || []).map((p) => p.order_id).filter(Boolean);
  if (ids.length) {
    const orders = await P.svc('GET', 'orders?select=id,payment_status&id=in.(' + ids.map(enc).join(',') + ')');
    const behind = {};
    (orders || []).forEach((o) => { if (o.payment_status !== 'paid') behind[o.id] = true; });
    for (const pay of paid) {
      if (!behind[pay.order_id] || Date.now() - began > STOP_AFTER_MS) continue;
      delete behind[pay.order_id];
      try {
        const r = await P.settle(pay.tx_ref);
        if (r.fresh) {
          out.repaired++;
          s = s || await P.shopSettings();
          await P.confirmByEmail(s, pay.order_id);
        }
      } catch (e) { /* the next run tries again */ }
    }
  }

  // 3) The three-hour tidy-up, now that anything paid has been found.
  await P.svc('POST', 'rpc/pay_expire_stale', {}, 'return=minimal').catch(() => {});
  return out;
}

exports.handler = async function () {
  try {
    return { statusCode: 200, body: JSON.stringify(await run()) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: String((e && e.message) || e).slice(0, 200) }) };
  }
};
exports._internals = { run, LOOK_BACK_HOURS, QUIET_MINUTES, MAX_PER_RUN };
