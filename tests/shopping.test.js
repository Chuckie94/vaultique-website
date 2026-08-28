/* =====================================================================
   Settings > Shopping: what each switch actually does to the shop.
   Every case sets a settings row and then looks at the page a customer
   would get.
   ===================================================================== */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8150;

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')); } };

const PRODUCTS = [
  { name: 'Aurelia Silk Blouse', sku: 'WF-1', category: "Women's Fashion", price: 920,
    size: 'S', color: 'Cream', material: 'Silk', available: true, lowStock: false },
  { name: 'Belmont Wool Blazer', sku: 'MF-1', category: "Men's Fashion", price: 1680,
    size: 'L', color: 'Navy', material: 'Wool', available: true, lowStock: true },
  { name: 'Gilt Chain Necklace', sku: 'AC-1', category: 'Accessories', price: 340,
    size: '', color: 'Gold', material: 'Brass', available: false, lowStock: false }
];
const REVIEWS = [{ id: '1', sku: null, name: 'Chanda M', rating: 5, comment: 'Lovely.',
  verified: true, approved: true, created_at: '2026-08-12T09:00:00Z' }];
const GENERAL = { businessName: 'Vaultique Boutique Point', currency: 'ZMW',
  numberFormat: '1,234.56', dateFormat: 'DD/MM/YYYY', websiteStatus: 'live', maintenanceMode: false };

const STUB = `
window.__rows = window.__rows || {}; window.__saves = [];
function tbl(name){var q={_v:null};
  q.select=function(){return q;};q.order=function(){return q;};q.eq=function(c,v){q._v=v;return q;};
  q.maybeSingle=function(){var r=window.__rows[name+':'+q._v];
    return Promise.resolve({data:r?JSON.parse(JSON.stringify(r)):null,error:null});};
  q.upsert=function(p){var id=p.key!==undefined?p.key:p.id;
    var c=JSON.parse(JSON.stringify(p));window.__rows[name+':'+id]={data:c.data};
    window.__saves.push({table:name,payload:p});return Promise.resolve({data:null,error:null});};
  q.then=function(f){return Promise.resolve({data:[],error:null}).then(f);};return q;}
window.supabase={createClient:function(){return{
  auth:{getSession:function(){return Promise.resolve({data:{session:{user:{id:'x'}}}});},
        signOut:function(){return Promise.resolve();}},
  from:tbl,storage:{from:function(){return{upload:function(){return Promise.resolve({data:null,error:null});},
    getPublicUrl:function(){return{data:{publicUrl:''}};}};}}};}};`;

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

async function shop(browser, shopping, hash) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript',
    body: "window.VBP_CONFIG={SUPABASE_URL:'https://x.supabase.co',SUPABASE_ANON_KEY:'k'};" }));
  await page.route('**/fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('**/api/products', r => r.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ products: PRODUCTS }) }));
  await page.route('**/rest/v1/**', r => {
    const u = r.request().url();
    const j = x => ({ contentType: 'application/json', body: JSON.stringify(x) });
    if (u.includes('key=eq.shopping')) return r.fulfill(j(shopping ? [{ data: shopping }] : []));
    if (u.includes('key=eq.general')) return r.fulfill(j([{ data: GENERAL }]));
    if (u.includes('reviews')) return r.fulfill(j(REVIEWS));
    if (u.includes('site_content')) return r.fulfill(j([{ data: {} }]));
    return r.fulfill(j([]));
  });
  await page.goto('http://127.0.0.1:' + PORT + '/index.html' + (hash || ''));
  await page.waitForTimeout(950);
  return { page, ctx, errors };
}

/* The storefront carries its own copy of the defaults so it behaves the same
   before this section has ever been saved. If the two lists drift, the shop
   changes the moment somebody presses Save, which is exactly the sort of thing
   nobody would think to look for. This caught the checkout settings being
   added to one side only. */
console.log('\n== both sides declare the same settings ==');
{
  const read = (file, marker) => {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const i = src.indexOf(marker);
    const j = src.indexOf('};', i);
    return [...src.slice(i, j).matchAll(/(\w+):/g)].map(m => m[1]).sort();
  };
  const front = read('assets/app.js', 'var SHOP = {');
  const admin = read('assets/admin/settings/shopping.js', 'var DEFAULTS = {');
  ok('the storefront knows every setting the admin offers',
     admin.every(k => front.includes(k)), admin.filter(k => !front.includes(k)));
  ok('and offers nothing the admin does not',
     front.every(k => admin.includes(k)), front.filter(k => !admin.includes(k)));
  /* Eighteen since guest checkout moved to Settings > Customer Accounts,
     where the rest of the questions about accounts live. */
  ok('eighteen of them', front.length === 18, front.length);
  ok('and guest checkout is not among them', front.indexOf('guestCheckout') < 0);
}

