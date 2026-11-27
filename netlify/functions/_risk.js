// =====================================================================
// THE FRAUD CHECK (website build 91; the enterprise plan, brief §1.1–1.3,
// 1.5, 1.6; findings E-01 to E-07, E-13, E-14)
//
// On the server only. Asked at four moments:
//   order_placed    a WhatsApp order recorded (place-order)
//   payment_start   before a payment is started with Lenco or Flutterwave
//                   (pay-start, a first try and a try again)
//   payment_paid    when a gateway confirms a payment, before it is marked
//                   paid (_pay.js, settleLenco and settleFlutterwave)
//   refund          when the platform's Online Refund asks for one, before
//                   anything is sent (_refund.js)
// and, every fifteen minutes, the team's own activity (risk-watch.js).
//
// THE SIGNALS come from records the website already keeps; nothing new is
// kept about anybody to make them (supabase-risk.sql, risk_facts): orders in
// a day from one phone, one email, one connection or one account; failed
// payments from one phone; several payment attempts on one order; a
// delivery address added to the account just before; an email or a phone
// that does not look real; an order far above the shop's usual; a piece or
// quantity the server refused from the same connection; refunds for one
// customer, a refund soon after the payment, many refunds asked by one
// person in a day, a refund far above the usual order; and, for the team,
// many deletions, role or settings changes in an hour.
//
// NO SINGLE SIGNAL DECIDES. Each adds points (Settings > Fraud & Risk, with
// the defaults below); the total gives Low, Medium, High or Critical. Every
// score is kept (risk_cases) with its reasons, the order and the time.
//
// WHAT EACH LEVEL DOES, once the check acts (decision D5: it watches for
// fourteen days first, and you switch it on):
//   Low       nothing
//   Medium    recorded and shown
//   High      held for review: a payment is marked "needs attention" when
//             it is paid (the platform's till leaves those alone), a refund
//             is not sent, a WhatsApp order is marked for you to look at
//             before you confirm it
//   Critical  refused before a payment starts, with a neutral message; a
//             payment that gets through is held; a refund is not sent; and
//             an email to you
// While it watches, nothing is held or refused: each case says what acting
// would have done, so the levels can be judged before they act.
//
// IT NEVER STOPS A SALE BY ACCIDENT. Off, or before supabase-risk.sql has
// been run, or anything at all going wrong in the check itself: the order
// or the payment goes on exactly as before build 91. The one exception is
// deliberate: a payment ALREADY held stays held if the check cannot be
// asked whether it was approved, because releasing it on a failed question
// would undo the hold.
// =====================================================================
'use strict';

const P = () => require('./_pay');
const M = () => require('./_mail');

const LEVELS = ['low', 'medium', 'high', 'critical'];
const WORD = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };
const DEFAULTS = {
  mode: 'watch',                 // off | watch | act
  medium: 30, high: 60, critical: 90,
  alertEmail: true, alertTo: '',
  weights: {
    ordersPhone: 15, ordersEmail: 15, ordersClient: 10, ordersAccount: 10,
    failedPayments: 15, paymentRefs: 15, addressNew: 15,
    emailOdd: 20, phoneOdd: 20, basketHigh: 20, refused: 25,
    refundsCustomer: 25, refundQuick: 15, refundsStaff: 20, refundLarge: 15,
    staffDeletes: 25, staffRoles: 25, staffSettings: 20,
  },
  limits: {
    ordersPerDay: 3, failedPerDay: 3, paymentRefs: 3, basketTimes: 5, basketMinOrders: 20,
    refundsPer90: 2, refundQuickHours: 2, refundsStaffDay: 5,
    staffDeletesHour: 10, staffRolesHour: 3, staffSettingsHour: 15,
  },
};
// What a customer is told when a payment is refused: nothing about why.
const REFUSED_SAID = 'We could not start this payment just now, and nothing has been charged. ' +
                     'Please complete your order on WhatsApp, or contact us.';
