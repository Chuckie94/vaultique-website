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

   WHEN THE VISITOR SAYS (build 69). "Where are you browsing from?" sends
   the id of the town the visitor picked, from the shop's own list of the
   world's towns (_places.js). It is recorded for this visit in place of
   Netlify's guess, marked how = 'told', so the map can tell the two
   apart. Only an id on that list is accepted: a browser still cannot
   write a place of its own. A visitor who picks nothing is recorded
   exactly as before.
   ===================================================================== */
const { readConfig, serviceKey } = require('./_seo-data');
const { readGeo } = require('./_geo');

const quiet = () => ({ statusCode: 204, headers: { 'Cache-Control': 'no-store' }, body: '' });

/* The town the visitor picked, or null. Loaded only when one was sent,
   so an ordinary visit never reads the list at all. */
function toldPlace(id) {
  if (id == null || id === '') return null;
  try { return require('./_places').byId(id); } catch (e) { return null; }
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: '' };

  let session = '', chosen = null;
  try {
    const body = JSON.parse(event.body || '{}') || {};
    session = String(body.session || '');
    chosen = body.place;
  } catch (e) {}
  if (!/^[A-Za-z0-9]{8,64}$/.test(session)) return quiet();

  const told = toldPlace(chosen);
  const place = told
    ? { country: told.country, country_name: told.country_name, region: told.region,
        city: told.city, lat: told.lat, lon: told.lon, how: 'told' }
    : readGeo(event.headers);
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

    /* Netlify's guess never replaces anything: the first place written for
       a visit stands. What the visitor says replaces the guess. */
    const write = (row) => fetch(url + '/rest/v1/site_places?on_conflict=session', {
      method: 'POST',
      headers: Object.assign({
        Prefer: (told ? 'resolution=merge-duplicates' : 'resolution=ignore-duplicates') + ',return=minimal'
      }, headers),
      body: JSON.stringify([Object.assign({ session }, row)]),
    });
    let res = await write(place);
    /* A database from before build 69 has no "how" column. The place is
       still worth keeping; it just cannot be marked as told. */
    if (!res.ok && told && res.status === 400) {
      const why = await res.text();
      if (/\bhow\b/.test(why)) {
        const plain = Object.assign({}, place); delete plain.how;
        res = await write(plain);
      } else { console.error('[visit-where] 400 ' + why.slice(0, 160)); return quiet(); }
    }
    if (!res.ok) console.error('[visit-where] ' + res.status + ' ' + (await res.text()).slice(0, 160));
  } catch (e) {
    console.error('[visit-where]', e.message);
  }
  return quiet();
};

module.exports._internals = { readGeo };
