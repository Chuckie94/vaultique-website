/* ===========================================================================
   THE ADMIN CHAT DESK: taken when opened, and @mentions -- in a real browser

   The real assets/admin/live-chat.js, with the database scripted. Mwila is
   signed in; Chanda is a colleague.
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

const ME = '22222222-2222-2222-2222-222222222222', CHANDA = '11111111-1111-1111-1111-111111111111';
const STUB = `
var ME = '${ME}', CHANDA = '${CHANDA}';
window.DB = {
  convs: [
    { id: 'c-new', name: 'Precious', status: 'open', last_message_at: new Date().toISOString(), shop_unread: 1, assigned_to: null },
    { id: 'c-theirs', name: 'Bwalya', status: 'open', last_message_at: new Date().toISOString(), shop_unread: 0, assigned_to: CHANDA }
  ],
  agents: [
    { id: ME, display_name: 'Mwila', status: 'online', last_seen_at: new Date().toISOString() },
    { id: CHANDA, display_name: 'Chanda', status: 'online', last_seen_at: new Date().toISOString() }
  ],
  notes: [], inserts: [], rpc: [], noteHandler: null
};
function answer(v) { return new Promise(function (r) { setTimeout(function () { r(v); }, 5); }); }
function builder(table) {
  var q = { table: table, f: [] }, b = {};
  ['select','order','limit','range','gte','lte','in','neq','or'].forEach(function (k) { b[k] = function () { return b; }; });
  b.eq = function (c, v) { q.f.push([c, v]); return b; };
  b.is = function (c, v) { q.f.push([c, v]); return b; };
  b.maybeSingle = b.single = function () { q.one = true; return b; };
  b.insert = function (row) { q.insert = row; return b; };
  b.update = function (row) { q.update = row; return b; };
  b.upsert = function (row) { q.insert = row; return b; };
  b.then = function (a, c) {
    var v = { data: [], error: null };
    if (q.insert) {
      DB.inserts.push({ table: table, row: q.insert });
      if (table === 'chat_notes') DB.notes.push(Object.assign({ id: 'n' + DB.notes.length, created_at: new Date().toISOString() }, q.insert));
    } else if (table === 'chat_conversations') v.data = DB.convs.slice();
    else if (table === 'chat_agents') v.data = DB.agents.slice();
    else if (table === 'chat_notes') v.data = DB.notes.filter(function (n) { return !q.f.length || n.conversation_id === q.f[0][1]; });
    else if (table === 'admins') v.data = [{ id: ME, role: 'agent' }];
    if (q.one) v.data = v.data[0] || null;
    return answer(v).then(a, c);
  };
  return b;
}
window.__sb = {
  auth: { getSession: function () { return Promise.resolve({ data: { session: { user: { id: ME, email: 'mwila@shop.test' } } } }); } },
  from: builder,
  rpc: function (name, args) {
    DB.rpc.push({ name: name, args: args });
    if (name === 'chat_take') {
      var c = DB.convs.filter(function (x) { return x.id === args.p_conversation; })[0];
      if (c && !c.assigned_to && c.status === 'open') {
        c.assigned_to = ME;
        DB.notes.push({ id: 'e' + DB.notes.length, conversation_id: c.id, kind: 'event', body: 'Taken by Mwila', author_id: ME, created_at: new Date().toISOString() });
        return answer({ data: { taken: true }, error: null });
      }
      return answer({ data: { taken: false, holder: c && c.assigned_to, name: 'Chanda' }, error: null });
    }
    if (name === 'chat_assign') {
      var d = DB.convs.filter(function (x) { return x.id === args.p_conversation; })[0];
      if (d) d.assigned_to = args.p_agent;
      return answer({ data: null, error: null });
    }
    return answer({ data: null, error: null });
  },
  channel: function () {
    var ch = { on: function (kind, spec, fn) { if (spec && spec.table === 'chat_notes') DB.noteHandler = fn; return ch; },
               subscribe: function (cb) { setTimeout(function () { cb && cb('SUBSCRIBED'); }, 0); return ch; } };
    return ch;
  },
  removeChannel: function () {}
};
`;
const PAGE = `<!DOCTYPE html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/assets/admin/admin.css"></head><body><div class="wrap"><div id="host"></div></div>
<script src="/assets/formats.js"></script>
<script src="/assets/admin/registry.js"></script>
<script>${STUB}</script>
<script src="/assets/admin/live-chat.js"></script>
<script>window.VBP_ADMIN.pages.chats.render(document.getElementById('host'), { sb: window.__sb, navigate: function () {} });</script>
</body></html>`;

const server = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (p === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(PAGE); }
  const f = path.join(ROOT, p);
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(''); }
  res.writeHead(200, { 'Content-Type': p.endsWith('.css') ? 'text/css' : 'text/javascript' });
  res.end(fs.readFileSync(f));
});

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e)));
  try {
    await page.goto('http://127.0.0.1:' + server.address().port + '/');
    await page.waitForSelector('.lc-row', { timeout: 6000 });
    await page.waitForTimeout(400);

    console.log('\nWho has what, in the list');
    let tags = await page.evaluate(() => Array.from(document.querySelectorAll('.lc-row')).map(r =>
      (r.querySelector('.lc-who') || {}).textContent + ':' + ((r.querySelector('.lc-taken') || {}).textContent || '-')));
    is(tags.includes('Bwalya:Taken by Chanda'), 'a chat Chanda has is marked "Taken by Chanda" for everybody', tags.join(' | '));
    is(tags.includes('Precious:-'), 'a new chat is not marked', tags.join(' | '));

    console.log('\nOpening a new chat takes it');
    await page.click('.lc-row >> text=Precious');
    await page.waitForTimeout(700);
    const took = await page.evaluate(() => DB.rpc.filter(r => r.name === 'chat_take').map(r => r.args.p_conversation));
    is(took.join() === 'c-new', 'opening it takes it, without choosing anybody from a list', took.join());
    tags = await page.evaluate(() => Array.from(document.querySelectorAll('.lc-row')).map(r =>
      (r.querySelector('.lc-who') || {}).textContent + ':' + ((r.querySelector('.lc-taken') || {}).textContent || '-')));
    is(tags.includes('Precious:You have this'), 'and the list says so', tags.join(' | '));
    const notesText = await page.evaluate(() => (document.querySelector('.lc-note-list') || {}).textContent || '');
    is(/Taken by Mwila/.test(notesText), 'with "Taken by Mwila" in the notes', notesText);

    console.log('\nOpening a chat a colleague has');
    await page.click('.lc-row >> text=Bwalya');
    await page.waitForTimeout(500);
    const rpcs = await page.evaluate(() => DB.rpc.filter(r => r.name === 'chat_take').length);
    is(rpcs === 1, 'a chat Chanda already has is not taken from her by opening it');
    const lock = await page.evaluate(() => Array.from(document.querySelectorAll('.lc-lock')).map(l => l.textContent).join(' '));
    is(/Chanda/.test(lock), 'and it says Chanda has it', lock);

    console.log('\nMentioning a colleague in a note');
    await page.click('.lc-row >> text=Precious');
    await page.waitForTimeout(500);
    await page.click('.lc-note-form input');
    await page.type('.lc-note-form input', 'Refund question @Ch');
    await page.waitForTimeout(150);
    const opts = await page.evaluate(() => Array.from(document.querySelectorAll('.lc-mention-opt')).map(b => b.textContent));
    is(opts.length === 1 && opts[0] === '@Chanda', 'typing @ offers the colleagues whose name matches', JSON.stringify(opts));
    await page.click('.lc-mention-opt');
    const val = await page.inputValue('.lc-note-form input');
    is(val === 'Refund question @Chanda ', 'picking one writes the mention in', JSON.stringify(val));
    const hand = await page.evaluate(() => { const r = document.querySelector('.lc-note-hand'); return r && !r.classList.contains('hide') ? r.textContent : ''; });
    is(/Also hand this chat to Chanda/.test(hand), 'and offers to hand her the chat in the same step', hand);
    await page.check('.lc-note-hand input');
    await page.focus('.lc-note-form input');
    await page.keyboard.press('End');
    await page.keyboard.type('please take it');
    await page.click('.lc-note-form button[type=submit]');
    await page.waitForTimeout(600);
    const ins = await page.evaluate(() => DB.inserts.filter(i => i.table === 'chat_notes').map(i => i.row));
    is(ins.length === 1 && JSON.stringify(ins[0].mentions) === JSON.stringify([CHANDA]),
       'the note is saved naming Chanda, which is what sends her the notification', JSON.stringify(ins));
    const assigned = await page.evaluate(() => DB.rpc.filter(r => r.name === 'chat_assign').map(r => r.args));
    is(assigned.length === 1 && assigned[0].p_agent === CHANDA && assigned[0].p_conversation === 'c-new',
       'and the chat is handed to her', JSON.stringify(assigned));
    const marked = await page.evaluate(() => Array.from(document.querySelectorAll('.lc-mention')).map(m => m.textContent));
    is(marked.includes('@Chanda'), 'the mention is picked out in the note', JSON.stringify(marked));

    console.log('\nBeing mentioned');
    await page.evaluate(([a, b]) => DB.noteHandler({ new: {
      id: 'n-live', conversation_id: 'c-theirs', author_id: a, kind: 'note',
      body: '@Mwila can you help with this customer?', mentions: [b] } }), [CHANDA, ME]);
    await page.waitForTimeout(200);
    const toast = await page.evaluate(() => { const t = document.querySelector('.lc-mention-toast'); return t ? t.textContent : ''; });
    is(/Chanda mentioned you/.test(toast) && /can you help/.test(toast), 'a note naming me pops up at once, saying who and what', toast);
    await page.click('.lc-mention-toast >> text=Open the chat');
    await page.waitForTimeout(400);
    const active = await page.evaluate(() => (document.querySelector('.lc-row.active .lc-who') || {}).textContent);
    is(active === 'Bwalya', '"Open the chat" takes me straight to it', active);
    await page.evaluate(a => DB.noteHandler({ new: {
      id: 'n-other', conversation_id: 'c-theirs', author_id: a, kind: 'note', body: 'note to self', mentions: null } }), CHANDA);
    await page.waitForTimeout(150);
    is(!(await page.$('.lc-mention-toast')), 'a note that does not name me does not interrupt me');
    is(errors.length === 0, 'with no page errors' + (errors.length ? ': ' + errors[0] : ''));
  } catch (e) {
    fail('threw: ' + (e && e.stack || e));
  } finally {
    await browser.close();
    server.close();
  }
  console.log('\n' + (failures ? '  ✗ ' + failures + ' of ' + checks + ' checks FAILED'
                                : '  chat desk: all ' + checks + ' checks passed'));
  process.exit(failures ? 1 : 0);
})();
