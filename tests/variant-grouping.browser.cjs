/* ===========================================================================
   ONE PIECE, NOT THREE — driven in a real browser

   THE SHOP OWNER: "I want it to receive products with the same name as one,
   just with variations as opposed to splitting everything like the platform
   does... If product A has 3 different colors and sizes, it shouldn't be split
   into A A A. It should be products A, then when someone selects it, they see
   variations accordingly."

   The platform splits a piece that arrived in several colours or sizes into a
   separate product for each combination, each with its own code and its own
   stock. That is right and it stays: a Black Large and a Red Small are
   different things to count. What was wrong is that the shop drew one card per
   combination, so a jacket in three colours filled the grid three times.

   Grouped by CATEGORY AND NAME, at the owner's choosing, so that pieces entered
   through Itemised or Consignment — which carry no variantGroup at all — are
   not left scattered.

   Driven against the real page because the claim is about what a visitor sees.
   A source-reading test would pass on a grid that still drew three cards.
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

const V = (over) => Object.assign({
  name: 'Kitenge Wrap Dress', sku: '', category: "Women's Fashion", price: 940,
  size: '', color: '', material: 'Cotton', available: true, lowStock: false,
  wasPrice: 0, brand: 'Vaultique Atelier', description: 'Block-printed cotton.',
  details: [], variantGroup: 'VG-7'
}, over);

const CATALOGUE = [
  /* One dress, six ways. The platform split these; the shop must not. */
  V({ sku: 'WF-KIWR-BK-S', color: 'Black', size: 'S' }),
  V({ sku: 'WF-KIWR-BK-M', color: 'Black', size: 'M' }),
  V({ sku: 'WF-KIWR-BK-L', color: 'Black', size: 'L', available: false }),
  V({ sku: 'WF-KIWR-RD-S', color: 'Red',   size: 'S' }),
  V({ sku: 'WF-KIWR-RD-M', color: 'Red',   size: 'M' }),
  V({ sku: 'WF-KIWR-RD-L', color: 'Red',   size: 'L' }),

  /* Two colours of the same belt, entered through Itemised, so NO variantGroup
     at all. These are the ones that grouping by the tag alone would scatter,
     and the reason the owner chose category and name. */
  V({ name: 'Heritage Suede Belt', sku: 'AC-HESU-BR-L', category: 'Accessories',
      color: 'Brown', size: 'L', price: 290, variantGroup: '' }),
  V({ name: 'Heritage Suede Belt', sku: 'AC-HESU-BK-L', category: 'Accessories',
      color: 'Black', size: 'L', price: 290, variantGroup: '' }),

  /* A piece on its own. It must not gain a picker it has no use for. */
  V({ name: 'Kudu Leather Satchel', sku: 'BG-KULE-BR-OS', category: 'Bags',
      color: 'Brown', size: 'One size', price: 3200, variantGroup: '' }),

  /* SAME NAME, DIFFERENT CATEGORY. Must stay two pieces: grouping on name
     alone would merge a dress and a scarf that happen to share a word. */
  V({ name: 'Kitenge Wrap Dress', sku: 'AC-KIWR-BK-OS', category: 'Accessories',
      color: 'Black', size: 'One size', price: 180, variantGroup: '' })
];

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/json'
};
const SUPABASE_STUB = `
window.supabase = { createClient: function () {
  return { channel: function () { var ch = { on: function(){ return ch; }, subscribe: function(){ return ch; } }; return ch; },
           removeChannel: function () {} }; } };`;

function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const p = new URL(req.url, 'http://x').pathname;
      if (p === '/api/products') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({
          products: CATALOGUE, count: CATALOGUE.length,
          generatedAt: new Date().toISOString(),
          version: crypto.createHash('sha1').update(JSON.stringify(CATALOGUE)).digest('hex').slice(0, 12)
        }));
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

/* The name on a card is drawn into .n — the class the grid actually uses. My
   first draft guessed three other class names and found none of them, which is
   why this reads the page rather than the source. */
const cardNames = page => page.evaluate(() =>
  Array.from(document.querySelectorAll('#grid .n'))
    .map(e => (e.textContent || '').trim()).filter(Boolean));

