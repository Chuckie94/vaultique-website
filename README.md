# Vaultique Boutique Point — Website

The online shop of Vaultique Boutique Point (Lusaka, Zambia): a storefront
with WhatsApp checkout and online payment, customer accounts, a live chat,
Vaultique Rewards, and an admin for the shop's staff. The pieces, their prices
and their stock come from the business platform, read through a door that
hands out the shop window and nothing else. The website never writes to the
platform.

The steps for the shop are in START-HERE.txt (each build) and SETUP.md (once,
and for every setting).

---

## How it fits together

```
  a visitor's browser                       a member of staff's browser
  index.html + assets/                      admin.html + assets/admin/
          │                                           │
          └────────────── Netlify ────────────────────┘
                 publishes dist/, made by tools/build-site.cjs on every deploy,
                 and runs the functions in netlify/functions/
                      │                  │                     │
                      ▼                  ▼                     ▼
       the website's own Supabase   the business platform's   Flutterwave, and the
       settings, orders, customers, Supabase, read only,      shop's own email account
       chat, analytics, rewards     through two doors
       links: every rule in the
       database itself
```

**The storefront** (`index.html`, `assets/app.js` and the files beside it)
draws the shop from `/api/products` and the website's settings, takes WhatsApp
orders and online payments, and runs the chat, customer accounts and rewards.

**The admin** (`admin.html`, `assets/admin/`) is for the shop's staff: orders,
products' photos and details, live chats, reviews, subscribers, analytics and
every setting. What each member of staff may see and do is decided by the
database, from their role's ticks and two-factor, not by which tabs the page
draws (`supabase-hardening.sql`).

**What Netlify publishes.** Netlify runs `tools/build-site.cjs` on every
deploy. It copies `index.html`, `admin.html`, `config.js`, `sw.js`,
`manifest.webmanifest`, `assets/` and `images/` into `dist/`, and Netlify
publishes `dist/` alone, so nothing else in the folder can be served, whatever
it is called. The same step stops the deploy if `config.js` is missing or still
holds the example's placeholders, or if Netlify still holds the platform's
secret key; puts a fingerprint (`?v=…`) on every script and stylesheet address
in the two pages; and writes the Content Security Policy (report-only for now)
into `dist/_headers`. Never upload a `dist/` folder.

**The functions** (`netlify/functions/`) are the only code that holds a
secret. The files starting `_` are shared by the others.

