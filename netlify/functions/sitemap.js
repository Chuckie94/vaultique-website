// /sitemap.xml — every address worth finding, built from the live
// catalogue and the policies rather than written by hand.
//
// Crawlers only, so no visitor pays for it.
const SEO = require('../../assets/seo.js');
const { rows, settings, originFrom } = require('./_seo-data');

exports.handler = async function (event) {
  const headers = {
    'Content-Type': 'application/xml; charset=utf-8',
    'Cache-Control': 'public, max-age=600, s-maxage=3600',
  };

  try {
    const seo = await settings('seo');
    if (seo.sitemapEnabled === false) {
      return { statusCode: 404, headers: { 'Content-Type': 'text/plain' }, body: 'Not found' };
    }
    if (!seo.canonicalBase) seo.canonicalBase = originFrom(event);

    // The product feed, through the same function the storefront uses, so
    // the sitemap can never list a piece the shop is not showing.
    const base = originFrom(event);
    let products = [];
    try {
      const res = await fetch(`${base}/api/products`);
      if (res.ok) products = (await res.json()).products || [];
    } catch (e) { /* a sitemap of pages is better than no sitemap */ }

    const meta = await rows('product_meta', 'select=sku,hidden');
    const hidden = {};
    (meta || []).forEach((m) => { if (m && m.hidden) hidden[m.sku] = true; });
    products = products.filter((p) => p && !hidden[p.sku]);

    const policies = await rows('policies', 'select=title&order=sort.asc');

    const categories = [];
    products.forEach((p) => {
      const c = (p.category || '').trim();
      if (c && categories.indexOf(c) < 0) categories.push(c);
    });

    const list = SEO.sitemap({ seo, categories }, products, policies);
    return { statusCode: 200, headers, body: SEO.sitemapXml(list) };
  } catch (e) {
    return {
      statusCode: 200,
      headers,
      body: SEO.sitemapXml([{ loc: originFrom(event) + '/', changefreq: 'weekly', priority: '1.0' }]),
    };
  }
};
