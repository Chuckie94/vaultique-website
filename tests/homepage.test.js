/* =====================================================================
   Settings > Homepage: the announcement, the hero, the story and the
   values, and what each does to the page a customer sees.
   ===================================================================== */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8180;

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')); } };

const PRODUCTS = [{ name: 'Aurelia Silk Blouse', sku: 'WF-1', category: "Women's Fashion",
  price: 920, size: 'S', color: 'Cream', material: 'Silk', available: true, lowStock: false }];
const GENERAL = { businessName: 'Vaultique Boutique Point', currency: 'ZMW',
  numberFormat: '1,234.56', dateFormat: 'DD/MM/YYYY', websiteStatus: 'live', maintenanceMode: false };

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

async function shop(browser, home, content) {
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
    if (u.includes('key=eq.homepage')) return r.fulfill(j(home ? [{ data: home }] : []));
    if (u.includes('key=eq.general')) return r.fulfill(j([{ data: GENERAL }]));
    if (u.includes('site_content')) return r.fulfill(j([{ data: content || {} }]));
    return r.fulfill(j([]));
  });
  await page.goto('http://127.0.0.1:' + PORT + '/index.html');
  await page.waitForTimeout(950);
  return { page, ctx, errors };
}

(async () => {
  const srv = server();
  await new Promise(r => srv.listen(PORT, r));
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  console.log('\n== before the section is ever saved ==');
  {
    const { page, ctx, errors } = await shop(browser, null,
      { announce: 'From Site Content', hero: { title: 'Old Title' } });
    ok('no page errors', errors.length === 0, errors);
    ok('what Site Content had is still shown',
       (await page.textContent('#announceBar')) === 'From Site Content');
    ok('and its hero text too', (await page.textContent('#heroTitle')) === 'Old Title');
    ok('the hero is visible',
       await page.evaluate(() => !document.querySelector('#hero').classList.contains('hide')));
    await ctx.close();
  }

  console.log('\n== announcement bar ==');
  {
    const { page, ctx } = await shop(browser, { announceEnabled: true,
      announceText: 'Free delivery in <b>Lusaka</b> this week' });
    ok('the text is applied', (await page.textContent('#announceBar')).includes('Free delivery'));
    ok('bold is allowed through',
       await page.evaluate(() => !!document.querySelector('#announceBar b')));
    await ctx.close();
  }
  {
    const { page, ctx } = await shop(browser, { announceEnabled: false });
    ok('it can be switched off',
       await page.evaluate(() => document.querySelector('#announceBar').classList.contains('hide')));
    await ctx.close();
  }

  console.log('\n== hero ==');
  {
    const { page, ctx } = await shop(browser, {
      heroEnabled: true, heroEyebrow: 'Lusaka', heroTitle: 'Something New,',
      heroTitleEm: 'Beautifully Made', heroSubtitle: 'A short line about the edit.',
      heroImage1: 'https://cdn.test/h1.jpg', heroImage2: 'https://cdn.test/h2.jpg',
      heroCtaText: 'See the pieces'
    });
    ok('the eyebrow is applied', (await page.textContent('#heroEyebrow')) === 'Lusaka');
    ok('both heading lines are applied',
       (await page.textContent('#heroTitle')) === 'Something New,' &&
       (await page.textContent('#heroTitleEm')) === 'Beautifully Made');
    ok('the subtitle is applied',
       (await page.textContent('#heroSub')) === 'A short line about the edit.');
    ok('the photos are applied',
       await page.evaluate(() =>
         getComputedStyle(document.querySelector('#heroPhoto1')).backgroundImage.includes('h1.jpg')));
    ok('an unset photo is left alone',
       await page.evaluate(() =>
         !getComputedStyle(document.querySelector('#heroPhoto3')).backgroundImage.includes('cdn.test')));
    ok('the button takes its wording',
       (await page.textContent('.hero-cta .btn')).trim() === 'See the pieces');
    ok('and with no link set it is still the shop button',
       await page.evaluate(() => !!document.querySelector('.hero-cta [data-go-shop]')));
    await ctx.close();
  }
  {
    const { page, ctx } = await shop(browser, { heroEnabled: false });
    ok('the whole hero can be switched off',
       await page.evaluate(() => document.querySelector('#hero').classList.contains('hide')));
    await ctx.close();
  }
  {
    const { page, ctx, errors } = await shop(browser, {
      heroEnabled: true, heroCtaText: 'Read our policies', heroCtaLink: '#/policies' });
    ok('no page errors', errors.length === 0, errors);
    const a = await page.evaluate(() => {
      const e = document.querySelector('.hero-cta a[href="#/policies"]');
      return e ? { text: e.textContent.trim(), target: e.getAttribute('target') } : null;
    });
    ok('a link on this site becomes a plain link', a && a.text === 'Read our policies', a);
    ok('and does not open a new tab', a && !a.target, a);
    await ctx.close();
  }
  {
    const { page, ctx } = await shop(browser, {
      heroEnabled: true, heroCtaText: 'Visit us', heroCtaLink: 'https://example.com/shop' });
    const a = await page.evaluate(() => {
      const e = document.querySelector('.hero-cta a[href^="https://example.com"]');
      return e ? { target: e.getAttribute('target'), rel: e.getAttribute('rel') } : null;
    });
    ok('a link elsewhere opens in a new tab', a && a.target === '_blank', a);
    ok('with rel=noopener', a && /noopener/.test(a.rel || ''), a);
    await ctx.close();
  }

  console.log('\n== our story ==');
  {
    const { page, ctx } = await shop(browser, {
      storyHeading: 'How we began', storyP1: 'First paragraph.', storyP2: 'Second paragraph.' });
    ok('the heading is applied', (await page.textContent('#storyHeading')) === 'How we began');
    ok('both paragraphs are applied',
       (await page.textContent('#storyP1')) === 'First paragraph.' &&
       (await page.textContent('#storyP2')) === 'Second paragraph.');
    await ctx.close();
  }
  {
    const { page, ctx } = await shop(browser, {
      storyHeading: 'How we began', storyP1: 'Only one paragraph.', storyP2: '' });
    ok('an empty second paragraph is hidden rather than left as shipped copy',
       await page.evaluate(() => document.querySelector('#storyP2').classList.contains('hide')));
    ok('the first is still there',
       await page.evaluate(() => !document.querySelector('#storyP1').classList.contains('hide')));
    await ctx.close();
  }

  console.log('\n== core values ==');
  {
    const { page, ctx } = await shop(browser, { values: [] });
    ok('an empty list keeps the four the site shipped with',
       await page.evaluate(() => document.querySelectorAll('#valuesGrid .trust-cell').length) === 4);
    await ctx.close();
  }
  {
    const { page, ctx, errors } = await shop(browser, { values: [
      { t: 'Hand picked', s: 'Every piece chosen by us' },
      { t: 'Fair prices', s: 'No mark-up for the name' },
      { t: 'Real people', s: 'We answer our own messages' },
      { t: 'Nationwide', s: 'Delivered across Zambia' },
      { t: 'Trusted', s: 'Since day one' }
    ] });
    ok('no page errors', errors.length === 0, errors);
    const cells = await page.$$eval('#valuesGrid .trust-cell .t', e => e.map(x => x.textContent));
    ok('five values give five cells, not four', cells.length === 5, cells);
    ok('the words are the shop’s own', cells[0] === 'Hand picked', cells);
    ok('each still has its mark',
       await page.evaluate(() =>
         Array.prototype.every.call(document.querySelectorAll('#valuesGrid .trust-cell'),
           c => !!c.querySelector('svg'))));
    await ctx.close();
  }
  {
    const { page, ctx } = await shop(browser, { values: [{ t: 'Only one', s: 'That is all' }] });
    ok('one value gives one cell',
       await page.evaluate(() => document.querySelectorAll('#valuesGrid .trust-cell').length) === 1);
    await ctx.close();
  }

  console.log('\n== the page follows the shop’s order ==');
  {
    const { page, ctx, errors } = await shop(browser, {
      sections: [
        { id: 'story', on: true }, { id: 'reviews', on: true },
        { id: 'lookbook', on: false }, { id: 'collections-sec', on: true }
      ]
    });
    ok('no page errors', errors.length === 0, errors);
    const order = await page.evaluate(() =>
      Array.prototype.map.call(document.querySelectorAll('main > section'), s => s.id));
    ok('the shop’s first choice comes first',
       order.indexOf('story') < order.indexOf('reviews'), order.slice(0, 6));
    ok('a section it did not mention still appears',
       order.includes('rewards'), order);
    ok('the hero is left where it is, since it is the frame',
       order[0] === 'hero', order.slice(0, 3));
    ok('a section switched off is hidden',
       await page.evaluate(() => document.querySelector('#lookbook').classList.contains('hide')));
    ok('but is still on the page, not deleted',
       await page.evaluate(() => !!document.querySelector('#lookbook')));
    await ctx.close();
  }

  console.log('\n== section headings ==');
  {
    const { page, ctx } = await shop(browser, {
      sections: [{ id: 'lookbook', on: true, title: 'Worn by our clients',
                   desc: 'A few of our favourite pairings.' }]
    });
    ok('a section takes the shop’s heading',
       (await page.textContent('#lookbook .section-head h2')) === 'Worn by our clients');
    ok('and gains a line underneath where it had none',
       (await page.textContent('#lookbook .section-head p')) === 'A few of our favourite pairings.');
    await ctx.close();
  }

  console.log('\n== promotional banner ==');
  {
    const { page, ctx } = await shop(browser, { promoEnabled: false });
    ok('it stays hidden while switched off',
       await page.evaluate(() => document.querySelector('#promo').classList.contains('hide')));
    await ctx.close();
  }
  {
    const { page, ctx } = await shop(browser, { promoEnabled: true, promoTitle: '' });
    ok('and while it has nothing to say',
       await page.evaluate(() => document.querySelector('#promo').classList.contains('hide')));
    await ctx.close();
  }
  {
    const { page, ctx, errors } = await shop(browser, {
      promoEnabled: true, promoTitle: 'Mid-season edit',
      promoText: 'Selected pieces, while they last.',
      promoCtaText: 'See the edit', promoCtaLink: '#/shop',
      promoImage: 'https://cdn.test/promo.jpg'
    });
    ok('no page errors', errors.length === 0, errors);
    ok('it appears once it has a headline',
       await page.evaluate(() => !document.querySelector('#promo').classList.contains('hide')));
    ok('with the headline', (await page.textContent('#promoTitle')) === 'Mid-season edit');
    ok('the supporting line', (await page.textContent('#promoText')).includes('while they last'));
    ok('the photo behind it',
       await page.evaluate(() =>
         getComputedStyle(document.querySelector('#promoBg')).backgroundImage.includes('promo.jpg')));
    ok('and its button', await page.getAttribute('#promoCta', 'href') === '#/shop');
    await ctx.close();
  }
  {
    const { page, ctx } = await shop(browser, {
      promoEnabled: true, promoTitle: 'Just a notice', promoCtaText: '' });
    ok('no button when none was asked for',
       await page.evaluate(() => document.querySelector('#promoCta').classList.contains('hide')));
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
    await p.goto('http://127.0.0.1:' + PORT + '/admin.html#/settings/homepage');
    await p.waitForSelector('#f_heroTitle', { timeout: 6000 });
    await p.waitForTimeout(300);

    ok('no page errors', errors.length === 0, errors);
    const names = await p.evaluate(() =>
      Array.prototype.map.call(document.querySelectorAll('#setPage [id^=f_]'), e => e.id.slice(2)));
    const want = ['announceEnabled','announceText','heroEnabled','heroEyebrow','heroTitle',
                  'heroTitleEm','heroSubtitle','heroCtaText','heroCtaLink',
                  'heroImage1','heroImage2','heroImage3',
                  'storyHeading','storyP1','storyP2','values'];
    ok('every field is drawn', want.every(w => names.includes(w)), want.filter(w => !names.includes(w)));

    ok('switching the hero off hides what it would have asked for',
       await p.evaluate(() => {
         document.querySelector('#f_heroEnabled').closest('.sw-row').click();
         return true;
       }));
    await p.waitForTimeout(200);
    ok('the hero fields go with it',
       await p.evaluate(() => ['heroTitle','heroCtaText','heroImage1']
         .every(n => document.querySelector('#f_' + n).closest('.field').classList.contains('hide'))));
    await p.evaluate(() => document.querySelector('#f_heroEnabled').closest('.sw-row').click());
    await p.waitForTimeout(200);

    console.log('\n== the button link is checked ==');
    await p.fill('#f_heroCtaLink', 'shop');
    await p.click('#setPage .save-bar .btn-gold');
    await p.waitForTimeout(150);
    ok('a link that is neither a page nor an address is refused',
       await p.evaluate(() => document.querySelector('#f_heroCtaLink')
         .closest('.field').classList.contains('bad')));
    await p.fill('#f_heroCtaLink', '#/shop');
    await p.click('#setPage .save-bar .btn-gold');
    await p.waitForTimeout(300);
    ok('a page on this site is accepted',
       (await p.textContent('#setPage .save-bar .stat')).includes('Saved'),
       await p.textContent('#setPage .save-bar .stat'));

    console.log('\n== values as a list ==');
    await p.click('#setPage .list-add');
    await p.waitForTimeout(150);
    await p.evaluate(() => {
      const row = document.querySelector('#f_values .list-row');
      const set = (sel, v) => { const e = row.querySelector(sel); e.value = v;
        e.dispatchEvent(new Event('input', { bubbles: true })); };
      const ins = row.querySelectorAll('input');
      ins[0].value = 'Hand picked'; ins[0].dispatchEvent(new Event('input', { bubbles: true }));
      ins[1].value = 'Chosen by us'; ins[1].dispatchEvent(new Event('input', { bubbles: true }));
    });
    await p.waitForTimeout(150);
    ok('a value can be added', await p.evaluate(() =>
       document.querySelectorAll('#f_values .list-row').length) === 1);
    ok('and the row titles itself',
       (await p.textContent('#f_values .list-cap')) === 'Hand picked',
       await p.textContent('#f_values .list-cap'));

    await p.click('#setPage .save-bar .btn-gold');
    await p.waitForTimeout(300);
    const saved = await p.evaluate(() =>
      window.__saves.filter(s => s.payload.key === 'homepage').pop());
    ok('it saves under the homepage key', !!saved);
    ok('with the value', saved && saved.payload.data.values[0].t === 'Hand picked',
       saved && saved.payload.data.values);
    ok('and the button link', saved && saved.payload.data.heroCtaLink === '#/shop');

    console.log('\n== testimonials and lookbook moved in ==');
    ok('the testimonials list is here', await p.$('#f_testimonials') !== null);
    ok('and six lookbook slots',
       await p.evaluate(() => [1,2,3,4,5,6].every(n => !!document.querySelector('#f_look' + n))));
    ok('the Site Content tab is gone from the admin',
       await p.$$eval('.tab', e => e.map(x => x.getAttribute('data-tab')))
         .then(t => !t.includes('content')));

    console.log('\n== lookbook photos actually appear ==');
    {
      /* A photo was set on a tile that still carried the placeholder
         class. That class paints its gradient with the `background`
         shorthand, which quietly resets size, position and repeat too, so
         the photo rendered at its natural size in the tile's top left
         corner and tiled across. On a large photograph that looks like a
         flat patch of colour, which is exactly what the shop saw. */
      const PHOTO = 'data:image/svg+xml;base64,' + Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900">' +
        '<rect width="1200" height="900" fill="#8a6b4a"/></svg>').toString('base64');
      const { page, ctx, errors } = await shop(browser,
        { lookImages: [PHOTO, PHOTO, '', '', '', ''] });
      ok('no page errors', errors.length === 0, errors);

      const tiles = await page.evaluate(() => [1, 2, 3].map(n => {
        const e = document.getElementById('look' + n);
        const c = getComputedStyle(e);
        return { placeholder: e.classList.contains('fallback'),
                 size: c.backgroundSize, pos: c.backgroundPosition,
                 isImage: /^url\(/.test(c.backgroundImage) };
      }));
      ok('a tile with a photo drops the placeholder class', !tiles[0].placeholder);
      ok('and shows the photo', tiles[0].isImage && tiles[1].isImage, tiles);
      ok('covering the tile rather than sitting at its natural size',
         tiles[0].size === 'cover', tiles[0].size);
      ok('and centred rather than anchored to the corner',
         tiles[0].pos === '50% 50%', tiles[0].pos);
      ok('a tile with no photo keeps the placeholder', tiles[2].placeholder);
      ok('and shows the gradient, not a broken image', !tiles[2].isImage);

      /* Even if the class were left on, the stylesheet should not be the
         thing that breaks the photo. */
      const guard = fs.readFileSync(path.join(ROOT, 'assets/styles.css'), 'utf8');
      ok('the placeholder paints with background-image, not the shorthand',
         !/\.ph\.fallback\{background:/.test(guard));
      await ctx.close();
    }

    console.log('\n== the section list ==');
    const rows = await p.$$eval('#f_sections .list-row', e => e.length);
    ok('every section of the page is listed', rows === 22, rows);
    ok('there is no Add button, since sections are not invented here',
       await p.evaluate(() => document.querySelector('#f_sections')
         .parentNode.querySelector('.list-add').classList.contains('hide')));
    ok('and no Remove buttons',
       await p.evaluate(() => Array.prototype.every.call(
         document.querySelectorAll('#f_sections .list-drop'),
         b => b.classList.contains('hide'))));
    ok('the first row cannot move up',
       await p.evaluate(() => document.querySelectorAll('#f_sections .list-row')[0]
         .querySelectorAll('.list-move')[0].disabled));
    ok('the last row cannot move down',
       await p.evaluate(() => {
         const r = document.querySelectorAll('#f_sections .list-row');
         return r[r.length - 1].querySelectorAll('.list-move')[1].disabled;
       }));

    const firstBefore = await p.textContent('#f_sections .list-cap');
    await p.evaluate(() => document.querySelectorAll('#f_sections .list-row')[1]
      .querySelectorAll('.list-move')[0].click());
    await p.waitForTimeout(200);
    const firstAfter = await p.textContent('#f_sections .list-cap');
    ok('moving a row up reorders the list', firstAfter !== firstBefore,
       [firstBefore, firstAfter]);

    await p.evaluate(() => {
      const row = Array.prototype.find.call(
        document.querySelectorAll('#f_sections .list-row'),
        r => /Lookbook/.test(r.querySelector('.list-cap').textContent));
      row.querySelector('.sw-row').click();
    });
    await p.waitForTimeout(200);
    ok('switching a section off says so on its row',
       await p.evaluate(() => Array.prototype.some.call(
         document.querySelectorAll('#f_sections .list-cap'),
         c => /Lookbook — hidden/.test(c.textContent))));

    await p.click('#setPage .save-bar .btn-gold');
    await p.waitForTimeout(400);
    const savedSecs = await p.evaluate(() =>
      window.__saves.filter(s => s.payload.key === 'homepage').pop());
    ok('the order is stored', savedSecs && savedSecs.payload.data.sections.length === 22,
       savedSecs && savedSecs.payload.data.sections.length);
    ok('with the section that was switched off',
       savedSecs && savedSecs.payload.data.sections.some(r => r.id === 'lookbook' && r.on === false));
    ok('and the reordered first section',
       savedSecs && savedSecs.payload.data.sections[0].id === 'collections-sec',
       savedSecs && savedSecs.payload.data.sections[0]);
    ok('no page errors across the run', errors.length === 0, errors);
    await ctx.close();
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})();
