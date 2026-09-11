/* =====================================================================
   Vaultique Boutique Point — the picture on a shared link
   ---------------------------------------------------------------------
   WHAT WAS WRONG. index.html carried og:image as a fixed address —
   /images/logo.png, the mark the site was built with. seo.js does set
   that tag properly from Settings > Branding, but it sets it in
   JavaScript, and the things that build a link preview do not run
   JavaScript. WhatsApp, Facebook and Twitter fetch the page, read the
   HTML as it was served, and never see a line of seo.js.

   So every link this shop shared showed the built-in logo, for ever, in
   the most public place the shop has — and unlike the header logo there
   was no swap a moment later to put it right, because nothing runs.

   WHY A REDIRECT AND NOT A SERVED PAGE. The obvious fix is to build
   index.html to order and put the real address in the tag. That means
   every visit to the shop going through a function instead of the
   CDN — slower for every customer, an invocation for every page view,
   and a site that is down when the function is. For one meta tag that is
   the wrong trade.

   This instead: the tag names one fixed address, /social-image, and this
   sends whoever asks on to the picture the shop last uploaded. A scraper
   follows it — that is ordinary HTTP and every one of them does it — and
   a customer never touches it at all, because nothing on the page loads
   this. It is called when a link is shared and at no other time.

   IF THE SHOP HAS UPLOADED NOTHING, or the database cannot be reached,
   this sends them to the shipped logo. A link preview with the old mark
   is what happens today; a link preview with no picture would be worse.
   ===================================================================== */
const { settings, originFrom } = require('./_seo-data');

/* Only ever the shop's own storage or its own site. These addresses come
   from a settings row an administrator wrote, which is not a stranger —
   but this one ends up as a Location header handed to Facebook, and "an
   administrator would not do that" is not a reason to redirect anybody
   anywhere at all. */
function safe(url, origin) {
  const s = String(url || '').trim();
  if (!s) return null;
  if (s.charAt(0) === '/') return origin ? origin + s : s;
  if (/^https:\/\/[a-z0-9-]+\.supabase\.co\//i.test(s)) return s;
  if (origin && s.indexOf(origin + '/') === 0) return s;
  return null;
}

exports.handler = async function (event) {
  const origin = originFrom(event) || '';
  const shipped = (origin || '') + '/images/logo.png';

  let where = null;
  try {
    const b = await settings('branding');
    /* The same order Settings > SEO reads them in: the picture chosen for
       sharing, then the shop's own logo, then what the folder ships. One
       answer, wherever it comes from. */
    where = safe(b.socialImage, origin) || safe(b.logoMain, origin);
  } catch (e) {
    where = null;
  }

  return {
    statusCode: 302,
    headers: {
      Location: where || shipped,
      /* Long enough that a shop sharing its link fifty times in a day
         costs one lookup, short enough that changing the picture shows
         up the same afternoon. The scrapers cache far harder than this
         anyway — a preview already taken does not come back. */
      'Cache-Control': 'public, max-age=3600',
      'Content-Type': 'text/plain; charset=utf-8'
    },
    body: where || shipped
  };
};
