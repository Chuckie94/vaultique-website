/* =====================================================================
   Vaultique Boutique Point — checking the live website from outside
   ---------------------------------------------------------------------
   From the website folder, with Node 18 or later:

     node tools/live-check.cjs https://YOUR-SITE

   It asks the live website, the way any visitor's browser could:

     1. FILES THAT MUST NOT BE HANDED OUT. The setup SQL, the notes, the
        tests and tools, and the serverless functions' own source. Each
        must answer 404, or with the shop's own page. Anything else is
        the file itself, readable by anybody who guesses its name.
     2. THE SAFETY HEADERS on the shop and the admin.
     3. HOW THE REWARDS AND THE PRODUCT FEED READ THE PLATFORM, and
        whether the platform's secret key is still in Netlify.
     4. WHICH PAYMENT KEYS NETLIFY HOLDS: yes or no, never the keys.
     5. WHETHER THE FUNCTIONS CAN READ config.js, through the sitemap.

   READ ONLY. Ordinary GET requests to your own site; nothing is changed
   anywhere. The list of files comes from this folder, so it always checks
   the files this build actually has. A ✗ is something to fix; a ! is
   worth knowing. It ends non-zero when there is any ✗.
   ===================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BASE = String(process.argv[2] || '').trim().replace(/\/+$/, '');
const TIMEOUT_MS = 15000;
const AT_ONCE = 6;

if (!/^https?:\/\/[^/\s]+$/i.test(BASE)) {
  console.log('\nUsage: node tools/live-check.cjs https://YOUR-SITE\n' +
              '       (the address of the website, with nothing after it)\n');
  process.exit(2);
}
if (typeof fetch !== 'function') {
  console.log('\nThis needs Node 18 or later (it uses the built-in fetch).\n');
  process.exit(2);
}

let fails = 0, notes = 0;
const ok   = (m) => console.log('  ✓ ' + m);
const fail = (m) => { fails++; console.log('  ✗ ' + m); };
const note = (m) => { notes++; console.log('  ! ' + m); };

/* One GET. Reads the first part of the body only, so a big file costs a
   few hundred bytes rather than the whole download. */
async function peek(p) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(BASE + p, {
      signal: ctl.signal,
      headers: { 'User-Agent': 'vaultique-live-check', Accept: '*/*' },
    });
    let head = '';
    if (res.body && res.body.getReader) {
      const reader = res.body.getReader();
      const first = await reader.read();
      if (first.value) head = Buffer.from(first.value).toString('utf8', 0, Math.min(first.value.length, 400));
      try { await reader.cancel(); } catch (e) { /* already done */ }
    }
    return { status: res.status, headers: res.headers, head };
  } catch (e) {
    return { status: 0, headers: new Map(), head: '', error: e.name === 'AbortError' ? 'no answer in 15 s' : e.message };
  } finally {
    clearTimeout(timer);
  }
}

async function json(p) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(BASE + p, { signal: ctl.signal, headers: { 'User-Agent': 'vaultique-live-check' } });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch (e) { body = null; }
    return { status: res.status, body, text };
  } catch (e) {
    return { status: 0, body: null, text: '', error: e.message };
  } finally {
    clearTimeout(timer);
  }
}

/* 404 is a rule doing its job. The shop's own page is the catch-all
   answering for a file that is not there at all. Anything else is the
   file. */
function verdict(r) {
  if (r.status === 404) return 'blocked';
  if (r.status === 200 && /^\s*(<!doctype html|<html)/i.test(r.head)) return 'page';
  if (r.status === 200) return 'readable';
  return 'other';
}

async function inTurn(items, work) {
  const out = new Array(items.length);
  let next = 0;
  async function lane() {
    while (next < items.length) { const i = next++; out[i] = await work(items[i]); }
  }
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, items.length) }, lane));
  return out;
}

function list(dir, test) {
  try { return fs.readdirSync(path.join(ROOT, dir)).filter(test).sort(); } catch (e) { return []; }
}

async function checkFiles() {
  const groups = [
    { name: 'setup SQL files', paths: list('.', (f) => /^supabase-.*\.sql$/.test(f)).map((f) => '/' + f) },
    { name: 'notes and settings files',
      paths: ['/README.md', '/SETUP.md', '/LAUNCH.md', '/START-HERE.txt', '/HOW-TO-UPLOAD.txt', '/netlify.toml',
              // the Business Platform's working notes that builds before 74 carried
              '/DEFECT-FIX-PLAN-342.md', '/DEFECTS-342-ADDENDUM.md', '/PHASE-0-DECISIONS-342.md'] },
    { name: 'tests and tools',
      paths: list('tests', (f) => /\.(sql|cjs)$/.test(f)).slice(0, 4).map((f) => '/tests/' + f)
        .concat(list('tools', (f) => /\.cjs$/.test(f)).map((f) => '/tools/' + f))
        .concat(['/tools/phase-0-diagnose.cjs']) },
    { name: 'serverless function sources',
      paths: list(path.join('netlify', 'functions'), (f) => /\.(js|json)$/.test(f)).map((f) => '/netlify/functions/' + f) },
  ];

  console.log('\n1. Files that must not be handed out');
  for (const g of groups) {
    const seen = await inTurn(g.paths, async (p) => ({ p, r: await peek(p) }));
    const readable = seen.filter((s) => verdict(s.r) === 'readable');
    const odd = seen.filter((s) => verdict(s.r) === 'other');
    if (!readable.length && !odd.length) {
      ok(g.paths.length + ' ' + g.name + ': none readable');
      continue;
    }
    readable.forEach((s) => fail(s.p + ' is readable by anybody (200, begins "' +
      s.r.head.replace(/\s+/g, ' ').trim().slice(0, 40) + '")'));
    odd.forEach((s) => note(s.p + ' answered ' + (s.r.status || s.r.error)));
    const fine = seen.length - readable.length - odd.length;
    if (fine) ok(fine + ' other ' + g.name + ': not readable');
  }
}

