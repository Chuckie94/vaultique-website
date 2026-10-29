/* =====================================================================
   Vaultique Boutique Point — putting the website together for Netlify
   ---------------------------------------------------------------------
   Netlify runs this on every deploy, before it publishes anything
   (netlify.toml, [build]). Nobody has to run it by hand.

   WHAT IT DOES

     1. COPIES THE WEBSITE, AND ONLY THE WEBSITE, INTO dist/. Netlify
        publishes dist/ and nothing else. Until build 75 it published the
        whole folder, so every setup file, note and test could be read by
        anybody who asked for it by name, unless netlify.toml had a rule
        for it, and 33 files had none. A file that is not on the list
        below cannot be handed out now, whatever it is called and however
        it got into the repository.

     2. REFUSES TO PUBLISH WITHOUT A REAL config.js. A site deployed
        without it, or with the example's placeholders still in it, opens
        to an empty shop. A deploy that stops here leaves the site that was
        already live exactly as it was.

     3. PUTS A FINGERPRINT ON EVERY SCRIPT AND STYLESHEET ADDRESS in the
        two pages: /assets/app.js becomes /assets/app.js?v=3f9c2a1b7e. The
        fingerprint is taken from the file itself, so it changes when the
        file does and not otherwise. A browser keeps its copy of a file for
        an hour (netlify.toml), and until now it could go on using an old
        one for that long after a deploy, beside the new page. A changed
        file now has a new address and is fetched at once; an unchanged one
        keeps its address and its stored copy.

     4. WRITES THE CONTENT SECURITY POLICY (dist/_headers). It names the
        places the pages may load scripts, pictures and data from. The
        Supabase address comes from config.js, and the six small scripts
        written into index.html are allowed by their exact contents, so an
        edited one is noticed. In this build the policy is REPORT-ONLY: the
        browser blocks nothing, and tells netlify/functions/csp-report.js
        what it would have blocked. That record is what decides when the
        policy is switched on.

   It changes nothing outside dist/, reads nothing from the internet, and
   needs nothing installed but Node itself.

   By hand, from the website folder:   node tools/build-site.cjs
   The tests point it elsewhere:       --root <folder> --out <folder>/dist

   Netlify environment variable, optional:
     CSP_REPORTS = off   stop the reports (the policy itself stays). For
                         if the csp-report function is ever called more
                         often than is worth paying for.
   ===================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? path.resolve(process.argv[i + 1]) : fallback;
}

const ROOT = arg('--root', path.resolve(__dirname, '..'));
const OUT = arg('--out', path.join(ROOT, 'dist'));

/* THE WEBSITE. Nothing else is published. A new page or a new top-level
   folder has to be added here, and the build says so (see "left out"
   below) rather than leaving it to be found missing on the live site. */
const PAGES = ['index.html', 'admin.html'];
const FILES = PAGES.concat(['config.js', 'sw.js', 'manifest.webmanifest']);
const FOLDERS = ['assets', 'images'];

/* Files another service sometimes asks a shop to put at the top of its
   website, to prove the shop owns it: Google, Bing and Yandex, and the
   .well-known folder that Apple Pay and others read. None of them ships
   with this folder. If one has been added to the repository, it goes out
   exactly as it did before. */
const EXTRA_FILES = [/^google[0-9a-f]{16}\.html$/, /^BingSiteAuth\.xml$/, /^yandex_[0-9a-f]{16}\.html$/];
const EXTRA_FOLDERS = ['.well-known'];

/* What the folder carries that is not the website. Anything at the top of
   the repository that is neither the website nor on this list is named in
   the deploy log, so that a file somebody meant to publish is not silently
   dropped. */
const NOT_SITE = [/^supabase-.*\.sql$/i, /\.md$/i, /^START-HERE\.txt$/, /^HOW-TO-UPLOAD\.txt$/,
  /^netlify\.toml$/, /^\.gitignore$/, /^\.gitattributes$/, /^\.git$/, /^\.github$/, /^\.netlify$/,
  /^netlify$/, /^tests$/, /^tools$/, /^dist$/, /^node_modules$/,
  /^\.DS_Store$/, /^Thumbs\.db$/i, /^desktop\.ini$/i];

/* Never copied from inside assets/ or images/ either. */
const JUNK = /^(\.|Thumbs\.db$|desktop\.ini$)/i;

/* The places the pages reach that are not this site and not its Supabase.
   Every one is in use today:
     fonts        the shop's typefaces (index.html, admin.html) and
                  Settings > Branding's choices (assets/theme.js)
     nominatim    Settings > General finding the shop's address on the map
                  (assets/admin/settings/general.js)
     google maps  the map in the visit panel (index.html, assets/app.js)
   Pictures and videos may come from any https address, because product
   photos can be hosted anywhere the business platform keeps them. A
   picture cannot run code; scripts and data are the parts kept tight. */
