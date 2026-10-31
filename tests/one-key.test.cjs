/* ===========================================================================
   ONE NAME FOR EACH KEY -- netlify/functions/_seo-data.js (build 77, plan 3.4)

   SETUP.md asks for SUPABASE_SERVICE_ROLE_KEY. Until build 77 the nightly
   clean-up and the product pulse read WEB_SUPABASE_SERVICE_KEY instead, so
   on a shop that set only the first, the clean-up never ran and the visit
   records grew for ever (W-09). Every function now asks one helper, which
   understands either name, and admin-users.js finds the website the same
   way as everything else.
   =========================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');

let checks = 0, failures = 0;
const is = (c, m, x) => { checks++; if (c) console.log('  ✓ ' + m); else { failures++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); } };
const F = path.join(__dirname, '..', 'netlify', 'functions');
const fresh = (name) => { delete require.cache[require.resolve(path.join(F, name))]; return require(path.join(F, name)); };

(async () => {
  console.log('\nOne helper, either name');
  delete process.env.WEB_SUPABASE_SERVICE_KEY; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'the-documented-name';
  is(fresh('_seo-data').serviceKey() === 'the-documented-name' && fresh('_pay').serviceKey() === 'the-documented-name',
     'the name SETUP.md asks for is found');
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.WEB_SUPABASE_SERVICE_KEY = 'the-older-name';
  is(fresh('_seo-data').serviceKey() === 'the-older-name', 'and so is the name two functions used to read');
  delete process.env.WEB_SUPABASE_SERVICE_KEY;

  console.log('\nNo function reads a key or the website\'s address by itself');
  const strays = [];
  for (const f of fs.readdirSync(F).filter((n) => /\.js$/.test(n) && n !== '_seo-data.js')) {
    const src = fs.readFileSync(path.join(F, f), 'utf8');
    if (/process\.env\.(SUPABASE_SERVICE_ROLE_KEY|WEB_SUPABASE_SERVICE_KEY|WEB_SUPABASE_URL|WEB_SUPABASE_ANON_KEY|SITE_SUPABASE_URL|SITE_SUPABASE_ANON_KEY)/.test(src)) strays.push(f);
  }
  is(strays.length === 0, 'every function asks _seo-data.js', strays.join(', '));

  console.log('\nThe nightly clean-up, with only SUPABASE_SERVICE_ROLE_KEY set');
  let asked = null;
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => body += c);
    req.on('end', () => { asked = { path: req.url, auth: req.headers.authorization, body }; res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('12'); });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.WEB_SUPABASE_URL = 'http://127.0.0.1:' + server.address().port;
  process.env.WEB_SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  fresh('_seo-data');
  const r = await fresh('site-prune').handler();
  is(JSON.parse(r.body).message === 'pruned' && asked && asked.path === '/rest/v1/rpc/site_prune' && asked.auth === 'Bearer service-role',
     'it runs, with that key (W-09: before build 77 it said the key was missing and did nothing)', r.body);
  server.close();

  console.log('\nadmin-users.js finds the website the way everything else does');
  const src = fs.readFileSync(path.join(F, 'admin-users.js'), 'utf8');
  is(/require\('\.\/_seo-data'\)/.test(src) && !/readFileSync/.test(src), 'through _seo-data.js, not a reader of its own');

  console.log(failures ? '\n  ✗ ' + failures + ' of ' + checks + ' checks FAILED' : '\n  one name for each key: all ' + checks + ' checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('  ✗ the test itself failed: ' + (e && e.stack || e)); process.exit(1); });
