#!/usr/bin/env bash
# =====================================================================
# Vaultique Boutique Point — the database, checked (build 76)
# ---------------------------------------------------------------------
# For whoever looks after the website, not for the shop. Builds a scratch
# database the way a real project got here and checks it:
#
#   1. a stand-in for a hosted Supabase (tests/supabase-standin/)
#   2. the 28 supabase-*.sql files, in the order SETUP.md gives them
#   3. supabase-hardening.sql, twice: it must be safe to run again
#   4. every one of the 28 files again: each must now refuse, untouched
#   5. tests/hardening.sql: every check from the audit, one line each
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

echo "3. Each older file again: each must refuse"
refused=0
for f in $FILES; do
  if out=$(run "$here/$f"); then echo "   RAN, and should not have:  $f"; fail=1
  elif echo "$out" | grep -q "supabase-hardening.sql (build 76) has already been run"; then refused=$((refused + 1))
  else echo "   FAILED for another reason:  $f"; echo "$out" | grep -E 'ERROR' | head -2 | sed 's/^/           /'; fail=1
  fi
done
echo "   $refused of 28 refused, changing nothing"

echo "4. tests/hardening.sql"
out=$(as "psql -X -d $DB -f -" < "$here/tests/hardening.sql" 2>&1)
echo "$out" | grep -E '✗' | sed 's/^/   /'
summary=$(echo "$out" | grep -E 'checks passed|checks FAILED' | tail -1)
echo "   ${summary:-no summary: the test file did not finish}"
echo "$summary" | grep -q 'checks passed' || fail=1

[ $fail -eq 0 ] && echo "ALL GOOD" || echo "SOMETHING FAILED (above)"
exit $fail
