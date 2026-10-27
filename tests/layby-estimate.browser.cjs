/* ===========================================================================
   THE LAYBY ESTIMATE ON THE PRODUCT PAGE -- driven in a real browser

   THE OWNER: "Display a professional, compact layby estimate beneath the
   product price ... All values and labels must update automatically when the
   product price, deposit percentage or payment duration changes ... Add a
   clickable 'Layby Terms & Conditions' link below the estimate ... This is
   just for display when a product is opened, do not create a layby."

   The real index.html, app.js and layby.js. /api/products and the website's
   Supabase are answered by this file, so the shop's settings, its prices and
   its policies can be changed between visits the way the shop changes them.
   Checked: the owner's own example; the shop's own terms; a different size at
   a different price; a sale price; a price that changes while the page is
   open; pieces with no estimate; terms that make no sense; the terms link;
   a phone and a computer; and that looking at it changes nothing anywhere.
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
const J = o => JSON.stringify(o);

const V = (over) => Object.assign({
  name: 'Beige Knit Vest Top', sku: '', category: 'Tops', price: 499,
  size: '', color: 'Beige', material: 'Knit', available: true, lowStock: false,
  wasPrice: 0, brand: '', description: 'A soft knit vest.', details: [], variantGroup: ''
}, over);

let CATALOGUE = [];
function freshCatalogue() {
  CATALOGUE = [
    /* One top in two sizes, at two prices. */
    V({ sku: 'TP-BKVT-BE-S', size: 'S', price: 499 }),
    V({ sku: 'TP-BKVT-BE-L', size: 'L', price: 549 }),
    /* Reduced: K450, was K600. The estimate is on what it sells for. */
    V({ name: 'Linen Wrap Skirt', sku: 'SK-LIWR-WH-M', category: 'Skirts', price: 450, wasPrice: 600,
        size: 'M', color: 'White' }),
    /* Its price is settled in conversation (product_meta below). */
    V({ name: 'Gold Cuff', sku: 'AC-GOCU-GD-OS', category: 'Accessories', price: 1200,
        size: 'One size', color: 'Gold' }),
    /* Sold out, with no other colour to send the visitor to. */
    V({ name: 'Silk Scarf', sku: 'AC-SISC-RD-OS', category: 'Scarves', price: 300, available: false,
        size: 'One size', color: 'Red' })
  ];
}
freshCatalogue();

let PAYMENTS = null;      // site_settings 'payments', as the shop saved it (null: never)
let PRICING = null;       // site_settings 'pricing'
let POLICIES = null;      // the policies table (null: empty, so the built-in ones show)
const META = [{ sku: 'AC-GOCU-GD-OS', on_request: true }];
const WRITES = [];        // everything that was not a plain read

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/json'
};

/* No realtime: the page falls back to asking, which is what lets a test say
   when it asks. */
const SUPABASE_STUB = `
window.supabase = { createClient: function () { return {
  channel: function () { var ch = { on: function () { return ch; }, subscribe: function () { return ch; } }; return ch; },
  removeChannel: function () {}
}; } };`;

function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      const p = u.pathname;
      const json = (o, st) => { res.writeHead(st || 200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(o)); };
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        if (req.method !== 'GET' && req.method !== 'HEAD') WRITES.push({ method: req.method, path: p, body: body.slice(0, 300) });

        if (p === '/api/products') {
          return json({ products: CATALOGUE, count: CATALOGUE.length, generatedAt: new Date().toISOString(),
            version: crypto.createHash('sha1').update(JSON.stringify(CATALOGUE)).digest('hex').slice(0, 12) });
        }
        if (p === '/rest/v1/site_settings') {
          const key = (u.searchParams.get('key') || '').replace('eq.', '');
          if (key === 'payments') return json(PAYMENTS ? [{ data: PAYMENTS }] : []);
          if (key === 'pricing') return json(PRICING ? [{ data: PRICING }] : []);
          return json([]);
        }
        if (p === '/rest/v1/policies') return json(POLICIES || []);
        if (p === '/rest/v1/product_meta') return json(META);
        if (p.indexOf('/rest/v1/') === 0) return json([]);
        if (p.indexOf('/.netlify/functions/') === 0) return json({ error: 'not here' }, 404);
        if (p === '/config.js') {
          res.writeHead(200, { 'Content-Type': TYPES['.js'] });
          return res.end('window.VBP_CONFIG={SUPABASE_URL:"http://127.0.0.1:' + server.address().port +
                         '",SUPABASE_ANON_KEY:"test-anon-key"};');
        }
        if (p === '/__stub.js') { res.writeHead(200, { 'Content-Type': TYPES['.js'] }); return res.end(SUPABASE_STUB); }

        let file = path.join(ROOT, p);
        if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, 'index.html');
        let html = null;
        if (file.endsWith('index.html')) {
          html = fs.readFileSync(file, 'utf8').replace('<script src="/config.js"></script>',
            '<script src="/config.js"></script>\n<script src="/__stub.js"></script>');
        }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
        res.end(html !== null ? html : fs.readFileSync(file));
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

