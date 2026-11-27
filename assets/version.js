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
  version: '1.57.0',
  build: 87,
  builtAt: '2026-11-25T16:37:36Z',
  notes: 'Customers\' requests. From their own order a signed-in customer can ask to cancel it (before the shop has started on it), return or exchange pieces (within the days set in Settings > Customer Accounts after it arrived, 7 unless set), or report a problem (once it is on its way, up to 30 days after it arrived), with a reason, the pieces, what instead, their words, and photos through the chat. The shop accepts or declines each, with a word for the customer, in the business platform\'s Online Orders (platform 512, behind the till\'s key) or in Admin > Orders; a cancel accepted cancels an order not paid online and not rung up, and one paid online is cancelled by its refund (Online Refund). The customer sees each step and can withdraw; the shop is emailed each new request and the customer each answer (the 15-minute check). Off until switched on in Settings. One SQL file: supabase-customer-requests.sql. Holds builds 86, 85 and 84.'
};
