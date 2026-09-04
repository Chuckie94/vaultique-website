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

> ### Run `supabase-fixes.sql` as well
>
> **Everybody who set this up before today needs this, once.** Same place —
> SQL Editor > New query > paste the whole of **supabase-fixes.sql** > Run. It
> is safe to run again, and it drops nothing and deletes nothing.
>
> Two things were wrong in the database and neither announced itself:
>
> - **Orders placed by anybody not signed in were never recorded.** They went
>   to WhatsApp as always and the sale was fine, but the Orders tab never saw
>   them. On a shop with customer accounts switched off — which is how it
>   comes — that was every single order.
> - **A review could arrive already wearing the "Verified" badge.** That badge
>   means the shop confirmed this person bought from them. Nothing stopped a
>   review posted straight at the database from setting it, and once approved
>   it wore the badge with the shop never having ticked it.
>
> Running this file fixes both. Nothing on the website needs changing for it
> beyond the files in this package.

## 3. Create your admin login
1. Open **Authentication** > **Users** > **Add user** > **Create new user**.
2. Enter your email and a password. (Tick "Auto Confirm User" if shown.)
3. This email and password is how you log in to the website admin.
4. Run **supabase-setup.sql** once more. That is what puts you in the
   `admins` table, which is what every rule in the database asks about.

> **Then check who is in there, before anything else:**
>
> ```sql
> select email from public.admins;
> ```
>
> It should list you and nobody else. If it is **empty**, the file was
> being careful rather than failing: it only seeds itself when the project
> has exactly one account, so that a project which already had customer
> accounts cannot turn all of them into administrators. Name yourself
> instead:
>
> ```sql
> insert into public.admins (id, email)
> select id, email from auth.users where email = 'you@example.com'
> on conflict (id) do nothing;
> ```
>
> If it lists **anybody else**, remove them — `delete from public.admins
> where email = '...';` — and check again. Anyone on that list has the run
> of the shop.

### Who is the owner, and what that means

Everyone in `admins` can do everything in the admin, with one exception:
**deleting a conversation in Live Chats**. Ending a chat can be undone and
a deleted one cannot, so that one is the owner's.

Running **supabase-chat-phase5.sql** adds a `role` to the `admins` table and
makes the account that was added first the owner — the one that ran this
setup. Everybody else is an `agent`, which is everything they could do
before.

To see where things stand:

```sql
select email, role, added_at from public.admins order by added_at;
```

To name somebody else, or a second person:

```sql
update public.admins set role = 'owner' where email = 'someone@example.com';
```

And to take it back: the same line with `'agent'`. There is no rule saying
there must be exactly one owner — name as many as should be able to delete.

An agent signed in to Live Chats simply does not see the Delete button, and
the database refuses the request even if one is conjured up by hand.

### Logins for people who only answer chats

Somebody hired to answer customers does not need the products, the orders, the
payment details or the settings. **Settings > Live Chat** has a *People who
answer chats* panel where you add them: you give an email and a name, the site
makes the login and shows you a temporary password once, and the first time
they sign in they are made to choose their own before they can do anything.

They sign in at the same address you do. They see Live Chats and nothing else —
not because the tabs are hidden, but because the database refuses them
everything else. Run **supabase-chat-phase6.sql** once to create that.

**One thing to set up first, in Netlify.** Making a login is the one job that
needs Supabase's *service role* key — the key that bypasses every rule in the
database. That key must never reach a browser, so it lives in Netlify and only
a server-side function ever holds it.

1. Supabase > **Project Settings** > **API**. Under *Project API keys*, copy
   the **`service_role`** key. (Not the `anon` one. The `anon` key is the one
   already in `config.js` and is meant to be public; this one is not, ever.)
2. Netlify > your site > **Site configuration** > **Environment variables** >
   **Add a variable**.
   - Key: `SUPABASE_SERVICE_ROLE_KEY`
   - Value: the key you copied
3. **Deploys** > **Trigger deploy** > *Deploy site*, so the functions pick it up.

Until you do that, the panel still lists and switches people on and off — it
only needs the key to *create* a login, and it tells you exactly this if you
try without it.

