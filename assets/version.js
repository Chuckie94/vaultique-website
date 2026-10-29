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
  version: '1.45.0',
  build: 75,
  builtAt: '2026-10-29T12:32:15Z',
  notes: 'Safety work, part 2: Netlify now publishes only the website (index.html, admin.html, config.js, sw.js, the manifest, assets/ and images/), through a build step that refuses to deploy without a real config.js; safety headers on every page; a Content Security Policy in report-only mode, reporting to the csp-report function; supabase-js 2.118.0 and Leaflet 1.9.4 kept in assets/vendor/ instead of a public CDN; the admin\'s main script moved into assets/admin/shell.js; script addresses carry a fingerprint so a deploy reaches browsers at once. Nothing a customer sees changes.'
};
