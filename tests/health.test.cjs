/* ===========================================================================
   THE HEALTH CHECK (website build 84) · netlify/functions/health.js

   Run as Netlify runs it, against a stand-in for the website's Supabase:

     1. anybody gets one word, the build and whether the deploy checks are
        on, and nothing else: no settings, no SQL, no keys;
     2. "not working" when the database does not answer, or there is no
        service key; the public answer is kept 30 seconds, so a flood costs
        one read;
     3. an administrator (the database's is_admin says so) gets the details:
        the database, each SQL file run or not, every setting set or not,
        and whether online payment can really start;
     4. no value of any setting ever appears in any answer;
     5. a paused deploy gate (VBP_DEPLOY_GATE) is said to everybody.
   =========================================================================== */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

let checks = 0, failures = 0;
const ok = (m) => { checks++; console.log('  ✓ ' + m); };
const fail = (m, x) => { checks++; failures++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); };
const is = (c, m, x) => (c ? ok(m) : fail(m, x));

const ROOT = path.resolve(__dirname, '..');
const SENTINELS = ['SENTINEL-SERVICE-KEY-123', 'SENTINEL-FLW-TEST-456', 'SENTINEL-HASH-789',
                   'SENTINEL-REWARDS-000', 'SENTINEL-ANON-111', 'SENTINEL-POS-SECRET-222', 'SENTINEL-FLW-LIVE-333'];

/* ---------------- the stand-in Supabase ---------------- */
let STATE, ASKED;
function reset() {
  STATE = {
    down: false, record: true,
    cols: { pos_claim_id: true, auto_deliver_at: true },
    tables: { payment_events: true, refunds: true, chat_reply_push: false },
    rpc: { pos_test_payment: true },
    payments: { onlineEnabled: true, onlineMode: 'live', onlineCard: true, onlineMobile: true,
      /* build 88: Flutterwave takes payments only once switched on in its own
         setting (flwEnabled), as the shop will once its account is approved */
      flwEnabled: true },
  };
  ASKED = [];
}
reset();

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const key = req.headers.apikey || '';
  ASKED.push({ path: u.pathname, q: u.search, key });
  const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (STATE.down) return send(500, { message: 'down' });
  const table = u.pathname.replace('/rest/v1/', '');
  if (req.method === 'POST' && table === 'rpc/is_admin') {
    return send(200, req.headers.authorization === 'Bearer ADMIN-TOKEN');
  }
  if (table === 'schema_migrations') {
    if (key !== 'SENTINEL-SERVICE-KEY-123') return send(401, { message: 'service key only' });
    return STATE.record ? send(200, [{ version: '083-hardening', applied_at: '2026-11-19T10:00:00Z' }])
                        : send(404, { code: 'PGRST205', message: 'Could not find the table' });
  }
  if (table === 'rpc/pos_test_payment') {
    if (req.method !== 'GET' || u.searchParams.get('p_id') !== '00000000-0000-0000-0000-000000000000') return send(400, { message: 'asked about a real order' });
    return STATE.rpc.pos_test_payment ? send(200, false) : send(404, { code: 'PGRST202', message: 'Could not find the function' });
  }
  if (table === 'orders') {
    const col = u.searchParams.get('select');
    if (u.searchParams.get('limit') !== '0') return send(400, { message: 'rows were asked for' });
    return STATE.cols[col] ? send(200, []) : send(400, { code: '42703', message: 'column does not exist' });
  }
  if (table in STATE.tables) {
    if (u.searchParams.get('limit') !== '0') return send(400, { message: 'rows were asked for' });
    return STATE.tables[table] ? send(200, []) : send(404, { code: 'PGRST205', message: 'Could not find the table' });
  }
  if (table === 'site_settings') {
    const k = (u.searchParams.get('key') || '').replace(/^eq\./, '');
    return send(200, k === 'payments' ? [{ data: STATE.payments }] : []);
  }
  return send(404, { message: 'unknown' });
});

