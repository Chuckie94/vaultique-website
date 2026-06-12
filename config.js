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
  SUPABASE_URL: 'https://jbzlrbljhyubpqwpzogm.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpiemxyYmxqaHl1YnBxd3B6b2dtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExODIyMDksImV4cCI6MjA5Njc1ODIwOX0.EqEHe5C-kF1D7bRGd80b5SjazLbIsY0U-etQC8DcGa8',
  IMAGE_BUCKET: 'product-images'
};
