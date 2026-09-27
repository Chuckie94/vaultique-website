/* ===========================================================================
   WHERE A VISIT CAME FROM -- netlify/functions/visit-where.js

   The function is run as Netlify runs it, with the database answered here.
   It must write Netlify's own reading of the place and nothing else, only
   for a visit the website really recorded, and never the internet address.
   =========================================================================== */
const path = require('path');
process.env.WEB_SUPABASE_URL = 'https://db.test';
process.env.WEB_SUPABASE_ANON_KEY = 'anon';
process.env.WEB_SUPABASE_SERVICE_KEY = 'service-key';

let checks = 0, failures = 0;
const is = (c, m, x) => { checks++; if (c) console.log('  ✓ ' + m); else { failures++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); } };

const fn = require(path.resolve(__dirname, '../netlify/functions/visit-where.js'));
const geo = o => Buffer.from(JSON.stringify(o)).toString('base64');
const LUSAKA = geo({ city: 'Lusaka', country: { code: 'ZM', name: 'Zambia' },
  subdivision: { code: '09', name: 'Lusaka Province' }, latitude: -15.4167, longitude: 28.2833, timezone: 'Africa/Lusaka' });

let calls = [], recorded = true, written = [];
global.fetch = async (url, opts) => {
  calls.push({ url, opts });
  if (/site_events\?/.test(url)) return { ok: true, json: async () => (recorded ? [{ id: 1 }] : []) };
  if (/site_places/.test(url)) { written.push(JSON.parse(opts.body)); return { ok: true, text: async () => '' }; }
  return { ok: false, text: async () => '' };
};
const run = (body, headers) => fn.handler({ httpMethod: 'POST', body: JSON.stringify(body),
  headers: Object.assign({ 'x-nf-client-connection-ip': '41.216.99.12' }, headers || {}) });

(async () => {
  console.log('\nA visit from Lusaka');
  let r = await run({ session: 'abcdef0123456789' }, { 'x-nf-geo': LUSAKA });
  is(r.statusCode === 204, 'answers 204 and says nothing about what it wrote');
  const row = (written[0] || [])[0] || {};
  is(row.country === 'ZM' && row.country_name === 'Zambia' && row.region === 'Lusaka Province' && row.city === 'Lusaka',
     'writes Zambia, Lusaka Province, Lusaka', JSON.stringify(row));
  is(row.lat === -15.42 && row.lon === 28.28, 'at the town, to about a kilometre, never a house', row.lat + ',' + row.lon);
  is(!JSON.stringify(calls).includes('41.216.99.12'), 'and the internet address goes nowhere');
  is(Object.keys(row).sort().join(',') === 'city,country,country_name,lat,lon,region,session', 'those fields and no others');
  const put = calls.find(c => /site_places/.test(c.url)) || { opts: { headers: {} } };
  is(/ignore-duplicates/.test(put.opts.headers.Prefer), 'the first place written for a visit stands');

  console.log('\nWhat it will not do');
  calls = []; written = []; recorded = false;
  await run({ session: 'abcdef0123456789' }, { 'x-nf-geo': LUSAKA });
  is(written.length === 0, 'write a place for a visit the website never recorded');
  recorded = true; calls = []; written = [];
  await run({ session: 'abcdef0123456789', country: 'US', city: 'New York' }, { 'x-nf-geo': LUSAKA });
  is(((written[0] || [])[0] || {}).city === 'Lusaka', 'take the browser\'s word for where it is');
  calls = []; written = [];
  await run({ session: 'x' }, { 'x-nf-geo': LUSAKA });
  is(calls.length === 0, 'act on a token that is not a visit token');
  calls = []; written = [];
  await run({ session: 'abcdef0123456789' }, {});
  is(calls.length === 0, 'guess when Netlify does not say where');
  const get = await fn.handler({ httpMethod: 'GET', headers: {} });
  is(get.statusCode === 405, 'answer anything but a POST');

  console.log('\nWith only the country known');
  calls = []; written = [];
  await run({ session: 'abcdef0123456789' }, { 'x-country': 'za' });
  const c = (written[0] || [])[0] || {};
  is(c.country === 'ZA' && c.city === null && c.lat === null, 'the country is written and the town left empty', JSON.stringify(c));

  console.log('\nWithout a service key');
  delete process.env.WEB_SUPABASE_SERVICE_KEY; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  calls = [];
  r = await run({ session: 'abcdef0123456789' }, { 'x-nf-geo': LUSAKA });
  is(r.statusCode === 204 && calls.length === 0, 'does nothing, quietly');

  console.log(failures ? '\n  ✗ ' + failures + ' of ' + checks + ' checks FAILED'
                       : '\n  where a visit came from: all ' + checks + ' checks passed');
  process.exit(failures ? 1 : 0);
})();
