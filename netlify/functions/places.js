/* =====================================================================
   Vaultique Boutique Point — the lists for "Where are you browsing from?"
   ---------------------------------------------------------------------
   GET /api/places?near=1          the quick choices for this visitor (in
                                   Zambia: Lusaka, Kitwe, Ndola,
                                   Livingstone, Kabwe, Chipata) and their
                                   country, to start the lists on
   GET /api/places?list=countries  every country
   GET /api/places?cc=ZM           that country's provinces or states
   GET /api/places?cc=ZM&p=07      that province's towns, then "somewhere
                                   else in" it

   Reads only the shop's own list of the world's towns (_places.js) and,
   for the quick choices, the country Netlify reads from the connection.
   Writes nothing and keeps nothing: recording an answer is
   visit-where.js's job.
   ===================================================================== */
'use strict';
const P = require('./_places');
const { readGeo } = require('./_geo');

function json(status, body, cache) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache },
    body: JSON.stringify(body),
  };
}
/* The lists are the same for everybody, so they are kept for a day. */
const DAY = 'public, max-age=86400, s-maxage=86400';

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: '' };
  const q = event.queryStringParameters || {};
  try {
    if (q.near) {
      /* Different for every visitor, so never kept by the CDN. */
      const g = readGeo(event.headers);
      const cc = g ? g.country : '';
      return json(200, { country: cc || null, quick: P.quick(cc, g && g.city) }, 'private, no-store');
    }
    if (q.list === 'countries') return json(200, { countries: P.countries() }, DAY);
    const cc = String(q.cc || '');
    if (!/^[A-Z]{2}$/.test(cc)) return json(400, { error: 'unreadable country' }, 'no-store');
    if (q.p) {
      const code = String(q.p);
      if (!/^[A-Za-z0-9]{1,8}$/.test(code)) return json(400, { error: 'unreadable province' }, 'no-store');
      return json(200, { towns: P.towns(cc, code) }, DAY);
    }
    return json(200, { provinces: P.provinces(cc) }, DAY);
  } catch (e) {
    console.error('[places]', e && e.message);
    return json(200, { quick: [], countries: [], provinces: [], towns: [] }, 'no-store');
  }
};
