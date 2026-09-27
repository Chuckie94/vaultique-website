/* chat-push.js, for a mention: who is told is read from the note itself,
   never from the request, and only the people it names are woken. */
const http = require('http');
const path = require('path');
let checks = 0, failures = 0;
const is = (c, m, x) => { checks++; if (c) console.log('  ✓ ' + m); else { failures++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); } };

const CHANDA = '11111111-1111-1111-1111-111111111111', MWILA = '22222222-2222-2222-2222-222222222222';
const seen = [];
const server = http.createServer((req, res) => {
  seen.push(decodeURIComponent(req.url));
  const u = new URL(req.url, 'http://x'), p = u.pathname;
  const send = o => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (p.endsWith('/site_settings_private')) return send([{ data: { vapidPrivate: 'x', vapidPublic: 'y', secret: 'hook' } }]);
  if (p.endsWith('/chat_conversations')) return send([{ id: 'c1', name: 'Precious', assigned_to: MWILA }]);
  if (p.endsWith('/site_settings')) return send([{ data: {} }]);
  if (p.endsWith('/chat_notes')) return send([{ author_id: MWILA, body: '@Chanda please take this one', mentions: [CHANDA] }]);
  if (p.endsWith('/chat_agents')) return send([{ display_name: 'Mwila' }]);
  if (p.endsWith('/chat_push')) return send([]);
  send([]);
});
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  Object.assign(process.env, { WEB_SUPABASE_URL: base, WEB_SUPABASE_ANON_KEY: 'a', SITE_SUPABASE_URL: base,
                               SITE_SUPABASE_ANON_KEY: 'a', SUPABASE_SERVICE_ROLE_KEY: 'svc' });
  const fn = require(path.join(__dirname, '..', 'netlify', 'functions', 'chat-push')).handler;
  try {
    let r = await fn({ httpMethod: 'POST', headers: { 'x-chat-hook': 'wrong' },
                       body: JSON.stringify({ kind: 'mention', conversation: 'c1', note: 'n1', to: [MWILA] }) });
    is(r.statusCode === 403, 'without the database\'s secret, nothing is sent');
    seen.length = 0;
    r = await fn({ httpMethod: 'POST', headers: { 'x-chat-hook': 'hook' },
                   body: JSON.stringify({ kind: 'mention', conversation: 'c1', note: 'n1', to: [MWILA, 'everyone'] }) });
    const subs = seen.filter(u => u.indexOf('chat_push?') > -1)[0] || '';
    is(/person=in\.\(11111111-1111-1111-1111-111111111111\)/.test(subs),
       'a mention wakes only the person the note names, whatever the request says', subs);
    is(seen.some(u => /chat_notes\?id=eq\.n1/.test(u)), 'and who that is comes from the note itself');
    is(r.statusCode === 200, 'answered normally', r.body);
  } catch (e) { is(false, 'threw: ' + e.stack); }
  server.close();
  console.log('\n' + (failures ? '  ✗ ' + failures + ' of ' + checks + ' checks FAILED' : '  mention notifications: all ' + checks + ' checks passed'));
  process.exit(failures ? 1 : 0);
})();
