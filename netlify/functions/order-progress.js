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
//   6. BUILD 87 · customers' requests (supabase-customer-requests.sql):
//      emails the shop each new one (cancel, return, exchange, a problem),
//      once, and the customer each answer the shop gives (accepted, not
//      accepted, done), once each. Before that SQL there is no table, and
//      this step says nothing and changes nothing.
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
/* BUILD 89 · the courier and the tracking number (supabase-delivery.sql),
   asked for with the rest when that file has been run, and left out when it
   has not, so the emails before it go on exactly as they did. */
const SHIP_COLS = ',ship_courier,ship_tracking,ship_tracking_url,ship_set_at,ship_mailed_at';

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

/* BUILD 89 · the courier, the tracking number and the courier's own page,
   as the shop recorded them; nothing when it has not. */
function shipLines(o) {
  const out = [];
  if (o.ship_courier) out.push('Courier: ' + o.ship_courier);
  if (o.ship_tracking) out.push('Tracking number: ' + o.ship_tracking);
  if (o.ship_tracking_url && /^https:\/\/[^\s<>"'`]+$/.test(o.ship_tracking_url)) out.push('Track it: ' + o.ship_tracking_url);
  return out.length ? [out.join('\n')] : [];
}
function onItsWay(o) {
  const l = link(o);
  return ['Your order ' + o.ref + ' is on its way to you.' + (o.ship_note ? '\n' + o.ship_note : '')]
    .concat(shipLines(o))
    .concat(['Once it has arrived, please press Confirm delivery on your order. If it has not arrived by ' +
          when(o.auto_deliver_at) + ', press Ask for more time; otherwise it will be marked delivered then.',
          l ? 'Your order: ' + l : 'You can see your order on your account page.']);
}
/* BUILD 89 · the courier or tracking number, given after the "on its way"
   email went: told once more, with them. */
function tracking(o) {
  const l = link(o);
  return ['Here are the delivery details for your order ' + o.ref + ', which is on its way to you.']
    .concat(shipLines(o))
    .concat([l ? 'Your order: ' + l : 'You can see your order on your account page.']);
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
  // BUILD 89: with the courier's columns when supabase-delivery.sql is there.
  let onway, ship = true;
  try {
    onway = await P.svc('GET', 'orders?select=' + COLS + SHIP_COLS + '&status=eq.dispatched&order=auto_deliver_at.asc&limit=200');
  } catch (e) {
    ship = false;
    try {
      onway = await P.svc('GET', 'orders?select=' + COLS + '&status=eq.dispatched&order=auto_deliver_at.asc&limit=200');
    } catch (e2) {
      return { skipped: 'the order progress is not set up (supabase-order-progress.sql)' };
    }
  }
  onway = onway || [];
  const toldNow = {};

  // 1) On its way, once; with the courier and the tracking number when the
  //    shop has recorded them (build 89), which then count as told.
  for (const o of onway.filter((x) => x.dispatched_at && !x.dispatch_mailed_at && x.email
                                    && x.dispatched_at > fresh).slice(0, MAX_PER_STEP)) {
    if (late()) break;
    if (await M.shopMail(o.email, 'Your order ' + o.ref + ' is on its way', ['Hello ' + first(o.name) + ','].concat(onItsWay(o)))) {
      await mark(o.id, 'dispatch_mailed_at');
      if (ship && o.ship_set_at) {
        await P.svc('PATCH', 'orders?id=eq.' + enc(o.id), { ship_mailed_at: iso(Date.now()) }, 'return=minimal').catch(() => {});
      }
      toldNow[o.id] = true;
      out.onway++;
    }
  }

  // 1b) BUILD 89 · the courier or the tracking number given, or changed,
  //     after that email went: the customer is told once more, once.
  out.tracking = 0;
  if (ship) {
    for (const o of onway.filter((x) => !toldNow[x.id] && x.email && x.dispatch_mailed_at && x.ship_set_at
                                      && x.ship_set_at > fresh
                                      && (x.ship_courier || x.ship_tracking || x.ship_tracking_url)
                                      && (!x.ship_mailed_at || x.ship_mailed_at < x.ship_set_at)).slice(0, MAX_PER_STEP)) {
      if (late()) break;
      if (await M.shopMail(o.email, 'Delivery details for your order ' + o.ref, ['Hello ' + first(o.name) + ','].concat(tracking(o)))) {
        await P.svc('PATCH', 'orders?id=eq.' + enc(o.id), { ship_mailed_at: iso(Date.now()) }, 'return=minimal').catch(() => {});
        toldNow[o.id] = true;
        out.tracking++;
      }
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

  // 6) Customers' requests: the shop told of each new one, the customer of
  //    each answer. Once each.
  if (!late()) {
    const told = await requestEmails(late, fresh);
    out.requestsShop = told.shop;
    out.requestsCustomer = told.customer;
  }

  // 7) BUILD 89 · delivery instructions a customer changed on their order:
  //    the shop is told, once for each change.
  if (!late()) out.instructions = await instructionEmails(late, fresh);
  return out;
}

/* ---- BUILD 89 · delivery instructions changed (supabase-delivery.sql) ----
   Given at checkout they come with the order (and count as told). Changed
   later, on the customer's own order page, the shop is emailed, so that an
   order already being prepared goes out with the right ones. */
async function instructionEmails(late, fresh) {
  let rows;
  try {
    rows = await P.svc('GET', 'orders?select=id,ref,name,phone,status,fulfilment,address,delivery_instructions,' +
                       'instructions_at,instructions_told_at&instructions_at=gt.' + enc(fresh) +
                       '&status=neq.cancelled&order=instructions_at.asc&limit=200');
  } catch (e) {
    return 0;     // supabase-delivery.sql not run yet
  }
  const due = (rows || []).filter((o) => o.instructions_at &&
    (!o.instructions_told_at || o.instructions_told_at < o.instructions_at)).slice(0, MAX_PER_STEP);
  if (!due.length) return 0;
  let shopTo = '';
  try {
    const [s, a] = await Promise.all([P.shopSettings(), M.mailAccount()]);
    shopTo = String((s.contact && s.contact.email) || a.pub.replyTo || a.pub.senderEmail || '').trim();
  } catch (e) { shopTo = ''; }
  if (!shopTo) return 0;
  let n = 0;
  for (const o of due) {
    if (late()) break;
    const lines = [o.delivery_instructions
        ? 'The customer has changed the delivery instructions for order ' + o.ref + '. They now read:\n' + o.delivery_instructions
        : 'The customer has removed the delivery instructions for order ' + o.ref + '.',
      [o.name, o.phone].filter(Boolean).join(', ') + (o.address ? '\nDelivery to: ' + o.address : ''),
      'Please make sure whoever takes the order out has them. They are on the order in Admin > Orders, and are sent ' +
      'to the platform with the order.'];
    if (await M.shopMail(shopTo, 'Delivery instructions changed: order ' + o.ref, lines)) {
      await P.svc('PATCH', 'orders?id=eq.' + enc(o.id) + '&instructions_at=eq.' + enc(o.instructions_at),
                  { instructions_told_at: iso(Date.now()) }, 'return=minimal').catch(() => {});
      n++;
    }
  }
  return n;
}

/* ---- BUILD 87 · customers' requests (supabase-customer-requests.sql) ----
   A signed-in customer asks, from their order in their account; the shop
   answers in the business platform's Online Orders (platform 512) or in
   Admin > Orders. Here, every fifteen minutes: the shop is emailed each
   new request, and the customer each answer. A request withdrawn before
   the shop was told is not sent to it. Email not set up, or an address
   missing: nothing sent, nothing marked, as above. */
const REQ_COLS = 'id,ref,order_id,order_ref,kind,reason,detail,wants,items,status,answer,created_at,updated_at,' +
  'shop_told_at,customer_told';
const REASON_SAID = {
  changed_mind: 'Changed their mind', ordered_by_mistake: 'Ordered it by mistake', too_slow: 'It is taking too long',
  wrong_size: 'The size or fit is wrong', not_as_shown: 'Not as shown on the website', damaged: 'It arrived damaged',
  quality: 'A problem with its quality', wrong_item: 'Not what they ordered', missing: 'Something is missing',
  other: 'Something else (in their words, below)'
};
function pieces(rq) {
  return (Array.isArray(rq.items) ? rq.items : [])
    .map((i) => (Number(i.qty) > 1 ? i.qty + ' \u00d7 ' : '') + (i.name || i.sku || ''))
    .filter(Boolean).join(', ');
}
function forTheShop(rq, o) {
  const ref = rq.order_ref;
  const what = {
    cancel: 'A customer has asked to cancel order ' + ref + '.',
    return: 'A customer has asked to return pieces from order ' + ref + '.',
    exchange: 'A customer has asked to exchange pieces from order ' + ref + '.',
    problem: 'A customer has reported a problem with order ' + ref + '.'
  }[rq.kind] || 'A customer has asked about order ' + ref + '.';
  const lines = [what];
  const facts = [];
  if (o && o.name) facts.push('Customer: ' + o.name);
  facts.push('Reason: ' + (REASON_SAID[rq.reason] || rq.reason));
  if (pieces(rq)) facts.push('Pieces: ' + pieces(rq));
  if (rq.wants) facts.push('Would like instead: ' + rq.wants);
  if (rq.detail) facts.push('In their words: ' + rq.detail);
  facts.push('Request ' + rq.ref + ', ' + when(rq.created_at) + '.');
  lines.push(facts.join('\n'));
  lines.push('Accept or decline it in Admin > Orders on the website, or in the business platform\'s Online Orders. ' +
             'The customer is emailed your answer.');
  return lines;
}
function forTheCustomer(rq, o) {
  const ref = rq.order_ref;
  const pcs = pieces(rq);
  const paidOnline = o && o.payment_method === 'online' && o.payment_status === 'paid';
  const asked = {
    cancel: 'to cancel your order ' + ref,
    return: 'to return ' + (pcs || 'pieces') + ' from your order ' + ref,
    exchange: 'to exchange ' + (pcs || 'pieces') + ' from your order ' + ref,
    problem: 'about the problem with your order ' + ref
  }[rq.kind] || 'about your order ' + ref;
  const lines = [];
  let subject;
  if (rq.status === 'accepted') {
    subject = 'Your request for order ' + ref + ': accepted';
    lines.push(rq.kind === 'problem'
      ? 'We have looked at the problem you reported with your order ' + ref + ', and we will put it right.'
      : 'We have accepted your request ' + asked + '.');
    if (rq.kind === 'cancel') {
      lines.push(paidOnline
        ? 'You paid online, so your money comes back the way you paid. We will email you when the refund is made.'
        : 'We will email you again once it is cancelled.');
    } else {
      lines.push('We will be in touch to arrange it.');
    }
  } else if (rq.status === 'declined') {
    subject = 'Your request for order ' + ref + ': not accepted';
    lines.push('We are sorry: we could not accept your request ' + asked + '.');
  } else {
    subject = rq.kind === 'cancel' ? 'Your order ' + ref + ' is cancelled' : 'Your request for order ' + ref + ': done';
    lines.push({
      cancel: 'Your order ' + ref + ' is cancelled, as you asked.',
      return: 'Your return from order ' + ref + ' is done.',
      exchange: 'Your exchange from order ' + ref + ' is done.',
      problem: 'The problem with your order ' + ref + ' has been put right.'
    }[rq.kind] || 'Your request about order ' + ref + ' is done.');
  }
  // The shop's word, the first time the customer hears, and with a refusal.
  if (rq.answer && (rq.customer_told == null || rq.status === 'declined')) lines.push('From the shop: ' + rq.answer);
  lines.push('If you have a question, reply to this email.');
  const base = P.siteOrigin();
  if (base) lines.push('Your order: ' + base + '/account/orders/' + enc(ref));
  return { subject, lines };
}

async function requestEmails(late, fresh) {
  const told = { shop: 0, customer: 0 };
  let fresh1, answered;
  try {
    fresh1 = await P.svc('GET', 'order_requests?select=' + REQ_COLS + '&status=eq.requested&shop_told_at=is.null' +
                         '&created_at=gt.' + enc(fresh) + '&order=created_at.asc&limit=' + MAX_PER_STEP);
    answered = await P.svc('GET', 'order_requests?select=' + REQ_COLS + '&status=in.(accepted,declined,done)' +
                           '&updated_at=gt.' + enc(fresh) + '&order=updated_at.asc&limit=200');
  } catch (e) {
    return told;    // supabase-customer-requests.sql not run yet
  }
  const due = (answered || []).filter((r) => r.customer_told !== r.status).slice(0, MAX_PER_STEP);
  if (!(fresh1 || []).length && !due.length) return told;

  const ids = Array.from(new Set((fresh1 || []).concat(due).map((r) => r.order_id).filter(Boolean)));
  let orders = [];
  if (ids.length) {
    const q = 'orders?id=in.(' + ids.map(enc).join(',') + ')&select=';
    orders = await P.svc('GET', q + 'id,ref,name,email,payment_method,payment_status')
      .catch(() => P.svc('GET', q + 'id,ref,name,email').catch(() => []));
  }
  const byId = {};
  for (const o of (orders || [])) byId[String(o.id)] = o;

  if ((fresh1 || []).length) {
    let shopTo = '';
    try {
      const [s, a] = await Promise.all([P.shopSettings(), M.mailAccount()]);
      shopTo = String((s.contact && s.contact.email) || a.pub.replyTo || a.pub.senderEmail || '').trim();
    } catch (e) { shopTo = ''; }
    for (const rq of fresh1) {
      if (late() || !shopTo) break;
      const o = byId[String(rq.order_id)] || null;
      const subject = {
        cancel: 'Customer request: cancel order ', return: 'Customer request: a return from order ',
        exchange: 'Customer request: an exchange from order ', problem: 'Customer request: a problem with order '
      }[rq.kind] || 'Customer request: order ';
      if (await M.shopMail(shopTo, subject + rq.order_ref, forTheShop(rq, o))) {
        await P.svc('PATCH', 'order_requests?id=eq.' + enc(rq.id) + '&shop_told_at=is.null',
                    { shop_told_at: iso(Date.now()) }, 'return=minimal');
        told.shop++;
      }
    }
  }

  for (const rq of due) {
    if (late()) break;
    const o = byId[String(rq.order_id)];
    if (!o || !o.email) continue;
    const m = forTheCustomer(rq, o);
    if (await M.shopMail(o.email, m.subject, ['Hello ' + first(o.name) + ','].concat(m.lines))) {
      await P.svc('PATCH', 'order_requests?id=eq.' + enc(rq.id), { customer_told: rq.status }, 'return=minimal');
      told.customer++;
    }
  }
  return told;
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

exports._internals = { run, when, link, tellRefunds, requestEmails, forTheShop, forTheCustomer, FRESH_HOURS, MAX_PER_STEP,
                       shipLines, onItsWay, tracking, instructionEmails };
