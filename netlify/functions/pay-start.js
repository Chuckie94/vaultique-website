// Starts a payment: prices the order here, checks the stock, records the
// order (through the same place_order the WhatsApp checkout uses), and
// starts the payment with the gateway that takes the way of paying chosen.
//
// POST { items, buyer: { name, phone, email, address, notes, instructions }, fulfilment, town, preview,
//        expect,        the total on the quote the customer pressed Pay on
//        method,        BUILD 88: 'mobile' | 'card' (never 'bank': no gateway takes it yet)
//        network,       BUILD 88: mobile money through Lenco: airtel | mtn | zamtel
//        momo,          BUILD 88: the mobile money number (the buyer's phone when not given)
//        attempt,       BUILD 88: a key the page makes for one press of Pay
//        retry }        BUILD 88: { txRef }: try the same order again, after that attempt
// Authorization: the signed-in customer's own token, when there is one,
// so the order lands in their account exactly as a WhatsApp order does.
// Since build 76 the token is checked with Supabase here and the order is
// written with the service key (P.recordOrder), the only key place_order
// now answers.
//
// WHAT COMES BACK, by the gateway that takes the payment (_pay.js, routes):
//   Flutterwave    { link, ref, txRef, total, totalText }
//                  the page goes to Flutterwave's own page, as before build 88
//   Lenco, prompt  { via: 'prompt', ref, txRef, number, network, networkLabel, totalText }
//                  mobile money: the customer approves on their phone
//   Lenco, window  { via: 'window', ref, txRef, totalText, widget: {...} }
//                  cards: the page opens Lenco's own payment window
//   A Lenco answer may also carry status 'paid', 'review' or 'failed' (with a
//   reason for the customer) when Lenco has already decided.
const P = require('./_pay');
const L = require('./_lenco');
const CR = require('./_cardroute');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TX = /^VB-[A-Z0-9]{5}-[a-f0-9]{10}$/;
const KEY = /^[A-Za-z0-9_-]{16,64}$/;
const RETRY_GAP_MS = L.HOLD.ms; // a request younger than this may still be live (_lenco.js, HOLD)
const MAX_TRIES = 6;            // payments one order may have
const DAY_MS = 86400000;
const enc = encodeURIComponent;

function cut(v, n) { return String(v == null ? '' : v).trim().slice(0, n); }
function firstLast(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] || '', lastName: parts.length > 1 ? parts.slice(1).join(' ') : (parts[0] || '') };
}
const refOf = (tx) => String(tx || '').split('-').slice(0, 2).join('-');

