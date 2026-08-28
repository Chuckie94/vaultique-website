/* =====================================================================
   The details step: what a customer fills in before WhatsApp opens, and
   what the shop actually receives. window.open is captured so the exact
   message can be read back.
   ===================================================================== */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8160;

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')); } };

const PRODUCTS = [
  { name: 'Aurelia Silk Blouse', sku: 'WF-1', category: "Women's Fashion", price: 920,
    size: 'S', color: 'Cream', material: 'Silk', available: true, lowStock: false },
  { name: 'Gilt Chain Necklace', sku: 'AC-1', category: 'Accessories', price: 340,
    color: 'Gold', material: 'Brass', available: false, lowStock: false }
];
const GENERAL = { businessName: 'Vaultique Boutique Point', currency: 'ZMW',
  numberFormat: '1,234.56', dateFormat: 'DD/MM/YYYY', websiteStatus: 'live', maintenanceMode: false };
const CONTACT = { orderNumber: '+260 97 832 3036', enquiryNumber: '+260 96 353 9728',
  orderMessage: "Hello {business}, I'd like to buy: {product} (SKU: {sku}), {price}. Is it available?",
  enquiryMessage: 'Hello {business}, I have an enquiry.' };

const STUB = `
window.__rows = window.__rows || {}; window.__saves = [];
function tbl(name){var q={_v:null};
  q.select=function(){return q;};q.order=function(){return q;};q.eq=function(c,v){q._v=v;return q;};
  q.maybeSingle=function(){var r=window.__rows[name+':'+q._v];
    return Promise.resolve({data:r?JSON.parse(JSON.stringify(r)):null,error:null});};
  q.upsert=function(p){var id=p.key!==undefined?p.key:p.id;
    var c=JSON.parse(JSON.stringify(p));window.__rows[name+':'+id]={data:c.data};
    window.__saves.push({table:name,payload:p});return Promise.resolve({data:null,error:null});};
  q.then=function(f){return Promise.resolve({data:[],error:null}).then(f);};return q;}
window.supabase={createClient:function(){return{
  auth:{getSession:function(){return Promise.resolve({data:{session:{user:{id:'x'}}}});},
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

async function shop(browser, shopping, opts = {}) {
  const ctx = opts.context || await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  // capture where the shop tries to send the customer
  await page.addInitScript(() => {
    window.__opened = [];
    window.open = function (url) { window.__opened.push(url); return null; };
  });
  await page.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript',
    body: "window.VBP_CONFIG={SUPABASE_URL:'https://x.supabase.co',SUPABASE_ANON_KEY:'k'};" }));
  await page.route('**/fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('**/api/products', r => r.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ products: PRODUCTS }) }));
  await page.route('**/rest/v1/**', r => {
    const u = r.request().url();
    const j = x => ({ contentType: 'application/json', body: JSON.stringify(x) });
    if (u.includes('key=eq.shopping')) return r.fulfill(j(shopping ? [{ data: shopping }] : []));
    if (u.includes('key=eq.general')) return r.fulfill(j([{ data: GENERAL }]));
    if (u.includes('key=eq.contact')) return r.fulfill(j([{ data: CONTACT }]));
    if (u.includes('site_content')) return r.fulfill(j([{ data: {} }]));
    return r.fulfill(j([]));
  });
  await page.goto('http://127.0.0.1:' + PORT + '/index.html' + (opts.hash || '#/product/WF-1'));
  await page.waitForTimeout(950);
  return { page, ctx, errors };
}

const sent = page => page.evaluate(() => (window.__opened || []).map(decodeURIComponent));

(async () => {
  const srv = server();
  await new Promise(r => srv.listen(PORT, r));
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  console.log('\n== the details step, with the shipped defaults ==');
  {
    const { page, ctx, errors } = await shop(browser, null);
    ok('no page errors', errors.length === 0, errors);
    ok('the buy button is there', await page.isVisible('#buyDetail'));
    await page.click('#buyDetail');
    await page.waitForTimeout(200);
    ok('it opens the details step rather than WhatsApp',
       await page.evaluate(() => document.querySelector('#orderModal').classList.contains('open')));
    ok('nothing was opened yet', (await sent(page)).length === 0);
    ok('name and phone are asked for',
       await page.evaluate(() => !!document.querySelector('#od_name') && !!document.querySelector('#od_phone')));
    ok('email and address are not, by default',
       await page.evaluate(() => !document.querySelector('#od_email') && !document.querySelector('#od_address')));
    ok('and there is a notes box',
       await page.evaluate(() => !!document.querySelector('#od_notes')));

    await page.click('#odGo');
    await page.waitForTimeout(120);
    ok('an empty form is refused',
       (await page.textContent('#odMsg')).includes('your name'), await page.textContent('#odMsg'));
    ok('still nothing opened', (await sent(page)).length === 0);

    await page.fill('#od_name', 'Chanda Mwansa');
    await page.click('#odGo');
    await page.waitForTimeout(120);
    ok('a missing phone number is refused too',
       (await page.textContent('#odMsg')).includes('phone'), await page.textContent('#odMsg'));

    await page.fill('#od_phone', '+260 97 123 4567');
    await page.fill('#od_notes', 'Please call before delivery');
    await page.click('#odGo');
    await page.waitForTimeout(250);

    const opened = await sent(page);
    ok('WhatsApp is opened once', opened.length === 1, opened.length);
    const msg = opened[0] || '';
    ok('on the order number', msg.indexOf('https://wa.me/260978323036') === 0, msg.slice(0, 40));
    ok('the message names the piece', msg.includes('Aurelia Silk Blouse'));
    ok('carries the name', msg.includes('Name: Chanda Mwansa'), msg);
    ok('carries the phone number', msg.includes('Phone: +260 97 123 4567'));
    ok('carries the note', msg.includes('Notes: Please call before delivery'));
    ok('and does not carry what was never asked for',
       !msg.includes('Email:') && !msg.includes('Delivery address:'), msg);
    ok('the form closed itself',
       await page.evaluate(() => !document.querySelector('#orderModal').classList.contains('open')));
    await ctx.close();
  }

  console.log('\n== asking for everything ==');
  {
    const { page, ctx } = await shop(browser, {
      requireName: true, requirePhone: true, requireEmail: true, requireAddress: true, orderNotes: true
    });
    await page.click('#buyDetail');
    await page.waitForTimeout(200);
    await page.fill('#od_name', 'Chanda Mwansa');
    await page.fill('#od_phone', '0971234567');
    await page.fill('#od_email', 'not-an-email');
    await page.fill('#od_address', '12 Great East Road, Lusaka');
    await page.click('#odGo');
    await page.waitForTimeout(120);
    ok('a bad email address is refused',
       (await page.textContent('#odMsg')).includes('email address'), await page.textContent('#odMsg'));
    await page.fill('#od_email', 'chanda@example.com');
    await page.click('#odGo');
    await page.waitForTimeout(250);
    const msg = (await sent(page))[0] || '';
    ok('every answer reaches the message',
       msg.includes('Name: Chanda Mwansa') && msg.includes('Phone: 0971234567') &&
       msg.includes('Email: chanda@example.com') &&
       msg.includes('Delivery address: 12 Great East Road, Lusaka'), msg);
    ok('each on its own line, so it reads as an order',
       msg.split('\n').length >= 5, msg.split('\n').length);
    await ctx.close();
  }

  console.log('\n== asking for nothing ==');
  {
    const { page, ctx } = await shop(browser, {
      requireName: false, requirePhone: false, requireEmail: false, requireAddress: false, orderNotes: false
    });
    ok('the button is still an ordinary link to WhatsApp',
       (await page.getAttribute('#buyDetail', 'href')).indexOf('https://wa.me/260978323036') === 0);
    await page.click('#buyDetail');
    await page.waitForTimeout(200);
    ok('no details step appears',
       await page.evaluate(() => !document.querySelector('#orderModal').classList.contains('open')));
    await ctx.close();
  }

  console.log('\n== the details are remembered, not stored ==');
  {
    const ctx = await browser.newContext();
    const first = await shop(browser, null, { context: ctx });
    await first.page.click('#buyDetail');
    await first.page.waitForTimeout(200);
    await first.page.fill('#od_name', 'Chanda Mwansa');
    await first.page.fill('#od_phone', '+260 97 123 4567');
    await first.page.fill('#od_notes', 'Leave with the concierge');
    await first.page.click('#odGo');
    await first.page.waitForTimeout(250);

    const second = await shop(browser, null, { context: ctx });
    await second.page.click('#buyDetail');
    await second.page.waitForTimeout(250);
    ok('the name comes back on the next order',
       await second.page.inputValue('#od_name') === 'Chanda Mwansa');
    ok('so does the phone number',
       await second.page.inputValue('#od_phone') === '+260 97 123 4567');
    ok('but the note does not, since it belonged to that order',
       await second.page.inputValue('#od_notes') === '',
       await second.page.inputValue('#od_notes'));
    ok('it is kept in this browser only, never sent to the site',
       await second.page.evaluate(() =>
         Object.keys(localStorage).some(k => k === 'vbp_buyer')));
    await ctx.close();
  }

  console.log('\n== the button text ==');
  {
    const { page, ctx } = await shop(browser, { checkoutLabel: 'Order on WhatsApp' }, { hash: '#/shop' });
    const labels = await page.$$eval('#grid .btn-wa', e => e.map(x => x.textContent.trim()));
    ok('the wording is the shop’s own', labels.includes('Order on WhatsApp'), labels);
    ok('a sold-out piece still says Enquire', labels.includes('Enquire'), labels);
    await ctx.close();
  }

  console.log('\n== WhatsApp checkout switched off ==');
  {
    const { page, ctx, errors } = await shop(browser, { whatsappCheckout: false }, { hash: '#/shop' });
    ok('no page errors', errors.length === 0, errors);
    const labels = await page.$$eval('#grid .btn-wa', e => e.map(x => x.textContent.trim()));
    ok('nothing can be bought', !labels.some(l => /buy|order/i.test(l)), labels);
    ok('but a sold-out piece can still be asked about', labels.includes('Enquire'), labels);
    ok('prices are still shown, so it reads as a catalogue',
       (await page.$$eval('#grid .card-info .p', e => e.length)) === 2);
    await ctx.close();
  }
  {
    const { page, ctx } = await shop(browser, { whatsappCheckout: false, enquiries: false }, { hash: '#/shop' });
    ok('with enquiries off too, no WhatsApp buttons at all',
       (await page.$$eval('#grid .btn-wa', e => e.length)) === 0);
    await ctx.close();
  }

  console.log('\n== quick view goes the same way ==');
  {
    const { page, ctx } = await shop(browser, null, { hash: '#/shop' });
    await page.click('#grid .card .quick');
    await page.waitForTimeout(250);
    await page.click('#qvBuy');
    await page.waitForTimeout(250);
    ok('the quick view closes and the details step opens',
       await page.evaluate(() =>
         !document.querySelector('#qv').classList.contains('open') &&
         document.querySelector('#orderModal').classList.contains('open')));
    ok('nothing opened before the details were given', (await sent(page)).length === 0);
    await ctx.close();
  }

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
    await p.goto('http://127.0.0.1:' + PORT + '/admin.html#/settings/shopping');
    await p.waitForSelector('#f_checkoutLabel', { timeout: 6000 });
    await p.waitForTimeout(300);

    ok('no page errors', errors.length === 0, errors);
    const names = await p.evaluate(() =>
      Array.prototype.map.call(document.querySelectorAll('#setPage [id^=f_]'), e => e.id.slice(2)));
    const checkout = ['whatsappCheckout','checkoutLabel','requireName',
                      'requirePhone','requireEmail','requireAddress','orderNotes'];
    ok('all seven checkout settings are drawn',
       checkout.every(c => names.includes(c)), checkout.filter(c => !names.includes(c)));
    ok('which makes eighteen for the category', names.length === 18, names.length);

    /* Guest checkout used to sit here, switched off and waiting. Whether
       somebody may buy without an account is a question about accounts,
       so it moved to Settings > Customer Accounts rather than being
       answered in two places. */
    ok('guest checkout has gone',
       await p.evaluate(() => !document.querySelector('#f_guestCheckout')));
    ok('and this page says where',
       (await p.textContent('#setPage')).includes('Customer Accounts'),
       'no explanation found');

    await p.evaluate(() => document.querySelector('#f_whatsappCheckout').closest('.sw-row').click());
    await p.waitForTimeout(150);
    ok('turning checkout off hides what it would have asked for',
       await p.evaluate(() => ['checkoutLabel','requireName','requirePhone','orderNotes']
         .every(n => document.querySelector('#f_' + n).closest('.field').classList.contains('hide'))));
    await p.evaluate(() => document.querySelector('#f_whatsappCheckout').closest('.sw-row').click());
    await p.waitForTimeout(150);
    await p.fill('#f_checkoutLabel', '');
    await p.click('#setPage .save-bar .btn-gold');
    await p.waitForTimeout(150);
    ok('a button with no words on it is refused',
       await p.evaluate(() => document.querySelector('#f_checkoutLabel')
         .closest('.field').classList.contains('bad')));

    await p.fill('#f_checkoutLabel', 'Order on WhatsApp');
    await p.click('#setPage .save-bar .btn-gold');
    await p.waitForTimeout(300);
    const saved = await p.evaluate(() =>
      window.__saves.filter(s => s.payload.key === 'shopping').pop());
    ok('it saves', !!saved);
    ok('with the wording', saved && saved.payload.data.checkoutLabel === 'Order on WhatsApp');
    ok('and the checkout switches', saved && saved.payload.data.whatsappCheckout === true &&
       saved.payload.data.requireName === true, saved && saved.payload.data);
    ok('no page errors across the run', errors.length === 0, errors);
    await ctx.close();
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})();
