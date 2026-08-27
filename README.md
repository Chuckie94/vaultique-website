# Vaultique Boutique Point — Website

A luxury storefront for Vaultique Boutique Point (Lusaka, Zambia) with WhatsApp
checkout. It reads your live products from the existing POS automatically and
never touches the POS or its security.

---

## Folder structure

```
vaultique-website/
├── index.html                 the storefront
├── admin.html                 the admin: the shell, routing and the older tabs
├── config.js                  this site's own Supabase keys
├── supabase-setup.sql         run once in Supabase to create the tables
├── netlify.toml               Netlify config + /api/products redirect
├── netlify/
│   └── functions/
│       └── products.js        server-side product feed (holds the read key)
├── assets/
│   ├── app.js                 the storefront's script
│   ├── styles.css             the storefront's styles
│   ├── policies-data.js       the starter policies
│   ├── formats.js             prices, dates and trading hours, shared by both
│   ├── theme.js               branding into colours, fonts and shapes
│   ├── contact.js             numbers, handles and WhatsApp messages
│   ├── preview.css            the mock storefront drawn inside the admin
│   └── admin/
│       ├── registry.js        which pages and settings categories exist
│       ├── settings-store.js  reads and writes the site_settings table
│       ├── settings-ui.js     the shared form kit every category draws with
│       ├── dashboard.js       one file per top level admin page
│       ├── activity-log.js
│       └── settings/          one file per Settings category
├── tests/                     browser tests for the admin (see README there)
└── images/                    optional photos, named by SKU (see README there)
```

Open `index.html` directly to preview the design. `products.js` is the secure
server-side feed.

Each admin Settings category is its own small file under `assets/admin/settings/`.
A category describes the fields it wants and the shared form kit draws them,
loads and saves them, and validates them, so no category talks to the database
itself.

---

## Do I need Supabase and Netlify?

- **Netlify: yes.** Use your EXISTING Netlify account, but create a NEW, separate
  site for the website (free). Do not deploy over your POS site.
- **Supabase: no new project.** The website reads your existing POS Supabase
  READ-ONLY through the function. You create nothing and change nothing in
  Supabase, and you never touch the POS project.

---

## Important: how to deploy a site that has a function

This site includes one serverless function (the piece that securely fetches your
products). Netlify deploys functions through **Git** or the **Netlify CLI** — a
plain browser drag-and-drop uploads static files only and will NOT run the
function, so products would not load.

### Option A — GitHub (recommended, easiest to keep updated)
1. Create a free GitHub account and a new repository.
2. Upload the contents of this folder to the repo (keep the `netlify/functions`
   folder structure intact).
3. In Netlify: Add new site → Import an existing project → pick the repo →
   Deploy. Netlify detects and builds the function automatically.
4. Future changes: update the files in GitHub and Netlify redeploys on its own.

### Option B — Netlify CLI (one computer command)
```
npm install -g netlify-cli
cd vaultique-website
netlify deploy --prod
```

Either way, after deploy open `https://YOUR-SITE.netlify.app/api/products` — you
should see product JSON. If you do, the live feed is working.

### Optional hardening
Move the POS read key into Netlify env vars (Site settings → Environment
variables): `POS_SUPABASE_URL` and `POS_SUPABASE_KEY`.

### Newsletter
The signup uses Netlify Forms (no backend). Submissions appear under **Forms**
in your Netlify dashboard.

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
- **WhatsApp number / Instagram:** edit `WA_SHOP`, `WA_ENQUIRY` and `IG_HANDLE` near the top
  of the script inside `index.html`.
