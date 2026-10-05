/* =====================================================================
   Vaultique Boutique Point — when a piece sold out
   ---------------------------------------------------------------------
   The platform says whether a piece can be bought, never since when. For
   "hide sold-out pieces after so many days" (Settings > Shopping) the
   website notes the date itself, in its OWN database (sold_out_since):
   the first time the feed sees a piece sold out, it writes today; the
   moment the piece is back in stock, the note is removed.

   The feed carries the date on sold-out pieces only (soldOutSince). It
   says nothing about how many were sold or what was earned.

   THIS CAN NEVER COST THE SHOP ITS PRODUCTS. Every step is guarded and
   given a short time limit; if anything fails, or the SQL has not been
   run, the feed goes out exactly as it would have without it.
   ===================================================================== */
'use strict';
const P = require('./_pay');

const HOLD_MS = 60000;      // the notes are read at most once a minute
const LIMIT_MS = 1500;      // and never hold the feed up longer than this
let held = null;            // { at, map: { sku: since } }

async function notes() {
  if (held && Date.now() - held.at < HOLD_MS) return held.map;
  const rows = await P.svc('GET', 'sold_out_since?select=sku,since');
  const map = {};
  (rows || []).forEach((r) => { if (r && r.sku) map[r.sku] = r.since; });
  held = { at: Date.now(), map };
  return map;
}

function inList(skus) {
  return '(' + skus.map((s) => '"' + String(s).replace(/["\\]/g, '') + '"').join(',') + ')';
}

async function work(products) {
  if (!P.serviceKey()) return products;
  const map = await notes();
  const now = new Date().toISOString();
  const add = [], back = [];
  products.forEach((p) => {
    if (!p || !p.sku) return;
    if (p.available) { if (map[p.sku]) back.push(p.sku); }
    else if (!map[p.sku]) add.push(p.sku);
  });
  if (add.length) {
    await P.svc('POST', 'sold_out_since?on_conflict=sku', add.map((sku) => ({ sku, since: now })),
      'resolution=ignore-duplicates,return=minimal');
    add.forEach((sku) => { map[sku] = now; });
  }
  if (back.length) {
    await P.svc('DELETE', 'sold_out_since?sku=in.' + encodeURIComponent(inList(back)), undefined, 'return=minimal');
    back.forEach((sku) => { delete map[sku]; });
  }
  return products.map((p) => (p && !p.available && map[p.sku]) ? Object.assign({}, p, { soldOutSince: map[p.sku] }) : p);
}

async function stampSoldOut(products) {
  let timer;
  try {
    return await Promise.race([
      work(products),
      new Promise((resolve) => { timer = setTimeout(() => resolve(products), LIMIT_MS); })
    ]);
  } catch (e) {
    console.error('[sold-out] not noted:', e && e.message);
    return products;
  } finally {
    clearTimeout(timer);
  }
}

function forget() { held = null; }

module.exports = { stampSoldOut, forget };
