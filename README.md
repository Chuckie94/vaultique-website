# Vaultique Boutique Point — Website

A luxury storefront for Vaultique Boutique Point (Lusaka, Zambia) with WhatsApp
checkout. It reads your live products from the existing POS automatically and
never touches the POS or its security.

---

## Folder structure

```
vaultique-website/
├── index.html                 the whole storefront (styles + script inlined)
├── netlify.toml               Netlify config + /api/products redirect
├── netlify/
│   └── functions/
│       └── products.js        server-side product feed (holds the read key)
└── images/                    optional photos, named by SKU (see README there)
```

`index.html` is now a single self-contained file, so you can open it directly
to preview the design. `products.js` is the secure server-side feed.

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
- **WhatsApp number / Instagram:** edit `WA_NUMBER` and `IG_HANDLE` near the top
  of the script inside `index.html`.
