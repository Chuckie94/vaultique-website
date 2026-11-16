/* ===========================================================================
   "WHERE ARE YOU BROWSING FROM?" -- driven in a real browser

   THE OWNER: "I want to know browsing location as statistics of where the
   website is popular ... It should be everywhere ... list them per country
   not a long list of world cities. So country, province, then city ... if
   someone doesn't pick the location, the system should work as before."

   The page is the real storefront with the real assets/where.js and
   assets/analytics.js; the lists come from the real places.js function, run
   here in-process. Time is moved on with the browser's own clock rather than
   waited out, so "after twenty seconds" takes no real twenty seconds.
   =========================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const placesFn = require(path.join(ROOT, 'netlify/functions/places.js'));

let checks = 0, failures = 0;
const is = (c, m, x) => { checks++; if (c) console.log('  ✓ ' + m); else { failures++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); } };

const REAL_PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const geo = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
const LUSAKA = geo({ city: 'Lusaka', country: { code: 'ZM', name: 'Zambia' }, subdivision: { name: 'Lusaka Province' } });
const MANCHESTER = geo({ city: 'Manchester', country: { code: 'GB', name: 'United Kingdom' }, subdivision: { name: 'England' } });

let GEO = LUSAKA;
let SHOPPING = {};
let WHERE = [];          // what visit-where was sent
let PLACES_ASKED = [];   // what the lists were asked
let EVENTS_MISSING = false;  // the website's analytics tables not created

const CATALOGUE = [
  { name: 'Crossbody Tote Sling', sku: 'BG-1', category: 'PU Leather Handbags', price: 642, size: 'M', color: 'Black',
    material: '', available: true, lowStock: false, wasPrice: 0, brand: '', description: '', details: [] }
];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/json',
  '.woff2': 'font/woff2', '.jpg': 'image/jpeg' };
const STUB = `window.supabase = { createClient: function () { return { channel: function () { var ch = { on: function(){ return ch; }, subscribe: function(){ return ch; } }; return ch; }, removeChannel: function () {} }; } };`;

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const u = new URL(req.url, 'http://x'); const p = u.pathname;
      const json = (d, st) => { res.writeHead(st || 200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d)); };
      let body = '';
      req.on('data', (c) => { body += c; });
      await new Promise((r) => req.on('end', r));
      if (p === '/api/products') return json({ products: CATALOGUE, count: 1, version: 'v1', generatedAt: new Date().toISOString() });
      if (p === '/.netlify/functions/places') {
        PLACES_ASKED.push(u.search);
        const r = await placesFn.handler({ httpMethod: 'GET', queryStringParameters: Object.fromEntries(u.searchParams), headers: { 'x-nf-geo': GEO } });
        res.writeHead(r.statusCode, r.headers); return res.end(r.body);
      }
      if (p === '/.netlify/functions/visit-where') { try { WHERE.push(JSON.parse(body)); } catch (e) {} res.writeHead(204); return res.end(); }
      if (p === '/rest/v1/site_settings' && /shopping/.test(u.searchParams.get('key') || '')) return json([{ data: SHOPPING }]);
      if (p === '/rest/v1/site_events' && req.method === 'POST') {
        return EVENTS_MISSING ? json({ message: 'relation "public.site_events" does not exist' }, 404) : json([], 201);
      }
      if (p.indexOf('/rest/v1/') === 0) return json([]);
      if (p === '/config.js') { res.writeHead(200, { 'Content-Type': TYPES['.js'] }); return res.end('window.VBP_CONFIG={SUPABASE_URL:"http://127.0.0.1:' + server.address().port + '",SUPABASE_ANON_KEY:"k"};'); }
      if (p === '/__stub.js') { res.writeHead(200, { 'Content-Type': TYPES['.js'] }); return res.end(STUB); }
      let file = path.join(ROOT, p);
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, 'index.html');
      let out = fs.readFileSync(file);
      if (file.endsWith('index.html')) out = out.toString().replace('<script src="/config.js"></script>', '<script src="/config.js"></script>\n<script src="/__stub.js"></script>');
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' }); res.end(out);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

(async () => {
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  /* A real visitor on a phone: a test browser announces itself as a robot,
     and robots are rightly never counted or asked. Nothing in the page is
     stubbed to get round that; the browser is made to look like a phone. */
  const visitor = async (opts) => {
    opts = opts || {};
    const ctx = await browser.newContext({ userAgent: opts.ua || REAL_PHONE, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    ctx.setDefaultTimeout(8000);
    if (!opts.robot) await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); });
    if (opts.staff) await ctx.addInitScript(() => { try { localStorage.setItem('vbp_staff', '1'); } catch (e) {} });
    await ctx.route('**/fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await ctx.route('**/cdn.jsdelivr.net/**', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    return ctx;
  };
  const open = async (ctx, url) => {
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message || e)));
    await page.clock.install();
    await page.goto(base + (url || '/'), { waitUntil: 'domcontentloaded' });
    await page.clock.runFor(1500);
    await page.waitForTimeout(400);
    return { page, errors };
  };
  /* Twenty-two seconds of looking around, in no real time at all. */
  const lookAround = async (page) => {
    for (let i = 0; i < 23; i++) { await page.clock.runFor(1000); await page.waitForTimeout(20); }
    await page.waitForTimeout(500);
    await page.clock.runFor(800);
    await page.waitForTimeout(200);
  };
  const bar = (page) => page.evaluate(() => {
    const b = document.querySelector('.wq');
    if (!b) return null;
    return { shown: b.classList.contains('in') && !b.classList.contains('wq-away'),
             title: (b.querySelector('.wq-t') || {}).textContent,
             chips: Array.from(b.querySelectorAll('.wq-chip')).map((c) => c.textContent),
             text: b.textContent.replace(/\s+/g, ' ').trim() };
  });

  try {
    console.log('\nA visitor in Livingstone, on a phone, on mobile data (the network says Lusaka)');
    let ctx = await visitor();
    let { page, errors } = await open(ctx);
    let b = await bar(page);
    is(!b, 'nothing is asked the moment they arrive');
    await lookAround(page);
    b = await bar(page);
    is(b && b.shown && b.title === 'Where are you browsing from?', 'after a little while of looking around, the question', JSON.stringify(b));
    is(b && b.chips.join(',') === 'Lusaka,Kitwe,Ndola,Livingstone,Kabwe,Chipata,Somewhere else…',
       'with the six largest Zambian towns one tap away, and "Somewhere else"', b && b.chips.join(','));
    const lifted = await page.evaluate(() => {
      const f = document.querySelector('.fab'); const w = document.querySelector('.wq');
      if (!f || !w) return null;
      return { fabBottom: Math.round(f.getBoundingClientRect().bottom), barTop: Math.round(w.getBoundingClientRect().top) };
    });
    is(lifted && lifted.fabBottom <= lifted.barTop + 2, 'the WhatsApp button steps up above it, rather than being covered', JSON.stringify(lifted));
    await page.screenshot({ path: path.join(ROOT, '..', 'where-ask-phone.png') });
    const before = WHERE.length;
    is(WHERE.some((w) => w.session && !w.place), 'until they answer, the visit is placed from the connection, as before');
    await page.click('.wq-chip:has-text("Livingstone")');
    await page.waitForTimeout(300);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('vbp_place') || 'null'));
    is(stored && stored.id === '910111' && stored.name === 'Livingstone', 'one tap: Livingstone is remembered on the phone', JSON.stringify(stored));
    const sent = WHERE.slice(before);
    is(sent.length === 1 && sent[0].place === '910111' && sent[0].session, 'and sent for this visit, as Livingstone\'s id and nothing else', JSON.stringify(sent));
    is(/Thank you — Livingstone\./.test((await bar(page) || {}).text || ''), 'thanked, by name');
    await page.clock.runFor(2600); await page.waitForTimeout(700);
    is(!(await page.$('.wq')), 'and the card goes away');
    is(!(await page.evaluate(() => document.body.classList.contains('wq-on'))), 'the buttons come back down');
    is(errors.length === 0, 'no errors on the page' + (errors.length ? ': ' + errors[0] : ''));
    await page.close();

    console.log('\nThe same phone, another day');
    WHERE = [];
    ({ page } = await open(ctx));
    await lookAround(page);
    is(!(await bar(page)), 'is never asked again');
    is(WHERE.some((w) => w.place === '910111'), 'and the new visit is counted in Livingstone straight away', JSON.stringify(WHERE));
    await ctx.close();

    console.log('\nSomewhere else: Country, then Province, then Town');
    WHERE = [];
    ctx = await visitor();
    ({ page, errors } = await open(ctx));
    await lookAround(page);
    await page.click('.wq-chip.wq-else');
    await page.waitForFunction(() => document.getElementById('wq_prov') && document.getElementById('wq_prov').options.length > 2);
    const lists = await page.evaluate(() => ({
      country: document.getElementById('wq_country').value,
      countries: document.getElementById('wq_country').options.length,
      provinces: Array.from(document.getElementById('wq_prov').options).map((o) => o.text)
    }));
    is(lists.country === 'ZM' && lists.countries > 200, 'the country list starts on Zambia, with every country there (' + lists.countries + ')');
    is(lists.provinces.includes('Southern Province') && lists.provinces.includes('Copperbelt Province') && lists.provinces.length === 11,
       'then Zambia\'s ten provinces', lists.provinces.join(', '));
    await page.waitForTimeout(700);
    const clear = await page.evaluate(() => {
      const w = document.querySelector('.wq').getBoundingClientRect().top;
      return ['.fab', '.chat-fab'].map((s) => document.querySelector(s))
        .filter((e) => e && e.getBoundingClientRect().height > 0 && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none')
        .map((e) => Math.round(e.getBoundingClientRect().bottom - w));
    });
    is(clear.length && clear.every((d) => d <= 0), 'the floating buttons stay clear of the card when it grows into the lists', JSON.stringify(clear));
    await page.screenshot({ path: path.join(ROOT, '..', 'where-ask-lists.png') });
    await page.selectOption('#wq_prov', '07');
    await page.waitForFunction(() => document.getElementById('wq_town').options.length > 2);
    const townNames = await page.evaluate(() => Array.from(document.getElementById('wq_town').options).map((o) => o.text));
    is(townNames.includes('Kalomo') && townNames.includes('Livingstone') && /Somewhere else in Southern Province/.test(townNames[townNames.length - 1]),
       'then the province\'s towns, and "somewhere else" in it', townNames.join(', '));
    await page.selectOption('#wq_town', 'zm-kalomo');
    await page.waitForTimeout(300);
    is(WHERE.some((w) => w.place === 'zm-kalomo'), 'choosing the town is the answer: Kalomo is sent', JSON.stringify(WHERE));
    is(errors.length === 0, 'no errors on the page' + (errors.length ? ': ' + errors[0] : ''));
    await ctx.close();

    console.log('\nA visitor in Manchester');
    GEO = MANCHESTER; WHERE = [];
    ctx = await visitor();
    ({ page } = await open(ctx));
    await lookAround(page);
    b = await bar(page);
    is(b && b.chips[0] === 'Manchester' && b.chips.includes('London'), 'is offered Manchester first, then the country\'s largest towns', b && b.chips.join(','));
    await page.click('.wq-chip.wq-else');
    await page.waitForFunction(() => document.getElementById('wq_prov') && document.getElementById('wq_prov').options.length > 2);
    const gb = await page.evaluate(() => ({ c: document.getElementById('wq_country').value,
      p: Array.from(document.getElementById('wq_prov').options).map((o) => o.text) }));
    is(gb.c === 'GB' && gb.p.includes('England') && gb.p.includes('Scotland'), 'and the lists start on the United Kingdom: England, Scotland, Wales...', JSON.stringify(gb));
    await ctx.close();
    GEO = LUSAKA;

    console.log('\nNot now');
    ctx = await visitor();
    ({ page } = await open(ctx));
    await lookAround(page);
    await page.click('.wq-x');
    await page.clock.runFor(800); await page.waitForTimeout(300);
    const skip = await page.evaluate(() => localStorage.getItem('vbp_place_skip'));
    is(!(await page.$('.wq')) && !!skip, '× puts it away');
    await page.close();
    ({ page } = await open(ctx));
    await lookAround(page);
    is(!(await bar(page)), 'and it is not asked again on that phone');
    await ctx.close();

    console.log('\nNever asked');
    for (const [what, opts, shop] of [
      ['the shop\'s own phone (signed in to the admin)', { staff: true }, {}],
      ['a robot', { robot: true, ua: 'Mozilla/5.0 (compatible; Googlebot/2.1)' }, {}],
      ['anybody, when Settings > Shopping switches it off', {}, { askWhere: false }]
    ]) {
      SHOPPING = shop;
      ctx = await visitor(opts);
      ({ page } = await open(ctx));
      await lookAround(page);
      is(!(await bar(page)), what);
      await ctx.close();
    }
    SHOPPING = {};
    EVENTS_MISSING = true;
    ctx = await visitor();
    ({ page } = await open(ctx));
    await lookAround(page);
    is(!(await bar(page)), 'anybody, while the website cannot record visits (its analytics SQL not run)');
    await ctx.close();
    EVENTS_MISSING = false;

    console.log('\nWhile something else is open');
    ctx = await visitor();
    ({ page } = await open(ctx));
    await page.evaluate(() => { const m = document.getElementById('cartModal'); if (m) m.classList.add('open'); });
    await lookAround(page);
    is(!(await bar(page)), 'it waits while the cart is open');
    await page.evaluate(() => { const m = document.getElementById('cartModal'); if (m) m.classList.remove('open'); });
    await page.clock.runFor(1500); await page.waitForTimeout(600); await page.clock.runFor(300); await page.waitForTimeout(200);
    b = await bar(page);
    is(b && b.shown, 'and asks once it is closed');
    await ctx.close();
  } catch (e) {
    is(false, 'the test itself broke', e && e.stack);
  } finally {
    await browser.close(); server.close();
  }
  console.log(failures ? '\n  ✗ ' + failures + ' of ' + checks + ' checks FAILED' : '\n  where are you browsing from: all ' + checks + ' checks passed');
  process.exit(failures ? 1 : 0);
})();
