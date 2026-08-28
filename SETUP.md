# Vaultique Website Admin — Setup (one time)

This connects your website to its own small database so you can log in and
manage product photos and content. It is completely separate from the POS and
never touches it. Products keep coming from the POS automatically.

You will do five short steps. It takes about 10 minutes.

---

## 1. Create a new Supabase project (separate from the POS)
1. Go to https://supabase.com and sign in.
2. Click **New project**. Give it a name like `vaultique-website`.
   IMPORTANT: this must be a NEW project, not your POS project.
3. Set a database password (save it somewhere) and create the project.

## 2. Create the tables and image storage
1. In the new project, open **SQL Editor** (left menu) > **New query**.
2. Open the file **supabase-setup.sql** from this folder, copy everything,
   paste it in, and click **Run**.
3. You should see "Success". This created the photo/content tables, a public
   image bucket, and the security rules.

> **Already set this up before?** Run **supabase-setup.sql** again. It is safe
> to run more than once, and it adds the `site_settings` table that the admin's
> Settings section needs. Without it, Settings > General cannot save.

## 3. Create your admin login
1. Open **Authentication** > **Users** > **Add user** > **Create new user**.
2. Enter your email and a password. (Tick "Auto Confirm User" if shown.)
3. This email and password is how you log in to the website admin.

## 4. Put your keys into the website
1. In Supabase, open **Project Settings** (gear icon) > **API**.
2. Copy two things:
   - **Project URL**
   - **Project API keys > anon** (the "public" key)
3. Open **config.js** in this folder and paste them in:
   ```js
   window.VBP_CONFIG = {
     SUPABASE_URL: 'https://YOUR-PROJECT.supabase.co',
     SUPABASE_ANON_KEY: 'your-anon-public-key',
     IMAGE_BUCKET: 'product-images'
   };
   ```
4. Save the file.

## 5. Redeploy the website
Push the updated folder to your repo (or run `netlify deploy --prod`).

---

## Using the admin
- Go to **https://your-site.netlify.app/admin.html** and sign in.
- **Products & Photos:** every product from the POS is listed. Upload a main
  photo plus extra photos (up to 10 in total) and up to 2 short videos per
  product, mark items Featured or New, hide a product from the site, or write a
  custom description. Changes save instantly.
- **Site Content:** edit the announcement bar, hero text and photos, your
  story, core values, testimonials, contact numbers, email, Instagram and
  payment methods. Click **Save content**.
- **Settings > General:** the business name, trading name, registration number,
  tagline and description; the country, city and address; the time zone,
  currency, date and number formats; your trading hours day by day; and whether
  the website is live, showing a coming-soon page, or in maintenance mode.
  The tagline and trading hours used to sit under Site Content and now live
  here, so the same value is not kept in two places.

### Settings > Branding & Appearance

Your logos, colours, fonts and the shapes the storefront uses. A live preview
sits beside the form and repaints as you change things, so you can see the shop
before saving.

- **Colours.** Six of them. Every lighter and darker shade the site needs is
  worked out from those six, so you are not asked for fourteen. Where a pairing
  would be hard to read, a note appears under the preview saying which pairing
  and by how much. Those are advice, not a refusal — you can save anyway.
- **Fonts.** A short list of pairings that suit the shop. Changing either adds
  one request to Google Fonts.
- **Shapes.** Button style, product card style and how rounded corners are.
  Round things such as badges stay round whatever you choose.
- **Custom CSS.** For small adjustments once everything else is set.

Two things worth knowing:

- Branding applies to **the storefront only**. This admin keeps its own look on
  purpose, so a colour or a line of custom CSS that makes something unreadable
  can always be undone from here.
- **The social sharing image needs one manual step.** Facebook and WhatsApp read
  your page's HTML and never run scripts, so an image chosen in the admin cannot
  reach them by itself. Choose the image, then copy the two lines the section
  shows you into `index.html` below the other meta tags, and redeploy. You only
  need to do that again if you change the image.

### Settings > Contact & Social

Every way a customer reaches you.

- **Contact.** Business phone (shown as a link that dials), WhatsApp number,
  business email and a separate customer support email. What customers see is
  the support address, falling back to the business one. Paste a Google Maps
  share link and a **Get directions** button appears next to your address; leave
  it empty and the address from General is searched for instead.
- **Support hours** follow the trading hours in General unless you switch the
  override on, which starts you from those hours rather than an empty week.

  The Find us block shows **both timetables** when they differ: *Trading hours*
  is when the shop is open, *Support hours* is when somebody answers WhatsApp.
  Each carries its own "open now" chip, worked out in your time zone. While
  support follows the trading hours there is only one row, because printing
  the same line twice under two headings tells a customer nothing. The footer
  always shows the trading hours, since that line is about visiting.
