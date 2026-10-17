/* =====================================================================
   Builds netlify/functions/_places-data.json: country -> province -> towns,
   for "Where are you browsing from?" (assets/where.js).

   From GeoNames (geonames.org, CC BY 4.0), by way of two npm packages:
     all-the-cities 3.1.0  towns of over 1,000 people, with population and id
     cities.json 1.1.65    the names of every country's provinces and states

   To refresh the list (not needed to run the shop):
     mkdir /tmp/geo && cd /tmp/geo
     npm pack all-the-cities@3.1.0 cities.json@1.1.65
     mkdir atc cj && tar -xzf all-the-cities-3.1.0.tgz -C atc && tar -xzf cities.json-1.1.65.tgz -C cj
     node tools/build-places.cjs /tmp/geo/atc/package /tmp/geo/cj/package netlify/functions/_places-data.json

   What goes in: every town in Zambia on the list (and six it does not
   have), up to 150 in each province of Zambia's neighbours, and up to 100
   of the largest in each province anywhere else. Positions are rounded to
   two decimals: a town, about a kilometre, never closer.
   ===================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const [,, atcDir, cjDir, out] = process.argv;
if (!atcDir || !cjDir || !out) {
  console.error('usage: node tools/build-places.cjs <all-the-cities package dir> <cities.json package dir> <out.json>');
  process.exit(1);
}

/* ---- all-the-cities: a stream of length-prefixed protobuf messages ---- */
const buf = fs.readFileSync(path.join(atcDir, 'cities.pbf'));
let pos = 0;
function varint() {
  let result = 0, shift = 0, b;
  do { b = buf[pos++]; result += (b & 0x7f) * Math.pow(2, shift); shift += 7; } while (b >= 0x80);
  return result;
}
function svarint() { const n = varint(); return (n % 2 === 1) ? -(n + 1) / 2 : n / 2; }
function string() { const len = varint(); const s = buf.toString('utf8', pos, pos + len); pos += len; return s; }
function skip(type) {
  if (type === 0) varint(); else if (type === 2) pos += varint(); else if (type === 1) pos += 8; else if (type === 5) pos += 4;
  else throw new Error('unknown wire type ' + type);
}
const towns = [];
let lastLat = 0, lastLon = 0;
while (pos < buf.length) {
  const end = varint() + pos;
  const c = { id: 0, name: '', cc: '', admin: '', pop: 0, lat: 0, lon: 0 };
  while (pos < end) {
    const key = varint(), tag = Math.floor(key / 8), type = key & 7;
    if (tag === 1) c.id = svarint();
    else if (tag === 2) c.name = string();
    else if (tag === 3) c.cc = string();
    else if (tag === 4 || tag === 5 || tag === 6 || tag === 7) string();
    else if (tag === 8) c.admin = string();
    else if (tag === 9) c.pop = varint();
    else if (tag === 10) { lastLon += svarint(); c.lon = lastLon / 1e5; }
    else if (tag === 11) { lastLat += svarint(); c.lat = lastLat / 1e5; }
    else skip(type);
  }
  towns.push(c);
}

/* ---- cities.json: province names, and today's province codes ---------- */
const a1 = new Map(JSON.parse(fs.readFileSync(path.join(cjDir, 'admin1.json'), 'utf8')).map((x) => [x.code, x.name]));
const now = new Map();
for (const c of JSON.parse(fs.readFileSync(path.join(cjDir, 'cities.json'), 'utf8'))) {
  const k = c.country + '|' + c.name.toLowerCase();
  if (!now.has(k)) now.set(k, []);
  now.get(k).push([Number(c.lat), Number(c.lng), c.admin1]);
}

const ZM_NAMES = { '01': 'Western Province', '02': 'Central Province', '03': 'Eastern Province',
  '04': 'Luapula Province', '05': 'Northern Province', '06': 'North-Western Province',
  '07': 'Southern Province', '08': 'Copperbelt Province', '09': 'Lusaka Province', '10': 'Muchinga Province' };
/* Roughly the middle of each Zambian province, for "somewhere else in" it. */
const ZM_CENTRE = { '01': [-15.4, 23.5], '02': [-14.25, 28.85], '03': [-13.45, 32.05], '04': [-10.8, 29.0],
  '05': [-9.7, 30.7], '06': [-12.9, 25.3], '07': [-16.7, 27.0], '08': [-12.95, 28.1], '09': [-15.35, 29.1], '10': [-11.4, 31.9] };
