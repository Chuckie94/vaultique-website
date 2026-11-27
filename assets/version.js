/* =====================================================================
   Vaultique Boutique Point - build stamp
   ---------------------------------------------------------------------
   THIS FILE IS WRITTEN WHEN THE BUILD IS PACKAGED. Do not delete it.

   AND IT IS WRITTEN BY HAND, because there is no packaging tool in this
   folder that writes it. That is worth saying plainly: the 10 September
   package shipped analytics, chat jobs, Realtime and product pulse while
   this file still said build 31 and "Reviews", so the admin reported the
   wrong build for a week and the deployment history recorded the wrong
   thing going live. Whoever packages a build updates the four values
   below in the same breath. It is the only way the admin can tell you
   what is actually running.

   It is the only way the admin can tell you which build of the website
   is actually live. Without it, Settings > System & Maintenance would
   have to guess, and a version number that is a guess is worse than no
   version number at all.

   Nothing on the customer side of the site loads this file, so it costs
   a visitor nothing. Only admin.html reads it.

     version   the human readable release, bumped per settings section
     build     always goes up, never repeats, one per packaged build
     builtAt   when the zip was made (NOT when it went live - the admin
               records that itself, the first time it sees a new build)
     notes     one line on what changed, shown in the deployment history
   ===================================================================== */
window.VBP_VERSION = {
  version: '1.55.0',
  build: 85,
  builtAt: '2026-11-21T06:36:54Z',
  notes: 'Checkout: the website or WhatsApp. Buy is gold on every piece and Checkout gold in the cart; after the details, Website checkout (gold) first and WhatsApp checkout (green) beside it, each the way it always went. Website checkout appears only when Flutterwave\'s key for the mode chosen is in Netlify, so a switch turned on before Flutterwave is set up shows WhatsApp checkout alone. Green is only ever WhatsApp. A payment made in Test mode is never rung up at the platform\'s till (supabase-test-orders.sql, run once). Holds build 84 (safe releases).'
};
