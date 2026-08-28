/* =====================================================================
   Settings > Delivery & Collection.

   The case that matters most is the one that was there before this
   section existed: a paragraph typed into assets/app.js naming the
   areas, the charging and the collection offer, on every product page,
   changeable only by editing the source.

   The second is the checkout. A customer who says they are collecting
   should not then be asked where to deliver to, and an address they
   typed before changing their mind should not follow them into the
   message.
   ===================================================================== */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8156;

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')); } };

const GENERAL = { businessName: 'Vaultique Boutique Point', currency: 'ZMW',
  numberFormat: '1,234.56', dateFormat: 'DD/MM/YYYY', timezone: 'Africa/Lusaka',
  address: 'Shop 12, Manda Hill', city: 'Lusaka', country: 'Zambia',
  websiteStatus: 'live', maintenanceMode: false };

const CONTACT = { orderNumber: '260978323036', whatsapp: '260978323036' };

const FULL = {
  deliveryEnabled: true, showFees: true, speeds: 'both',
  sameDayCutoff: '14:00', sameDayFee: 150,
  standardFee: 120, freeOver: 2000, standardDays: 'Two to four working days',
  areas: [
    { name: 'Lusaka', days: 'Same day or next day', fee: 80, sameDay: true },
    { name: 'Copperbelt', days: 'Two working days', fee: 180, sameDay: false },
    { name: 'Livingstone', days: 'Three working days', fee: '', sameDay: false }
  ],
  pickupEnabled: true, pickupUseShopAddress: true,
  pickupInstructions: 'Ask for Chanda at the front desk.',
  terms: 'We deliver nationwide across Zambia where possible.',
  instructions: 'Tell us your area and we will confirm the fee before dispatch.'
};

const POLICIES = [{ id: 'p1', section: 'Delivery', title: 'Delivery Policy', body: '…', sort: 1 }];
const PRODUCTS = [{ name: 'Aurelia Silk Blouse', sku: 'WF-1', category: "Women's Fashion",
  price: 900, size: 'S', color: 'Cream', material: 'Silk', available: true, lowStock: false }];

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

async function shop(browser, delivery, hash, shopping) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript',
    body: "window.VBP_CONFIG={SUPABASE_URL:'https://x.supabase.co',SUPABASE_ANON_KEY:'k'};" }));
  await page.route('**/fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('**/maps**', r => r.fulfill({ contentType: 'text/html', body: '' }));
  await page.route('**/api/products', r => r.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ products: PRODUCTS }) }));
  await page.route('**/rest/v1/**', r => {
    const u = r.request().url();
    const j = x => ({ contentType: 'application/json', body: JSON.stringify(x) });
    if (u.includes('key=eq.delivery')) return r.fulfill(j(delivery ? [{ data: delivery }] : []));
    if (u.includes('key=eq.general')) return r.fulfill(j([{ data: GENERAL }]));
    if (u.includes('key=eq.contact')) return r.fulfill(j([{ data: CONTACT }]));
    if (u.includes('key=eq.shopping')) return r.fulfill(j(shopping ? [{ data: shopping }] : []));
    if (u.includes('policies')) return r.fulfill(j(POLICIES));
    if (u.includes('site_content')) return r.fulfill(j([{ data: {} }]));
    return r.fulfill(j([]));
  });
  await page.goto('http://127.0.0.1:' + PORT + '/index.html' + (hash || ''));
  await page.waitForTimeout(1000);
  return { page, ctx, errors };
}

/* Presses Continue and returns the WhatsApp address it opened. If
   validation refuses the click, the message shown to the customer comes
   back instead of the test waiting for something that will never
   happen. */
function send(page) {
  return page.evaluate(() => new Promise(res => {
    window.open = u => { res({ url: u }); return null; };
    document.getElementById('odGo').click();
    setTimeout(function () {
      res({ refused: (document.getElementById('odMsg') || {}).textContent || 'no reason given' });
    }, 400);
  }));
}

const panelText = page => page.evaluate(() => {
  const b = document.querySelector('.acc-body .dl-block');
  return b ? b.closest('.inner').textContent.replace(/\s+/g, ' ').trim() : '';
});
async function openPanel(page) {
  for (const h of await page.$$('.acc-head')) {
    if (/Delivery|Collection/.test(await h.textContent())) { await h.click(); break; }
  }
  await page.waitForTimeout(200);
}