**If somebody leaves.** *Switch off* stops them answering immediately and keeps
their replies readable in the conversations they handled. *Remove* deletes the
login entirely; their replies stay, because a conversation with half its
messages missing is not a record of anything.

To see who exists at any time:

```sql
select email, display_name, active, must_change_password from public.chat_staff;
```

### A conversation belongs to one person

Run **supabase-chat-phase7.sql** once. After it, a conversation somebody has
taken cannot be answered by anybody else — the reply box goes grey for a
colleague, with their name on it, rather than two people answering the same
customer over each other.

That would be a trap if there were no way out of it, so there are three, and
none of them needs you:

- Nobody has taken it. Anybody may.
- **You** are the shop owner. You can always step in.
- The person holding it is **not at the desk** — their browser has said
  nothing for five minutes, or they have marked themselves *away*.

That last one is what stops a customer waiting behind somebody who has gone
home. Five minutes, not the two the little green light uses: somebody reading a
long message has not left.

**Handing one on.** The dropdown at the top of a conversation — the one that
says who is dealing with it — is also how you pass it to somebody else. Choose
their name and confirm. They are told straight away, on their phone if they
have turned that on. If they are away, it says so before you hand it over.

### Making a phone buzz

Also in **supabase-chat-phase7.sql**. When a customer writes, the database
tells the website, and the website sends a notification to every device that
asked for one — the same kind of buzz a message from anybody else makes, with
the panel closed and the phone in a pocket.

**Each person turns on their own device.** Open **Live Chats** on the phone
that should buzz and press **Notify me here**. That is it — there is nothing to
copy, no key to paste, and no Netlify variable to add. The keys were generated
for this shop and are already in the file.

Do the same on every device that should buzz. A phone, a laptop and a tablet
are three separate presses; turning one off leaves the others alone.

**On an iPhone or iPad this only works from the Home Screen.** Safari will not
send a notification to a page in a tab — it is Apple's rule, not the site's.
Open the admin in Safari, press **Share**, then **Add to Home Screen**, and
open it from the icon that appears. Then press *Notify me here*. On Android
there is nothing extra to do.

**Who gets told.** A conversation somebody has taken buzzes only them. One
nobody has taken buzzes everybody, so it is not left sitting — that is the case
where a customer actually waits. If you would rather only you were told about
those, **Settings > Live Chat > Being told a customer is waiting** has a switch
for it, along with whether the notification shows what the customer wrote.

Turn that preview off if the shop phone is ever passed around or left face up
on the counter: a notification shows on a locked screen.

**There is nothing in the file to fill in or check.** It needs one thing it
cannot know — the address your website answers at — and rather than ask you to
type it, the admin panel tells the database the address it is being used at the
first time you open **Live Chats** after running the file. It follows you if you
move to another domain later, and it ignores Netlify preview builds, whose
addresses stop answering at the next deploy.

Only the shop owner's browser can set it, and that is a real boundary rather
than tidiness: a secret travels to that address, so somebody who could point it
elsewhere would be handed it.

So the order is: run the file, upload the folder, **open Live Chats once**, then
press *Notify me here*.

**If the phones never buzz**, in this order:

1. Was **Notify me here** actually pressed on that device? It says *Notifying
   this device* when it is on.
2. On an iPhone — was it opened from the Home Screen icon, or from a tab?
3. Has the owner opened Live Chats at least once since running the file? That
   is what fills the address in. Check with:
   ```sql
   select data->>'siteUrl' from public.site_settings_private where key = 'chat_push';
   ```
   Blank means nobody has, and blank means no notifications at all — on purpose,
   because a wrong address would fail silently and a blank one is a state that
   fixes itself.
4. Supabase > **Database** > **Extensions**: `pg_net` should be enabled. The
   file turns it on, but a project can refuse.

A missed notification never costs a message. The nudge is wrapped so that if it
fails for any reason at all, the customer's message is still saved and still
appears in Live Chats — being told is a convenience, and the message is not.

### A green dot while somebody is typing

Run **supabase-chat-phase8.sql** once. After it, both sides show a small green
dot that breathes while the other person is writing — in the customer's window
when the shop is, and in Live Chats when the customer is. It sits where the
message will land and says nothing, because a dot is read faster than words.

