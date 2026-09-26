// =====================================================================
// ONLINE PAYMENT: the shared core behind pay-quote, pay-start,
// pay-webhook and pay-status.
//
// THE RULES THIS FILE EXISTS TO KEEP
//
//   1. The browser never says how much to charge. It says which pieces
//      and how many. The price is worked out here, from the same POS feed
//      the storefront shows (./products) and with the same price rules
//      (assets/formats.js, run here unchanged), so what is charged is what
//      the customer was shown.
//
//   2. Nothing is "paid" because somebody said so. Not the browser coming
//      back from Flutterwave, not a webhook on its own. Flutterwave is
//      asked directly, with the secret key, and the answer must name our
//      reference, our currency and at least our amount.
//
//   3. The secret keys live in Netlify's environment and nowhere else:
//        FLW_SECRET_KEY_TEST, FLW_SECRET_KEY_LIVE   from the Flutterwave dashboard
//        FLW_WEBHOOK_HASH                           the "secret hash" set there
//        SUPABASE_SERVICE_ROLE_KEY                  already used by the chat
//      None of them is ever sent to a browser.
//
//   4. Card details never come here at all. The customer types them into
//      Flutterwave's own page.
// =====================================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { settings, readConfig, rows } = require('./_seo-data');

const MAX_LINES = 50;
const MAX_QTY = 99;
const PER_PHONE_PER_HOUR = 5;
const PER_SHOP_PER_HOUR = 300;

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

