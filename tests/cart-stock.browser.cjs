/* ===========================================================================
   THE CART STOPS AT THE STOCK — driven in a real browser

   THE OWNER: "in cart, product quantity shouldn't add more than what is in
   stock."

   The cart lives in the customer's browser, and until now the feed told that
   browser only whether a piece was in stock, never how many. So the cart
   stopped at 99 of anything. The feed now sends maxQty -- the stock, capped
   at 99 -- and the cart stops there.

   Three things are driven here, all against the real page:
     - adding stops at the stock, on the card and in the cart panel;
     - a cart already holding more than is left (the piece sold in the shop
       meanwhile) is cut back and SAYS so, both when the page loads and when
       a sale arrives while the page is open;
     - a sale arriving while the page is open does not redraw the page. The
       feed leaves maxQty out of its version for exactly this reason, and this
       server does the same.
   =========================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');

let checks = 0, failures = 0;
const ok   = m => { checks++; console.log('  ✓ ' + m); };
const fail = (m, extra) => { checks++; failures++; console.log('  ✗ ' + m + (extra ? '\n      ' + extra : '')); };
const is   = (c, m, extra) => c ? ok(m) : fail(m, extra);

const P = (over) => Object.assign({
  name: 'Piece', sku: '', category: 'Bags', price: 500, size: 'One size', color: '',
  material: '', available: true, lowStock: false, wasPrice: 0, brand: '',
  description: '', details: [], variantGroup: ''
}, over);

let CATALOGUE = [
  P({ name: 'Kudu Leather Satchel', sku: 'BG-KULE-BR-OS', color: 'Brown', price: 3200, maxQty: 2, lowStock: true }),
  P({ name: 'Woven Tote', sku: 'BG-WOTO-NT-OS', color: 'Natural', price: 1150, maxQty: 12 }),
  /* From a feed older than this change: no maxQty at all. */
  P({ name: 'Silk Scarf', sku: 'AC-SISC-GD-OS', category: 'Accessories', color: 'Gold', price: 420 })
];

/* The version, the way netlify/functions/products.js takes it: without the
   cart ceiling, so that a sale alone does not change it. */
const versionOf = list => crypto.createHash('sha1')
  .update(JSON.stringify(list.map(p => { const o = Object.assign({}, p); delete o.maxQty; return o; })))
  .digest('hex').slice(0, 12);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/json'
};
/* Hands this test the handler the storefront registers for the pulse, so a
   "something changed in the shop" can be delivered on demand. */
const SUPABASE_STUB = `
window.__pulse = { handlers: [] };
window.supabase = { createClient: function () { return {
  channel: function () { var ch = {
    on: function (_e, _f, fn) { window.__pulse.handlers.push(fn); return ch; },
    subscribe: function (cb) { if (cb) setTimeout(function(){ cb('SUBSCRIBED'); }, 0); return ch; } };
    return ch; },
  removeChannel: function () {} }; } };
window.__noReload = 'alive';`;

function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const p = new URL(req.url, 'http://x').pathname;
      if (p === '/api/products') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ products: CATALOGUE, count: CATALOGUE.length,
          generatedAt: new Date().toISOString(), version: versionOf(CATALOGUE) }));
        return;
      }
      if (p.indexOf('/rest/v1/') === 0) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('[]'); return; }
      if (p === '/config.js') {
        res.writeHead(200, { 'Content-Type': TYPES['.js'] });
        res.end('window.VBP_CONFIG={SUPABASE_URL:"http://127.0.0.1:' + server.address().port + '",SUPABASE_ANON_KEY:"test-anon-key"};');
        return;
      }
      if (p === '/__stub.js') { res.writeHead(200, { 'Content-Type': TYPES['.js'] }); res.end(SUPABASE_STUB); return; }
      let file = path.join(ROOT, p);
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, 'index.html');
      let html = null;
      if (file.endsWith('index.html')) {
        html = fs.readFileSync(file, 'utf8')
          .replace('<script src="/config.js"></script>', '<script src="/config.js"></script>\n<script src="/__stub.js"></script>');
      }
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream' });
      res.end(html !== null ? html : fs.readFileSync(file));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const SATCHEL = 'BG-KULE-BR-OS', TOTE = 'BG-WOTO-NT-OS', SCARF = 'AC-SISC-GD-OS';

