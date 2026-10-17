/* =====================================================================
   Vaultique Boutique Point — where Netlify says a request came from
   ---------------------------------------------------------------------
   Netlify reads the country, province and town from the connection and
   hands it to every function in the x-nf-geo header. Shared by
   visit-where.js (the map) and places.js (the quick choices in "Where are
   you browsing from?"), so both read it the same way.

   The internet address itself is never read here.
   ===================================================================== */
'use strict';

function text(v, max) {
  const s = String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, '').trim();
  return s ? s.slice(0, max) : null;
}

function coord(v, limit) {
  const n = Number(v);
  if (!Number.isFinite(n) || Math.abs(n) > limit) return null;
  return Math.round(n * 100) / 100;          // about a kilometre: a town, not a house
}

/* Netlify's geo header, base64 JSON:
   { city, country: { code, name }, subdivision: { code, name },
     latitude, longitude, timezone } */
function readGeo(headers) {
  const h = headers || {};
  let g = null;
  const raw = h['x-nf-geo'] || h['X-Nf-Geo'];
  if (raw) {
    try { g = JSON.parse(Buffer.from(String(raw), 'base64').toString('utf8')); }
    catch (e) { try { g = JSON.parse(String(raw)); } catch (x) { g = null; } }
  }
  g = g || {};
  const country = g.country || {};
  const code = text(country.code || h['x-country'], 2);
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return null;
  return {
    country: code.toUpperCase(),
    country_name: text(country.name, 80),
    region: text(g.subdivision && g.subdivision.name, 80),
    city: text(g.city, 80),
    lat: coord(g.latitude, 90),
    lon: coord(g.longitude, 180),
  };
}

module.exports = { readGeo };
