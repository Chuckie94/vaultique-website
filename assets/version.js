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
  version: '1.60.0',
  build: 90,
  builtAt: '2026-11-26T11:13:03Z',
  notes: 'Shopping, and the policies entered in a window. Admin > Policies: a compact list numbered in the order customers see it; Add policy and Edit open a window on the screen; choosing a number renumbers the rest by themselves, and the page stays where it was. For customers: Compare two to four pieces; Email me when it\'s back and Email me if the price drops (sent once by a half-hourly job); reviews from customers who bought the piece, marked Verified buyer; questions and answers on a piece, published from Admin > Reviews; the wishlist shared as a gift list; sizes and categories in Shopping preferences, with My sizes in the shop; Recently purchased and Order again. One SQL file: supabase-shopping.sql. Holds builds 89 to 84.'
};
