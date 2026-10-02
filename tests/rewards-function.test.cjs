/* ===========================================================================
   VAULTIQUE REWARDS ON THE WEBSITE -- netlify/functions/rewards.js

   Run as Netlify runs it. The website's database, its sign-in, the platform's
   business record and the email are all answered here. What is checked above
   all: nothing about a customer is said or kept that should not be.
   =========================================================================== */
const path = require('path');
process.env.WEB_SUPABASE_URL = 'https://site.test';
process.env.WEB_SUPABASE_ANON_KEY = 'anon';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'site-service';
process.env.POS_SUPABASE_URL = 'https://platform.test';
process.env.POS_SUPABASE_KEY = 'sb_secret_platform';

let checks = 0, failures = 0;
const is = (c, m, x) => { checks++; if (c) console.log('  ✓ ' + m); else { failures++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); } };

/* ---- the platform: three customers, a sale, the shop's rewards settings */
const PLATFORM = {
  customers: [
    { id: 7, custNo: 'VB-0007', name: 'Chanda Phiri', phone: '0977000007', email: 'chanda@example.com', welcomePoints: 500 },
    { id: 8, custNo: 'VB-0008', name: 'Mwila Banda', phone: '0977000008', welcomePoints: 500 },              // no email
    { id: 9, custNo: 'VB-0009', name: 'Twin A', email: 'a@example.com' }, { id: 10, custNo: 'vb0009', name: 'Twin B' }
  ],
  sales: [{ id: 1, customerId: 7, total: 1000, pointsRate: 100, amountPaid: 1000 }],     // 100,000 earned
  returns: [],
  settings: { rewardsPointsPerK1: 100, rewardsWelcomePoints: 500, rewardsMilestonePoints: 100000, rewardsMilestoneValue: 50 }
};
let platformReads = 0;

/* ---- the website's database, as tables in memory */
const DB = { rewards_links: [], rewards_codes: [], rewards_requests: [], rewards_holds: [], site_settings_private: [{ key: 'notifications', data: { smtpPassword: 'x' } }] };
const USERS = { 'tok-chanda': { id: 'u-chanda', email: 'chanda.web@example.com' }, 'tok-mwila': { id: 'u-mwila', email: 'mw@example.com' },
                'tok-eve': { id: 'u-eve', email: 'eve@example.com' } };
const SENT = [];
const LOG = [];

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
  LOG.push({ url, body: opts.body || '' });
  const u = new URL(url);
  const ok = (data, status = 200) => ({ ok: status < 300, status, json: async () => data, text: async () => JSON.stringify(data) });
  if (u.host === 'platform.test') { platformReads++; return ok([{ id: 100, data: PLATFORM }]); }
  if (u.pathname === '/auth/v1/user') {
    const t = String(opts.headers.Authorization || '').replace('Bearer ', '');
    return USERS[t] ? ok(USERS[t]) : ok({ msg: 'bad' }, 401);
  }
  const table = u.pathname.replace('/rest/v1/', '');
  if (table === 'site_settings') {
    const key = (u.searchParams.get('key') || '').replace('eq.', '');
    if (key === 'notifications') return ok([{ data: { emailEnabled: true, smtpHost: 'smtp.test', senderEmail: 'shop@test' } }]);
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
  if (m === 'PATCH') { rows.filter((r) => match(r, q)).forEach((r) => Object.assign(r, JSON.parse(opts.body))); return ok(null, 204); }
  if (m === 'DELETE') { DB[table] = rows.filter((r) => !match(r, q)); return ok(null, 204); }
};
require.cache[require.resolve(path.resolve(__dirname, '../netlify/functions/send-email.js'))] = {
  exports: { _internals: { sendMail: async (m) => { SENT.push(m); } } }
};
const fn = require(path.resolve(__dirname, '../netlify/functions/rewards.js'));
const R = require(path.resolve(__dirname, '../netlify/functions/_rewards.js'));
const call = async (token, body) => {
  R.forget();
  const r = await fn.handler({ httpMethod: 'POST', headers: token ? { authorization: 'Bearer ' + token } : {}, body: JSON.stringify(body) });
  return { status: r.statusCode, body: JSON.parse(r.body) };
};
const codeIn = (m) => (/\b(\d{6})\b/.exec(m.text) || [])[1];