- **Social media.** Type the handle only — `vaultique`, not a whole address. An
  icon appears in the footer for each one you fill in, and nothing appears for
  the ones you leave empty.
- **WhatsApp.** Orders and enquiries can go to different phones. The two message
  templates are what WhatsApp pre-fills, and a preview beside them shows the
  exact message a customer would send. They take `{business}`, and the order one
  also takes `{product}`, `{sku}` and `{price}`.

The WhatsApp numbers, email and Instagram handle used to sit in the Site Content
tab. They live here now, and that tab points at this section.

### Settings > Shopping

What customers see on a product and what they can do with it.

- **Product display.** Whether sold-out pieces appear at all, the badges on a
  photo, the low stock warning, the category line, the product code, whether
  reviews are shown, and which order the shop opens in.
- **What customers can do.** Product enquiries on a sold-out piece, the
  wishlist, a share button, and whether new reviews can be written.

Two of these look like duplicates and are not. **Show reviews** decides whether
the reviews you already have appear; **Customer reviews** decides whether new
ones can be written. Turning submissions off leaves what you have on show.

**About the low stock warning.** Your POS feed sends whether a piece is in stock
and whether only a few are left, and never the count itself — that comparison
happens on the server and only its answer reaches the browser. "A few" means
three or fewer; to change it, add `LOW_STOCK_AT` to your Netlify environment
variables (Site settings → Environment variables). The number still never
reaches the website.

- **Checkout.** Ordering happens on WhatsApp, and these decide what gets asked
  for first. Anything you mark is collected in a short form when a customer taps
  the buy button, and folded into the message, so what reaches you is a complete
  order rather than "is this available?". Mark nothing and the button behaves as
  it always has, opening WhatsApp straight away.

  Nothing is stored on the site. The details travel inside the WhatsApp message,
  and a copy is kept in the customer's own browser so a returning buyer does not
  retype them.

  **WhatsApp checkout** off turns the shop into a catalogue: pieces and prices
  stay, the buy buttons go. **Guest checkout** is shown but locked, because with
  no customer accounts there is nothing for it to be the alternative to; it
  becomes a real choice once that section exists.

### Settings > Payments

Which ways of paying you accept, what each is called, what customers are told,
and the account details behind them.

**Airtel Money and MTN Money are not separate methods here.** They are both
mobile money, so Mobile Money is one method holding as many accounts as you
have — each with its provider, number and account name. Adding Zamtel Kwacha
later is adding a row, not asking for a new method.

**Cash and Payment on Delivery are kept apart on purpose.** Cash is paying in
person at the shop. Payment on delivery is paying whoever brings the order.

#### What is public and what is not

The website reads its settings with a public key, so **anything in the ordinary
settings table can be read by anyone**, whether or not the page shows it. Which
methods you accept, what they are called and the instructions customers see are
meant to be public and live there.

Your **bank details and mobile money numbers do not**. They are kept in
`site_settings_private`, a table with no public read rule at all, so they never
reach a customer's browser. Only a signed-in admin can read them. Send them on
WhatsApp when an order is agreed.

Those groups are marked in the admin. Because the instructions field *is*
public, the section checks it for anything that looks like an account number and
stops you — putting one there would undo the point of the private table.

> **This needs the SQL run again.** `supabase-setup.sql` now creates
> `site_settings_private`. It is safe to run more than once. Without it, the
> bank and mobile money details cannot save.

### Settings > Homepage

The announcement bar, the hero, your story, the core values, and which
sections appear in what order.

- **Announcement bar.** On or off, and what it says. `<b>bold</b>` works.
- **Hero.** On or off, the three rotating photos, the small line, both heading
  lines, the subtitle, and the button. Leave the button's link blank and it goes
  to the shop as it always has; `#/policies` sends it to a page on your site, and
  a full `https://` address opens elsewhere in a new tab.
- **Our story.** The heading and two paragraphs. Clear a paragraph and it goes
  rather than reverting to the words the site shipped with.
- **Core values.** The row of promises under the story. Leave the list empty to
  keep the four the site came with, or add your own — three or six work as well
  as four, and each gets a mark automatically.

A few things people look for here live elsewhere on purpose, each in one place:
the **footer tagline** is in General, **payment information** is in Payments, the
**customer care panels** will be in Customer Care, and the **newsletter wording**
in Newsletter.

