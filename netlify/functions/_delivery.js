// =====================================================================
// DELIVERY FEES BY TOWN ZONE AND PARCEL WEIGHT
//
// The courier charges a flat rate per parcel, set by two things only:
// which ZONE the customer's town is in, and which WEIGHT TIER the whole
// parcel falls into. No maps, no distance lookups. This file is the
// whole rule, as a pure function: no database, no network, so it can be
// tested line by line and cannot be slowed down by anything.
//
// Everything it works from is typed by the shop in Settings > Delivery
// and saved in the `delivery` settings row. Nothing about prices lives
// in the code.
//
// ---------------------------------------------------------------------
// THE SETTINGS IT READS (the data dictionary)
//
//   feeMethod        'standard'  the one Standard delivery fee (phase 1)
//                    'zones'     this file: town zone x weight tier
//
//   tierSmallMax     kg. A parcel up to and including this is SMALL.
//   tierMediumMax    kg. Over tierSmallMax, up to and including this, is
//                    MEDIUM. Anything heavier is LARGE.
//
//   zone1Name        what the shop calls the zone ("Local towns")
//   zone1Small       the fee for a small parcel to a town in zone 1
//   zone1Medium      ...a medium one
//   zone1Large       ...a large one
//   zone2...         the same four for zone 2
//   zone3...         the same four for zone 3
//
//   towns            [{ name: 'Kitwe', zone: 'zone2' }, ...]
//                    Every town a customer may choose at checkout, and
//                    the zone it belongs to. A town not in this list
//                    cannot be priced, and is never guessed at.
//
//   missingWeight    'block'    a piece with no weight in the POS stops
//                               delivery being priced online (the
//                               customer can still collect, or order
//                               on WhatsApp)
//                    'default'  such a piece counts as defaultWeight kg
//   defaultWeight    kg per piece, used only with missingWeight 'default'
//
//   surchargeEnabled true to add surchargeAmount once an order holds
//   surchargeItems   at least this many pieces in total (all lines)
//   surchargeAmount  the flat amount added
//
//   freeOver         (shared with the Standard fee) goods worth this much
//                    or more are delivered free; checked last
// ---------------------------------------------------------------------
'use strict';

const ZONES = ['zone1', 'zone2', 'zone3'];
const TIERS = ['Small', 'Medium', 'Large'];

const round2 = (n) => Math.round(n * 100) / 100;
const round3 = (n) => Math.round(n * 1000) / 1000;

// A figure the shop typed, or null when the box was left empty or holds
// something that is not a usable number. 0 is a real answer ("free").
function amount(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function key(town) {
  return String(town == null ? '' : town).trim().toLowerCase().replace(/\s+/g, ' ');
}

// The towns a customer may pick, in the shop's order, each once.
function towns(cfg) {
  const seen = {};
  const out = [];
  (Array.isArray(cfg && cfg.towns) ? cfg.towns : []).forEach((t) => {
    const name = String((t && t.name) || '').trim();
    const zone = t && t.zone;
    if (!name || ZONES.indexOf(zone) < 0 || seen[key(name)]) return;
    seen[key(name)] = true;
    out.push({ name, zone });
  });
  return out;
}

function zoneOf(cfg, town) {
  const want = key(town);
  if (!want) return null;
  return towns(cfg).find((t) => key(t.name) === want) || null;
}

function tierOf(cfg, kg) {
  const small = amount(cfg.tierSmallMax);
  const medium = amount(cfg.tierMediumMax);
  if (small === null || medium === null || !(small > 0) || !(medium > small)) return null;
  if (kg <= small) return 'Small';
  if (kg <= medium) return 'Medium';
  return 'Large';
}

// What the customer is told when an order cannot be priced for delivery.
// One sentence for every cause: the customer cannot fix the shop's
// settings, and a list of what is missing would be the shop's business.
const CANNOT = 'Delivery to your town cannot be priced online yet. ' +
               'You can collect in person, or order on WhatsApp and we will quote you.';

// ---------------------------------------------------------------------
// quote(cfg, order)
//
//   cfg    the delivery settings row (see above)
//   order  { town, goods, lines: [{ sku, name, qty, weightKg }] }
//
// Returns either
//   { ok: true, fee, zone, zoneName, tier, weightKg, surcharge, free, town }
// or
//   { ok: false, code, message, detail }
// where code is one of
//   'no-town'          no town was chosen
//   'unknown-town'     the town is not in the shop's list
//   'missing-weight'   a piece has no weight and the shop said to stop
//   'no-tiers'         the weight tiers are not set up
//   'unpriced'         the zone has no fee for this weight tier
// ---------------------------------------------------------------------
function quote(cfg, order) {
  cfg = cfg || {};
  order = order || {};
  const lines = Array.isArray(order.lines) ? order.lines : [];

  if (!key(order.town)) {
    return { ok: false, code: 'no-town', message: 'Please choose your town.' };
  }
  const place = zoneOf(cfg, order.town);
  if (!place) {
    return { ok: false, code: 'unknown-town', message: CANNOT, detail: String(order.town).slice(0, 60) };
  }

  // The parcel's weight: each piece's unit weight times how many.
  let kg = 0;
  let pieces = 0;
  const unweighed = [];
  const fallback = amount(cfg.defaultWeight);
  lines.forEach((l) => {
    const qty = Math.max(0, Math.floor(Number(l.qty) || 0));
    pieces += qty;
    let w = Number(l.weightKg);
    if (!(Number.isFinite(w) && w > 0)) {
      if (cfg.missingWeight === 'default' && fallback !== null && fallback > 0) {
        w = fallback;
      } else {
        unweighed.push(l.sku || l.name || '?');
        return;
      }
    }
    kg += w * qty;
  });
  if (unweighed.length) {
    return { ok: false, code: 'missing-weight', message: CANNOT, detail: unweighed.join(', ') };
  }
  kg = round3(kg);

  const tier = tierOf(cfg, kg);
  if (!tier) return { ok: false, code: 'no-tiers', message: CANNOT };

  const fee = amount(cfg[place.zone + tier]);
  if (fee === null) {
    return { ok: false, code: 'unpriced', message: CANNOT, detail: place.zone + tier };
  }

  let surcharge = 0;
  const atLeast = amount(cfg.surchargeItems);
  const extra = amount(cfg.surchargeAmount);
  if (cfg.surchargeEnabled && atLeast !== null && atLeast > 0 && extra !== null && pieces >= atLeast) {
    surcharge = extra;
  }

  let total = round2(fee + surcharge);
  let free = false;
  const freeOver = amount(cfg.freeOver);
  if (freeOver !== null && freeOver > 0 && Number(order.goods) >= freeOver) {
    total = 0;
    free = true;
  }

  return {
    ok: true,
    fee: total,
    zone: place.zone,
    zoneName: String(cfg[place.zone + 'Name'] || '').trim() || ('Zone ' + place.zone.slice(-1)),
    tier,
    weightKg: kg,
    surcharge,
    free,
    town: place.name,
  };
}

module.exports = { quote, towns, zoneOf, tierOf, ZONES, TIERS, CANNOT };
