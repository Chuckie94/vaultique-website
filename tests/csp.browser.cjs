/* ===========================================================================
   THE SECURITY POLICY, SWITCHED ON -- driven in a real browser

   tools/build-site.cjs writes a Content Security Policy that goes out as
   report-only in build 75. This test builds the site the way Netlify does,
   then serves dist/ with that very policy ENFORCED, the safety headers from
   netlify.toml beside it, and opens the shop and the admin. If the policy
   were wrong about anything these pages do, the browser would block it
   here, and this test would say what.

   So it proves two things at once: that report-only mode will have nothing
   to report from these pages, and that switching the policy on later will
   not break them. It also proves the harness can see a violation at all,
   with a page made to commit one.

   The libraries are the real ones in assets/vendor/, not stand-ins, so the
   Supabase client and the map are held to the policy too. The fake Supabase
   answers on this test's own address, the way config.js would point at the
   real one; other sites (fonts, map tiles, product photos) are answered by
   the test after the browser has decided to allow them.
   =========================================================================== */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
let checks = 0, failures = 0;
const ok   = m => { checks++; console.log('  ✓ ' + m); };
const fail = (m, extra) => { checks++; failures++; console.log('  ✗ ' + m + (extra ? '\n      ' + extra : '')); };
const is   = (c, m, extra) => c ? ok(m) : fail(m, extra);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain',
};
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

const CATALOGUE = [
  { name: 'Silk Wrap Dress', sku: 'VB-DRS-001', category: 'Dresses', price: 1850, size: 'M', color: 'Emerald',
    material: 'Silk', available: true, lowStock: false, wasPrice: 0 },
  { name: 'Leather Tote', sku: 'VB-BAG-002', category: 'Bags', price: 2400, available: true, lowStock: false, wasPrice: 0 },
];
/* Photos and a video kept on other sites, the way product pictures can be. */
const META = [{ sku: 'VB-DRS-001', image_url: 'https://img.example.test/dress.jpg',
                gallery: ['https://img.example.test/dress-2.jpg'], videos: ['https://media.example.test/clip.mp4'] }];

/* Settings > General with two shops in it: the visit panel then draws its
   own map (Leaflet, with OpenStreetMap's tiles) instead of Google's frame. */
let GENERAL = null;
const TWO_SHOPS = { address: 'Cairo Road', city: 'Lusaka', country: 'Zambia', mapPoints: [
  { name: 'Lusaka', lat: -15.4167, lng: 28.2833, address: 'Cairo Road' },
  { name: 'Kitwe', lat: -12.8024, lng: 28.2132, address: 'Freedom Avenue' }] };

/* The owner, signed in: a session as supabase-js keeps it, so the admin
   opens on its own and every tab can be walked with the real library. */
const OWNER = '00000000-0000-0000-0000-0000000000a1';
const USER = { id: OWNER, aud: 'authenticated', role: 'authenticated', email: 'owner@shop.test',
               app_metadata: { provider: 'email' }, user_metadata: {}, factors: [], created_at: '2026-01-01T00:00:00Z' };
function session() {
  const now = Math.floor(Date.now() / 1000);
  const part = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = part({ alg: 'HS256', typ: 'JWT' }) + '.' + part({ sub: OWNER, email: USER.email, role: 'authenticated',
    aud: 'authenticated', aal: 'aal1', amr: [{ method: 'password', timestamp: now }], session_id: 's1', iat: now, exp: now + 3600 }) + '.c2ln';
  return JSON.stringify({ access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600,
                          refresh_token: 'refresh', user: USER });
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vbp-csp-'));
const SITE = path.join(TMP, 'site');
const DIST = path.join(SITE, 'dist');
let ENFORCED = '';
const REPORTS = [];
const ASKED = [];

function copy(from, to) {
  if (fs.statSync(from).isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const n of fs.readdirSync(from)) copy(path.join(from, n), path.join(to, n));
  } else { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); }
}

/* netlify.toml's safety headers, read from the file so that the test serves
   what the site will. */
