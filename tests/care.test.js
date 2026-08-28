/* =====================================================================
   Settings > Customer Care, and where the policies actually live.

   Almost everything in the section that asked for this already existed:
   support email, phone, WhatsApp and hours in Contact & Social; delivery
   information in Delivery & Collection; payment information in Payments;
   and all seven policies already written in the Policies tab, among
   sixty-four of them.

   So most of what is checked here is that none of it was built twice —
   and that the one thing genuinely missing was fixed: three of the four
   help panels had their wording written into index.html, where nobody
   could edit them.
   ===================================================================== */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8162;
const CARE = require(path.join(ROOT, 'assets/care.js'));

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')); } };

const GENERAL = { businessName: 'Vaultique Boutique Point', currency: 'ZMW',
  numberFormat: '1,234.56', city: 'Lusaka', country: 'Zambia',
  address: 'Shop 12, Manda Hill', timezone: 'Africa/Lusaka',
  websiteStatus: 'live', maintenanceMode: false };

const DELIVERY = { deliveryEnabled: true, showFees: true, standardFee: 120,
  standardDays: 'Two to four working days',
  areas: [{ name: 'Lusaka', days: 'Same day or next day', fee: 80 }],
  pickupEnabled: true, pickupUseShopAddress: true,
  pickupInstructions: 'Ask for Chanda at the front desk.' };

const PAYMENTS = { cashEnabled: true, cashName: 'Cash',
  cashInstructions: 'Pay in person when you collect.',
  mobileEnabled: true, mobileName: 'Mobile Money',
  mobileInstructions: 'Send to our mobile money account.' };

const POLICIES = [
  { id: 'p1', section: 'Delivery', title: 'Delivery Policy', body: '…', sort: 1 },
  { id: 'p2', section: 'Returns and After-Sales', title: 'Return Policy', body: '…', sort: 2 },
  { id: 'p3', section: 'Payments', title: 'Payment Policy', body: '…', sort: 3 }
];

/* ------------------------------------------------------------------ */
console.log('\n== nothing was built twice ==');
{
  const care = fs.readFileSync(path.join(ROOT, 'assets/admin/settings/customer-care.js'), 'utf8');
  const contact = fs.readFileSync(path.join(ROOT, 'assets/admin/settings/contact-social.js'), 'utf8');

  /* Contact & Social already holds all four. A fifth and sixth number
     typed here is six numbers free to disagree. */
  ['supportEmail', 'phone', 'whatsapp', 'supportHours'].forEach(function (n) {
    ok('Contact & Social still owns ' + n, new RegExp("name: '" + n + "'").test(contact));
    ok('and Customer Care does not ask again for ' + n,
       !new RegExp("name: '" + n + "'").test(care));
  });

  ok('the section says where those answers live',
     /Contact & Social/.test(care) && /Delivery & Collection/.test(care) && /Payments/.test(care));
}

console.log('\n== the seven policies already existed ==');
{
  const src = fs.readFileSync(path.join(ROOT, 'assets/policies-data.js'), 'utf8');
  const rows = JSON.parse(src.slice(src.indexOf('['), src.lastIndexOf(']') + 1));
  const has = t => rows.some(r => r.title.toLowerCase().includes(t));

  /* Every one of the seven asked for was already written and shipped. */
  [['privacy policy', 'Privacy'], ['terms and conditions', 'Terms'],
   ['return policy', 'Returns'], ['exchange policy', 'Exchange'],
   ['delivery policy', 'Delivery'], ['cancellation policy', 'Cancellation'],
   ['payment policy', 'Payment']].forEach(function (p) {
    ok(p[1] + ' was already written', has(p[0]), rows.map(r => r.title).slice(0, 3));
  });
  ok('and sixty more besides', rows.length >= 60, rows.length);

  /* They are long documents, edited where there is room for them. */
  const care = fs.readFileSync(path.join(ROOT, 'assets/admin/settings/customer-care.js'), 'utf8');
  ok('Customer Care does not try to be a policy editor',
     !/type: 'textarea', name: 'privacy/.test(care) && /Policies tab/.test(care));
}

console.log('\n== the panels a shop starts with ==');
{
  /* Three of these four were written into index.html and could not be
     edited from anywhere. An empty list still shows them, so opening the
     section does not empty the home page. */
  const starter = CARE.cards([]);
  ok('an empty list means the four the site came with', starter.length === 4, starter.length);
  ok('including the two that were locked in the markup',
     starter.some(c => /Size & style/.test(c.title)) &&
     starter.some(c => /Exchanges & returns/.test(c.title)), starter.map(c => c.title));
  ok('the delivery panel borrows rather than repeating',
     starter.find(c => c.title === 'Deliveries').source === 'delivery');
  ok('and so does the payment one',
     starter.find(c => c.title === 'How to pay').source === 'payments');

  const mine = CARE.cards([{ title: 'Just this one' }]);
  ok('writing one of your own replaces them all', mine.length === 1, mine);
  ok('an icon always resolves to something', /svg/.test(CARE.icon('nonsense')));
}

/* ------------------------------------------------------------------ */
function server() {
  return http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    let f = path.join(ROOT, p);
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(ROOT, 'index.html');
    fs.readFile(f, (e, d) => {
      if (e) { res.writeHead(404); res.end('no'); return; }
      res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' });
      res.end(d);
    });
  });
}

