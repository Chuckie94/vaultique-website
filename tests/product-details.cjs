/* ===========================================================================
   THE PRODUCT DETAILS THE PLATFORM SHIPS

   THE OWNER'S REPORT: "Check the product details it ships to the website and
   allow all to appear on the website because the details don't all appear."

   THE CAUSE. The business platform's build 379 added fifteen attributes to
   Product Setup — lining material, style, shape, closure, gender, season and
   the rest — and writes them onto the product as `attrs`. It added a brand
   box and a description box beside them. /api/products builds a new object
   from a named list of fields, and none of those were on the list, so every
   one of them was dropped one step short of the website they were typed for.

   The shop was typing detail into boxes whose entire stated purpose was to
   fill in the website's product-details section, and the website was showing
   a sentence it made up out of the colour and the material.

   These checks drive the real handler with the platform's own record shape,
   and then read the storefront to see what it does with the answer.
   =========================================================================== */
const fs = require('fs');
const path = require('path');

let checks = 0, failures = 0;
const ok   = m => { checks++; console.log('  ✓ ' + m); };
const fail = (m, extra) => { checks++; failures++; console.log('  ✗ ' + m + (extra ? '\n      ' + extra : '')); };
const is   = (c, m, extra) => c ? ok(m) : fail(m, extra);
const hdr  = t => console.log('\n' + t);

const ROOT = path.resolve(__dirname, '..');
const FN = path.join(ROOT, 'netlify', 'functions');

/* The fifteen, spelled and ordered as the platform's own PRODUCT_ATTR_LABELS
   spells and orders them. If the platform ever renames one, this list is
   where the disagreement shows up. */
const FIFTEEN = [
  ['outsoleMaterial', 'Outsole Material'],
  ['midsoleMaterial', 'Midsole Material'],
  ['liningMaterial', 'Lining Material'],
  ['style', 'Style'],
  ['shape', 'Shape'],
  ['toeStyle', 'Toe Style'],
  ['pattern', 'Pattern'],
  ['closureType', 'Closure Type'],
  ['decoration', 'Decoration'],
  ['feature', 'Feature'],
  ['application', 'Application'],
  ['gender', 'Gender'],
  ['season', 'Season'],
  ['handleStraps', 'Number of Handle/Straps'],
  ['packageSize', 'Single Package Size'],
];

/* A product as the platform actually writes one, carrying everything the
   website may have and everything it may not. */
const product = over => Object.assign({
  id: 11, name: 'Kudu Leather Satchel', sku: 'BG-KULE-BR-OS', category: 'Bags',
  cost: 900, price: 1850, stock: 4, active: true, vatable: true,
  size: 'One size', colour: 'Kangaroo Brown', material: 'Leather',
  brand: 'Vaultique Atelier',
  description: 'Hand-stitched in full-grain leather, lined in cotton twill.',
  variantGroup: 'vg-kudu',
  cost_price: 900, targetMargin: 51.4, supplierCost: 900, supplierName: 'Someone Ltd',
  attrs: {}
}, over || {});

const allFifteen = () => {
  const a = {};
  FIFTEEN.forEach(([k, label], i) => { a[k] = label + ' value ' + i; });
  return a;
};

const feed = async (products) => {
  global.fetch = async (url) => {
    if (/site_settings/.test(String(url))) return { ok: true, json: async () => [] };
    return { ok: true, json: async () => [{ id: 100, data: { products } }] };
  };
  delete require.cache[require.resolve(FN + '/products.js')];
  delete require.cache[require.resolve(FN + '/_seo-data.js')];
  const h = require(FN + '/products.js').handler;
  return JSON.parse((await h({ queryStringParameters: {} })).body);
};

