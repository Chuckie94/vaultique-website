# Vaultique Boutique Point website: what each build changed

One entry per build, newest first. Each build holds every one before it, so
the newest is the one to upload. Its own notes (the build's `.md` file) and
START-HERE.txt say what to do; `assets/version.js` says which build is live,
and GitHub tags every build that passes its checks (`website-84`, …).

Builds before 84 are described in their own notes and in the `notes` line of
`assets/version.js` as each was released.

## Build 90 · 1.60.0 · shopping, and the policies entered in a window

- **Admin › Policies** (`assets/admin/policies.js`), as the owner asked: "Adding
  a new policy shouldn't take the windows to the bottom, instead, a policy
  window should just appear on the screen. Also, the numbers in order should
  auto correct when a new policy is added, instead of editing all the
  numbers." The list is now compact, under the same section headings as the
  policies page, each policy numbered 1, 2, 3 ... in the order customers see
  it. **Add policy** and **Edit** open one window over the list: title,
  section, number and text; choosing a number puts the policy there, and the
  window says which numbers move before anything is saved. Saved: the others
  renumber themselves, the page stays where it was, and the policy is marked
  (with *Show it* when it is out of sight). Arrows move a policy, or a whole
  section, one place; Delete closes the gap. Each section stays together, as
  on the policies page; a number among another section's policies is brought
  to the nearest place in the policy's own section, and the window says so.
  One row is written when there is room between two numbers; otherwise every
  number is written again as 10, 20, 30 ... in one step
  (`policies_set_order`), or row by row before `supabase-shopping.sql`.
  *Load starter policies* now adds them after the ones already there.
- **Compare** (`assets/shopping.js`): a Compare button on each piece, a small
  bar while some are chosen, and `/compare`: two to four pieces side by side,
  price, availability and every detail, with Add to cart. Kept on the
  customer's device. Settings › Shopping, *Compare pieces side by side*.
- **Product alerts**: *Email me when it's back* on a sold-out piece, *Email me
  if the price drops* on one in stock, for a signed-in customer, to their
  account's own address. The new half-hourly job
  (`netlify/functions/product-alerts.js`) emails each once, at the price the
  shop shows (its own prices and hidden pieces, as the checkout prices), one
  email for all of a customer's pieces; a piece priced on request never; an
  alert left waiting 180 days is let go. The customer sees and stops them in
  *Product alerts* in their account.
- **Reviews from buyers**: a piece is reviewed by a signed-in customer who
  bought it (sent, delivered or rung up at the till, not cancelled or
  refunded in full), once, marked *Verified buyer* (`review_by_buyer`, which
  checks the purchase in the database). Signed out: *Bought this piece? Sign
  in to review it.* Settings › Reviews, *Who can review a piece*: customers
  who bought it (the default) or anyone. A review of the whole shop is as
  before. The database holds the same rule.
- **Questions & answers**: *Ask a question* on each piece opens the live chat
  with the piece named; the shop publishes the answers worth keeping in
  **Admin › Reviews › Questions & answers** (`assets/admin/questions.js`),
  shown on the piece's page under its reviews.
- **The gift list**: a customer shares their wishlist as a link
  (`/gift/<key>`, a 64-character key made by the database); whoever has it
  sees the pieces and the customer's first name, nothing else, until they
  stop sharing. Not indexed by search engines.
- **Shopping preferences**: sizes and categories on the account. Their
  categories come first in the shop; *My sizes* shows pieces in their sizes
  (and one-size pieces); their size is marked on a piece's size picker.
- **Recently purchased** and **Order again**: every piece they bought, as the
  shop's own cards; on a past order, *Order again* puts its pieces back in
  the cart at today's prices, never more than the shop has, and says what
  is not on sale.
- **Settings › Customer Accounts › Shopping**: *Order again*, *Email alerts*,
  *Share the wishlist as a gift list*, *Shopping preferences*, each on unless
  switched off.
- **Download my personal data** includes their alerts, their gift list
  (whether it is shared, never its key), their preferences and the reviews
  they wrote as buyers.
- **The admin's top bar fits a phone**: at 390 pixels *Log out* ran a few
  pixels past the edge.
- One SQL file: `supabase-shopping.sql` (product_alerts, product_questions,
  gift_lists, review_owners, customers.preferences, the review rule, and the
  functions). The hardening's list keeps the gift list's link and the review
  rule open to visitors when it is run again.
- Tests: `tests/shopping.browser.cjs` (40) and `tests/product-alerts.test.cjs`
  (14), both critical; `tests/policies.browser.cjs` (33),
  `tests/policies-order.test.cjs` (25), `tests/questions.browser.cjs` (10),
  `tests/shopping.sql` (45), and new checks in `tests/after-the-hardening.sql`
  (3). Changed, each said why: `build-site.test.cjs`, 63 script and
  stylesheet addresses fingerprinted (was 60: the three new scripts);
  `portal.browser.cjs`, the dashboard's three new cards and Shopping
  preferences (its own wording had said alerts come with build 90); the
  hardening's lists and `tools/db-check.sh`, the gift list's link, the
  review rule and the tenth file.

## Build 89 · 1.59.0 · delivery: instructions, the courier and tracking number, the invoice

- **Delivery instructions at checkout** (`assets/app.js`): under the address,
  *Delivery instructions (optional)*, "For the courier: a landmark, the gate,
  the best time to deliver". Shown only for delivery, up to 300 characters,
  kept on one line. They go in the WhatsApp message (*Delivery instructions:
  …*) and are saved on the order, on both ways of checking out
  (`place-order.js`, `pay-start.js`), and remembered on the device with the
  address. **Settings › Shopping › Ask for delivery instructions** (on unless
  switched off). The order notes box now asks only for a gift message or
  anything else.
- **On the customer's order page** (`assets/account.js`): the instructions,
  with **Change instructions** (or **Add instructions**) until the order is
  on its way; saved by the database for the signed-in customer's own order
  only (`order_set_instructions`), at most 20 changes an hour; then *Saved ✓
  We have let the shop know.* Once it is on its way they are shown and can
  no longer be changed. The shop is emailed each change (*Delivery
  instructions changed: order VB-…*), once, by the fifteen-minute job.
- **The courier and tracking number**: the courier, the tracking number, the
  courier's tracking page (an https address only) and short updates for the
  customer (the newest twenty kept). Recorded in **Admin › Orders**, under a
  delivery order once it is confirmed (**Add courier and tracking**), or by
  the platform when it sends the order (platform 512, through a new door
  behind the till's own key, `vbp_pos_order_shipping`). Never on an order
  for collection, one cancelled or completed, or one not yet confirmed.
- **The customer sees them** on their order (Courier, Tracking number,
  **Track your delivery**, opening the courier's page in a new tab, and
  *Delivery updates*, newest first) and on the private progress link sent
  by email. The *on its way* email carries them; given or changed after
  that email went, the customer gets one more (*Delivery details for your
  order VB-…*), once for each change.
- **The till** receives the instructions, the courier, the tracking number
  and the updates with each order (`pos_order_out`), ready for platform 512
  to show them.
- **Download invoice** (`assets/account.js`): on the order list and the
  order's page, once the till has rung the order up and given it an invoice
  number. An A4 PDF made on the customer's device from the till's own record
  (`orders.pos_receipt`), nothing typed: the shop, its address and TPIN;
  INVOICE with its number, the date, the receipt number and the online
  order; who it is for; each piece with its quantity, unit price and amount;
  the subtotal before VAT, VAT, delivery, the total, points, what was paid,
  any balance; how it was paid. A long order runs onto more pages, each
  numbered. Named `Invoice-<number>.pdf`.
- **Cards, Zambian or international** (`assets/app.js`): the question *Where
  was your card issued?* is replaced, in the owner's words, by two buttons,
  **Pay with Zambian card** and **Pay with international card**, each paying
  at once. As before, they appear only once a second card gateway (DPO) is
  connected; today a card has one Pay button and goes to Lenco. No card
  detail is ever typed on the website.
- **Mended: a "Refunded K0" line on orders with no refund.** Since build 86
  an order's page showed a *Refunds* heading over an empty *Refunded* line
  whenever the order had no refund. It now shows nothing until there is one.
- One SQL file: `supabase-delivery.sql` (the instructions, when they were
  given and when the shop was told; the courier, tracking number, tracking
  page, updates and when they were set and emailed; the limits each is
  held to; the customer's function, the administrator's, the platform's
  door). The hardening's list keeps the new door open to the till's key when
  it is run again. `supabase-pos-orders.sql`, `supabase-test-orders.sql` and
  `supabase-order-progress.sql` carry the same changes, so running any of
  them again keeps the delivery details.
- Tests: `tests/delivery.sql` (34), `tests/delivery-kept.sql` (3),
  `tests/delivery.browser.cjs` (20) and `tests/invoice-pdf.test.cjs` (23),
  both critical; new checks in `order-progress.test.cjs` (56),
  `place-order.test.cjs` (22), `lenco.test.cjs` (112),
  `account-portal.test.cjs` (38) and `portal.browser.cjs` (51, the refund
  line). Changed, each said why: `lenco-checkout.browser.cjs`, the two card
  buttons in place of the question; `tests/pos-orders.sql`, the till's list
  of an order's parts now has *delivery*; the hardening's lists and
  `tools/db-check.sh`, the new door and the ninth file.

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
