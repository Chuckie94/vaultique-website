#!/usr/bin/env bash
# =====================================================================
# Vaultique Boutique Point — the database, checked (builds 76 to 81)
# ---------------------------------------------------------------------
# For whoever looks after the website, not for the shop. Builds a scratch
# database the way a real project got here and checks it:
#
#   1. a stand-in for a hosted Supabase (tests/supabase-standin/)
#   2. the 28 supabase-*.sql files, in the order SETUP.md gives them
#   3. supabase-hardening.sql, twice: it must be safe to run again
#   4. build 80: the three files made after the hardening (the platform's
#      till, the payment history, an order's progress), build 81's
#      online refunds and build 83's reply notifications
#      (supabase-chat-reply-push.sql), each twice, then supabase-hardening.sql once more:
#      they must sit beside it, and it must leave the till's door, an
#      order's private link and the refund doors open
#   5. every one of the 28 files again: each must now refuse, untouched
#   6. tests/hardening.sql: every check from the audit, one line each
#   7. tests/after-the-hardening.sql: the platform's till, an order's steps,
#      the customer's two buttons, the private link and the payment history
#      still work, and nothing the hardening closed is open again
#
# Needs PostgreSQL 16 (psql, createdb, dropdb) and the pg_net stand-in
# installed once (tests/supabase-standin/README.txt). Never point it at the
# shop's real Supabase: it drops and creates the database it is given.
#
#   bash tools/db-check.sh                    database vbp_db_check
#   VBP_CHECK_DB=other bash tools/db-check.sh
#   AS_USER=postgres bash tools/db-check.sh   run psql as that user (sudo/root)
# =====================================================================
set -u
here="$(cd "$(dirname "$0")/.." && pwd)"
DB="${VBP_CHECK_DB:-vbp_db_check}"
FILES="supabase-setup.sql supabase-chat.sql supabase-chat-phase2.sql supabase-chat-phase3.sql
supabase-chat-phase4.sql supabase-chat-phase5.sql supabase-chat-phase6.sql supabase-chat-phase7.sql
supabase-chat-phase8.sql supabase-chat-phase9.sql supabase-chat-phase10.sql supabase-fixes.sql
supabase-product-pulse.sql supabase-analytics.sql supabase-chat-jobs.sql supabase-chat-realtime.sql
supabase-chat-photos.sql supabase-payments.sql supabase-chat-mentions.sql supabase-chat-handover.sql
supabase-analytics-live.sql supabase-analytics-sources.sql supabase-rewards.sql supabase-signup.sql
supabase-new-arrivals.sql supabase-sold-out.sql supabase-browsing-towns.sql supabase-cart-pieces.sql"

as() { if [ -n "${AS_USER:-}" ]; then su "$AS_USER" -c "$*"; else sh -c "$*"; fi; }
# Each file is read here and handed to psql on its standard input, so the
# user psql runs as never needs to be able to read this folder.
run() { as "psql -X -q -1 -v ON_ERROR_STOP=1 -d $DB -f -" < "$1" 2>&1; }

fail=0
as "dropdb --if-exists $DB" >/dev/null 2>&1
as "createdb $DB" || { echo "Could not create the database $DB."; exit 1; }
run "$here/tests/supabase-standin/supabase-standin.sql" >/dev/null || { echo "The Supabase stand-in did not load (is the pg_net stand-in installed?)."; exit 1; }
echo "insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-0000-0000-0000000000a1', 'owner@shop.test', now());" \
  | as "psql -X -q -d $DB -f -" >/dev/null

echo "1. The 28 setup files, in order"
for f in $FILES; do
  out=$(run "$here/$f") || { echo "   FAILED  $f"; echo "$out" | grep -E 'ERROR|LINE' | head -3 | sed 's/^/           /'; fail=1; }
done
[ $fail -eq 0 ] && echo "   all 28 ran"

echo "2. supabase-hardening.sql, twice"
for n in 1 2; do
  out=$(run "$here/supabase-hardening.sql") || { echo "   FAILED on run $n"; echo "$out" | grep -E 'ERROR|LINE|CONTEXT' | head -4 | sed 's/^/           /'; fail=1; }