const DISPOSABLE = ['mailinator.com', 'guerrillamail.com', 'guerrillamail.net', '10minutemail.com', 'tempmail.com',
  'temp-mail.org', 'yopmail.com', 'trashmail.com', 'sharklasers.com', 'getnada.com', 'dispostable.com', 'maildrop.cc',
  'throwawaymail.com', 'fakeinbox.com', 'mailnesia.com', 'mintemail.com', 'example.com', 'example.org', 'test.com'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const enc = encodeURIComponent;

function merge(saved) {
  const s = saved && typeof saved === 'object' ? saved : {};
  const num = (v, d) => { const n = Number(v); return v !== '' && v != null && isFinite(n) && n >= 0 ? n : d; };
  const out = {
    mode: ['off', 'watch', 'act'].indexOf(s.mode) > -1 ? s.mode : DEFAULTS.mode,
    medium: num(s.medium, DEFAULTS.medium), high: num(s.high, DEFAULTS.high), critical: num(s.critical, DEFAULTS.critical),
    alertEmail: s.alertEmail !== false,
    alertTo: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s.alertTo || '').trim()) ? String(s.alertTo).trim() : '',
    weights: {}, limits: {},
  };
  Object.keys(DEFAULTS.weights).forEach((k) => { out.weights[k] = num(s['w_' + k] != null ? s['w_' + k] : (s.weights || {})[k], DEFAULTS.weights[k]); });
  Object.keys(DEFAULTS.limits).forEach((k) => { out.limits[k] = Math.max(1, num(s['l_' + k] != null ? s['l_' + k] : (s.limits || {})[k], DEFAULTS.limits[k])); });
  // The levels always rise: a High below the Medium would read nonsense.
  if (!(out.medium > 0)) out.medium = 1;
  if (!(out.high > out.medium)) out.high = out.medium + 1;
  if (!(out.critical > out.high)) out.critical = out.high + 1;
  return out;
}

let CACHE = null, CACHE_AT = 0;
async function settings() {
  if (CACHE && Date.now() - CACHE_AT < 60000) return CACHE;
  let saved = null;
  try {
    const r = await P().svc('GET', 'site_settings_private?key=eq.risk&select=data');
    saved = r && r[0] && r[0].data;
  } catch (e) { saved = null; }
  CACHE = merge(saved);
  CACHE_AT = Date.now();
  return CACHE;
}
function forget() { CACHE = null; CACHE_AT = 0; }

/* ---------------------------------------------------------------- signals */
function emailOdd(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return '';
  const m = /^([^@\s]+)@([^@\s]+\.[a-z]{2,})$/.exec(e);
  if (!m) return 'the email address is not a real address';
  if (DISPOSABLE.indexOf(m[2]) > -1) return 'the email address is a throwaway one (' + m[2] + ')';
  if (/^(test|asdf|qwerty|a+|x+|none|no|fake)\d*$/.test(m[1])) return 'the email address looks made up';
  return '';
}
function phoneOdd(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (!d) return '';
  const local = d.length === 12 && d.indexOf('260') === 0 ? '0' + d.slice(3) : d;
  // One digit throughout, the seven after the network's prefix all the same,
  // or counting up or down: numbers typed to get past the box.
  if (/^(\d)\1+$/.test(local) || /^0\d{2}(\d)\1{6}$/.test(local) || /0123456|1234567|2345678|3456789|9876543|8765432/.test(local)) {
    return 'the phone number does not look real';
  }
  if (local.length >= 9 && local.length <= 15) return '';
  return 'the phone number does not look real';
}
function money(n) {
  const v = Number(n);
  return isFinite(v) ? 'K' + v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '';
}