It appears within about three seconds of somebody starting and goes within about
six of them stopping — both sides ask every three seconds, the same as
everything else in chat. Sending a message clears it at once, so a dot never
lingers promising a message that has already arrived.

Nothing to switch on and nothing to set. Two things worth knowing:

- **A conversation a colleague is holding shows no dot from you.** The reply box
  is closed there, and a dot would be promising the customer an answer you
  cannot send.
- **The dot beside the shop's name in the chat header is a different thing** —
  that one says whether anybody is at the desk, and it has not changed.

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

### Settings > Customer Care

The help panels on the home page, and the questions customers ask before they
buy.

> **Most of what you would expect here is already set, elsewhere — on purpose.**
> Support email, phone and WhatsApp are in **Contact & Social**, along with
> support hours, which the site already shows beside your trading hours.
> Delivery information is in **Delivery & Collection**, payment information in
> **Payments**. And all seven policies — Privacy, Terms, Return, Exchange,
> Delivery, Cancellation and Payment — were **already written** in the Policies
> tab, along with fifty-seven more. Nothing here repeats any of it.

#### The help panels

Your home page shows four. **Three of them had their wording written into the
site itself and could not be edited from anywhere** — that was the real gap this
section fills.

They are a list now: add, remove, reorder, retitle, choose an icon. Opening the
section shows the four you already have, filled in and ready to change. Remove
them all and the site falls back to exactly those four rather than showing an
empty band.

**A panel can borrow its answer** from the section that owns it. Set *Where the
answer comes from* to Delivery and the panel shows your real areas, fees and
collection address; set it to Payments and it lists your real methods and
instructions — which is how the How to pay panel already worked. Change a
delivery fee once, in Delivery, and the panel follows.

**Each panel can link to a policy**, chosen by name from the ones you actually
have. A Returns panel offers *Read the full policy* under it, so the short answer
and the long one finally point at each other. A panel naming a policy you later
delete simply stops offering the link rather than sending anyone nowhere.

#### The FAQ

Questions that open when tapped, at their own address `/faq`, and placeable in
the Homepage section list like any other band.

Each answer can link to a policy too. At the end there is a WhatsApp button,
because a question you have not answered is the one somebody needs answered.

It stays hidden until you have written at least one question, whatever the
switch says — a heading over nothing helps no one.

#### The policies themselves

They stay in the **Policies tab**. They are long documents rather than settings,
and a settings page cannot be a better editor for sixty-four of them than the tab
built for exactly that. What is new is that a panel or a question can now point
at one.

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

#### The block in index.html — already done

**WhatsApp and Facebook do not run JavaScript.** They fetch your page, read the
`<head>` as it arrives, and never run a line of script — so nothing the site sets
afterwards reaches a shared-link preview. Since your whole shop runs on people
sending each other links, this is probably the most valuable thing on the page.

**This is already filled in for you.** The block sits in `index.html` between two
comments marked `SEO BLOCK — START` and `END`, written with your business name,
tagline, description and logo. There is nothing to copy and nothing to paste.

The page then watches it. It **fetches your live `index.html`, reads the tags
actually deployed, and tells you when they no longer match your settings.** It
stays green while they agree. It only turns red if you change your business name,
tagline, description or sharing picture — and then it shows the new block, with a
Copy button, so it can be brought back into line.

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

#### The chat window, and who can see a conversation

**For the customer.** The window has two buttons now. The dash puts it away and
keeps the conversation; the cross ends it, and asks first. A small light in the
header says whether anybody is at the desk — green when somebody is, red when
nobody is — and **Seen** appears under their last message once you have read it.

**A browser is not a person.** The conversation used to be remembered in that
browser indefinitely, so on a shop tablet, a counter computer or any shared
machine the next person to open the site inherited the last one's conversation,
unread badge and all, and could read every word. Now:

- it is remembered for **four hours** of not being used, and then forgotten;
- it is forgotten outright the moment the conversation is closed, by either
  side;
- the customer can end it themselves with the cross.

A customer coming back the same afternoon still finds their thread. Somebody
opening the same browser the next morning gets a clean window.

#### Your name in Live Chats