// ---- BUILD 88 · LENCO -----------------------------------------------------------------
// The payment row is already written. Cards: the page is given what Lenco's
// window needs (the public key, never the secret one). Mobile money: Lenco is
// asked to send the request to the customer's phone, and what it says is kept.
// Once Lenco has been asked, nothing here undoes the order: whatever Lenco did
// is found out by asking it (the status page, the webhook, the check-up).
async function lencoStart(x) {
  const { s, mode, method, pay, order, total, currency, buyer, network, momo } = x;
  const F = P.formats();
  const style = F.moneyStyle(s.general, s.pricing);
  const out = {
    via: method === 'card' ? 'window' : 'prompt', ref: order.ref, txRef: pay.tx_ref,
    total, totalText: F.money(total, style), test: mode === 'test',
  };
  if (method === 'card') {
    const w = L.widget(mode);
    const nm = firstLast(buyer.name);
    out.widget = {
      script: w.script, key: w.key, reference: pay.tx_ref, email: buyer.email,
      amount: total, currency, label: s.general.businessName || 'Vaultique Boutique Point',
      channels: ['card'], bearer: 'merchant',
      customer: { firstName: nm.firstName, lastName: nm.lastName, phone: buyer.phone },
    };
    // Named only now, once the card is going to this gateway: with a second
    // card gateway (_cardroute.js) the customer's answer decides which.
    out.processor = 'Lenco';
    return out;
  }
  out.number = L.masked(momo);
  out.network = network;
  out.networkLabel = L.NETWORKS[network].label;
  // When the page may offer a new request, if none has been approved: the
  // same wait the server holds to (retry, below).
  out.retryAfter = Math.round(L.HOLD.ms / 1000);
  const r = await L.startMobile(mode, { amount: total, reference: pay.tx_ref, phone: momo, network });
  const now = new Date().toISOString();
  try {
    if (r.answered && r.c) {
      const said = { provider_tx_id: r.c.id || null, provider_ref: r.c.lencoReference || null,
                     provider_status: r.c.status, verified_at: now, provider_response: L.responseOf(r.c) };
      if (r.state === 'pending') { await P.touchLenco(pay, said); return out; }
      if (r.state === 'successful' || r.state === 'failed') {
        const st = await P.settle(pay.tx_ref);
        out.status = st.status === 'paid' || st.status === 'review' || st.status === 'failed' ? st.status : undefined;
        if (st.status === 'failed') out.reason = L.customerReason(st.reason, 'mobile');
        if (st.status === 'paid' && st.fresh && st.pay && st.pay.order_id) {
          await P.confirmByEmail(s, st.pay.order_id, st.pay.mode, st.late, 'lenco');
        }
        return out;
      }
      // A step this checkout does not take: the reference for this endpoint
      // gives pending, successful, failed and pay-offline only.
      await P.failAttempt(pay, 'unsupported', Object.assign({ failure_reason: 'Lenco asked for a step this checkout does not take (' + r.c.status + ').' }, said),
                          { provider: 'lenco', why: r.c.status });
      out.status = 'failed';
      out.unsupported = true;
      out.reason = 'We were unable to complete this payment because your network requested an additional verification ' +
                   'step that is not supported here. Please choose another payment method.';
      return out;
    }
    if (r.refused) {
      // A clear no from Lenco: no request reached the customer's phone.
      await P.failAttempt(pay, 'refused', { failure_reason: r.message, verified_at: now }, { provider: 'lenco', why: r.message });
      await P.noteError('lenco', r.message);
      out.status = 'failed';
      out.refused = true;
      out.reason = r.errorCode === '12'
        ? 'We were unable to send a payment request to this number. Please check that it is a registered ' +
          out.networkLabel + ' number, or choose another payment method.'
        : 'We were unable to start your payment. Please try again or choose another payment method.';
      return out;
    }
  } catch (e) { /* recorded or not, Lenco has been asked: the status says what happened */ }
  // No answer from Lenco: the request may or may not have reached the phone.
  // Never called failed on a guess; the status page and the check-up ask.
  await P.touchLenco(pay, { provider_status: 'no-answer', verified_at: now });
  await P.noteError('lenco', r.message);
  out.uncertain = true;
  return out;
}

// The same press of Pay again (a double tap, an answer lost on the line):
// the payment it made, as it stands, and nothing new.
async function again(row, s) {
  const F = P.formats();
  const style = F.moneyStyle(s.general, s.pricing);
  const out = { again: true, via: row.method === 'card' ? 'window' : 'prompt', ref: refOf(row.tx_ref), txRef: row.tx_ref,
                total: Number(row.amount), totalText: F.money(Number(row.amount), style), test: row.mode === 'test' };
  if (row.status === 'paid' || row.status === 'review' || row.status === 'failed') out.status = row.status;
  if (row.status === 'failed') {
    if (row.detail && row.detail.reason === 'customer-cancelled') out.status = 'cancelled';
    else out.reason = L.customerReason(row.failure_reason || '', row.method);
  }
  if (row.method === 'card' && row.status === 'started') {
    const o = (await P.svc('GET', 'orders?select=name,email,phone&id=eq.' + row.order_id))[0] || {};
    const w = L.widget(row.mode);
    const nm = firstLast(o.name);
    out.widget = { script: w.script, key: w.key, reference: row.tx_ref, email: o.email || '', amount: Number(row.amount),
                   currency: row.currency, label: s.general.businessName || 'Vaultique Boutique Point', channels: ['card'],
                   bearer: 'merchant', customer: { firstName: nm.firstName, lastName: nm.lastName, phone: o.phone || '' } };
    out.processor = 'Lenco';
  }
  if (row.method !== 'card' && row.network && L.NETWORKS[row.network]) {
    out.number = L.masked(row.phone);
    out.network = row.network;
    out.networkLabel = L.NETWORKS[row.network].label;
    out.retryAfter = Math.max(0, Math.round((L.HOLD.ms - (Date.now() - Date.parse(row.created_at || 0))) / 1000));
  }
  return out;
}

