/* =====================================================================
   Settings > SEO, and the addresses underneath it.

   The site used to live entirely behind a #. Every page shared one
   address, which to a search engine is one page: a sitemap would list a
   single entry and every canonical URL would be identical. Paths are
   real now, and most of what is checked here is the consequence of that
   change rather than the settings themselves.

   The check that matters most is the dullest one. With real addresses, a
   relative script src in index.html resolves against the page rather
   than the site: on /product/WF-1, "assets/app.js" becomes
   /product/assets/app.js and NOTHING loads. It cost the whole site while
   this was being built, and a test now stands over it.
   ===================================================================== */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8160;
const SEO = require(path.join(ROOT, 'assets/seo.js'));

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')); } };

const GENERAL = { businessName: 'Vaultique Boutique Point',
  tagline: 'Curated Elegance, Accessible Luxury', country: 'Zambia', city: 'Lusaka',
  currency: 'ZMW', numberFormat: '1,234.56',
  description: 'A premium fashion boutique in Lusaka, Zambia.',
  websiteStatus: 'live', maintenanceMode: false };

const SEOSET = { canonicalBase: 'https://vaultiqueboutique.com',
  sitemapEnabled: true, indexing: 'index',
  pages: { shop: { title: 'Shop the collection', description: 'Every piece currently in store.' } } };

const PRODUCTS = [{ name: 'Aurelia Silk Blouse', sku: 'WF-1', category: "Women's Fashion",
  price: 900, size: 'S', color: 'Cream', material: 'Silk', available: true, lowStock: false }];

/* The sharing picture belongs to Settings > Branding & Appearance, where
   it already lived before this section existed, so it is read from there
   rather than asked for twice. */
const BRANDING = { socialImage: 'https://x/share.jpg' };
const ctx = (seo, b) => ({ general: GENERAL, seo: seo || SEOSET,
  branding: b === undefined ? BRANDING : b, categories: ["Women's Fashion"] });

/* ------------------------------------------------------------------ */
/* the engine, with no browser                                          */
/* ------------------------------------------------------------------ */
console.log('\n== what each page says about itself ==');
{
  const home = SEO.forRoute(ctx(), '');
  ok('the home page borrows General, as it always did',
     home.title === 'Vaultique Boutique Point · Curated Elegance, Accessible Luxury · Zambia', home.title);
  ok('and General\'s description', home.description === GENERAL.description, home.description);
  ok('the canonical address is absolute',
     home.canonical === 'https://vaultiqueboutique.com/', home.canonical);

  const shop = SEO.forRoute(ctx(), 'shop');
  ok('a page with its own settings uses them', shop.title === 'Shop the collection', shop.title);
  ok('and its own description', shop.description === 'Every piece currently in store.');

  const pol = SEO.forRoute(ctx(), 'policies');
  ok('a page with none names itself and borrows the rest',
     pol.title === 'Policies · ' + home.title, pol.title);

  /* A shop with nothing saved here must read exactly as it did before
     this section existed. */
  const bare = SEO.forRoute({ general: GENERAL, seo: {} }, '');
  ok('a shop that never opens this page is unchanged',
     bare.title === home.title && bare.description === GENERAL.description, bare);
}

console.log('\n== a product describes itself ==');
{
  const v = SEO.forRoute(ctx(), 'product/WF-1', { product: PRODUCTS[0] });
  ok('the title leads with the piece',
     v.title === "Aurelia Silk Blouse · Women's Fashion · Vaultique Boutique Point", v.title);
  /* Nobody writes two hundred descriptions by hand. */
  ok('the description is built from what the piece is',
     /silk, in cream, size S/.test(v.description), v.description);
  ok('and says where to get it', /Lusaka/.test(v.description) && /WhatsApp/.test(v.description));
  ok('it is a product, not a page', v.type === 'product');
  ok('with its own address', v.canonical === 'https://vaultiqueboutique.com/product/WF-1');

  const hidden = SEO.forRoute(ctx(), 'product/WF-1',
    { product: Object.assign({}, PRODUCTS[0], { hidden: true }) });
  ok('a hidden piece is kept out of search', /noindex/.test(hidden.robots), hidden.robots);

  const cat = SEO.forRoute(ctx(), 'shop/Bags');
  ok('a category names itself over the shop settings',
     cat.title === 'Bags · Shop the collection', cat.title);
}

