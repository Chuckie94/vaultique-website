/* ===========================================================================
   EVERY SQL FILE KEPT FROM VISITORS (website build 78)

   The publish directory is the whole folder, so a setup file answers to
   anyone who asks for it by name unless netlify.toml says otherwise. Build 77
   hid 25 of its 30; five older ones still answered. This reads netlify.toml
   as Netlify does and checks every supabase-*.sql in the folder, the new one
   included, has its own rule: 404, forced, and before the catch-all that
   would otherwise serve the page in its place. A file added later without
   a rule fails here.
   =========================================================================== */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

let checks = 0, failures = 0;
const is = (c, m, x) => { checks++; if (c) console.log('  ✓ ' + m); else { failures++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); } };

/* netlify.toml's [[redirects]], read the way Netlify reads them: in order. */
const toml = fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8');
const rules = [];
let cur = null;
toml.split(/\r?\n/).forEach(line => {
  const l = line.replace(/#.*$/, '').trim();
  if (/^\[\[redirects\]\]$/.test(l)) { cur = {}; rules.push(cur); return; }
  if (/^\[/.test(l)) { cur = null; return; }
  const m = /^(\w+)\s*=\s*(.+)$/.exec(l);
  if (cur && m) cur[m[1]] = m[2].replace(/^"|"$/g, '');
});
const files = fs.readdirSync(ROOT).filter(f => /^supabase-.*\.sql$/.test(f)).sort();
const catchAll = rules.findIndex(r => r.from === '/*');

is(files.length >= 31 && files.indexOf('supabase-order-progress.sql') > -1,
   'the folder has its ' + files.length + ' SQL files, the new one among them');
const missing = [], wrong = [];
files.forEach(f => {
  const i = rules.findIndex(r => r.from === '/' + f);
  if (i < 0) { missing.push(f); return; }
  const r = rules[i];
  if (r.status !== '404' || r.force !== 'true' || (catchAll > -1 && i > catchAll)) wrong.push(f + ' ' + JSON.stringify(r));
});
is(missing.length === 0, 'every SQL file has its own rule', missing.join(', '));
is(wrong.length === 0, 'each rule answers 404, forced, before the catch-all', wrong.join(' | '));
is(['supabase-browsing-towns.sql', 'supabase-cart-pieces.sql', 'supabase-new-arrivals.sql', 'supabase-signup.sql',
    'supabase-sold-out.sql'].every(f => rules.some(r => r.from === '/' + f)),
   'the five build 77 left answering are hidden now');
is(catchAll === rules.length - 1, 'the catch-all is still the last rule, so nothing after it is lost');

console.log(failures ? '\n  ✗ ' + failures + ' of ' + checks + ' checks FAILED' : '\n  SQL files kept from visitors: all ' + checks + ' checks passed');
process.exit(failures ? 1 : 0);
