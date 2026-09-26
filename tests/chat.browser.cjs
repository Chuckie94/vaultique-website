/* ===========================================================================
   THE CHAT WINDOW — driven in a real browser

   Three things were changed about the customer's side and each is checked here
   against the real index.html and the real assets/chat.js, with the website's
   Supabase answered by this file:

     1. THE LINE UNDER THE TITLE. It used to be a sentence written into
        index.html which no setting could reach — which is why a shop looking
        for it in Settings could not find it. It now comes from Settings > Live
        Chat like everything else in the window, and there are four states to
        get right: before anyone has asked, somebody at the desk, nobody there,
        and outside chat hours.

     2. AN AUTOMATIC NOTICE IS DRAWN ON THE SHOP'S SIDE. The job-enquiry filter
        answers as 'system' rather than as 'shop' — it is not a person and must
        not stamp the shop's answering-time statistic. The window has to draw
        it as an answer and not as something the customer said themselves.

     3. THE SOCKET. A reply should arrive without waiting for the next ask, and
        — far more important — everything must still work when there is no
        socket at all, which is what these checks are mostly about.
   =========================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
let checks = 0, failures = 0;
const ok   = m => { checks++; console.log('  ✓ ' + m); };
const fail = m => { checks++; failures++; console.log('  ✗ ' + m); };
const is   = (c, m) => c ? ok(m) : fail(m);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/json'
};
const REAL_DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/141.0.0.0 Safari/537.36';

/* What the shop has saved, and what the conversation currently holds. Both are
   changed between assertions the way the shop and the customer change them. */
let CHAT_SETTINGS = {};
let POLL = null;
let RPC_CALLS = [];

const body = req => new Promise(r => { let d=''; req.on('data',c=>d+=c); req.on('end',()=>r(d)); });

function serve() {
  return new Promise(resolve => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://x');
      const p = url.pathname;
      const json = o => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(o));
      };

      if (p === '/api/products') return json({ products: [], count: 0, version: 't' });

      if (p.indexOf('/rest/v1/rpc/') === 0) {
        const fn = p.slice('/rest/v1/rpc/'.length);
        RPC_CALLS.push({ fn, body: await body(req) });
        if (fn === 'chat_start') return json('tok-test-000000000001');
        if (fn === 'chat_poll') return json(POLL);
        return json(null);
      }
      if (p.indexOf('/rest/v1/site_settings') === 0) {
        const key = (url.searchParams.get('key') || '').replace('eq.', '');
        if (key === 'chat') return json([{ data: CHAT_SETTINGS }]);
        return json([]);
      }
      if (p.indexOf('/rest/v1/') === 0) return json([]);

      if (p === '/config.js') {
        res.writeHead(200, { 'Content-Type': TYPES['.js'] });
        return res.end('window.VBP_CONFIG={SUPABASE_URL:"http://127.0.0.1:' +
                       server.address().port + '",SUPABASE_ANON_KEY:"test-anon-key"};');
      }
      let file = path.join(ROOT, p);
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, 'index.html');
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      res.end(fs.readFileSync(file));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const subLine = page => page.evaluate(() =>
  (document.querySelector('#chatSub') || {}).textContent || '');

