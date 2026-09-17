/* ===========================================================================
   THE DETAILS ON THE PAGE — driven in a real browser

   tests/product-details.cjs proves the feed carries what the platform ships.
   This proves a visitor can actually read it: the page is served for real,
   /api/products answers with a piece carrying the platform's own details, and
   every assertion below is made against what is on the screen.

   The two halves matter separately. A feed that carries fifteen details to a
   page that draws none of them is exactly as useless to the shop as the feed
   that dropped them, and it would pass a source-reading test either way.
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

/* A satchel with detail on it, and a belt with none, so the page is asked
   both questions on the same visit. */
const SATCHEL_DETAILS = [
  { label: 'Lining Material', value: 'Cotton twill' },
  { label: 'Style', value: 'Satchel' },
  { label: 'Shape', value: 'Structured' },
  { label: 'Pattern', value: 'Plain' },
  { label: 'Closure Type', value: 'Buckle' },
  { label: 'Decoration', value: 'Hand-stitched edge' },
  { label: 'Feature', value: 'Water resistant' },
  { label: 'Application', value: 'Everyday' },
  { label: 'Gender', value: 'Women' },
  { label: 'Season', value: 'All season' },
  { label: 'Number of Handle/Straps', value: '2' },
  { label: 'Single Package Size', value: '38 x 28 x 12 cm' },
  /* Not one of the fifteen — it is a field of its own on the product,
     appended to the same list by the feed so the page has one thing to
     draw. Here so that the page is seen drawing it. */
  { label: 'Unit Weight', value: '0.8 kg' },
];

const CATALOGUE = [
  {
    name: 'Kudu Leather Satchel', sku: 'BG-KULE-BR-OS', category: 'Bags', price: 3200,
    size: 'One size', color: 'Kangaroo Brown', material: 'Leather',
    available: true, lowStock: false, wasPrice: 0,
    brand: 'Vaultique Atelier',
    description: 'Hand-stitched in full-grain leather and lined in cotton twill.',
    details: SATCHEL_DETAILS, variantGroup: '',
  },
  {
    name: 'Heritage Suede Belt', sku: 'AC-HESU-BR-L', category: 'Accessories', price: 290,
    size: 'L', color: 'Brown', material: 'Suede',
    available: true, lowStock: false, wasPrice: 0,
    brand: '', description: '', details: [], variantGroup: '',
  },
];

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/json'
};

const SUPABASE_STUB = `
window.supabase = {
  createClient: function () {
    return {
      channel: function () {
        var ch = { on: function () { return ch; }, subscribe: function () { return ch; } };
        return ch;
      },
      removeChannel: function () {}
    };
  }
};
`;

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
      if (p.indexOf('/rest/v1/') === 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('[]');
        return;
      }
      if (p === '/config.js') {
        res.writeHead(200, { 'Content-Type': TYPES['.js'] });
        res.end('window.VBP_CONFIG={SUPABASE_URL:"http://127.0.0.1:' + server.address().port +
                '",SUPABASE_ANON_KEY:"test-anon-key"};');
        return;
      }
      if (p === '/__stub.js') {
        res.writeHead(200, { 'Content-Type': TYPES['.js'] });
        res.end(SUPABASE_STUB);
        return;
      }

      let file = path.join(ROOT, p);
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, 'index.html');
      let html = null;
      if (file.endsWith('index.html')) {
        html = fs.readFileSync(file, 'utf8')
          .replace('<script src="/config.js"></script>',
                   '<script src="/config.js"></script>\n<script src="/__stub.js"></script>');
      }
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream' });
      res.end(html !== null ? html : fs.readFileSync(file));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

/* The specification table, read the way a visitor reads it: left column and
   right column, in the order they are drawn. */
const specRows = page => page.evaluate(() =>
  Array.from(document.querySelectorAll('#view-detail .spec-table tr')).map(tr => [
    (tr.querySelector('.l') || {}).textContent || '',
    (tr.querySelector('.r') || {}).textContent || ''
  ]));

const descText = page => page.evaluate(() => {
  const d = document.querySelector('#view-detail .desc');
  return d ? (d.textContent || '').replace(/\s+/g, ' ').trim() : '';
});

