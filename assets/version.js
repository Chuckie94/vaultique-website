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
  version: '1.53.0',
  build: 83,
  builtAt: '2026-11-19T14:00:33Z',
  notes: 'Each Enquire button starts its own message again, and every message is written in Settings > Live Chat > Enquire buttons. A customer who writes in the live chat can ask to be notified when the shop replies, offered again if they close the chat while still waiting, with a note by the chat button and the count in the tab while the site is open: only within an hour of their message unless Settings > Live Chat says otherwise, and never with what was said. GitHub test logs now say what a failing check found. One SQL file: supabase-chat-reply-push.sql, run once.'
};
