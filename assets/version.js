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
  version: '1.51.0',
  build: 81,
  builtAt: '2026-11-19T03:46:22Z',
  notes: 'Online refunds for the platform\'s Online Refund: the platform finds the payment through its own door and asks for a refund; the website writes it down first, sends it to Flutterwave once with its own key (the test key for a test payment), and records the answer (pending, completed, failed or refused) with each date and time. Never more than was paid, never sent twice, a lost answer never sent again; an order not yet rung up is refunded whole and cancelled, and put back if Flutterwave says no. Refund notices are asked about, never believed alone; the fifteen-minute check follows refunds too. Admin > Orders shows each step in Payment history; the customer\'s refund email goes within seconds. One SQL file: supabase-online-refund.sql, run once.'
};