/* The points, the level and the reasons: plain, for the tests. */
function score(moment, f, ctx, cfg) {
  const W = cfg.weights, L = cfg.limits, R = [];
  const add = (signal, points, said) => { if (points > 0) R.push({ signal, points: Math.round(points), said }); };
  // A count at twice its limit counts twice.
  const step = (n, lim, w) => (n >= lim * 2 ? w * 2 : w);
  f = f || {};
  ctx = ctx || {};
  const n = (v) => Number(v) || 0;
  if (moment === 'order_placed' || moment === 'payment_start' || moment === 'payment_paid') {
    if (n(f.ordersPhone) >= L.ordersPerDay) add('ordersPhone', step(n(f.ordersPhone), L.ordersPerDay, W.ordersPhone), n(f.ordersPhone) + ' orders from this phone number in a day');
    if (n(f.ordersEmail) >= L.ordersPerDay) add('ordersEmail', step(n(f.ordersEmail), L.ordersPerDay, W.ordersEmail), n(f.ordersEmail) + ' orders from this email address in a day');
    if (n(f.ordersClient) >= L.ordersPerDay) add('ordersClient', step(n(f.ordersClient), L.ordersPerDay, W.ordersClient), n(f.ordersClient) + ' orders from this connection in a day');
    if (n(f.ordersAccount) >= L.ordersPerDay) add('ordersAccount', step(n(f.ordersAccount), L.ordersPerDay, W.ordersAccount), n(f.ordersAccount) + ' orders from this account in a day');
    if (n(f.failedPhone) >= L.failedPerDay) add('failedPayments', step(n(f.failedPhone), L.failedPerDay, W.failedPayments), n(f.failedPhone) + ' failed payments from this phone number in a day');
    if (n(f.paymentRefs) >= L.paymentRefs) add('paymentRefs', step(n(f.paymentRefs), L.paymentRefs, W.paymentRefs), n(f.paymentRefs) + ' payment attempts on this one order');
    if (n(f.addressNew) > 0) add('addressNew', W.addressNew, 'a delivery address added to the account in the half hour before');
    const eo = emailOdd(ctx.email);
    if (eo) add('emailOdd', W.emailOdd, eo);
    const po = phoneOdd(ctx.phone);
    if (po) add('phoneOdd', W.phoneOdd, po);
    const total = Number(ctx.total), usual = Number(f.usualTotal);
    if (isFinite(total) && usual > 0 && n(f.usualOf) >= L.basketMinOrders && total >= usual * L.basketTimes) {
      add('basketHigh', step(total, usual * L.basketTimes, W.basketHigh),
          money(total) + ' is ' + Math.round(total / usual) + ' times the shop’s usual order (' + money(usual) + ')');
    }
    if (n(f.refusedClient) > 0) {
      add('refused', W.refused, 'the shop refused an unreadable piece or quantity from this connection today (' +
          n(f.refusedClient) + (n(f.refusedClient) === 1 ? ' time)' : ' times)'));
    }
  }
  if (moment === 'refund') {
    if (n(f.refundsPhone90) >= L.refundsPer90) add('refundsCustomer', step(n(f.refundsPhone90), L.refundsPer90, W.refundsCustomer), n(f.refundsPhone90) + ' refunds for this customer in 90 days');
    if (f.hoursSincePaid != null && Number(f.hoursSincePaid) >= 0 && Number(f.hoursSincePaid) < L.refundQuickHours) {
      add('refundQuick', W.refundQuick, 'asked for ' + (Number(f.hoursSincePaid) < 1 ? 'within the hour' : 'within ' + Math.ceil(Number(f.hoursSincePaid)) + ' hours') + ' of the payment');
    }
    if (n(f.refundsByStaffToday) >= L.refundsStaffDay) add('refundsStaff', step(n(f.refundsByStaffToday), L.refundsStaffDay, W.refundsStaff), n(f.refundsByStaffToday) + ' refunds asked for by ' + (ctx.byName || 'the same person') + ' in a day');
    const usual = Number(f.usualTotal);
    if (usual > 0 && n(f.usualOf) >= L.basketMinOrders && Number(f.amount) >= usual * L.basketTimes) {
      add('refundLarge', W.refundLarge, money(f.amount) + ' refunded, ' + Math.round(Number(f.amount) / usual) + ' times the shop’s usual order');
    }
  }
  if (moment === 'staff') {
    if (n(f.deletes) >= L.staffDeletesHour) add('staffDeletes', step(n(f.deletes), L.staffDeletesHour, W.staffDeletes), n(f.deletes) + ' records deleted in an hour');
    if (n(f.roles) >= L.staffRolesHour) add('staffRoles', step(n(f.roles), L.staffRolesHour, W.staffRoles), n(f.roles) + ' changes to the team’s logins or roles in an hour');
    if (n(f.settings) >= L.staffSettingsHour) add('staffSettings', step(n(f.settings), L.staffSettingsHour, W.staffSettings), n(f.settings) + ' settings changes in an hour');
  }
  const total = R.reduce((s, r) => s + r.points, 0);
  let level = total >= cfg.critical ? 'critical' : total >= cfg.high ? 'high' : total >= cfg.medium ? 'medium' : 'low';
  // A level carried from an earlier moment (the start of the same payment).
  if (ctx.floor && LEVELS.indexOf(ctx.floor.level) > LEVELS.indexOf(level)) {
    R.push({ signal: 'carried', points: 0, said: 'when the payment started, the check gave it ' + WORD[ctx.floor.level] +
                                                    (ctx.floor.score != null ? ' (' + ctx.floor.score + ' points)' : '') });
    level = ctx.floor.level;
  }
  return { score: total, level, reasons: R };
}