- **Testimonials.** Quotes you write yourself, shown after the reviews customers
  actually leave. Real reviews always come first and yours fill what is left.
- **Lookbook photos.** Six squares for the lookbook band.
- **Promotional banner.** A band for a sale or an announcement. It stays hidden
  until you switch it on *and* give it a headline, and you place it in the
  section list below.
- **Sections.** Everything between the hero and the footer: switch a section off,
  move it with the arrows, and give it your own heading. Leave a heading blank to
  keep the wording the site came with. The hero is not in the list — it has its
  own switch above, because it is the frame rather than the contents.

**Best sellers** are ticked in **Products & Photos**, next to Featured and New.
Your POS knows what sells but the product feed deliberately carries no sales
figures, so this is your choice rather than a number's.

> **The SQL adds a column** for that tick. `supabase-setup.sql` is safe to run
> again and does the rest of nothing.

**The Site Content tab is gone.** Everything it held now lives in Settings: the
homepage here, contact details in Contact & Social, payment methods in Payments,
the tagline and trading hours in General.

### Settings > SEO

How the shop describes itself to search engines, and to whoever sees a link
shared in WhatsApp.

#### Your pages have real addresses now

The site used to live behind a `#`: `#/shop`, `#/policies`, `#/product/WF-1`.
Everything after a `#` is the **same address** to a search engine, so Google saw
one page. A sitemap would have listed one entry and every canonical URL would
have been identical.

They are real paths now — `/shop`, `/policies`, `/product/WF-1` — so each can be
found on its own. **Old `#/` links still work**: anyone with one bookmarked, or
sitting in a WhatsApp thread from months ago, is moved to the real address on
arrival.

> **This needs the `netlify.toml` in the zip.** `/shop` is not a file, so without
> the rules in it a visitor typing that address gets a 404. The rules pass your
> admin, assets and images through untouched before the catch-all, so nothing
> else changes.

#### The block you have to paste

**WhatsApp and Facebook do not run JavaScript.** They fetch your page, read the
`<head>` as it arrives, and never run a line of script — so nothing the site sets
afterwards reaches a shared-link preview. Since your whole shop runs on people
sending each other links, this is probably the most valuable thing on the page.

So the section shows the **exact block** for `index.html`, with a Copy button.
Paste it into the `<head>`, replacing the title and meta tags already there, and
upload.

Then it watches. The page **fetches your live `index.html`, reads the tags
actually deployed, and tells you when they no longer match your settings** — so
the one weakness of pasting by hand, forgetting to re-paste, is the one thing it
protects you from.

#### What is set here

- **Website title** and **meta description** override Settings > General. Leave
  them empty and General is used exactly as it is today.
- **Website address** — with `https://` and no trailing slash. A shop reachable
  at both `www.` and the bare name looks to Google like two shops carrying the
  same pages, and neither gets the credit.
- **Sharing title and description** default to the two above. Write them only if
  a shared link should say something different.
- **Indexing** keeps the whole site out of search while it is not ready. Closing
  the shop in General does this on its own.
- **Verification** tags for Google Search Console and Bing.

> **The sharing picture is not here.** It is in **Branding & Appearance** beside
> the logos and the favicon, where it already was and already worked. This
> section uses it rather than asking for it again.

#### robots.txt and sitemap.xml

Both are generated from your live settings and catalogue at `/robots.txt` and
`/sitemap.xml` — nothing to write or keep up to date. The sitemap lists your home
page, the shop, every category, **every piece currently in stock** and every
policy. Hidden pieces are left out, and wishlists and accounts are kept out of
search entirely.

Only crawlers ever request them, so no visitor waits on them.

#### Pages, and what is not a page

**Home, Shop and Policies** get their own title, description and canonical
address. Anything left empty falls back to the settings above.

**About, Contact and Customer Care are not pages.** They are bands on the home
page rather than separate addresses, so they share whatever Home says. Giving
them their own boxes would be offering settings that could not do anything.

**Every product describes itself** from its name, category, material, colour and
price — which is where a boutique is actually found, since people search for the
piece rather than the shop. Category pages take the Shop settings and name
themselves.

### Settings > Customer Accounts

Whether customers can have an account, and what one is worth having.

> **Run `supabase-setup.sql` again before switching this on.** This is not
> housekeeping. Until you run it, every rule in your database treats *anyone
> signed in* as an administrator — which was perfectly safe while you were the
> only person who could sign in. The first customer to register would otherwise
> be able to read and change your prices, your settings, your policies and your
> **bank details**. The file adds an `admins` table, carries your existing login
> into it so you cannot lock yourself out, and rewrites every rule to ask *who*
> is signed in rather than whether anyone is. Safe to run more than once.

