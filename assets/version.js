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
  version: '1.46.0',
  build: 76,
  builtAt: '2026-10-29T17:44:14Z',
  notes: 'Safety work, part 3 (with supabase-hardening.sql): the database now enforces each role\'s ticks and two-factor (required for the owner and for any role ticked for Settings, Orders or Subscribers; the admin shows the setup at sign-in); "Switch off" stops a person at the database; WhatsApp orders are priced by the website from the catalogue and written with the service key; limits on how fast one connection can start chats, write, review, join the newsletter or order; test-mode payments are marked TEST and left out of sales; the preview key is private; the shop makes its own notification keys and the shared ones are retired; someone who unsubscribed is only put back by a link sent to their own inbox; visitors can call only the functions the website uses; older SQL files refuse to undo this.'
};
