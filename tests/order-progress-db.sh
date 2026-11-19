#!/usr/bin/env bash
# ===========================================================================
# The order-progress database test, on a scratch PostgreSQL (never the live
# one). Builds the website's database from its own files, in the live order,
# runs supabase-order-progress.sql twice, then tests/order-progress.sql; and
# checks the file refuses the wrong database, and a website without the
# till's door, creating nothing.
#
# Build 80: run by tools/sql-tests.sh, after its chains, the same way: psql
# as AS_USER when that is set (sudo on GitHub), as you otherwise. Or by hand:
#
#   VBP_TEST_PG="-h /path/to/socket -p 5432 -U postgres" bash tests/order-progress-db.sh
#
# Never point it at the shop's real Supabase: it drops and creates the two
# databases it uses (vq_progress_test, vq_progress_refuse).
# ===========================================================================
set -u
cd "$(dirname "$0")/.." || exit 9
# Each file is handed to psql on its standard input, as tools/sql-tests.sh
# does, so the user psql runs as never needs to read this folder.
pg() {
  if [ -n "${VBP_TEST_PG:-}" ]; then psql $VBP_TEST_PG -X -q -v ON_ERROR_STOP=1 "$@"
  elif [ -n "${AS_USER:-}" ]; then su "$AS_USER" -c "psql -X -q -v ON_ERROR_STOP=1 $(printf '%q ' "$@")"
  else psql -X -q -v ON_ERROR_STOP=1 "$@"; fi
}
ERR=$(mktemp)
DB=vq_progress_test
pg -d postgres -c "drop database if exists $DB" >/dev/null 2>&1
pg -d postgres -c "create database $DB" >/dev/null 2>&1 || { echo "   ✗ cannot make the database $DB"; exit 2; }
for f in tests/pos-orders-fixture.sql supabase-setup.sql supabase-payments.sql tests/pos-orders-admins.sql \
         supabase-rewards.sql supabase-pos-orders.sql supabase-payment-history.sql \
         tests/order-progress-fixture.sql supabase-order-progress.sql supabase-order-progress.sql; do
  pg -d $DB -f - < "$f" >/dev/null 2>"$ERR" || { echo "   ✗ loading $f failed:"; cat "$ERR"; exit 3; }
done
out=$(pg -d $DB -At -f - < tests/order-progress.sql 2>&1)
echo "$out" | grep -E '^   (✓|✗)'
fails=$(echo "$out" | grep -c '^   ✗')

# Run a third time, now with orders, an owner and the customer's steps in it:
# still safe, still changes no order, and its last result names who may open
# the admin, the email shortened (the owner the test made).
before=$(pg -d $DB -At -c "select md5(string_agg(to_jsonb(o)::text, '' order by ref)) from public.orders o" 2>/dev/null)
third=$(pg -d $DB -At -F '|' -f - < supabase-order-progress.sql 2>&1 | tail -1)
after=$(pg -d $DB -At -c "select md5(string_agg(to_jsonb(o)::text, '' order by ref)) from public.orders o" 2>/dev/null)
if [ "$before" = "$after" ] && echo "$third" | grep -q '^OK|OK|OK|OK|ow…@shop.test (owner)$'; then
  echo "   ✓ run a third time with orders in it: no order changed, and it names who may open the admin ($third)"
else
  echo "   ✗ run a third time with orders in it: no order changed, and it names who may open the admin (said: $third; orders same: $([ "$before" = "$after" ] && echo yes || echo no))"; fails=$((fails+1))
fi

# The wrong database: the platform's (it has app_state), and a website without
# supabase-pos-orders.sql. Each refused at step 1, with nothing created.
refuse(){ local name="$1" setup="$2" db="vq_progress_refuse"
  pg -d postgres -c "drop database if exists $db" >/dev/null 2>&1
  pg -d postgres -c "create database $db" >/dev/null 2>&1
  pg -d $db -f - < tests/pos-orders-fixture.sql >/dev/null 2>&1
  [ -n "$setup" ] && for f in $setup; do pg -d $db -f - < "$f" >/dev/null 2>&1; done
  [ "$name" = "the platform's database" ] && pg -d $db -c "create table public.app_state (id int primary key, data jsonb)" >/dev/null 2>&1
  local said; said=$(pg -d $db -f - < supabase-order-progress.sql 2>&1 | grep -m1 -o "ERROR: .*" | cut -c1-120)
  local made; made=$(pg -d $db -At -c "select (select count(*) from pg_proc where proname in ('vbp_pos_progress', 'order_progress_link'))
                                                 + (select count(*) from information_schema.columns where column_name = 'dispatched_at')
                                                 + (select count(*) from pg_trigger where tgname = 'orders_progress_guard_t')" 2>/dev/null)
  if [ -n "$said" ] && [ "${made:-1}" = "0" ]; then echo "   ✓ refused in $name, nothing created ($said)";
  else echo "   ✗ refused in $name, nothing created (said: ${said:-nothing}; made: $made)"; fails=$((fails+1)); fi
}
# The platform's database with everything else this file needs already in it
# (the till's door made before app_state appeared), so that only the guard
# against the platform's database can stop it.
refuse "the platform's database" "supabase-setup.sql supabase-pos-orders.sql"
refuse "a website without supabase-pos-orders.sql" "supabase-setup.sql supabase-payments.sql"
rm -f "$ERR"
pg -d postgres -c "drop database if exists vq_progress_refuse" >/dev/null 2>&1
pg -d postgres -c "drop database if exists $DB" >/dev/null 2>&1
total=$(( $(echo "$out" | grep -c '^   [✓✗]') + 3 ))
if [ "$fails" -eq 0 ]; then echo "order progress database: all $total checks passed"; else echo "order progress database: $fails of $total checks FAILED"; exit 1; fi
