# Admin tests

Two browser tests that run the admin against a stand-in database, so nothing
here touches Supabase, the POS, or the live site.

    npm install playwright           # once
    node tests/general.test.js       # the form kit and the General page
    node tests/admin-shell.test.js   # the admin shell: routing, guard, handover
    node tests/storefront.test.js    # what the customer sees for a given settings row
    node tests/theme.test.js         # the theme engine's colour sums, no browser needed
    node tests/branding.test.js      # Settings > Branding & Appearance, end to end
    node tests/contact.test.js       # Contact & Social, and every contact link it drives
    node tests/shopping.test.js      # Settings > Shopping, switch by switch
    node tests/checkout.test.js      # the details step, and the message it composes
    node tests/payments.test.js      # Payments, and what stays out of the browser
    node tests/homepage.test.js      # Settings > Homepage, and the Site Content handover
    node tests/pricing.test.js       # Settings > Pricing & Tax, and the money engine
    node tests/delivery.test.js      # Settings > Delivery & Collection, and the checkout
    node tests/account.test.js       # Settings > Customer Accounts, and the database rules
    node tests/seo.test.js           # Settings > SEO, and the real addresses under it
    node tests/care.test.js          # Settings > Customer Care, the FAQ, and the policies

`general.test.js` also drops two screenshots next to itself.

## What the stand-ins do

The two admin tests replace `supabase-js` with a small in-memory table. It copies
values through `JSON` on every read and write, the way the real client does,
so a caller never ends up sharing an object with the store. That detail
matters: an earlier version handed back the same object each time, which
quietly hid a bug where saving Site Content wrote an old tagline back over
one that Settings > General had just saved.

`storefront.test.js` works differently: it serves the real `index.html` and
answers its network calls with fixtures, so a test is just "given this
settings row, what does the customer get?". It covers the gate (maintenance,
coming soon, closed), the currency, number and date formats, the trading
hours, and the two ways this can go wrong in a customer's favour: no settings
row at all must still open the shop, and a settings request that hangs must
not leave a returning visitor on a blank screen.

## Adding the next settings category

`general.test.js` is the template. A new category needs the same four things
checked: its fields draw, its defaults land, its validation refuses bad input,
and a save round-trips through `site_settings` and reads back.

## The screenshot oracle

`assets/styles.css` was made themeable by moving colours, fonts and corner
rounding into variables, and the way that was checked was to capture the site
at two widths across three routes with animations frozen, which produces
byte-identical images run to run. Any refactor of the stylesheet that is meant
to change nothing can be proved that way.

The same oracle caught a bug worth remembering: the theme engine recomputes
every variable the stylesheet also declares, and two of its derived shades
came out one step off the designed palette. On a shop that had never opened
the Branding section, loading the engine quietly changed the hero eyebrow.
`theme.test.js` now reads the `:root` block straight out of the stylesheet and
fails if the engine and the stylesheet ever disagree again.

## The money engine

`pricing.test.js` runs in two halves. The first requires `assets/formats.js`
directly and checks the arithmetic with no browser at all: a price is a sum
before it is markup, and a sum is cheaper to check. The second serves the
real storefront and looks at the page a customer would get.

Two of its checks exist to stop something coming back rather than to prove
something works. One greps `assets/app.js` for a hardcoded VAT rate, which
used to be typed into the product page twice. The other reads the product
feed's field list and fails if anything to do with cost is ever read from
the POS: the feed now passes a former price through, and a former price and
a cost are one careless rename apart.


## The database rules

`account.test.js` opens with a handful of checks that never touch a browser:
they read `supabase-setup.sql` and fail if any policy goes back to trusting
`auth.role() = 'authenticated'`. That check meant *anyone signed in*, which was
safe only while the admin was the one person who could sign in. Customer
accounts ended that.

The cheap guard runs every time. The real proof is three SQL scripts and a
Postgres — see `RLS.md`. They end by putting the old policy back for a single
query, so the difference is shown rather than argued.
