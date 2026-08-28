/* =====================================================================
   Storefront: does Settings > General actually reach the customer?
   ---------------------------------------------------------------------
   Serves the real site and answers its network calls with fixtures, so
   the only thing under test is how index.html and app.js behave for a
   given settings row.
   ===================================================================== */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8101;

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')); } };

const PRODUCTS = [
  { name: 'Aurelia Silk Blouse', sku: 'WF-AUSI-CR-S', category: "Women's Fashion",
    price: 920, size: 'S', color: 'Cream', material: 'Silk', available: true },
  { name: 'Belmont Wool Blazer', sku: 'MF-BEWO-NV-L', category: "Men's Fashion",
    price: 1680.5, size: 'L', color: 'Navy', material: 'Wool', available: true },
  { name: 'Heritage Belt', sku: 'AC-HESU-BR-L', category: 'Accessories',
    price: 89000, size: 'L', color: 'Brown', material: 'Suede', available: true }
];

const REVIEWS = [{
  id: '1', sku: null, name: 'Chanda M', rating: 5, comment: 'Beautiful pieces.',
  verified: true, approved: true, created_at: '2026-08-12T09:00:00Z'
}];

const HOURS_MON_SAT = {
  mon: { open: true,  from: '09:00', to: '18:00' },
  tue: { open: true,  from: '09:00', to: '18:00' },
  wed: { open: true,  from: '09:00', to: '18:00' },
  thu: { open: true,  from: '09:00', to: '18:00' },
  fri: { open: true,  from: '09:00', to: '18:00' },
  sat: { open: true,  from: '09:00', to: '16:00' },
  sun: { open: false, from: '09:00', to: '16:00' }
};

function server() {
  return http.createServer((req, res) => {
    const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    fs.readFile(f, (e, d) => {
      if (e) { res.writeHead(404); res.end('no'); return; }
      const t = f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html';
      res.writeHead(200, { 'Content-Type': t }); res.end(d);
    });
  });
}

