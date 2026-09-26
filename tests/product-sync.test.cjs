/* ===========================================================================
   PRODUCT SYNCHRONISATION — the feed and the pulse

   THE OWNER'S REPORT: "uploaded products do not appear and deleted ones still
   remain."

   THE CAUSE, and it was not a synchronisation bug at all: /api/products read
   `app_state?id=eq.1`. Row 1 is the ORIGINAL point of sale. When the business
   platform was built its data was copied to row 100 and row 1 was deliberately
   left behind as a rollback target — the platform's own checks refuse to let
   anything write to it ever again.

   So row 1 has been frozen since the day of that migration. The website was not
   reading a stale copy of the shop. It was reading a photograph of the shop
   taken on the day it moved out, and no amount of refreshing would ever have
   changed it.

   These checks drive the real handlers with the platform's own record shape.
   =========================================================================== */
const path = require('path');

let checks = 0, failures = 0;
const ok   = m => { checks++; console.log('  ✓ ' + m); };
const fail = m => { checks++; failures++; console.log('  ✗ ' + m); };
const is   = (c, m) => c ? ok(m) : fail(m);

const FN = path.resolve(__dirname, '..', 'netlify', 'functions');

/* A product as the business platform actually writes one. */
const product = over => Object.assign({
  id: 11, name: 'Silk Wrap Dress', sku: 'VB-DRS-001', category: 'Dresses',
  cost: 900, price: 1850, stock: 4, active: true, vatable: true,
  size: 'M', colour: 'Emerald', material: 'Silk',
  /* What the platform holds beside a piece and a category, and what the
     shop asked never to see on the website. Put here so the checks below
     are driven by it rather than by a product that happens not to have
     any. */
  margin: 51.4, markup: 105.5, profit: 950, wholesale: 900,
  supplier: 'Someone Ltd', reorderLevel: 2, internalNote: 'haggle harder',
  /* What the platform's own build stamps onto every piece it prices: the
     profit margin of the category it was priced under. It has a name of its
     own rather than "margin", which is exactly why the check below is on the
     whole shape and not on a list of words to look out for. */
  targetMargin: 51.4, supplierCost: 900, supplierCurrency: 'USD',
  supplierCode: 'SC-77', poRef: 'PO-19', grnRef: 'GRN-42', branchId: 3,
  /* And what build 379 added, which is the whole point of this round. */
  brand: 'Vaultique Atelier',
  description: 'Cut from a single length of silk and finished by hand.',
  variantGroup: 'vg-silk-wrap',
  attrs: {
    liningMaterial: 'Polyester', style: 'Wrap', pattern: 'Plain',
    closureType: 'Tie', gender: 'Women', season: 'All season',
    packageSize: '30 x 24 x 6 cm'
  }
}, over || {});

