// Vaultique Boutique Point — server-side product feed
// ---------------------------------------------------------------------------
// This function is the ONLY thing that ever talks to the POS Supabase project.
// It runs on the server (Netlify), so the POS read key NEVER reaches a browser.
// It reads the live POS `app_state` row READ-ONLY over the REST API, extracts
// ONLY the public product fields, and returns them. It performs no writes,
// no schema changes, and no security changes to the POS. The live till is
// completely untouched.
// ---------------------------------------------------------------------------

// POS connection. These are the POS's own PUBLIC read key and URL.
// They are kept server-side only. You may override them with Netlify
// environment variables (Site settings > Environment variables) named
// POS_SUPABASE_URL and POS_SUPABASE_KEY for cleaner separation.
const POS_URL =
  process.env.POS_SUPABASE_URL || 'https://xbrchpxdmptwuvivdiqj.supabase.co';
const POS_KEY =
  process.env.POS_SUPABASE_KEY ||
  'sb_publishable_wj1gGEwOnLu_HlBRkbeZvA_tCHEk1vR';

// WHICH ROW THE SHOP'S LIVE DATA IS IN.
//
// This read `id=eq.1` until now, and that is why uploaded products never
// appeared here and deleted ones never went away.
//
// Row 1 was the ORIGINAL point of sale. When the business platform was built,
// its data was copied to row 100 and row 1 was deliberately left behind,
// untouched, as a rollback target — the platform's own checks refuse to let
// anything write to row 1 ever again.
//
// So row 1 has been frozen since the day of that migration. The website was not
// reading a stale copy of the shop; it was reading a photograph of the shop
// taken on the day it moved out. Every product added, edited, repriced or
// deleted since then happened in row 100, where nothing was looking.
//
// Overridable, because a number this important should never be a number only
// one file knows.
const STATE_ROW = String(process.env.POS_STATE_ROW || '100').trim();

// THE DETAILS A LISTING NEEDS.
//
// The platform's build 379 added fifteen attributes to Product Setup — taken
// from the supplier sheets the goods are actually bought against — and writes
// them onto the product as `attrs`. They were never arriving here, because
// this function builds a new object from a named list and `attrs` was not on
// it. Everything the shop typed into those boxes was being dropped one step
// short of the website it was typed for.
//
// WHY THE LABELS ARE HERE AND NOT ON THE STOREFRONT. The platform stores
// `liningMaterial`, not "Lining Material". Something has to hold the wording.
// Putting it in the storefront would mean two files having to agree about
// fifteen names for ever; putting it here means the feed sends label and
// value together and the page just prints them.
//
// WHY THIS LIST IS CLOSED, and it must stay closed. `attrs` is an object the
// platform is free to add keys to. Passing it through whole would mean the
// next field somebody adds over there — a costing note, a supplier remark —
// arriving on the public website the day it is invented, with nobody having
// decided that. So only these fifteen keys are read, and anything else in
// `attrs` is dropped exactly as though it had been sent at the top level.
//
// The order is the platform's own: what it is made of, then its shape, then
// what it is for, then how it packs.
const DETAIL_FIELDS = [
  ['outsoleMaterial', 'Outsole Material'],
  ['midsoleMaterial', 'Midsole Material'],
  ['liningMaterial', 'Lining Material'],
  ['style', 'Style'],
  ['shape', 'Shape'],
  ['toeStyle', 'Toe Style'],
  ['pattern', 'Pattern'],
  ['closureType', 'Closure Type'],
  ['decoration', 'Decoration'],
  ['feature', 'Feature'],
  ['application', 'Application'],
  ['gender', 'Gender'],
  ['season', 'Season'],
  ['handleStraps', 'Number of Handle/Straps'],
  ['packageSize', 'Single Package Size'],
];

// These are typed by hand into free-text boxes, so the only sane assumption
// is that one day somebody will paste a whole supplier paragraph into one.
// A detail is a few words; this keeps a page from being made unreadable by
// a stray paste without throwing the answer away.
const DETAIL_MAX = 120;

function toDetails(attrs) {
  if (!attrs || typeof attrs !== 'object') return [];
  const out = [];
  for (const [key, label] of DETAIL_FIELDS) {
    const value = clean(attrs[key]);
    // The platform already drops blanks on save, so an empty one here means
    // an older record. Either way an unanswered box is not a detail.
    if (!value) continue;
    out.push({ label, value: value.slice(0, DETAIL_MAX) });
  }
  return out;
}

