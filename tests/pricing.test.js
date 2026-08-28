/* =====================================================================
   Settings > Pricing & Tax.

   Two halves. The first runs the money engine directly, with no browser,
   because a price is arithmetic before it is markup and arithmetic is
   cheaper to check. The second serves the real storefront and looks at
   the page a customer would actually get.

   The case that matters most is the one the shop will meet every week:
   the POS reduces a piece, and the website has to say so on its own.
   ===================================================================== */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8154;

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')); } };

const GENERAL = { businessName: 'Vaultique Boutique Point', currency: 'ZMW',
  numberFormat: '1,234.56', dateFormat: 'DD/MM/YYYY', websiteStatus: 'live', maintenanceMode: false };

/* ------------------------------------------------------------------ */
/* the money engine, on its own                                         */
/* ------------------------------------------------------------------ */
global.window = {};
require(path.join(ROOT, 'assets/formats.js'));
const F = global.window.VBP_FORMAT;
const style = (pricing) => F.moneyStyle(GENERAL, pricing || {});

console.log('\n== the old call signature still means what it meant ==');
{
  ok('K in front, no decimals on a whole number', F.money(1200, 'ZMW', '1,234.56') === 'K1,200');
  ok('decimals only when the amount has them', F.money(1200.5, 'ZMW', '1,234.56') === 'K1,200.50');
  ok('a style object gives the same answer by default',
     F.money(1200, style()) === 'K1,200', F.money(1200, style()));
}

console.log('\n== symbol, side and decimals ==');
{
  ok('a custom symbol replaces the currency default',
     F.money(1200, style({ currencySymbol: 'ZK' })) === 'ZK1,200');
  ok('after the amount', F.money(1200, style({ currencyPosition: 'after' })) === '1,200K');
  ok('after, with a space that will not wrap',
     F.money(1200, style({ currencyPosition: 'after-space' })) === '1,200 K');
  ok('before, with a space',
     F.money(1200, style({ currencyPosition: 'before-space' })) === 'K 1,200');
  ok('never any decimals', F.money(1200.5, style({ decimalPlaces: '0' })) === 'K1,201');
  ok('always two', F.money(1200, style({ decimalPlaces: '2' })) === 'K1,200.00');
  ok('an empty custom symbol falls back to the currency',
     F.money(1200, style({ currencySymbol: '   ' })) === 'K1,200');
}

console.log('\n== the tax line ==');
{
  ok('included', F.taxLine({ taxMode: 'included', taxRate: 16, taxLabel: 'VAT' }) === 'Price includes 16% VAT');
  ok('excluded', F.taxLine({ taxMode: 'excluded', taxRate: 16, taxLabel: 'VAT' }) === '16% VAT added at checkout');
  ok('silent', F.taxLine({ taxMode: 'none', taxRate: 16 }) === '');
  ok('no rate given, so no rate claimed',
     F.taxLine({ taxMode: 'included', taxRate: '', taxLabel: 'VAT' }) === 'Price includes VAT');
  ok('an unnamed tax is still called something',
     F.taxLine({ taxMode: 'included', taxRate: 16, taxLabel: '  ' }) === 'Price includes 16% VAT');
  ok('the shipped default is the line the shop used to have typed into it',
     F.taxLine({ taxMode: 'included', taxRate: 16, taxLabel: 'VAT' }) === 'Price includes 16% VAT');
}

console.log('\n== a reduction made in the POS ==');
{
  const v = F.priceView({ price: 900, wasPrice: 1200 }, {}, style());
  ok('the reduced price is the price', v.now === 900 && v.nowText === 'K900');
  ok('the old one is shown', v.wasText === 'K1,200', v.wasText);
  ok('the percentage is worked out from the two', v.offText === '-25%', v.offText);
  ok('and the saving', v.saved === 300, v.saved);
  ok('it counts as a sale', v.isSale === true);

  const small = F.priceView({ price: 1195, wasPrice: 1200 }, {}, style());
  ok('a price corrected by a hair is not a sale', small.isSale === false);
  ok('and shows no strike through', small.wasText === '');

  const floor = F.priceView({ price: 1140, wasPrice: 1200 }, { minReductionPercent: 10 }, style());
  ok('the shop chooses where a hair ends: 5% is below a 10% floor', floor.isSale === false);
  const floor2 = F.priceView({ price: 1000, wasPrice: 1200 }, { minReductionPercent: 10 }, style());
  ok('and 16.7% clears it', floor2.isSale === true);

  const up = F.priceView({ price: 1400, wasPrice: 1200 }, {}, style());
  ok('a price that went up is not a sale', up.isSale === false && up.nowText === 'K1,400');

  const off = F.priceView({ price: 900, wasPrice: 1200 }, { trackReductions: false }, style());
  ok('with the tracking switched off, the piece just has a price', off.isSale === false);
  ok('and it is the reduced one', off.nowText === 'K900');
}

