/* ===========================================================================
   EVERY "ASK US" BUTTON OPENS THE LIVE CHAT -- in a real browser

   THE OWNER (build 81): "All the ask on WhatsApp should now have Enquire and
   route to the website live chat instead of WhatsApp."

   So each of them -- the Shopping made personal band, the here-to-help
   panels, delivery, the FAQ, the policies page, a sold-out piece and a piece
   whose price is on request -- says Enquire and opens the chat window with
   the words the WhatsApp message used to start with, ready to send. Ordering
   is not an enquiry: Buy on WhatsApp is unchanged. With the live chat
   switched off, Enquire still goes somewhere: WhatsApp, as before.

   BUILD 83. "Why did you stamp everything ... with 'I have a question about
   delivery'?" The first Enquire's words, left unsent when the chat was
   closed, stayed in the box, and every other Enquire left them there: the
   rule that protects what a customer typed could not tell it from its own
   words. This file used to empty the box between buttons, which is how it
   missed that; it now closes the chat the way a customer does, and leaves
   the box alone. And each button's words are the shop's to write, in
   Settings > Live Chat ("Enquire buttons").

   The real index.html, assets/app.js and assets/chat.js; the website's
   Supabase and the product feed are answered here.
   =========================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');

let checks = 0, failures = 0;
const ok = m => { checks++; console.log('  ✓ ' + m); };
const fail = (m, x) => { checks++; failures++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); };
const is = (c, m, x) => c ? ok(m) : fail(m, x);
const J = o => JSON.stringify(o);

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const piece = o => Object.assign({ category: 'Bags', size: '', color: '', material: '', available: true,
  lowStock: false, wasPrice: 0, brand: '', description: 'A piece.', details: [], variantGroup: '', maxQty: 5,
  image_url: '/pic/a.png', gallery: [] }, o);
const CATALOGUE = [
  piece({ name: 'Woven Tote', sku: 'BG-WOTO', price: 1150 }),
  piece({ name: 'Leather Satchel', sku: 'BG-SATC', price: 3200, available: false }),
  piece({ name: 'Croc Clutch', sku: 'BG-CROC', price: 9000, priceOnRequest: true }),
];
let SETTINGS = {};
let SENT = [];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/json' };
const STUB = `window.supabase = { createClient: function () { return { channel: function () {
  var ch = { on: function () { return ch; }, subscribe: function () { return ch; } }; return ch; },
  removeChannel: function () {} }; } };`;
const body = req => new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => r(d)); });

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'), p = u.pathname;
  const json = o => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (p === '/api/products') return json({ products: CATALOGUE, count: CATALOGUE.length, version: 'e1' });
  if (p.indexOf('/pic/') === 0) { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(PNG); }
  if (p.indexOf('/rest/v1/rpc/') === 0) {
    const fn = p.slice('/rest/v1/rpc/'.length), b = await body(req);
    if (fn === 'chat_send') SENT.push(JSON.parse(b || '{}').p_body);
    if (fn === 'chat_start') return json('tok-enquire-0000000001');
    return json(null);
  }
  if (p === '/rest/v1/site_settings') {
    const key = (u.searchParams.get('key') || '').replace('eq.', '');
    return json(SETTINGS[key] ? [{ data: SETTINGS[key] }] : []);
  }
  if (p.indexOf('/rest/v1/') === 0) return json([]);
  if (p === '/config.js') {
    res.writeHead(200, { 'Content-Type': TYPES['.js'] });
    return res.end('window.VBP_CONFIG={SUPABASE_URL:"http://127.0.0.1:' + server.address().port + '",SUPABASE_ANON_KEY:"k"};');
  }
  if (p.indexOf('/.netlify/') === 0) return json({});
  let file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const errors = [];
  const SHOTS = process.env.SHOTS_DIR || '';

  async function open(chatOn, extra) {
    SETTINGS = Object.assign({
      chat: { enabled: chatOn },
      shopping: { enquiries: true },
      pricing: { onRequestEnabled: true, onRequestButton: 'Ask about this piece' },
      'customer-care': { faqEnabled: true, faqs: [{ q: 'Do you deliver?', a: 'Yes, nationwide.' }],
                         faqAskEnabled: true, faqAskText: 'Still not sure? Ask us on WhatsApp' },
      contact: { whatsapp: '260970000001' },
    }, extra || {});
    SENT = [];
    const ctx = await browser.newContext(SHOTS ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }
                                               : { viewport: { width: 390, height: 844 } });
    await ctx.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: STUB }));
    await ctx.route('**/fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await ctx.route('**/fonts.gstatic.com/**', r => r.fulfill({ status: 200, body: '' }));
    await ctx.route('**/cdnjs.cloudflare.com/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    await ctx.route(/https:\/\/(wa\.me|api\.whatsapp\.com)\//, r => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>WhatsApp</title>' }));
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(String(e.message || e)));
    await page.goto(base + '/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    return { ctx, page };
  }
  const chat = page => page.evaluate(() => {
    const panel = document.getElementById('chatPanel'), box = document.getElementById('chatInput');
    return { open: !!(panel && panel.classList.contains('open')), text: box ? box.value : null };
  });
  async function shut(page) {
    await page.evaluate(() => {
      const mini = document.getElementById('chatMin');
      if (mini) mini.click();
      else { const p = document.getElementById('chatPanel'); if (p) p.classList.remove('open'); }
      document.body.style.overflow = '';
    });
    await page.waitForTimeout(150);
  }
  /* Clicks a button the way a customer would, and says whether anything
     tried to take them to WhatsApp instead. */
  async function press(page, sel) {
    const popups = [];
    const onPage = p => popups.push(p);
    page.context().on('page', onPage);
    await page.locator(sel).first().scrollIntoViewIfNeeded();
    await page.locator(sel).first().click();
    await page.waitForTimeout(400);
    page.context().off('page', onPage);
    const away = popups.map(p => p.url()).concat(/wa\.me|whatsapp/.test(page.url()) ? [page.url()] : []);
    for (const p of popups) await p.close().catch(() => {});
    return away;
  }
  const words = (page, sel) => page.evaluate(s => Array.from(document.querySelectorAll(s)).map(e => e.textContent.trim()), sel);

  try {
    console.log('\nThe live chat on: every ask button says Enquire and opens it');
    let { ctx, page } = await open(true);

    let w = await words(page, '#wabanner .btn');
    is(w.length === 1 && w[0] === 'Enquire', 'Shopping made personal: "Enquire", not "Chat on WhatsApp"', J(w));
    let band = await page.evaluate(() => document.querySelector('#wabanner p').textContent);
    is(!/WhatsApp/.test(band), 'and its line no longer sends people to WhatsApp', band);
    if (SHOTS) {
      await page.locator('#wabanner').scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      await page.locator('#wabanner').screenshot({ path: path.join(SHOTS, 'enquire-band.png') });
    }
    let away = await press(page, '#wabanner .btn');
    let c = await chat(page);
    is(c.open && c.text === 'I\'d like to shop with you.' && away.length === 0,
       'pressed, the live chat opens with the message ready to send, and nothing goes to WhatsApp', J({ c, away }));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'enquire-chat-open.png') });
    await shut(page);

    w = await words(page, '.care-wa');
    is(w.length > 0 && w.every(t => t === 'Enquire'), 'the here-to-help panels: each says "Enquire"', J(w));
    if (SHOTS) {
      await page.locator('.care-wa').first().scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollBy(0, -260));
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(SHOTS, 'enquire-care.png') });
    }
    away = await press(page, '.care-wa');
    c = await chat(page);
    is(c.open && c.text && c.text.length > 3 && away.length === 0, 'and opens the chat with that panel\'s own message', J({ c, away }));
    await shut(page);

    w = await words(page, '#deliveryFoot .btn');
    is(w.length === 1 && w[0] === 'Enquire', 'delivery: "Enquire", not "Ask about delivery"', J(w));
    away = await press(page, '#deliveryFoot .btn');
    c = await chat(page);
    is(c.open && c.text === 'I have a question about delivery.' && away.length === 0, 'and asks about delivery in the chat', J({ c, away }));
    await shut(page);

    w = await words(page, '#faqAsk .btn');
    is(w.length === 1 && w[0] === 'Enquire', 'the FAQ\'s last button: "Enquire", even where the old "Ask us on WhatsApp" was saved', J(w));
    away = await press(page, '#faqAsk .btn');
    c = await chat(page);
    is(c.open && c.text === 'I have a question.' && away.length === 0, 'and opens the chat', J({ c, away }));
    await shut(page);

    const cards = await page.evaluate(() => Array.from(document.querySelectorAll('.card')).map(card => ({
      name: (card.querySelector('.n') || {}).textContent, btn: ((card.querySelector('.wa-line .btn-wa') || {}).textContent || '').trim(),
      chat: !!card.querySelector('.wa-line .btn-chat') })));
    const sold = cards.find(x => x.name === 'Leather Satchel'), asked = cards.find(x => x.name === 'Croc Clutch'),
          buy = cards.find(x => x.name === 'Woven Tote');
    is(sold && sold.btn === 'Enquire' && sold.chat, 'a sold-out piece: "Enquire"', J(sold));
    is(asked && asked.btn === 'Enquire' && asked.chat, 'a piece whose price is on request: "Enquire", even with "Ask about this piece" saved', J(asked));
    is(buy && /WhatsApp/.test(buy.btn) && !buy.chat, 'a piece you can buy is unchanged: buying is not an enquiry', J(buy));
    away = await press(page, '.card:has(.n:text-is("Leather Satchel")) .wa-line .btn-chat');
    c = await chat(page);
    is(c.open && /Leather Satchel \(SKU: BG-SATC\)/.test(c.text) && away.length === 0,
       'pressed on the sold-out piece, the chat opens naming the piece and its code', J({ c, away }));
    await shut(page);
    away = await press(page, '.card:has(.n:text-is("Croc Clutch")) .wa-line .btn-chat');
    c = await chat(page);
    is(c.open && /price of Croc Clutch \(SKU: BG-CROC\)/.test(c.text) && away.length === 0,
       'and on the price-on-request piece, it asks the price', J({ c, away }));

    console.log('\nFrom a quick view');
    await shut(page);
    await page.evaluate(() => {
      const card = Array.from(document.querySelectorAll('.card')).find(c => /Leather Satchel/.test(c.textContent));
      const q = card && card.querySelector('.quick, [class*="quick"], button[aria-label*="uick"]');
      if (q) q.click();
    });
    await page.waitForSelector('#qv.open #qvBuy', { timeout: 5000 });
    w = await words(page, '#qvBuy');
    away = await press(page, '#qvBuy');
    c = await chat(page);
    const qvOpen = await page.evaluate(() => document.getElementById('qv').classList.contains('open'));
    is(w[0] === 'Enquire' && c.open && !qvOpen && /Leather Satchel/.test(c.text) && away.length === 0,
       'Enquire in a quick view closes it and opens the chat in front, not behind it', J({ w, c, qvOpen, away }));
    await shut(page);

    console.log('\nWhat the customer has already typed is theirs');
    await page.fill('#chatInput', 'Hello, about my order');
    await page.evaluate(() => { const m = document.getElementById('chatMin'); if (m) m.click(); });
    await page.waitForTimeout(150);
    await press(page, '#wabanner .btn');
    c = await chat(page);
    is(c.open && c.text === 'Hello, about my order', 'Enquire opens the chat and leaves their words alone', J(c));
    await page.fill('#chatInput', '');
    await shut(page);

    console.log('\nThe piece page and the policies page');
    await page.goto(base + '/product/BG-SATC', { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    w = await words(page, '#buyDetail');
    away = await press(page, '#buyDetail');
    c = await chat(page);
    is(w[0] === 'Enquire' && c.open && /Leather Satchel/.test(c.text) && away.length === 0,
       'a sold-out piece\'s own page: Enquire, into the chat', J({ w, c, away }));
    await shut(page);
    await page.goto(base + '/policies', { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    w = await words(page, '.pol-help .btn');
    away = await press(page, '.pol-help .btn');
    c = await chat(page);
    is(w[0] === 'Enquire' && c.open && c.text === 'I have a question about your policies.' && away.length === 0,
       'the policies page: Enquire, into the chat', J({ w, c, away }));
    await shut(page);

    console.log('\nThe shop\'s own wording is kept, unless it names WhatsApp');
    await ctx.close();
    ({ ctx, page } = await open(true, {
      'customer-care': { faqEnabled: true, faqs: [{ q: 'Q?', a: 'A.' }], faqAskEnabled: true, faqAskText: 'Talk to a stylist' },
      pricing: { onRequestEnabled: true, onRequestButton: 'Ask the price' } }));
    w = await words(page, '#faqAsk .btn');
    const asked2 = await page.evaluate(() => { const b = document.querySelector('.card:has(.n) .wa-line .btn-chat');
      return Array.from(document.querySelectorAll('.card')).filter(c => /Croc Clutch/.test(c.textContent))
        .map(c => c.querySelector('.wa-line .btn-wa').textContent.trim())[0]; });
    is(w[0] === 'Talk to a stylist' && asked2 === 'Ask the price', 'words the shop typed itself stay, and still open the chat', J({ w, asked2 }));
    await ctx.close();

    console.log('\nThe owner\'s steps: one Enquire, close the chat, another Enquire');
    ({ ctx, page } = await open(true));
    await press(page, '#deliveryFoot .btn');
    const first = (await chat(page)).text;
    await shut(page);
    await press(page, '.care-wa');
    const second = (await chat(page)).text;
    await shut(page);
    await press(page, '#wabanner .btn');
    const third = (await chat(page)).text;
    await shut(page);
    is(first === 'I have a question about delivery.' && second && second !== first && third === 'I\'d like to shop with you.',
       'each button puts its own words in the box, not the first one\'s again (build 82 did)', J([first, second, third]));
    await ctx.close();

    console.log('\nEach button\'s words are the shop\'s to write (Settings > Live Chat)');
    ({ ctx, page } = await open(true, { chat: { enabled: true,
      enquireShop: 'Hello! I saw your website and would like some help.',
      enquireDelivery: 'Do you deliver to Kitwe?',
      enquireFaq: 'My question is not on the list.',
      enquirePolicies: 'About your returns policy:',
      enquireSoldOut: 'Will {product} ({sku}) be back? I liked it at {price}.',
      enquirePrice: 'What does {product} cost?' } }));
    const said = {};
    for (const [name, sel] of [['band', '#wabanner .btn'], ['delivery', '#deliveryFoot .btn'], ['faq', '#faqAsk .btn'],
                               ['sold', '.card:has(.n:text-is("Leather Satchel")) .wa-line .btn-chat'],
                               ['price', '.card:has(.n:text-is("Croc Clutch")) .wa-line .btn-chat']]) {
      await press(page, sel); said[name] = (await chat(page)).text; await shut(page);
    }
    is(said.band === 'Hello! I saw your website and would like some help.' && said.delivery === 'Do you deliver to Kitwe?' &&
       said.faq === 'My question is not on the list.',
       'the band, delivery and the FAQ start with the words saved for each', J(said));
    is(/^Will Leather Satchel \(BG-SATC\) be back\? I liked it at K/.test(said.sold) && said.price === 'What does Croc Clutch cost?',
       'and a piece\'s, with its name, code and price filled in', J(said));
    await page.goto(base + '/policies', { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    await press(page, '.pol-help .btn');
    const pol = (await chat(page)).text;
    is(pol === 'About your returns policy:', 'the policies page too', pol);
    await ctx.close();

    ({ ctx, page } = await open(false, { chat: { enabled: false, enquireDelivery: 'Do you deliver to Kitwe?' } }));
    const pop = ctx.waitForEvent('page', { timeout: 5000 });
    await page.locator('#deliveryFoot .btn').scrollIntoViewIfNeeded();
    await page.locator('#deliveryFoot .btn').click();
    const waPage = await pop.catch(() => null);
    const waAddr = waPage ? decodeURIComponent(waPage.url()) : '';
    is(/Do you deliver to Kitwe\?/.test(waAddr), 'with the live chat off, the same saved words start the WhatsApp message', waAddr);
    await ctx.close();

    console.log('\nThe live chat switched off: Enquire still goes somewhere');
    ({ ctx, page } = await open(false));
    w = await words(page, '#wabanner .btn');
    const popup = ctx.waitForEvent('page', { timeout: 5000 });
    await page.locator('#wabanner .btn').scrollIntoViewIfNeeded();
    await page.locator('#wabanner .btn').click();
    const wa = await popup.catch(() => null);
    const waUrl = wa ? wa.url() : '';
    c = await chat(page);
    is(w[0] === 'Enquire' && /wa\.me\/260970000001/.test(waUrl) && /shop%20with%20you/.test(waUrl) && !c.open,
       'Settings > Live Chat off: Enquire opens WhatsApp, as these buttons did before', J({ w, waUrl, c }));
    await ctx.close();

    is(errors.length === 0, 'no errors on the page', errors.slice(0, 3).join(' | '));
  } catch (e) {
    fail('the test itself broke', e && e.stack);
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failures ? '\n  ✗ ' + failures + ' of ' + checks + ' checks FAILED'
                       : '\n  enquire opens the live chat: all ' + checks + ' checks passed');
  process.exit(failures ? 1 : 0);
})();
