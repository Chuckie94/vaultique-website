/* =====================================================================
   Vaultique Boutique Point — the installed app's icon
   ---------------------------------------------------------------------
   Run with:  node tests/pwa-icons.cjs

   Nothing here needs a network, a database or a browser. It reads the
   three PNGs off disk and decodes them, renders the manifest function
   with its settings stubbed, and reads the two pages that link to an
   icon. It is meant to be runnable on any machine that has the folder.

   WHAT IT IS GUARDING. An app icon is read once, when somebody installs
   the app, and then kept on the home screen until they uninstall it.
   There is no cache to clear and no reload that fixes it — a wrong icon
   is wrong on that phone for good. So the things that would make it
   wrong are worth pinning down in checks rather than in a comment:

     * that the manifest points at the tiles drawn for the purpose and
       not at the shop's website logo, which is a different shape and a
       different job;
     * that the file the shop's phone actually gets — the built one —
       says the same as the file that stands in for it;
     * that the maskable tile can survive being cropped to a circle;
     * and that none of the above quietly stopped being true because
       somebody changed a logo somewhere else.
   ===================================================================== */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const R = (p) => path.join(ROOT, p);

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { console.log('  ✓ ' + name); pass++; }
  else { console.log('  ✗ ' + name + (extra ? '\n      ' + extra : '')); fail++; }
}
function group(title) { console.log('\n' + title); }

/* ------------------------------------------------------------------ */
/* A PNG, far enough to answer the two questions that matter: how big is
   it, and what is underneath every pixel. No dependency for this — the
   only compression a PNG uses is the one Node already has. */
function readPng(file) {
  const d = fs.readFileSync(file);
  if (d.toString('latin1', 0, 8) !== '\x89PNG\r\n\x1a\n') throw new Error(file + ': not a PNG');

  let pos = 8, idat = [], w = 0, h = 0, depth = 0, ctype = 0, interlace = 0;
  while (pos < d.length) {
    const len = d.readUInt32BE(pos);
    const typ = d.toString('latin1', pos + 4, pos + 8);
    if (typ === 'IHDR') {
      w = d.readUInt32BE(pos + 8);
      h = d.readUInt32BE(pos + 12);
      depth = d[pos + 16]; ctype = d[pos + 17]; interlace = d[pos + 20];
    } else if (typ === 'IDAT') {
      idat.push(d.slice(pos + 8, pos + 8 + len));
    } else if (typ === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8) throw new Error(file + ': expected 8 bits per channel, found ' + depth);
  if (interlace !== 0) throw new Error(file + ': interlaced PNGs are not read here');

  const nch = { 0: 1, 2: 3, 4: 2, 6: 4 }[ctype];
  if (!nch) throw new Error(file + ': palette PNGs are not read here');

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * nch;
  const px = Buffer.alloc(h * stride);
  let prev = Buffer.alloc(stride), p = 0;

  for (let y = 0; y < h; y++) {
    const f = raw[p++];
    const line = Buffer.from(raw.slice(p, p + stride)); p += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= nch ? line[i - nch] : 0;
      const b = prev[i];
      const c = i >= nch ? prev[i - nch] : 0;
      let add = 0;
      if (f === 1) add = a;
      else if (f === 2) add = b;
      else if (f === 3) add = (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        add = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      line[i] = (line[i] + add) & 255;
    }
    line.copy(px, y * stride);
    prev = line;
  }
  return { w: w, h: h, nch: nch, px: px, bytes: d.length };
}

/* How much of the drawing sits outside the circle Android is allowed to
   crop back to — the "safe zone", a circle 80% of the tile wide. Ink is
   any opaque pixel that is not the background colour the corners are. */
function inkOutsideSafeZone(img) {
  const { w, h, nch, px } = img;
  const bg = [px[0], px[1], px[2]];
  const cx = (w - 1) / 2, cy = (h - 1) / 2, r = w * 0.4;
  let inside = 0, outside = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * nch;
      if (nch === 4 && px[i + 3] <= 16) continue;
      const diff = Math.abs(px[i] - bg[0]) + Math.abs(px[i + 1] - bg[1]) + Math.abs(px[i + 2] - bg[2]);
      if (diff < 40) continue;
      if (Math.hypot(x - cx, y - cy) > r) outside++; else inside++;
    }
  }
  return { inside: inside, outside: outside };
}

