/* ===========================================================================
   COUNTRY, PROVINCE, TOWN -- netlify/functions/places.js and _places.js

   The lists behind "Where are you browsing from?": every country, its
   provinces or states, and their towns, with Zambia complete; the quick
   choices for a visitor; and that only an entry on the list can ever be
   recorded.
   =========================================================================== */
const path = require('path');
let checks = 0, failures = 0;
const is = (c, m, x) => { checks++; if (c) console.log('  ✓ ' + m); else { failures++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); } };

const fn = require(path.resolve(__dirname, '../netlify/functions/places.js'));
const P = require(path.resolve(__dirname, '../netlify/functions/_places.js'));
const geo = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
const get = async (q, h) => {
  const r = await fn.handler({ httpMethod: 'GET', queryStringParameters: q, headers: h || {} });
  return { status: r.statusCode, cache: r.headers['Cache-Control'], body: JSON.parse(r.body) };
};

(async () => {
  console.log('\nThe quick choices');
  let r = await get({ near: '1' }, { 'x-nf-geo': geo({ city: 'Lusaka', country: { code: 'ZM', name: 'Zambia' } }) });
  is(r.body.country === 'ZM' && r.body.quick.map((q) => q.name).join(',') === 'Lusaka,Kitwe,Ndola,Livingstone,Kabwe,Chipata',
     'a visitor in Zambia: Lusaka, Kitwe, Ndola, Livingstone, Kabwe, Chipata', JSON.stringify(r.body.quick.map((q) => q.name)));
  is(r.cache === 'private, no-store', 'different for every visitor, so never kept by the CDN');
  r = await get({ near: '1' }, { 'x-nf-geo': geo({ city: 'Manchester', country: { code: 'GB', name: 'United Kingdom' } }) });
  is(r.body.country === 'GB' && r.body.quick[0].name === 'Manchester' && r.body.quick.length === 4,
     'anywhere else: the town the connection suggests first, then the country\'s largest', JSON.stringify(r.body.quick.map((q) => q.name)));
  r = await get({ near: '1' }, {});
  is(r.body.country === null && r.body.quick[0].name === 'Lusaka', 'a visitor Netlify cannot place gets the Zambian towns');

  console.log('\nCountry, then province, then town');
  r = await get({ list: 'countries' });
  const names = r.body.countries.map((c) => c.name);
  is(r.body.countries.length > 200 && names.includes('Zambia') && names.includes('United Kingdom') && names.includes('South Africa'),
     'every country (' + r.body.countries.length + ')');
  is(/max-age=86400/.test(r.cache), 'the same for everybody, so kept for a day');
  r = await get({ cc: 'ZM' });
  is(r.body.provinces.length === 10 && r.body.provinces.every((p) => / Province$/.test(p.name)),
     'Zambia\'s ten provinces, each called a province', r.body.provinces.map((p) => p.name).join(', '));
  r = await get({ cc: 'ZM', p: '07' });
  const south = r.body.towns.map((t) => t.name);
  is(['Livingstone', 'Choma', 'Mazabuka', 'Monze', 'Kalomo', 'Kazungula', 'Siavonga'].every((n) => south.includes(n)),
     'Southern Province has Livingstone, Choma, Mazabuka, Monze, Kalomo, Kazungula, Siavonga', south.join(', '));
  is(south[south.length - 1] === 'Somewhere else in Southern Province', 'and ends with "somewhere else in" it');
  const sorted = south.slice(0, -1);
  is(sorted.join('|') === sorted.slice().sort((a, b) => a.localeCompare(b)).join('|'), 'the towns in alphabetical order');
  let zmTowns = 0;
  for (const p of (await get({ cc: 'ZM' })).body.provinces) zmTowns += (await get({ cc: 'ZM', p: p.code })).body.towns.length - 1;
  is(zmTowns >= 70, 'every Zambian town on the list is offered (' + zmTowns + ')');
  r = await get({ cc: 'GB' });
  is(r.body.provinces.map((p) => p.name).join(',') === 'England,Northern Ireland,Scotland,Wales', 'the United Kingdom: England, Northern Ireland, Scotland, Wales');
  r = await get({ cc: 'GB', p: 'ENG' });
  is(r.body.towns.length <= 101 && r.body.towns.some((t) => t.name === 'London'), 'England: its hundred largest towns, London among them (' + (r.body.towns.length - 1) + ')');
  r = await get({ cc: 'ZA' });
  is(r.body.provinces.some((p) => p.name === 'Gauteng') && r.body.provinces.some((p) => p.name === 'Western Cape'), 'South Africa: Gauteng, Western Cape and the rest');

  console.log('\nOnly what is on the list');
  is((await get({ cc: 'zm' })).status === 400 && (await get({ cc: 'ZM', p: '<x>' })).status === 400, 'a country or province that is not one is refused');
  is((await get({ cc: 'QQ' })).body.provinces.length === 0, 'a country that does not exist has no provinces');
  const liv = P.byId('910111');
  is(liv && liv.city === 'Livingstone' && liv.region === 'Southern Province' && liv.lat === -17.84 && liv.lon === 25.85,
     'Livingstone is at Livingstone, to a town and no closer', JSON.stringify(liv));
  is(P.byId('p-ZM-07').city === null && P.byId('p-ZM-07').region === 'Southern Province', '"somewhere else in" a province is the province');
  is(P.byId('c-ZA').lat === null, 'a whole country is not pinned anywhere');
  is([null, '', 'Paris', '910111; drop table', 'p-ZM-99', 'c-QQ', '99999999', 'zm-nowhere'].every((x) => P.byId(x) === null),
     'anything else is nothing');

  const t = Date.now();
  for (let i = 0; i < 200; i++) P.towns('GB', 'ENG');
  is(Date.now() - t < 2000, 'a list is quick to make (' + (Date.now() - t) + ' ms for 200)');

  console.log(failures ? '\n  ✗ ' + failures + ' of ' + checks + ' checks FAILED' : '\n  country, province, town: all ' + checks + ' checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
