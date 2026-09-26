/* ===========================================================================
   A CUSTOMER SENDS A PHOTO IN THE CHAT -- driven in a real browser

   THE SHOP OWNER: "Make the web chat allow customers to upload images.
   Should be compressed images."

   The real index.html and assets/chat.js, with the website's Supabase
   answered by this file. What is checked: the camera button appears only
   once supabase-chat-photos.sql has been run; a big phone photo is shrunk
   on the phone before it is uploaded; it goes to the one address the
   database handed out, and is then sent into the conversation; and the
   customer sees their photo, not an error.
   =========================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
let checks = 0, failures = 0;
const ok   = m => { checks++; console.log('  ✓ ' + m); };
const fail = (m, x) => { checks++; failures++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); };
const is   = (c, m, x) => c ? ok(m) : fail(m, x);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/json'
};

const SLOT = 'aaaaaaaa-0000-0000-0000-000000000001/c-0123456789abcdef.jpg';
let INSTALLED = true;
let RPC = [];
let UPLOADS = [];
let MESSAGES = [];

const read = req => new Promise(r => { const b = []; req.on('data', c => b.push(c)); req.on('end', () => r(Buffer.concat(b))); });

function serve() {
  return new Promise(resolve => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://x');
      const p = url.pathname;
      const json = (o, code) => { res.writeHead(code || 200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };

      if (p === '/api/products') return json({ products: [], count: 0, version: 't' });
      if (p.indexOf('/rest/v1/rpc/') === 0) {
        const fn = p.slice('/rest/v1/rpc/'.length);
        const args = JSON.parse((await read(req)).toString() || '{}');
        RPC.push({ fn, args });
        if (fn === 'chat_photos_on') return INSTALLED ? json(true) : json({ message: 'not found' }, 404);
        if (fn === 'chat_start') return json('tok-test');
        if (fn === 'chat_photo_start') return json(SLOT);
        if (fn === 'chat_send_photo') {
          MESSAGES.push({ id: 'm' + MESSAGES.length, sender: 'customer', body: '',
                          at: new Date().toISOString(), meta: { kind: 'image', path: args.p_path } });
          return json(new Date().toISOString());
        }
        if (fn === 'chat_poll') return json({ status: 'open', unread: 0, named: true, seen: false,
                                              here: true, typing: false, messages: MESSAGES });
        return json(null);
      }
      if (p.indexOf('/storage/v1/object/chat-uploads/') === 0 && req.method === 'POST') {
        const bytes = await read(req);
        UPLOADS.push({ path: p.slice('/storage/v1/object/chat-uploads/'.length), size: bytes.length,
                       type: req.headers['content-type'], bytes });
        return json({ Key: 'chat-uploads/' + SLOT });
      }
      if (p.indexOf('/storage/v1/object/public/chat-uploads/') === 0) {
        const u = UPLOADS[UPLOADS.length - 1];
        res.writeHead(u ? 200 : 404, { 'Content-Type': u ? u.type : 'text/plain' });
        return res.end(u ? u.bytes : '');
      }
      if (p.indexOf('/rest/v1/site_settings') === 0) {
        const key = (url.searchParams.get('key') || '').replace('eq.', '');
        if (key === 'chat') return json([{ data: { enabled: true } }]);
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

/* A 4000 x 3000 photo full of detail, as a phone takes it: several MB. */
async function phonePhoto(page) {
  const b64 = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 4000; c.height = 3000;
    const x = c.getContext('2d'); const d = x.createImageData(4000, 3000);
    for (let i = 0; i < d.data.length; i += 4) {
      d.data[i] = (i * 7) & 255; d.data[i + 1] = (i * 13) & 255; d.data[i + 2] = (i * 3) & 255; d.data[i + 3] = 255;
    }
    x.putImageData(d, 0, 0);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.98));
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return btoa(s);
  });
  return Buffer.from(b64, 'base64');
}