console.log('\n== what a sale is allowed to say ==');
{
  const noOrig = F.priceView({ price: 900, wasPrice: 1200 }, { showOriginalPrice: false }, style());
  ok('the original can be withheld', noOrig.wasText === '' && noOrig.offText === '-25%');
  const noPct = F.priceView({ price: 900, wasPrice: 1200 }, { showDiscountPercent: false }, style());
  ok('so can the percentage', noPct.offText === '' && noPct.wasText === 'K1,200');
  const noSale = F.priceView({ price: 900, wasPrice: 1200 }, { showSalePrice: false }, style());
  ok('and the whole comparison', noSale.wasText === '' && noSale.offText === '' && noSale.isSale === false);
  ok('but the price itself is never withheld', noSale.nowText === 'K900');
}

console.log('\n== price on request ==');
{
  const v = F.priceView({ price: 900, priceOnRequest: true }, {}, style());
  ok('the figure is replaced', v.onRequest === true && v.nowText === 'Price on request');
  ok('and no figure leaks through the number', v.now === 0, v.now);
  const worded = F.priceView({ price: 900, priceOnRequest: true },
    { onRequestText: 'Enquire for price' }, style());
  ok('the shop chooses the wording', worded.nowText === 'Enquire for price');
  const allowedOff = F.priceView({ price: 900, priceOnRequest: true },
    { onRequestEnabled: false }, style());
  ok('switching the feature off shows every price, whatever is ticked',
     allowedOff.onRequest === false && allowedOff.nowText === 'K900');
}

console.log('\n== a shop-wide promotion ==');
{
  const p = { price: 1000, category: 'Bags' };
  const on = { promoEnabled: true, promoType: 'percent', promoAmount: 20, promoScope: 'all' };
  const v = F.priceView(p, on, style());
  ok('everything comes down', v.now === 800 && v.wasText === 'K1,000' && v.offText === '-20%');

  const amt = F.priceView(p, { promoEnabled: true, promoType: 'amount', promoAmount: 150, promoScope: 'all' }, style());
  ok('an amount off works too', amt.now === 850, amt.now);

  const cat = { promoEnabled: true, promoType: 'percent', promoAmount: 20,
                promoScope: 'categories', promoCategories: 'Shoes, Bags' };
  ok('a listed category is included', F.priceView(p, cat, style()).now === 800);
  ok('capitals and spaces do not matter',
     F.priceView({ price: 1000, category: 'bags' }, cat, style()).now === 800);
  ok('an unlisted one is not',
     F.priceView({ price: 1000, category: 'Accessories' }, cat, style()).now === 1000);

  const early = { ...on, promoFrom: '2099-01-01' };
  ok('a promotion that has not started does nothing', F.priceView(p, early, style()).now === 1000);
  const late = { ...on, promoTo: '2000-01-01' };
  ok('nor one that has ended', F.priceView(p, late, style()).now === 1000);
  const window_ = { ...on, promoFrom: '2000-01-01', promoTo: '2099-01-01' };
  ok('one inside its dates does', F.priceView(p, window_, style()).now === 800);

  /* The rule the user asked for, stated as a test so it cannot quietly
     change: the till's reduction wins and the two never stack. */
  const both = F.priceView({ price: 900, wasPrice: 1200, category: 'Bags' }, on, style());
  ok('a piece the POS already reduced keeps its own price', both.now === 900, both.now);
  ok('and its own comparison', both.wasText === 'K1,200', both.wasText);
  ok('the promotion does not cut it a second time', both.now !== 720);

  ok('a promotion with no amount does nothing',
     F.priceView(p, { promoEnabled: true, promoType: 'percent', promoAmount: '' }, style()).now === 1000);
  ok('a switched-off promotion does nothing',
     F.priceView(p, { ...on, promoEnabled: false }, style()).now === 1000);
}

