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
