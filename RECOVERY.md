# Recovery: what to do when something goes wrong

*Website build 92. For you, and for whoever helps you. Kept with the website
so it is there when it is needed. Each case: what you see, what to do, and
how you know it is done. Steps marked **(technical)** need someone at ease
with a computer's command line, or me in the chat, with this file.*

**Two rules for every case:**

1. **Never restore over a working shop.** A restore always goes into a *new*
   Supabase project, after a copy of what is there now has been made. The
   restore tool refuses a database that already has the shop's tables.
2. **Money is only ever taken on the gateway's word.** After any restore,
   run the check in step 6 before anything else: it asks Lenco and
   Flutterwave what happened after the copy, and holds refunds until you
   finish, so nothing is paid or refunded twice.

---

## The copies, in short

- **What is copied**: the website's database (the shop's tables with their
  rules, the customers' and the team's logins, the pictures' records) and
  every picture, by GitHub, every two hours (or every hour, D2), checked by
  restoring each copy into an empty database before it is kept.
- **Where**: your own storage account (Backblaze B2 or similar), in the
  bucket named in GitHub's secret `BACKUP_S3_BUCKET`: `copies/<time>/` and
  `pictures/`. Every copy for two days, then one a day for thirty days.
- **Sealed**: only your **private backup key** opens a copy
  (`vaultique-backup-private-key-<key>.pem`, made in Admin › Settings ›
  Backups). Keep it in two safe places. Without it, no copy can be opened.
- **How they are doing**: Admin › Settings › Backups. GitHub also emails
  you when a copy fails.

## The tools (technical)

On a computer with Node 20 or later and PostgreSQL 17's tools (`pg_dump`,
`pg_restore`, `psql`), in the website's folder, with the storage account's
details from GitHub's secrets set for the session:

```
export BACKUP_S3_ENDPOINT=…  BACKUP_S3_REGION=…  BACKUP_S3_BUCKET=…  BACKUP_S3_KEY_ID=…  BACKUP_S3_SECRET=…
node tools/backup/restore.cjs list
node tools/backup/restore.cjs open latest --key vaultique-backup-private-key-<key>.pem --out opened-copy
node tools/backup/restore.cjs pictures --key vaultique-backup-private-key-<key>.pem --out opened-pictures
```

`open` takes `latest` (the newest copy that checked out) or a copy's name
from `list` (such as `2026-11-27T0117Z`, which is UTC). It checks every file
against the copy's list before opening it, and refuses one that has changed.

---

## Step by step: restoring the website from a copy

Used by cases 1, 2, 3 and 10 below.

1. **Keep what is there now.** If the old project still answers, make a copy
   of it first: GitHub › Actions › Backup › Run workflow (not ticked:
   *drill*). If it does not answer, go on.
2. **Make a new Supabase project** (supabase.com › New project), in the
   same region as before. Note its database password.
3. **Open the copy (technical)**: `restore.cjs open` and `restore.cjs
   pictures`, above. Choose the newest copy from before the trouble began.
4. **Restore into the new project (technical)**. Its address is in Supabase
   › Connect › *Session pooler*:
   ```
   node tools/backup/restore.cjs into --from opened-copy --db "postgresql://postgres.<new project>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres" --i-have-a-copy-of-what-is-there
   ```
   It restores the logins first, then the shop's tables with their rules,
   then the pictures' records, and counts every table against the copy.
   Each line says *done* or *FAILED* with the reason.
   Then the pictures, with the new project's service key (Supabase ›
   Project Settings › API):
   ```
   node tools/backup/restore.cjs pictures-into --from opened-pictures --url https://<new project>.supabase.co --service-key <service key>
   ```
   If a picture's bucket is missing, make it in Supabase › Storage with the
   same name, and run that line again.
