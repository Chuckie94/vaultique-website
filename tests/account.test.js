/* =====================================================================
   Settings > Customer Accounts.

   The first half of this file is not about the page at all. It is about
   the database rules underneath it, because customer accounts could not
   safely exist until those changed.

   Every policy used to say `auth.role() = 'authenticated'`, which in
   Supabase means ANYONE SIGNED IN. That was safe while the admin was the
   only person who could sign in at all. The first customer to register
   would have inherited write access to prices, settings, reviews,
   policies, the photo bucket and site_settings_private - the table
   holding the bank details, made private because those details are
   confidential.

   tests/rls-refuses.sql and tests/rls-allows.sql prove the fix against a
   real Postgres, and tests/RLS.md says how to run them. What is here is
   the cheap guard that runs every time: if that weak check is ever
   written back into the setup file, this fails.
   ===================================================================== */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8158;

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')); } };

const GENERAL = { businessName: 'Vaultique Boutique Point', currency: 'ZMW',
  numberFormat: '1,234.56', dateFormat: 'DD/MM/YYYY', timezone: 'Africa/Lusaka',
  websiteStatus: 'live', maintenanceMode: false };

const ON = { accountsEnabled: true, registration: 'open', guestCheckout: true,
  emailVerification: false, passwordMinLength: 8, passwordNeedsNumber: true,
  passwordReset: true, savedAddresses: true, maxAddresses: 5,
  orderHistory: true, historyScope: 'all', wishlistFollowsAccount: true,
  accountDeletion: true };

const PRODUCTS = [{ name: 'Aurelia Silk Blouse', sku: 'WF-1', category: "Women's Fashion",
  price: 900, size: 'S', color: 'Cream', material: 'Silk', available: true, lowStock: false }];

const STUB = `
window.__db = window.__db || {};
/* A real Supabase session is kept in localStorage and survives a reload.
   The stub does the same, so navigating to another page keeps somebody
   signed in exactly as it would for a customer. */
try { window.__user = window.__user || JSON.parse(localStorage.getItem('__stub_user') || 'null'); }
catch (e) { window.__user = window.__user || null; }
function remember(u) {
  window.__user = u;
  try {
    if (u) localStorage.setItem('__stub_user', JSON.stringify(u));
    else localStorage.removeItem('__stub_user');
  } catch (e) {}
}
try { window.__db = Object.keys(window.__db).length ? window.__db
        : JSON.parse(localStorage.getItem('__stub_db') || '{}'); } catch (e) {}
function save(){ try { localStorage.setItem('__stub_db', JSON.stringify(window.__db)); } catch (e) {} }
function rows(n){ if(!window.__db[n]) window.__db[n]=[]; return window.__db[n]; }
function ok(d){return Promise.resolve({data:d,error:null});}
function tbl(name){
  var q={_f:[],_sel:null,_single:false};
  q.select=function(s){q._sel=s;return q;};
  q.order=function(){return q;};q.limit=function(){return q;};q.gte=function(){return q;};
  q.eq=function(c,v){q._f.push([c,v]);return q;};
  q._rows=function(){return rows(name).filter(function(r){
    return q._f.every(function(f){return String(r[f[0]])===String(f[1]);});});};
  q.maybeSingle=function(){return ok(q._rows()[0]||null);};
  q.insert=function(r){var list=Array.isArray(r)?r:[r];
    list.forEach(function(x){x.id=x.id||('id'+Math.random().toString(36).slice(2,8));
      rows(name).push(x);}); save();
    var out={data:list,error:null};
    out.select=function(){return {maybeSingle:function(){return ok(list[0]);}};};
    out.then=function(f){return Promise.resolve({data:list,error:null}).then(f);};
    save();return out;};
  q.upsert=function(r,o){var key=(o&&o.onConflict)||'id';
    var i=rows(name).findIndex(function(x){return x[key]===r[key];});
    if(i>=0) Object.assign(rows(name)[i],r); else rows(name).push(r); save();
    return ok(null);};
  q.update=function(patch){var o={};o.eq=function(c,v){
    rows(name).filter(function(r){return String(r[c])===String(v);})
      .forEach(function(r){Object.assign(r,patch);});save();return ok(null);};
    o.then=function(f){return ok(null).then(f);};return o;};
  q.delete=function(){var o={};o.eq=function(c,v){
    window.__db[name]=rows(name).filter(function(r){return String(r[c])!==String(v);});
    save();return ok(null);};return o;};
  q.then=function(f){return ok(q._rows()).then(f);};
  return q;}
window.supabase={createClient:function(){return{
  auth:{
    getSession:function(){return ok({session: window.__user?{user:window.__user}:null});},
    onAuthStateChange:function(){return {data:{subscription:{unsubscribe:function(){}}}};},
    signUp:function(a){remember({id:'cust-1',email:a.email,email_confirmed_at:'2026-01-01'});
      return Promise.resolve({data:{user:window.__user,session:{user:window.__user}},error:null});},
    signInWithPassword:function(a){
      if(a.password!=='goodpass1') return Promise.resolve({data:null,error:{message:'Invalid login credentials'}});
      remember({id:'cust-1',email:a.email,email_confirmed_at:'2026-01-01'});
      return Promise.resolve({data:{user:window.__user},error:null});},
    signOut:function(){remember(null);return ok(null);},
    updateUser:function(){return ok(null);},
    resetPasswordForEmail:function(){return ok(null);}
  },
  from:tbl,
  storage:{from:function(){return{upload:function(){return ok(null);},
    getPublicUrl:function(){return{data:{publicUrl:''}};}};}}
}}};`;