const POLICY = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],                       // + the inline scripts' hashes
  'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  'font-src': ["'self'", 'https://fonts.gstatic.com'],
  'img-src': ["'self'", 'data:', 'blob:', 'https:'],
  'media-src': ["'self'", 'data:', 'blob:', 'https:'],
  'connect-src': ["'self'", 'https://nominatim.openstreetmap.org'],  // + Supabase
  'frame-src': ['https://www.google.com', 'https://maps.google.com'],
  'worker-src': ["'self'"],
  'manifest-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
  'frame-ancestors': ["'none'"],
};
const REPORT_TO = '/.netlify/functions/csp-report';

let warnings = 0;
const say = (m) => console.log('  ' + m);
const warn = (m) => { warnings++; console.log('  ! ' + m); };
function stop(m) {
  console.log('\nBUILD STOPPED: ' + m + '\n\nNothing was published. The site that was live before this deploy is still live.\n');
  process.exit(1);
}

/* ---------------------------------------------------------------- config */

/* config.js is read twice, because it is read two ways on the live site.
   The pages run it, so it is run here too, in an empty sandbox that can
   reach nothing. The functions read it as text (netlify/functions/
   _seo-data.js), so that reading is tried as well: where only the pages
   can read it, the deploy goes ahead, and the log says what the functions
   will be missing. */
function readConfig() {
  const file = path.join(ROOT, 'config.js');
  if (!fs.existsSync(file)) {
    stop('config.js is not in the repository.\n' +
         'It holds the shop\'s Supabase address and public key (SETUP.md, step 4), and\n' +
         'every build leaves it out of the zip on purpose so that yours is never\n' +
         'overwritten. Put your config.js back at the top of the repository, beside\n' +
         'index.html, and deploy again.');
  }
  const src = fs.readFileSync(file, 'utf8');

  let ran = null;
  try {
    const box = { window: {} };
    vm.runInNewContext(src, box, { timeout: 1000 });
    ran = box.window.VBP_CONFIG || null;
  } catch (e) { ran = null; }
  const text = (name) => {
    const m = new RegExp('(?:^|[^\\w])' + name + '\\s*:\\s*[\'"]([^\'"]+)[\'"]', 'm').exec(src);
    return m ? m[1] : '';
  };
  const asText = { url: text('SUPABASE_URL'), key: text('SUPABASE_ANON_KEY') };
  const pick = (v, fallback) => (typeof v === 'string' && v.trim() ? v.trim() : fallback);
  const url = pick(ran && ran.SUPABASE_URL, asText.url);
  const key = pick(ran && ran.SUPABASE_ANON_KEY, asText.key);

  if (!url || !key) {
    stop('config.js has no ' + (!url ? 'SUPABASE_URL' : 'SUPABASE_ANON_KEY') + ' in it.\n' +
         'Compare it with the example in SETUP.md, step 4.');
  }
  if (/YOUR-PROJECT/i.test(url) || /^your-anon-public-key$/i.test(key)) {
    stop('config.js still has the example\'s placeholders in it, not your project\'s\n' +
         'address and key. SETUP.md, step 4, says where to copy them from.');
  }
  let u;
  try { u = new URL(url); } catch (e) { u = null; }
  if (!u || !/^https?:$/.test(u.protocol)) {
    stop('config.js\'s SUPABASE_URL is not a web address: "' + url + '".');
  }
  if ((!asText.url || !asText.key) && !(process.env.WEB_SUPABASE_URL && process.env.WEB_SUPABASE_ANON_KEY)) {
    warn('config.js works for the pages, but the functions cannot read it: they look for\n' +
         '    SUPABASE_URL: \'…\' and SUPABASE_ANON_KEY: \'…\' written as in SETUP.md, step 4.\n' +
         '    Until it is written that way, robots.txt, the sitemap and the admin\'s email go without.');
  }
  return {
    origin: u.origin,
    socket: (u.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + u.host,  // Realtime
  };
}

/* ----------------------------------------------------------------- files */

function removeTree(dir) {
  if (!fs.existsSync(dir)) return;
  if (fs.rmSync) fs.rmSync(dir, { recursive: true, force: true });
  else fs.rmdirSync(dir, { recursive: true });
}

let copied = 0, bytes = 0;
function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  copied++;
  bytes += fs.statSync(from).size;
}
function copyTree(from, to) {
  for (const name of fs.readdirSync(from).sort()) {
    if (JUNK.test(name)) continue;
    const a = path.join(from, name);
    const st = fs.lstatSync(a);
    if (st.isSymbolicLink()) continue;            // nothing outside the folder gets in
    if (st.isDirectory()) copyTree(a, path.join(to, name));
    else if (st.isFile()) copyFile(a, path.join(to, name));
  }
}

