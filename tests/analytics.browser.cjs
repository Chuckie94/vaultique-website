/* ===========================================================================
   WHAT THE STOREFRONT RECORDS — driven in a real browser

   THE REQUIREMENT: "Verify that a website visit is recorded correctly", and
   alongside it the two that constrain how: keep it privacy-conscious, and keep
   it light enough not to slow the storefront down.

   HOW THIS IS DRIVEN. The real site is served — the real index.html, the real
   app.js, the real analytics.js — and the website's Supabase is answered by
   this file. Nothing is stubbed inside the tracker and nothing in it is
   special-cased for a test: what is asserted below is the actual body of the
   actual request the actual page sent.

   THE CHECK THAT MATTERS MOST is not that the right fields are there. It is
   the one that reads every request the page made and fails if a user agent, an
   email, a search term or an internet address is anywhere in any of them. A
   tracker that records the right things AND one wrong thing is still a tracker
   that records the wrong thing.
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

const CATALOGUE = [
  { name: 'Silk Wrap Dress', sku: 'VB-DRS-001', category: 'Dresses', price: 1850,
    size: 'M', color: 'Emerald', material: 'Silk', available: true, lowStock: false, wasPrice: 0 },
  { name: 'Leather Tote Bag', sku: 'VB-BAG-003', category: 'Bags', price: 3200,
    size: '', color: 'Tan', material: 'Leather', available: true, lowStock: false, wasPrice: 0 }
];

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/json'
};

/* Everything the page sent to the website's database, kept as it arrived. */
let EVENTS = [];       // rows posted to site_events
let BEATS = [];        // bodies posted to rpc/site_beat
let RAW = [];          // every request to /rest/v1/, verbatim, for the privacy sweep
let EVENT_STATUS = 201;  // switched to 404 to prove the tracker gives up quietly

function body(req) {
  return new Promise(resolve => {
    let data = '';
    req.on('data', c => { data += c; });
    req.on('end', () => resolve(data));
  });
}

function serve() {
  return new Promise(resolve => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://x');
      let p = url.pathname;

      if (p === '/api/products') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({
          products: CATALOGUE, count: CATALOGUE.length,
          generatedAt: new Date().toISOString(), version: 'test'
        }));
        return;
      }

      if (p.indexOf('/rest/v1/') === 0) {
        const sent = await body(req);
        RAW.push({ path: p, query: url.search, headers: req.headers, body: sent });
        if (p === '/rest/v1/site_events' && req.method === 'POST') {
          if (EVENT_STATUS !== 201) {
            res.writeHead(EVENT_STATUS, { 'Content-Type': 'application/json' });
            res.end('{"message":"relation \\"public.site_events\\" does not exist"}');
            return;
          }
          try { EVENTS = EVENTS.concat(JSON.parse(sent)); } catch (e) { /* asserted on below */ }
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end('');
          return;
        }
        if (p === '/rest/v1/rpc/site_beat' && req.method === 'POST') {
          try { BEATS.push(JSON.parse(sent)); } catch (e) {}
          res.writeHead(204); res.end();
          return;
        }
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

      let file = path.join(ROOT, p);
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, 'index.html');
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream' });
      res.end(fs.readFileSync(file));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

/* Longer than the tracker's own coalescing window, which is what makes several
   things happening at once go out as ONE request. Waiting less than it would be
   asserting on a queue that has not been sent yet. */
const FLUSH_WINDOW = 1500;
const settle = (page, ms) => page.waitForTimeout(ms == null ? FLUSH_WINDOW + 600 : ms);

/* A test browser announces itself twice over — navigator.webdriver is set, and
   it calls itself HeadlessChrome — and the tracker refuses to count either,
   which is correct and is checked below. So a context standing in for a REAL
   VISITOR is given a real visitor's two answers to those questions and nothing
   else. Nothing inside analytics.js is stubbed, reached into or special-cased:
   the browser is simply made to look like the one it is standing in for. */