(async () => {
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();

  try {
    const page = await browser.newPage();

    /* ================================================================== */
    console.log('\nA piece the shop described in the platform');
    await page.goto(base + '/product/BG-KULE-BR-OS', { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);

    const rows = await specRows(page);
    is(rows.length > 0, 'the product page draws a specification table', 'rows: ' + rows.length);

    const missing = SATCHEL_DETAILS.filter(d =>
      !rows.some(r => r[0].trim() === d.label && r[1].trim() === d.value));
    is(missing.length === 0,
       'every detail the platform sent is on it, with its own wording',
       missing.map(d => d.label).join(', '));

    /* Order is not decoration. A page that shuffles its own rows between
       visits reads as an unreliable page. */
    const drawn = rows.map(r => r[0].trim()).filter(l => SATCHEL_DETAILS.some(d => d.label === l));
    is(JSON.stringify(drawn) === JSON.stringify(SATCHEL_DETAILS.map(d => d.label)),
       'in the order the platform sends them');

    is(rows.some(r => r[0].trim() === 'Brand' && r[1].trim() === 'Vaultique Atelier'),
       'the maker is there too');
    is(rows.some(r => r[0].trim() === 'Material' && r[1].trim() === 'Leather') &&
       rows.some(r => r[0].trim() === 'Colour' && r[1].trim() === 'Kangaroo Brown') &&
       rows.some(r => r[0].trim() === 'Size' && r[1].trim() === 'One size'),
       'and the rows the page has always shown are still above them');
    is(rows.every(r => r[0].trim() && r[1].trim()),
       'with no half-empty row anywhere in the table');

    is(/Hand-stitched in full-grain leather/.test(await descText(page)),
       'the description reads in the shop\'s own words');
    is(!/crafted in leather/i.test(await descText(page)),
       'rather than the sentence this website used to make up out of the colour and the material');

    /* The details live inside a panel that starts shut. A visitor has to be
       able to open it, or none of the above is worth anything. */
    await page.click('#view-detail .acc-head');
    await page.waitForTimeout(350);
    is(await page.evaluate(() => {
      const b = document.querySelector('#view-detail .acc-body');
      return !!b && b.getBoundingClientRect().height > 0;
    }), 'and the panel holding them opens when it is pressed');

    /* ================================================================== */
    console.log('\nA piece with none of it filled in');
    await page.goto(base + '/product/AC-HESU-BR-L', { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);

    const plain = await specRows(page);
    is(plain.length > 0 && plain.every(r => r[0].trim() && r[1].trim()),
       'still draws its table, with no blank rows where the details would be');
    is(!plain.some(r => r[0].trim() === 'Brand'),
       'no empty Brand row for a piece with no brand');
    is(!plain.some(r => SATCHEL_DETAILS.some(d => d.label === r[0].trim())),
       'and none of the fifteen, because none of them were answered');
    is(/suede/i.test(await descText(page)),
       'and it falls back to the made-up sentence, which is what it is for');

    /* ================================================================== */
    console.log('\nThe quick view, and the search box');
    await page.goto(base + '/shop', { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);

    const opened = await page.evaluate(() => {
      const card = Array.from(document.querySelectorAll('#grid .card'))
        .find(c => (c.textContent || '').indexOf('Kudu Leather Satchel') > -1);
      const btn = card && card.querySelector('button.quick');
      if (!btn) return null;
      btn.click();
      return new Promise(r => setTimeout(() => {
        const b = document.querySelector('#qvBody');
        r(b ? (b.textContent || '').replace(/\s+/g, ' ').trim() : '');
      }, 400));
    });
    is(opened !== null, 'the card offers a quick view');
    is(typeof opened === 'string' && /Brand: ?Vaultique Atelier/.test(opened),
       'and it names the maker', String(opened).slice(0, 200));
    /* The glance stays a glance. Putting fifteen rows in a panel meant for
       deciding whether to open the piece properly would be the same mistake
       in the other direction. */
    is(typeof opened === 'string' && opened.indexOf('Single Package Size') === -1,
       'without the fifteen, which belong on the full page one button away');

    await page.keyboard.press('Escape').catch(() => {});
    await page.evaluate(() => {
      const c = document.querySelector('#qv .qv-close');
      if (c) c.click();
    });
    await page.waitForTimeout(300);

    const found = await page.evaluate(() => {
      const box = document.querySelector('#shopSearch');
      if (!box) return null;
      box.value = 'Vaultique Atelier';
      box.dispatchEvent(new Event('input', { bubbles: true }));
      /* Scoped to the shop's own grid. The home page's rows are still in the
         document with their display turned off, and counting those would
         have made this pass whatever the search did. */
      return new Promise(r => setTimeout(() => r(
        Array.from(document.querySelectorAll('#grid .card'))
          .map(c => (c.textContent || '').replace(/\s+/g, ' ').trim())
      ), 500));
    });
    is(found !== null, 'the shop has a search box');
    is(Array.isArray(found) && found.length === 1 &&
       found[0].indexOf('Kudu Leather Satchel') > -1,
       'and searching the maker\'s name brings back that maker\'s piece, and only it',
       JSON.stringify(found));

  } finally {
    await browser.close();
    server.close();
  }

  console.log('\n' + (failures
    ? 'product details in the browser: ' + failures + ' of ' + checks + ' checks FAILED'
    : 'product details in the browser: all ' + checks + ' checks passed'));
  process.exit(failures ? 1 : 0);
})();
