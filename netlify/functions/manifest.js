/* =====================================================================
   Vaultique Boutique Point — what the installed app is called and
   what its icon is
   ---------------------------------------------------------------------
   The name on the home screen follows the shop: rename the business in
   Settings > General and the installed app is renamed with it, which is
   why this is built when it is asked for rather than kept as a file.

   THE ICON FOLLOWS THE SHOP AGAIN — BUT NOT THE HEADER LOGO.

   It used to be the header logo, and that was removed for three reasons,
   all of them right:

   1. It was declared "any" size, which means "right at every size" — so
      a logo drawn for a website header was chosen ahead of tiles drawn
      at exactly 192 and 512 for this purpose, and they were never
      reached.
   2. A website logo is the wrong shape. Settings > Branding asks for a
      wide mark on a transparent background, because that is what sits in
      a header. A phone puts an app icon on a square and crops that
      square, so a wide transparent mark comes back small, off-centre and
      floating.
   3. The home screen does not refresh. A phone reads the icon once, at
      install, and keeps whatever it took.

   Removing it answered all three and left the shop unable to change its
   app icon at all, which was not the point. So the icon is the shop's
   again and the three are answered instead of avoided: Settings asks for
   a SQUARE picture, for this and nothing else (2); it is declared at 192
   and 512 rather than "any", so it competes rather than wins by default
   (1); and (3) is said plainly under the upload, because it is true and
   cannot be fixed from here.

   THE SHIPPED TILES ARE STILL HERE and still the fallback, in the same
   order: 192 and 512 for ordinary use, and a 512 with the mark inside
   the middle 80% for phones that crop. A shop that uploads nothing is
   exactly where it was.

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
/* Only ever the shop's own storage or its own site. A settings value is
   written by an administrator and not by a stranger, but it ends up in a
   file a phone installs from, and "an administrator would not do that"
   is not a reason to hand a browser an address from anywhere at all. */
function safeIcon(url) {
  const v = String(url || '').trim();
  if (!v) return null;
  if (v.charAt(0) === '/') return v;
  if (/^https:\/\/[a-z0-9-]+\.supabase\.co\//i.test(v)) return v;
  return null;
}

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

  /* THE SHOP'S OWN APP ICON, IF IT HAS UPLOADED ONE.
     ------------------------------------------------------------------
     This was taken away in an earlier round, and it was taken away for
     three good reasons. Two of them are answered here and the third is
     answered on the page that asks for the picture.

     1. It used to be declared sizes:"any", which tells a browser "right
        at every size" -- so a logo drawn for a website header beat the
        tiles drawn at exactly 192 and 512 and they were never reached.
        It is declared at the two real sizes now, and it competes on
        equal terms instead of winning by default.

     2. It used to be the header logo, which is a wide mark on a
        transparent background, and a phone crops an app icon to a
        circle or a squircle. Settings > Branding now asks for a SQUARE
        picture for this and nothing else, so the thing being cropped is
        the right shape to crop.

     3. A phone reads the icon once, at install, and keeps it. That is
        true and cannot be fixed from here, so it is said plainly under
        the upload rather than left to be discovered.

     THE SHIPPED TILES STAY, behind it, in the same order as before. A
     shop that uploads nothing is exactly where it was, and a phone that
     cannot fetch the uploaded one falls through to a tile that is always
     there. */
  const own = safeIcon(brand.appIcon);
  const icons = own
    ? [{ src: own, sizes: '192x192', type: 'image/png', purpose: 'any' },
       { src: own, sizes: '512x512', type: 'image/png', purpose: 'any' }].concat(PWA_ICONS)
    : PWA_ICONS;

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
    icons: icons,
    shortcuts: [
      { name: 'Live chats', url: '/admin.html#/chats', icons: [icons[0]] },
      { name: 'Orders', url: '/admin.html#/orders', icons: [icons[0]] }
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
