/* ===========================================================================
   NEW ARRIVALS THAT LEAVE ON THEIR OWN, AND "ALL PRODUCTS" -- in a browser

   THE OWNER: "put a setting to set how long products can stay under new
   arrivals. Then products shouldn't go under accessories."

   A piece ticked New stays under New Arrivals for the days set in Settings >
   Homepage, counted from the day it was ticked. The old Accessories row,
   which caught bags and shoes by their category name, is now All Products.
   =========================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');

let checks = 0, failures = 0;
const is = (c, m, x) => { checks++; if (c) console.log('  ✓ ' + m); else { failures++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); } };

const P = (name, sku, category, over) => Object.assign({ name, sku, category, price: 500, size: 'M', color: 'Black',
  material: '', available: true, lowStock: false, wasPrice: 0, brand: '', description: '', details: [] }, over || {});
const CATALOGUE = [
  P('Crossbody Tote Sling', 'BG-1', 'PU Leather Handbags'),
  P('Urban Simplicity', 'BG-2', 'Leather Handbags'),
  P('Slip-on Loafer', 'SH-1', 'PU Male Shoes'),
  P('Silk Scarf', 'AC-1', 'Accessories', { available: false, soldOutSince: new Date(Date.now() - 10 * 86400000).toISOString() })
];
const day = 86400000;
let META = [
  { sku: 'BG-1', is_new: true, new_since: new Date(Date.now() - 3 * day).toISOString() },   // 3 days
  { sku: 'BG-2', is_new: true, new_since: new Date(Date.now() - 45 * day).toISOString() },  // 45 days
  { sku: 'SH-1', is_new: false, new_since: null }
];
let HOME = { newArrivalDays: 30 };
let SHOPPING = {};

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/json' };
const STUB = `window.supabase = { createClient: function () { return { channel: function () { var ch = { on: function(){ return ch; }, subscribe: function(){ return ch; } }; return ch; }, removeChannel: function () {} }; } };`;

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x'); const p = u.pathname;
      const json = (d) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d)); };
      if (p === '/api/products') return json({ products: CATALOGUE, count: CATALOGUE.length, version: 'v1', generatedAt: new Date().toISOString() });
      if (p === '/rest/v1/product_meta') return json(META);
      if (p === '/rest/v1/site_settings' && /homepage/.test(u.searchParams.get('key') || '')) return json([{ data: HOME }]);
      if (p === '/rest/v1/site_settings' && /shopping/.test(u.searchParams.get('key') || '')) return json([{ data: SHOPPING }]);
      if (p.indexOf('/rest/v1/') === 0) return json([]);
      if (p === '/config.js') { res.writeHead(200, { 'Content-Type': TYPES['.js'] }); res.end('window.VBP_CONFIG={SUPABASE_URL:"http://127.0.0.1:' + server.address().port + '",SUPABASE_ANON_KEY:"k"};'); return; }
      if (p === '/__stub.js') { res.writeHead(200, { 'Content-Type': TYPES['.js'] }); res.end(STUB); return; }
      let file = path.join(ROOT, p);
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, 'index.html');
      let body = fs.readFileSync(file);
      if (file.endsWith('index.html')) body = body.toString().replace('<script src="/config.js"></script>', '<script src="/config.js"></script>\n<script src="/__stub.js"></script>');
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' }); res.end(body);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

(async () => {
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const row = (id) => page.evaluate((i) => {
    const t = document.getElementById(i), sec = t && t.closest('section');
    return { shown: !!sec && sec.style.display !== 'none' && !sec.classList.contains('hide'),
             names: Array.prototype.map.call(t ? t.children : [], (c) => (c.querySelector('.n') || c).textContent.trim()) };
  }, id);
  const open = async () => { await page.goto(base + '/', { waitUntil: 'networkidle' }); await page.waitForTimeout(700); };
  try {
    console.log('\nNew Arrivals, 30 days');
    await open();
    let r = await row('row-new');
    is(r.shown && r.names.length === 1 && /Crossbody/.test(r.names[0]), 'ticked 3 days ago: shown; ticked 45 days ago: gone by itself', JSON.stringify(r));

    console.log('\nThe days come from Settings > Homepage');
    HOME = { newArrivalDays: 60 }; await open();
    r = await row('row-new');
    is(r.names.length === 2 && /Crossbody/.test(r.names[0]), 'at 60 days both are new, the newest first', JSON.stringify(r.names));
    HOME = { newArrivalDays: 0 }; await open();
    is((await row('row-new')).names.length === 2, '0 keeps a piece new until it is unticked');
    HOME = { newArrivalDays: 1 }; await open();
    r = await row('row-new');
    is(!r.shown, 'and with nothing new the row hides, rather than calling old pieces new', JSON.stringify(r));
    const badge = await page.evaluate(() => document.body.textContent.indexOf('New In') > -1);
    is(!badge, 'and no card anywhere still says New In');

    console.log('\nAll Products, not Accessories');
    HOME = { newArrivalDays: 30 }; await open();
    r = await row('row-acc');
    const head = await page.evaluate(() => document.querySelector('#sec-acc h2').textContent);
    is(head === 'All Products', 'the row is called All Products', head);
    is(r.names.length === 4 && /Silk Scarf/.test(r.names[3]), 'it shows pieces from across the shop, in stock first', JSON.stringify(r.names));
    const acc = await page.evaluate(() => /\bAccessories\b/.test(document.getElementById('sec-acc').textContent));
    is(!acc, 'and bags and shoes are no longer filed under "Accessories"');

    console.log('\nSold out: when a piece leaves');
    const scarf = async () => {
      await open();
      const home = (await row('row-acc')).names.some((n) => /Silk Scarf/.test(n));
      await page.goto(base + '/#/shop', { waitUntil: 'networkidle' }); await page.waitForTimeout(500);
      const shop = await page.evaluate(() => /Silk Scarf/.test(document.getElementById('grid') ? document.getElementById('grid').textContent : document.body.textContent));
      await page.evaluate(() => { const i = document.getElementById('soInput'); if (i) { i.value = 'scarf'; i.dispatchEvent(new Event('input', { bubbles: true })); } });
      await page.waitForTimeout(200);
      const found = await page.evaluate(() => { const h = document.getElementById('soResults'); return !!h && /Silk Scarf/.test(h.textContent); });
      return { home, shop, found };
    };
    SHOPPING = { showOutOfStock: true, soldOutDays: 0 };
    let sc = await scarf();
    is(sc.home && sc.shop && sc.found, 'sold out 10 days, "hide after" 0: still shown everywhere, marked sold out', JSON.stringify(sc));
    SHOPPING = { showOutOfStock: true, soldOutDays: 7 };
    sc = await scarf();
    is(!sc.home && !sc.shop && !sc.found, 'with "hide after 7 days": gone from the homepage, the shop and search', JSON.stringify(sc));
    SHOPPING = { showOutOfStock: true, soldOutDays: 30 };
    sc = await scarf();
    is(sc.home && sc.shop, 'with 30 days: still shown, it has only been 10', JSON.stringify(sc));
    SHOPPING = { showOutOfStock: false };
    sc = await scarf();
    is(!sc.home && !sc.shop && !sc.found, '"Show sold-out pieces" off now hides it from the homepage too, not only the shop', JSON.stringify(sc));
    SHOPPING = {};
  } catch (e) {
    is(false, 'the test itself broke', e && e.stack);
  } finally {
    await browser.close(); server.close();
  }
  console.log(failures ? '\n  ✗ ' + failures + ' of ' + checks + ' checks FAILED' : '\n  new arrivals: all ' + checks + ' checks passed');
  process.exit(failures ? 1 : 0);
})();
