/* ===========================================================================
   WHAT NETLIFY PUBLISHES -- tools/build-site.cjs and netlify.toml
   The build copies the website and nothing else into dist/, stops without a
   real config.js, fingerprints the script and stylesheet addresses, and
   writes a security policy that names every inline script by its contents.
   Each run works on a copy of this folder in a temporary directory; this
   folder is never touched.
   =========================================================================== */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BUILD = path.join(ROOT, 'tools', 'build-site.cjs');
let checks = 0, failures = 0;
const is = (c, m, x) => { checks++; if (c) console.log('  ✓ ' + m); else { failures++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); } };

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vbp-build-'));
const SITE = path.join(TMP, 'site');
const DIST = path.join(SITE, 'dist');
const CONFIG = "window.VBP_CONFIG = {\n  SUPABASE_URL: 'https://abcdefghijklmnop.supabase.co',\n" +
               "  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiJ9.test.key',\n  IMAGE_BUCKET: 'product-images'\n};\n";

function copy(from, to) {
  const st = fs.statSync(from);
  if (st.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const n of fs.readdirSync(from)) copy(path.join(from, n), path.join(to, n));
  } else {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
}
function walk(dir, base, out) {
  out = out || []; base = base || dir;
  for (const n of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) walk(p, base, out); else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}
const sha = (buf) => crypto.createHash('sha256').update(buf).digest();
const read = (p) => fs.readFileSync(p, 'utf8');

/* The website folder as the shop's repository holds it, with its own
   config.js and the things a repository collects over time. */
function freshSite() {
  fs.rmSync(SITE, { recursive: true, force: true });
  fs.mkdirSync(SITE, { recursive: true });
  for (const n of ['index.html', 'admin.html', 'sw.js', 'manifest.webmanifest', 'assets', 'images',
                   'netlify.toml', 'README.md', 'START-HERE.txt', 'HOW-TO-UPLOAD.txt', 'supabase-setup.sql',
                   'supabase-safety-check.sql']) copy(path.join(ROOT, n), path.join(SITE, n));
  copy(BUILD, path.join(SITE, 'tools', 'build-site.cjs'));
  copy(path.join(ROOT, 'netlify', 'functions', 'robots.js'), path.join(SITE, 'netlify', 'functions', 'robots.js'));
  copy(__filename, path.join(SITE, 'tests', path.basename(__filename)));
  fs.writeFileSync(path.join(SITE, 'config.js'), CONFIG);
  fs.writeFileSync(path.join(SITE, '.env'), 'SECRET=never-publish-me\n');
  fs.writeFileSync(path.join(SITE, 'notes-to-self.txt'), 'private\n');
  fs.writeFileSync(path.join(SITE, 'google0123456789abcdef.html'), 'google-site-verification: google0123456789abcdef.html');
  fs.mkdirSync(path.join(SITE, '.well-known'));
  fs.writeFileSync(path.join(SITE, '.well-known', 'security.txt'), 'Contact: mailto:shop@example.com\n');
  fs.writeFileSync(path.join(SITE, 'assets', '.DS_Store'), 'junk');
}

