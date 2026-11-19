// =====================================================================
// AN ORDER'S PROGRESS: every fifteen minutes (netlify.toml).  BUILD 78
//
// The platform sends an order On its way (supabase-order-progress.sql), and
// the customer has the days the shop set to say it arrived. This:
//
//   1. emails the customer that it is on its way, with the shop's note, the
//      day it will be marked delivered, and the private link to the order
//      (Confirm delivery, Ask for more time). Once.
//   2. emails a reminder so many days before that day. Once, and never in
//      the same run as 1, so nobody gets both at the same moment.
//   3. marks delivered each order whose day has passed. Only orders on
//      their way: a collection order never is, so it is never marked
//      collected by itself.
//   4. emails that it was delivered, once; not when the customer said so
//      themselves.
//   5. emails a refund the platform recorded (build 510), once. From
//      website 81 the platform's Online Refund sends it sooner, while the
//      refund is being followed (tellRefunds, below, called by
//      _refund.js); this stays for any not sent that way.
//
// Without the service key, or before supabase-order-progress.sql has been
// run, it stops at once and changes nothing. Without email set up in
// Settings > Notifications, 3 still happens and nothing is marked as sent,
// so nobody is told late and wrongly that an email went. An email not sent
// within two days is not sent at all: news that old is not news.
// =====================================================================
const P = require('./_pay');
const M = require('./_mail');

const MAX_PER_STEP = 25;      // a scheduled function has thirty seconds
const STOP_AFTER_MS = 20000;
const FRESH_HOURS = 48;
const enc = encodeURIComponent;
const COLS = 'id,ref,name,email,fulfilment,status,total,ship_note,dispatched_at,delivered_at,delivered_by,' +
  'auto_deliver_at,extend_days,extend_max,extend_used,remind_days,reminded_at,progress_token,' +
  'dispatch_mailed_at,delivered_mailed_at,refund_state,refund_amount,refund_ref,refund_note,refund_at,refund_mailed_at';

const iso = (ms) => new Date(ms).toISOString();
const first = (name) => (String(name || '').trim().split(/\s+/)[0]) || 'there';

/* "Monday 23 November, 10:30", in Lusaka's time. */
function when(at) {
  const d = new Date(at);
  if (isNaN(d.getTime())) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lusaka', weekday: 'long', day: 'numeric',
      month: 'long', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
    const g = (t) => (parts.find((p) => p.type === t) || {}).value || '';
    return g('weekday') + ' ' + g('day') + ' ' + g('month') + ', ' + g('hour') + ':' + g('minute');
  } catch (e) {
    return d.toISOString().slice(0, 16).replace('T', ' ');
  }
}
function link(o) {
  const base = P.siteOrigin();
  return o.progress_token && base ? base + '/order/' + enc(o.ref) + '?t=' + enc(o.progress_token) : '';
}

function onItsWay(o) {
  const l = link(o);
  return ['Your order ' + o.ref + ' is on its way to you.' + (o.ship_note ? '\n' + o.ship_note : ''),
          'Once it has arrived, please press Confirm delivery on your order. If it has not arrived by ' +
          when(o.auto_deliver_at) + ', press Ask for more time; otherwise it will be marked delivered then.',
          l ? 'Your order: ' + l : 'You can see your order on your account page.'];
}
function reminder(o) {
  const l = link(o);
  const left = Math.max(0, (Number(o.extend_max) || 0) - (Number(o.extend_used) || 0));
  return ['Your order ' + o.ref + ' will be marked delivered on ' + when(o.auto_deliver_at) + '.',
          'If it has arrived, please press Confirm delivery. If it has not, press Ask for more time' +
          (left ? ' (' + (Number(o.extend_days) || 3) + ' more days, ' + left + (left === 1 ? ' time' : ' times') + ' left).' : '.') +
          ' If there is a problem, reply to this email.',
          l ? 'Your order: ' + l : 'You can see your order on your account page.'];
}
function delivered(o) {
  const collected = o.fulfilment === 'collection';
  return ['Your order ' + o.ref + (collected ? ' has been collected.' : ' has been delivered.') +
          (o.delivered_by === 'auto' ? ' The days to say it had arrived have passed, so it is now marked delivered.' : ''),
          'Thank you for shopping with {shop}. If anything is not right, reply to this email.'];
}
function refunded(o, money) {
  return ['We have refunded ' + money(o.refund_amount) + ' for your order ' + o.ref +
          (o.refund_ref ? ' (reference ' + o.refund_ref + ')' : '') + '.' + (o.refund_note ? '\n' + o.refund_note : ''),
          'It goes back the way you paid. Mobile money usually arrives within a day; a card can take up to a week.'];
}

async function mark(id, col, guard) {
  await P.svc('PATCH', 'orders?id=eq.' + enc(id) + '&' + col + '=is.null' + (guard || ''),
              { [col]: iso(Date.now()) }, 'return=minimal');
}