/* Open a page whose settings row is `settings`. */
async function open(browser, settings, opts = {}) {
  const ctx = opts.context || await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text());
  });

  await page.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript',
    body: "window.VBP_CONFIG={SUPABASE_URL:'https://x.supabase.co',SUPABASE_ANON_KEY:'k',IMAGE_BUCKET:'product-images'};" }));
  await page.route('**/fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('**/api/products', r => r.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ products: PRODUCTS }) }));

  const json = (body) => ({ contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/rest/v1/**', r => {
    const u = r.request().url();
    if (u.includes('site_settings')) {
      if (u.includes('key=eq.branding')) return r.fulfill(json(opts.branding ? [{ data: opts.branding }] : []));
      return r.fulfill(json(settings ? [{ data: settings }] : []));
    }
    if (u.includes('site_content'))  return r.fulfill(json([{ data: opts.content || {} }]));
    if (u.includes('reviews'))       return r.fulfill(json(REVIEWS));
    if (u.includes('product_meta'))  return r.fulfill(json([]));
    if (u.includes('policies'))      return r.fulfill(json([]));
    return r.fulfill(json([]));
  });

  await page.goto('http://127.0.0.1:' + PORT + '/index.html');
  await page.waitForTimeout(opts.wait || 700);
  return { page, ctx, errors };
}

(async () => {
  const srv = server();
  await new Promise(r => srv.listen(PORT, r));
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  const LIVE = {
    businessName: 'Vaultique Boutique Point',
    tagline: 'Curated Elegance, Accessible Luxury',
    description: 'A premium boutique in Lusaka.',
    country: 'Zambia', city: 'Lusaka', address: '',
    timezone: 'Africa/Lusaka', currency: 'ZMW',
    dateFormat: 'DD/MM/YYYY', numberFormat: '1,234.56',
    businessHours: HOURS_MON_SAT,
    websiteStatus: 'live', maintenanceMode: false, maintenanceMessage: ''
  };

  // ---------------------------------------------------------------- live
  console.log('\n== live site ==');
  {
    const { page, ctx, errors } = await open(browser, LIVE);
    ok('no page errors', errors.length === 0, errors);
    ok('not gated', await page.$('.gate') === null);
    ok('the shop is visible',
       !(await page.evaluate(() => document.documentElement.classList.contains('vbp-gated'))));
    ok('products rendered',
       await page.evaluate(() => document.querySelectorAll('.card').length) > 0);

    const prices = await page.$$eval('.card .p', e => e.map(x => x.textContent.trim()));
    ok('prices were found at all', prices.length > 0, prices.length);
    ok('prices use the Kwacha symbol', prices.length > 0 && prices.every(p => p.startsWith('K')), prices.slice(0, 3));
    ok('thousands grouped with a comma', prices.some(p => /K1,680\.50|K89,000/.test(p)), prices.slice(0, 5));

    ok('tagline from settings',
       (await page.textContent('#footTagline')) === 'Curated Elegance, Accessible Luxury');
    ok('location from settings',
       (await page.textContent('#locVal')).includes('Lusaka'), await page.textContent('#locVal'));
    ok('footer location from settings',
       (await page.textContent('#footLocation')).includes('Zambia'), await page.textContent('#footLocation'));
    ok('footer hours summarise the grid',
       /Mon-Fri 9am-6pm/.test(await page.textContent('#footHours')), await page.textContent('#footHours'));
    ok('an open/closed chip is shown', await page.$('#hoursVal .open-chip') !== null);
    ok('page title built from settings',
       (await page.title()).startsWith('Vaultique Boutique Point · Curated Elegance'), await page.title());
    ok('meta description from settings',
       await page.getAttribute('meta[name="description"]', 'content') === 'A premium boutique in Lusaka.');
    ok('review date in the chosen format',
       (await page.textContent('.testi .when')) === '12/08/2026', await page.textContent('.testi .when').catch(() => ''));
    await ctx.close();
  }

  // ------------------------------------------------------------- formats
  console.log('\n== formats follow the settings ==');
  {
    const { page, ctx } = await open(browser, Object.assign({}, LIVE, {
      currency: 'USD', numberFormat: '1.234,56', dateFormat: 'D MMMM YYYY'
    }));
    const prices = await page.$$eval('.card .p', e => e.map(x => x.textContent.trim()));
    ok('dollar symbol applied', prices.length > 0 && prices.every(p => p.startsWith('$')), prices.slice(0, 3));
    ok('full stop thousands, comma decimal',
       prices.some(p => /\$1\.680,50/.test(p)) && prices.some(p => /\$89\.000/.test(p)), prices.slice(0, 5));
    ok('long date format applied',
       (await page.textContent('.testi .when')) === '12 August 2026', await page.textContent('.testi .when'));
    await ctx.close();
  }
  {
    const { page, ctx } = await open(browser, Object.assign({}, LIVE, { numberFormat: '1 234,56' }));
    const prices = await page.$$eval('.card .p', e => e.map(x => x.textContent.trim()));
    ok('space grouped prices use a non-breaking space',
       prices.some(p => p.indexOf('89 000') > -1), prices.slice(0, 5));
    await ctx.close();
  }

  // --------------------------------------------------------- maintenance
  console.log('\n== maintenance mode ==');
  {
    const { page, ctx, errors } = await open(browser, Object.assign({}, LIVE, {
      maintenanceMode: true, maintenanceMessage: 'Back on Monday morning.'
    }));
    ok('no page errors', errors.length === 0, errors);
    ok('the gate is shown', await page.$('.gate') !== null);
    ok('the message is the one from settings',
       (await page.textContent('.gate-body')) === 'Back on Monday morning.');
    ok('the shop is hidden',
       await page.evaluate(() => {
         const hdr = document.querySelector('header');
         return !hdr || getComputedStyle(hdr).display === 'none';
       }));
    ok('nothing but the gate is reachable',
       await page.evaluate(() => Array.prototype.every.call(
         document.body.children,
         n => n.classList.contains('gate') || getComputedStyle(n).display === 'none')));
    ok('a WhatsApp route is offered',
       (await page.getAttribute('.gate-btn', 'href')).startsWith('https://wa.me/'));
    ok('title reflects the state', (await page.title()).includes('Back shortly'), await page.title());
    ok('maintenance does not advertise hours', await page.$('.gate-hours') === null);
    await ctx.close();
  }

  console.log('\n== maintenance beats a live status ==');
  {
    const { page, ctx } = await open(browser, Object.assign({}, LIVE, {
      websiteStatus: 'live', maintenanceMode: true, maintenanceMessage: 'Short break.'
    }));
    ok('gated even though the status says live', await page.$('.gate') !== null);
    await ctx.close();
  }

  // -------------------------------------------------------- coming soon
  console.log('\n== coming soon ==');
  {
    const { page, ctx } = await open(browser, Object.assign({}, LIVE, { websiteStatus: 'coming-soon' }));
    ok('the gate is shown', await page.$('.gate') !== null);
    ok('opening-soon wording', (await page.textContent('.gate-eyebrow')) === 'Opening soon');
    ok('the business name is used',
       (await page.textContent('.gate-title')).includes('Vaultique Boutique Point'));
    ok('usual hours are shown', /Mon-Fri 9am-6pm/.test(await page.textContent('.gate-hours')),
       await page.textContent('.gate-hours'));
    await ctx.close();
  }

  // -------------------------------------------------------------- closed
  console.log('\n== closed ==');
  {
    const { page, ctx } = await open(browser, Object.assign({}, LIVE, { websiteStatus: 'closed' }));
    ok('the gate is shown', await page.$('.gate') !== null);
    ok('closed wording', (await page.textContent('.gate-eyebrow')) === 'Temporarily closed');
    ok('usual hours are shown', await page.$('.gate-hours') !== null);
    await ctx.close();
  }

  // -------------------------------------------------- degrading safely
  console.log('\n== degrading safely ==');
  {
    // no settings row at all: the shop must open, not sit behind a gate
    const { page, ctx, errors } = await open(browser, null);
    ok('no settings row still opens the shop', await page.$('.gate') === null);
    const fallback = await page.$$eval('.card .p', e => e.map(x => x.textContent.trim()));
    ok('prices fall back to Kwacha',
       fallback.length > 0 && fallback.every(p => p.startsWith('K')), fallback.slice(0, 3));
    ok('no page errors', errors.length === 0, errors);
    await ctx.close();
  }

  // ------------------------------------------------------- gate memory
  console.log('\n== gate memory ==');
  {
    const ctx = await browser.newContext();
    const first = await open(browser, Object.assign({}, LIVE, {
      maintenanceMode: true, maintenanceMessage: 'Back soon.'
    }), { context: ctx });
    ok('first view is gated', await first.page.$('.gate') !== null);
    ok('the gated state was remembered',
       await first.page.evaluate(() => localStorage.getItem('vbp_gate')) === '1');

    // same browser, still gated: the shop must be hidden before the fetch lands
    const second = await open(browser, Object.assign({}, LIVE, {
      maintenanceMode: true, maintenanceMessage: 'Back soon.'
    }), { context: ctx, wait: 0 });
    ok('a returning visitor is hidden immediately',
       await second.page.evaluate(() => document.documentElement.classList.contains('vbp-gated')));
    await second.page.waitForTimeout(700);

    // reopened: the memo clears and the shop comes back
    const third = await open(browser, LIVE, { context: ctx });
    ok('reopening clears the gate', await third.page.$('.gate') === null);
    ok('and the shop is visible again',
       !(await third.page.evaluate(() => document.documentElement.classList.contains('vbp-gated'))));
    ok('the memo was cleared',
       await third.page.evaluate(() => localStorage.getItem('vbp_gate')) === '0');
    await ctx.close();
  }

  // ------------------------------------------- a hanging settings request
  console.log('\n== the settings request hangs ==');
  {
    const ctx = await browser.newContext();
    // get the browser into the "was gated last time" state
    const first = await open(browser, Object.assign({}, LIVE, {
      maintenanceMode: true, maintenanceMessage: 'Back soon.'
    }), { context: ctx });
    ok('gated, so the state is remembered', await first.page.$('.gate') !== null);

    const page = await ctx.newPage();
    await page.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript',
      body: "window.VBP_CONFIG={SUPABASE_URL:'https://x.supabase.co',SUPABASE_ANON_KEY:'k'};" }));
    await page.route('**/fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
    await page.route('**/api/products', r => r.fulfill({ contentType: 'application/json',
      body: JSON.stringify({ products: PRODUCTS }) }));
    await page.route('**/rest/v1/**', () => { /* never answered */ });

    await page.goto('http://127.0.0.1:' + PORT + '/index.html');
    await page.waitForTimeout(1200);
    ok('still hidden while the request is outstanding',
       await page.evaluate(() => document.documentElement.classList.contains('vbp-gated')));
    await page.waitForTimeout(5600);
    ok('the shop is shown rather than a blank screen',
       !(await page.evaluate(() => document.documentElement.classList.contains('vbp-gated'))));
    await ctx.close();
  }

  // ------------------------------------------------ an emptied catalogue
  // Clearing the POS used to look exactly like the feed being broken, so
  // the shop replaced the empty answer with twelve sample pieces. A feed
  // that answers with nothing has answered.
  console.log('\n== the POS has been emptied ==');
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript',
      body: "window.VBP_CONFIG={SUPABASE_URL:'https://x.supabase.co',SUPABASE_ANON_KEY:'k'};" }));
    await page.route('**/fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
    await page.route('**/api/products', r => r.fulfill({ contentType: 'application/json',
      body: '{"products":[]}' }));
    await page.route('**/rest/v1/**', r => r.fulfill({ contentType: 'application/json',
      body: JSON.stringify(r.request().url().includes('key=eq.general') ? [{ data: LIVE }] : []) }));
    await page.goto('http://127.0.0.1:' + PORT + '/index.html#/shop');
    await page.waitForTimeout(950);

    ok('no page errors', errors.length === 0, errors);
    ok('no sample pieces are shown',
       await page.evaluate(() => document.querySelectorAll('#grid .card').length) === 0);
    ok('and no piece named after the samples exists anywhere',
       !(await page.content()).includes('Aurelia Silk Blouse'));
    ok('the preview banner stays down, because nothing failed',
       await page.evaluate(() => !document.querySelector('#previewBanner').classList.contains('show')));
    const msg = await page.textContent('#shopEmpty');
    ok('the shop says the collection is coming rather than nothing matched',
       /on its way/i.test(msg), msg);
    ok('with a way to be told when it lands',
       await page.evaluate(() => !!document.querySelector('#shopEmpty .btn-wa')));

    await page.evaluate(() => { location.hash = ''; });
    await page.waitForTimeout(400);
    ok('the home page hides its product rows rather than showing empty ones',
       await page.evaluate(() => ['sec-featured','sec-new','sec-women','sec-men','sec-acc']
         .every(id => { const e = document.getElementById(id); return !e || e.style.display === 'none'; })));
    await ctx.close();
  }

  console.log('\n== the feed is actually broken ==');
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript',
      body: "window.VBP_CONFIG={SUPABASE_URL:'https://x.supabase.co',SUPABASE_ANON_KEY:'k'};" }));
    await page.route('**/fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
    await page.route('**/api/products', r => r.abort());
    await page.route('**/rest/v1/**', r => r.fulfill({ contentType: 'application/json', body: '[]' }));
    await page.goto('http://127.0.0.1:' + PORT + '/index.html#/shop');
    await page.waitForTimeout(950);
    ok('the samples still stand in, since the truth is unknown',
       await page.evaluate(() => document.querySelectorAll('#grid .card').length) > 0);
    ok('and the preview banner says so',
       await page.evaluate(() => document.querySelector('#previewBanner').classList.contains('show')));
    await ctx.close();
  }

  // ------------------------------------------------- the themeable surface
  // Phase A of Branding made the stylesheet respond to variables. Nothing in
  // the admin sets them yet, so these check the surface the Branding page
  // will be steering, and that circles are not part of it.
  console.log('\n== the stylesheet is themeable ==');
  {
    const { page, ctx } = await open(browser, LIVE);

    const before = await page.evaluate(() => {
      const cs = getComputedStyle(document.body);
      const box = document.querySelector('.testi, .why-card, .pr-item');
      return {
        bodyFont: cs.fontFamily,
        headFont: getComputedStyle(document.querySelector('.serif') || document.body).fontFamily,
        cardRadius: box ? getComputedStyle(box).borderRadius : '',
        bg: cs.backgroundColor
      };
    });
    ok('body font resolves through the variable', /Jost/.test(before.bodyFont), before.bodyFont);
    ok('heading font resolves through the variable',
       /Cormorant/.test(before.headFont), before.headFont);

    // repaint the brand and confirm the page follows
    await page.addStyleTag({ content: `:root{
      --navy:#2d0a3d; --navy-rgb:45,10,61;
      --gold:#19a974; --gold-rgb:25,169,116;
      --cream:#fdf6ff; --ivory:#fdf6ff; --ink:#1a0f20;
      --font-head:Georgia,serif; --font-body:Verdana,sans-serif;
      --radius-lg:0px;
    }` });
    await page.waitForTimeout(120);

    const after = await page.evaluate(() => {
      const cs = getComputedStyle(document.body);
      const box = document.querySelector('.testi, .why-card, .pr-item');
      const round = document.querySelector('[style*="50%"], .gal-nav') ||
                    Array.from(document.querySelectorAll('*'))
                      .find(n => getComputedStyle(n).borderRadius === '50%');
      return {
        bodyFont: cs.fontFamily,
        bg: cs.backgroundColor,
        cardRadius: box ? getComputedStyle(box).borderRadius : '',
        roundStillRound: round ? getComputedStyle(round).borderRadius : null
      };
    });
    ok('the background follows the palette', after.bg !== before.bg, [before.bg, after.bg]);
    ok('the body font follows the variable', /Verdana/.test(after.bodyFont), after.bodyFont);
    ok('corner rounding follows the scale',
       after.cardRadius !== before.cardRadius, [before.cardRadius, after.cardRadius]);
    ok('circles are left out of the rounding scale',
       after.roundStillRound === null || after.roundStillRound === '50%', after.roundStillRound);

    // a colour carrying transparency has to follow the brand too
    const alpha = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.background = 'rgba(var(--navy-rgb), .5)';
      document.body.appendChild(probe);
      const c = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return c;
    });
    ok('translucent brand colours follow too', alpha === 'rgba(45, 10, 61, 0.5)', alpha);
    await ctx.close();
  }

  // ------------------------------------------------------- branding applied
  console.log('\n== branding reaches the page ==');
  {
    const branding = {
      primaryColour: '#2d0a3d', secondaryColour: '#19a974', accentColour: '#e8b4b8',
      backgroundColour: '#fdf6ff', textColour: '#1a0f20', buttonColour: '#19a974',
      headingFont: 'playfair', bodyFont: 'inter',
      buttonStyle: 'pill', cardStyle: 'shadow', borderRadius: 'soft',
      logoMain: 'https://x.supabase.co/logo-main.png',
      logoFooter: 'https://x.supabase.co/logo-foot.png',
      favicon: 'https://x.supabase.co/icon.png',
      socialImage: 'https://x.supabase.co/share.png',
      customCss: '.foot-bottom{letter-spacing:.5em}'
    };
    const { page, ctx, errors } = await open(browser, LIVE, { branding });
    ok('no page errors', errors.length === 0, errors);

    const got = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const body = getComputedStyle(document.body);
      const btn = document.querySelector('.btn-gold');
      return {
        primary: cs.getPropertyValue('--navy').trim(),
        primaryRgb: cs.getPropertyValue('--navy-rgb').trim(),
        accent: cs.getPropertyValue('--accent').trim(),
        bg: body.backgroundColor,
        bodyFont: body.fontFamily,
        btnRadius: btn ? getComputedStyle(btn).borderRadius : '',
        btnBg: btn ? getComputedStyle(btn).backgroundColor : '',
        cardClass: document.documentElement.className,
        radiusLg: cs.getPropertyValue('--radius-lg').trim(),
        fontLink: (document.getElementById('vbp-fonts') || {}).href || '',
        mainLogo: (document.querySelector('.brand-logo') || {}).getAttribute
                  ? document.querySelector('.brand-logo').getAttribute('src') : '',
        mobileLogo: document.querySelector('.mm-logo').getAttribute('src'),
        footLogo: document.querySelector('.foot-logo').getAttribute('src'),
        favicon: (document.querySelector('link[rel="icon"]') || {}).getAttribute
                 ? document.querySelector('link[rel="icon"]').getAttribute('href') : '',
        og: (document.querySelector('meta[property="og:image"]') || {}).getAttribute
            ? document.querySelector('meta[property="og:image"]').getAttribute('content') : '',
        custom: (document.getElementById('vbp-custom') || {}).textContent || ''
      };
    });

    ok('the primary colour is applied', got.primary === '#2d0a3d', got.primary);
    ok('its channels follow for translucent uses', got.primaryRgb === '45,10,61', got.primaryRgb);
    ok('the accent is separate from the secondary', got.accent === '#e8b4b8', got.accent);
    ok('the background is applied', got.bg === 'rgb(253, 246, 255)', got.bg);
    ok('the chosen body font is used', /Inter/.test(got.bodyFont), got.bodyFont);
    ok('a font request was added for it',
       got.fontLink.includes('Playfair') && got.fontLink.includes('Inter'), got.fontLink);
    ok('the button style is a pill', got.btnRadius === '999px', got.btnRadius);
    ok('the button takes its own colour', got.btnBg === 'rgb(25, 169, 116)', got.btnBg);
    ok('the card preset is on the page', /cards-shadow/.test(got.cardClass), got.cardClass);
    ok('soft rounding doubled the scale', got.radiusLg === '16px', got.radiusLg);

    ok('the main logo is swapped', got.mainLogo === branding.logoMain, got.mainLogo);
    ok('the mobile logo falls back to the main one when unset',
       got.mobileLogo === branding.logoMain, got.mobileLogo);
    ok('the footer logo is its own', got.footLogo === branding.logoFooter, got.footLogo);
    ok('the favicon is swapped', got.favicon === branding.favicon, got.favicon);
    ok('the sharing image tag is written', got.og === branding.socialImage, got.og);
    ok('custom CSS is injected', got.custom === branding.customCss, got.custom);
    ok('custom CSS takes effect',
       (await page.evaluate(() =>
         getComputedStyle(document.querySelector('.foot-bottom')).letterSpacing)) !== 'normal');
    await ctx.close();
  }

  console.log('\n== the no-photo placeholder follows the brand ==');
  {
    const { page, ctx } = await open(browser, LIVE, {
      branding: { primaryColour: '#0f3d2e', secondaryColour: '#c9a227' }
    });
    const src = await page.getAttribute('.card .thumb img', 'src');
    ok('it is the drawn stand-in', src.indexOf('data:image/svg+xml') === 0, src.slice(0, 40));
    ok('it uses the chosen primary colour', src.includes('%230f3d2e'), src.slice(0, 160));
    ok('it uses the chosen secondary colour', src.includes('%23c9a227'));
    ok('it carries the business name', src.includes('VAULTIQUE BOUTIQUE POINT'));
    await ctx.close();
  }
  {
    const { page, ctx } = await open(browser,
      Object.assign({}, LIVE, { businessName: 'The Extremely Long Boutique Name Company Limited' }),
      { branding: {} });
    const src = await page.getAttribute('.card .thumb img', 'src');
    // not decodeURIComponent: the SVG contains width='100%' and friends
    const label = src.match(/letter-spacing='6'[^>]*>([^<]*)</);
    ok('a very long name is trimmed rather than overflowing',
       label && label[1].length <= 24, label && label[1]);
    await ctx.close();
  }

  console.log('\n== a default branding row changes nothing ==');
  {
    const { page, ctx } = await open(browser, LIVE, { branding: {} });
    const v = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      return ['navy','gold','ivory','ink','muted','cream','sand','accent','btn']
        .reduce((o,k) => (o[k] = cs.getPropertyValue('--' + k).trim(), o), {});
    });
    ok('the palette is still the shipped one',
       v.navy.toLowerCase() === '#0b1f3a' && v.gold.toLowerCase() === '#c8a24a' &&
       v.ivory.toLowerCase() === '#fbf8f0' && v.muted.toLowerCase() === '#6b7480', v);
    ok('the accent and button default to the gold',
       v.accent.toLowerCase() === '#c8a24a' && v.btn.toLowerCase() === '#c8a24a', v);
    ok('no font request is made for the default pair',
       await page.evaluate(() => !document.getElementById('vbp-fonts')));
    await ctx.close();
  }

  console.log('\n== oversized custom CSS is capped ==');
  {
    const huge = '/*' + 'x'.repeat(40000) + '*/';
    const { page, ctx } = await open(browser, LIVE, { branding: { customCss: huge } });
    const len = await page.evaluate(() => (document.getElementById('vbp-custom') || {}).textContent.length);
    ok('the injected CSS is truncated to the limit', len === 20000, len);
    await ctx.close();
  }

  /* The whole site leans on one class. index.html ships elements already
     carrying it and app.js adds and removes it in dozens of places — the
     promotional banner, the empty phone row, the delivery band, the
     account button. For a long time there was no rule behind it on the
     storefront, only in the admin, so none of them were ever hidden: a
     shop with the promo band switched off still showed the band.

     Every other test in this suite asks whether an element CARRIES the
     class, which passed happily while nothing was hidden. This one asks
     whether it does anything. */
  console.log('\n== hiding actually hides ==');
  {
    const { page, ctx } = await open(browser, LIVE, {});
    const v = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.className = 'hide';
      document.body.appendChild(probe);
      const hidden = getComputedStyle(probe).display === 'none';
      probe.remove();

      /* And on something the page really ships, which carries other
         classes too: a single-class utility has to outrank them. */
      const sec = document.createElement('section');
      sec.className = 'section tight hide';
      document.body.appendChild(sec);
      const sectionHidden = getComputedStyle(sec).display === 'none';
      sec.remove();

      return {
        hidden: hidden,
        sectionHidden: sectionHidden,
        shipped: [...document.querySelectorAll('.hide')]
          .filter(e => getComputedStyle(e).display !== 'none')
          .map(e => e.id || e.className)
      };
    });
    ok('the class hides a bare element', v.hidden);
    ok('and one that carries other classes as well', v.sectionHidden, v.sectionHidden);
    ok('nothing the page ships hidden is on screen', v.shipped.length === 0, v.shipped);
    await ctx.close();
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})();
