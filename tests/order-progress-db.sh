#!/usr/bin/env bash
# ===========================================================================
# The order-progress database test, on a scratch PostgreSQL (never the live
# one). Builds the website's database from its own files, in the live order,
# runs supabase-order-progress.sql twice, then tests/order-progress.sql; and
# checks the file refuses the wrong database, and a website without the
# till's door, creating nothing.
#
#   VBP_TEST_PG="-h /path/to/socket -p 5432 -U postgres" bash tests/order-progress-db.sh
#
# Without VBP_TEST_PG it says so and stops: it does not guess a database.
# ===========================================================================
set -u
cd "$(dirname "$0")/.." || exit 9
if [ -z "${VBP_TEST_PG:-}" ]; then
  echo "order progress database: NOT RUN here (set VBP_TEST_PG to a scratch PostgreSQL)"; exit 0
fi
PG="$VBP_TEST_PG -X -q -v ON_ERROR_STOP=1"
DB=vq_progress_test
psql $PG -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null 2>&1 || { echo "cannot make $DB"; exit 2; }
for f in tests/pos-orders-fixture.sql supabase-setup.sql supabase-payments.sql tests/pos-orders-admins.sql \
         supabase-rewards.sql supabase-pos-orders.sql supabase-payment-history.sql \
         tests/order-progress-fixture.sql supabase-order-progress.sql supabase-order-progress.sql; do
  psql $PG -d $DB -f "$f" >/dev/null 2>/tmp/vq-progress-load.err || { echo "loading $f failed:"; cat /tmp/vq-progress-load.err; exit 3; }
done
out=$(psql $PG -d $DB -At -f tests/order-progress.sql 2>&1)
echo "$out" | grep -E '^   (✓|✗)'
fails=$(echo "$out" | grep -c '^   ✗')

# Run a third time, now with orders, an owner and the customer's steps in it:
# still safe, still changes no order, and its last result names who may open
# the admin, the email shortened (the owner the test made).
before=$(psql $PG -d $DB -At -c "select md5(string_agg(to_jsonb(o)::text, '' order by ref)) from public.orders o" 2>/dev/null)
third=$(psql $PG -d $DB -At -F '|' -f supabase-order-progress.sql 2>&1 | tail -1)
after=$(psql $PG -d $DB -At -c "select md5(string_agg(to_jsonb(o)::text, '' order by ref)) from public.orders o" 2>/dev/null)
if [ "$before" = "$after" ] && echo "$third" | grep -q '^OK|OK|OK|OK|ow…@shop.test (owner)$'; then
  echo "   ✓ run a third time with orders in it: no order changed, and it names who may open the admin ($third)"
else
  echo "   ✗ run a third time with orders in it: no order changed, and it names who may open the admin (said: $third; orders same: $([ "$before" = "$after" ] && echo yes || echo no))"; fails=$((fails+1))
fi

# The wrong database: the platform's (it has app_state), and a website without
# supabase-pos-orders.sql. Each refused at step 1, with nothing created.
refuse(){ local name="$1" setup="$2" db="vq_progress_refuse"
  psql $PG -d postgres -c "drop database if exists $db" -c "create database $db" >/dev/null 2>&1
  psql $PG -d $db -f tests/pos-orders-fixture.sql >/dev/null 2>&1
  [ -n "$setup" ] && for f in $setup; do psql $PG -d $db -f "$f" >/dev/null 2>&1; done
  [ "$name" = "the platform's database" ] && psql $PG -d $db -c "create table public.app_state (id int primary key, data jsonb)" >/dev/null 2>&1
  local said; said=$(psql $PG -d $db -f supabase-order-progress.sql 2>&1 | grep -m1 -o "ERROR: .*" | cut -c1-120)
  local made; made=$(psql $PG -d $db -At -c "select (select count(*) from pg_proc where proname in ('vbp_pos_progress', 'order_progress_link'))
                                                 + (select count(*) from information_schema.columns where column_name = 'dispatched_at')
                                                 + (select count(*) from pg_trigger where tgname = 'orders_progress_guard_t')" 2>/dev/null)
  if [ -n "$said" ] && [ "${made:-1}" = "0" ]; then echo "   ✓ refused in $name, nothing created ($said)";
  else echo "   ✗ refused in $name, nothing created (said: ${said:-nothing}; made: $made)"; fails=$((fails+1)); fi
}
refuse "the platform's database" "supabase-setup.sql"
refuse "a website without supabase-pos-orders.sql" "supabase-setup.sql supabase-payments.sql"
total=$(( $(echo "$out" | grep -c '^   [✓✗]') + 3 ))
if [ "$fails" -eq 0 ]; then echo "order progress database: all $total checks passed"; else echo "order progress database: $fails of $total checks FAILED"; exit 1; fi
