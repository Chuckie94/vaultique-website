/* =====================================================================
   Settings > Payments.
   The point worth testing hardest: what is public and what is not.
   ===================================================================== */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8170;

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')); } };

const PRODUCTS = [{ name: 'Aurelia Silk Blouse', sku: 'WF-1', category: "Women's Fashion",
  price: 920, size: 'S', color: 'Cream', material: 'Silk', available: true, lowStock: false }];
const GENERAL = { businessName: 'Vaultique Boutique Point', currency: 'ZMW',
  numberFormat: '1,234.56', dateFormat: 'DD/MM/YYYY', websiteStatus: 'live', maintenanceMode: false };

/* The stand-in keeps the two tables apart and, like Supabase with the
   anon key, refuses the private one unless a session is present. */
const STUB = `
window.__rows = window.__rows || {}; window.__private = window.__private || {};
window.__saves = []; window.__privateSaves = []; window.__deniedReads = [];
function tbl(name){
  var q={_v:null};
  q.select=function(){return q;};q.order=function(){return q;};q.eq=function(c,v){q._v=v;return q;};
  q.maybeSingle=function(){
    if(name==='site_settings_private'){
      if(!window.__signedIn){ window.__deniedReads.push(q._v);
        return Promise.resolve({data:null,error:null}); }
      var pr=window.__private[q._v];
      return Promise.resolve({data:pr?JSON.parse(JSON.stringify(pr)):null,error:null});
    }
    var r=window.__rows[name+':'+q._v];
    return Promise.resolve({data:r?JSON.parse(JSON.stringify(r)):null,error:null});};
  q.upsert=function(p){
    var c=JSON.parse(JSON.stringify(p));
    if(name==='site_settings_private'){ window.__private[p.key]={data:c.data};
      window.__privateSaves.push(c); return Promise.resolve({data:null,error:null}); }
    var id=p.key!==undefined?p.key:p.id;
    window.__rows[name+':'+id]={data:c.data};
    window.__saves.push({table:name,payload:p});return Promise.resolve({data:null,error:null});};
  q.then=function(f){return Promise.resolve({data:[],error:null}).then(f);};return q;}
window.supabase={createClient:function(){return{
  auth:{getSession:function(){window.__signedIn=true;
        return Promise.resolve({data:{session:{user:{id:'x'}}}});},
        signOut:function(){return Promise.resolve();}},
  from:tbl,storage:{from:function(){return{upload:function(){return Promise.resolve({data:null,error:null});},
    getPublicUrl:function(){return{data:{publicUrl:''}};}};}}};}};`;

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

const PUBLIC_PAY = {
  cashEnabled: true, cashName: 'Cash', cashInstructions: 'Pay when you collect.',
  bankEnabled: true, bankName: 'Bank Transfer', bankInstructions: 'Transfer before dispatch.',
  mobileEnabled: true, mobileName: 'Mobile Money', mobileInstructions: 'Send to our mobile money account.',
  cardEnabled: false, cardName: 'Card Payment', cardInstructions: '',
  codEnabled: false, codName: 'Payment on Delivery', codInstructions: ''
};

