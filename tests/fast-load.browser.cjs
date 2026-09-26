/* ===========================================================================
   FAST FIRST PAINT -- driven in a real browser

   THE SHOP OWNER: "the website loads slowly, images, including hero, load
   so late. I want it instant."

   Three causes, three checks:
     1. The settings (where the hero photo is named) were only asked for
        after the catalogue answered. Now both are asked for together, and
        the hero is painted the moment its row arrives.
     2. On a return visit the hero photo is asked for from the page's
        <head>, before any script has run.
     3. Photos went up at full phone size. The admin now shrinks them.
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
  name: 'Piece', sku: '', category: 'Bags', price: 500, size: '', color: '',
  material: '', available: true, lowStock: false, wasPrice: 0, brand: '',
  description: '', details: [], variantGroup: ''
}, over);

const CATALOGUE = [
  P({ name: 'Kudu Leather Satchel', sku: 'BG-KULE-BR-OS', category: 'Bags' }),
  P({ name: 'Kitenge Wrap Dress', sku: 'WF-KIWR-BK-S', category: "Women's Fashion" })
];

const HERO = '/storage/v1/object/public/product-images/homepage/hero-1.png';
const HOMEPAGE = {};                  // filled in once the port is known
let FEED_DELAY = 1500;                // a slow catalogue, as on mobile data
const LOG = [];                       // [when, path] of every request the page made
let T0 = 0;

/* One real pixel, so the browser's Image() genuinely loads it. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');

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
      const u = new URL(req.url, 'http://x');
      const p = u.pathname;
      LOG.push([Date.now() - T0, p + (u.searchParams.get('key') ? '?' + u.searchParams.get('key') : '')]);
      if (p === '/api/products') { setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({
          products: CATALOGUE, count: CATALOGUE.length,
          generatedAt: new Date().toISOString(),
          version: crypto.createHash('sha1').update(JSON.stringify(CATALOGUE)).digest('hex').slice(0, 12)
        }));
        }, FEED_DELAY);
        return;
      }
      if (p === HERO) { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(PNG); return; }
      if (p === '/rest/v1/site_settings' && u.searchParams.get('key') === 'eq.homepage') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([{ data: HOMEPAGE }]));
        return;
      }
      if (p.indexOf('/rest/v1/') === 0) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('[]'); return; }
      if (p === '/config.js') {
        /* The admin IS connected, and LOCAL_IMAGES is left unset: the
           arrangement every real shop runs, and the one the bug lived in. */
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

