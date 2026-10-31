// Starts a payment: prices the order here, checks the stock, records the
// order (through the same place_order the WhatsApp checkout uses), and
// asks Flutterwave for its secure payment page. Returns that page's
// address for the browser to go to.
//
// POST { items, buyer: { name, phone, email, address, notes }, fulfilment, town, preview }
// Authorization: the signed-in customer's own token, when there is one,
// so the order lands in their account exactly as a WhatsApp order does.
// Since build 76 the token is checked with Supabase here and the order is
// written with the service key (P.recordOrder), the only key place_order
// now answers.
const P = require('./_pay');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cut(v, n) { return String(v == null ? '' : v).trim().slice(0, n); }

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
  if (!buyer.name) return P.json(400, { error: 'Please fill in your name.', field: 'name' });
  if (buyer.phone.replace(/\D/g, '').length < 9) return P.json(400, { error: 'Please fill in your phone number.', field: 'phone' });
  if (!EMAIL.test(buyer.email)) return P.json(400, { error: 'Please fill in your email address, for your receipt.', field: 'email' });
  if (fulfilment === 'delivery' && !buyer.address) return P.json(400, { error: 'Please fill in your delivery address.', field: 'address' });

  try {
    const s = await P.shopSettings();
    if (!P.onlineOn(s)) return P.json(403, { error: 'Online payment is switched off.', off: true });
    if (await P.closedFor(s.general, body.preview)) return P.json(403, { error: 'The shop is not taking orders at the moment.' });
    const mode = s.pay.onlineMode === 'live' ? 'live' : 'test';
    if (!P.flwKey(mode) || !P.serviceKey()) {
      return P.json(503, { error: 'Online payment is not ready yet. Please order on WhatsApp for now.' });
    }
    // Build 77 (decision Q3): Test mode is the shop's own, not the public's.
    if (mode === 'test' && !(await P.testAllowed(event, body.preview))) {
      return P.json(403, { error: P.TEST_ONLY, off: true });
    }

    // Tidy walked-away attempts, then the limits: this connection first,
    // counted by the database (build 77), then this phone and the shop.
    await P.svc('POST', 'rpc/pay_expire_stale', {}, 'return=minimal').catch(() => {});
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
    const hourAgo = new Date(Date.now() - 3600000).toISOString();
    const digits = buyer.phone.replace(/\D/g, '');
    const [mine, all] = await Promise.all([
      P.svc('GET', 'payments?select=id&phone=eq.' + encodeURIComponent(digits) + '&created_at=gt.' + encodeURIComponent(hourAgo)),
      P.svc('GET', 'payments?select=id&created_at=gt.' + encodeURIComponent(hourAgo)),
    ]);
    if ((mine || []).length >= P.PER_PHONE_PER_HOUR || (all || []).length >= P.PER_SHOP_PER_HOUR) {
      return P.json(429, { error: 'There have been a lot of payment attempts. Please wait a little and try again.' });
    }

    const town = String(body.town || '').trim().slice(0, 60);
    const q = await P.priceOrder(s, body.items, fulfilment, body.preview, town);
    if (q.problems) return P.json(409, { problems: q.problems, deliveryProblem: q.deliveryProblem });
    // The town the fee was worked out for goes with the address, so the
    // shop and the courier read the same place the customer paid for.
    if (q.town && buyer.address.toLowerCase().indexOf(q.town.toLowerCase()) < 0) {
      buyer.address = (buyer.address + ', ' + q.town).slice(0, 400);
    }

    const placed = await P.recordOrder(
      Object.assign({}, buyer, { fulfilment, total: q.total, currency: q.currency }),
      q.lines.map((l) => ({ sku: l.sku, name: l.name, price: l.unit, qty: l.qty })),
      body.preview, await P.customerFrom(event), P.clientAddr(event));

    const txRef = P.newTxRef(placed.ref);
    await P.svc('PATCH', 'orders?id=eq.' + placed.id, {
      payment_method: 'online', payment_status: 'awaiting', pay_ref: txRef,
      goods_total: q.goods, delivery_fee: q.delivery, tax_total: q.tax,
    }, 'return=minimal');
    /* Build 76: the mode goes on the order itself, so a test payment can
       never pass for a real one in the Orders tab. Before
       supabase-hardening.sql has been run the column is not there, and
       that is no reason to stop a payment. */
    await P.svc('PATCH', 'orders?id=eq.' + placed.id, { pay_mode: mode }, 'return=minimal').catch(() => {});
    const pay = (await P.svc('POST', 'payments', {
      order_id: placed.id, tx_ref: txRef, mode, amount: q.total, currency: q.currency, phone: digits,
    }))[0];

    const origin = P.siteOrigin(event);
    const shop = s.general.businessName || 'Vaultique Boutique Point';
    const made = await P.flw(mode, 'POST', '/payments', {
      tx_ref: txRef,
      amount: q.total,
      currency: q.currency,
      redirect_url: origin + '/payment-return',
      payment_options: P.paymentOptions(s),
      customer: { email: buyer.email, phonenumber: buyer.phone, name: buyer.name },
      customizations: { title: shop, description: 'Order ' + placed.ref },
      meta: { order_ref: placed.ref },
    });
    const link = made.data && made.data.data && made.data.data.link;
    // Only ever a web page of Flutterwave's own: the customer's browser is
    // sent there, so nothing else is passed on (build 78).
    if (!made.ok || !/^https:\/\/[^\/\\\s]/i.test(String(link || ''))) {
      await P.failPayment(pay, 'could not open the payment page');
      return P.json(502, { error: 'The payment page could not be opened just now. Please try again, or order on WhatsApp.' });
    }
    return P.json(200, { link, ref: placed.ref, txRef, total: q.total, totalText: q.totalText });
  } catch (e) {
    const m = String(e && e.message || '');
    if (/not taking orders/.test(m)) return P.json(403, { error: 'The shop is not taking orders at the moment.' });
    if (/Too many/.test(m)) return P.json(429, { error: 'There have been a lot of orders just now. Please wait a little and try again.' });
    return P.json(502, { error: 'Something went wrong starting the payment. Nothing has been charged. Please try again.' });
  }
};
