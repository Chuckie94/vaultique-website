/* ===========================================================================
   THE WHOLE CHAIN, END TO END

   The two other analytics tests each prove one half. This one joins them, and
   it is the only check that can catch the mistake neither of them can see: a
   field the browser calls one thing and the database calls another. Both halves
   pass on their own with that mistake in place, and every visit is refused in
   production.

   WHAT IT ACTUALLY DOES.
     1. Serves the real storefront and drives it in a real browser.
     2. Takes the request bodies the page ACTUALLY SENT — not a fixture, not a
        hand-written row — and replays them into a real Postgres.
     3. Replays them as `anon`, the storefront's own role, through the real
        insert policy from supabase-analytics.sql.
     4. Reads them back through site_stats() as an administrator, which is the
        function the Admin > Website Analytics page calls and nothing else.

   IT NEEDS A DATABASE, and skips itself politely when there is not one:

     createdb vq_roundtrip
     psql -d vq_roundtrip -f tests/analytics-fixture.sql -f supabase-analytics.sql
     VBP_TEST_DB="postgresql://localhost/vq_roundtrip" node tests/analytics.roundtrip.cjs
   =========================================================================== */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DB = process.env.VBP_TEST_DB || '';

let checks = 0, failures = 0;
const ok   = m => { checks++; console.log('  ✓ ' + m); };
const fail = m => { checks++; failures++; console.log('  ✗ ' + m); };
const is   = (c, m) => c ? ok(m) : fail(m);

if (!DB) {
  console.log('\nround trip: skipped — set VBP_TEST_DB to a scratch database to run it');
  console.log('  (see the note at the top of this file for the three commands)');
  process.exit(0);
}

const CATALOGUE = [
  { name: 'Silk Wrap Dress', sku: 'VB-DRS-001', category: 'Dresses', price: 1850,
    size: 'M', color: 'Emerald', material: 'Silk', available: true, lowStock: false, wasPrice: 0 }
];
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/json'
};
const REAL_DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/141.0.0.0 Safari/537.36';

let SENT = [];      // exactly what the page posted to site_events
let BEATS = [];

const readBody = req => new Promise(resolve => {
  let d = ''; req.on('data', c => { d += c; }); req.on('end', () => resolve(d));
});

function serve() {
  return new Promise(resolve => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://x');
      const p = url.pathname;
      if (p === '/api/products') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ products: CATALOGUE, count: 1, version: 't' }));
        return;
      }
      if (p.indexOf('/rest/v1/') === 0) {
        const sent = await readBody(req);
        if (p === '/rest/v1/site_events' && req.method === 'POST') {
          try { SENT = SENT.concat(JSON.parse(sent)); } catch (e) {}
          res.writeHead(201); res.end(''); return;
        }
        if (p === '/rest/v1/rpc/site_beat' && req.method === 'POST') {
          try { BEATS.push(JSON.parse(sent)); } catch (e) {}
          res.writeHead(204); res.end(); return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('[]'); return;
      }
      if (p === '/config.js') {
        res.writeHead(200, { 'Content-Type': TYPES['.js'] });
        res.end('window.VBP_CONFIG={SUPABASE_URL:"http://127.0.0.1:' +
                server.address().port + '",SUPABASE_ANON_KEY:"test-anon-key"};');
        return;
      }
      let file = path.join(ROOT, p);
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, 'index.html');
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      res.end(fs.readFileSync(file));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function psql(sql) {
  const file = path.join(os.tmpdir(), 'vbp-roundtrip-' + process.pid + '.sql');
  fs.writeFileSync(file, sql);
  try {
    return execFileSync('psql', [DB, '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-f', file],
                        { encoding: 'utf8' }).trim();
  } finally { fs.unlinkSync(file); }
}

/* A row, written the way PostgREST would write it — every key the browser sent
   and not one this file added. */
