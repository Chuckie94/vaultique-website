# Vaultique Boutique Point website: what each build changed

One entry per build, newest first. Each build holds every one before it, so
the newest is the one to upload. Its own notes (the build's `.md` file) and
START-HERE.txt say what to do; `assets/version.js` says which build is live,
and GitHub tags every build that passes its checks (`website-84`, …).

Builds before 84 are described in their own notes and in the `notes` line of
`assets/version.js` as each was released.

## Build 88 · 1.58.0 · Lenco, and one checkout for every way of paying

- **Lenco by BroadPay Zambia, the primary gateway** (`netlify/functions/_lenco.js`,
  built from Lenco's API reference, version 2.0): Mobile Money on Airtel
  Money, MTN MoMo and Zamtel Kwacha, by a request to the customer's phone
  (`POST /collections/mobile-money`), approved there with their PIN; Debit
  / Credit Cards in Lenco's own secure window (`pay.lenco.co`), so no card
  number or security code ever reaches this website. Lenco's direct card
  API needs PCI DSS certification and the card number on the server, and
  is not used.
- **One checkout** (`assets/app.js`): after the total, *How would you like
  to pay?* with **Mobile Money**, **Debit / Credit Card**, and **Instant Bank
  Transfer** once a gateway can take one (neither Lenco's API nor its window
  takes bank transfers, so it is not shown). No gateway is named on a
  button. Mobile money: the network and the number, checked here (a number
  for another network is caught before any phone rings).
- **The payment screens, in the owner's words**: under the number, *A
  payment approval request will be sent to this number. Please check and
  verify the phone number is correct before proceeding.* and *Payments are
  processed securely by Lenco.*; under a card, only *Your card details are
  entered in a secure payment window and are never kept by this website.*
  (Lenco is named once its window opens, where the card number goes).
  **Payment Authorisation Required** (the number shown as 09******28) with
  **Check payment status**, **Choose another payment method** and **Cancel
  payment**; once a new request can be sent, *Didn't receive approval
  request? Please try again or use another payment method.* with **Try
  again** and a **Contact us** link to the website chat (WhatsApp when the
  chat is off). **Payment Successful** with **View order details** (the
  account's order page when signed in; the order on the screen otherwise)
  and **Continue shopping**. **Payment Unsuccessful** with the reason
  (*...due to insufficient funds in your mobile money account. Please load
  your account to complete the transaction.*, a wrong PIN, a time-out, a
  decline, a limit), **Try again**, **Choose another payment method** and
  **Complete your order via WhatsApp**. **Payment Cancelled**, **Payment
  Not Completed** (a card window closed), **Payment Confirmation Pending**
  (a card the bank has not confirmed in two minutes), **Payment Already
  Received** and **Payment Under Review**. A dropped line is said plainly
  (*We were unable to connect to the payment service...*), and the next
  press is the same payment, never a second one.
- **Nobody is asked or charged twice for one order**: no second request is
  sent while the first can still be approved (on the phone, or in a card's
  check with the bank), even after **Cancel payment** (Lenco's API cannot
  withdraw a request already on a phone): 90 seconds from the request, or
  until Lenco says it failed. Cancel payment works only from the page that
  started the payment, asks Lenco first (money already taken is never
  "cancelled"), and the check-up keeps asking Lenco about a cancelled
  request until Lenco answers, so one approved after all is still the
  order's payment.
- **Cards ready to be routed, Zambian or international, by the customer's
  answer** (`netlify/functions/_cardroute.js`): no card detail is ever typed
  on the website, not even a card's first six digits. Once DPO is connected
  (a later build, not this one), the checkout asks *Where was your card
  issued?* (**Card issued in Zambia** / **International card**): Zambian
  cards to Lenco, international cards to DPO. Today every card goes to Lenco
  and the checkout asks nothing more. After a card payment, the BIN Lenco
  gives (first six digits, beside the last four; never the whole number) is
  kept, and once `CARD_BINS_ZM` lists the Zambian banks' BINs, whether the
  customer's answer was right.
- **Paid only on Lenco's word**: `GET /collections/status/:reference`, with
  the secret token, naming our reference, exactly our amount and our
  currency. Anything else is never paid: another amount or currency *needs
  attention* (the shop is told once); another reference says nothing.
- **Lenco's webhook** (`netlify/functions/lenco-webhook.js`): signed in
  `X-Lenco-Signature` (HMAC SHA512, keyed with the SHA256 of the API token),
  checked in constant time; unsigned calls are refused and counted; a
  signed notice is only a reason to ask Lenco. The same notice twice changes
  nothing twice. Each signed notice is kept (`payment_webhooks`).
- **Each try kept, an order paid once**: a second try at an order is a
  payment of its own; the same press of Pay arriving twice is one payment;
  never a second request while the first may still be on the phone; if two
  tries were ever both paid, the second is held for the shop to refund
  (*Paid twice, refund one*), and the database itself refuses a second paid
  payment for an order.
- **The fifteen-minute check-up** asks Lenco about every payment not heard
  back about (Lenco's own advice: a webhook can be missed), and keeps each
  run for Settings. A Lenco payment Lenco called failed is final.
- **Refunds**: Lenco's API has no refund. The platform's Online Refund of a
  Lenco payment is refused with the reason (`no_refund_api`); the shop
  refunds it from its Lenco account. A second lock in `_refund.js` never
  sends a Lenco payment to Flutterwave.
- **Flutterwave kept, exactly as it was, and off** until switched on in its
  own setting (*Use Flutterwave*), for when its account is approved. Its
  payments are still checked and can still be refunded. Its emails and
  history keep their words; Lenco's say Lenco.
- **Settings › Payments**: a switch for each gateway; under Lenco, what Lenco
  has activated (each network, cards); Lenco's readiness (each key there
  or not, the database file, the webhook address, unsigned calls, the last
  error, *Check the keys with Lenco*); and **Payment activity**: recent,
  waiting, failed, needing attention, Lenco's notices, the check-up and
  errors, and every change to the page (`payment_settings_audit`, written by
  the database).
- **Security** (the four protections the owner passed on): cards only in the
  gateway's own window or page; the secret keys only in Netlify, and a
  deploy stops if a secret key, a Supabase service key or a card field is
  in anything it would publish (`tools/build-site.cjs`, step 8); webhooks
  verified by signature and by asking the gateway; and which scripts may
  run is now **enforced** (step 7: this site, its own inline scripts and
  Lenco's window; `CSP_SCRIPTS = report` puts it back). Two-factor stays
  required by the database for every admin role that can see payments,
  orders or settings.
- One SQL file: `supabase-lenco.sql` (each payment's way of paying, network,
  the gateway's reference, status, failure reason, confirmation and last
  verification times and answer; one payment per press; an order paid once;
  the notices; the settings record; the three-hour tidy-up counted from the
  latest try; the refund rule). `supabase-online-refund.sql` carries the
  refund rule too. The plan's later builds are renumbered (the customer
  portal's 88 and 89 become 89 and 90; the enterprise plan's 90 to 95 become
  91 to 96).
- Tests: `tests/lenco.test.cjs` (110), `tests/lenco-checkout.browser.cjs` (60),
  `tests/lenco-admin.browser.cjs` (30), `tests/secure-publish.test.cjs` (17),
  `tests/lenco.sql` (31), and new checks in `csp.browser.cjs` (5). Changed,
  each said why: the Flutterwave tests switch Flutterwave on; the check-up's
  "no gateway key"; the policy's second header and Lenco's two addresses in
  `build-site.test.cjs`; the monitoring build's new number in
  `health.test.cjs`; and in `payments.browser.cjs`, the quote's WhatsApp
  button, which now says *Complete your order via WhatsApp*, as the payment
  screens do.

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