(async function main() {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  Object.assign(process.env, {
    WEB_SUPABASE_URL: base, WEB_SUPABASE_ANON_KEY: 'SENTINEL-ANON-111',
    SUPABASE_SERVICE_ROLE_KEY: 'SENTINEL-SERVICE-KEY-123',
    FLW_SECRET_KEY_TEST: 'SENTINEL-FLW-TEST-456', FLW_WEBHOOK_HASH: 'SENTINEL-HASH-789',
    POS_REWARDS_KEY: 'SENTINEL-REWARDS-000',
  });
  delete process.env.FLW_SECRET_KEY_LIVE;
  delete process.env.VBP_DEPLOY_GATE;
  delete process.env.POS_SUPABASE_KEY;
  const H = require(path.join(ROOT, 'netlify', 'functions', 'health.js'));
  const call = async (token, method) => {
    H._reset();
    const r = await H.handler({ httpMethod: method || 'GET', headers: token ? { authorization: 'Bearer ' + token } : {} });
    let body = null; try { body = JSON.parse(r.body); } catch (e) { body = null; }
    return { code: r.statusCode, body, raw: r.body, headers: r.headers || {} };
  };
  const clean = (raw) => SENTINELS.every((s) => raw.indexOf(s) < 0);
  const ver = fs.readFileSync(path.join(ROOT, 'assets', 'version.js'), 'utf8');
  const BUILD = Number(/\bbuild\s*:\s*(\d+)/.exec(ver)[1]);
  const VERSION = /\bversion\s*:\s*'([0-9.]+)'/.exec(ver)[1];

  console.log('\nAnybody: one word, the build, nothing else');
  let r = await call();
  is(r.code === 200 && r.body && r.body.status === 'working', 'the database answers: "working"', r.raw);
  is(r.body.build === BUILD && r.body.version === VERSION, 'the build and version, from assets/version.js (' + BUILD + ', ' + VERSION + ')', r.raw);
  is(r.body.deployChecks === 'on', 'the deploy checks: on');
  is(Object.keys(r.body).sort().join(',') === 'at,build,deployChecks,status,version',
     'nothing else: no settings, no SQL, no payments, no database details', Object.keys(r.body).join(','));
  is(clean(r.raw), 'no value of any setting in it');
  is(/no-store/.test(r.headers['Cache-Control'] || ''), 'never kept by a browser or the network in between');
  is(ASKED.every((a) => a.path !== '/rest/v1/rpc/is_admin'), 'nobody signed in: the database is not even asked who they are');

  console.log('\nNot working');
  reset(); STATE.down = true;
  r = await call();
  is(r.body.status === 'not working', 'the database does not answer: "not working"', r.raw);
  reset();
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  r = await call();
  is(r.body.status === 'not working', 'no service key in Netlify: "not working"', r.raw);
  is(ASKED.length === 0, 'and the database is not asked without it');
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'SENTINEL-SERVICE-KEY-123';
  reset(); STATE.record = false;
  r = await call();
  is(r.body.status === 'working', 'a database without the hardening\'s record still answers: "working" (the details say what is missing)');

  console.log('\nThe public answer is kept 30 seconds');
  reset(); H._reset();
  await H.handler({ httpMethod: 'GET', headers: {} });
  await H.handler({ httpMethod: 'GET', headers: {} });
  await H.handler({ httpMethod: 'GET', headers: {} });
  is(ASKED.filter((a) => /schema_migrations/.test(a.path)).length === 1, 'three requests, one read of the database',
     ASKED.length + ' reads');

  console.log('\nAn administrator: the details');
  reset();
  r = await call('NOT-AN-ADMIN');
  is(r.code === 403 && !/sql|settings/i.test(r.raw), 'a sign-in the database does not call an administrator: refused, and told nothing', r.raw);
  r = await call('ADMIN-TOKEN');
  const d = r.body || {};
  is(r.code === 200 && d.status === 'working' && d.build === BUILD, 'an administrator: "working", the build', r.raw.slice(0, 200));
  is(d.database && d.database.answered === true && typeof d.database.ms === 'number', 'the database answered, and how fast');
  const sql = {};
  (d.sql || []).forEach((f) => { sql[f.file] = f.run; });
  is(sql['supabase-hardening.sql'] === true, 'the hardening: run (its own record)');
  is(sql['supabase-pos-orders.sql'] === true && sql['supabase-order-progress.sql'] === true &&
     sql['supabase-payment-history.sql'] === true && sql['supabase-online-refund.sql'] === true,
     'builds 80 and 81\'s files: run, each by something only it makes');
  is(sql['supabase-chat-reply-push.sql'] === false, 'build 83\'s reply notifications: not run, said as such');
  is(sql['supabase-test-orders.sql'] === true, 'build 85\'s test payments: run, by asking its function about an order nobody has');
  STATE.rpc.pos_test_payment = false;
  let r85 = await call('ADMIN-TOKEN');
  is((r85.body.sql || []).filter((f) => f.file === 'supabase-test-orders.sql')[0].run === false, 'and not run, said as such');
  STATE.rpc.pos_test_payment = true;
  is(ASKED.filter((a) => /orders|payment_events|refunds|chat_reply_push/.test(a.path)).every((a) => /limit=0/.test(a.q)),
     'every file is asked about with no rows: nothing is read');
  is(ASKED.filter((a) => /schema_migrations|orders|payment_events|refunds|chat_reply_push/.test(a.path))
       .every((a) => a.key === 'SENTINEL-SERVICE-KEY-123'), 'with the service key, never the public one');
  const set = {};
  (d.settings || []).forEach((s) => { set[s.name] = s; });
  is(set.SUPABASE_SERVICE_ROLE_KEY && set.SUPABASE_SERVICE_ROLE_KEY.set === true, 'the service key: set');
  is(set.FLW_SECRET_KEY_TEST.set === true && set.FLW_SECRET_KEY_LIVE.set === false, 'Flutterwave: the Test key set, the Live key not');
  is(set.POS_REWARDS_KEY.set === true && set.VBP_DEPLOY_GATE.set === false, 'the rewards key set; the gate not paused');
  is(!set.POS_SUPABASE_KEY, 'the platform\'s secret key: not listed while it is not there');
  is(d.payments && d.payments.online === true && d.payments.mode === 'live' && d.payments.keyForMode === false &&
     d.payments.ready === false, 'online payment on in Live mode with no Live key: NOT ready (the button would be a dead end)',
     JSON.stringify(d.payments));
  STATE.payments.onlineMode = 'test';
  r = await call('ADMIN-TOKEN');
  is(r.body.payments.ready === true && r.body.payments.keyForMode === true, 'in Test mode, with the Test key: ready');
  STATE.payments.onlineEnabled = false;
  r = await call('ADMIN-TOKEN');
  is(r.body.payments.online === false && r.body.payments.ready === false, 'switched off: not ready');
  is(clean(r.raw), 'no value of any setting in an administrator\'s answer either');
  is(d.jobs === 'recorded from build 94', 'the scheduled jobs: said to come with build 94 (the monitoring build), not guessed');

  console.log('\nThe platform\'s secret key, if it is ever put back');
  process.env.POS_SUPABASE_KEY = 'SENTINEL-POS-SECRET-222';
  process.env.FLW_SECRET_KEY_LIVE = 'SENTINEL-FLW-LIVE-333';
  r = await call('ADMIN-TOKEN');
  const pk = (r.body.settings || []).filter((s) => s.name === 'POS_SUPABASE_KEY')[0];
  is(pk && pk.set === true && pk.mustNot === true, 'listed as set, and as a setting that must not be there');
  is(clean(r.raw), 'its value is not in the answer');
  delete process.env.POS_SUPABASE_KEY;
  delete process.env.FLW_SECRET_KEY_LIVE;

  console.log('\nA paused deploy gate is said to everybody');
  process.env.VBP_DEPLOY_GATE = 'paused';
  r = await call();
  is(r.body.deployChecks === 'paused', 'anybody: deployChecks "paused"');
  r = await call('ADMIN-TOKEN');
  is(r.body.deployChecks === 'paused', 'an administrator: the same');
  delete process.env.VBP_DEPLOY_GATE;

  console.log('\nOnly GET');
  r = await call(null, 'POST');
  is(r.code === 405, 'a POST is refused');

  server.close();
  console.log('\n  health check: ' + (failures ? failures + ' of ' + checks + ' checks FAILED' : 'all ' + checks + ' checks passed'));
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('  ✗ the test itself broke: ' + (e && e.stack || e)); process.exit(1); });