- **Offer customer accounts.** Off by default, and off removes sign in from the
  site entirely. Everyone shops as a guest, which is how the shop runs today.
- **New accounts** can be open or closed. Closed keeps existing customers
  signed in but stops new sign-ups.
- **Guest checkout** moved here from Products & Shopping, where it sat switched
  off waiting for this section. Whether somebody may buy without an account is a
  question about accounts. You cannot turn both this and accounts off — that
  would leave no way to buy anything, and the section refuses it.

#### Verifying

**Email verification** works straight away; Supabase sends the message. Someone
can sign in but cannot check out until they have clicked the link, and the site
tells them so on the page rather than letting them reach a dead conversation.

**Phone verification** has its own switch, but it needs an SMS provider
connected to Supabase (Authentication → Providers → Phone, with Twilio or
similar behind it) and costs money per message. Until that exists the switch
saves but the site does not act on it — better than leaving a customer waiting
for a code that will never arrive.

#### Passwords

Supabase enforces its own minimum on the server. What you set here can only ever
be **stricter**, and is checked in the browser as somebody types, so they are
told the rule before they submit rather than after.

#### What an account holds

- **Order history.** An order is written when a customer presses Continue, so it
  records what they *asked for*, not what you agreed. Every one arrives as
  **pending** in the new **Orders** tab, where you confirm, complete or cancel
  it — and the customer sees that status on their account page. It is only worth
  showing them for as long as somebody keeps it honest.
- **Saved addresses.** Without an account the checkout already remembers one
  address on one device. An account makes it several, on any device, and the
  checkout fills itself in from the one marked default.
- **Wishlist follows the account.** A signed-in wishlist moves between their
  phone and their laptop, and whatever they saved before signing in is merged in
  rather than overwritten. The wishlist *itself* stays a Products & Shopping
  setting — this only decides whether one travels.

#### Closing an account

The Data Protection Act No. 3 of 2021 gives people the right to have their
personal information deleted, and your privacy policy already promises it.
Switching this off removes the button, not the obligation.

The profile and saved addresses go, and orders already placed lose their owner
but keep their content, since you need them for your own records. Say that in
the wording, because it is what actually happens.

### Settings > Delivery & Collection

How an order reaches the customer. This replaced a paragraph that was typed
into the site itself and appeared on **every product page**, naming your areas,
your charging and your collection offer, changeable only by editing code.

- **Offer delivery** and **Offer collection.** Either can be off, but not both:
  with neither there is no way for an order to reach anyone. Switching delivery
  off also makes two settings elsewhere pointless, and the section says so —
  *Payment on delivery* in Payments, and *Ask for a delivery address* in
  Products & Shopping.
- **Delivery areas.** Name each place you reach, with how long it takes, the
  fee, and whether same-day is possible there. Leave the list empty and the site
  simply says you deliver without naming anywhere.
- **Show delivery fees.** Off keeps your areas and timings but takes the figures
  out, and says fees are confirmed on WhatsApp instead — which is what the site
  said before this section existed. On publishes them.
- **Standard fee** covers anywhere not named. **Free delivery over** sets the
  amount above which you carry the cost.
- **Speed.** Standard only, or standard and same-day with its own cut-off time
  and fee.

#### Collection

**Collect from the shop address** uses the address in **General** — one address,
kept in one place. Switch it off only if customers actually come somewhere else.
The same for the number: collection and delivery questions go to your **order
WhatsApp number** from Contact & Social unless you set one of your own.

> **Why there is no plain phone box here.** Contact & Social already holds four
> numbers: your business phone, your main WhatsApp, the order number and the
> enquiry number. Two more typed here would be six free to disagree with each
> other.

#### What customers are told

**Delivery terms** is a line or two, shown under the heading on the homepage
band and on every product page. **Delivery instructions** is what a buyer should
do or expect, and appears at checkout where they are deciding.

> **The long form is already written.** Your policies page carries *Delivery
> Policy, Delivery Charges, Delivery Timeframes, Delivery Delays, Failed
> Delivery, Click and Collect* and *Local Pickup*. The site links through to
> them, so these boxes only need the summary. Edit the rest in the Policies tab.

#### At checkout

Where you offer both, the details step asks **Delivered** or **Collected in
person** before anything else, and the answer goes into the WhatsApp message so
you know before you reply. The address box appears and disappears with the
choice, and an address typed before someone changed their mind is not sent —
it would have you delivering to somewhere they said they were coming to fetch
from.