(async () => {
  console.log('\nWho may ask');
  let r = await call(null, { action: 'status' });
  is(r.status === 401, 'nobody signed in is told to sign in, and nothing is read', String(r.status));
  is(platformReads === 0, 'and the platform is not even asked');

  console.log('\nLinking with the code sent to the email on the record');
  r = await call('tok-chanda', { action: 'status' });
  is(r.body.linked === false, 'an account starts unlinked');
  r = await call('tok-chanda', { action: 'link', number: 'vb 0007' });
  is(r.status === 200 && SENT.length === 1 && SENT[0].to === 'chanda@example.com', 'the code goes to the email on the customer record', JSON.stringify(SENT.map((m) => m.to)));
  const told = JSON.stringify(r.body);
  is(!/chanda@|Chanda|0977|Phiri/i.test(told) && !/@/.test(told), 'and the answer names nobody and shows no email, not even part of one', told);
  is(!/Chanda|Phiri|0977/.test(SENT[0].text + SENT[0].subject), 'the email itself carries no name or phone either');
  const answerReal = r.body.message;

  r = await call('tok-chanda', { action: 'verify', code: '000000' === codeIn(SENT[0]) ? '111111' : '000000' });
  is(r.status === 400, 'a wrong code is refused');
  r = await call('tok-chanda', { action: 'verify', code: codeIn(SENT[0]) });
  is(r.status === 200 && DB.rewards_links.length === 1 && DB.rewards_links[0].cust_no === 'VB0007', 'the right code links the account to the customer number',
     JSON.stringify(DB.rewards_links));
  is(Object.keys(DB.rewards_links[0]).sort().join(',') === 'cust_no,how,user_id', 'and only the number is kept: no platform id, name, phone or email',
     JSON.stringify(DB.rewards_links[0]));
  is(DB.rewards_codes.length === 0, 'the code is gone once used');

  console.log('\nThe points, asked live');
  r = await call('tok-chanda', { action: 'status' });
  is(r.body.points === 100500 && r.body.worth === 50.25 && r.body.milestone.reached === 1,
     'balance, worth and milestone, as the till would show them', JSON.stringify(r.body));
  is(Object.keys(r.body).sort().join(',') === 'canRedeem,linked,milestone,milestoneValue,number,perK1,points,worth',
     'and nothing about the person', Object.keys(r.body).join(','));
  const dbText = JSON.stringify(DB);
  is(!/Chanda|Phiri|chanda@example|0977000007|100500|"id":7/.test(dbText), 'the website\'s database holds nothing from the platform', dbText.slice(0, 200));

  console.log('\nA number that is not real, has no email, or is on two records');
  SENT.length = 0;
  for (const [tok, num, what] of [['tok-mwila', 'VB-0008', 'no email'], ['tok-eve', 'VB-4242', 'made up']]) {
    r = await call(tok, { action: 'link', number: num });
    is(r.status === 200 && r.body.message === answerReal, 'a number with ' + what + ' gets exactly the same answer as a real one');
  }
  is(SENT.length === 0, 'no code is sent for either');
  is(DB.rewards_requests.filter((q) => q.kind === 'link').length === 2, 'each becomes a request for the team to check');
  const notes = DB.rewards_requests.map((q) => q.note || '');
  is(/no email/.test(notes[0]) && /not on exactly one/.test(notes[1]), 'and each says why no code went, for the team only', JSON.stringify(notes));
  is(!/record on the platform|exactly one/.test(answerReal), 'while the customer is never told the reason');
  DB.rewards_requests = [];
  r = await call('tok-eve', { action: 'verify', code: '123456' });
  is(r.status === 400, 'and no code can link them');
  DB.rewards_codes = [];
  r = await call('tok-eve', { action: 'link', number: 'VB-0009' });
  is(SENT.length === 0 && r.body.message === answerReal, 'a number on two platform records sends nothing, rather than guessing whose it is');
  DB.rewards_codes = [];
  r = await call('tok-eve', { action: 'link', number: 'VB-0007' });
  is(SENT.length === 0 && r.body.message === answerReal, 'a number already linked to another account sends nothing to its owner');

  console.log('\nNobody can flood a customer\'s inbox');
  DB.rewards_codes = []; DB.rewards_links = []; SENT.length = 0;
  for (let i = 0; i < 4; i++) r = await call('tok-chanda', { action: 'link', number: 'VB0007' });
  is(SENT.length === 3 && r.status === 429, 'three codes an hour, then a polite no', SENT.length + ' sent, last ' + r.status);
  r = await call('tok-chanda', { action: 'verify', code: codeIn(SENT[2]) });
  is(r.status === 200, 'and the last code still links the account', String(r.status));

  console.log('\nUsing the points on an order');
  r = await call('tok-chanda', { action: 'quote', due: 30 });
  is(r.body.quote && r.body.quote.value === 30 && r.body.quote.points === 60000, 'a K30 order: 60,000 points take K30 off', JSON.stringify(r.body));
  r = await call('tok-chanda', { action: 'hold', orderRef: 'VB-ABC12', due: 30 });
  is(r.status === 200 && DB.rewards_holds.length === 1 && DB.rewards_holds[0].points === 60000, 'they are promised on the order');
  r = await call('tok-chanda', { action: 'status' });
  is(r.body.points === 40500, 'and the balance shown is what is left, so they cannot be promised twice', String(r.body.points));
  r = await call('tok-chanda', { action: 'hold', orderRef: 'VB-ABC12', due: 30 });
  is(r.status === 409, 'the same order cannot promise them again');
  r = await call('tok-chanda', { action: 'hold', orderRef: 'VB-ABC13', due: 1000 });
  is(r.body.held && r.body.held.points === 40500 && r.body.held.value === 20.25, 'a bigger order uses only what is left', JSON.stringify(r.body));
  r = await call('tok-chanda', { action: 'quote', due: 1000 });
  is(r.body.quote === null, 'and then there is nothing left to use');

  console.log('\nJoining');
  SENT.length = 0;
  r = await call('tok-eve', { action: 'join', name: 'Eve' });
  const jq = DB.rewards_requests.find((q) => q.kind === 'join');
  is(r.status === 200 && jq && jq.name === 'Eve' && jq.email === 'eve@example.com' && !jq.phone,
     'a shopper who is not registered asks the team, with their account email and no phone', JSON.stringify(jq));
  is(r.body.emailed === true && SENT.some((m) => m.to === 'eve@example.com' && /request to join/i.test(m.subject)),
     'and is emailed to say the request arrived', JSON.stringify(SENT.map((m) => m.to + ': ' + m.subject)));
  const n = SENT.length;
  r = await call('tok-eve', { action: 'join', name: 'Eve' });
  is(SENT.length === n, 'asking twice sends no second email');
  r = await call('tok-eve', { action: 'join', name: '' });
  is(r.status === 400 || SENT.length === n, 'a join with no name is refused');


  console.log('\nWhen the platform cannot be read safely');
  process.env.POS_SUPABASE_KEY = 'sb_publishable_abc';
  r = await call('tok-chanda', { action: 'status' });
  is(r.body.unavailable === true && r.body.points === undefined, 'a publishable key is never used to read customers', JSON.stringify(r.body));

  console.log(failures ? '\n  ✗ ' + failures + ' of ' + checks + ' checks FAILED' : '\n  rewards function: all ' + checks + ' checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