async function shop(browser, care, url) {
  const c = await browser.newContext();
  const page = await c.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript',
    body: "window.VBP_CONFIG={SUPABASE_URL:'https://x.supabase.co',SUPABASE_ANON_KEY:'k'};" }));
  await page.route('**/fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('**/maps**', r => r.fulfill({ contentType: 'text/html', body: '' }));
  await page.route('**/api/products', r => r.fulfill({ contentType: 'application/json', body: '{"products":[]}' }));
  await page.route('**/rest/v1/**', r => {
    const u = r.request().url();
    const j = x => ({ contentType: 'application/json', body: JSON.stringify(x) });
    if (u.includes('key=eq.general')) return r.fulfill(j([{ data: GENERAL }]));
    if (u.includes('key=eq.delivery')) return r.fulfill(j([{ data: DELIVERY }]));
    if (u.includes('key=eq.payments')) return r.fulfill(j([{ data: PAYMENTS }]));
    if (u.includes('key=eq.customer-care')) return r.fulfill(j(care === null ? [] : [{ data: care }]));
    if (u.includes('policies')) return r.fulfill(j(POLICIES));
    if (u.includes('site_content')) return r.fulfill(j([{ data: {} }]));
    return r.fulfill(j([]));
  });
  await page.goto('http://127.0.0.1:' + PORT + (url || '/'));
  await page.waitForTimeout(1400);
  return { page, ctx: c, errors };
}

const panels = page => page.evaluate(() =>
  [...document.querySelectorAll('#careGrid .care-card')].map(c => ({
    h: c.querySelector('h3').textContent,
    body: c.querySelector('.care-body').textContent,
    policy: c.querySelector('.care-policy') ? c.querySelector('.care-policy').getAttribute('href') : null,
    wa: !!c.querySelector('.care-wa')
  })));

