/* =====================================================================
   Vaultique Boutique Point — what the installed app is called and
   what its icon is
   ---------------------------------------------------------------------
   The home-screen icon used to be four PNGs generated from
   images/logo.png and shipped in the folder. That file is the one the
   site was built with, and a shop that has since uploaded a new logo in
   Settings > Branding was left with the old one on its phone — where it
   is the most visible thing there is, and the one place nobody would
   think to look for a stale file.

   So the manifest is built when it is asked for. It reads the same
   branding settings the storefront's header reads, which means the app
   icon is whatever logo the shop last uploaded, and changing it is
   changing it in one place.

   THE SHIPPED TILES ARE STILL HERE, and still the fallback: a shop that
   has uploaded nothing gets the navy tile with the mark on it rather
   than no icon at all.

   WHY THE UPLOADED LOGO IS NOT DECLARED MASKABLE. Android crops a
   maskable icon to a circle or a squircle and keeps only the middle
   60%. A wide logo on a transparent background — which is exactly what
   Settings asks for, because that is what a website header wants —
   would come back with its ends cut off. So the shop's logo is offered
   as an ordinary icon, and the square tile that was drawn for the
   purpose stays the maskable one.
   ===================================================================== */
const { settings } = require('./_seo-data');

/* Only ever the shop's own storage or its own site. A settings value is
   written by an administrator and not by a stranger, but it ends up in a
   file a phone installs from, and "an administrator would not do that"
   is not a reason to hand a browser an address from anywhere at all. */
function safeIcon(url, origin) {
  const s = String(url || '').trim();
  if (!s) return null;
  if (s.charAt(0) === '/') return s;
  let u;
  try { u = new URL(s); } catch (e) { return null; }
  if (u.protocol !== 'https:') return null;
  if (origin && u.origin === origin) return s;
  if (/(^|\.)supabase\.co$/.test(u.hostname)) return s;
  return null;
}

exports.handler = async function (event) {
  let brand = {};
  try { brand = (await settings('branding')) || {}; } catch (e) { brand = {}; }
  let general = {};
  try { general = (await settings('general')) || {}; } catch (e) { general = {}; }

  const proto = (event.headers && event.headers['x-forwarded-proto']) || 'https';
  const host = (event.headers && (event.headers.host || event.headers.Host)) || '';
  const origin = host ? proto + '://' + host : '';

  /* The mobile logo first: it is the one the shop chose for a small
     square-ish space, which is exactly what an app icon is. */
  const chosen = safeIcon(brand.logoMobile, origin) ||
                 safeIcon(brand.logoMain, origin);

  const icons = [];
  if (chosen) {
    /* No sizes claimed that have not been measured. A browser reads the
       file itself when "any" is given, and a wrong number here is worse
       than none — it picks the icon by what it is told. */
    icons.push({ src: chosen, sizes: 'any', purpose: 'any' });
  }
  icons.push({ src: '/images/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' });
  icons.push({ src: '/images/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' });
  icons.push({ src: '/images/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' });

  const shop = String(general.shopName || 'Vaultique Boutique').slice(0, 45);

  const body = {
    name: shop + ' — Shop Desk',
    short_name: shop.split(/\s+/)[0].slice(0, 12),
    description: 'Answer customers, take orders and watch the shop.',
    start_url: '/admin.html#/chats',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: brand.navy || '#0B1F3A',
    theme_color: brand.navy || '#0B1F3A',
    icons: icons,
    shortcuts: [
      { name: 'Live chats', url: '/admin.html#/chats' },
      { name: 'Orders', url: '/admin.html#/orders' }
    ]
  };

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/manifest+json; charset=utf-8',
      /* Short, so a new logo reaches a phone the same day — but not
         nothing, because this is fetched on every install check. */
      'Cache-Control': 'public, max-age=300'
    },
    body: JSON.stringify(body, null, 2)
  };
};