Where you offer only one, nothing is asked: one option is not a choice.

**Delivery & collection** is also a section in the Homepage list, so you can
place the band wherever you like. It hides itself when you offer neither.

### Settings > Pricing & Tax

How a price is written and what it says about tax. **Prices themselves are not
here.** They come from the POS, and nothing on this page invents one.

- **Currency.** The currency itself is in **General**, with the time zone and
  the date format, so you only choose it once. What is here is everything
  General does not decide: the symbol (leave it empty for the usual one — K for
  kwacha, $ for dollars), which side of the amount it sits on, and how many
  decimals show. Thousands and decimal *separators* are General's too.
- **Tax.** One line under the price. Choose whether tax is included in the
  price, added at checkout, or not mentioned at all, then the rate and what you
  call it. This used to be `Price includes 16% VAT`, typed into the site in two
  places and changeable only by editing code.

#### Sale prices come from the POS

There is no box here for typing a sale price, and that is deliberate. **Reduce a
piece in the POS and the website shows it as reduced.**

The POS sends one number per piece and no history, so on its own the site could
show a lower price but never know it had been higher. The admin therefore
remembers: against each piece it keeps the price it last saw. When the POS comes
in lower, the older price is struck through and the percentage is worked out
from the two. Put a price back up and the piece stops being on sale on its own.

The memory is refreshed **whenever you open the Products tab**. If you reduce
something in the POS and never open the admin, the shop still shows the correct
lower price — it simply does not advertise it as a reduction. That is the safe
way round.

Two settings stop this becoming noise:

- **Smallest drop that counts.** A price corrected by a hair is not a sale.
- **A sale stays news for.** After this the piece keeps its lower price but
  stops being advertised as reduced.

Each piece in **Products & Photos** shows what the website is charging, the
older price where there is one, and a **Not a sale** button for when the price
was corrected rather than reduced.

Sale badges are governed by **Show badges** in Products & Shopping, along with
New In and Sold Out — one switch for badges, not two.

- **Price on request.** Tick a piece in Products & Photos to hide its figure.
  Its WhatsApp button asks about the piece instead of buying it, because nobody
  can agree to a price they have not been shown. The message asks what it costs
  and carries no figure.
- **Promotional pricing.** One reduction across the shop or across chosen
  categories, with optional start and end dates. **A piece the POS has already
  reduced keeps its own price** — the two never stack, so nothing is ever cut
  twice.
- **Manual price overrides.** Off by default, which is how the shop runs today.
  Switch them on and each piece gets a website price that replaces the POS
  price outright, including any reduction made there. Overridden pieces are
  marked in Products & Photos with the POS price beside yours, so one cannot sit
  forgotten against a till that has moved on.

Sorting by price follows what a piece **actually costs today**, not what the
till holds, so a reduced piece sorts where its reduced price puts it. A piece
with no price shown has no figure to place and goes last.

> **This needs the SQL run again.** `supabase-setup.sql` adds four columns to
> `product_meta` for the remembered price, its date, an override and the
> price-on-request tick. It is safe to run more than once.

### Closing the website

Two settings in **Settings > General** decide whether customers can shop:

- **Website status** is the normal state. *Live* is the shop as usual.
  *Coming soon* and *Closed* replace it with a notice that still carries your
  WhatsApp number, your email and your usual trading hours.
- **Maintenance mode** is for short interruptions and overrides the status
  while it is on, showing the message you write underneath it.

Either way the storefront is replaced, not merely hidden, so nothing can be
scrolled to or ordered behind the notice. **The admin is not affected** — you
can always sign in at `/admin.html` and switch the site back on.
- **Reviews:** every review left on the site appears here. Mark a review as
  Verified, hide it, or delete it.
- **Subscribers:** see everyone who signed up to the newsletter, copy all
  emails, or use "Email all (BCC)" to send them an update from your own mail app.
- **Policies:** your policies live here. Click **Load starter policies** once to
  import the full set from your manual, then edit any of them, change their order
  with the number, add your own, or delete. They show on the site's Policies page.

## Good to know
- Products, prices and stock still come from the POS and cannot be edited here
  (that is on purpose, so the POS stays the single source of truth).
- The website database only holds photos and text. Anyone can view them, but
  only you (logged in) can change them. Its key is separate from the POS, so it
  can never read POS data.
- Photos are matched to products by SKU, so each product needs a SKU in the POS.
- If the admin says "Almost there", config.js is not filled in yet.
- If the product list is empty in the admin, open it on your live Netlify site
  (the product feed must be reachable, which it is not when opening the file
  directly on a phone).
