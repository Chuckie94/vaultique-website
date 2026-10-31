#!/usr/bin/env bash
# =====================================================================
# Vaultique Boutique Point — the SQL checks, chain by chain (build 79)
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
as "dropdb --if-exists $DB" >/dev/null 2>&1

echo
if [ $failed -eq 0 ]; then
  echo "  $chains chains, $total checks: ALL GOOD"
  exit 0
fi
echo "  $failed of $chains chains FAILED"
exit 1