(async () => {
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();

  async function open(settings, poll) {
    CHAT_SETTINGS = settings || {};
    POLL = poll || null;
    RPC_CALLS = [];
    const ctx = await browser.newContext({ userAgent: REAL_DESKTOP });
    ctx.setDefaultTimeout(8000);
    ctx.setDefaultNavigationTimeout(60000);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String((e && e.message) || e)));
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1400);
    return { ctx, page, errors };
  }

  try {
    /* ==================================================================== */
    console.log('\nThe line under the title is the shop\'s to write');
    {
      const { ctx, page, errors } = await open({
        enabled: true,
        openingText: 'Ask us anything at all — we are glad you are here'
      });
      is(errors.length === 0, 'the window loads without a script error' +
         (errors.length ? ': ' + errors[0] : ''));
      is((await subLine(page)) === 'Ask us anything at all — we are glad you are here',
         'and shows the opening line the shop saved, not the one in index.html');
      await ctx.close();
    }
    {
      /* The exact fault that was reported: a shop that saves nothing must see
         what it has always seen, so the default has to match index.html. */
      const { ctx, page } = await open({ enabled: true });
      is((await subLine(page)) === 'Tell us what you are looking for — we would love to help',
         'a shop that has saved nothing sees exactly what it saw before');
      await ctx.close();
    }
    {
      const { ctx, page } = await open({
        enabled: true, useHours: true, hideOutsideHours: false,
        outsideHoursText: 'We are shut — leave a message',
        hours: { mon: { open: false }, tue: { open: false }, wed: { open: false },
                 thu: { open: false }, fri: { open: false }, sat: { open: false },
                 sun: { open: false } }
      });
      is((await subLine(page)) === 'We are shut — leave a message',
         'outside chat hours it says so, and that is a setting too');
      await ctx.close();
    }

    /* ==================================================================== */
    console.log('\nAnd changes once it knows who is at the desk');
    {
      const { ctx, page } = await open(
        { enabled: true, hereText: 'Chanda is here now', awayText: 'Nobody in — leave a note' },
        { status: 'open', unread: 0, named: true, seen: false, here: true, typing: false,
          messages: [{ id: 'm1', sender: 'customer', body: 'Hello', at: new Date().toISOString() }] }
      );
      await page.click('#chatFab');
      await page.fill('#chatInput', 'Is the silk dress in stock?');
      await page.press('#chatInput', 'Enter');
      await page.waitForTimeout(1600);
      is((await subLine(page)) === 'Chanda is here now',
         'with somebody at the desk it says the shop\'s "here" line');
      await ctx.close();
    }
    {
      const { ctx, page } = await open(
        { enabled: true, hereText: 'Chanda is here now', awayText: 'Nobody in — leave a note' },
        { status: 'open', unread: 0, named: true, seen: false, here: false, typing: false,
          messages: [{ id: 'm1', sender: 'customer', body: 'Hello', at: new Date().toISOString() }] }
      );
      await page.click('#chatFab');
      await page.fill('#chatInput', 'Hello?');
      await page.press('#chatInput', 'Enter');
      await page.waitForTimeout(1600);
      is((await subLine(page)) === 'Nobody in — leave a note',
         'with nobody there it says the shop\'s "away" line');
      await ctx.close();
    }

    /* ==================================================================== */
    console.log('\nAn automatic notice is an answer, not something they said');
    {
      const now = new Date().toISOString();
      const { ctx, page } = await open(
        { enabled: true },
        { status: 'open', unread: 0, named: true, seen: false, here: false, typing: false,
          messages: [
            { id: 'm1', sender: 'customer', body: 'Are you hiring?', at: now },
            { id: 'm2', sender: 'system',
              body: 'Thank you for your interest in working with Vaultique Boutique Point.',
              at: now }
          ] }
      );
      await page.click('#chatFab');
      await page.fill('#chatInput', 'Are you hiring?');
      await page.press('#chatInput', 'Enter');
      await page.waitForTimeout(1600);

      const rows = await page.evaluate(() =>
        Array.from(document.querySelectorAll('#chatLog .chat-msg')).map(n => ({
          cls: n.className, text: (n.textContent || '').trim()
        })));
      const notice = rows.find(r => /Thank you for your interest/.test(r.text));
      const theirs = rows.find(r => /Are you hiring/.test(r.text));
      is(!!notice, 'the notice is shown to the customer');
      is(notice && /from-shop/.test(notice.cls),
         'on the shop\'s side of the window, where an answer belongs');
      is(notice && !/from-me/.test(notice.cls),
         'and never in the customer\'s own words');
      is(theirs && /from-me/.test(theirs.cls),
         'while what they actually wrote is still theirs');
      is(!/(job enquiry|classif|intent|score)/i.test(rows.map(r => r.text).join(' ')),
         'and no internal label is anywhere on the page');

      const tail = await page.evaluate(() =>
        (document.querySelector('#chatLog .chat-seen') || {}).textContent || '');
      is(tail === '', 'no "Queued" is stamped under a notice the shop never typed');
      await ctx.close();
    }

    /* ==================================================================== */
    console.log('\nWith no socket at all — which is how it has always worked');
    {
      const now = new Date().toISOString();
      const { ctx, page, errors } = await open(
        { enabled: true },
        { status: 'open', unread: 0, named: true, seen: false, here: true, typing: false,
          messages: [{ id: 'm1', sender: 'shop', body: 'We do have it.', at: now }] }
      );
      await page.click('#chatFab');
      await page.fill('#chatInput', 'Do you have it?');
      await page.press('#chatInput', 'Enter');
      await page.waitForTimeout(1800);

      const shown = await page.evaluate(() =>
        (document.querySelector('#chatLog') || {}).textContent || '');
      is(/We do have it\./.test(shown),
         'the shop\'s reply still reaches the window without any socket');
      is(RPC_CALLS.some(c => c.fn === 'chat_start'), 'a conversation is still started');
      is(RPC_CALLS.some(c => c.fn === 'chat_send'), 'the message is still sent');
      is(RPC_CALLS.some(c => c.fn === 'chat_poll'), 'and it still asks for what is new');
      is(errors.length === 0, 'with no script error anywhere' +
         (errors.length ? ': ' + errors[0] : ''));

      /* The library is fetched from a CDN this test cannot reach, so the
         subscription can never settle here. That is exactly the case the
         timer exists for, and the checks above are what prove it holds. */
      const asks = RPC_CALLS.filter(c => c.fn === 'chat_poll').length;
      is(asks >= 1, 'the timer is doing the work, as it does when the socket is not there');
      await ctx.close();
    }

    /* ==================================================================== */
    console.log('\nThe breathing dot when the shop is typing');
    {
      const now = new Date().toISOString();
      const { ctx, page } = await open(
        { enabled: true },
        { status: 'open', unread: 0, named: true, seen: false, here: true, typing: true,
          messages: [{ id: 'm1', sender: 'customer', body: 'Hello', at: now }] }
      );
      await page.click('#chatFab');
      await page.fill('#chatInput', 'Hello');
      await page.press('#chatInput', 'Enter');
      await page.waitForTimeout(1800);
      const dot = await page.evaluate(() => {
        const d = document.querySelector('#chatLog .chat-typing .chat-typing-dot');
        if (!d) return null;
        const r = d.getBoundingClientRect(), cs = getComputedStyle(d);
        return { w: r.width, h: r.height, bg: cs.backgroundColor, anim: cs.animationName,
                 last: document.querySelector('#chatLog').lastElementChild.className };
      });
      is(!!dot && dot.w > 0 && dot.h > 0 && /31, 157, 87/.test(dot.bg),
         'with the shop typing, a green dot is on the customer\'s side', JSON.stringify(dot));
      is(!!dot && dot.anim && dot.anim !== 'none', 'and it breathes', dot && dot.anim);
      is(!!dot && /chat-typing/.test(dot.last), 'at the foot of the conversation', dot && dot.last);
      POLL = Object.assign({}, POLL, { typing: false });
      await page.waitForTimeout(3600);
      is(!(await page.$('#chatLog .chat-typing')), 'and goes when they stop');
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures ? ('\n' + checks + ' checks, ' + failures + ' failed')
                       : ('\nchat window: all ' + checks + ' checks passed'));
  process.exit(failures ? 1 : 0);
})();