done
[ $fail -eq 0 ] && echo "   ran, and ran again"
# Before supabase-chat-reply-push.sql (build 83) the report says so.
echo "$out" | grep -q "Telling a customer you have replied.*NOT RUN YET (optional)" \
  || { echo "   the report does not say the customer reply notification is not run yet"; fail=1; }

# Before supabase-test-orders.sql (build 85), and the till, the report says so.
echo "$out" | grep -q "A test payment is never rung up.*NOT RUN YET" \
  || { echo "   the report does not say a test payment's rule is not run yet"; fail=1; }
# Before supabase-customer-requests.sql (build 87), the report says so.
echo "$out" | grep -q "Customer requests.*NOT RUN YET (optional)" \
  || { echo "   the report does not say customers' requests are not run yet"; fail=1; }

echo "3. The files made after the hardening (builds 80, 81, 83, 85, 87, 88, 89, 90, 91 and 92), twice each, then the hardening once more"
AFTER="supabase-pos-orders.sql supabase-payment-history.sql supabase-order-progress.sql supabase-online-refund.sql
supabase-chat-reply-push.sql supabase-test-orders.sql supabase-customer-requests.sql supabase-lenco.sql supabase-delivery.sql
supabase-shopping.sql supabase-risk.sql supabase-backup.sql"
for f in $AFTER; do
  for n in 1 2; do
    out=$(run "$here/$f") || { echo "   FAILED  $f (run $n)"; echo "$out" | grep -E 'ERROR|LINE' | head -3 | sed 's/^/           /'; fail=1; }
  done
done
out=$(run "$here/supabase-hardening.sql") || { echo "   FAILED: the hardening after them"; echo "$out" | grep -E 'ERROR|LINE|CONTEXT' | head -4 | sed 's/^/           /'; fail=1; }
[ $fail -eq 0 ] && echo "   all 12 ran, twice, and the hardening ran after them"
# The hardening, run after supabase-delivery.sql, leaves the platform's new
# door open to its key (build 89: it is on the hardening's own list).
echo "select case when has_function_privilege('anon', 'public.vbp_pos_order_shipping(text, text, text, text, text, text)', 'execute')
              then 'open' else 'CLOSED' end;" \
  | as "psql -X -q -t -d $DB -f -" | grep -q open \
  && echo "   the hardening, run after it, leaves the platform's delivery door open to its key" \
  || { echo "   the hardening, run after supabase-delivery.sql, closed the platform's delivery door"; fail=1; }
# And a gift list's link, from supabase-shopping.sql (build 90: on its list too).
echo "select case when has_function_privilege('anon', 'public.gift_list_get(text)', 'execute')
              and has_function_privilege('anon', 'public.reviews_open_to_all()', 'execute')
              then 'open' else 'CLOSED' end;" \
  | as "psql -X -q -t -d $DB -f -" | grep -q open \
  && echo "   the hardening, run after it, leaves a gift list's link and the review rule open to visitors" \
  || { echo "   the hardening, run after supabase-shopping.sql, closed a gift list's link"; fail=1; }
# supabase-test-orders.sql's own check row (build 85) says OK.
out85=$(run "$here/supabase-test-orders.sql") || fail=1
echo "$out85" | grep -q "OK · a test payment is never rung up" \
  && echo "   supabase-test-orders.sql says: OK · a test payment is never rung up" \
  || { echo "   supabase-test-orders.sql does not say OK"; echo "$out85" | tail -4 | sed 's/^/           /'; fail=1; }
# And after it, that the hardening kept its four doors open (build 83).
echo "$out" | grep -q "Telling a customer you have replied.*OK · the chat window can offer it" \
  && echo "   the report: telling a customer you have replied, OK · the chat window can offer it" \
  || { echo "   the report does not say the customer reply notification is OK"; echo "$out" | grep "Telling a customer" | sed 's/^/           /'; fail=1; }
# And that a test payment is never rung up (build 85).
echo "$out" | grep -q "A test payment is never rung up.*OK · a test payment is never rung up" \
  && echo "   the report: a test payment is never rung up, OK" \
  || { echo "   the report does not say a test payment is never rung up"; echo "$out" | grep "A test payment" | sed 's/^/           /'; fail=1; }
