/* ===========================================================================
   MOTION, USED SPARINGLY -- driven in a real browser

   THE OWNER: "Gentle fades when pages and photos appear, a soft zoom when you
   hover over a piece, and a small confirmation when something is added to the
   cart." And: "why can't products auto swipe? You can add a setting to switch
   this on. Even those displayed can still auto swipe, not just selected
   products."

   Checks the photos move by themselves only when Settings > Shopping says so,
   on the piece's page and on the cards; that the customer taking over stops
   them; and the page fade, photo fade and cart confirmation.
   =========================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');

let checks = 0, failures = 0;
const is = (c, m, x) => { checks++; if (c) console.log('  ✓ ' + m); else { failures++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); } };

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const piece = (o) => Object.assign({ category: 'Bags', size: '', color: '', material: '', available: true,
  lowStock: false, wasPrice: 0, brand: '', description: 'A piece.', details: [], variantGroup: '', maxQty: 5 }, o);
const CATALOGUE = [
  piece({ name: 'Woven Tote', sku: 'BG-WOTO', price: 1150, image_url: '/pic/tote-1.png',
          gallery: ['/pic/tote-2.png', '/pic/tote-3.png'] }),
  piece({ name: 'Leather Satchel', sku: 'BG-SATC', price: 3200, image_url: '/pic/satchel-1.png',
          gallery: ['/pic/satchel-2.png'] })
];
let SHOPPING = { photoAutoSwipe: true, photoSwipeSeconds: 2 };

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/json' };
const STUB = `window.supabase = { createClient: function () { return { channel: function () {
  var ch = { on: function () { return ch; }, subscribe: function () { return ch; } }; return ch; },
  removeChannel: function () {} }; } };`;

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), p = u.pathname;
  if (p === '/api/products') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ products: CATALOGUE, count: CATALOGUE.length, version: 'm1' }));
  }
  if (p.indexOf('/pic/') === 0) { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(PNG); }
  if (p === '/rest/v1/site_settings' && u.searchParams.get('key') === 'eq.shopping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify([{ data: SHOPPING }]));
  }
  if (p.indexOf('/rest/v1/') === 0) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('[]'); }
  if (p === '/config.js') {
    res.writeHead(200, { 'Content-Type': TYPES['.js'] });
    return res.end('window.VBP_CONFIG={SUPABASE_URL:"http://127.0.0.1:' + server.address().port + '",SUPABASE_ANON_KEY:"k"};');
  }
  if (p === '/__stub.js') { res.writeHead(200, { 'Content-Type': TYPES['.js'] }); return res.end(STUB); }
  let file = path.join(ROOT, p);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, 'index.html');
  let body = fs.readFileSync(file);
  if (file.endsWith('index.html')) body = String(body).replace('<script src="/config.js"></script>',
    '<script src="/config.js"></script>\n<script src="/__stub.js"></script>');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  res.end(body);
});

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const errors = [];
  async function open(url, opts) {
    const ctx = await browser.newContext(Object.assign({ viewport: { width: 1366, height: 900 } }, opts || {}));
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(String(e.message || e)));
    await page.goto(base + url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    return page;
  }
  /* Which photo is chosen, read from the counter ("2 / 3"): the photo itself
     only takes its new picture once the cross-fade has finished. */
  const gal = page => page.evaluate(() => (document.querySelector('#galCount') || {}).textContent);
  try {
    console.log('\nA piece\'s own page, with photos swiping switched on');
    let page = await open('/product/BG-WOTO');
    const first = await gal(page);
    await page.waitForTimeout(2600);
    const second = await gal(page);
    is(first && second && first !== second, 'the photos move on by themselves', first + ' → ' + second);

    await page.hover('#galMain');
    const held = await gal(page);
    await page.waitForTimeout(2600);
    is(await gal(page) === held, 'pointing at the photo holds it still');
    await page.mouse.move(5, 5);
    await page.waitForTimeout(2600);
    is(await gal(page) !== held, 'and it carries on once the pointer leaves');

    await page.click('#galNext', { force: true });
    const chosen = await gal(page);
    await page.waitForTimeout(4600);
    is(await gal(page) === chosen, 'once the customer moves through the photos, it stops for good');
    await page.context().close();

    console.log('\nThe change is a cross-fade, never a switch');
    page = await open('/product/BG-WOTO');
    const fade = await page.evaluate(() => new Promise(done => {
      const seen = [];
      const t = setInterval(() => {
        const o = document.querySelector('#galMain img.gal-fade');
        if (o) seen.push(Number(getComputedStyle(o).opacity).toFixed(2));
      }, 50);
      setTimeout(() => { clearInterval(t); done(seen); }, 4500);
    }));
    const mids = fade.filter(v => v > 0.05 && v < 0.95);
    is(mids.length >= 5, 'the new photo rises gradually over the old one', fade.slice(0, 40).join(' '));
    is(await page.evaluate(() => getComputedStyle(document.querySelector('#galImg')).opacity) === '1',
       'and the photo underneath never goes blank');
    await page.context().close();

    console.log('\nThe pieces in the shop');
    page = await open('/shop');
    /* Watched over seven seconds rather than looked at once: a card with
       two photos is back on its first one every other turn. */
    const alt = await page.evaluate(() => new Promise(done => {
      const seen = new Set();
      const t = setInterval(() => document.querySelectorAll('#grid .card .thumb').forEach((x, k) => {
        if (x.classList.contains('auto-alt')) seen.add(k);
      }), 100);
      setTimeout(() => { clearInterval(t); done(seen.size); }, 7000);
    }));
    is(alt === 2, 'swipe to their other photos by themselves too, every card', alt + ' of 2 swiped');
    const cardFade = await page.evaluate(() => new Promise(done => {
      const seen = [];
      const t = setInterval(() => document.querySelectorAll('#grid .card img.auto-layer').forEach(l => {
        seen.push(Number(getComputedStyle(l).opacity));
      }), 50);
      setTimeout(() => { clearInterval(t); done(seen); }, 6000);
    }));
    is(cardFade.filter(v => v > 0.05 && v < 0.95).length >= 5, 'fading from one photo to the next, not switching',
       cardFade.length + ' samples');
    is(await page.evaluate(() => !document.querySelector('#resultCount') &&
         !/\b\d+\s+pieces?\b/i.test(document.querySelector('#view-shop').textContent)),
       'and the shop no longer says how many pieces it holds');
    is(await page.evaluate(() => Array.from(document.querySelectorAll('#grid .card img.primary'))
         .every(i => i.classList.contains('is-in'))), 'and their photos faded in as they arrived');

    console.log('\nMoving to another page');
    await page.click('[data-nav="home"], .nav-links a', { timeout: 3000 }).catch(() => {});
    await page.evaluate(() => { history.pushState({}, '', '/product/BG-SATC'); dispatchEvent(new PopStateEvent('popstate')); });
    await page.waitForTimeout(100);
    is(await page.evaluate(() => document.querySelector('#view-detail').classList.contains('view-in')),
       'the new page fades up into place');

    console.log('\nAdding to the cart');
    await page.waitForTimeout(600);
    await page.click('#view-detail .btn-cart');
    await page.waitForTimeout(600);
    const toast = await page.evaluate(() => {
      const t = document.querySelector('#cartToast');
      return t && { shown: t.classList.contains('show'), text: t.textContent.replace(/\s+/g, ' ').trim(),
                    top: t.getBoundingClientRect().top, h: innerHeight };
    });
    is(toast && toast.shown && /Added to your cart/.test(toast.text) && /Leather Satchel/.test(toast.text),
       'a confirmation slides up naming the piece', JSON.stringify(toast));
    is(toast && toast.top < toast.h, 'on screen, wherever the button was');
    await page.click('#cartToast .ct-view');
    await page.waitForTimeout(400);
    is(await page.evaluate(() => document.querySelector('#cartModal').classList.contains('open')),
       'and "View cart" opens the cart');
    await page.context().close();

    console.log('\nWith photos swiping switched off');
    SHOPPING = { photoAutoSwipe: false, photoSwipeSeconds: 2 };
    page = await open('/product/BG-WOTO');
    const still = await gal(page);
    await page.waitForTimeout(2600);
    is(await gal(page) === still, 'the photos stay where they are, as before');
    await page.goto(base + '/shop', { waitUntil: 'networkidle' });
    const offAlt = await page.evaluate(() => new Promise(done => {
      let any = 0;
      const t = setInterval(() => { any += document.querySelectorAll('#grid .thumb.auto-alt').length; }, 100);
      setTimeout(() => { clearInterval(t); done(any); }, 6000);
    }));
    is(offAlt === 0, 'on the cards too');
    await page.context().close();

    console.log('\nA phone that asks for less motion');
    SHOPPING = { photoAutoSwipe: true, photoSwipeSeconds: 2 };
    page = await open('/product/BG-WOTO', { reducedMotion: 'reduce' });
    const calm = await gal(page);
    await page.waitForTimeout(2600);
    is(await gal(page) === calm, 'is not given moving photos, whatever the setting');
    await page.context().close();

    is(errors.length === 0, 'no errors on the page', errors.join(' | '));
  } catch (e) {
    is(false, 'the test itself broke', e && e.stack);
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failures ? '\n  ✗ ' + failures + ' of ' + checks + ' checks FAILED'
                       : '\n  motion: all ' + checks + ' checks passed');
  process.exit(failures ? 1 : 0);
})();