(async () => {
  const srv = server();
  await new Promise(r => srv.listen(PORT, r));
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  /* The one thing that must never come back. */
  console.log('\n== the paragraph is out of the source ==');
  {
    const app = fs.readFileSync(path.join(ROOT, 'assets/app.js'), 'utf8');
    ok('no hardcoded nationwide claim', !/We deliver nationwide across Zambia where possible, with fees/.test(app));
    ok('no hardcoded fee wording', !/fees calculated by distance and confirmed on WhatsApp before dispatch/.test(app));
  }

  console.log('\n== the shop before this section has ever been opened ==');
  {
    const { page, ctx, errors } = await shop(browser, null, '#/product/WF-1');
    ok('no page errors', errors.length === 0, errors);
    await openPanel(page);
    const t = await panelText(page);
    ok('the panel still says what it always said',
       /nationwide across Zambia/.test(t) && /Collection in person/.test(t), t);
    ok('and still mentions how fees are settled',
       /confirmed on WhatsApp/.test(t), t);
    await ctx.close();
  }

  console.log('\n== areas, fees and speeds reach the product page ==');
  {
    const { page, ctx, errors } = await shop(browser, FULL, '#/product/WF-1');
    ok('no page errors', errors.length === 0, errors);
    await openPanel(page);
    const t = await panelText(page);
    ok('each area is named with its time and fee',
       /Lusaka · Same day or next day · K80/.test(t) && /Copperbelt · Two working days · K180/.test(t), t);
    /* A shop that publishes its charges and leaves one blank is saying it
       costs nothing, not that it forgot. */
    ok('an area with no fee reads as free', /Livingstone · Three working days · Free/.test(t), t);
    ok('the standard fee covers anywhere unlisted', /Elsewhere K120/.test(t), t);
    ok('free delivery is stated', /Free over K2,000/.test(t), t);
    ok('same-day carries its cut-off', /Order by 14:00/.test(t), t);
    ok('collection gives the shop address',
       /Collect in person from Shop 12, Manda Hill, Lusaka, Zambia/.test(t), t);
    ok('and its instructions', /Ask for Chanda/.test(t), t);
    ok('the seven delivery policies are linked, not repeated',
       /Read the full delivery policy/.test(t), t);
    await ctx.close();
  }

  console.log('\n== fees can be withheld without hiding the areas ==');
  {
    const quiet = Object.assign({}, FULL, { showFees: false,
      feesNote: 'Fees are confirmed on WhatsApp before dispatch.' });
    const { page, ctx, errors } = await shop(browser, quiet, '#/product/WF-1');
    ok('no page errors', errors.length === 0, errors);
    await openPanel(page);
    const t = await panelText(page);
    ok('the areas are still named', /Lusaka/.test(t) && /Copperbelt/.test(t), t);
    ok('and their timings', /Same day or next day/.test(t), t);
    ok('but no figure is published', !/K80/.test(t) && !/K180/.test(t) && !/K120/.test(t), t);
    ok('and the shop says how fees are settled instead',
       /confirmed on WhatsApp/.test(t), t);
    await ctx.close();
  }

  console.log('\n== a shop that only collects ==');
  {
    const { page, ctx, errors } = await shop(browser,
      Object.assign({}, FULL, { deliveryEnabled: false }), '#/product/WF-1');
    ok('no page errors', errors.length === 0, errors);
    await openPanel(page);
    const t = await panelText(page);
    ok('says nothing about delivering', !/Lusaka · Same day/.test(t) && !/Elsewhere/.test(t), t);
    ok('but still offers collection', /Collect in person/.test(t), t);
    /* A panel called "Delivery & collection" on a shop that only collects
       is a small lie in a heading. */
    const titles = await page.$$eval('.acc-head', a => a.map(e => e.textContent.replace('+', '').trim()));
    ok('and the panel is called what it is', titles.includes('Collection'), titles);
    const desc = await page.textContent('.desc');
    ok('the generated description does not promise delivery either',
       !/delivery/i.test(desc), desc);
    await ctx.close();
  }

  console.log('\n== a shop that offers neither ==');
  {
    const { page, ctx, errors } = await shop(browser,
      { deliveryEnabled: false, pickupEnabled: false }, '#/product/WF-1');
    ok('no page errors', errors.length === 0, errors);
    const titles = await page.$$eval('.acc-head', a => a.map(e => e.textContent.replace('+', '').trim()));
    ok('the panel is gone rather than empty',
       !titles.some(t => /Delivery|Collection/.test(t)), titles);
    await ctx.close();
  }

  console.log('\n== the homepage band ==');
  {
    const { page, ctx, errors } = await shop(browser, FULL);
    ok('no page errors', errors.length === 0, errors);
    const v = await page.evaluate(() => {
      const s = document.getElementById('delivery-sec');
      return { hidden: s.classList.contains('hide'),
               sub: document.getElementById('deliverySub').textContent,
               cards: [...s.querySelectorAll('.dl-card h3')].map(e => e.textContent),
               foot: [...document.getElementById('deliveryFoot').children].map(e => e.textContent.trim()) };
    });
    ok('the band is shown', !v.hidden);
    ok('with a card each', v.cards.join('|') === 'Delivery|Collection', v.cards);
    ok('the terms sit under the heading', /nationwide across Zambia/.test(v.sub), v.sub);
    ok('and there is a way to ask', v.foot.some(t => /Ask about delivery/.test(t)), v.foot);

    /* Settings > Homepage gives up early on a shop that has never saved
       it. The delivery band is not the homepage's to withhold. */
    ok('drawn even though Homepage has never been saved', !v.hidden);
    await ctx.close();
  }
  {
    const { page, ctx } = await shop(browser, { deliveryEnabled: false, pickupEnabled: false });
    ok('and hidden entirely when the shop offers neither',
       await page.evaluate(() => document.getElementById('delivery-sec').classList.contains('hide')));
    await ctx.close();
  }
  {
    const { page, ctx } = await shop(browser, FULL);
    ok('the band is in the section list, so it can be moved',
       await page.evaluate(() => (window.VBP_SECTIONS.ALL || [])
         .some(s => s.id === 'delivery-sec')));
    await ctx.close();
  }

  console.log('\n== the checkout ==');
  {
    const { page, ctx, errors } = await shop(browser, FULL, '#/product/WF-1',
      { requireAddress: true, requireName: true, requirePhone: false });
    ok('no page errors', errors.length === 0, errors);
    await page.click('#buyDetail');
    await page.waitForTimeout(350);

    const picks = await page.$$eval('.od-pick', a => a.map(e => e.textContent.trim()));
    ok('the customer is asked how they want it',
       picks.join('|') === 'Delivered|Collected in person', picks);

    const addrVisible = () => page.evaluate(() => {
      const l = document.querySelector('label[for="od_address"]');
      return l ? !l.classList.contains('hide') : 'no field';
    });
    ok('the address is asked for while delivering', await addrVisible() === true);
    ok('and the note is short rather than the whole tariff',
       await page.evaluate(() => {
         const t = document.querySelector('.od-how-note').textContent;
         return !/K80/.test(t) && /confirm the fee/.test(t);
       }));

    await page.check('input[name="odHow"][value="collection"]');
    await page.waitForTimeout(250);
    ok('choosing collection puts the address box away', await addrVisible() === false);
    ok('and says where to come',
       /Manda Hill/.test(await page.textContent('.od-how-note')));

    /* Asking a customer who is collecting to fill in a delivery address
       before they may continue would be a dead end. */
    await page.fill('#od_name', 'Chanda M');
    const sent = await send(page);
    ok('the order sends without an address', !sent.refused, sent);
    const msg = decodeURIComponent(sent.url || '');
    ok('carrying the name', /Chanda M/.test(msg), msg);
    ok('and says the customer is collecting', /Collecting in person/.test(msg), msg);
    ok('no delivery address line is sent', !/Delivery address/.test(msg), msg);
    await ctx.close();
  }
  {
    /* An address typed before changing to collection must not follow the
       customer into the message: it would have you delivering to somewhere
       they said they were coming to fetch from. */
    const { page, ctx } = await shop(browser, FULL, '#/product/WF-1',
      { requireAddress: true, requireName: true, requirePhone: false });
    await page.click('#buyDetail');
    await page.waitForTimeout(350);
    await page.fill('#od_name', 'Chanda M');
    await page.fill('#od_address', '42 Kabulonga Road');
    await page.check('input[name="odHow"][value="collection"]');
    await page.waitForTimeout(200);
    const sent = await send(page);
    ok('it still sends', !sent.refused, sent);
    ok('an address typed and then abandoned is not sent',
       !/Kabulonga/.test(decodeURIComponent(sent.url || '')), sent);
    await ctx.close();
  }
  {
    /* One option is not a choice, it is a sentence. */
    const { page, ctx } = await shop(browser,
      Object.assign({}, FULL, { pickupEnabled: false }), '#/product/WF-1',
      { requireAddress: true, requireName: true, requirePhone: false });
    await page.click('#buyDetail');
    await page.waitForTimeout(350);
    ok('a shop that only delivers does not ask',
       await page.$$eval('.od-pick', a => a.length) === 0);
    await page.fill('#od_name', 'Chanda M');
    await page.fill('#od_address', '42 Kabulonga Road');
    const sent = await send(page);
    ok('it sends', !sent.refused, sent);
    const msg = decodeURIComponent(sent.url || '');
    ok('and the message does not state the obvious', !/To be delivered/.test(msg), msg);
    ok('but does carry the address', /Kabulonga/.test(msg), msg);
    await ctx.close();
  }
  {
    const { page, ctx } = await shop(browser,
      Object.assign({}, FULL, { deliveryEnabled: false }), '#/product/WF-1',
      { requireAddress: true, requireName: true, requirePhone: false });
    await page.click('#buyDetail');
    await page.waitForTimeout(350);
    ok('a shop that only collects never asks for an address',
       await page.evaluate(() => !document.querySelector('#od_address')));
    await ctx.close();
  }

  /* ---------------------------------------------------------- the admin */
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
    await page.goto('http://127.0.0.1:' + PORT + '/admin.html#/settings/delivery');
    await page.waitForTimeout(1300);

    ok('no page errors', errors.length === 0, errors);
    const groups = await page.$$eval('.card h3', a => a.map(e => e.textContent));
    ok('every group is drawn', groups.length === 7, groups);

    const preview = await page.$$eval('.dl-line', a => a.length);
    ok('the preview is drawn on load', preview > 0, preview);

    /* The numbers and the pickup address are not asked for again here. */
    const labels = await page.$$eval('.field label', a => a.map(e => e.textContent.trim()));
    ok('collection follows the order number until told otherwise',
       labels.includes('Collection questions go to a different number'), labels);
    ok('and delivery does too',
       labels.includes('Delivery questions go to a different number'), labels);
    ok('the pickup address follows the shop address until told otherwise',
       labels.includes('Collect from the shop address'), labels);

    const notes = await page.$$eval('.note-field strong', a => a.map(e => e.textContent));
    ok('the section says the long form already exists',
       notes.some(t => /long form already exists/i.test(t)), notes);

    /* Turning both off leaves no way for an order to reach anyone. */
    await page.evaluate(() => {
      document.querySelector('#f_deliveryEnabled').click();
      document.querySelector('#f_pickupEnabled').click();
    });
    await page.waitForTimeout(250);
    await page.click('.save-bar .btn-gold');
    await page.waitForTimeout(300);
    ok('offering neither is refused',
       await page.evaluate(() => document.querySelector('#f_pickupEnabled')
         .closest('.field').classList.contains('bad')));
    ok('and the warning about the two coupled settings appears',
       await page.evaluate(() => [...document.querySelectorAll('.note-field strong')]
         .some(e => /lean on this/.test(e.textContent))));

    await page.evaluate(() => { document.querySelector('#f_deliveryEnabled').click(); });
    await page.waitForTimeout(250);
    await page.click('.save-bar .btn-gold');
    await page.waitForTimeout(400);
    const saved = await page.evaluate(() => (window.__rows['site_settings:delivery'] || {}).data);
    ok('a sound setting saves', !!saved && saved.deliveryEnabled === true, saved);
    ok('under the delivery key', !!saved);
    ok('the notes are not saved as settings',
       saved && !('offNote' in saved) && !('policyNote' in saved),
       saved && Object.keys(saved).filter(k => /Note$/.test(k)));
    await ctx.close();
  }

  /* Both sides carry the same list, so a shop does not change the moment
     somebody presses Save. */
  console.log('\n== both sides declare the same settings ==');
  {
    const read = (file, marker) => {
      const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
      const i = src.indexOf(marker);
      const j = src.indexOf('\n  };', i);
      const block = src.slice(i, j)
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      return [...block.matchAll(/(\w+):/g)].map(m => m[1]).sort();
    };
    const front = read('assets/app.js', 'var DELIVERY = {');
    const admin = read('assets/admin/settings/delivery.js', 'var DEFAULTS = {');
    ok('the storefront knows every setting the admin offers',
       admin.every(k => front.includes(k)), admin.filter(k => !front.includes(k)));
    ok('and offers nothing the admin does not',
       front.every(k => admin.includes(k)), front.filter(k => !admin.includes(k)));
  }

  await browser.close();
  srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
