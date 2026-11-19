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
  version: '1.50.0',
  build: 80,
  builtAt: '2026-11-18T16:41:53Z',
  notes: 'Build 79 with the work of the other website builds 74 to 78 carried onto it: the order number at the start of the WhatsApp message and points kept on it; orders rung up at the platform\'s till, with the receipt to download; an order\'s progress (preparing, on its way or ready, delivered), Confirm delivery and Ask for more time, its private link and its emails; payment safety (the fifteen-minute check-up, only the exact amount counts as paid, payment needs attention, the payment history, a piece paid for online held); the admin keeps its own sign-in, says Not saved when nothing was saved, and asks in its own dialogs; closing an account now removes the login too, and is refused for any admin login. One SQL file: supabase-hardening.sql, run once more.'
};
