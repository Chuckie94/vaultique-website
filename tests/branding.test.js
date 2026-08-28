/* =====================================================================
   Settings > Branding & Appearance, driven through the real admin.
   The database is a stand-in, uploads are stubbed, and everything else
   is the page a shop owner would actually use.
   ===================================================================== */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8130;

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')); } };

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

(async () => {
  const srv = http.createServer((req, res) => {
    const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    fs.readFile(f, (e, d) => {
      if (e) { res.writeHead(404); res.end('no'); return; }
      res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' });
      res.end(d);
    });
  });
  await new Promise(r => srv.listen(PORT, r));
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(String(e)));
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });

  await p.addInitScript(() => {
    window.__rows = { 'site_settings:general': { data: { businessName: 'Vaultique Boutique Point',
      tagline: 'Curated Elegance, Accessible Luxury' } } };
  });
  await p.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript',
    body: "window.VBP_CONFIG={SUPABASE_URL:'https://x.supabase.co',SUPABASE_ANON_KEY:'k'};" }));
  await p.route('**/@supabase/supabase-js**', r => r.fulfill({ contentType: 'text/javascript', body: STUB }));
  await p.route('**/fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  await p.route('**/api/products', r => r.fulfill({ contentType: 'application/json', body: '{"products":[]}' }));

  await p.goto('http://127.0.0.1:' + PORT + '/admin.html');
  await p.waitForSelector('#admin:not(.hide)');
  await p.evaluate(() => {
    window.__uploads = [];
    window.VBP_ADMIN.uploadImage = function (file, prefix) {
      window.__uploads.push(prefix);
      return Promise.resolve('https://cdn.test/' + prefix + '.png');
    };
  });

  console.log('\n== the section opens ==');
  await p.click('.tab[data-tab="settings"]');
  await p.waitForSelector('#setGrid .set-item');
  const titles = await p.$$eval('#setGrid .set-item .t', e => e.map(x => x.textContent));
  ok('all 15 categories are listed', titles.length === 15, titles.length);
  ok('Branding & Appearance is one of them',
     titles.includes('Branding & Appearance'), titles);

  await p.evaluate(() => { location.hash = '#/settings/branding'; });
  await p.waitForSelector('#f_primaryColour', { timeout: 5000 });
  ok('no page errors', errors.length === 0, errors);

  console.log('\n== every setting is present ==');
  const wanted = ['logoMain','logoMobile','logoFooter','favicon','socialImage',
                  'primaryColour','secondaryColour','accentColour','backgroundColour',
                  'textColour','buttonColour','headingFont','bodyFont','customCss',
                  'buttonStyle','cardStyle','borderRadius'];
  const present = await p.evaluate(() =>
    Array.prototype.map.call(document.querySelectorAll('#setPage [id^=f_]'), e => e.id.slice(2)));
  ok('all seventeen fields are drawn',
     wanted.every(w => present.includes(w)), wanted.filter(w => !present.includes(w)));
  ok('the three shape choices are drawn',
     await p.evaluate(() => document.querySelectorAll('#setPage .choice-row').length) === 3);
  ok('five image slots', await p.evaluate(() =>
     document.querySelectorAll('#setPage .img-frame').length) === 5);
  ok('that is all seventeen settings', wanted.length === 17, wanted.length);

  console.log('\n== the preview is live ==');
  ok('a preview is drawn', await p.isVisible('#setPage .vbp-preview'));
  const before = await p.evaluate(() =>
    getComputedStyle(document.querySelector('#setPage .pv-bar')).backgroundColor);
  ok('it starts on the shipped navy', before === 'rgb(11, 31, 58)', before);

  await p.fill('#f_primaryColour', '#14532d');
  await p.waitForTimeout(150);
  const after = await p.evaluate(() =>
    getComputedStyle(document.querySelector('#setPage .pv-bar')).backgroundColor);
  ok('typing a colour repaints it', after === 'rgb(20, 83, 45)', after);
  ok('the storefront itself is untouched by the preview',
     await p.evaluate(() =>
       getComputedStyle(document.body).backgroundColor) !== 'rgb(20, 83, 45)');
  ok('and the admin keeps its own look',
     await p.evaluate(() =>
       getComputedStyle(document.documentElement).getPropertyValue('--navy').trim()) === '#0B1F3A');

  console.log('\n== the shape choices work ==');
  await p.evaluate(() => {
    const rows = document.querySelectorAll('#setPage .choice-row');
    rows[0].querySelectorAll('button')[2].click();       // button style: pill
    rows[1].querySelectorAll('button')[2].click();       // card style: raised
  });
  await p.waitForTimeout(150);
  ok('a pill button shows as a pill in the preview',
     await p.evaluate(() =>
       getComputedStyle(document.querySelector('#setPage .pv-btn')).borderRadius) === '999px');
  ok('the card preset reaches the preview',
     await p.evaluate(() =>
       document.querySelector('#setPage .vbp-preview').classList.contains('cards-shadow')));
  ok('the chosen options are marked',
     await p.evaluate(() =>
       document.querySelectorAll('#setPage .choice.on').length) === 3);

  console.log('\n== the preview badge is not swallowed by the initials ==');
  {
    const sizes = await p.evaluate(() => ({
      init: parseFloat(getComputedStyle(document.querySelector('#setPage .pv-init')).fontSize),
      tag: parseFloat(getComputedStyle(document.querySelector('#setPage .pv-tag')).fontSize)
    }));
    ok('the New badge stays small beside the initials',
       sizes.tag < sizes.init / 2, sizes);
  }

  console.log('\n== unreadable pairings are called out ==');
  ok('nothing to warn about so far',
     await p.evaluate(() => document.querySelectorAll('#setPage .warn').length) === 0);
  await p.fill('#f_textColour', '#f2eee6');            // pale text on a pale page
  await p.waitForTimeout(150);
  const warned = await p.evaluate(() =>
    Array.prototype.map.call(document.querySelectorAll('#setPage .warn'), e => e.textContent));
  ok('pale text on a pale page is flagged', warned.length > 0, warned);
  ok('the warning says which pairing and by how much',
     warned.some(w => /Body text/.test(w) && /:1/.test(w)), warned);
  ok('a warning does not block saving',
     !(await p.isDisabled('#setPage .save-bar .btn-gold')));
  await p.fill('#f_textColour', '#15202e');
  await p.waitForTimeout(150);
  ok('fixing it clears the warning',
     await p.evaluate(() => document.querySelectorAll('#setPage .warn').length) === 0);

  console.log('\n== a colour must be a colour ==');
  await p.fill('#f_secondaryColour', 'burnt sienna');
  await p.click('#setPage .save-bar .btn-gold');
  await p.waitForTimeout(150);
  ok('nonsense is refused',
     await p.evaluate(() =>
       document.querySelector('#f_secondaryColour').closest('.field').classList.contains('bad')));
  ok('nothing was saved',
     await p.evaluate(() => window.__saves.filter(s => s.payload.key === 'branding').length) === 0);
  await p.fill('#f_secondaryColour', 'c9a227');        // no hash, should still be accepted
  await p.evaluate(() => document.querySelector('#f_secondaryColour').blur());
  await p.waitForTimeout(120);
  ok('a hex without its hash is tidied up on the way out',
     await p.inputValue('#f_secondaryColour') === '#c9a227',
     await p.inputValue('#f_secondaryColour'));

  console.log('\n== reset puts a colour back ==');
  await p.evaluate(() => {
    const f = document.querySelector('#f_primaryColour').closest('.field');
    f.querySelector('.col-reset').click();
  });
  await p.waitForTimeout(120);
  ok('reset restores the shipped colour',
     (await p.inputValue('#f_primaryColour')).toLowerCase() === '#0b1f3a',
     await p.inputValue('#f_primaryColour'));

  console.log('\n== the sharing-image snippet ==');
  ok('it explains itself before an image is chosen',
     /two lines to paste/.test(await p.textContent('#setPage')));
  await p.setInputFiles('#setPage .img-frame ~ .img-side input[type=file] >> nth=4', {
    name: 'share.png', mimeType: 'image/png', buffer: Buffer.alloc(600)
  });
  await p.waitForTimeout(250);
  const snip = await p.textContent('#setPage .snip pre').catch(() => '');
  ok('the snippet appears once an image is chosen', snip.length > 0, snip);
  ok('it carries the og:image tag with the uploaded URL',
     /og:image/.test(snip) && /cdn\.test/.test(snip), snip);
  ok('and the twitter card line', /twitter:card/.test(snip), snip);
  ok('with a copy button', await p.isVisible('#setPage .snip-bar button'));

  console.log('\n== saving ==');
  await p.click('#setPage .save-bar .btn-gold');
  await p.waitForTimeout(300);
  ok('it reports success',
     (await p.textContent('#setPage .save-bar .stat')).includes('Saved'),
     await p.textContent('#setPage .save-bar .stat'));
  const saved = await p.evaluate(() =>
    window.__saves.filter(s => s.payload.key === 'branding').pop());
  ok('stored under the branding key', !!saved);
  ok('the colours are stored', saved && saved.payload.data.secondaryColour === '#c9a227',
     saved && saved.payload.data.secondaryColour);
  ok('the shape choices are stored',
     saved && saved.payload.data.buttonStyle === 'pill' && saved.payload.data.cardStyle === 'shadow',
     saved && [saved.payload.data.buttonStyle, saved.payload.data.cardStyle]);
  ok('the sharing image is stored',
     saved && /cdn\.test/.test(saved.payload.data.socialImage), saved && saved.payload.data.socialImage);

  console.log('\n== custom CSS ==');
  await p.fill('#f_customCss', '.hero-title{letter-spacing:.06em}');
  await p.waitForTimeout(120);
  ok('the box takes CSS', (await p.inputValue('#f_customCss')).includes('hero-title'));
  ok('it is not applied to the admin',
     await p.evaluate(() => !document.getElementById('vbp-custom')));
  const counter = await p.evaluate(() => {
    const f = document.querySelector('#f_customCss').closest('.field');
    const c = f.querySelector('.cnt');
    return c ? c.textContent : '';
  });
  ok('the length is shown against its cap', /\/\s*20000/.test(counter), counter);

  console.log('\n== reopening shows what was saved ==');
  // custom CSS was typed after the save, so leaving asks first
  p.on('dialog', d => d.accept());
  await p.evaluate(() => { window.VBP_ADMIN.store.forget(); location.hash = '#/settings'; });
  await p.waitForTimeout(200);
  await p.evaluate(() => { location.hash = '#/settings/branding'; });
  await p.waitForSelector('#f_primaryColour');
  await p.waitForTimeout(250);
  ok('the saved secondary colour comes back',
     (await p.inputValue('#f_secondaryColour')).toLowerCase() === '#c9a227',
     await p.inputValue('#f_secondaryColour'));
  ok('the saved button style comes back',
     await p.evaluate(() => {
       const rows = document.querySelectorAll('#setPage .choice-row');
       const on = rows[0].querySelector('.choice.on .choice-lab');
       return on ? on.textContent : null;
     }) === 'Pill');
  ok('the preview matches what was saved',
     await p.evaluate(() =>
       getComputedStyle(document.querySelector('#setPage .pv-btn')).borderRadius) === '999px');

  console.log('\n== summary ==');
  ok('no page errors across the run', errors.length === 0, errors);
  console.log('\n' + pass + ' passed, ' + fail + ' failed');

  await b.close(); srv.close();
  process.exit(fail ? 1 : 0);
})();