function tomlSafety() {
  const toml = fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8');
  const block = toml.split(/\n\[\[headers\]\]\n/).slice(1).filter(b => /^\s*for\s*=\s*"\/\*"/m.test(b))[0] || '';
  const out = {};
  (block.split(/\n\[\[|\n# /)[0].match(/^\s{4}[A-Za-z-]+\s*=\s*".*"$/gm) || []).forEach(l => {
    const m = /^\s*([A-Za-z-]+)\s*=\s*"(.*)"$/.exec(l); out[m[1]] = m[2];
  });
  return out;
}
const SAFETY = tomlSafety();

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const send = (status, type, body, extra) => {
    ASKED.push({ path: p, search: url.search, status });
    res.writeHead(status, Object.assign({ 'Content-Type': type, 'Content-Security-Policy': ENFORCED }, SAFETY, extra || {}));
    res.end(body);
  };

  if (p === '/__csp') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => { REPORTS.push(body); res.writeHead(204); res.end(); });
    return;
  }
  if (p === '/__probe.html') {
    return send(200, TYPES['.html'], '<!doctype html><html><head><title>probe</title></head><body>' +
      '<script>window.__ran = true;</script><p id="p">probe</p></body></html>');
  }
  if (p === '/api/products' || p === '/.netlify/functions/products') {
    return send(200, 'application/json', JSON.stringify({ products: CATALOGUE, count: CATALOGUE.length,
      generatedAt: new Date().toISOString(), version: 'csp' }), { 'Cache-Control': 'no-store' });
  }
  if (p === '/rest/v1/rpc/my_access') {
    return send(200, 'application/json', JSON.stringify({ is_admin: true, is_owner: true, active: true, permissions: null }));
  }
  if (p.indexOf('/rest/v1/rpc/') === 0) return send(200, 'application/json', 'null');
  if (p === '/rest/v1/admins') return send(200, 'application/json', JSON.stringify([{ id: OWNER, role: 'owner', active: true }]));
  if (p.indexOf('/rest/v1/') === 0) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(201, 'application/json', '[]');
    if (p === '/rest/v1/product_meta') return send(200, 'application/json', JSON.stringify(META));
    if (p === '/rest/v1/site_settings' && GENERAL && /key=eq\.general/.test(url.search)) {
      return send(200, 'application/json', JSON.stringify([{ data: GENERAL }]));
    }
    return send(200, 'application/json', '[]');
  }
  if (p === '/auth/v1/user') return send(200, 'application/json', JSON.stringify(USER));
  if (p.indexOf('/auth/v1/token') === 0) return send(400, 'application/json', '{"message":"no refresh here"}');
  if (p.indexOf('/auth/v1/') === 0) return send(200, 'application/json', '{}');
  if (p.indexOf('/storage/v1/') === 0) return send(200, 'application/json', '[]');
  if (p.indexOf('/.netlify/functions/') === 0) return send(200, 'application/json', '{}');

  let file = path.join(DIST, decodeURIComponent(p === '/' ? '/index.html' : p));
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (/^\/(assets|images)\//.test(p) || /\.(js|css|png|jpg|svg|webp|json)$/.test(p)) return send(404, 'text/plain', 'not found');
    file = path.join(DIST, 'index.html');            // the catch-all, as on Netlify
  }
  send(200, TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', fs.readFileSync(file));
});

/* Other sites, answered only once the browser has decided the policy
   allows asking them at all. */
async function otherSites(ctx) {
  await ctx.route(u => !/^http:\/\/127\.0\.0\.1:/.test(String(u)), route => {
    const u = new URL(route.request().url());
    if (u.host === 'fonts.googleapis.com') return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    if (u.host === 'www.google.com' || u.host === 'maps.google.com') {
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>map</title><p>map</p>' });
    }
    if (/\.(png|jpe?g)$/.test(u.pathname)) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    if (/\.mp4$/.test(u.pathname)) return route.fulfill({ status: 200, contentType: 'video/mp4', body: '' });
    if (u.host === 'nominatim.openstreetmap.org') return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    return route.fulfill({ status: 404, body: '' });
  });
}

/* Everything the browser refuses is caught three ways: the page's own
   securitypolicyviolation event, the console, and the report the policy
   posts to /__csp. */
const WATCH = `
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', function (e) {
    window.__csp.push(e.effectiveDirective + ' ' + e.blockedURI + ' ' + (e.sourceFile || '') + ':' + e.lineNumber);
  });
`;

async function visit(browser, url, ready, label) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(WATCH);
  await otherSites(ctx);
  const page = await ctx.newPage();
  const consoleCsp = [], errors = [];
  page.on('console', m => { if (/Content Security Policy|Refused to/i.test(m.text())) consoleCsp.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e.message || e)));
  await page.goto(base + url, { waitUntil: 'domcontentloaded' });
  let readyOk = true;
  try { await page.waitForFunction(ready, null, { timeout: 15000 }); } catch (e) { readyOk = false; }
  await page.waitForTimeout(600);
  return { ctx, page, consoleCsp, errors, readyOk, label };
}

