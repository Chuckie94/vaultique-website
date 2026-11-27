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
//      reference, our currency and exactly our amount (build 77: more,
//      less or another currency "needs attention", and is never paid).
//
//   3. The secret keys live in Netlify's environment and nowhere else:
//        FLW_SECRET_KEY_TEST, FLW_SECRET_KEY_LIVE   from the Flutterwave dashboard
//        FLW_WEBHOOK_HASH                           the "secret hash" set there
//        SUPABASE_SERVICE_ROLE_KEY                  already used by the chat
//      None of them is ever sent to a browser.
//
//   4. Card details never come here at all. The customer types them into
//      Flutterwave's own page.
//
//   5. Money Flutterwave confirms always reaches its order, and the emails
//      about it go once. The order is switched to paid with a conditional
//      update (orderPaid), and only the call that made that switch sends
//      the emails, whichever of the return page, the webhook or the
//      check-up got there first. If the switch fails part-way, the payment
//      row still says paid and the check-up finishes the job.
//
//   6. Nobody has to come back for a payment to count. pay-reconcile.js
//      asks Flutterwave every fifteen minutes about every attempt of the
//      last three days that has not been heard back about (build 77: and
//      about the ones Flutterwave itself reported failed, because a
//      customer can try again on the same page and pay).
//
//   7. BUILD 77 · A piece paid for online is held until the till rings its
//      order up, or the order is completed or cancelled, for at most seven
//      days: a second customer is not charged for a piece the first one has
//      already paid for. The feed and the price rules are not touched; the
//      hold is worked out here, from this website's own orders.
//
//   (Build 81: refunds keep rules of their own, in _refund.js.)
//
//   8. BUILD 88 · MORE THAN ONE GATEWAY. Lenco (_lenco.js) is the primary
//      gateway for Zambia: mobile money (Airtel, MTN, Zamtel) by a prompt
//      on the customer's phone, and cards in Lenco's own payment window.
//      Flutterwave stays exactly as it was, switched on only by its own
//      setting (flwEnabled), for when its merchant account is approved.
//      Which gateway takes which way of paying is decided here (routes);
//      the customer chooses a way of paying, never a gateway. Every rule
//      above holds for both: the price is worked out here, nothing is paid
//      until the gateway itself says so, the keys stay in Netlify, and
//      card details never come here.
//
//   9. BUILD 88 · AN ORDER IS PAID ONCE. A customer whose mobile money
//      payment failed (a wrong PIN, not enough money) can try again on the
//      same order: each try is a payment of its own, none overwritten. If
//      two of them are ever both paid, the second is never counted: it
//      "needs attention", and the shop is told to refund it. The database
//      itself refuses a second paid payment for one order
//      (supabase-lenco.sql).
// =====================================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { settings, readConfig, rows, previewOk, serviceKey: siteServiceKey } = require('./_seo-data');

const MAX_LINES = 50;
const MAX_QTY = 99;
const PER_PHONE_PER_HOUR = 5;
// Build 77: one connection may start this many payments an hour, and the
// whole shop this many. The shop-wide figure is a backstop against a
// flood, not a working limit: at 300 anybody typing made-up phone numbers
// could switch online payment off for everybody for an hour (W-11).
const PER_CONNECTION_PER_HOUR = 8;
const PER_SHOP_PER_HOUR = 1000;
const HOLD_DAYS = 7;          // build 77: how long a piece paid for online is held at most
const ASK_GAP_MS = 5000;      // build 77: the status page asks Flutterwave about one payment at most this often

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
  // BUILD 88 · the gateways, each off until the shop switches it on. A
  // network or cards are offered through Lenco only once the shop has ticked
  // them as activated on its Lenco account: nothing is offered on trust.
  lencoEnabled: false, lencoAirtel: false, lencoMtn: false, lencoZamtel: false, lencoCard: false,
  flwEnabled: false,
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

function onlineOn(s) {
  return s.pay.onlineEnabled === true && (s.pay.onlineCard !== false || s.pay.onlineMobile !== false);
}

