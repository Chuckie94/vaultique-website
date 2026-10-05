/* ===========================================================================
   WHEN A PIECE SOLD OUT -- netlify/functions/_sold-out.js
   The feed notes the day it first sees a piece sold out, removes the note
   when it is back, and never holds up or breaks the feed.
   =========================================================================== */
const path = require('path');
process.env.WEB_SUPABASE_URL = 'https://site.test';
process.env.WEB_SUPABASE_ANON_KEY = 'anon';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
let checks = 0, failures = 0;
const is = (c, m, x) => { checks++; if (c) console.log('  ✓ ' + m); else { failures++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); } };

let TABLE = {}; let mode = 'ok'; let calls = 0;
global.fetch = async (url, o = {}) => {
  calls++;
  const u = new URL(url); const m = o.method || 'GET';
  const ok = (d, st = 200) => ({ ok: st < 300, status: st, json: async () => d, text: async () => (d == null ? '' : JSON.stringify(d)) });
  if (mode === 'missing') return ok({ message: 'relation "sold_out_since" does not exist' }, 404);
  if (mode === 'slow') await new Promise((r) => setTimeout(r, 4000));
  if (m === 'GET') return ok(Object.keys(TABLE).map((sku) => ({ sku, since: TABLE[sku] })));
  if (m === 'POST') { JSON.parse(o.body).forEach((r) => { if (!TABLE[r.sku]) TABLE[r.sku] = r.since; }); return ok(null, 201); }
  if (m === 'DELETE') { const list = decodeURIComponent(u.search).match(/in\.\((.*)\)/)[1].split(',').map((x) => x.replace(/"/g, '')); list.forEach((s) => delete TABLE[s]); return ok(null, 204); }
};
const S = require(path.resolve(__dirname, '../netlify/functions/_sold-out.js'));
const feed = (bk, gr) => [{ sku: 'BK', available: bk }, { sku: 'GR', available: gr }];

(async () => {
  let out = await S.stampSoldOut(feed(false, true));
  is(TABLE.BK && !TABLE.GR, 'the first time a piece is seen sold out, the day is noted', JSON.stringify(TABLE));
  is(out[0].soldOutSince === TABLE.BK && out[1].soldOutSince === undefined, 'and the feed carries it on that piece only');
  const first = TABLE.BK;
  S.forget(); TABLE.BK = '2026-01-01T00:00:00.000Z';
  out = await S.stampSoldOut(feed(false, true));
  is(out[0].soldOutSince === '2026-01-01T00:00:00.000Z', 'a piece still sold out keeps the day it first sold out', out[0].soldOutSince + ' / ' + first);
  S.forget();
  out = await S.stampSoldOut(feed(true, true));
  is(!TABLE.BK && out[0].soldOutSince === undefined, 'back in stock: the note is removed');
  S.forget(); mode = 'missing';
  out = await S.stampSoldOut(feed(false, true));
  is(out.length === 2 && out[0].available === false, 'before the SQL is run, the feed goes out untouched');
  S.forget(); mode = 'slow';
  const t = Date.now(); out = await S.stampSoldOut(feed(false, true));
  is(Date.now() - t < 2500 && out.length === 2, 'a slow database never holds the feed up more than a moment', (Date.now() - t) + 'ms');
  mode = 'ok'; delete process.env.SUPABASE_SERVICE_ROLE_KEY; S.forget(); calls = 0;
  out = await S.stampSoldOut(feed(false, true));
  is(calls === 0 && out.length === 2, 'without the service key nothing is asked at all');
  console.log(failures ? '\n  ✗ ' + failures + ' of ' + checks + ' checks FAILED' : '\n  sold out since: all ' + checks + ' checks passed');
  process.exit(failures ? 1 : 0);
})();
