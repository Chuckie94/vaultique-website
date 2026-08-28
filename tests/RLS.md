# Checking the database rules for real

Every policy in `supabase-setup.sql` used to say `auth.role() = 'authenticated'`,
which in Supabase means **anyone signed in**. That was safe only while the admin
was the one person who could sign in at all. Customer accounts ended that: a
customer who registered would have inherited write access to prices, settings,
reviews, policies, the photo bucket and the private table holding the bank
details.

These three files prove the fix against a real Postgres rather than by reading.

    # any Postgres 14+ will do
    initdb -D /tmp/pg/data -U postgres -A trust
    pg_ctl -D /tmp/pg/data -o '-k /tmp/pg -p 5433' start

    psql -h /tmp/pg -p 5433 -U postgres -f tests/rls-shim.sql     # the bits of Supabase the file assumes
    psql -h /tmp/pg -p 5433 -U postgres -f supabase-setup.sql     # the real file, twice, to prove it is safe to re-run
    psql -h /tmp/pg -p 5433 -U postgres -f supabase-setup.sql
    psql -h /tmp/pg -p 5433 -U postgres -f tests/rls-refuses.sql  # what a customer must not be able to do
    psql -h /tmp/pg -p 5433 -U postgres -f tests/rls-allows.sql   # what they must

`rls-allows.sql` ends by restoring the old policy for one query, so the
difference is visible rather than argued:

    === WHAT THE OLD POLICY WOULD HAVE DONE ===
     bank_account_a_customer_could_read
     0123456789

`account.test.js` carries a cheap static guard that fails if that weak check is
ever written into the setup file again. These scripts are the slower, realer
version of the same worry.
