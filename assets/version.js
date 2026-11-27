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
  version: '1.61.0',
  build: 91,
  builtAt: '2026-11-27T01:00:00Z',
  notes: 'Payments and fraud. The fraud check scores every payment (before it starts and when it is paid, Lenco and Flutterwave), every WhatsApp order and every refund from records the site already keeps; no single signal decides. It starts by watching (D5): nothing held or refused, each case saying what acting would have done. Acting: High held for review, Critical refused before the payment starts. Admin > Fraud & Risk: the totals, the spread of scores, the trend, the review queue (Approve, Reject, Escalate; an approved payment is marked paid only on the gateway\'s word), and the sealed record of every decision and change, which shows if it is touched. One SQL file: supabase-risk.sql. Holds builds 90 to 84.'
};
