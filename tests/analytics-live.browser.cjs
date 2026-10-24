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

/* Build 69: the same report once visitors have started saying where they are.
   Livingstone was invisible before -- everybody there on mobile data was
   "Lusaka" -- and is now the town most people named. */
const PLACES_TOLD = { data: { visits: 14, located: 12, told: 5, told_visitors: 4,
  countries: [{ code: 'ZM', name: 'Zambia', visits: 11, visitors: 9, page_views: 30, told: 5, told_visitors: 4 },
              { code: 'ZA', name: 'South Africa', visits: 1, visitors: 1, page_views: 2, told: 0, told_visitors: 0 }],
  cities: [{ country: 'ZM', country_name: 'Zambia', region: 'Lusaka Province', name: 'Lusaka', lat: -15.42, lon: 28.28, visits: 6, visitors: 5, page_views: 16, told: 1, told_visitors: 1 },
           { country: 'ZM', country_name: 'Zambia', region: 'Southern Province', name: 'Livingstone', lat: -17.84, lon: 25.85, visits: 3, visitors: 2, page_views: 9, told: 3, told_visitors: 2 },
           { country: 'ZM', country_name: 'Zambia', region: 'Copperbelt Province', name: 'Kitwe', lat: -12.8, lon: 28.21, visits: 2, visitors: 2, page_views: 5, told: 1, told_visitors: 1 },
           { country: 'ZA', country_name: 'South Africa', region: 'Gauteng', name: 'Johannesburg', lat: -26.2, lon: 28.04, visits: 1, visitors: 1, page_views: 2, told: 0, told_visitors: 0 }] } };

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

    console.log('\nThe Traffic chart\'s legend');
    {
      /* Build 69's map key borrowed the chart legend's class names and tipped
         the chart's "Visits" and "Unique visitors" over its dates. */
      const day = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
      const tp = await open({ 'rpc:site_stats': stats(12), 'rpc:site_here': { data: [] },
        'rpc:site_series': { data: [0, 1, 2, 3, 4, 5, 6].map((n) => ({ bucket: day(n), visits: 7 - n, visitors: 6 - n, page_views: 9 })) } });
      const lay = await tp.evaluate(() => {
        const card = Array.from(document.querySelectorAll('.card')).find((c) => /Traffic/.test((c.querySelector('h3') || {}).textContent || ''));
        const keys = Array.from(card.querySelectorAll('.an-legend .an-key'));
        const plot = card.querySelector('.an-plot').getBoundingClientRect();
        const labels = Array.from(card.querySelectorAll('.an-plot svg text')).map((x) => x.getBoundingClientRect());
        const leg = card.querySelector('.an-legend').getBoundingClientRect();
        return {
          keys: keys.map((k) => ({ t: k.textContent.trim(), turn: getComputedStyle(k).transform, w: Math.round(k.getBoundingClientRect().width), h: Math.round(k.getBoundingClientRect().height) })),
          below: Math.round(leg.top - plot.bottom),
          clash: labels.filter((r) => r.bottom > leg.top && r.top < leg.bottom && r.right > leg.left && r.left < leg.right).length,
          labels: labels.length
        };
      });
      is(lay.keys.length === 2 && lay.keys.every((k) => k.turn === 'none' && k.w > k.h),
         'Visits and Unique visitors sit level, each a swatch and its word side by side', JSON.stringify(lay.keys));
      is(lay.labels > 0 && lay.below >= 0 && lay.clash === 0, 'below the chart, touching none of its dates or numbers', JSON.stringify(lay));
      const scale = await tp.evaluate(() => {
        const card = Array.from(document.querySelectorAll('.card')).find((c) => /Traffic/.test((c.querySelector('h3') || {}).textContent || ''));
        return Array.from(card.querySelectorAll('.an-plot svg text[text-anchor="end"]')).map((x) => x.textContent);
      });
      is(scale.join(',') === '0,2,4,6,8,10', 'the scale counts in whole numbers, 0 to 10 in twos, not "3" and "8" for 2.5 and 7.5', scale.join(','));
      await tp.locator('.card:has(.an-plot)').screenshot({ path: path.join(ROOT, '..', 'traffic-legend.png') });
      await tp.close();
    }

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
        markers: card.querySelectorAll('.an-pin').length,
        widest: Math.max.apply(null, Array.from(card.querySelectorAll('.an-pin svg')).map(x => x.getBoundingClientRect().width).concat([0]))
      };
    });
    is(/12 of 14 visits placed/.test(pl.said), 'it says how many visits could be placed: 12 of 14', pl.said);
    is(/Zambia/.test(pl.countries[0] || '') && /11/.test(pl.countries[0] || ''), 'Zambia first, with 11 visits', pl.countries.join(' | '));
    is(/🇿🇲/.test(pl.countries[0] || ''), 'with its flag');
    is(/Lusaka/.test(pl.towns[0] || '') && /Kitwe/.test(pl.towns[1] || ''), 'Lusaka, then Kitwe', pl.towns.join(' | '));
    if (LEAFLET) {
      is(pl.markers === 3, 'one pin on the map for each town', pl.markers + ' pins');
      is(pl.widest > 0 && pl.widest <= 14, 'small pins: at most 14px wide, even for the busiest town', pl.widest + 'px');
      if (process.env.SHOT) await page.locator('.an-places').screenshot({ path: process.env.SHOT });
      const lusaka = await page.evaluate(() => {
        let found = null;
        const m = document.querySelector('.an-map');
        return m && m.querySelector('.leaflet-pane') ? true : found;
      });
      is(lusaka === true, 'on a real map');
    } else {
      console.log('  (the map drawing itself was skipped: no local copy of Leaflet)');
    }
    const old = await page.evaluate(() => {
      const card = document.querySelector('.an-places');
      return { legend: !card.querySelector('.an-mapkey').classList.contains('hide'),
               said: !card.querySelector('.an-said').classList.contains('hide') };
    });
    is(!old.legend && !old.said, 'before supabase-browsing-towns.sql, the card is exactly as it was', JSON.stringify(old));
    await page.close();

    console.log('\nWhere visitors say they are (build 69)');
    page = await open({ 'rpc:site_stats': stats(14), 'rpc:site_here': { data: [] }, 'rpc:site_places_report': PLACES_TOLD });
    await page.waitForTimeout(900);
    const st = await page.evaluate(() => {
      const card = document.querySelector('.an-places');
      const rows = (sel) => Array.from(card.querySelectorAll(sel + ' .an-row')).map((r) => r.textContent.replace(/\s+/g, ' ').trim());
      return {
        said: card.querySelector('.an-places-said').textContent,
        legend: !card.querySelector('.an-mapkey').classList.contains('hide'),
        note: card.querySelector('.an-said .an-note').textContent,
        named: rows('.an-said'),
        towns: rows('.an-places-lists > div:last-child'),
        pins: Array.from(card.querySelectorAll('.an-pin path')).map((p) => p.getAttribute('fill'))
      };
    });
    is(/5 of them in a town the visitor named/.test(st.said) && /mobile data in Lusaka/.test(st.said),
       'the card says how many visits were in a town the visitor named, and why the rest lean on Lusaka', st.said);
    is(st.legend, 'a key tells the two kinds of pin apart');
    is(/The 4 visitors who answered/.test(st.note), 'the new list says whose answers it is built from', st.note);
    is(/^Livingstone/.test(st.named[0] || '') && /2/.test(st.named[0] || '') && /50% of answers/.test(st.named[0] || ''),
       'Livingstone leads "Where visitors say they are": 2 people, half the answers', st.named.join(' | '));
    is(st.named.length === 3 && !st.named.some((r) => /Johannesburg/.test(r)), 'and only towns somebody named are in it', st.named.join(' | '));
    is(st.towns.some((r) => /^Lusaka/.test(r) && /1 said so/.test(r)), 'the full town list marks how many said so', st.towns.join(' | '));
    if (LEAFLET) {
      is(st.pins.length === 4 && st.pins.filter((f) => f === '#c9a24a').length === 3 && st.pins.filter((f) => f === '#d5d9df').length === 1,
         'gold pins where somebody named the town, a grey one where it is only a guess (Johannesburg)', JSON.stringify(st.pins));
      await page.locator('.an-places').screenshot({ path: path.join(ROOT, '..', 'map-told.png') });
    }
    await page.close();

    console.log('\nWhich pieces were added to carts (build 70)');
    const CARTS = { data: [
      { sku: 'BG-1', label: 'Crossbody Tote Sling', carts: 3, people: 2, views: 5, last_at: new Date().toISOString() },
      { sku: 'AC-2', label: 'Heritage Suede Belt',  carts: 1, people: 1, views: 0, last_at: new Date().toISOString() }
    ] };
    page = await open({ 'rpc:site_stats': stats(14), 'rpc:site_here': { data: [] }, 'rpc:site_cart_products': CARTS });
    await page.waitForTimeout(700);
    const carts = await page.evaluate(() => {
      const card = document.querySelector('.an-carts');
      return { said: card.querySelector('.an-carts-said').textContent,
               rows: Array.from(card.querySelectorAll('.an-row')).map((r) => r.textContent.replace(/\s+/g, ' ').trim()),
               go: !!Array.from(document.querySelectorAll('.an-kpi')).find((k) => /Added to cart/.test(k.textContent) && k.querySelector('.an-kpi-go')) };
    });
    is(carts.go, 'the Added to cart number now leads to which pieces they were');
    is(/2 pieces added to carts, 4 times in all/.test(carts.said), 'the card says how many pieces and how many times', carts.said);
    is(/^Crossbody Tote Sling/.test(carts.rows[0] || '') && /3/.test(carts.rows[0]) && /2 people/.test(carts.rows[0]) && /viewed 5/.test(carts.rows[0]) && /last added/.test(carts.rows[0]),
       'each piece by name: times added, by how many people, how often viewed, when last added', carts.rows.join(' | '));
    is(/^Heritage Suede Belt/.test(carts.rows[1] || ''), 'including a piece added straight from the shop page', carts.rows.join(' | '));
    await page.locator('.an-carts').screenshot({ path: path.join(ROOT, '..', 'carts-card.png') });
    await page.locator('.an-kpis').screenshot({ path: path.join(ROOT, '..', 'carts-kpi.png') });
    await page.evaluate(() => { const c = document.querySelector('.an-carts .an-fold'); if (c) c.click(); });
    await page.click('.an-kpi-go');
    await page.waitForTimeout(400);
    is(await page.evaluate(() => !document.querySelector('.an-carts').classList.contains('is-folded')),
       'and pressing it opens the list, even one that was folded away');
    await page.close();
    page = await open({ 'rpc:site_stats': stats(14), 'rpc:site_here': { data: [] },
      'rpc:site_cart_products': { error: 'Could not find the function public.site_cart_products(p_from, p_limit, p_to, p_tz) in the schema cache' },
      'rpc:site_top_products': { data: [
        { sku: 'BG-1', label: 'Crossbody Tote Sling', views: 5, carts: 3, visitors: 3 },
        { sku: 'AC-9', label: 'Silk Scarf', views: 9, carts: 0, visitors: 3 } ] } });
    await page.waitForTimeout(700);
    const noSql = await page.evaluate(() => ({ said: document.querySelector('.an-carts-said').textContent,
      rows: Array.from(document.querySelectorAll('.an-carts .an-row')).map((r) => r.textContent.replace(/\s+/g, ' ').trim()) }));
    is(noSql.rows.length === 1 && /^Crossbody Tote Sling/.test(noSql.rows[0]) && /supabase-cart-pieces\.sql/.test(noSql.said),
       'before its SQL is run, the most viewed pieces that went to a cart, and it says so', JSON.stringify(noSql));
    await page.close();

    console.log('\nLong lists, kept tidy');
    const many = { data: Array.from({ length: 20 }, (_, k) => ({ sku: 'SKU-' + k, label: 'Piece ' + k, views: 40 - k, carts: 0 })) };
    page = await open({ 'rpc:site_stats': stats(40), 'rpc:site_here': { data: [] }, 'rpc:site_top_products': many });
    const rowsShown = () => page.evaluate(() => {
      const card = Array.from(document.querySelectorAll('.card')).find(c => /Most viewed pieces/.test(c.textContent));
      return Array.from(card.querySelectorAll('.an-row')).filter(r => r.getBoundingClientRect().height > 0).length;
    });
    is(await rowsShown() === 5, 'twenty pieces viewed shows the top five', String(await rowsShown()));
    const moreBtn = await page.evaluate(() => {
      const card = Array.from(document.querySelectorAll('.card')).find(c => /Most viewed pieces/.test(c.textContent));
      const b = card.querySelector('.an-more'); return b && b.textContent;
    });
    is(moreBtn === 'Show 15 more', 'with the rest one tap away', moreBtn);
    await page.evaluate(() => {
      const card = Array.from(document.querySelectorAll('.card')).find(c => /Most viewed pieces/.test(c.textContent));
      card.querySelector('.an-more').click();
    });
    is(await rowsShown() === 20, 'and all twenty once asked for');
    await page.evaluate(() => {
      const card = Array.from(document.querySelectorAll('.card')).find(c => /Browsing device/.test(c.textContent));
      card.querySelector('.an-fold').click();
    });
    const shut = await page.evaluate(() => {
      const card = Array.from(document.querySelectorAll('.card')).find(c => /Browsing device/.test(c.textContent));
      return { folded: card.classList.contains('is-folded'), h: Math.round(card.querySelector('.an-rows').getBoundingClientRect().height),
               saved: localStorage.getItem('vbp_an_folded') };
    });
    is(shut.folded && shut.h === 0, 'a card closes when its heading is pressed', JSON.stringify(shut));
    await page.reload();
    await page.evaluate(([p]) => {
      window.PLAN = p;
      window.VBP_ADMIN.pages.analytics.render(document.getElementById('host'), { sb: window.__sb, store: window.__store });
    }, [{ 'rpc:site_stats': stats(40), 'rpc:site_here': { data: [] } }]);
    await page.waitForTimeout(500);
    is(await page.evaluate(() => Array.from(document.querySelectorAll('.card')).find(c => /Browsing device/.test(c.textContent)).classList.contains('is-folded')),
       'and stays closed next time on this device');
    await page.close();

    console.log('\nWhere visitors came from');
    page = await open({ 'rpc:site_stats': stats(40), 'rpc:site_here': { data: [] },
      'rpc:site_sources': { data: [{ source: 'Facebook', visits: 21, visitors: 19 }, { source: 'Direct', visits: 9, visitors: 8 },
                                   { source: 'Instagram', visits: 6, visitors: 6 }, { source: 'WhatsApp', visits: 4, visitors: 3 }] } });
    const src = await page.evaluate(() => {
      const card = document.querySelector('.an-sources');
      return { said: card.querySelector('.an-src-said').textContent,
               rows: Array.from(card.querySelectorAll('.an-row')).map(r => r.textContent.replace(/\s+/g, ' ').trim()) };
    });
    is(/^Facebook\s*21/.test(src.rows[0] || ''), 'Facebook first, with 21 visits', src.rows.join(' | '));
    is(src.rows.some(r => /Typed in or unknown\s*9/.test(r)), 'visits with no source said plainly', src.rows.join(' | '));
    is(/Facebook and Instagram together: 27 visits/.test(src.said), 'and Facebook and Instagram added up, to hold against Meta', src.said);
    await page.close();
    page = await open({ 'rpc:site_stats': stats(3), 'rpc:site_here': { data: [] },
      'rpc:site_sources': { error: 'Could not find the function public.site_sources' } });
    is(/supabase-analytics-sources\.sql/.test(await page.evaluate(() => document.querySelector('.an-src-said').textContent)),
       'before its SQL is run, it says what to run, and nothing else breaks');
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
