/* =====================================================================
   Vaultique Boutique Point — what the installed app is called and
   what its icon is
   ---------------------------------------------------------------------
   The name on the home screen follows the shop: rename the business in
   Settings > General and the installed app is renamed with it, which is
   why this is built when it is asked for rather than kept as a file.

   THE ICON DOES NOT FOLLOW THE SHOP, AND THAT IS DELIBERATE.

   It used to. The shop's uploaded logo was offered first in this list,
   on the reasoning that a shop which changes its logo should see the
   change everywhere. It was the wrong reasoning, for three separate
   reasons, and all three of them show up on the home screen where they
   are hardest to explain and hardest to undo:

   1. IT WAS DECLARED "any" SIZE. A browser picks an icon by the sizes it
      is given, and "any" means "this one is right at every size" — so a
      logo drawn for a website header was chosen ahead of tiles drawn at
      exactly 192 and 512 for this purpose. The tiles below were never
      reached.

   2. A WEBSITE LOGO IS THE WRONG SHAPE. Settings > Branding asks for a
      wide mark on a transparent background, because that is what sits in
      a header. Android puts an app icon on a square and then crops that
      square to whatever shape the phone uses. A wide transparent mark
      comes back small, off-centre, and floating on whatever colour
      happens to be behind it.

   3. THE HOME SCREEN DOES NOT REFRESH. A phone reads the icon once, at
      install. Whatever it took at that moment it keeps, so "changing the
      logo changes the icon" was never true after the first install
      anyway — it only ever changed the icon for somebody installing the
      app for the first time afterwards.

   So the two are kept apart. The website's logo is the website's, and
   the installed app has three tiles drawn for it: 192 and 512 for
   ordinary use, and a 512 with the mark held inside the middle 80% for
   phones that crop. The shop still owns its colours here — the tile is
   sat on the shop's navy — but not the artwork.

   These are the same three files, in the same order, as the static
   manifest.webmanifest that stands in when this function is not running.
   If one list changes the other has to change with it.
   ===================================================================== */
const { settings } = require('./_seo-data');

/* The three tiles the installed app is drawn from. One list, used by the
   icons array and by the shortcuts below, so a shortcut can never end up
   pointing at an icon the app itself no longer has. */
const PWA_ICONS = [
  { src: '/images/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/images/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: '/images/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
];

/* The shop's primary colour, or nothing.

   This is read straight out of a settings row and handed to a phone, and
   until now it was never read at all: the line below asked for
   brand.navy, and no such key is ever written. Settings > Branding saves
   primaryColour; "navy" is the name of the CSS variable the storefront
   DERIVES from it, one layer further on. So both colours here fell
   through to the shipped default every time, and a shop that had chosen
   its own colour still got this one.

   Guarded now that it is genuinely used. The colour input in Settings
   cannot produce anything but a hex value, but a settings row can also
   be written straight into the database, and a manifest carrying
   nonsense where a colour belongs is refused as a whole in some
   browsers — which would cost the shop the install prompt, not just the
   colour. */
function safeColour(v) {
  const s = String(v || '').trim();
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s) ? s : null;
}

exports.handler = async function () {
  /* Branding is read for the shop's colour and nothing else now. A
     failure is not worth a broken manifest — an install check that gets
     an error here simply stops offering to install — so both reads fall
     back to an empty object and the defaults below take over. */
  let brand = {};
  try { brand = (await settings('branding')) || {}; } catch (e) { brand = {}; }
  let general = {};
  try { general = (await settings('general')) || {}; } catch (e) { general = {}; }

  const shop = String(general.shopName || 'Vaultique Boutique').slice(0, 45);
  /* The same navy the tiles are drawn on, when the shop has chosen
     nothing else. */
  const colour = safeColour(brand.primaryColour) || '#0B1F3A';

  const body = {
    name: shop + ' — Shop Desk',
    short_name: shop.split(/\s+/)[0].slice(0, 12),
    description: 'Answer customers, take orders and watch the shop.',
    start_url: '/admin.html#/chats',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: colour,
    theme_color: colour,
    icons: PWA_ICONS,
    shortcuts: [
      { name: 'Live chats', url: '/admin.html#/chats', icons: [PWA_ICONS[0]] },
      { name: 'Orders', url: '/admin.html#/orders', icons: [PWA_ICONS[0]] }
    ]
  };

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/manifest+json; charset=utf-8',
      /* Unchanged. The name still follows Settings > General, so this is
         still short enough for a rename to reach a phone the same day. */
      'Cache-Control': 'public, max-age=300'
    },
    body: JSON.stringify(body, null, 2)
  };
};
