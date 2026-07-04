# Vaultique Boutique Website — Launch & Update Guide

Your site already runs on GitHub and Netlify. This guide covers two things:
1. Pushing this updated version live.
2. Switching on the admin (photos, content, reviews, subscribers, policies).

You do not need to rebuild anything. The product feed from your POS is untouched.

---

## Part A — Put this update live (5 minutes)

Your site auto-deploys from your GitHub repository: when the repo changes,
Netlify rebuilds and publishes within about a minute. So "going live" means
getting these files into your repo.

### Option 1: GitHub website (no tools needed)
1. Open your repository on https://github.com.
2. Click **Add file > Upload files**.
3. Drag in everything from this folder, keeping the structure:
   - `index.html`, `admin.html`, `config.js`, `netlify.toml`
   - the `assets` folder (`styles.css`, `app.js`, `policies-data.js`)
   - the `images` folder
   - the `netlify` folder (`functions/products.js`)
   - `supabase-setup.sql`, `SETUP.md`, `LAUNCH.md`, `README.md`
4. When asked, choose **Commit changes**.
5. Netlify detects the commit and redeploys automatically. Check your Netlify
   dashboard; in about a minute your live site shows the update.

### Option 2: Netlify CLI (if you prefer the terminal)
From inside this folder:
```
netlify deploy --prod
```

### Important
- Do not deploy by dragging the folder into Netlify's "Sites" drop zone. This
  site has a serverless function (the product feed), which only works through a
  Git deploy or the Netlify CLI. Uploading the folder directly would break the
  product feed.
- After deploying, open your live site and check that products load and that the
  new Policies page opens from the footer link.

---

## Part B — Switch on the admin (one time, about 10 minutes)

Until you do this, the site runs exactly as before: products load from the POS,
and the Policies page shows the starter policies built in. Doing this step lets
you log in to upload photos and edit content, reviews, subscribers and policies.

Full step-by-step is in **SETUP.md**. In short:
1. Create a new Supabase project (separate from your POS).
2. In that project, open SQL Editor and run the whole of **supabase-setup.sql**.
3. Create your login under Authentication > Users (email and password).
4. Copy your Project URL and anon public key into **config.js**.
5. Redeploy (repeat Part A so the filled-in config.js goes live).
6. Go to `https://your-site.netlify.app/admin.html`, sign in, open the
   **Policies** tab and click **Load starter policies** once.

That last click copies the policies into your database so you can edit them.

---

## Quick checklist
- [ ] Files committed to GitHub (or pushed with the CLI).
- [ ] Live site loads products and opens the Policies page.
- [ ] New Supabase project created and `supabase-setup.sql` run.
- [ ] Admin login created.
- [ ] URL and anon key pasted into `config.js`, then redeployed.
- [ ] Signed in to `/admin.html` and clicked "Load starter policies".

## Day to day
- To change wording, photos, reviews, subscribers or policies: use `/admin.html`.
  No redeploy needed; changes appear on the site within about a minute.
- To change the website's design or structure: edit the files and repeat Part A.
- Products, prices and stock are always managed in your POS, not here.