// THE SIXTEENTH, which lives somewhere else.
//
// The weight is not in `attrs`. The platform's build 379 listed Single Gross
// Weight among the details a listing needs and deliberately built no box for
// it, because the form already had one — "Unit weight (kg)", used to share a
// consignment's freight out by weight — and a second box for the same figure
// was the thing its no-duplicates rule existed to prevent.
//
// So it is a field of its own on the product rather than one of the fifteen,
// and it is appended here so that the page still has ONE list to draw and
// needs to know nothing about where each row came from.
//
// It is labelled "Unit Weight" rather than "Single Gross Weight" because that
// is what the box it was typed into is called. A gross weight is the PACKED
// weight of one unit and this is the piece's own; they are close enough to
// share a box and not close enough to relabel behind the shop's back.
// The same figure as a number, for working out delivery by weight (see
// _delivery.js). 0 when the till has none, which the delivery rules treat
// as "weight unknown" rather than as weightless.
function weightKg(p) {
  const n = Number(p.weight !== undefined ? p.weight : p.unitWeight);
  if (!Number.isFinite(n) || n <= 0 || n > 100000) return 0;
  return Math.round(n * 1000) / 1000;
}

function weightDetail(p) {
  const n = Number(p.weight !== undefined ? p.weight : p.unitWeight);
  // Nought is not a weight, and neither is a negative one or something that
  // came through as text. A shop that never fills the box in shows no row.
  if (!Number.isFinite(n) || n <= 0 || n > 100000) return null;
  // 0.80 reads as 0.8, and 1.000 as 1.
  const shown = String(Math.round(n * 1000) / 1000);
  return { label: 'Unit Weight', value: shown + ' kg' };
}

// The ONLY fields permitted to reach the public. Everything else is dropped.
function toSafeProduct(p) {
  if (!p || typeof p !== 'object') return null;
  const name = clean(p.name);
  const sku = clean(p.sku);
  if (!name || !sku) return null; // need both to be a real, linkable product

  return {
    name,
    sku,
    category: clean(p.category) || 'Other',
    price: toNumber(p.price),
    size: clean(p.size),
    // The platform writes this field under either spelling depending on which
    // screen created the piece — its own product screen reads `p.color ||
    // p.colour` for exactly the same reason. Reading only one of them left the
    // colour blank on the website for everything entered through procurement.
    color: clean(p.color) || clean(p.colour),
    material: clean(p.material),
    // Whether it can be bought at all.
    available: toNumber(p.stock) > 0,
    // And so is scarcity. The shop can show "only a few left" without the
    // count ever crossing this line: the comparison happens here and only
    // its answer is sent. LOW_STOCK_AT sets where "a few" begins.
    lowStock: toNumber(p.stock) > 0 && toNumber(p.stock) <= LOW_STOCK_AT,
    // How many of this piece a customer's cart may hold. See cartCeiling
    // below: it is the stock count, but never more than CART_CEILING.
    maxQty: cartCeiling(p.stock),
    // The price this piece used to be, IF the till happens to record one.
    // Some point of sale systems keep a "was" price beside the current one
    // and some do not; this passes it through when it is there so the shop
    // can show a reduction the moment it is made, rather than waiting for
    // the website to notice. When the till has no such field this is 0 and
    // the website falls back to remembering prices itself.
    //
    // This is a PRICE, the same class of thing as `price` above, which is
    // already public. It is not, and must never become, `cost`: what the
    // shop paid stays behind this line forever.
    wasPrice: formerPrice(p),

    // The maker. Typed on Product Setup, and until now it went no further
    // than the platform's own screens.
    brand: clean(p.brand),

    // The shop's own words for the piece. The website has always been able
    // to write a description of its own in the admin, and that still wins —
    // but with nothing arriving from the platform, a shop that had already
    // described every piece over there was being shown a sentence this file
    // made up out of the colour and the material.
    //
    // Capped because it is a free-text box and a pasted supplier page would
    // otherwise be carried to every browser on every load.
    description: clean(p.description).slice(0, 2000),

    // The fifteen, plus the weight that sits beside them. Label and value
    // together, in one fixed order, already filtered down to the boxes that
    // were actually filled in.
    details: toDetails(p.attrs).concat(weightDetail(p) || []),
    // The unit weight in kg, as a number, for delivery fees by weight.
    weightKg: weightKg(p),

    // What the platform lists a piece under when it arrived in several
    // colours or sizes (its builds 381 and 382). Carried so that the group
    // is on the website the day it is wanted; nothing draws it yet, and a
    // piece that is not part of a set carries an empty string, which is
    // every piece the shop had before those builds.
    variantGroup: clean(p.variantGroup),
  };
  // Deliberately omitted forever: cost, supplierCost, supplierCurrency,
  // targetMargin, supplierCode, supplier name and id, the purchase order and
  // goods-received references, the branch, the stock field itself (maxQty
  // above is the only figure taken from it), id, vatable, and anything
  // outside this object.
  //
  // targetMargin is the one to keep in mind. The platform sets a profit
  // margin against a category and stamps it onto every piece priced under
  // it. The shop asked plainly that the margin never reach the website, and
  // the reason it cannot is structural: this returns a new object built from
  // named fields, so a field nobody listed is gone whether or not anybody
  // remembered it existed.
}