console.log('\n== a manual override ==');
{
  const p = { price: 1000, priceOverride: 750, wasPrice: 1200 };
  const off = F.priceView(p, {}, style());
  ok('an override is ignored while overrides are switched off', off.now === 1000, off.now);
  const on = F.priceView(p, { overridesEnabled: true }, style());
  ok('and replaces the POS price when they are on', on.now === 750 && on.nowText === 'K750');
  ok('an override outranks a reduction rather than joining it', on.wasText === '', on.wasText);
  ok('and says so', on.overridden === true);
  const promo = F.priceView({ price: 1000, priceOverride: 750, category: 'Bags' },
    { overridesEnabled: true, promoEnabled: true, promoType: 'percent', promoAmount: 20, promoScope: 'all' },
    style());
  ok('a promotion does not cut an overridden piece either', promo.now === 750, promo.now);
}

/* ------------------------------------------------------------------ */
/* the storefront                                                       */
/* ------------------------------------------------------------------ */
const PRODUCTS = [
  { name: 'Aurelia Silk Blouse', sku: 'WF-1', category: "Women's Fashion", price: 900,
    size: 'S', color: 'Cream', material: 'Silk', available: true, lowStock: false },
  { name: 'Belmont Wool Blazer', sku: 'MF-1', category: "Men's Fashion", price: 1680,
    size: 'L', color: 'Navy', material: 'Wool', available: true, lowStock: false },
  { name: 'Gilt Chain Necklace', sku: 'AC-1', category: 'Accessories', price: 340,
    size: '', color: 'Gold', material: 'Brass', available: true, lowStock: false }
];
/* WF-1 was 1,200 and the till now says 900: a reduction the website has to
   notice on its own. AC-1 is held back for a conversation. */
const META = [
  { sku: 'WF-1', ref_price: 1200, ref_price_at: new Date().toISOString() },
  { sku: 'AC-1', on_request: true }
];

const STUB = `
window.__rows = window.__rows || {};
function tbl(name){var q={_v:null};
  q.select=function(){return q;};q.order=function(){return q;};q.eq=function(c,v){q._v=v;return q;};
  q.maybeSingle=function(){var r=window.__rows[name+':'+q._v];
    return Promise.resolve({data:r?JSON.parse(JSON.stringify(r)):null,error:null});};
  q.upsert=function(p){var id=p.key!==undefined?p.key:p.id;
    var c=JSON.parse(JSON.stringify(p));window.__rows[name+':'+id]={data:c.data};
    return Promise.resolve({data:null,error:null});};
  q.then=function(f){return Promise.resolve({data:[],error:null}).then(f);};return q;}
window.supabase={createClient:function(){return{
  auth:{getSession:function(){return Promise.resolve({data:{session:{user:{id:'x'}}}});},
        signOut:function(){return Promise.resolve();}},
  from:tbl,storage:{from:function(){return{upload:function(){return Promise.resolve({data:null,error:null});},
    getPublicUrl:function(){return{data:{publicUrl:''}};}};}}};}};`;

async function admin(browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript',
    body: "window.VBP_CONFIG={SUPABASE_URL:'https://x.supabase.co',SUPABASE_ANON_KEY:'k'};" }));
  await page.route('**/fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ contentType: 'text/javascript', body: STUB }));
  await page.route('**/api/products', r => r.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ products: [] }) }));
  await page.goto('http://127.0.0.1:' + PORT + '/admin.html#/settings/pricing');
  await page.waitForTimeout(1300);
  return { page, ctx, errors };
}

function server() {
  return http.createServer((req, res) => {
    const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    fs.readFile(f, (e, d) => {
      if (e) { res.writeHead(404); res.end('no'); return; }
      res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' });
      res.end(d);
    });
  });
}

async function shop(browser, pricing, hash, opts) {
  opts = opts || {};
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript',
    body: "window.VBP_CONFIG={SUPABASE_URL:'https://x.supabase.co',SUPABASE_ANON_KEY:'k'};" }));
  await page.route('**/fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('**/api/products', r => r.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ products: opts.products || PRODUCTS }) }));
  await page.route('**/rest/v1/**', r => {
    const u = r.request().url();
    const j = x => ({ contentType: 'application/json', body: JSON.stringify(x) });
    if (u.includes('key=eq.pricing')) return r.fulfill(j(pricing ? [{ data: pricing }] : []));
    if (u.includes('key=eq.general')) return r.fulfill(j([{ data: GENERAL }]));
    if (u.includes('product_meta')) return r.fulfill(j(opts.meta || META));
    if (u.includes('site_content')) return r.fulfill(j([{ data: {} }]));
    return r.fulfill(j([]));
  });
  await page.goto('http://127.0.0.1:' + PORT + '/index.html' + (hash || ''));
  await page.waitForTimeout(950);
  return { page, ctx, errors };
}