/* What a level does at a moment, once the check acts. */
function actionFor(moment, level) {
  if (level === 'low') return 'none';
  if (level === 'medium') return 'shown';
  if (moment === 'payment_start') return level === 'critical' ? 'refused' : 'shown';   // High is held once it is paid
  if (moment === 'payment_paid') return 'held';
  if (moment === 'refund') return 'refused';                                           // not sent until approved
  return 'shown';                                                                       // a WhatsApp order, the team
}
function decide(moment, level, mode) {
  const act = actionFor(moment, level);
  return mode === 'act' ? { action: act, would: act } : { action: 'none', would: act };
}

/* --------------------------------------------------------------- recording */
// One case per payment's start, per payment's confirmation, per refund and
// per WhatsApp order (supabase-risk.sql): of several requests about the same
// thing at the same moment, the first one's case is everybody's.
const ONE = { payment_start: 'tx_ref', payment_paid: 'tx_ref', refund: 'refund_id', order_placed: 'order_id' };
async function existing(moment, row) {
  const col = ONE[moment];
  if (!col || !row[col]) return null;
  const got = await P().svc('GET', 'risk_cases?select=*&moment=eq.' + moment + '&' + col + '=eq.' + enc(row[col]) + '&limit=1');
  return (got && got[0]) || null;
}
async function record(moment, ctx, s, cfg) {
  const d = decide(moment, s.level, cfg.mode);
  const open = (s.level === 'high' || s.level === 'critical') ? 'open' : 'none';
  const row = {
    moment, order_id: (ctx.order && ctx.order.id) || null, order_ref: (ctx.order && ctx.order.ref) || null,
    tx_ref: (ctx.pay && ctx.pay.tx_ref) || null, refund_id: (ctx.refund && ctx.refund.id) || null, actor: ctx.actor || null,
    score: Math.min(10000, s.score), level: s.level, reasons: s.reasons, mode: cfg.mode,
    action: d.action, would: d.would, review_state: open,
  };
  let c;
  try {
    const got = await P().svc('POST', 'risk_cases', row);
    c = (got && got[0]) || row;
  } catch (e) {
    if (!/23505|duplicate key|risk_cases_one/i.test(String(e && e.message))) throw e;
    const first = await existing(moment, row);
    if (!first) throw e;
    return Object.assign({ existing: true }, first);
  }
  if (row.order_id && s.level !== 'low') {
    // The order shows the highest level any of its moments was given.
    const lower = LEVELS.slice(0, LEVELS.indexOf(s.level)).join(',');
    await P().svc('PATCH', 'orders?id=eq.' + enc(row.order_id) + '&or=(risk_level.is.null' +
                  (lower ? ',risk_level.in.(' + lower + ')' : '') + ')', { risk_level: s.level }, 'return=minimal').catch(() => {});
  }
  // Critical: an email to you. A payment held gets its own email instead
  // (holdEmail, sent by the request that holds it), so never two.
  if (s.level === 'critical' && cfg.alertEmail && c.id && row.action !== 'held') await alert(c, cfg).catch(() => {});
  return c;
}

