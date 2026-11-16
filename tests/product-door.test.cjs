/* ===========================================================================
   THE PRODUCTS-ONLY DOOR — the feed and the pulse (website build 62)

   THE OWNER: "Build the product only door. This essential for data
   protection."

   WHY. app_state, where the business platform keeps everything, has been
   locked since 18 September: somebody who has not signed in gets nothing from
   it. Database rules work on whole rows, so this site could only read the
   products with the secret key in POS_SUPABASE_KEY, and that key opens the
   whole business — every sale, customer, payslip and staff record — and can
   change it.

   The platform's build 454 adds a door to its database, vbp_website_products,
   that hands out the shop window and nothing else. It is asked with the
   publishable key, which is public already. These checks drive the real feed
   and pulse against that door's answer.

   WHERE THE DOOR'S ANSWER BELOW CAME FROM. Not written by hand: the products
   in RAW were put into a database shaped like the platform's (its three
   roles, app_state locked as it is live), the platform's
   tools/vbp-website-door.sql was run there, and DOOR_ANSWER is exactly what
   the door returned to the anonymous role. So "the door path gives the same
   feed as today" below is checked against what the real SQL hands out.
   =========================================================================== */
const path = require('path');

let checks = 0, failures = 0;
const ok   = m => { checks++; console.log('  ✓ ' + m); };
const fail = m => { checks++; failures++; console.log('  ✗ ' + m); };
const is   = (c, m) => c ? ok(m) : fail(m);

const FN = path.resolve(__dirname, '..', 'netlify', 'functions');
const PUBLISHABLE = 'sb_publishable_wj1gGEwOnLu_HlBRkbeZvA_tCHEk1vR';
const SECRET = 'the-secret-service-role-key';

