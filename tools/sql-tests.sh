#!/usr/bin/env bash
# =====================================================================
# Vaultique Boutique Point — the SQL checks, chain by chain (build 81)
# ---------------------------------------------------------------------
# For whoever looks after the website, not for the shop. Each chain is
# what README.md lists: a fixture, the supabase-*.sql file it checks, and
# the checks, run on a scratch database made fresh for that chain. The
# 28 files together, the hardening and the older files refusing are
# tools/db-check.sh's job; run both (npm run test:sql, from tests/).
#
# Needs PostgreSQL (psql, createdb, dropdb). Never point it at the shop's
# real Supabase: it drops and creates the database it is given.
#
#   bash tools/sql-tests.sh                    database vbp_sql_tests
#   VBP_SQL_DB=other bash tools/sql-tests.sh
#   AS_USER=postgres bash tools/sql-tests.sh   run psql as that user (sudo/root)
#
# It ends with ALL GOOD, or names each chain that failed and ends non-zero.
# =====================================================================
set -u
here="$(cd "$(dirname "$0")/.." && pwd)"
DB="${VBP_SQL_DB:-vbp_sql_tests}"

as() { if [ -n "${AS_USER:-}" ]; then su "$AS_USER" -c "$*"; else sh -c "$*"; fi; }
# Each file is read here and handed to psql on its standard input, so the
# user psql runs as never needs to be able to read this folder.
feed() { as "psql -X -q -v ON_ERROR_STOP=1 -d $DB -f -" 2>&1; }

failed=0; total=0; chains=0
run() {
  local name="$1"; shift
  local out="" o rc=0 f
  chains=$((chains + 1))
  as "dropdb --if-exists $DB" >/dev/null 2>&1
  as "createdb $DB" >/dev/null 2>&1 || { echo "Could not create the database $DB."; exit 1; }
  for f in "$@"; do
    if [ "$f" = "@layby-setup-slice" ]; then
      # The layby checks need only the settings tables from the setup file.
      o=$(sed -n '/^create table if not exists public.site_settings (/,/with check (public.is_admin());/p' \
            "$here/supabase-setup.sql" | feed) || rc=1
    else
      o=$(feed < "$here/$f") || rc=1
    fi
    out="$out
$o"
    [ $rc -ne 0 ] && break
  done
  local pass fail
  pass=$(printf '%s\n' "$out" | grep -c '✓')
  fail=$(printf '%s\n' "$out" | grep -c '✗')
  total=$((total + pass))
  if [ $rc -eq 0 ] && [ "$fail" -eq 0 ] && [ "$pass" -gt 0 ]; then
    printf '  ✓ %-18s %4s checks\n' "$name" "$pass"
  else
    failed=$((failed + 1))
    printf '  ✗ %-18s %4s passed, %s failed\n' "$name" "$pass" "$fail"
    printf '%s\n' "$out" | grep -E '✗|ERROR' | head -8 | sed 's/^/        /'
  fi
}