function server() {
  return http.createServer((req, res) => {
    const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    fs.readFile(f, (e, d) => {
      if (e) { res.writeHead(404); res.end('no'); return; }
      res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' });
      res.end(d);
    });
  });
}

/* `seed` runs before any of the page's own scripts, so state set here
   survives the navigations a test makes. Setting it afterwards and then
   calling goto() wipes it, which is a fine way to write a test that
   fails for reasons that have nothing to do with the code. */
async function shop(browser, accounts, hash, shopping, seed) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  if (seed) await page.addInitScript(seed);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript',
    body: "window.VBP_CONFIG={SUPABASE_URL:'https://x.supabase.co',SUPABASE_ANON_KEY:'k'};" }));
  await page.route('**/fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('**/maps**', r => r.fulfill({ contentType: 'text/html', body: '' }));
  await page.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ contentType: 'text/javascript', body: STUB }));
  await page.route('**/api/products', r => r.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ products: PRODUCTS }) }));
  await page.route('**/rest/v1/**', r => {
    const u = r.request().url();
    const j = x => ({ contentType: 'application/json', body: JSON.stringify(x) });
    if (u.includes('key=eq.customer-accounts')) return r.fulfill(j(accounts ? [{ data: accounts }] : []));
    if (u.includes('key=eq.general')) return r.fulfill(j([{ data: GENERAL }]));
    if (u.includes('key=eq.shopping')) return r.fulfill(j(shopping ? [{ data: shopping }] : []));
    if (u.includes('site_content')) return r.fulfill(j([{ data: {} }]));
    return r.fulfill(j([]));
  });
  await page.goto('http://127.0.0.1:' + PORT + '/index.html' + (hash || ''));
  await page.waitForTimeout(1300);
  return { page, ctx, errors };
}

const signIn = async (page, pw) => {
  await page.fill('#ac_email', 'chanda@example.com');
  await page.fill('#ac_pw', pw || 'goodpass1');
  await page.click('#accountBody .btn-gold');
  await page.waitForTimeout(500);
};