/* Zambian towns the list does not have: district towns under its cut, or
   newer than its data. Positions to a town. */
const EXTRA = [
  { id: 'zm-chilanga', name: 'Chilanga', admin: '09', lat: -15.56, lon: 28.27, pop: 40000 },
  { id: 'zm-kalomo', name: 'Kalomo', admin: '07', lat: -17.03, lon: 26.49, pop: 25000 },
  { id: 'zm-katete', name: 'Katete', admin: '03', lat: -14.06, lon: 32.04, pop: 25000 },
  { id: 'zm-kazungula', name: 'Kazungula', admin: '07', lat: -17.78, lon: 25.27, pop: 10000 },
  { id: 'zm-chirundu', name: 'Chirundu', admin: '09', lat: -16.03, lon: 28.85, pop: 10000 },
  { id: 'zm-itezhi-tezhi', name: 'Itezhi-Tezhi', admin: '02', lat: -15.73, lon: 26.03, pop: 10000 }
];
const NEAR = new Set(['AO', 'BW', 'CD', 'MW', 'MZ', 'NA', 'TZ', 'ZA', 'ZW']);
const r2 = (n) => Math.round(n * 100) / 100;

/* A town's province: its own code when that is still a province, otherwise
   the code today's list gives the same town (provinces have been renamed
   and renumbered since all-the-cities was made). */
function provinceOf(c) {
  if (a1.has(c.cc + '.' + c.admin)) return c.admin;
  let best = null;
  for (const [la, lo, ad] of now.get(c.cc + '|' + c.name.toLowerCase()) || []) {
    const d = Math.abs(la - c.lat) + Math.abs(lo - c.lon);
    if (d < 0.3 && a1.has(c.cc + '.' + ad) && (!best || d < best[0])) best = [d, ad];
  }
  return best ? best[1] : null;
}

const per = new Map();
let left = 0;
for (const c of towns) {
  if (!c.name || !/^[A-Z]{2}$/.test(c.cc)) continue;
  if (c.pop < 1000 && c.cc !== 'ZM') continue;
  const code = provinceOf(c);
  if (code === null) { left++; continue; }
  const k = c.cc + '|' + code;
  if (!per.has(k)) per.set(k, []);
  per.get(k).push(c);
}
for (const e of EXTRA) {
  const k = 'ZM|' + e.admin;
  if (!per.has(k)) per.set(k, []);
  if (!per.get(k).some((x) => x.name === e.name)) per.get(k).push(Object.assign({ cc: 'ZM' }, e));
}

const data = {};
let count = 0;
for (const [k, list] of per) {
  const [cc, code] = k.split('|');
  list.sort((a, b) => b.pop - a.pop);
  const cap = cc === 'ZM' ? Infinity : NEAR.has(cc) ? 150 : 100;
  const seen = new Set(), keep = [];
  for (const x of list.slice(0, cap)) {
    const n = x.name.toLowerCase();
    if (seen.has(n)) continue;          // one of each name in a province: the larger, the one meant
    seen.add(n); keep.push(x);
  }
  const name = cc === 'ZM' ? ZM_NAMES[code] : a1.get(cc + '.' + code);
  const centre = cc === 'ZM' ? ZM_CENTRE[code]
    : [keep.reduce((s, x) => s + x.lat, 0) / keep.length, keep.reduce((s, x) => s + x.lon, 0) / keep.length];
  if (!data[cc]) data[cc] = [];
  data[cc].push([code, name, r2(centre[0]), r2(centre[1]),
    keep.map((x) => [x.id, x.name, r2(x.lat), r2(x.lon), Math.max(1, Math.round(x.pop / 1000))])]);
  count += keep.length;
}
for (const cc of Object.keys(data)) data[cc].sort((a, b) => a[1].toLowerCase().localeCompare(b[1].toLowerCase()));

fs.writeFileSync(out, JSON.stringify({
  source: 'GeoNames (geonames.org), CC BY 4.0: towns from all-the-cities 3.1.0, provinces from cities.json 1.1.65',
  c: data
}));
console.log(Object.keys(data).length + ' countries, ' + Object.values(data).reduce((s, v) => s + v.length, 0) +
  ' provinces, ' + count + ' towns (' + left + ' left out, their province unknown), ' +
  Math.round(fs.statSync(out).size / 1024) + ' KB');
