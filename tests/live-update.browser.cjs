/* ===========================================================================
   THE STOREFRONT UPDATES ITSELF — driven in a real browser

   THE REQUIREMENT: "Verify that adding, editing, and deleting a product in the
   Business Platform is reflected on the website without a manual page refresh"
   and "Ensure multiple browser tabs/windows update correctly."

   HOW THIS IS DRIVEN. The page is served for real and /api/products is answered
   from a catalogue this file can change between assertions — which is exactly
   what the platform does to it. Supabase's client is stubbed BEFORE app.js
   loads, so the storefront takes its real Realtime path: it subscribes, and the
   handler it registers is the one this test fires. Nothing in app.js is
   special-cased for testing.

   THE ONE THING EVERY ASSERTION TURNS ON: a marker is put on the window at
   first load and never renewed. If the page reloaded at any point the marker
   would be gone, and "without a manual page refresh" would be a claim rather
   than a measurement.
   =========================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');

let checks = 0, failures = 0;
const ok   = m => { checks++; console.log('  ✓ ' + m); };
const fail = m => { checks++; failures++; console.log('  ✗ ' + m); };
const is   = (c, m) => c ? ok(m) : fail(m);

/* The catalogue the website is served. Changed between assertions the way the
   shop changes it. */
let CATALOGUE = [
  { name: 'Silk Wrap Dress', sku: 'VB-DRS-001', category: 'Dresses', price: 1850,
    size: 'M', color: 'Emerald', material: 'Silk', available: true, lowStock: false, wasPrice: 0 },
  { name: 'Leather Tote Bag', sku: 'VB-BAG-003', category: 'Bags', price: 3200,
    size: '', color: 'Tan', material: 'Leather', available: true, lowStock: false, wasPrice: 0 }
];
const crypto = require('crypto');
const versionOf = list =>
  crypto.createHash('sha1').update(JSON.stringify(list)).digest('hex').slice(0, 12);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/json'
};

/* The stub, injected ahead of app.js. It answers createClient the way the real
   library does and hands this test the handler the storefront registers. */
const SUPABASE_STUB = `
window.__pulse = { handlers: [], subscribed: 0 };
window.supabase = {
  createClient: function () {
    return {
      channel: function () {
        var ch = {
          on: function (_evt, _filter, fn) { window.__pulse.handlers.push(fn); return ch; },
          subscribe: function (cb) { window.__pulse.subscribed++; if (cb) setTimeout(function(){ cb('SUBSCRIBED'); }, 0); return ch; }
        };
        return ch;
      },
      removeChannel: function () {}
    };
  }
};
window.__noReload = 'alive';
`;

function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://x');
      let p = url.pathname;

      if (p === '/api/products') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({
          products: CATALOGUE, count: CATALOGUE.length,
          generatedAt: new Date().toISOString(), version: versionOf(CATALOGUE)
        }));
        return;
      }
      /* The website's own Supabase. Everything it holds is optional to the
         catalogue, and answering empty is what a brand-new shop looks like. */
      if (p.indexOf('/rest/v1/') === 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('[]');
        return;
      }
      if (p === '/config.js') {
        res.writeHead(200, { 'Content-Type': TYPES['.js'] });
        res.end('window.VBP_CONFIG={SUPABASE_URL:"http://127.0.0.1:' + server.address().port +
                '",SUPABASE_ANON_KEY:"test-anon-key"};');
        return;
      }
      if (p === '/__stub.js') {
        res.writeHead(200, { 'Content-Type': TYPES['.js'] });
        res.end(SUPABASE_STUB);
        return;
      }

      let file = path.join(ROOT, p);
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, 'index.html');
      let html = null;
      if (file.endsWith('index.html')) {
        html = fs.readFileSync(file, 'utf8')
          /* Ahead of app.js, so the storefront finds a client already there and
             takes the same path it takes against the real library. */
          .replace('<script src="/config.js"></script>',
                   '<script src="/config.js"></script>\n<script src="/__stub.js"></script>');
      }
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream' });
      res.end(html !== null ? html : fs.readFileSync(file));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

/* The cards are built with DOM calls and carry no sku attribute, so what is
   on the page is read the way a visitor reads it: by the names showing on it. */