console.log('\n== pages that belong to one person ==');
{
  ['wishlist', 'account'].forEach(function (r) {
    const v = SEO.forRoute(ctx(), r);
    /* A page with somebody's name on it has no business in search
       results, and helps nobody who finds it. */
    ok('/' + r + ' is kept out of search', /noindex/.test(v.robots), v.robots);
    ok('and still lets a crawler follow its links', /follow/.test(v.robots));
  });
}

console.log('\n== the tags ==');
{
  const c = ctx();
  const tags = SEO.tagsFor(SEO.forRoute(c, ''), c);
  const by = {};
  tags.forEach(t => { by[t.property || t.name || t.kind] = t.content || t.href; });

  ok('a title', !!by.title);
  ok('a description', !!by.description);
  ok('og:title', !!by['og:title']);
  ok('og:image comes from Branding', by['og:image'] === 'https://x/share.jpg', by['og:image']);
  ok('og:url matches the canonical', by['og:url'] === by.link || !!by['og:url']);
  ok('a large twitter card, since there is an image',
     by['twitter:card'] === 'summary_large_image', by['twitter:card']);

  const noImg = SEO.tagsFor(SEO.forRoute(ctx({}, {}), ''), ctx({}, {}));
  const kinds = {};
  noImg.forEach(t => { kinds[t.property || t.name || t.kind] = t.content; });
  ok('and a small one when there is not', kinds['twitter:card'] === 'summary', kinds['twitter:card']);
  ok('no empty tags are written', noImg.every(t => (t.content || t.href || '').length > 0));

  const html = SEO.tagsHtml(tags);
  ok('the block is pasteable HTML', /^<title>/.test(html) && /<meta property="og:title"/.test(html));
  ok('and escapes what it is given',
     !/<script/.test(SEO.tagsHtml(SEO.tagsFor(
       SEO.forRoute({ general: { businessName: '<script>x</script>' }, seo: {} }, ''),
       { general: {}, seo: {} }))));
}

console.log('\n== the sharing image has one home ==');
{
  const seoAdmin = fs.readFileSync(path.join(ROOT, 'assets/admin/settings/seo.js'), 'utf8');
  const branding = fs.readFileSync(path.join(ROOT, 'assets/admin/settings/branding-appearance.js'), 'utf8');
  const theme = fs.readFileSync(path.join(ROOT, 'assets/theme.js'), 'utf8');
  ok('Branding offers the picture', /name: 'socialImage'/.test(branding));
  ok('SEO does not offer a second one', !/name: '(shareImage|ogImage)'/.test(seoAdmin));
  ok('and says where it lives', /Branding & Appearance/.test(seoAdmin));
  ok('only one place writes the tag', !/setMeta\(doc, 'og:image'/.test(theme));
}

console.log('\n== robots.txt ==');
{
  const txt = SEO.robotsTxt({ seo: SEOSET });
  ok('the admin is kept out', /Disallow: \/admin\.html/.test(txt));
  ok('so are accounts and wishlists', /Disallow: \/account/.test(txt) && /Disallow: \/wishlist/.test(txt));
  ok('the sitemap is announced', /Sitemap: https:\/\/vaultiqueboutique\.com\/sitemap\.xml/.test(txt));

  const closed = SEO.robotsTxt({ seo: { indexing: 'noindex' } });
  ok('a site kept out of search says so and nothing else',
     /Disallow: \/$/m.test(closed) && !/Sitemap/.test(closed), closed);

  const extra = SEO.robotsTxt({ seo: Object.assign({}, SEOSET, { robotsExtra: 'Disallow: /secret' }) });
  ok('extra lines are added', /Disallow: \/secret/.test(extra));
}

console.log('\n== sitemap.xml ==');
{
  const rows = SEO.sitemap(ctx(), PRODUCTS, [{ title: 'Delivery Policy' }]);
  const locs = rows.map(r => r.loc);
  ok('the home page', locs.includes('https://vaultiqueboutique.com/'));
  ok('the shop', locs.includes('https://vaultiqueboutique.com/shop'));
  ok('each category', locs.some(l => /\/shop\/Women/.test(l)), locs);
  ok('each piece', locs.includes('https://vaultiqueboutique.com/product/WF-1'));
  ok('each policy', locs.some(l => /policies\/delivery-policy/.test(l)), locs);
  /* Personal pages are not addresses to advertise. */
  ok('no wishlist or account', !locs.some(l => /wishlist|account/.test(l)));

  const withHidden = SEO.sitemap(ctx(), [Object.assign({}, PRODUCTS[0], { hidden: true })], []);
  ok('a hidden piece is not listed',
     !withHidden.some(r => /product/.test(r.loc)), withHidden.map(r => r.loc));

  const off = SEO.sitemap({ seo: { indexing: 'noindex' } }, PRODUCTS, []);
  ok('a site kept out of search offers nothing', off.length === 0);

  const xml = SEO.sitemapXml(rows);
  ok('it is valid-looking XML',
     /^<\?xml/.test(xml) && /<urlset/.test(xml) && /<\/urlset>/.test(xml.trim()));
}

/* The bug that cost the whole site. */
console.log('\n== nothing in the page is addressed relatively ==');
{
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const rel = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map(m => m[1])
    .filter(u => !/^(https?:)?\/\//.test(u) && !/^[/#]/.test(u) && !/^(mailto|tel|data):/.test(u));
  /* On /product/WF-1 a relative "assets/app.js" resolves to
     /product/assets/app.js. The page loads and nothing else does. */
  ok('every address in index.html is absolute or root-relative', rel.length === 0, rel);

  const app = fs.readFileSync(path.join(ROOT, 'assets/app.js'), 'utf8');
  const relImg = [...app.matchAll(/['"](images\/[^'"]+)['"]/g)].map(m => m[1]);
  ok('and every image the storefront reaches for at runtime', relImg.length === 0, relImg);
}

console.log('\n== the Netlify rules that make real addresses work ==');
{
  const toml = fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8');
  ok('unmatched paths are served the page', /from = "\/\*"[\s\S]{0,80}to = "\/index\.html"/.test(toml));
  ok('robots.txt is generated', /from = "\/robots\.txt"/.test(toml));
  ok('so is the sitemap', /from = "\/sitemap\.xml"/.test(toml));
  /* Relying on Netlify serving a file before a redirect would work, but
     relying on a default is relying on something a later change can
     quietly alter. */
  const catchAll = toml.indexOf('from = "/*"');
  ok('the admin is passed through before the catch-all',
     toml.indexOf('from = "/admin.html"') < catchAll);
  ok('so are the assets', toml.indexOf('from = "/assets/*"') < catchAll);
}

/* ------------------------------------------------------------------ */
/* the storefront                                                       */
/* ------------------------------------------------------------------ */
function server() {
  /* Netlify's catch-all, so /shop behaves here exactly as it will live. */
  return http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    let f = path.join(ROOT, p);
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(ROOT, 'index.html');
    fs.readFile(f, (e, d) => {
      if (e) { res.writeHead(404); res.end('no'); return; }
      res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' });
      res.end(d);
    });
  });
}