(async () => {
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();

  async function open() {
    RPC = []; UPLOADS = []; MESSAGES = [];
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String((e && e.message) || e)));
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1400);
    return { ctx, page, errors };
  }
  const shown = page => page.evaluate(() => {
    const a = document.getElementById('chatAttach');
    return !!a && getComputedStyle(a).display !== 'none';
  });

  try {
    console.log('\nBefore supabase-chat-photos.sql has been run');
    INSTALLED = false;
    {
      const { ctx, page } = await open();
      await page.click('#chatFab');
      is(!(await shown(page)), 'there is no photo button, so nobody meets one that cannot work');
      await ctx.close();
    }

    console.log('\nOnce it has');
    INSTALLED = true;
    {
      const { ctx, page, errors } = await open();
      await page.click('#chatFab');
      is(await shown(page), 'a camera button sits beside the message box');
      const shrinkLoaded = await page.evaluate(() => !!window.VBP_SHRINK);
      is(!shrinkLoaded, 'the shrinker is not downloaded until somebody picks a photo');

      const photo = await phonePhoto(page);
      await page.setInputFiles('#chatFile', { name: 'IMG_0001.jpg', mimeType: 'image/jpeg', buffer: photo });
      await page.waitForFunction(() => document.querySelectorAll('#chatLog .chat-photo img').length > 0 &&
        !document.querySelector('#chatLog .chat-photo.is-sending'), null, { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(500);

      const up = UPLOADS[0];
      is(UPLOADS.length === 1 && up.path === SLOT, 'the photo goes to the one address the database handed out',
         JSON.stringify(UPLOADS.map(u => u.path)));
      is(up && up.type === 'image/jpeg' && up.size < photo.length / 4,
         'shrunk on the phone first: ' + (photo.length / 1048576).toFixed(1) + ' MB went up as ' +
         (up ? Math.round(up.size / 1024) + ' KB' : '?'));
      const dims = up ? await page.evaluate(async b64 => {
        const im = new Image(); im.src = 'data:image/jpeg;base64,' + b64;
        await im.decode(); return [im.naturalWidth, im.naturalHeight];
      }, up.bytes.toString('base64')) : null;
      is(dims && dims[0] === 1600 && dims[1] === 1200, 'at 1600 pixels on its long side', JSON.stringify(dims));

      const order = RPC.map(r => r.fn).filter(f => /chat_(start|photo_start|send_photo)/.test(f));
      is(order.join() === 'chat_start,chat_photo_start,chat_send_photo',
         'a conversation is started, an address asked for, and the photo sent, in that order', order.join());
      const sent = RPC.filter(r => r.fn === 'chat_send_photo')[0];
      is(sent && sent.args.p_token === 'tok-test' && sent.args.p_path === SLOT,
         'sent with the conversation\'s token and that address');

      const view = await page.evaluate(() => {
        const img = document.querySelector('#chatLog .chat-msg.from-me .chat-photo img');
        return img ? { src: img.src, alt: img.alt, w: img.naturalWidth } : null;
      });
      is(view && view.src.indexOf('/storage/v1/object/public/chat-uploads/' + SLOT) > -1 && view.w > 0,
         'the customer sees their photo in the conversation, on their side', JSON.stringify(view));
      is(view && view.alt === 'Your photo', 'described as theirs, not as the shop\'s');
      const wa = await page.evaluate(() => /continue on whatsapp|continue there/i.test(
        (document.getElementById('chatPanel') || {}).textContent || ''));
      is(!wa, 'and the "Need to send a photo? Continue on WhatsApp" link is gone');
      if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
      is(errors.length === 0, 'and nothing went wrong on the page' + (errors.length ? ': ' + errors[0] : ''));
      await ctx.close();
    }

    console.log('\nSomething that is not a photo');
    {
      const { ctx, page } = await open();
      await page.click('#chatFab');
      await page.setInputFiles('#chatFile', { name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
      await page.waitForTimeout(600);
      is(UPLOADS.length === 0 && !RPC.some(r => r.fn === 'chat_photo_start'),
         'is not uploaded, and no address is asked for');
      await ctx.close();
    }
  } catch (e) {
    fail('threw: ' + (e && e.message || e));
  } finally {
    await browser.close();
    server.close();
  }
  console.log('\n' + (failures ? '  ✗ ' + failures + ' of ' + checks + ' checks FAILED'
                                : '  chat photos in the browser: all ' + checks + ' checks passed'));
  process.exit(failures ? 1 : 0);
})();