/* ------------------------------------------------------------------ */
console.log('\n== the database rules that made this possible ==');
{
  const sql = fs.readFileSync(path.join(ROOT, 'supabase-setup.sql'), 'utf8');
  const live = sql.replace(/^\s*--[^\n]*$/gm, '');   // the comments explain the old way

  ok('no policy trusts merely being signed in',
     !/auth\.role\(\)\s*=\s*'authenticated'/.test(live),
     (live.match(/auth\.role\(\)[^\n]*/g) || []).slice(0, 3));
  ok('there is an admins table', /create table if not exists public\.admins/.test(sql));
  ok('and a test every policy can ask', /create or replace function public\.is_admin/.test(sql));
  ok('which reads the admins table', /from public\.admins a where a\.id = auth\.uid\(\)/.test(sql));

  /* Rewriting the rules must not lock the shop out of its own admin. */
  ok('existing logins are carried across',
     /insert into public\.admins[\s\S]{0,200}select id, email from auth\.users/.test(sql));
  /* But only once. Customers are rows in auth.users too, so a later
     re-run of the file would otherwise promote every one of them to
     administrator — quietly, and with nothing to show it had happened. */
  ok('and only while the admins table is empty, so a re-run cannot promote customers',
     /where not exists \(select 1 from public\.admins\)/.test(sql));

  ok('the bank details table asks is_admin',
     /ssp_admin[\s\S]{0,120}public\.is_admin\(\)/.test(sql));
  ok('so does the settings table', /ss_admin[\s\S]{0,120}public\.is_admin\(\)/.test(sql));
  ok('so does the photo bucket', /vbp_img_write[\s\S]{0,120}public\.is_admin\(\)/.test(sql));

  /* A customer owns their own rows and nobody else's. */
  ok('a customer row is theirs alone',
     /cu_own[\s\S]{0,160}auth\.uid\(\) = id[\s\S]{0,60}auth\.uid\(\) = id/.test(sql));
  ok('an order cannot be filed under somebody else',
     /or_insert[\s\S]{0,200}customer_id is null or customer_id = auth\.uid\(\)/.test(sql));
  ok('nor filed already confirmed', /or_insert[\s\S]{0,900}status = 'pending'/.test(sql));
  ok('a guest order has no owner to claim',
     /or_own[\s\S]{0,140}customer_id is not null and customer_id = auth\.uid\(\)/.test(sql));

  ok('the slower proof is checked in',
     fs.existsSync(path.join(ROOT, 'tests/rls-refuses.sql')) &&
     fs.existsSync(path.join(ROOT, 'tests/rls-allows.sql')));
}

/* Both sides carry the same list. */
console.log('\n== both sides declare the same settings ==');
{
  const read = (file, marker) => {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const i = src.indexOf(marker);
    const j = src.indexOf('\n  };', i);
    const block = src.slice(i, j).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    return [...block.matchAll(/(\w+):/g)].map(m => m[1]).sort();
  };
  const front = read('assets/app.js', 'var ACCOUNTS = {');
  const admin = read('assets/admin/settings/customer-accounts.js', 'var DEFAULTS = {');
  ok('the storefront knows every setting the admin offers',
     admin.every(k => front.includes(k)), admin.filter(k => !front.includes(k)));
  ok('and offers nothing the admin does not',
     front.every(k => admin.includes(k)), front.filter(k => !admin.includes(k)));
}

/* Guest checkout was in Shopping, parked and waiting for this section.
   Two pages owning one switch is how they start disagreeing. */
console.log('\n== guest checkout has exactly one home ==');
{
  const shopping = fs.readFileSync(path.join(ROOT, 'assets/admin/settings/shopping.js'), 'utf8');
  const accounts = fs.readFileSync(path.join(ROOT, 'assets/admin/settings/customer-accounts.js'), 'utf8');
  ok('Shopping no longer holds it', !/name: 'guestCheckout'/.test(shopping));
  ok('Customer Accounts does', /name: 'guestCheckout'/.test(accounts));
  ok('and Shopping says where it went', /guest checkout moved/i.test(shopping));
}

