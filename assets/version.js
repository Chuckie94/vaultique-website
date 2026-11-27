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
  version: '1.58.0',
  build: 88,
  builtAt: '2026-11-26T04:33:57Z',
  notes: 'Lenco, the primary payment gateway for Zambia, and one checkout for every way of paying. After the total the customer chooses Mobile Money (Airtel Money, MTN MoMo, Zamtel Kwacha: a request to their phone, approved with their PIN) or Debit / Credit Card (in Lenco\'s own secure window); never a gateway. The payment screens in the owner\'s words (Payment Authorisation Required, Payment Successful, Payment Unsuccessful), with Cancel payment, Didn\'t receive approval request? and a Contact us link to the chat; nobody is asked or charged twice for one order; cards ready to be routed by the customer\'s answer, Zambian or international, once DPO is connected (never a card detail typed on the website). Paid only on Lenco\'s own word, asked directly; webhooks signed and still checked; a failed try can be tried again on the same order, and an order is paid once. Settings > Payments: a switch for each gateway (Lenco; Flutterwave kept, off until approved), what Lenco has activated, its readiness, and payment activity. Which scripts may run is now enforced, and a deploy stops if a secret key or a card field would be published. One SQL file: supabase-lenco.sql. Holds builds 87 to 84.'
};