async function run() {
  if (!P.serviceKey()) return { skipped: 'no service key' };
  const began = Date.now();
  const late = () => Date.now() - began > STOP_AFTER_MS;
  const fresh = iso(began - FRESH_HOURS * 3600000);
  const out = { onway: 0, reminded: 0, delivered: 0, toldDelivered: 0, refunds: 0 };

  // Before the SQL the columns are not there, and this first read says so.
  let onway;
  try {
    onway = await P.svc('GET', 'orders?select=' + COLS + '&status=eq.dispatched&order=auto_deliver_at.asc&limit=200');
  } catch (e) {
    return { skipped: 'the order progress is not set up (supabase-order-progress.sql)' };
  }
  onway = onway || [];
  const toldNow = {};

  // 1) On its way, once.
  for (const o of onway.filter((x) => x.dispatched_at && !x.dispatch_mailed_at && x.email
                                    && x.dispatched_at > fresh).slice(0, MAX_PER_STEP)) {
    if (late()) break;
    if (await M.shopMail(o.email, 'Your order ' + o.ref + ' is on its way', ['Hello ' + first(o.name) + ','].concat(onItsWay(o)))) {
      await mark(o.id, 'dispatch_mailed_at');
      toldNow[o.id] = true;
      out.onway++;
    }
  }

  // 2) The reminder, so many days before the day; not in the same run as 1.
  const now = Date.now();
  for (const o of onway.filter((x) => !toldNow[x.id] && !x.reminded_at && x.email && x.auto_deliver_at
                                    && Number(x.remind_days) > 0
                                    && now >= Date.parse(x.auto_deliver_at) - Number(x.remind_days) * 86400000
                                    && now < Date.parse(x.auto_deliver_at)).slice(0, MAX_PER_STEP)) {
    if (late()) break;
    if (await M.shopMail(o.email, 'Has your order ' + o.ref + ' arrived?', ['Hello ' + first(o.name) + ','].concat(reminder(o)))) {
      await mark(o.id, 'reminded_at', '&status=eq.dispatched');
      out.reminded++;
    }
  }

  // 3) The day has passed: marked delivered. Asked of the database as it is
  //    now, so an order confirmed a moment ago is left alone.
  for (const o of onway.filter((x) => x.auto_deliver_at && Date.parse(x.auto_deliver_at) <= now && !x.delivered_at
                                    && x.fulfilment !== 'collection')) {
    if (late()) break;
    const r = await P.svc('PATCH', 'orders?id=eq.' + enc(o.id) + '&status=eq.dispatched&delivered_at=is.null' +
                          '&auto_deliver_at=lte.' + enc(iso(now)),
                          { status: 'delivered', delivered_at: iso(now), delivered_by: 'auto', updated_at: iso(now) });
    if (r && r.length) out.delivered++;
  }

  // 4) Delivered or collected: told once. Not what the customer said themselves.
  const done = await P.svc('GET', 'orders?select=' + COLS + '&status=eq.delivered&delivered_mailed_at=is.null' +
                           '&delivered_at=gt.' + enc(fresh) + '&limit=' + MAX_PER_STEP).catch(() => []);
  for (const o of (done || [])) {
    if (late()) break;
    if (!o.email || o.delivered_by === 'customer') continue;
    const subject = 'Your order ' + o.ref + (o.fulfilment === 'collection' ? ' has been collected' : ' has been delivered');
    if (await M.shopMail(o.email, subject, ['Hello ' + first(o.name) + ','].concat(delivered(o)))) {
      await mark(o.id, 'delivered_mailed_at');
      out.toldDelivered++;
    }
  }

  // 5) A refund the platform recorded, told once.
  const refunds = await P.svc('GET', 'orders?select=' + COLS + '&refund_mailed_at=is.null&refund_at=gt.' + enc(fresh) +
                              '&limit=' + MAX_PER_STEP).catch(() => []);
  if ((refunds || []).length) {
    const money = await moneyFn();
    for (const o of refunds) {
      if (late()) break;
      if (!o.email || !o.refund_state) continue;
      if (await M.shopMail(o.email, 'Your refund for order ' + o.ref, ['Hello ' + first(o.name) + ','].concat(refunded(o, money)))) {
        await mark(o.id, 'refund_mailed_at');
        out.refunds++;
      }
    }
  }
  return out;
}

exports.handler = async function () {
  try {
    return { statusCode: 200, body: JSON.stringify(await run()) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: String((e && e.message) || e).slice(0, 200) }) };
  }
};
/* The shop's way of writing an amount, as the page writes it. */
async function moneyFn() {
  try {
    const s = await P.shopSettings();
    const F = P.formats();
    const style = F.moneyStyle(s.general, s.pricing);
    return (v) => F.money(v, style);
  } catch (e) {
    return (v) => String(v);   // the figure as it is
  }
}

/* BUILD 81 · The refund email (step 5, word for word), for these orders
   only, as soon as their refund is accepted. Each is taken first, so the
   15-minute check does not send it too; one that could not be sent is put
   back for the check to send. budget: how long it may take, in ms. */
async function tellRefunds(ids, budget) {
  const list = (ids || []).filter(Boolean).slice(0, 3);
  if (!list.length || !P.serviceKey()) return 0;
  const began = Date.now();
  const fresh = iso(began - FRESH_HOURS * 3600000);
  const due = await P.svc('GET', 'orders?select=' + COLS + '&id=in.(' + list.map(enc).join(',') +
                          ')&refund_mailed_at=is.null&refund_at=gt.' + enc(fresh)).catch(() => []);
  const todo = (due || []).filter((o) => o.email && o.refund_state);
  if (!todo.length) return 0;
  const money = await moneyFn();
  let n = 0;
  for (const o of todo) {
    if (Date.now() - began > (budget || 4000)) break;
    const took = await P.svc('PATCH', 'orders?id=eq.' + enc(o.id) + '&refund_mailed_at=is.null',
                             { refund_mailed_at: iso(Date.now()) }).catch(() => null);
    if (!(took && took.length)) continue;
    if (await M.shopMail(o.email, 'Your refund for order ' + o.ref, ['Hello ' + first(o.name) + ','].concat(refunded(o, money)))) {
      n++;
    } else {
      await P.svc('PATCH', 'orders?id=eq.' + enc(o.id), { refund_mailed_at: null }, 'return=minimal').catch(() => {});
    }
  }
  return n;
}

exports._internals = { run, when, link, tellRefunds, FRESH_HOURS, MAX_PER_STEP };