(async () => {
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    await page.goto(base + '/#/shop', { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);

    console.log('\nThe shelf');

    const names = await cardNames(page);
    const dress = names.filter(n => /Kitenge Wrap Dress/i.test(n));
    is(names.length > 0, 'the shop drew some pieces (' + names.length + ')', JSON.stringify(names));
    is(dress.length === 2,
       'a dress in six colour-and-size combinations is TWO cards, not six — the dress, and the scarf of the same name in another category',
       JSON.stringify(dress));

    const belts = names.filter(n => /Heritage Suede Belt/i.test(n));
    is(belts.length === 1,
       'and two belts entered with NO variant tag still group, because the grouping is on category and name',
       JSON.stringify(belts));

    const sat = names.filter(n => /Kudu Leather Satchel/i.test(n));
    is(sat.length === 1, 'a piece on its own is still exactly one card');

    console.log('\nThe piece, and choosing between its variations');

    await page.goto(base + '/#/product/WF-KIWR-BK-S', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);

    const opts = await page.evaluate(() => {
      const blocks = Array.from(document.querySelectorAll('#view-detail .opt-block'));
      return blocks.map(b => ({
        label: ((b.querySelector('.lbl') || {}).textContent || '').trim(),
        chips: Array.from(b.querySelectorAll('.opt-chip')).map(c => ({
          text: (c.textContent || '').trim(),
          pick: c.classList.contains('opt-pick'),
          on: c.classList.contains('on'),
          gone: c.classList.contains('gone')
        }))
      }));
    });

    const sizes  = opts.filter(o => /size/i.test(o.label))[0];
    const colours = opts.filter(o => /colour/i.test(o.label))[0];

    is(!!sizes && sizes.chips.length === 3,
       'the page offers all three sizes', JSON.stringify(sizes));
    is(!!colours && colours.chips.length === 2,
       'and both colours', JSON.stringify(colours));
    is(!!sizes && sizes.chips.every(c => c.pick),
       'each one can actually be pressed');
    is(!!sizes && sizes.chips.filter(c => c.on).length === 1 && sizes.chips.filter(c => c.on)[0].text === 'S',
       'the one being looked at is marked, and only it');
    is(!!sizes && sizes.chips.filter(c => c.gone).length === 1 && sizes.chips.filter(c => c.gone)[0].text === 'L',
       'and the size that is sold out is faded rather than hidden — a shopper is owed the difference',
       JSON.stringify(sizes && sizes.chips));

    /* Pressing one is the whole point. */
    await page.evaluate(() => {
      const chips = Array.from(document.querySelectorAll('#view-detail .opt-chip.opt-pick'));
      const m = chips.filter(c => (c.textContent || '').trim() === 'M')[0];
      if (m) m.click();
    });
    await page.waitForTimeout(500);

    /* Asserted on what the shopper now sees, not on the address bar: whether
       the page is reached by hash or by path is this website's business, and a
       test that pins it would break on a routing change that changed nothing
       for anybody looking at the screen. */
    const after = await page.evaluate(() => {
      const marked = {};
      Array.from(document.querySelectorAll('#view-detail .opt-block')).forEach(b => {
        const label = ((b.querySelector('.lbl') || {}).textContent || '').trim();
        const on = b.querySelector('.opt-chip.on');
        marked[label] = on ? (on.textContent || '').trim() : '';
      });
      return marked;
    });
    is(after.Size === 'M',
       'choosing Medium opens the Medium', JSON.stringify(after));
    is(after.Colour === 'Black',
       'and keeps the colour that was already chosen, rather than starting again',
       JSON.stringify(after));

    console.log('\nAnd a piece with nothing to choose');

    await page.goto(base + '/#/product/BG-KULE-BR-OS', { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    const lone = await page.evaluate(() =>
      document.querySelectorAll('#view-detail .opt-chip.opt-pick').length);
    is(lone === 0, 'shows no picker at all, because there is nothing to pick between');

  } catch (e) {
    fail('threw: ' + (e && e.message || e));
  } finally {
    await browser.close();
    server.close();
  }

  console.log('\n' + (failures ? '  ✗ ' + failures + ' of ' + checks + ' checks FAILED'
                                : '  one piece, not three: all ' + checks + ' checks passed'));
  process.exit(failures ? 1 : 0);
})();