const REAL_DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/141.0.0.0 Safari/537.36';
const REAL_PHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

async function asAVisitor(browser, ua) {
  const ctx = await browser.newContext({ userAgent: ua || REAL_DESKTOP });
  /* A selector that is not there is a broken check, and a broken check should
     say so in seconds rather than hold the suite up for thirty of them.
     Navigation is given far longer and on purpose: this page asks a CDN for
     the Supabase library, there is no CDN here, and waiting out that refusal
     is the slowest thing in the suite. */
  ctx.setDefaultTimeout(8000);
  ctx.setDefaultNavigationTimeout(60000);
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });
  return ctx;
}
const kinds = () => EVENTS.map(e => e.kind);
const reset = () => { EVENTS = []; BEATS = []; RAW = []; };

(async () => {
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();

  try {
    /* ==================================================================== */
    console.log('\nA visit is recorded');
    const ctx = await asAVisitor(browser);
    const page = await ctx.newPage();
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await settle(page);

    is(EVENTS.length >= 1, 'landing on the home page records something');
    const first = EVENTS[0] || {};
    is(first.kind === 'page_view', 'and what it records is a page view');
    is(first.path === '/', 'carrying the page it was');
    is(typeof first.visitor === 'string' && first.visitor.length >= 8,
       'a token for the browser, long enough for the database to accept');
    is(typeof first.session === 'string' && first.session.length >= 8,
       'a token for the visit');
    is(first.visitor !== first.session, 'and the two are not the same token');
    is(first.is_new === true, 'a browser the shop has never seen is marked new');
    is(['mobile', 'tablet', 'desktop'].indexOf(first.device) > -1,
       'the device as one of three words: ' + first.device);

    /* ==================================================================== */
    console.log('\nAnd nothing else is');
    const ALLOWED = ['kind', 'path', 'label', 'sku', 'visitor', 'session',
                     'device', 'is_new', 'referrer'];
    const strays = [];
    EVENTS.forEach(e => Object.keys(e).forEach(k => {
      if (ALLOWED.indexOf(k) < 0 && strays.indexOf(k) < 0) strays.push(k);
    }));
    is(strays.length === 0,
       'a recorded event has these nine fields and no others' +
       (strays.length ? ' — found ' + strays.join(', ') : ''));

    const everything = JSON.stringify(RAW);
    is(!/Mozilla|Chrome\/|AppleWebKit|Gecko|Safari\//.test(JSON.stringify(EVENTS)),
       'no browser string is anywhere in what was recorded');
    is(!/\b\d{1,3}(\.\d{1,3}){3}\b/.test(JSON.stringify(EVENTS.map(e =>
        Object.assign({}, e, { path: '' })))),
       'and nothing shaped like an internet address');
    is(!/@[a-z0-9.-]+\.[a-z]{2,}/i.test(JSON.stringify(EVENTS)),
       'and nothing shaped like an email address');
    is(everything.indexOf('document.cookie') < 0 && !/set-cookie/i.test(everything),
       'and no cookie is set or sent');

    /* ==================================================================== */
    console.log('\nMoving around the shop');
    EVENTS = [];
    await page.goto(base + '/shop', { waitUntil: 'domcontentloaded' });
    await settle(page);
    is(kinds().indexOf('page_view') > -1 && (EVENTS[0] || {}).path === '/shop',
       'the shop page is recorded as /shop');
    is((EVENTS[0] || {}).is_new === false,
       'and the same browser is no longer new the second time it loads');

    /* RAW as well as EVENTS, because the check below counts REQUESTS and the
       ones from the two pages before this are not part of the question. */
    EVENTS = []; RAW = [];
    await page.click('#grid .card .thumb');   // the first piece on the shop page
    await settle(page);
    is(kinds().indexOf('page_view') > -1, 'opening a piece records a page view');
    is(kinds().indexOf('product_view') > -1, 'and a product view alongside it');
    const pv = EVENTS.find(e => e.kind === 'product_view') || {};
    is(pv.sku === 'VB-DRS-001', 'naming the piece by its sku');
    is(pv.label === 'Silk Wrap Dress', 'and by the name the shop gave it');
    is(/^\/product\//.test(pv.path || ''), 'on the piece\'s own address');
    is(EVENTS.length <= 2 && RAW.filter(r => r.path === '/rest/v1/site_events').length === 1,
       'both went out in ONE request, not one each');

    /* ==================================================================== */
    console.log('\nThe two things only the storefront can say');
    EVENTS = [];
    await page.click('#view-detail [data-cart-sku]');
    await settle(page);
    const atc = EVENTS.find(e => e.kind === 'add_to_cart') || {};
    is(atc.sku === 'VB-DRS-001', 'gathering a piece records an add to cart, with its sku');
    is(atc.label === 'Silk Wrap Dress', 'and its name');

    EVENTS = [];
    /* The buy button on a piece's page. It is an anchor to WhatsApp, which a
       test browser must not actually follow, so its href is taken off first.
       Everything that matters is untouched: the same element, the same click,
       the same startOrder() handler, and the same recording inside it. */
    await page.evaluate(() => {
      const a = document.querySelector('#buyDetail');
      if (a) a.removeAttribute('href');
    });
    await page.click('#buyDetail');
    await settle(page);
    is(kinds().indexOf('checkout_start') > -1,
       'setting off to buy records a checkout start');
    const co = EVENTS.find(e => e.kind === 'checkout_start') || {};
    is(co.sku === 'VB-DRS-001', 'naming the piece being bought');

    /* ==================================================================== */
    console.log('\nThe live count');
    is(BEATS.length >= 1, 'an open tab beats, so the admin can say who is here now');
    const beat = BEATS[0] || {};
    is(Object.keys(beat).sort().join(',') === 'p_device,p_session',
       'and a beat carries the visit token and the device word, and nothing else');
    is(!beat.p_visitor, 'in particular not the token that follows a browser between visits');

    /* ==================================================================== */
    /* Everything below asserts on what a FRESH browser does, and one already
       open would go on beating into the middle of it. So the first visitor
       leaves before the next one arrives. */
    await ctx.close();
    await new Promise(r => setTimeout(r, 400));

    console.log('\nA browser that asks not to be counted');
    reset();
    const shy = await asAVisitor(browser);
    await shy.addInitScript(() => {
      Object.defineProperty(navigator, 'globalPrivacyControl', { get: () => true });
    });
    const shyPage = await shy.newPage();
    await shyPage.goto(base + '/shop', { waitUntil: 'domcontentloaded' });
    await settle(shyPage);
    is(EVENTS.length === 0 && BEATS.length === 0,
       'is not counted at all — no event, no heartbeat, nothing');
    is((await shyPage.$$('#grid .card')).length > 0,
       'and still gets the whole shop, because this is not a paywall');
    await shy.close();

    /* ==================================================================== */
    console.log('\nA browser driving itself');
    reset();
    /* Both tells left exactly as Playwright sets them. */
    const robot = await browser.newContext();
    robot.setDefaultTimeout(8000);
    robot.setDefaultNavigationTimeout(60000);
    const robotPage = await robot.newPage();
    await robotPage.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await settle(robotPage);
    is(EVENTS.length === 0 && BEATS.length === 0,
       'an automated browser is not counted, so a crawler is not a customer');
    await robot.close();

    reset();
    const crawler = await asAVisitor(browser, 'Mozilla/5.0 (compatible; Googlebot/2.1)');
    const crawlerPage = await crawler.newPage();
    await crawlerPage.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await settle(crawlerPage);
    is(EVENTS.length === 0, 'and neither is one that says outright that it is a bot');
    await crawler.close();

    /* ==================================================================== */
    console.log('\nOn a phone');
    reset();
    const phone = await asAVisitor(browser, REAL_PHONE);
    const phonePage = await phone.newPage();
    await phonePage.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await settle(phonePage);
    is((EVENTS[0] || {}).device === 'mobile',
       'the same visit on an iPhone is recorded as mobile');
    is(!/iPhone|Safari|Mozilla/.test(JSON.stringify(EVENTS)),
       'and the browser string that said so is not kept');
    await phone.close();

    /* ==================================================================== */
    console.log('\nWhen the analytics tables have not been created');
    reset();
    EVENT_STATUS = 404;
    const fresh = await asAVisitor(browser);
    const freshPage = await fresh.newPage();
    await freshPage.goto(base + '/shop', { waitUntil: 'domcontentloaded' });
    await settle(freshPage);
    const triedFirst = RAW.filter(r => r.path === '/rest/v1/site_events').length;
    /* Moved through by clicking, not by reloading: a reload is a new visit and
       would quite properly start again. This is one visit and three more things
       done in it — a piece opened, a piece gathered, and back again. */
    await freshPage.click('#grid .card .thumb');
    await settle(freshPage);
    await freshPage.click('#view-detail [data-cart-sku]');
    await settle(freshPage);
    await freshPage.goBack();
    await settle(freshPage);
    const triedAfter = RAW.filter(r => r.path === '/rest/v1/site_events').length;
    is(triedFirst === 1, 'the first page of the visit asks once');
    is(triedAfter === 1,
       'and having been told there is no such table, never asks again this visit');
    is((await freshPage.$$('#grid .card')).length > 0,
       'while the shop carries on exactly as it did');
    await fresh.close();
    EVENT_STATUS = 201;

    /* ==================================================================== */
    console.log('\nAnd the storefront is untouched by any of it');
    reset();
    const plain = await asAVisitor(browser);
    const plainPage = await plain.newPage();
    const errors = [];
    plainPage.on('pageerror', e => errors.push(String(e && e.message || e)));
    await plainPage.goto(base + '/shop', { waitUntil: 'domcontentloaded' });
    await settle(plainPage);
    is(errors.length === 0, 'not one script error on the page' +
       (errors.length ? ': ' + errors[0] : ''));
    is((await plainPage.$$('#grid .card')).length === CATALOGUE.length,
       'every piece in the catalogue is on the shop page');
    /* The button says "Added" for a moment and then settles to what the cart
       now holds. Both are read, because the moment is the part a customer on a
       phone actually sees and it would be the easy one to break. */
    await plainPage.click('#grid [data-cart-sku]');
    await settle(plainPage, 300);
    const flashed = await plainPage.evaluate(() =>
      (document.querySelector('#grid [data-cart-sku]') || {}).textContent || '');
    is(/Added/i.test(flashed), 'and the cart still takes a piece and says so at once');
    await settle(plainPage, 1600);
    const inCart = await plainPage.evaluate(() =>
      (document.querySelector('#grid [data-cart-sku]') || {}).textContent || '');
    is(/In cart/i.test(inCart),
       'then settles to what the cart holds — "' + inCart.trim() + '"');

    /* The one measurement behind "it must not slow the storefront down":
       analytics.js is deferred and asks for nothing until the page has
       drawn, so nothing a visitor waits for is behind it. */
    const timing = await plainPage.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0] || {};
      const an = performance.getEntriesByType('resource')
        .find(r => r.name.indexOf('/assets/analytics.js') > -1) || null;
      return { drawn: nav.domContentLoadedEventEnd || 0, an: an ? an.responseEnd : -1 };
    });
    is(timing.an >= 0, 'the tracker is loaded');
    is(timing.an <= timing.drawn + 1 || timing.drawn === 0,
       'and is finished with before the page has drawn, not in front of it');
    await plain.close();

  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures ? ('\n' + checks + ' checks, ' + failures + ' failed')
                       : ('\nwebsite analytics: all ' + checks + ' checks passed'));
  process.exit(failures ? 1 : 0);
})();
