/* =====================================================================
   Contact & Social, both halves.
     1. the shared module's own sums, in node
     2. the admin section
     3. every contact link on the storefront, because those links are
        how customers actually reach the shop
   ===================================================================== */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8140;

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')); } };

/* ---------------------------------------------------------------- unit */
global.window = {};
require(path.join(ROOT, 'assets', 'contact.js'));
const C = global.window.VBP_CONTACT;

console.log('\n== numbers survive however they are typed ==');
ok('an international number', C.waDigits('+260 97 832 3036') === '260978323036');
ok('a local number given the dialling code',
   C.waDigits('0978323036', '260') === '260978323036', C.waDigits('0978323036', '260'));
ok('a local number with spaces', C.waDigits('097 832 3036', '+260') === '260978323036');
ok('already-bare digits are left alone', C.waDigits('260978323036') === '260978323036');
ok('nothing in, nothing out', C.waDigits('') === '');
ok('a tel link keeps the plus', C.telHref('+260 97 832 3036') === 'tel:+260978323036');
ok('no number means no link', C.telHref('') === '' && C.waUrl('', 'hi') === '');

console.log('\n== handles ==');
ok('a bare handle', C.socialUrl('instagram', 'vaultique') === 'https://instagram.com/vaultique');
ok('an @ is dropped', C.socialUrl('instagram', '@vaultique') === 'https://instagram.com/vaultique');
ok('a pasted domain is not doubled up',
   C.socialUrl('instagram', 'instagram.com/vaultique') === 'https://instagram.com/vaultique',
   C.socialUrl('instagram', 'instagram.com/vaultique'));
ok('a pasted www domain too',
   C.socialUrl('facebook', 'www.facebook.com/vaultique') === 'https://facebook.com/vaultique',
   C.socialUrl('facebook', 'www.facebook.com/vaultique'));
ok('TikTok gets its @', C.socialUrl('tiktok', 'vaultique') === 'https://tiktok.com/@vaultique');
ok('LinkedIn drops a repeated company/',
   C.socialUrl('linkedin', 'company/vaultique') === 'https://linkedin.com/company/vaultique');
ok('a full URL is trusted as given',
   C.socialUrl('x', 'https://x.com/other') === 'https://x.com/other');
ok('an empty handle gives no address', C.socialUrl('youtube', '') === '');
ok('six networks are offered', C.SOCIALS.length === 6, C.SOCIALS.length);
ok('each has a name, an address and a mark',
   C.SOCIALS.every(n => n.id && n.name && n.base && n.prefix && n.icon));

console.log('\n== messages ==');
ok('placeholders are filled',
   C.fill('Hello {business}, {product} at {price}', { business: 'V', product: 'Blouse', price: 'K920' })
     === 'Hello V, Blouse at K920');
ok('an unknown placeholder is left as written, not blanked',
   C.fill('Hi {nope}', {}) === 'Hi {nope}');
ok('a reason gets the greeting in front of it',
   C.greet('Vaultique', 'I have a question.', '') === 'Hello Vaultique, I have a question.');
ok('with no reason, the default message is used',
   C.greet('Vaultique', '', 'Hello {business}, hello.') === 'Hello Vaultique, hello.');

console.log('\n== maps ==');
ok('a pasted Google link is used as it is',
   C.mapsUrl('https://maps.app.goo.gl/abc') === 'https://maps.app.goo.gl/abc');
ok('otherwise the address is searched for',
   C.mapsUrl('', 'Manda Hill, Lusaka').includes('query=Manda%20Hill'));
ok('no address and no link means no button', C.mapsUrl('', '') === '');

/* ------------------------------------------------------------- browser */
const STUB = `
window.__rows = window.__rows || {}; window.__saves = [];
function tbl(name){
  var q={_v:null};
  q.select=function(){return q;}; q.order=function(){return q;};
  q.eq=function(c,v){q._v=v;return q;};
  q.maybeSingle=function(){var r=window.__rows[name+':'+q._v];
    return Promise.resolve({data:r?JSON.parse(JSON.stringify(r)):null,error:null});};
  q.upsert=function(p){var id=p.key!==undefined?p.key:p.id;
    var c=JSON.parse(JSON.stringify(p));window.__rows[name+':'+id]={data:c.data};
    window.__saves.push({table:name,payload:p});return Promise.resolve({data:null,error:null});};
  q.then=function(f){return Promise.resolve({data:[],error:null}).then(f);};
  return q;
}
window.supabase={createClient:function(){return{
  auth:{getSession:function(){return Promise.resolve({data:{session:{user:{id:'x'}}}});},
        signOut:function(){return Promise.resolve();}},
  from:tbl,
  storage:{from:function(){return{upload:function(){return Promise.resolve({data:null,error:null});},
    getPublicUrl:function(){return{data:{publicUrl:''}};}};}}
};}};`;