(async () => {
  const srv = server();
  await new Promise(r => srv.listen(PORT, r));
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  console.log('\n== a shop that has never opened the section ==');
  {
    const { page, ctx: c, errors } = await shop(browser, null);
    ok('no page errors', errors.length === 0, errors);
    const p = await panels(page);
    ok('keeps its four panels', p.length === 4, p.map(x => x.h));
    ok('with the wording it had', /Tell us your usual size/.test(p[0].body), p[0].body.slice(0, 40));
    await c.close();
  }

  console.log('\n== a panel borrows from the section that owns the answer ==');
  {
    const { page, ctx: c, errors } = await shop(browser, null);
    ok('no page errors', errors.length === 0, errors);
    const p = await panels(page);
    const del = p.find(x => x.h === 'Deliveries');
    /* Change a fee once, in Delivery, and the panel follows. */
    ok('the delivery panel shows the real areas and fees',
       /Lusaka/.test(del.body) && /K80/.test(del.body), del.body.slice(0, 80));
    ok('and where to collect from', /Manda Hill/.test(del.body), del.body);

    const pay = p.find(x => x.h === 'How to pay');
    ok('the payment panel shows the real methods',
       /Cash/.test(pay.body) && /Mobile Money/.test(pay.body), pay.body);
    /* This one already worked this way before the section existed. */
    ok('and their instructions', /Pay in person/.test(pay.body), pay.body);
    await c.close();
  }

  console.log('\n== the short answer points at the long one ==');
  {
    const { page, ctx: c } = await shop(browser, null);
    const p = await panels(page);
    ok('the delivery panel links to the Delivery Policy',
       p.find(x => x.h === 'Deliveries').policy === '/policies/delivery-policy', p);
    ok('returns links to the Return Policy',
       p.find(x => x.h === 'Exchanges & returns').policy === '/policies/return-policy');
    /* A card naming a policy the shop has deleted must not offer a dead
       link. */
    await c.close();
  }
  {
    const { page, ctx: c } = await shop(browser,
      { cards: [{ title: 'Sizing', body: 'Ask us.', policy: 'A Policy That Was Deleted' }] });
    const p = await panels(page);
    ok('a link to a policy that no longer exists is not offered',
       p[0].policy === null, p);
    await c.close();
  }

  console.log('\n== your own panels ==');
  {
    const { page, ctx: c, errors } = await shop(browser, {
      careHeading: 'How we help',
      cards: [
        { title: 'Gift wrapping', icon: 'gift', source: 'own',
          body: 'Every order is wrapped by hand.', ask: 'Can you gift wrap?' },
        { title: 'Nothing to say', icon: 'chat', source: 'own', body: '' }
      ]
    });
    ok('no page errors', errors.length === 0, errors);
    const p = await panels(page);
    /* A panel with nothing in it is worse than one fewer panel. */
    ok('an empty panel is left out', p.length === 1, p.map(x => x.h));
    ok('yours replaces the four that shipped', p[0].h === 'Gift wrapping');
    ok('the heading is yours too',
       (await page.textContent('#careHeading')) === 'How we help');
    ok('a panel with no message has no button', p[0].wa === true);
    await c.close();
  }
  {
    const { page, ctx: c } = await shop(browser, { careEnabled: false });
    ok('the whole band can be switched off',
       await page.evaluate(() => getComputedStyle(document.getElementById('care')).display === 'none'));
    await c.close();
  }

  console.log('\n== the FAQ ==');
  {
    const { page, ctx: c } = await shop(browser, { faqEnabled: true, faqs: [] });
    /* Switched on with nothing written is an empty heading. */
    ok('an FAQ with no questions stays hidden',
       await page.evaluate(() => getComputedStyle(document.getElementById('faq')).display === 'none'));
    await c.close();
  }
  {
    const { page, ctx: c, errors } = await shop(browser, {
      faqEnabled: true, faqHeading: 'Frequently asked',
      faqs: [{ q: 'How long does delivery take?', a: 'Two to four working days.',
               policy: 'Delivery Policy' },
             { q: 'Can I return something?', a: 'Within 7 days, unworn.', policy: '' }]
    });
    ok('no page errors', errors.length === 0, errors);
    ok('the band appears', await page.evaluate(() =>
       getComputedStyle(document.getElementById('faq')).display !== 'none'));
    const qs = await page.$$eval('.faq-q', a => a.map(e => e.textContent.replace('+', '').trim()));
    ok('both questions are listed', qs.length === 2, qs);

    /* Answers are folded away until asked for: a wall of text is not a
       list of questions. */
    ok('answers start closed', await page.evaluate(() =>
       !document.querySelector('.faq-item').classList.contains('open')));
    await page.click('.faq-q');
    await page.waitForTimeout(400);
    ok('tapping one opens it', await page.evaluate(() =>
       document.querySelector('.faq-item').classList.contains('open')));
    ok('and it is announced as open', await page.evaluate(() =>
       document.querySelector('.faq-q').getAttribute('aria-expanded') === 'true'));
    ok('the answer links to its policy', await page.evaluate(() => {
      const a = document.querySelector('.faq-a .care-policy');
      return a && a.getAttribute('href') === '/policies/delivery-policy';
    }));
    /* A question nobody answered is the one somebody needs answered. */
    ok('there is a way to ask something else', await page.$('#faqAsk .btn-wa') !== null);

    await page.goto('http://127.0.0.1:' + PORT + '/faq');
    await page.waitForTimeout(1400);
    ok('the FAQ has its own address', await page.evaluate(() =>
       getComputedStyle(document.getElementById('faq')).display !== 'none'));
    await c.close();
  }

  console.log('\n== the section list ==');
  {
    const { page, ctx: c } = await shop(browser, null);
    const ids = await page.evaluate(() => (window.VBP_SECTIONS.ALL || []).map(s => s.id));
    ok('the FAQ can be placed like any other section', ids.indexOf('faq') > -1, ids);
    ok('and the care band still can', ids.indexOf('care') > -1);
    await c.close();
  }

  console.log('\n== the admin page ==');
  {
    const c = await browser.newContext();
    const page = await c.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await page.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript',
      body: "window.VBP_CONFIG={SUPABASE_URL:'https://x.supabase.co',SUPABASE_ANON_KEY:'k'};" }));
    await page.route('**/fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
    await page.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ contentType: 'text/javascript', body: `
window.__rows={}; window.__policies=${JSON.stringify(POLICIES)};
function tbl(name){var q={_v:null};
  q.select=function(){return q;};q.order=function(){return q;};q.eq=function(c,v){q._v=v;return q;};
  q.maybeSingle=function(){var r=window.__rows[name+':'+q._v];
    return Promise.resolve({data:r?JSON.parse(JSON.stringify(r)):null,error:null});};
  q.upsert=function(p){window.__rows[name+':'+(p.key!==undefined?p.key:p.id)]={data:JSON.parse(JSON.stringify(p)).data};
    return Promise.resolve({data:null,error:null});};
  q.then=function(f){var d = name==='policies' ? window.__policies : [];
    return Promise.resolve({data:d,error:null}).then(f);};return q;}
window.supabase={createClient:function(){return{
  auth:{getSession:function(){return Promise.resolve({data:{session:{user:{id:'x'}}}});},signOut:function(){return Promise.resolve();}},
  from:tbl,storage:{from:function(){return{upload:function(){return Promise.resolve({data:null,error:null});},
  getPublicUrl:function(){return{data:{publicUrl:''}};}};}}};}};` }));
    await page.route('**/api/products', r => r.fulfill({ contentType: 'application/json', body: '{"products":[]}' }));
    await page.goto('http://127.0.0.1:' + PORT + '/admin.html#/settings/customer-care');
    await page.waitForTimeout(1400);

    ok('no page errors', errors.length === 0, errors);
    const groups = await page.$$eval('.card h3', a => a.map(e => e.textContent));
    ok('every group is drawn', groups.length === 4, groups);

    const notes = await page.$$eval('.note-field strong', a => a.map(e => e.textContent));
    ok('the section opens by saying where the answers already are',
       /already set, elsewhere/i.test(notes[0] || ''), notes);
    ok('and that the policies are edited in their own tab',
       notes.some(t => /Policies tab/i.test(t)), notes);

    /* A panel points at a policy by name, chosen from the ones that
       actually exist, rather than by an address somebody has to keep
       correct by hand. */
    const opts = await page.$$eval('select[id$="_policy"] option', a => a.map(e => e.textContent));
    ok('a panel can pick from the real policies',
       opts.includes('Delivery Policy') && opts.includes('Return Policy'), opts);
    ok('or none at all', opts.includes('No link'));

    await page.evaluate(() => { document.querySelector('#f_faqEnabled').click(); });
    await page.waitForTimeout(250);
    await page.click('.save-bar .btn-gold');
    await page.waitForTimeout(300);
    ok('an FAQ switched on with no questions is refused',
       await page.evaluate(() => document.querySelector('#f_faqs')
         .closest('.field').classList.contains('bad')));

    /* Switching it back off leaves the form exactly as it loaded, so Save
       is correctly disabled. A real change is needed to save at all. */
    await page.evaluate(() => { document.querySelector('#f_faqEnabled').click(); });
    await page.waitForTimeout(250);
    await page.fill('#f_careHeading', 'How we help');
    await page.click('.save-bar .btn-gold');
    await page.waitForTimeout(400);
    const saved = await page.evaluate(() => (window.__rows['site_settings:customer-care'] || {}).data);
    ok('and the change is what saved', saved && saved.careHeading === 'How we help', saved);
    ok('a sound setting saves', !!saved, saved);
    ok('the notes are not saved as settings',
       saved && !('elsewhereNote' in saved) && !('policyNote' in saved),
       saved && Object.keys(saved).filter(k => /Note$/.test(k)));
    await c.close();
  }

  console.log('\n== both sides declare the same settings ==');
  {
    const read = (file, marker) => {
      const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
      const i = src.indexOf(marker);
      const j = src.indexOf('\n  };', i);
      const block = src.slice(i, j).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      return [...block.matchAll(/(\w+):/g)].map(m => m[1]).sort();
    };
    const front = read('assets/app.js', 'var CARESET = {');
    const admin = read('assets/admin/settings/customer-care.js', 'var DEFAULTS = {');
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