/* Where the check's emails go: the address in Settings > Fraud & Risk, or
   the shop's own contact address. */
async function shopTo(cfg) {
  if (cfg && cfg.alertTo) return cfg.alertTo;
  try {
    const [s, a] = await Promise.all([P().shopSettings(), M().mailAccount()]);
    return String((s.contact && s.contact.email) || a.pub.replyTo || a.pub.senderEmail || '').trim();
  } catch (e) { return ''; }
}
function whyLines(c) {
  return 'Why:\n' + ((c.reasons || []).map((r) => '- ' + r.said + (r.points ? ' (' + r.points + ' points)' : '')).join('\n') || '- nothing');
}
function alertLines(c) {
  const what = { order_placed: 'A WhatsApp order', payment_start: 'A payment about to start', payment_paid: 'A payment just made',
                 refund: 'A refund asked for', staff: 'Activity by a member of the team' }[c.moment] || 'Something';
  const did = c.mode === 'act'
    ? ({ refused: c.moment === 'refund' ? 'It was not sent.' : 'It was refused before the payment started, and nothing was charged.',
         held: 'It is held: the till will not ring it up until you approve it.', shown: 'It is marked for you to look at.' }[c.action] || '')
    : 'The check is only watching, so nothing was held or refused. Acting, it would have ' +
      ({ refused: 'refused it.', held: 'held it.', shown: 'marked it for you.' }[c.would] || 'marked it for you.');
  return [what + (c.order_ref ? ', order ' + c.order_ref : '') + ', was scored Critical (' + c.score + ' points) by the fraud check.',
          did, whyLines(c), 'Look at it in Admin > Fraud & Risk: Approve, Reject or Escalate.'];
}
async function alert(c, cfg) {
  const to = await shopTo(cfg);
  if (!to || !c.id) return false;
  const ok = await M().shopMail(to, 'Fraud check: Critical' + (c.order_ref ? ', order ' + c.order_ref : ''), alertLines(c));
  if (ok) await P().svc('PATCH', 'risk_cases?id=eq.' + enc(c.id), { alerted_at: new Date().toISOString() }, 'return=minimal').catch(() => {});
  return ok;
}

/* The email for a payment held: the money is in, and somebody has to look. */
function holdLines(pay, c, gw) {
  const ref = c.order_ref || pay.tx_ref;
  const lines = [];
  if (pay.mode === 'test') lines.push('A TEST payment, made in Test mode: no money moved.');
  lines.push('A payment for order ' + ref + ' was confirmed by ' + gw + ', and the fraud check held it. It scored ' +
             WORD[c.level] + ' (' + c.score + ' points). The order says "needs attention" and the payment is not marked ' +
             'paid, so the till will not ring it up.');
  lines.push(whyLines(c));
  lines.push('In Admin > Fraud & Risk: Approve, and it is marked paid once ' + gw + ' confirms it again (the customer is ' +
             'emailed then); or Reject, and refund the customer from your ' + gw + ' account; or Escalate.');
  lines.push('Our reference: ' + pay.tx_ref);
  return lines;
}
async function holdEmail(pay, c, gw) {
  const cfg = await settings();
  const to = await shopTo(cfg);
  if (!to) return false;
  const ok = await M().shopMail(to, (pay.mode === 'test' ? '[TEST] ' : '') + 'Payment held for review: order ' + (c.order_ref || pay.tx_ref),
                                holdLines(pay, c, gw));
  if (ok && c.id) await P().svc('PATCH', 'risk_cases?id=eq.' + enc(c.id), { alerted_at: new Date().toISOString() }, 'return=minimal').catch(() => {});
  return ok;
}

