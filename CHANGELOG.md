# Vaultique Boutique Point website: what each build changed

One entry per build, newest first. Each build holds every one before it, so
the newest is the one to upload. Its own notes (the build's `.md` file) and
START-HERE.txt say what to do; `assets/version.js` says which build is live,
and GitHub tags every build that passes its checks (`website-84`, …).

Builds before 84 are described in their own notes and in the `notes` line of
`assets/version.js` as each was released.

## Build 87 · 1.57.0 · customers' requests

- **A customer asks, from their own order** (`assets/account.js`):
  **Cancel this order**, before the shop has started on it; **Return or
  exchange**, within the days after it arrived that Settings allows (7
  unless set); **Report a problem**, once it is on its way and up to 30 days
  after it arrived. Each with a reason, the pieces and how many, what they
  would like instead (an exchange), and their own words. Photos go in the
  chat, with the request's number.
- **Each is a request, and the shop decides**: accept or decline, with a word
  for the customer, then mark it done. The business platform does that in
  its Online Orders (platform 512, through a door behind the till's own
  key); until then, and whenever it suits, **Admin › Orders** shows each
  request under its order with Accept, Decline and Mark done.
- **Accepting a cancel** cancels an order that is not paid online and not
  rung up at the till. One paid online is cancelled by its refund (the
  platform's Online Refund, as every refund), never here; one already rung
  up is undone at the till.
- **The customer sees each step** on the order and in Returns & refunds, and
  can withdraw a request the shop has not answered (two taps). One open
  request of each kind per order.
- **Emails** (the 15-minute check, `netlify/functions/order-progress.js`):
  the shop, for each new request, at its Contact address; the customer, for
  each answer, once each.
- **Download my personal data** includes their requests and the shop's
  answers, never who in the team answered.
- **Settings › Customer Accounts**: *Let customers ask to cancel, return or
  exchange, or report a problem* (off until switched on) and *Days after
  delivery to ask for a return or exchange* (7).
- One SQL file: `supabase-customer-requests.sql`. The hardening's report has
  a line for it.

## Build 86 · 1.56.0 · the customer portal

- **A signed-in customer's account is a portal** (`assets/account.js`), as in
  the owner's screenshots, with Vaultique navy for the top: Welcome back and
  three figures (orders, wishlist, points, the points asked of the platform),
  then My shopping, My Vault and Security and privacy, each a page of its
  own at `/account/<page>`.
- **An order opened in full** (`/account/orders/<number>`), and its words:
  Requested, Awaiting payment, Payment not completed, Paid, Confirmed,
  Preparing, On its way, Ready for collection, Delivered or Collected,
  Completed, Cancelled; its five steps: Requested, Confirmed, Paid,
  Delivered, Completed.
- **Returns & refunds**: every refund, the one Flutterwave is still sending
  included. **Recently viewed**, **Customer support**, **Notifications**.
- **The password**: the one in use asked first. **Signing out**: this device
  only (it was every device), the other devices, or everywhere.
- **The newsletter**, yes or no, and **Download my personal data**
  (`netlify/functions/account-portal.js`, new: for the signed-in customer
  alone).
- **The account page is no longer drawn again under the customer's hands**
  (by a new sign-in token every hour, or a save): what they type stays, and
  "Saved" can be read.
- **A test with a date in it** (`tests/order-progress.test.cjs`): its order
  was due on 23 November 2026, and from 21 November the check failed, so the
  deploy step of builds 84 and 85 would have stopped. The date is now six
  days from whenever it runs.
- **A database check that read the wrong day** (`tests/payments.sql`): from
  midnight to 02:00 in Lusaka it asked for UTC's date with Lusaka's sums, and
  failed, so GitHub's checks went red at night. It now asks for Lusaka's own
  date. The dashboard itself was right.
- No SQL, no new setting.

## Build 85 · 1.55.0 · checkout, the website or WhatsApp

- **Buy, in gold**, on every piece (the cards, the quick view, the product
  page), without the WhatsApp mark; the cart's **Checkout**, gold.
- **After the details: Website checkout (gold) first, WhatsApp checkout
  (green) beside it.** Website checkout is the online payment of builds 77 to
  81; WhatsApp checkout is exactly the WhatsApp order as before.
- **Website checkout only when Flutterwave is really there**: the page asks
  the server (`pay-status ?check=1`, yes or no, never a key). Switched on
  without the key for the mode, it is not offered.
- **Green is only ever WhatsApp.** A saved "Buy on WhatsApp" reads "Buy".
- **A payment made in Test mode is never rung up at the platform's till**:
  only a Live payment counts as paid there; a Test-mode order is kept off
  the till's list and refused if rung up by hand, marked `test`
  (`supabase-test-orders.sql`, run once; the same in
  `supabase-pos-orders.sql`). The hardening's report has a line for it.
- One SQL file: `supabase-test-orders.sql`.

## Build 84 · 1.54.0 · safe releases

- **A deploy never publishes a build whose own checks fail.** Netlify's build
  step (`tools/build-site.cjs`, step 6) runs the node checks first, with none
  of Netlify's settings; one failure and nothing is published. `VBP_DEPLOY_GATE
  = paused` publishes without them for a day, loudly in the log and in the
  health check.
- **No second try for a critical check** (payments, refunds, orders, sign-in,
  security), and **a skipped check is never counted as passed**
  (`tests/run-tests.js`).
- **The health check**, `/api/health` (`netlify/functions/health.js`): working
  or not working for anybody; for an administrator, the database, the SQL
  files run, every setting set or not (never a value), and whether online
  payment can really start. `tools/live-check.cjs` reads it.
- **A tag for every build that passes** (`.github/workflows/release-tag.yml`),
  and this file.
- SETUP.md section 6: what a stopped deploy looks like, pausing the checks,
  the health check, the tags, who can change the website, and a staging copy
  for when a Supabase project is free.
- No SQL, no new setting. Nothing the shop's customers see changes.