// ---- BUILD 88 · which gateway takes which way of paying -------------------------
// The customer is offered ways of paying, never a gateway: Mobile Money,
// Instant Bank Transfer, Debit / Credit Card. Each goes to the first gateway
// that is switched on, ready for the mode, and able to take it: Lenco first
// (the primary gateway for Zambia), then Flutterwave, only once the shop has
// switched it on (its merchant account approved). A way of paying no
// gateway can take is not offered at all.
//
//   via 'prompt'  Lenco: a request to the customer's phone (mobile money)
//   via 'window'  Lenco: Lenco's own payment window opens over the page (cards)
//   via 'page'    Flutterwave: the customer is sent to Flutterwave's page
//
// Instant Bank Transfer: neither gateway's API can take one today (Lenco's
// takes card and mobile money only), so it is never offered. Its place in
// the list is kept for a gateway that can.
const METHODS = ['mobile', 'bank', 'card'];
const METHOD_LABEL = { mobile: 'Mobile Money', bank: 'Instant Bank Transfer', card: 'Debit / Credit Card' };
const lenco = () => require('./_lenco');
function lencoNetworks(s) {
  const L = lenco();
  return L.NETWORK_KEYS.filter((k) => s.pay['lenco' + k.charAt(0).toUpperCase() + k.slice(1)] === true);
}
function shopCurrency(s) {
  try { return String(formats().moneyStyle(s.general, s.pricing).currency || '').toUpperCase(); }
  catch (e) { return String((s.general && s.general.currency) || 'ZMW').toUpperCase(); }
}
// dbReady: whether supabase-lenco.sql is in (lencoDbReady). Lenco keeps
// what it says in columns that file adds, so without it Lenco is not offered.
function routes(s, mode, dbReady) {
  const L = lenco();
  const out = {};
  const lencoOn = s.pay.lencoEnabled === true && dbReady === true && shopCurrency(s) === 'ZMW';
  const flwOn = s.pay.flwEnabled === true && !!flwKey(mode);
  if (s.pay.onlineMobile !== false) {
    const nets = lencoNetworks(s);
    if (lencoOn && nets.length && L.ready(mode, 'mobile')) out.mobile = { provider: 'lenco', via: 'prompt', networks: nets };
    else if (flwOn) out.mobile = { provider: 'flutterwave', via: 'page' };
  }
  if (s.pay.onlineCard !== false) {
    if (lencoOn && s.pay.lencoCard === true && L.ready(mode, 'card')) out.card = { provider: 'lenco', via: 'window' };
    else if (flwOn) out.card = { provider: 'flutterwave', via: 'page' };
    // Zambian or international (_cardroute.js): the gateway for cards issued
    // in Zambia, and the one for international cards, none until DPO is
    // connected. Only with both does the checkout ask which the card is.
    if (out.card) {
      out.card.gateways = { local: out.card.provider, international: null };
      out.card.needsChoice = require('./_cardroute').needsChoice(out.card.gateways);
    }
  }
  return out;
}
// What the page is told: the ways of paying on offer, in the order they are
// shown, with the networks for mobile money. Nothing about keys.
// processor: who takes the payment, named on the page under Mobile Money.
// Never for cards: a card's gateway is named only once its window opens,
// because with a second card gateway the customer's answer decides (Zambian
// or international, _cardroute.js). issuerChoice: whether to ask it.
const PROCESSOR = { lenco: 'Lenco' };
function publicMethods(r) {
  const L = lenco();
  return METHODS.filter((k) => r[k]).map((k) => Object.assign({
    key: k, label: METHOD_LABEL[k], via: r[k].via,
    networks: (r[k].networks || []).map((n) => ({ key: n, label: L.NETWORKS[n].label })),
  }, k === 'card' ? { issuerChoice: !!r[k].needsChoice }
     : (r[k].via === 'prompt' && PROCESSOR[r[k].provider] ? { processor: PROCESSOR[r[k].provider] } : {})));
}
// A page from before build 88 says no way of paying: it can only go the
// Flutterwave way it always went, and only while Flutterwave takes everything
// on offer. Otherwise it is asked to load the page again.
function legacyRoute(r) {
  const on = METHODS.filter((k) => r[k]);
  if (on.length && on.every((k) => r[k].provider === 'flutterwave')) return { provider: 'flutterwave', via: 'page' };
  return null;
}
// What Flutterwave's page offers for one payment: the way of paying chosen,
// or (a page with no choice) everything Flutterwave takes, as before build 88.
function flwOptions(r, method, s) {
  if (method === 'card') return 'card';
  if (method === 'mobile') return 'mobilemoneyzambia';
  const out = [];
  if (r.card && r.card.provider === 'flutterwave') out.push('card');
  if (r.mobile && r.mobile.provider === 'flutterwave') out.push('mobilemoneyzambia');
  return out.length ? out.join(', ') : paymentOptions(s);
}

