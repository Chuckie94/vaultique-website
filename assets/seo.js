/* =====================================================================
   Vaultique Boutique Point - what each page says about itself
   ---------------------------------------------------------------------
   Titles, descriptions, canonical addresses and the tags a shared link
   shows. Shared by the storefront, the admin's preview and the sitemap
   function, so all three describe a page the same way.

   What a browser can and cannot do here
   -------------------------------------
   Google runs JavaScript, so a title set on the page is eventually seen.
   WhatsApp and Facebook do not. Their scrapers fetch the HTML, read the
   <head> as it arrives, and never run a line of script. Anything written
   here afterwards is invisible to a shared-link preview.

   So this file does two jobs. It keeps the live page correct as somebody
   moves around the site, and it produces the exact block of tags for the
   static <head> - which the admin shows with a Copy button, and then
   checks against what is actually deployed so it cannot go quietly
   stale.
   ===================================================================== */
(function () {
  'use strict';

  /* The pages that have their own settings. About, Contact and Customer
     Care are deliberately absent: they are bands on the home page, not
     addresses, so they share whatever Home says. */
  var PAGES = [
    { id: 'home',     route: '',         label: 'Home' },
    { id: 'shop',     route: 'shop',     label: 'Shop' },
    { id: 'policies', route: 'policies', label: 'Policies' }
  ];

  function clean(v) { return String(v == null ? '' : v).trim(); }

  /* Collapses whitespace and trims to a sensible length on a word rather
     than mid-syllable. Google cuts a description around 160 characters;
     a sentence that stops cleanly reads better than one chopped. */
  function trim(text, max) {
    var t = clean(text).replace(/\s+/g, ' ');
    if (!max || t.length <= max) return t;
    var cut = t.slice(0, max);
    var sp = cut.lastIndexOf(' ');
    if (sp > max * 0.6) cut = cut.slice(0, sp);
    return cut.replace(/[,;:.\s]+$/, '') + '…';
  }

  /* The site's own address, without a trailing slash. Settings > SEO can
     state it, which matters because a site reachable at both www and
     bare, or over http and https, otherwise looks like several sites
     carrying the same pages. */
  function origin(seo) {
    var stated = clean(seo && seo.canonicalBase).replace(/\/+$/, '');
    if (stated) return stated;
    if (typeof location !== 'undefined' && location.origin) {
      return location.origin.replace(/\/+$/, '');
    }
    return '';
  }

  function absolute(seo, route) {
    var base = origin(seo);
    var r = clean(route).replace(/^\/+/, '');
    return base + '/' + r;
  }

  /* ---- what one page says --------------------------------------------
     Everything falls back rather than blanking: a page with nothing
     written for it borrows the site's own title and description, which
     is better than a blank tab or an empty preview. */

  function siteTitle(ctx) {
    var seo = ctx.seo || {}, g = ctx.general || {};
    if (clean(seo.title)) return clean(seo.title);
    var bits = [];
    if (clean(g.businessName)) bits.push(clean(g.businessName));
    if (clean(g.tagline)) bits.push(clean(g.tagline));
    if (clean(g.country)) bits.push(clean(g.country));
    return bits.join(' · ') || 'Vaultique Boutique Point';
  }

  function siteDescription(ctx) {
    var seo = ctx.seo || {}, g = ctx.general || {};
    return trim(clean(seo.description) || clean(g.description), 300);
  }

  /* The sharing picture belongs to Settings > Branding & Appearance,
     beside the logos and the favicon, and was already being written
     before this section existed. Read, never re-asked: two places
     offering the same picture is two pictures waiting to disagree.

     The logo is a poor preview — square, often transparent, tiny in a
     card — so it is a last resort rather than a default. */
  function siteImage(ctx) {
    var b = ctx.branding || {};
    return clean(b.socialImage) || clean(b.logoMain) || '';
  }

  function pageSettings(ctx, id) {
    var pages = (ctx.seo && ctx.seo.pages) || {};
    return pages[id] || {};
  }

  /* One page, resolved. `route` is the plain route ('', 'shop',
     'product/WF-1'); `extra` carries what only the page itself knows,
     such as the product being looked at. */
  function forRoute(ctx, route, extra) {
    ctx = ctx || {}; extra = extra || {};
    var r = clean(route).replace(/^\/+/, '');
    var seo = ctx.seo || {};
    var out = {
      route: r,
      title: siteTitle(ctx),
      description: siteDescription(ctx),
      image: siteImage(ctx),
      canonical: absolute(seo, r),
      robots: '',
      type: 'website'
    };

    var known = null;
    for (var i = 0; i < PAGES.length; i++) if (PAGES[i].route === r) known = PAGES[i];

    if (known) {
      var p = pageSettings(ctx, known.id);
      if (clean(p.title)) out.title = clean(p.title);
      else if (known.id !== 'home') out.title = known.label + ' · ' + siteTitle(ctx);
      if (clean(p.description)) out.description = trim(p.description, 300);
      if (clean(p.image)) out.image = clean(p.image);
      if (clean(p.canonical)) out.canonical = clean(p.canonical);
      return out;
    }

    /* A product. This is where a boutique is actually found: somebody
       searches for the piece, not for the shop. */
    var pm = r.match(/^product\/(.+)$/);
    if (pm && extra.product) {
      return productSeo(ctx, extra.product, out);
    }

    /* A category page borrows the shop's settings and names itself. */
    var sm = r.match(/^shop\/(.+)$/);
    if (sm) {
      var shop = pageSettings(ctx, 'shop');
      var cat = decodeURIComponent(sm[1]);
      out.title = cat + ' · ' + (clean(shop.title) || siteTitle(ctx));
      if (clean(shop.description)) out.description = trim(shop.description, 300);
      return out;
    }

    var polm = r.match(/^policies\/(.+)$/);
    if (polm && extra.policy) {
      out.title = clean(extra.policy.title) + ' · ' + siteTitle(ctx);
      if (clean(extra.policy.body)) out.description = trim(extra.policy.body, 160);
      return out;
    }

    /* A wishlist and an account belong to one person. Naming them in a
       sitemap or letting them be indexed helps nobody and puts a page
       with somebody's name on it into search results. */
    if (r === 'wishlist' || r === 'account') {
      out.robots = 'noindex, follow';
      out.title = (r === 'account' ? 'Your account' : 'Your wishlist') + ' · ' + siteTitle(ctx);
    }
    return out;
  }

  /* A description written from what the piece actually is, because a
     shop with two hundred pieces will not write two hundred by hand. */
  function productSeo(ctx, p, out) {
    var g = ctx.general || {};
    var shop = clean(g.businessName) || 'Vaultique Boutique Point';
    out.type = 'product';
    out.title = clean(p.name) + (clean(p.category) ? ' · ' + clean(p.category) : '') + ' · ' + shop;

    var bits = [];
    if (clean(p.material)) bits.push(clean(p.material).toLowerCase());
    if (clean(p.color)) bits.push('in ' + clean(p.color).toLowerCase());
    if (clean(p.size)) bits.push('size ' + clean(p.size));
    var made = bits.length ? ' — ' + bits.join(', ') : '';

    var priced = (extraPrice(ctx, p) ? ' ' + extraPrice(ctx, p) + '.' : '');
    out.description = trim(
      clean(p.name) + made + '.' + priced +
      ' Available from ' + shop + (clean(g.city) ? ' in ' + clean(g.city) : '') +
      '. Buy on WhatsApp.', 300);

    if (clean(p.image_url)) out.image = clean(p.image_url);
    /* A piece the shop has hidden, or one nobody can buy, should not be
       collecting search traffic to a dead end. */
    if (p.hidden) out.robots = 'noindex, follow';
    return out;
  }

  function extraPrice(ctx, p) {
    if (!ctx.money || !ctx.money.text) return '';
    try { return ctx.money.text(p); } catch (e) { return ''; }
  }

  /* ---- the tags -------------------------------------------------------
     Returned as data so the storefront can apply them, the admin can
     show them, and a test can read them without parsing HTML. */
  function tagsFor(view, ctx) {
    var g = (ctx && ctx.general) || {};
    var seo = (ctx && ctx.seo) || {};
    var tags = [
      { kind: 'title', content: view.title },
      { kind: 'meta', name: 'description', content: view.description },
      { kind: 'link', rel: 'canonical', href: view.canonical },
      { kind: 'meta', property: 'og:title', content: clean(seo.ogTitle) || view.title },
      { kind: 'meta', property: 'og:description', content: clean(seo.ogDescription) || view.description },
      { kind: 'meta', property: 'og:type', content: view.type },
      { kind: 'meta', property: 'og:url', content: view.canonical },
      { kind: 'meta', property: 'og:site_name', content: clean(g.businessName) || 'Vaultique Boutique Point' }
    ];

    var img = view.image;
    if (img) {
      tags.push({ kind: 'meta', property: 'og:image', content: img });
      /* Twitter reads its own tags and falls back to Open Graph, but a
         large card has to be asked for by name. */
      tags.push({ kind: 'meta', name: 'twitter:card', content: 'summary_large_image' });
      tags.push({ kind: 'meta', name: 'twitter:image', content: img });
    } else {
      tags.push({ kind: 'meta', name: 'twitter:card', content: 'summary' });
    }
    tags.push({ kind: 'meta', name: 'twitter:title', content: clean(seo.ogTitle) || view.title });
    tags.push({ kind: 'meta', name: 'twitter:description', content: clean(seo.ogDescription) || view.description });

    if (clean(seo.keywords)) {
      /* Google has ignored this since 2009. Kept because some smaller
         engines and site-search tools still read it, and because a shop
         that asks for it should be able to have it. */
      tags.push({ kind: 'meta', name: 'keywords', content: clean(seo.keywords) });
    }
    if (clean(seo.googleVerification)) {
      tags.push({ kind: 'meta', name: 'google-site-verification', content: clean(seo.googleVerification) });
    }
    if (clean(seo.bingVerification)) {
      tags.push({ kind: 'meta', name: 'msvalidate.01', content: clean(seo.bingVerification) });
    }

    var robots = view.robots || robotsValue(seo);
    if (robots) tags.push({ kind: 'meta', name: 'robots', content: robots });

    return tags.filter(function (t) {
      return clean(t.content) || clean(t.href);
    });
  }

  /* The site-wide instruction to crawlers. 'closed' is the one that
     matters: a shop that is not trading yet should not be found. */
  function robotsValue(seo) {
    switch ((seo && seo.indexing) || 'index') {
      case 'noindex': return 'noindex, nofollow';
      case 'noimage': return 'index, follow, noimageindex';
      default:        return '';   // the default is to be indexed; saying so adds nothing
    }
  }

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* The tags as HTML, for the block the admin hands over to be pasted. */
  function tagsHtml(tags) {
    return tags.map(function (t) {
      if (t.kind === 'title') return '<title>' + esc(t.content) + '</title>';
      if (t.kind === 'link') return '<link rel="' + esc(t.rel) + '" href="' + esc(t.href) + '" />';
      var key = t.property ? 'property="' + esc(t.property) + '"' : 'name="' + esc(t.name) + '"';
      return '<meta ' + key + ' content="' + esc(t.content) + '" />';
    }).join('\n');
  }

  /* ---- applying them to the live page --------------------------------
     Every tag this file owns is marked, so a redraw replaces its own work
     rather than piling a second og:title on top of the first. */
  var OWNED = 'data-vbp-seo';

  function apply(tags) {
    if (typeof document === 'undefined') return;
    var head = document.head;
    if (!head) return;

    Array.prototype.slice.call(head.querySelectorAll('[' + OWNED + ']'))
      .forEach(function (n) { n.parentNode.removeChild(n); });

    tags.forEach(function (t) {
      if (t.kind === 'title') { document.title = t.content; return; }

      /* A tag already in the static head is updated in place rather than
         duplicated. Two og:title tags is not twice as good. */
      var sel = t.kind === 'link'
        ? 'link[rel="' + t.rel + '"]'
        : (t.property ? 'meta[property="' + t.property + '"]' : 'meta[name="' + t.name + '"]');
      var existing = head.querySelector(sel);
      if (existing) {
        existing.setAttribute(t.kind === 'link' ? 'href' : 'content',
                              t.kind === 'link' ? t.href : t.content);
        return;
      }

      var node = document.createElement(t.kind === 'link' ? 'link' : 'meta');
      node.setAttribute(OWNED, '1');
      if (t.kind === 'link') { node.setAttribute('rel', t.rel); node.setAttribute('href', t.href); }
      else if (t.property) { node.setAttribute('property', t.property); node.setAttribute('content', t.content); }
      else { node.setAttribute('name', t.name); node.setAttribute('content', t.content); }
      head.appendChild(node);
    });
  }

  /* ---- the sitemap ----------------------------------------------------
     Every address worth finding. Built here rather than in the function
     so the admin can show exactly what a crawler will be given. */
  function sitemap(ctx, products, policies) {
    var seo = (ctx && ctx.seo) || {};
    var rows = [];
    var seen = {};

    function add(route, priority, changefreq) {
      var url = absolute(seo, route);
      if (seen[url]) return;
      seen[url] = 1;
      rows.push({ loc: url, priority: priority, changefreq: changefreq });
    }

    if ((seo.indexing || 'index') === 'noindex') return rows;   // nothing to offer

    add('', '1.0', 'weekly');
    add('shop', '0.9', 'daily');
    add('policies', '0.3', 'yearly');

    (ctx.categories || []).forEach(function (c) {
      add('shop/' + encodeURIComponent(c), '0.7', 'weekly');
    });
    (products || []).forEach(function (p) {
      if (!p || !p.sku || p.hidden) return;
      add('product/' + encodeURIComponent(p.sku), '0.8', 'weekly');
    });
    (policies || []).forEach(function (p) {
      if (!p || !p.title) return;
      add('policies/' + slug(p.title), '0.2', 'yearly');
    });
    return rows;
  }

  function slug(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function sitemapXml(rows) {
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      rows.map(function (r) {
        return '  <url>\n    <loc>' + esc(r.loc) + '</loc>\n' +
               '    <changefreq>' + r.changefreq + '</changefreq>\n' +
               '    <priority>' + r.priority + '</priority>\n  </url>';
      }).join('\n') +
      '\n</urlset>\n';
  }

  function robotsTxt(ctx) {
    var seo = (ctx && ctx.seo) || {};
    var lines = ['User-agent: *'];

    if ((seo.indexing || 'index') === 'noindex') {
      lines.push('Disallow: /');
      return lines.join('\n') + '\n';
    }

    lines.push('Disallow: /admin.html');
    lines.push('Disallow: /account');
    lines.push('Disallow: /wishlist');
    lines.push('Disallow: /api/');

    var extra = clean(seo.robotsExtra);
    if (extra) extra.split(/\r?\n/).forEach(function (l) {
      if (clean(l)) lines.push(clean(l));
    });

    if (seo.sitemapEnabled !== false) {
      lines.push('');
      lines.push('Sitemap: ' + absolute(seo, 'sitemap.xml'));
    }
    return lines.join('\n') + '\n';
  }

  var api = {
    PAGES: PAGES,
    forRoute: forRoute,
    tagsFor: tagsFor,
    tagsHtml: tagsHtml,
    apply: apply,
    trim: trim,
    absolute: absolute,
    origin: origin,
    slug: slug,
    sitemap: sitemap,
    sitemapXml: sitemapXml,
    robotsTxt: robotsTxt
  };

  if (typeof window !== 'undefined') window.VBP_SEO = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
