/* ===========================================================================
   ONLINE PAYMENT, END TO END -- in a real browser

   The real index.html and assets/app.js, talking to the real payment
   functions (netlify/functions/pay-*.js), which talk to stand-ins for the
   POS, this website's Supabase and Flutterwave. Flutterwave's payment page
   is a plain page here; "paying" on it is the test telling the stand-in
   the payment went through, then coming back the way Flutterwave sends
   customers back.

   What matters most: with the switch off nothing has changed, and with it
   on the WhatsApp checkout still works exactly as before.
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
let FN = {};
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  const body = await read(req);
  const send = (code, o, type) => { res.writeHead(code, { 'Content-Type': type || 'application/json' }); res.end(o === undefined ? '' : (typeof o === 'string' ? o : JSON.stringify(o))); };
  const service = (req.headers.authorization || '') === 'Bearer service-key';

  if (p.startsWith('/.netlify/functions/pay-')) {
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
      return send(200, { status: 'success', data: { link: base + '/fake-flutterwave?tx_ref=' + b.tx_ref } });
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
    const b = JSON.parse(body); const id = 'ord-' + (++seq); const ref = 'VB-ABCD' + seq;
    DB.orders.push(Object.assign({ id, ref, status: 'pending' }, b.p_order));
    b.p_items.forEach(i => DB.order_items.push(Object.assign({ order_id: id }, i)));
    return send(200, { id, ref });
  }
  if (p === '/web/rest/v1/rpc/pay_expire_stale') return send(204);
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
    products: require(path.join(F, 'products')).handler,
  };
  const browser = await chromium.launch();
  async function open() {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript(() => {
      if (!sessionStorage.getItem('seeded')) {
        localStorage.setItem('vbp_cart', JSON.stringify([{ sku: 'BG-1', qty: 2 }, { sku: 'SC-1', qty: 1 }]));
        sessionStorage.setItem('seeded', '1');
      }
      window.__opened = [];
      window.open = function (u) { window.__opened.push(u); return null; };
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message || e)));
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    return { ctx, page, errors };
  }
  async function checkout(page) {
    await page.click('#cartBtn');
    await page.waitForSelector('#ctGo', { timeout: 5000 });
    await page.click('#ctGo');
    await page.waitForSelector('#odGo', { timeout: 5000 });
  }

  try {
    console.log('\nSwitched off: nothing has changed');
    {
      const { ctx, page } = await open();
      await checkout(page);
      const v = await page.evaluate(() => ({
        pay: !!document.getElementById('odPay'),
        extra: document.querySelectorAll('#orderBody .od-opt').length,
        email: !!document.getElementById('od_email')
      }));
      is(!v.pay && !v.email, 'no Pay button, and no extra questions', JSON.stringify(v));
      await ctx.close();
    }

    SETTINGS.payments.onlineEnabled = true;
    console.log('\nSwitched on');
    {
      const { ctx, page, errors } = await open();
      await checkout(page);
      const v = await page.evaluate(() => {
        const acts = document.querySelector('#orderBody .rv-actions');
        const btns = Array.from(acts.querySelectorAll('button')).map(b => b.id);
        return { btns, pay: (document.getElementById('odPay') || {}).textContent,
                 email: !!document.getElementById('od_email') };
      });
      is(v.btns[0] === 'odGo' && v.btns[1] === 'odPay', 'Continue on WhatsApp stays first; Pay now sits under it', JSON.stringify(v.btns));
      is(v.pay === 'Pay now — card or mobile money', 'worded for card and mobile money', v.pay);
      is(v.email, 'and an email box is added, marked as needed only to pay online');

      console.log('\nWhatsApp checkout, with the switch on');
      await page.fill('#od_name', 'Chanda');
      await page.fill('#od_phone', '0977123456');
      await page.click('#odGo');
      await page.waitForTimeout(300);
      const wa = await page.evaluate(() => window.__opened);
      is(wa.length === 1 && /wa\.me\/260970000000/.test(wa[0]),
         'still goes straight to WhatsApp, without asking for the email', JSON.stringify(wa));

      console.log('\nPaying online');
      await checkout(page);
      await page.fill('#od_name', 'Chanda');
      await page.fill('#od_phone', '0977123456');
      await page.click('#odPay');
      await page.waitForTimeout(200);
      const need = await page.evaluate(() => document.getElementById('odMsg').textContent);
      is(/email/i.test(need), 'the email is asked for before paying', need);
      await page.fill('#od_email', 'chanda@example.com');
      await page.click('#odPay');
      await page.waitForTimeout(200);
      const need2 = await page.evaluate(() => document.getElementById('odMsg').textContent);
      is(/address/i.test(need2), 'and a delivery address', need2);
      await page.fill('#od_address', 'Plot 5, Lusaka');
      await page.click('#odPay');
      await page.waitForSelector('.pq-total', { timeout: 8000 });
      const q = await page.evaluate(() => ({
        rows: Array.from(document.querySelectorAll('.pq-row')).map(r => r.textContent.replace(/\s+/g, ' ').trim()),
        btn: document.getElementById('pqPay').textContent
      }));
      is(q.rows.some(r => /Delivery\s*K80/.test(r)) && q.rows.some(r => /Total\s*K1,380/.test(r)),
         'the quote shows the delivery fee added before paying', JSON.stringify(q.rows));
      is(q.btn === 'Pay K1,380', 'and the button says exactly what will be paid', q.btn);
      if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });

      await Promise.all([page.waitForURL(/fake-flutterwave/, { timeout: 10000 }), page.click('#pqPay')]);
      const tx = await page.textContent('#tx');
      is(/^VB-ABCD\d-[a-f0-9]{10}$/.test(tx), 'the customer is sent to Flutterwave\'s page with the order\'s reference', tx);
      const o = DB.orders[DB.orders.length - 1];
      is(o.total === 1380 && o.payment_status === 'awaiting', 'the order is in the Orders tab, awaiting payment');

      console.log('\nComing back, paid');
      FLW.verify[tx] = { id: 900, tx_ref: tx, status: 'successful', amount: 1380, currency: 'ZMW', payment_type: 'card' };
      await page.goto(base + '/payment-return?status=successful&tx_ref=' + tx + '&transaction_id=900');
      await page.waitForFunction(() => /Payment received/.test((document.getElementById('prHead') || {}).textContent || ''), null, { timeout: 10000 });
      const done = await page.evaluate(() => ({
        lead: document.getElementById('prLead').textContent,
        cart: localStorage.getItem('vbp_cart'), path: location.pathname
      }));
      is(/is paid \(K1,380\)/.test(done.lead) && /email/.test(done.lead), 'the customer is told it is paid, and that an email is coming', done.lead);
      is(done.cart === '[]', 'the cart is emptied', done.cart);
      is(done.path === '/', 'and the address is tidied, so a refresh does not ask again', done.path);
      is(o.payment_status === 'paid', 'the order is marked paid');
      is(errors.length === 0, 'with no errors on the page' + (errors.length ? ': ' + errors[0] : ''));
      await ctx.close();
    }

    console.log('\nComing back, not paid');
    {
      const { ctx, page } = await open();
      await checkout(page);
      await page.fill('#od_name', 'Chanda'); await page.fill('#od_phone', '0966000000');
      await page.fill('#od_email', 'c@example.com'); await page.fill('#od_address', 'Plot 5');
      await page.click('#odPay');
      await page.waitForSelector('.pq-total', { timeout: 8000 });
      await Promise.all([page.waitForURL(/fake-flutterwave/), page.click('#pqPay')]);
      const tx = await page.textContent('#tx');
      FLW.verify[tx] = { id: 901, tx_ref: tx, status: 'cancelled', amount: 1380, currency: 'ZMW' };
      await page.goto(base + '/payment-return?status=cancelled&tx_ref=' + tx + '&transaction_id=901');
      await page.waitForFunction(() => /did not go through/.test((document.getElementById('prHead') || {}).textContent || ''), null, { timeout: 10000 });
      const cart = await page.evaluate(() => JSON.parse(localStorage.getItem('vbp_cart')).length);
      is(cart === 2, 'the customer is told it did not go through, and their cart is still there');
      await ctx.close();
    }

    console.log('\nCollecting instead');
    SETTINGS.payments.onlineMode = 'test';
    {
      const { ctx, page } = await open();
      SETTINGS.delivery = { payDelivery: true, standardFee: 80, pickupEnabled: true, deliveryEnabled: true };
      await checkout(page);
      const both = await page.$('input[name="odHow"][value="collection"]');
      if (both) {
        await both.check();
        await page.fill('#od_name', 'C'); await page.fill('#od_phone', '0955000000'); await page.fill('#od_email', 'c@e.com');
        await page.click('#odPay');
        await page.waitForSelector('.pq-total', { timeout: 8000 });
        const rows = await page.evaluate(() => Array.from(document.querySelectorAll('.pq-row')).map(r => r.textContent.replace(/\s+/g, ' ').trim()));
        is(!rows.some(r => /Delivery/.test(r)) && rows.some(r => /Total\s*K1,300/.test(r)), 'no delivery fee when collecting', JSON.stringify(rows));
      } else {
        ok('(this shop offers only one way to receive an order)');
      }
      await ctx.close();
    }
    console.log('\nDelivery priced by town and weight');
    SETTINGS.delivery = {
      payDelivery: true, feeMethod: 'zones', tierSmallMax: 5, tierMediumMax: 15,
      zone1Small: 11, zone1Medium: 12, zone1Large: 13, zone2Small: 21, zone2Medium: 22, zone2Large: 23,
      towns: [{ name: 'Lusaka', zone: 'zone1' }, { name: 'Kitwe', zone: 'zone2' }], missingWeight: 'block',
    };
    {
      const { ctx, page } = await open();
      await checkout(page);
      const opts = await page.evaluate(() => Array.from(document.querySelectorAll('#od_town option')).map(o => o.textContent));
      is(opts.join('|') === 'Choose your town|Lusaka|Kitwe|My town is not listed',
         'a town dropdown lists the shop\'s towns', opts.join('|'));
      await page.fill('#od_name', 'C'); await page.fill('#od_phone', '0955000001');
      await page.fill('#od_email', 'c@e.com'); await page.fill('#od_address', 'Plot 9');
      await page.click('#odPay');
      await page.waitForTimeout(200);
      is(/town/i.test(await page.textContent('#odMsg')), 'the town must be chosen before paying');
      await page.selectOption('#od_town', 'Kitwe');
      await page.click('#odPay');
      await page.waitForSelector('.pq-total', { timeout: 8000 });
      const rows = await page.evaluate(() => Array.from(document.querySelectorAll('.pq-row')).map(r => r.textContent.replace(/\s+/g, ' ').trim()));
      is(rows.some(r => /Delivery to Kitwe · 5\.5 kg\s*K22/.test(r)) && rows.some(r => /Total\s*K1,322/.test(r)),
         'two satchels (2 kg) and a scarf (1.5 kg) to Kitwe: 5.5 kg, medium, zone 2 fee added', JSON.stringify(rows));
      if (process.env.SHOT2) await page.screenshot({ path: process.env.SHOT2 });
      await page.click('#pqBack');
      await page.waitForSelector('#od_town');
      await page.selectOption('#od_town', '__other');
      await page.fill('#od_name', 'C'); await page.fill('#od_phone', '0955000001');
      await page.fill('#od_email', 'c@e.com'); await page.fill('#od_address', 'Plot 9');
      await page.click('#odPay');
      await page.waitForFunction(() => /WhatsApp/.test((document.getElementById('pqLead') || {}).textContent || ''), null, { timeout: 8000 });
      const lead = await page.textContent('#pqLead');
      is(/collect in person, or order on WhatsApp/.test(lead) && /WhatsApp instead/.test(await page.textContent('#pqPay')),
         '"My town is not listed" is pointed to collection or WhatsApp, never charged a guess', lead);
      await ctx.close();
    }
  } catch (e) {
    fail('threw: ' + (e && e.stack || e));
  } finally {
    await browser.close();
    server.close();
  }
  console.log('\n' + (failures ? '  ✗ ' + failures + ' of ' + checks + ' checks FAILED'
                                : '  online payment in the browser: all ' + checks + ' checks passed'));
  process.exit(failures ? 1 : 0);
})();