// The names a till might use for the price before the current one. Only
// fields that mean "this used to cost more" are read; anything to do with
// what the shop paid is never looked at, whatever it is called.
const FORMER_PRICE_KEYS = [
  'was_price', 'wasPrice',
  'old_price', 'oldPrice',
  // What the business platform actually calls it when a piece is marked down.
  // Without these two a reduction made in the shop reached the website as a
  // plain lower price, with nothing to show it had been reduced.
  'origPrice', 'orig_price',
  'original_price', 'originalPrice',
  'compare_at_price', 'compareAtPrice', 'compare_price',
  'list_price', 'listPrice',
  'rrp', 'msrp',
];

function formerPrice(p) {
  const now = toNumber(p.price);
  for (const key of FORMER_PRICE_KEYS) {
    const v = toNumber(p[key]);
    // A former price is only a former price when it is above the current
    // one. A till that mirrors the current price into one of these fields,
    // or leaves it at zero, is saying nothing.
    if (v > now) return v;
  }
  return 0;
}

// How few is "only a few left". Override with LOW_STOCK_AT in the Netlify
// environment variables; the number itself is never sent to the browser.
const LOW_STOCK_AT = toNumber(process.env.LOW_STOCK_AT) || 3;

// THE MOST OF ONE PIECE A CART MAY HOLD.
//
// THE OWNER: "in cart, product quantity shouldn't add more than what is in
// stock." The cart lives in the customer's browser, so to stop at the stock
// it has to be told the stock -- and that is a real change, because until
// now this file sent only "in stock" and "only a few left" and never a
// number.
//
// So it is told as little as does the job: the count, but never more than
// the 99 the website's cart has always stopped at. A piece with 3 left says
// 3 -- and a visitor pressing plus could work that out from the cart anyway,
// which is unavoidable once the cart stops at the stock. A piece with 400
// left says 99, and nobody learns anything about the other 301.
//
// This must match CART_MAX in assets/app.js: below it the storefront reads
// the figure as the stock and says "that's all we have".
const CART_CEILING = 99;

function cartCeiling(stock) {
  const n = toNumber(stock);
  if (n <= 0) return 0;
  // A part-unit left over (0.5 of something sold by the metre) is still in
  // stock, and still one piece a customer can ask for.
  return Math.min(Math.max(1, Math.floor(n)), CART_CEILING);
}

// The feed WITHOUT the cart ceiling, for the fingerprint below. The ceiling
// moves with every sale, and the storefront redraws whatever is on screen
// when the fingerprint changes -- which would send every open carousel back
// to its first card each time a piece sold in the shop. It changes nothing a
// visitor can see, so the storefront picks it up quietly instead.
function withoutCeiling(products) {
  return products.map((p) => {
    const out = Object.assign({}, p);
    delete out.maxQty;
    return out;
  });
}