/* ----------------------------------------------------------- the moments */
// One question to the database for the counts.
async function facts(ctx) {
  return P().svc('POST', 'rpc/risk_facts', { p: {
    phone: ctx.phone || '', email: ctx.email || '', client: ctx.client || '', customer: ctx.customer || '',
    order_id: (ctx.order && ctx.order.id) || '',
  } });
}
const notReady = (e) => /404|PGRST20[25]|risk_facts|risk_refund_facts|risk_cases|does not exist/i.test(String(e && e.message));

async function assess(moment, ctx) {
  try {
    if (!P().serviceKey()) return { off: true, why: 'no service key' };
    const cfg = await settings();
    if (cfg.mode === 'off') return { off: true, why: 'off' };
    let f;
    try {
      f = moment === 'refund'
        ? Object.assign({}, await facts(ctx), await P().svc('POST', 'rpc/risk_refund_facts', { p_refund: ctx.refund.id }))
        : moment === 'staff' ? (ctx.facts || {}) : await facts(ctx);
    } catch (e) {
      return { off: true, why: notReady(e) ? 'not ready' : 'error' };
    }
    const s = score(moment, f, ctx, cfg);
    const c = await record(moment, ctx, s, cfg);
    return Object.assign({ off: false }, c);
  } catch (e) {
    console.error('[risk] not scored:', e && e.message);
    return { off: true, why: 'error' };
  }
}

/* A WhatsApp order: recorded and shown; never refused (it is confirmed by
   hand on WhatsApp before anything is paid). */
async function atOrder(ctx) { return assess('order_placed', ctx); }

/* Before a payment starts: refused only when Critical and acting. A High
   start is carried to the payment, so that it is held once it is paid. */
async function atStart(ctx) {
  const r = await assess('payment_start', ctx);
  if (r.off) return r;
  const carry = (r.level === 'high' || r.level === 'critical') ? { level: r.level, score: r.score, case: r.id || null } : null;
  return Object.assign(r, { refuse: r.action === 'refused', carry });
}
/* The level carried onto the payment's own row (detail.risk). */
async function carryTo(pay, carry) {
  if (!carry || !pay || !pay.tx_ref) return;
  const detail = Object.assign({}, (pay && pay.detail) || {}, { risk: carry });
  await P().svc('PATCH', 'payments?tx_ref=eq.' + enc(pay.tx_ref) + '&status=eq.started', { detail }, 'return=minimal').catch(() => {});
}

/* When a gateway says a payment is made, before it is marked paid.
   hold     keep it held (or hold it now)
   release  the id of an approved case: mark it released once paid */
async function atPaid(pay) {
  const held = pay && pay.detail && pay.detail.risk_hold;
  if (held) {
    // Held already. Only an approval lets it through; if that cannot be
    // asked just now, it stays held until the next question.
    try {
      const c = held.case && UUID.test(String(held.case))
        ? ((await P().svc('GET', 'risk_cases?select=*&id=eq.' + enc(held.case))) || [])[0]
        : await existing('payment_paid', { tx_ref: pay.tx_ref });
      if (c && c.review_state === 'approved') return { off: false, hold: false, release: c.id, case: c };
      return Object.assign({ off: false, hold: true, existing: true }, c || held);
    } catch (e) {
      return Object.assign({ off: false, hold: true, existing: true, unknown: true }, held);
    }
  }
  try {
    if (!P().serviceKey()) return { off: true };
    const before = await existing('payment_paid', { tx_ref: pay.tx_ref }).catch(() => null);
    if (before) {
      // Decided once already, by an earlier message about this payment.
      if (before.action === 'held' && before.review_state !== 'approved') return Object.assign({ off: false, hold: true, existing: true }, before);
      return Object.assign({ off: false, hold: false, existing: true }, before);
    }
    const o = pay.order_id
      ? ((await P().svc('GET', 'orders?select=id,ref,email,customer_id,phone&id=eq.' + enc(pay.order_id))) || [])[0] || {}
      : {};
    const carried = pay.detail && pay.detail.risk;
    const r = await assess('payment_paid', {
      order: { id: pay.order_id || null, ref: o.ref || null }, pay,
      phone: pay.phone || o.phone, email: o.email, customer: o.customer_id,
      total: pay.amount, floor: carried && carried.level ? carried : null,
    });
    if (r.off) return r;
    return Object.assign(r, { hold: r.action === 'held' && r.review_state !== 'approved' });
  } catch (e) {
    console.error('[risk] payment not scored:', e && e.message);
    return { off: true, why: 'error' };
  }
}
async function released(id) {
  if (!id) return;
  await P().svc('PATCH', 'risk_cases?id=eq.' + enc(id) + '&released_at=is.null', { released_at: new Date().toISOString() },
                'return=minimal').catch(() => {});
}

