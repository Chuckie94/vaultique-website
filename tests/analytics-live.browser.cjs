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
window.__sb = {
  rpc: function (name) { if (name === 'site_stats') window.__asked++; return answer(window.PLAN['rpc:' + name]); },
  channel: function () {
    var ch = {
      on: function (kind, filter, fn) { window.__heard[filter.table] = fn; return ch; },
      subscribe: function (cb) { setTimeout(function () { cb && cb('SUBSCRIBED'); }, 5); return ch; }
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

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 1400 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e)));
  await page.goto('http://127.0.0.1:' + server.address().port + '/');
  const kpi = () => page.evaluate(() => {
    const out = {};
    document.querySelectorAll('.an-kpis:not(.an-pay-tiles) .an-kpi').forEach(k => {
      out[k.querySelector('.an-kpi-l').textContent.trim().toLowerCase()] = k.querySelector('.an-kpi-n').textContent.trim();
    });
    return out;
  });
  try {
    console.log('\nThe Analytics page is open');
    await page.evaluate(p => {
      window.PLAN = p;
      window.VBP_ADMIN.pages.analytics.render(document.getElementById('host'), { sb: window.__sb, store: window.__store });
    }, { 'rpc:site_stats': stats(12), 'rpc:site_here': { data: [] } });
    await page.waitForTimeout(600);
    let k = await kpi();
    is(k['total visits'] === '12', 'it shows 12 visits', JSON.stringify(k));
    is(await page.evaluate(() => typeof window.__heard.site_events === 'function'),
       'and listens for the website recording a page or a piece');

    console.log('\nSomebody opens a page on the website');
    await page.evaluate(p => { window.PLAN['rpc:site_stats'] = p; }, stats(13));
    await page.evaluate(() => window.__heard.site_events({ eventType: 'INSERT', new: { kind: 'page_view' } }));
    await page.waitForTimeout(1600);
    k = await kpi();
    is(k['total visits'] === '13', 'the visits go up to 13 without reloading', JSON.stringify(k));
    is(k['page views'] === '26', 'and the page views with them');
    is(k['product views'] === '12', 'and the product views');

    console.log('\nSeveral things at once');
    const before = await page.evaluate(() => window.__asked);
    await page.evaluate(() => { for (let i = 0; i < 8; i++) window.__heard.site_events({ eventType: 'INSERT', new: {} }); });
    await page.waitForTimeout(1600);
    const after = await page.evaluate(() => window.__asked);
    is(after - before === 1, 'are read as one, not eight times', 'asked ' + (after - before) + ' times');

    console.log('\nA new visitor arriving');
    await page.evaluate(p => { window.PLAN['rpc:site_stats'] = p; }, stats(14));
    await page.evaluate(() => window.__heard.site_presence({ eventType: 'INSERT', new: { session: 'abcdefgh1' } }));
    await page.waitForTimeout(1600);
    k = await kpi();
    is(k['total visits'] === '14', 'shows up in the figures as they arrive', JSON.stringify(k));

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