function fingerprint(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 10);
}

/* ----------------------------------------------------------------- pages */

function attr(attrs, name) {
  const m = new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s"\'>]+))', 'i').exec(attrs);
  return m ? (m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]) : null;
}
function setAttr(attrs, name, value) {
  return attrs.replace(new RegExp('((?:^|\\s)' + name + '\\s*=\\s*)(?:"[^"]*"|\'[^\']*\'|[^\\s"\'>]+)', 'i'),
                       (all, lead) => lead + '"' + value + '"');
}

/* A local address in a page, as a path inside the website, or null for
   anything that is not a file of this site (other sites, data:, #, …). */
function localPath(value) {
  const v = String(value || '').trim();
  if (!v || v[0] === '#' || v.slice(0, 2) === '//' || /^[a-z][a-z0-9+.-]*:/i.test(v)) return null;
  const bare = v.split(/[?#]/)[0];
  let rel = bare[0] === '/' ? bare.slice(1) : bare;   // both pages sit at the top
  try { rel = decodeURIComponent(rel); } catch (e) { /* leave it as written */ }
  return path.posix.normalize(rel);
}

/* Executable scripts only: a JSON-LD block is data, not code, and the
   policy does not apply to it. */
function runs(type) {
  return !type || /^\s*(module|(text|application)\/(x-)?(java|ecma)script)\s*$/i.test(type);
}

function lineOf(html, at) { return html.slice(0, at).split('\n').length; }

const hashes = [];
let stamped = 0;

function preparePage(page) {
  const file = path.join(OUT, page);
  const html = fs.readFileSync(file, 'utf8');
  const TOKEN = /<!--[\s\S]*?-->|<script\b([^>]*)>([\s\S]*?)<\/script\s*>|<(link|img|source|video|audio|iframe)\b([^>]*)>/gi;

  /* Every file a page points at has to be in dist/. One that exists in
     the repository but not in dist/ was left behind by the list at the
     top of this file, and publishing would break the page: stop. One that
     exists nowhere is an old mistake rather than a new one: say so. */
  function check(value, at) {
    const rel = localPath(value);
    if (rel === null || rel === '.' || rel === '') return;
    if (fs.existsSync(path.join(OUT, rel))) return;
    if (fs.existsSync(path.join(ROOT, rel))) {
      stop(page + ' (line ' + lineOf(html, at) + ') uses ' + value + ', which this build did not\n' +
           'publish. Add it to the website list at the top of tools/build-site.cjs.');
    }
    warn(page + ' (line ' + lineOf(html, at) + ') points at ' + value + ', which does not exist.');
  }

  function stamp(attrs, name, at) {
    const value = attr(attrs, name);
    check(value, at);
    const rel = localPath(value);
    if (rel === null || !/^assets\//.test(rel) || /[?#]/.test(value)) return attrs;
    const target = path.join(OUT, rel);
    if (!fs.existsSync(target)) return attrs;
    stamped++;
    return setAttr(attrs, name, value.trim() + '?v=' + fingerprint(target));
  }

  const out = html.replace(TOKEN, (all, sAttrs, body, tag, tAttrs, at) => {
    if (all.slice(0, 4) === '<!--') return all;
    if (sAttrs !== undefined) {
      if (attr(sAttrs, 'src') !== null) {
        return '<script' + stamp(sAttrs, 'src', at) + '>' + body + all.slice(all.lastIndexOf('</'));
      }
      if (runs(attr(sAttrs, 'type'))) {
        /* What a browser hashes is the text between the tags as it reads
           it, and a browser reads every line ending as \n. A copy saved
           on Windows would otherwise get a policy its own scripts fail. */
        const text = body.replace(/\r\n?/g, '\n');
        const h = "'sha256-" + crypto.createHash('sha256').update(text, 'utf8').digest('base64') + "'";
        if (hashes.indexOf(h) < 0) hashes.push(h);
      }
      return all;
    }
    const t = tag.toLowerCase();
    if (/\son[a-z]+\s*=/i.test(tAttrs)) {
      warn(page + ' (line ' + lineOf(html, at) + ') has an on…= handler written into a <' + t +
           '>, which the policy would block once it is switched on.');
    }
    if (t === 'link') return '<' + tag + stamp(tAttrs, 'href', at) + '>';
    check(attr(tAttrs, 'src'), at);
    if (t === 'video') check(attr(tAttrs, 'poster'), at);
    return all;
  });

  /* Handlers written straight into any other element (<button onclick=…>)
     are code the policy would block when switched on. There are none
     today; this says so if one ever appears. */
  const handler = /<(?!script\b|link\b|img\b|source\b|video\b|audio\b|iframe\b)([a-z][a-z0-9-]*)\b[^>]*\son[a-z]+\s*=/gi;
  const stripped = html.replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, (s) => s.replace(/[^\n]/g, ' '));
  let m;
  while ((m = handler.exec(stripped))) {
    warn(page + ' (line ' + lineOf(stripped, m.index) + ') has an on…= handler written into a <' +
         m[1].toLowerCase() + '>, which the policy would block once it is switched on.');
  }
  if (/\shref\s*=\s*["']?\s*javascript:/i.test(stripped)) {
    warn(page + ' has a javascript: link, which the policy would block once it is switched on.');
  }

  fs.writeFileSync(file, out);
}

/* ----------------------------------------------------------------- build */

(function build() {
  /* dist/ is emptied first, so it must never be the website itself or a
     folder the website sits in. */
  const up = path.relative(OUT, ROOT);
  if (up === '' || (up.split(path.sep)[0] !== '..' && !path.isAbsolute(up))) {
    stop('the output folder cannot be the website folder, or a folder that holds it: ' + OUT);
  }
  if (path.basename(OUT) !== 'dist') stop('the output folder has to be called dist: ' + OUT);

  console.log('\nPutting the website together in ' + OUT);
  const supabase = readConfig();

  removeTree(OUT);
  fs.mkdirSync(OUT, { recursive: true });

  for (const f of FILES) {
    const from = path.join(ROOT, f);
    if (!fs.existsSync(from)) stop(f + ' is missing from the repository. Upload the whole build folder again.');
    copyFile(from, path.join(OUT, f));
  }
  for (const d of FOLDERS) {
    const from = path.join(ROOT, d);
    if (!fs.existsSync(from) || !fs.statSync(from).isDirectory()) stop('the ' + d + '/ folder is missing from the repository.');
    copyTree(from, path.join(OUT, d));
  }

  const leftOut = [];
  for (const name of fs.readdirSync(ROOT).sort()) {
    const from = path.join(ROOT, name);
    if (FILES.indexOf(name) > -1 || FOLDERS.indexOf(name) > -1) continue;
    const st = fs.lstatSync(from);
    if (EXTRA_FOLDERS.indexOf(name) > -1 && st.isDirectory()) {
      copyTree(from, path.join(OUT, name)); say('also published: ' + name + '/'); continue;
    }
    if (EXTRA_FILES.some((re) => re.test(name)) && st.isFile()) {
      copyFile(from, path.join(OUT, name)); say('also published: ' + name); continue;
    }
    if (!NOT_SITE.some((re) => re.test(name))) leftOut.push(name);
  }
  if (leftOut.length) {
    say('Left out, as not part of the website: ' + leftOut.join(', '));
    say('(If one of these belongs on the live site, add it to the list at the top of tools/build-site.cjs.)');
  }

  for (const p of PAGES) preparePage(p);

  POLICY['script-src'] = POLICY['script-src'].concat(hashes);
  POLICY['connect-src'] = ["'self'", supabase.origin, supabase.socket].concat(POLICY['connect-src'].slice(1));
  const reports = !/^(off|no|false|0)$/i.test(String(process.env.CSP_REPORTS || '').trim());
  const policy = Object.keys(POLICY).map((k) => k + ' ' + POLICY[k].join(' '))
    .concat(reports ? ['report-uri ' + REPORT_TO] : []).join('; ');

  fs.writeFileSync(path.join(OUT, '_headers'),
    '# Written by tools/build-site.cjs on every deploy. Change that file, not this one.\n' +
    '# Every other header is in netlify.toml, and no header is set in both places.\n' +
    '/*\n' +
    '  Content-Security-Policy-Report-Only: ' + policy + '\n');

  say(copied + ' files published (' + (bytes / 1048576).toFixed(1) + ' MB); nothing else in the folder is published.');
  say(stamped + ' script and stylesheet addresses fingerprinted.');
  say('Security policy: report-only, ' + hashes.length + ' inline scripts allowed by their contents, ' +
      (reports ? 'reports to ' + REPORT_TO : 'reports switched off (CSP_REPORTS)') + '.');
  say('Supabase: ' + supabase.origin);
  if (warnings) say(warnings + ' thing' + (warnings === 1 ? '' : 's') + ' worth knowing, above. None stops the deploy.');
  console.log('');
}());
