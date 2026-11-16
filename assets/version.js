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
  version: '1.48.0',
  build: 78,
  builtAt: '2026-11-16T15:34:05Z',
  notes: 'An order\'s progress, from the till to the customer: once the platform rings an order up, one still to go says Preparing (taken at the counter, Completed); then On its way (with the shop\'s note) or Ready for collection, then Delivered or Collected. The customer sees each step on their account page or behind a private link in their email, with Confirm delivery and Ask for more time; an order on its way is marked delivered after the shop\'s days, with a reminder before (collection orders never by themselves); refunds shown. Emails: on its way, the reminder, delivered, refunded. Orders shows where each order is. Every SQL file hidden from visitors. The admin sign-in check asks the database\'s own administrator rule before saying no, and names the login. SQL: supabase-order-progress.sql, once, in this website Supabase.'
};
