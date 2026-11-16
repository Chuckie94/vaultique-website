/* ===========================================================================
   DELIVERY FEES BY TOWN ZONE AND PARCEL WEIGHT

   netlify/functions/_delivery.js, the whole rule, checked line by line with
   made-up figures (the real ones are the shop's, typed in Settings >
   Delivery). Then once more through pay-quote, with weights coming from the
   POS feed exactly as they will in the shop.
   =========================================================================== */
const path = require('path');
const http = require('http');
const D = require('../netlify/functions/_delivery');

let checks = 0, failures = 0;
const ok = m => { checks++; console.log('  ✓ ' + m); };
const fail = (m, x) => { checks++; failures++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); };
const is = (c, m, x) => c ? ok(m) : fail(m, x);

// Test figures only. Nothing here is a real price.
const CFG = {
  feeMethod: 'zones', tierSmallMax: 5, tierMediumMax: 15,
  zone1Name: 'Near', zone1Small: 11, zone1Medium: 12, zone1Large: 13,
  zone2Name: 'Middle', zone2Small: 21, zone2Medium: 22, zone2Large: 23,
  zone3Name: '', zone3Small: 31, zone3Medium: 32, zone3Large: '',
  towns: [{ name: 'Lusaka', zone: 'zone1' }, { name: 'Kitwe', zone: 'zone2' },
          { name: 'Mongu', zone: 'zone3' }, { name: 'lusaka', zone: 'zone3' }, { name: '', zone: 'zone1' }],
  missingWeight: 'block', defaultWeight: '',
  surchargeEnabled: false, surchargeItems: '', surchargeAmount: '', freeOver: '',
};
const cfg = (over) => Object.assign({}, CFG, over || {});
const one = (kg, qty) => [{ sku: 'A', name: 'A', qty: qty || 1, weightKg: kg }];

console.log('\nWeight tiers');
is(D.quote(CFG, { town: 'Lusaka', lines: one(5) }).tier === 'Small', '5.0 kg is small (up to and including the limit)');
is(D.quote(CFG, { town: 'Lusaka', lines: one(5.1) }).tier === 'Medium', '5.1 kg is medium');
is(D.quote(CFG, { town: 'Lusaka', lines: one(15) }).tier === 'Medium', '15.0 kg is medium');
is(D.quote(CFG, { town: 'Lusaka', lines: one(15.1) }).tier === 'Large', '15.1 kg is large');
let q = D.quote(CFG, { town: 'Lusaka', lines: [{ sku: 'A', qty: 3, weightKg: 1.2 }, { sku: 'B', qty: 2, weightKg: 2 }] });
is(q.weightKg === 7.6 && q.tier === 'Medium', 'the parcel is each weight times its quantity, added up (3 x 1.2 + 2 x 2 = 7.6 kg)', JSON.stringify(q));
q = D.quote(CFG, { town: 'Lusaka', lines: [{ sku: 'A', qty: 3, weightKg: 0.1 }] });
is(q.weightKg === 0.3, 'without floating-point dust (0.1 x 3 is 0.3, not 0.30000000000000004)', String(q.weightKg));

console.log('\nZones');
is(D.quote(CFG, { town: 'Lusaka', lines: one(1) }).fee === 11, 'a zone 1 town, small parcel: the zone 1 small fee');
is(D.quote(CFG, { town: 'Kitwe', lines: one(10) }).fee === 22, 'a zone 2 town, medium parcel: the zone 2 medium fee');
is(D.quote(CFG, { town: 'Mongu', lines: one(1) }).fee === 31, 'a zone 3 town, small parcel: the zone 3 small fee');
is(D.quote(CFG, { town: '  kITWE ', lines: one(1) }).fee === 21, 'the town is matched however it is typed or spaced');
is(D.quote(CFG, { town: 'Lusaka', lines: one(1) }).zone === 'zone1', 'a town listed twice keeps its first zone');
is(D.towns(CFG).length === 3, 'blank and repeated towns are not offered at checkout');
is(D.quote(CFG, { town: 'Mongu', lines: one(1) }).zoneName === 'Zone 3', 'a zone with no name is called by its number');

console.log('\nWhat cannot be priced is never guessed');
q = D.quote(CFG, { town: '', lines: one(1) });
is(!q.ok && q.code === 'no-town', 'no town chosen');
q = D.quote(CFG, { town: 'Atlantis', lines: one(1) });
is(!q.ok && q.code === 'unknown-town' && /WhatsApp/.test(q.message), 'a town not in the list: the customer is pointed to collection or WhatsApp');
q = D.quote(CFG, { town: 'Mongu', lines: one(20) });
is(!q.ok && q.code === 'unpriced', 'a zone with no fee for that weight tier', JSON.stringify(q));
q = D.quote(CFG, { town: 'Lusaka', lines: [{ sku: 'A', qty: 1, weightKg: 1 }, { sku: 'NOWEIGHT', qty: 1, weightKg: 0 }] });
is(!q.ok && q.code === 'missing-weight' && q.detail === 'NOWEIGHT', 'a piece with no weight in the POS stops it, and names the piece for the shop', JSON.stringify(q));
q = D.quote(cfg({ missingWeight: 'default', defaultWeight: 2 }), { town: 'Lusaka', lines: [{ sku: 'A', qty: 1, weightKg: 1 }, { sku: 'N', qty: 3, weightKg: null }] });
is(q.ok && q.weightKg === 7 && q.tier === 'Medium', '...unless the shop set a weight to assume (1 + 3 x 2 = 7 kg)', JSON.stringify(q));
q = D.quote(cfg({ missingWeight: 'default', defaultWeight: '' }), { town: 'Lusaka', lines: one(0) });
is(!q.ok && q.code === 'missing-weight', 'and "assume a weight" with no weight given still stops it');
q = D.quote(cfg({ tierMediumMax: 4 }), { town: 'Lusaka', lines: one(1) });
is(!q.ok && q.code === 'no-tiers', 'weight tiers that make no sense are refused rather than used');
is(D.quote(cfg({ zone1Small: 0 }), { town: 'Lusaka', lines: one(1) }).fee === 0, 'but a fee of 0 is a real answer: free to that zone');

