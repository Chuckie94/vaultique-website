/* ===========================================================================
   WHAT THE SETTINGS CAN PUT ON THE SHOP'S PAGES -- assets/app.js, build 78

   The audit of build 73 (W-13): the homepage's two buttons followed any
   link the settings held. Settings > Homepage only accepts a page on this
   site, a web address, an email or a phone number, but the database cannot
   check that, so a javascript: link written straight into it ran in every
   visitor's browser. The announcement bar, the FAQ's "Ask us" button and the
   buy buttons' words were put on the page as code in the same way.

   Here the shop is opened, in a real browser, with each of those holding
   something harmful, and then something harmless. Anything that would run
   sets window.__pwned.
   =========================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');

let checks = 0, failures = 0;
const is = (c, m, x) => { checks++; if (c) console.log('  ✓ ' + m); else { failures++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); } };

const CATALOGUE = [
  { name: 'Crossbody Tote', sku: 'BG-1', category: 'Handbags', price: 500, size: 'M', color: 'Black', material: '',
    available: true, lowStock: false, maxQty: 3, wasPrice: 0, brand: '', description: '', details: [] }
];
let HOME = null;            // Settings > Homepage; null: never saved
let CONTENT = null;         // the older Site Content row
const SETTINGS = {};        // every other section, by key

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/json' };
const STUB = `window.supabase = { createClient: function () { return { channel: function () { var ch = { on: function(){ return ch; }, subscribe: function(){ return ch; } }; return ch; }, removeChannel: function () {} }; } };`;

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x'); const p = u.pathname;
      const json = (d) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d)); };
      if (p === '/api/products') return json({ products: CATALOGUE, count: CATALOGUE.length, version: 'v1', generatedAt: new Date().toISOString() });
      if (p === '/rest/v1/site_content') return json(CONTENT ? [{ data: CONTENT }] : []);
      if (p === '/rest/v1/site_settings') {
        const key = (u.searchParams.get('key') || '').replace(/^eq\./, '');
        if (key === 'homepage') return json(HOME ? [{ data: HOME }] : []);
        return json(SETTINGS[key] ? [{ data: SETTINGS[key] }] : []);
      }
      if (p.indexOf('/rest/v1/') === 0) return json([]);
      if (p === '/config.js') { res.writeHead(200, { 'Content-Type': TYPES['.js'] }); res.end('window.VBP_CONFIG={SUPABASE_URL:"http://127.0.0.1:' + server.address().port + '",SUPABASE_ANON_KEY:"k"};'); return; }
      if (p === '/__stub.js') { res.writeHead(200, { 'Content-Type': TYPES['.js'] }); res.end(STUB); return; }
      let file = path.join(ROOT, p);
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, 'index.html');
      let body = fs.readFileSync(file);
      if (file.endsWith('index.html')) body = body.toString().replace('<script src="/config.js"></script>', '<script src="/config.js"></script>\n<script src="/__stub.js"></script>');
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' }); res.end(body);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

(async () => {
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  const open = async () => {
    await page.goto(base + '/', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelector('#grid .card, .row .card, .card'), null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(600);
  };
  const buttons = () => page.evaluate(() => {
    const hero = document.querySelector('.hero-cta').firstElementChild;
    const promo = document.getElementById('promoCta');
    return {
      heroTag: hero.tagName, heroHref: hero.getAttribute('href'), heroShop: hero.hasAttribute('data-go-shop'),
      heroTarget: hero.getAttribute('target'),
      promoHref: promo && promo.getAttribute('href'), promoTarget: promo && promo.getAttribute('target'),
      pwned: window.__pwned === 1
    };
  });
  try {
    /* ------------------------------------------------------------------ */
    console.log('\nThe admin\'s form and the shop front agree on what a link may be');
    {
      const take = (file, name) => {
        const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
        const at = src.indexOf('function ' + name + '(');
        let depth = 0, i = src.indexOf('{', at);
        for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
        return new Function(src.slice(at, i + 1) + '\nreturn ' + name + ';')();
      };
      const shopTakes = take('assets/app.js', 'safeHref');
      const adminTakes = take('assets/admin/settings/homepage.js', 'checkLink');
      const SAMPLES = ['#/shop', '/policies/returns', 'https://example.com/a', 'http://example.com', 'mailto:a@b.c',
        'tel:+260 97 000 0000', 'javascript:alert(1)', ' JavaScript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,x',
        'vbscript:x', '//evil.example', '/\\evil.example', 'policies', 'www.example.com', 'tel:call-me', 'https://', 'ftp://x.y'];
      const differ = SAMPLES.filter(x => !!shopTakes(x) !== (adminTakes(x) === ''));
      is(differ.length === 0, 'for ' + SAMPLES.length + ' kinds of link, what the form accepts is exactly what the shop follows',
         JSON.stringify(differ));
    }

    /* ------------------------------------------------------------------ */
    console.log('\nA link the admin would refuse, written straight into the database');
    const BAD = [
      ['javascript:', 'javascript:window.__pwned=1'],
      ['with spaces and capitals', '  JavaScript:window.__pwned=1'],
      ['with a tab inside the word', 'java\tscript:window.__pwned=1'],
      ['with a line break inside the word', 'java\nscript:window.__pwned=1'],
      ['data:', 'data:text/html,<script>window.__pwned=1</script>'],
      ['vbscript:', 'vbscript:msgbox(1)'],
      ['an address that starts //', '//evil.example/x'],
      ['an address that starts /\\', '/\\evil.example/x']
    ];
    for (const [what, link] of BAD) {
      HOME = { heroCtaText: 'Go', heroCtaLink: link, promoEnabled: true, promoTitle: 'Sale', promoCtaText: 'Shop the sale', promoCtaLink: link };
      await open();
      const b = await buttons();
      await page.click('.hero-cta > :first-child').catch(() => {});
      await page.waitForTimeout(150);
      const pwned = await page.evaluate(() => window.__pwned === 1).catch(() => false);
      is(b.heroTag === 'BUTTON' && b.heroShop && b.heroHref === null && /#\/shop$/.test(b.promoHref || '') && !b.pwned && !pwned,
         what + ': both buttons keep going to the shop, and nothing runs', JSON.stringify(b));
    }

    /* ------------------------------------------------------------------ */
    console.log('\nThe links the admin accepts work exactly as before');
    const GOOD = [
      ['a page on this site, #/', '#/shop', false],
      ['a page on this site, /', '/policies/returns', false],
      ['a web address', 'https://example.com/lookbook', true],
      ['an older web address, http://', 'http://example.com/old', true],
      ['an email', 'mailto:hello@example.com', false],
      ['a phone number', 'tel:+260 97 000 0000', false]
    ];
    for (const [what, link, blank] of GOOD) {
      HOME = { heroCtaText: 'Go', heroCtaLink: link, promoEnabled: true, promoTitle: 'Sale', promoCtaText: 'Shop the sale', promoCtaLink: link };
      await open();
      const b = await buttons();
      is(b.heroTag === 'A' && b.heroHref === link && b.promoHref === link &&
         (blank ? b.heroTarget === '_blank' && b.promoTarget === '_blank' : b.heroTarget === null),
         what + ' (' + link + '): followed as written' + (blank ? ', in a new tab' : ''), JSON.stringify(b));
    }
    HOME = { heroCtaText: 'Go', heroCtaLink: '', promoEnabled: true, promoTitle: 'Sale', promoCtaText: 'Shop the sale', promoCtaLink: '' };
    await open();
    let b = await buttons();
    is(b.heroTag === 'BUTTON' && b.heroShop && /#\/shop$/.test(b.promoHref || ''), 'left blank: the shop, as it always was', JSON.stringify(b));

    /* ------------------------------------------------------------------ */
    console.log('\nThe announcement keeps its formatting, and nothing else');
    HOME = {
      announceText: 'Free delivery · <b>Shop &amp; buy</b> <a href="#/shop">now</a> <em>today</em>' +
                    '<img src="x" onerror="window.__pwned=1"><script>window.__pwned=1</script>' +
                    '<a href="javascript:window.__pwned=1" onclick="window.__pwned=1">tap</a>' +
                    '<i onmouseover="window.__pwned=1" style="color:red">it</i><a href="https://example.com">out</a>'
    };
    await open();
    await page.hover('#announceBar i').catch(() => {});
    await page.click('#announceBar a:not([href])').catch(() => {});
    await page.waitForTimeout(300);
    let bar = await page.evaluate(() => {
      const e = document.getElementById('announceBar');
      const links = Array.from(e.querySelectorAll('a')).map((a) => ({ href: a.getAttribute('href'), target: a.getAttribute('target'), text: a.textContent }));
      return { html: e.innerHTML, text: e.textContent, bold: (e.querySelector('b') || {}).textContent, em: !!e.querySelector('em'),
               links, attrs: Array.from(e.querySelectorAll('*')).reduce((n, x) => n + x.attributes.length, 0),
               img: !!e.querySelector('img'), script: !!e.querySelector('script'), pwned: window.__pwned === 1 };
    });
    is(bar.bold === 'Shop & buy' && bar.em && /^Free delivery · Shop & buy now today/.test(bar.text),
       'bold, italics and the words are all there', JSON.stringify(bar.text));
    is(bar.links[0] && bar.links[0].href === '#/shop' && bar.links[2] && bar.links[2].href === 'https://example.com' &&
       bar.links[2].target === '_blank', 'a link to a page here, or to another site, still works', JSON.stringify(bar.links));
    is(!bar.img && !bar.script && bar.links[1] && bar.links[1].href === null && bar.links[1].text === 'tap',
       'a picture, a script and a javascript: link are gone; the link\'s words stay, going nowhere', bar.html);
    is(!/on(error|click|mouseover)|style=/i.test(bar.html), 'no event handler or style survives on anything', bar.html);
    is(!bar.pwned, 'and none of it ran, even hovered over and clicked');

    HOME = null;
    CONTENT = { announce: 'Hello <u>there</u><svg onload="window.__pwned=1"></svg><iframe src="javascript:window.__pwned=1"></iframe>' };
    await open();
    bar = await page.evaluate(() => {
      const e = document.getElementById('announceBar');
      return { text: e.textContent, u: !!e.querySelector('u'), other: !!e.querySelector('svg, iframe'), pwned: window.__pwned === 1 };
    });
    is(bar.text === 'Hello there' && bar.u && !bar.other && !bar.pwned,
       'the older Site Content announcement goes through the same filter', JSON.stringify(bar));
    CONTENT = null;

    /* ------------------------------------------------------------------ */
    console.log('\nButton words are words');
    HOME = null;
    SETTINGS.shopping = { checkoutLabel: '<img src="x" onerror="window.__pwned=1">Buy now' };
    SETTINGS['customer-care'] = { faqEnabled: true, faqs: [{ q: 'Do you deliver?', a: 'Yes.' }],
                                  faqAskText: '<img src="x" onerror="window.__pwned=1">Ask us' };
    await open();
    const words = await page.evaluate(() => {
      const card = document.querySelector('.card .btn-wa');
      const faq = document.querySelector('#faq .btn-wa');
      return { card: card && card.textContent, faq: faq && faq.textContent,
               imgs: document.querySelectorAll('.btn-wa img').length, pwned: window.__pwned === 1 };
    });
    is(words.card && words.card.indexOf('<img src="x" onerror="window.__pwned=1">Buy now') > -1,
       'the buy button\'s words, set in Settings > Shopping, are shown as typed', JSON.stringify(words.card));
    is(words.faq && words.faq.indexOf('<img src="x" onerror="window.__pwned=1">Ask us') > -1,
       'and the FAQ\'s "Ask us" button\'s too', JSON.stringify(words.faq));
    is(words.imgs === 0 && !words.pwned, 'neither becomes a picture, and nothing runs');
    delete SETTINGS.shopping; delete SETTINGS['customer-care'];

    is(errors.length === 0, 'no errors on the page' + (errors.length ? ': ' + errors[0] : ''));
  } catch (e) {
    failures++; console.log('  ✗ threw: ' + (e && e.stack || e));
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failures ? '\n  ✗ ' + failures + ' of ' + checks + ' checks FAILED'
                       : '\n  safe links: all ' + checks + ' checks passed');
  process.exit(failures ? 1 : 0);
})();