(async () => {
  const srv = server();
  await new Promise(r => srv.listen(PORT, r));
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  /* --------------------------------------------------------- storefront */
  async function shop(pay) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    const asked = [];
    await page.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript',
      body: "window.VBP_CONFIG={SUPABASE_URL:'https://x.supabase.co',SUPABASE_ANON_KEY:'k'};" }));
    await page.route('**/fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
    await page.route('**/api/products', r => r.fulfill({ contentType: 'application/json',
      body: JSON.stringify({ products: PRODUCTS }) }));
    await page.route('**/rest/v1/**', r => {
      const u = r.request().url();
      asked.push(u);
      const j = x => ({ contentType: 'application/json', body: JSON.stringify(x) });
      if (u.includes('site_settings_private')) return r.fulfill({ status: 401,
        contentType: 'application/json', body: '{"message":"permission denied"}' });
      if (u.includes('key=eq.payments')) return r.fulfill(j(pay ? [{ data: pay }] : []));
      if (u.includes('key=eq.general')) return r.fulfill(j([{ data: GENERAL }]));
      if (u.includes('site_content')) return r.fulfill(j([{ data: { payments: ['Old', 'List'] } }]));
      return r.fulfill(j([]));
    });
    await page.goto('http://127.0.0.1:' + PORT + '/index.html');
    await page.waitForTimeout(950);
    return { page, ctx, errors, asked };
  }

  console.log('\n== the private table is never asked for by the website ==');
  {
    const { page, ctx, errors, asked } = await shop(PUBLIC_PAY);
    ok('no page errors', errors.length === 0, errors);
    ok('the storefront never requests site_settings_private',
       !asked.some(u => u.includes('site_settings_private')),
       asked.filter(u => u.includes('private')));
    const body = await page.content();
    ok('no bank account number could appear, because none was sent',
       !/\b\d{8,}\b/.test(body.replace(/wa\.me\/\d+/g, '').replace(/26097\d+/g, '')),
       'a long number is on the page');
    await ctx.close();
  }

  console.log('\n== what customers do see ==');
  {
    const { page, ctx } = await shop(PUBLIC_PAY);
    const row = await page.$$eval('#payRow span', e => e.map(x => x.textContent));
    ok('the footer lists the methods that are on',
       JSON.stringify(row) === JSON.stringify(['Cash', 'Bank Transfer', 'Mobile Money']), row);
    ok('and not the ones that are off',
       !row.includes('Card Payment') && !row.includes('Payment on Delivery'), row);
    /* How to pay used to be a card of its own with its own rules. It is a
       Customer Care panel now, like the other three, and borrows these
       instructions rather than being built separately. */
    const told = await page.evaluate(() => {
      const c = [...document.querySelectorAll('#careGrid .care-card')]
        .filter(x => /How to pay/.test(x.querySelector('h3').textContent))[0];
      return c ? c.querySelector('.care-body').textContent : null;
    });
    ok('the How to pay panel is shown', told !== null);
    ok('with the instructions for each', told && /Pay when you collect/.test(told) &&
       /Transfer before dispatch/.test(told), told);
    await ctx.close();
  }

  console.log('\n== renaming and switching off ==');
  {
    const { page, ctx } = await shop(Object.assign({}, PUBLIC_PAY, {
      cashName: 'Cash on collection', bankEnabled: false, codEnabled: true,
      codName: 'Pay the rider', codInstructions: 'Pay when it arrives.'
    }));
    const row = await page.$$eval('#payRow span', e => e.map(x => x.textContent));
    ok('a renamed method shows its new name', row.includes('Cash on collection'), row);
    ok('a method switched off disappears', !row.includes('Bank Transfer'), row);
    ok('a method switched on appears', row.includes('Pay the rider'), row);
    await ctx.close();
  }

  console.log('\n== before the section is ever opened ==');
  {
    const { page, ctx, errors } = await shop(null);
    ok('no page errors', errors.length === 0, errors);
    const row = await page.$$eval('#payRow span', e => e.map(x => x.textContent));
    ok('the old Site Content list still shows, so nothing goes blank',
       JSON.stringify(row) === JSON.stringify(['Old', 'List']), row);
    /* Nothing saved in Payments means the panel has nothing to explain,
       and a panel with nothing to say is worse than one fewer panel. */
    ok('and How to pay stays out of the way',
       await page.evaluate(() => ![...document.querySelectorAll('#careGrid .care-card')]
         .some(x => /How to pay/.test(x.querySelector('h3').textContent))));
    await ctx.close();
  }

  console.log('\n== nothing accepted at all ==');
  {
    const { page, ctx } = await shop({ cashEnabled: false, bankEnabled: false,
      mobileEnabled: false, cardEnabled: false, codEnabled: false });
    ok('the footer row hides rather than showing an empty strip',
       await page.evaluate(() => document.querySelector('#payRow').classList.contains('hide')));
    await ctx.close();
  }

  /* -------------------------------------------------------------- admin */
  console.log('\n== the admin section ==');
  {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', e => errors.push(String(e)));
    p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await p.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript',
      body: "window.VBP_CONFIG={SUPABASE_URL:'https://x.supabase.co',SUPABASE_ANON_KEY:'k'};" }));
    await p.route('**/@supabase/supabase-js**', r => r.fulfill({ contentType: 'text/javascript', body: STUB }));
    await p.route('**/fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
    await p.route('**/api/products', r => r.fulfill({ contentType: 'application/json', body: '{"products":[]}' }));
    await p.goto('http://127.0.0.1:' + PORT + '/admin.html#/settings/payments');
    await p.waitForSelector('#f_cashName', { timeout: 6000 });
    await p.waitForTimeout(300);

    ok('no page errors', errors.length === 0, errors);
    const names = await p.evaluate(() =>
      Array.prototype.map.call(document.querySelectorAll('#setPage [id^=f_]'), e => e.id.slice(2)));
    ok('five methods, each with a switch, a name and instructions',
       ['cash','bank','mobile','card','cod'].every(k =>
         names.includes(k + 'Enabled') && names.includes(k + 'Name') && names.includes(k + 'Instructions')),
       names);
    ok('the bank fields are there',
       ['bankAccountBank','bankAccountName','bankAccountNumber','bankBranch','bankBranchCode']
         .every(n => names.includes(n)), names);
    ok('and the mobile money list', names.includes('mobileAccounts'));

    ok('the private groups are marked as such',
       (await p.$$eval('#setPage .shut-head', e => e.map(x => x.textContent))).length === 2,
       await p.$$eval('#setPage .shut-head', e => e.map(x => x.textContent)));

    console.log('\n== the mobile money list ==');
    ok('it starts empty', await p.evaluate(() =>
       document.querySelectorAll('#f_mobileAccounts .list-row').length) === 0);
    await p.click('#setPage .list-add');
    await p.waitForTimeout(150);
    ok('a row can be added', await p.evaluate(() =>
       document.querySelectorAll('#f_mobileAccounts .list-row').length) === 1);
    await p.click('#setPage .list-add');
    await p.waitForTimeout(150);
    ok('and another, so Airtel and MTN are rows not settings',
       await p.evaluate(() => document.querySelectorAll('#f_mobileAccounts .list-row').length) === 2);

    await p.evaluate(() => {
      const rows = document.querySelectorAll('#f_mobileAccounts .list-row');
      const set = (row, sel, val) => {
        const e = row.querySelector(sel);
        e.value = val;
        e.dispatchEvent(new Event(e.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
      };
      set(rows[0], 'select', 'Airtel Money');
      set(rows[0], 'input[id*="number"]', '+260 97 832 3036');
      set(rows[0], 'input[id*="name"]', 'Vaultique Boutique');
      set(rows[1], 'select', 'MTN Money');
      set(rows[1], 'input[id*="number"]', '+260 96 353 9728');
      set(rows[1], 'input[id*="name"]', 'Vaultique Boutique');
    });
    await p.waitForTimeout(150);
    ok('each row is titled by what is in it',
       (await p.$$eval('#f_mobileAccounts .list-cap', e => e.map(x => x.textContent)))
         .join('|').includes('Airtel Money · +260 97 832 3036'),
       await p.$$eval('#f_mobileAccounts .list-cap', e => e.map(x => x.textContent)));

    await p.evaluate(() => document.querySelectorAll('#f_mobileAccounts .list-drop')[1].click());
    await p.waitForTimeout(150);
    ok('a row can be removed', await p.evaluate(() =>
       document.querySelectorAll('#f_mobileAccounts .list-row').length) === 1);
    await p.click('#setPage .list-add');
    await p.waitForTimeout(120);
    await p.evaluate(() => {
      const row = document.querySelectorAll('#f_mobileAccounts .list-row')[1];
      const set = (sel, val) => { const e = row.querySelector(sel); e.value = val;
        e.dispatchEvent(new Event(e.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); };
      set('select', 'MTN Money');
      set('input[id*="number"]', '+260 96 353 9728');
      set('input[id*="name"]', 'Vaultique Boutique');
    });
    await p.waitForTimeout(150);

    console.log('\n== instructions are public, and the section says so ==');
    await p.fill('#f_bankInstructions', 'Send to account 0123456789 at our bank');
    await p.click('#setPage .save-bar .btn-gold');
    await p.waitForTimeout(200);
    ok('an account number typed into public instructions is caught',
       await p.evaluate(() => document.querySelector('#f_bankInstructions')
         .closest('.field').classList.contains('bad')));
    // scoped to this field's own error line: a comma selector would pick up
    // the first empty one on the page instead
    const why = await p.evaluate(() => {
      const line = document.querySelector('#f_bankInstructions').closest('.field').querySelector('.err-txt');
      return line ? line.textContent : '';
    });
    ok('and the reason is given', /never sees|public/i.test(why), why);
    await p.fill('#f_bankInstructions', 'Transfer before dispatch. We will send details on WhatsApp.');

    console.log('\n== saving splits the two halves ==');
    await p.fill('#f_bankAccountBank', 'Zanaco');
    await p.fill('#f_bankAccountName', 'Vaultique Boutique Point Ltd');
    await p.fill('#f_bankAccountNumber', '0123456789012');
    await p.fill('#f_bankBranch', 'Manda Hill');
    await p.fill('#f_bankBranchCode', '010');
    await p.click('#setPage .save-bar .btn-gold');
    await p.waitForTimeout(400);
    ok('it saves', (await p.textContent('#setPage .save-bar .stat')).includes('Saved'),
       await p.textContent('#setPage .save-bar .stat'));

    const pub = await p.evaluate(() =>
      window.__saves.filter(s => s.payload.key === 'payments').pop());
    const shut = await p.evaluate(() => window.__privateSaves.pop());

    ok('the public row carries the method names', pub && pub.payload.data.bankName === 'Bank Transfer');
    ok('and the instructions', pub && /Transfer before dispatch/.test(pub.payload.data.bankInstructions));
    ok('the public row carries NO account number',
       pub && !('bankAccountNumber' in pub.payload.data) &&
       !JSON.stringify(pub.payload.data).includes('0123456789012'),
       pub && Object.keys(pub.payload.data));
    ok('and NO mobile money numbers',
       pub && !('mobileAccounts' in pub.payload.data) &&
       !JSON.stringify(pub.payload.data).includes('832 3036'),
       pub && Object.keys(pub.payload.data));

    ok('the private row went to the private table', !!shut && shut.key === 'payments');
    ok('with the account number', shut && shut.data.bankAccountNumber === '0123456789012');
    ok('the branch and code', shut && shut.data.bankBranch === 'Manda Hill' &&
       shut.data.bankBranchCode === '010');
    ok('and both mobile money accounts',
       shut && shut.data.mobileAccounts.length === 2 &&
       shut.data.mobileAccounts[0].provider === 'Airtel Money' &&
       shut.data.mobileAccounts[1].provider === 'MTN Money',
       shut && shut.data.mobileAccounts);

    console.log('\n== reopening ==');
    await p.evaluate(() => { window.VBP_ADMIN.store.forget(); location.hash = '#/settings'; });
    await p.waitForTimeout(200);
    await p.evaluate(() => { location.hash = '#/settings/payments'; });
    await p.waitForSelector('#f_bankAccountNumber');
    await p.waitForTimeout(350);
    ok('the private details come back for the admin',
       await p.inputValue('#f_bankAccountNumber') === '0123456789012',
       await p.inputValue('#f_bankAccountNumber'));
    ok('so do the mobile money rows',
       await p.evaluate(() => document.querySelectorAll('#f_mobileAccounts .list-row').length) === 2);

    console.log('\n== refusing to leave customers stranded ==');
    await p.evaluate(() => {
      ['cash','bank','mobile','card','cod'].forEach(k => {
        const box = document.querySelector('#f_' + k + 'Enabled');
        if (box.checked) box.closest('.sw-row').click();
      });
    });
    await p.waitForTimeout(200);
    await p.click('#setPage .save-bar .btn-gold');
    await p.waitForTimeout(200);
    ok('accepting nothing at all is refused',
       await p.evaluate(() => document.querySelector('#f_cashEnabled')
         .closest('.field').classList.contains('bad')));
    ok('no page errors across the run', errors.length === 0, errors);
    await ctx.close();
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})();
