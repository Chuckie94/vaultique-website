/* =====================================================================
   Vaultique Boutique Point — the customer portal's own records (build 86)
   ---------------------------------------------------------------------
   POST { action }, with the signed-in customer's own token
   (Authorization: Bearer), from the account pages (assets/account.js).

     newsletter       -> { state: 'on' | 'off', email }
                         is the account's own email address on the list
     newsletter-set   { on: true | false }
                      -> { state: 'on' | 'off' | 'confirm', email }
                         off: taken off the list, at once;
                         on: a new address joins at once; one that left
                         the list before is sent a link, and only following
                         it from that inbox puts it back (the newsletter
                         form's own rule since build 76, newsletter.js)
     refunds          -> { refunds: [...] }
                         the refunds sent through Flutterwave for this
                         customer's own orders, and where each one is now
     data             -> everything the website holds about this customer

   WHY ON THE SERVER. The newsletter list, the payments and the refunds are
   the shop's records: no customer may read those tables, only the shop's
   administrators. Here, with the website's service key, they are read for
   the one customer whose token this is, and only the rows that are theirs:
   under their own account, or, for the newsletter, their own address.

   WHAT IT NEVER DOES. It changes no order, payment or refund, and makes no
   refund: refunds are the business platform's (Online Refund). The one
   thing it writes is the newsletter choice of the customer's own address.
   It never hands out what proves ownership of something (the chat's
   token, an order's private-link token, a newsletter link) or anything the
   shop's staff wrote for themselves (who made a refund and why).
   ===================================================================== */
'use strict';
const P = require('./_pay');
const { readConfig, settings } = require('./_seo-data');

const enc = encodeURIComponent;

/* Who the token belongs to, asked of Supabase itself: a browser can say
   anything about who it is. */
async function whoIs(event) {
  const h = (event && event.headers) || {};
  const token = String(h.authorization || h.Authorization || '').replace(/^Bearer\s+/i, '').trim();
  const { url, key } = readConfig();
  if (!token || !url || !key || token === key) return null;
  try {
    const res = await fetch(url.replace(/\/+$/, '') + '/auth/v1/user', { headers: { apikey: key, Authorization: 'Bearer ' + token } });
    if (!res.ok) return null;
    const u = await res.json();
    if (!u || !u.id) return null;
    const meta = (u.user_metadata && typeof u.user_metadata === 'object') ? u.user_metadata : {};
    return {
      id: String(u.id),
      email: String(u.email || '').trim().toLowerCase(),
      createdAt: u.created_at || null,
      confirmedAt: u.email_confirmed_at || u.confirmed_at || null,
      lastSignInAt: u.last_sign_in_at || null,
      name: typeof meta.name === 'string' ? meta.name : null,
      consentAt: typeof meta.consent_at === 'string' ? meta.consent_at : null,
    };
  } catch (e) {
    return null;
  }
}

/* A few an hour for each customer, counted by the database. Before
   supabase-hardening.sql there is nothing to count with. */
async function throttled(bucket, who, max) {
  try {
    await P.svc('POST', 'rpc/throttle', { p_bucket: bucket, p_key: who, p_max: max, p_window: '1 hour' }, 'return=minimal');
    return false;
  } catch (e) {
    return /Too many/.test(String(e && e.message));
  }
}

/* Rows of a table, or [] when the table is not there yet (its SQL not run). */
async function rows(pathAndQuery) {
  try {
    const r = await P.svc('GET', pathAndQuery);
    return Array.isArray(r) ? r : [];
  } catch (e) {
    if (/PGRST205|PGRST200|42P01|does not exist|Could not find the table|relationship/i.test(String(e && e.message))) return [];
    throw e;
  }
}
/* Only the named fields of a row, in that order. */
function pick(row, keys) {
  const out = {};
  for (const k of keys) if (row && row[k] !== undefined) out[k] = row[k];
  return out;
}

/* ---------------------------------------------------------- the newsletter */
/* The list's row for this address. Matched without regard to case, as the
   database matches it (subscribe_email). ilike's own wildcards are
   escaped, and the rows that come back are checked again here, so another
   address can never be read or changed by mistake. */
async function subscriberRow(email) {
  const like = email.replace(/[\\%_]/g, (c) => '\\' + c).replace(/\*/g, '\\*');
  const found = await rows('subscribers?email=ilike.' + enc(like) + '&select=email,created_at,unsubscribed_at');
  return found.find((r) => String(r.email || '').trim().toLowerCase() === email) || null;
}
function stateOf(row) { return row && !row.unsubscribed_at ? 'on' : 'off'; }

async function newsletter(who) {
  return P.json(200, { state: stateOf(await subscriberRow(who.email)), email: who.email });
}

