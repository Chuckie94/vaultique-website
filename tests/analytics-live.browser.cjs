/* ===========================================================================
   ANALYTICS: THE FIGURES MOVE BY THEMSELVES -- driven in a real browser

   The real assets/admin/analytics.js, with the database and its realtime
   scripted. Somebody opening a page on the website must change the cards on
   an Analytics page that is already open, without anybody reloading it.
   =========================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');

let checks = 0, failures = 0;
const ok = m => { checks++; console.log('  ✓ ' + m); };
const fail = (m, x) => { checks++; failures++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); };
const is = (c, m, x) => c ? ok(m) : fail(m, x);

const PAGE = `<!DOCTYPE html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/assets/admin/admin.css"></head><body>
<div class="wrap"><div id="host"></div></div>
<script src="/assets/formats.js"></script>
<script src="/assets/admin/registry.js"></script>
<script>
window.PLAN = window.PLAN || {};
function answer(spec) {
  return new Promise(function (res) { setTimeout(function () {
    if (spec && spec.error) res({ data: null, error: { message: spec.error, code: spec.code } });
    else res({ data: spec ? spec.data : null, count: spec ? spec.count : null, error: null });
  }, 5); });
}
window.__heard = {};
window.__asked = 0;
window.__rpc = {};
window.__channels = [];
window.__chanState = window.__chanState || {};
window.__sb = {
  rpc: function (name) {
    window.__rpc[name] = (window.__rpc[name] || 0) + 1;
    if (name === 'site_stats') window.__asked++;
    return answer(window.PLAN['rpc:' + name]);
  },
  channel: function (name) {
    window.__channels.push(name);
    var ch = {
      on: function (kind, filter, fn) { window.__heard[filter.table] = fn; return ch; },
      subscribe: function (cb) {
        setTimeout(function () { cb && cb(window.__chanState[name] || 'SUBSCRIBED'); }, 5);
        return ch;
      }
    };
    return ch;
  },
  removeChannel: function () {},
  from: function () { var b = { select: function () { return b; }, eq: function () { return b; },
    gte: function () { return b; }, lte: function () { return b; }, order: function () { return b; },
    limit: function () { return b; }, then: function (a, c) { return answer({ data: [] }).then(a, c); } }; return b; }
};
window.__store = { load: function (k) { return Promise.resolve((window.PLAN['settings:' + k] || {}).data || {}); } };
</script>
<script src="/assets/admin/analytics.js"></script>
</body></html>`;

const server = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (p === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(PAGE); }
  const f = path.join(ROOT, p);
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(''); }
  res.writeHead(200, { 'Content-Type': p.endsWith('.css') ? 'text/css' : 'text/javascript' });
  res.end(fs.readFileSync(f));
});


const stats = n => ({ data: { visits: n, visitors: n, page_views: n * 2, product_views: n - 1,
  add_to_cart: 0, checkout_starts: 0, orders: 0, sales: 0, currency: 'ZMW' } });
const PLACES = { data: { visits: 14, located: 12,
  countries: [{ code: 'ZM', name: 'Zambia', visits: 11, visitors: 9, page_views: 30 },
              { code: 'ZA', name: 'South Africa', visits: 1, visitors: 1, page_views: 2 }],
  cities: [{ country: 'ZM', country_name: 'Zambia', region: 'Lusaka Province', name: 'Lusaka', lat: -15.42, lon: 28.28, visits: 8, visitors: 6, page_views: 22 },
           { country: 'ZM', country_name: 'Zambia', region: 'Copperbelt', name: 'Kitwe', lat: -12.8, lon: 28.21, visits: 3, visitors: 3, page_views: 8 },
           { country: 'ZA', country_name: 'South Africa', region: 'Gauteng', name: 'Johannesburg', lat: -26.2, lon: 28.04, visits: 1, visitors: 1, page_views: 2 }] } };

let LEAFLET = null;
try { LEAFLET = path.dirname(require.resolve('leaflet/dist/leaflet.js')); } catch (e) {
  const local = path.resolve(ROOT, '..', 'vendor', 'node_modules', 'leaflet', 'dist');
  if (fs.existsSync(path.join(local, 'leaflet.js'))) LEAFLET = local;
}
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch();
  const errors = [];
  async function open(plan, chanState) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 1600 } });
    page.on('pageerror', e => errors.push(String(e.message || e)));
    await page.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/leaflet\/.*\/leaflet\.min\.(js|css)$/, route => {
      if (!LEAFLET) return route.abort();
      const css = route.request().url().endsWith('.css');
      route.fulfill({ status: 200, contentType: css ? 'text/css' : 'text/javascript',
        body: fs.readFileSync(path.join(LEAFLET, css ? 'leaflet.css' : 'leaflet.js')) });
    });
    await page.route(/tile\.openstreetmap\.org/, route => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
    await page.goto('http://127.0.0.1:' + server.address().port + '/');
    await page.evaluate(([p, c]) => {
      window.PLAN = p;
      window.__chanState = c || {};
      window.VBP_ADMIN.pages.analytics.render(document.getElementById('host'), { sb: window.__sb, store: window.__store });
    }, [plan, chanState]);
    await page.waitForTimeout(700);
    return page;
  }
  const kpi = page => page.evaluate(() => {
    const out = {};
    document.querySelectorAll('.an-kpis:not(.an-pay-tiles) .an-kpi').forEach(k => {
      out[k.querySelector('.an-kpi-l').textContent.trim().toLowerCase()] = k.querySelector('.an-kpi-n').textContent.trim();
    });
    return out;
  });
  const here = page => page.evaluate(() => (document.querySelector('.an-live') || document.body).textContent);
  try {
    console.log('\nThe Analytics page is open');
    let page = await open({ 'rpc:site_stats': stats(12), 'rpc:site_here': { data: [] } });
    let k = await kpi(page);
    is(k['total visits'] === '12', 'it shows 12 visits', JSON.stringify(k));
    is(await page.evaluate(() => typeof window.__heard.site_events === 'function'),
       'and listens for the website recording a page or a piece');
    const chans = await page.evaluate(() => window.__channels);
    is(chans.indexOf('vbp-admin-presence') > -1 && chans.indexOf('vbp-admin-figures') > -1,
       'on two channels: who is here, and the figures, each on its own', chans.join(', '));

    console.log('\nSomebody opens a page on the website');
    await page.evaluate(p => { window.PLAN['rpc:site_stats'] = p; }, stats(13));
    await page.evaluate(() => window.__heard.site_events({ eventType: 'INSERT', new: { kind: 'page_view' } }));
    await page.waitForTimeout(1600);
    k = await kpi(page);
    is(k['total visits'] === '13', 'the visits go up to 13 without reloading', JSON.stringify(k));
    is(k['page views'] === '26', 'and the page views with them');
    is(k['product views'] === '12', 'and the product views');

    console.log('\nSeveral things at once');
    let before = await page.evaluate(() => window.__asked);
    await page.evaluate(() => { for (let i = 0; i < 8; i++) window.__heard.site_events({ eventType: 'INSERT', new: {} }); });
    await page.waitForTimeout(1600);
    let after = await page.evaluate(() => window.__asked);
    is(after - before === 1, 'are read as one, not eight times', 'asked ' + (after - before) + ' times');

    console.log('\nA steady stream of visitors');
    before = await page.evaluate(() => window.__asked);
    await page.evaluate(() => { window.__stream = setInterval(() => window.__heard.site_events({ eventType: 'INSERT', new: {} }), 400); });
    await page.waitForTimeout(6000);
    after = await page.evaluate(() => window.__asked);
    await page.evaluate(() => clearInterval(window.__stream));
    is(after - before >= 1, 'still refreshes within five seconds, rather than waiting for a quiet moment',
       'refreshed ' + (after - before) + ' times in six seconds');

    console.log('\nA new visitor arriving, and leaving');
    await page.evaluate(p => { window.PLAN['rpc:site_stats'] = p; }, stats(14));
    await page.evaluate(() => window.__heard.site_presence({ eventType: 'INSERT', new: { session: 'abcdefgh1' }, old: {} }));
    await page.waitForTimeout(1600);
    k = await kpi(page);
    is(k['total visits'] === '14', 'shows up in the figures as they arrive', JSON.stringify(k));
    is(/1 person here now/.test(await here(page)), 'and as one person here now', await here(page));
    /* Exactly what supabase-js v2 delivers for a departure. */
    await page.evaluate(() => window.__heard.site_presence({ eventType: 'DELETE', new: {}, old: { session: 'abcdefgh1' } }));
    await page.waitForTimeout(200);
    is(/Nobody on the site/.test(await here(page)), 'and is gone the moment they leave, not 45 seconds later', await here(page));
    await page.close();

    console.log('\nWhen the live figures are refused');
    page = await open({ 'rpc:site_stats': stats(5), 'rpc:site_here': { data: [] } }, { 'vbp-admin-figures': 'CHANNEL_ERROR' });
    await page.evaluate(() => window.__heard.site_presence({ eventType: 'INSERT', new: { session: 'visitorxx1' }, old: {} }));
    await page.waitForTimeout(200);
    is(/1 person here now/.test(await here(page)), 'who is here still arrives instantly', await here(page));
    const askedHere = await page.evaluate(() => window.__rpc.site_here || 0);
    is(askedHere === 1, 'and is not being asked for on a timer instead', 'site_here asked ' + askedHere + ' times');
    await page.close();

    console.log('\nBrowsing location');
    page = await open({ 'rpc:site_stats': stats(14), 'rpc:site_here': { data: [] }, 'rpc:site_places_report': PLACES });
    await page.waitForTimeout(800);
    const pl = await page.evaluate(() => {
      const card = document.querySelector('.an-places');
      const rows = sel => Array.from(card.querySelectorAll(sel + ' .an-row')).map(r => r.textContent.replace(/\s+/g, ' ').trim());
      return {
        said: card.querySelector('.an-places-said').textContent,
        countries: rows('.an-places-lists > div:first-child'),
        towns: rows('.an-places-lists > div:last-child'),
        markers: card.querySelectorAll('.leaflet-interactive').length
      };
    });
    is(/12 of 14 visits placed/.test(pl.said), 'it says how many visits could be placed: 12 of 14', pl.said);
    is(/Zambia/.test(pl.countries[0] || '') && /11/.test(pl.countries[0] || ''), 'Zambia first, with 11 visits', pl.countries.join(' | '));
    is(/🇿🇲/.test(pl.countries[0] || ''), 'with its flag');
    is(/Lusaka/.test(pl.towns[0] || '') && /Kitwe/.test(pl.towns[1] || ''), 'Lusaka, then Kitwe', pl.towns.join(' | '));
    if (LEAFLET) {
      is(pl.markers === 3, 'one circle on the map for each town', pl.markers + ' circles');
      const lusaka = await page.evaluate(() => {
        let found = null;
        const m = document.querySelector('.an-map');
        return m && m.querySelector('.leaflet-pane') ? true : found;
      });
      is(lusaka === true, 'on a real map');
    } else {
      console.log('  (the map drawing itself was skipped: no local copy of Leaflet)');
    }
    await page.close();

    console.log('\nBefore the map is switched on');
    page = await open({ 'rpc:site_stats': stats(3), 'rpc:site_here': { data: [] },
      'rpc:site_places_report': { error: 'Could not find the function public.site_places_report' } });
    const off = await page.evaluate(() => ({
      said: document.querySelector('.an-places-said').textContent,
      kpis: document.querySelector('.an-kpis .an-kpi-n').textContent
    }));
    is(/run supabase-analytics-live\.sql/.test(off.said), 'the map says what to run', off.said);
    is(off.kpis === '3', 'and everything else on the page carries on as normal', off.kpis);
    await page.close();

    is(errors.length === 0, 'no errors on the page', errors.join(' | '));
  } catch (e) {
    fail('the test itself broke', e && e.stack);
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failures ? '\n  ✗ ' + failures + ' of ' + checks + ' checks FAILED'
                       : '\n  live analytics: all ' + checks + ' checks passed');
  process.exit(failures ? 1 : 0);
})();