(async () => {
  const srv = server();
  await new Promise(r => srv.listen(PORT, r));
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  console.log('\n== a shop with accounts off ==');
  {
    const { page, ctx, errors } = await shop(browser, null, '#/account');
    ok('no page errors', errors.length === 0, errors);
    ok('there is no account button',
       await page.evaluate(() => getComputedStyle(document.getElementById('acctBtn')).display === 'none'));
    /* Asking for a page the shop does not have is not an error. */
    ok('asking for the account page lands on the home page',
       await page.evaluate(() => getComputedStyle(document.getElementById('view-home')).display !== 'none'));
    ok('and the account view stays out of sight',
       await page.evaluate(() => getComputedStyle(document.getElementById('view-account')).display === 'none'));
    await ctx.close();
  }

  console.log('\n== signing in ==');
  {
    const { page, ctx, errors } = await shop(browser, ON, '#/account');
    ok('no page errors', errors.length === 0, errors);
    ok('the account button appears',
       await page.evaluate(() => getComputedStyle(document.getElementById('acctBtn')).display !== 'none'));
    const tabs = await page.$$eval('.ac-tab', a => a.map(e => e.textContent));
    ok('both ways in are offered', tabs.join('|') === 'Sign in|Create an account', tabs);

    await signIn(page, 'wrong');
    /* Supabase says "Invalid login credentials", which is written for a
       developer rather than a customer. */
    ok('a wrong password is explained in plain words',
       (await page.textContent('.ac-msg')) === 'That email and password do not match.');

    await signIn(page);
    const cards = await page.$$eval('.ac-card h2', a => a.map(e => e.textContent));
    ok('signing in shows the account',
       cards.join('|') === 'Your details|Saved addresses|Your orders|Close your account', cards);
    ok('and the header says so',
       await page.evaluate(() => document.getElementById('acctBtn').classList.contains('is-in')));
    await ctx.close();
  }

  console.log('\n== registration can be closed ==');
  {
    const { page, ctx } = await shop(browser,
      Object.assign({}, ON, { registration: 'closed' }), '#/account');
    const tabs = await page.$$eval('.ac-tab', a => a.map(e => e.textContent));
    ok('no way to create one', tabs.join('|') === 'Sign in', tabs);
    ok('but signing in still works', tabs.includes('Sign in'));
    await ctx.close();
  }

  console.log('\n== password rules are said before they are enforced ==');
  {
    const { page, ctx } = await shop(browser,
      Object.assign({}, ON, { passwordMinLength: 10, passwordNeedsSymbol: true }), '#/account');
    await page.click('.ac-tab:nth-child(2)');
    await page.waitForTimeout(200);
    ok('the rule is stated up front',
       /at least 10 characters, a number, a symbol/.test(await page.textContent('.ac-rule')));
    await page.fill('#ac_pw2', 'short');
    await page.waitForTimeout(150);
    ok('and complains as they type', /at least 10/.test(await page.textContent('.ac-rule')));
    await page.fill('#ac_pw2', 'longenough1');
    await page.waitForTimeout(150);
    ok('a missing symbol is caught', /symbol/.test(await page.textContent('.ac-rule')));
    await page.fill('#ac_pw2', 'longenough1!');
    await page.waitForTimeout(150);
    ok('and a sound one is accepted', /will do/.test(await page.textContent('.ac-rule')));
    await ctx.close();
  }

  console.log('\n== saved addresses ==');
  {
    const { page, ctx, errors } = await shop(browser, ON, '#/account',
      { requireAddress: true, requirePhone: false, requireName: true });
    await signIn(page);
    await page.click('#accountBody button:has-text("Add an address")');
    await page.waitForTimeout(200);
    await page.fill('#ac_alabel', 'Home');
    await page.fill('#ac_arecip', 'Chanda Mwale');
    await page.fill('#ac_aaddr', '42 Kabulonga Road');
    await page.fill('#ac_acity', 'Lusaka');
    await page.check('.ac-check input');
    await page.click('.ac-inline .btn-gold');
    await page.waitForTimeout(500);

    const saved = await page.evaluate(() => window.__db.customer_addresses);
    ok('it saves', saved.length === 1, saved);
    ok('under the right customer', saved[0] && saved[0].customer_id === 'cust-1');
    ok('as the default', saved[0] && saved[0].is_default === true);
    ok('the form closes once saved',
       await page.evaluate(() => getComputedStyle(document.querySelector('.ac-inline')).display === 'none'));

    /* Somebody signed in has already told the shop all of this. Asking
       again is asking them to prove they can type. */
    await page.goto('http://127.0.0.1:' + PORT + '/index.html#/product/WF-1');
    await page.waitForTimeout(1300);
    await page.click('#buyDetail');
    await page.waitForTimeout(400);
    const pre = await page.evaluate(() => ({
      name: (document.querySelector('#od_name') || {}).value,
      address: (document.querySelector('#od_address') || {}).value
    }));
    ok('the checkout fills itself in from the account', pre.name === 'Chanda Mwale', pre);
    ok('including the address', /42 Kabulonga Road, Lusaka/.test(pre.address), pre);
    ok('no page errors', errors.length === 0, errors);
    await ctx.close();
  }

  console.log('\n== an order is recorded ==');
  {
    const { page, ctx, errors } = await shop(browser, ON, '#/account',
      { requireName: true, requirePhone: false });
    await signIn(page);
    await page.goto('http://127.0.0.1:' + PORT + '/index.html#/product/WF-1');
    await page.waitForTimeout(1300);
    await page.click('#buyDetail');
    await page.waitForTimeout(400);
    await page.fill('#od_name', 'Chanda M');
    await page.evaluate(() => { window.open = () => null; });
    await page.click('#odGo');
    await page.waitForTimeout(700);

    const orders = await page.evaluate(() => window.__db.orders);
    const items = await page.evaluate(() => window.__db.order_items);
    ok('one order is written', orders.length === 1, orders);
    /* A row records what somebody ASKED FOR. Nothing here is agreement,
       which is why it starts pending and the shop settles it. */
    ok('as pending', orders[0] && orders[0].status === 'pending');
    ok('with a reference somebody could say over a phone',
       orders[0] && /^VB-[A-Z2-9]{5}$/.test(orders[0].ref), orders[0] && orders[0].ref);
    ok('and it belongs to them', orders[0] && orders[0].customer_id === 'cust-1');
    /* The price is copied in, not looked up later: a piece reduced next
       week must not rewrite what was asked for today. */
    ok('the price is written down at the time', orders[0] && orders[0].total === 900);
    ok('the piece is listed', items.length === 1 && items[0].name === 'Aurelia Silk Blouse', items);
    ok('no page errors', errors.length === 0, errors);
    await ctx.close();
  }

  console.log('\n== a guest can still buy ==');
  {
    const { page, ctx, errors } = await shop(browser, ON, '#/product/WF-1',
      { requireName: true, requirePhone: false });
    await page.click('#buyDetail');
    await page.waitForTimeout(400);
    await page.fill('#od_name', 'A Guest');
    await page.evaluate(() => { window.open = () => null; });
    await page.click('#odGo');
    await page.waitForTimeout(700);
    const orders = await page.evaluate(() => window.__db.orders);
    ok('the sale goes through without an account', orders.length === 1, orders);
    /* No owner, so nobody can claim it later: the rules only let a
       customer read orders that are already theirs. */
    ok('and the order has no owner to be claimed', orders[0] && !orders[0].customer_id);
    ok('no page errors', errors.length === 0, errors);
    await ctx.close();
  }

  console.log('\n== guest checkout switched off ==');
  {
    const { page, ctx, errors } = await shop(browser,
      Object.assign({}, ON, { guestCheckout: false }), '#/product/WF-1',
      { requireName: true });
    await page.click('#buyDetail');
    await page.waitForTimeout(400);
    ok('the sale stops on the page, not at WhatsApp',
       /sign in to check out/i.test(await page.textContent('#orderBody .od-lead')));
    ok('with a way forward', await page.$('#odAcct') !== null);
    ok('no page errors', errors.length === 0, errors);
    await ctx.close();
  }

  console.log('\n== an unconfirmed email cannot check out ==');
  {
    const { page, ctx } = await shop(browser,
      Object.assign({}, ON, { emailVerification: true }), '#/product/WF-1',
      { requireName: true },
      /* Signed in, but the confirmation link never clicked. */
      () => { window.__user = { id: 'cust-1', email: 'chanda@example.com' }; });
    await page.click('#buyDetail');
    await page.waitForTimeout(400);
    ok('and is told why',
       /confirm your email/i.test(await page.textContent('#orderBody .od-lead')));
    await ctx.close();
  }

  console.log('\n== the wishlist follows the account ==');
  {
    /* Saved on this device before signing in, and already on the account
       from another one. Signing in should end with both, not whichever
       they signed in from. Seeded before the page runs so a signed-in
       session and a device list are both there from the first moment. */
    const { page, ctx, errors } = await shop(browser, ON, '', null, () => {
      localStorage.setItem('vbp_wishlist', JSON.stringify(['WF-1']));
      window.__user = { id: 'cust-1', email: 'chanda@example.com',
                        email_confirmed_at: '2026-01-01' };
      window.__db = { customers: [{ id: 'cust-1', wishlist: ['MF-9'] }] };
    });
    await page.waitForTimeout(900);
    const merged = await page.evaluate(() =>
      (window.__db.customers[0] || {}).wishlist);
    ok('the two are merged rather than one overwriting the other',
       merged && merged.indexOf('WF-1') > -1 && merged.indexOf('MF-9') > -1, merged);
    ok('no page errors', errors.length === 0, errors);
    await ctx.close();
  }

  console.log('\n== the admin page ==');
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await page.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript',
      body: "window.VBP_CONFIG={SUPABASE_URL:'https://x.supabase.co',SUPABASE_ANON_KEY:'k'};" }));
    await page.route('**/fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
    await page.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ contentType: 'text/javascript', body: STUB }));
    await page.route('**/api/products', r => r.fulfill({ contentType: 'application/json', body: '{"products":[]}' }));
    /* The admin needs somebody signed in, or it shows its login panel and
       none of the settings pages are drawn at all. */
    await page.addInitScript(() => {
      window.__user = { id: 'admin-1', email: 'owner@vaultique.test',
                        email_confirmed_at: '2026-01-01' };
    });
    await page.goto('http://127.0.0.1:' + PORT + '/admin.html#/settings/customer-accounts');
    await page.waitForTimeout(1300);

    ok('no page errors', errors.length === 0, errors);
    const groups = await page.$$eval('.card h3', a => a.map(e => e.textContent));
    ok('every group is drawn', groups.length === 6, groups);

    /* The one thing a shop must read before switching this on. */
    const notes = await page.$$eval('.note-field strong', a => a.map(e => e.textContent));
    ok('the SQL warning is first',
       /Run supabase-setup\.sql first/.test(notes[0] || ''), notes);

    ok('accounts start off',
       await page.evaluate(() => !document.querySelector('#f_accountsEnabled').checked));

    /* Off and off leaves no way to buy anything. */
    await page.evaluate(() => { document.querySelector('#f_guestCheckout').click(); });
    await page.waitForTimeout(250);
    await page.click('.save-bar .btn-gold');
    await page.waitForTimeout(300);
    ok('accounts off and guests off is refused',
       await page.evaluate(() => document.querySelector('#f_guestCheckout')
         .closest('.field').classList.contains('bad')));

    await page.evaluate(() => { document.querySelector('#f_accountsEnabled').click(); });
    await page.waitForTimeout(250);
    await page.selectOption('#f_registration', 'closed');
    await page.waitForTimeout(200);
    await page.click('.save-bar .btn-gold');
    await page.waitForTimeout(300);
    /* Guests barred and registration closed means nobody new can ever buy. */
    ok('closed registration with no guests is refused',
       await page.evaluate(() => document.querySelector('#f_registration')
         .closest('.field').classList.contains('bad')));

    await page.selectOption('#f_registration', 'open');
    await page.waitForTimeout(200);
    await page.click('.save-bar .btn-gold');
    await page.waitForTimeout(400);
    const saved = await page.evaluate(() =>
      (window.__db.site_settings || []).filter(r => r.key === 'customer-accounts')[0]);
    ok('a sound setting saves', !!saved && saved.data.accountsEnabled === true, saved);
    ok('the notes are not saved as settings',
       saved && !('sqlNote' in saved.data) && !('movedNote' in saved.data),
       saved && Object.keys(saved.data).filter(k => /Note$/.test(k)));

    /* The Orders tab is what makes a saved order worth showing anyone. */
    await page.goto('http://127.0.0.1:' + PORT + '/admin.html#/orders');
    await page.waitForTimeout(900);
    ok('there is an Orders tab',
       await page.$$eval('.tab', a => a.map(e => e.getAttribute('data-tab')))
         .then(t => t.indexOf('orders') > -1));
    ok('and it says what an order here actually is',
       /asked for/.test(await page.textContent('#tab-orders .hint')));
    await ctx.close();
  }

  await browser.close();
  srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