// ---- assets/formats.js, run here exactly as the page runs it ----------
let FMT = null;
function formatsPaths() {
  const out = [];
  const add = (p) => { if (p && out.indexOf(p) < 0) out.push(p); };
  add(path.join(process.cwd(), 'assets', 'formats.js'));
  let dir = __dirname;
  for (let i = 0; i < 6 && dir; i++) {
    add(path.join(dir, 'assets', 'formats.js'));
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return out;
}
function formats() {
  if (FMT) return FMT;
  for (const p of formatsPaths()) {
    try {
      const src = fs.readFileSync(p, 'utf8');
      const sandbox = { window: {}, Intl, Date, Math, Number, String, isFinite, isNaN };
      vm.runInNewContext(src, sandbox, { filename: 'formats.js', timeout: 1000 });
      if (sandbox.window.VBP_FORMAT && sandbox.window.VBP_FORMAT.priceView) {
        FMT = sandbox.window.VBP_FORMAT;
        return FMT;
      }
    } catch (e) { /* try the next one */ }
  }
  throw new Error('assets/formats.js is not in the function bundle');
}

// ---- the settings, with the storefront's own defaults under them ------
// These must match the defaults in assets/app.js: a setting nobody has
// saved has to mean the same thing here as it does on the page.
const PRICING_DEFAULTS = {
  currencySymbol: '', currencyPosition: 'before', decimalPlaces: 'auto',
  taxMode: 'included', taxRate: 16, taxLabel: 'VAT',
  trackReductions: true, minReductionPercent: 5, reductionDays: 30,
  showSalePrice: true, showOriginalPrice: true, showDiscountPercent: true,
  onRequestEnabled: true, onRequestText: 'Price on request',
  promoEnabled: false, promoType: 'percent', promoAmount: '',
  promoScope: 'all', promoCategories: '', promoFrom: '', promoTo: '',
  overridesEnabled: false,
};
const PAY_DEFAULTS = {
  onlineEnabled: false, onlineMode: 'test', onlineCard: true, onlineMobile: true,
  onlineConfirmEmail: true, onlineNotifyShop: true,
};
const DELIVERY_DEFAULTS = {
  deliveryEnabled: true, pickupEnabled: true,
  standardFee: '', freeOver: '', payDelivery: false,
};

function over(defaults, got) {
  const out = Object.assign({}, defaults);
  Object.keys(got || {}).forEach((k) => {
    if (got[k] !== null && got[k] !== undefined) out[k] = got[k];
  });
  return out;
}

async function shopSettings() {
  const [general, pricing, payments, delivery, contact] = await Promise.all([
    settings('general'), settings('pricing'), settings('payments'),
    settings('delivery'), settings('contact'),
  ]);
  return {
    general: general || {},
    pricing: over(PRICING_DEFAULTS, pricing),
    pay: over(PAY_DEFAULTS, payments),
    delivery: over(DELIVERY_DEFAULTS, delivery),
    contact: contact || {},
  };
}

function shopClosed(general, preview) {
  const closed = general.maintenanceMode === true ||
    ['closed', 'coming-soon'].indexOf(general.websiteStatus || 'live') > -1;
  if (!closed) return false;
  const key = String(general.previewKey || '').trim();
  return !(key && String(preview || '').trim() === key);
}

function onlineOn(s) {
  return s.pay.onlineEnabled === true && (s.pay.onlineCard !== false || s.pay.onlineMobile !== false);
}

// ---- the catalogue: the POS feed, with the website's own rules on it ---
async function catalogue(preview) {
  const products = require('./products');
  const res = await products.handler({ queryStringParameters: preview ? { preview } : {}, headers: {} });
  const feed = JSON.parse(res.body || '{}');
  if (res.statusCode !== 200) throw new Error('The products could not be read just now.');
  return feed.products || [];
}

async function productMeta(skus) {
  if (!skus.length) return {};
  const list = skus.map((s) => '"' + String(s).replace(/["\\]/g, '') + '"').join(',');
  const got = await rows('product_meta',
    'select=sku,price_override,on_request,hidden,ref_price,ref_price_at&sku=in.(' + encodeURIComponent(list) + ')');
  const out = {};
  (got || []).forEach((m) => { if (m && m.sku) out[m.sku] = m; });
  return out;
}

// assets/app.js freshReduction(), the same rule.
function freshReduction(pricing, recordedAt) {
  if (pricing.trackReductions === false) return false;
  const days = Number(pricing.reductionDays);
  if (!isFinite(days) || days <= 0) return true;
  if (!recordedAt) return true;
  const t = new Date(recordedAt).getTime();
  if (isNaN(t)) return true;
  return (Date.now() - t) <= days * 86400000;
}

// assets/app.js mergeMeta(), the pricing half of it.
function withMeta(p, m, pricing) {
  const out = Object.assign({}, p);
  if (!m) return out;
  out.hidden = !!m.hidden;
  out.priceOnRequest = !!m.on_request;
  if (m.price_override !== null && m.price_override !== undefined && m.price_override !== '') {
    out.priceOverride = Number(m.price_override) || 0;
  }
  const ref = Number(m.ref_price);
  if (!(Number(out.wasPrice) > 0) && isFinite(ref) && ref > 0 && freshReduction(pricing, m.ref_price_at)) {
    out.wasPrice = ref;
  }
  return out;
}

// assets/app.js cartLimit(), the same rule.
function cartLimit(p) {
  const m = p ? Math.floor(Number(p.maxQty)) : NaN;
  if (!isFinite(m) || m < 1) return MAX_QTY;
  return m < MAX_QTY ? m : MAX_QTY;
}

const round2 = (n) => Math.round(n * 100) / 100;

function cleanItems(items) {
  if (!Array.isArray(items) || !items.length) return { error: 'There is nothing to pay for.' };
  if (items.length > MAX_LINES) return { error: 'That is too many different pieces for one payment.' };
  const seen = {};
  const out = [];
  for (const it of items) {
    const sku = String((it && it.sku) || '').trim();
    const qty = Math.floor(Number(it && it.qty));
    if (!sku || sku.length > 60) return { error: 'A piece in the order could not be read.' };
    if (!(qty >= 1 && qty <= MAX_QTY)) return { error: 'A quantity in the order could not be read.' };
    if (seen[sku]) { seen[sku].qty = Math.min(MAX_QTY, seen[sku].qty + qty); continue; }
    seen[sku] = { sku, qty };
    out.push(seen[sku]);
  }
  return { items: out };
}

// ---- delivery -----------------------------------------------------------
// THE ONE PLACE A DELIVERY FEE IS WORKED OUT for a payment. Two ways,
// chosen in Settings > Delivery:
//   'standard'  the one Standard delivery fee (free over "Free delivery over")
//   'zones'     the customer's town zone and the parcel's weight tier,
//               worked out by _delivery.js from the shop's own table
function deliveryCharge(s, fulfilment, goods, lines, town) {
  if (fulfilment !== 'delivery') return { fee: 0, included: true, note: '' };
  if (!s.delivery.payDelivery) {
    return { fee: 0, included: false, note: 'Delivery is charged separately, confirmed on WhatsApp.' };
  }
  if (s.delivery.feeMethod === 'zones') {
    const q = require('./_delivery').quote(s.delivery, { town, goods, lines });
    if (!q.ok) return { unavailable: true, code: q.code, message: q.message };
    return {
      fee: q.fee, included: true, note: q.free ? 'Free delivery' : '',
      town: q.town, label: 'Delivery to ' + q.town + ' \u00b7 ' + q.weightKg + ' kg',
    };
  }
  const fee = Number(s.delivery.standardFee);
  if (s.delivery.standardFee === '' || !isFinite(fee) || fee < 0) {
    return { unavailable: true, note: 'The delivery fee could not be worked out.' };
  }
  const free = Number(s.delivery.freeOver);
  if (s.delivery.freeOver !== '' && isFinite(free) && free > 0 && goods >= free) {
    return { fee: 0, included: true, note: 'Free delivery' };
  }
  return { fee: round2(fee), included: true, note: '' };
}

// ---- the price of an order, worked out here and nowhere else ----------
async function priceOrder(s, rawItems, fulfilment, preview, town) {
  const F = formats();
  const cleaned = cleanItems(rawItems);
  if (cleaned.error) return { problems: [cleaned.error] };
  const style = F.moneyStyle(s.general, s.pricing);
  const [feed, meta] = await Promise.all([
    catalogue(preview),
    productMeta(cleaned.items.map((i) => i.sku)),
  ]);
  const bySku = {};
  feed.forEach((p) => { bySku[p.sku] = p; });

  const problems = [];
  const lines = [];
  let goods = 0;
  cleaned.items.forEach((it) => {
    const base = bySku[it.sku];
    const p = base ? withMeta(base, meta[it.sku], s.pricing) : null;
    if (!p || p.hidden) { problems.push('A piece in your order is no longer on sale.'); return; }
    if (!p.available) { problems.push(p.name + ' has just sold out.'); return; }
    const limit = cartLimit(p);
    if (it.qty > limit) {
      problems.push('Only ' + limit + ' of ' + p.name + ' ' + (limit === 1 ? 'is' : 'are') + ' available.');
      return;
    }
    const v = F.priceView(p, s.pricing, style);
    if (v.onRequest || !(v.now > 0)) { problems.push(p.name + ' is priced on request, so it cannot be paid for online.'); return; }
    const total = round2(v.now * it.qty);
    goods = round2(goods + total);
    lines.push({ sku: p.sku, name: p.name, qty: it.qty, unit: v.now, total, weightKg: Number(p.weightKg) || 0 });
  });
  if (problems.length) return { problems };

  let tax = 0;
  const rate = Number(s.pricing.taxRate);
  if (s.pricing.taxMode === 'excluded' && isFinite(rate) && rate > 0) tax = round2(goods * rate / 100);

  const how = fulfilment === 'collection' ? 'collection' : 'delivery';
  const d = deliveryCharge(s, how, goods, lines, town);
  if (d.unavailable) {
    return {
      problems: [d.message || 'Online payment for delivery is not available just now. You can pay online if you collect, or order on WhatsApp.'],
      deliveryProblem: d.code || 'unavailable',
    };
  }
  const total = round2(goods + tax + (d.fee || 0));
  const money = (n) => F.money(n, style);
  return {
    currency: style.currency,
    // weightKg stays on the server: the customer is shown the parcel total only.
    lines: lines.map((l) => ({ sku: l.sku, name: l.name, qty: l.qty, unit: l.unit, total: l.total,
                              unitText: money(l.unit), totalText: money(l.total) })),
    goods, goodsText: money(goods),
    tax, taxText: tax ? money(tax) : '', taxLabel: tax ? (Math.round(rate * 100) / 100) + '% ' + (s.pricing.taxLabel || 'VAT') : '',
    delivery: d.fee || 0, deliveryText: d.included ? (d.fee ? money(d.fee) : (how === 'delivery' ? 'Free' : '')) : '',
    deliveryNote: d.note, deliveryLabel: d.label || '', town: d.town || '', fulfilment: how,
    total, totalText: money(total),
  };
}

// ---- the website's database, as the payment service ---------------------
function serviceKey() { return process.env.SUPABASE_SERVICE_ROLE_KEY || ''; }

async function svc(method, pathAndQuery, body, prefer) {
  const { url } = readConfig();
  const key = serviceKey();
  if (!url || !key) throw new Error('The payment service is not set up (SUPABASE_SERVICE_ROLE_KEY).');
  const res = await fetch(url.replace(/\/+$/, '') + '/rest/v1/' + pathAndQuery, {
    method,
    headers: {
      apikey: key, Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json', Accept: 'application/json',
      Prefer: prefer || 'return=representation',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error('database: ' + res.status + ' ' + text.slice(0, 200));
  return text ? JSON.parse(text) : null;
}

// ---- Flutterwave -----------------------------------------------------------
function flwKey(mode) {
  return mode === 'live' ? (process.env.FLW_SECRET_KEY_LIVE || '') : (process.env.FLW_SECRET_KEY_TEST || '');
}
function flwBase() { return (process.env.FLW_API_BASE || 'https://api.flutterwave.com/v3').replace(/\/+$/, ''); }

async function flw(mode, method, p, body) {
  const key = flwKey(mode);
  if (!key) throw new Error('No Flutterwave ' + mode + ' key is set.');
  const res = await fetch(flwBase() + p, {
    method,
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  return { ok: res.ok, status: res.status, data };
}

function paymentOptions(s) {
  const out = [];
  if (s.pay.onlineCard !== false) out.push('card');
  if (s.pay.onlineMobile !== false) out.push('mobilemoneyzambia');
  return out.join(', ');
}

function hashMatches(given) {
  const want = process.env.FLW_WEBHOOK_HASH || '';
  if (!want || !given) return false;
  const a = Buffer.from(String(given)), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function newTxRef(orderRef) {
  return orderRef + '-' + crypto.randomBytes(5).toString('hex');
}

// ---- settling a payment ------------------------------------------------------
// Asks Flutterwave, then records the answer. Safe to call any number of
// times for the same payment: only the first "paid" does anything.
async function settle(txRef, transactionId) {
  const found = await svc('GET', 'payments?tx_ref=eq.' + encodeURIComponent(txRef) + '&select=*');
  const pay = found && found[0];
  if (!pay) return { status: 'unknown' };
  if (pay.status === 'paid') return { status: 'paid', pay, fresh: false };
  // An attempt marked expired or failed is still asked about: money that
  // arrives late is still the customer's money, and still an order.

  const answer = transactionId && /^\d{1,20}$/.test(String(transactionId))
    ? await flw(pay.mode, 'GET', '/transactions/' + encodeURIComponent(transactionId) + '/verify')
    : await flw(pay.mode, 'GET', '/transactions/verify_by_reference?tx_ref=' + encodeURIComponent(txRef));
  const d = answer.data && answer.data.data;
  if (!answer.ok || !d) return { status: pay.status === 'failed' ? 'failed' : 'pending', pay };

  const ours = d.tx_ref === txRef &&
    String(d.currency || '').toUpperCase() === String(pay.currency || '').toUpperCase() &&
    Number(d.amount) >= Number(pay.amount) - 0.001;

  if (d.status === 'successful' && ours) {
    const now = new Date().toISOString();
    // Only the first writer gets a row back, so the emails go once.
    const won = await svc('PATCH', 'payments?tx_ref=eq.' + encodeURIComponent(txRef) + '&status=neq.paid', {
      status: 'paid', provider_tx_id: String(d.id || ''), channel: String(d.payment_type || ''),
      updated_at: now,
      detail: { flw_ref: d.flw_ref || '', amount: d.amount, charged: d.charged_amount, app_fee: d.app_fee },
    });
    if (!won || !won.length) return { status: 'paid', pay, fresh: false };
    if (pay.order_id) {
      // An order cancelled only because its payment had failed or expired
      // comes back to life. One the shop has moved along is left as it is.
      const was = await svc('GET', 'orders?id=eq.' + pay.order_id + '&select=status,payment_status');
      const revive = was && was[0] && was[0].status === 'cancelled' &&
                     ['failed', 'expired'].indexOf(was[0].payment_status) > -1;
      await svc('PATCH', 'orders?id=eq.' + pay.order_id, Object.assign({
        payment_status: 'paid', paid_amount: Number(d.amount), paid_at: now,
        pay_channel: String(d.payment_type || ''), updated_at: now,
      }, revive ? { status: 'pending' } : {}), 'return=minimal');
    }
    return { status: 'paid', pay: won[0], fresh: true };
  }

  if (d.status === 'successful' && !ours) {
    // Paid, but not what we asked for. Recorded for the shop to look at,
    // never marked as paid.
    await svc('PATCH', 'payments?tx_ref=eq.' + encodeURIComponent(txRef) + '&status=neq.paid', {
      detail: { mismatch: true, amount: d.amount, currency: d.currency, tx_ref: d.tx_ref },
      updated_at: new Date().toISOString(),
    }, 'return=minimal');
    return { status: 'pending', pay };
  }

  if (d.status === 'failed' || d.status === 'cancelled') {
    await failPayment(pay, d.status);
    return { status: 'failed', pay };
  }
  return { status: 'pending', pay };
}

async function failPayment(pay, why) {
  const now = new Date().toISOString();
  await svc('PATCH', 'payments?tx_ref=eq.' + encodeURIComponent(pay.tx_ref) + '&status=in.(started,expired)',
    { status: 'failed', updated_at: now, detail: { reason: why || 'failed' } }, 'return=minimal');
  if (pay.order_id) {
    await svc('PATCH', 'orders?id=eq.' + pay.order_id + '&payment_status=in.(awaiting,expired)',
      { payment_status: 'failed', status: 'cancelled', updated_at: now }, 'return=minimal');
  }
}

// ---- the confirmation email -------------------------------------------------
async function confirmByEmail(s, orderId) {
  try {
    const [pub, priv, orders, items] = await Promise.all([
      settings('notifications'),
      svc('GET', 'site_settings_private?key=eq.notifications&select=data'),
      svc('GET', 'orders?id=eq.' + orderId + '&select=*'),
      svc('GET', 'order_items?order_id=eq.' + orderId + '&select=name,qty,price'),
    ]);
    const n = pub || {};
    const secret = (priv && priv[0] && priv[0].data) || {};
    const o = orders && orders[0];
    if (!o || !n.emailEnabled || !n.smtpHost || !n.senderEmail) return { sent: 0 };

    const F = formats();
    const style = F.moneyStyle(s.general, s.pricing);
    const money = (v) => F.money(v, style);
    const shop = s.general.businessName || 'Vaultique Boutique Point';
    const list = (items || []).map((i) => '  ' + i.qty + ' \u00d7 ' + i.name + '  ' + money(Number(i.price) * i.qty)).join('\n');
    const parts = [
      'Order ' + o.ref,
      '',
      list,
      '',
      o.goods_total != null ? 'Items: ' + money(o.goods_total) : '',
      Number(o.tax_total) ? 'Tax: ' + money(o.tax_total) : '',
      Number(o.delivery_fee) ? 'Delivery: ' + money(o.delivery_fee) : '',
      'Paid: ' + money(o.paid_amount) + (o.pay_channel ? ' (' + (o.pay_channel === 'card' ? 'card' : 'mobile money') + ')' : ''),
      '',
      o.fulfilment === 'collection' ? 'You are collecting this order in person.' : (o.address ? 'Delivering to: ' + o.address : ''),
    ].filter((l, i, a) => l !== '' || (a[i - 1] !== '' && i > 0));

    const sendMail = require('./send-email')._internals.sendMail;
    const base = {
      smtpHost: n.smtpHost, smtpPort: n.smtpPort, encryption: n.encryption,
      smtpUser: n.smtpUser, smtpPassword: secret.smtpPassword,
      senderName: n.senderName || shop, senderEmail: n.senderEmail, replyTo: n.replyTo,
    };
    let sent = 0;
    if (s.pay.onlineConfirmEmail !== false && o.email) {
      try {
        await sendMail(Object.assign({}, base, {
          to: o.email,
          subject: 'Payment received \u2014 order ' + o.ref,
          text: 'Hello ' + (o.name || '') + ',\n\nThank you. We have received your payment.\n\n' +
                parts.join('\n') + '\n\nWe will be in touch about your order shortly.\n\n' + (n.signature || shop),
        }));
        sent++;
      } catch (e) { /* the payment stands whether or not the email goes */ }
    }
    const shopTo = s.contact.email || n.replyTo || n.senderEmail;
    if (s.pay.onlineNotifyShop !== false && shopTo) {
      try {
        await sendMail(Object.assign({}, base, {
          to: shopTo,
          subject: 'Paid online: order ' + o.ref + ' \u2014 ' + money(o.paid_amount),
          text: 'A customer has paid online.\n\n' + parts.join('\n') + '\n\n' +
                'Customer: ' + (o.name || '') + '\nPhone: ' + (o.phone || '') + '\nEmail: ' + (o.email || '') +
                (o.notes ? '\nNotes: ' + o.notes : '') + '\n\nOpen the Orders tab in your admin to confirm it.',
        }));
        sent++;
      } catch (e) { /* as above */ }
    }
    return { sent };
  } catch (e) {
    return { sent: 0, error: e.message };
  }
}

function siteOrigin(event) {
  const env = process.env.URL || '';
  if (env) return env.replace(/\/+$/, '');
  const h = (event && event.headers) || {};
  const host = h.host || h['x-forwarded-host'] || '';
  const proto = h['x-forwarded-proto'] || 'https';
  return host ? proto + '://' + host : '';
}

module.exports = {
  json, formats, shopSettings, shopClosed, onlineOn, priceOrder, cleanItems,
  deliveryCharge, svc, serviceKey, flw, flwKey, paymentOptions, hashMatches, newTxRef,
  settle, failPayment, confirmByEmail, siteOrigin,
  PER_PHONE_PER_HOUR, PER_SHOP_PER_HOUR,
};
