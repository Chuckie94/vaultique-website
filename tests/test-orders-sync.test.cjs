/* ===========================================================================
   A TEST PAYMENT IS NEVER RUNG UP: THE TWO FILES SAY THE SAME (website build 85)

   supabase-test-orders.sql is for a shop already running: it replaces five
   of the platform's door functions with the ones supabase-pos-orders.sql
   makes since build 85. If the two ever said different things, running one
   after the other would quietly undo the other. Here, each of the five, as
   written in each file, must be the same, character for character; and the
   rule itself must be the one this build means:

     1. only a payment in LIVE mode counts as paid at the till;
     2. a Test-mode order is kept off the till's list of orders to ring up,
        and the till is told it is a test;
     3. the file's own check row asks for the rule without quotes that could
        be lost (each _ stands for one character);
     4. the hardening's report has its line for it, and both database
        checks run the file (tools/db-check.sh, tools/sql-tests.sh).
   =========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

let checks = 0, failures = 0;
const ok = (m) => { checks++; console.log('  ✓ ' + m); };
const fail = (m, x) => { checks++; failures++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); };
const is = (c, m, x) => (c ? ok(m) : fail(m, x));

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const pos = read('supabase-pos-orders.sql');
const tst = read('supabase-test-orders.sql');
function fn(src, name) {
  const m = new RegExp('create or replace function public\\.' + name + '\\([\\s\\S]*?\\n\\$([a-z]+)\\$;\\n').exec(src);
  return m ? m[0] : null;
}

console.log('\nThe five functions, in both files');
for (const name of ['pos_paid_online', 'pos_test_payment', 'pos_order_out', 'vbp_pos_orders', 'vbp_pos_order_claim']) {
  const a = fn(pos, name), b = fn(tst, name);
  is(!!a && !!b && a === b, name + ': the same in supabase-pos-orders.sql and supabase-test-orders.sql',
     !a ? 'not in supabase-pos-orders.sql' : !b ? 'not in supabase-test-orders.sql' : 'they differ');
}

console.log('\nThe rule');
const paid = fn(pos, 'pos_paid_online') || '';
is(/p\.status = ''paid''\s+and p\.mode = ''live''/.test(paid), 'paid at the till: a payment the payment service says is paid, in Live mode');
is(/not \(o\.payment_method = 'online' and public\.pos_test_payment\(o\.id\)\)/.test(fn(pos, 'vbp_pos_orders') || ''),
   'a Test-mode order is kept off the list of orders to ring up');
is(/'test', public\.pos_test_payment\(o\.id\)/.test(fn(pos, 'pos_order_out') || ''), 'and every order says whether it is a test');
is(/'test', public\.pos_test_payment\(o\.id\)/.test(fn(pos, 'vbp_pos_order_claim') || ''), 'ringing a test up is refused, saying so');

console.log('\nThe checks of it');
is(/like '%p\.mode = __live__%'/.test(tst) && !/like '%p\.mode = live%'/.test(tst), 'supabase-test-orders.sql\'s check row looks for the rule without quotes that could be lost');
const hard = read('supabase-hardening.sql');
is(/A test payment is never rung up \(supabase-test-orders\.sql, website 85\)/.test(hard) && /like '%p\.mode = __live__%'/.test(hard),
   'the hardening\'s report has its line, asked the same way');
is(/AFTER="[^"]*supabase-test-orders\.sql[^"]*"/.test(read('tools/db-check.sh')),
   'the database check runs the file twice, beside the other files made after the hardening');
is(/run test-orders +\$POS supabase-test-orders\.sql supabase-test-orders\.sql tests\/pos-orders\.sql/.test(read('tools/sql-tests.sh')),
   'and the SQL chains run it twice over the till\'s file, then every check of the till');
is(/revoke all on function public\.pos_test_payment\(uuid\) from public, anon, authenticated;/.test(pos) &&
   /revoke all on function public\.pos_test_payment\(uuid\) from public, anon, authenticated;/.test(tst),
   'nobody outside can call the new helper, in either file');

console.log('\n  test payments, the two files: ' + (failures ? failures + ' of ' + checks + ' checks FAILED' : 'all ' + checks + ' checks passed'));
process.exit(failures ? 1 : 0);
