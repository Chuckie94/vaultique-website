/* ===========================================================================
   ANALYTICS: THE RANGES -- driven in a real browser

   THE OWNER: "what's the difference between this week and last 7 days? It
   doesn't add up to me. I also need last 3 months, 6 months, 9 months"

   "This week" starts on Monday and grows a day at a time until Sunday;
   "Last 7 days" is always today and the six days before, so it slides. On a
   Saturday they differ by one Sunday, on a Monday by six days, and only on a
   Sunday are they the same. Nothing on the page said so, so the range line
   under the buttons now names the weekdays: "Mon 19 Oct to Sat 24 Oct".

   And three new buttons, which slide the same way "Last 7 days" does: today
   and back exactly three, six or nine months. Checked here against a clock
   held still, on the days a month arithmetic gets wrong (the 31st of a month
   whose earlier months are shorter, a leap year, a new year), and at a
   phone's width, where a longer range means more dates under the chart.

   The real assets/admin/analytics.js, with the database answered by this file.
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
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/assets/admin/admin.css"></head><body>
<div class="wrap"><div id="host"></div></div>
<script src="/assets/formats.js"></script>
<script src="/assets/admin/registry.js"></script>
<script>
window.PLAN = window.PLAN || {};
window.__asked = [];
function answer(spec) {
  return new Promise(function (res) { setTimeout(function () {
    res({ data: spec ? spec.data : null, error: null });
  }, 5); });
}
window.__sb = {
  rpc: function (name, args) {
    window.__asked.push({ name: name, args: args || {} });
    return answer(window.PLAN['rpc:' + name]);
  },
  channel: function () {
    var ch = { on: function () { return ch; },
               subscribe: function (cb) { setTimeout(function () { cb && cb('SUBSCRIBED'); }, 5); return ch; } };
    return ch;
  },
  removeChannel: function () {},
  from: function () { var b = { select: function () { return b; }, eq: function () { return b; },
    gte: function () { return b; }, lte: function () { return b; }, order: function () { return b; },
    limit: function () { return b; }, then: function (a, c) { return answer({ data: [] }).then(a, c); } }; return b; }
};
window.__store = { load: function (k) {
  return Promise.resolve(k === 'general' ? { timezone: 'Africa/Lusaka' } : {});
} };
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

const STATS = { data: { visits: 40, visitors: 31, page_views: 90, product_views: 30,
  add_to_cart: 4, checkout_starts: 2, orders: 1, sales: 900, currency: 'ZMW' } };

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch();
  const errors = [];

  /* Ten in the morning in Lusaka on the day given. */
  async function open(day, width) {
    const page = await browser.newPage({ viewport: { width: width || 1200, height: 1400 } });
    page.on('pageerror', e => errors.push(String(e.message || e)));
    await page.clock.setFixedTime(new Date(day + 'T08:00:00Z'));
    await page.route(/cdnjs\.cloudflare\.com|openstreetmap\.org/, route => route.abort());
    await page.goto('http://127.0.0.1:' + server.address().port + '/');
    await page.evaluate((plan) => {
      window.PLAN = plan;
      window.VBP_ADMIN.pages.analytics.render(document.getElementById('host'), { sb: window.__sb, store: window.__store });
    }, { 'rpc:site_stats': STATS, 'rpc:site_here': { data: [] } });
    await page.waitForTimeout(500);
    return page;
  }
  /* Press a range and read back what it asked the database for, and said. */
  async function pick(page, label) {
    const found = await page.evaluate((label) => {
      const b = Array.from(document.querySelectorAll('.an-preset')).find(x => x.textContent.trim() === label);
      if (!b) return false;
      window.__asked = [];
      b.click();
      return true;
    }, label);
    if (!found) return null;
    await page.waitForTimeout(250);
    return page.evaluate(() => {
      const stats = window.__asked.filter(a => a.name === 'site_stats').pop();
      const series = window.__asked.filter(a => a.name === 'site_series').pop();
      const said = Array.from(document.querySelectorAll('.an-bar .count')).map(x => x.textContent.trim()).filter(Boolean)[0] || '';
      const boxes = Array.from(document.querySelectorAll('.an-date')).map(x => x.value);
      return { from: stats && stats.args.p_from, to: stats && stats.args.p_to,
               grain: series && series.args.p_grain, said: said, boxes: boxes,
               on: (document.querySelector('.an-preset.on') || {}).textContent };
    });
  }
  /* The dates under the chart: none touching another, none cut off. */
  const dates = page => page.evaluate(() => {
    const svg = document.querySelector('.an-plot svg');
    if (!svg) return null;
    const edge = svg.getBoundingClientRect();
    /* The scale's numbers stand at the left above y 220; the dates below. */
    const r = Array.from(svg.querySelectorAll('text'))
      .filter(t => +t.getAttribute('y') > 220)
      .map(t => { const b = t.getBoundingClientRect(); return { t: t.textContent, l: b.left, r: b.right }; })
      .sort((a, b) => a.l - b.l);
    let touch = [], cut = [];
    for (let i = 1; i < r.length; i++) if (r[i].l < r[i - 1].r + 4) touch.push(r[i - 1].t + '|' + r[i].t);
    r.forEach(x => { if (x.l < edge.left - 0.5 || x.r > edge.right + 0.5) cut.push(x.t); });
    return { n: r.length, touch: touch, cut: cut, all: r.map(x => x.t).join(' ') };
  });

  try {
    /* ==================================================================== */
    console.log('\nThe buttons');
    let page = await open('2026-10-24');
    const labels = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.an-preset')).map(b => b.textContent.trim()));
    is(labels.join(', ') === 'Today, Yesterday, Last 7 days, This week, This month, ' +
       'Last 3 months, Last 6 months, Last 9 months, This year',
       'Last 3, 6 and 9 months are offered, between This month and This year', labels.join(', '));

    /* ==================================================================== */
    console.log('\nSaturday 24 October 2026: this week and the last seven days');
    let r = await pick(page, 'Last 7 days');
    is(r && r.from === '2026-10-18' && r.to === '2026-10-24',
       'Last 7 days is today and the six days before: Sunday the 18th to today', JSON.stringify(r));
    is(r && r.said === 'Sun 18 Oct to Sat 24 Oct 2026 · 7 days',
       'and the line under the buttons says so, weekdays and all', r && r.said);
    r = await pick(page, 'This week');
    is(r && r.from === '2026-10-19' && r.to === '2026-10-24',
       'This week starts on Monday the 19th', JSON.stringify(r));
    is(r && r.said === 'Mon 19 Oct to Sat 24 Oct 2026 · 6 days',
       'which the line says, so the missing Sunday is plain to see', r && r.said);

    /* ==================================================================== */
    console.log('\nThe new ranges, from the same Saturday');
    r = await pick(page, 'Last 3 months');
    is(r && r.from === '2026-07-25' && r.to === '2026-10-24' && r.on === 'Last 3 months',
       'Last 3 months: 25 July to today', JSON.stringify(r));
    is(r && r.said === 'Sat 25 Jul to Sat 24 Oct 2026 · 92 days', 'said as 92 days', r && r.said);
    is(r && r.grain === 'week' && r.boxes.join() === '2026-07-25,2026-10-24',
       'drawn week by week, with the date boxes filled in to match', JSON.stringify(r));
    r = await pick(page, 'Last 6 months');
    is(r && r.from === '2026-04-25' && r.to === '2026-10-24', 'Last 6 months: 25 April to today', JSON.stringify(r));
    is(r && /· 183 days$/.test(r.said) && r.grain === 'week', 'said as 183 days, week by week', r && r.said);
    r = await pick(page, 'Last 9 months');
    is(r && r.from === '2026-01-25' && r.to === '2026-10-24', 'Last 9 months: 25 January to today', JSON.stringify(r));
    is(r && /· 273 days$/.test(r.said) && r.grain === 'week', 'said as 273 days, week by week', r && r.said);
    r = await pick(page, 'This year');
    is(r && r.from === '2026-01-01' && r.to === '2026-10-24', 'This year is unchanged: 1 January to today', JSON.stringify(r));
    await page.close();

    /* ==================================================================== */
    console.log('\nOn the days month arithmetic gets wrong');
    const cases = [
      ['2026-05-31', 'Last 3 months', '2026-03-01', '31 May: three months back is the end of February, so from 1 March'],
      ['2026-05-31', 'Last 6 months', '2025-12-01', '31 May, six months: from 1 December last year'],
      ['2026-03-31', 'Last 9 months', '2025-07-01', '31 March, nine months: from 1 July'],
      ['2028-05-29', 'Last 3 months', '2028-03-01', 'a leap year: 29 February is three months before 29 May, so from 1 March'],
      ['2026-01-15', 'Last 3 months', '2025-10-16', 'across new year: 16 October to 15 January']
    ];
    for (const [day, label, from, m] of cases) {
      page = await open(day);
      r = await pick(page, label);
      is(r && r.from === from && r.to === day, m, JSON.stringify(r));
      if (day === '2026-01-15') is(r && r.said === 'Thu 16 Oct 2025 to Thu 15 Jan 2026 · 92 days',
        'and a range across new year names both years', r && r.said);
      await page.close();
    }

    /* ==================================================================== */
    console.log('\nMonday and Sunday');
    page = await open('2026-10-26');
    r = await pick(page, 'This week');
    is(r && r.from === '2026-10-26' && r.said === 'Mon 26 Oct 2026',
       'on a Monday, This week is Monday alone', JSON.stringify(r));
    r = await pick(page, 'Last 7 days');
    is(r && r.from === '2026-10-20' && r.said === 'Tue 20 Oct to Mon 26 Oct 2026 · 7 days',
       'while Last 7 days still reaches back to last Tuesday', r && r.said);
    await page.close();
    page = await open('2026-10-25');
    const wk = await pick(page, 'This week');
    const l7 = await pick(page, 'Last 7 days');
    is(wk && l7 && wk.from === l7.from && wk.from === '2026-10-19',
       'on a Sunday the two are the same seven days', JSON.stringify([wk, l7]));
    await page.close();

    /* ==================================================================== */
    console.log('\nOn a phone');
    for (const day of ['2026-10-24', '2026-10-31']) {
      page = await open(day, 390);
      const fit = await page.evaluate(() => ({
        page: document.documentElement.scrollWidth,
        box: Math.max.apply(null, Array.from(document.querySelectorAll('.an-preset')).map(b => b.getBoundingClientRect().right))
      }));
      if (day === '2026-10-24') is(fit.page <= 390 && fit.box <= 390, 'the nine buttons fit across the screen, wrapping', JSON.stringify(fit));
      for (const label of ['Last 7 days', 'This week', 'This month', 'Last 3 months', 'Last 6 months', 'Last 9 months', 'This year']) {
        await pick(page, label);
        await page.waitForTimeout(150);
        const d = await dates(page);
        is(d && d.n >= 2 && !d.touch.length && !d.cut.length,
           day.slice(8) + ' Oct, ' + label + ': ' + (d ? d.n : 0) + ' dates under the chart, none touching or cut off',
           JSON.stringify(d));
        if (process.env.SHOT_CHART && day === '2026-10-24' && label === 'This month') {
          await page.locator('.card').filter({ has: page.locator('.an-plot') }).screenshot({ path: process.env.SHOT_CHART });
        }
        if (process.env.SHOT && day === '2026-10-24' && label === 'Last 9 months') {
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.screenshot({ path: process.env.SHOT, clip: { x: 0, y: 0, width: 390, height: 640 } });
        }
      }
      await page.close();
    }

    /* ==================================================================== */
    console.log('\nOn a computer, as many dates as before');
    page = await open('2026-10-24', 1200);
    for (const [label, least] of [['This month', 8], ['Last 3 months', 8], ['Last 9 months', 8], ['This year', 8]]) {
      await pick(page, label);
      await page.waitForTimeout(150);
      const d = await dates(page);
      is(d && d.n >= least && d.n <= 10 && !d.touch.length && !d.cut.length,
         label + ': ' + (d ? d.n : 0) + ' dates, none touching or cut off', JSON.stringify(d));
    }
    await page.close();

    is(errors.length === 0, 'no script error anywhere', errors.join(' | '));
  } catch (e) {
    fail('threw', e && e.stack);
  }
  await browser.close();
  server.close();
  console.log(failures ? '\n  ✗ ' + failures + ' of ' + checks + ' checks FAILED'
                       : '\n  analytics ranges: all ' + checks + ' checks passed');
  process.exit(failures ? 1 : 0);
})();