The box at the top of **Live Chats** is the name your colleagues see beside a
conversation. It starts from your sign-in address, which is rarely how anybody
writes their name — type yours properly and it stays. Beside it, your own
status, and beside each conversation a light saying whether that customer is
still on the site. **End this chat** closes one; it asks first, and either of
you can start a new one afterwards.

#### robots.txt and sitemap.xml

Both are generated from your live settings and catalogue at `/robots.txt` and
`/sitemap.xml` — nothing to write or keep up to date. The sitemap lists your home
page, the shop, every category, **every piece currently in stock** and every
policy. Hidden pieces are left out, and wishlists and accounts are kept out of
search entirely.

Only crawlers ever request them, so no visitor waits on them.

> **How they read your settings.** These two run on Netlify, not in the browser,
> so they cannot use `config.js` the way a page does — they read it off the
> disk. The `[functions]` block in `netlify.toml` is what puts `config.js` where
> they can see it. Setting `WEB_SUPABASE_URL` and `WEB_SUPABASE_ANON_KEY` in
> Site settings → Environment variables does the same job and wins over the
> file; it is the **anon** key, the public one, never the service role key.
>
> **Checking:** open `/sitemap.xml` on your live site and look for your policy
> pages. If `/policies` is there but none of the individual policies are, your
> settings are not being read. `/robots.txt` looks normal either way, so it is
> not the test — but it is quietly ignoring anything you changed, **Do not let
> search engines index my site** included, and the sitemap is listing pieces you
> marked hidden.
>
> **Send a test** under Settings > Notifications tells you the same thing in
> words: a message about the website not being able to read its own settings
> means this, and not that there is anything wrong with your account.

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

### The Activity / Audit Log

A record of every change made in this admin: what changed, when, who changed
it, and what it changed from and to.

| Column | What it holds |
| --- | --- |
| Date & time | When the change was saved |
| Administrator | The email address of whoever was signed in |
| Action | Added, Changed or Deleted |
| Module | Where in the admin it happened |
| Record affected | Which product, policy, order or section |
| Previous & new value | What the field said before and after |
| Session information | The browser and device used |

Filter by section, by action, or search by person, section or record. **Show
older** loads further back.

#### Two things worth knowing

**Nothing private is ever recorded.** A change to your bank account number
appears as *"bankAccountNumber changed · value not recorded"* — never the number
itself. Writing it here would put it straight back into a table your admin can
read, in plain text, for years, which is the whole thing the private settings
table exists to prevent. The value is held back when the line is **written**, so
it is not in the database at all — not merely hidden on screen.

**Nobody can edit or delete a line — including you.** The database has a rule to
write a line and a rule to read the lines, and none at all to change or remove
one. A record the recorded person can tidy up afterwards is not a record of
anything. This is tested against a real database, not assumed.

**Session information** is the browser and device, because that is what a web
page can honestly know. It is not a location and not an internet address — a
browser cannot see either, and a column filled with a guess would be worse than
one filled with the little that is true.

#### What gets recorded

Every settings change in any section; products edited; policies added, edited
and deleted; order status changes and deletions; reviews shown, verified or
deleted; and subscribers unsubscribed or deleted.

Recording can never break what it records. If the log is unreachable, your change
still saves — a missing line is a far smaller problem than a shop that cannot
change its prices.

### Settings > Reviews

Whether reviews appear, who may write them, and what happens to a new one.

**Two of these used to be in Settings > Shopping** — *Show reviews* and *Customer
reviews*. They have moved here with the rest of the subject. If you had switched
either off, your answer is carried across the first time you open this page; press
Save to keep it.

- **Show reviews** — whether the reviews you have appear on the site.
- **Show the star rating** — the score and the count. Turn it off to show what
  people wrote without a mark out of five on everything.
- **Let customers write reviews** — whether new ones can be left.
- **Allow a review without a name** — some people say what they think more
  honestly when they do not have to sign it. You choose the word shown in place
  of a name.

#### What happens to a new review

**Publish new reviews straight away** is off to begin with, which means nothing
appears until you approve it in the Reviews tab. Turn it on and reviews appear at
once — you can still remove any of them afterwards.

