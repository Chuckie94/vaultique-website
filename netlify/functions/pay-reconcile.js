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
//
// BUILD 81 · It also asks Flutterwave about every online refund still on
// its way, or whose answer was lost on the line (_refund.js, sweep): the
// back-up for the platform's own asking and Flutterwave's refund notice.
// =====================================================================
const P = require('./_pay');
const R = require('./_refund');

const LOOK_BACK_HOURS = 72;   // money that arrives late is still the customer's
const QUIET_MINUTES = 3;      // somebody may still be on the payment page
const MAX_PER_RUN = 25;       // a scheduled function has thirty seconds
const MAX_RETRY_PER_RUN = 10; // build 77: failed attempts asked about again, on top
const STOP_AFTER_MS = 20000;

const ago = (ms) => new Date(Date.now() - ms).toISOString();
const enc = encodeURIComponent;

async function run() {
  if (!P.serviceKey()) return { skipped: 'no service key' };
  // Online payment not connected yet: there is nobody to ask, so nothing is read.
  if (!P.flwKey('test') && !P.flwKey('live')) return { skipped: 'no Flutterwave key' };
  const began = Date.now();
  const out = { checked: 0, paid: 0, failed: 0, repaired: 0, review: 0 };

  // 1) Attempts nobody has heard back about, newest first.
  const span = '&created_at=gt.' + enc(ago(LOOK_BACK_HOURS * 3600000)) +
    '&created_at=lt.' + enc(ago(QUIET_MINUTES * 60000)) + '&order=created_at.desc';
  // BUILD 77 · review too: a payment that needs attention is asked about
  // again, in case Flutterwave now names one that is exactly right (then it
  // is paid like any other). The shop is not told twice.
  const open = await P.svc('GET', 'payments?select=*&status=in.(started,expired,review)' + span + '&limit=' + MAX_PER_RUN);

  // BUILD 77 · And attempts Flutterwave itself reported failed or
  // cancelled. On Flutterwave's page a customer whose first try fails
  // (a wrong PIN, not enough on the wallet) can try again and pay; if word
  // of that payment never reaches this site, nothing else would ever look
  // again, and the order would stay cancelled with the money taken. Not the
  // attempts this site stopped itself before a payment page existed
  // (abandon: "could not open the payment page", "stopped before the
  // payment page"): nobody could have paid those.
  const failedOnes = await P.svc('GET', 'payments?select=*&status=eq.failed' + span + '&limit=' + MAX_PER_RUN);
  const retry = (failedOnes || []).filter((p) =>
    ['failed', 'cancelled'].indexOf(String((p && p.detail && p.detail.reason) || '')) > -1);

  // Newest first across both, so a customer who paid a few minutes ago is
  // asked about before an attempt from two days ago.
  const list = (open || []).concat(retry)
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .slice(0, MAX_PER_RUN + MAX_RETRY_PER_RUN);
  let s = null;
  for (const pay of list) {
    if (Date.now() - began > STOP_AFTER_MS) break;
    out.checked++;
    try {
      const r = await P.settle(pay.tx_ref);
      if (r.status === 'paid') {
        out.paid++;
        if (r.fresh && r.pay && r.pay.order_id) {
          s = s || await P.shopSettings();
          await P.confirmByEmail(s, r.pay.order_id, r.pay.mode, r.late);
        }
      } else if (r.status === 'failed') {
        out.failed++;
      } else if (r.status === 'review') {
        out.review++;   // the shop has been told by settle itself (needsAttention)
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
          await P.confirmByEmail(s, pay.order_id, pay.mode, r.late);
        }
      } catch (e) { /* the next run tries again */ }
    }
  }

  // 3) The three-hour tidy-up, now that anything paid has been found.
  await P.svc('POST', 'rpc/pay_expire_stale', {}, 'return=minimal').catch(() => {});

  // 4) BUILD 81 · Refunds still on their way, or whose answer was lost.
  //    Before supabase-online-refund.sql is run there are none to read.
  try { out.refunds = await R.sweep(began + 26000); } catch (e) { out.refunds = { asked: 0, changed: 0 }; }
  return out;
}

exports.handler = async function () {
  try {
    return { statusCode: 200, body: JSON.stringify(await run()) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: String((e && e.message) || e).slice(0, 200) }) };
  }
};
exports._internals = { run, LOOK_BACK_HOURS, QUIET_MINUTES, MAX_PER_RUN, MAX_RETRY_PER_RUN };
