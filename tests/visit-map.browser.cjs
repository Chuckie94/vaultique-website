/* ===========================================================================
   THE MAP PINS THE SHOP'S OWN PLACES — driven in a real browser

   THE OWNER: "remove based in zambia, delivering nationwide wording. Then on
   the map, the red location icon should be where the store is currently
   listed. If 10 places are listed, it should show exactly those places."

   The map was a Google map of the word "Zambia", so its pin sat in the middle
   of the country. It is now drawn from Settings > General.

   The several-places map uses Leaflet from cdnjs. This test serves Leaflet
   from a local copy (npm install leaflet) and skips that part if there is none.
   =========================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
let LEAFLET = null;
try { LEAFLET = path.dirname(require.resolve('leaflet/dist/leaflet.js')); } catch (e) {}

let checks = 0, failures = 0;
const ok   = m => { checks++; console.log('  ✓ ' + m); };
const fail = (m, extra) => { checks++; failures++; console.log('  ✗ ' + m + (extra ? '\n      ' + extra : '')); };
const is   = (c, m, extra) => c ? ok(m) : fail(m, extra);

const CATALOGUE = [{ name: 'Tote', sku: 'A1', category: 'Bags', price: 700, size: '', color: '', material: '',
  available: true, lowStock: false, wasPrice: 0, brand: '', description: '', details: [], variantGroup: '', maxQty: 3 }];
let GENERAL = {};
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' };
const STUB = `window.supabase = { createClient: function () { return { channel: function () { var ch = { on: function(){ return ch; }, subscribe: function(){ return ch; } }; return ch; }, removeChannel: function () {} }; } };`;

function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x'), p = u.pathname;
      if (p === '/api/products') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ products: CATALOGUE, version: 'v1' })); return; }
      if (p === '/rest/v1/site_settings' && u.searchParams.get('key') === 'eq.general') {
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify([{ data: GENERAL }])); return;
      }
      if (p.indexOf('/rest/v1/') === 0) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('[]'); return; }
      if (p === '/config.js') { res.writeHead(200, { 'Content-Type': TYPES['.js'] }); res.end('window.VBP_CONFIG={SUPABASE_URL:"http://127.0.0.1:' + server.address().port + '",SUPABASE_ANON_KEY:"k"};'); return; }
      if (p === '/__stub.js') { res.writeHead(200, { 'Content-Type': TYPES['.js'] }); res.end(STUB); return; }
      let file = path.join(ROOT, p);
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, 'index.html');
      let html = null;
      if (file.endsWith('index.html')) html = fs.readFileSync(file, 'utf8').replace('<script src="/config.js"></script>', '<script src="/config.js"></script>\n<script src="/__stub.js"></script>');
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(html !== null ? html : fs.readFileSync(file));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

(async () => {
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.route(/google\.com\/maps/, r => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>map</p>' }));
  await page.route(/tile\.openstreetmap\.org/, r => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/leaflet\/1\.9\.4\/(.*)$/, r => {
    const name = r.request().url().split('/').pop().replace('.min', '');
    if (!LEAFLET) return r.abort();
    r.fulfill({ status: 200, contentType: name.endsWith('.css') ? 'text/css' : 'text/javascript',
                body: fs.readFileSync(path.join(LEAFLET, name)) });
  });
  const open = async () => { await page.goto(base + '/', { waitUntil: 'networkidle' }); await page.waitForTimeout(800); };
  const mapSrc = () => page.evaluate(() => { const f = document.querySelector('#visitMap'); return f && f.tagName === 'IFRAME' ? decodeURIComponent(f.src) : null; });

  try {
    console.log('\nThe heading');
    GENERAL = { country: 'Zambia', city: 'Livingstone', address: 'Mosi-oa-Tunya Road' };
    await open();
    is(!/Based in Zambia, delivering nationwide/.test(await page.evaluate(() => document.querySelector('#visit').textContent)),
       '"Based in Zambia, delivering nationwide" is gone');

    console.log('\nOne shop');
    let src = await mapSrc();
    is(src && /q=Mosi-oa-Tunya Road, Livingstone, Zambia/.test(src),
       'before its position is known, the map searches for the address, not for "Zambia"', src);
    GENERAL.mapPoints = [{ name: 'Vaultique', address: 'Mosi-oa-Tunya Road', query: 'x', lat: -17.85, lng: 25.85 }];
    await open();
    src = await mapSrc();
    is(src && /q=-17\.85,25\.85/.test(src), 'once it is known, the pin sits on exactly that spot', src);

    console.log('\nThree shops');
    if (!LEAFLET) { console.log('  (skipped: npm install leaflet to run these)'); }
    else {
      GENERAL.locations = [{ name: 'Lusaka', address: 'Manda Hill' }, { name: 'Kitwe', address: 'Kitwe Mall' }];
      GENERAL.mapPoints = GENERAL.mapPoints.concat([
        { name: 'Lusaka', address: 'Manda Hill', query: 'y', lat: -15.40, lng: 28.30 },
        { name: 'Kitwe', address: 'Kitwe Mall', query: 'z', lat: -12.80, lng: 28.20 }]);
      await open();
      await page.evaluate(() => document.querySelector('#visit').scrollIntoView());
      await page.waitForTimeout(800);
      const pins = await page.evaluate(() => Array.from(document.querySelectorAll('#visitMap .visit-pin')).map(p => p.getAttribute('title')));
      is(pins.length === 3, 'a red pin for each of the three places, and no others', JSON.stringify(pins));
      is(['Vaultique', 'Lusaka', 'Kitwe'].every(n => pins.indexOf(n) > -1), 'each named for its shop', JSON.stringify(pins));
      const loc = await page.evaluate(() => document.querySelector('#locVal').innerText);
      is(/Lusaka/.test(loc) && /Kitwe/.test(loc), 'and the Location line lists them too', loc);
      if (process.env.SHOT) await page.locator('#visit').screenshot({ path: process.env.SHOT });
    }
  } catch (e) {
    fail('threw: ' + (e && e.message || e));
  } finally {
    await browser.close(); server.close();
  }
  console.log('\n' + (failures ? '  ✗ ' + failures + ' of ' + checks + ' checks FAILED'
                                : '  the visit map: all ' + checks + ' checks passed'));
  process.exit(failures ? 1 : 0);
})();
