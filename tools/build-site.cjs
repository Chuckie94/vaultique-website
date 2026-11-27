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

     5. REFUSES TO PUBLISH WHILE NETLIFY STILL HOLDS POS_SUPABASE_KEY, the
        business platform's SECRET key (build 77, W-24). Nothing in the
        website uses it any more: the products and the rewards are read
        only through the platform's doors. A shop whose doors are not
        working yet must not lose its catalogue to an upload, so the
        deploy stops here, the site that was live stays live, and the
        log says what to check before deleting the key.

     6. REFUSES TO PUBLISH A BUILD WHOSE OWN CHECKS FAIL (build 84). Until
        now GitHub ran the checks and Netlify published whatever was
        uploaded, pass or fail. The node checks (tests/run-tests.js node:
        the server jobs and this step; under a minute; nothing to install)
        now run here first, before anything is copied. One failure and the
        deploy stops, and the site that was live stays live. The browser
        and database checks need Chromium and PostgreSQL, which Netlify's
        build machine does not have: they stay on GitHub.

        The checks run with none of Netlify's settings. They never need a
        real key, and a check that saw the shop's service key or
        Flutterwave's could reach the real shop with it. Each check makes
        its own stand-ins, as on GitHub.

        Netlify environment variable, for a day when a check is wrong
        rather than the website:
          VBP_DEPLOY_GATE = paused   publish without running them. Never
                                     quietly: the log says so first and
                                     last, and the health check
                                     (/.netlify/functions/health) says so
                                     to anybody who asks, until the
                                     setting is deleted.

     7. BUILD 88 · ENFORCES THE SCRIPTS PART OF THE POLICY. The whole policy
        stays report-only, as in step 4, and beside it the part that decides
        which scripts may run (script-src, with object-src, base-uri and
        frame-ancestors) is enforced: a script from anywhere not on the list
        (this site, the inline scripts by their contents, and Lenco's card
        window at pay.lenco.co) is blocked by the browser, on the checkout as
        everywhere. tests/csp.browser.cjs walks the shop and the admin with
        the whole policy enforced, so the scripts part breaks nothing today.

          CSP_SCRIPTS = report   back to report-only for scripts too, for a
                                 day when something the reports did not see
                                 is blocked. The health check says so.

     8. BUILD 88 · REFUSES TO PUBLISH A SECRET, OR A CARD FIELD. Every file
        about to be published is read before anything goes out:
          - no secret key: the value of any secret Netlify holds (the
            service key, Flutterwave's and Lenco's secret keys and webhook
            hash, the platform's keys), and nothing shaped like one (a
            Flutterwave secret key, a Supabase key whose role is
            service_role). Public keys are public, and may be there.
          - no card field: no box for a card number, expiry or security
            code. Cards are typed only into the gateway's own window or page.
        Either found, and the deploy stops, naming the file, never the key.

   It changes nothing outside dist/, reads nothing from the internet, and
   needs nothing installed but Node itself.

   By hand, from the website folder:   node tools/build-site.cjs
   The tests point it elsewhere:       --root <folder> --out <folder>/dist
   (and then the checks of step 6 run only when asked: --gate)

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
const { spawnSync } = require('child_process');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? path.resolve(process.argv[i + 1]) : fallback;
}

const ROOT = arg('--root', path.resolve(__dirname, '..'));
const OUT = arg('--out', path.join(ROOT, 'dist'));
/* Step 6 runs for the real website (no --root: Netlify, or by hand), and
   for a copy only when a check asks for it with --gate. */
const GATE = process.argv.indexOf('--root') < 0 || process.argv.indexOf('--gate') > -1;

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
  // build 88 · Lenco's card window: its script, and the window it opens
  // (https://pay.lenco.co/js/v1/inline.js and the sandbox's).
  'worker-src': ["'self'"],
  'manifest-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
  'frame-ancestors': ["'none'"],
};
const LENCO_ORIGINS = ['https://pay.lenco.co', 'https://pay.sandbox.lenco.co'];
POLICY['frame-src'] = POLICY['frame-src'].concat(LENCO_ORIGINS);
const REPORT_TO = '/.netlify/functions/csp-report';

