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
  version: '1.56.0',
  build: 86,
  builtAt: '2026-11-21T21:56:46Z',
  notes: 'The customer portal. A signed-in customer\'s account is the dashboard of the owner\'s screenshots, with Vaultique navy for the top: Welcome back, their orders, wishlist and points (the points asked of the platform every time), then My shopping, My Vault and Security and privacy, each a page of its own. Orders told apart (Requested, Awaiting payment, Paid, Confirmed, Preparing, On its way, Delivered, Completed, Cancelled) and opened in full with five steps; every refund, the one still on its way included; recently viewed; the password in use asked first; Sign out this device only, or the others, or everywhere; the newsletter yes or no; download my personal data (account-portal, a new server job). A check with a date in it mended (builds 84 and 85 would now be stopped by Netlify). No SQL. Holds builds 85 and 84.'
};