const PRODUCTS = [
  { name: 'Aurelia Silk Blouse', sku: 'WF-AUSI-CR-S', category: "Women's Fashion",
    price: 920, size: 'S', color: 'Cream', material: 'Silk', available: true }
];

const GENERAL = {
  businessName: 'Vaultique Boutique Point', tagline: 'Curated Elegance, Accessible Luxury',
  country: 'Zambia', city: 'Lusaka', address: 'Manda Hill Mall, Shop 12',
  timezone: 'Africa/Lusaka', currency: 'ZMW', dateFormat: 'DD/MM/YYYY',
  numberFormat: '1,234.56', websiteStatus: 'live', maintenanceMode: false,
  businessHours: {
    mon:{open:true,from:'09:00',to:'18:00'}, tue:{open:true,from:'09:00',to:'18:00'},
    wed:{open:true,from:'09:00',to:'18:00'}, thu:{open:true,from:'09:00',to:'18:00'},
    fri:{open:true,from:'09:00',to:'18:00'}, sat:{open:true,from:'09:00',to:'16:00'},
    sun:{open:false,from:'09:00',to:'16:00'}
  }
};

const CONTACT = {
  phone: '+260 211 123 456',
  whatsapp: '+260 97 000 0000',
  email: 'accounts@vaultique.test',
  supportEmail: 'help@vaultique.test',
  mapsUrl: 'https://maps.app.goo.gl/vaultique',
  supportHoursOverride: false, supportHours: null,
  instagram: 'vaultiqueboutique', facebook: 'vaultiqueboutique',
  tiktok: '', linkedin: '', x: 'vaultique', youtube: '',
  orderNumber: '+260 97 832 3036',
  enquiryNumber: '+260 96 353 9728',
  orderMessage: "Hello {business}, I'd like to buy: {product} (SKU: {sku}), {price}. Is it available?",
  enquiryMessage: 'Hello {business}, I have an enquiry.'
};

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

async function shop(browser, contact, general) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript',
    body: "window.VBP_CONFIG={SUPABASE_URL:'https://x.supabase.co',SUPABASE_ANON_KEY:'k'};" }));
  await page.route('**/fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('**/api/products', r => r.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ products: PRODUCTS }) }));
  await page.route('**/rest/v1/**', r => {
    const u = r.request().url();
    const j = x => ({ contentType: 'application/json', body: JSON.stringify(x) });
    if (u.includes('key=eq.contact')) return r.fulfill(j(contact ? [{ data: contact }] : []));
    if (u.includes('key=eq.general')) return r.fulfill(j(general === null ? [] : [{ data: general || GENERAL }]));
    if (u.includes('key=eq.branding')) return r.fulfill(j([]));
    if (u.includes('site_content')) return r.fulfill(j([{ data: {} }]));
    return r.fulfill(j([]));
  });
  await page.goto('http://127.0.0.1:' + PORT + '/index.html');
  await page.waitForTimeout(900);
  return { page, ctx, errors };
}

