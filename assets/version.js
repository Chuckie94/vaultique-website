/* =====================================================================
   Vaultique Boutique Point - build stamp
   ---------------------------------------------------------------------
   THIS FILE IS WRITTEN WHEN THE BUILD IS PACKAGED. Do not edit it by
   hand and do not delete it.

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
  version: '1.18.0',
  build: 31,
  builtAt: '2026-08-28T15:17:02Z',
  notes: 'Reviews: shown, written and approved in one place, with holding a review enforced by the database.'
};