(async () => {

  /* ====================================================================== */
  hdr('Every one of the fifteen reaches the website');
  {
    const p = (await feed([product({ attrs: allFifteen() })])).products[0];
    is(Array.isArray(p.details), 'the feed carries a details list');
    is(p.details.length === 15, 'with all fifteen on it', 'got ' + (p.details || []).length);

    let missing = [];
    FIFTEEN.forEach(([, label]) => {
      if (!p.details.some(d => d.label === label)) missing.push(label);
    });
    is(missing.length === 0,
       'each one under the name the platform gives it',
       missing.join(', '));

    /* The label travels WITH the value. It is the reason the storefront does
       not need its own copy of these fifteen names, and the reason the two
       cannot drift apart. */
    is(p.details.every(d => d && typeof d.label === 'string' && typeof d.value === 'string'),
       'and each one as a label and a value together');
    is(JSON.stringify(p.details.map(d => d.label)) ===
       JSON.stringify(FIFTEEN.map(r => r[1])),
       'in the platform\'s own order, so the same piece reads the same way every time');
  }

  /* ====================================================================== */
  hdr('Only what was typed');
  {
    const p = (await feed([product({
      attrs: { style: 'Satchel', gender: 'Women', pattern: '', shape: '   ' }
    })])).products[0];
    is(p.details.length === 2, 'two boxes filled in, two details', 'got ' + p.details.length);
    is(p.details.map(d => d.label).join('|') === 'Style|Gender',
       'and they are the two that were filled in');

    const none = (await feed([product({ attrs: {} })])).products[0];
    is(Array.isArray(none.details) && none.details.length === 0,
       'a piece with none of them filled in carries an empty list rather than nothing at all');
  }

  /* ====================================================================== */
  hdr('The list of fifteen is CLOSED, which is the whole safety of it');
  {
    /* attrs is an object the platform is free to add keys to. If this passed
       it through whole, the next field invented over there would appear on
       the public website the day it was invented, with nobody having decided
       that. The poison here is what that would actually look like. */
    const p = (await feed([product({
      attrs: Object.assign(allFifteen(), {
        targetMargin: '51.4',
        costNote: 'bought at 900, haggle harder next time',
        supplierName: 'Someone Ltd',
        wholesale: '900'
      })
    })])).products[0];

    is(p.details.length === 15,
       'four fields the platform might add tomorrow, and still fifteen details',
       'got ' + p.details.length);
    const blob = JSON.stringify(p);
    is(blob.indexOf('haggle harder') === -1 && blob.indexOf('Someone Ltd') === -1,
       'nothing that was not on the list is anywhere in the answer');
    is(blob.indexOf('51.4') === -1 && blob.indexOf('900') === -1,
       'and least of all the margin and what the shop paid');
    is(p.attrs === undefined,
       'the raw attrs object itself never leaves the function');
  }

  /* ====================================================================== */
  hdr('A free-text box cannot be made into a weapon');
  {
    const essay = 'x'.repeat(5000);
    const p = (await feed([product({
      attrs: { style: essay },
      description: essay
    })])).products[0];
    is(p.details[0].value.length === 120,
       'a pasted supplier page in a detail box is cut to a detail\'s length',
       'got ' + p.details[0].value.length);
    is(p.description.length === 2000,
       'and a pasted page in the description is cut too, rather than carried to every browser',
       'got ' + p.description.length);
  }

  /* ====================================================================== */
  hdr('And a malformed record does not take the catalogue down with it');
  {
    for (const bad of [null, undefined, 'not an object', 42, [], { style: null }, { style: { deep: 1 } }]) {
      let res;
      try { res = await feed([product({ attrs: bad })]); }
      catch (e) { res = { error: e.message }; }
      is(res && Array.isArray(res.products) && res.products.length === 1,
         'attrs as ' + JSON.stringify(bad) + ' still serves the piece');
    }
  }

  /* ====================================================================== */
  hdr('The weight, which is not one of the fifteen but reads as one');
  {
    /* It is a field of its own on the product rather than a key in attrs,
       because the platform reused the freight box instead of adding a
       sixteenth. The page should not have to know that. */
    const p = (await feed([product({ unitWeight: 0.8, attrs: { style: 'Satchel' } })])).products[0];
    is(p.details.length === 2, 'it joins the details rather than arriving separately');
    is(p.details[1].label === 'Unit Weight' && p.details[1].value === '0.8 kg',
       'labelled as the box it was typed into, with its unit',
       JSON.stringify(p.details[1]));
    is(p.details[0].label === 'Style',
       'and it comes after the fifteen, being about the parcel rather than the piece');

    const trailing = (await feed([product({ unitWeight: 1.000 })])).products[0];
    is(trailing.details[0].value === '1 kg', 'a round number reads as a round number',
       JSON.stringify(trailing.details[0]));

    /* Nought is what the box says before anybody fills it in, and it is not
       a weight. Nor is a negative one, nor a word. */
    for (const bad of [0, -3, null, undefined, '', 'heavy', NaN, 1e9]) {
      const r = (await feed([product({ unitWeight: bad, weight: bad, attrs: {} })])).products[0];
      is(r.details.length === 0,
         'a weight of ' + JSON.stringify(bad) + ' shows no row at all',
         JSON.stringify(r.details));
    }

    /* The platform writes it as unitWeight; a priced line calls it weight.
       Reading only one of them is the mistake that left colour blank on
       everything entered through procurement. */
    const other = (await feed([product({ unitWeight: undefined, weight: 2.5, attrs: {} })])).products[0];
    is(other.details.length === 1 && other.details[0].value === '2.5 kg',
       'and it is read under either spelling the platform uses');
  }

  /* ====================================================================== */
  hdr('The three fields beside them');
  {
    const p = (await feed([product({ attrs: {} })])).products[0];
    is(p.brand === 'Vaultique Atelier', 'the maker reaches the website');
    is(/Hand-stitched/.test(p.description || ''),
       'so does the shop\'s own description, which never used to');
    is(p.variantGroup === 'vg-kudu',
       'and the group a piece belongs to when it arrived in several colours or sizes');

    const plain = (await feed([product({ brand: undefined, description: undefined, variantGroup: undefined })])).products[0];
    is(plain.brand === '' && plain.description === '' && plain.variantGroup === '',
       'a piece set up before any of this existed carries empty strings, not gaps');
  }

  /* ====================================================================== */
  hdr('The storefront draws them');
  {
    const app = fs.readFileSync(path.join(ROOT, 'assets/app.js'), 'utf8');

    is(/function detailRows\(p\)/.test(app),
       'the product page turns the feed\'s details into specification rows');
    is(/\.concat\(detailRows\(p\)\)/.test(app),
       'and puts them in the table under the handful it always showed');
    is(/\['Brand', p\.brand\]/.test(app),
       'the maker is one of those rows');
    is(/p\.customDesc \|\| p\.description \|\| buildDescription\(p\)/.test(app),
       'the description the shop typed is used when the website has not written its own');
    is(/p\.brand && p\.brand\.toLowerCase\(\)\.indexOf\(term\)/.test(app),
       'and searching a maker\'s name finds that maker');

    /* THE DRIFT GUARD, and it is the reason the labels travel with the
       values. There are exactly two ways the storefront could grow its own
       copy of these fifteen names — writing the wording out as a string, or
       reaching into the raw attrs object for a key — and both of them start
       disagreeing with the feed the first time one is renamed. Every
       disagreement after that is a row that silently stops being drawn, on
       a page whose whole job is to show what the shop typed.

       This is the same class of check as the two slug() functions in
       collection-pictures.cjs, and it exists for the same reason. */
    const esc = s => s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
    const written = FIFTEEN
      .filter(([, label]) => new RegExp('[\'"]' + esc(label) + '[\'"]').test(app))
      .map(r => r[1]);
    is(written.length === 0,
       'and the storefront never writes one of the fifteen names out for itself',
       written.join(', '));

    const reached = FIFTEEN
      .filter(([key]) => new RegExp('\\bp\\.' + key + '\\b').test(app))
      .map(r => r[0]);
    is(reached.length === 0 && !/\bp\.attrs\b/.test(app),
       'nor reaches past the feed into the platform\'s own shape for one',
       reached.join(', '));
  }

  /* ====================================================================== */
  hdr('And the admin shows the shop what arrived');
  {
    const admin = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
    const css = fs.readFileSync(path.join(ROOT, 'assets/admin/admin.css'), 'utf8');

    is(/p\.details && p\.details\.length/.test(admin),
       'Products & photos lists the details that came with a piece');
    is(/Details from the platform/.test(admin),
       'saying plainly where they came from');
    is(/To change one, change it there/.test(admin),
       'and where to change one, rather than offering a second place to type it');
    is(/\.plat-details\{/.test(css), 'with somewhere to put them on the page');

    /* The precedence, stated where the shop is standing when it matters.
       Without this, a shop that had described every piece in the platform
       would see an empty box here and reasonably assume nothing arrived. */
    is(/dTa\.placeholder = p\.description/.test(admin),
       'the description from the platform shows in the box as the greyed-out text');
    is(/the product page uses the description from the platform/.test(admin),
       'and it says what happens if the box is left empty');
  }

  console.log('\n' + (failures
    ? 'product details: ' + failures + ' of ' + checks + ' checks FAILED'
    : 'product details: all ' + checks + ' checks passed'));
  process.exit(failures ? 1 : 0);
})();