(async () => {
  const srv = server();
  await new Promise(r => srv.listen(PORT, r));
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  console.log('\n== every contact link on the storefront ==');
  {
    const { page, ctx, errors } = await shop(browser, CONTACT);
    ok('no page errors', errors.length === 0, errors);

    const links = await page.evaluate(() => {
      const grab = sel => Array.prototype.map.call(document.querySelectorAll(sel),
        a => ({ href: a.getAttribute('href') || '', label: a.getAttribute('aria-label') || '' }));
      return {
        wa: grab('[data-wa]'),
        enq: grab('[data-wa-enq]'),
        mail: grab('[data-email]'),
        social: grab('#footSocial a'),
        product: (document.querySelector('.card .btn-wa') || {}).href || '',
        phone: (document.querySelector('#phoneVal') || {}).getAttribute
               ? document.querySelector('#phoneVal').getAttribute('href') : '',
        phoneShown: !document.querySelector('#phoneRow').classList.contains('hide'),
        maps: (document.querySelector('#mapsLink') || {}).getAttribute
              ? document.querySelector('#mapsLink').getAttribute('href') : '',
        mapsShown: !document.querySelector('#mapsLink').classList.contains('hide')
      };
    });

    // The count is here to catch links quietly losing their wiring; it moves
    // whenever the page gains one, as it did when How to pay was added.
    ok('all ten order links point at the order number',
       links.wa.length === 10 && links.wa.every(l => l.href.indexOf('https://wa.me/260978323036') === 0),
       [links.wa.length, links.wa[0] && links.wa[0].href]);
    ok('both enquiry links point at the enquiry number',
       links.enq.length === 2 && links.enq.every(l => l.href.indexOf('https://wa.me/260963539728') === 0),
       [links.enq.length, links.enq[0] && links.enq[0].href]);
    ok('each order link keeps its own reason',
       links.wa.some(l => decodeURIComponent(l.href).includes('size and style advice')) &&
       links.wa.some(l => decodeURIComponent(l.href).includes('place an order')),
       links.wa.map(l => decodeURIComponent(l.href).split('text=')[1]).slice(0, 3));
    ok('and the business name in front of it',
       links.wa.every(l => decodeURIComponent(l.href).includes('Hello Vaultique Boutique Point,')),
       decodeURIComponent(links.wa[0].href));

    const msg = decodeURIComponent(links.product);
    ok('a product link goes to the order number',
       links.product.indexOf('https://wa.me/260978323036') === 0, links.product);
    ok('and names the piece, its code and its price',
       msg.includes('Aurelia Silk Blouse') && msg.includes('WF-AUSI-CR-S') && msg.includes('K920'), msg);

    ok('email links use the support address, not the business one',
       links.mail.length === 2 && links.mail.every(l => l.href === 'mailto:help@vaultique.test'),
       links.mail.map(l => l.href));
    ok('the footer email icon uses it too',
       links.social[links.social.length - 1].href === 'mailto:help@vaultique.test',
       links.social[links.social.length - 1]);
    ok('the footer WhatsApp icon is an enquiry, so it uses the enquiry number',
       links.social[links.social.length - 2].href.indexOf('https://wa.me/260963539728') === 0,
       links.social[links.social.length - 2]);

    ok('the phone row is shown', links.phoneShown);
    ok('and dials the number', links.phone === 'tel:+260211123456', links.phone);
    ok('the directions link is shown', links.mapsShown);
    ok('and opens the pasted map', links.maps === 'https://maps.app.goo.gl/vaultique', links.maps);

    const socialLabels = links.social.map(s => s.label);
    ok('only the networks that were filled in appear',
       JSON.stringify(socialLabels) === JSON.stringify(['Instagram','Facebook','X','WhatsApp','Email']),
       socialLabels);
    ok('the Instagram icon goes to Instagram, not WhatsApp',
       links.social[0].href === 'https://instagram.com/vaultiqueboutique', links.social[0].href);
    await ctx.close();
  }

  console.log('\n== nothing filled in still leaves a working shop ==');
  {
    const { page, ctx, errors } = await shop(browser, null);
    ok('no page errors', errors.length === 0, errors);
    const state = await page.evaluate(() => ({
      wa: (document.querySelector('[data-wa]') || {}).getAttribute
          ? document.querySelector('[data-wa]').getAttribute('href') : '',
      phoneHidden: document.querySelector('#phoneRow').classList.contains('hide'),
      social: Array.prototype.map.call(document.querySelectorAll('#footSocial a'),
        a => a.getAttribute('aria-label'))
    }));
    ok('order links still work, on the number the site shipped with',
       state.wa.indexOf('https://wa.me/260978323036') === 0, state.wa);
    ok('the phone row stays hidden when there is no phone', state.phoneHidden);
    ok('no social icons rather than icons that go nowhere',
       JSON.stringify(state.social) === JSON.stringify(['WhatsApp','Email']), state.social);
    await ctx.close();
  }

  console.log('\n== support hours ==');
  {
    const { page, ctx } = await shop(browser, CONTACT);
    const v = await page.evaluate(() => ({
      trading: document.querySelector('#hoursVal').textContent,
      supportHidden: document.getElementById('supportRow').classList.contains('hide'),
      footer: document.querySelector('#footHours').textContent
    }));
    ok('trading hours are shown', /Mon-Fri 9am-6pm/.test(v.trading), v.trading);
    /* Printing the same line twice under two headings tells a customer
       nothing and makes them read it to find that out. */
    ok('and no second row while support keeps the same timetable', v.supportHidden);
    ok('the footer carries the trading hours', /Mon-Fri 9am-6pm/.test(v.footer), v.footer);
    await ctx.close();
  }
  {
    const later = Object.assign({}, CONTACT, {
      supportHoursOverride: true,
      supportHours: {
        mon:{open:true,from:'08:00',to:'20:00'}, tue:{open:true,from:'08:00',to:'20:00'},
        wed:{open:true,from:'08:00',to:'20:00'}, thu:{open:true,from:'08:00',to:'20:00'},
        fri:{open:true,from:'08:00',to:'20:00'}, sat:{open:true,from:'08:00',to:'20:00'},
        sun:{open:true,from:'10:00',to:'16:00'}
      }
    });
    const { page, ctx } = await shop(browser, later);
    /* Two timetables answering two questions: when the doors are open,
       and when somebody answers WhatsApp. The site used to show one row
       that quietly became the other, so a shop whose support ran later
       than its doors had no way to say so. */
    const v = await page.evaluate(() => ({
      tradingLabel: document.querySelector('#tradingRow .k').textContent,
      trading: document.querySelector('#hoursVal').textContent,
      supportHidden: document.getElementById('supportRow').classList.contains('hide'),
      supportLabel: document.querySelector('#supportRow .k').textContent,
      support: document.querySelector('#supportVal').textContent,
      footer: document.querySelector('#footHours').textContent
    }));
    ok('the support row appears once the two differ', !v.supportHidden);
    ok('it is labelled Support hours', v.supportLabel === 'Support hours', v.supportLabel);
    ok('and carries the support timetable',
       /Mon-Sat 8am-8pm/.test(v.support) && /Sun 10am-4pm/.test(v.support), v.support);
    ok('the trading row is labelled Trading hours', v.tradingLabel === 'Trading hours', v.tradingLabel);
    ok('and still carries the trading timetable',
       /Mon-Fri 9am-6pm/.test(v.trading), v.trading);
    ok('support hours do not overwrite the trading ones',
       !/8am-8pm/.test(v.trading), v.trading);
    ok('nor the footer, which is about visiting the shop',
       /Mon-Fri 9am-6pm/.test(v.footer) && !/8am-8pm/.test(v.footer), v.footer);
    await ctx.close();
  }

  /* ---------------------------------------------------------- the admin */
  console.log('\n== the admin section ==');
  {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', e => errors.push(String(e)));
    p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await p.addInitScript(g => {
      window.__rows = { 'site_settings:general': { data: g } };
    }, GENERAL);
    await p.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript',
      body: "window.VBP_CONFIG={SUPABASE_URL:'https://x.supabase.co',SUPABASE_ANON_KEY:'k'};" }));
    await p.route('**/@supabase/supabase-js**', r => r.fulfill({ contentType: 'text/javascript', body: STUB }));
    await p.route('**/fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
    await p.route('**/api/products', r => r.fulfill({ contentType: 'application/json', body: '{"products":[]}' }));
    await p.goto('http://127.0.0.1:' + PORT + '/admin.html#/settings/contact');
    await p.waitForSelector('#f_orderMessage', { timeout: 6000 });
    await p.waitForTimeout(400);

    ok('no page errors', errors.length === 0, errors);
    const names = await p.evaluate(() =>
      Array.prototype.map.call(document.querySelectorAll('#setPage [id^=f_]'), e => e.id.slice(2)));
    const want = ['phone','whatsapp','email','supportEmail','mapsUrl','supportHoursOverride',
                  'instagram','facebook','tiktok','linkedin','x','youtube',
                  'orderNumber','enquiryNumber','orderMessage','enquiryMessage'];
    ok('every field is drawn', want.every(w => names.includes(w)), want.filter(w => !names.includes(w)));
    ok('that is seventeen settings with the hours grid', want.length + 1 === 17, want.length + 1);

    ok('the address is shown, read only, from General',
       (await p.textContent('#setPage .ro-line')).includes('Manda Hill'),
       await p.textContent('#setPage .ro-line'));
    ok('so are the trading hours',
       (await p.$$eval('#setPage .ro-line', e => e.map(x => x.textContent)))
         .some(t => /Mon-Fri 9am-6pm/.test(t)),
       await p.$$eval('#setPage .ro-line', e => e.map(x => x.textContent)));

    ok('the support hours grid is hidden until the override is on',
       await p.evaluate(() => document.querySelector('#f_supportHours')
         .closest('.field').classList.contains('hide')));
    await p.click('#setPage #f_supportHoursOverride ~ .sw, #setPage .sw-row');
    await p.waitForTimeout(150);
    ok('and appears when it is switched on',
       !(await p.evaluate(() => document.querySelector('#f_supportHours')
         .closest('.field').classList.contains('hide'))));
    ok('starting from the trading hours rather than an empty week',
       await p.evaluate(() => {
         const rows = document.querySelectorAll('#f_supportHours .hrs-row');
         const open = Array.prototype.filter.call(rows, r => !r.classList.contains('shut'));
         const mon = rows[0].querySelectorAll('input[type=time]');
         return open.length === 6 && mon[0].value === '09:00' && mon[1].value === '18:00';
       }));

    console.log('\n== the message preview ==');
    const prev = await p.$$eval('#setPage .msg-body', e => e.map(x => x.textContent));
    ok('two messages are previewed', prev.length === 2, prev.length);
    ok('the order one is filled in with a real product',
       prev[0].includes('Vaultique Boutique Point') && prev[0].includes('Aurelia Silk Blouse') &&
       prev[0].includes('K920'), prev[0]);
    await p.fill('#f_orderMessage', 'Hi {business}, is {product} in stock? {nonsense}');
    await p.waitForTimeout(150);
    ok('editing the template repaints the preview',
       (await p.textContent('#setPage .msg-body')).includes('is Aurelia Silk Blouse in stock?'),
       await p.textContent('#setPage .msg-body'));
    ok('a placeholder the shop cannot fill is called out',
       /\{nonsense\}/.test(await p.textContent('#setPage .warn')),
       await p.textContent('#setPage .warn').catch(() => 'no warning'));

    console.log('\n== handles are tidied ==');
    await p.fill('#f_instagram', 'https://instagram.com/vaultique');
    await p.evaluate(() => document.querySelector('#f_instagram').blur());
    await p.waitForTimeout(150);
    ok('a pasted address becomes a bare handle',
       await p.inputValue('#f_instagram') === 'vaultique',
       await p.inputValue('#f_instagram'));
    ok('and the address it resolves to is shown',
       (await p.textContent('#setPage .handle-out.on')).includes('instagram.com/vaultique'));

    console.log('\n== validation ==');
    await p.fill('#f_phone', '123');
    await p.fill('#f_orderNumber', '+260 97 832 3036');
    await p.click('#setPage .save-bar .btn-gold');
    await p.waitForTimeout(150);
    ok('a number that is too short is refused',
       await p.evaluate(() => document.querySelector('#f_phone').closest('.field').classList.contains('bad')));
    await p.fill('#f_phone', '+260 211 123 456');
    await p.fill('#f_supportEmail', 'not-an-email');
    await p.click('#setPage .save-bar .btn-gold');
    await p.waitForTimeout(150);
    ok('so is an address that is not one',
       await p.evaluate(() => document.querySelector('#f_supportEmail').closest('.field').classList.contains('bad')));
    await p.fill('#f_supportEmail', 'help@vaultique.test');

    await p.fill('#f_orderNumber', '');
    await p.fill('#f_whatsapp', '');
    await p.click('#setPage .save-bar .btn-gold');
    await p.waitForTimeout(150);
    ok('leaving every WhatsApp number blank is refused, since that ends ordering',
       await p.evaluate(() => document.querySelector('#f_orderNumber').closest('.field').classList.contains('bad')));
    await p.fill('#f_orderNumber', '+260 97 832 3036');

    console.log('\n== saving ==');
    await p.click('#setPage .save-bar .btn-gold');
    await p.waitForTimeout(300);
    ok('it saves', (await p.textContent('#setPage .save-bar .stat')).includes('Saved'),
       await p.textContent('#setPage .save-bar .stat'));
    const saved = await p.evaluate(() =>
      window.__saves.filter(s => s.payload.key === 'contact').pop());
    ok('under the contact key', !!saved);
    ok('the handle is stored bare', saved && saved.payload.data.instagram === 'vaultique');
    ok('the order number is stored', saved && saved.payload.data.orderNumber === '+260 97 832 3036');
    ok('the override is stored', saved && saved.payload.data.supportHoursOverride === true);
    ok('no page errors across the run', errors.length === 0, errors);
    await ctx.close();
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})();