/* BUILD 88 · step 8: what must never be published. The names of the
   secrets Netlify may hold; their values are looked for in every file. */
const SECRET_NAMES = ['SUPABASE_SERVICE_ROLE_KEY', 'WEB_SUPABASE_SERVICE_KEY', 'FLW_SECRET_KEY_LIVE', 'FLW_SECRET_KEY_TEST',
  'LENCO_SECRET_KEY_LIVE', 'LENCO_SECRET_KEY_TEST', 'POS_REWARDS_KEY', 'POS_SUPABASE_KEY', 'VBP_WEB_ORDERS_KEY'];
/* A phrase the shop chose itself, which could be an ordinary word on a page
   (the shop's own name, say): found, it is named in the log, not a stop. */
const SECRET_PHRASES = ['FLW_WEBHOOK_HASH'];
const TEXT_FILE = /\.(html?|js|cjs|mjs|css|json|webmanifest|txt|svg|xml|map)$/i;

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

/* ------------------------------------------------- the platform's secret key */

/* A secret key, as opposed to the publishable one (which is public, in every
   page the platform serves, and harmless here). New keys say which they are;
   an older key is a token whose role says so. */
function isSecretKey(k) {
  k = String(k || '').trim();
  if (!k || /^sb_publishable_/.test(k)) return false;
  if (/^sb_secret_/.test(k)) return true;
  try {
    const role = JSON.parse(Buffer.from(k.split('.')[1] || '', 'base64url').toString('utf8')).role;
    if (role === 'anon') return false;
  } catch (e) { /* not a token: treat as secret */ }
  return true;
}
function checkPlatformKey() {
  if (!isSecretKey(process.env.POS_SUPABASE_KEY)) return;
  stop('Netlify still holds POS_SUPABASE_KEY, the business platform\'s SECRET key.\n' +
       'It opens the whole business, and since build 77 nothing in the website uses it:\n' +
       'the products and the rewards are read only through the platform\'s doors.\n\n' +
       'Before deleting it, check the site that is live now (it is still the old build):\n' +
       '  https://YOUR-SITE/api/products        must say  "source":"door"   (near the end)\n' +
       '  https://YOUR-SITE/api/rewards-check   must say  "source":"door"\n' +
       'Both say "door": Netlify > Site configuration > Environment variables >\n' +
       'POS_SUPABASE_KEY > Delete, then Deploys > Trigger deploy.\n' +
       'Either says anything else: do not delete it, keep the old build, and send\n' +
       'what they say to whoever looks after the website.');
}

/* ------------------------------------------------- step 6: the checks first */

/* What the checks are given of the machine they run on: enough to run
   Node and write their scratch files, and none of Netlify's settings. */
const GATE_KEEP = ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'TZ', 'SYSTEMROOT', 'COMSPEC', 'PATHEXT'];
function gateEnv() {
  const env = {};
  for (const k of GATE_KEEP) if (process.env[k] !== undefined) env[k] = process.env[k];
  env.VBP_IN_GATE = '1';          // a check that builds a copy of the site does not start them again
  return env;
}
function gatePaused() {
  return /^(paused|pause|off|no|false|0)$/i.test(String(process.env.VBP_DEPLOY_GATE || '').trim());
}
const PAUSED_WORDS = 'THE CHECKS WERE NOT RUN: VBP_DEPLOY_GATE is set to "' +
  String(process.env.VBP_DEPLOY_GATE || '').trim() + '" in Netlify, so this deploy was published\n' +
  '  without them. Delete that setting (Site configuration > Environment variables) and\n' +
  '  Trigger deploy as soon as the reason has gone: until then the health check says so too.';

