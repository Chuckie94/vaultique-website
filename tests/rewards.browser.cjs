/* ===========================================================================
   VAULTIQUE REWARDS IN THE BROWSER -- assets/rewards.js and the order form

   The rewards server function is answered here. Checked: linking a customer
   number with the emailed code, the points card, and using the points on a
   WhatsApp order -- promised on the server first, then written into the
   message with the customer number and the reference the till needs.
   =========================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');

let checks = 0, failures = 0;
const is = (c, m, x) => { checks++; if (c) console.log('  ✓ ' + m); else { failures++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); } };

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const piece = (o) => Object.assign({ category: 'Bags', size: '', color: '', material: '', available: true,
  lowStock: false, wasPrice: 0, brand: '', description: 'A piece.', details: [], variantGroup: '', maxQty: 5 }, o);
const CATALOGUE = [
  piece({ name: 'Woven Tote', sku: 'BG-WOTO', price: 1150, image_url: '/pic/tote-1.png',
          gallery: ['/pic/tote-2.png', '/pic/tote-3.png'] }),
  piece({ name: 'Leather Satchel', sku: 'BG-SATC', price: 3200, image_url: '/pic/satchel-1.png',
          gallery: ['/pic/satchel-2.png'] })
];
let SHOPPING = { rewardsOnline: true };
const CALLS = [];
let STATUS = { linked: false, waiting: [] };

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/json' };
const STUB = `window.supabase = { createClient: function () { return { channel: function () {
  var ch = { on: function () { return ch; }, subscribe: function () { return ch; } }; return ch; },
  removeChannel: function () {} }; } };`;

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), p = u.pathname;
  if (p === '/api/products') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ products: CATALOGUE, count: CATALOGUE.length, version: 'm1' }));
  }
  if (p === '/.netlify/functions/rewards') {
    let b = ''; req.on('data', c => b += c); req.on('end', () => {
      const body = JSON.parse(b || '{}'); CALLS.push({ auth: req.headers.authorization, body });
      const send = (st, o) => { res.writeHead(st, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (!/Bearer tok/.test(req.headers.authorization || '')) return send(401, { error: 'Please sign in to your account first.' });
      if (body.action === 'status') return send(200, STATUS);
      if (body.action === 'link') return send(200, { asked: true, message: 'If this number is on our records with an email address, we have sent a 6-digit code to that email.' });
      if (body.action === 'verify') {
        if (body.code !== '123456') return send(400, { error: 'That code is not right, or it has run out.' });
        STATUS = { linked: true, number: 'VB0007', points: 100500, worth: 50.25, perK1: 100, canRedeem: true,
                   milestone: { milestone: 100000, reached: 1, next: 200000 }, milestoneValue: 50 };
        return send(200, { linked: true });
      }
      if (body.action === 'quote') return send(200, { quote: { points: 60000, value: 30 } });
      if (body.action === 'hold') return send(200, { held: { points: 60000, value: 30 }, number: 'VB0007' });
      return send(400, { error: 'unknown' });
    });
    return;
  }
  if (p.indexOf('/pic/') === 0) { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(PNG); }
  if (p === '/rest/v1/site_settings' && u.searchParams.get('key') === 'eq.shopping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify([{ data: SHOPPING }]));
  }
  if (p.indexOf('/rest/v1/') === 0) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('[]'); }
  if (p === '/config.js') {
    res.writeHead(200, { 'Content-Type': TYPES['.js'] });
    return res.end('window.VBP_CONFIG={SUPABASE_URL:"http://127.0.0.1:' + server.address().port + '",SUPABASE_ANON_KEY:"k"};');
  }
  if (p === '/__stub.js') { res.writeHead(200, { 'Content-Type': TYPES['.js'] }); return res.end(STUB); }
  let file = path.join(ROOT, p);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, 'index.html');
  let body = fs.readFileSync(file);
  if (file.endsWith('index.html')) body = String(body).replace('<script src="/config.js"></script>',
    '<script src="/config.js"></script>\n<script src="/__stub.js"></script>');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  res.end(body);
});


(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await ctx.addInitScript(() => {
    window.__opened = [];
    window.open = function (u) {
      const tab = { location: { href: u || '' }, close() { tab.closed = true; } };
      window.__opened.push(tab); return tab;
    };
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e.message || e)));
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  /* A signed-in customer, as far as the rewards code can tell. */
  await page.evaluate(() => {
    const A = window.VBP_ACCOUNT;
    A.enabled = () => true; A.signedIn = () => true; A.accessToken = () => 'tok-chanda';
  });
  try {
    console.log('\nThe switch in Settings > Shopping');
    is(await page.evaluate(() => window.VBP_REWARDS.enabled === true), 'switched on, the website offers rewards');

    console.log('\nLinking a customer number');
    await page.evaluate(() => { const c = window.VBP_REWARDS.card(); c.id = 'rwCard'; document.body.prepend(c); });
    await page.waitForSelector('#rw_num');
    await page.fill('#rw_num', 'VB-0007');
    await page.click('#rwCard .ac-actions .btn');
    await page.waitForSelector('#rw_code:visible');
    const told = await page.textContent('#rwCard');
    is(/If this number is on our records/.test(told) && !/@/.test(told), 'the customer is told a code may be on its way, and no email is shown');
    await page.fill('#rw_code', '000000');
    await page.click('#rwCard .rw-code .btn');
    await page.waitForTimeout(300);
    is(/not right/.test(await page.textContent('#rwCard')), 'a wrong code is turned away');
    await page.fill('#rw_code', '123456');
    await page.click('#rwCard .rw-code .btn');
    await page.waitForSelector('#rwCard .rw-n');
    const cardText = (await page.textContent('#rwCard')).replace(/\s+/g, ' ');
    is(/100,500\s*points/.test(cardText) && /Worth K50\.25/.test(cardText), 'linked, the card shows the points and what they are worth', cardText);
    is(/Milestone reached/.test(cardText) && /VB0007/.test(cardText), 'the milestone, and the customer number', cardText);
    is(CALLS.every(c => c.auth === 'Bearer tok-chanda'), 'every question is asked as the signed-in customer');

    console.log('\nUsing the points on a WhatsApp order');
    await page.evaluate(() => document.getElementById('rwCard').remove());
    await page.goto(base + '/product/BG-WOTO', { waitUntil: 'networkidle' });
    await page.evaluate(() => { const A = window.VBP_ACCOUNT; A.enabled = () => true; A.signedIn = () => true; A.accessToken = () => 'tok-chanda'; window.VBP_REWARDS.forget(); });
    await page.click('#buyDetail');
    await page.waitForSelector('#od_points', { timeout: 8000 });
    const offer = (await page.textContent('.od-points')).replace(/\s+/g, ' ');
    is(/60,000 points take K30\.00 off/.test(offer), 'the order form offers the points', offer);
    await page.fill('#od_name', 'Chanda'); await page.fill('#od_phone', '0977000007');
    await page.check('#od_points'); await page.check('#od_consent');
    await page.click('#odGo');
    await page.waitForTimeout(600);
    const holdCall = CALLS.find(c => c.body.action === 'hold');
    is(holdCall && /^RW-[A-Z0-9]{6}$/.test(holdCall.body.orderRef) && holdCall.body.due === 1150,
       'the points are promised on the server first, for this order', JSON.stringify(holdCall && holdCall.body));
    const sent = await page.evaluate(() => window.__opened.map(t => t.location.href));
    const text = decodeURIComponent((sent[0] || '').split('text=')[1] || '');
    is(/Rewards: customer number VB0007, use 60,000 points \(−K30\.00\)\. Ref RW-[A-Z0-9]{6}\./.test(text),
       'the message names the customer number, the points and the reference for the till', text);
    is(/To pay after points: K1,120\.00/.test(text), 'and what is left to pay', text);

    console.log('\nSwitched off');
    SHOPPING = { rewardsOnline: false };
    const off = await browser.newPage();
    await off.goto(base + '/', { waitUntil: 'networkidle' });
    await off.waitForTimeout(600);
    const band = await off.evaluate(() => { const b = document.querySelector('#rewards .btn'); return b && { href: b.getAttribute('href'), text: b.textContent }; });
    is(await off.evaluate(() => window.VBP_REWARDS.enabled === false) && band && /wa\.me/.test(band.href || ''),
       'nothing changes: the homepage button is the WhatsApp message it always was', JSON.stringify(band));
    await off.close();

    is(errors.length === 0, 'no errors on the page', errors.join(' | '));
  } catch (e) {
    is(false, 'the test itself broke', e && e.stack);
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failures ? '\n  ✗ ' + failures + ' of ' + checks + ' checks FAILED' : '\n  rewards in the browser: all ' + checks + ' checks passed');
  process.exit(failures ? 1 : 0);
})();