// ---- BUILD 88 · trying the same order again --------------------------------------------------
// After a mobile money payment failed (a wrong PIN, not enough money, not
// approved in time) or a card window was closed, the customer tries again on
// the same order: a new payment of its own, the earlier ones kept. Allowed only
// while the order is still waiting for its money and nobody at the shop has it,
// and never while an earlier request may still be on the customer's phone.
async function retry(event, body, s, mode, route, x) {
  const prevTx = String((body.retry && body.retry.txRef) || '');
  const restart = (error, code) => P.json(code || 409, { error, restart: true });
  if (!TX.test(prevTx)) return restart('That payment could not be read. Please start again.', 400);
  const prev = ((await P.svc('GET', 'payments?select=*&tx_ref=eq.' + enc(prevTx))) || [])[0];
  if (!prev || !prev.order_id) return restart('That payment could not be found. Please start again.');
  const order = ((await P.svc('GET', 'orders?select=*&id=eq.' + prev.order_id)) || [])[0];
  if (!order || order.payment_method !== 'online' || String(order.ref || '') !== refOf(prevTx)) {
    return restart('That order could not be found. Please start again.');
  }
  if (prev.mode !== mode) return restart('The shop has changed how it takes payments. Please start again.');
  // The same order is the same total: a page showing another figure starts again.
  if (P.changedSince(body.expect, Number(prev.amount))) {
    return restart('The total has changed since this order was placed. Please start again.');
  }
  if (order.pos_sale_id || order.pos_claim_id) return restart('This order is already with the shop. Please contact us about it.');
  if (!(Date.now() - Date.parse(order.created_at || 0) < DAY_MS)) return restart('This order is too old to pay for now. Please start again.');

  const all = (await P.svc('GET', 'payments?select=*&order_id=eq.' + order.id + '&order=created_at.desc&limit=20')) || [];
  // What became of the earlier tries, asked of Lenco now. NEVER TWO LIVE
  // REQUESTS FOR ONE ORDER: while an earlier one may still be approved (on
  // the customer's phone, or in a card's check with the bank), no new one is
  // sent, even after the customer pressed Cancel payment (Lenco's API cannot
  // withdraw a request already on a phone).
  const live = (q) => q.status === 'started' ||
    (q.status === 'failed' && q.detail && q.detail.reason === 'customer-cancelled' &&
     Date.now() - Date.parse(q.created_at || 0) < L.HOLD.ms);
  for (const p of all.filter(live).slice(0, 3)) {
    const st = await P.settle(p.tx_ref);
    if (st.status === 'paid' || st.status === 'review') {
      if (st.status === 'paid' && st.fresh && st.pay && st.pay.order_id) {
        await P.confirmByEmail(s, st.pay.order_id, st.pay.mode, st.late, st.pay.provider);
      }
      return P.json(200, Object.assign(await again(st.pay || p, s), { again: false, status: st.status }));
    }
    const age = Date.now() - Date.parse(p.created_at || 0);
    // Live: Lenco calls it pending or pay-offline, or could not be asked and
    // last said so. Not live: Lenco has nothing under the reference (no
    // request reached anybody), or has called it failed (final).
    const said = String(st.providerState || p.provider_status || '');
    const stillLive = !st.notFound && !st.final &&
      (st.status === 'pending' || ['pending', 'pay-offline', 'no-answer'].indexOf(said) > -1);
    if (stillLive && age < L.HOLD.ms) {
      const wait = Math.max(1, Math.ceil((L.HOLD.ms - age) / 1000));
      return P.json(409, { wait, txRef: p.tx_ref,
        error: p.method === 'card'
          ? 'Your previous card payment is still being processed. Please wait about ' + wait + ' seconds before trying again.'
          : 'Your previous payment request is still active. Please authorise it on your phone, or wait about ' + wait +
            ' seconds before trying again or choosing another payment method.' });
    }
  }
  const now = ((await P.svc('GET', 'orders?select=*&id=eq.' + order.id)) || [])[0] || order;
  if (now.payment_status === 'paid' || now.payment_status === 'review') {
    return P.json(200, { status: now.payment_status, ref: now.ref, txRef: now.pay_ref || prevTx, test: mode === 'test' });
  }
  const waiting = now.status === 'pending' && ['awaiting', 'failed', 'expired'].indexOf(now.payment_status) > -1;
  const lapsed = now.status === 'cancelled' && ['failed', 'expired'].indexOf(now.payment_status) > -1;
  if (!waiting && !lapsed) return restart('This order can no longer be paid for here. Please start again, or contact us.');
  if (all.length >= MAX_TRIES) {
    return P.json(429, { error: 'There have been several tries for this order. Please wait a while, or order on WhatsApp.' });
  }

  const digits = String(x.momo || now.phone || '').replace(/\D/g, '');
  const hourAgo = new Date(Date.now() - 3600000).toISOString();
  const mine = await P.svc('GET', 'payments?select=id&phone=eq.' + enc(digits) + '&created_at=gt.' + enc(hourAgo));
  if ((mine || []).length >= P.PER_PHONE_PER_HOUR) {
    return P.json(429, { error: 'There have been a lot of payment attempts. Please wait a little and try again.' });
  }

  const txRef = P.newTxRef(now.ref);
  const made = await P.svc('POST', 'payments', Object.assign({
    order_id: now.id, tx_ref: txRef, mode, amount: Number(prev.amount), currency: prev.currency, phone: digits,
    provider: 'lenco', method: x.method, channel: x.method === 'card' ? 'card' : 'mobile-money',
    network: x.network || null, client_key: x.attempt || null,
  }, x.cardRoute ? { detail: { card_route: x.cardRoute } } : {}));
  const pay = (made && made[0]) || { tx_ref: txRef, order_id: now.id };
  const set = await P.svc('PATCH', 'orders?id=eq.' + now.id + '&payment_status=in.(awaiting,failed,expired)&status=in.(pending,cancelled)',
    Object.assign({ payment_status: 'awaiting', pay_ref: txRef, updated_at: new Date().toISOString() }, lapsed ? { status: 'pending' } : {}));
  if (!(set && set.length)) {
    await P.failAttempt(pay, 'order moved on', { failure_reason: 'The order changed before this try could start.' }, { provider: 'lenco' });
    return restart('This order can no longer be paid for here. Please start again, or contact us.');
  }
  return P.json(200, await lencoStart({
    s, mode, method: x.method, pay, order: now, total: Number(prev.amount), currency: prev.currency,
    buyer: { name: now.name, email: now.email, phone: now.phone }, network: x.network, momo: x.momo,
  }));
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return P.json(405, { error: 'Use POST.' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return P.json(400, { error: 'That request could not be read.' }); }

  const b = body.buyer || {};
  const buyer = {
    name: cut(b.name, 120), phone: cut(b.phone, 40), email: cut(b.email, 160),
    address: cut(b.address, 400), notes: cut(b.notes, 600),
  };
  const fulfilment = body.fulfilment === 'collection' ? 'collection' : 'delivery';
  const method = ['mobile', 'card', 'bank'].indexOf(body.method) > -1 ? body.method : '';
  // A try on an order already placed carries the order's own details.
  if (!body.retry) {
    if (!buyer.name) return P.json(400, { error: 'Please fill in your name.', field: 'name' });
    if (buyer.phone.replace(/\D/g, '').length < 9) return P.json(400, { error: 'Please fill in your phone number.', field: 'phone' });
    if (!EMAIL.test(buyer.email)) return P.json(400, { error: 'Please fill in your email address, for your receipt.', field: 'email' });
    if (fulfilment === 'delivery' && !buyer.address) return P.json(400, { error: 'Please fill in your delivery address.', field: 'address' });
  }

  // What has been made so far, so that a failure part-way can undo it.
  let placed = null, pay = null, txRef = null;
  try {
    const s = await P.shopSettings();
    if (!P.onlineOn(s)) return P.json(403, { error: 'Online payment is switched off.', off: true });
    if (await P.closedFor(s.general, body.preview)) return P.json(403, { error: 'The shop is not taking orders at the moment.' });
    const mode = s.pay.onlineMode === 'live' ? 'live' : 'test';
    // BUILD 88 · the gateway that takes the way of paying chosen (_pay.js,
    // routes). A page from before build 88 chooses nothing, and goes the
    // Flutterwave way it always went, while Flutterwave takes everything.
    const r = P.serviceKey() ? P.routes(s, mode, await P.lencoDbReady()) : {};
    const route = method ? r[method] : P.legacyRoute(r);
    if (!route || !P.serviceKey()) {
      return P.json(503, method && P.serviceKey()
        ? { error: 'That way of paying is not available just now. Please choose another, or order on WhatsApp.',
            methods: P.publicMethods(r) }
        : { error: 'Online payment is not ready yet. Please order on WhatsApp for now.' });
    }
    // Build 77 (decision Q3): Test mode is the shop's own, not the public's.
    if (mode === 'test' && !(await P.testAllowed(event, body.preview))) {
      return P.json(403, { error: P.TEST_ONLY, off: true });
    }
    const viaLenco = route.provider === 'lenco';

    // BUILD 88 · mobile money through Lenco: the network and the number are
    // checked before anything is written or anybody's phone rings.
    let network = '', momo = '';
    if (viaLenco && method === 'mobile') {
      network = String(body.network || '').toLowerCase();
      const given = body.momo || buyer.phone;
      const problem = route.networks.indexOf(network) < 0 ? 'Please choose your mobile money network.' : L.numberProblem(network, given);
      if (problem) return P.json(400, { error: problem, field: 'momo' });
      momo = L.localNumber(given);
    }
    // BUILD 88 · one press of Pay is one payment, however often it arrives.
    const attempt = KEY.test(String(body.attempt || '')) ? String(body.attempt) : '';
    if (viaLenco && attempt) {
      const seen = await P.svc('GET', 'payments?select=*&client_key=eq.' + enc(attempt) + '&limit=1');
      if (seen && seen[0]) return P.json(200, await again(seen[0], s));
    }

    // The limits: this connection first, counted by the database (build
    // 77), then this phone and the shop.
    const client = P.clientAddr(event);
    if (client) {
      try {
        await P.svc('POST', 'rpc/throttle', { p_bucket: 'pay_start', p_key: client,
          p_max: P.PER_CONNECTION_PER_HOUR, p_window: '1 hour' }, 'return=minimal');
      } catch (e) {
        if (/Too many/.test(String(e && e.message))) {
          return P.json(429, { error: 'There have been a lot of payment attempts from here. Please wait a little and try again.' });
        }
        /* No throttle in the database yet (supabase-hardening.sql not
           run): the phone and shop limits below still apply. */
      }
    }
    // A card: Zambian or international, as the customer said (_cardroute.js).
    // Asked only once a second card gateway exists; today every card goes to
    // Lenco. Nothing about the card itself is ever sent here: every card
    // detail is typed in the gateway's own window.
    const issuer = method === 'card' && CR.CHOICES.indexOf(String(body.cardIssuer || '')) > -1 ? String(body.cardIssuer) : '';
    if (method === 'card' && route.needsChoice && !issuer) {
      return P.json(400, { error: 'Please choose where your card was issued.', field: 'cardIssuer' });
    }
    const cardRoute = issuer ? (function () {
      const c = CR.cardGateway(issuer, route.gateways);
      return { choice: c.choice, gateway: c.gateway, why: c.why };
    }()) : null;
    if (viaLenco && body.retry) {
      return await retry(event, body, s, mode, route, { method, network, momo, attempt, cardRoute });
    }
    if (!method && body.retry) return P.json(400, { error: 'That request could not be read.' });

    // Four questions at once, none waiting on another: tidy walked-away
    // attempts, count this hour's attempts (this phone's, and everybody's),
    // and price the order. One after the other they were most of the wait
    // between pressing Pay and seeing Flutterwave's page.
    const hourAgo = new Date(Date.now() - 3600000).toISOString();
    // BUILD 88 · for mobile money through Lenco, the number asked to pay: the
    // limit also keeps anybody from sending request after request to a phone.
    const digits = (momo || buyer.phone).replace(/\D/g, '');
    const town = String(body.town || '').trim().slice(0, 60);
    const [, mine, all, q] = await Promise.all([
      P.svc('POST', 'rpc/pay_expire_stale', {}, 'return=minimal').catch(() => {}),
      P.svc('GET', 'payments?select=id&phone=eq.' + encodeURIComponent(digits) + '&created_at=gt.' + encodeURIComponent(hourAgo)),
      P.svc('GET', 'payments?select=id&created_at=gt.' + encodeURIComponent(hourAgo)),
      P.priceOrder(s, body.items, fulfilment, body.preview, town),
    ]);
    if ((mine || []).length >= P.PER_PHONE_PER_HOUR || (all || []).length >= P.PER_SHOP_PER_HOUR) {
      return P.json(429, { error: 'There have been a lot of payment attempts. Please wait a little and try again.' });
    }
    if (q.problems) return P.json(409, { problems: q.problems, deliveryProblem: q.deliveryProblem });
    // The customer pressed "Pay K1,380" on a quote. If the price has moved
    // since (a promotion ending, a price changed at the till), nobody is
    // charged a figure they were not shown: they are shown the new one.
    if (P.changedSince(body.expect, q.total)) {
      return P.json(409, { changed: true, total: q.total, totalText: q.totalText,
        problems: ['The total has changed since you checked it: it is now ' + q.totalText + '. Please look at your order again before paying.'] });
    }
    // The town the fee was worked out for goes with the address, so the
    // shop and the courier read the same place the customer paid for.
    if (q.town && buyer.address.toLowerCase().indexOf(q.town.toLowerCase()) < 0) {
      buyer.address = (buyer.address + ', ' + q.town).slice(0, 400);
    }

    placed = await P.recordOrder(
      Object.assign({}, buyer, { fulfilment, total: q.total, currency: q.currency }),
      q.lines.map((l) => ({ sku: l.sku, name: l.name, price: l.unit, qty: l.qty })),
      body.preview, await P.customerFrom(event), P.clientAddr(event));

    txRef = P.newTxRef(placed.ref);
    // The payment row is written BEFORE the gateway is asked for anything:
    // money paid against a reference this site has no record of could
    // never be matched to its order. Both writes are waited for, even when
    // one fails, so that undoing them below finds them both.
    const [orderSet, payMade] = await Promise.allSettled([
      P.svc('PATCH', 'orders?id=eq.' + placed.id, {
        payment_method: 'online', payment_status: 'awaiting', pay_ref: txRef,
        goods_total: q.goods, delivery_fee: q.delivery, tax_total: q.tax,
      }, 'return=minimal'),
      P.svc('POST', 'payments', Object.assign({
        order_id: placed.id, tx_ref: txRef, mode, amount: q.total, currency: q.currency, phone: digits,
      }, viaLenco ? Object.assign({
        // BUILD 88 · the gateway, and the way of paying (supabase-lenco.sql)
        provider: 'lenco', method, channel: method === 'card' ? 'card' : 'mobile-money',
        network: network || null, client_key: attempt || null,
      }, cardRoute ? { detail: { card_route: cardRoute } } : {}) : {})),
    ]);
    pay = (payMade.status === 'fulfilled' && payMade.value && payMade.value[0]) || null;
    if (orderSet.status === 'rejected') throw orderSet.reason;
    if (payMade.status === 'rejected') throw payMade.reason;
    /* Build 76: the mode goes on the order itself, so a test payment can
       never pass for a real one in the Orders tab. Before
       supabase-hardening.sql has been run the column is not there, and
       that is no reason to stop a payment. */
    await P.svc('PATCH', 'orders?id=eq.' + placed.id, { pay_mode: mode }, 'return=minimal').catch(() => {});
    // BUILD 89 · the delivery instructions, onto the order (supabase-delivery.sql).
    if (fulfilment === 'delivery' && b.instructions) await P.saveInstructions(placed.id, b.instructions);

    if (viaLenco) {
      const started = await lencoStart({
        s, mode, method, pay: pay || { tx_ref: txRef, order_id: placed.id }, order: placed,
        total: q.total, currency: q.currency, buyer, network, momo,
      });
      placed = null;   // Lenco has its reference now: nothing below may undo the order
      return P.json(200, started);
    }

    const origin = P.siteOrigin(event);
    const shop = s.general.businessName || 'Vaultique Boutique Point';
    const made = await P.flw(mode, 'POST', '/payments', {
      tx_ref: txRef,
      amount: q.total,
      currency: q.currency,
      redirect_url: origin + '/payment-return',
      payment_options: P.flwOptions(r, method, s),
      customer: { email: buyer.email, phonenumber: buyer.phone, name: buyer.name },
      customizations: { title: shop, description: 'Order ' + placed.ref },
      meta: { order_ref: placed.ref },
    });
    const link = made.data && made.data.data && made.data.data.link;
    // Only ever a web page of Flutterwave's own: the customer's browser is
    // sent there, so nothing else is passed on (build 78).
    if (!made.ok || !/^https:\/\/[^\/\\\s]/i.test(String(link || ''))) {
      await P.abandon(placed, pay, 'could not open the payment page');
      return P.json(502, { error: 'The payment page could not be opened just now. Please try again, or order on WhatsApp.' });
    }
    return P.json(200, { link, ref: placed.ref, txRef, total: q.total, totalText: q.totalText });
  } catch (e) {
    const m = String(e && e.message || '');
    // Stopped after the order was made: it is cancelled now rather than
    // left "awaiting payment" for a payment page nobody was given.
    if (placed) {
      try { await P.abandon(placed, pay || (txRef ? { tx_ref: txRef } : null), 'stopped before the payment page: ' + m.slice(0, 120)); }
      catch (x) { /* the three-hour tidy-up will */ }
    }
    if (/not taking orders/.test(m)) return P.json(403, { error: 'The shop is not taking orders at the moment.' });
    if (/Too many/.test(m)) return P.json(429, { error: 'There have been a lot of orders just now. Please wait a little and try again.' });
    // BUILD 88 · the same press twice at the same moment: the other one made it.
    if (/23505|duplicate key|payments_client_key/i.test(m) && KEY.test(String(body.attempt || ''))) {
      try {
        const s2 = await P.shopSettings();
        const seen = await P.svc('GET', 'payments?select=*&client_key=eq.' + enc(String(body.attempt)) + '&limit=1');
        if (seen && seen[0]) return P.json(200, await again(seen[0], s2));
      } catch (x) { /* answered below */ }
    }
    return P.json(502, { error: 'Something went wrong starting the payment. Nothing has been charged. Please try again.' });
  }
};

exports._internals = { RETRY_GAP_MS, MAX_TRIES, HOLD: L.HOLD, lencoStart, again, retry };
