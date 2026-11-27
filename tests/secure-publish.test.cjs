/* ===========================================================================
   WHAT MUST NEVER BE PUBLISHED, AND WHICH SCRIPTS MAY RUN (website build 88)

   The security advice the owner passed on: keep every secret key on the
   server, never in what a browser can read; never take card details on the
   website itself; and send a policy that stops other sites' scripts running
   on the checkout. tools/build-site.cjs now refuses to publish a build that
   holds a secret key or a card field (step 8), and sends the scripts part of
   the policy enforced (step 7).

   Each drill puts the fault in on purpose, in a copy of the website in a
   temporary folder (this folder is never touched), runs the build exactly
   as Netlify does, and checks it is caught, naming the file and the
   setting, never the key itself.
   =========================================================================== */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BUILD = path.join(ROOT, 'tools', 'build-site.cjs');
let checks = 0, failures = 0;
const is = (c, m, x) => { checks++; if (c) console.log('  ✓ ' + m); else { failures++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); } };

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vbp-secure-'));
const SITE = path.join(TMP, 'site');
const DIST = path.join(SITE, 'dist');
const jwt = (payload) => [{ alg: 'HS256', typ: 'JWT' }, payload].map((o) => Buffer.from(JSON.stringify(o)).toString('base64url')).join('.') +
  '.c2lnbmF0dXJlLW9mLXRoZS10b2tlbg';
const ANON = jwt({ iss: 'supabase', ref: 'abcdefghijklmnop', role: 'anon', iat: 1700000000, exp: 2000000000 });
const SERVICE = jwt({ iss: 'supabase', ref: 'abcdefghijklmnop', role: 'service_role', iat: 1700000000, exp: 2000000000 });
const config = (key) => "window.VBP_CONFIG = {\n  SUPABASE_URL: 'https://abcdefghijklmnop.supabase.co',\n" +
                        "  SUPABASE_ANON_KEY: '" + key + "',\n  IMAGE_BUCKET: 'product-images'\n};\n";

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
function freshSite() {
  fs.rmSync(SITE, { recursive: true, force: true });
  fs.mkdirSync(SITE, { recursive: true });
  for (const n of ['index.html', 'admin.html', 'sw.js', 'manifest.webmanifest', 'assets', 'images']) copy(path.join(ROOT, n), path.join(SITE, n));
  copy(BUILD, path.join(SITE, 'tools', 'build-site.cjs'));
  fs.writeFileSync(path.join(SITE, 'config.js'), config(ANON));
}
const SECRETS = { FLW_SECRET_KEY_LIVE: 'FLWSECK-livekey0123456789abcdef-X', LENCO_SECRET_KEY_LIVE: 'lenco-live-api-token-0123456789',
                  SUPABASE_SERVICE_ROLE_KEY: SERVICE, LENCO_PUBLIC_KEY_LIVE: 'pub-live-key-shown-to-browsers' };
