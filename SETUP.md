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

The announcement bar, the hero, your story and the core values. Which sections
appear and in what order is a separate piece of work, still to come.

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