async function open(browser, url, seo) {
  const c = await browser.newContext();
  const page = await c.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript',
    body: "window.VBP_CONFIG={SUPABASE_URL:'https://x.supabase.co',SUPABASE_ANON_KEY:'k'};" }));
  await page.route('**/fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('**/maps**', r => r.fulfill({ contentType: 'text/html', body: '' }));
  await page.route('**/api/products', r => r.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ products: PRODUCTS }) }));
  await page.route('**/rest/v1/**', r => {
    const u = r.request().url();
    const j = x => ({ contentType: 'application/json', body: JSON.stringify(x) });
    if (u.includes('key=eq.general')) return r.fulfill(j([{ data: GENERAL }]));
    if (u.includes('key=eq.seo')) return r.fulfill(j(seo === null ? [] : [{ data: seo || SEOSET }]));
    if (u.includes('site_content')) return r.fulfill(j([{ data: {} }]));
    return r.fulfill(j([]));
  });
  await page.goto('http://127.0.0.1:' + PORT + url);
  await page.waitForTimeout(1300);
  return { page, ctx: c, errors };
}

const head = page => page.evaluate(() => ({
  path: location.pathname,
  hash: location.hash,
  title: document.title,
  desc: (document.querySelector('meta[name=description]') || {}).content,
  canonical: (function () {
    var l = document.querySelector('link[rel=canonical]');
    return l ? l.getAttribute('href') : '';
  })(),
  ogTitle: (document.querySelector('meta[property="og:title"]') || {}).content,
  ogType: (document.querySelector('meta[property="og:type"]') || {}).content,
  robots: (document.querySelector('meta[name=robots]') || {}).content || ''
}));

