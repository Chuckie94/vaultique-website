/* ===========================================================================
   THE OLD ICON IS NEVER SHOWN — driven in a real browser, and on the server

   THE COMPLAINT THIS ANSWERS: "the website used to load with the old icon
   first before showing the uploaded one. I just don't want loading and
   displaying old icons."

   WHY logo-first-paint.browser.cjs DID NOT ALREADY COVER IT. That file proves
   the shop's logo is applied before the catalogue arrives, which was the
   original defect and is genuinely fixed. But applying it early is not the
   same as never applying it: index.html used to carry <img src="/images/
   logo.png">, so the browser fetched and painted that file while parsing,
   before any script ran at all. The wait got shorter. The wrong picture was
   still shown.

   So this file asks a different question. Not "how soon was it right" but
   "was it ever wrong" — every value the four marks ever hold, from the first
   frame to the last, collected and checked.

   AND THE HALF NO BROWSER CAN SEE. og:image was a fixed address in the HTML.
   seo.js sets it properly, but in JavaScript, and the things that build a
   link preview do not run JavaScript — so every link this shop shared showed
   the built-in logo for ever, with no swap a moment later because nothing
   runs. The last sections here read the HTML exactly as a scraper gets it and
   drive the redirect that answers it.
   =========================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const SHIPPED_LOGO = '/images/logo.png';
const SHIPPED_ICON = '/images/logo-sm.png';
const UPLOADED = 'https://abcdefghijkl.supabase.co/storage/v1/object/public/branding/logo-main.png';
const UPLOADED_ICON = 'https://abcdefghijkl.supabase.co/storage/v1/object/public/branding/favicon.png';
const UPLOADED_APP = 'https://abcdefghijkl.supabase.co/storage/v1/object/public/branding/app-icon.png';
const UPLOADED_SOCIAL = 'https://abcdefghijkl.supabase.co/storage/v1/object/public/branding/social.png';

let checks = 0, failures = 0;
const ok   = m => { checks++; console.log('  ✓ ' + m); };
const fail = (m, extra) => { checks++; failures++; console.log('  ✗ ' + m + (extra ? '\n      ' + extra : '')); };
const is   = (c, m, extra) => c ? ok(m) : fail(m, extra);
const hdr  = t => console.log('\n' + t);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/json'
};

let BRANDING = {};

let PORT = 0;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  if (p === '/api/products') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ products: [], count: 0 }));
  }
  /* The branding row, answered the way Supabase answers it. */
  if (p.indexOf('/rest/v1/') === 0) {
    const isBranding = url.search.indexOf('key=eq.branding') > -1;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(isBranding ? JSON.stringify([{ data: BRANDING }]) : '[]');
  }
  if (p === '/config.js') {
    res.writeHead(200, { 'Content-Type': TYPES['.js'] });
    return res.end('window.VBP_CONFIG={SUPABASE_URL:"http://127.0.0.1:' + PORT +
                   '",SUPABASE_ANON_KEY:"test-anon-key"};');
  }
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404); return res.end('x');
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

/* Watches every src and every icon href the page ever sets, from before the
   body is parsed. What it collects is the whole history, not the end state --
   the end state was always right, and that was the problem. */
const WATCH = `
window.__seen = { src: [], icon: [] };
new MutationObserver(function (recs) {
  recs.forEach(function (r) {
    var el = r.target;
    if (r.attributeName === 'src' && el.className) {
      window.__seen.src.push(String(el.className) + ' ' + (el.getAttribute('src') || ''));
    }
    if (r.attributeName === 'href' && el.rel === 'icon') {
      window.__seen.icon.push(el.getAttribute('href') || '');
    }
  });
}).observe(document, { attributes: true, subtree: true, attributeFilter: ['src', 'href'] });

window.supabase = { createClient: function () { return {
  channel: function () { var ch = { on: function () { return ch; },
    subscribe: function (cb) { if (cb) setTimeout(function () { cb('SUBSCRIBED'); }, 0); return ch; } };
    return ch; },
  removeChannel: function () {}
}; } };
`;