// A short, stable fingerprint of the whole public feed.
//
// It is taken from the SAFE products — the ones about to be sent, less the
// cart ceiling (see withoutCeiling above) — so it changes when and only when
// something a visitor could see changes: a piece added or removed, renamed,
// repriced, resized, restocked to zero or back. It cannot leak anything,
// because it is derived from what is already on its way out of here.
const crypto = require('crypto');
function fingerprint(products) {
  try {
    return crypto
      .createHash('sha1')
      .update(JSON.stringify(products))
      .digest('hex')
      .slice(0, 12);
  } catch (e) {
    // A fingerprint that cannot be taken must not stop the catalogue being
    // served. The storefront treats an absent version as "assume it changed".
    return '';
  }
}

function clean(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}
function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// The whole POS database is one JSON document in a single column of app_state.
// We don't assume the column name; we find the object that holds `products`.
function findStateObject(row) {
  if (!row || typeof row !== 'object') return null;

  const candidates = [];
  for (const value of Object.values(row)) {
    if (value == null) continue;
    if (typeof value === 'string') {
      const parsed = tryParse(value);
      if (parsed) candidates.push(parsed);
    } else if (typeof value === 'object') {
      candidates.push(value);
    }
  }
  // The row itself might already carry products at the top level.
  candidates.push(row);

  for (const c of candidates) {
    const found = locateProducts(c);
    if (found) return found;
  }
  return null;
}

// Looks for an object that has a `products` array, checking a few common nests.
function locateProducts(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj.products)) return obj;
  const nests = ['state', 'data', 'app_state', 'snapshot', 'value', 'payload'];
  for (const key of nests) {
    if (obj[key] && Array.isArray(obj[key].products)) return obj[key];
  }
  return null;
}

function tryParse(s) {
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

/* A shop that has told its customers it is shut should not still be
   handing out its catalogue. The settings say whether it is, and the
   preview key is how the owner still sees it while testing. */
const { settings } = require('./_seo-data');

async function closedToThisCaller(event) {
  try {
    const g = await settings('general');
    const closed = g.maintenanceMode === true ||
                   ['closed', 'coming-soon'].indexOf(g.websiteStatus || 'live') > -1;
    if (!closed) return false;
    const key = String((g.previewKey || '')).trim();
    const asked = String(((event && event.queryStringParameters) || {}).preview || '').trim();
    return !(key && asked === key);
  } catch (e) {
    /* The settings could not be read. A shop that cannot be asked is
       treated as open: refusing every product because of a failed
       lookup would close a shop nobody closed. */
    return false;
  }
}

exports.handler = async function (event) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    // Cache at the CDN for a short while. POS edits appear within ~2 minutes.
    'Cache-Control': 'public, max-age=60, s-maxage=120',
    // Only safe product data is ever returned, so cross-origin reads are fine.
    'Access-Control-Allow-Origin': '*',
  };

  if (await closedToThisCaller(event)) {
    return {
      statusCode: 200,
      headers: Object.assign({}, headers, { 'Cache-Control': 'no-store' }),
      body: JSON.stringify({ products: [], closed: true }),
    };
  }

  try {
    const res = await fetch(
      `${POS_URL}/rest/v1/app_state?id=eq.${STATE_ROW}&select=*`,
      {
        method: 'GET',
        headers: {
          apikey: POS_KEY,
          Authorization: `Bearer ${POS_KEY}`,
          Accept: 'application/json',
        },
      }
    );

    if (!res.ok) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({
          error: 'Could not read the product source.',
          products: [],
          count: 0,
        }),
      };
    }

    const rows = await res.json();
    const row = Array.isArray(rows) ? rows[0] : rows;
    const state = findStateObject(row);
    const rawProducts =
      state && Array.isArray(state.products) ? state.products : [];

    const products = rawProducts
      .filter((p) => p && p.active === true) // only products marked active
      .map(toSafeProduct)
      .filter(Boolean);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        products,
        count: products.length,
        generatedAt: new Date().toISOString(),
        // ADDED, never removed: the existing three fields are untouched and the
        // storefront's reading of `products` is unchanged.
        //
        // A short fingerprint of exactly what is in this answer. The storefront
        // compares it with the last one it drew and redraws only when it has
        // actually changed, so a refresh triggered by a signal that turned out
        // to mean nothing costs one small request and no repaint at all.
        version: fingerprint(withoutCeiling(products)),
      }),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({
        error: 'Product service is temporarily unavailable.',
        products: [],
        count: 0,
      }),
    };
  }
};