# supabase-customer-requests.sql's own check row (build 87) says OK, and the
# report says the platform can reach the requests with its key.
out87=$(run "$here/supabase-customer-requests.sql") || fail=1
echo "$out87" | grep -q "OK · customers can ask, the shop decides" \
  && echo "   supabase-customer-requests.sql says: OK · customers can ask, the shop decides" \
  || { echo "   supabase-customer-requests.sql does not say OK"; echo "$out87" | tail -4 | sed 's/^/           /'; fail=1; }
echo "$out" | grep -q "Customer requests.*OK · the platform's till can reach it with its own key" \
  && echo "   the report: customer requests, OK · the platform's till can reach it" \
  || { echo "   the report does not say customer requests are OK"; echo "$out" | grep "Customer requests" | sed 's/^/           /'; fail=1; }

# supabase-lenco.sql's own check row (build 88) says OK, after the hardening ran again.
out88=$(run "$here/supabase-lenco.sql") || fail=1
echo "$out88" | grep -q "OK · Lenco payments can be recorded" \
  && echo "   supabase-lenco.sql says: OK · Lenco payments can be recorded" \
  || { echo "   supabase-lenco.sql does not say OK"; echo "$out88" | tail -4 | sed 's/^/           /'; fail=1; }
echo "$out88" | grep -q "OK · an order is paid once" \
  && echo "   supabase-lenco.sql says: OK · an order is paid once" \
  || { echo "   supabase-lenco.sql does not say an order is paid once"; fail=1; }
# Online refunds run again after it keep the build 88 rule (no_refund_api).
run "$here/supabase-online-refund.sql" >/dev/null || fail=1
echo "select case when pg_get_functiondef('public.refund_state_of(uuid)'::regprocedure) like '%no_refund_api%' then 'kept' else 'LOST' end;" \
  | as "psql -X -q -t -d $DB -f -" | grep -q kept \
  && echo "   supabase-online-refund.sql run again keeps the build 88 refund rule" \
  || { echo "   supabase-online-refund.sql run again lost the build 88 refund rule"; fail=1; }

# supabase-delivery.sql's own check row (build 89) says OK; and the two files
# that hand an order out, run again after it, keep its delivery details.
out89=$(run "$here/supabase-delivery.sql") || fail=1
echo "$out89" | grep -q "OK · delivery details can be recorded" \
  && echo "   supabase-delivery.sql says: OK · delivery details can be recorded" \
  || { echo "   supabase-delivery.sql does not say OK"; echo "$out89" | tail -4 | sed 's/^/           /'; fail=1; }
run "$here/supabase-order-progress.sql" >/dev/null || fail=1
run "$here/supabase-test-orders.sql" >/dev/null || fail=1
echo "select case when pg_get_functiondef('public.pos_order_out(uuid,boolean)'::regprocedure) like '%ship_tracking_url%'
              and pg_get_functiondef('public.order_progress_out(uuid)'::regprocedure) like '%ship_tracking_url%'
              then 'kept' else 'LOST' end;" \
  | as "psql -X -q -t -d $DB -f -" | grep -q kept \
  && echo "   supabase-order-progress.sql and supabase-test-orders.sql run again keep the build 89 delivery details" \
  || { echo "   an older file run again lost the build 89 delivery details"; fail=1; }

# supabase-shopping.sql's own check row (build 90) says OK, after the hardening ran again.
out90=$(run "$here/supabase-shopping.sql") || fail=1
echo "$out90" | grep -q "OK · shopping can be recorded" \
  && echo "   supabase-shopping.sql says: OK · shopping can be recorded" \
  || { echo "   supabase-shopping.sql does not say OK"; echo "$out90" | tail -4 | sed 's/^/           /'; fail=1; }

# supabase-risk.sql's own check row (build 91) says OK after the hardening ran
# again; the hardening keeps Fraud & Risk among the rights that need
# two-factor, and leaves none of the check's functions open to visitors.
out91=$(run "$here/supabase-risk.sql") || fail=1
echo "$out91" | grep -q "OK · the fraud check can record" && echo "$out91" | grep -q "OK · the record is sealed" \
  && echo "   supabase-risk.sql says: OK · the fraud check can record, OK · the record is sealed" \
  || { echo "   supabase-risk.sql does not say OK"; echo "$out91" | tail -4 | sed 's/^/           /'; fail=1; }