With it on, **Except below** holds anything under the rating you pick. A one-star
review still waits for you while five-star ones go up on their own. Nothing is
hidden or thrown away: an unhappy customer simply gets read before they are
published, which is worth doing anyway.

> **This is enforced by the database, not just by the website.** A rule the site
> merely honours is a request — anyone can talk to the database directly, and a
> review arriving already marked as approved would appear on your shop without you
> ever seeing it. The database checks your setting before it accepts a published
> review. Tested against a real database, including the obvious way round it.

Reading and approving happens in the **Reviews** tab, where every review — live
or waiting — can be marked as from a genuine buyer, shown, hidden or deleted.
There is a button on this page that takes you straight there.

### Settings > Newsletter

Every word on the sign-up band used to be written into the website's files, where
you could not reach it. This section hands them back.

- **Run a newsletter** is the master switch. Off means the band appears nowhere,
  the tick box on the sign-up form is not offered, and nothing new is accepted.
  Everyone already on your list stays on it.
- **The invitation** — the small line above, the heading, the sentence explaining
  what joining actually gets someone, the grey text in the box, and the button.
- **When somebody joins** — what they see the moment they sign up, and the small
  print underneath the box. Leave the small print empty and the line disappears
  rather than sitting there blank.
- **The welcome email** — the subject, the message, and the footer under it.
- **Leaving the list** — the words you send somebody you have taken off.

The wording it starts with is exactly what your site says today, so uploading
this build changes nothing until you decide to change it.

#### Where the band appears

Two different questions, two different places:

- **Whether you run a list at all** is the switch at the top of this page, and
  it wins over everything else.
- **Where the band sits on the homepage**, and in what order among the other
  bands, is **Settings > Homepage**.

#### The email account

**Not here.** The sender name, sender address and signature are in
**Settings > Notifications**, and everything the shop sends uses them — one
account, set once.

#### The welcome email

Sent from the **Subscribers** tab, one person at a time, using the wording on
this page. Nobody is written to by accident, and there is no way to empty your
whole list into a spam folder with one click.

The message goes out as: your welcome text, then your signature from
Notifications, then the footer. Any part you leave empty is simply left out.

### The Subscribers tab

- **Search** narrows the list as you type.
- **Export as CSV** saves a file of everyone still subscribed, which opens in
  Excel or Google Sheets.
- **Copy all emails** and **Email all (BCC)** cover only people still
  subscribed — never anyone who has left.

#### Unsubscribe, or delete?

These are not the same thing and the difference matters.

- **Unsubscribe** records that they left. The address stays in the list, greyed
  out, and you are handed your unsubscribe wording, ready to send back to them.
  **Nothing on your site puts them back by accident** — the tick-box beside a
  new account will not, however many times they open one. The one thing that
  will is the person typing their own address into the newsletter box
  themselves, because that is them asking, and telling somebody they had
  rejoined while quietly leaving them off would be worse than either.
- **Delete** erases them completely. Use it when somebody asks to be forgotten
  entirely. Afterwards nothing stops the address being added again.

If somebody asks to stop hearing from you, **unsubscribe** them. If they ask to
be erased, delete them. Anyone unsubscribed can be put back on with one button.

#### Offering it at sign up

Somebody creating an account has already typed their email. Switch
**Offer the list when someone registers** on, and a tick box appears on the
sign-up form in whatever words you choose.

It starts **unticked**, on purpose. A list somebody joined without noticing is a
list they report as spam, and that damage lands on your email address, not
theirs.

Joining happens after the account is made and never blocks it — if the list
write fails for any reason, they still get their account.

### Settings > Notifications

What you say to a customer as their order moves along, and the email account
behind it.

#### The six messages

An order moves through six states: **Received, Confirmed, Ready, On its way,
Delivered, Cancelled.** Each one has a message, already written for you, which
you can rewrite in your own words.

You can use these anywhere in a message, and they are filled in when you send it:

| You type | You get |
| --- | --- |
| `{name}` | the customer's first name |
| `{ref}` | the order reference, e.g. VB-3F9K |
| `{items}` | the items, one per line |
| `{total}` | the order total, in your currency |
| `{business}` | your shop name |
| `{fulfilment}` | delivery or collection |

Leave a message empty and the wording shown underneath it is used, so you can
never end up sending a blank message by accident.