async function newsletterSet(who, on, event) {
  const row = await subscriberRow(who.email);
  if (!on) {
    if (row && !row.unsubscribed_at) {
      await P.svc('PATCH', 'subscribers?email=eq.' + enc(row.email), { unsubscribed_at: new Date().toISOString() }, 'return=minimal');
    }
    return P.json(200, { state: 'off', email: who.email });
  }
  if (row && !row.unsubscribed_at) return P.json(200, { state: 'on', email: who.email });
  /* Joining is the newsletter form's own way (netlify/functions/
     newsletter.js): a new address joins at once; one that left the list is
     sent a link, because somebody's wish to be left alone outlives a
     signed-in browser left on a table. */
  const res = await require('./newsletter')._join(event, who.email);
  let b = {};
  try { b = JSON.parse(res.body || '{}') || {}; } catch (e) { b = {}; }
  if (res.statusCode !== 200) return P.json(res.statusCode, { error: b.error || 'That did not go through. Please try again shortly.' });
  const state = b.state === 'joined' || b.state === 'already' ? 'on'
    : b.state === 'confirm' || b.state === 'wait' ? 'confirm' : 'off';
  if (b.state === 'contact') {
    return P.json(502, { error: 'You left this list before, and the email to confirm could not be sent just now. Please try again later.' });
  }
  return P.json(200, { state, email: who.email });
}

/* ------------------------------------------------------------- the refunds */
const REFUND_KEYS = ['order_ref', 'amount', 'currency', 'whole', 'state', 'requested_at', 'sent_at', 'accepted_at', 'completed_at', 'failed_at'];

async function myOrders(who, select) {
  return rows('orders?customer_id=eq.' + enc(who.id) + '&select=' + select + '&order=created_at.desc&limit=500');
}
async function refundsOf(orderIds) {
  if (!orderIds.length) return [];
  const list = await rows('refunds?order_id=in.(' + orderIds.map(enc).join(',') + ')&select=*&order=requested_at.desc&limit=500');
  /* Who in the team asked, and why, are the team's own notes. */
  return list.map((r) => pick(r, REFUND_KEYS));
}
async function refunds(who) {
  const orders = await myOrders(who, 'id');
  return P.json(200, { refunds: await refundsOf(orders.map((o) => String(o.id))) });
}

/* ------------------------------------------------- everything, in one file */
const ORDER_KEYS = ['ref', 'created_at', 'status', 'fulfilment', 'name', 'phone', 'email', 'address', 'notes',
  'total', 'currency', 'goods_total', 'delivery_fee', 'tax_total', 'payment_method', 'payment_status', 'pay_channel',
  'paid_amount', 'paid_at', 'pos_receipt_no', 'pos_completed_at', 'ship_note', 'dispatched_at', 'ready_at',
  'delivered_at', 'delivered_by', 'refund_state', 'refund_amount', 'refund_ref', 'refund_at',
  // build 89: delivery (supabase-delivery.sql), theirs to see
  'delivery_instructions', 'ship_courier', 'ship_tracking', 'ship_tracking_url', 'ship_updates'];
const ITEM_KEYS = ['sku', 'name', 'price', 'qty'];
const PAYMENT_KEYS = ['tx_ref', 'mode', 'status', 'amount', 'currency', 'channel', 'created_at', 'updated_at'];
const REQUEST_KEYS = ['ref', 'order_ref', 'kind', 'reason', 'detail', 'wants', 'items', 'status', 'answer',
  'created_at', 'decided_at', 'done_at'];

