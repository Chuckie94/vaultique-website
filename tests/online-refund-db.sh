#!/usr/bin/env bash
# ===========================================================================
# The online refund database test (website build 81), on a scratch
# PostgreSQL (never the live one). Builds the website's database from its own
# files, in the live order, runs supabase-online-refund.sql twice, then
# tests/online-refund.sql; runs the file a third time with refunds in it; and
# checks the file refuses the platform's database, and a website without an
# order's progress (supabase-order-progress.sql), creating nothing.
#
# Run by tools/sql-tests.sh, after its chains, the same way as the order
# progress test: psql as AS_USER when that is set (sudo on GitHub), as you
# otherwise. Or by hand:
#
#   VBP_TEST_PG="-h /path/to/socket -p 5432 -U postgres" bash tests/online-refund-db.sh
#
# Never point it at the shop's real Supabase: it drops and creates the two
# databases it uses (vq_refund_test, vq_refund_refuse).
# ===========================================================================
set -u
cd "$(dirname "$0")/.." || exit 9
pg() {
  if [ -n "${VBP_TEST_PG:-}" ]; then psql $VBP_TEST_PG -X -q -v ON_ERROR_STOP=1 "$@"
  elif [ -n "${AS_USER:-}" ]; then su "$AS_USER" -c "psql -X -q -v ON_ERROR_STOP=1 $(printf '%q ' "$@")"
  else psql -X -q -v ON_ERROR_STOP=1 "$@"; fi
}
ERR=$(mktemp)
DB=vq_refund_test
pg -d postgres -c "drop database if exists $DB" >/dev/null 2>&1
pg -d postgres -c "create database $DB" >/dev/null 2>&1 || { echo "   ✗ cannot make the database $DB"; exit 2; }
for f in tests/pos-orders-fixture.sql supabase-setup.sql supabase-payments.sql tests/pos-orders-admins.sql \
         supabase-rewards.sql supabase-pos-orders.sql supabase-payment-history.sql \
         tests/order-progress-fixture.sql supabase-order-progress.sql \
         supabase-online-refund.sql supabase-online-refund.sql; do
  pg -d $DB -f - < "$f" >/dev/null 2>"$ERR" || { echo "   ✗ loading $f failed:"; cat "$ERR"; exit 3; }
done
out=$(pg -d $DB -At -f - < tests/online-refund.sql 2>&1)
echo "$out" | grep -E '^   (✓|✗)'
fails=$(echo "$out" | grep -c '^   ✗')
if ! echo "$out" | grep -q 'online refund database: all'; then
  echo "   ✗ tests/online-refund.sql did not finish:"; echo "$out" | grep -E 'ERROR|LINE' | head -4; fails=$((fails+1))
fi

# Run a third time, now with refunds and orders in it: still safe, and it
# changes no refund and no order.
sig="select md5(coalesce((select string_agg(to_jsonb(r)::text, '' order by request_key) from public.refunds r), '')
              || coalesce((select string_agg(to_jsonb(o)::text, '' order by ref) from public.orders o), ''))"
before=$(pg -d $DB -At -c "$sig" 2>/dev/null)
third=$(pg -d $DB -At -F '|' -f - < supabase-online-refund.sql 2>&1 | tail -1)
after=$(pg -d $DB -At -c "$sig" 2>/dev/null)
if [ -n "$before" ] && [ "$before" = "$after" ] && echo "$third" | grep -q '^OK|OK · the platform can reach them with its own key|6$'; then
  echo "   ✓ run a third time with refunds in it: no refund or order changed, and it counts them ($third)"
else
  echo "   ✗ run a third time with refunds in it: no refund or order changed, and it counts them (said: $third; same: $([ "$before" = "$after" ] && echo yes || echo no))"; fails=$((fails+1))
fi

# The wrong database: the platform's (it has app_state), and a website without
# supabase-order-progress.sql. Each refused at step 1, with nothing created.
refuse(){ local name="$1" setup="$2" db="vq_refund_refuse"
  pg -d postgres -c "drop database if exists $db" >/dev/null 2>&1
  pg -d postgres -c "create database $db" >/dev/null 2>&1
  pg -d $db -f - < tests/pos-orders-fixture.sql >/dev/null 2>&1
  [ -n "$setup" ] && for f in $setup; do pg -d $db -f - < "$f" >/dev/null 2>&1; done
  [ "$name" = "the platform's database" ] && pg -d $db -c "create table public.app_state (id int primary key, data jsonb)" >/dev/null 2>&1
  local said; said=$(pg -d $db -f - < supabase-online-refund.sql 2>&1 | grep -m1 -o "ERROR: .*" | cut -c1-120)
  local made; made=$(pg -d $db -At -c "select (select count(*) from pg_proc where proname in ('vbp_pos_refund_find', 'vbp_pos_refund_request', 'vbp_pos_refunds', 'refund_out'))
                                                 + (select count(*) from pg_class where relname = 'refunds')
                                                 + (select count(*) from pg_trigger where tgname in ('refunds_guard_t', 'refunds_to_order_t'))" 2>/dev/null)
  if [ -n "$said" ] && [ "${made:-1}" = "0" ]; then echo "   ✓ refused in $name, nothing created ($said)";
  else echo "   ✗ refused in $name, nothing created (said: ${said:-nothing}; made: $made)"; fails=$((fails+1)); fi
}
# The platform's database with everything else this file needs already in it
# (the website's files loaded before app_state appeared), so that only the
# guard against the platform's database can stop it.
refuse "the platform's database" "supabase-setup.sql supabase-payments.sql tests/pos-orders-admins.sql supabase-pos-orders.sql supabase-order-progress.sql"
refuse "a website without supabase-order-progress.sql" "supabase-setup.sql supabase-payments.sql tests/pos-orders-admins.sql supabase-pos-orders.sql"
rm -f "$ERR"
pg -d postgres -c "drop database if exists vq_refund_refuse" >/dev/null 2>&1
pg -d postgres -c "drop database if exists $DB" >/dev/null 2>&1
total=$(( $(echo "$out" | grep -c '^   [✓✗]') + 3 ))
if [ "$fails" -eq 0 ]; then echo "online refund database: all $total checks passed"; else echo "online refund database: $fails of $total checks FAILED"; exit 1; fi
