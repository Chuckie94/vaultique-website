/* ===========================================================================
   THE PHONE FIT — driven in a real browser

   THE OWNER: "make the layout and display on the phone smaller so that the
   fit doesn't display bigger icons. Just for the phone." And of the product
   cards: "shrink the size".

   Measured at 390px, the width of most phones in hand today, the storefront
   was built from desktop parts: a 74px header with its icons bunched against
   the logo, three round buttons of 46-56px over the pieces, the shop's filter
   panel pinned across a third of the screen, one 470px category card per row,
   and product cards 500px tall with two stacked buttons whose words did not
   fit on one line.

   Checked here against the real page: that those came down on a phone, that
   nothing on a phone scrolls sideways at the common widths, and that a
   desktop is exactly as it was -- the owner asked for the phone only.
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
  name: 'Piece', sku: '', category: 'Bags', price: 500, size: 'One size', color: '',
  material: '', available: true, lowStock: false, wasPrice: 0, brand: 'Vaultique Atelier',
  description: 'Cut and finished by hand.', details: [], variantGroup: '', maxQty: 5
}, over);

const CATALOGUE = [
  P({ name: 'Kitenge Wrap Dress', sku: 'WF-KIWR-BK-M', category: "Women's Fashion", color: 'Black', size: 'M', price: 940,
      details: [{ label: 'Style', value: 'Wrap' }, { label: 'Pattern', value: 'Block print' },
                { label: 'Closure Type', value: 'Tie' }, { label: 'Season', value: 'All season' },
                { label: 'Gender', value: 'Women' }, { label: 'Unit Weight', value: '0.4 kg' }] }),
  P({ name: 'Linen Shirt', sku: 'MF-LISH-WH-L', category: "Men's Fashion", color: 'White', size: 'L', price: 650 }),
  P({ name: 'Kudu Leather Satchel', sku: 'BG-KULE-BR-OS', color: 'Brown', price: 3200 }),
  P({ name: 'Heritage Suede Belt', sku: 'AC-HESU-BR-L', category: 'Accessories', color: 'Brown', size: 'L', price: 290 })
];

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
      const p = new URL(req.url, 'http://x').pathname;
      if (p === '/api/products') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ products: CATALOGUE, count: CATALOGUE.length, generatedAt: new Date().toISOString(),
          version: crypto.createHash('sha1').update(JSON.stringify(CATALOGUE)).digest('hex').slice(0, 12) }));
        return;
      }
      if (p.indexOf('/rest/v1/') === 0) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('[]'); return; }
      if (p === '/config.js') {
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

const box = (page, sel) => page.evaluate(s => {
  const e = document.querySelector(s);
  if (!e) return null;
  const b = e.getBoundingClientRect();
  return { x: b.left, y: b.top, w: b.width, h: b.height, r: b.right, b: b.bottom };
}, sel);
const sideways = page => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const settle = (page, ms) => page.waitForTimeout(ms || 500);

(async () => {
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();

  try {
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await phone.newPage();

    console.log('\nThe header, on a 390px phone');
    await page.goto(base + '/', { waitUntil: 'networkidle' }); await settle(page, 800);
    const nav = await box(page, 'header.site .nav');
    is(nav && nav.h <= 62, 'the header is 60px, down from 74', JSON.stringify(nav));
    const menu = await box(page, '#menuBtn');
    is(menu && 390 - menu.r <= 24, 'the icons sit at the right-hand edge, not bunched against the logo', JSON.stringify(menu));
    const icon = await box(page, '#searchBtn svg');
    is(icon && icon.w <= 19.5, 'and are drawn smaller', JSON.stringify(icon));

    console.log('\nThe round buttons in the corner');
    const fab = await box(page, '.fab');
    is(fab && fab.w <= 46 && fab.h <= 46, 'the WhatsApp button is 46px, down from 56', JSON.stringify(fab));
    const chatShown = await page.evaluate(() => !document.querySelector('#chatFab').classList.contains('hide'));
    if (chatShown) {
      const chat = await box(page, '#chatFab');
      is(chat && chat.w <= 46, 'the chat button likewise', JSON.stringify(chat));
      is(fab.b <= chat.y, 'and WhatsApp sits above it rather than on top of it');
    }
    await page.evaluate(() => document.querySelector('#chatFab').classList.add('hide'));
    const alone = await box(page, '.fab');
    is(alone && 844 - alone.b <= 14, 'with chat switched off, WhatsApp drops into its slot instead of floating over a gap',
       JSON.stringify(alone));
    await page.evaluate(() => document.querySelector('#chatFab').classList.remove('hide'));

    console.log('\nThe homepage');
    const cols = await page.evaluate(() => Array.from(document.querySelectorAll('#collections .col-card'))
      .slice(0, 2).map(c => { const b = c.getBoundingClientRect(); return { y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; }));
    is(cols.length === 2 && cols[0].y === cols[1].y && cols[0].w < 200,
       'categories are two to a row', JSON.stringify(cols));
    is(cols.length === 2 && cols[0].h < 260, 'and each is well under half the height it was', JSON.stringify(cols));
    const tall = await page.evaluate(() => document.documentElement.scrollHeight);
    is(tall < 12500, 'the whole homepage is over a quarter shorter to scroll (was 15,759px)', String(tall));

    console.log('\nThe shop');
    await page.goto(base + '/shop', { waitUntil: 'networkidle' }); await settle(page);
    const pos = await page.evaluate(() => getComputedStyle(document.querySelector('.shop-toolbar')).position);
    is(pos === 'static', 'the filter panel scrolls away instead of staying pinned over the pieces', pos);
    const card = await box(page, '#grid .card');
    is(card && card.h < 360, 'a product card is much shorter (it was 487px)', JSON.stringify(card));
    const row = await page.evaluate(() => {
      const line = document.querySelector('#grid .card .wa-line');
      const wa = line.querySelector('.btn-wa').getBoundingClientRect();
      const cb = line.querySelector('.btn-cart');
      const b = cb.getBoundingClientRect();
      return { waTop: Math.round(wa.top), cartTop: Math.round(b.top), cartW: Math.round(b.width), waH: Math.round(wa.height),
               waW: Math.round(wa.width), cartH: Math.round(b.height),
               words: cb.querySelector('.btn-cart-t') ? getComputedStyle(cb.querySelector('.btn-cart-t')).display : 'no span',
               label: cb.getAttribute('aria-label') };
    });
    is(row.waTop === row.cartTop, 'buying and the cart share one row', JSON.stringify(row));
    is(row.words !== 'none', 'both keep their words', JSON.stringify(row));
    is(Math.abs(row.waW - row.cartW) <= 1 && row.waH === row.cartH,
       'and the two are the same size, half the card each', JSON.stringify(row));
    is(row.label === 'Add to cart', 'and still says "Add to cart" to a screen reader', row.label);
    is(row.waH <= 36, 'and both are slim', JSON.stringify(row));
    await page.click('#grid .card .btn-cart'); await settle(page, 1700);
    const inCart = await page.evaluate(() => (document.querySelector('#grid .card .btn-cart').textContent || '').trim());
    is(/In cart · 1/.test(inCart), 'once added, it says so', inCart);

    console.log('\nA piece\'s own page');
    await page.click('#grid .card .card-info .n'); await settle(page, 700);
    const acc = await page.evaluate(() => {
      const body = document.querySelector('#view-detail .acc-item.open .acc-body');
      if (!body) return null;
      return { shown: Math.round(body.getBoundingClientRect().height), content: body.firstElementChild.scrollHeight };
    });
    is(acc && acc.shown >= acc.content, 'the product details open in full, not cut off after the first line',
       JSON.stringify(acc));
    const btn = await page.evaluate(() => {
      const b = document.querySelector('#view-detail .btn-cart');
      const t = b && b.querySelector('.btn-cart-t');
      return t ? getComputedStyle(t).display : null;
    });
    is(btn && btn !== 'none', 'the full-width cart button there keeps its words', String(btn));

    console.log('\nNothing scrolls sideways');
    for (const width of [320, 360, 390, 414]) {
      const ctx = await browser.newContext({ viewport: { width, height: 760 }, isMobile: true, hasTouch: true });
      const pg = await ctx.newPage();
      const over = [];
      for (const route of ['/', '/shop', '/product/WF-KIWR-BK-M']) {
        await pg.goto(base + route, { waitUntil: 'networkidle' }); await settle(pg, 500);
        const d = await sideways(pg);
        if (d > 0) over.push(route + ' by ' + d + 'px');
      }
      is(!over.length, 'at ' + width + 'px wide', over.join(', '));
      await ctx.close();
    }

    console.log('\nA desktop is exactly as it was');
    const desk = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await desk.goto(base + '/', { waitUntil: 'networkidle' }); await settle(desk, 800);
    const dnav = await box(desk, 'header.site .nav');
    is(dnav && Math.round(dnav.h) === 74, 'the header is still 74px', JSON.stringify(dnav));
    const dfab = await box(desk, '.fab');
    is(dfab && dfab.h > 46, 'the WhatsApp button keeps its desktop size and label', JSON.stringify(dfab));
    const dcols = await desk.evaluate(() => Array.from(document.querySelectorAll('#collections .col-card'))
      .map(c => Math.round(c.getBoundingClientRect().top)));
    is(dcols.length === 4 && dcols.every(y => y === dcols[0]), 'the categories are still four across', JSON.stringify(dcols));
    await desk.goto(base + '/shop', { waitUntil: 'networkidle' }); await settle(desk);
    const dpos = await desk.evaluate(() => getComputedStyle(document.querySelector('.shop-toolbar')).position);
    is(dpos === 'sticky', 'the filter panel still follows the page down', dpos);
    const dwords = await desk.evaluate(() => {
      const t = document.querySelector('#grid .btn-cart .btn-cart-t');
      return t ? getComputedStyle(t).display : null;
    });
    is(dwords && dwords !== 'none', 'and the card\'s cart button still says "Add to cart"', String(dwords));
  } catch (e) {
    fail('threw: ' + (e && e.message || e));
  } finally {
    await browser.close();
    server.close();
  }

  console.log('\n' + (failures ? '  ✗ ' + failures + ' of ' + checks + ' checks FAILED'
                                : '  the phone fit: all ' + checks + ' checks passed'));
  process.exit(failures ? 1 : 0);
})();