/* The grid's own add-to-cart button for one piece. */
const gridBtn = sku => '#grid [data-cart-sku="' + sku + '"]';
const btnState = (page, sku) => page.evaluate(sel => {
  const b = document.querySelector(sel);
  return b ? { text: (b.textContent || '').replace(/\s+/g, ' ').trim(), disabled: b.disabled,
               label: b.getAttribute('aria-label') } : null;
}, gridBtn(sku));
const stored = page => page.evaluate(() => JSON.parse(localStorage.getItem('vbp_cart') || '[]'));
const qtyOf = (list, sku) => (list.filter(l => l.sku === sku)[0] || {}).qty;
const badge = page => page.evaluate(() => (document.querySelector('#cartCount') || {}).textContent);
const lineOf = (page, sku) => page.evaluate(s => {
  const l = document.querySelector('#cartBody .cart-line[data-sku="' + s + '"]');
  if (!l) return null;
  const plus = l.querySelector('[data-inc]');
  const cap = l.querySelector('.cart-cap');
  return { qty: Number((l.querySelector('.qty-n') || {}).textContent), plusOff: !!(plus && plus.disabled),
           note: cap ? cap.textContent.trim() : '' };
}, sku);
async function pulse(page) {
  await page.evaluate(() => window.__pulse.handlers.forEach(fn => fn({ eventType: 'UPDATE' })));
  await page.waitForTimeout(700);
}

