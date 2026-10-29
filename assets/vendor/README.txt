THIRD-PARTY LIBRARIES, KEPT IN THE WEBSITE'S OWN FOLDER (from build 75)
=======================================================================
Until build 74 the admin and the storefront loaded these from public CDNs
at the moment each page opened: supabase-js as "@2", meaning whichever 2.x
release was newest that day, with nothing checking what arrived. The admin
holds full database access, so a bad release, or a bad copy on the CDN,
would have run inside it at once. Kept here, they change only when a build
changes them, and they come from this website and nowhere else.

  supabase-js-2.118.0.js
      @supabase/supabase-js 2.118.0 from npm, file dist/umd/supabase.js:
      the exact file the CDN's "@2" served on 29 October 2026.
      Published 15 October 2026. MIT licence: LICENSE-supabase-js.txt
      sha256 ee3be8de192b97cb1d73d1e95d6b82bb1f6b658c0f97c4ef757fc331996ed3d3

  leaflet-1.9.4/  (leaflet.js, leaflet.css, images/)
      Leaflet 1.9.4 from npm, folder dist/; only the source-map line was
      removed from leaflet.js. BSD-2-Clause: leaflet-1.9.4/LICENSE.txt
      leaflet.js  sha256 dc71f8a6880bc3ca1bd9fa8dc5f1af48c702dc510b0a78240a07c5feed7ce935
      leaflet.css sha256 a7837102824184820dfa198d1ebcd109ff6d0ff9a2672a074b9a1b4d147d04c6

To upgrade one: put the new file beside the old with its version in the
name, change the one place each is named (admin.html, assets/app.js,
assets/chat.js, assets/admin/analytics.js), and delete the old file.