/* Products as the platform writes them, cost, margin and supplier included. */
const RAW = [
  {"id":11,"name":"Silk Wrap Dress","sku":"VB-DRS-001","category":"Dresses","cost":900,"price":1850,"stock":4,"active":true,"vatable":true,"size":"M","colour":"Emerald","material":"Silk","margin":51.4,"markup":105.5,"profit":950,"wholesale":900,"supplier":"Someone Ltd","reorderLevel":2,"internalNote":"haggle harder","targetMargin":51.4,"supplierCost":900,"supplierCurrency":"USD","supplierCode":"SC-77","poRef":"PO-19","grnRef":"GRN-42","branchId":3,"brand":"Vaultique Atelier","description":"Cut from a single length of silk and finished by hand.","variantGroup":"vg-silk-wrap","attrs":{"liningMaterial":"Polyester","style":"Wrap","pattern":"Plain","closureType":"Tie","gender":"Women","season":"All season","packageSize":"30 x 24 x 6 cm","costNote":"paid 900 in Dubai"}},
  {"id":12,"name":"Silk Wrap Dress","sku":"VB-DRS-002","category":"Dresses","cost":900,"price":1850,"stock":2,"active":true,"vatable":true,"size":"L","colour":"Emerald","material":"Silk","margin":51.4,"markup":105.5,"profit":950,"wholesale":900,"supplier":"Someone Ltd","reorderLevel":2,"internalNote":"haggle harder","targetMargin":51.4,"supplierCost":900,"supplierCurrency":"USD","supplierCode":"SC-77","poRef":"PO-19","grnRef":"GRN-42","branchId":3,"brand":"Vaultique Atelier","description":"Cut from a single length of silk and finished by hand.","variantGroup":"vg-silk-wrap","attrs":{"liningMaterial":"Polyester","style":"Wrap","pattern":"Plain","closureType":"Tie","gender":"Women","season":"All season","packageSize":"30 x 24 x 6 cm","costNote":"paid 900 in Dubai"}},
  {"id":13,"name":"Kudu Leather Satchel","sku":"VB-BAG-003","category":"Bags","cost":900,"price":3200,"stock":400,"active":true,"vatable":true,"size":"M","material":"Silk","margin":51.4,"markup":105.5,"profit":950,"wholesale":900,"supplier":"Someone Ltd","reorderLevel":2,"internalNote":"haggle harder","targetMargin":51.4,"supplierCost":900,"supplierCurrency":"USD","supplierCode":"SC-77","poRef":"PO-19","grnRef":"GRN-42","branchId":3,"brand":"Vaultique Atelier","description":"Cut from a single length of silk and finished by hand.","variantGroup":"vg-silk-wrap","attrs":{"liningMaterial":"Polyester","style":"Wrap","pattern":"Plain","closureType":"Tie","gender":"Women","season":"All season","packageSize":"30 x 24 x 6 cm","costNote":"paid 900 in Dubai"},"color":"Brown","origPrice":4000,"weight":1.25},
  {"id":14,"name":"Woven Sandal","sku":"VB-SHO-004","category":"Shoes","cost":900,"price":1850,"stock":"7","active":true,"vatable":true,"size":"M","colour":"Emerald","material":"Silk","margin":51.4,"markup":105.5,"profit":950,"wholesale":900,"supplier":"Someone Ltd","reorderLevel":2,"internalNote":"haggle harder","targetMargin":51.4,"supplierCost":900,"supplierCurrency":"USD","supplierCode":"SC-77","poRef":"PO-19","grnRef":"GRN-42","branchId":3,"brand":"Vaultique Atelier","description":"Cut from a single length of silk and finished by hand.","variantGroup":"vg-silk-wrap","attrs":{"outsoleMaterial":"Rubber"},"unitWeight":0.8},
  {"id":15,"name":"Chiffon Scarf","sku":"VB-SCF-005","category":"Dresses","cost":900,"price":1850,"stock":0,"active":true,"vatable":true,"size":"M","colour":"Emerald","material":"Silk","margin":51.4,"markup":105.5,"profit":950,"wholesale":900,"supplier":"Someone Ltd","reorderLevel":2,"internalNote":"haggle harder","targetMargin":51.4,"supplierCost":900,"supplierCurrency":"USD","supplierCode":"SC-77","poRef":"PO-19","grnRef":"GRN-42","branchId":3,"brand":"Vaultique Atelier","description":"Cut from a single length of silk and finished by hand.","variantGroup":"vg-silk-wrap","attrs":"n/a"},
  {"id":16,"name":"Chitenge by the metre","sku":"VB-FAB-006","category":"Dresses","cost":900,"price":"95.00","stock":0.5,"active":true,"vatable":true,"size":"M","colour":"Emerald","material":"Silk","margin":51.4,"markup":105.5,"profit":950,"wholesale":900,"supplier":"Someone Ltd","reorderLevel":2,"internalNote":"haggle harder","targetMargin":51.4,"supplierCost":900,"supplierCurrency":"USD","supplierCode":"SC-77","poRef":"PO-19","grnRef":"GRN-42","branchId":3,"brand":"Vaultique Atelier","description":"Cut from a single length of silk and finished by hand.","variantGroup":"vg-silk-wrap","attrs":{"liningMaterial":"Polyester","style":"Wrap","pattern":"Plain","closureType":"Tie","gender":"Women","season":"All season","packageSize":"30 x 24 x 6 cm","costNote":"paid 900 in Dubai"}},
  {"id":17,"name":"Retired Clutch","sku":"VB-OLD-007","category":"Dresses","cost":900,"price":1850,"stock":3,"active":false,"vatable":true,"size":"M","colour":"Emerald","material":"Silk","margin":51.4,"markup":105.5,"profit":950,"wholesale":900,"supplier":"Someone Ltd","reorderLevel":2,"internalNote":"haggle harder","targetMargin":51.4,"supplierCost":900,"supplierCurrency":"USD","supplierCode":"SC-77","poRef":"PO-19","grnRef":"GRN-42","branchId":3,"brand":"Vaultique Atelier","description":"Cut from a single length of silk and finished by hand.","variantGroup":"vg-silk-wrap","attrs":{"liningMaterial":"Polyester","style":"Wrap","pattern":"Plain","closureType":"Tie","gender":"Women","season":"All season","packageSize":"30 x 24 x 6 cm","costNote":"paid 900 in Dubai"}},
  {"id":18,"name":"   ","sku":"VB-NON-008","category":"Dresses","cost":900,"price":1850,"stock":3,"active":true,"vatable":true,"size":"M","colour":"Emerald","material":"Silk","margin":51.4,"markup":105.5,"profit":950,"wholesale":900,"supplier":"Someone Ltd","reorderLevel":2,"internalNote":"haggle harder","targetMargin":51.4,"supplierCost":900,"supplierCurrency":"USD","supplierCode":"SC-77","poRef":"PO-19","grnRef":"GRN-42","branchId":3,"brand":"Vaultique Atelier","description":"Cut from a single length of silk and finished by hand.","variantGroup":"vg-silk-wrap","attrs":{"liningMaterial":"Polyester","style":"Wrap","pattern":"Plain","closureType":"Tie","gender":"Women","season":"All season","packageSize":"30 x 24 x 6 cm","costNote":"paid 900 in Dubai"}}
];

