/* ===========================================================================
   ANALYTICS: HOW ORDERS WERE PAID -- driven in a real browser

   The real assets/admin/analytics.js, with the database scripted. Checks the
   new "How orders were paid" card, and that Orders and Sales count an online
   order only once it is paid.
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
window.__sb = {
  rpc: function (name) { return answer(window.PLAN['rpc:' + name]); },
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

const STATS = { data: { visits: 9, visitors: 6, page_views: 25, product_views: 4, add_to_cart: 2,
  checkout_starts: 3, orders: 5, sales: 4150, currency: 'ZMW' } };
const SPLIT = { data: {
  whatsapp_orders: 2, whatsapp_sales: 1200, online_orders: 2, online_sales: 1800,
  card_orders: 1, card_sales: 1300, mobile_orders: 1, mobile_sales: 500, delivery_paid: 80,
  online_waiting: 1, online_unfinished: 1, currency: 'ZMW' } };

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 420, height: 1400 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e)));
  await page.goto('http://127.0.0.1:' + server.address().port + '/');
  async function show(plan) {
    await page.evaluate(p => {
      window.PLAN = p;
      var host = document.getElementById('host');
      host.innerHTML = '';
      window.VBP_ADMIN.pages.analytics.render(host, { sb: window.__sb, store: window.__store });
    }, plan);
    await page.waitForTimeout(500);
    return page.evaluate(() => {
      const kpi = {};
      document.querySelectorAll('.an-kpis:not(.an-pay-tiles) .an-kpi').forEach(k => {
        kpi[k.querySelector('.an-kpi-l').textContent] = k.querySelector('.an-kpi-n').textContent;
      });
      const card = document.querySelector('.an-pay');
      return {
        kpi, shown: !!card && !card.classList.contains('hide'),
        tiles: card ? Array.from(card.querySelectorAll('.an-kpi')).map(t => t.textContent.replace(/\s+/g, ' ').trim()) : [],
        rows: card ? Array.from(card.querySelectorAll('.an-row')).map(t => t.textContent.replace(/\s+/g, ' ').trim()) : [],
        note: card ? (card.querySelector('.an-note') || {}).textContent : ''
      };
    });
  }
  try {
    console.log('\nBefore online payment is used');
    let v = await show({ 'rpc:site_stats': STATS, 'rpc:pay_sales_split': { error: 'function does not exist' } });
    is(!v.shown, 'on a shop that has not run supabase-payments.sql, there is no new card');
    is(/5/.test(v.kpi.Orders) && /4,150/.test(v.kpi.Sales), 'and Orders and Sales are exactly as before', JSON.stringify(v.kpi));
    v = await show({ 'rpc:site_stats': STATS, 'rpc:pay_sales_split': { data: Object.assign({}, SPLIT.data,
      { online_orders: 0, online_sales: 0, card_orders: 0, card_sales: 0, mobile_orders: 0, mobile_sales: 0,
        online_waiting: 0, online_unfinished: 0 }) } });
    is(!v.shown, 'nor while online payment is off and nobody has paid online');

    console.log('\nWith online payments');
    v = await show({ 'rpc:site_stats': STATS, 'rpc:pay_sales_split': SPLIT, 'settings:payments': { data: { onlineEnabled: true } } });
    is(v.shown, 'a "How orders were paid" card appears');
    is(v.kpi.Orders === '4' && /3,000/.test(v.kpi.Sales),
       'Orders and Sales count WhatsApp plus paid online only: 4 orders, K3,000 (the unpaid one is not a sale)', JSON.stringify(v.kpi));
    is(v.tiles.some(t => /1,800.*Paid online.*2 orders/.test(t)), 'paid online: value and number of orders', JSON.stringify(v.tiles));
    is(v.tiles.some(t => /1,200.*Ordered on WhatsApp.*2 orders/.test(t)), 'ordered on WhatsApp, the same way');
    is(v.tiles.some(t => /^60%.*Online share/.test(t)), 'the online share of sales (1,800 of 3,000 = 60%)');
    is(v.tiles.some(t => /^1\s*Not completed.*1 still waiting/.test(t)), 'and online payments never finished, and still waiting, counted apart');
    is(v.rows.length === 3 && /Card.*1,300.*1 order.*43%/.test(v.rows[0]) && /Mobile money.*500/.test(v.rows[1]) && /WhatsApp/.test(v.rows[2]),
       'split into card, mobile money and WhatsApp', JSON.stringify(v.rows));
    is(/includes .*80 of delivery fees/.test(v.note), 'with the delivery paid online mentioned', v.note);
    if (process.env.SHOT) {
      const card = await page.$('.an-pay');
      await card.screenshot({ path: process.env.SHOT });
    }
    is(errors.length === 0, 'with no errors on the page' + (errors.length ? ': ' + errors[0] : ''));
  } catch (e) {
    fail('threw: ' + (e && e.stack || e));
  } finally {
    await browser.close();
    server.close();
  }
  console.log('\n' + (failures ? '  ✗ ' + failures + ' of ' + checks + ' checks FAILED'
                                : '  analytics by payment: all ' + checks + ' checks passed'));
  process.exit(failures ? 1 : 0);
})();