function runChecks() {
  if (!GATE) return 'not asked';
  if (process.env.VBP_IN_GATE === '1') {
    say('Checks: not started again (this is one of them, building a copy of the site).');
    return 'inside';
  }
  if (gatePaused()) {
    console.log('\n  !!! ' + PAUSED_WORDS + '\n');
    warnings++;
    return 'paused';
  }
  const runner = path.join(ROOT, 'tests', 'run-tests.js');
  if (!fs.existsSync(runner)) {
    stop('the website\'s own checks (tests/run-tests.js) are not in the repository.\n' +
         'Every build carries them in its tests/ folder, and this step runs them before\n' +
         'it publishes anything. Upload the whole build folder again, tests/ included.');
  }
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [runner, 'node'], {
    cwd: ROOT, env: gateEnv(), encoding: 'utf8', timeout: 10 * 60 * 1000, maxBuffer: 64 * 1024 * 1024
  });
  const out = ((r.stdout || '') + (r.stderr || '')).replace(/\s+$/, '');
  const lines = out.split('\n');
  const summary = lines.filter((l) => /^\s*node: /.test(l)).pop() || '';
  const secs = Math.round((Date.now() - t0) / 1000);
  if (r.status !== 0 || r.error) {
    console.log('\nThe website\'s own checks, before publishing:\n');
    /* The files that failed and what they found, then the count: the
       runner prints exactly that, beneath each file it names with a cross. */
    const shown = [];
    lines.forEach((l, i) => {
      if (/^\s*✗ /.test(l)) {
        shown.push(l);
        for (let j = i + 1; j < lines.length && /^\s{8,}\S/.test(lines[j]); j++) shown.push(lines[j]);
      }
    });
    (shown.length ? shown : lines.slice(-12))
      .filter((l, i, all) => i === 0 || l !== all[i - 1])
      .forEach((l) => console.log(l));
    if (summary) console.log('\n' + summary);
    stop((r.error && r.error.code === 'ETIMEDOUT'
           ? 'the website\'s own checks did not finish within 10 minutes.'
           : 'the website\'s own checks failed, above.') + '\n' +
         'A build that fails its own checks is not published. The same checks run on\n' +
         'GitHub (the Actions tab says which and why).');
  }
  say('Checks: ' + (summary.trim() || 'all passed') + ' (' + secs + ' s), before publishing.');
  return 'passed';
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