async function checkHeaders() {
  console.log('\n2. Safety headers');
  const wanted = [
    ['x-content-type-options', (v) => /nosniff/i.test(v)],
    ['referrer-policy', (v) => !!v],
    ['permissions-policy', (v) => !!v],
    ['strict-transport-security', (v) => /max-age=\d+/i.test(v)],
  ];
  let missing = 0;
  for (const p of ['/', '/admin.html']) {
    const r = await peek(p);
    if (!r.status) { fail(p + ' could not be reached: ' + r.error); continue; }
    const h = (k) => r.headers.get(k) || '';
    const lacks = [];
    wanted.forEach(([k, good]) => { if (!good(h(k))) lacks.push(k); });
    const csp = h('content-security-policy') || h('content-security-policy-report-only');
    if (!csp) lacks.push('content-security-policy');
    if (!/frame-ancestors/i.test(csp) && !/deny|sameorigin/i.test(h('x-frame-options'))) lacks.push('x-frame-options (or frame-ancestors)');
    if (lacks.length) { missing += lacks.length; note(p + ' does not send: ' + lacks.join(', ')); }
    else ok(p + ' sends every safety header');
  }
  if (missing) note('Phase 1 of the plan (the next build) adds these. Until then this is expected.');
}

async function checkPlatform() {
  console.log('\n3. Rewards and the product feed');
  const rc = await json('/api/rewards-check');
  if (!rc.body) {
    note('/api/rewards-check did not answer (' + (rc.status || rc.error) + ')');
  } else {
    const b = rc.body;
    if (b.source === 'door') ok('rewards read through the door');
    else if (b.source === 'row') fail('rewards still read the whole business with the secret key: ' + (b.why || b.next || ''));
    else note('rewards cannot be read: ' + (b.why || b.next || b.source));
    if (b.secretKeyStillSet === true) fail('POS_SUPABASE_KEY is still set in Netlify. Once both lines here say "door", delete it and redeploy.');
    else if (b.secretKeyStillSet === false) ok('POS_SUPABASE_KEY is gone from Netlify');
  }

  const pr = await json('/api/products');
  if (!pr.body) {
    fail('/api/products did not answer with the feed (' + (pr.status || pr.error) + ')');
  } else if (pr.body.closed) {
    note('the product feed is empty because the shop is closed');
  } else if (pr.body.sourceUnreadable) {
    fail('the product feed cannot read the platform at all');
  } else {
    const n = pr.body.count != null ? pr.body.count : (pr.body.products || []).length;
    if (pr.body.source === 'door') ok('product feed reads through the door (' + n + ' pieces)');
    else if (pr.body.source === 'row') fail('product feed still reads with the secret key (' + n + ' pieces)');
    else note('product feed answered without saying how it read (' + n + ' pieces)');
  }
}

async function checkPayments() {
  console.log('\n4. Keys the functions hold (yes or no)');
  const r = await json('/.netlify/functions/pay-status?check=1');
  if (!r.body) { note('pay-status did not answer (' + (r.status || r.error) + ')'); return; }
  const b = r.body;
  if (b.service) ok('SUPABASE_SERVICE_ROLE_KEY is set');
  else fail('SUPABASE_SERVICE_ROLE_KEY is not set: online payment, staff logins, phone notifications and sign-up email all need it');
  if (b.formats === false) fail('assets/formats.js is not in the function bundle (netlify.toml included_files)');
  note('Flutterwave: test key ' + (b.test ? 'set' : 'not set') + ', live key ' + (b.live ? 'set' : 'not set') +
       ', webhook hash ' + (b.hash ? 'set' : 'not set') + '. Only matters if online payment is on.');
}

async function checkConfig() {
  console.log('\n5. Can the functions read config.js?');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(BASE + '/sitemap.xml', { signal: ctl.signal, headers: { 'User-Agent': 'vaultique-live-check' } });
    const xml = await res.text();
    const locs = (xml.match(/<loc>/g) || []).length;
    const policies = (xml.match(/<loc>[^<]*\/policies\/[^<]+<\/loc>/g) || []).length;
    if (!locs) note('/sitemap.xml has no addresses in it (' + res.status + ')');
    else if (policies) ok('the sitemap lists ' + policies + (policies === 1 ? ' individual policy' : ' individual policies') + ', so the functions read the settings');
    else note('the sitemap lists no individual policies: either the shop has none, or the functions cannot read config.js (README: "The website\'s own Supabase, as seen by the functions")');
  } catch (e) {
    note('/sitemap.xml could not be read: ' + e.message);
  } finally {
    clearTimeout(timer);
  }
}

(async () => {
  console.log('\nChecking ' + BASE + ' (read only)');
  const home = await peek('/');
  if (!home.status) {
    console.log('\n  The website could not be reached: ' + home.error +
                '\n  Check the address, and that this computer is online.\n');
    process.exit(2);
  }
  await checkFiles();
  await checkHeaders();
  await checkPlatform();
  await checkPayments();
  await checkConfig();
  console.log('\n  ' + (fails ? fails + ' to fix' : 'nothing to fix') + (notes ? ', ' + notes + ' worth knowing' : '') + '\n');
  process.exit(fails ? 1 : 0);
})();