function build(extraEnv, args) {
  const r = spawnSync(process.execPath, [path.join(SITE, 'tools', 'build-site.cjs')].concat(args || []),
    { cwd: SITE, encoding: 'utf8', env: Object.assign({}, process.env, { CSP_REPORTS: '' }, extraEnv || {}) });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

/* What a browser would hash: the text between <script> and </script>. */
function inlineHashes(html) {
  const out = [];
  html.replace(/<!--[\s\S]*?-->|<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (all, attrs, body) => {
    if (attrs === undefined || /\bsrc\s*=/i.test(attrs) || /type\s*=\s*["']?application\/ld\+json/i.test(attrs)) return all;
    out.push("'sha256-" + sha(Buffer.from(body.replace(/\r\n?/g, '\n'), 'utf8')).toString('base64') + "'");
    return all;
  });
  return out;
}
function policyOf(headers) {
  const m = /^\s+Content-Security-Policy-Report-Only:\s*(.+)$/m.exec(headers);
  return m ? m[1] : '';
}
const directive = (policy, name) => {
  const d = policy.split(';').map((s) => s.trim()).filter((s) => s.indexOf(name + ' ') === 0)[0];
  return d ? d.slice(name.length + 1).split(/\s+/) : null;
};

try {
  /* ------------------------------------------------------------- config */
  console.log('\nNo deploy without a real config.js');
  freshSite();
  fs.unlinkSync(path.join(SITE, 'config.js'));
  let r = build();
  is(r.code === 1, 'config.js missing: the build stops', 'exit ' + r.code);
  is(/config\.js is not in the repository/.test(r.out) && /still live/.test(r.out),
     'and says so, and that the live site is untouched', r.out.trim().split('\n').slice(0, 3).join(' | '));
  is(!fs.existsSync(DIST), 'nothing was made to publish');

  fs.writeFileSync(path.join(SITE, 'config.js'),
    "window.VBP_CONFIG = { SUPABASE_URL: 'https://YOUR-PROJECT.supabase.co', SUPABASE_ANON_KEY: 'your-anon-public-key' };");
  r = build();
  is(r.code === 1 && /placeholders/.test(r.out), 'the example\'s placeholders: stops', r.out.trim().split('\n')[1]);

  fs.writeFileSync(path.join(SITE, 'config.js'), "window.VBP_CONFIG = { SUPABASE_URL: 'https://abc.supabase.co' };");
  r = build();
  is(r.code === 1 && /SUPABASE_ANON_KEY/.test(r.out), 'no key: stops, naming what is missing');

  fs.writeFileSync(path.join(SITE, 'config.js'),
    "window.VBP_CONFIG = { POS_SUPABASE_URL: 'https://pos.supabase.co', SUPABASE_ANON_KEY: 'k' };");
  r = build();
  is(r.code === 1 && /SUPABASE_URL/.test(r.out), 'the platform\'s address is not mistaken for the website\'s');

  fs.writeFileSync(path.join(SITE, 'config.js'), "window.VBP_CONFIG = { SUPABASE_URL: 'abc.supabase.co', SUPABASE_ANON_KEY: 'k' };");
  r = build();
  is(r.code === 1 && /not a web address/.test(r.out), 'an address without https:// stops too');

  /* Read the way the pages read it: a config.js a browser accepts is never
     refused, even where the functions' simpler reading misses it. */
  fs.writeFileSync(path.join(SITE, 'config.js'),
    'window.VBP_CONFIG = {\n  "SUPABASE_URL": "https://abcdefghijklmnop.supabase.co",\n  "SUPABASE_ANON_KEY": "k"\n};\n');
  r = build();
  is(r.code === 0 && /the functions cannot read it/.test(r.out),
     'names in quotes: published, with a warning that the functions cannot read it', r.out.trim().split('\n').slice(0, 4).join(' | '));
  r = build({ WEB_SUPABASE_URL: 'https://abcdefghijklmnop.supabase.co', WEB_SUPABASE_ANON_KEY: 'k' });
  is(r.code === 0 && !/the functions cannot read it/.test(r.out),
     'no warning when Netlify gives the functions the address and key itself');
  fs.writeFileSync(path.join(SITE, 'config.js'),
    "window.VBP_CONFIG = { SUPABASE_URL: 'https://abcdefghijklmnop.supabase.co', SUPABASE_ANON_KEY: 'k' };\n" +
    'document.documentElement.dataset.cfg = "1";\n');
  r = build();
  is(r.code === 0 && !/!/.test(r.out.split('\n').filter((l) => /^\s+!/.test(l)).join('')),
     'a config.js that does more than a sandbox allows is still read, as the functions read it');

  /* ------------------------------------------------------- what goes out */
  console.log('\nOnly the website is published');
  freshSite();
  r = build();
  is(r.code === 0, 'a real config.js: the build finishes', r.out.trim().split('\n').slice(-6).join(' | '));
  const top = fs.readdirSync(DIST).sort();
  const expected = ['.well-known', '_headers', 'admin.html', 'assets', 'config.js', 'google0123456789abcdef.html',
                    'images', 'index.html', 'manifest.webmanifest', 'sw.js'];
  is(JSON.stringify(top) === JSON.stringify(expected), 'dist/ holds the website and nothing else', top.join(' '));
  const all = walk(DIST);
  is(!all.some((f) => /\.(sql|md)$|^tools\/|^tests\/|^netlify|START-HERE|HOW-TO-UPLOAD|\.env$|notes-to-self/.test(f)),
     'no setup SQL, notes, tests, tools, function sources or stray files',
     all.filter((f) => /\.(sql|md)$|^tools\/|^tests\/|^netlify|\.env$|notes-to-self/.test(f)).join(' '));
  is(/Left out, as not part of the website: \.env, notes-to-self\.txt/.test(r.out),
     'the two stray files are named in the deploy log, so nothing is dropped silently', (r.out.match(/Left out.*/) || [''])[0]);
  is(/also published: \.well-known\//.test(r.out) && /also published: google0123456789abcdef\.html/.test(r.out),
     'an ownership file for Google and .well-known/ still go out, as before');
  is(!all.some((f) => /(^|\/)\.DS_Store$/.test(f)), 'system junk inside assets/ is not copied');

  const srcFiles = walk(path.join(SITE, 'assets')).filter((f) => !/(^|\/)\./.test(f)).map((f) => 'assets/' + f)
    .concat(walk(path.join(SITE, 'images')).map((f) => 'images/' + f))
    .concat(['config.js', 'sw.js', 'manifest.webmanifest']);
  const same = srcFiles.filter((f) => fs.existsSync(path.join(DIST, f)) &&
    sha(fs.readFileSync(path.join(DIST, f))).equals(sha(fs.readFileSync(path.join(SITE, f)))));
  is(same.length === srcFiles.length, 'every file of assets/ and images/, config.js, sw.js and the manifest, byte for byte',
     same.length + ' of ' + srcFiles.length);

  /* --------------------------------------------------------- fingerprints */
  console.log('\nScript and stylesheet addresses carry a fingerprint of the file');
  let stamps = 0, wrong = [];
  for (const page of ['index.html', 'admin.html']) {
    const html = read(path.join(DIST, page));
    html.replace(/<(?:script|link)\b[^>]*?\s(?:src|href)="([^"]+)"/g, (all, v) => {
      if (!/^\/?assets\//.test(v)) return all;
      const m = /^(\/?assets\/[^?#]+)\?v=([0-9a-f]{10})$/.exec(v);
      if (!m) { wrong.push(page + ': ' + v); return all; }
      const want = sha(fs.readFileSync(path.join(DIST, m[1].replace(/^\//, '')))).toString('hex').slice(0, 10);
      if (want !== m[2]) wrong.push(page + ': ' + v + ' (file says ' + want + ')');
      stamps++;
      return all;
    });
  }
  is(stamps === 59 && wrong.length === 0, 'all 59 in the two pages, each matching its file', stamps + ' / ' + wrong.slice(0, 3).join(', '));
  is(/59 script and stylesheet addresses fingerprinted/.test(r.out), 'and the deploy log says how many');
  const unstamp = (s) => s.replace(/\?v=[0-9a-f]{10}"/g, '"');
  is(unstamp(read(path.join(DIST, 'index.html'))) === read(path.join(SITE, 'index.html')),
     'index.html: nothing else in the page is changed');
  is(unstamp(read(path.join(DIST, 'admin.html'))) === read(path.join(SITE, 'admin.html')),
     'admin.html: nothing else either');
  is(/<script src="\/config\.js"><\/script>/.test(read(path.join(DIST, 'index.html'))),
     'config.js is left as it is: it is never stored, so it needs no fingerprint');

  /* ------------------------------------------------------------- policy */
  console.log('\nThe security policy');
  const headers = read(path.join(DIST, '_headers'));
  const policy = policyOf(headers);
  is(/^\/\*\n  Content-Security-Policy-Report-Only: /m.test(headers), 'dist/_headers sets it for every address, as report-only');
  is(headers.split('\n').filter((l) => /^\s+\S+:/.test(l)).length === 1, 'and sets nothing else, so nothing doubles up with netlify.toml');
  const want = inlineHashes(read(path.join(SITE, 'index.html'))).concat(inlineHashes(read(path.join(SITE, 'admin.html'))));
  const scripts = directive(policy, 'script-src') || [];
  is(want.length === 6 && want.every((h) => scripts.indexOf(h) > -1),
     'index.html\'s six inline scripts are each allowed by their exact contents', want.length + ' found');
  is(inlineHashes(read(path.join(SITE, 'admin.html'))).length === 0, 'admin.html has none left to allow');
  is(scripts.indexOf("'unsafe-inline'") < 0 && scripts.indexOf("'unsafe-eval'") < 0 && policy.indexOf('unsafe-eval') < 0,
     'no script may be written into a page, and no text run as code', scripts.join(' '));
  is(scripts.filter((s) => /^https?:/.test(s)).length === 0, 'and no script comes from another site: the libraries are this site\'s own');
  const connect = directive(policy, 'connect-src') || [];
  is(connect.indexOf('https://abcdefghijklmnop.supabase.co') > -1 && connect.indexOf('wss://abcdefghijklmnop.supabase.co') > -1,
     'data goes only to this shop\'s own Supabase (taken from config.js), and its live updates', connect.join(' '));
  is(!/\*\.supabase\.co/.test(policy), 'not to every Supabase project there is');
  is((directive(policy, 'frame-ancestors') || []).join() === "'none'" && (directive(policy, 'object-src') || []).join() === "'none'",
     'no framing, no plugins');
  is((directive(policy, 'report-uri') || []).join() === '/.netlify/functions/csp-report', 'reports go to the csp-report function');

  /* ------------------------------------------------------------ settings */
  console.log('\nRun again, and with the reports switched off');
  const before = walk(DIST).map((f) => f + ':' + sha(fs.readFileSync(path.join(DIST, f))).toString('hex')).join('\n');
  r = build();
  const after = walk(DIST).map((f) => f + ':' + sha(fs.readFileSync(path.join(DIST, f))).toString('hex')).join('\n');
  is(r.code === 0 && before === after, 'a second run makes exactly the same dist/');
  r = build({ CSP_REPORTS: 'off' });
  is(r.code === 0 && !/report-uri/.test(read(path.join(DIST, '_headers'))) && /reports switched off/.test(r.out),
     'CSP_REPORTS = off: the policy stays, the reports stop');

  /* ------------------------------------------------------------- windows */
  console.log('\nA copy saved on Windows');
  const lf = read(path.join(SITE, 'index.html'));
  fs.writeFileSync(path.join(SITE, 'index.html'), lf.replace(/\n/g, '\r\n'));
  r = build();
  const crlf = directive(policyOf(read(path.join(DIST, '_headers'))), 'script-src') || [];
  is(r.code === 0 && want.every((h) => crlf.indexOf(h) > -1),
     'line endings of \\r\\n give the same allowances, as a browser reads them as \\n');
  fs.writeFileSync(path.join(SITE, 'index.html'), lf);

  /* -------------------------------------------------------- left behind */
  console.log('\nA page that points at something the build did not publish');
  fs.writeFileSync(path.join(SITE, 'extra.js'), 'window.x = 1;');
  fs.writeFileSync(path.join(SITE, 'index.html'), lf.replace('</body>', '<script src="/extra.js"></script>\n</body>'));
  r = build();
  is(r.code === 1 && /extra\.js, which this build did not\s+publish/.test(r.out), 'a file left out of the list: stops, naming it',
     r.out.trim().split('\n')[1]);
  fs.writeFileSync(path.join(SITE, 'index.html'), lf.replace('</body>', '<script src="/assets/gone.js"></script>\n</body>'));
  r = build();
  is(r.code === 0 && /points at \/assets\/gone\.js, which does not exist/.test(r.out),
     'a file that exists nowhere: published, with a warning (an old mistake, not a new one)');
  fs.writeFileSync(path.join(SITE, 'index.html'), lf.replace('<button class="to-top"', '<button onclick="go()" class="to-top"'));
  r = build();
  is(r.code === 0 && /on…= handler written into a <button>/.test(r.out), 'an onclick= in the page: a warning, since the policy would block it');
  fs.writeFileSync(path.join(SITE, 'index.html'), lf);
  fs.unlinkSync(path.join(SITE, 'extra.js'));

  /* --------------------------------------------------------- the outputs */
  console.log('\nWhere it may write');
  r = build({}, ['--out', SITE]);
  is(r.code === 1 && !fs.existsSync(path.join(SITE, 'dist', 'nothing')) && fs.existsSync(path.join(SITE, 'index.html')),
     'never into the website folder itself');
  r = build({}, ['--out', TMP]);
  is(r.code === 1 && fs.existsSync(path.join(SITE, 'index.html')), 'nor into a folder that holds it');
  r = build({}, ['--out', path.join(TMP, 'public')]);
  is(r.code === 1 && /has to be called dist/.test(r.out), 'and only into a folder called dist');

  const local = path.join(TMP, 'local', 'dist');
  fs.writeFileSync(path.join(SITE, 'config.js'), "window.VBP_CONFIG = { SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_ANON_KEY: 'k' };");
  r = build({}, ['--out', local]);
  const lc = directive(policyOf(read(path.join(local, '_headers'))), 'connect-src') || [];
  is(r.code === 0 && lc.indexOf('ws://127.0.0.1:54321') > -1, 'a local Supabase (http) gets ws:, not wss:', lc.join(' '));

  /* ------------------------------------------------------- netlify.toml */
  console.log('\nnetlify.toml');
  const toml = read(path.join(ROOT, 'netlify.toml'));
  const buildBlock = /\n\[build\]\n([\s\S]*?)\n\[/.exec(toml);
  is(buildBlock && /^\s*command\s*=\s*"node tools\/build-site\.cjs"\s*$/m.test(buildBlock[1]) &&
     /^\s*publish\s*=\s*"dist"\s*$/m.test(buildBlock[1]), 'Netlify runs the build and publishes dist/');
  is(/included_files\s*=\s*\["config\.js", "assets\/formats\.js"\]/.test(toml), 'the functions still take config.js and formats.js with them');

  /* Each [[headers]] block: the address it is for, and the headers it sets. */
  const rules = toml.split(/\n\[\[headers\]\]\n/).slice(1).map((b) => ({
    for: (/^\s*for\s*=\s*"([^"]+)"/m.exec(b) || [])[1],
    names: (b.split(/\n\[\[|\n# /)[0].match(/^\s{4}([A-Za-z-]+)\s*=/gm) || []).map((s) => s.trim().replace(/\s*=$/, '').toLowerCase()),
  }));
  const star = rules.filter((x) => x.for === '/*')[0];
  is(star && ['x-content-type-options', 'x-frame-options', 'referrer-policy', 'permissions-policy'].every((h) => star.names.indexOf(h) > -1),
     'the four safety headers are set on every address', star ? star.names.join(', ') : 'no /* rule');
  is(/X-Content-Type-Options = "nosniff"/.test(toml) && /X-Frame-Options = "DENY"/.test(toml),
     'nosniff, and no framing');
  is(/Permissions-Policy = "camera=\(\), microphone=\(\), geolocation=\(\), payment=\(\), usb=\(\)"/.test(toml),
     'camera, microphone, location, payment sheet and USB refused (the site uses none of them)');
  const twice = [];
  rules.forEach((a, i) => rules.forEach((b, j) => {
    if (j <= i) return;
    const overlap = a.for === b.for || a.for === '/*' || b.for === '/*';
    if (overlap) a.names.forEach((n) => { if (b.names.indexOf(n) > -1) twice.push(n + ' (' + a.for + ', ' + b.for + ')'); });
  }));
  is(twice.length === 0, 'no header is set by two rules that match the same address', twice.join('; '));
  is(star && star.names.indexOf('content-security-policy-report-only') < 0 && star.names.indexOf('content-security-policy') < 0 &&
     star.names.indexOf('strict-transport-security') < 0,
     'nor in both netlify.toml and dist/_headers (the policy is only in _headers), and Netlify\'s own HSTS is left alone');
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}

console.log(failures ? '\n  ✗ ' + failures + ' of ' + checks + ' checks FAILED' : '\n  what Netlify publishes: all ' + checks + ' checks passed');
process.exit(failures ? 1 : 0);
