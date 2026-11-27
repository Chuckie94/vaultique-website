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
  version: '1.59.0',
  build: 89,
  builtAt: '2026-11-26T09:11:00Z',
  notes: 'Delivery. At checkout, delivery instructions for the courier (a landmark, the gate, the best time), sent with the order and in the WhatsApp message; changed by the customer on their order until it is on its way, and the shop emailed each change. The courier, the tracking number, the courier\'s tracking page and updates for the customer, recorded in Admin > Orders or by the platform when it sends the order (its door is ready for platform 512); shown on the customer\'s order and private progress link, and emailed. Download invoice: an A4 PDF of the till\'s invoice, on the order. Cards: Pay with Zambian card and Pay with international card in place of the question, once DPO is connected. Mended: an order with no refund no longer shows an empty Refunded line. One SQL file: supabase-delivery.sql. Holds builds 88 to 84.'
};