(async () => {
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  try {
    await page.goto(base + '/shop', { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.removeItem('vbp_cart'));
    await page.goto(base + '/shop', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);

    console.log('\nAdding stops at the stock');

    await page.click(gridBtn(SATCHEL));
    await page.waitForTimeout(1700);            // let the "Added" flash pass
    let st = await btnState(page, SATCHEL);
    is(st && /In cart · 1/.test(st.text) && !st.disabled,
       'two left: the first goes in, and there is still room for another', JSON.stringify(st));

    await page.click(gridBtn(SATCHEL));
    await page.waitForTimeout(1700);
    st = await btnState(page, SATCHEL);
    is(st && /In cart · 2/.test(st.text) && /all we have/i.test(st.text),
       'the second goes in, and the button now says that is all there is', JSON.stringify(st));
    is(st && st.disabled, 'and it stops taking taps');
    is(st && /all we have in stock/i.test(st.label || ''), 'which a screen reader is told too', st && st.label);

    await page.click(gridBtn(SATCHEL), { force: true }).catch(() => {});
    await page.waitForTimeout(300);
    is(qtyOf(await stored(page), SATCHEL) === 2, 'a third tap adds nothing: the cart holds 2',
       JSON.stringify(await stored(page)));

    /* A feed that says nothing keeps the old ceiling of 99. */
    for (let i = 0; i < 3; i++) { await page.click(gridBtn(SCARF)); await page.waitForTimeout(150); }
    await page.waitForTimeout(1600);
    st = await btnState(page, SCARF);
    is(qtyOf(await stored(page), SCARF) === 3 && st && !st.disabled,
       'a piece the feed gives no figure for is not held back', JSON.stringify(st));

    await page.click(gridBtn(TOTE));
    await page.waitForTimeout(300);

    console.log('\nAnd the cart panel agrees');

    await page.click('#cartBtn');
    await page.waitForTimeout(400);
    let line = await lineOf(page, SATCHEL);
    is(line && line.qty === 2 && line.plusOff, 'the satchel line shows 2, with plus switched off', JSON.stringify(line));
    is(line && /all we have in stock/i.test(line.note), 'and says why', line && line.note);
    line = await lineOf(page, TOTE);
    is(line && line.qty === 1 && !line.plusOff && !line.note,
       'while the tote, with twelve left, carries on as before', JSON.stringify(line));

    await page.click('#cartBody .cart-line[data-sku="' + SATCHEL + '"] [data-inc]', { force: true }).catch(() => {});
    await page.waitForTimeout(300);
    is(qtyOf(await stored(page), SATCHEL) === 2, 'pressing plus there anyway changes nothing');

    console.log('\nA sale in the shop while the cart is open');

    /* Somebody buys one of the two in the shop. The version is unchanged --
       nothing a visitor can see has moved -- so the page must take the new
       figure quietly rather than redrawing. */
    const cardBefore = await page.evaluate(() => { const c = document.querySelector('#grid .card'); c.__mark = 'same'; return true; });
    CATALOGUE = CATALOGUE.map(p => p.sku === SATCHEL ? Object.assign({}, p, { maxQty: 1 }) : p);
    await pulse(page);

    line = await lineOf(page, SATCHEL);
    is(line && line.qty === 1, 'the satchel comes down to the one that is left', JSON.stringify(line));
    is(line && /Only 1 left, so this has come down from 2/.test(line.note),
       'and the line says so, rather than a number changing by itself', line && line.note);
    is(qtyOf(await stored(page), SATCHEL) === 1, 'the cart kept in the browser says 1 as well');
    is(await badge(page) === '5', 'the header count follows (1 + 3 + 1)', await badge(page));
    is(cardBefore && await page.evaluate(() => { const c = document.querySelector('#grid .card'); return c && c.__mark === 'same'; }),
       'and the shop behind it was not redrawn to do it');
    is(await page.evaluate(() => window.__noReload === 'alive'), 'nor was the page reloaded');

    /* Most refreshes find nothing has moved. An open cart must not be
       redrawn under somebody's thumb for those. */
    await page.evaluate(() => { document.querySelector('#cartBody .cart-lines').__mark = 'kept'; });
    await pulse(page);
    is(await page.evaluate(() => (document.querySelector('#cartBody .cart-lines') || {}).__mark === 'kept'),
       'a refresh that finds nothing moved leaves the open cart alone');

    /* Restocked while the note is showing: it must stop saying "only". */
    CATALOGUE = CATALOGUE.map(p => p.sku === SATCHEL ? Object.assign({}, p, { maxQty: 4 }) : p);
    await pulse(page);
    line = await lineOf(page, SATCHEL);
    is(line && line.qty === 1 && !line.plusOff && !line.note,
       'restocked: the note goes and plus works again', JSON.stringify(line));
    CATALOGUE = CATALOGUE.map(p => p.sku === SATCHEL ? Object.assign({}, p, { maxQty: 1 }) : p);

    await page.click('#cartBody .cart-line[data-sku="' + SATCHEL + '"] [data-rm]');
    await page.waitForTimeout(300);
    is(!(await lineOf(page, SATCHEL)), 'removing the line works as it always did');

    console.log('\nA cart left from yesterday, holding more than is left');

    await page.evaluate(s => localStorage.setItem('vbp_cart', JSON.stringify([
      { sku: s, qty: 5, name: 'Kudu Leather Satchel' }])), SATCHEL);
    await page.goto(base + '/shop', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    is(qtyOf(await stored(page), SATCHEL) === 1, 'five in the cart, one in the shop: the cart is cut to one on arrival',
       JSON.stringify(await stored(page)));
    is(await badge(page) === '1', 'the header says 1, not 5', await badge(page));
    await page.click('#cartBtn');
    await page.waitForTimeout(400);
    line = await lineOf(page, SATCHEL);
    is(line && /Only 1 left, so this has come down from 5/.test(line.note), 'and the cart says what happened',
       line && line.note);
    const total = await page.evaluate(() => (document.querySelector('#ctTotal') || {}).textContent || '');
    is(/3,200/.test(total), 'with the total for the one that can actually be had', total);

  } catch (e) {
    fail('threw: ' + (e && e.message || e));
  } finally {
    await browser.close();
    server.close();
  }

  console.log('\n' + (failures ? '  ✗ ' + failures + ' of ' + checks + ' checks FAILED'
                                : '  the cart stops at the stock: all ' + checks + ' checks passed'));
  process.exit(failures ? 1 : 0);
})();
