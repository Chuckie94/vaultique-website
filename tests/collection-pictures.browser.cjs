/* ===========================================================================
   COLLECTION PICTURES — driven in a real browser

   THE SHOP OWNER: "The categories are not displaying uploaded picture in
   admin settings, Home page."

   A picture uploaded in Settings > Homepage > Collection pictures was saved,
   and the homepage card stayed navy and gold anyway. The card routed the
   uploaded picture through preload(), which answers "no" whenever the admin
   is connected (it exists to stop the site probing the images folder for
   files that are not there). So with the admin connected -- which is the only
   way a picture can be uploaded at all -- no upload was ever drawn.

   Driven against the real page with the admin connected, because that is the
   one arrangement the bug lived in.
   =========================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');

let checks = 0, failures = 0;
const ok   = m => { checks++; console.log('  ✓ ' + m); };
const fail = (m, extra) => { checks++; failures++; console.log('  ✗ ' + m + (extra ? '\n      ' + extra : '')); };
const is   = (c, m, extra) => c ? ok(m) : fail(m, extra);

const P = (over) => Object.assign({
  name: 'Piece', sku: '', category: 'Bags', price: 500, size: '', color: '',
  material: '', available: true, lowStock: false, wasPrice: 0, brand: '',
  description: '', details: [], variantGroup: ''
}, over);

const CATALOGUE = [
  P({ name: 'Kudu Leather Satchel', sku: 'BG-KULE-BR-OS', category: 'Bags' }),
  P({ name: 'Kitenge Wrap Dress', sku: 'WF-KIWR-BK-S', category: "Women's Fashion" })
];

/* The picture the owner uploaded for Bags. Women's Fashion has none, and
   must keep the navy and gold card. */
const UPLOADED = '/storage/v1/object/public/product-images/homepage/collection-bags-1.png';
const HOMEPAGE = { col_bags: null };   // filled in once the port is known

/* One real pixel, so the browser's Image() genuinely loads it. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/json'
};
const SUPABASE_STUB = `
window.supabase = { createClient: function () {
  return { channel: function () { var ch = { on: function(){ return ch; }, subscribe: function(){ return ch; } }; return ch; },
           removeChannel: function () {} }; } };`;

function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      const p = u.pathname;
      if (p === '/api/products') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({
          products: CATALOGUE, count: CATALOGUE.length,
          generatedAt: new Date().toISOString(),
          version: crypto.createHash('sha1').update(JSON.stringify(CATALOGUE)).digest('hex').slice(0, 12)
        }));
        return;
      }
      if (p === UPLOADED) { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(PNG); return; }
      if (p === '/rest/v1/site_settings' && u.searchParams.get('key') === 'eq.homepage') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([{ data: HOMEPAGE }]));
        return;
      }
      if (p.indexOf('/rest/v1/') === 0) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('[]'); return; }
      if (p === '/config.js') {
        /* The admin IS connected, and LOCAL_IMAGES is left unset: the
           arrangement every real shop runs, and the one the bug lived in. */
        res.writeHead(200, { 'Content-Type': TYPES['.js'] });
        res.end('window.VBP_CONFIG={SUPABASE_URL:"http://127.0.0.1:' + server.address().port + '",SUPABASE_ANON_KEY:"test-anon-key"};');
        return;
      }
      if (p === '/__stub.js') { res.writeHead(200, { 'Content-Type': TYPES['.js'] }); res.end(SUPABASE_STUB); return; }
      let file = path.join(ROOT, p);
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, 'index.html');
      let html = null;
      if (file.endsWith('index.html')) {
        html = fs.readFileSync(file, 'utf8')
          .replace('<script src="/config.js"></script>', '<script src="/config.js"></script>\n<script src="/__stub.js"></script>');
      }
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream' });
      res.end(html !== null ? html : fs.readFileSync(file));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

(async () => {
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port;
  HOMEPAGE.col_bags = base + UPLOADED;
  HOMEPAGE.philosophyImage = base + UPLOADED;
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    await page.goto(base + '/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);

    console.log('\nThe homepage collection cards, with the admin connected');

    const cards = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#collections .col-card')).map(c => {
        const ph = c.querySelector('.ph');
        return {
          name: ((c.querySelector('.n') || {}).textContent || '').trim(),
          bg: ph ? ph.style.backgroundImage : '',
          fallback: ph ? ph.classList.contains('fallback') : null
        };
      }));
    const bags = cards.filter(c => c.name === 'Bags')[0];
    const women = cards.filter(c => c.name === "Women's Fashion")[0];

    is(cards.length === 2, 'a card for each category the platform sent', JSON.stringify(cards));
    is(!!bags && bags.bg.indexOf('collection-bags-1.png') !== -1 && bags.fallback === false,
       'the card whose picture was uploaded in the admin shows that picture', JSON.stringify(bags));
    is(!!women && !women.bg && women.fallback === true,
       'and a category with nothing uploaded keeps the navy and gold card', JSON.stringify(women));

    console.log('\nThe philosophy band, with a photo uploaded in Settings > Homepage');
    await page.waitForTimeout(400);
    const band = await page.evaluate(() => {
      const img = document.querySelector('#philosophy .ed-img');
      return { bg: img.style.backgroundImage, hidden: img.classList.contains('no-photo'),
               h: Math.round(img.getBoundingClientRect().height) };
    });
    is(band.bg.indexOf('collection-bags-1.png') !== -1 && !band.hidden && band.h > 0,
       'the uploaded photo fills the photo half instead of it being taken away', JSON.stringify(band));
  } catch (e) {
    fail('threw: ' + (e && e.message || e));
  } finally {
    await browser.close();
    server.close();
  }

  console.log('\n' + (failures ? '  ✗ ' + failures + ' of ' + checks + ' checks FAILED'
                                : '  collection pictures in the browser: all ' + checks + ' checks passed'));
  process.exit(failures ? 1 : 0);
})();