function insertFor(row) {
  const cols = Object.keys(row);
  const lit = v => v === null || v === undefined ? 'null'
             : typeof v === 'boolean' ? (v ? 'true' : 'false')
             : "'" + String(v).replace(/'/g, "''") + "'";
  return 'insert into public.site_events (' + cols.join(', ') + ') values (' +
         cols.map(c => lit(row[c])).join(', ') + ');';
}

(async () => {
  const { chromium } = require('playwright');
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();

  try {
    console.log('\nA real browser walks through the shop');
    const ctx = await browser.newContext({ userAgent: REAL_DESKTOP });
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });
    const page = await ctx.newPage();
    await page.goto(base + '/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    await page.goto(base + '/shop', { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    await page.click('#grid .card .thumb');
    await page.waitForTimeout(900);
    await page.click('#view-detail [data-cart-sku]');
    await page.waitForTimeout(900);
    await ctx.close();

    is(SENT.length >= 4, 'the walk produced ' + SENT.length + ' events to replay');
    is(BEATS.length >= 1, 'and at least one heartbeat');
  } finally {
    await browser.close();
    server.close();
  }

  console.log('\nEvery one of them is accepted by the real insert policy, as anon');
  const before = Number(psql('select count(*) from public.site_events;'));
  let landed = 0, refused = [];
  SENT.forEach((row, i) => {
    try {
      psql('set role anon;\n' + insertFor(row) + '\nreset role;');
      landed++;
    } catch (e) {
      refused.push('#' + i + ' ' + row.kind + ': ' +
                   String(e.stderr || e.message).split('\n').find(l => /ERROR/.test(l)) || '');
    }
  });
  is(refused.length === 0,
     'not one row is refused by the database' + (refused.length ? '\n      ' + refused.join('\n      ') : ''));
  is(Number(psql('select count(*) from public.site_events;')) === before + landed,
     'and all ' + landed + ' are on file');

  console.log('\nAnd the admin reads back what the visitor actually did');
  psql("delete from auth.whoami; insert into auth.whoami values ('22222222-2222-2222-2222-222222222222');");
  const today = psql("select (now() at time zone 'UTC')::date;");
  const stats = JSON.parse(psql(
    "select public.site_stats('" + today + "'::date, '" + today + "'::date, 'UTC');"));

  is(stats.visits === 1, 'one visit, because it was one person in one sitting');
  is(stats.visitors === 1, 'one unique visitor');
  is(stats.page_views === 3, 'three page views — home, shop, and the piece');
  is(stats.product_views === 1, 'one product view');
  is(stats.add_to_cart === 1, 'one add to cart');
  is(stats.new_visitors === 1, 'counted as somebody new, which is what they were');
  is(stats.desktop === 1 && stats.mobile === 0, 'on a desktop');

  const pages = JSON.parse(psql(
    "select public.site_top_pages('" + today + "'::date, '" + today + "'::date, 'UTC', 10);"));
  is(pages.length === 3, 'three pages in the most-viewed list');
  is(pages.some(x => x.path === '/shop'), 'including the shop page');

  const prods = JSON.parse(psql(
    "select public.site_top_products('" + today + "'::date, '" + today + "'::date, 'UTC', 10);"));
  is(prods.length === 1 && prods[0].sku === 'VB-DRS-001',
     'and the piece that was opened, by the sku the storefront sent');
  is(prods[0].label === 'Silk Wrap Dress', 'under the name the shop gave it');
  is(prods[0].carts === 1, 'showing that it was also put in a cart');

  console.log('\nThe heartbeat reaches the live count the same way');
  psql("delete from auth.whoami;\nset role anon;\nselect public.site_beat('" +
       String(BEATS[0].p_session).replace(/'/g, "''") + "', '" +
       String(BEATS[0].p_device || '').replace(/'/g, "''") + "');\nreset role;");
  psql("insert into auth.whoami values ('22222222-2222-2222-2222-222222222222');");
  is(Number(psql('select public.site_live();')) === 1,
     'the visit the browser actually opened shows as one person here now');

  console.log(failures ? ('\n' + checks + ' checks, ' + failures + ' failed')
                       : ('\nround trip: all ' + checks + ' checks passed'));
  process.exit(failures ? 1 : 0);
})();