async function data(who) {
  const id = enc(who.id);
  const s = (await settings('general').catch(() => null)) || {};
  const [profile, addresses, orders, newsletterRow, convs, links, asks, holds, requests] = await Promise.all([
    rows('customers?id=eq.' + id + '&select=name,phone,wishlist,created_at,updated_at'),
    rows('customer_addresses?customer_id=eq.' + id + '&select=label,recipient,phone,address,city,is_default,created_at&order=created_at.asc'),
    myOrders(who, '*,order_items(*)'),
    subscriberRow(who.email),
    rows('chat_conversations?customer_id=eq.' + id + '&select=id,name,phone,email,status,created_at,last_message_at&order=created_at.asc'),
    rows('rewards_links?user_id=eq.' + id + '&select=cust_no,how,linked_at'),
    rows('rewards_requests?user_id=eq.' + id + '&select=kind,cust_no,name,phone,status,created_at,decided_at&order=created_at.asc'),
    rows('rewards_holds?user_id=eq.' + id + '&select=order_ref,points,value,status,created_at,decided_at&order=created_at.asc'),
    /* BUILD 87 · what they asked of the shop, and its answers; not who in
       the team answered (supabase-customer-requests.sql). */
    rows('order_requests?customer_id=eq.' + id + '&select=' + REQUEST_KEYS.join(',') + '&order=created_at.asc'),
  ]);
  /* BUILD 90 · shopping (supabase-shopping.sql): their alerts, their gift
     list (whether it is shared, never its key), their sizes and categories,
     and the reviews they wrote as buyers. Nothing, before that file. */
  const [prefs, alerts, gifts, buyerReviews] = await Promise.all([
    rows('customers?id=eq.' + id + '&select=preferences').catch(() => []),
    rows('product_alerts?customer_id=eq.' + id + '&select=sku,kind,name,price_at,created_at,sent_at,sent_price&order=created_at.asc'),
    rows('gift_lists?customer_id=eq.' + id + '&select=title,note,created_at,updated_at'),
    rows('review_owners?customer_id=eq.' + id + '&select=sku,created_at,reviews(name,rating,comment,approved,created_at)&order=created_at.asc')
      .catch(() => []),
  ]);
  const orderIds = orders.map((o) => String(o.id));
  const refByOrder = {};
  for (const o of orders) refByOrder[String(o.id)] = o.ref;
  const [payments, refundList, messages] = await Promise.all([
    orderIds.length ? rows('payments?order_id=in.(' + orderIds.map(enc).join(',') + ')&select=*&order=created_at.asc') : [],
    refundsOf(orderIds),
    convs.length ? rows('chat_messages?conversation_id=in.(' + convs.map((c) => enc(c.id)).join(',') + ')&select=conversation_id,sender,body,created_at&order=created_at.asc&limit=5000') : [],
  ]);

  return P.json(200, {
    about: 'Everything the website of ' + (s.businessName || 'Vaultique Boutique Point') + ' holds about this account, ' +
           'as it was at ' + new Date().toISOString() + '. Card numbers are never in it: they are kept only by the payment service.',
    account: {
      email: who.email, created_at: who.createdAt, email_confirmed_at: who.confirmedAt,
      last_sign_in_at: who.lastSignInAt, name_given_at_sign_up: who.name, consent_given_at: who.consentAt,
    },
    details: profile[0] || null,
    addresses,
    orders: orders.map((o) => Object.assign(pick(o, ORDER_KEYS), {
      items: (o.order_items || []).map((it) => pick(it, ITEM_KEYS)),
    })),
    payments: payments.map((p) => Object.assign({ order_ref: refByOrder[String(p.order_id)] || null }, pick(p, PAYMENT_KEYS))),
    refunds: refundList,
    requests: requests.map((r) => pick(r, REQUEST_KEYS)),
    shopping: {
      preferences: (prefs[0] && prefs[0].preferences) || null,
      alerts,
      gift_list: gifts[0] ? Object.assign({ shared: true }, gifts[0]) : null,
      reviews_as_a_buyer: buyerReviews.map((r) => Object.assign({ sku: r.sku }, r.reviews || {})),
    },
    newsletter: newsletterRow
      ? { email: newsletterRow.email, joined_at: newsletterRow.created_at, left_at: newsletterRow.unsubscribed_at || null }
      : null,
    chats: convs.map((c) => Object.assign(pick(c, ['name', 'phone', 'email', 'status', 'created_at', 'last_message_at']), {
      messages: messages.filter((m) => String(m.conversation_id) === String(c.id)).map((m) => pick(m, ['sender', 'body', 'created_at'])),
    })),
    rewards: { link: links[0] || null, requests: asks, points_promised_on_orders: holds },
    not_kept_against_your_account: [
      'A review of the whole shop, or one written without signing in, carries only the name given with it, not the account.',
      'Visits to the website are counted with a random number for the browser, never a name or an account.',
    ],
  });
}

const SAY = {
  method: 'Use POST.',
  notSetUp: 'This is not available just now. Please try again later.',
  signIn: 'Please sign in again.',
  busy: 'That has been asked for many times this hour. Please try again later.',
  failed: 'That could not be done just now. Please try again shortly.',
  what: 'That request could not be read.',
};

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return P.json(405, { error: SAY.method });
  if (!P.serviceKey()) return P.json(503, { error: SAY.notSetUp });
  let body = {};
  try { body = JSON.parse(event.body || '{}') || {}; } catch (e) { return P.json(400, { error: SAY.what }); }
  const who = await whoIs(event);
  if (!who) return P.json(401, { error: SAY.signIn });
  if (!who.email) return P.json(400, { error: SAY.what });

  const action = String(body.action || '');
  try {
    if (action === 'newsletter') return await newsletter(who);
    if (action === 'newsletter-set') {
      if (typeof body.on !== 'boolean') return P.json(400, { error: SAY.what });
      if (await throttled('portal_newsletter', who.id, 20)) return P.json(429, { error: SAY.busy });
      return await newsletterSet(who, body.on, event);
    }
    if (action === 'refunds') return await refunds(who);
    if (action === 'data') {
      if (await throttled('portal_data', who.id, 10)) return P.json(429, { error: SAY.busy });
      return await data(who);
    }
    return P.json(400, { error: SAY.what });
  } catch (e) {
    console.error('[account-portal]', action, e && e.message);
    return P.json(502, { error: SAY.failed });
  }
};

module.exports._internals = { whoIs, subscriberRow, stateOf, REFUND_KEYS, ORDER_KEYS, PAYMENT_KEYS, SAY };