/* What the door returned for RAW, word for word (see the note at the top). */
const DOOR_ANSWER = Object.assign({"v":1,"row":102,"door":"vbp_website_products","stamp":"2026-10-02T12:00:00+00:00"}, { products: [
  {"sku":"VB-DRS-001","name":"Silk Wrap Dress","size":"M","attrs":{"style":"Wrap","gender":"Women","season":"All season","pattern":"Plain","closureType":"Tie","packageSize":"30 x 24 x 6 cm","liningMaterial":"Polyester"},"brand":"Vaultique Atelier","price":1850,"active":true,"colour":"Emerald","maxQty":4,"category":"Dresses","lowStock":false,"material":"Silk","available":true,"description":"Cut from a single length of silk and finished by hand.","variantGroup":"vg-silk-wrap"},
  {"sku":"VB-DRS-002","name":"Silk Wrap Dress","size":"L","attrs":{"style":"Wrap","gender":"Women","season":"All season","pattern":"Plain","closureType":"Tie","packageSize":"30 x 24 x 6 cm","liningMaterial":"Polyester"},"brand":"Vaultique Atelier","price":1850,"active":true,"colour":"Emerald","maxQty":2,"category":"Dresses","lowStock":true,"material":"Silk","available":true,"description":"Cut from a single length of silk and finished by hand.","variantGroup":"vg-silk-wrap"},
  {"sku":"VB-BAG-003","name":"Kudu Leather Satchel","size":"M","attrs":{"style":"Wrap","gender":"Women","season":"All season","pattern":"Plain","closureType":"Tie","packageSize":"30 x 24 x 6 cm","liningMaterial":"Polyester"},"brand":"Vaultique Atelier","color":"Brown","price":3200,"active":true,"maxQty":99,"weight":1.25,"category":"Bags","lowStock":false,"material":"Silk","available":true,"origPrice":4000,"description":"Cut from a single length of silk and finished by hand.","variantGroup":"vg-silk-wrap"},
  {"sku":"VB-SHO-004","name":"Woven Sandal","size":"M","attrs":{"outsoleMaterial":"Rubber"},"brand":"Vaultique Atelier","price":1850,"active":true,"colour":"Emerald","maxQty":7,"category":"Shoes","lowStock":false,"material":"Silk","available":true,"unitWeight":0.8,"description":"Cut from a single length of silk and finished by hand.","variantGroup":"vg-silk-wrap"},
  {"sku":"VB-SCF-005","name":"Chiffon Scarf","size":"M","brand":"Vaultique Atelier","price":1850,"active":true,"colour":"Emerald","maxQty":0,"category":"Dresses","lowStock":false,"material":"Silk","available":false,"description":"Cut from a single length of silk and finished by hand.","variantGroup":"vg-silk-wrap"},
  {"sku":"VB-FAB-006","name":"Chitenge by the metre","size":"M","attrs":{"style":"Wrap","gender":"Women","season":"All season","pattern":"Plain","closureType":"Tie","packageSize":"30 x 24 x 6 cm","liningMaterial":"Polyester"},"brand":"Vaultique Atelier","price":"95.00","active":true,"colour":"Emerald","maxQty":1,"category":"Dresses","lowStock":true,"material":"Silk","available":true,"description":"Cut from a single length of silk and finished by hand.","variantGroup":"vg-silk-wrap"}
] });