| Function | What it does |
|---|---|
| `products` | The product feed, `/api/products`: the shop window, through the platform's products-only door |
| `product-pulse` | Every five minutes: notices the catalogue changed and tells open pages to refresh |
| `place-order` | A WhatsApp order, priced here from the catalogue and recorded, with the customer's delivery instructions (build 89) |
| `pay-quote`, `pay-start`, `pay-status` | Online payment: the price, the start (with the gateway that takes the way of paying chosen, build 88), and where a payment is, on its gateway's own word; `pay-status?check=1` also says which ways of paying can be paid now; `pay-status` POST `cancel`: Cancel payment, from the page that started it, Lenco asked first (build 88) |
| `_lenco.js` | Lenco, the primary gateway (build 88): mobile money requests, a payment's status, the signature on Lenco's webhooks, the card window's public settings; built from Lenco's API reference v2.0 |
| `lenco-webhook` | Lenco's notices (build 88): signed, or refused; then Lenco is asked; each signed notice kept |
| `_cardroute.js` | Which gateway takes a card (build 88, ready, routing nothing yet): by the customer's choice, **Pay with Zambian card** (Lenco) or **Pay with international card** (DPO, once a later build connects it; the two buttons from build 89); never a card detail typed on the website |
| `pay-webhook` | Flutterwave's notices, as before (Flutterwave is off until switched on, build 88) |
| `pay-reconcile` | Every fifteen minutes (build 80): asks the gateway about any payment the site has not heard back about (Lenco's too from build 88) |
| `product-alerts` | Every thirty minutes (build 90): emails a customer once when a piece they asked about is back in stock or cheaper than when they asked, at the shop's own price |
| `_risk.js` | The fraud check (build 91): scores a payment before it starts and when it is paid, a WhatsApp order and a refund, from records the site already keeps; watches first (D5), and acting holds High and refuses Critical |
| `risk-watch` | Every fifteen minutes (build 91): the team's own activity scored from the sealed record, held payments approved in Admin > Fraud & Risk released on the gateway's word, escalations emailed to the owner, the record anchored |
| `risk-release` | A held payment just approved, released at once: its gateway asked again, and paid only on its word (build 91) |
| `after-restore` | After a restore from a backup (build 92): refunds held until you finish; payments waiting in the copy confirmed on the gateway's word; payments and refunds made after the copy found on Lenco's and Flutterwave's own lists (the owner only) |
| `order-progress` | Every fifteen minutes (build 80): an order's emails (on its way, the reminder, delivered, refunded), and marking delivered when the days run out; from build 87, customers' requests: the shop told of each new one, the customer of each answer; from build 89, the courier and tracking number in the on-its-way email (or one of their own when given later), and the shop told when a customer changes their delivery instructions |
| `account-delete` | Closing a customer's account, the login included; never a login on the admin list (build 80) |
| `account-portal` | The customer portal's records that only the shop may read, for the signed-in customer alone: the newsletter yes or no, refunds on their way, "Download my personal data" (build 86; their requests in it from 87) |
| `pay-refund` | The platform's online refunds (build 81): sends a refund the platform's door wrote down to Flutterwave, once, and records the answer; only with the door's key |
| `account-signup` | Creating a customer account; the confirm link goes through the shop's own email |
| `send-email` | The admin's "Send a test email" and "Send welcome" |
| `newsletter` | Joining the newsletter, and the link that puts somebody who left back on it |
| `admin-users` | The owner adding and removing staff logins |
| `rewards`, `rewards-check` | Vaultique Rewards, through the platform's rewards door; `/api/rewards-check` says whether the door answers |
| `chat-push` | A customer's chat message buzzes the staff's phones |
| `visit-where`, `places` | Where a visit came from, and the town lists for "Where are you browsing from?" |
| `site-prune` | Every night: throws away raw analytics nobody will read again |
| `robots`, `sitemap`, `manifest`, `social-image` | `/robots.txt`, `/sitemap.xml`, the installed app's name, and the picture on a shared link |
| `csp-report` | Receives the security policy's reports, for the function log |

**The website's own Supabase** holds the settings, orders, customers and their
accounts, chats, reviews, subscribers, analytics and the rewards links. It is
built by the 28 `supabase-*.sql` files and `supabase-hardening.sql`, in the
order SETUP.md gives, then the three made after it (build 80, from the other
line's builds 76 to 78): `supabase-pos-orders.sql` (the platform's till),
`supabase-payment-history.sql` and `supabase-order-progress.sql`, each followed
by the hardening once more. On a shop already running, only the hardening is
ever run again. Its rules live in the database itself: a visitor, a customer and each
member of staff can read and write exactly what their role allows, however
they ask.

**The platform's till** reaches this website the other way, through a door of
this website's own (`supabase-pos-orders.sql`, build 80): it finds an order by
its number, rings it up, and moves it on (`supabase-order-progress.sql`), with
a key of its own that the database keeps only as a fingerprint.

**The business platform** is read, never written, through two doors in its
own Supabase: the products-only door (the shop window) and the rewards door
(one customer's points, or the email to send a code to). Both are asked with
the platform's publishable key; the rewards door also with its own key. The
platform's secret key is not used by anything, and Netlify will not publish
the website while it is set (below, "The platform's doors").

**Keys, and where each one lives.** `config.js` holds this website's Supabase
address and its public (anon) key, which every visitor's browser reads anyway.
Everything secret is in Netlify's environment variables, read only by the
functions: the website's service key, the rewards door's key, and the
Flutterwave keys (SETUP.md has the full list). The email password is in a
database row only the functions can read. No secret ever reaches a browser.

---

## Folder structure

```
index.html, admin.html     the storefront and the admin
config.js                  this site's Supabase address and public key (yours; never in a zip)
sw.js, manifest.webmanifest  the installable app
assets/                    the scripts and styles; assets/admin/ the admin's, one file per Settings category
                           in assets/admin/settings/; assets/vendor/ the Supabase library and Leaflet, kept here
images/                    optional photos (see images/README.txt)
netlify.toml               Netlify: the build step, addresses, headers, scheduled functions
netlify/functions/         the functions (above)
supabase-*.sql             the website's database: the 28 files and supabase-hardening.sql (SETUP.md)
tools/                     build-site.cjs (run by Netlify on every deploy), live-check.cjs (checks the
                           live site from outside), db-check.sh and sql-tests.sh (the database, checked)
tests/                     the checks (below), with package.json to install what they need
.github/workflows/         tests.yml: the checks, run by GitHub on every push (build 79)
START-HERE.txt, HOW-TO-UPLOAD.txt, SETUP.md, README.md, LAUNCH.md   the documents
```

---

## Tests

The checks that ship with the folder, so any later change can be checked
rather than taken on trust. None of them is published, and none touches the
shop: every database is a scratch one made on the spot.

**All of them, from `tests/`** (Node 18 or later; PostgreSQL 16 for the SQL):

```
cd tests
npm ci                          once: Playwright and Leaflet, the versions the checks were made with
npx playwright install chromium once: the browser the browser checks drive
npm run test:node               every Node check: the functions, the build step   (seconds)
npm run test:browser            every browser check: the shop and the admin       (10 to 20 minutes)
npm run test:sql                the SQL chains, then the stand-in Supabase        (needs PostgreSQL)
npm test                        Node, then browser
```

**Netlify runs the same node checks (`node tests/run-tests.js node`) before every deploy** (build 84,
`tools/build-site.cjs` step 6), with none of its settings, and publishes
nothing if one fails. A **critical** file (payments, refunds, orders, sign-in,
security: `CRITICAL` in `tests/run-tests.js`) is never given a second try, and
a file that skips some or all of its checks (it needs a database, or a copy of
the platform beside the website) is shown with a dash and named at the end,
never counted as passed; a critical one that skips fails the run.

`node tests/run-tests.js node send-email product-door` runs only the files
named. A browser file that fails is run once more: if it passes then, the
summary names it as passed only on the second try (on GitHub, as a warning)
so it can be made steadier, and if it fails again the run fails. The Node
files are run once. The SQL needs the pg_net stand-in installed once
(tests/supabase-standin/README.txt), and the user that may create databases:
`AS_USER=postgres npm run test:sql` from a root shell.

**On GitHub, on every push** (build 79): `.github/workflows/tests.yml` runs
the Node checks, the browser checks, and the database (the stand-in Supabase,
the SQL chains and the browser-to-database round trip) on GitHub's own
computers. A failure shows as a red cross beside the commit; the Actions tab
says which check and why. It needs no keys, and touches nothing of the shop's.

**One at a time**, as each file says at its top:

```
node tests/product-sync.test.cjs        the product feed and the pulse
node tests/product-door.test.cjs        the feed and the pulse through the products-only door
node tests/analytics.browser.cjs        what a visit records, in a real browser
psql -d <scratch db> -f tests/analytics-fixture.sql \
                     -f supabase-analytics.sql \
                     -f tests/analytics.sql     the analytics database
VBP_TEST_DB=<url> node tests/analytics.roundtrip.cjs   browser to database, end to end
node tests/chat.browser.cjs             the chat window, in a real browser
node tests/cart-stock.browser.cjs       the cart stops at the stock
node tests/phone-layout.browser.cjs     the phone layout, and a desktop left as it was
node tests/collection-pictures.browser.cjs   uploaded category pictures on the homepage
node tests/shop-locations.cjs           the admin finds each shop location for the map
node tests/visit-map.browser.cjs        the map pins those places (needs npm install leaflet)
node tests/fast-load.browser.cjs        hero first, settings alongside products, photos shrunk
node tests/chat-photos.browser.cjs      a customer sends a photo in the chat, shrunk first
node tests/payments.test.cjs            the payment functions, and attempts to cheat them
node tests/payments.browser.cjs         paying online end to end; WhatsApp checkout unchanged
node tests/payment-settings.cjs         the admin switches for online payment and delivery
node tests/delivery-zones.test.cjs      delivery fees by town zone and parcel weight
node tests/analytics-payments.browser.cjs  Analytics: how orders were paid
node tests/password-reset.browser.cjs   "Forgot your password?" on the admin and customer accounts
node tests/chat-desk.browser.cjs        chats taken when opened, "Taken by", @mentions and hand-over
node tests/chat-push-mention.test.cjs   a mention notifies only the colleague it names
psql -d <scratch db> -f tests/chat-jobs-fixture.sql -f tests/chat-mentions-fixture.sql \
     -f supabase-chat-mentions.sql -f tests/chat-mentions.sql      taking and mentions, in the database
psql -d <scratch db> -f tests/chat-jobs-fixture.sql -f tests/chat-mentions-fixture.sql \
     -f supabase-chat-mentions.sql -f supabase-chat-handover.sql -f tests/chat-handover.sql
psql -d <scratch db> -f tests/analytics-fixture.sql -f supabase-analytics.sql -f tests/analytics-live-fixture.sql \
     -f supabase-analytics-live.sql -f tests/analytics-live.sql      live figures, goodbye and the map
node tests/analytics-live.browser.cjs     the Analytics page updates by itself, and the visitor map
node tests/motion.browser.cjs            fades, the cart confirmation, photos that swipe by themselves
psql -d <scratch db> -f tests/analytics-fixture.sql -f supabase-analytics.sql \
     -f supabase-analytics-sources.sql -f tests/analytics-sources.sql   where visitors came from
node tests/rewards-engine.test.cjs       the website's points match the till's, to the point
node tests/rewards-function.test.cjs     linking, live points and promises; nothing about a customer said or kept
node tests/rewards-door.test.cjs         the same, through the platform's rewards door, the only way since build 77
node tests/rewards.browser.cjs           the account card and using points on a WhatsApp order
node tests/admin-rewards.browser.cjs     Admin > Rewards
psql -d <scratch db> -f tests/analytics-fixture.sql -f supabase-rewards.sql -f tests/rewards.sql   who may read and change what
node tests/visit-where.test.cjs           where a visit came from: Netlify's place, no internet address, or the town the visitor named
node tests/places.test.cjs                country, province, town: the lists behind "Where are you browsing from?"
node tests/where-ask.browser.cjs          "Where are you browsing from?" as a visitor sees it
node tests/chat-push.test.cjs             the phone buzz as it leaves: urgent, one per conversation, still decrypts;
                                          and a customer told the shop has replied, within the hours set (build 83)
node tests/chat-alerts.browser.cjs        the desk chimes at once: admin in the background, or on any admin page
psql -d <scratch db> -f tests/analytics-fixture.sql -f supabase-analytics.sql -f supabase-cart-pieces.sql \
     -f tests/cart-pieces.sql             which pieces were added to carts
psql -d <scratch db> -f tests/analytics-fixture.sql -f supabase-analytics.sql -f tests/analytics-live-fixture.sql \
     -f supabase-analytics-live.sql -f supabase-browsing-towns.sql -f tests/browsing-towns.sql   told and guessed towns
psql -d <scratch db> -f tests/chat-jobs-fixture.sql -f tests/chat-realtime-fixture.sql \
     -f supabase-chat-realtime.sql -f tests/chat-realtime.sql   the shop typing reaches the customer live
psql -d <scratch db> -f tests/payments-fixture.sql -f supabase-payments.sql \
     -f tests/payments.sql                                   who may mark an order paid
psql -d <scratch db> -f tests/chat-jobs-fixture.sql -f tests/chat-photos-fixture.sql \
     -f supabase-chat-photos.sql -f tests/chat-photos.sql    the database side of chat photos
psql -d <scratch db> -f tests/chat-jobs-fixture.sql \
                     -f supabase-chat-jobs.sql \
                     -f tests/chat-jobs.sql     the job-enquiry filter
node tests/build-site.test.cjs           what Netlify publishes, and what stops a deploy (build 75)
node tests/csp-report.test.cjs           the Content Security Policy's report function (build 75)
node tests/csp.browser.cjs               every page under the policy, with nothing it would block (build 75)
node tests/place-order.test.cjs          a WhatsApp order, priced by the website from the catalogue (build 76)
node tests/admin-two-factor.browser.cjs  two-factor at the admin's door; TEST on a test payment (build 76)
node tests/chat-keys.browser.cjs         the shop's own notification keys, made in the owner's browser (build 76)
node tests/newsletter.test.cjs           joining the newsletter; back on it only by a link from that inbox (build 76)
node tests/newsletter.browser.cjs        the newsletter form, as a visitor sees it (build 76)
node tests/send-email.test.cjs           the test email and Send welcome: who may, what is sent, what a failure says (build 77)
node tests/one-key.test.cjs              every function finds the website's service key by either name (build 77)
node tests/account-signup.test.cjs       creating an account; the same answer for an address already in use (build 77)
node tests/safe-links.browser.cjs        what the settings can put on the shop's pages: links, the announcement, button words (build 78)
node tests/admin-escaping.browser.cjs    the admin shows photo addresses and database errors as text (build 78)
node tests/backup.browser.cjs            a settings backup never holds the email password or the notification keys (build 78)
node tests/payments-74.test.cjs          payments as builds 74 to 78 of the other line left them: the price moving,
                                         stopping part-way, the webhook signed the newer way, the check-up (build 80)
node tests/payments-77.test.cjs          only the exact amount is paid; needs attention; the status page's pace;
                                         a piece paid for online held (build 80)
node tests/order-progress.test.cjs       an order's emails and its marking delivered, every fifteen minutes (build 80)
node tests/receipt-pdf.test.cjs          the receipt a customer downloads, as the till printed it (build 80)
node tests/sql-hidden.test.cjs           every SQL file has its own rule in netlify.toml (build 80)
node tests/account-delete.test.cjs       closing an account removes the login; never an admin's (build 80)
node tests/pos-orders.browser.cjs        the order number in the WhatsApp message; the receipt on the account page (build 80)
node tests/order-progress.browser.cjs    an order's steps, Confirm delivery, the private link, the admin's lines (build 80)
node tests/payment-return.browser.cjs    the page after paying: needs attention, left the page, two minutes (build 80)
node tests/pay-readiness.browser.cjs     Settings > Payments: the keys, the webhook, asking Flutterwave (build 80)
node tests/admin-session.browser.cjs     the admin's sign-in kept apart from the shop's (build 80)
node tests/online-refund.test.cjs        the platform's online refunds: sent once, the test key, Flutterwave's
                                         answer, a lost answer never sent again, notices asked about (build 81)
node tests/enquire-chat.browser.cjs      every Enquire button opens the live chat with its own message, the
                                         shop's own words from Settings > Live Chat; WhatsApp when it is off (82, 83)
node tests/chat-notify.browser.cjs       a customer told the shop has replied: Notify me, the offer on closing,
                                         the note by the chat button, the count in the tab (build 83)
node tests/chat-settings.browser.cjs     Settings > Live Chat: the Enquire messages and the reply notification (build 83)
node tests/deploy-gate.test.cjs          the deploy step runs the website's own checks first; one failure
                                         publishes nothing (build 84)
node tests/runner.test.cjs               no second try for a critical check; a skip is never a pass (build 84)
node tests/health.test.cjs               /api/health: working or not; the details only for an administrator (84)
node tests/release-tag.test.cjs          a tag on GitHub for every build whose checks pass (build 84)
node tests/live-check-health.test.cjs    tools/live-check.cjs reads the health check (build 84)
node tests/checkout-choice.browser.cjs   Buy in gold; Website checkout (gold) and WhatsApp checkout (green) (85)
node tests/test-orders-sync.test.cjs     the two SQL files keep a test payment away from the till alike (85)
node tests/account-portal.test.cjs       the customer portal's own records: each customer's own and never
                                         another's; nothing that proves ownership, nothing the team wrote
                                         for itself (build 86)
node tests/portal.browser.cjs            the customer portal on a phone: the navy dashboard, every page, an
                                         order's five steps, refunds, the password, signing out (build 86)
node tests/customer-requests.browser.cjs customers' requests: off until switched on; what each order may ask;
                                         the form, every missing piece said; withdraw; Admin > Orders (decline
                                         needs a word, accept cancels or sends to Online Refund); the
                                         Settings switch and days (build 87)
node tests/lenco.test.cjs                Lenco, against a stand-in that answers as Lenco's reference says:
                                         what is offered; Airtel, MTN, Zamtel; paid only on Lenco's word;
                                         failed; no answer; three hours; late; signed webhooks and forged
                                         ones; the wrong amount, currency, reference; one press, a second
                                         try, paid twice; Cancel payment and the 90-second hold; cards in
                                         Lenco's window; Zambian or international cards, ready; refunds refused; the
                                         check-up; Flutterwave kept and off (build 88)
node tests/lenco-checkout.browser.cjs    the unified checkout, in the owner's words: the ways of paying,
                                         Payment Authorisation Required, Didn't receive approval request
                                         and Contact us, Payment Successful and View order details,
                                         Payment Unsuccessful, Cancel payment, never two live requests,
                                         Lenco's card window paid or closed, Pay with Zambian card and
                                         Pay with international card ready for DPO (build 89), a dropped
                                         line (build 88)
node tests/lenco-admin.browser.cjs       Settings > Payments: a switch for each gateway, what Lenco has
                                         activated, Lenco's readiness, the payment activity (build 88)
node tests/secure-publish.test.cjs       a deploy stops if a secret key or a card field would be published;
                                         the scripts part of the policy enforced (build 88)
node tests/delivery.browser.cjs          delivery: the instructions box at checkout and in the WhatsApp
                                         message; changed on the customer's order until it is on its way;
                                         the courier, tracking number, Track your delivery and updates on
                                         the order and the private link; Download invoice; Admin > Orders'
                                         courier and tracking (build 89)
node tests/invoice-pdf.test.cjs          the invoice PDF: a good A4 file in the two fonts every reader has,
                                         the figures in their columns, more pages for a long order, names
                                         that look like PDF kept as text (build 89)
node tests/shopping.browser.cjs          shopping: compare, alerts, questions and answers, reviews from
                                         buyers, the gift list, sizes and categories, Recently purchased,
                                         Order again, each switched off (build 90)
node tests/product-alerts.test.cjs       the alert emails: back in stock, a price drop at the shop's own
                                         price, once, one email each, nothing without email (build 90)
node tests/policies.browser.cjs          Admin > Policies: the window, the numbers renumbering themselves,
                                         the arrows, delete, a phone, the policies page in the same order (90)
node tests/policies-order.test.cjs       the policies' numbers worked out without a page (build 90)
node tests/questions.browser.cjs         Admin > Reviews > Questions & answers (build 90)
node tests/risk.test.cjs                 the fraud check: watching, acting, held and released on the gateway's
                                         word, refunds held, WhatsApp orders never refused, never a sale
                                         stopped by its own failure, the fifteen-minute watch (build 91)
node tests/risk.browser.cjs              Admin > Fraud & Risk and Settings > Fraud & Risk (build 91)
node tests/backups.test.cjs              the backup without a database: the seal, the storage account's
                                         signatures, which copies are let go, the pictures, the workflow's
                                         switches, the check after a restore, RECOVERY.md's settings (build 92)
node tests/backups-admin.browser.cjs     Admin > Settings > Backups and the key made in the browser (build 92)
bash tools/db-check.sh                   supabase-hardening.sql on a stand-in Supabase: the 28 files, the
                                         hardening twice, the files made after it (build 80) twice each and the
                                         hardening again, the older files refusing, then tests/hardening.sql,
                                         which also holds visitors to the functions on the hardening's list,
                                         and tests/after-the-hardening.sql: the till's door, an order's steps,
                                         the customer's buttons, the payment history, closing an account and
                                         the online refunds (builds 76 to 81), telling a customer the
                                         shop has replied (build 83), customers' requests (build 87) and
                                         the platform's delivery door (build 89), and the fraud check with
                                         the hardening (build 91); then the backup on that whole database:
                                         a copy checked by restoring it, sealed, kept, the first drill, and a
                                         real restore into a new project (tests/backup-cycle.js, build 92;
                                         one-time setup in tests/supabase-standin/README.txt)
bash tools/sql-tests.sh                  every psql chain above, each on a fresh database (build 79), and the
                                         till's door, the payment history and an order's progress
                                         (tests/order-progress-db.sh) (build 80), the online refunds
                                         (tests/online-refund-db.sh) (build 81), a test payment kept off the
                                         till (build 85), customers' requests (tests/customer-requests.sql,
                                         build 87), Lenco payments (tests/lenco.sql, build 88), delivery
                                         (tests/delivery.sql, tests/delivery-kept.sql, build 89),
                                         shopping (tests/shopping.sql, build 90), the fraud check and
                                         the sealed record (tests/risk.sql, build 91) and the backups'
                                         records (tests/backup.sql, build 92)
```

The browser ones need Playwright (`npm ci` in `tests/`), the SQL ones any
PostgreSQL to point at, and the round trip skips itself politely when it is
given no database.

---

## Deploying

The site is a Netlify site of its own, built from a GitHub repository holding
this folder (never deploy over the business platform's site). Netlify runs the
build step and publishes `dist/`; START-HERE.txt and HOW-TO-UPLOAD.txt say how
each build goes up. With the Netlify command line instead:

```
npm install -g netlify-cli
cd vaultique-website
netlify deploy --build --prod
```

`--build` matters: without it there is no `dist/` to publish, and since build
84 it is also what runs the node checks first. After a deploy,
`node tools/live-check.cjs https://YOUR-SITE` checks the live site from
outside, read only, the health check (`/api/health`) included. SETUP.md
section 6 says what a stopped deploy looks like, how to pause the checks for
a day, the release tags, and the staging copy.

The website's own Supabase is set up once, as SETUP.md says; the business
platform's is never touched.

---

## The platform's doors, and the functions' own settings

### The products-only door (website build 63)
The product feed and its change bell no longer need the platform's secret
key. They ask the platform's **products-only door** (`vbp_website_products`,
created by the platform's `tools/vbp-website-door.sql`, build 454) with the
publishable key, and get the shop window and nothing else. Since build 77
nothing uses the platform's secret key: if the door does not answer, the old
way is asked with the publishable key only, which the platform's lock refuses,
and the feed says it cannot read the products rather than showing an empty
shop.

Check it at `https://YOUR-SITE.netlify.app/api/products`: near the end it says
`"source":"door"`.

### The rewards door (website build 68)
**Vaultique Rewards** (SETUP.md) ask the platform's **rewards door**
(`vbp_website_rewards` and `vbp_website_rewards_email`, created by the
platform's `tools/vbp-rewards-door.sql`, build 469) with the publishable key
and the door's own key, `POS_REWARDS_KEY`. Since build 77 there is no other
way: until the door is set up, the rewards say they cannot be reached.

Check it at `https://YOUR-SITE.netlify.app/api/rewards-check`: it says
`"source":"door"` once the door is in use, and `"source":"none"` with the
reason until then. `POS_SUPABASE_KEY` must not be in Netlify at all: the
build step (`tools/build-site.cjs`) refuses to publish while it is, so the
website holds no key that opens the business.

### The website's own Supabase, as seen by the functions
`/robots.txt`, `/sitemap.xml` and the email sender run on Netlify rather than in
the browser, so they cannot use `config.js` the way a page does — they read it
off disk. The `[functions]` block in `netlify.toml` puts `config.js` into the
function bundle for them, and that is all most sites need.

If you would rather not ship the file into the bundle, set these two instead
(Site settings → Environment variables) and they win over the file:

| Variable | Value |
|---|---|
| `WEB_SUPABASE_URL` | the same as `SUPABASE_URL` in `config.js` |
| `WEB_SUPABASE_ANON_KEY` | the same as `SUPABASE_ANON_KEY` in `config.js` |

It is the **anon** key, the public one the storefront already uses — never the
service role key.

**To check it is working:** open `https://YOUR-SITE/sitemap.xml` and look for
your policy pages. If the only one there is `/policies` and none of the
individual policies are listed, the functions are not reading your settings —
and the same is true of `/robots.txt` and the email sender.

`/robots.txt` is not a good test on its own: it looks normal either way, because
its standard lines are built without needing any settings. What it quietly loses
is anything you changed — including **Do not let search engines index my site**,
which is ignored entirely when the settings cannot be read.

### Newsletter
The signup goes through the website's `newsletter` function, which writes to
the `subscribers` table in this website's own Supabase. Somebody who once
unsubscribed is sent a link instead, and only that link from their own inbox
puts them back (build 76). Addresses appear in the admin under
**Subscribers**, where you can export or remove them.

Nothing goes to Netlify Forms. This paragraph used to say it did, which was
true of an earlier build and would have sent anyone looking for a customer's
address to a dashboard page that has never had one on it.

---

## Preview before deploy
Open `index.html` directly (on your phone or computer) to see the full design.
With no server, it runs in "Preview mode" with a few sample products behind an
amber banner. On the live Netlify site, your real POS products load and the
banner disappears.

---

## Day-to-day
- **Products:** add or edit in the POS. The site refreshes within ~1–2 minutes.
- **Hide a product:** set it inactive in the POS.
- **Photos:** drop files into `images/` (see `images/README.txt`).
- **WhatsApp numbers, Instagram and the rest:** Settings > Contact & Social in the
  admin. (`WA_SHOP`, `WA_ENQUIRY` and `IG_HANDLE` at the top of `assets/app.js`
  are only what is used before any are set there.)
