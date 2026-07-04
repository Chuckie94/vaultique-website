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
  story, core values, testimonials, contact numbers, email, Instagram, support
  hours and payment methods. Click **Save content**.
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