async function visit(browser, opts) {
  opts = opts || {};
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  BRANDING = opts.branding || BRANDING;
  await page.addInitScript(WATCH);
  if (opts.cache) {
    await page.addInitScript('try{localStorage.setItem("vbp_marks",' +
      JSON.stringify(JSON.stringify(opts.cache)) + ');}catch(e){}');
  }
  await page.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: '/*x*/' }));
  await page.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('**/*.supabase.co/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: '' }));
  await page.goto(opts.base + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  const seen = await page.evaluate(() => window.__seen);
  const now = await page.evaluate(() => ({
    main: (document.querySelector('.brand-logo') || {}).getAttribute
            ? document.querySelector('.brand-logo').getAttribute('src') : null,
    mobile: document.querySelector('.mm-logo') &&
            document.querySelector('.mm-logo').getAttribute('src'),
    footer: document.querySelector('.foot-logo') &&
            document.querySelector('.foot-logo').getAttribute('src'),
    icon: document.querySelector('link[rel="icon"]') &&
          document.querySelector('link[rel="icon"]').getAttribute('href'),
    cache: (function () { try { return localStorage.getItem('vbp_marks'); } catch (e) { return null; } }())
  }));
  await page.close();
  return { seen, now, errors };
}

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  PORT = server.address().port;
  const base = 'http://127.0.0.1:' + PORT;
  const browser = await chromium.launch({ args: ['--no-sandbox'] });

  // =========================================================== a returning visitor
  hdr('Somebody who has been here before never sees the old mark');
  BRANDING = { logoMain: UPLOADED, logoMobile: UPLOADED, logoFooter: UPLOADED,
               favicon: UPLOADED_ICON, primaryColour: '#123456' };
  let r = await visit(browser, { base, cache: {
    main: UPLOADED, mobile: UPLOADED, footer: UPLOADED, favicon: UPLOADED_ICON } });

  const everySrc = r.seen.src.join(' | ');
  is(r.seen.src.length > 0, 'the marks were set at all', everySrc);
  is(everySrc.indexOf(SHIPPED_LOGO) === -1,
     'the shipped logo is never once the src of any mark', everySrc);
  is(r.seen.icon.join(' | ').indexOf(SHIPPED_ICON) === -1,
     'and the shipped tab icon is never once set',
     r.seen.icon.join(' | '));
  is(r.now.main === UPLOADED, 'the header carries the shop\'s own logo', r.now.main);
  is(r.now.mobile === UPLOADED, 'so does the mobile menu', r.now.mobile);
  is(r.now.footer === UPLOADED, 'so does the footer', r.now.footer);
  is(r.now.icon === UPLOADED_ICON, 'and the tab icon', r.now.icon);
  is(r.errors.length === 0, 'and nothing threw', r.errors.join(' | '));

  // ============================================================ the first visit
  hdr('Somebody here for the first time gets the shipped mark, and is remembered');
  r = await visit(browser, { base });
  is(r.now.main === UPLOADED,
     'the shop\'s logo is up by the end, as it always was', r.now.main);
  is(!!r.now.cache, 'and what was used is remembered for next time', String(r.now.cache));
  let remembered = {};
  try { remembered = JSON.parse(r.now.cache || '{}'); } catch (e) {}
  is(remembered.main === UPLOADED, 'the header logo is in it', remembered.main);
  is(remembered.favicon === UPLOADED_ICON, 'and the tab icon', remembered.favicon);
  is(r.errors.length === 0, 'and nothing threw', r.errors.join(' | '));

  // ================================================= a shop that uploaded nothing
  hdr('A shop that has uploaded nothing is exactly where it was');
  r = await visit(browser, { base, branding: { primaryColour: '#123456' } });
  is(r.now.main === SHIPPED_LOGO, 'the shipped logo is shown', r.now.main);
  is(r.now.icon === SHIPPED_ICON, 'and the shipped tab icon', r.now.icon);
  is(!r.now.cache, 'and nothing is remembered, because there is nothing to remember',
     String(r.now.cache));
  is(r.errors.length === 0, 'and nothing threw', r.errors.join(' | '));

  // ============================================================ a poisoned cache
  hdr('A cache that has been tampered with is ignored, not obeyed');
  r = await visit(browser, { base, cache: {
    main: 'https://not-the-shop.example/evil.png',
    mobile: 'javascript:alert(1)',
    footer: '//elsewhere.example/x.png',
    favicon: 'http://plain-http.example/i.png' } });
  const early = r.seen.src.join(' | ');
  is(early.indexOf('not-the-shop') === -1, 'an address on somebody else\'s server is refused', early);
  is(early.indexOf('javascript:') === -1, 'and so is a script pretending to be a picture', early);
  is(early.indexOf('//elsewhere') === -1, 'and a protocol-relative address', early);
  is(r.errors.length === 0, 'and nothing threw', r.errors.join(' | '));

  await browser.close();

  // ================================================== what a scraper actually sees
  hdr('What WhatsApp reads — the HTML as served, with no JavaScript at all');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const og = /<meta property="og:image" content="([^"]+)"/.exec(html);
  const tw = /<meta name="twitter:image" content="([^"]+)"/.exec(html);
  is(!!og && /\/social-image$/.test(og[1]),
     'og:image names the address that answers with the shop\'s own picture', og && og[1]);
  is(!!tw && /\/social-image$/.test(tw[1]),
     'and so does twitter:image', tw && tw[1]);
  is(!/<meta property="og:image" content="[^"]*\/images\/logo\.png"/.test(html),
     'and neither is hard-coded to the file the site was built with');
  const bodyOnly = html.slice(html.indexOf('</head>'));
  is(bodyOnly.indexOf('src="' + SHIPPED_LOGO + '"') === -1,
     'no mark in the body ships with an address for the browser to paint first');

  // ============================================================ the redirect itself
  hdr('And the address it names');
  const fn = require(path.join(ROOT, 'netlify/functions/social-image.js'));
  const seo = path.join(ROOT, 'netlify/functions/_seo-data.js');
  const realSettings = require(seo).settings;

  async function ask(branding, throws) {
    require(seo).settings = async () => { if (throws) throw new Error('down'); return branding; };
    delete require.cache[require.resolve(path.join(ROOT, 'netlify/functions/social-image.js'))];
    const f = require(path.join(ROOT, 'netlify/functions/social-image.js'));
    const out = await f.handler({ headers: { host: 'vaultiqueboutique.com' } });
    return out;
  }

  let out = await ask({ socialImage: UPLOADED_SOCIAL, logoMain: UPLOADED });
  is(out.statusCode === 302, 'it is a redirect, which a scraper follows', String(out.statusCode));
  is(out.headers.Location === UPLOADED_SOCIAL,
     'to the picture the shop chose for sharing', out.headers.Location);

  out = await ask({ logoMain: UPLOADED });
  is(out.headers.Location === UPLOADED,
     'or to its logo, when it has chosen no sharing picture', out.headers.Location);

  out = await ask({});
  is(/\/images\/logo\.png$/.test(out.headers.Location),
     'and to the shipped mark when it has uploaded neither', out.headers.Location);

  out = await ask({}, true);
  is(/\/images\/logo\.png$/.test(out.headers.Location),
     'a database that cannot be reached still gets a picture, not an error',
     out.headers.Location);

  out = await ask({ socialImage: 'https://not-the-shop.example/evil.png' });
  is(out.headers.Location.indexOf('not-the-shop') === -1,
     'and an address on somebody else\'s server is refused', out.headers.Location);
  require(seo).settings = realSettings;

  // ================================================================= the app icon
  hdr('The app icon follows the shop again, without the bug that removed it');
  const man = path.join(ROOT, 'netlify/functions/manifest.js');
  async function manifest(branding) {
    require(seo).settings = async (k) => (k === 'branding' ? branding : { shopName: 'Vaultique' });
    delete require.cache[require.resolve(man)];
    const f = require(man);
    return JSON.parse((await f.handler()).body);
  }

  let m = await manifest({ appIcon: UPLOADED_APP });
  is(m.icons[0].src === UPLOADED_APP, 'the uploaded icon is offered first', m.icons[0].src);
  is(m.icons.filter(i => i.sizes === 'any').length === 0,
     'and nothing claims to be right at every size, which is what broke it before',
     JSON.stringify(m.icons.map(i => i.sizes)));
  is(m.icons[0].sizes === '192x192' && m.icons[1].sizes === '512x512',
     'it is declared at the two sizes a phone actually asks for',
     JSON.stringify(m.icons.slice(0, 2).map(i => i.sizes)));
  is(m.icons.some(i => i.src === '/images/icon-192.png') &&
     m.icons.some(i => i.purpose === 'maskable'),
     'and the shipped tiles are still behind it, maskable one included');
  is(m.shortcuts[0].icons[0].src === UPLOADED_APP,
     'the shortcuts use it too, rather than a different picture', m.shortcuts[0].icons[0].src);

  m = await manifest({});
  is(m.icons.length === 3 && m.icons[0].src === '/images/icon-192.png',
     'a shop that uploads nothing gets exactly the three tiles it had before',
     JSON.stringify(m.icons.map(i => i.src)));

  m = await manifest({ appIcon: 'https://not-the-shop.example/evil.png' });
  is(m.icons[0].src === '/images/icon-192.png',
     'and an icon from somebody else\'s server is refused', m.icons[0].src);
  require(seo).settings = realSettings;

  server.close();
  console.log('\n' + (failures
    ? 'no old icon: ' + failures + ' of ' + checks + ' checks FAILED'
    : 'no old icon: all ' + checks + ' checks passed'));
  process.exit(failures ? 1 : 0);
})().catch(e => {
  console.error('the checks themselves fell over:\n', e);
  process.exit(2);
});
