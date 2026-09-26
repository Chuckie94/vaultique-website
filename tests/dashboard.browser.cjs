/* ===========================================================================
   ADMIN > DASHBOARD — driven in a real browser

   WHY IT IS DRIVEN THIS WAY. The admin will not open without a real Supabase
   session, and stubbing a login well enough to get past it would be a test of
   the login. The Dashboard's actual boundary is narrower than that and is
   stated in the file itself:

       render(host, ctx)   with ctx = { sb, store, navigate, ... }

   So the page is rendered exactly as the shell renders it, against an sb this
   file writes the answers for. Nothing in dashboard.js is special-cased for
   testing, and every path below is the path a shop takes.

   WHAT IS WORTH GUARDING. A dashboard asks a dozen questions at once and some
   of them WILL be refused — a role without Analytics, a shop that has not run
   the analytics SQL, a table that is simply slow. The interesting behaviour is
   not the happy path; it is that one refusal costs one card and nothing else.
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
const group = t => console.log('\n' + t);

/* The harness page: the registry and the formatter the shell would already
   have loaded, the real stylesheet, and the tab strip the page reads to know
   what this account may open. */
function harness() {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/assets/admin/admin.css">
</head><body>
<div class="wrap">
  <div id="tabs"></div>
  <div id="host"></div>
</div>
<script src="/assets/formats.js"></script>
<script src="/assets/admin/registry.js"></script>
<script src="/__stub.js"></script>
<script src="/assets/admin/dashboard.js"></script>
</body></html>`;
}

/* The scripted Supabase. PLAN is written by each test before the page renders;
   every answer is either { data } , { count } or { error }. */
const STUB = `
window.__nav = [];
window.__asked = { rpc: [], from: [] };

function answer(spec) {
  var d = (spec && spec.delay) || 0;
  return new Promise(function (res) {
    setTimeout(function () {
      if (spec && spec.error) res({ data: null, count: null, error: { message: spec.error } });
      else res({ data: spec ? spec.data : null, count: spec ? spec.count : null, error: null });
    }, d);
  });
}

/* A PostgREST builder is chainable and thenable. This is the same shape,
   recording what it was asked so a test can check the question as well as
   the answer. */
function builder(table) {
  var q = { table: table, filters: [], head: false };
  var b = {
    select: function (cols, opts) {
      q.cols = cols;
      if (opts && opts.head) q.head = true;
      if (opts && opts.count) q.count = opts.count;
      return b;
    },
    eq:  function (c, v) { q.filters.push(['eq', c, v]); return b; },
    gte: function (c, v) { q.filters.push(['gte', c, v]); return b; },
    lte: function (c, v) { q.filters.push(['lte', c, v]); return b; },
    is:  function (c, v) { q.filters.push(['is', c, v]); return b; },
    in:  function (c, v) { q.filters.push(['in', c, v]); return b; },
    neq: function (c, v) { q.filters.push(['neq', c, v]); return b; },
    order: function (c, o) { q.order = [c, o]; return b; },
    limit: function (n) { q.limit = n; return b; },
    then: function (onOk, onErr) {
      window.__asked.from.push(q);
      var key = q.head ? table + ':count' : table;
      /* The count of orders still on the online payment page is its own
         question, answered 0 unless a test plans otherwise. */
      if (q.head && q.filters.some(function (f) { return f[1] === 'payment_method'; })) {
        key = table + ':count:unpaid';
        return answer(window.PLAN[key] !== undefined ? window.PLAN[key] : { count: 0 }).then(onOk, onErr);
      }
      var spec = window.PLAN[key] !== undefined ? window.PLAN[key] : window.PLAN[table];
      return answer(spec).then(onOk, onErr);
    }
  };
  return b;
}

window.__sb = {
  rpc: function (name, args) {
    window.__asked.rpc.push({ name: name, args: args });
    var spec = window.PLAN['rpc:' + name];
    /* site_stats is asked twice with different ranges. A test says what
       each one answers with { same: ..., span: ... } rather than shipping
       a function across, which cannot be serialised. */
    if (spec && spec.when) {
      spec = (args && args.p_from === args.p_to) ? spec.when.same : spec.when.span;
    }
    return answer(spec);
  },
  from: builder
};

/* The product feed is fetched rather than asked for through sb, so it is
   answered here from the same plan. A test writes PLAN.feed as { data } for
   a catalogue, or { error } for a feed that will not answer. */
var realFetch = window.fetch;
window.fetch = function (url, opts) {
  if (String(url).indexOf('/api/products') === 0) {
    var spec = window.PLAN.feed;
    window.__asked.from.push({ table: '/api/products' });
    if (spec && spec.error) return Promise.reject(new Error(spec.error));
    return Promise.resolve({
      ok: true,
      json: function () { return Promise.resolve({ products: (spec && spec.data) || [] }); }
    });
  }
  return realFetch.apply(window, arguments);
};

window.__store = {
  load: function (key) {
    var spec = window.PLAN['settings:' + key];
    if (spec && spec.error) return Promise.reject(new Error(spec.error));
    return Promise.resolve((spec && spec.data) || {});
  }
};

window.__render = function () {
  var host = document.getElementById('host');
  host.innerHTML = '';
  window.VBP_ADMIN.pages.dashboard.render(host, {
    sb: window.__sb,
    store: window.__store,
    navigate: function (tab, sub) { window.__nav.push(tab + (sub ? '/' + sub : '')); }
  });
};

window.__tabs = function (list) {
  document.getElementById('tabs').innerHTML = list.map(function (t) {
    return '<button class="tab" data-tab="' + t + '"></button>';
  }).join('');
};
`;

/* The rule that stops a tap becoming a text selection, read out of the
   stylesheet rather than out of the browser: Chromium does not implement
   -webkit-touch-callout and drops it when parsing, so what ships is the
   only place it can be seen. Returns the selector list and the body. */
function touchRule() {
  const css = fs.readFileSync(path.join(ROOT, 'assets/admin/admin.css'), 'utf8');
  const at = css.indexOf('-webkit-touch-callout');
  if (at < 0) return null;
  const open = css.lastIndexOf('{', at);
  const prev = Math.max(css.lastIndexOf('}', open), css.lastIndexOf('*/', open));
  return {
    selectors: css.slice(prev + 1, open),
    body: css.slice(open, css.indexOf('}', at) + 1)
  };
}

const TYPES = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const p = new URL(req.url, 'http://x').pathname;
      if (p === '/__stub.js') {
        res.writeHead(200, { 'Content-Type': TYPES['.js'] }); res.end(STUB); return;
      }
      if (p === '/' ) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(harness()); return;
      }
      const file = path.join(ROOT, p);
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(''); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(fs.readFileSync(file));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

/* Today and the six days behind it, in the shop's zone, so the fixtures below
   are about the same days the page will ask for. */
const TZ = 'Africa/Lusaka';
const dayIn = (tz, d) => new Intl.DateTimeFormat('en-GB', {
  timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
}).formatToParts(d).reduce((a, p) => (a[p.type] = p.value, a), {});
function stampIn(tz, d) { const g = dayIn(tz, d); return g.year + '-' + g.month + '-' + g.day; }
const TODAY = stampIn(TZ, new Date());
const at = daysAgo => new Date(Date.now() - daysAgo * 86400000).toISOString();

const SETTINGS_OK = {
  'settings:general': { data: { timezone: TZ, businessName: 'Vaultique Boutique Point', currency: 'ZMW' } },
  'settings:pricing': { data: { currencySymbol: 'K', currencyPosition: 'before-space' } }
};

/* Render with a plan, and wait for it to settle. */
async function render(page, plan, tabs) {
  await page.evaluate(([p, t]) => {
    window.PLAN = p;
    window.__nav = [];
    window.__asked = { rpc: [], from: [] };
    window.__tabs(t);
    window.__render();
  }, [plan, tabs || ['dashboard', 'analytics', 'products', 'orders', 'chats', 'reviews', 'subscribers']]);
  await page.waitForTimeout(320);
}

const textOf = (page, sel) => page.evaluate(s => {
  const e = document.querySelector(s);
  return e ? (e.textContent || '').replace(/\s+/g, ' ').trim() : null;
}, sel);

/* The card whose label matches, read as { n, s }. */
const cardBy = (page, label) => page.evaluate(l => {
  const cards = Array.from(document.querySelectorAll('.an-kpi'));
  const hit = cards.find(c => {
    const t = c.querySelector('.an-kpi-l');
    return t && t.textContent.trim().toLowerCase() === l.toLowerCase();
  });
  if (!hit) return null;
  return {
    n: (hit.querySelector('.an-kpi-n') || {}).textContent || '',
    s: (hit.querySelector('.an-kpi-s') || {}).textContent || ''
  };
}, label);

/* A shop with nothing happening: the baseline every section is varied
   against, so each test says only what it is actually about. */
const QUIET = {
  'rpc:site_stats': { when: { same: { data: {} }, span: { data: {} } } },
  orders: { data: [] },
  'customers:count': { count: 0 }, customers: { data: [] },
  'subscribers:count': { count: 0 }, subscribers: { data: [] },
  product_meta: { data: [] },
  feed: { data: [] }
};

/* One of the three windows in "Orders taken", read as { n, s }. */
const period = (page, label) => page.evaluate(l => {
  const box = Array.from(document.querySelectorAll('.db-period')).find(b => {
    const t = b.querySelector('.db-period-l');
    return t && t.textContent.trim().toLowerCase() === l.toLowerCase();
  });
  if (!box) return null;
  return {
    n: (box.querySelector('.db-period-n') || {}).textContent || '',
    s: (box.querySelector('.db-period-s') || {}).textContent || ''
  };
}, label);

/* Every line currently in "Needs attention". */
const attnText = p => p.evaluate(() =>
  Array.from(document.querySelectorAll('.db-attn-item .db-attn-t'))
    .map(e => e.textContent.replace(/\s+/g, ' ').trim()));

/* The stock figures, as { label: value }. */
const stock = p => p.evaluate(() => {
  const out = {};
  document.querySelectorAll('.card .an-rows .an-row').forEach(r => {
    const l = r.querySelector('.an-row-l'), n = r.querySelector('.an-row-n');
    if (l && n) out[l.textContent.trim()] = n.textContent.trim();
  });
  return out;
});

(async () => {
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const errs = [];
  const rejections = [];

  try {
    const page = await browser.newPage();
    page.on('pageerror', e => errs.push((e && (e.message || e.stack)) || JSON.stringify(e)));
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });

    /* ================================================================= */
    group('The page registers itself the way the shell expects');
    is(await page.evaluate(() => !!(window.VBP_ADMIN && window.VBP_ADMIN.pages.dashboard)),
       'it is in the registry under "dashboard"');
    is(await page.evaluate(() => window.VBP_ADMIN.pages.dashboard.title) === 'Dashboard',
       'with the title the shell puts at the top');
    is(await page.evaluate(() => typeof window.VBP_ADMIN.pages.dashboard.render) === 'function',
       'and a render it can call');

    /* ================================================================= */
    group('A shop with a normal day on it');
    await render(page, Object.assign({}, SETTINGS_OK, {
      'rpc:site_stats': { when: {
        same: { data: { visits: 41, product_views: 96, add_to_cart: 12, checkout_starts: 5 } },
        span: { data: { visits: 305, product_views: 702, add_to_cart: 88, checkout_starts: 31 } }
      } },
      orders: { data: [
        { id: '1', ref: 'VB-001', total: 1850, currency: 'ZMW', status: 'pending',   created_at: at(0) },
        { id: '2', ref: 'VB-002', total: 3200, currency: 'ZMW', status: 'confirmed', created_at: at(0) },
        { id: '3', ref: 'VB-003', total: 900,  currency: 'ZMW', status: 'cancelled', created_at: at(0) },
        { id: '4', ref: 'VB-004', total: 2400, currency: 'ZMW', status: 'completed', created_at: at(3) },
        /* Paid online: a sale. Sent to pay online and not paid: not one. */
        { id: '5', ref: 'VB-005', total: 500,  currency: 'ZMW', status: 'pending', created_at: at(0),
          payment_method: 'online', payment_status: 'paid' },
        { id: '6', ref: 'VB-006', total: 700,  currency: 'ZMW', status: 'pending', created_at: at(0),
          payment_method: 'online', payment_status: 'awaiting' }
      ] },
      'customers:count': { count: 42 },
      customers: { data: [{ created_at: at(2) }, { created_at: at(5) }] },
      'subscribers:count': { count: 73 },
      subscribers: { data: [{ created_at: at(1) }] }
    }));

    let c = await cardBy(page, 'Website visits');
    is(c && c.n === '41', 'website visits shows today', JSON.stringify(c));
    is(c && /305/.test(c.s) && /7 days/.test(c.s), 'with the week behind it underneath', c && c.s);

    c = await cardBy(page, 'Product views');
    is(c && c.n === '96', 'product views shows today', JSON.stringify(c));
    c = await cardBy(page, 'Added to cart');
    is(c && c.n === '12', 'added to cart shows today', JSON.stringify(c));
    c = await cardBy(page, 'Checkouts begun');
    is(c && c.n === '5', 'checkouts begun shows today', JSON.stringify(c));

    group('Orders are counted the way a shop counts them');
    c = await cardBy(page, 'Orders');
    is(c && c.n === '3', 'three orders today — the cancelled one and the unpaid online one are not among them', JSON.stringify(c));
    c = await cardBy(page, 'Order value');
    is(c && /5,550/.test(c.n), 'and today is worth 1850 + 3200 + 500 paid online, with the cancelled 900 and the unpaid 700 left out',
       c && c.n);
    is(c && /K/.test(c.n), 'shown in the shop’s own money', c && c.n);
    is(c && /7,950/.test(c.s), 'the week includes the older order and still excludes the cancelled',
       c && c.s);

    group('The people are totals, not today');
    c = await cardBy(page, 'Registered customers');
    is(c && c.n === '42', 'registered customers is the whole count', JSON.stringify(c));
    is(c && /\+2 this month/.test(c.s), 'with how many joined this month under it', c && c.s);
    c = await cardBy(page, 'Newsletter subscribers');
    is(c && c.n === '73', 'newsletter subscribers likewise', JSON.stringify(c));

    group('And somebody who has unsubscribed is not on the newsletter');
    let asked = await page.evaluate(() => window.__asked.from.filter(q => q.table === 'subscribers'));
    is(asked.length > 0 && asked.every(q => q.filters.some(f => f[0] === 'is' && f[1] === 'unsubscribed_at')),
       'every subscribers question excludes them',
       JSON.stringify(asked.map(q => q.filters)));

    group('It asks the shop’s own timezone, and asks about the shop’s today');
    const rpcs = await page.evaluate(() => window.__asked.rpc.filter(r => r.name === 'site_stats'));
    is(rpcs.length === 2, 'site_stats is asked twice — today, and the week', String(rpcs.length));
    is(rpcs.every(r => r.args.p_tz === TZ), 'both in the shop’s timezone',
       JSON.stringify(rpcs.map(r => r.args.p_tz)));
    is(rpcs.some(r => r.args.p_from === TODAY && r.args.p_to === TODAY),
       'one of them is today alone', JSON.stringify(rpcs.map(r => [r.args.p_from, r.args.p_to])));

    group('The greeting is the shop’s, at the shop’s hour');
    const hello = await textOf(page, '.db-hello h2');
    is(/^Good (morning|afternoon|evening)$/.test(hello || ''), 'it greets by time of day', hello);
    is(/Vaultique Boutique Point/.test(await textOf(page, '.db-hello p') || ''),
       'and names the shop', await textOf(page, '.db-hello p'));

    /* ================================================================= */
    group('Orders taken — the three windows read the same rows');
    await render(page, Object.assign({}, SETTINGS_OK, {
      'rpc:site_stats': { when: { same: { data: {} }, span: { data: {} } } },
      orders: { data: [
        { id: '1', total: 1850, status: 'pending',   created_at: at(0) },
        { id: '2', total: 3200, status: 'confirmed', created_at: at(0) },
        { id: '3', total: 900,  status: 'cancelled', created_at: at(0) },
        { id: '4', total: 2400, status: 'completed', created_at: at(2) },
        { id: '5', total: 1000, status: 'completed', created_at: at(5) }
      ] },
      'customers:count': { count: 0 }, customers: { data: [] },
      'subscribers:count': { count: 0 }, subscribers: { data: [] }
    }));

    let pd = await period(page, 'Today');
    is(pd && /^2 orders/.test(pd.n), 'today counts the two that stand', JSON.stringify(pd));
    is(pd && /5,050/.test(pd.s), 'and is worth what they came to', pd && pd.s);
    pd = await period(page, 'This month');
    is(pd && /^4 orders/.test(pd.n), 'the month has all four that stand', JSON.stringify(pd));
    is(pd && /8,450/.test(pd.s), 'worth 1850 + 3200 + 2400 + 1000', pd && pd.s);

    is(/does not take payment/i.test(await textOf(page, '.card .an-note') || ''),
       'the card says plainly that the website takes no money',
       await textOf(page, '.card .an-note'));
    is(/Business Platform/i.test(await textOf(page, '.card .an-note') || ''),
       'and points at where the books actually are');

    group('The seven days behind today are drawn, one measure at a time');
    is((await page.evaluate(() => document.querySelectorAll('.db-trend .db-bar').length)) > 0,
       'there are bars');
    is((await page.evaluate(() => document.querySelectorAll('.db-trend .db-val').length)) === 7,
       'seven days are labelled, including the empty ones',
       String(await page.evaluate(() => document.querySelectorAll('.db-trend .db-val').length)));
    let vals = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.db-trend .db-val')).map(e => e.textContent));
    is(vals[6] === '2', 'today reads 2 orders', vals.join(','));
    is(vals.indexOf('0') > -1, 'a day with none reads as a nought rather than a gap', vals.join(','));

    group('And the toggle changes the measure rather than adding an axis');
    is((await page.evaluate(() => document.querySelectorAll('.db-trend svg').length)) === 1,
       'there is one chart, not two');
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('.db-measure .an-grain'))
        .find(x => x.textContent.trim() === 'Order value');
      b.click();
    });
    await page.waitForTimeout(80);
    vals = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.db-trend .db-val')).map(e => e.textContent));
    is(/5,050/.test(vals[6] || ''), 'today now reads its value', vals.join(','));
    is((await page.evaluate(() => document.querySelectorAll('.db-trend svg').length)) === 1,
       'still one chart on one scale');
    is(await page.evaluate(() => {
      const on = Array.from(document.querySelectorAll('.db-measure .an-grain.on'))
        .map(e => e.textContent.trim());
      return on.length === 1 && on[0] === 'Order value';
    }), 'and the chart says which measure it is of');

    group('Every column can be hovered, even on a day with no bar to hit');
    is((await page.evaluate(() => document.querySelectorAll('.db-trend .db-bar-hit').length)) === 7,
       'seven full-height targets');
    is(await page.evaluate(() => {
      const t = document.querySelector('.db-trend .db-bar-hit title');
      return !!t && /order/.test(t.textContent);
    }), 'each naming the day, the orders and the value');

    group('A week with nothing in it says so');
    await render(page, Object.assign({}, SETTINGS_OK, {
      'rpc:site_stats': { when: { same: { data: {} }, span: { data: {} } } },
      orders: { data: [] },
      'customers:count': { count: 0 }, customers: { data: [] },
      'subscribers:count': { count: 0 }, subscribers: { data: [] }
    }));
    is(/no orders in the last seven days/i.test(await textOf(page, '.db-trend') || ''),
       'in words rather than as an empty chart', await textOf(page, '.db-trend'));
    pd = await period(page, 'Today');
    is(pd && /^0 orders/.test(pd.n), 'and the windows read nought', JSON.stringify(pd));

    group('Orders that cannot be read leave the section saying why');
    await render(page, Object.assign({}, SETTINGS_OK, {
      'rpc:site_stats': { when: { same: { data: { visits: 3 } }, span: { data: { visits: 9 } } } },
      orders: { error: 'permission denied for table orders' },
      'customers:count': { count: 5 }, customers: { data: [] },
      'subscribers:count': { count: 2 }, subscribers: { data: [] }
    }));
    is(/role has not been given/i.test(await textOf(page, '.db-trend') || ''),
       'the chart says so', await textOf(page, '.db-trend'));
    is(!!(await page.evaluate(() => document.querySelector('.db-trend .db-state.is-err'))),
       'and says it as a problem, not as an empty week');
    c = await cardBy(page, 'Website visits');
    is(c && c.n === '3', 'while the traffic card is unaffected', JSON.stringify(c));

    /* ================================================================= */
    group('Needs attention lists work, and only work this account can do');

    await render(page, Object.assign({}, SETTINGS_OK, QUIET, {
      'orders:count': { count: 6 },
      'rpc:chat_stats': { data: { unanswered: 2 } },
      'reviews:count': { count: 1 },
      product_meta: { data: [{ sku: 'A', image_url: 'x.jpg' }, { sku: 'B', image_url: '' }] },
      feed: { data: [
        { sku: 'A', name: 'Silk Dress', available: true,  lowStock: false },
        { sku: 'B', name: 'Tote Bag',   available: true,  lowStock: true },
        { sku: 'C', name: 'Loafers',    available: false, lowStock: false }
      ] }
    }));

    let items = await attnText(page);
    is(items.some(t => /^6 orders waiting/.test(t)), 'six orders waiting', items.join(' | '));

    await render(page, Object.assign({}, SETTINGS_OK, QUIET, {
      'orders:count': { count: 6 }, 'orders:count:unpaid': { count: 2 }
    }));
    let unpaid = await attnText(page);
    is(unpaid.some(t => /^4 orders waiting/.test(t)),
       'two of them still on the online payment page are not waiting for the shop', unpaid.join(' | '));
    await render(page, Object.assign({}, SETTINGS_OK, QUIET, {
      'orders:count': { count: 6 },
      'rpc:chat_stats': { data: { unanswered: 2 } },
      'reviews:count': { count: 1 },
      product_meta: { data: [{ sku: 'A', image_url: 'x.jpg' }, { sku: 'B', image_url: '' }] },
      feed: { data: [
        { sku: 'A', name: 'Silk Dress', available: true,  lowStock: false },
        { sku: 'B', name: 'Tote Bag',   available: true,  lowStock: true },
        { sku: 'C', name: 'Loafers',    available: false, lowStock: false }
      ] }
    }));
    items = await attnText(page);
    is(items.some(t => /^2 chats unanswered/.test(t)), 'two chats unanswered', items.join(' | '));
    is(items.some(t => /^1 review waiting/.test(t)), 'one review, in the singular', items.join(' | '));
    is(items.some(t => /pieces? with no photo/.test(t)),
       'and the pieces with no photo on them', items.join(' | '));

    is(await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('.db-attn-item'))
        .find(x => /orders waiting/.test(x.textContent));
      b.click(); return window.__nav[0];
    }) === 'orders', 'pressing one goes to the tab that clears it');

    group('A count this account could not act on is not shown to it');
    await render(page, Object.assign({}, SETTINGS_OK, QUIET, {
      'orders:count': { count: 6 },
      'rpc:chat_stats': { data: { unanswered: 9 } },
      'reviews:count': { count: 4 }
    }), ['dashboard', 'orders']);
    items = await attnText(page);
    is(items.some(t => /orders waiting/.test(t)), 'the orders it can clear are listed', items.join(' | '));
    is(!items.some(t => /chats unanswered/.test(t)),
       'the chats it cannot open are not', items.join(' | '));
    is(!items.some(t => /review/.test(t)), 'nor the reviews', items.join(' | '));
    is(await page.evaluate(() => window.__asked.rpc.filter(r => r.name === 'chat_stats').length) === 0,
       'and it did not even ask about them');

    group('A quiet shop is told it is quiet, not shown an empty box');
    await render(page, Object.assign({}, SETTINGS_OK, QUIET, {
      'orders:count': { count: 0 },
      'rpc:chat_stats': { data: { unanswered: 0 } },
      'reviews:count': { count: 0 },
      product_meta: { data: [{ sku: 'A', image_url: 'x.jpg' }] },
      feed: { data: [{ sku: 'A', name: 'Silk Dress', available: true, lowStock: false }] }
    }));
    is(/nothing is waiting/i.test(await textOf(page, '.db-attn') || ''),
       'it says so in words', await textOf(page, '.db-attn'));
    is((await attnText(page)).length === 0, 'with no rows reading nought');

    group('A count that is refused is quietly not an item, and throws nothing');
    /* Regression. These were written .then(ok, fail), which does not catch a
       throw inside ok — so a refused count raised an unhandled rejection in
       the console every time, while the section still looked fine. */
    const before = errs.length;
    await render(page, Object.assign({}, SETTINGS_OK, QUIET, {
      'orders:count': { error: 'permission denied for table orders' },
      'rpc:chat_stats': { error: 'not permitted' },
      'reviews:count': { error: 'permission denied for table reviews' },
      product_meta: { data: [{ sku: 'A', image_url: 'x.jpg' }] },
      feed: { data: [{ sku: 'A', name: 'Silk Dress', available: true, lowStock: false }] }
    }));
    is(errs.length === before, 'nothing was thrown', errs.slice(before).join(' | '));
    is(/nothing is waiting/i.test(await textOf(page, '.db-attn') || ''),
       'and the section settles rather than sitting on "Looking…"',
       await textOf(page, '.db-attn'));
    is((await stock(page))['Pieces on the shop front'] === '1',
       'while the column beside it is unaffected');

    group('And a single slow answer does not hold the whole list back');
    await render(page, Object.assign({}, SETTINGS_OK, QUIET, {
      'orders:count': { count: 4 },
      'rpc:chat_stats': { data: { unanswered: 1 } },
      'reviews:count': { count: 0 },
      product_meta: { data: [] }, feed: { data: [] }
    }));
    items = await attnText(page);
    is(items.length === 2, 'the two that had something to say are both listed',
       items.join(' | '));

    group('A shop front that is not open says so before anything else');
    await render(page, Object.assign({}, SETTINGS_OK, QUIET, {
      'settings:general': { data: { timezone: TZ, businessName: 'Vaultique', maintenanceMode: true } },
      'orders:count': { count: 3 }, 'rpc:chat_stats': { data: { unanswered: 0 } },
      'reviews:count': { count: 0 }
    }));
    items = await attnText(page);
    is(/under maintenance/i.test(items[0] || ''), 'and says it first', items.join(' | '));
    is(await page.evaluate(() => {
      const c = document.querySelector('.db-attn-item .db-chip');
      return c && c.className.indexOf('is-stop') > -1;
    }), 'marked as the thing that stops everything else mattering');

    await render(page, Object.assign({}, SETTINGS_OK, QUIET, {
      'settings:general': { data: { timezone: TZ, websiteStatus: 'coming-soon' } },
      'orders:count': { count: 0 }, 'rpc:chat_stats': { data: { unanswered: 0 } },
      'reviews:count': { count: 0 }
    }));
    is(/not open yet/i.test((await attnText(page))[0] || ''),
       'a shop still to open is told that instead', (await attnText(page)).join(' | '));

    /* ================================================================= */
    group('On the storefront — the shelves, as a visitor would find them');
    await render(page, Object.assign({}, SETTINGS_OK, QUIET, {
      'orders:count': { count: 0 }, 'rpc:chat_stats': { data: { unanswered: 0 } },
      'reviews:count': { count: 0 },
      product_meta: { data: [{ sku: 'D', hidden: true }] },
      feed: { data: [
        { sku: 'A', name: 'Silk Dress', available: true,  lowStock: false },
        { sku: 'B', name: 'Tote Bag',   available: true,  lowStock: true },
        { sku: 'C', name: 'Loafers',    available: false, lowStock: false },
        { sku: 'D', name: 'Hidden One', available: true,  lowStock: false }
      ] }
    }));

    let st = await stock(page);
    is(st['Pieces on the shop front'] === '3', 'the hidden piece is not on the shop front',
       JSON.stringify(st));
    is(st['In stock'] === '1', 'one is simply in stock', JSON.stringify(st));
    is(st['Running low'] === '1', 'one is running low', JSON.stringify(st));
    is(st['Out of stock'] === '1', 'one is out', JSON.stringify(st));
    is(/1 more piece is hidden/i.test(await textOf(page, '.card .an-note') || '') ||
       await page.evaluate(() => Array.from(document.querySelectorAll('.an-note'))
         .some(n => /1 more piece is hidden/i.test(n.textContent))),
       'and the hidden one is accounted for rather than vanishing');

    group('It never claims to know how many are left');
    is(await page.evaluate(() => {
      const card = Array.from(document.querySelectorAll('.card'))
        .find(c => /On the storefront/.test(c.textContent));
      return /never how many are left/i.test(card.textContent);
    }), 'the card says outright that stock is the platform’s');
    is(await page.evaluate(() =>
      window.__asked.from.every(q => !/stock|inventory/i.test(q.table || ''))),
      'and nothing here asks a stock table for anything');

    group('A feed that will not answer is the one thing worth chasing');
    await render(page, Object.assign({}, SETTINGS_OK, QUIET, {
      'orders:count': { count: 0 }, 'rpc:chat_stats': { data: { unanswered: 0 } },
      'reviews:count': { count: 0 },
      feed: { error: 'feed is down' }
    }));
    is(/could not be read/i.test(await textOf(page, '.card .db-state.is-err') || ''),
       'it says the feed could not be read', await textOf(page, '.card .db-state.is-err'));
    is(/chasing straight away/i.test(await page.evaluate(() =>
        document.querySelector('.db-state.is-err').textContent)),
       'and says why that matters more than the rest of the page');

    group('An empty catalogue is not an error');
    await render(page, Object.assign({}, SETTINGS_OK, QUIET, {
      'orders:count': { count: 0 }, 'rpc:chat_stats': { data: { unanswered: 0 } },
      'reviews:count': { count: 0 }
    }));
    is(await page.evaluate(() => Array.from(document.querySelectorAll('.db-state'))
        .some(e => /catalogue is empty/i.test(e.textContent))),
       'it says the catalogue is empty and where pieces come from');

    /* ================================================================= */
    group('How pieces are doing — four lists of one catalogue, one at a time');

    const BUSY = Object.assign({}, SETTINGS_OK, QUIET, {
      'orders:count': { count: 0 }, 'rpc:chat_stats': { data: { unanswered: 0 } },
      'reviews:count': { count: 0 },
      'rpc:site_top_products': { data: [
        { sku: 'A', label: 'Silk Dress', views: 24, carts: 2,  visitors: 20 },
        { sku: 'B', label: 'Tote Bag',   views: 19, carts: 11, visitors: 15 },
        { sku: 'C', label: 'Loafers',    views: 17, carts: 0,  visitors: 14 }
      ] },
      orders: { data: [
        { id: 'o1', total: 1850, status: 'confirmed', created_at: at(0) },
        { id: 'o2', total: 3200, status: 'cancelled', created_at: at(1) }
      ] },
      order_items: { data: [
        { sku: 'B', name: 'Tote Bag',   qty: 3 },
        { sku: 'A', name: 'Silk Dress', qty: 1 },
        { sku: 'B', name: 'Tote Bag',   qty: 2 }
      ] },
      product_meta: { data: [] },
      feed: { data: [
        { sku: 'A', name: 'Silk Dress', category: 'Dresses', available: true,  lowStock: false },
        { sku: 'C', name: 'Loafers',    category: 'Shoes',   available: false, lowStock: false },
        { sku: 'E', name: 'Clutch',     category: 'Bags',    available: false, lowStock: false }
      ] },
      activity_log: { data: [] },
      reviews: { data: [] }
    });

    const pickList = (p, label) => p.evaluate(l => {
      const b = Array.from(document.querySelectorAll('.db-perf-pick .an-grain'))
        .find(x => x.textContent.trim() === l);
      if (b) b.click();
      return Array.from(document.querySelectorAll('.db-perf .an-row')).map(r => ({
        l: (r.querySelector('.an-row-l') || {}).textContent || '',
        n: (r.querySelector('.an-row-n') || {}).textContent || '',
        bar: !!r.querySelector('.an-fill')
      }));
    }, label);

    await render(page, BUSY);

    let list = await pickList(page, 'Most viewed');
    is(list.length === 3, 'most viewed lists the three pieces', JSON.stringify(list));
    is(/Silk Dress/.test(list[0].l) && /^24/.test(list[0].n),
       'the most viewed first, with its count', JSON.stringify(list[0]));
    is(/2 to cart/.test(list[0].n), 'and how many of those went to a cart', list[0].n);
    is(list[0].bar, 'drawn with the same bar Analytics ranks with');

    list = await pickList(page, 'Added to cart');
    is(/Tote Bag/.test(list[0].l) && /^11/.test(list[0].n),
       'added to cart re-sorts the same answer rather than asking again',
       JSON.stringify(list[0]));
    is(list.length === 2, 'and drops the piece nobody carted', JSON.stringify(list));
    is(await page.evaluate(() =>
       window.__asked.rpc.filter(r => r.name === 'site_top_products').length) === 1,
       'site_top_products was asked exactly once');

    list = await pickList(page, 'Best selling');
    is(/Tote Bag/.test(list[0].l) && /^5/.test(list[0].n),
       'best selling counts quantity, not lines', JSON.stringify(list[0]));
    is(/2 orders/.test(list[0].n), 'and says how many orders it was spread over', list[0].n);

    group('And best selling never counts a cancelled order');
    let sentIds = await page.evaluate(() => {
      const q = window.__asked.from.find(x => x.table === 'order_items');
      return q ? JSON.stringify(q.filters) : null;
    });
    is(sentIds && sentIds.indexOf('o1') > -1, 'the order that stands is asked about', sentIds);
    is(sentIds && sentIds.indexOf('o2') === -1, 'the cancelled one is not', sentIds);

    group('Out of stock is the feed, and carries no count');
    list = await pickList(page, 'Out of stock');
    is(list.length === 2, 'both pieces a visitor cannot buy', JSON.stringify(list));
    is(list.every(r => !r.bar), 'with no bar, because there is no quantity to draw',
       JSON.stringify(list));
    is(list.every(r => !/[0-9]/.test(r.n.replace(/[^0-9]/g, '')) || r.n.trim() === '' ||
                       /Dresses|Shoes|Bags/.test(r.n)),
       'and no number claiming to know how many are left', JSON.stringify(list.map(r => r.n)));
    is(/What a visitor cannot buy right now/.test(await textOf(page, '.card .an-note') || '') ||
       await page.evaluate(() => Array.from(document.querySelectorAll('.an-note'))
         .some(n => /cannot buy right now/i.test(n.textContent))),
       'the note changes to match the list');

    group('A shop where nothing happened says so, per list');
    await render(page, Object.assign({}, BUSY, {
      'rpc:site_top_products': { data: [] },
      orders: { data: [] }, order_items: { data: [] },
      feed: { data: [{ sku: 'A', name: 'Silk Dress', available: true, lowStock: false }] }
    }));
    is(/nothing was opened/i.test(await textOf(page, '.db-perf') || ''),
       'most viewed says nothing was opened', await textOf(page, '.db-perf'));
    await pickList(page, 'Out of stock');
    is(/everything on the shop front is in stock/i.test(await textOf(page, '.db-perf') || ''),
       'and out of stock says everything is in stock', await textOf(page, '.db-perf'));

    group('A role without Analytics loses those two lists and keeps the rest');
    await render(page, Object.assign({}, BUSY, {
      'rpc:site_top_products': { error: 'You do not have permission to read the website analytics.' }
    }));
    is(/role has not been given/i.test(await textOf(page, '.db-perf') || ''),
       'most viewed says why', await textOf(page, '.db-perf'));
    list = await pickList(page, 'Best selling');
    is(list.length > 0, 'while best selling is unaffected', JSON.stringify(list));

    /* ================================================================= */
    group('Customer activity');
    await render(page, Object.assign({}, BUSY, {
      customers: { data: [{ created_at: at(1) }, { created_at: at(3) }] },
      subscribers: { data: [{ created_at: at(2) }] },
      reviews: { data: [
        { id: 'r1', name: 'Chanda', rating: 5, comment: 'Beautiful piece, arrived quickly.',
          approved: true, created_at: at(0) },
        { id: 'r2', name: 'Mutale', rating: 3, comment: 'Nice but the fit runs small.',
          approved: false, created_at: at(1) }
      ] }
    }));
    is(/2 people registered/.test(await textOf(page, '.card .an-note') || '') ||
       await page.evaluate(() => Array.from(document.querySelectorAll('.an-note'))
         .some(n => /2 people registered/.test(n.textContent))),
       'it says how many registered this month');
    is(await page.evaluate(() => Array.from(document.querySelectorAll('.an-note'))
         .some(n => /1 joined the newsletter/.test(n.textContent))),
       'and how many joined the newsletter, in the singular');

    let revs = await page.evaluate(() => Array.from(document.querySelectorAll('.db-rev')).map(r => ({
      who: (r.querySelector('.db-rev-who') || {}).textContent || '',
      stars: (r.querySelector('.db-stars') || {}).textContent || '',
      what: (r.querySelector('.db-rev-what') || {}).textContent || '',
      tag: (r.querySelector('.db-rev-tag') || {}).textContent || ''
    })));
    is(revs.length === 2, 'both reviews are shown', JSON.stringify(revs));
    is(revs[0].who === 'Chanda' && revs[0].stars.split('★').length - 1 === 5,
       'the newest first, with its rating', JSON.stringify(revs[0]));
    is(revs[1].stars.split('★').length - 1 === 3, 'a three-star review shows three',
       revs[1].stars);
    is(revs[1].tag === 'Waiting' && revs[0].tag === '',
       'and only the one still held back is marked as waiting',
       JSON.stringify(revs.map(r => r.tag)));
    is(await page.evaluate(() =>
       !!document.querySelector('.db-stars[aria-label="5 out of 5"]')),
       'the stars are labelled, so the rating is not told by symbol alone');

    group('A role without Reviews is not shown them');
    await render(page, Object.assign({}, BUSY, {
      reviews: { data: [{ id: 'r1', name: 'Chanda', rating: 5, approved: true, created_at: at(0) }] }
    }), ['dashboard', 'orders', 'products']);
    is((await page.evaluate(() => document.querySelectorAll('.db-rev').length)) === 0,
       'no reviews are drawn');
    is(await page.evaluate(() => Array.from(document.querySelectorAll('.db-state'))
         .some(e => /not part of what your role opens/i.test(e.textContent))),
       'and it says so rather than showing an empty card');

    /* ================================================================= */
    group('Recent activity');
    await render(page, Object.assign({}, BUSY, {
      activity_log: { data: [
        { id: 'a1', at: new Date(Date.now() - 4 * 60000).toISOString(),
          actor_email: 'owner@vaultique.com', action: 'changed', module: 'Settings > Chat',
          record: 'Opening line' },
        { id: 'a2', at: new Date(Date.now() - 3 * 3600000).toISOString(),
          actor_email: 'sales@vaultique.com', action: 'added', module: 'Products',
          record: 'VB-DRS-001' }
      ] }
    }), ['dashboard', 'activity', 'orders', 'reviews', 'products', 'chats']);

    let log = await page.evaluate(() => Array.from(document.querySelectorAll('.db-log .al-item'))
      .map(i => i.textContent.replace(/\s+/g, ' ').trim()));
    is(log.length === 2, 'the latest entries are listed', JSON.stringify(log));
    is(/Changed/.test(log[0]) && /Settings > Chat/.test(log[0]),
       'each says what was done and where', log[0]);
    is(/4 minutes ago/.test(log[0]), 'and how long ago, while it is recent', log[0]);
    is(/3 hours ago/.test(log[1]), 'in hours once it is older', log[1]);
    is(/owner@vaultique.com/.test(log[0]), 'and who did it', log[0]);
    is(await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('.db-link'))
        .find(x => /activity log/i.test(x.textContent));
      if (!b) return null;
      b.click(); return window.__nav[window.__nav.length - 1];
    }) === 'activity', 'and there is a way through to the full log');

    group('A role without the log is told, and offered no link to it');
    await render(page, Object.assign({}, BUSY, {
      activity_log: { data: [{ id: 'a1', at: at(0), action: 'added', module: 'Products' }] }
    }), ['dashboard', 'orders']);
    is((await page.evaluate(() => document.querySelectorAll('.db-log .al-item').length)) === 0,
       'nothing from the log is drawn');
    is(await page.evaluate(() => !Array.from(document.querySelectorAll('.db-link'))
         .some(x => /activity log/i.test(x.textContent))),
       'and no link is offered to a tab that is not there');

    group('An admin who has changed nothing yet');
    await render(page, Object.assign({}, BUSY, { activity_log: { data: [] } }),
                 ['dashboard', 'activity', 'orders', 'reviews', 'products', 'chats']);
    is(await page.evaluate(() => Array.from(document.querySelectorAll('.db-state'))
         .some(e => /nothing has been changed yet/i.test(e.textContent))),
       'is told that, rather than shown an empty box');

    /* ================================================================= */
    group('Quick actions offer only what this account can open');
    let labels = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.db-actions .set-item .t')).map(e => e.textContent.trim()));
    is(labels.indexOf('Orders') > -1 && labels.indexOf('Live Chat') > -1,
       'the tabs it has are offered', labels.join(', '));

    await render(page, Object.assign({}, SETTINGS_OK), ['dashboard', 'orders']);
    labels = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.db-actions .set-item .t')).map(e => e.textContent.trim()));
    is(labels.length === 1 && labels[0] === 'Orders',
       'a role with only Orders is offered only Orders', labels.join(', '));
    is(labels.indexOf('Website Analytics') === -1,
       'and is not sent to a tab that is not there');

    await page.evaluate(() => document.querySelector('.db-actions .set-item').click());
    is((await page.evaluate(() => window.__nav))[0] === 'orders',
       'pressing one navigates to its tab');

    await render(page, Object.assign({}, SETTINGS_OK), ['dashboard']);
    is(/nothing else has been ticked/i.test(await textOf(page, '.db-actions') || ''),
       'a role with nothing else says so rather than showing an empty row',
       await textOf(page, '.db-actions'));

    /* ================================================================= */
    group('A refusal costs one card and nothing else');
    await render(page, Object.assign({}, SETTINGS_OK, {
      'rpc:site_stats': { error: 'You do not have permission to read the website analytics.' },
      orders: { data: [{ id: '1', total: 500, status: 'confirmed', created_at: at(0) }] },
      'customers:count': { count: 9 }, customers: { data: [] },
      'subscribers:count': { count: 4 }, subscribers: { data: [] }
    }));
    c = await cardBy(page, 'Website visits');
    is(c && /role has not been given/i.test(c.s), 'the traffic card says why it is empty', JSON.stringify(c));
    is(c && c.n === '—', 'and shows no number rather than a nought', c && c.n);
    c = await cardBy(page, 'Orders');
    is(c && c.n === '1', 'while the orders card is unaffected', JSON.stringify(c));
    c = await cardBy(page, 'Registered customers');
    is(c && c.n === '9', 'and so are the people', JSON.stringify(c));

    group('A role without the Analytics tab is not sent to be refused');
    /* may_see_analytics() keys on the same permission the shell removed the
       tab for, so these calls could only ever come back denied. */
    await render(page, Object.assign({}, SETTINGS_OK, QUIET, {
      'rpc:site_stats': { error: 'You do not have permission to read the website analytics.' },
      'rpc:site_top_products': { error: 'You do not have permission to read the website analytics.' },
      'orders:count': { count: 0 }, 'rpc:chat_stats': { data: { unanswered: 0 } },
      'reviews:count': { count: 0 },
      orders: { data: [{ id: 'o1', total: 500, status: 'confirmed', created_at: at(0) }] },
      order_items: { data: [{ sku: 'A', name: 'Silk Dress', qty: 2 }] }
    }), ['dashboard', 'orders', 'products', 'reviews']);

    is(await page.evaluate(() => window.__asked.rpc.filter(r =>
        r.name === 'site_stats' || r.name === 'site_top_products').length) === 0,
       'neither function is called at all');
    c = await cardBy(page, 'Website visits');
    is(c && /not part of what your role opens/i.test(c.s),
       'and the card says so in words a shop would use', JSON.stringify(c));
    c = await cardBy(page, 'Orders');
    is(c && c.n === '1', 'while everything not behind Analytics still loads', JSON.stringify(c));
    is(await page.evaluate(() => {
      const on = Array.from(document.querySelectorAll('.db-perf-pick .an-grain.on'));
      return on.length === 1 && on[0].textContent.trim() === 'Best selling';
    }), 'and the pieces list opens on one this role can actually read');

    group('A shop that has not run the analytics SQL is told that instead');
    await render(page, Object.assign({}, SETTINGS_OK, {
      'rpc:site_stats': { error: 'Could not find the function public.site_stats' },
      orders: { data: [] }, 'customers:count': { count: 0 }, customers: { data: [] },
      'subscribers:count': { count: 0 }, subscribers: { data: [] }
    }));
    c = await cardBy(page, 'Website visits');
    is(c && /not set up/i.test(c.s), 'it says it is not set up, not that permission was refused',
       JSON.stringify(c));

    group('A brand new shop shows noughts, not blanks or errors');
    await render(page, Object.assign({}, SETTINGS_OK, {
      'rpc:site_stats': { data: { visits: 0, product_views: 0, add_to_cart: 0, checkout_starts: 0 } },
      orders: { data: [] },
      'customers:count': { count: 0 }, customers: { data: [] },
      'subscribers:count': { count: 0 }, subscribers: { data: [] }
    }));
    c = await cardBy(page, 'Website visits');
    is(c && c.n === '0', 'visits is nought', JSON.stringify(c));
    c = await cardBy(page, 'Orders');
    is(c && c.n === '0', 'orders is nought', JSON.stringify(c));
    c = await cardBy(page, 'Registered customers');
    is(c && /none yet this month/i.test(c.s), 'and the month line says so in words', c && c.s);

    /* ================================================================= */
    group('While it is still loading it shows the shape, not a blank');
    await page.evaluate(([p, t]) => {
      window.PLAN = p; window.__tabs(t); window.__render();
    }, [Object.assign({}, SETTINGS_OK, {
      'rpc:site_stats': { data: { visits: 7 }, delay: 3000 },
      orders: { data: [], delay: 3000 },
      'customers:count': { count: 0, delay: 3000 }, customers: { data: [], delay: 3000 },
      'subscribers:count': { count: 0, delay: 3000 }, subscribers: { data: [], delay: 3000 }
    }), ['dashboard', 'orders']]);
    await page.waitForTimeout(250);
    c = await cardBy(page, 'Website visits');
    is(c && c.n === '—', 'the cards are placeheld rather than empty', JSON.stringify(c));
    is((await page.evaluate(() => document.querySelectorAll('.an-kpi').length)) === 8,
       'all eight are already on the page');
    is(!!(await textOf(page, '.db-hello h2')), 'and the greeting is already up');

    group('And a page that is left does not paint over the one that replaced it');
    await page.evaluate(() => { document.getElementById('host').innerHTML = ''; });
    await page.waitForTimeout(3200);
    is((await page.evaluate(() => document.querySelectorAll('.an-kpi').length)) === 0,
       'the late answers found nobody home and did nothing');

    /* ================================================================= */
    group('It holds together on a phone as well as on a desk');
    /* Every section carrying real content at once, with long names and big
       numbers — the state a phone is most likely to be pushed out of shape
       by, and the one an empty fixture would never catch. */
    await render(page, Object.assign({}, BUSY, {
      'rpc:site_stats': { when: {
        same: { data: { visits: 1234, product_views: 5678, add_to_cart: 91, checkout_starts: 23 } },
        span: { data: { visits: 9999, product_views: 8888, add_to_cart: 777, checkout_starts: 66 } } } },
      orders: { data: [
        { id: 'o1', total: 1850000, status: 'confirmed', created_at: at(0) },
        { id: 'o2', total: 320000,  status: 'completed', created_at: at(4) }
      ] },
      'orders:count': { count: 17 },
      'rpc:chat_stats': { data: { unanswered: 3 } },
      'reviews:count': { count: 8 },
      'customers:count': { count: 12345 }, customers: { data: [{ created_at: at(1) }] },
      'subscribers:count': { count: 9876 }, subscribers: { data: [{ created_at: at(2) }] },
      'rpc:site_top_products': { data: [
        { sku: 'VB-DRS-0001-LONG', label: 'Hand-embroidered Silk Evening Gown, Midnight',
          views: 2400, carts: 210 },
        { sku: 'VB-BAG-0002', label: 'Full-grain Leather Weekender', views: 1900, carts: 180 }
      ] },
      order_items: { data: [{ sku: 'VB-BAG-0002', name: 'Full-grain Leather Weekender', qty: 12 }] },
      product_meta: { data: [] },
      feed: { data: [
        { sku: 'VB-DRS-0001-LONG', name: 'Hand-embroidered Silk Evening Gown, Midnight',
          category: 'Dresses', available: false, lowStock: false },
        { sku: 'VB-BAG-0002', name: 'Full-grain Leather Weekender',
          category: 'Bags', available: true, lowStock: true }
      ] },
      reviews: { data: [
        { id: 'r1', name: 'Chanda Mwansa-Chileshe', rating: 5, approved: false,
          comment: 'Absolutely beautiful piece and it arrived far quicker than I expected, ' +
                   'the stitching is lovely and it fits exactly as described on the page.',
          created_at: at(0) }
      ] },
      activity_log: { data: [
        { id: 'a1', at: new Date(Date.now() - 120000).toISOString(),
          actor_email: 'a-rather-long-address@vaultiqueboutique.com',
          action: 'changed', module: 'Settings > Branding & Appearance',
          record: 'Primary colour, Secondary colour, Button style' }
      ] }
    }), ['dashboard', 'analytics', 'products', 'orders', 'chats', 'reviews', 'subscribers', 'activity']);

    for (const w of [390, 768, 1280]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(120);
      const over = await page.evaluate(() => {
        const doc = document.documentElement;
        const spill = [];
        document.querySelectorAll('.db-wrap *').forEach(e => {
          const r = e.getBoundingClientRect();
          if (r.width > 0 && (r.right > doc.clientWidth + 1 || r.left < -1)) {
            spill.push((e.className || e.tagName) + ' @' + Math.round(r.left) + '..' + Math.round(r.right));
          }
        });
        return { scrollW: doc.scrollWidth, clientW: doc.clientWidth, spill: spill.slice(0, 4) };
      });
      is(over.scrollW <= over.clientW + 1, 'at ' + w + 'px the page does not scroll sideways',
         over.scrollW + ' > ' + over.clientW);
      is(over.spill.length === 0, 'at ' + w + 'px nothing hangs off the edge', over.spill.join(' | '));
    }

    group('And the sections stack rather than squeeze when narrow');
    await page.setViewportSize({ width: 390, height: 900 });
    await page.waitForTimeout(120);
    is(await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.an-kpi'));
      if (cards.length < 2) return false;
      // one per row on a phone means each starts at the same left edge
      const lefts = new Set(cards.map(c => Math.round(c.getBoundingClientRect().left)));
      return lefts.size <= 2;
    }), 'the eight cards fall into one or two columns, not eight');
    is(await page.evaluate(() => {
      const svg = document.querySelector('.db-trend svg');
      if (!svg) return false;
      const r = svg.getBoundingClientRect();
      return r.width > 0 && r.width <= document.documentElement.clientWidth;
    }), 'the chart shrinks to fit rather than overflowing');
    is(await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.an-two > .card'));
      if (cards.length < 2) return false;
      const lefts = new Set(cards.map(c => Math.round(c.getBoundingClientRect().left)));
      return lefts.size === 1;
    }), 'the paired cards stack into one column');
    is(await page.evaluate(() => {
      const r = document.querySelector('.db-perf .an-row-l');
      return !!r && r.getBoundingClientRect().right <= document.documentElement.clientWidth;
    }), 'a very long piece name wraps instead of pushing the row out');
    is(await page.evaluate(() => {
      const rv = document.querySelector('.db-rev-what');
      if (!rv) return false;
      return rv.getBoundingClientRect().right <= document.documentElement.clientWidth;
    }), 'and a long review is clamped rather than run on');
    is(await page.evaluate(() => {
      const it = document.querySelector('.db-log .al-item');
      return !!it && it.getBoundingClientRect().right <= document.documentElement.clientWidth;
    }), 'so is a long activity entry');
    await page.setViewportSize({ width: 1280, height: 900 });

    /* =================================================================
       Not the Dashboard's own, but the stylesheet it is drawn with, and
       this harness is the one place that loads admin.css against real
       controls. On a phone a tap held a fraction too long used to select
       the tab's text and raise the Copy sheet over the admin instead of
       opening anything. */
    group('Tapping a control presses it rather than selecting its text');
    is(await page.evaluate(() => {
      const t = document.querySelector('.tab');
      const c = getComputedStyle(t);
      return (c.webkitUserSelect || c.userSelect) === 'none';
    }), 'a tab’s label is not text to be selected');
    /* The Copy sheet is Safari's, and so is -webkit-touch-callout. Chromium
       does not implement the property and drops it when parsing, so it can
       be seen neither in a computed style nor in the CSSOM here. What ships
       is what reaches an iPhone, so that is what is asserted. */
    const tr = touchRule();
    is(!!tr, 'the stylesheet carries a rule for this at all');
    is(!!tr && /(^|,)\s*\.tab\s*(,|$)/m.test(tr.selectors),
       'and the tabs are named in it', tr && tr.selectors.replace(/\s+/g, ' ').trim().slice(0, 80));
    is(!!tr && /-webkit-touch-callout:\s*none/.test(tr.body),
       'telling an iPhone not to offer the Copy sheet for them');
    is(!!tr && ['.btn', '.set-item', '.choice', '.an-preset', '.an-grain', '.hrs-day', '.sw-row']
         .every(sel => tr.selectors.indexOf(sel) > -1),
       'and it covers every control the admin makes tappable, not only the tabs',
       tr && tr.selectors.replace(/\s+/g, ' ').trim());
    is(!!tr && tr.selectors.indexOf('.an-plot') === -1,
       'while leaving the chart its own touch behaviour, so a finger can still scroll from on top of it');
    is(await page.evaluate(() =>
      getComputedStyle(document.querySelector('.tab')).touchAction === 'manipulation'),
      'a tab acts on the first tap instead of waiting to see if it is a zoom');

    is(await page.evaluate(() => {
      const b = document.querySelector('.db-actions .set-item');
      if (!b) return false;
      const c = getComputedStyle(b);
      return (c.webkitUserSelect || c.userSelect) === 'none' &&
             c.touchAction === 'manipulation';
    }), 'the quick-action buttons are guarded the same way');

    is(await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('.an-grain'))[0];
      if (!b) return false;
      const c = getComputedStyle(b);
      return (c.webkitUserSelect || c.userSelect) === 'none';
    }), 'so is the measure toggle on the chart');

    group('While anything somebody might genuinely want to copy stays copyable');
    is(await page.evaluate(() => {
      const host = document.getElementById('host');
      const p = document.createElement('p');
      p.className = 'db-state';
      p.textContent = 'VB-3F9K';
      host.appendChild(p);
      const c = getComputedStyle(p);
      const ok = (c.webkitUserSelect || c.userSelect) !== 'none';
      p.remove();
      return ok;
    }), 'an order reference on the page is still selectable');
    is(await page.evaluate(() => {
      const host = document.getElementById('host');
      const i = document.createElement('input');
      i.type = 'text'; i.value = 'test';
      host.appendChild(i);
      const c = getComputedStyle(i);
      const ok = (c.webkitUserSelect || c.userSelect) !== 'none';
      i.remove();
      return ok;
    }), 'and so is every input');

    group('Nothing threw along the way');
    is(errs.length === 0, 'no script error anywhere', errs.join(' | '));

    await page.close();
  } finally {
    await browser.close();
    server.close();
  }

  console.log('\ndashboard: ' + (failures === 0
    ? 'all ' + checks + ' checks passed'
    : (checks - failures) + ' passed, ' + failures + ' failed'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('\nthe checks themselves fell over:\n', e); process.exit(1); });