// Whether supabase-lenco.sql has been run: one look for a column only it
// makes, asked with no rows, remembered for a minute.
let LENCO_DB = null, LENCO_DB_AT = 0;
async function lencoDbReady() {
  if (LENCO_DB !== null && Date.now() - LENCO_DB_AT < 60000) return LENCO_DB;
  if (!serviceKey()) return false;
  try {
    await svc('GET', 'payments?select=client_key,provider_ref,failure_reason,verified_at&limit=0');
    LENCO_DB = true;
  } catch (e) {
    LENCO_DB = /database: (400|404)/.test(String(e && e.message)) ? false : null;
  }
  LENCO_DB_AT = Date.now();
  return LENCO_DB === true;
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
  const skus = cleaned.items.map((i) => i.sku);
  const [feed, meta, held] = await Promise.all([
    catalogue(preview),
    productMeta(skus),
    heldPieces(skus),
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
    // BUILD 77 · Pieces already paid for online and not yet rung up,
    // completed or cancelled are not on offer again. Only where the feed
    // gives the real count (under MAX_QTY): a count capped at the ceiling
    // says nothing about how many are really left.
    const hold = (held && limit < MAX_QTY) ? Math.max(0, Math.floor(Number(held[it.sku]) || 0)) : 0;
    if (hold > 0 && it.qty > limit - hold) {
      const left = limit - hold;
      problems.push(left <= 0 ? p.name + ' has just sold out.'
        : 'Only ' + left + ' of ' + p.name + ' ' + (left === 1 ? 'is' : 'are') + ' available.');
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
// ---- BUILD 77 · pieces paid for online, held ------------------------------
// How many of each piece are already paid for online, on orders the till has
// not rung up and nobody has completed or cancelled, placed in the last
// HOLD_DAYS days. Read from this website's own orders with the service key.
// Anything that goes wrong here answers null, and the payment goes ahead
// exactly as it did before build 77: a hold that cannot be worked out never
// stops a sale.
async function heldPieces(skus) {
  if (!skus || !skus.length || !serviceKey()) return null;
  try {
    const since = new Date(Date.now() - HOLD_DAYS * 86400000).toISOString();
    // select=*: pos_sale_id exists only once supabase-pos-orders.sql has
    // been run, and naming a column that is not there would fail the read.
    const paid = await svc('GET', 'orders?select=*&payment_method=eq.online&payment_status=eq.paid' +
      '&created_at=gt.' + encodeURIComponent(since) + '&order=created_at.desc&limit=500');
    const open = (paid || []).filter((o) => o && o.id && !o.pos_sale_id &&
      ['cancelled', 'completed'].indexOf(String(o.status || '')) < 0);
    if (!open.length) return {};
    const items = await svc('GET', 'order_items?select=order_id,sku,qty&order_id=in.(' +
      open.map((o) => encodeURIComponent(o.id)).join(',') + ')');
    const want = {};
    skus.forEach((s) => { want[s] = true; });
    const out = {};
    (items || []).forEach((i) => {
      if (!i || !want[i.sku]) return;
      const q = Math.floor(Number(i.qty));
      out[i.sku] = (out[i.sku] || 0) + (q >= 1 ? q : 1);
    });
    return out;
  } catch (e) {
    return null;
  }
}

// ---- the website's database, as the payment service ---------------------
function serviceKey() { return siteServiceKey(); }   // either name (build 77, _seo-data.js)

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

function sameText(given, want) {
  const a = Buffer.from(String(given)), b = Buffer.from(String(want));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// The secret hash set in the Flutterwave dashboard, sent back as it is in
// the verif-hash header: how Flutterwave's webhooks prove where they came from.
function hashMatches(given) {
  const want = process.env.FLW_WEBHOOK_HASH || '';
  if (!want || !given) return false;
  return sameText(given, want);
}

// The same secret used the newer way: a flutterwave-signature header that
// is the request body signed with it (HMAC-SHA256). Either proves the
// sender knows the hash. Neither is believed on its own: settle() asks
// Flutterwave before anything is marked paid.
function signatureMatches(raw, given) {
  const want = process.env.FLW_WEBHOOK_HASH || '';
  if (!want || !given || !raw) return false;
  const mac = crypto.createHmac('sha256', want).update(String(raw)).digest();
  const g = String(given).trim();
  return sameText(g, mac.toString('base64')) || sameText(g, mac.toString('hex'));
}

// When Flutterwave last reached the webhook, and when something last
// reached it with the wrong secret, for the readiness line in
// Settings > Payments. Kept in the private settings table: the time is
// harmless, but the table is the payment service's, not the website's.
async function noteWebhook(kind) {
  const now = new Date().toISOString();
  const got = await svc('GET', 'site_settings_private?key=eq.pay-health&select=data');
  const data = Object.assign({}, (got && got[0] && got[0].data) || {});
  data[kind === 'refused' ? 'lastRefusedAt' : 'lastWebhookAt'] = now;
  await svc('POST', 'site_settings_private', { key: 'pay-health', data, updated_at: now },
    'resolution=merge-duplicates,return=minimal');
}
async function payHealth() {
  const got = await svc('GET', 'site_settings_private?key=eq.pay-health&select=data');
  return (got && got[0] && got[0].data) || {};
}
// BUILD 88 · the same record, for anything else worth the shop knowing: when
// Lenco last reached its webhook, when something reached it unsigned, the
// last error a gateway gave, and the fifteen-minute check-up's last run.
// Counts are kept as counts, so a flood of forged webhooks fills nothing.
async function noteHealth(patch, counts) {
  const now = new Date().toISOString();
  const got = await svc('GET', 'site_settings_private?key=eq.pay-health&select=data');
  const data = Object.assign({}, (got && got[0] && got[0].data) || {}, patch || {});
  Object.keys(counts || {}).forEach((k) => { data[k] = (Number(data[k]) || 0) + counts[k]; });
  await svc('POST', 'site_settings_private', { key: 'pay-health', data, updated_at: now },
    'resolution=merge-duplicates,return=minimal');
}
// A gateway's error, for Settings > Payments. Never a key: only what the
// gateway said, already cut short by its adapter.
function noteError(provider, message) {
  const at = new Date().toISOString();
  return noteHealth({ [provider + 'LastErrorAt']: at, [provider + 'LastError']: String(message || '').slice(0, 200) })
    .catch(() => {});
}

// Whether the person behind a sign-in token is one of the shop's
// administrators. Asked of the database with their own token, so the
// answer is the database's rule (is_admin) and not this file's opinion.
async function callerIsAdmin(token) {
  if (!token) return false;
  const { url, key } = readConfig();
  if (!url || !key) return false;
  try {
    const res = await fetch(url.replace(/\/+$/, '') + '/rest/v1/rpc/is_admin', {
      method: 'POST',
      headers: { apikey: key, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!res.ok) return false;
    return (await res.json()) === true;
  } catch (e) { return false; }
}

// Whether the price has moved since the customer was shown it. A page from
// before this check existed sends no figure, and is not refused for it.
function changedSince(expect, total) {
  if (expect === undefined || expect === null || expect === '') return false;
  const e = Number(expect);
  return !isFinite(e) || Math.abs(e - Number(total)) > 0.004;
}


function newTxRef(orderRef) {
  return orderRef + '-' + crypto.randomBytes(5).toString('hex');
}

// ---- settling a payment ------------------------------------------------------
// Asks Flutterwave, then records the answer. Safe to call any number of
// times for the same payment: only the first "paid" does anything.
// opts.pause (build 77, the status page only): see askedJustNow.
async function settle(txRef, transactionId, opts) {
  const found = await svc('GET', 'payments?tx_ref=eq.' + encodeURIComponent(txRef) + '&select=*');
  const pay = found && found[0];
  if (!pay) return { status: 'unknown' };
  if (pay.status === 'paid') {
    // Paid already. Its order is looked at too: the two rows are written
    // one after the other, and an order left "awaiting payment" by a
    // request that went missing in between would later be cancelled as
    // walked away from, with the money already taken. Whoever brings the
    // order up to date sends the emails (fresh), so they still go once.
    const caught = await orderPaid(pay, (pay.detail && pay.detail.amount) || pay.amount, pay.channel, pay.updated_at);
    return { status: 'paid', pay, fresh: !!caught, late: caught === 'late' };
  }
  // BUILD 77 · A payment that needs attention stays so, whatever else
  // Flutterwave says about this reference (a failed try, nothing at all),
  // unless it now names a payment that is exactly right: then it is paid
  // like any other, because that money is the order's.
  const review = pay.status === 'review' ? 'review' : null;

  // BUILD 77 · The status page asks Flutterwave about one payment at most
  // once every ASK_GAP_MS. In between it is told "pending" (never "failed":
  // a customer whose first try failed may be paying on a second one right
  // now), and the next ask that is let through gets the real answer. The
  // webhook and the check-up never pause.
  if (opts && opts.pause && await askedJustNow(pay)) return { status: review || 'pending', pay, paused: true };

  // An attempt marked expired or failed is still asked about: money that
  // arrives late is still the customer's money, and still an order.

  // BUILD 88 · The gateway the payment went to is the one asked: each knows
  // only its own references. A payment from before build 88 says
  // flutterwave (the column's default).
  const provider = String(pay.provider || 'flutterwave');
  if (provider === 'lenco') return settleLenco(pay, review);
  if (provider !== 'flutterwave') return { status: review || 'pending', pay };
  return settleFlutterwave(pay, txRef, transactionId, review);
}

// ---- Flutterwave's answer (unchanged since build 77, moved here in 88) -------
async function settleFlutterwave(pay, txRef, transactionId, review) {
  const answer = transactionId && /^\d{1,20}$/.test(String(transactionId))
    ? await flw(pay.mode, 'GET', '/transactions/' + encodeURIComponent(transactionId) + '/verify')
    : await flw(pay.mode, 'GET', '/transactions/verify_by_reference?tx_ref=' + encodeURIComponent(txRef));
  const d = answer.data && answer.data.data;
  if (!answer.ok || !d) return { status: review || (pay.status === 'failed' ? 'failed' : 'pending'), pay };

  // Flutterwave's answer is about this payment only if it names it. The
  // transaction id comes from the address the customer came back on, so
  // anybody can put another one there; whatever that transaction says, it
  // says nothing about this payment.
  const same = d.tx_ref === txRef;
  // BUILD 77 · Exactly the amount asked, to the ngwee (half a ngwee either
  // way for the arithmetic), in the currency asked. Until 76 anything at
  // least the amount counted; more is not "paid" either, it is a payment
  // somebody has to look at.
  const ours = same &&
    String(d.currency || '').toUpperCase() === String(pay.currency || '').toUpperCase() &&
    Math.abs(Number(d.amount) - Number(pay.amount)) < 0.005;

  if (d.status === 'successful' && ours) {
    const now = new Date().toISOString();
    const won = await svc('PATCH', 'payments?tx_ref=eq.' + encodeURIComponent(txRef) + '&status=neq.paid', {
      status: 'paid', provider_tx_id: String(d.id || ''), channel: String(d.payment_type || ''),
      updated_at: now,
      detail: { flw_ref: d.flw_ref || '', amount: d.amount, charged: d.charged_amount, app_fee: d.app_fee },
    });
    const row = (won && won[0]) || pay;
    // The emails go with the ORDER becoming paid, and only one request can
    // make that happen (orderPaid), so they go exactly once however many
    // webhooks, return visits and check-ups arrive together.
    const caught = await orderPaid(row, d.amount, d.payment_type, now);
    // late: the order had lapsed and been cancelled, and this brought it
    // back. Its piece may have sold since, so the shop is told (build 78).
    return { status: 'paid', pay: row, fresh: !!caught, late: caught === 'late' };
  }

  if (d.status === 'successful' && same) {
    // Paid, but not what we asked for: more, less, or another currency.
    // Never marked as paid. BUILD 77: no longer only noted in the payment
    // row for nobody to see, and left for the three-hour tidy-up to cancel
    // its order with the money taken. It "needs attention": the order stays
    // open, the shop is told once, and the Orders tab shows it.
    return needsAttention(pay, d);
  }

  if ((d.status === 'failed' || d.status === 'cancelled') && same) {
    // BUILD 77 · Money already came in against a payment under review:
    // a failed try on top of it is not "nothing was taken".
    if (review) return { status: 'review', pay };
    await failPayment(pay, d.status);
    return { status: 'failed', pay };
  }
  return { status: review || 'pending', pay };
}

// ---- BUILD 88 · Lenco's answer -----------------------------------------------------
// Lenco is asked about our reference (GET /collections/status/:reference)
// and its answer is held to the same rules as Flutterwave's: only Lenco's
// word, only about this reference, only exactly the amount and currency
// asked. Each answer is kept on the payment: when Lenco was last asked
// (verified_at), Lenco's own status, its references, and why it failed.
const encR = encodeURIComponent;
function lencoDetail(c, extra) {
  // A card's BIN (first six digits, as Lenco gives it beside the last four,
  // after the payment; never typed on this website) and whether a Zambian
  // bank issued it, once CARD_BINS_ZM is set: how many international cards
  // the shop gets (_cardroute.js).
  const card = c.cardBin ? { card_bin: c.cardBin.slice(0, 6), card_issuer: require('./_cardroute').issuerOf(c.cardBin) || null } : {};
  return Object.assign({
    provider: 'lenco', lenco_ref: c.lencoReference || '', lenco_id: c.id || '', amount: c.amount,
    fee: c.fee, type: c.type, operator: c.operator, operator_tx: c.operatorTxId, settlement: c.settlementStatus,
  }, card, extra || {});
}
// The customer's answer for a card (Zambian or international) and the
// gateway it chose, kept when the payment's record is written again; with
// the card's issuer from its BIN, whether the answer was right.
function keepRoute(pay, d) {
  const r = pay && pay.detail && pay.detail.card_route;
  if (!r) return d;
  const out = Object.assign({ card_route: r }, d);
  if (r.choice && out.card_issuer) out.card_choice_right = (r.choice === 'local') === (out.card_issuer === 'ZM');
  return out;
}
// What Lenco said about a payment still on its way: kept, but never a
// reason to change the payment. One write, and one that may fail quietly.
function touchLenco(pay, patch) {
  return svc('PATCH', 'payments?tx_ref=eq.' + encR(pay.tx_ref) + '&status=in.(started,expired)', patch, 'return=minimal')
    .catch(() => {});
}
async function settleLenco(pay, review) {
  const L = lenco();
  const txRef = pay.tx_ref;
  const now = new Date().toISOString();
  const stay = () => ({ status: review || (pay.status === 'failed' ? 'failed' : 'pending'), pay });
  const a = await L.ask(pay.mode, txRef);
  if (!a.answered) {
    await noteError('lenco', a.message);
    return stay();
  }
  if (a.notFound) {
    // Lenco has nothing under this reference: a card window opened and
    // closed without paying, or a prompt that never reached Lenco. Nothing
    // is decided on it; the three-hour tidy-up closes an attempt nobody paid.
    await touchLenco(pay, { verified_at: now, provider_status: 'not-found' });
    return Object.assign(stay(), { notFound: true });
  }
  const c = a.c;
  // Lenco's answer is about this payment only if it names it.
  if (c.reference !== txRef) return stay();
  const ours = c.currency === String(pay.currency || '').toUpperCase() &&
    Math.abs(Number(c.amount) - Number(pay.amount)) < 0.005;
  const said = { provider_tx_id: c.id || null, provider_ref: c.lencoReference || null, provider_status: c.status,
                 verified_at: now, provider_response: L.responseOf(c) };

  if (a.state === 'successful' && ours) {
    // Rule 9: an order already paid by another of its payments is not paid
    // again. This one is money the shop has to give back.
    const other = pay.order_id ? await svc('GET', 'payments?select=tx_ref&order_id=eq.' + pay.order_id +
      '&status=eq.paid&tx_ref=neq.' + encR(txRef) + '&limit=1') : [];
    if (other && other.length) return lencoAttention(pay, c, said, other[0].tx_ref);
    let won;
    try {
      won = await svc('PATCH', 'payments?tx_ref=eq.' + encR(txRef) + '&status=neq.paid', Object.assign({
        status: 'paid', channel: c.type || pay.channel || '', updated_at: now,
        confirmed_at: c.completedAt || now, failure_reason: null, detail: keepRoute(pay, lencoDetail(c)),
      }, said));
    } catch (e) {
      // The database's own lock (supabase-lenco.sql): another payment of this
      // order was marked paid at the same moment. That one stands.
      if (/23505|duplicate key|payments_one_paid/i.test(String(e && e.message))) {
        const first = await svc('GET', 'payments?select=tx_ref&order_id=eq.' + pay.order_id + '&status=eq.paid&limit=1');
        return lencoAttention(pay, c, said, (first && first[0] && first[0].tx_ref) || 'another payment');
      }
      throw e;
    }
    const row = (won && won[0]) || pay;
    const caught = await orderPaid(row, c.amount, c.type || pay.channel, now);
    return { status: 'paid', pay: row, fresh: !!caught, late: caught === 'late' };
  }
  if (a.state === 'successful') return lencoAttention(pay, c, said, null);   // paid, not what was asked
  if (a.state === 'failed') {
    if (review) return { status: 'review', pay };
    if (pay.status !== 'failed') {
      await failAttempt(pay, 'failed', Object.assign({ failure_reason: c.reason || 'failed' }, said),
                        { provider: 'lenco', why: c.reason || '', lenco_ref: c.lencoReference || '' });
    } else if (pay.provider_status !== 'failed') {
      // Closed here first (the customer pressed Cancel payment): Lenco's own
      // word is kept beside it, and ends the wait for a request still on the
      // phone. Why it was closed stays as it was.
      await svc('PATCH', 'payments?tx_ref=eq.' + encR(txRef) + '&status=eq.failed',
        Object.assign({ updated_at: now }, said, pay.failure_reason ? {} : { failure_reason: c.reason || 'failed' }),
        'return=minimal').catch(() => {});
    }
    // final: Lenco has decided; no request for this payment is live any more.
    return { status: 'failed', pay, reason: c.reason || pay.failure_reason || '', final: true };
  }
  await touchLenco(pay, said);
  return Object.assign(stay(), { providerState: c.status });
}

// BUILD 88 · An attempt that failed, for a gateway whose customer may try the
// same order again (Lenco). Its order is cancelled only if this attempt is the
// order's latest: a newer attempt already under way is left to finish.
async function failAttempt(pay, why, cols, detail) {
  const now = new Date().toISOString();
  await svc('PATCH', 'payments?tx_ref=eq.' + encR(pay.tx_ref) + '&status=in.(started,expired)',
    Object.assign({ status: 'failed', updated_at: now, detail: keepRoute(pay, Object.assign({ reason: why || 'failed' }, detail || {})) }, cols || {}),
    'return=minimal');
  if (pay.order_id) {
    await svc('PATCH', 'orders?id=eq.' + pay.order_id + '&pay_ref=eq.' + encR(pay.tx_ref) + '&payment_status=in.(awaiting,expired)',
      { payment_status: 'failed', status: 'cancelled', updated_at: now }, 'return=minimal');
  }
}

// BUILD 88 · Lenco says paid, but not as asked (dupOf empty: another amount
// or currency), or for an order another payment has already paid (dupOf: that
// payment). Never paid; the shop is told once, by whichever request makes the
// switch. A mismatch keeps its order open, as for Flutterwave; a second
// payment leaves its order paid by the first.
async function lencoAttention(pay, c, said, dupOf) {
  const now = new Date().toISOString();
  const got = await svc('PATCH', 'payments?tx_ref=eq.' + encR(pay.tx_ref) + '&status=in.(started,expired,failed)', Object.assign({
    status: 'review', channel: c.type || pay.channel || '', updated_at: now,
    detail: keepRoute(pay, lencoDetail(c, Object.assign({
      mismatch: !dupOf, expected: Number(pay.amount), expectedCurrency: pay.currency,
      currency: c.currency, tx_ref: c.reference,
    }, dupOf ? { duplicate: true, duplicateOf: dupOf } : {}))),
  }, said));
  const row = got && got[0];
  if (!row) return { status: 'review', pay, duplicate: !!dupOf };
  if (!dupOf) await orderNeedsAttention(row, now);
  try {
    await attentionEmail(await shopSettings(), row, {
      provider: 'lenco', amount: c.amount, currency: c.currency, payment_type: c.type,
      lenco_ref: c.lencoReference || '', duplicateOf: dupOf || '',
    });
  } catch (e) { /* the record stands whether or not the email goes */ }
  return { status: 'review', pay: row, fresh: true, duplicate: !!dupOf };
}

// The order a paid payment belongs to, marked paid if it is not already.
// An order cancelled only because its payment had failed or expired comes
// back to life; one the shop cancelled itself is left cancelled, now with
// the money showing against it so that it can be refunded.
//
// Answers whether THIS call is the one that marked it paid. The write only
// touches an order that is not paid yet, so of two requests racing, one
// gets the row back and the other gets nothing. 'late' when it was also
// the one that brought a lapsed order back (true otherwise, false if not).
async function orderPaid(pay, amount, channel, when) {
  if (!pay || !pay.order_id) return false;
  const was = await svc('GET', 'orders?id=eq.' + pay.order_id + '&select=status,payment_status');
  const o = was && was[0];
  if (!o || o.payment_status === 'paid') return false;
  const revive = o.status === 'cancelled' && ['failed', 'expired'].indexOf(o.payment_status) > -1;
  const now = new Date().toISOString();
  const notYet = o.payment_status == null ? '&payment_status=is.null' : '&payment_status=neq.paid';
  const rows = await svc('PATCH', 'orders?id=eq.' + pay.order_id + notYet, Object.assign({
    payment_status: 'paid', paid_amount: Number(amount), paid_at: when || now,
    pay_channel: String(channel || ''), updated_at: now,
  }, revive ? { status: 'pending' } : {}));
  if (!(rows && rows.length)) return false;
  return revive ? 'late' : true;
}

// ---- BUILD 77 · the status page, not asking too often ----------------------
// True when Flutterwave was asked about this payment by the status page less
// than ASK_GAP_MS ago, or when another ask has just claimed the next turn.
// The turn is claimed with a conditional write, so of two asks arriving
// together exactly one goes to Flutterwave. Without the asked_at column
// (supabase-payment-history.sql not run yet) nothing pauses, as in 76, and
// anything that goes wrong here lets the ask through rather than leaving a
// customer without an answer.
async function askedJustNow(pay) {
  if (!pay || !Object.prototype.hasOwnProperty.call(pay, 'asked_at')) return false;
  const now = Date.now();
  const last = pay.asked_at ? new Date(pay.asked_at).getTime() : NaN;
  if (isFinite(last) && now - last < ASK_GAP_MS) return true;
  const turn = pay.asked_at
    ? '&asked_at=lt.' + encodeURIComponent(new Date(now - ASK_GAP_MS).toISOString())
    : '&asked_at=is.null';
  try {
    const won = await svc('PATCH', 'payments?tx_ref=eq.' + encodeURIComponent(pay.tx_ref) + turn,
      { asked_at: new Date(now).toISOString() });
    return !(won && won.length);
  } catch (e) {
    return false;
  }
}

// ---- BUILD 77 · a payment that needs attention -----------------------------
// Flutterwave says it was paid, for this reference, but not the amount or
// the currency asked. The payment is marked "review" by a conditional write
// (only an attempt not paid and not already under review), so of several
// webhooks, return visits and check-ups exactly one makes the switch, and
// only that one tells the shop. The order is marked to match and stays open:
// one cancelled only because its payment had failed or expired comes back,
// one the shop cancelled itself stays cancelled. Nothing here ever marks
// anything paid.
async function needsAttention(pay, d) {
  const now = new Date().toISOString();
  const got = await svc('PATCH', 'payments?tx_ref=eq.' + encodeURIComponent(pay.tx_ref) + '&status=in.(started,expired,failed)', {
    status: 'review', provider_tx_id: String(d.id || ''), channel: String(d.payment_type || ''), updated_at: now,
    detail: {
      mismatch: true, expected: Number(pay.amount), expectedCurrency: pay.currency,
      amount: d.amount, currency: d.currency, charged: d.charged_amount, app_fee: d.app_fee,
      flw_ref: d.flw_ref || '', tx_ref: d.tx_ref,
    },
  });
  const row = got && got[0];
  if (!row) return { status: 'review', pay };
  await orderNeedsAttention(row, now);
  try {
    await attentionEmail(await shopSettings(), row, d);
  } catch (e) { /* the record stands whether or not the email goes */ }
  return { status: 'review', pay: row, fresh: true };
}

async function orderNeedsAttention(pay, now) {
  if (!pay || !pay.order_id) return false;
  const was = await svc('GET', 'orders?id=eq.' + pay.order_id + '&select=status,payment_status');
  const o = was && was[0];
  if (!o || o.payment_status === 'paid' || o.payment_status === 'review') return false;
  const revive = o.status === 'cancelled' && ['failed', 'expired'].indexOf(o.payment_status) > -1;
  const notYet = o.payment_status == null ? '&payment_status=is.null' : '&payment_status=in.(awaiting,expired,failed)';
  const rows = await svc('PATCH', 'orders?id=eq.' + pay.order_id + notYet,
    Object.assign({ payment_status: 'review', updated_at: now }, revive ? { status: 'pending' } : {}));
  return !!(rows && rows.length);
}

// One email to the shop, whatever the notification settings say about paid
// orders: this is money somebody has to look at, not news of a sale. Sent
// from the shop's own account, read the one way every function reads it
// (_mail.js, build 77). A test payment says so (build 77, W-04).
async function attentionEmail(s, pay, d) {
  const M = require('./_mail');
  const [account, orders] = await Promise.all([
    M.mailAccount(),
    pay.order_id ? svc('GET', 'orders?id=eq.' + pay.order_id + '&select=*') : Promise.resolve([]),
  ]);
  const n = account.pub;
  const o = (orders && orders[0]) || {};
  if (!account.ready) return { sent: 0 };
  const shopTo = s.contact.email || n.replyTo || n.senderEmail;
  if (!shopTo) return { sent: 0 };
  const test = pay.mode === 'test' || o.pay_mode === 'test';
  const F = formats();
  const style = F.moneyStyle(s.general, s.pricing);
  const money = (v) => F.money(v, style);
  const sameCurrency = String(d.currency || '').toUpperCase() === String(pay.currency || '').toUpperCase();
  const got = sameCurrency ? money(Number(d.amount)) : String(d.currency || '?') + ' ' + d.amount;
  const how = d.payment_type ? ' (' + (d.payment_type === 'card' ? 'card' : 'mobile money') + ')' : '';
  const ref = o.ref || String(pay.tx_ref || '').split('-').slice(0, 2).join('-');
  const shop = s.general.businessName || 'Vaultique Boutique Point';
  // BUILD 88 · the gateway the payment went through; Flutterwave's words are
  // exactly as they were.
  const gw = d.provider === 'lenco' ? 'Lenco' : 'Flutterwave';
  const twice = !!d.duplicateOf;
  const sendMail = require('./send-email')._internals.sendMail;
  await sendMail(Object.assign(M.accountConfig(account), {
    senderName: n.senderName || shop,
    to: shopTo,
    subject: (test ? '[TEST] ' : '') + (twice ? 'Paid twice, refund one: order ' : 'Payment needs attention: order ') + ref,
    text: (test ? 'A TEST payment, made in Test mode: no money moved.\n\n' : '') +
      (twice ? 'A second payment came in for order ' + ref + ', which another payment had already paid.\n\n'
             : 'A payment came in for order ' + ref + ', but it does not match the order.\n\n') +
      'The order: ' + money(Number(pay.amount)) + '\n' +
      'Received: ' + got + how + '\n' +
      (d.flw_ref ? 'Flutterwave reference: ' + d.flw_ref + '\n' : '') +
      (d.lenco_ref ? 'Lenco reference: ' + d.lenco_ref + '\n' : '') +
      'Our reference: ' + pay.tx_ref + '\n' +
      (twice ? 'The payment that paid the order: ' + d.duplicateOf + '\n' : '') + '\n' +
      (twice ? 'The order is paid once and counted once. This second payment is not counted anywhere: ' +
               'refund it to the customer from your ' + gw + ' account, then let them know.\n\n'
             : 'Nothing has been marked paid, and the order stays open. Check the payment in your ' +
               gw + ' dashboard, then contact the customer.\n\n') +
      'Customer: ' + (o.name || '') + '\nPhone: ' + (o.phone || '') + '\nEmail: ' + (o.email || ''),
  }));
  return { sent: 1 };
}

// A payment started here that could not be finished here. Its attempt is
// marked failed and its order cancelled straight away, rather than sitting
// in the Orders tab "awaiting payment" until the three-hour tidy-up. The
// order was made moments ago by this same request, so nothing else can
// have moved it on.
async function abandon(placed, pay, why) {
  const now = new Date().toISOString();
  if (pay && pay.tx_ref) {
    await svc('PATCH', 'payments?tx_ref=eq.' + encodeURIComponent(pay.tx_ref) + '&status=eq.started',
      { status: 'failed', updated_at: now, detail: { reason: why || 'failed' } }, 'return=minimal');
  }
  if (placed && placed.id) {
    await svc('PATCH', 'orders?id=eq.' + placed.id,
      { payment_method: 'online', payment_status: 'failed', status: 'cancelled', updated_at: now }, 'return=minimal');
  }
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
// mode is the payment's own ('test' or 'live'). A test payment says so in
// both subjects and never calls itself paid (build 77, W-04): no money
// moved, and an email that said otherwise could be forwarded as proof.
async function confirmByEmail(s, orderId, mode, late, provider) {
  // BUILD 88 · the gateway the payment went through, for the shop's email.
  // Not given (Flutterwave's callers): Flutterwave, word for word as before.
  const gw = provider === 'lenco' ? 'Lenco' : 'Flutterwave';
  const gwTest = provider === 'lenco' ? 'Lenco\'s sandbox cards and numbers were used'
                                      : 'Flutterwave\'s test cards and numbers were used';
  try {
    // The shop's email account, read the one way every function reads it
    // (_mail.js): since build 77 the password is in a row only the server
    // can read.
    const M = require('./_mail');
    const [account, orders, items] = await Promise.all([
      M.mailAccount(),
      svc('GET', 'orders?id=eq.' + orderId + '&select=*'),
      svc('GET', 'order_items?order_id=eq.' + orderId + '&select=name,qty,price'),
    ]);
    const n = account.pub;
    const o = orders && orders[0];
    if (!o || !account.ready) return { sent: 0 };
    const test = mode === 'test' || o.pay_mode === 'test';

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
      (test ? 'TEST payment, no money taken: ' : 'Paid: ') + money(o.paid_amount) +
        (o.pay_channel ? ' (' + (o.pay_channel === 'card' ? 'card' : 'mobile money') + ')' : ''),
      '',
      o.fulfilment === 'collection' ? 'You are collecting this order in person.' : (o.address ? 'Delivering to: ' + o.address : ''),
    ].filter((l, i, a) => l !== '' || (a[i - 1] !== '' && i > 0));

    const sendMail = require('./send-email')._internals.sendMail;
    const base = Object.assign(M.accountConfig(account), { senderName: n.senderName || shop });
    let sent = 0;
    if (s.pay.onlineConfirmEmail !== false && o.email) {
      try {
        await sendMail(Object.assign({}, base, {
          to: o.email,
          subject: test ? '[TEST] Test payment \u2014 order ' + o.ref + ', no money taken'
                        : 'Payment received \u2014 order ' + o.ref,
          text: 'Hello ' + (o.name || '') + ',\n\n' +
                (test ? 'This was a TEST payment, made while the shop was testing online payment. ' +
                        'No money was taken, and this is not a receipt.'
                      : 'Thank you. We have received your payment.') + '\n\n' +
                parts.join('\n') + '\n\n' +
                (test ? '' : 'We will be in touch about your order shortly.\n\n') + (n.signature || shop),
        }));
        sent++;
      } catch (e) { /* the payment stands whether or not the email goes */ }
    }
    const shopTo = s.contact.email || n.replyTo || n.senderEmail;
    if (s.pay.onlineNotifyShop !== false && shopTo) {
      try {
        await sendMail(Object.assign({}, base, {
          to: shopTo,
          subject: (late ? '[CHECK STOCK] ' : '') +
                   (test ? '[TEST] Test payment: order ' + o.ref + ' \u2014 no money moved'
                         : 'Paid online: order ' + o.ref + ' \u2014 ' + money(o.paid_amount)),
          text: (late ? 'PAID LATE. This payment arrived after the payment window had closed, when the order ' +
                        'had already been cancelled for not being paid, and it has brought the order back. ' +
                        'Nothing was set aside for it meanwhile, so the piece may have sold since: check it is ' +
                        'still there before you confirm the order, and if it is not, refund the customer from ' +
                        'your ' + gw + (gw === 'Lenco' ? ' account' : ' dashboard') + '.\n\n' : '') +
                (test ? 'A TEST payment was made on the website, in Test mode. No money moved: ' + gwTest +
                        '. The order is marked TEST in the Orders tab.'
                      : 'A customer has paid online.') + '\n\n' + parts.join('\n') + '\n\n' +
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

// ---- build 76: the things the database now decides ----------------------

// Closed to this caller: closed, unless the preview key is right. Since
// build 76 the key is checked by the database (_seo-data.previewOk), not
// compared here, because it is no longer in the public settings.
async function closedFor(general, preview) {
  const closed = general.maintenanceMode === true ||
    ['closed', 'coming-soon'].indexOf(general.websiteStatus || 'live') > -1;
  if (!closed) return false;
  return !(await previewOk(preview));
}

// A WhatsApp order, priced here (decision Q2). The same catalogue and price
// rules as a payment, but a WhatsApp order is the start of a conversation,
// not a charge, so nothing is refused: a piece priced on request, sold out
// since, or no longer on sale is recorded as asked for, without a price, for
// the shop to settle in the chat. The total is what the storefront calls
// the order's total (orderTotal() in assets/app.js): the priced pieces times
// their quantities, nothing else. The browser's own prices are not asked for.
async function priceWhatsApp(s, rawItems, preview) {
  const F = formats();
  if (!Array.isArray(rawItems) || !rawItems.length) return { error: 'There is nothing in the order.' };
  if (rawItems.length > MAX_LINES) return { error: 'That is too many different pieces for one order.' };
  const items = [];
  for (const it of rawItems) {
    const sku = String((it && it.sku) || '').trim();
    const qty = Math.floor(Number(it && it.qty));
    if (!sku || sku.length > 60) return { error: 'A piece in the order could not be read.' };
    if (!(qty >= 1 && qty <= MAX_QTY)) return { error: 'A quantity in the order could not be read.' };
    items.push({ sku, qty, asked: String((it && it.name) || '').trim().slice(0, 200) });
  }
  const style = F.moneyStyle(s.general, s.pricing);
  const [feed, meta] = await Promise.all([
    catalogue(preview).catch(() => []),
    productMeta(items.map((i) => i.sku)).catch(() => ({})),
  ]);
  const bySku = {};
  feed.forEach((p) => { bySku[p.sku] = p; });
  let total = 0;
  const lines = items.map((it) => {
    const base = bySku[it.sku];
    const p = base ? withMeta(base, meta[it.sku], s.pricing) : null;
    if (!p || p.hidden) return { sku: it.sku, name: it.asked || it.sku, price: null, qty: it.qty };
    const v = F.priceView(p, s.pricing, style);
    const unit = (v.onRequest || !(v.now > 0)) ? null : v.now;
    if (unit !== null) total = round2(total + unit * it.qty);
    return { sku: p.sku, name: p.name, price: unit, qty: it.qty };
  });
  return { lines, total, currency: style.currency };
}

// Who is signed in, asked of Supabase itself with the token the browser
// sent: a browser can say anything about who it is. A token that does not
// check out is a guest.
async function customerFrom(event) {
  const h = (event && event.headers) || {};
  const bearer = String(h.authorization || h.Authorization || '').replace(/^Bearer\s+/i, '').trim();
  const { url, key } = readConfig();
  if (!bearer || !url || !key || bearer === key) return null;
  try {
    const res = await fetch(url.replace(/\/+$/, '') + '/auth/v1/user', {
      headers: { apikey: key, Authorization: 'Bearer ' + bearer },
    });
    if (!res.ok) return null;
    const u = await res.json();
    return (u && u.id) || null;
  } catch (e) {
    return null;
  }
}

// ---- build 77: who may use Test mode (decision Q3) --------------------------
// In Test mode anybody could "pay" with the test cards Flutterwave
// publishes and be sent a paid-looking confirmation. On the live site it
// is for the shop alone: whoever holds the preview key, or the owner,
// signed in with two-factor.
function claimsOf(token) {
  try {
    return JSON.parse(Buffer.from(String(token || '').split('.')[1] || '', 'base64url').toString('utf8')) || {};
  } catch (e) { return {}; }
}
async function ownerFrom(event) {
  const h = (event && event.headers) || {};
  const bearer = String(h.authorization || h.Authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!bearer || !serviceKey()) return false;
  // The token is checked with Supabase first, so what it says can be read.
  const id = await customerFrom(event);
  if (!id || claimsOf(bearer).aal !== 'aal2') return false;
  try {
    const r = await svc('GET', 'admins?id=eq.' + encodeURIComponent(id) + '&role=eq.owner&select=id');
    return !!(r && r.length);
  } catch (e) { return false; }
}
async function testAllowed(event, preview) {
  if (await previewOk(preview)) return true;
  return ownerFrom(event);
}
const TEST_ONLY = 'Paying online is not available just now. Please order on WhatsApp instead.';

// The visitor's address as Netlify saw it, for the database's throttle.
function clientAddr(event) {
  const h = (event && event.headers) || {};
  const v = h['x-nf-client-connection-ip'] || String(h['x-forwarded-for'] || '').split(',')[0];
  return String(v || '').trim().slice(0, 64) || null;
}

// The order, written by the database's place_order with the service key,
// the only key it now answers. On a database where supabase-hardening.sql
// has not been run yet, place_order still has its old three-part form, and
// that is used instead, so no order is lost to the order things were done
// in. The old form cannot be told who the customer was; such an order is
// filed as a guest's until the SQL is run.
async function recordOrder(order, items, preview, customer, client) {
  try {
    return await svc('POST', 'rpc/place_order', {
      p_order: order, p_items: items, p_preview: preview || null,
      p_customer: customer || null, p_client: client || null,
    });
  } catch (e) {
    if (!/PGRST202|Could not find the function/i.test(String(e && e.message))) throw e;
    return svc('POST', 'rpc/place_order', { p_order: order, p_items: items, p_preview: preview || null });
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
  json, formats, shopSettings, onlineOn, priceOrder, cleanItems,
  deliveryCharge, svc, serviceKey, flw, flwKey, flwBase, paymentOptions, hashMatches, newTxRef,
  settle, failPayment, confirmByEmail, siteOrigin,
  previewOk, closedFor, priceWhatsApp, customerFrom, clientAddr, recordOrder,
  testAllowed, ownerFrom, TEST_ONLY,
  signatureMatches, noteWebhook, payHealth, callerIsAdmin, changedSince,
  orderPaid, abandon, heldPieces, askedJustNow, needsAttention, attentionEmail,
  PER_PHONE_PER_HOUR, PER_CONNECTION_PER_HOUR, PER_SHOP_PER_HOUR, HOLD_DAYS, ASK_GAP_MS,
  // build 88
  METHODS, METHOD_LABEL, routes, publicMethods, legacyRoute, flwOptions, lencoNetworks, shopCurrency,
  lencoDbReady, noteHealth, noteError, settleLenco, failAttempt, lencoAttention, touchLenco,
  _resetLencoDb: () => { LENCO_DB = null; LENCO_DB_AT = 0; },
};