The preview at the bottom shows exactly how each one will read, against an
example order. It follows what you type as you type it.

#### How a message reaches the customer

In the **Orders** tab, set an order to its new status. The WhatsApp button beside
it then says **Message about this order** — tap it, and WhatsApp opens on that
customer's own conversation with the right message already written. You press
send.

Nothing goes out behind your back. Every order on this site is a conversation,
and this keeps it that way — it just saves you typing the same thing forty times
a week.

> The message a **customer** sends **you** when they tap a product is a different
> thing, and lives in Settings > Contact & Social. These are the ones you send
> back.

#### Sending email

Your email provider gives you five details: **host, port, encryption, username
and password.** Put them in and press **Send test email**.

That button sends a real email using exactly the details you saved, so you find
out whether they work rather than hoping. If it fails, it tells you *which* part
failed — a wrong password and an unreachable host need completely different
fixes.

- Most providers use **port 587 with STARTTLS**, or **465 with SSL/TLS**.
- Your **SMTP password is kept in the private table**, with your bank details,
  where the website cannot read it. It never reaches a customer's browser.
- Save your changes before testing — the test uses what is stored, not what is
  on screen.

> The test only works on your live website address. Opening `admin.html` from a
> folder on your computer means the sender is not there to answer.

Password reset and account verification emails are **not** set here — Supabase
sends those using its own settings, and one place for them is enough.

### Settings > Security

The account you sign in with can change every price, read your bank details and
empty the shop. This page is where a password stops being the only thing in the
way.

#### Your login

- **Signed in as** is the email you use here. Changing it asks for your current
  password, then sends a confirmation link. **Your login does not change until
  you open that link**, so a typo cannot lock you out.
- **Change password** asks for the current one first, then the new one twice.
  An admin password must be at least **10 characters and contain a number** —
  a higher bar than the one you set for customers, and if you set a stricter
  rule for customers, that one applies here instead.
- After changing it, you are offered the chance to sign out every other device.
  Take it: anyone still signed in elsewhere stays signed in otherwise.

#### Two factor authentication — turn this on

A six digit code from an app on your phone, on top of your password. Someone who
learns your password still cannot get in.

Press **Set up two factor**, scan the square with Google Authenticator, Microsoft
Authenticator, Authy or any app of that kind, then type the code it shows. From
then on, signing in asks for a code as well.

> **Keep the app.** If you lose the phone and have no other way in, only Supabase
> can let you back into your own admin. Most authenticator apps can back
> themselves up — turn that on when you set it up.

This is checked **every time you sign in**, including when you come back to a tab
that was already open. It is enforced by this admin page, which is what stops a
person with your password. Someone who bypassed the page entirely and spoke to
the database directly would not be stopped by it — if you ever want that closed
too, say so and I will add the database rule for it.

#### Signing in

- **Sign me out automatically** ends your session after a stretch with no
  activity. Worth setting on any computer on the shop floor. Moving the mouse or
  typing counts as activity.
- **Keep me signed in** appears on the sign-in screen. Switch the option off here
  and closing the browser always signs you out.
- **Slow down repeated failed sign-ins** makes this device wait after several
  wrong passwords.

Be clear about that last one: it stops somebody **guessing at your own counter**.
It does not stop a real attacker, who would just open a different browser.
Supabase limits sign-in attempts on its own side, and that is the part that
actually protects you. It is on by default because the counter is the realistic
risk in a shop.

#### Other devices

**Sign out every other device** ends every session except the one you are using —
a phone left at home, a laptop sold, a computer in a shop you no longer use.

There is no list of those devices, and that is deliberate. Only a key that can
read and write your entire database while ignoring every security rule could ask
for such a list, and that key has no business being on a website. So you get the
button the list would have been for, and none of the risk.

#### Administrators

Everyone who can sign in. Adding and removing is done in Supabase rather than
here, on purpose — a page that can promote an account is a page worth attacking.

**Roles and permissions are not built.** Hiding a tab is not a permission: every
rule in the database asks only "is this an administrator", so a limited admin
whose tabs were hidden could still change anything by other means. Real roles
mean a change to the database and a decision about staff. If you have people who
need their own logins, tell me and I will build it properly.

