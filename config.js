/* =====================================================================
   Vaultique Boutique Point — website configuration
   ---------------------------------------------------------------------
   This is the WEBSITE's own Supabase project (for photos and editable
   content). It is SEPARATE from the POS. It never touches the POS and
   only ever holds presentation data (images and text) that anyone may
   read but only you (when logged in) may change.

   Paste your NEW Supabase project's values below, then redeploy.
   Find them in Supabase: Project Settings > API
     - Project URL              -> SUPABASE_URL
     - Project API keys > anon   -> SUPABASE_ANON_KEY   (the "public" key)

   Leave them blank to run the site without the admin layer (products
   still load from the POS as normal).
   ===================================================================== */
window.VBP_CONFIG = {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
  IMAGE_BUCKET: 'product-images'
};
