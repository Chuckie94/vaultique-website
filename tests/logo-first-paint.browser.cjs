/* ===========================================================================
   THE SHOP'S OWN LOGO IS UP BEFORE THE CATALOGUE IS — driven in a real browser

   THE COMPLAINT THIS ANSWERS: "the website loads with an old logo even when I
   changed it. The logo only changes after a few seconds."

   WHY IT DID THAT. index.html ships with the logo the site was built with
   sitting in the header, and the shop's uploaded one replaces it only when
   the theme is applied. The theme used to be applied at the end of
   loadWebsiteData, which finishes when the slowest of seventeen requests has
   answered — and loadWebsiteData is called from the /api/products handler, so
   it does not begin until the catalogue has arrived. Two waits, one behind the
   other, with the wrong logo on screen for both.

   HOW THIS IS DRIVEN, AND WHY IT PROVES ANYTHING. The catalogue feed is held
   open by this file and released when it says so. So the middle of this test
   is a moment that could not exist under the old arrangement: the products
   request has not answered, therefore finishLoad has not run, therefore the
   old code has not applied the theme and cannot have. If the shop's logo is
   on the page at that moment, it got there without waiting for the catalogue.

   Then the feed is released, and the rest of the load is checked to be exactly
   as it was — which is the other half of the job.
   =========================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');

let checks = 0, failures = 0;
const ok   = m => { checks++; console.log('  ✓ ' + m); };
const fail = (m, extra) => { checks++; failures++; console.log('  ✗ ' + m + (extra ? '\n      ' + extra : '')); };
const is   = (c, m, extra) => c ? ok(m) : fail(m, extra);

const UPLOADED = '/uploaded-logo.png';
const SHIPPED  = '/images/logo.png';

/* What the shop last saved in Settings > Branding. */
let BRANDING = {
  logoMain: UPLOADED, logoMobile: UPLOADED, logoFooter: UPLOADED,
  primaryColour: '#123456'
};
/* Set to make the branding row fail, for the last section. */
let BRANDING_FAILS = false;

const CATALOGUE = [
  { name: 'Silk Wrap Dress', sku: 'VB-DRS-001', category: 'Dresses', price: 1850,
    size: 'M', color: 'Emerald', material: 'Silk', available: true, lowStock: false, wasPrice: 0 }
];

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/json'
};

/* Every request the page makes, so "asked once" can be counted rather than
   assumed. */
let SEEN = [];
/* The held catalogue request, and the lever that lets it go. */
let heldProducts = null;
function releaseProducts() {
  if (!heldProducts) return false;
  const res = heldProducts; heldProducts = null;
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({
    products: CATALOGUE, count: CATALOGUE.length,
    generatedAt: new Date().toISOString(), version: 'held-then-released'
  }));
  return true;
}

/* Ahead of app.js: the Supabase client the storefront expects, and a watch on
   every src the page changes, timed from the moment this script ran. */
const STUB = `
window.__logo = { t0: performance.now(), changes: [] };
new MutationObserver(function (recs) {
  recs.forEach(function (r) {
    if (r.attributeName !== 'src') return;
    var el = r.target;
    window.__logo.changes.push({
      cls: el.className || '',
      src: el.getAttribute('src') || '',
      at: Math.round(performance.now() - window.__logo.t0)
    });
  });
}).observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['src'] });

window.supabase = {
  createClient: function () {
    return {
      channel: function () {
        var ch = { on: function () { return ch; },
                   subscribe: function (cb) { if (cb) setTimeout(function () { cb('SUBSCRIBED'); }, 0); return ch; } };
        return ch;
      },
      removeChannel: function () {}
    };
  }
};
`;