const copy = (v) => JSON.parse(JSON.stringify(v));

/* One stand-in for both of the platform's ways in, and the website's own
   settings. `door` is what the door answers: a body, or a status number. */
function platform({ door, row, bell, stamp }) {
  const calls = [];
  global.fetch = async (url, init) => {
    const u = String(url), m = (init && init.method) || 'GET';
    const h = (init && init.headers) || {};
    calls.push({ u, m, apikey: h.apikey, auth: h.Authorization });
    if (/site_settings/.test(u)) return { ok: true, json: async () => [] };
    if (/\/rpc\/vbp_website_products$/.test(u)) {
      if (typeof door === 'number') return { ok: false, status: door, json: async () => ({ code: 'PGRST202' }) };
      return { ok: true, json: async () => copy(door) };
    }
    if (/\/rpc\/vbp_website_products_stamp$/.test(u)) {
      if (typeof bell === 'number') return { ok: false, status: bell, json: async () => ({}) };
      return { ok: true, json: async () => copy(bell) };
    }
    if (/app_state/.test(u)) {
      if (/select=updated_at/.test(u)) return { ok: true, json: async () => (stamp ? [{ updated_at: stamp }] : []) };
      return { ok: true, json: async () => copy(row) };
    }
    if (/product_pulse/.test(u)) {
      if (m === 'POST') return { ok: true, json: async () => [] };
      return { ok: true, json: async () => [{ id: 1, pos_updated_at: 'long ago', revision: 3 }] };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return calls;
}

async function feed(opts, env) {
  const saved = {};
  for (const k of Object.keys(env || {})) { saved[k] = process.env[k]; if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
  const calls = platform(opts);
  for (const k of Object.keys(require.cache)) if (k.startsWith(FN)) delete require.cache[k];
  const res = await require(FN + '/products.js').handler({ queryStringParameters: {} });
  for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  return { res, body: JSON.parse(res.body), calls };
}

const ROW = [{ id: 100, data: { products: RAW } }];

(async () => {

  /* ====================================================================== */
  console.log('\nThe feed asks the door first, with the public key');
  {
    const { body, calls } = await feed({ door: DOOR_ANSWER, row: ROW }, { POS_SUPABASE_KEY: SECRET });
    const first = calls.find((c) => !/site_settings/.test(c.u));
    is(first && /\/rest\/v1\/rpc\/vbp_website_products$/.test(first.u) && first.m === 'POST',
       'the first thing it asks the platform is the door');
    is(first && first.apikey === PUBLISHABLE && first.auth === 'Bearer ' + PUBLISHABLE,
       'with the publishable key');
    is(!calls.some((c) => c.apikey === SECRET || c.auth === 'Bearer ' + SECRET),
       'and the secret key is sent nowhere, even while it is still set');
    is(!calls.some((c) => /app_state/.test(c.u)), 'nothing reads app_state when the door answers');
    is(body.source === 'door', 'and the answer says it came through the door');
  }

  /* ====================================================================== */
  console.log('\nThrough the door, the website gets exactly what it gets today');
  {
    const today = (await feed({ door: 404, row: ROW }, { POS_SUPABASE_KEY: SECRET })).body;
    const door = (await feed({ door: DOOR_ANSWER, row: ROW }, { POS_SUPABASE_KEY: undefined })).body;
    is(today.source === 'row' && today.products.length === 6, 'today: six pieces, read the old way');
    is(JSON.stringify(door.products) === JSON.stringify(today.products),
       'through the door: the same six, every field the same, in the same order');
    is(door.version === today.version && door.count === today.count,
       'the same count and the same version, so no open page redraws for the change');
    const shape = Object.keys(door.products[0] || {}).sort();
    is(JSON.stringify(shape) === JSON.stringify(['available', 'brand', 'category', 'color', 'description',
      'details', 'lowStock', 'material', 'maxQty', 'name', 'price', 'size', 'sku', 'variantGroup',
      'wasPrice', 'weightKg']), 'a piece still carries exactly the sixteen fields');
    const satchel = door.products.find((p) => p.sku === 'VB-BAG-003') || {};
    is(satchel.maxQty === 99 && satchel.available && !satchel.lowStock && satchel.wasPrice === 4000,
       'four hundred in stock: the cart may hold 99 and the rest of the count stays private');
    const scarf = door.products.find((p) => p.sku === 'VB-SCF-005') || {};
    is(scarf.available === false && scarf.maxQty === 0, 'sold out is still sold out');
    const fabric = door.products.find((p) => p.sku === 'VB-FAB-006') || {};
    is(fabric.maxQty === 1 && fabric.lowStock === true && fabric.price === 95, 'half a metre left is one piece, and only a few');
    is(!door.products.some((p) => /Retired|VB-OLD/.test(p.name + p.sku)), 'a piece switched off is not there');
    is(!/haggle|Dubai|Someone|51\.4|SC-77|GRN-42/.test(JSON.stringify(door)),
       'nor the cost, the margin, the supplier, the notes or the references');
  }

  /* ====================================================================== */
  console.log('\nWhat the door itself hands a stranger');
  {
    const keys = new Set();
    DOOR_ANSWER.products.forEach((p) => Object.keys(p).forEach((k) => keys.add(k)));
    is(!keys.has('stock') && !keys.has('cost') && !keys.has('id') && !keys.has('targetMargin') &&
       !keys.has('supplier') && !keys.has('internalNote'),
       'never the stock count, the cost, the id, the margin, the supplier or a note');
    is(DOOR_ANSWER.products.every((p) => !p.attrs || !('costNote' in p.attrs)),
       'and of the listing details only the fifteen, not the note beside them');
    is(DOOR_ANSWER.row === 102, 'read from the Stock section, row 102, where the platform keeps the products');
  }

  /* ====================================================================== */
  console.log('\nThe secret key can go');
  {
    const { body, res } = await feed({ door: DOOR_ANSWER, row: [] }, { POS_SUPABASE_KEY: undefined });
    is(res.statusCode === 200 && body.products.length === 6 && body.source === 'door',
       'with no POS_SUPABASE_KEY at all, the catalogue is all there');
  }

  /* ====================================================================== */
  console.log('\nUntil the door is there, nothing changes');
  {
    const shapes = [
      ['not created yet (404)', 404],
      ['refusing (401)', 401],
      ['a reply in another shape (a list)', [{ id: 100 }]],
      ['a reply in another shape (null)', null],
      ['somebody else\'s answer', { door: 'something_else', products: [] }],
      ['the door unable to find a product list', Object.assign({}, DOOR_ANSWER, { products: null, row: null })],
    ];
    for (const [what, door] of shapes) {
      const { body, res, calls } = await feed({ door, row: ROW }, { POS_SUPABASE_KEY: SECRET });
      is(res.statusCode === 200 && body.source === 'row' && body.products.length === 6 &&
         calls.some((c) => /app_state\?id=eq\.100/.test(c.u) && c.apikey === SECRET),
         'the door ' + what + ': the old way is read, with the key, and the shop is all there');
    }
  }

  /* ====================================================================== */
  console.log('\nAnd if neither way can read, it says so rather than emptying the shop');
  {
    const { body, res } = await feed({ door: 404, row: [] }, { POS_SUPABASE_KEY: undefined });
    is(res.statusCode === 503 && body.sourceUnreadable === true,
       'no door and the lock refusing the old way: an error, never a shop with nothing in it');
    is(/NOT\s+empty/.test(body.error), 'and the error says the catalogue is not empty');
    const shapeless = await feed({ door: 404, row: [{ id: 100, data: { customers: [] } }] }, { POS_SUPABASE_KEY: SECRET });
    is(shapeless.res.statusCode === 503, 'a row with no product list in it is not an empty shop either');
    const empty = await feed({ door: Object.assign({}, DOOR_ANSWER, { products: [] }), row: [] }, {});
    is(empty.res.statusCode === 200 && empty.body.products.length === 0,
       'while a shop that really has nothing, said so by the door, is shown as it is');
  }

  /* ====================================================================== */
  console.log('\nWhatever arrives, the same rules');
  {
    const odd = Object.assign({}, DOOR_ANSWER, { products: [
      Object.assign({}, DOOR_ANSWER.products[0], { maxQty: 500, cost: 900, stock: 4, supplier: 'X' }),
      Object.assign({}, DOOR_ANSWER.products[1], { available: 'yes', lowStock: 'yes', maxQty: -3 }),
    ] });
    const { body } = await feed({ door: odd, row: [] }, {});
    const p0 = body.products[0] || {}, p1 = body.products[1] || {};
    is(p0.maxQty === 99, 'a cart limit above 99 is held at 99');
    is(body.products.length === 2 && !('cost' in p0) && !('stock' in p0) && !('supplier' in p0),
       'a field outside the sixteen is dropped here too, whoever sent it');
    is(body.products.length === 2 && p1.available === false && p1.lowStock === false && p1.maxQty === 0,
       'anything but a plain yes is not in stock');
  }

  /* ====================================================================== */
  console.log('\nThe pulse asks the door\'s bell, with the public key');
  {
    process.env.WEB_SUPABASE_URL = 'https://web.example.co';
    process.env.WEB_SUPABASE_ANON_KEY = 'anon-key';
    process.env.WEB_SUPABASE_SERVICE_KEY = 'service-key';
    const pulse = async (opts, env) => {
      const saved = {};
      for (const k of Object.keys(env || {})) { saved[k] = process.env[k]; if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
      const calls = platform(opts);
      for (const k of Object.keys(require.cache)) if (k.startsWith(FN)) delete require.cache[k];
      const r = JSON.parse((await require(FN + '/product-pulse.js').handler({})).body);
      for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
      return { r, calls };
    };
    const BELL = { door: 'vbp_website_products', v: 1, row: 102, stamp: '2026-10-02T12:44:04.173745+00:00' };
    let { r, calls } = await pulse({ bell: BELL, stamp: 'row-100-time' }, { POS_SUPABASE_KEY: SECRET });
    const bell = calls.find((c) => /rpc\/vbp_website_products_stamp$/.test(c.u));
    is(bell && bell.m === 'POST' && bell.apikey === PUBLISHABLE, 'it asks the bell with the publishable key');
    is(r.posUpdatedAt === BELL.stamp && !calls.some((c) => /app_state/.test(c.u)),
       'and uses its time, reading nothing from app_state');
    is(!calls.some((c) => c.apikey === SECRET), 'the secret key is sent nowhere');
    ({ r, calls } = await pulse({ bell: 404, stamp: 'row-100-time' }, { POS_SUPABASE_KEY: SECRET }));
    is(r.posUpdatedAt === 'row-100-time' && calls.some((c) => /app_state\?id=eq\.100&select=updated_at/.test(c.u)),
       'with no bell yet, it reads row 100\'s time the way it always has');
    ({ r } = await pulse({ bell: [], stamp: 'row-100-time' }, { POS_SUPABASE_KEY: SECRET }));
    is(r.posUpdatedAt === 'row-100-time', 'and the same for a reply in any other shape');
  }

  console.log(failures ? ('\n' + checks + ' checks, ' + failures + ' failed')
                       : ('\nproduct door: all ' + checks + ' checks passed'));
  process.exit(failures ? 1 : 0);
})();
