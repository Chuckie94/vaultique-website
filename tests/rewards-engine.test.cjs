/* ===========================================================================
   REWARDS: THE WEBSITE AND THE TILL MUST AGREE TO THE POINT

   netlify/functions/_rewards.js carries a copy of the platform's points
   formula (js/services/loyaltyEngine.js, build 453). This runs both on the
   same thousand made-up customers and fails on the first difference.

   The platform's file is looked for at PLATFORM_DIR (or ../platform beside
   this site). Without it, the fixed cases below still run.
   =========================================================================== */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const R = require(path.resolve(__dirname, '../netlify/functions/_rewards.js'));

let checks = 0, failures = 0;
const is = (c, m, x) => { checks++; if (c) console.log('  ✓ ' + m); else { failures++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); } };

const SET = { rewardsPointsPerK1: 100, rewardsWelcomePoints: 500, rewardsMilestonePoints: 100000, rewardsMilestoneValue: 50 };

console.log('\nFixed cases');
const cust = { id: 7, custNo: 'VB-0007', welcomePoints: 500 };
const sales = [
  { id: 1, customerId: 7, total: 499.99, pointsRate: 100, amountPaid: 499.99 },        // 49,900
  { id: 2, customerId: 7, total: 1000, pointsRate: 100, amountPaid: 400 },             // not paid: 0
  { id: 3, customerId: 7, total: 2000, pointsRate: 100, voided: true },                // voided: 0
  { id: 4, customerId: 7, total: 300, pointsRate: 100, pointsRedeemed: 20000 },        // 30,000 earned, 20,000 used
  { id: 5, customerId: 7, total: 2500 },                                               // before 453: 25 points
  { id: 6, customerId: 8, total: 9999, pointsRate: 100 }                               // somebody else
];
const returns = [{ saleId: 4, total: 100 }];                                          // 100 of sale 4 came back
// 500 + 49,900 + 0 + 0 + (200 kept * 100 = 20,000) - 20,000 + 25
is(R.pointsBalance(cust, sales, SET, returns) === 500 + 49900 + 20000 - 20000 + 25, 'a balance, the way the till works it out',
   String(R.pointsBalance(cust, sales, SET, returns)));
is(R.pointsWorth(50425, SET) === 25.21, '50,425 points are worth K25.21 at 100,000 = K50', String(R.pointsWorth(50425, SET)));
is(JSON.stringify(R.redeemQuote(50425, 10, SET)) === JSON.stringify({ points: 20000, value: 10 }), 'a K10 order uses 20,000 points',
   JSON.stringify(R.redeemQuote(50425, 10, SET)));
is(R.redeemQuote(50425, 10, { rewardsPointsPerK1: 100 }) === null, 'nothing can be redeemed until the milestone and its value are set');
is(R.milestoneState(250000, SET).reached === 2 && R.milestoneState(250000, SET).next === 300000, 'milestones reached and the next one');
is(R.pointsBalance({ id: 1, type: 'Walk-in' }, sales, SET, []) === 0, 'a walk-in has no points');
is(R.numberKey(' vb-0007 ') === 'VB0007' && R.numberKey('VB 0007') === 'VB0007', 'customer numbers compared the platform\'s way');

const state = { customers: [cust, { id: 9, custNo: 'VB-0009' }, { id: 10, custNo: 'VB-0010' }, { id: 11, custNo: 'vb0010' }], sales, returns, settings: SET };
is(R.customerByNumber(state, 'vb0007') === cust, 'a customer is found by their number');
is(R.customerByNumber(state, 'VB-0010') === null, 'a number on two records answers nobody, rather than guessing');
is(R.customerByNumber(state, 'VB-9999') === null, 'an unknown number answers nobody');
const st = R.standing(state, cust, 5000);
is(st.points === 50425 - 5000 && Object.keys(st).sort().join(',') === 'canRedeem,milestone,milestoneValue,perK1,points,worth',
   'what may be said: points and their worth, less what is already promised, and nothing about the person', JSON.stringify(st));

console.log('\nAgainst the platform\'s own file');
const dir = process.env.PLATFORM_DIR || path.resolve(__dirname, '..', '..', 'platform');
const file = path.join(dir, 'js', 'services', 'loyaltyEngine.js');
if (!fs.existsSync(file)) {
  console.log('  (skipped: no copy of the platform at ' + dir + ')');
} else {
  const mods = {};
  const sandbox = { __register: (name, fn) => { const ex = {}; fn(() => ({}), ex); mods[name] = ex; }, Math, Number, String, Date, isFinite, console };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox);
  const P = mods['js/services/loyaltyEngine.js'];
  let seed = 4531;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  let diffs = 0, first = '';
  for (let n = 0; n < 1000; n++) {
    const c = { id: n % 20, welcomePoints: rnd() < 0.7 ? Math.floor(rnd() * 600) : undefined, type: rnd() < 0.05 ? 'Walk-in' : 'Retail' };
    const ss = [], rr = [];
    for (let k = 0; k < 8; k++) {
      const total = Math.round(rnd() * 500000) / 100;
      const s = { id: n * 10 + k, customerId: rnd() < 0.8 ? c.id : c.id + 1, total,
                  pointsRate: rnd() < 0.2 ? undefined : Math.floor(rnd() * 3) * 50,
                  amountPaid: rnd() < 0.8 ? total : Math.round(total * rnd() * 100) / 100,
                  voided: rnd() < 0.1, pointsRedeemed: rnd() < 0.3 ? Math.floor(rnd() * 30000) : undefined };
      ss.push(s);
      if (rnd() < 0.2) rr.push({ saleId: s.id, total: Math.round(total * rnd() * 100) / 100 });
    }
    const set = rnd() < 0.2 ? {} : { rewardsPointsPerK1: Math.floor(rnd() * 200), rewardsWelcomePoints: 500,
      rewardsMilestonePoints: rnd() < 0.2 ? '' : 50000 + Math.floor(rnd() * 100000), rewardsMilestoneValue: rnd() < 0.2 ? '' : Math.round(rnd() * 10000) / 100 };
    const due = Math.round(rnd() * 300000) / 100;
    const a = P.pointsBalance(c, ss, set, rr), b = R.pointsBalance(c, ss, set, rr);
    const qa = JSON.stringify(P.redeemQuote(a, due, set)), qb = JSON.stringify(R.redeemQuote(b, due, set));
    const ma = JSON.stringify(P.milestoneState(a, set)), mb = JSON.stringify(R.milestoneState(b, set));
    const wa = P.pointsWorth(a, set), wb = R.pointsWorth(b, set);
    if (a !== b || qa !== qb || ma !== mb || wa !== wb) { diffs++; if (!first) first = JSON.stringify({ n, a, b, qa, qb, ma, mb, wa, wb }); }
  }
  is(diffs === 0, 'a thousand made-up customers: the same balance, worth, milestone and redemption as the till', first);
}

console.log(failures ? '\n  ✗ ' + failures + ' of ' + checks + ' checks FAILED' : '\n  rewards engine: all ' + checks + ' checks passed');
process.exit(failures ? 1 : 0);