/* A held payment approved: asked of its gateway once more, as any payment
   is, and marked paid on the gateway's word. The confirmation emails go
   from here when this is the call that marked it paid. */
async function release(c) {
  if (!c || c.moment !== 'payment_paid' || c.action !== 'held' || c.review_state !== 'approved' || !c.tx_ref) {
    return { ok: false, why: 'not_approved' };
  }
  const r = await P().settle(c.tx_ref);
  if (r.status === 'paid') {
    await released(c.id);
    if (r.fresh && r.pay && r.pay.order_id) {
      const s = await P().shopSettings();
      await P().confirmByEmail(s, r.pay.order_id, r.pay.mode, r.late, r.pay.provider);
    }
  }
  return { ok: true, status: r.status };
}

/* A refund, before it is sent. One the check held and you approved (for the
   same order, in the last seven days) goes through when it is asked again. */
async function atRefund(row) {
  if (!row || !row.id) return { off: true };
  try {
    if (row.order_id) {
      const since = new Date(Date.now() - 7 * 86400000).toISOString();
      const ok = await P().svc('GET', 'risk_cases?select=id&moment=eq.refund&review_state=eq.approved&order_id=eq.' +
                                      enc(row.order_id) + '&at=gt.' + enc(since) + '&limit=1');
      if (ok && ok.length) return { off: true, why: 'approved', approved: ok[0].id };
    }
  } catch (e) { /* asked below; anything wrong there lets the refund through */ }
  let phone = '';
  try {
    if (row.order_id) phone = (((await P().svc('GET', 'orders?select=phone&id=eq.' + enc(row.order_id))) || [])[0] || {}).phone || '';
  } catch (e) { phone = ''; }
  const r = await assess('refund', { refund: row, order: { id: row.order_id || null, ref: row.order_ref || null }, phone,
                                     byName: row.by_name });
  if (r.off) return r;
  return Object.assign(r, { refuse: r.action === 'refused' && r.review_state !== 'approved' });
}
function refundHeldSaid(r) {
  return 'Held by the website’s fraud check (' + WORD[r.level] + ', ' + r.score + ' points): nothing was sent. ' +
         'Look at it in the website’s Admin > Fraud & Risk; once approved there, ask for the refund again.';
}

/* A refusal no checkout page causes: a piece or a quantity that could not be
   read, an empty order, too many lines. A piece selling out or a price
   changing is ordinary, and never counted. (A price is never taken from the
   page, since build 76, so there is no price to refuse.) */
const UNREADABLE = /could not be read|too many different pieces|nothing to pay for|nothing in the order/i;
function unreadable(problem) { return UNREADABLE.test(String(problem || '')); }

/* An unreadable piece or quantity refused by the server: counted for the
   connection (rate_events, kept two days), never a reason to refuse more. */