(async () => {
  const srv = server();
  await new Promise(r => srv.listen(PORT, r));
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  console.log('\n== real addresses ==');
  {
    const { page, ctx: c, errors } = await open(browser, '/shop');
    ok('no page errors', errors.length === 0, errors);
    /* If the assets had resolved relatively this would be a blank page. */
    ok('the shop loads at its own address',
       await page.evaluate(() => getComputedStyle(document.getElementById('view-shop')).display !== 'none'));
    const v = await head(page);
    ok('and says which page it is', v.title === 'Shop the collection', v.title);
    ok('with its own canonical address',
       v.canonical === 'https://vaultiqueboutique.com/shop', v.canonical);
    await c.close();
  }
  {
    const { page, ctx: c, errors } = await open(browser, '/product/WF-1');
    ok('a product loads two levels deep', errors.length === 0, errors);
    /* The one that broke everything: a relative src resolves against
       /product/, not the site. */
    ok('the stylesheet still applied',
       await page.evaluate(() => getComputedStyle(document.body).backgroundColor !== 'rgba(0, 0, 0, 0)'));
    const v = await head(page);
    ok('and the piece names itself',
       /Aurelia Silk Blouse/.test(v.title), v.title);
    ok('as a product', v.ogType === 'product');
    await c.close();
  }

  console.log('\n== old links still work ==');
  {
    /* Anyone with #/shop bookmarked, or sitting in a WhatsApp thread from
       months ago, has to land somewhere real. */
    const { page, ctx: c, errors } = await open(browser, '/#/policies');
    ok('no page errors', errors.length === 0, errors);
    const v = await head(page);
    ok('an old hash address becomes the real one', v.path === '/policies', v.path);
    ok('and the hash is gone from the bar', v.hash === '', v.hash);
    ok('the right page is shown',
       await page.evaluate(() => getComputedStyle(document.getElementById('view-policies')).display !== 'none'));
    await c.close();
  }

  console.log('\n== moving around does not reload ==');
  {
    const { page, ctx: c, errors } = await open(browser, '/');
    await page.evaluate(() => { window.__stayed = true; });
    await page.click('.foot-legal a[href="/policies"]');
    await page.waitForTimeout(400);
    ok('a link is followed without fetching the page again',
       await page.evaluate(() => window.__stayed === true));
    ok('the address changed', (await head(page)).path === '/policies');
    await page.goBack();
    await page.waitForTimeout(400);
    ok('and back returns home', (await head(page)).path === '/');
    ok('no page errors', errors.length === 0, errors);
    await c.close();
  }

  console.log('\n== a shop that has never opened this section ==');
  {
    const { page, ctx: c, errors } = await open(browser, '/', null);
    ok('no page errors', errors.length === 0, errors);
    const v = await head(page);
    ok('reads exactly as it did before',
       v.title === 'Vaultique Boutique Point · Curated Elegance, Accessible Luxury · Zambia', v.title);
    ok('with General\'s description', v.desc === GENERAL.description, v.desc);
    await c.close();
  }

  console.log('\n== a closed shop is not collecting search traffic ==');
  {
    const { page, ctx: c, errors } = await open(browser, '/',
      Object.assign({}, SEOSET));
    /* Settings > General closing the shop replaces the storefront with a
       notice. A notice has no business in search results — but the page
       is still shared, so it must keep saying whose shop it is. */
    await page.evaluate(() => {
      const S = window.VBP_SEO;
      const c = { general: { businessName: 'Vaultique Boutique Point' },
                  seo: { canonicalBase: 'https://vaultiqueboutique.com',
                         shareImage: 'https://x/share.jpg' } };
      const view = S.forRoute(c, '');
      view.robots = 'noindex, follow';
      S.apply(S.tagsFor(view, c));
    });
    const gated = await head(page);
    ok('a closed shop is marked noindex', /noindex/.test(gated.robots), gated.robots);
    ok('but a crawler may still follow its links', /follow/.test(gated.robots));
    ok('and the page still says whose shop it is', !!gated.ogTitle, gated);
    ok('no page errors', errors.length === 0, errors);
    await c.close();
  }

  console.log('\n== the admin page ==');
  {
    const c = await browser.newContext();
    const page = await c.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await page.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript',
      body: "window.VBP_CONFIG={SUPABASE_URL:'https://x.supabase.co',SUPABASE_ANON_KEY:'k'};" }));
    await page.route('**/fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
    await page.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ contentType: 'text/javascript', body: `
window.__rows={};
function tbl(name){var q={_v:null};
  q.select=function(){return q;};q.order=function(){return q;};q.eq=function(c,v){q._v=v;return q;};
  q.maybeSingle=function(){var r=window.__rows[name+':'+q._v];
    return Promise.resolve({data:r?JSON.parse(JSON.stringify(r)):null,error:null});};
  q.upsert=function(p){window.__rows[name+':'+(p.key!==undefined?p.key:p.id)]={data:JSON.parse(JSON.stringify(p)).data};
    return Promise.resolve({data:null,error:null});};
  q.then=function(f){return Promise.resolve({data:[],error:null}).then(f);};return q;}
window.supabase={createClient:function(){return{
  auth:{getSession:function(){return Promise.resolve({data:{session:{user:{id:'x'}}}});},signOut:function(){return Promise.resolve();}},
  from:tbl,storage:{from:function(){return{upload:function(){return Promise.resolve({data:null,error:null});},
  getPublicUrl:function(){return{data:{publicUrl:''}};}};}}};}};` }));
    await page.route('**/api/products', r => r.fulfill({ contentType: 'application/json', body: '{"products":[]}' }));
    await page.goto('http://127.0.0.1:' + PORT + '/admin.html#/settings/seo');
    await page.waitForTimeout(1400);

    ok('no page errors', errors.length === 0, errors);
    const groups = await page.$$eval('.card h3', a => a.map(e => e.textContent));
    ok('every group is drawn', groups.length === 6, groups);

    const snip = await page.textContent('.seo-snip');
    ok('the block to paste is shown', /<title>/.test(snip) && /og:title/.test(snip), snip);
    ok('it is HTML, ready to paste', /<meta property="og:site_name"/.test(snip));

    /* The one weakness of a block you paste by hand is forgetting to
       re-paste it. So the page reads what is actually deployed. */
    const drift = await page.evaluate(() => {
      const d = document.querySelector('.seo-drift');
      return d ? { cls: d.className, text: d.textContent } : null;
    });
    ok('the deployed file is checked', !!drift && /is-(ok|stale)/.test(drift.cls), drift);
    ok('and the shipped index.html is correctly called out of date',
       drift && /is-stale/.test(drift.cls) && /out of date/.test(drift.text), drift);

    ok('a search result is previewed', await page.$('.seo-serp') !== null);
    ok('and a shared card', await page.$('.seo-card') !== null);

    /* The section says plainly which of the asked-for pages are not
       pages, rather than offering settings that could do nothing. */
    const notes = await page.$$eval('.note-field strong', a => a.map(e => e.textContent));
    ok('it explains what a scraper can and cannot see',
       notes.some(t => /cannot come from the settings alone/i.test(t)), notes);
    ok('and that three of the six are not pages',
       notes.some(t => /not pages/i.test(t)), notes);

    await page.fill('#f_canonicalBase', 'vaultiqueboutique.com');
    await page.click('.save-bar .btn-gold');
    await page.waitForTimeout(300);
    ok('an address without https is refused',
       await page.evaluate(() => document.querySelector('#f_canonicalBase')
         .closest('.field').classList.contains('bad')));

    await page.fill('#f_canonicalBase', 'https://vaultiqueboutique.com');
    await page.fill('#f_page_shop_title', 'Shop the collection');
    await page.click('.save-bar .btn-gold');
    await page.waitForTimeout(400);
    const saved = await page.evaluate(() => (window.__rows['site_settings:seo'] || {}).data);
    ok('a sound setting saves', !!saved, saved);
    /* The boxes are flat so the form kit can draw them; the saved shape
       is nested so a page's settings stay together. */
    ok('page settings are folded into one place',
       saved && saved.pages && saved.pages.shop && saved.pages.shop.title === 'Shop the collection',
       saved && saved.pages);
    ok('and the flat boxes are not saved as settings',
       saved && !('page_shop_title' in saved), Object.keys(saved || {}).filter(k => /^page_/.test(k)));
    await c.close();
  }

  console.log('\n== both sides declare the same settings ==');
  {
    const read = (file, marker) => {
      const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
      const i = src.indexOf(marker);
      const j = src.indexOf('\n  };', i);
      const block = src.slice(i, j).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      return [...block.matchAll(/(\w+):/g)].map(m => m[1]).sort();
    };
    const front = read('assets/app.js', 'var SEOSET = {');
    const admin = read('assets/admin/settings/seo.js', 'var DEFAULTS = {');
    ok('the storefront knows every setting the admin offers',
       admin.every(k => front.includes(k)), admin.filter(k => !front.includes(k)));
    ok('and offers nothing the admin does not',
       front.every(k => admin.includes(k)), front.filter(k => !admin.includes(k)));
  }

  await browser.close();
  srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