/* --------------------------------------------- step 8: secrets, card fields */
function filesUnder(dir) {
  const out = [];
  (function walk(d) {
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name);
      const st = fs.lstatSync(p);
      if (st.isDirectory()) walk(p);
      else if (st.isFile()) out.push(p);
    }
  }(dir));
  return out;
}
function jwtRole(token) {
  try {
    return JSON.parse(Buffer.from(String(token).split('.')[1] || '', 'base64url').toString('utf8')).role || '';
  } catch (e) { return ''; }
}
function noSecretsNoCardFields(dir) {
  const secrets = SECRET_NAMES
    .map((n) => [n, String(process.env[n] || '').trim()])
    .filter(([, v]) => v.length >= 12);
  const phrases = SECRET_PHRASES
    .map((n) => [n, String(process.env[n] || '').trim()])
    .filter(([, v]) => v.length >= 8);
  const CARD_FIELD = /autocomplete\s*=\s*\\?["']cc-(number|csc|exp|exp-month|exp-year)\\?["']|<input\b[^>]*\b(name|id)\s*=\s*\\?["'][^"'\\]*(card-?number|cardnumber|cvv|cvc|card-?code|security-?code)/i;
  for (const file of filesUnder(dir)) {
    if (!TEXT_FILE.test(file)) continue;
    const rel = path.relative(dir, file).split(path.sep).join('/');
    const text = fs.readFileSync(file, 'utf8');
    for (const [name, value] of secrets) {
      if (text.indexOf(value) > -1) {
        stop(rel + ' holds the value of ' + name + ', a secret key.\n' +
             'Secret keys live in Netlify\'s environment variables and nowhere else: a key in a published file\n' +
             'can be read by anybody. Take it out of that file, then change the key itself where it was made\n' +
             '(it has to be treated as seen), put the new one in Netlify, and deploy again.');
      }
    }
    for (const [name, value] of phrases) {
      if (text.indexOf(value) > -1) {
        warn(rel + ' has the words of ' + name + ' in it. Anybody can read that file: choose a new phrase in ' +
             'Flutterwave (Settings > Webhooks) and put the same one in Netlify.');
      }
    }
    if (/FLWSECK(_TEST)?-[A-Za-z0-9]{8,}/.test(text)) {
      stop(rel + ' holds what looks like a Flutterwave secret key (FLWSECK...).\n' +
           'Secret keys live in Netlify\'s environment variables and nowhere else. Take it out, change the key\n' +
           'in Flutterwave, and deploy again.');
    }
    const jwts = text.match(/eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g) || [];
    if (jwts.some((t) => jwtRole(t) === 'service_role')) {
      stop(rel + ' holds a Supabase service key (its role is service_role), which opens the whole database.\n' +
           'Only the public (anon) key belongs in config.js. Take it out, roll the service key in Supabase\n' +
           '(Project Settings > API), put the new one in Netlify as SUPABASE_SERVICE_ROLE_KEY, and deploy again.');
    }
    if (/\.(html?|js)$/i.test(file) && CARD_FIELD.test(text)) {
      stop(rel + ' has a box for a card number, expiry or security code.\n' +
           'Cards are typed only into the payment gateway\'s own secure window or page, never into this\n' +
           'website (build 88). Take the field out and deploy again.');
    }
  }
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
  checkPlatformKey();
  const checks = runChecks();

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
  noSecretsNoCardFields(OUT);

  POLICY['script-src'] = POLICY['script-src'].concat(hashes, LENCO_ORIGINS);   // build 88: Lenco's card window, after the hashes
  POLICY['connect-src'] = ["'self'", supabase.origin, supabase.socket].concat(POLICY['connect-src'].slice(1));
  const reports = !/^(off|no|false|0)$/i.test(String(process.env.CSP_REPORTS || '').trim());
  const policy = Object.keys(POLICY).map((k) => k + ' ' + POLICY[k].join(' '))
    .concat(reports ? ['report-uri ' + REPORT_TO] : []).join('; ');

  /* Step 7 (build 88): the scripts part, enforced beside the whole policy. */
  const scriptsReport = /^(report|report-only|off|no|false|0)$/i.test(String(process.env.CSP_SCRIPTS || '').trim());
  const scripts = ['script-src ' + POLICY['script-src'].join(' '), "object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'"]
    .concat(reports ? ['report-uri ' + REPORT_TO] : []).join('; ');

  fs.writeFileSync(path.join(OUT, '_headers'),
    '# Written by tools/build-site.cjs on every deploy. Change that file, not this one.\n' +
    '# Every other header is in netlify.toml, and no header is set in both places.\n' +
    '/*\n' +
    '  Content-Security-Policy-Report-Only: ' + policy + '\n' +
    (scriptsReport ? '' : '  Content-Security-Policy: ' + scripts + '\n'));

  say(copied + ' files published (' + (bytes / 1048576).toFixed(1) + ' MB); nothing else in the folder is published.');
  say(stamped + ' script and stylesheet addresses fingerprinted.');
  say('Security policy: report-only, ' + hashes.length + ' inline scripts allowed by their contents, ' +
      (reports ? 'reports to ' + REPORT_TO : 'reports switched off (CSP_REPORTS)') + '.');
  say(scriptsReport ? '! Scripts: report-only too, because Netlify holds CSP_SCRIPTS = ' + process.env.CSP_SCRIPTS + '.'
                    : 'Scripts: enforced. Only this site, its own inline scripts and Lenco\'s card window may run scripts.');
  say('Checked: no secret key and no card field in anything published.');
  say('Supabase: ' + supabase.origin);
  if (warnings) say(warnings + ' thing' + (warnings === 1 ? '' : 's') + ' worth knowing, above. None stops the deploy.');
  if (checks === 'paused') console.log('\n  !!! ' + PAUSED_WORDS);
  console.log('');
}());