/* The estimate as a visitor reads it. */
const read = page => page.evaluate(() => {
  const box = document.querySelector('#view-detail .layby');
  if (!box) return null;
  const t = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : '');
  const link = box.querySelector('a.layby-terms');
  return {
    rows: Array.from(box.querySelectorAll('.layby-rows > div')).map(d => [t(d.querySelector('dt')), t(d.querySelector('dd'))]),
    pill: t(box.querySelector('.layby-pill')),
    link: link ? { text: t(link), href: link.getAttribute('href') } : null,
    note: t(box.querySelector('.layby-note'))
  };
});
const rowsAre = (r, want) => !!r && J(r.rows) === J(want);

(async () => {
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const errors = [];

  async function open(url, viewport) {
    const ctx = await browser.newContext({ viewport: viewport || { width: 1280, height: 900 } });
    await ctx.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await ctx.route('**/fonts.gstatic.com/**', r => r.abort());
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(String((e && e.message) || e)));
    await page.goto(base + url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    return { ctx, page };
  }

  try {
    /* ================================================================== */
    console.log('\nThe owner\'s example: K499, a shop that has not touched the settings');
    let { ctx, page } = await open('/product/TP-BKVT-BE-S');
    let r = await read(page);
    is(rowsAre(r, [['Product price', 'K499.00'], ['Deposit (30%)', 'K149.70'], ['Remaining balance', 'K349.30']]),
       'Product price K499.00, Deposit (30%) K149.70, Remaining balance K349.30', J(r));
    is(r && r.pill === 'From K58.22 per month over 6 months', '"From K58.22 per month over 6 months"', r && r.pill);
    is(r && r.link && r.link.text === 'Layby Terms & Conditions' && r.link.href === '/policies/lay-by-policy',
       'with "Layby Terms & Conditions" under it, pointing at the shop\'s own Lay-by Policy', J(r && r.link));
    is(r && /estimate only/i.test(r.note), 'and saying it is an estimate', r && r.note);
    const order = await page.evaluate(() => {
      const q = s => document.querySelector('#view-detail ' + s);
      const price = q('.detail-price'), lb = q('.layby'), desc = q('.desc');
      const F = Node.DOCUMENT_POSITION_FOLLOWING;
      return {
        after: !!(price && lb && (price.compareDocumentPosition(lb) & F)),
        before: !!(lb && desc && (lb.compareDocumentPosition(desc) & F)),
        gap: lb && price ? Math.round(lb.getBoundingClientRect().top - price.getBoundingClientRect().bottom) : null
      };
    });
    is(order.after && order.before && order.gap >= 0 && order.gap < 60,
       'beneath the price, above the description', J(order));
    await ctx.close();

    /* ================================================================== */
    console.log('\nThe shop\'s own terms: 25% over 12 months');
    PAYMENTS = { cashEnabled: true, laybyDeposit: 25, laybyMonths: 12 };
    ({ ctx, page } = await open('/product/TP-BKVT-BE-S'));
    r = await read(page);
    is(rowsAre(r, [['Product price', 'K499.00'], ['Deposit (25%)', 'K124.75'], ['Remaining balance', 'K374.25']]),
       'the label and the figures follow the percentage', J(r));
    is(r && r.pill === 'From K31.19 per month over 12 months', 'and the duration: "From K31.19 per month over 12 months"', r && r.pill);
    await ctx.close();
    PAYMENTS = { laybyDeposit: '40', laybyMonths: '1' };
    ({ ctx, page } = await open('/product/TP-BKVT-BE-S'));
    r = await read(page);
    is(r && r.rows[1][0] === 'Deposit (40%)' && r.pill === 'From K299.40 per month over 1 month',
       'one month reads "over 1 month"', J(r));
    await ctx.close();
    PAYMENTS = null;

    /* ================================================================== */
    console.log('\nAnother size, at another price');
    ({ ctx, page } = await open('/product/TP-BKVT-BE-S'));
    await page.click('#view-detail .opt-pick[data-vsku="TP-BKVT-BE-L"]');
    await page.waitForTimeout(500);
    r = await read(page);
    is(/\/product\/TP-BKVT-BE-L$/.test(page.url()) &&
       rowsAre(r, [['Product price', 'K549.00'], ['Deposit (30%)', 'K164.70'], ['Remaining balance', 'K384.30']]) &&
       r.pill === 'From K64.05 per month over 6 months',
       'choosing the Large at K549 works it out again: K164.70, K384.30, K64.05', J(r));

    console.log('\nThe price changing while the page is open');
    CATALOGUE.find(x => x.sku === 'TP-BKVT-BE-L').price = 520;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));   // the page asks for the catalogue again
    await page.waitForTimeout(900);
    r = await read(page);
    is(rowsAre(r, [['Product price', 'K520.00'], ['Deposit (30%)', 'K156.00'], ['Remaining balance', 'K364.00']]) &&
       r.pill === 'From K60.67 per month over 6 months',
       'the till changes it to K520 and the estimate follows, with nobody reloading', J(r));
    await ctx.close();
    freshCatalogue();

    /* ================================================================== */
    console.log('\nA reduced piece: the price it sells for');
    ({ ctx, page } = await open('/product/SK-LIWR-WH-M'));
    const shown = await page.evaluate(() => (document.querySelector('#view-detail .detail-price') || {}).textContent || '');
    r = await read(page);
    is(/K450/.test(shown) && /K600/.test(shown) &&
       rowsAre(r, [['Product price', 'K450.00'], ['Deposit (30%)', 'K135.00'], ['Remaining balance', 'K315.00']]) &&
       r.pill === 'From K52.50 per month over 6 months',
       'K450, was K600: worked out on K450', J({ shown, r }));
    await ctx.close();

    /* ================================================================== */
    console.log('\nTwo decimal places, whatever the shop shows its prices with');
    PRICING = { decimalPlaces: '0' };
    ({ ctx, page } = await open('/product/TP-BKVT-BE-S'));
    const plain = await page.evaluate(() => ((document.querySelector('#view-detail .detail-price .px-now') || {}).textContent || '').trim());
    r = await read(page);
    is(plain === 'K499' && r && r.rows[0][1] === 'K499.00' && r.rows[1][1] === 'K149.70',
       'the price above says K499 as the shop asked; the estimate still says K499.00 and K149.70', J({ plain, r }));
    await ctx.close();
    PRICING = null;

    /* ================================================================== */
    console.log('\nPieces with no estimate');
    ({ ctx, page } = await open('/product/AC-GOCU-GD-OS'));
    const req = await page.evaluate(() => (document.querySelector('#view-detail .detail-price') || {}).textContent || '');
    is(/request/i.test(req) && !(await read(page)), 'a price on request: nothing to work out, and nothing shown', req);
    await ctx.close();
    ({ ctx, page } = await open('/product/AC-SISC-RD-OS'));
    const sold = await page.evaluate(() => (document.querySelector('#view-detail .avail-line') || {}).textContent || '');
    is(/sold out/i.test(sold) && !(await read(page)), 'sold out: it cannot be laid by, so no estimate', sold);
    await ctx.close();

    console.log('\nTerms that make no sense, saved straight into the database');
    for (const bad of [{ laybyDeposit: 0 }, { laybyDeposit: 150 }, { laybyDeposit: 'thirty' }, { laybyMonths: 2.5 }, { laybyMonths: 0 }]) {
      PAYMENTS = bad;
      ({ ctx, page } = await open('/product/TP-BKVT-BE-S'));
      const there = await page.evaluate(() => !!document.querySelector('#view-detail .detail-price'));
      is(there && !(await read(page)), J(bad) + ': no estimate, the rest of the page as usual');
      await ctx.close();
    }
    PAYMENTS = null;

    /* ================================================================== */
    console.log('\nThe terms link');
    ({ ctx, page } = await open('/product/TP-BKVT-BE-S'));
    await page.click('#view-detail a.layby-terms');
    await page.waitForTimeout(700);
    const pol = await page.evaluate(() => {
      const v = document.getElementById('view-policies');
      const d = document.getElementById('pol-lay-by-policy');
      return { path: location.pathname, shown: !!v && v.style.display !== 'none',
               open: !!d && d.open, title: d ? d.querySelector('summary').textContent : '',
               body: d ? d.querySelector('.pol-body').textContent : '' };
    });
    is(pol.path === '/policies/lay-by-policy' && pol.shown && pol.open && /Lay-by Policy/.test(pol.title),
       'opens the Policies page at the Lay-by Policy, unfolded', J(pol));
    is(/agreed and confirmed in writing/.test(pol.body), 'the shop\'s existing terms, word for word, nothing new written', pol.body.slice(0, 80));
    await page.goBack();
    await page.waitForTimeout(600);
    is(/\/product\/TP-BKVT-BE-S$/.test(page.url()) && !!(await read(page)), 'and Back returns to the piece, estimate and all');
    await ctx.close();

    POLICIES = [
      { section: 'Special Services', title: 'Layby Terms and Conditions', body: 'Our layby terms.', sort: 1 },
      { section: 'Privacy', title: 'Privacy Policy', body: 'Our privacy policy.', sort: 2 }
    ];
    ({ ctx, page } = await open('/product/TP-BKVT-BE-S'));
    r = await read(page);
    is(r && r.link.href === '/policies/layby-terms-and-conditions',
       'a policy renamed in Admin > Policies is still the one linked', r && r.link.href);
    await ctx.close();
    POLICIES = [{ section: 'Privacy', title: 'Privacy Policy', body: 'Our privacy policy.', sort: 1 }];
    ({ ctx, page } = await open('/product/TP-BKVT-BE-S'));
    r = await read(page);
    is(r && r.link.href === '/policies', 'with no lay-by policy at all, the Policies page itself', r && r.link.href);
    await ctx.close();
    POLICIES = null;

    /* ================================================================== */
    console.log('\nOn a phone and on a computer');
    for (const [label, vp] of [['phone', { width: 390, height: 844 }], ['small phone', { width: 320, height: 640 }],
                               ['computer', { width: 1280, height: 900 }]]) {
      ({ ctx, page } = await open('/product/TP-BKVT-BE-S', vp));
      const fit = await page.evaluate(() => {
        const box = document.querySelector('#view-detail .layby').getBoundingClientRect();
        const info = document.querySelector('#view-detail .detail-info').getBoundingClientRect();
        const pill = document.querySelector('#view-detail .layby-pill').getBoundingClientRect();
        const cut = Array.from(document.querySelectorAll('#view-detail .layby dd, #view-detail .layby-pill span'))
          .filter(n => n.scrollWidth > n.clientWidth + 1).length;
        return { page: document.documentElement.scrollWidth, vw: window.innerWidth,
                 l: Math.round(box.left), r: Math.round(box.right), w: Math.round(box.width),
                 il: Math.round(info.left), ir: Math.round(info.right), pr: Math.round(pill.right), cut };
      });
      is(fit.page <= fit.vw && fit.l >= fit.il - 1 && fit.r <= fit.ir + 1 && fit.pr <= fit.r + 1 && fit.cut === 0,
         label + ' (' + vp.width + 'px): inside the column, no sideways scrolling, nothing cut off', J(fit));
      if (label === 'computer') is(fit.w <= 400, 'and compact on a computer: no wider than 400px', String(fit.w));
      if (process.env.SHOT_DIR && label !== 'small phone') {
        const el = await page.$('#view-detail .detail-info');
        await el.screenshot({ path: path.join(process.env.SHOT_DIR, 'layby-' + label + '.png') });
      }
      await ctx.close();
    }

    /* ================================================================== */
    console.log('\nLooking at it changes nothing');
    /* The chat button asks once per page whether photos are switched on: a
       question, asked by POST because that is how the database is asked
       anything. Everything else that was not a plain read is listed. */
    const READS = ['/rest/v1/rpc/chat_photos_on'];
    const touched = WRITES.filter(w => READS.indexOf(w.path) < 0);
    is(touched.length === 0, 'no order, payment, layby or hold was sent anywhere while viewing: nothing but reads', J(touched));
    ({ ctx, page } = await open('/product/TP-BKVT-BE-S'));
    const cart = await page.evaluate(() => { try { return localStorage.getItem('vbp_cart'); } catch (e) { return 'unreadable'; } });
    is(!cart || cart === '[]' || cart === '{}', 'and the cart is empty after it', String(cart));
    await ctx.close();

    is(errors.length === 0, 'no script error on any page', errors.slice(0, 3).join(' | '));
  } catch (e) {
    fail('threw', e && e.stack);
  }
  await browser.close();
  server.close();
  console.log(failures ? '\n  ✗ ' + failures + ' of ' + checks + ' checks FAILED'
                       : '\n  layby estimate on the product page: all ' + checks + ' checks passed');
  process.exit(failures ? 1 : 0);
})();
