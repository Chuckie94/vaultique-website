/* ===========================================================================
   VAULTIQUE REWARDS THROUGH THE PLATFORM'S REWARDS DOOR -- build 68

   The platform's build 469 put a door in its database that answers the two
   questions the rewards ask (one customer's points, and the email to send a
   code to) and nothing else, to a caller holding the door's own key. This
   checks the website's side of it, run as Netlify runs it:

     A. the door is asked, the right way: with the public key and the door's
        key, never the secret key, and the business is never read whole;
     B. linking: the code goes to the email the door gives, and every case a
        number can be in still gets the same answer;
     C. a quote and a promise use the door's figures, and come out the same;
     D. no old way any more (build 77): with the door not answering, the
        rewards say they cannot be reached, even while the secret key is
        still set, and the business is never read whole instead;
     E. /api/rewards-check says whether the door is in use, and nothing else;
     F. no key and no customer detail ever leaves in an answer.

   THE DOOR'S ANSWERS BELOW WERE NOT WRITTEN BY HAND. They are what the real
   door SQL (the platform's tools/vbp-rewards-door.sql) answered on a stand-in
   database holding the shop below, recorded word for word. The website's
   own formula, run on the same shop (the old way, until build 76), is the
   yardstick: both must say the same thing.
   =========================================================================== */
const path = require('path');
process.env.WEB_SUPABASE_URL = 'https://site.test';
process.env.WEB_SUPABASE_ANON_KEY = 'anon';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'site-service';
process.env.POS_SUPABASE_URL = 'https://platform.test';
const SECRET = 'sb_secret_platform_whole_business';
const DOORKEY = 'd00rk3yd00rk3yd00rk3yd00rk3yd00rk3yd00rk3yd00rk3yd00rk3yd00rk3y0';
const PUBLIC = 'sb_publishable_wj1gGEwOnLu_HlBRkbeZvA_tCHEk1vR';

let checks = 0, failures = 0;
const is = (c, m, x) => { checks++; if (c) console.log('  ✓ ' + m); else { failures++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); } };