async function noViolations(v, extra) {
  const seen = await v.page.evaluate(() => window.__csp || []);
  const frames = [];
  /* A frame that has not loaded (the map is lazy until scrolled to) has
     nothing to say, and asking it would wait for ever: a second each. */
  for (const f of v.page.frames()) {
    if (f === v.page.mainFrame()) continue;
    const got = await Promise.race([
      f.evaluate(() => window.__csp || []).catch(() => null),
      new Promise(r => setTimeout(() => r(null), 1000)),
    ]);
    (got || []).forEach(x => frames.push(x));
  }
  const all = seen.concat(frames, v.consoleCsp);
  is(all.length === 0, v.label + ': nothing blocked' + (extra || ''), all.slice(0, 4).join(' | '));
  is(v.errors.length === 0, v.label + ': no script errors', v.errors.slice(0, 3).join(' | '));
}

let base = '';
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;

  /* The repository as the shop has it, with a config.js pointing at this
     test's own Supabase; then the build, exactly as Netlify runs it. */
  for (const n of ['index.html', 'admin.html', 'sw.js', 'manifest.webmanifest', 'assets', 'images']) copy(path.join(ROOT, n), path.join(SITE, n));
  copy(path.join(ROOT, 'tools', 'build-site.cjs'), path.join(SITE, 'tools', 'build-site.cjs'));
  fs.writeFileSync(path.join(SITE, 'config.js'),
    "window.VBP_CONFIG = {\n  SUPABASE_URL: '" + base + "',\n  SUPABASE_ANON_KEY: 'test-anon-key',\n  IMAGE_BUCKET: 'product-images'\n};\n");
  const b = spawnSync(process.execPath, [path.join(SITE, 'tools', 'build-site.cjs')], { cwd: SITE, encoding: 'utf8', env: Object.assign({}, process.env, { CSP_REPORTS: '' }) });
  const browser = await chromium.launch();

  try {
    console.log('\nThe build');
    is(b.status === 0, 'tools/build-site.cjs made dist/', (b.stdout + b.stderr).trim().split('\n').slice(-3).join(' | '));
    const headers = fs.readFileSync(path.join(DIST, '_headers'), 'utf8');
    const policy = (/Content-Security-Policy-Report-Only:\s*(.+)/.exec(headers) || [])[1] || '';
    ENFORCED = policy.replace(/report-uri [^;]+/, 'report-uri /__csp');
    is(/script-src 'self' 'sha256-/.test(ENFORCED) && /report-uri \/__csp$/.test(ENFORCED),
       'its policy is served here ENFORCED, word for word but for where reports go');
    is(Object.keys(SAFETY).length === 4, 'beside netlify.toml\'s four safety headers', Object.keys(SAFETY).join(', '));

    console.log('\nThe harness can see a violation');
    {
      const v = await visit(browser, '/__probe.html', () => !!document.getElementById('p'), 'probe');
      const ran = await v.page.evaluate(() => window.__ran === true);
      const seen = await v.page.evaluate(() => window.__csp || []);
      is(!ran, 'an inline script that is not in the policy does not run');
      is(seen.some(s => /^script-src-elem inline/.test(s)), 'and the page hears about it', seen.join(' | '));
      await v.page.waitForTimeout(300);
      is(REPORTS.length > 0, 'and a report is posted, as the live site\'s would be to csp-report', REPORTS.length + ' reports');
      await v.ctx.close();
      REPORTS.length = 0;
    }

    console.log('\nThe shop');
    {
      const v = await visit(browser, '/shop', () => document.querySelectorAll('#grid .card').length > 0, '/shop');
      is(v.readyOk, '/shop: the catalogue is drawn, so every script on the page ran');
      const inline = await v.page.evaluate(() => ({
        marks: !!window.VBP_MARKS, track: !!(window.VBP_TRACK && window.VBP_TRACK.q),
        logo: (document.querySelector('.brand-logo') || {}).getAttribute ? document.querySelector('.brand-logo').getAttribute('src') : null,
      }));
      is(inline.marks && inline.track && !!inline.logo, 'the six small scripts written into index.html ran: logos and the visit queue',
         JSON.stringify(inline));
      await noViolations(v);
      await v.ctx.close();
    }
    {
      const v = await visit(browser, '/', () => !!document.getElementById('visitMap'), 'home page');
      await v.page.evaluate(() => { const m = document.getElementById('visitMap'); if (m) m.scrollIntoView(); });
      await v.page.waitForTimeout(1200);
      const mapAsked = v.page.frames().some(f => /google\.com\/maps/.test(f.url()));
      is(mapAsked, 'home page: the Google map is let into its frame');
      await noViolations(v);
      await v.ctx.close();
    }
    {
      GENERAL = TWO_SHOPS;
      const v = await visit(browser, '/', () => !!document.querySelector('#visitMap.visit-pins'), 'home page, two shops');
      await v.page.evaluate(() => { const m = document.getElementById('visitMap'); if (m) m.scrollIntoView(); });
      let drawn = true;
      try { await v.page.waitForFunction(() => document.querySelectorAll('#visitMap .leaflet-marker-icon').length === 2, null, { timeout: 10000 }); }
      catch (e) { drawn = false; }
      await v.page.waitForTimeout(800);
      is(drawn, 'home page, two shops: the map is drawn by this site\'s own Leaflet, with both pins');
      is(ASKED.some(a => a.path === '/assets/vendor/leaflet-1.9.4/leaflet.js'), 'Leaflet came from this site');
      await noViolations(v, ', the map\'s tiles and styles included');
      await v.ctx.close();
      GENERAL = null;
    }
    {
      const v = await visit(browser, '/product/VB-DRS-001', () => !!document.querySelector('.prod-videos video'), 'a product');
      is(v.readyOk, 'a product: drawn, with its video');
      await v.page.waitForTimeout(800);
      const imgs = await v.page.evaluate(() => Array.from(document.images).map(i => i.currentSrc || i.src).filter(s => /img\.example\.test/.test(s)));
      is(imgs.length > 0, 'its photos kept on another site are shown', imgs.slice(0, 2).join(', '));
      await noViolations(v, ', photos and video from other sites included');
      await v.ctx.close();
    }
    {
      const v = await visit(browser, '/policies', () => /polic/i.test((document.querySelector('#view-policies, [data-view="policies"], main') || document.body).innerText), '/policies');
      is(v.readyOk, '/policies: drawn');
      await noViolations(v);
      await v.ctx.close();
    }

    console.log('\nThe admin');
    {
      const v = await visit(browser, '/admin.html', () => { const e = document.getElementById('login'); return !!e && !e.classList.contains('hide'); }, 'admin');
      is(v.readyOk, 'admin: the sign-in panel is up, so the moved script (assets/admin/shell.js) ran under the policy');
      is(await v.page.evaluate(() => !!(window.supabase && window.supabase.createClient) && !!(window.VBP_ADMIN && window.VBP_ADMIN.sb)),
         'with the real Supabase library from assets/vendor/, not a stand-in');
      await v.page.fill('#loginEmail', 'owner@shop.test').catch(() => {});
      await noViolations(v);
      await v.ctx.close();
    }

    console.log('\nThe admin, signed in: every tab and every section of Settings');
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await ctx.addInitScript(WATCH);
      await ctx.addInitScript(s => { try { if (!localStorage.getItem('sb-127-auth-token')) localStorage.setItem('sb-127-auth-token', s); } catch (e) {} }, session());
      await otherSites(ctx);
      const page = await ctx.newPage();
      const consoleCsp = [], errors = [];
      page.on('console', m => { if (/Content Security Policy|Refused to/i.test(m.text())) consoleCsp.push(m.text()); });
      page.on('pageerror', e => errors.push(String(e.message || e)));
      await page.goto(base + '/admin.html', { waitUntil: 'domcontentloaded' });
      let inside = true;
      try { await page.waitForFunction(() => { const a = document.getElementById('admin'); return a && !a.classList.contains('hide'); }, null, { timeout: 15000 }); }
      catch (e) { inside = false; }
      is(inside, 'signed in as the owner, with the real Supabase library: the admin opens');

      const tabs = await page.evaluate(() => Array.from(document.querySelectorAll('.tab[data-tab]')).map(t => t.getAttribute('data-tab')));
      const drawn = [];
      for (const t of tabs) {
        await page.evaluate(h => { location.hash = h; }, '#/' + t);
        await page.waitForTimeout(t === 'analytics' || t === 'chats' ? 1500 : 700);
        if (await page.evaluate(id => { const e = document.getElementById(id); return !!e && e.innerHTML.trim().length > 0; }, 'tab-' + t)) drawn.push(t);
      }
      const sections = await page.evaluate(() => ((window.VBP_ADMIN || {}).settings || []).map(x => x.key));
      const shown = [];
      for (const k of sections) {
        await page.evaluate(h => { location.hash = h; }, '#/settings/' + k);
        await page.waitForTimeout(500);
        /* Each section draws its own form; one that drew nothing was not
           really visited. */
        const text = await page.evaluate(() => { const e = document.getElementById('tab-settings'); return e ? e.innerText : ''; });
        if (text.trim().length > 40) shown.push(k);
      }
      is(tabs.length >= 11 && drawn.length === tabs.length, 'all ' + tabs.length + ' tabs opened and drawn',
         'drawn: ' + drawn.join(', ') + ' / tabs: ' + tabs.join(', '));
      is(sections.length >= 18 && shown.length === sections.length, 'and all ' + sections.length + ' sections of Settings',
         'drawn ' + shown.length + ': missing ' + sections.filter(k => shown.indexOf(k) < 0).join(', '));
      const seen = (await page.evaluate(() => window.__csp || [])).concat(consoleCsp);
      is(seen.length === 0, 'the whole tour: nothing blocked', seen.slice(0, 4).join(' | '));
      /* The control: the same document, at the end of the tour, made to
         break the policy. If this were not seen, "nothing blocked" above
         would mean nothing. */
      const control = await page.evaluate(() => {
        const sc = document.createElement('script'); sc.textContent = 'window.__slipped = true;';
        document.body.appendChild(sc);
        return new Promise(r => setTimeout(() => r({ ran: window.__slipped === true, seen: (window.__csp || []).length }), 200));
      });
      is(!control.ran && control.seen === 1, 'and the watch was listening: a script slipped in at the end is refused and seen',
         JSON.stringify(control));
      const cspErrors = errors.filter(e => /Content Security Policy|Refused|unsafe-eval|unsafe-inline/i.test(e));
      is(cspErrors.length === 0, 'and no script failed because of the policy', cspErrors.slice(0, 3).join(' | '));
      if (errors.length) console.log('      [' + errors.length + ' other script error(s) against the empty stand-in database, none from the policy: ' +
                                      errors.slice(0, 2).map(e => e.slice(0, 90)).join(' | ') + ']');
      await ctx.close();
    }

    console.log('\nWhat the pages asked this site for');
    /* The shop looks for photos it may or may not have been given --
       images/editorial-1.jpg, a product's photo named after its SKU -- and
       carries on without them by design (images/README.txt). Those asks are
       expected to miss; anything else missing would be the build's fault. */
    const optional = a => /(^|\/)images\//.test(a.path) && !fs.existsSync(path.join(ROOT, 'images', path.basename(a.path)));
    const missing = ASKED.filter(a => a.status === 404 && !optional(a));
    is(missing.length === 0, 'nothing missing: every file the pages use is in dist/ (' +
       ASKED.filter(a => a.status === 404 && optional(a)).length + ' looks for optional photos aside)',
       missing.map(a => a.path).slice(0, 5).join(', '));
    const pageAssets = ASKED.filter(a => /^\/assets\/(app|chat|theme|admin\/shell)\.js$/.test(a.path));
    is(pageAssets.length >= 4 && pageAssets.every(a => /^\?v=[0-9a-f]{10}$/.test(a.search)),
       'the scripts the pages name were asked for by their fingerprinted addresses',
       pageAssets.map(a => a.path + a.search).slice(0, 4).join(', '));
    is(ASKED.some(a => a.path === '/assets/vendor/supabase-js-2.118.0.js'), 'the Supabase library came from this site');
    const posted = REPORTS.filter(b => !/__slipped|"inline"/.test(b) || !/admin\.html/.test(b));
    is(REPORTS.length === 1 && posted.length === 0, 'and no report was posted by any page, but the control\'s own',
       REPORTS.length + ' posted: ' + REPORTS.slice(0, 2).join(' | ').slice(0, 300));
  } finally {
    await browser.close();
    server.close();
    fs.rmSync(TMP, { recursive: true, force: true });
  }

  console.log(failures ? '\n  ✗ ' + failures + ' of ' + checks + ' checks FAILED' : '\n  security policy, switched on: all ' + checks + ' checks passed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('  ✗ the test itself failed: ' + (e && e.stack || e)); process.exit(1); });