function fullyOpaque(img) {
  const { w, h, nch, px } = img;
  if (nch !== 4) return true;          // no alpha channel at all
  for (let i = 3; i < px.length; i += nch) if (px[i] < 250) return false;
  return true;
}

/* ------------------------------------------------------------------ */
/* The manifest function, rendered with its settings answered from
   memory rather than from the shop's database. */
const realLoad = Module._load;
function renderManifest(store) {
  Module._load = function (req, parent) {
    if (parent && parent.filename && parent.filename.indexOf('functions' + path.sep + 'manifest.js') !== -1 &&
        req === './_seo-data') {
      return { settings: async (key) => (store && store[key]) || null };
    }
    return realLoad.apply(this, arguments);
  };
  const file = R('netlify/functions/manifest.js');
  delete require.cache[require.resolve(file)];
  const fn = require(file);
  Module._load = realLoad;
  return fn.handler({ headers: {} });
}

const THE_THREE = [
  { src: '/images/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/images/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: '/images/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
];

(async function () {

  /* ---------------------------------------------------------------- */
  group('The three tiles are on disk, and are the size they claim to be');

  const icons = {};
  THE_THREE.forEach(function (spec) {
    const rel = spec.src.replace(/^\//, '');
    const exists = fs.existsSync(R(rel));
    ok(rel + ' ships with the folder', exists);
    if (!exists) return;
    const img = icons[spec.src] = readPng(R(rel));
    const want = spec.sizes.split('x').map(Number);
    ok(rel + ' really is ' + spec.sizes,
       img.w === want[0] && img.h === want[1], img.w + 'x' + img.h);
    ok(rel + ' is square', img.w === img.h);
    ok(rel + ' is small enough to fetch on a phone', img.bytes < 200 * 1024,
       img.bytes + ' bytes');
  });

  /* ---------------------------------------------------------------- */
  group('And the maskable one can be cropped without losing the mark');

  const mask = icons['/images/icon-maskable-512.png'];
  const any192 = icons['/images/icon-192.png'];
  const any512 = icons['/images/icon-512.png'];

  /* A phone puts an adaptive icon behind a shape of its own choosing —
     a circle, a squircle, a rounded square — and whatever the tile left
     transparent shows through as a hole. Every one of these has to be
     opaque corner to corner, maskable or not. */
  ok('the maskable tile is opaque corner to corner', fullyOpaque(mask));
  ok('so is the 192', fullyOpaque(any192));
  ok('so is the 512', fullyOpaque(any512));

  const m = inkOutsideSafeZone(mask);
  ok('the maskable tile keeps its whole mark inside the middle 80%',
     m.outside === 0, m.outside + ' pixels of ink would be cropped');
  ok('and there is a mark there to keep', m.inside > 500, m.inside + ' pixels of ink');

  /* The other two are declared "any", which is never cropped — so they
     are expected to fill their tile, and a mark that stayed inside the
     safe circle would just be a small mark with a wide margin. This is
     the one check that would fail if somebody "fixed" them to match the
     maskable one. */
  const a = inkOutsideSafeZone(any512);
  ok('the ordinary tiles fill their square instead, as they should',
     a.outside > 0, 'the 512 draws nothing outside the safe circle');

  /* ---------------------------------------------------------------- */
  group('The static manifest names those three and nothing else');

  const STATIC = JSON.parse(fs.readFileSync(R('manifest.webmanifest'), 'utf8'));
  ok('three icons, in order, exactly as drawn',
     JSON.stringify(STATIC.icons) === JSON.stringify(THE_THREE), JSON.stringify(STATIC.icons));
  ok('exactly one is maskable',
     STATIC.icons.filter(function (i) { return i.purpose === 'maskable'; }).length === 1);
  ok('none of them claims to be right at every size',
     STATIC.icons.every(function (i) { return i.sizes !== 'any'; }));
  ok('the shortcuts point at a PWA tile too',
     (STATIC.shortcuts || []).every(function (s) {
       return (s.icons || []).every(function (i) { return i.src.indexOf('/images/icon-') === 0; });
     }));
  ok('and nowhere does it name a website logo',
     JSON.stringify(STATIC).indexOf('/images/logo') === -1);

  /* ---------------------------------------------------------------- */
  group('The built manifest says the same, whatever the shop has uploaded');

  let res = await renderManifest({
    branding: {
      logoMain: 'https://xyz.supabase.co/storage/v1/object/public/brand/logo.png',
      logoMobile: 'https://xyz.supabase.co/storage/v1/object/public/brand/mobile.png',
      favicon: 'https://xyz.supabase.co/storage/v1/object/public/brand/fav.png',
      primaryColour: '#101820'
    },
    general: { shopName: 'Kabwe Couture House' }
  });
  let live = JSON.parse(res.body);

  ok('the same three tiles, in the same order',
     JSON.stringify(live.icons) === JSON.stringify(THE_THREE), JSON.stringify(live.icons));
  ok('the uploaded logo is not among them', JSON.stringify(live.icons).indexOf('supabase.co') === -1);
  ok('nor hiding in a shortcut', JSON.stringify(live.shortcuts).indexOf('supabase.co') === -1);
  ok('nor anywhere else in the file', res.body.indexOf('supabase.co') === -1);
  ok('nothing claims sizes "any"', live.icons.every(function (i) { return i.sizes !== 'any'; }));
  ok('exactly one maskable', live.icons.filter(function (i) { return i.purpose === 'maskable'; }).length === 1);

  group('While the name, the colours and the window are still the shop’s');
  ok('the shop is named on the home screen', live.name === 'Kabwe Couture House — Shop Desk');
  ok('the short name is its first word', live.short_name === 'Kabwe');
  ok('the splash sits on the shop’s own primary colour', live.background_color === '#101820',
     live.background_color);
  ok('and so does the title bar', live.theme_color === '#101820', live.theme_color);
  ok('it still opens on the chats screen', live.start_url === '/admin.html#/chats');
  ok('scope unchanged', live.scope === '/');
  ok('display unchanged', live.display === 'standalone');
  ok('orientation unchanged', live.orientation === 'any');
  ok('both shortcuts still there',
     live.shortcuts.length === 2 &&
     live.shortcuts[0].url === '/admin.html#/chats' &&
     live.shortcuts[1].url === '/admin.html#/orders');
  ok('served as a manifest',
     res.headers['Content-Type'] === 'application/manifest+json; charset=utf-8');
  ok('and cached no longer than it was before', res.headers['Cache-Control'] === 'public, max-age=300');

  group('The colour is read from the key Settings > Branding actually writes');

  /* primaryColour is what the form saves. "navy" is the name of the CSS
     variable the storefront derives from it, and was what this function
     used to ask for — so it never found anything and every shop got the
     shipped default. */
  res = await renderManifest({ branding: { primaryColour: '#7A1F3D' }, general: {} });
  live = JSON.parse(res.body);
  ok('a shop that chose its own colour gets it', live.background_color === '#7A1F3D',
     live.background_color);
  ok('on the title bar too', live.theme_color === '#7A1F3D', live.theme_color);

  /* The old key, on its own, must not bring the bug back by the side
     door: it is not a colour anybody saves. */
  res = await renderManifest({ branding: { navy: '#7A1F3D' }, general: {} });
  live = JSON.parse(res.body);
  ok('a row carrying only the derived name falls back to the shipped navy',
     live.background_color === '#0B1F3A', live.background_color);

  ok('a colour that is not a colour is refused rather than passed on',
     await (async () => {
       for (const bad of ['red', 'javascript:x', '#12', '', '#GGGGGG', 'rgb(1,2,3)', null]) {
         const r = await renderManifest({ branding: { primaryColour: bad }, general: {} });
         if (JSON.parse(r.body).background_color !== '#0B1F3A') return false;
       }
       return true;
     })());
  ok('while a short hex is still a hex',
     JSON.parse((await renderManifest({ branding: { primaryColour: '#abc' }, general: {} })).body)
       .background_color === '#abc');

  group('A shop that has saved nothing gets the static file back, to the letter');
  res = await renderManifest({});
  live = JSON.parse(res.body);
  ['icons', 'shortcuts', 'name', 'short_name', 'description', 'start_url',
   'scope', 'display', 'orientation', 'theme_color', 'background_color'].forEach(function (k) {
    ok('same ' + k, JSON.stringify(live[k]) === JSON.stringify(STATIC[k]),
       JSON.stringify(live[k]) + '  vs  ' + JSON.stringify(STATIC[k]));
  });

  group('And a database that is not answering does not cost the shop its icon');
  Module._load = function (req, parent) {
    if (parent && parent.filename && parent.filename.indexOf('functions' + path.sep + 'manifest.js') !== -1 &&
        req === './_seo-data') {
      return { settings: async function () { throw new Error('no database'); } };
    }
    return realLoad.apply(this, arguments);
  };
  delete require.cache[require.resolve(R('netlify/functions/manifest.js'))];
  res = await require(R('netlify/functions/manifest.js')).handler({ headers: {} });
  Module._load = realLoad;
  live = JSON.parse(res.body);
  ok('it still answers', res.statusCode === 200);
  ok('still with the three tiles', JSON.stringify(live.icons) === JSON.stringify(THE_THREE));
  ok('and the name it ships with', live.name === 'Vaultique Boutique — Shop Desk');

  /* ---------------------------------------------------------------- */
  group('The worker buzzes with the app’s icon, not a logo');

  const sw = fs.readFileSync(R('sw.js'), 'utf8');
  ok('the notification icon is the 192 tile',
     /const ICON = '\/images\/icon-192\.png';/.test(sw));
  ok('the badge is still the badge', /const BADGE = '\/images\/badge-96\.png';/.test(sw));
  ok('no website logo is named anywhere in it', sw.indexOf('/images/logo') === -1);
  ok('it still caches nothing', sw.indexOf("addEventListener('fetch'") === -1);
  ok('and still takes over at once', /skipWaiting\(\)/.test(sw) && /clients\.claim\(\)/.test(sw));

  /* ---------------------------------------------------------------- */
  group('The desk keeps the app’s icon and the tab’s picture apart');

  const admin = fs.readFileSync(R('admin.html'), 'utf8');
  const appleLinks = admin.match(/<link rel="apple-touch-icon"[^>]*>/g) || [];
  ok('the home-screen icon is declared once', appleLinks.length === 1, String(appleLinks.length));
  ok('and points at the tile drawn for it',
     appleLinks[0] && appleLinks[0].indexOf('/images/icon-192.png') !== -1, appleLinks[0]);

  /* The whole point of the change. Whatever else useTheShopsLogo() does,
     it must not reach for the home-screen icon: that one is read at
     install and kept, so a logo written into it is a logo the shop is
     stuck with. */
  const swapFn = (admin.match(/function useTheShopsLogo\(\)[\s\S]*?\n  \}/) || [''])[0];
  ok('there is still a function swapping the tab picture', swapFn.length > 0);
  ok('it sets the tab icon', /link\[rel="icon"\]/.test(swapFn));
  ok('and never touches apple-touch-icon', swapFn.indexOf('apple-touch-icon') === -1);
  ok('the tab picture still follows Settings > Branding',
     /logoMobile \|\| b\.logoMain/.test(swapFn));
  ok('the desk still asks for the manifest',
     /<link rel="manifest" href="\/manifest\.webmanifest"/.test(admin));

  group('And the storefront is left out of it altogether');
  const index = fs.readFileSync(R('index.html'), 'utf8');
  ok('the shop front does not install itself as an app',
     index.indexOf('rel="manifest"') === -1);
  ok('and its tab picture is a logo, as it always was',
     /<link rel="icon" href="\/images\/logo-sm\.png"/.test(index));
  ok('no PWA tile is used as website furniture',
     index.indexOf('/images/icon-') === -1);

  console.log('\npwa icons: ' + (fail === 0
    ? 'all ' + pass + ' checks passed'
    : pass + ' passed, ' + fail + ' failed'));
  process.exit(fail === 0 ? 0 : 1);
})().catch(function (e) {
  console.error('\nthe checks themselves fell over:\n', e);
  process.exit(1);
});