/* ---- the shop, on the platform */
const SHOP = {
 "customers": [
  {
   "id": 7,
   "custNo": "VB-0007",
   "name": "Customer Seven",
   "phone": "0970000007",
   "email": "seven@example.com",
   "welcomePoints": 500
  },
  {
   "id": "c8",
   "custNo": "VB-0008",
   "name": "Customer Eight",
   "welcomePoints": 500
  },
  {
   "id": 9,
   "custNo": "VB-0009",
   "name": "Twin One",
   "email": "one@example.com"
  },
  {
   "id": 10,
   "custNo": "vb0009",
   "name": "Twin Two"
  },
  {
   "id": 1,
   "custNo": "VB-0001",
   "name": "Walk-in Customer",
   "type": "Walk-in"
  },
  {
   "id": 12,
   "custNo": "VB-0012",
   "name": "Customer Twelve",
   "email": "  twelve@example.com ",
   "welcomePoints": "500"
  }
 ],
 "sales": [
  {
   "id": 1,
   "customerId": 7,
   "total": 1000,
   "pointsRate": 100,
   "amountPaid": 1000
  },
  {
   "id": 2,
   "customerId": "7",
   "total": 1000,
   "pointsRate": 100,
   "amountPaid": 1000,
   "pointsRedeemed": 20000
  },
  {
   "id": 3,
   "customerId": 7,
   "total": 900,
   "pointsRate": 100,
   "voided": true
  },
  {
   "id": 4,
   "customerId": 7,
   "total": 250
  },
  {
   "id": 5,
   "customerId": "c8",
   "total": 500,
   "pointsRate": 100,
   "amountPaid": 100
  },
  {
   "id": 6,
   "customerId": 12,
   "total": 1234.56,
   "pointsRate": 100
  }
 ],
 "returns": [
  {
   "id": "r1",
   "saleId": 2,
   "total": 300
  }
 ],
 "settings": {
  "legalName": "Vaultique",
  "smtpPassword": "never",
  "rewardsPointsPerK1": 100,
  "rewardsWelcomePoints": 500,
  "rewardsMilestonePoints": 100000,
  "rewardsMilestoneValue": 50
 }
};
/* ---- what the real door SQL answered for it, by customer number */
const GOLDEN = {
 "VB0007": {
  "points": {
   "v": 1,
   "ok": true,
   "door": "vbp_website_rewards",
   "found": true,
   "points": 150502,
   "settings": {
    "rewardsPointsPerK1": 100,
    "rewardsWelcomePoints": 500,
    "rewardsMilestoneValue": 50,
    "rewardsMilestonePoints": 100000
   }
  },
  "email": {
   "v": 1,
   "ok": true,
   "door": "vbp_website_rewards_email",
   "email": "seven@example.com",
   "found": true
  }
 },
 "VB0008": {
  "points": {
   "v": 1,
   "ok": true,
   "door": "vbp_website_rewards",
   "found": true,
   "points": 500,
   "settings": {
    "rewardsPointsPerK1": 100,
    "rewardsWelcomePoints": 500,
    "rewardsMilestoneValue": 50,
    "rewardsMilestonePoints": 100000
   }
  },
  "email": {
   "v": 1,
   "ok": true,
   "door": "vbp_website_rewards_email",
   "email": null,
   "found": true
  }
 },
 "VB0009": {
  "points": {
   "v": 1,
   "ok": true,
   "door": "vbp_website_rewards",
   "found": false
  },
  "email": {
   "v": 1,
   "ok": true,
   "door": "vbp_website_rewards_email",
   "email": null,
   "found": false
  }
 },
 "VB0001": {
  "points": {
   "v": 1,
   "ok": true,
   "door": "vbp_website_rewards",
   "found": false
  },
  "email": {
   "v": 1,
   "ok": true,
   "door": "vbp_website_rewards_email",
   "email": null,
   "found": false
  }
 },
 "VB0012": {
  "points": {
   "v": 1,
   "ok": true,
   "door": "vbp_website_rewards",
   "found": true,
   "points": 123900,
   "settings": {
    "rewardsPointsPerK1": 100,
    "rewardsWelcomePoints": 500,
    "rewardsMilestoneValue": 50,
    "rewardsMilestonePoints": 100000
   }
  },
  "email": {
   "v": 1,
   "ok": true,
   "door": "vbp_website_rewards_email",
   "email": "twelve@example.com",
   "found": true
  }
 },
 "VB0404": {
  "points": {
   "v": 1,
   "ok": true,
   "door": "vbp_website_rewards",
   "found": false
  },
  "email": {
   "v": 1,
   "ok": true,
   "door": "vbp_website_rewards_email",
   "email": null,
   "found": false
  }
 }
};
const REFUSED = {"v": 1, "ok": false, "why": "refused", "door": "vbp_website_rewards"};
const EMPTY = {"n": "", "points": {"v": 1, "ok": true, "door": "vbp_website_rewards", "found": false}, "email": {"v": 1, "ok": true, "door": "vbp_website_rewards_email", "email": null, "found": false}};

/* ---- how the platform behaves in each case */
let door = 'ok';          // ok | missing | refused | unreadable | busy | busy-email | shape
const PLATFORM = [];      // every request that reached the platform
const key = (v) => String(v == null ? '' : v).toUpperCase().replace(/[^0-9A-Z]/g, '');

/* ---- the website's database, as tables in memory */
let DB;
const fresh = () => { DB = { rewards_links: [], rewards_codes: [], rewards_requests: [], rewards_holds: [], site_settings_private: [{ key: 'notifications', data: { smtpPassword: 'x' } }] }; };
fresh();
const USERS = { 'tok-seven': { id: 'u-seven', email: 'seven.web@example.com' }, 'tok-eight': { id: 'u-eight', email: 'eight@example.com' },
                'tok-other': { id: 'u-other', email: 'other@example.com' }, 'tok-twelve': { id: 'u-twelve', email: 'tw@example.com' } };
const SENT = [];