function build(env) {
  const r = spawnSync(process.execPath, [path.join(SITE, 'tools', 'build-site.cjs'), '--root', SITE, '--out', DIST],
    { cwd: SITE, encoding: 'utf8', env: Object.assign({}, process.env, { CSP_REPORTS: '', CSP_SCRIPTS: '', VBP_IN_GATE: '1' }, SECRETS, env || {}) });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
const leaks = (out) => Object.keys(SECRETS).filter((k) => k !== 'LENCO_PUBLIC_KEY_LIVE' && out.indexOf(SECRETS[k]) > -1);

try {
  console.log('\nThe website as it is: published, with the scripts part enforced');
  freshSite();
  let r = build();
  is(r.code === 0, 'it builds, with the secret keys set in the environment as Netlify sets them', r.out.split('\n').slice(-4).join(' | '));
  is(/Checked: no secret key and no card field in anything published/.test(r.out), 'the log says what was checked');
  is(/Scripts: enforced/.test(r.out), 'and that only this site, its inline scripts and Lenco\'s window may run scripts');
  const headers = fs.readFileSync(path.join(DIST, '_headers'), 'utf8');
  is(/^\s+Content-Security-Policy: script-src 'self' 'sha256-[^;]+https:\/\/pay\.lenco\.co https:\/\/pay\.sandbox\.lenco\.co; object-src 'none'; base-uri 'self'; frame-ancestors 'none'/m.test(headers),
     'dist/_headers: the scripts part, enforced', headers.split('\n').filter((l) => /Content-Security-Policy:/.test(l))[0]);
  is(/^\s+Content-Security-Policy-Report-Only: default-src/m.test(headers), 'beside the whole policy, still report-only');

  console.log('\nCSP_SCRIPTS = report: the scripts part back to report-only, said loudly');
  r = build({ CSP_SCRIPTS: 'report' });
  const h2 = fs.readFileSync(path.join(DIST, '_headers'), 'utf8');
  is(r.code === 0 && !/^\s+Content-Security-Policy:/m.test(h2) && /^\s+Content-Security-Policy-Report-Only:/m.test(h2),
     'no enforced line, the report-only policy as before');
  is(/! Scripts: report-only too, because Netlify holds CSP_SCRIPTS = report/.test(r.out), 'and the log says why, with a !');

  console.log('\nDrills: a secret key in what would be published');
  freshSite();
  fs.writeFileSync(path.join(SITE, 'assets', 'extra-pay.js'), "var k = '" + SECRETS.LENCO_SECRET_KEY_LIVE + "';\n");
  r = build();
  is(r.code !== 0 && /BUILD STOPPED: assets\/extra-pay\.js holds the value of LENCO_SECRET_KEY_LIVE, a secret key/.test(r.out),
     'Lenco\'s API token in a script: stopped, naming the file and the setting', r.out.split('\n').filter((l) => /STOPPED/.test(l)).join(' | '));
  is(leaks(r.out).length === 0, 'and the log never shows the key itself', leaks(r.out).join(', '));

  freshSite();
  fs.writeFileSync(path.join(SITE, 'index.html'), fs.readFileSync(path.join(SITE, 'index.html'), 'utf8')
    .replace('</body>', '<!-- ' + SECRETS.FLW_SECRET_KEY_LIVE + ' -->\n</body>'));
  r = build();
  is(r.code !== 0 && /index\.html holds the value of FLW_SECRET_KEY_LIVE/.test(r.out), 'Flutterwave\'s live secret key in a page, even in a comment: stopped');

  freshSite();
  fs.writeFileSync(path.join(SITE, 'assets', 'old-test.js'), "var flw = 'FLWSECK_TEST-0123456789abcdef-X';\n");
  r = build();
  is(r.code !== 0 && /assets\/old-test\.js holds what looks like a Flutterwave secret key/.test(r.out),
     'a Flutterwave secret key Netlify does not even hold (an old test key): stopped by its shape');

  freshSite();
  fs.writeFileSync(path.join(SITE, 'config.js'), config(SERVICE));
  r = build({ SUPABASE_SERVICE_ROLE_KEY: '' });
  is(r.code !== 0 && /config\.js holds a Supabase service key \(its role is service_role\)/.test(r.out),
     'the service key pasted into config.js instead of the public one: stopped by what it is, even with Netlify not holding it');

  freshSite();
  fs.writeFileSync(path.join(SITE, 'assets', 'pub.js'), "var lencoPublic = '" + SECRETS.LENCO_PUBLIC_KEY_LIVE + "';\n");
  r = build();
  is(r.code === 0, 'a PUBLIC key (Lenco\'s, for its window) is not a secret: the build goes ahead');
  r = build({ FLW_WEBHOOK_HASH: 'Vaultique Boutique' });
  is(r.code === 0 && /has the words of FLW_WEBHOOK_HASH in it/.test(r.out),
     'a webhook phrase that is also words on the page: named in the log, never a stop', r.out.split('\n').filter((l) => /FLW_WEBHOOK_HASH/.test(l)).join(' | '));

  console.log('\nDrills: a card field on the website');
  freshSite();
  fs.writeFileSync(path.join(SITE, 'index.html'), fs.readFileSync(path.join(SITE, 'index.html'), 'utf8')
    .replace('</body>', '<input type="text" autocomplete="cc-number">\n</body>'));
  r = build();
  is(r.code !== 0 && /BUILD STOPPED: index\.html has a box for a card number, expiry or security code/.test(r.out),
     'a card number box in a page: stopped');
  freshSite();
  fs.writeFileSync(path.join(SITE, 'assets', 'pay-form.js'), "box.innerHTML = '<input id=\"cvv\" maxlength=\"4\">';\n");
  r = build();
  is(r.code !== 0 && /assets\/pay-form\.js has a box for a card number/.test(r.out), 'a security-code box written by a script: stopped');
  freshSite();
  r = build();
  is(r.code === 0, 'and the website as it is has none: Lenco\'s window takes the card, never this site');
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}

console.log(failures ? '\n  ✗ ' + failures + ' of ' + checks + ' checks FAILED'
                     : '\n  what must never be published: all ' + checks + ' checks passed');
process.exit(failures ? 1 : 0);
