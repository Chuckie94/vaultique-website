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
  version: '1.62.0',
  build: 92,
  builtAt: '2026-11-27T05:33:00Z',
  notes: 'Backups and recovery, on free services (D8). GitHub copies the website\'s database (the shop, the logins, the pictures\' records) and its pictures every two hours, or every hour; checks each copy by restoring it into an empty database; seals it with your public key so only your private key opens it; and keeps it in your own storage account: every copy for two days, one a day for thirty. Off until switched on. RECOVERY.md for the ten cases; the drill every three months; after a restore, the gateways asked and refunds held until you finish. Admin > Settings > Backups. One SQL file: supabase-backup.sql. Holds builds 91 to 84.'
};
