/* ===========================================================================
   CHECKOUT: THE WEBSITE OR WHATSAPP (website build 85) -- in a real browser

   The owner: "make the "buy" button in gold Vaultique color, then when all
   the process of clicking buy is complete, website checkout and WhatsApp
   checkout buttons should appear, one in gold, on in green." And: "The
   green one should only be for WhatsApp."

   The real index.html and assets/app.js, with the real payment functions
   behind them (the same stand-ins as payments.browser.cjs):

     1. Buy is gold on the card, the quick view and the product page, with
        no WhatsApp mark; the cart's Checkout is gold too;
     2. after the details: Website checkout (gold) first, WhatsApp checkout
        (green) beside it, each going the way it always went;
     3. Website checkout is offered only when the server says Flutterwave's
        key for the mode is there: switched on with no key, it is not
        there, and WhatsApp checkout stands alone, as before;
     4. in Test mode only the shop sees it (the preview key);
     5. a saved "Buy on WhatsApp" reads "Buy"; the shop's own words stay;
     6. the only green button anywhere is one that opens WhatsApp.
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

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/json' };
const POS = [
  { sku: 'BG-1', name: 'Leather Satchel', category: 'Bags', price: 500, stock: 3, active: true, unitWeight: 2 },
  { sku: 'SC-1', name: 'Silk Scarf', category: 'Accessories', price: 300, stock: 10, active: true, unitWeight: 1.5 },
];
const SETTINGS = {
  general: { businessName: 'Vaultique', currency: 'ZMW' },
  payments: { onlineEnabled: false, onlineMode: 'test', onlineCard: true, onlineMobile: true },
  delivery: { payDelivery: true, standardFee: 80 },
  shopping: { requireName: true, requirePhone: true, requireEmail: false, requireAddress: false },
  contact: { orderNumber: '260970000000', whatsapp: '260970000000' },
};
const DB = { orders: [], order_items: [], payments: [] };
const FLW = { verify: {} };
let seq = 0;

const read = req => new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => r(d)); });
function filters(q) {
  const out = [];
  for (const [k, v] of new URLSearchParams(q)) {
    if (['select', 'order', 'limit'].includes(k)) continue;
    const m = /^(eq|neq|in|gt)\.(.*)$/.exec(v); if (m) out.push([k, m[1], m[2]]);
  }
  return out;
}
function matches(row, fs2) {
  return fs2.every(([k, op, v]) => {
    const x = row[k] == null ? '' : String(row[k]);
    if (op === 'eq') return x === v; if (op === 'neq') return x !== v; if (op === 'gt') return x > v;
    return v.replace(/^\(|\)$/g, '').split(',').map(s => s.replace(/^"|"$/g, '')).includes(x);
  });
}
let base = '';
const ASKED = { ready: 0 };
let FN = {};
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  const body = await read(req);
  const send = (code, o, type) => { res.writeHead(code, { 'Content-Type': type || 'application/json' }); res.end(o === undefined ? '' : (typeof o === 'string' ? o : JSON.stringify(o))); };
  const service = (req.headers.authorization || '') === 'Bearer service-key';

  if (p === '/.netlify/functions/pay-status' && u.searchParams.get('check')) ASKED.ready++;
  if (p.startsWith('/.netlify/functions/pay-') || p === '/.netlify/functions/place-order') {
    const name = p.split('/').pop();
    const r = await FN[name]({ httpMethod: req.method, body, headers: req.headers,
                               queryStringParameters: Object.fromEntries(u.searchParams) });
    res.writeHead(r.statusCode, r.headers || {}); return res.end(r.body || '');
  }
  if (p === '/api/products') {
    const r = await FN.products({ queryStringParameters: {}, headers: {} });
    res.writeHead(r.statusCode, r.headers); return res.end(r.body);
  }
  if (p === '/pos/rest/v1/app_state') return send(200, [{ id: 100, state: { products: POS } }]);
  if (p === '/fake-flutterwave') return send(200, '<h1>Flutterwave</h1><p id="tx">' + u.searchParams.get('tx_ref') + '</p>', 'text/html');
  if (p.startsWith('/flw/')) {
    if (p === '/flw/payments') {
      const b = JSON.parse(body);
      /* Flutterwave's page is always https://, and since build 78 nothing
         else is followed: the browser below serves this address itself. */
      return send(200, { status: 'success', data: { link: 'https://checkout.flutterwave.test/fake-flutterwave?tx_ref=' + b.tx_ref } });
    }
    const m = /^\/flw\/transactions\/(\d+)\/verify$/.exec(p);
    const t = m ? Object.values(FLW.verify).find(v => String(v.id) === m[1]) : FLW.verify[u.searchParams.get('tx_ref')];
    return t ? send(200, { status: 'success', data: t }) : send(404, { status: 'error' });
  }
  if (p === '/web/rest/v1/site_settings') {
    const key = (u.searchParams.get('key') || '').replace('eq.', '');
    return send(200, SETTINGS[key] ? [{ data: SETTINGS[key] }] : []);
  }
  if (p === '/web/rest/v1/rpc/place_order') {
    // After supabase-hardening.sql (build 76) only the service key may call it.
    if (!service) return send(401, { message: 'permission denied for function place_order' });
    const b = JSON.parse(body); const id = 'ord-' + (++seq); const ref = 'VB-ABCD' + seq;
    DB.orders.push(Object.assign({ id, ref, status: 'pending' }, b.p_order));
    b.p_items.forEach(i => DB.order_items.push(Object.assign({ order_id: id }, i)));
    return send(200, { id, ref });
  }
  if (p === '/web/rest/v1/rpc/pay_expire_stale') return send(204);
  // Build 77: Test mode is the shop's own. The owner tests with the
  // preview key, and the database says whether a key is right.
  if (p === '/web/rest/v1/rpc/preview_ok') return send(200, JSON.parse(body || '{}').p_key === 'shop-preview');
  const t = /^\/web\/rest\/v1\/(orders|order_items|payments)$/.exec(p);
  if (t && service) {
    const table = DB[t[1]], fs2 = filters(u.search.slice(1));
    const minimal = /return=minimal/.test(req.headers.prefer || '');
    if (req.method === 'GET') return send(200, table.filter(r => matches(r, fs2)));
    if (req.method === 'POST') { const row = Object.assign({ id: 'pay-' + (++seq), status: 'started' }, JSON.parse(body)); table.push(row); return send(201, [row]); }
    if (req.method === 'PATCH') { const patch = JSON.parse(body), hit = table.filter(r => matches(r, fs2)); hit.forEach(r => Object.assign(r, patch)); return minimal ? send(204) : send(200, hit); }
  }
  if (p.startsWith('/web/rest/v1/')) return send(200, []);
  if (p === '/config.js') return send(200, 'window.VBP_CONFIG={SUPABASE_URL:"' + base + '/web",SUPABASE_ANON_KEY:"anon-key"};', TYPES['.js']);
  let file = path.join(ROOT, p);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  Object.assign(process.env, {
    WEB_SUPABASE_URL: base + '/web', WEB_SUPABASE_ANON_KEY: 'anon-key',
    POS_SUPABASE_URL: base + '/pos', POS_SUPABASE_KEY: 'pos-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key', FLW_SECRET_KEY_TEST: 'FLWSECK_TEST-x',
    FLW_WEBHOOK_HASH: 'h', FLW_API_BASE: base + '/flw', URL: base,
  });
  const F = path.join(ROOT, 'netlify', 'functions');
  require(path.join(F, 'send-email'))._internals.sendMail = async () => {};
  FN = {
    'pay-quote': require(path.join(F, 'pay-quote')).handler,
    'pay-start': require(path.join(F, 'pay-start')).handler,
    'pay-status': require(path.join(F, 'pay-status')).handler,
    'place-order': require(path.join(F, 'place-order')).handler,
    products: require(path.join(F, 'products')).handler,
  };
  const browser = await chromium.launch();
  /* Online payment runs in Test mode here, and since build 77 only the
     shop may use it: the page is opened as the owner testing, with the
     preview key, unless a check says it is a stranger. */
  async function open(opts) {
    const stranger = !!(opts && opts.stranger);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.route('https://checkout.flutterwave.test/**', r => {
      const tx = new URL(r.request().url()).searchParams.get('tx_ref') || '';
      return r.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Flutterwave</h1><p id="tx">' + tx.replace(/[<>&"]/g, '') + '</p>' });
    });
    await ctx.addInitScript(() => {
      if (!sessionStorage.getItem('seeded')) {
        localStorage.setItem('vbp_cart', JSON.stringify([{ sku: 'BG-1', qty: 2 }, { sku: 'SC-1', qty: 1 }]));
        sessionStorage.setItem('seeded', '1');
      }
      window.__opened = [];
      /* BUILD 76 · the order form opens WhatsApp's tab at the tap and fills
         it in once the order's number is back (the number heads the message;
         tests/pos-orders.browser.cjs). So a tab is handed back here, and where
         it was sent is what is kept: __opened[i] is the address the i-th tab
         ended up on, as the address window.open was given used to be. */
      window.__opened = [];
      window.open = function (u) {
        var i = window.__opened.length;
        window.__opened.push(u || '');
        var tab = { closed: false, close: function () { tab.closed = true; } };
        tab.location = {};
        Object.defineProperty(tab.location, 'href', {
          get: function () { return window.__opened[i]; },
          set: function (v) { window.__opened[i] = String(v); }
        });
        return tab;
      };
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message || e)));
    await page.goto(base + (stranger ? '/' : '/?preview=shop-preview'), { waitUntil: 'domcontentloaded' });
    /* Until the shop has its prices and settings the cart says "one
       moment" instead of offering checkout, and checkout() waits for that
       as well; this only lets the shop show its pieces first, as it has
       for a customer who opens the cart. */
    await page.waitForSelector('.card', { state: 'attached', timeout: 15000 }).catch(() => {});
    return { ctx, page, errors };
  }
  async function checkout(page) {
    await page.click('#cartBtn');
    await page.waitForSelector('#ctGo', { timeout: 15000 });
    await page.click('#ctGo');
    await page.waitForSelector('#odGo', { timeout: 15000 });
    /* Every order now needs the consent box ticked, as a customer would.
       The box itself is checked under "Consent before any order". */
    if (!page.__leaveConsent && await page.$('#od_consent')) await page.check('#od_consent');
  }
  /* Each check waits for what it is about to look at, never for a set
     time (build 79): on a slow or busy computer it waits longer rather
     than looking too soon. A wait that runs out is not a failure by
     itself; the check after it says what was there instead. */
  async function press(page, sel, re) {
    // The form's message is emptied first, so one left by an earlier
    // press is not taken for the answer to this one.
    await page.evaluate(() => { const m = document.getElementById('odMsg'); if (m) m.textContent = ''; });
    await page.click(sel);
    await page.waitForFunction(s => new RegExp(s, 'i').test((document.getElementById('odMsg') || {}).textContent || '') ||
      !!document.getElementById('pqLead') || (window.__opened || []).length > 0, re.source, { timeout: 10000 }).catch(() => {});
  }
  // A tab counts once it has been sent somewhere: since website 80 the order
  // form opens it at the tap and fills it in when the order's number is back.
  const opened = (page, n) => page.waitForFunction(k => (window.__opened || []).filter(Boolean).length >= k, n, { timeout: 10000 }).catch(() => {});
  async function until(test) {
    for (const end = Date.now() + 10000; !test() && Date.now() < end;) await new Promise(r => setTimeout(r, 50));
  }


  const GOLD = 'rgb(200, 162, 74)', GREEN = 'rgb(37, 211, 102)';
  const look = (page, sel) => page.evaluate((s) => {
    const b = document.querySelector(s);
    if (!b) return null;
    return { text: b.textContent.trim(), bg: getComputedStyle(b).backgroundColor, icon: !!b.querySelector('svg'),
             cls: b.className };
  }, sel);
  async function reach(page) {
    await checkout(page);
    return page.evaluate(() => {
      const acts = document.querySelector('#orderBody .rv-actions');
      const btns = Array.from(acts.querySelectorAll('button')).map(b => ({ id: b.id, text: b.textContent.trim(),
        bg: getComputedStyle(b).backgroundColor, icon: !!b.querySelector('svg') }));
      return { btns, lead: (document.querySelector('#orderBody .od-lead') || {}).textContent || '' };
    });
  }
  /* Every element painted WhatsApp's green, and where it goes. */
  const greens = (page) => page.evaluate((green) => Array.from(document.querySelectorAll('a, button')).filter((e) => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(e).backgroundColor === green;
  }).map((e) => ({ id: e.id, text: e.textContent.trim().slice(0, 40), href: e.getAttribute('href') || '' })), GREEN);
  const opensWhatsApp = (g) => g.id === 'odGo' || /wa\.me|whatsapp\.com|^whatsapp:/i.test(g.href);

  try {
    console.log('\nBuy, in gold, everywhere (online payment off)');
    {
      ASKED.ready = 0;
      const { ctx, page } = await open({ stranger: true });
      const card = await page.evaluate(() => {
        const c = Array.from(document.querySelectorAll('.card')).find((x) => /Leather Satchel/.test(x.textContent));
        const b = c && c.querySelector('.wa-line .btn-wa');
        return b && { text: b.textContent.trim(), bg: getComputedStyle(b).backgroundColor, icon: !!b.querySelector('svg'),
                      buy: b.classList.contains('btn-buy') };
      });
      is(card && card.text === 'Buy' && card.bg === GOLD && !card.icon && card.buy, 'the card: "Buy", gold, no WhatsApp mark', JSON.stringify(card));
      let g = await greens(page);
      is(g.every(opensWhatsApp), 'the shop page: nothing green but what opens WhatsApp', JSON.stringify(g));
      await page.goto(base + '/product/BG-1', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#buyDetail', { timeout: 15000 }).catch(() => {});
      const det = await look(page, '#buyDetail');
      is(det && det.text === 'Buy' && det.bg === GOLD && !det.icon, 'the product page: "Buy", gold, no WhatsApp mark', JSON.stringify(det));
      g = await greens(page);
      is(g.every(opensWhatsApp), 'the product page: nothing green but what opens WhatsApp', JSON.stringify(g));
      await page.goto(base + '/shop', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.card button.quick', { timeout: 15000 }).catch(() => {});
      await page.evaluate(() => { const c = Array.from(document.querySelectorAll('.card')).find((x) => /Leather Satchel/.test(x.textContent));
        const q = c && c.querySelector('button.quick'); if (q) q.click(); });
      await page.waitForSelector('#qvBuy', { timeout: 15000 }).catch(() => {});
      const qv = await look(page, '#qvBuy');
      is(qv && qv.text === 'Buy' && qv.bg === GOLD && !qv.icon, 'the quick view: "Buy", gold, no WhatsApp mark', JSON.stringify(qv));
      await page.keyboard.press('Escape').catch(() => {});
      await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.card', { state: 'attached', timeout: 15000 }).catch(() => {});
      await page.click('#cartBtn');
      await page.waitForSelector('#ctGo', { timeout: 15000 });
      const cart = await look(page, '#ctGo');
      is(cart && cart.text === 'Checkout' && cart.bg === GOLD && !cart.icon, 'the cart: "Checkout", gold', JSON.stringify(cart));
      is(/Nothing is paid on this site/.test(await page.textContent('#cartModal')), 'and its note as before: nothing is paid on the site');
      await page.click('#ctGo');
      await page.waitForSelector('#odGo', { timeout: 15000 });
      const v = await page.evaluate(() => Array.from(document.querySelectorAll('#orderBody .rv-actions button')).map((b) => ({
        id: b.id, text: b.textContent.trim(), bg: getComputedStyle(b).backgroundColor, icon: !!b.querySelector('svg') })));
      is(v.length === 1 && v[0].id === 'odGo' && v[0].text === 'WhatsApp checkout' && v[0].bg === GREEN && v[0].icon,
         'after the details: WhatsApp checkout alone, green, with its mark', JSON.stringify(v));
      is(/We will carry on from here on WhatsApp/.test(await page.textContent('#orderBody')), 'and the line above says WhatsApp, as before');
      g = await greens(page);
      is(g.every(opensWhatsApp) && g.some((x) => x.id === 'odGo'), 'the details: the one green button is WhatsApp checkout', JSON.stringify(g));
      is(ASKED.ready === 0, 'online payment off: the server is not even asked about Flutterwave', String(ASKED.ready));
      await page.fill('#od_name', 'Chanda');
      await page.fill('#od_phone', '0977123456');
      if (await page.$('#od_consent')) await page.check('#od_consent');
      await page.click('#odGo');
      await opened(page, 1);
      const sent = await page.evaluate(() => window.__opened);
      is(sent.length === 1 && /wa\.me|whatsapp/i.test(sent[0]) && /Leather%20Satchel/.test(sent[0]),
         'WhatsApp checkout opens WhatsApp with the order, as it always has', JSON.stringify(sent).slice(0, 200));
      await ctx.close();
    }

    console.log('\nSwitched on in Live mode, but no Live key in Netlify (Flutterwave not set up)');
    SETTINGS.payments.onlineEnabled = true;
    SETTINGS.payments.onlineMode = 'live';
    delete process.env.FLW_SECRET_KEY_LIVE;
    {
      ASKED.ready = 0;
      const { ctx, page } = await open({ stranger: true });
      const v = await reach(page);
      is(v.btns.length === 1 && v.btns[0].id === 'odGo', 'no Website checkout: it would be a dead end', JSON.stringify(v.btns));
      is(/We will carry on from here on WhatsApp/.test(v.lead), 'WhatsApp checkout alone, as before');
      is(ASKED.ready === 1, 'the server was asked once whether Flutterwave is there', String(ASKED.ready));
      await ctx.close();
    }

    console.log('\nLive, with the Live key: both');
    process.env.FLW_SECRET_KEY_LIVE = 'FLWSECK-live-x';
    {
      ASKED.ready = 0;
      const { ctx, page } = await open({ stranger: true });
      await page.click('#cartBtn');
      await page.waitForSelector('#ctGo', { timeout: 15000 });
      await page.waitForFunction(() => !/Nothing is paid on this site/.test((document.getElementById('cartModal') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
      is(/check it out on the website, or on WhatsApp/.test(await page.textContent('#cartModal')), 'the cart says it can be checked out on the website or on WhatsApp');
      await page.keyboard.press('Escape').catch(() => {});
      await page.evaluate(() => { const x = document.querySelector('#cartModal .qv-close, #cartModal [aria-label="Close"]'); if (x) x.click(); });
      const v = await reach(page);
      const [a, b] = v.btns;
      is(v.btns.length === 2 && a.id === 'odPay' && b.id === 'odGo', 'two buttons: Website checkout first, WhatsApp checkout beside it', JSON.stringify(v.btns));
      is(a && a.text === 'Website checkout' && a.bg === GOLD && !a.icon, 'Website checkout: gold', JSON.stringify(a));
      is(b && b.text === 'WhatsApp checkout' && b.bg === GREEN && b.icon, 'WhatsApp checkout: green, with its mark', JSON.stringify(b));
      is(!/carry on from here on WhatsApp/.test(v.lead), 'the line above no longer says it all goes on WhatsApp', v.lead);
      const g = await greens(page);
      is(g.every(opensWhatsApp) && g.some((x) => x.id === 'odGo') && !g.some((x) => x.id === 'odPay'),
         'everything green opens WhatsApp (WhatsApp checkout, and the "Chat with us" link); Website checkout is not green', JSON.stringify(g));
      await page.fill('#od_name', 'Chanda');
      await page.fill('#od_phone', '0977123456');
      await page.fill('#od_email', 'c@example.com');
      if (await page.$('#od_address')) await page.fill('#od_address', 'Plot 9, Kabulonga');
      await page.click('#odPay');
      await page.waitForSelector('#pqLead', { timeout: 15000 }).catch(() => {});
      is(!!(await page.$('#pqLead')), 'Website checkout goes the way online payment always went: the total, then Flutterwave');
      await ctx.close();
    }

    console.log('\nTest mode: only the shop sees it');
    SETTINGS.payments.onlineMode = 'test';
    {
      ASKED.ready = 0;
      const { ctx, page } = await open({ stranger: true });
      const v = await reach(page);
      is(v.btns.length === 1 && v.btns[0].id === 'odGo' && ASKED.ready === 0, 'a customer: WhatsApp checkout alone, and nothing asked', JSON.stringify(v.btns));
      await ctx.close();
    }
    {
      ASKED.ready = 0;
      const { ctx, page } = await open();
      const v = await reach(page);
      is(v.btns.length === 2 && v.btns[0].id === 'odPay', 'the shop, with its preview key and the Test key: both', JSON.stringify(v.btns));
      await ctx.close();
    }
    SETTINGS.payments.onlineEnabled = false;

    console.log('\nThe shop\'s own words');
    SETTINGS.shopping.checkoutLabel = 'Buy on WhatsApp';
    {
      const { ctx, page } = await open({ stranger: true });
      const t = await page.evaluate(() => { const b = document.querySelector('.card .wa-line .btn-wa'); return b && b.textContent.trim(); });
      is(t === 'Buy', 'a saved "Buy on WhatsApp" reads "Buy": the button no longer goes straight to WhatsApp', t);
      await ctx.close();
    }
    SETTINGS.shopping.checkoutLabel = 'Shop this piece';
    {
      const { ctx, page } = await open({ stranger: true });
      const t = await page.evaluate(() => { const b = document.querySelector('.card .wa-line .btn-wa'); return b && b.textContent.trim(); });
      is(t === 'Shop this piece', 'wording the shop typed itself stays as it is', t);
      await ctx.close();
    }
    delete SETTINGS.shopping.checkoutLabel;
  } catch (e) {
    fail('the test itself broke', e && e.stack || e);
  }
  await browser.close();
  server.close();
  console.log('\n  checkout, the website or WhatsApp: ' + (failures ? failures + ' of ' + checks + ' checks FAILED' : 'all ' + checks + ' checks passed'));
  process.exit(failures ? 1 : 0);
})();