(async () => {
  const srv = server();
  await new Promise(r => srv.listen(PORT, r));
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  console.log('\n== the shipped defaults ==');
  {
    const { page, ctx, errors } = await shop(browser, null, '#/shop');
    ok('no page errors', errors.length === 0, errors);
    const v = await page.evaluate(() => ({
      cards: document.querySelectorAll('#grid .card').length,
      badges: document.querySelectorAll('#grid .tag').length,
      cats: document.querySelectorAll('#grid .card-info .c').length,
      wish: document.querySelectorAll('#grid .wish').length,
      low: Array.prototype.map.call(document.querySelectorAll('#grid .tag'), t => t.textContent)
    }));
    ok('all three pieces are shown, sold out included', v.cards === 3, v.cards);
    ok('badges are on', v.badges > 0);
    ok('categories are on', v.cats === 3, v.cats);
    ok('the wishlist heart is on each card', v.wish === 3, v.wish);
    ok('the low-stock piece says so', v.low.includes('Only a few left'), v.low);
    ok('the others do not', v.low.filter(t => t === 'Only a few left').length === 1, v.low);
    await ctx.close();
  }

  console.log('\n== hiding things ==');
  {
    const { page, ctx, errors } = await shop(browser, {
      showOutOfStock: false, showBadges: false, showCategory: false,
      showLowStock: false, wishlist: false
    }, '#/shop');
    ok('no page errors', errors.length === 0, errors);
    const v = await page.evaluate(() => ({
      cards: document.querySelectorAll('#grid .card').length,
      badges: document.querySelectorAll('#grid .tag').length,
      cats: document.querySelectorAll('#grid .card-info .c').length,
      wish: document.querySelectorAll('#grid .wish').length,
      headerWish: document.querySelector('#wishBtn').classList.contains('hide')
    }));
    ok('the sold-out piece is gone', v.cards === 2, v.cards);
    ok('no badges', v.badges === 0, v.badges);
    ok('no categories', v.cats === 0, v.cats);
    ok('no hearts on the cards', v.wish === 0, v.wish);
    ok('and the wishlist leaves the header too', v.headerWish);
    await ctx.close();
  }

  console.log('\n== low stock without the number ==');
  {
    const { page, ctx } = await shop(browser, { showLowStock: false }, '#/shop');
    const tags = await page.$$eval('#grid .tag', e => e.map(t => t.textContent));
    ok('the warning can be switched off', !tags.includes('Only a few left'), tags);
    ok('the piece still reads as in stock', tags.filter(t => t === 'In Stock').length === 2, tags);
    await ctx.close();
  }
  {
    const { page, ctx } = await shop(browser, null, '#/shop');
    const leaked = await page.evaluate(() =>
      JSON.stringify(window.__probe || '') + document.body.innerHTML);
    ok('no stock count appears anywhere on the page',
       !/stock["\s:]*\d/i.test(leaked.replace(/lowStock/gi, '')), 'a number was rendered');
    await ctx.close();
  }

  console.log('\n== default sorting ==');
  {
    const { page, ctx } = await shop(browser, { defaultSort: 'price-asc' }, '#/shop');
    const names = await page.$$eval('#grid .card-info .n', e => e.map(x => x.textContent));
    ok('the shop opens cheapest first', names[0] === 'Gilt Chain Necklace', names);
    ok('and the dropdown agrees',
       await page.inputValue('#sortSelect') === 'price-asc');
    await ctx.close();
  }
  {
    const { page, ctx } = await shop(browser, { defaultSort: 'name' }, '#/shop');
    const names = await page.$$eval('#grid .card-info .n', e => e.map(x => x.textContent));
    ok('or alphabetically', names[0] === 'Aurelia Silk Blouse', names);
    await ctx.close();
  }
  {
    const { page, ctx, errors } = await shop(browser, { defaultSort: 'nonsense' }, '#/shop');
    ok('an order the shop does not know falls back rather than breaking',
       (await page.$$eval('#grid .card', e => e.length)) === 3 && errors.length === 0, errors);
    await ctx.close();
  }

  console.log('\n== the product page ==');
  {
    const { page, ctx } = await shop(browser, null, '#/product/MF-1');
    await page.waitForTimeout(300);
    const v = await page.evaluate(() => ({
      specs: Array.prototype.map.call(document.querySelectorAll('#view-detail .acc-row .k, #view-detail th, #view-detail .spec-k'), x => x.textContent),
      body: document.querySelector('#view-detail').textContent,
      share: !!document.querySelector('#shareDetail'),
      wish: !!document.querySelector('#wishDetail')
    }));
    ok('the product code is shown', /SKU/.test(v.body), v.body.slice(0, 200));
    ok('the category is shown', /Women|Men|Accessories/.test(v.body));
    ok('low stock is spelled out, not counted', /only a few left/i.test(v.body));
    ok('there is a share button', v.share);
    ok('and a wishlist button', v.wish);
    await ctx.close();
  }
  {
    const { page, ctx, errors } = await shop(browser,
      { showSku: false, showCategory: false, sharing: false, wishlist: false }, '#/product/MF-1');
    await page.waitForTimeout(300);
    const v = await page.evaluate(() => ({
      body: document.querySelector('#view-detail').textContent,
      share: !!document.querySelector('#shareDetail'),
      wish: !!document.querySelector('#wishDetail')
    }));
    ok('no page errors with both buttons off', errors.length === 0, errors);
    ok('the product code can be hidden', !/SKU/.test(v.body));
    ok('the share button can be turned off', !v.share);
    ok('so can the wishlist button', !v.wish);
    await ctx.close();
  }

  console.log('\n== enquiries on a sold-out piece ==');
  {
    const { page, ctx } = await shop(browser, null, '#/product/AC-1');
    await page.waitForTimeout(300);
    ok('an enquiry button is offered by default',
       await page.evaluate(() => !!document.querySelector('#view-detail .btn-wa')));
    await ctx.close();
  }
  {
    const { page, ctx } = await shop(browser, { enquiries: false }, '#/product/AC-1');
    await page.waitForTimeout(300);
    ok('with enquiries off there is no button on a sold-out piece',
       await page.evaluate(() => !document.querySelector('#view-detail .btn-wa')));
    await ctx.close();
  }
  {
    const { page, ctx } = await shop(browser, { enquiries: false }, '#/product/MF-1');
    await page.waitForTimeout(300);
    ok('but a piece in stock still has its buy button',
       await page.evaluate(() => !!document.querySelector('#view-detail .btn-wa')));
    await ctx.close();
  }

  console.log('\n== reviews: showing and accepting are separate ==');
  {
    const { page, ctx } = await shop(browser, null);
    ok('reviews are shown by default',
       await page.evaluate(() => !document.querySelector('#reviews').classList.contains('hide')));
    ok('and can be written',
       await page.evaluate(() => !document.querySelector('#siteReviewBtn').classList.contains('hide')));
    await ctx.close();
  }
  {
    const { page, ctx } = await shop(browser, { customerReviews: false });
    ok('closing submissions leaves existing reviews on show',
       await page.evaluate(() => !document.querySelector('#reviews').classList.contains('hide')));
    ok('but takes away the write button',
       await page.evaluate(() => document.querySelector('#siteReviewBtn').classList.contains('hide')));
    ok('and clicking it anyway does nothing',
       await page.evaluate(() => {
         document.querySelector('#siteReviewBtn').click();
         var m = document.querySelector('#reviewModal');
         return !m || !m.classList.contains('open');
       }));
    await ctx.close();
  }
  {
    const { page, ctx, errors } = await shop(browser, { showReviews: false, customerReviews: false });
    ok('hiding reviews hides the whole section',
       await page.evaluate(() => document.querySelector('#reviews').classList.contains('hide')));
    ok('with no errors from the section that was skipped', errors.length === 0, errors);
    await ctx.close();
  }

  console.log('\n== the admin section ==');
  {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', e => errors.push(String(e)));
    p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await p.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript',
      body: "window.VBP_CONFIG={SUPABASE_URL:'https://x.supabase.co',SUPABASE_ANON_KEY:'k'};" }));
    await p.route('**/@supabase/supabase-js**', r => r.fulfill({ contentType: 'text/javascript', body: STUB }));
    await p.route('**/fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
    await p.route('**/api/products', r => r.fulfill({ contentType: 'application/json', body: '{"products":[]}' }));
    await p.goto('http://127.0.0.1:' + PORT + '/admin.html#/settings/shopping');
    await p.waitForSelector('#f_defaultSort', { timeout: 6000 });

    ok('no page errors', errors.length === 0, errors);
    const names = await p.evaluate(() =>
      Array.prototype.map.call(document.querySelectorAll('#setPage [id^=f_]'), e => e.id.slice(2)));
    const want = ['showOutOfStock','showBadges','showLowStock','showCategory','showSku',
                  'showReviews','defaultSort','enquiries','wishlist','sharing','customerReviews'];
    ok('all eleven settings are drawn', want.every(w => names.includes(w)),
       want.filter(w => !names.includes(w)));
    ok('the sort list matches the shop’s own',
       await p.$$eval('#f_defaultSort option', e => e.map(o => o.value))
         .then(v => JSON.stringify(v) === JSON.stringify(
           ['featured','price-asc','price-desc','name','available'])));

    // reviews hidden but still open for writing is a trap
    await p.evaluate(() => {
      document.querySelector('#f_showReviews').closest('.sw-row').click();
    });
    await p.waitForTimeout(120);
    await p.click('#setPage .save-bar .btn-gold');
    await p.waitForTimeout(150);
    ok('accepting reviews nobody can see is refused',
       await p.evaluate(() => document.querySelector('#f_customerReviews')
         .closest('.field').classList.contains('bad')));
    await p.evaluate(() => {
      document.querySelector('#f_customerReviews').closest('.sw-row').click();
    });
    await p.waitForTimeout(120);
    await p.click('#setPage .save-bar .btn-gold');
    await p.waitForTimeout(300);
    ok('turning both off saves',
       (await p.textContent('#setPage .save-bar .stat')).includes('Saved'),
       await p.textContent('#setPage .save-bar .stat'));
    const saved = await p.evaluate(() =>
      window.__saves.filter(s => s.payload.key === 'shopping').pop());
    ok('stored under the shopping key', !!saved);
    ok('with both review switches off',
       saved && saved.payload.data.showReviews === false &&
       saved.payload.data.customerReviews === false, saved && saved.payload.data);
    await ctx.close();
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})();
