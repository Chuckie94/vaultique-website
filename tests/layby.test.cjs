/* ===========================================================================
   THE LAYBY ESTIMATE'S ARITHMETIC -- assets/layby.js

   THE OWNER: "Deposit amount = Product price x configured deposit percentage.
   Remaining balance = Product price - deposit amount. Monthly instalment
   estimate = Remaining balance / configured payment duration." With their own
   example: K499, 30%, six months -> K149.70, K349.30, from K58.22 a month.

   Run here exactly as the page runs it. Checked: that example; other terms,
   so nothing about 30% or six months is built in; that the deposit and the
   balance always add up to the price to the ngwee, and the months to the
   balance, over thousands of prices; and that terms which make no sense give
   no estimate rather than a wrong one.
   =========================================================================== */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let checks = 0, failures = 0;
const is = (c, m, x) => {
  checks++;
  if (c) console.log('  ✓ ' + m);
  else { failures++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); }
};

const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'assets', 'layby.js'), 'utf8'), sandbox);
const L = sandbox.window.VBP_LAYBY;
const J = (o) => JSON.stringify(o);

console.log('\nThe owner\'s example');
let e = L.estimate(499, 30, 6);
is(e && e.price === 499 && e.deposit === 149.7 && e.balance === 349.3 && e.monthly === 58.22 && e.months === 6,
   'K499 at 30% over 6 months: deposit K149.70, balance K349.30, from K58.22 a month', J(e));
is(e && e.last === 58.2 && Math.round((e.monthly * 5 + e.last) * 100) === 34930,
   'the rounding is settled in the last month: five of K58.22 and one of K58.20 make K349.30', J(e));

console.log('\nOther terms, so nothing is built in');
e = L.estimate(499, 25, 12);
is(e && e.deposit === 124.75 && e.balance === 374.25 && e.monthly === 31.19 && e.last === 31.16 && e.percent === 25,
   'K499 at 25% over 12 months: K124.75, K374.25, from K31.19 (the last K31.16)', J(e));
e = L.estimate(549, 30, 6);
is(e && e.deposit === 164.7 && e.balance === 384.3 && e.monthly === 64.05 && e.last === 64.05,
   'a K549 size of the same piece: K164.70, K384.30, six of K64.05', J(e));
e = L.estimate(424.15, 30, 6);
is(e && e.price === 424.15 && e.deposit === 127.25 && e.balance === 296.9,
   'a sale price in ngwee, K424.15: deposit rounded to the nearest ngwee, K127.25, and K296.90 left', J(e));
e = L.estimate(100, 12.5, 3);
is(e && e.deposit === 12.5 && e.balance === 87.5 && e.monthly === 29.17 && e.last === 29.16 && e.percent === 12.5,
   'a deposit of 12.5%, and a balance that does not divide by three', J(e));
e = L.estimate(499, 100, 6);
is(e && e.deposit === 499 && e.balance === 0 && e.monthly === 0 && e.last === 0,
   'a deposit of 100% leaves nothing to pay monthly', J(e));
e = L.estimate(499, 30, 1);
is(e && e.monthly === 349.3 && e.last === 349.3, 'one month: the whole balance in it', J(e));

console.log('\nAlways adding up, over 20,000 prices and terms');
let bad = [];
let seed = 7;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
for (let i = 0; i < 20000 && bad.length < 5; i++) {
  const price = Math.round(rnd() * 5000000) / 100 + 0.01;                // K0.01 to K50,000
  const pct = Math.max(0.01, Math.round(rnd() * 10000) / 100);           // 0.01% to 100%
  const months = 1 + Math.floor(rnd() * 120);                            // 1 to 120
  const r = L.estimate(price, pct, months);
  if (!r) { bad.push('no answer ' + J([price, pct, months])); continue; }
  const P = Math.round(r.price * 100), D = Math.round(r.deposit * 100), B = Math.round(r.balance * 100);
  const M = Math.round(r.monthly * 100), Z = Math.round(r.last * 100);
  const wantD = Math.round(P * pct / 100);
  if (P !== Math.round(price * 100)) bad.push('price moved ' + J([price, r.price]));
  else if (D + B !== P) bad.push('deposit + balance != price ' + J([price, pct, r]));
  else if (Math.abs(D - wantD) > 1) bad.push('deposit off ' + J([price, pct, r]));
  else if (M * (months - 1) + Z !== B) bad.push('months do not add up ' + J([price, pct, months, r]));
  else if (Z < 0 || M < 0) bad.push('negative month ' + J([price, pct, months, r]));
  else if (Math.abs(M - B / months) >= 1) bad.push('monthly off ' + J([price, pct, months, r]));
  /* The nearest ngwee, wherever a month is a kwacha or more. Below that
     (K12.95 over 94 months) it is rounded down instead, so that the last
     month cannot go below zero. */
  else if (B / months >= 100 && Math.abs(M - B / months) > 0.5) bad.push('not the nearest ngwee ' + J([price, pct, months, r]));
  else if (B >= months && Math.abs(Z - M) > months) bad.push('last month far off ' + J([price, pct, months, r]));
  [r.price, r.deposit, r.balance, r.monthly, r.last].forEach((v) => {
    if (Math.round(v * 100) / 100 !== v) bad.push('not to the ngwee ' + v);
  });
}
is(!bad.length, 'deposit + balance = price, months = balance, all to the ngwee, never negative', bad.join(' | '));
e = L.estimate(0.07, 1, 12);
is(e && e.balance === 0.07 && e.last >= 0 && Math.round((e.monthly * 11 + e.last) * 100) === 7,
   'even a balance of a few ngwee over twelve months, the last month is not below zero', J(e));

console.log('\nNo estimate rather than a wrong one');
const none = [[0, 30, 6], [-5, 30, 6], ['abc', 30, 6], [499, 0, 6], [499, -1, 6], [499, 100.01, 6],
              [499, 30, 0], [499, 30, 2.5], [499, 30, -3], [499, 'x', 6], [499, 30, 'six']];
is(none.every((a) => L.estimate(a[0], a[1], a[2]) === null),
   'no price, a deposit of nothing or over 100%, or a part-month: nothing',
   none.filter((a) => L.estimate(a[0], a[1], a[2]) !== null).map(J).join(' '));

console.log('\nThe shop\'s terms out of Settings > Payments');
is(J(L.terms(null)) === J({ deposit: 30, months: 6 }) && J(L.terms({})) === J({ deposit: 30, months: 6 }),
   'never saved: 30% over 6 months, what the settings page starts from');
is(J(L.terms({ laybyDeposit: 25, laybyMonths: 12 })) === J({ deposit: 25, months: 12 }), 'saved: the shop\'s own');
is(J(L.terms({ laybyDeposit: '40', laybyMonths: '3' })) === J({ deposit: 40, months: 3 }), 'figures saved as text still read');
is(J(L.terms({ laybyDeposit: '', laybyMonths: null })) === J({ deposit: 30, months: 6 }), 'a blank figure falls back to the default');
is([{ laybyDeposit: 0 }, { laybyDeposit: 150 }, { laybyDeposit: 'abc' }, { laybyMonths: 0 }, { laybyMonths: 2.5 }, { laybyMonths: -1 }]
   .every((t) => L.terms(t) === null), 'terms that make no sense give none');

console.log(failures ? '\n  ✗ ' + failures + ' of ' + checks + ' checks FAILED'
                     : '\n  layby arithmetic: all ' + checks + ' checks passed');
process.exit(failures ? 1 : 0);