console.log('\nLarge orders and free delivery');
const surcharge = cfg({ surchargeEnabled: true, surchargeItems: 10, surchargeAmount: 5 });
is(D.quote(surcharge, { town: 'Lusaka', lines: one(0.1, 9) }).fee === 11, 'below the piece count, no surcharge');
q = D.quote(surcharge, { town: 'Lusaka', lines: one(0.1, 10) });
is(q.fee === 16 && q.surcharge === 5, 'at the piece count, the surcharge is added', JSON.stringify(q));
q = D.quote(cfg({ freeOver: 1000 }), { town: 'Kitwe', goods: 1000, lines: one(20) });
is(q.fee === 0 && q.free, '"free delivery over" still wins, checked last');

/* ---- through pay-quote, with weights from the POS feed ---- */
(async () => {
  const POS = [
    { sku: 'BAG', name: 'Bag', category: 'Bags', price: 500, stock: 20, active: true, unitWeight: 1.5 },
    { sku: 'COAT', name: 'Coat', category: 'Coats', price: 900, stock: 5, active: true, weight: 2.5 },
    { sku: 'RING', name: 'Ring', category: 'Jewellery', price: 300, stock: 5, active: true },
  ];
  const SETTINGS = {
    general: { currency: 'ZMW' },
    payments: { onlineEnabled: true },
    delivery: Object.assign({}, CFG, { payDelivery: true }),
  };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const send = o => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (u.pathname === '/pos/rest/v1/app_state') return send([{ id: 100, state: { products: POS } }]);
    if (u.pathname === '/web/rest/v1/site_settings') {
      const k = u.searchParams.get('key').replace('eq.', '');
      return send(SETTINGS[k] ? [{ data: SETTINGS[k] }] : []);
    }
    send([]);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  Object.assign(process.env, { WEB_SUPABASE_URL: base + '/web', WEB_SUPABASE_ANON_KEY: 'a',
                               POS_SUPABASE_URL: base + '/pos', POS_SUPABASE_KEY: 'p' });
  const quote = require(path.join(__dirname, '..', 'netlify', 'functions', 'pay-quote')).handler;
  const ask = async (b) => { const r = await quote({ httpMethod: 'POST', body: JSON.stringify(b), headers: {} }); return { code: r.statusCode, body: JSON.parse(r.body) }; };

  console.log('\nAt checkout, with weights from the POS');
  try {
    let r = await ask({ items: [{ sku: 'BAG', qty: 2 }, { sku: 'COAT', qty: 1 }], fulfilment: 'delivery', town: 'Kitwe' });
    is(r.code === 200 && r.body.delivery === 22 && r.body.total === 1922,
       'two bags (1.5 kg) and a coat (2.5 kg) to Kitwe: 5.5 kg, medium, zone 2', JSON.stringify(r.body));
    is(r.body.deliveryLabel === 'Delivery to Kitwe · 5.5 kg', 'the quote says where and how heavy', r.body.deliveryLabel);
    is(!JSON.stringify(r.body.lines).includes('weight'), 'no per-piece weights are sent to the browser');
    r = await ask({ items: [{ sku: 'BAG', qty: 1 }], fulfilment: 'delivery', town: 'Nowhere' });
    is(r.code === 409 && r.body.deliveryProblem === 'unknown-town', 'an unknown town is refused with a reason', JSON.stringify(r.body));
    r = await ask({ items: [{ sku: 'BAG', qty: 1 }], fulfilment: 'delivery' });
    is(r.code === 409 && r.body.deliveryProblem === 'no-town', 'no town is refused');
    r = await ask({ items: [{ sku: 'RING', qty: 1 }], fulfilment: 'delivery', town: 'Lusaka' });
    is(r.code === 409 && r.body.deliveryProblem === 'missing-weight', 'a piece the POS has no weight for stops delivery being priced');
    r = await ask({ items: [{ sku: 'RING', qty: 1 }], fulfilment: 'collection' });
    is(r.code === 200 && r.body.delivery === 0 && r.body.total === 300, '...but collecting it is still fine');
    SETTINGS.delivery.feeMethod = 'standard'; SETTINGS.delivery.standardFee = 7;
    r = await ask({ items: [{ sku: 'RING', qty: 1 }], fulfilment: 'delivery' });
    is(r.code === 200 && r.body.delivery === 7, 'and "Standard delivery fee" still works exactly as before');
  } catch (e) {
    fail('threw: ' + (e && e.stack || e));
  } finally {
    server.close();
  }
  console.log('\n' + (failures ? '  ✗ ' + failures + ' of ' + checks + ' checks FAILED'
                                : '  delivery by zone and weight: all ' + checks + ' checks passed'));
  process.exit(failures ? 1 : 0);
})();
