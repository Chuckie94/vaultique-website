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
    color: clean(p.color),
    material: clean(p.material),
    // Availability is a boolean ONLY. The raw stock count never leaves here.
    available: toNumber(p.stock) > 0,
    // And so is scarcity. The shop can show "only a few left" without the
    // count ever crossing this line: the comparison happens here and only
    // its answer is sent. LOW_STOCK_AT sets where "a few" begins.
    lowStock: toNumber(p.stock) > 0 && toNumber(p.stock) <= LOW_STOCK_AT,
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
  };
  // Deliberately omitted forever: cost, stock (number), id, vatable,
  // and anything outside this object.
}

// The names a till might use for the price before the current one. Only
// fields that mean "this used to cost more" are read; anything to do with
// what the shop paid is never looked at, whatever it is called.
const FORMER_PRICE_KEYS = [
  'was_price', 'wasPrice',
  'old_price', 'oldPrice',
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

exports.handler = async function () {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    // Cache at the CDN for a short while. POS edits appear within ~2 minutes.
    'Cache-Control': 'public, max-age=60, s-maxage=120',
    // Only safe product data is ever returned, so cross-origin reads are fine.
    'Access-Control-Allow-Origin': '*',
  };

  try {
    const res = await fetch(
      `${POS_URL}/rest/v1/app_state?id=eq.1&select=*`,
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