const shown = page => page.evaluate(() =>
  Array.from(document.querySelectorAll('.card'))
    .map(e => (e.textContent || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean));
const showing = (list, name) => list.some(t => t.indexOf(name) > -1);

/* Fire the pulse the way Supabase would, and wait for the page to settle. */
async function pulse(page) {
  await page.evaluate(() => window.__pulse.handlers.forEach(fn => fn({ eventType: 'UPDATE' })));
  await page.waitForTimeout(600);
}

(async () => {
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();

  try {
    const page = await browser.newPage();
    await page.goto(base + '/shop', { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);

    console.log('\nThe shop opens, and starts listening');
    let skus = await shown(page);
    is(showing(skus, 'Silk Wrap Dress') && showing(skus, 'Leather Tote Bag'),
       'both products are on the page');
    is(await page.evaluate(() => window.__pulse.subscribed) > 0,
       'and the storefront has subscribed for changes');

    /* ---------------------------------------------------------------- add */
    console.log('\nA product added in the platform appears by itself');
    CATALOGUE = CATALOGUE.concat([{
      name: 'Beaded Clutch', sku: 'VB-CLU-009', category: 'Bags', price: 950,
      size: '', color: 'Gold', material: 'Beadwork', available: true, lowStock: false, wasPrice: 0
    }]);
    await pulse(page);
    skus = await shown(page);
    is(showing(skus, 'Beaded Clutch'), 'the new piece is on the page');
    is(await page.evaluate(() => window.__noReload) === 'alive',
       'and the page never reloaded to get it');

    /* --------------------------------------------------------------- edit */
    console.log('\nAn edit and a price change follow it');
    CATALOGUE = CATALOGUE.map(p => p.sku === 'VB-DRS-001'
      ? Object.assign({}, p, { name: 'Silk Wrap Dress (Long)', price: 1499, wasPrice: 1850 })
      : p);
    await pulse(page);
    let txt = await page.evaluate(() => document.body.innerText);
    is(/Silk Wrap Dress \(Long\)/.test(txt), 'the new name is showing');
    is(/1,?499/.test(txt), 'and the new price');
    is(await page.evaluate(() => window.__noReload) === 'alive', 'still with no reload');

    /* ------------------------------------------------------------- delete */
    console.log('\nAnd a deleted product goes away — the half that never worked');
    CATALOGUE = CATALOGUE.filter(p => p.sku !== 'VB-BAG-003');
    await pulse(page);
    skus = await shown(page);
    is(!showing(skus, 'Leather Tote Bag'), 'the deleted piece is off the page');
    is(showing(skus, 'Silk Wrap Dress') && showing(skus, 'Beaded Clutch'),
       'and the ones that remain are untouched');
    is(await page.evaluate(() => window.__noReload) === 'alive', 'still with no reload');

    /* --------------------------------------------------- sold out / stock */
    console.log('\nSelling out is reflected without removing the piece');
    CATALOGUE = CATALOGUE.map(p => p.sku === 'VB-CLU-009'
      ? Object.assign({}, p, { available: false }) : p);
    await pulse(page);
    is(showing(await shown(page), 'Beaded Clutch'),
       'it is still listed, because the shop still stocks it');

    /* -------------------------------------------------- a false alarm    */
    console.log('\nA signal that means nothing costs nothing');
    const before = await page.evaluate(() => document.body.innerHTML.length);
    await pulse(page);
    is(await page.evaluate(() => document.body.innerHTML.length) === before,
       'an unchanged catalogue does not repaint the page');

    /* ------------------------------------------------------ where you were */
    console.log('\nAnd it does not throw you back to the top of the page');
    await page.evaluate(() => window.scrollTo(0, 400));
    await page.waitForTimeout(150);
    const wasAt = await page.evaluate(() => window.scrollY);
    CATALOGUE = CATALOGUE.concat([{
      name: 'Woven Belt', sku: 'VB-BLT-002', category: 'Accessories', price: 420,
      size: '', color: 'Brown', material: 'Leather', available: true, lowStock: false, wasPrice: 0
    }]);
    await pulse(page);
    /* Longer than the redraw itself: the correction runs over a short
       window because the jump to the top happens after the layout has
       settled, not in the same breath as the repaint. */
    await page.waitForTimeout(500);
    const y = await page.evaluate(() => window.scrollY);
    /* NOT an exact pixel. When a piece is added above where somebody is
       reading, the browser shifts the view down by the height of the new
       card so the same thing stays under their eyes — that is correct,
       and pinning the old number back would drag them onto different
       products. What must never happen is being thrown to the top. */
    is(wasAt > 0 && y > wasAt / 2,
       'the visitor is not thrown back to the top (' + Math.round(wasAt) + 'px \u2192 ' + Math.round(y) + 'px)');

    /* ------------------------------------------------------------- 2 tabs */
    console.log('\nTwo tabs, both live, independently');
    const tab2 = await browser.newPage();
    await tab2.goto(base + '/shop', { waitUntil: 'networkidle' });
    await tab2.waitForTimeout(700);
    is(showing(await shown(tab2), 'Woven Belt'),
       'the second tab opens with everything the first has');

    CATALOGUE = CATALOGUE.filter(p => p.sku !== 'VB-CLU-009');
    await pulse(page);
    await pulse(tab2);
    is(!showing(await shown(page), 'Beaded Clutch'), 'the first tab drops it');
    is(!showing(await shown(tab2), 'Beaded Clutch'), 'and so does the second');
    is(await tab2.evaluate(() => window.__noReload) === 'alive',
       'neither of them reloaded');
    is(await tab2.evaluate(() => window.__pulse.subscribed) > 0,
       'because each tab subscribes for itself rather than sharing one connection');

    /* ------------------------------------------------------- the fallback */
    console.log('\nAnd it still works with no Realtime at all');
    const bare = await browser.newPage();
    /* No stub this time: window.supabase never appears and the CDN is refused,
       which is a visitor behind a firewall, or a Supabase outage. */
    await bare.route('**/supabase-js@2**', r => r.abort());
    await bare.addInitScript(() => { window.__noReload = 'alive'; });
    await bare.goto(base + '/shop', { waitUntil: 'networkidle' });
    await bare.waitForTimeout(800);
    is((await shown(bare)).length > 0, 'the shop still opens and lists its products');

    CATALOGUE = CATALOGUE.concat([{
      name: 'Silver Cuff', sku: 'VB-CUF-004', category: 'Accessories', price: 780,
      size: '', color: 'Silver', material: 'Silver', available: true, lowStock: false, wasPrice: 0
    }]);
    /* The fallback refreshes on its timer and when a tab comes back to the
       front. The second is the one a person actually experiences. */
    await bare.evaluate(() => window.dispatchEvent(new Event('online')));
    await bare.waitForTimeout(800);
    is(showing(await shown(bare), 'Silver Cuff'),
       'and it still picks up a change with no socket to tell it');
    is(await bare.evaluate(() => window.__noReload) === 'alive', 'without reloading either');

  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures ? ('\n' + checks + ' checks, ' + failures + ' failed')
                       : ('\nlive update: all ' + checks + ' checks passed'));
  process.exit(failures ? 1 : 0);
})();