5. **Point the website at the new project**: Netlify › Site configuration ›
   Environment variables: `WEB_SUPABASE_URL`, `WEB_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY` (the new project's); and `config.js` in the
   repository (its address and anon key). In Supabase › Authentication ›
   URL Configuration, the site's address as before. Then Netlify › Deploys
   › Trigger deploy. Update GitHub's `BACKUP_DB_URL`,
   `SUPABASE_SERVICE_ROLE_KEY` and `WEB_SUPABASE_URL` too, so the copies go
   on from the new project.
6. **The check after a restore**: Admin › Settings › Backups › *After a
   restore*: the time the copy was made (its name, in UTC), then *Check the
   gateways now*. Refunds are held from that moment. You get an email:
   - payments waiting in the copy that the gateway confirms: marked paid,
     the customers emailed;
   - payments made **after** the copy: their orders were lost with it;
     contact each customer (the list has the reference and amount);
   - refunds made after the copy: record them on the platform, and do not
     refund them again.
   When every line is dealt with: *The restore is finished*. Refunds can be
   sent again.
7. **Customers sign in again** (their sessions are not copied, on purpose);
   their passwords and accounts are as they were.

**Done when** the shop opens, Admin › Orders shows the orders up to the
copy, the check in step 6 is finished, and the next copy (within two hours)
checks out in Admin › Settings › Backups.

---

## The ten cases

### 1. A database failure

*You see*: the shop shows no pieces or says it cannot load; the admin
cannot sign in; Supabase's dashboard shows the project unhealthy or gone.

*Do*: first, Supabase's status page (status.supabase.com) and your
project's dashboard: a paused free project is woken with *Restore
project*, and nothing is lost. If the project is gone or its data damaged:
**restore from a copy** (above), into a new project.

*Done when*: as above.

### 2. A deletion

*You see*: orders, customers, policies or settings missing that were there.

*Do*: Admin › Fraud & Risk › the sealed record shows who deleted what, and
when. For one or two records: open the newest copy from before the
deletion (technical) and copy those rows back by hand, with me in the chat.
For a large deletion: **restore from a copy** made before it, into a new
project. Then Settings › Users & Roles: was it someone who should not
have been able to? (case 5).

*Done when*: the records are back, and the cause is known.

### 3. Corrupted data

*You see*: figures that make no sense (orders with wrong totals, settings
reset), or Admin › Fraud & Risk › *Check the record now* says NOT INTACT.

*Do*: keep the page as it is, and the record's message. Find the last copy
from before it began (copies are kept for thirty days, one a day): restore
it into a new project and compare, with me in the chat, before deciding
which to keep.

*Done when*: the shop runs on data you trust, and the record checks out.

### 4. A failed deploy

*You see*: Netlify › Deploys shows *Failed*, or the shop looks broken after
an upload.

*Do*: a deploy whose checks fail is never published (build 84): the site
that was live stays live. If a bad one was published anyway: Netlify ›
Deploys › the last good deploy › *Publish deploy*. Nothing in the database
changes. Send me the deploy's log lines.

*Done when*: https://vaultiqueboutique.com/api/health says "working" and
the build you expect.

### 5. A stolen admin account

*You see*: changes nobody at the shop made, sign-ins you do not recognise,
or a team member's phone or laptop lost.

*Do*, at once: Settings › Users & Roles: switch that person off (an owner
cannot be switched off: change the owner's password and two-factor in
Supabase › Authentication). Supabase › Authentication › Users › that user
› *Sign out* (all sessions). If the service key may have been seen: make a
new one (Supabase › Project Settings › API) and put it in Netlify and
GitHub. Then Admin › Fraud & Risk › the sealed record: what that account
changed, and when; undo it (case 2).

*Done when*: the account is closed, keys changed, and every change it made
is checked.

### 6. A payment gateway failing (Lenco or Flutterwave)

*You see*: customers say they cannot pay; Settings › Payments shows a
gateway's errors; payments stay *awaiting*.

*Do*: Settings › Payments: switch the failing gateway off (*Use Lenco* or
*Use Flutterwave*). If the other is approved and ready, it takes the
payments; if not, customers order on WhatsApp, as before online payment.
Payments already started are not lost: the fifteen-minute check-up keeps
asking the gateway about each, and marks them paid only on its word.
Contact the gateway's support with the time and a payment's reference.

*Done when*: the gateway works again (Settings › Payments: its last check
is fine) and is switched back on; or the other gateway carries on.

### 7. The platform link failing

*You see*: the shop shows no pieces or old prices; website orders do not
reach the till; Settings › System & Maintenance says the platform cannot
be reached.

*Do*: https://vaultiqueboutique.com/api/rewards-check and /api/products say
what is wrong. Most often the platform's door key: it is `POS_PUBLIC_KEY`
in Netlify (never the platform's secret key). Check the platform's own
Supabase is running. Website orders are kept on the website in the
meantime, and reach the till when the link is back.

*Done when*: /api/products lists the pieces, and a test order reaches the
till.

### 8. Lost settings

*You see*: email not sending, payments switched off, the shop's wording
gone; or a Netlify setting deleted.

*Do*: admin settings are in the database: restore them from the newest
copy (technical, case 2), or set them again (the activity log shows what
they were, except private values). Netlify's settings are listed below by
name: set each again from where it came from (never from this file: it
holds no values).

*Done when*: Settings › Notifications › *Send a test email* works, and
Settings › Payments shows each gateway ready as before.

### 9. A failed SQL file

*You see*: a SQL file stopped with an ERROR in Supabase's SQL Editor, or
its last line does not say OK.

*Do*: every SQL file only adds, and is safe to run again: run it again,
whole. If it stops at the same place, send me the error line; the files
before it are not undone by it. Never edit a file to make it pass. A file
run twice by mistake does no harm.

*Done when*: its last line says OK.

### 10. Everything down

*You see*: the shop and the admin both unreachable.

*Do*, in order: Netlify's status (netlifystatus.com) and your site in
Netlify; Supabase's status and your project; your domain's renewal and
DNS. Customers can still order on WhatsApp. If Supabase's project is lost:
**restore from a copy** into a new one. If Netlify's site is lost: make a
new site from the GitHub repository (Netlify › Add new site › Import from
GitHub), set its settings (below), and point the domain at it.

*Done when*: the shop opens, an order can be placed, and the next copy
checks out.

---

## The drill, every three months

So a restore is never tried for the first time in an emergency.

1. GitHub › Settings › Secrets and variables › Actions › *New repository
   secret*: `BACKUP_PRIVATE_KEY`, the whole contents of your private key
   file (from `-----BEGIN PRIVATE KEY-----` to the end).
2. GitHub › Actions › Backup › *Run workflow*, *drill* ticked. It opens the
   newest copy that checked out with your key, checks every file against its
   list, restores it into an empty database, and compares every table and row.
3. **Delete the secret `BACKUP_PRIVATE_KEY`** again when it has finished:
   between drills, GitHub must hold only the public half.
4. Admin › Settings › Backups: *The last drill* says when, and that it passed.

---

## The settings, by name (never their values)

**Netlify** (Site configuration › Environment variables). This list is
checked against the website's code by its tests, so a new setting is
never missing from it.

| Name | What it is, and where it comes from |
|---|---|
| `WEB_SUPABASE_URL` | the website's Supabase address (Supabase › Project Settings › API) |
| `WEB_SUPABASE_ANON_KEY` | its public (anon) key, the same place |
| `SUPABASE_SERVICE_ROLE_KEY` | its service key, the same place (secret) |
| `WEB_SUPABASE_SERVICE_KEY` | an older name for the service key, read if the one above is missing |
| `SITE_SUPABASE_URL`, `SITE_SUPABASE_ANON_KEY` | older names for the first two, read if those are missing |
| `POS_SUPABASE_URL` | the platform's Supabase address |
| `POS_PUBLIC_KEY` | the platform's door key for the website (never its secret key) |
| `POS_SUPABASE_KEY` | must **not** be set (build 77): the platform's secret key |
| `POS_REWARDS_KEY` | the platform's rewards door key |
| `POS_STATE_ROW` | which row of the platform's state holds the products (only if told so) |
| `LENCO_SECRET_KEY_TEST`, `LENCO_PUBLIC_KEY_TEST`, `LENCO_API_BASE_TEST` | Lenco's sandbox token, public key and API address |
| `LENCO_SECRET_KEY_LIVE`, `LENCO_PUBLIC_KEY_LIVE`, `LENCO_API_BASE` | Lenco's live token and public key, and its live API address if not the usual one |
| `FLW_SECRET_KEY_TEST`, `FLW_SECRET_KEY_LIVE`, `FLW_WEBHOOK_HASH` | Flutterwave's keys and webhook hash (dashboard › Settings › API) |
| `FLW_API_BASE` | Flutterwave's API address, only if told so |
| `CARD_BINS_ZM` | the list of card numbers' first digits issued in Zambia, when cards are routed (DPO, later) |
| `CSP_SCRIPTS`, `CSP_REPORTS` | the security policy's switches (SETUP.md) |
| `ANALYTICS_KEEP_DAYS`, `LOW_STOCK_AT` | optional figures (SETUP.md) |
| `VBP_DEPLOY_GATE`, `VBP_IN_GATE` | the deploy step's own; never set by hand |
| `URL` | set by Netlify itself |

**GitHub** (Settings › Secrets and variables › Actions), for the copies:

| Name | Kind | What it is |
|---|---|---|
| `BACKUP_ON` | variable | `yes` to make copies on the schedule |
| `BACKUP_EVERY_HOURS` | variable | `2` (the start) or `1` |
| `BACKUP_PUBLIC_KEY` | variable | the public half of your backup key |
| `WEB_SUPABASE_URL` | variable | the website's Supabase address |
| `BACKUP_DB_URL` | secret | the database's *Session pooler* address, with its password |
| `SUPABASE_SERVICE_ROLE_KEY` | secret | the website's service key (for the pictures and the record) |
| `BACKUP_S3_ENDPOINT`, `BACKUP_S3_REGION`, `BACKUP_S3_BUCKET` | secrets | the storage account's address, region and bucket |
| `BACKUP_S3_KEY_ID`, `BACKUP_S3_SECRET` | secrets | the storage account's key for that bucket |
| `BACKUP_PRIVATE_KEY` | secret | **only during a drill**, then deleted |