run "$here/supabase-hardening.sql" >/dev/null || fail=1
echo "select case when pg_get_functiondef('public.two_factor_required()'::regprocedure) like '%''risk''%'
              and not has_function_privilege('anon', 'public.risk_decide(uuid, text, text)', 'execute')
              and not has_function_privilege('anon', 'public.risk_summary(integer)', 'execute')
              and not has_function_privilege('anon', 'public.audit_verify(integer)', 'execute')
              and not has_function_privilege('anon', 'public.risk_facts(jsonb)', 'execute')
              and has_function_privilege('authenticated', 'public.risk_decide(uuid, text, text)', 'execute')
              and (select count(*) from pg_trigger where tgname like 'zz_audit_%') >= 7
              then 'kept' else 'LOST' end;" \
  | as "psql -X -q -t -d $DB -f -" | grep -q kept \
  && echo "   the hardening, run after it, keeps Fraud & Risk needing two-factor, the record's triggers, and the check closed to visitors" \
  || { echo "   the hardening, run after supabase-risk.sql, lost part of the fraud check"; fail=1; }

# supabase-backup.sql's own check row (build 92) says OK.
out92=$(run "$here/supabase-backup.sql") || fail=1
echo "$out92" | grep -q "OK · backups can be recorded" \
  && echo "   supabase-backup.sql says: OK · backups can be recorded" \
  || { echo "   supabase-backup.sql does not say OK"; echo "$out92" | tail -4 | sed 's/^/           /'; fail=1; }

echo "4. Each older file again: each must refuse"
refused=0
for f in $FILES; do
  if out=$(run "$here/$f"); then echo "   RAN, and should not have:  $f"; fail=1
  elif echo "$out" | grep -q "supabase-hardening.sql (build 76 or later) has already been run"; then refused=$((refused + 1))
  else echo "   FAILED for another reason:  $f"; echo "$out" | grep -E 'ERROR' | head -2 | sed 's/^/           /'; fail=1
  fi
done
echo "   $refused of 28 refused, changing nothing"

echo "5. tests/hardening.sql"
out=$(as "psql -X -d $DB -f -" < "$here/tests/hardening.sql" 2>&1)
echo "$out" | grep -E '✗' | sed 's/^/   /'
summary=$(echo "$out" | grep -E 'checks passed|checks FAILED' | tail -1)
echo "   ${summary:-no summary: the test file did not finish}"
echo "$summary" | grep -q 'checks passed' || fail=1

echo "6. tests/after-the-hardening.sql (builds 80, 81 and 83: the platform's till, an order's progress, closing an account, online refunds, telling a customer the shop has replied)"
out=$(as "psql -X -d $DB -f -" < "$here/tests/after-the-hardening.sql" 2>&1)
echo "$out" | grep -E '✗|ERROR' | sed 's/^/   /'
summary=$(echo "$out" | grep -E 'checks passed|checks FAILED' | tail -1)
echo "   ${summary:-no summary: the test file did not finish}"
echo "$summary" | grep -q 'checks passed' || fail=1

# BUILD 92 · The backup, on this whole database: a copy made, checked by
# restoring it, sealed, kept, read back; the first drill; a real restore into
# a new (stand-in) project. Needs Node; connects as postgres over TCP, so the
# check sets a password for this scratch server first.
echo "7. The backup: a copy of this database, checked by restoring it, and the first drill (tests/backup-cycle.js)"
echo "alter user postgres password 'backup-cycle-local';" | as "psql -X -q -d $DB -f -" >/dev/null 2>&1
out=$(BACKUP_TEST_DB="postgresql://postgres:backup-cycle-local@127.0.0.1:5432/$DB" \
      BACKUP_TEST_SCRATCH="postgresql://postgres:backup-cycle-local@127.0.0.1:5432/postgres" \
      node "$here/tests/backup-cycle.js" 2>&1)
echo "$out" | grep -E '✗' | sed 's/^/   /'
summary=$(echo "$out" | grep -E 'checks passed|checks FAILED|skipped' | tail -1)
echo "   ${summary:-no summary: the backup cycle did not finish}"
echo "$summary" | grep -q 'checks passed' || fail=1

[ $fail -eq 0 ] && echo "ALL GOOD" || echo "SOMETHING FAILED (above)"
exit $fail