function match(row, q) {
  for (const [k, v] of q) {
    if (['select', 'on_conflict'].includes(k)) continue;
    const [op, ...rest] = v.split('.'); const val = rest.join('.');
    if (op === 'eq' && String(row[k]) !== val) return false;
    if (op === 'gt' && !(String(row[k]) > val)) return false;
  }
  return true;
}
global.fetch = async (url, opts = {}) => {
  const u = new URL(url);
  const ok = (data, status = 200) => ({ ok: status < 300, status, json: async () => data, text: async () => JSON.stringify(data) });
  if (u.host === 'platform.test') {
    PLATFORM.push({ path: u.pathname, search: u.search, method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body || '' });
    if (u.pathname.startsWith('/rest/v1/rpc/')) {
      const fn = u.pathname.replace('/rest/v1/rpc/', '');
      if (door === 'missing') return ok({ message: 'Could not find the function' }, 404);
      /* Not the door's answer, though it looks like one: no door name, no
         version. Believed, it would show this number. */
      if (door === 'shape') return ok({ ok: true, found: true, points: 999999, settings: {} });
      const b = JSON.parse(opts.body || '{}');
      if (b.p_key !== DOORKEY || door === 'refused') return ok(Object.assign({}, REFUSED, { door: fn }));
      if (door === 'unreadable') return ok({ door: fn, v: 1, ok: false, why: 'unreadable' });
      if (door === 'busy' || (door === 'busy-email' && fn === 'vbp_website_rewards_email')) return ok({ door: fn, v: 1, ok: false, why: 'busy' });
      const k = key(b.p_number);
      if (k.length < 3 || k.length > 24) return ok(fn === 'vbp_website_rewards' ? EMPTY.points : EMPTY.email);
      const g = GOLDEN[k];
      if (fn === 'vbp_website_rewards') return ok(g ? g.points : { door: fn, v: 1, ok: true, found: false });
      if (fn === 'vbp_website_rewards_email') return ok(g ? g.email : { door: fn, v: 1, ok: true, found: false, email: null });
      return ok({ message: 'no such function' }, 404);
    }
    if (u.pathname === '/rest/v1/app_state') {
      const auth = String((opts.headers || {}).Authorization || '');
      return ok(auth === 'Bearer ' + SECRET ? [{ id: 100, data: SHOP }] : []);
    }
    return ok({ message: 'nothing here' }, 404);
  }
  if (u.pathname === '/auth/v1/user') {
    const t = String(opts.headers.Authorization || '').replace('Bearer ', '');
    return USERS[t] ? ok(USERS[t]) : ok({ msg: 'bad' }, 401);
  }
  const table = u.pathname.replace('/rest/v1/', '');
  if (table === 'site_settings') {
    const k = (u.searchParams.get('key') || '').replace('eq.', '');
    if (k === 'notifications') return ok([{ data: { emailEnabled: true, smtpHost: 'smtp.test', senderEmail: 'shop@test' } }]);
    return ok([]);
  }
  const rows = DB[table]; if (!rows) return ok({ message: 'no table ' + table }, 404);
  const q = [...u.searchParams.entries()];
  const m = opts.method || 'GET';
  if (m === 'GET') return ok(rows.filter((r) => match(r, q)));
  if (m === 'POST') {
    const row = JSON.parse(opts.body);
    if (table === 'rewards_links' && rows.some((r) => r.cust_no === row.cust_no || r.user_id === row.user_id)) return ok({ code: '23505', message: 'duplicate' }, 409);
    if (table === 'rewards_holds' && rows.some((r) => r.order_ref === row.order_ref)) return ok({ code: '23505' }, 409);
    if (table === 'rewards_requests' && rows.some((r) => r.user_id === row.user_id && r.kind === row.kind && r.status === 'waiting')) return ok({ code: '23505' }, 409);
    if (u.searchParams.get('on_conflict') === 'user_id') { const i = rows.findIndex((r) => r.user_id === row.user_id); if (i > -1) rows.splice(i, 1); }
    const dflt = table === 'rewards_holds' ? { status: 'promised' } : table === 'rewards_requests' ? { status: 'waiting' } : {};
    rows.push(Object.assign(dflt, row));
    return ok(null, 201);
  }
  if (m === 'PATCH') {
    const hit = rows.filter((r) => match(r, q));
    hit.forEach((r) => Object.assign(r, JSON.parse(opts.body)));
    /* The changed rows, when asked for: how a conditional update tells
       its caller whether it won (rewards verify, build 77). */
    return /return=representation/.test((opts.headers || {}).Prefer || '') ? ok(hit.map((r) => Object.assign({}, r))) : ok(null, 204);
  }
  if (m === 'DELETE') { DB[table] = rows.filter((r) => !match(r, q)); return ok(null, 204); }
};
require.cache[require.resolve(path.resolve(__dirname, '../netlify/functions/send-email.js'))] = {
  exports: { _internals: { sendMail: async (m) => { SENT.push(m); } } }
};
const fn = require(path.resolve(__dirname, '../netlify/functions/rewards.js'));
const check = require(path.resolve(__dirname, '../netlify/functions/rewards-check.js'));
const R = require(path.resolve(__dirname, '../netlify/functions/_rewards.js'));
const call = async (token, body) => {
  R.forget();
  const r = await fn.handler({ httpMethod: 'POST', headers: token ? { authorization: 'Bearer ' + token } : {}, body: JSON.stringify(body) });
  return { status: r.statusCode, body: JSON.parse(r.body), raw: r.body };
};
const askCheck = async () => { const r = await check.handler({ httpMethod: 'GET', headers: {} }); return { status: r.statusCode, body: JSON.parse(r.body), raw: r.body }; };
const setKeys = (doorKey, secret) => {
  if (doorKey) process.env.POS_REWARDS_KEY = doorKey; else delete process.env.POS_REWARDS_KEY;
  if (secret) process.env.POS_SUPABASE_KEY = secret; else delete process.env.POS_SUPABASE_KEY;
};
const link = (user, no) => { DB.rewards_links.push({ user_id: user, cust_no: key(no), how: 'code' }); };
const reads = () => PLATFORM.filter((p) => p.path === '/rest/v1/app_state').length;
const asked = (f) => PLATFORM.filter((p) => p.path === '/rest/v1/rpc/' + f);
const ANSWERS = [];
const said = (r) => { ANSWERS.push(r.raw); return r; };
/* What the old way says for the same shop: the yardstick. */
const oldStanding = (no, promised) => R.standing(SHOP, R.customerByNumber(SHOP, no), promised || 0);