async function noteRefused(client) {
  if (!client) return;
  await P().svc('POST', 'rpc/throttle', { p_bucket: 'refused', p_key: String(client).slice(0, 64), p_max: 1000000,
                                          p_window: '1 day' }, 'return=minimal').catch(() => {});
}

/* --------------------------------------------- every fifteen minutes (risk-watch) */
// The team's activity in the sealed record, the last hour, per person. A
// person already given a case in the last hour is not given another.
async function staffScan() {
  const cfg = await settings();
  if (cfg.mode === 'off') return { off: true };
  const since = new Date(Date.now() - 3600000).toISOString();
  const rows = (await P().svc('POST', 'rpc/risk_staff_facts', { p_since: since })) || [];
  const out = { people: rows.length, cases: 0 };
  for (const f of rows) {
    const s = score('staff', f, {}, cfg);
    if (s.level === 'low') continue;
    const seen = await P().svc('GET', 'risk_cases?select=id&moment=eq.staff&actor=eq.' + enc(f.actor) + '&at=gt.' + enc(since) + '&limit=1');
    if (seen && seen.length) continue;
    await record('staff', { actor: f.actor }, s, cfg);
    out.cases++;
  }
  return out;
}
// Approved holds whose payment is still waiting: released through settle.
async function releaseApproved(stopAt) {
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const list = (await P().svc('GET', 'risk_cases?select=*&moment=eq.payment_paid&action=eq.held&review_state=eq.approved' +
                                     '&released_at=is.null&at=gt.' + enc(since) + '&order=at.asc&limit=10')) || [];
  const out = { asked: 0, released: 0 };
  for (const c of list) {
    if (stopAt && Date.now() > stopAt) break;
    out.asked++;
    try {
      const r = await release(c);
      if (r.status === 'paid') out.released++;
    } catch (e) { /* the next run asks again */ }
  }
  return out;
}
// Escalated cases: the owner is emailed, once each.
async function mailEscalated() {
  const list = (await P().svc('GET', 'risk_cases?select=*&review_state=eq.escalated&escalated_mailed_at=is.null&order=at.asc&limit=10')) || [];
  if (!list.length) return { mailed: 0 };
  let to = '';
  try {
    const owners = await P().svc('GET', 'admins?select=email&role=eq.owner&limit=3');
    to = (owners || []).map((o) => String(o.email || '').trim()).filter(Boolean).join(', ');
  } catch (e) { to = ''; }
  if (!to) to = await shopTo(await settings());
  if (!to) return { mailed: 0 };
  let mailed = 0;
  for (const c of list) {
    const ok = await M().shopMail(to, 'Fraud check: escalated to you' + (c.order_ref ? ', order ' + c.order_ref : ''), [
      'A case in Admin > Fraud & Risk was escalated to you' + (c.review_note ? ', with this note: "' + c.review_note + '"' : '') + '.',
      (c.order_ref ? 'Order ' + c.order_ref + ' s' : 'It s') + 'cored ' + WORD[c.level] + ' (' + c.score + ' points) when ' +
        ({ order_placed: 'the WhatsApp order was placed', payment_start: 'the payment started', payment_paid: 'the payment came in',
           refund: 'the refund was asked for', staff: 'the team’s activity was checked' }[c.moment] || 'it was checked') + '.',
      whyLines(c), 'It stays held, or marked, until it is approved or rejected there.']);
    if (ok) {
      mailed++;
      await P().svc('PATCH', 'risk_cases?id=eq.' + enc(c.id), { escalated_mailed_at: new Date().toISOString() }, 'return=minimal').catch(() => {});
    }
  }
  return { mailed };
}

module.exports = {
  DEFAULTS, LEVELS, WORD, REFUSED_SAID,
  merge, settings, forget, score, actionFor, decide, emailOdd, phoneOdd, alertLines, holdLines, refundHeldSaid,
  assess, record, atOrder, atStart, carryTo, atPaid, released, release, atRefund, unreadable, noteRefused, holdEmail,
  staffScan, releaseApproved, mailEscalated,
};
