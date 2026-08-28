const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');

const ROOT = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); res.end('no'); return; }
    const t = f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html';
    res.writeHead(200, { 'Content-Type': t }); res.end(d);
  });
});

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')); } };

const STUB = `
window.__rows = window.__rows || {}; window.__saves = [];
function tbl(name){
  var q={_v:null};
  q.select=function(){return q;}; q.order=function(){return q;};
  q.eq=function(c,v){q._v=v;return q;};
  q.maybeSingle=function(){var r=window.__rows[name+':'+q._v];return Promise.resolve({data:r?JSON.parse(JSON.stringify(r)):null,error:null});};
  q.upsert=function(p){var id=p.key!==undefined?p.key:p.id;var c=JSON.parse(JSON.stringify(p));window.__rows[name+':'+id]={data:c.data};
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
  await new Promise(r => server.listen(8099, r));
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(String(e)));
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });

  await p.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript',
    body: "window.VBP_CONFIG={SUPABASE_URL:'https://x.supabase.co',SUPABASE_ANON_KEY:'k',IMAGE_BUCKET:'product-images'};" }));
  await p.route('**/@supabase/supabase-js**', r => r.fulfill({ contentType: 'text/javascript', body: STUB }));
  await p.route('**/fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  await p.route('**/api/products', r => r.fulfill({ contentType: 'application/json', body: '{"products":[]}' }));

  await p.addInitScript(() => {
    window.__rows = { 'site_content:1': { data: { tagline: 'From General', hours: 'Mon-Sat 9am-6pm' } } };
  });
  await p.goto('http://127.0.0.1:8099/admin.html');
  await p.waitForSelector('#admin:not(.hide)', { timeout: 5000 });

  console.log('\n== shell boots ==');
  ok('admin visible without the login panel', await p.isHidden('#login'));
  ok('no page errors on boot', errors.length === 0, errors);
  ok('supabase client shared on VBP_ADMIN', await p.evaluate(() => !!window.VBP_ADMIN.sb));
  ok('store and kit both loaded',
     await p.evaluate(() => !!(window.VBP_ADMIN.store && window.VBP_ADMIN.ui)));

  console.log('\n== settings index ==');
  await p.click('.tab[data-tab="settings"]');
  await p.waitForSelector('#setGrid .set-item');
  const cats = await p.$$eval('#setGrid .set-item .t', els => els.map(e => e.textContent));
  ok('all 15 categories listed', cats.length === 15, cats.length);
  ok('General is first', cats[0] === 'General', cats[0]);

  console.log('\n== General opens through the shell ==');
  await p.click('#setGrid .set-item:first-child');
  await p.waitForSelector('#f_businessName', { timeout: 5000 });
  ok('route is #/settings/general', p.url().includes('#/settings/general'), p.url());
  ok('form rendered inside the settings page', await p.isVisible('#setPage .save-bar'));
  ok('back crumb present', await p.isVisible('#setPage .crumb button'));
  ok('ctx carried the kit through', errors.length === 0, errors);

  console.log('\n== unsaved changes guard ==');
  await p.fill('#f_city', 'Ndola');
  let asked = 0;
  p.on('dialog', d => { asked++; d.dismiss(); });          // decline the first
  await p.click('.tab[data-tab="products"]');
  await p.waitForTimeout(150);
  ok('leaving a dirty form asks first', asked === 1, asked);
  ok('declining keeps you on General', await p.isVisible('#f_businessName'));

  p.removeAllListeners('dialog');
  p.on('dialog', d => { asked++; d.accept(); });            // accept the second
  await p.click('.tab[data-tab="products"]');
  await p.waitForTimeout(150);
  ok('accepting lets you leave', asked === 2 && await p.isHidden('#tab-settings'), asked);

  console.log('\n== clean form does not nag ==');
  await p.click('.tab[data-tab="settings"]');
  await p.click('#setGrid .set-item:first-child');
  await p.waitForSelector('#f_businessName');
  const before = asked;
  await p.click('#setPage .crumb button');
  await p.waitForTimeout(150);
  ok('a clean form leaves silently', asked === before, asked);
  ok('back crumb returns to the index', await p.isVisible('#setGrid'));

  console.log('\n== Site Content has been retired ==');
  // Everything that tab held now lives in Settings. The site_content row
  // itself is left alone, because the storefront still reads it as a
  // fallback for a shop that has not opened those sections yet.
  {
    const tabs = await p.$$eval('.tab', e => e.map(x => x.getAttribute('data-tab')));
    ok('the tab is gone', !tabs.includes('content'), tabs);
    ok('eight tabs remain, Orders having joined them', tabs.length === 8, tabs.length);
    ok('its panel is gone too', await p.$('#tab-content') === null);

    await p.evaluate(() => { location.hash = '#/content'; });
    await p.waitForTimeout(200);
    ok('asking for it by address falls back rather than showing nothing',
       await p.isVisible('#tab-products'));

    const homes = ['general', 'homepage', 'contact', 'payments'];
    for (const key of homes) {
      await p.evaluate(k => { location.hash = '#/settings/' + k; }, key);
      await p.waitForTimeout(250);
      ok('Settings > ' + key + ' opens',
         await p.evaluate(() => !!document.querySelector('#setPage .save-bar')));
    }
    ok('no page errors from the retired tab', errors.length === 0, errors);
  }

  /* The browser's own confirm() and alert() boxes carry its chrome and the
     site's domain, which is a strange thing to be shown by your own admin
     halfway through deleting a policy. Every one of them is now asked in
     the shop's voice instead. */
  console.log('\n== asking, in the shop\'s own voice ==');
  {
    let nativeShown = false;
    p.on('dialog', d => { nativeShown = true; d.dismiss(); });

    const src = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*/gm, '');
    ok('no confirm() left in the admin', !/(^|[^.\w])confirm\s*\(/.test(src));
    ok('no alert() either', !/(^|[^.\w])alert\s*\(/.test(src));
    ok('and no window.prompt', !/window\.prompt\s*\(/.test(src));

    /* Shared on VBP_ADMIN so the settings sections, which live in their
       own files, can ask things too. */
    const seen = await p.evaluate(() =>
      (window.VBP_ADMIN && typeof window.VBP_ADMIN.ask === 'function' &&
       typeof window.VBP_ADMIN.tell === 'function') ? null : 'not shared');
    ok('the admin shares its own ask() and tell()', seen === null, seen);

    /* Opened, it must behave like a dialog: focus inside it, Escape
       cancels, and the answer comes back rather than being assumed. */
    await p.evaluate(() => { window.__answer = 'pending'; 
      VBP_ADMIN.ask('Delete this thing?', { danger: true, note: 'This cannot be undone.' })
        .then(a => { window.__answer = a; }); });
    await p.waitForTimeout(250);

    const shown = await p.evaluate(() => {
      const c = document.querySelector('.ask-card');
      if (!c) return null;
      return { body: c.querySelector('p').textContent,
               note: c.querySelector('.ask-note').textContent,
               buttons: [...c.querySelectorAll('button')].map(b => b.textContent),
               danger: !!c.querySelector('.btn-danger'),
               focused: document.activeElement.textContent,
               modal: document.querySelector('.ask-back').getAttribute('aria-modal') };
    });
    ok('a dialog appears in the page', !!shown, shown);
    ok('carrying the question', shown && shown.body === 'Delete this thing?', shown);
    ok('and the consequence', shown && /cannot be undone/.test(shown.note), shown);
    ok('a destructive answer is marked as one', shown && shown.danger);
    /* A destructive answer should not be the one a stray keypress lands on. */
    ok('but Cancel takes the focus, not Delete', shown && shown.focused === 'Cancel', shown);
    ok('it is announced as a dialog', shown && shown.modal === 'true', shown);

    await p.keyboard.press('Escape');
    await p.waitForTimeout(350);
    ok('Escape closes it', await p.evaluate(() => !document.querySelector('.ask-back')));
    ok('answering no', await p.evaluate(() => window.__answer) === false);

    await p.evaluate(() => { window.__answer = 'pending';
      VBP_ADMIN.ask('Do the thing?').then(a => { window.__answer = a; }); });
    await p.waitForTimeout(250);
    await p.click('.ask-card .btn-gold');
    await p.waitForTimeout(350);
    ok('and pressing the button answers yes',
       await p.evaluate(() => window.__answer) === true);

    await p.evaluate(() => { window.__told = 'pending';
      VBP_ADMIN.tell('Nothing to copy.').then(a => { window.__told = a; }); });
    await p.waitForTimeout(250);
    const told = await p.evaluate(() => {
      const c = document.querySelector('.ask-card');
      return c ? [...c.querySelectorAll('button')].map(b => b.textContent) : null;
    });
    ok('tell() offers one button, since there is nothing to decline',
       told && told.length === 1, told);
    await p.keyboard.press('Escape');
    await p.waitForTimeout(350);

    ok('no browser dialog was ever shown', !nativeShown);
  }

  console.log('\n== summary ==');
  ok('no page errors across the run', errors.length === 0, errors);
  console.log('\n' + pass + ' passed, ' + fail + ' failed');

  await b.close(); server.close();
  process.exit(fail ? 1 : 0);
})();