(async () => {
  console.log('\nA · The door, asked the right way');
  setKeys(DOORKEY, SECRET); door = 'ok'; fresh(); link('u-seven', 'VB-0007'); PLATFORM.length = 0;
  let r = said(await call('tok-seven', { action: 'status' }));
  const want = Object.assign({ linked: true, number: 'VB0007' }, oldStanding('VB-0007'));
  is(r.status === 200 && JSON.stringify(r.body) === JSON.stringify(want),
     'the points, their worth and the milestone come from the door, exactly as the old way works them out', JSON.stringify(r.body) + ' / ' + JSON.stringify(want));
  is(r.body.points === 150502 && r.body.worth === 75.25 && r.body.milestone.reached === 1, 'with the figures the door gave: 150,502 points, worth K75.25');
  const q1 = asked('vbp_website_rewards')[0] || { headers: {}, body: '{}' };
  is(asked('vbp_website_rewards').length === 1 && q1.method === 'POST', 'one question to the points door', JSON.stringify(PLATFORM.map((p) => p.path)));
  is(q1.headers.apikey === PUBLIC && q1.headers.Authorization === 'Bearer ' + PUBLIC, 'asked with the public key');
  const b1 = JSON.parse(q1.body);
  is(b1.p_key === DOORKEY && key(b1.p_number) === 'VB0007' && Object.keys(b1).sort().join() === 'p_key,p_number',
     'carrying the door\'s key and the customer number, and nothing else', q1.body);
  is(reads() === 0 && !PLATFORM.some((p) => JSON.stringify(p).includes(SECRET)),
     'the business is never read whole, and the secret key is never sent', JSON.stringify(PLATFORM).slice(0, 200));
  fresh(); link('u-other', 'VB-0009'); PLATFORM.length = 0;
  r = said(await call('tok-other', { action: 'status' }));
  const oldMissing = R.customerByNumber(SHOP, 'VB-0009') === null;
  is(oldMissing && JSON.stringify(r.body) === JSON.stringify({ linked: true, number: 'VB0009', missing: true }) && reads() === 0,
     'a linked number the door cannot find (on two records) says so, as the old way did', r.raw);

  console.log('\nB · Linking with the code, through the email door');
  fresh(); SENT.length = 0; PLATFORM.length = 0;
  r = said(await call('tok-seven', { action: 'link', number: 'vb 0007' }));
  is(r.status === 200 && SENT.length === 1 && SENT[0].to === 'seven@example.com', 'the code goes to the email the door gave', JSON.stringify(SENT.map((m) => m.to)));
  const answerReal = r.body.message;
  is(!/@/.test(r.raw), 'and the answer shows no email, not even part of one', r.raw);
  is(asked('vbp_website_rewards_email').length === 1 && reads() === 0, 'one question to the email door, and the business is not read');
  const code = (/\b(\d{6})\b/.exec(SENT[0].text) || [])[1];
  r = said(await call('tok-seven', { action: 'verify', code }));
  is(r.status === 200 && DB.rewards_links.length === 1 && DB.rewards_links[0].cust_no === 'VB0007', 'the right code links the account');
  SENT.length = 0;
  for (const [tok, num] of [['tok-eight', 'VB-0008'], ['tok-other', 'VB-0009'], ['tok-twelve', 'VB-0001'], ['tok-twelve', 'VB-4242']]) {
    DB.rewards_codes = []; DB.rewards_requests = [];
    r = said(await call(tok, { action: 'link', number: num }));
    is(r.status === 200 && r.body.message === answerReal, num + ': exactly the same answer as a real number');
  }
  is(SENT.length === 0, 'no code is sent for a number with no email, on two records, the walk-in, or made up');
  DB.rewards_requests = []; DB.rewards_codes = [];
  await call('tok-eight', { action: 'link', number: 'VB-0008' });
  await call('tok-other', { action: 'link', number: 'VB-0009' });
  const notes = DB.rewards_requests.map((q) => q.note || '');
  is(/no email/.test(notes[0]) && /not on exactly one/.test(notes[1]), 'and the team is told why, each case its own reason', JSON.stringify(notes));
  DB.rewards_requests = []; DB.rewards_codes = []; PLATFORM.length = 0;
  r = said(await call('tok-other', { action: 'link', number: 'VB-0007' }));
  is(asked('vbp_website_rewards_email').length === 0 && /already linked/.test((DB.rewards_requests[0] || {}).note || ''),
     'a number already linked to another account: its email is not even asked for', JSON.stringify(DB.rewards_requests));
  DB.rewards_requests = []; DB.rewards_codes = []; door = 'busy-email'; PLATFORM.length = 0; SENT.length = 0;
  r = said(await call('tok-twelve', { action: 'link', number: 'VB-0012' }));
  is(r.body.message === answerReal && SENT.length === 0 && /as many emails/.test((DB.rewards_requests[0] || {}).note || '') && reads() === 0,
     'the email door busy: no code, the team is told, the same answer, and the business is not read the old way instead',
     JSON.stringify(DB.rewards_requests) + ' reads=' + reads());
  door = 'ok';

  console.log('\nC · A quote and a promise, with the door\'s figures');
  fresh(); link('u-seven', 'VB-0007'); PLATFORM.length = 0;
  r = said(await call('tok-seven', { action: 'quote', due: 100 }));
  const wantQ = R.redeemQuote(oldStanding('VB-0007').points, 100, SHOP.settings);
  is(r.status === 200 && JSON.stringify(r.body.quote) === JSON.stringify(wantQ) && r.body.quote.value === 75.25,
     'what the points take off K100: the same as the old way', JSON.stringify(r.body) + ' / ' + JSON.stringify(wantQ));
  r = said(await call('tok-seven', { action: 'hold', orderRef: 'WEB-1001', due: 100 }));
  is(r.status === 200 && DB.rewards_holds.length === 1 && DB.rewards_holds[0].points === wantQ.points, 'promised on the order');
  r = said(await call('tok-seven', { action: 'status' }));
  is(r.body.points === 150502 - wantQ.points && JSON.stringify(r.body) === JSON.stringify(Object.assign({ linked: true, number: 'VB0007' }, oldStanding('VB-0007', wantQ.points))),
     'and the balance shows them as promised, as the old way would', JSON.stringify(r.body));
  is(reads() === 0, 'still without reading the business');

  console.log('\nD · No old way any more (build 77)');
  const before = JSON.stringify(Object.assign({ linked: true, number: 'VB0007' }, oldStanding('VB-0007')));
  for (const [what, keys, mode] of [
    ['no door key yet', [null, SECRET], 'ok'],
    ['the door not in the platform yet', [DOORKEY, SECRET], 'missing'],
    ['the door refusing the key', [DOORKEY, SECRET], 'refused'],
    ['the door unable to read', [DOORKEY, SECRET], 'unreadable'],
    ['an answer of another shape', [DOORKEY, SECRET], 'shape']]) {
    setKeys(keys[0], keys[1]); door = mode; fresh(); link('u-seven', 'VB-0007'); PLATFORM.length = 0;
    r = said(await call('tok-seven', { action: 'status' }));
    is(r.body.unavailable === true && reads() === 0 && !PLATFORM.some((p) => JSON.stringify(p).includes(SECRET)),
       what + ', the secret key still set: unavailable, and the business is not read with it', JSON.stringify(r.body));
  }
  setKeys(null, SECRET); door = 'ok'; fresh(); SENT.length = 0; PLATFORM.length = 0;
  r = said(await call('tok-seven', { action: 'link', number: 'VB-0007' }));
  is(SENT.length === 0 && reads() === 0 && PLATFORM.length === 0,
     'nor is an email looked up the old way to link with: no code goes out', JSON.stringify(r.body) + ' sent=' + SENT.length);
  setKeys(DOORKEY, SECRET); door = 'busy'; fresh(); link('u-seven', 'VB-0007'); PLATFORM.length = 0;
  r = said(await call('tok-seven', { action: 'status' }));
  is(r.body.unavailable === true && reads() === 0, 'the door busy: "cannot be reached just now", and never the whole business instead', JSON.stringify(r.body));
  r = said(await call('tok-seven', { action: 'quote', due: 100 }));
  is(r.status === 500 && reads() === 0, 'nor for a quote');
  for (const mode of ['missing', 'refused', 'unreadable', 'shape']) {
    setKeys(DOORKEY, null); door = mode; fresh(); link('u-seven', 'VB-0007'); PLATFORM.length = 0;
    r = said(await call('tok-seven', { action: 'status' }));
    is(r.body.unavailable === true && reads() === 0, 'the secret key deleted, the door ' + mode + ': unavailable, and nothing is read the old way', JSON.stringify(r.body));
  }
  setKeys(null, null); door = 'ok'; fresh(); link('u-seven', 'VB-0007'); PLATFORM.length = 0;
  r = said(await call('tok-seven', { action: 'status' }));
  is(r.body.unavailable === true && PLATFORM.length === 0, 'neither key: unavailable, and the platform is not asked at all');
  setKeys(DOORKEY, null); door = 'ok'; fresh(); link('u-seven', 'VB-0007'); PLATFORM.length = 0;
  r = said(await call('tok-seven', { action: 'status' }));
  is(JSON.stringify(r.body) === before && reads() === 0, 'the secret key deleted and the door working: everything still works');

  console.log('\nE · /api/rewards-check');
  setKeys(DOORKEY, SECRET); door = 'ok'; PLATFORM.length = 0;
  let c = said(await askCheck());
  is(c.status === 200 && c.body.source === 'door' && c.body.secretKeyStillSet === true && /delete POS_SUPABASE_KEY/i.test(c.body.next),
     'door working, secret key still set: "door", and that the secret key can now go', c.raw);
  const cq = JSON.parse((asked('vbp_website_rewards')[0] || {}).body || '{}');
  is(cq.p_number === '' && asked('vbp_website_rewards').length === 1 && reads() === 0,
     'it asks the door with a number nobody could have, which the door does not count', JSON.stringify(cq));
  setKeys(DOORKEY, null);
  c = said(await askCheck());
  is(c.body.source === 'door' && c.body.secretKeyStillSet === false, 'and once it is gone: "door", nothing more to do', c.raw);
  setKeys(DOORKEY, SECRET); door = 'missing';
  c = said(await askCheck());
  is(c.body.source === 'none' && /SQL has not been run/.test(c.body.why) && reads() === 0,
     'the SQL not run yet: "none" (there is no old way to fall back on), and why', c.raw);
  door = 'refused';
  c = said(await askCheck());
  is(c.body.source === 'none' && /refused POS_REWARDS_KEY/.test(c.body.why), 'a wrong key in Netlify: said plainly', c.raw);
  setKeys(null, null); door = 'ok';
  c = said(await askCheck());
  is(c.body.source === 'none' && c.body.doorKeySet === false, 'neither key: "none"', c.raw);
  const r405 = await check.handler({ httpMethod: 'POST', headers: {} });
  is(r405.statusCode === 405, 'it only answers to being opened (GET)');

  console.log('\nF · Nothing leaks');
  const all = ANSWERS.join('\n');
  is(!all.includes(DOORKEY) && !all.includes(SECRET), 'no answer to a browser ever carries the door\'s key or the secret key');
  is(!/Customer Seven|Twin One|0970000007|seven@example|twelve@example|"id":7/.test(all), 'nor a name, a phone, an email or a platform id', all.slice(0, 300));

  console.log(`\n  rewards door: ${failures ? failures + ' of ' + checks + ' checks FAILED' : 'all ' + checks + ' checks passed'}`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('  ✗ ' + (e && e.stack || e)); process.exit(1); });
