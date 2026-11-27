/* =====================================================================
   Vaultique Boutique Point — /.netlify/functions/health   (build 84)
   ---------------------------------------------------------------------
   Is the website working? Asked after every deploy (tools/live-check.cjs)
   and, from build 89, by an outside monitor every few minutes.

   ANYBODY gets one word and the build, nothing else:

     { "status": "working", "build": 84, "version": "1.54.0",
       "deployChecks": "on", "at": "…" }

     working      this server answers, its service key is set, and the
                  website's database answered just now.
     not working  any of those failed. Which one is for an administrator.
     deployChecks "paused" while VBP_DEPLOY_GATE is set in Netlify, so a
                  deploy that went out without its checks never passes
                  quietly (tools/build-site.cjs, step 6).

   AN ADMINISTRATOR (signed in, the admin's token as Authorization:
   Bearer …, checked by the database's own is_admin) also gets:

     database     answered or not, and in how many milliseconds
     sql          each SQL file the website expects, run or not: the
                  hardening's own record (schema_migrations), and for each
                  file made after it, one column or table that only it
                  makes, asked for with no rows (so nothing is read)
     settings     every Netlify setting the server jobs read: set or not
                  set, and what it is for. NEVER A VALUE.
     payments     online payment on or off, Test or Live, and whether the
                  key that mode needs is in Netlify: "ready" means a
                  customer's payment can actually start
     jobs         when each scheduled job last ran: recorded from build 89

   It reads, and writes nothing. The public answer is kept for 30 seconds,
   so a flood of requests costs the database one read every 30 seconds.
   ===================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const P = require('./_pay');
const { readConfig } = require('./_seo-data');

/* ---- which build this is: assets/version.js, as the admin reads it ---- */
function versionPaths() {
  const out = [];
  const add = (p) => { if (p && out.indexOf(p) < 0) out.push(p); };
  add(path.join(process.cwd(), 'assets', 'version.js'));
  let dir = __dirname;
  for (let i = 0; i < 6 && dir; i++) {
    add(path.join(dir, 'assets', 'version.js'));
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return out;
}
let VERSION = null;
function version() {
  if (VERSION) return VERSION;
  VERSION = { build: null, version: null };
  for (const p of versionPaths()) {
    try {
      const src = fs.readFileSync(p, 'utf8');
      const b = /\bbuild\s*:\s*(\d+)/.exec(src);
      const v = /\bversion\s*:\s*['"]([0-9][0-9.]*)['"]/.exec(src);
      VERSION = { build: b ? Number(b[1]) : null, version: v ? v[1] : null };
      break;
    } catch (e) { /* the next place */ }
  }
  return VERSION;
}

function deployChecks() {
  const v = String(process.env.VBP_DEPLOY_GATE || '').trim();
  return /^(paused|pause|off|no|false|0)$/i.test(v) ? 'paused' : 'on';
}

/* ---- the database: one read, with the service key ---------------------- */
async function askDatabase() {
  if (!P.serviceKey()) return { answered: false, why: 'no service key in Netlify' };
  const t0 = Date.now();
  try {
    const got = await P.svc('GET', 'schema_migrations?select=version,applied_at&order=version.asc');
    return { answered: true, ms: Date.now() - t0, record: Array.isArray(got) ? got : [] };
  } catch (e) {
    const m = /database: (\d{3})/.exec(String(e && e.message));
    /* Answered, but has no record of runs: the hardening has not been run. */
    if (m && (m[1] === '404' || m[1] === '400')) return { answered: true, ms: Date.now() - t0, record: [] };
    return { answered: false, ms: Date.now() - t0, why: m ? 'the database answered ' + m[1] : 'the database could not be reached' };
  }
}

let PUBLIC = null, PUBLIC_AT = 0;
async function publicAnswer() {
  if (PUBLIC && Date.now() - PUBLIC_AT < 30000) return PUBLIC;
  const db = await askDatabase();
  const v = version();
  PUBLIC = {
    status: db.answered ? 'working' : 'not working',
    build: v.build, version: v.version,
    deployChecks: deployChecks(),
    at: new Date().toISOString(),
  };
  PUBLIC_AT = Date.now();
  return { answer: PUBLIC, db };
}

/* ---- the SQL files, each by something only it makes -------------------- */
const LATER = [
  { file: 'supabase-pos-orders.sql',       build: 80, what: 'the platform\'s till door',  probe: 'orders?select=pos_claim_id&limit=0' },
  { file: 'supabase-payment-history.sql',  build: 80, what: 'the payment history',        probe: 'payment_events?select=*&limit=0' },
  { file: 'supabase-order-progress.sql',   build: 80, what: 'an order\'s progress',       probe: 'orders?select=auto_deliver_at&limit=0' },
  { file: 'supabase-online-refund.sql',    build: 81, what: 'online refunds',             probe: 'refunds?select=*&limit=0' },
  { file: 'supabase-chat-reply-push.sql',  build: 83, what: 'telling a customer the shop has replied', probe: 'chat_reply_push?select=*&limit=0' },
  /* A function only it makes, asked about an order nobody has: it reads nothing. */
  { file: 'supabase-test-orders.sql',      build: 85, what: 'a test payment is never rung up',
    probe: 'rpc/pos_test_payment?p_id=00000000-0000-0000-0000-000000000000' },
  { file: 'supabase-customer-requests.sql', build: 87, what: 'customers\' requests (cancel, return, exchange, a problem)',
    probe: 'order_requests?select=id&limit=0' },
];
async function probe(q) {
  try { await P.svc('GET', q); return true; } catch (e) {
    const m = /database: (\d{3})/.exec(String(e && e.message));
    return m && (m[1] === '400' || m[1] === '404') ? false : null;
  }
}
async function sqlFiles(db) {
  const versions = (db.record || []).map((r) => String(r.version || ''));
  const out = [{
    file: 'supabase-hardening.sql', build: 83, what: 'the security hardening and the record of runs',
    run: db.answered ? versions.some((v) => /hardening/.test(v)) : null,
    when: ((db.record || []).filter((r) => /hardening/.test(String(r.version))).pop() || {}).applied_at || null,
  }];
  for (const f of LATER) {
    out.push({ file: f.file, build: f.build, what: f.what, run: db.answered ? await probe(f.probe) : null });
  }
  return out;
}

/* ---- every setting the server jobs read: set or not, never the value ---- */
const has = (n) => !!String(process.env[n] || '').trim();
function settingsList() {
  const cfg = readConfig() || {};
  const list = [
    { name: 'config.js (the website\'s Supabase address and public key)', set: !!(cfg.url && cfg.key), for: 'everything', needed: true },
    { name: 'SUPABASE_SERVICE_ROLE_KEY', set: !!P.serviceKey(), for: 'orders, payments, refunds, email', needed: true,
      also: 'or WEB_SUPABASE_SERVICE_KEY' },
    { name: 'FLW_SECRET_KEY_TEST', set: has('FLW_SECRET_KEY_TEST'), for: 'online payment in Test mode' },
    { name: 'FLW_SECRET_KEY_LIVE', set: has('FLW_SECRET_KEY_LIVE'), for: 'online payment in Live mode' },
    { name: 'FLW_WEBHOOK_HASH', set: has('FLW_WEBHOOK_HASH'), for: 'Flutterwave telling the site a payment went through' },
    { name: 'POS_REWARDS_KEY', set: has('POS_REWARDS_KEY'), for: 'rewards points from the platform' },
    { name: 'POS_SUPABASE_URL', set: has('POS_SUPABASE_URL'), for: 'the platform\'s address (built in when not set)' },
    { name: 'POS_PUBLIC_KEY', set: has('POS_PUBLIC_KEY'), for: 'the platform\'s public key (built in when not set)' },
    { name: 'VBP_DEPLOY_GATE', set: has('VBP_DEPLOY_GATE'), for: 'set only to pause the checks before a deploy',
      mustNot: true },
  ];
  /* The platform's SECRET key: a deploy stops while it is there
     (tools/build-site.cjs, step 5), so set means something is wrong. */
  if (has('POS_SUPABASE_KEY')) list.push({ name: 'POS_SUPABASE_KEY', set: true, for: 'nothing: it should be deleted', mustNot: true });
  return list;
}

async function payments() {
  let s = null;
  try { s = await P.shopSettings(); } catch (e) { s = null; }
  if (!s) return { known: false };
  const mode = s.pay.onlineMode === 'live' ? 'live' : 'test';
  const on = P.onlineOn(s);
  const key = !!P.flwKey(mode);
  return {
    known: true, online: on, mode, keyForMode: key, webhookHash: has('FLW_WEBHOOK_HASH'),
    ready: on && key && !!P.serviceKey(),
  };
}

exports.handler = async function (event) {
  if (event.httpMethod && event.httpMethod !== 'GET') return P.json(405, { error: 'GET only.' });
  const h = event.headers || {};
  const token = String(h.authorization || h.Authorization || '').replace(/^Bearer\s+/i, '').trim();

  if (!token) {
    const r = await publicAnswer();
    return P.json(200, r.answer || r);
  }
  if (!(await P.callerIsAdmin(token))) return P.json(403, { error: 'Administrators only.' });

  const db = await askDatabase();
  const v = version();
  return P.json(200, {
    status: db.answered ? 'working' : 'not working',
    build: v.build, version: v.version,
    deployChecks: deployChecks(),
    at: new Date().toISOString(),
    database: { answered: db.answered, ms: db.ms == null ? null : db.ms, why: db.why || null },
    sql: await sqlFiles(db),
    settings: settingsList(),
    payments: await payments(),
    jobs: 'recorded from build 89',
  });
};

/* For the tests: forget the 30-second answer and the version read. */
exports._reset = function () { PUBLIC = null; PUBLIC_AT = 0; VERSION = null; };
