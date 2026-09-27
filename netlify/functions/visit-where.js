/* =====================================================================
   Vaultique Boutique Point — where a visit came from
   ---------------------------------------------------------------------
   For the map in Admin > Analytics. The storefront asks this once per
   visit, sending only the visit's random token.

   WHERE THE PLACE COMES FROM. Netlify already knows, for every request,
   roughly where it came from: the country, the province and the town,
   worked out from the connection. It passes that to this function in
   the x-nf-geo header. Nothing is asked of the visitor and there is no
   pop-up. The browser cannot choose what is written, because it never
   sends a place at all -- only this function, reading Netlify, does.

   HOW ACCURATE. The country is very reliable. The town is right for most
   visitors; a phone on a mobile network is sometimes placed at its
   network's hub instead (Lusaka for somebody in Kafue, say). The map
   works at town level and never pretends to know a street.

   WHAT IS KEPT. Country, province, town and the town's map position,
   against the visit's random token. The internet address is never read
   into a variable, never sent to the database and never logged.

   WHAT IT WILL NOT DO. Write for a visit that is not recorded (so it
   cannot be used to fill the table with made-up visits), or change a
   place once written (the first answer for a visit stands).

   IF ANYTHING IS MISSING -- no service key, no table, no geo header --
   it answers 204 and does nothing. The map simply has fewer places.
   ===================================================================== */
const { readConfig } = require('./_seo-data');

function serviceKey() {
  return String(process.env.WEB_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
}

const quiet = () => ({ statusCode: 204, headers: { 'Cache-Control': 'no-store' }, body: '' });

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

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: '' };

  let session = '';
  try { session = String((JSON.parse(event.body || '{}') || {}).session || ''); } catch (e) {}
  if (!/^[A-Za-z0-9]{8,64}$/.test(session)) return quiet();

  const place = readGeo(event.headers);
  if (!place) return quiet();

  const url = String(readConfig().url || '').replace(/\/+$/, '');
  const key = serviceKey();
  if (!url || !key) return quiet();

  const headers = {
    apikey: key, Authorization: 'Bearer ' + key,
    'Content-Type': 'application/json', Accept: 'application/json',
  };
  try {
    // Only a visit the website has actually recorded, in the last six hours.
    const since = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
    const seen = await fetch(url + '/rest/v1/site_events?select=id&limit=1&session=eq.' +
      encodeURIComponent(session) + '&at=gt.' + encodeURIComponent(since), { headers });
    if (!seen.ok) return quiet();
    const rows = await seen.json();
    if (!Array.isArray(rows) || !rows.length) return quiet();

    const res = await fetch(url + '/rest/v1/site_places?on_conflict=session', {
      method: 'POST',
      headers: Object.assign({ Prefer: 'resolution=ignore-duplicates,return=minimal' }, headers),
      body: JSON.stringify([Object.assign({ session }, place)]),
    });
    if (!res.ok) console.error('[visit-where] ' + res.status + ' ' + (await res.text()).slice(0, 160));
  } catch (e) {
    console.error('[visit-where]', e.message);
  }
  return quiet();
};

module.exports._internals = { readGeo };
