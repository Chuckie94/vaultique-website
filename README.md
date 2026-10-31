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
| `place-order` | A WhatsApp order, priced here from the catalogue and recorded |
| `pay-quote`, `pay-start`, `pay-status`, `pay-webhook` | Online payment with Flutterwave: the price, the start, the page after paying, and Flutterwave's own word on it |
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
order SETUP.md gives; on a shop already running, only the hardening is ever run
again. Its rules live in the database itself: a visitor, a customer and each
member of staff can read and write exactly what their role allows, however
they ask.

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
node tests/chat-push.test.cjs             the phone buzz as it leaves: urgent, one per conversation, still decrypts
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
bash tools/db-check.sh                   supabase-hardening.sql on a stand-in Supabase: the 28 files, the
                                         hardening twice, the older files refusing, then tests/hardening.sql,
                                         which also holds visitors to the functions on the hardening's list
                                         (builds 76 to 79; one-time setup in tests/supabase-standin/README.txt)
bash tools/sql-tests.sh                  every psql chain above, each on a fresh database (build 79)
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

`--build` matters: without it there is no `dist/` to publish. After a deploy,
`node tools/live-check.cjs https://YOUR-SITE` checks the live site from
outside, read only.

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