(async () => {
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port;
  HOMEPAGE.heroImage1 = base + HERO;
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('\nFirst visit: the catalogue takes 1.5 seconds to answer');
    T0 = Date.now(); LOG.length = 0;
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
      const e = document.getElementById('heroPhoto1');
      return e && e.style.backgroundImage.indexOf('hero-1.png') !== -1;
    }, null, { timeout: 5000 });
    const heroAt = Date.now() - T0;
    const feedAsked = (LOG.find(l => l[1] === '/api/products') || [0])[0];
    const homeAsked = (LOG.find(l => l[1] === '/rest/v1/site_settings?eq.homepage') || [99999])[0];
    is(homeAsked < feedAsked + FEED_DELAY - 200,
       'the settings are asked for while the catalogue is still on its way, not after it',
       'feed asked at ' + feedAsked + 'ms, homepage settings at ' + homeAsked + 'ms');
    is(heroAt < feedAsked + FEED_DELAY,
       'the hero photo is on the page before the catalogue has even answered',
       'hero at ' + heroAt + 'ms, feed answers at ~' + (feedAsked + FEED_DELAY) + 'ms');
    await page.waitForSelector('.pcard, .p-card, .card', { timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(300);
    const memo = await page.evaluate(() => localStorage.getItem('vbp_hero'));
    is(!!memo && memo.indexOf('hero-1.png') !== -1, 'and the browser remembers which photo it was', memo);

    console.log('\nSecond visit: app.js held back for 2 seconds');
    await page.route('**/assets/app.js', async route => {
      await new Promise(r => setTimeout(r, 2000));
      route.continue().catch(() => {});   // the page may have moved on
    });
    T0 = Date.now(); LOG.length = 0;
    await page.goto(base + '/', { waitUntil: 'commit' });
    await page.waitForFunction(() => {
      const e = document.getElementById('heroPhoto1');
      return e && e.style.backgroundImage.indexOf('hero-1.png') !== -1;
    }, null, { timeout: 1500 }).then(() => ok('the hero is set from the page itself, before the shop\'s script has loaded'),
                                      e => fail('the hero is set from the page itself, before the shop\'s script has loaded', String(e)));
    const early = await page.evaluate(() => {
      const l = document.querySelector('link[rel="preload"][as="image"]');
      return l ? { href: l.href, pr: l.getAttribute('fetchpriority') } : null;
    });
    is(!!early && early.href.indexOf('hero-1.png') !== -1 && early.pr === 'high',
       'and the photo is asked for from the <head>, at high priority', JSON.stringify(early));
    const photoAt = (LOG.find(l => l[1] === HERO) || [99999])[0];
    is(photoAt < 1500, 'the photo is requested while the shop\'s script is still held back',
       'photo requested at ' + photoAt + 'ms; app.js is released at 2000ms');
    await page.unroute('**/assets/app.js');

    console.log('\nA remembered address that is not the shop\'s is ignored');
    const other = await browser.newContext();
    const p2 = await other.newPage();
    await p2.addInitScript(() => localStorage.setItem('vbp_hero', JSON.stringify(['https://evil.example/x.jpg'])));
    await p2.route('**/assets/app.js', route => route.abort());
    await p2.goto(base + '/', { waitUntil: 'domcontentloaded' });
    const bad = await p2.evaluate(() => ({
      bg: document.getElementById('heroPhoto1').style.backgroundImage,
      pre: !!document.querySelector('link[rel="preload"][as="image"]')
    }));
    is(!bad.bg && !bad.pre, 'nothing is fetched from somewhere else', JSON.stringify(bad));
    await other.close();

    console.log('\nThe admin shrinks photos before they are uploaded');
    await page.route(/^https:\/\//, route => route.fulfill({ status: 200, body: '' }));
    await page.goto(base + '/admin.html', { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForFunction(() => !!window.VBP_SHRINK, null, { timeout: 5000 });
    const r = await page.evaluate(async () => {
      function make(w, h, type, see) {
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const x = c.getContext('2d');
        const d = x.createImageData(w, h);
        for (let i = 0; i < d.data.length; i += 4) {
          d.data[i] = (i * 7) & 255; d.data[i + 1] = (i * 13) & 255; d.data[i + 2] = (i * 3) & 255;
          d.data[i + 3] = see && i < 4000 ? 0 : 255;
        }
        x.putImageData(d, 0, 0);
        return new Promise(res => c.toBlob(res, type, 1));
      }
      const size = b => new Promise(res => { const u = URL.createObjectURL(b); const im = new Image();
        im.onload = () => res([im.naturalWidth, im.naturalHeight]); im.src = u; });
      const out = {};
      const phone = await make(4000, 3000, 'image/jpeg');
      const small = await window.VBP_SHRINK.shrink(phone);
      out.phone = { before: phone.size, after: small && small.size, type: small && small.type,
                    dims: small ? await size(small) : null };
      out.again = await window.VBP_SHRINK.shrink(small);
      const logo = await make(2400, 1200, 'image/png', true);
      out.logo = await window.VBP_SHRINK.shrink(logo);
      const tiny = await make(300, 200, 'image/jpeg');
      out.tiny = { size: tiny.size, r: await window.VBP_SHRINK.shrink(tiny) };
      out.gif = await window.VBP_SHRINK.shrink(new Blob(['x'], { type: 'image/gif' }));
      return out;
    });
    is(r.phone.after && r.phone.after < r.phone.before && r.phone.type === 'image/jpeg',
       'a full-size phone photo comes out smaller, as a JPEG',
       JSON.stringify(r.phone));
    is(r.phone.dims && r.phone.dims[0] === 1800 && r.phone.dims[1] === 1350,
       'at 1800 pixels on its long side, the same shape', JSON.stringify(r.phone.dims));
    is(r.again === null, 'a photo already shrunk is not shrunk twice');
    is(r.logo === null, 'a PNG with see-through parts (a logo) is left exactly as it was');
    is(r.tiny.r === null, 'a photo already small is left alone', JSON.stringify(r.tiny));
    is(r.gif === null, 'and a GIF is left alone');

    console.log('\nShrinking the photos already uploaded, against a stand-in store');
    await page.waitForFunction(() => window.VBP_ADMIN && window.VBP_ADMIN.shrinkStoredPhotos, null, { timeout: 5000 });
    const st = await page.evaluate(async () => {
      function make(w, h, type) {
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const x = c.getContext('2d'); const d = x.createImageData(w, h);
        for (let i = 0; i < d.data.length; i += 4) { d.data[i] = (i * 7) & 255; d.data[i + 1] = (i * 13) & 255; d.data[i + 2] = 90; d.data[i + 3] = 255; }
        x.putImageData(d, 0, 0);
        return new Promise(res => c.toBlob(res, type, 1));
      }
      const big = await make(3000, 2000, 'image/jpeg');
      const files = {
        'homepage/hero-1.jpg': big,
        'SKU1/main-1.jpg': big,
        'branding/logo.svg': new Blob(['<svg/>'], { type: 'image/svg+xml' }),
        'SKU1/small.jpg': await make(200, 200, 'image/jpeg')
      };
      const writes = [];
      const store = {
        list(prefix) {
          const names = {};
          Object.keys(files).forEach(k => {
            if (prefix && k.indexOf(prefix + '/') !== 0) return;
            const rest = prefix ? k.slice(prefix.length + 1) : k;
            const i = rest.indexOf('/');
            if (i > -1) names[rest.slice(0, i)] = { name: rest.slice(0, i), id: null };
            else names[rest] = { name: rest, id: 'x', metadata: { size: files[k].size, mimetype: files[k].type } };
          });
          return Promise.resolve({ data: Object.values(names), error: null });
        },
        download(p) { return Promise.resolve({ data: files[p], error: null }); },
        upload(p, b, o) { writes.push({ p, size: b.size, o }); files[p] = b; return Promise.resolve({ error: null }); }
      };
      const ctx = { sb: { storage: { from: () => store } }, cfg: {} };
      const steps = [];
      const t = await window.VBP_ADMIN.shrinkStoredPhotos(ctx, (n, of) => steps.push(n + '/' + of));
      return { t, writes, steps, bigSize: big.size };
    });
    is(st.t.looked === 2 && st.t.done === 2 && st.t.failed === 0,
       'the two large photos are found, in folders as well as at the top', JSON.stringify(st.t));
    is(st.writes.map(w => w.p).sort().join() === 'SKU1/main-1.jpg,homepage/hero-1.jpg',
       'each is written back at the very same address, and nothing else is touched', JSON.stringify(st.writes.map(w => w.p)));
    is(st.writes.every(w => w.size < st.bigSize && w.o.upsert === true && w.o.contentType === 'image/jpeg'),
       'smaller than before, replacing the original', JSON.stringify(st.writes));
    is(st.steps.join() === '1/2,2/2', 'and progress is reported as it goes', st.steps.join());

    console.log('\nClearing chat photos, against a stand-in store');
    const cp = await page.evaluate(async () => {
      const day = 86400000, now = Date.now();
      const files = {
        'conv-live/old.jpg':   { size: 300000, at: new Date(now - 200 * day).toISOString() },
        'conv-live/new.jpg':   { size: 250000, at: new Date(now - 5 * day).toISOString() },
        'conv-gone/any.jpg':   { size: 100000, at: new Date(now - 1 * day).toISOString() }
      };
      for (let i = 0; i < 1005; i++) files['conv-many/p' + String(i).padStart(4, '0') + '.jpg'] =
        { size: 1000, at: new Date(now - 400 * day).toISOString() };
      const removed = [];
      const store = {
        list(prefix, o) {
          const names = {};
          Object.keys(files).sort().forEach(k => {
            if (prefix && k.indexOf(prefix + '/') !== 0) return;
            const rest = prefix ? k.slice(prefix.length + 1) : k;
            const i = rest.indexOf('/');
            if (i > -1) names[rest.slice(0, i)] = { name: rest.slice(0, i), id: null };
            else names[rest] = { name: rest, id: 'x', created_at: files[k].at, metadata: { size: files[k].size, mimetype: 'image/jpeg' } };
          });
          const all = Object.values(names);
          return Promise.resolve({ data: all.slice(o.offset || 0, (o.offset || 0) + o.limit), error: null });
        },
        remove(paths) { paths.forEach(p => { removed.push(p); delete files[p]; }); return Promise.resolve({ error: null }); }
      };
      const ctx = { sb: {
        storage: { from: () => store },
        from: () => ({ select: () => Promise.resolve({ data: [{ id: 'conv-live' }, { id: 'conv-many' }], error: null }) })
      } };
      const T = window.VBP_ADMIN.chatPhotoTools;
      const rep = await T.report(ctx);
      const pick = T.pick(rep, 90).map(f => f.path);
      const n = await T.clear(ctx, T.pick(rep, 90));
      return { total: rep.files.length, pick, n, left: Object.keys(files) };
    });
    is(cp.total === 1008, 'every chat photo is counted, past the first thousand in a folder', String(cp.total));
    is(cp.pick.indexOf('conv-live/old.jpg') > -1 && cp.pick.indexOf('conv-live/new.jpg') === -1,
       'older than three months goes, last week\'s stays');
    is(cp.pick.indexOf('conv-gone/any.jpg') > -1, 'a photo left behind by a deleted conversation goes, whatever its age');
    is(cp.n === 1007 && cp.left.join() === 'conv-live/new.jpg', 'and they are deleted, in batches',
       cp.n + ' / ' + cp.left.join());
  } catch (e) {
    fail('threw: ' + (e && e.message || e));
  } finally {
    await browser.close();
    server.close();
  }

  console.log('\n' + (failures ? '  ✗ ' + failures + ' of ' + checks + ' checks FAILED'
                                : '  fast first paint: all ' + checks + ' checks passed'));
  process.exit(failures ? 1 : 0);
})();