function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://x');
      const p = url.pathname;
      SEEN.push(p + (url.search || ''));

      /* Held until this file lets it go. This is the whole apparatus. */
      if (p === '/api/products') { heldProducts = res; return; }

      if (p === UPLOADED) {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(fs.readFileSync(path.join(ROOT, 'images/badge-96.png')));
        return;
      }

      if (p.indexOf('/rest/v1/') === 0) {
        const isBranding = url.search.indexOf('key=eq.branding') > -1;
        if (isBranding && BRANDING_FAILS) { res.writeHead(500); res.end('no'); return; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(isBranding ? JSON.stringify([{ data: BRANDING }]) : '[]');
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
        res.end(STUB);
        return;
      }

      let file = path.join(ROOT, p);
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, 'index.html');
      let html = null;
      if (file.endsWith('index.html')) {
        html = fs.readFileSync(file, 'utf8')
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

const logoSrc = (page, sel) => page.evaluate(s => {
  const e = document.querySelector(s);
  return e ? e.getAttribute('src') : null;
}, sel);

(async () => {
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();

  try {
    /* ================================================================= */
    let page = await browser.newPage();
    SEEN = [];
    await page.goto(base + '/shop', { waitUntil: 'domcontentloaded' });

    console.log('\nWith the catalogue still on its way — which is where the old logo used to sit');
    /* No waiting on the feed: it is being held open by this file. */
    await page.waitForFunction(
      s => { const e = document.querySelector('.brand-logo'); return e && e.getAttribute('src') === s; },
      UPLOADED, { timeout: 5000 }
    ).catch(() => {});

    is(heldProducts !== null, 'the catalogue request has not been answered yet');
    is(await page.evaluate(() => document.querySelectorAll('#grid .card').length) === 0,
       'so there is nothing from the catalogue on the page');
    is(await logoSrc(page, '.brand-logo') === UPLOADED,
       'and the shop’s own logo is already in the header',
       'found ' + await logoSrc(page, '.brand-logo'));
    is(await logoSrc(page, '.mm-logo') === UPLOADED, 'the menu logo too');
    is(await logoSrc(page, '.foot-logo') === UPLOADED, 'and the one in the footer');

    const changes = await page.evaluate(() => window.__logo.changes);
    const first = changes.filter(c => String(c.cls).indexOf('brand-logo') > -1)[0];
    is(!!first, 'the header logo was set once, and this file saw it happen');
    is(first && first.src === UPLOADED, 'to the uploaded file, not the shipped one');
    is(first && first.at < 3000, 'within a moment of the page opening, not a few seconds',
       first ? first.at + 'ms' : 'never');

    console.log('\nAnd the colours came with it, rather than after the catalogue');
    const navy = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--navy').trim());
    is(navy.toLowerCase() === '#123456', 'the shop’s navy is applied', navy || '(none)');

    console.log('\nThe row was asked for once, not once early and once again later');
    let asked = SEEN.filter(u => u.indexOf('key=eq.branding') > -1);
    is(asked.length === 1, 'one request for the branding row', asked.length + ': ' + asked.join(', '));

    /* ================================================================= */
    console.log('\nThen the catalogue lands, and the rest of the load is untouched');
    is(releaseProducts(), 'the feed is released');
    await page.waitForSelector('#grid .card', { timeout: 15000 });
    is(await page.evaluate(() => document.querySelectorAll('#grid .card').length) > 0,
       'the products are on the page');
    is(/Silk Wrap Dress/.test(await page.evaluate(() => document.body.innerText)),
       'and it is the piece the feed sent');
    is(await logoSrc(page, '.brand-logo') === UPLOADED, 'the logo is still the shop’s');

    asked = SEEN.filter(u => u.indexOf('key=eq.branding') > -1);
    is(asked.length === 1, 'and it was still only asked for once after the full load',
       asked.length + ' requests');
    console.log('      [general asked ' + SEEN.filter(u => u.indexOf('key=eq.general') > -1).length + ' time(s)]');
    is(SEEN.filter(u => u.indexOf('key=eq.general') > -1).length >= 1,
       'the other settings were still asked for, as before');
    is(SEEN.filter(u => u.indexOf('key=eq.shopping') > -1).length === 1,
       'including the shopping settings');

    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    await page.waitForTimeout(400);
    is(errs.length === 0, 'and no script error anywhere', errs.join(' | '));
    await page.close();

    /* ================================================================= */
    console.log('\nA shop that has uploaded nothing keeps the logo the site ships with');
    BRANDING = {};
    SEEN = [];
    page = await browser.newPage();
    await page.goto(base + '/shop', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    is(await logoSrc(page, '.brand-logo') === SHIPPED,
       'the shipped logo is still there', String(await logoSrc(page, '.brand-logo')));
    is(releaseProducts(), 'and the feed still releases');
    await page.waitForSelector('#grid .card', { timeout: 15000 });
    is(await logoSrc(page, '.brand-logo') === SHIPPED, 'and stays there after the full load');
    await page.close();

    /* ================================================================= */
    console.log('\nA branding row that will not load costs the shop nothing but its logo');
    BRANDING_FAILS = true;
    SEEN = [];
    const errs2 = [];
    page = await browser.newPage();
    page.on('pageerror', e => errs2.push(String(e)));
    await page.goto(base + '/shop', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    is(await logoSrc(page, '.brand-logo') === SHIPPED, 'the shipped logo is up');
    is(releaseProducts(), 'the feed releases');
    await page.waitForSelector('#grid .card', { timeout: 15000 });
    is(await page.evaluate(() => document.querySelectorAll('#grid .card').length) > 0,
       'the catalogue still arrives and is drawn');
    is(/Silk Wrap Dress/.test(await page.evaluate(() => document.body.innerText)),
       'with the piece the feed sent');
    is(SEEN.filter(u => u.indexOf('key=eq.general') > -1).length >= 1,
       'the other sixteen settings were still asked for');
    is(errs2.length === 0, 'and the failure was silent, as an icon should be', errs2.join(' | '));
    await page.close();

    BRANDING_FAILS = false;

  } finally {
    await browser.close();
    if (heldProducts) { try { heldProducts.destroy(); } catch (e) {} }
    server.close();
  }

  console.log('\nlogo first paint: ' + (failures === 0
    ? 'all ' + checks + ' checks passed'
    : (checks - failures) + ' passed, ' + failures + ' failed'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('\nthe checks themselves fell over:\n', e); process.exit(1); });