(async () => {

  /* ====================================================================== */
  console.log('\nThe feed reads the row the platform actually writes');
  {
    const seen = [];
    global.fetch = async (url) => {
      seen.push(String(url));
      if (/site_settings/.test(String(url))) return { ok: true, json: async () => [] };
      return { ok: true, json: async () => [{ id: 100, data: { products: [product()] } }] };
    };
    delete require.cache[require.resolve(FN + '/products.js')];
    delete require.cache[require.resolve(FN + '/_seo-data.js')];
    const h = require(FN + '/products.js').handler;
    const res = await h({ queryStringParameters: {} });
    const body = JSON.parse(res.body);

    const feedCall = seen.find(u => /app_state/.test(u));
    is(/id=eq\.100/.test(feedCall || ''),
       'it asks for app_state row 100, the platform\'s row');
    is(!/id=eq\.1&/.test(feedCall || '') && !/id=eq\.1$/.test(feedCall || ''),
       'and never row 1, which has been frozen since the migration');
    is(res.statusCode === 200 && body.products.length === 1,
       'a product in row 100 reaches the website');
  }

  /* ====================================================================== */
  console.log('\nThe response keeps its shape, and gains a way to tell it changed');
  {
    global.fetch = async (url) => {
      if (/site_settings/.test(String(url))) return { ok: true, json: async () => [] };
      return { ok: true, json: async () => [{ data: { products: [product()] } }] };
    };
    delete require.cache[require.resolve(FN + '/products.js')];
    const h = require(FN + '/products.js').handler;
    const a = JSON.parse((await h({ queryStringParameters: {} })).body);

    is(Array.isArray(a.products) && typeof a.count === 'number' && a.generatedAt,
       'products, count and generatedAt are all still there');
    const p = a.products[0];
    is(p.name && p.sku && p.category && typeof p.price === 'number'
       && typeof p.available === 'boolean',
       'and a product still carries exactly the fields the storefront reads');
    is(p.cost === undefined && p.stock === undefined && p.id === undefined,
       'with cost, the stock field and the id still kept back');

    /* NAMED FIELDS ARE NOT ENOUGH, and this is the check that matters.
       Listing the ones to keep back only ever catches the ones somebody
       thought of. The platform keeps a profit margin against a category
       and against a piece, and the shop asked plainly that it never reach
       the website — so what is asserted here is the whole shape: exactly
       these keys, and nothing else, whatever the platform sends.

       A field added to the platform tomorrow is dropped by construction,
       because toSafeProduct builds a new object rather than editing the
       one it was given. This is what makes that true rather than hoped. */
    const ALLOWED = ['name', 'sku', 'category', 'price', 'size', 'color',
                     'material', 'available', 'lowStock', 'wasPrice',
                     /* Added this round. The list gets longer; what it is
                        for does not change. */
                     'brand', 'description', 'details', 'variantGroup',
                     /* How many the cart may hold: the stock, capped at 99. */
                     'maxQty',
                     /* The unit weight as a number, for delivery fees by
                        weight. Already public as the "Unit Weight" row. */
                     'weightKg'].sort();
    const got = Object.keys(p).sort();
    is(JSON.stringify(got) === JSON.stringify(ALLOWED),
       'and a product carries exactly these sixteen fields and no others',
       'got: ' + JSON.stringify(got));
    is(p.targetMargin === undefined && !/51\.4/.test(JSON.stringify(p)),
       'the category profit margin the platform stamps on every piece is not among them');
    is(p.supplierCost === undefined && p.supplierCode === undefined &&
       p.supplierCurrency === undefined && p.poRef === undefined &&
       p.grnRef === undefined && p.branchId === undefined,
       'nor what was paid, who it was bought from, or which shop it sits in');
    is(typeof a.version === 'string' && a.version.length > 0,
       'and there is now a version, so a browser can tell a real change from a false alarm');

    /* The same catalogue must fingerprint the same, or every signal would
       redraw the page whether or not anything moved. */
    const b = JSON.parse((await h({ queryStringParameters: {} })).body);
    is(a.version === b.version, 'an unchanged catalogue keeps the same version');
  }

  /* ====================================================================== */
  console.log('\nAnd the version moves for every kind of change the owner listed');
  {
    const versionOf = async (products) => {
      global.fetch = async (url) => {
        if (/site_settings/.test(String(url))) return { ok: true, json: async () => [] };
        return { ok: true, json: async () => [{ data: { products } }] };
      };
      delete require.cache[require.resolve(FN + '/products.js')];
      const h = require(FN + '/products.js').handler;
      return JSON.parse((await h({ queryStringParameters: {} })).body).version;
    };

    const base = await versionOf([product()]);
    const cases = [
      ['a new product',      [product(), product({ sku: 'VB-BAG-003', name: 'Leather Tote' })]],
      ['a deleted product',  []],
      ['an edit',            [product({ name: 'Silk Wrap Dress II' })]],
      ['a price change',     [product({ price: 1600 })]],
      ['selling out',        [product({ stock: 0 })]],
      ['a detail change',    [product({ size: 'L' })]],
      ['deactivating it',    [product({ active: false })]]
    ];
    for (const [what, list] of cases) {
      const v = await versionOf(list);
      is(v !== base, what + ' changes the version, so every open browser redraws');
    }
  }

  /* ====================================================================== */
  console.log('\nThe cart is told how many it may hold, and no more than that');
  {
    const feedFor = async (products) => {
      global.fetch = async (url) => {
        if (/site_settings/.test(String(url))) return { ok: true, json: async () => [] };
        return { ok: true, json: async () => [{ data: { products } }] };
      };
      delete require.cache[require.resolve(FN + '/products.js')];
      const h = require(FN + '/products.js').handler;
      return JSON.parse((await h({ queryStringParameters: {} })).body);
    };
    const maxOf = async (stock) => (await feedFor([product({ stock })])).products[0].maxQty;

    is(await maxOf(4) === 4, 'four left: the cart may hold four');
    is(await maxOf(1) === 1, 'the last one: the cart may hold one');
    is(await maxOf(0) === 0, 'sold out: none');
    is(await maxOf(-2) === 0, 'a till that has gone below zero is still none');
    is(await maxOf(400) === 99,
       'four hundred: 99, the most the cart has ever held, so the rest of the count stays private');
    is(await maxOf(0.5) === 1, 'part of a unit left is still one piece that can be asked for');
    is(await maxOf('7') === 7, 'a count stored as text is still a count');

    /* A sale changes the ceiling and nothing a visitor can see, and the
       storefront redraws everything on screen when the version moves. So
       a sale must NOT move it, or every open carousel would jump back to
       its first card each time a piece sold. */
    const a = await feedFor([product({ stock: 12 })]);
    const b = await feedFor([product({ stock: 11 })]);
    is(a.products[0].maxQty === 12 && b.products[0].maxQty === 11,
       'a sale lowers the ceiling');
    is(a.version === b.version,
       'but leaves the version alone, so no open page is redrawn for it');
    const c = await feedFor([product({ stock: 2 })]);
    is(c.version !== a.version,
       'while running low, which a visitor can see, still moves it');
  }

  /* ====================================================================== */
  console.log('\nDeleting and deactivating both remove it from the website');
  {
    const feedFor = async (products) => {
      global.fetch = async (url) => {
        if (/site_settings/.test(String(url))) return { ok: true, json: async () => [] };
        return { ok: true, json: async () => [{ data: { products } }] };
      };
      delete require.cache[require.resolve(FN + '/products.js')];
      const h = require(FN + '/products.js').handler;
      return JSON.parse((await h({ queryStringParameters: {} })).body);
    };

    is((await feedFor([])).products.length === 0,
       'a product deleted in the platform is gone from the website');
    is((await feedFor([product({ active: false })])).products.length === 0,
       'and one switched off is gone too, without being deleted');
    is((await feedFor([product({ stock: 0 })])).products[0].available === false,
       'one that has sold out stays listed but is marked unavailable');
  }

  /* ====================================================================== */
  console.log('\nThe two fields the platform spells its own way');
  {
    global.fetch = async (url) => {
      if (/site_settings/.test(String(url))) return { ok: true, json: async () => [] };
      return { ok: true, json: async () => [{ data: { products: [
        product({ colour: 'Emerald', origPrice: 2400, price: 1850 })
      ] } }] };
    };
    delete require.cache[require.resolve(FN + '/products.js')];
    const h = require(FN + '/products.js').handler;
    const p = JSON.parse((await h({ queryStringParameters: {} })).body).products[0];

    is(p.color === 'Emerald',
       'a colour entered through procurement, spelled "colour", now reaches the website');
    is(p.wasPrice === 2400,
       'and a markdown made in the platform shows as a reduction rather than just a lower price');
  }

  /* ====================================================================== */
  console.log('\nThe pulse reads one column, and writes only when it moves');
  {
    process.env.WEB_SUPABASE_URL = 'https://web.example.co';
    process.env.WEB_SUPABASE_ANON_KEY = 'anon-key';
    process.env.WEB_SUPABASE_SERVICE_KEY = 'service-key';

    let posStamp = '2026-09-09T10:00:00Z';
    let stored = { id: 1, pos_updated_at: '2026-09-09T10:00:00Z', revision: 4 };
    let writes, reads;

    const run = async () => {
      writes = []; reads = [];
      global.fetch = async (url, init) => {
        const u = String(url), m = (init && init.method) || 'GET';
        reads.push(u);
        if (/app_state/.test(u)) {
          return { ok: true, json: async () => [{ updated_at: posStamp }] };
        }
        if (/product_pulse/.test(u)) {
          if (m === 'POST') {
            writes.push(JSON.parse(init.body)[0]);
            return { ok: true, json: async () => writes.slice(-1) };
          }
          return { ok: true, json: async () => (stored ? [stored] : []) };
        }
        return { ok: true, json: async () => [] };
      };
      delete require.cache[require.resolve(FN + '/product-pulse.js')];
      delete require.cache[require.resolve(FN + '/_seo-data.js')];
      const h = require(FN + '/product-pulse.js').handler;
      return JSON.parse((await h({})).body);
    };

    let r = await run();
    const posCall = reads.find(u => /app_state/.test(u));
    is(/select=updated_at/.test(posCall || ''),
       'it asks the platform for ONE COLUMN, not the catalogue');
    is(/id=eq\.100/.test(posCall || ''), 'of row 100');
    is(writes.length === 0 && /unchanged/.test(r.message),
       'and when nothing has moved it writes nothing, so no browser is woken');

    posStamp = '2026-09-09T11:30:00Z';
    r = await run();
    is(writes.length === 1, 'when the platform has changed, one row is written');
    is(writes[0].pos_updated_at === posStamp, 'carrying the new timestamp');
    is(writes[0].revision === 5,
       'and a counter that only goes up, so a repeat delivery is not a new change');
    is(!/product|price|name|sku/i.test(JSON.stringify(writes[0])),
       'the signal says only THAT the shop changed, never what');
  }

  console.log('\nAnd it never fails loudly over something it cannot fix from here');
  {
    delete process.env.WEB_SUPABASE_SERVICE_KEY;
    global.fetch = async () => ({ ok: true, json: async () => [] });
    delete require.cache[require.resolve(FN + '/product-pulse.js')];
    delete require.cache[require.resolve(FN + '/_seo-data.js')];
    const h = require(FN + '/product-pulse.js').handler;
    const res = await h({});
    is(res.statusCode === 200 && /SERVICE_KEY/.test(JSON.parse(res.body).message),
       'with no service key it says so and stops, rather than throwing every five minutes');
    process.env.WEB_SUPABASE_SERVICE_KEY = 'service-key';
  }

  console.log(failures ? ('\n' + checks + ' checks, ' + failures + ' failed')
                       : ('\nproduct sync: all ' + checks + ' checks passed'));
  process.exit(failures ? 1 : 0);
})();
