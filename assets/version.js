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
  version: '1.47.0',
  build: 77,
  builtAt: '2026-11-15T20:42:29Z',
  notes: 'Online payment made safer, after the payment audit: the 15-minute check-up also catches a payment that succeeds after a failed try; only the exact amount counts as paid, anything else needs attention (never paid, never cancelled, one email to the shop, shown in Orders); the status page asks Flutterwave about one payment at most every 5 seconds; every payment keeps a history nobody can change (Orders, Payment history); the page after paying no longer says nothing was taken unless Flutterwave says so, and checks for two minutes; a piece paid for online is held, so a second customer cannot pay for it. SQL: supabase-payment-history.sql, once, in this website Supabase.'
};
