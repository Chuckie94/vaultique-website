/* =====================================================================
   Vaultique Boutique Point — the world's towns, by country and province,
   for "Where are you browsing from?"
   ---------------------------------------------------------------------
   From GeoNames (geonames.org, CC BY 4.0), built once into
   _places-data.json and never fetched from anywhere while the shop runs:

     country -> province or state -> towns

   Every town in Zambia on the list; elsewhere, up to a hundred towns of
   over 1,000 people in each province, the largest. Each town carries its
   map position to a town (about a kilometre), never closer.

   A visitor whose town is not there can say "somewhere else in" their
   province. An answer is only ever one of these entries, chosen by its
   id, so a browser cannot write a place of its own making into the
   statistics.
   ===================================================================== */
'use strict';
const DATA = require('./_places-data.json');

/* DATA.c: { CC: [[code, province name, lat, lon, [[id, town, lat, lon, thousands], ...]], ...] }
   provinces sorted by name; towns largest first. */
const C = DATA.c;

/* The quick choices for a visitor in Zambia: the largest towns, and
   Livingstone and Chipata for the south and the east. */
const ZM_QUICK = ['Lusaka', 'Kitwe', 'Ndola', 'Livingstone', 'Kabwe', 'Chipata'];

let names = null;
function countryName(cc) {
  try {
    if (!names) names = new Intl.DisplayNames(['en'], { type: 'region' });
    return names.of(cc) || cc;
  } catch (e) { return cc; }
}

let BY_ID = null;                          // town id -> { cc, p, t }
let COUNTRIES = null;                      // [{ cc, name }] by name
function build() {
  if (BY_ID) return;
  BY_ID = new Map();
  Object.keys(C).forEach((cc) => C[cc].forEach((p) => p[4].forEach((t) => BY_ID.set(String(t[0]), { cc, p, t }))));
  COUNTRIES = Object.keys(C).map((cc) => ({ cc, name: countryName(cc) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
function provinceOf(cc, code) {
  const list = C[cc];
  if (!list) return null;
  for (let i = 0; i < list.length; i++) if (list[i][0] === code) return list[i];
  return null;
}

/* What an entry says about itself: how it is shown, and what is written. */
function townEntry(cc, p, t) {
  return {
    id: String(t[0]), name: t[1], sub: p[1] + ', ' + countryName(cc),
    country: cc, country_name: countryName(cc), region: p[1], city: t[1], lat: t[2], lon: t[3]
  };
}
function provinceEntry(cc, p) {
  return {
    id: 'p-' + cc + '-' + p[0], name: 'Somewhere else in ' + p[1], sub: countryName(cc),
    country: cc, country_name: countryName(cc), region: p[1], city: null, lat: p[2], lon: p[3]
  };
}
function countryEntry(cc) {
  /* A whole country is not a place on a map: it is counted under the
     country and left off the map, rather than pinned on its capital. */
  return {
    id: 'c-' + cc, name: 'Somewhere in ' + countryName(cc), sub: '',
    country: cc, country_name: countryName(cc), region: null, city: null, lat: null, lon: null
  };
}

function byId(id) {
  const s = String(id == null ? '' : id).trim();
  let m;
  if (/^(\d{1,10}|zm-[a-z-]{2,30})$/.test(s)) {
    build();
    const x = BY_ID.get(s);
    return x ? townEntry(x.cc, x.p, x.t) : null;
  }
  if ((m = /^p-([A-Z]{2})-([A-Za-z0-9]{1,8})$/.exec(s))) {
    const p = provinceOf(m[1], m[2]);
    return p ? provinceEntry(m[1], p) : null;
  }
  if ((m = /^c-([A-Z]{2})$/.exec(s))) return C[m[1]] ? countryEntry(m[1]) : null;
  return null;
}

/* ---- the three lists ---------------------------------------------------- */

function countries() { build(); return COUNTRIES.slice(); }

function provinces(cc) {
  return (C[cc] || []).map((p) => ({ code: p[0], name: p[1] }));
}

/* A province's towns by name, then "somewhere else" in it. */
function towns(cc, code) {
  const p = provinceOf(cc, code);
  if (!p) return [];
  return p[4].map((t) => ({ id: String(t[0]), name: t[1] }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .concat([{ id: 'p-' + cc + '-' + p[0], name: 'Somewhere else in ' + p[1] }]);
}

/* ---- the quick choices, before anything is opened ----------------------- */

/* For a visitor in Zambia, or whose country is not known: the largest
   towns. For anybody else: the town their connection suggests, if it is
   on the list, then their country's largest. */
function quick(cc, guessCity) {
  build();
  const shown = (e) => ({ id: e.id, name: e.name, sub: e.sub });
  const find = (country, name) => {
    const want = String(name || '').toLowerCase();
    for (const p of C[country] || []) for (const t of p[4]) if (t[1].toLowerCase() === want) return townEntry(country, p, t);
    return null;
  };
  if (!cc || cc === 'ZM' || !C[cc]) return ZM_QUICK.map((n) => find('ZM', n)).filter(Boolean).map(shown);
  const out = [];
  const guess = guessCity ? find(cc, guessCity) : null;
  if (guess) out.push(shown(guess));
  const all = [];
  C[cc].forEach((p) => p[4].forEach((t) => all.push({ p, t })));
  all.sort((a, b) => b.t[4] - a.t[4]);
  for (const x of all) {
    if (out.length >= 4) break;
    if (guess && String(x.t[0]) === guess.id) continue;
    out.push(shown(townEntry(cc, x.p, x.t)));
  }
  return out;
}

module.exports = { byId, countries, provinces, towns, quick, countryName, SOURCE: DATA.source };