const cardOf = sku => `#grid .card[data-sku="${sku}"]`;

(async () => {
  const srv = server();
  await new Promise(r => srv.listen(PORT, r));
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  console.log('\n== the shop before this section has ever been opened ==');
  {
    const { page, ctx, errors } = await shop(browser, null, '#/shop');
    ok('no page errors', errors.length === 0, errors);
    const v = await page.evaluate(() => ({
      prices: [...document.querySelectorAll('#grid .card-info .p .px-now')].map(e => e.textContent),
      was: [...document.querySelectorAll('#grid .px-was')].map(e => e.textContent),
      off: [...document.querySelectorAll('#grid .px-off')].map(e => e.textContent)
    }));
    ok('prices read exactly as they always did', v.prices.includes('K1,680'), v.prices);
    ok('the reduced piece is marked without anyone typing a sale price',
       v.was.includes('K1,200'), v.was);
    ok('and carries its percentage', v.off.includes('-25%'), v.off);
  }

  console.log('\n== the tax line is no longer typed into the page ==');
  {
    const { page, ctx, errors } = await shop(browser,
      { taxMode: 'excluded', taxRate: 20, taxLabel: 'Sales tax' }, '#/product/MF-1');
    ok('no page errors', errors.length === 0, errors);
    const t = await page.textContent('.detail-vat');
    ok('the shop says what it was told to say', t === '20% Sales tax added at checkout', t);
    await ctx.close();
  }
  {
    const { page, ctx } = await shop(browser, { taxMode: 'none' }, '#/product/MF-1');
    const n = await page.$$eval('.detail-vat', a => a.length);
    ok('and can say nothing at all', n === 0, n);
    await ctx.close();
  }
  {
    const { page, ctx } = await shop(browser, null, '#/product/MF-1');
    const t = await page.textContent('.detail-vat');
    ok('the shipped default is the line the site used to have hardcoded',
       t === 'Price includes 16% VAT', t);
    await ctx.close();
  }

  console.log('\n== a piece whose price is settled in conversation ==');
  {
    const { page, ctx, errors } = await shop(browser, null, '#/product/AC-1');
    ok('no page errors', errors.length === 0, errors);
    const v = await page.evaluate(() => {
      const btn = document.querySelector('#buyDetail');
      return { price: document.querySelector('.detail-price .px-now').textContent,
               label: btn ? btn.textContent.trim() : null,
               href: btn ? btn.getAttribute('href') : null };
    });
    ok('no figure is shown', v.price === 'Price on request', v.price);
    ok('the button asks rather than buys', /Ask about this piece/.test(v.label || ''), v.label);
    ok('and the message asks what it costs', /could you tell me the price/i.test(decodeURIComponent(v.href || '')), v.href);
    ok('the price never reaches the message', !/900/.test(decodeURIComponent(v.href || '')));

    /* Sharing goes out through the same resolver. Anything that reads the
       till's number directly would put the hidden figure on the clipboard,
       which is the one place nobody would think to look for it. */
    await page.evaluate(() => {
      window.__shared = null;
      navigator.share = d => { window.__shared = d; return Promise.resolve(); };
    });
    await page.click('#shareDetail');
    await page.waitForTimeout(200);
    const shared = await page.evaluate(() => window.__shared);
    ok('a shared piece carries what the page showed',
       shared && /Price on request/.test(shared.text), shared);
    ok('and not the figure behind it', shared && !/340/.test(shared.text), shared);
    await ctx.close();
  }

  console.log('\n== the symbol and its side reach every corner ==');
  {
    const { page, ctx, errors } = await shop(browser,
      { currencySymbol: 'ZK', currencyPosition: 'after-space', decimalPlaces: '2' }, '#/shop');
    ok('no page errors', errors.length === 0, errors);
    const v = await page.evaluate(() => [...document.querySelectorAll('#grid .px-now')].map(e => e.textContent));
    ok('cards follow the style', v.some(t => /^1,680\.00 ZK$/.test(t)), v);
    await ctx.close();
  }

  console.log('\n== sorting follows the price actually charged ==');
  {
    const cheapestFirst = async (pricing) => {
      const { page, ctx, errors } = await shop(browser, pricing, '#/shop');
      ok('no page errors', errors.length === 0, errors);
      await page.selectOption('#sortSelect', 'price-asc');
      await page.waitForTimeout(250);
      const order = await page.$$eval('#grid .card .n', a => a.map(e => e.textContent));
      await ctx.close();
      return order;
    };

    /* The blazer is the dearest piece in the till at 1,680. Sixty per cent
       off puts it at 672, below everything else, so it has to move from
       last to first. Sorting on the till's number would leave it where it
       was. */
    const before = await cheapestFirst(null);
    ok('by default the blazer sorts after the blouse, at 1,680 against 900',
       before.indexOf('Belmont Wool Blazer') > before.indexOf('Aurelia Silk Blouse'), before);

    const after = await cheapestFirst({
      promoEnabled: true, promoType: 'percent', promoAmount: 60,
      promoScope: 'categories', promoCategories: "Men's Fashion" });
    ok('reduced, it sorts as the cheapest', after[0] === 'Belmont Wool Blazer', after);

    /* A piece with no price shown has no figure to place, so it goes last
       whichever way the list is sorted rather than pretending to be free. */
    ok('a price-on-request piece sorts last ascending',
       after[after.length - 1] === 'Gilt Chain Necklace', after);
  }

  console.log('\n== a sale that has gone stale ==');
  {
    const old = new Date(Date.now() - 90 * 86400000).toISOString();
    const { page, ctx, errors } = await shop(browser, { reductionDays: 30 }, '#/shop',
      { meta: [{ sku: 'WF-1', ref_price: 1200, ref_price_at: old }] });
    ok('no page errors', errors.length === 0, errors);
    const v = await page.evaluate(() => ({
      was: [...document.querySelectorAll('#grid .px-was')].map(e => e.textContent),
      price: [...document.querySelectorAll('#grid .px-now')].map(e => e.textContent)
    }));
    ok('the shop stops advertising it', v.was.length === 0, v.was);
    ok('but the piece keeps its lower price', v.price.includes('K900'), v.price);
    await ctx.close();
  }

  console.log('\n== the till\'s own former price outranks the remembered one ==');
  {
    const { page, ctx, errors } = await shop(browser, null, '#/shop', {
      products: PRODUCTS.map(p => p.sku === 'WF-1' ? { ...p, wasPrice: 1500 } : p)
    });
    ok('no page errors', errors.length === 0, errors);
    const was = await page.$$eval('#grid .px-was', a => a.map(e => e.textContent));
    ok('the figure the POS sent is used, not the one the admin noted',
       was.includes('K1,500') && !was.includes('K1,200'), was);
    await ctx.close();
  }

  /* The storefront carries its own copy of these defaults so it behaves the
     same before the section has ever been saved. If the two lists drift, the
     shop changes the moment somebody presses Save. */
  console.log('\n== both sides declare the same settings ==');
  {
    /* Comments are stripped before the names are read: a comment that
       happens to contain "word:" is prose, not a setting, and counting it
       would fail this guard for no reason. */
    const read = (file, marker) => {
      const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
      const i = src.indexOf(marker);
      const j = src.indexOf('\n  };', i);
      const block = src.slice(i, j)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      return [...block.matchAll(/(\w+):/g)].map(m => m[1]).sort();
    };
    const front = read('assets/app.js', 'var PRICING = {');
    const admin = read('assets/admin/settings/pricing.js', 'var DEFAULTS = {');
    ok('the storefront knows every setting the admin offers',
       admin.every(k => front.includes(k)), admin.filter(k => !front.includes(k)));
    ok('and offers nothing the admin does not',
       front.every(k => admin.includes(k)), front.filter(k => !admin.includes(k)));
  }

  /* The one thing that must never come back. */
  console.log('\n== the VAT line is gone from the source ==');
  {
    const app = fs.readFileSync(path.join(ROOT, 'assets/app.js'), 'utf8');
    ok('no hardcoded rate anywhere in the storefront', !/16%\s*VAT/.test(app));
  }

  /* The feed may pass a former price through, but never what the shop paid. */
  console.log('\n== the POS boundary still holds ==');
  {
    const fn = fs.readFileSync(path.join(ROOT, 'netlify/functions/products.js'), 'utf8');
    const keys = fn.slice(fn.indexOf('const FORMER_PRICE_KEYS'), fn.indexOf('function formerPrice'));
    ok('no cost field is read', !/cost/i.test(keys), keys.match(/\w*cost\w*/gi));
    const safe = fn.slice(fn.indexOf('function toSafeProduct'), fn.indexOf('// How few is'));
    ok('stock is still a boolean only', !/stock:\s*toNumber/.test(safe));
    ok('and nothing else was let through',
       !/\bcost\b\s*:/.test(safe) && !/\bid\b\s*:/.test(safe) && !/vatable\s*:/.test(safe));
  }

  console.log('\n== the admin page ==');
  {
    const { page, ctx, errors } = await admin(browser);
    ok('no page errors', errors.length === 0, errors);

    const v = await page.evaluate(() => ({
      groups: [...document.querySelectorAll('.card h3')].map(e => e.textContent),
      numbers: document.querySelectorAll('.num-line input.num').length,
      suffixes: [...document.querySelectorAll('.num-fix')].map(e => e.textContent),
      dates: document.querySelectorAll('input[type=date]').length,
      notes: [...document.querySelectorAll('.note-field strong')].map(e => e.textContent),
      example: (document.querySelector('.px-example') || {}).textContent
    }));
    ok('every group is drawn', v.groups.length === 7, v.groups);
    ok('the number fields carry their units', v.suffixes.join('|') === '%|%|days', v.suffixes);
    ok('four figures in all', v.numbers === 4, v.numbers);
    ok('the promotion has two dates', v.dates === 2, v.dates);
    ok('the currency is named rather than asked for again',
       v.notes.some(t => /Currency in force: ZMW/.test(t)), v.notes);
    ok('the section explains where a sale price comes from',
       v.notes.some(t => /How a sale price gets here/.test(t)), v.notes);

    /* A preview that only appears once you touch something is no use to
       somebody who opened the page to see what it currently does. */
    ok('the worked example is drawn on load',
       /K900/.test(v.example) && /K1,200/.test(v.example) && /-25%/.test(v.example), v.example);
    ok('and carries the tax line', /Price includes 16% VAT/.test(v.example), v.example);

    await page.fill('#f_currencySymbol', 'ZK');
    await page.selectOption('#f_currencyPosition', 'after-space');
    await page.waitForTimeout(200);
    const after = await page.textContent('.px-example');
    /* The space is U+00A0 on purpose: a price must never wrap between its
       digits and its symbol. Asserting the ordinary space here would pass
       only if that had been got wrong. */
    ok('and follows an edit without saving', /900\u00a0ZK/.test(after), after);
    ok('the space between them will not wrap', !/900 ZK/.test(after), after);

    await page.selectOption('#f_taxMode', 'none');
    await page.waitForTimeout(200);
    ok('the tax line disappears with the mode',
       !/VAT/.test(await page.textContent('.px-example')));
    ok('and the rate box goes with it',
       await page.evaluate(() => document.querySelector('#f_taxRate')
         .closest('.field').classList.contains('hide')));

    await page.selectOption('#f_taxMode', 'included');
    await page.fill('#f_taxRate', '250');
    await page.click('.save-bar .btn-gold');
    await page.waitForTimeout(300);
    ok('a rate over 100 is refused',
       await page.evaluate(() => document.querySelector('#f_taxRate')
         .closest('.field').classList.contains('bad')));

    await page.fill('#f_taxRate', '16');
    await page.evaluate(() => {
      document.querySelector('#f_promoEnabled').click();
    });
    await page.waitForTimeout(200);
    await page.click('.save-bar .btn-gold');
    await page.waitForTimeout(300);
    ok('a promotion with no amount is refused',
       await page.evaluate(() => document.querySelector('#f_promoAmount')
         .closest('.field').classList.contains('bad')));

    await page.fill('#f_promoAmount', '100');
    await page.click('.save-bar .btn-gold');
    await page.waitForTimeout(300);
    ok('and one that would make everything free',
       await page.evaluate(() => document.querySelector('#f_promoAmount')
         .closest('.field').classList.contains('bad')));

    await page.fill('#f_promoAmount', '20');
    await page.click('.save-bar .btn-gold');
    await page.waitForTimeout(400);
    const saved = await page.evaluate(() => (window.__rows['site_settings:pricing'] || {}).data);
    ok('a sound one saves', !!saved && saved.promoAmount === 20, saved);
    ok('the figure is stored as a number, not the text somebody typed',
       saved && typeof saved.promoAmount === 'number', typeof (saved || {}).promoAmount);
    ok('an empty figure stays empty rather than becoming zero',
       saved && saved.promoTo === '', saved && saved.promoTo);
    ok('the notes are not saved as settings',
       saved && !('currencyNote' in saved) && !('overrideNote' in saved),
       saved && Object.keys(saved).filter(k => /Note$/.test(k)));

    await ctx.close();
  }

  await browser.close();
  srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
