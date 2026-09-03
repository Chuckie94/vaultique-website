// /robots.txt — generated from Settings > SEO rather than kept as a file,
// so it follows the settings with nothing to re-upload.
//
// Only crawlers ever ask for this, so no visitor waits on it and nothing
// about the shop breaks if it fails.
const SEO = require('../../assets/seo.js');
const { settings, originFrom } = require('./_seo-data');

exports.handler = async function (event) {
  const headers = {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'public, max-age=300, s-maxage=3600',
  };
  try {
    const seo = await settings('seo');
    if (!seo.canonicalBase) seo.canonicalBase = originFrom(event);

    /* A shop that is shut should not be gathering search traffic to its
       notice. The page says so too, but it says it in JavaScript, after
       it has already been served — and a crawler that does not run
       scripts never sees that. This is the half that does not depend on
       the visitor running anything. */
    const g = await settings('general');
    const closed = g.maintenanceMode === true ||
                   ['closed', 'coming-soon'].indexOf(g.websiteStatus || 'live') > -1;
    if (closed) {
      return { statusCode: 200, headers: Object.assign({}, headers, { 'Cache-Control': 'no-store' }),
               body: 'User-agent: *\nDisallow: /\n' };
    }

    return { statusCode: 200, headers, body: SEO.robotsTxt({ seo }) };
  } catch (e) {
    // A shop with no robots.txt is indexed normally, which is the right
    // outcome when we cannot read the settings. Keeping the admin out is
    // stated here rather than being left to chance.
    return {
      statusCode: 200,
      headers,
      body: 'User-agent: *\nDisallow: /admin.html\n',
    };
  }
};
