A STAND-IN FOR SUPABASE, FOR CHECKING THE SQL FILES (build 76)

For whoever looks after the website. Nothing here is uploaded to Netlify or
run on the shop's Supabase.

tools/db-check.sh builds a scratch database on a plain PostgreSQL 16 that
behaves like a hosted Supabase project where it matters (roles, default
grants, auth.uid(), two-factor factors, pgcrypto in "extensions", storage,
realtime), runs the 28 setup files and supabase-hardening.sql on it, and
checks the result.

One-time setup: supabase-chat-phase7.sql runs "create extension pg_net".
PostgreSQL needs the two pg_net files here to accept that (they install
nothing; supabase-standin.sql supplies stand-ins that only log the calls):

  sudo cp tests/supabase-standin/pg_net.control tests/supabase-standin/pg_net--0.1.sql \
          "$(pg_config --sharedir)/extension/"

Then:

  bash tools/db-check.sh                    (or: AS_USER=postgres bash tools/db-check.sh)

It ends with ALL GOOD, or says what failed.