### Settings > System & Maintenance

This section has nothing to fill in. Everything on it is either a fact read live
from your site, or a button that does something.

#### System information

- **Website version** and **build number** identify exactly which upload is
  running. They come from a stamp written into the build itself, so they cannot
  drift or be guessed.
- **This build was packaged** is when the zip was made. **Went live** is when
  that build first reached your site — the admin notices a new build number and
  records the date itself. The two differ whenever a zip waits before upload.
- **Database** and **Photo storage** are tested when you open the page: a real
  request, timed, reporting whatever actually came back.
- **Settings last changed** is the last time anything in this admin was saved.

#### Maintenance

The **maintenance switch is not here** — it is in Settings > General with the
rest of the website status, so there is only ever one switch to find. This page
shows its live state and links straight to it.

- **Refresh website data** throws away the copy of your settings the admin keeps
  while you work, and reads everything fresh. Use it if something you saved is
  not showing up. It affects the admin only: customers read your settings on
  every visit anyway, so a change reaches them next time they open the site.
- **Run health check** tests everything at once — database, photo storage, the
  till feed, whether your settings are filled in, whether the shop is open, and
  **whether your bank details are still sealed off from the public.**

That last one is worth understanding. It opens a second, deliberately
**signed-out** connection — the same view of your database a stranger on the
internet gets — and asks it for your payment details. Nothing coming back is the
pass. If it ever goes red, your bank and mobile money details are readable by
anyone visiting the site: stop and re-run `supabase-setup.sql`. **Run it after
every upload.**

#### Backup

- **Download a backup** saves every setting on every page of this admin into one
  file: business details, prices, delivery, payment details, the lot. Take one
  before big changes.
- The file holds your **bank account and mobile money details in plain readable
  text**. Anyone who opens it can read them. Keep it somewhere only you can get
  to and do not email it to anyone. You are warned before it downloads.
- It does **not** include product photos, orders, customers or reviews. Those
  stay in the database, which Supabase backs up itself.
- **Restore from a backup** reads a file back. It shows you which sections will
  be replaced and asks first. Anything not in the file is left exactly as it is,
  so restoring an old backup cannot blank a section it never knew about.

#### Deployment history

Every build that has gone live, newest first, with the date and a line on what
changed. Written automatically the first time the admin sees a new build, so
there is nothing to keep up to date.

### Closing the website

Two settings in **Settings > General** decide whether customers can shop:

- **Website status** is the normal state. *Live* is the shop as usual.
  *Coming soon* and *Closed* replace it with a notice that still carries your
  WhatsApp number, your email and your usual trading hours.
- **Maintenance mode** is for short interruptions and overrides the status
  while it is on, showing the message you write underneath it.

Either way the storefront is replaced, not merely hidden. **The admin is not
affected** — you can always sign in at `/admin.html` and switch the site back
on.

#### It is a real closure, not just a notice

Until now the notice was only a notice: the page hid itself, but the product
feed carried on handing out the whole catalogue, an order sent straight at the
database was accepted, a chat could still be started, and a search engine that
does not run JavaScript saw the shop rather than the notice. All four are shut
now:

- `/api/products` returns nothing while the shop is shut.
- The database refuses an order and refuses to start a chat.
- `/robots.txt` says `Disallow: /` for as long as the notice is up.
- The chat panel stops asking for messages instead of quietly polling on.

#### Testing while the shop is shut — the preview key

The awkward part of maintenance mode is that you have to open the site to see
your own changes, and the moment you do, a customer can be on it too.

**Settings > General > Preview key** solves that. Put any word in it, then open
your site as:

```
https://yourshop.com/?preview=THATWORD
```

You get the real shop — products, checkout, chat, all of it working — while
everybody else still gets the notice. The key is remembered for that tab, so
you can click around without repeating it, and closing the tab forgets it.

**Be clear about what it is.** It is a door key, not a password. It sits in the
same settings the storefront reads, so it is not a secret and is not meant to
be one. What it stops is a customer wandering in while you work, which is the
thing that actually happens. If you leave it empty, nobody gets past the notice
— including you.

Change it whenever you like; the old one stops working the moment you save.
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