echo "The SQL chains, each on a fresh database ($DB)"
run analytics        tests/analytics-fixture.sql supabase-analytics.sql tests/analytics.sql
run chat-mentions    tests/chat-jobs-fixture.sql tests/chat-mentions-fixture.sql supabase-chat-mentions.sql tests/chat-mentions.sql
run chat-handover    tests/chat-jobs-fixture.sql tests/chat-mentions-fixture.sql supabase-chat-mentions.sql supabase-chat-handover.sql tests/chat-handover.sql
run analytics-live   tests/analytics-fixture.sql supabase-analytics.sql tests/analytics-live-fixture.sql supabase-analytics-live.sql tests/analytics-live.sql
run analytics-src    tests/analytics-fixture.sql supabase-analytics.sql supabase-analytics-sources.sql tests/analytics-sources.sql
run rewards          tests/analytics-fixture.sql supabase-rewards.sql tests/rewards.sql
run cart-pieces      tests/analytics-fixture.sql supabase-analytics.sql supabase-cart-pieces.sql tests/cart-pieces.sql
run browsing-towns   tests/analytics-fixture.sql supabase-analytics.sql tests/analytics-live-fixture.sql supabase-analytics-live.sql supabase-browsing-towns.sql tests/browsing-towns.sql
run chat-realtime    tests/chat-jobs-fixture.sql tests/chat-realtime-fixture.sql supabase-chat-realtime.sql tests/chat-realtime.sql
run payments         tests/payments-fixture.sql supabase-payments.sql tests/payments.sql
run chat-photos      tests/chat-jobs-fixture.sql tests/chat-photos-fixture.sql supabase-chat-photos.sql tests/chat-photos.sql
run chat-jobs        tests/chat-jobs-fixture.sql supabase-chat-jobs.sql tests/chat-jobs.sql
run layby-settings   tests/layby-settings-fixture.sql @layby-setup-slice tests/layby-settings.sql
# Build 80: the platform's till (supabase-pos-orders.sql) and the payment
# history, each with the files they stand on. An order's progress
# (supabase-order-progress.sql) is the last chain, below.
POS="tests/pos-orders-fixture.sql supabase-setup.sql supabase-payments.sql tests/pos-orders-admins.sql supabase-rewards.sql supabase-pos-orders.sql"
run pos-orders       $POS tests/pos-orders.sql
run pos-orders-bare  tests/pos-orders-fixture.sql supabase-setup.sql supabase-pos-orders.sql tests/pos-orders-bare.sql
run payment-history  $POS supabase-payment-history.sql supabase-payment-history.sql tests/payment-history.sql
run pos-orders-80    $POS supabase-payment-history.sql supabase-order-progress.sql tests/pos-orders.sql
# Build 85: a test payment is never rung up. supabase-test-orders.sql, run
# twice over the till's file, and every check of the till still passes.
run test-orders      $POS supabase-test-orders.sql supabase-test-orders.sql tests/pos-orders.sql
# Build 87: customers' requests (supabase-customer-requests.sql), run twice
# over the till's door and an order's progress, then its checks.
run requests         $POS supabase-payment-history.sql tests/order-progress-fixture.sql supabase-order-progress.sql supabase-customer-requests.sql supabase-customer-requests.sql tests/customer-requests.sql
# Build 88: Lenco payments (supabase-lenco.sql), run twice over the till's
# door, the payment history, an order's progress and the online refunds.
run lenco            $POS supabase-payment-history.sql tests/order-progress-fixture.sql supabase-order-progress.sql supabase-online-refund.sql supabase-lenco.sql supabase-lenco.sql tests/lenco.sql
as "dropdb --if-exists $DB" >/dev/null 2>&1

# Build 80 · an order's progress (supabase-order-progress.sql). Its own
# script, because two of its checks need a second database: it builds the
# chain (the till's files, orders already there, the file run twice), runs
# tests/order-progress.sql, then runs the file a third time with orders in
# it, and checks it refuses the platform's database and a website without
# the till's door, creating nothing.
script() {
  local name="$1" file="$2" o rc pass fail
  chains=$((chains + 1))
  o=$(bash "$here/$file" 2>&1); rc=$?
  pass=$(printf '%s\n' "$o" | grep -c '✓')
  fail=$(printf '%s\n' "$o" | grep -c '✗')
  total=$((total + pass))
  if [ $rc -eq 0 ] && [ "$fail" -eq 0 ] && [ "$pass" -gt 0 ]; then
    printf '  ✓ %-18s %4s checks\n' "$name" "$pass"
  else
    failed=$((failed + 1))
    printf '  ✗ %-18s %4s passed, %s failed\n' "$name" "$pass" "$fail"
    printf '%s\n' "$o" | grep -E '✗|ERROR' | head -8 | sed 's/^/        /'
  fi
}
script order-progress tests/order-progress-db.sh
# Build 81 · the online refunds (supabase-online-refund.sql), the same way:
# the chain, the file run three times, and its two refusals.
script online-refund tests/online-refund-db.sh

echo
if [ $failed -eq 0 ]; then
  echo "  $chains chains, $total checks: ALL GOOD"
  exit 0
fi
echo "  $failed of $chains chains FAILED"
exit 1
