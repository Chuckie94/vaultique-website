/* =====================================================================
   Vaultique Boutique Point - Admin > Settings > SEO
   ---------------------------------------------------------------------
   How the shop describes itself to search engines and to whoever sees a
   link shared in WhatsApp.

   The thing worth understanding before anything else
   --------------------------------------------------
   Google runs JavaScript. WhatsApp and Facebook do not. Their scrapers
   fetch the page, read the <head> as it arrives, and never run a line of
   script - so a title this site writes onto the page afterwards is
   invisible to a shared-link preview.

   Since this whole shop runs on people sending each other links, that
   preview is probably the most valuable thing on this page. It can only
   come from the static <head> in index.html, which the admin cannot
   write to.

   So the section hands over the exact block to paste, and then keeps
   checking: it fetches the live index.html, reads the tags actually
   deployed, and says plainly when they no longer match these settings.
   A snippet you forget to re-paste is the only real weakness of this
   approach, and that is the weakness it removes.

   What was already elsewhere
   --------------------------
   The website title and the meta description were General's: it built a
   title from the business name, tagline and country, and wrote its
   business description into meta[name=description]. Both still work
   exactly that way when nothing here is filled in - what is here is an
   override, not a replacement, so a shop that never opens this page is
   unchanged.

   Two of the fields asked for were the same tag twice. A "default social
   sharing image" and an "Open Graph image" are both og:image, so there is
   one, with an override for when a shop genuinely wants the shared
   picture to differ from the page's own.
   ===================================================================== */
(function () {
  'use strict';
  if (!window.VBP_ADMIN) return;

  var A = window.VBP_ADMIN;
  var SEO = window.VBP_SEO;

  var INDEXING = [
    { value: 'index',   label: 'Index the site — the normal setting' },
    { value: 'noimage', label: 'Index, but keep photos out of image search' },
    { value: 'noindex', label: 'Keep the whole site out of search results' }
  ];

  var DEFAULTS = {
    title: '',
    description: '',
    keywords: '',
    canonicalBase: '',

    ogTitle: '',
    ogDescription: '',

    googleVerification: '',
    bingVerification: '',
    sitemapEnabled: true,
    indexing: 'index',
    robotsExtra: '',

    pages: {}
  };

  A.store.registerDefaults('seo', DEFAULTS);

  /* The pages with their own settings. About, Contact and Customer Care
     are deliberately not here: they are bands on the home page rather
     than addresses, so they share whatever Home says. Saying that is
     kinder than offering three boxes that quietly do nothing. */
  var PAGES = [
    { id: 'home',     label: 'Home',     route: '' },
    { id: 'shop',     label: 'Shop',     route: 'shop' },
    { id: 'policies', label: 'Policies', route: 'policies' }
  ];

  A.registerSetting({
    key: 'seo',
    title: 'SEO',
    summary: 'How the shop appears in search results and when a link is shared.',
    render: function (host, ctx) {
      var general = {}, branding = {};

      Promise.all([
        A.store.load('general').catch(function () { return {}; }),
        A.store.load('branding').catch(function () { return {}; })
      ]).then(function (r) {
        general = r[0] || {}; branding = r[1] || {};
        draw();
      });

      function context(v) {
        return { general: general, branding: branding, seo: v, categories: [] };
      }

      function draw() {
        mountPreview();
        var formHost = document.createElement('div');
        host.appendChild(formHost);

        ctx.ui.form(formHost, {
          key: 'seo',
          savedMessage: 'Saved ✓ — remember to re-paste the block above into index.html',
          onChange: function (v) { showPreview(v); },
          afterLoad: function (v) { showPreview(v); checkDeployed(v); },

          groups: [
            {
              title: 'How the site describes itself',
              note: 'Leave any of these empty and Settings > General is used, exactly as ' +
                    'it is today.',
              fields: [
                { type: 'text', name: 'title', label: 'Website title', maxLength: 70,
                  placeholder: titleFallback(),
                  hint: 'Around 60 characters is what a search result shows. Longer is not ' +
                        'wrong, it is just cut off.' },
                { type: 'textarea', name: 'description', label: 'Meta description',
                  rows: 3, maxLength: 300,
                  placeholder: general.description || 'A paragraph about the shop.',
                  hint: 'Around 160 characters is what a search result shows. This is the ' +
                        'sentence that decides whether somebody clicks.' },
                { type: 'text', name: 'canonicalBase', label: 'Website address',
                  maxLength: 120, placeholder: 'https://vaultiqueboutique.com',
                  validate: function (v) {
                    if (!v) return '';
                    return /^https?:\/\/[^\s\/]+$/.test(v.replace(/\/+$/, ''))
                      ? '' : 'Write it in full, like https://vaultiqueboutique.com, with no path.';
                  },
                  hint: 'With https:// and no trailing slash. A shop reachable at both www ' +
                        'and the bare name otherwise looks to Google like two shops carrying ' +
                        'the same pages, and neither gets the credit.' },
                { type: 'text', name: 'keywords', label: 'Default keywords', maxLength: 200,
                  placeholder: 'boutique, fashion, Lusaka',
                  hint: 'Google has ignored these since 2009. Kept because some smaller ' +
                        'engines still read them, not because they will move you up.' }
              ]
            },
            {
              title: 'When somebody shares a link',
              note: 'The picture and words that appear in a WhatsApp or Facebook preview.',
              fields: [
                { type: 'note', name: 'ogNote', tone: 'warn',
                  label: 'This one cannot come from the settings alone',
                  text: 'WhatsApp and Facebook do not run JavaScript. They read index.html ' +
                        'as it is served, so these tags have to be in the file itself. ' +
                        'Copy the block above into the <head> of index.html and upload it. ' +
                        'This page will tell you whenever what is deployed stops matching ' +
                        'what is set here.' },
                { type: 'note', name: 'imageNote',
                  label: 'The picture lives in Branding & Appearance',
                  text: 'It is a brand asset, so it sits with the logos and the favicon ' +
                        'rather than here, and it is already working. This section uses ' +
                        'whatever is set there. Landscape, around 1200 × 630 — a logo makes ' +
                        'a poor preview, being square and often transparent.' },
                { type: 'text', name: 'ogTitle', label: 'Sharing title', maxLength: 70,
                  hint: 'Leave empty to use the website title above. Worth writing only if ' +
                        'a shared link should say something different.' },
                { type: 'textarea', name: 'ogDescription', label: 'Sharing description',
                  rows: 2, maxLength: 200,
                  hint: 'Leave empty to use the meta description.' }
              ]
            },
            {
              title: 'Search engines',
              fields: [
                { type: 'select', name: 'indexing', label: 'Indexing', options: INDEXING,
                  hint: 'Keep the site out of search while it is not ready to be found. ' +
                        'Settings > General closing the shop does this on its own.' },
                { type: 'text', name: 'googleVerification', label: 'Google verification',
                  half: true, maxLength: 120,
                  hint: 'The content value from the meta tag Search Console gives you.' },
                { type: 'text', name: 'bingVerification', label: 'Bing verification',
                  half: true, maxLength: 120 },
                { type: 'toggle', name: 'sitemapEnabled', label: 'Publish a sitemap',
                  hint: 'Built from your live catalogue at /sitemap.xml, so it lists what ' +
                        'is actually in the shop today with nothing to maintain.' },
                { type: 'textarea', name: 'robotsExtra', label: 'Extra robots.txt lines',
                  rows: 3, maxLength: 500,
                  placeholder: 'Disallow: /private-page',
                  hint: 'Added to what is already there. The admin, accounts and wishlists ' +
                        'are kept out for you.' }
              ]
            },
            {
              title: 'Page by page',
              note: 'Leave anything empty and the page falls back to the settings above.',
              fields: pageFields()
            },
            {
              title: 'Everything else',
              fields: [
                { type: 'note', name: 'autoNote',
                  label: 'Products and categories describe themselves',
                  text: 'Every piece gets its own title and description built from its name, ' +
                        'category, material, colour and price — which is where a boutique is ' +
                        'actually found, since people search for the piece rather than the ' +
                        'shop. Category pages take the Shop settings and name themselves. ' +
                        'Wishlists and accounts are kept out of search entirely.' },
                { type: 'note', name: 'sectionNote',
                  label: 'About, Contact and Customer Care are not pages',
                  text: 'They are bands on the home page rather than separate addresses, so ' +
                        'they share whatever Home says above. Giving them their own boxes ' +
                        'would be offering three settings that could not do anything.' }
              ]
            }
          ],

          validate: function (v, fail) {
            PAGES.forEach(function (pg) {
              var c = (v.pages && v.pages[pg.id] && v.pages[pg.id].canonical) || '';
              if (c && !/^https?:\/\//.test(c)) {
                fail('page_' + pg.id + '_canonical',
                     'A canonical address has to be the full one, starting https://');
              }
            });
          },

          /* The page boxes are drawn flat so the form kit can handle
             them, and folded back into one object on the way out. */
          beforeSave: function (values) {
            var pages = {};
            PAGES.forEach(function (pg) {
              var row = {};
              ['title', 'description', 'image', 'canonical'].forEach(function (k) {
                var name = 'page_' + pg.id + '_' + k;
                if (values[name]) row[k] = values[name];
                delete values[name];
              });
              if (Object.keys(row).length) pages[pg.id] = row;
            });
            values.pages = pages;
            return values;
          },

          afterLoad2: null
        });

        /* The saved shape is nested; the form is flat. Unfolded here so
           the boxes come up filled in. */
        setTimeout(function () {
          A.store.load('seo').then(function (v) {
            var pages = v.pages || {};
            PAGES.forEach(function (pg) {
              var row = pages[pg.id] || {};
              ['title', 'description', 'image', 'canonical'].forEach(function (k) {
                var input = document.getElementById('f_page_' + pg.id + '_' + k);
                if (input && row[k] && !input.value) input.value = row[k];
              });
            });
          });
        }, 120);
      }

      function pageFields() {
        var out = [];
        PAGES.forEach(function (pg) {
          out.push({ type: 'note', name: 'pg_' + pg.id + '_head',
                     label: pg.label,
                     text: 'Address: /' + pg.route });
          out.push({ type: 'text', name: 'page_' + pg.id + '_title',
                     label: pg.label + ' — title', maxLength: 70 });
          out.push({ type: 'textarea', name: 'page_' + pg.id + '_description',
                     label: pg.label + ' — description', rows: 2, maxLength: 300 });
          out.push({ type: 'text', name: 'page_' + pg.id + '_canonical',
                     label: pg.label + ' — canonical address', maxLength: 160,
                     hint: pg.id === 'home'
                       ? 'Only if this page should credit a different address.'
                       : undefined });
        });
        return out;
      }

      function titleFallback() {
        var bits = [];
        if (general.businessName) bits.push(general.businessName);
        if (general.tagline) bits.push(general.tagline);
        if (general.country) bits.push(general.country);
        return bits.join(' · ') || 'Vaultique Boutique Point';
      }

      /* ---- the block to paste, and whether it is still true ---------- */
      var pv = null, snip = null, drift = null;

      function mountPreview() {
        var card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = '<h3>The block for index.html</h3>' +
          '<p class="hint">Copy this into the &lt;head&gt; of index.html, replacing the ' +
          'title and meta tags already there, then upload. WhatsApp and Facebook read ' +
          'the file itself, so this is the only way a shared link shows the right ' +
          'picture and words.</p>';

        snip = document.createElement('pre');
        snip.className = 'seo-snip';
        card.appendChild(snip);

        var row = document.createElement('div');
        row.className = 'row';
        row.style.marginTop = '10px';
        var copy = document.createElement('button');
        copy.className = 'btn btn-out btn-sm';
        copy.textContent = 'Copy the block';
        var said = document.createElement('span');
        said.className = 'stat';
        copy.addEventListener('click', function () {
          var text = snip.textContent;
          function done() { said.textContent = 'Copied ✓'; said.className = 'stat ok'; }
          if (navigator.clipboard) {
            navigator.clipboard.writeText(text).then(done, fallback);
          } else fallback();
          function fallback() {
            var t = document.createElement('textarea');
            t.value = text;
            document.body.appendChild(t);
            t.select();
            try { document.execCommand('copy'); done(); }
            catch (e) { said.textContent = 'Select the text above and copy it'; said.className = 'stat'; }
            document.body.removeChild(t);
          }
        });
        row.appendChild(copy); row.appendChild(said);
        card.appendChild(row);

        drift = document.createElement('div');
        drift.className = 'seo-drift';
        card.appendChild(drift);

        pv = document.createElement('div');
        pv.className = 'seo-preview';
        card.appendChild(pv);
        host.appendChild(card);
      }

      function showPreview(v) {
        if (!SEO || !snip) return;
        var c = context(v);
        var view = SEO.forRoute(c, '');
        var tags = SEO.tagsFor(view, c);
        snip.textContent = SEO.tagsHtml(tags);

        /* What a search result and a shared card would look like, since a
           length in characters means less than seeing it cut off. */
        pv.innerHTML = '';
        var res = document.createElement('div');
        res.className = 'seo-serp';
        res.innerHTML = '<div class="seo-url"></div><div class="seo-t"></div><div class="seo-d"></div>';
        res.querySelector('.seo-url').textContent = view.canonical;
        res.querySelector('.seo-t').textContent = SEO.trim(view.title, 60);
        res.querySelector('.seo-d').textContent = SEO.trim(view.description, 160);
        pv.appendChild(res);

        var img = branding.socialImage || '';
        var card = document.createElement('div');
        card.className = 'seo-card';
        card.innerHTML =
          (img ? '<div class="seo-card-img" style="background-image:url(\'' + img.replace(/'/g, "\\'") + '\')"></div>'
               : '<div class="seo-card-img is-empty">No sharing image</div>') +
          '<div class="seo-card-body"><div class="seo-card-t"></div>' +
          '<div class="seo-card-d"></div><div class="seo-card-u"></div></div>';
        card.querySelector('.seo-card-t').textContent = SEO.trim(v.ogTitle || view.title, 65);
        card.querySelector('.seo-card-d').textContent = SEO.trim(v.ogDescription || view.description, 110);
        card.querySelector('.seo-card-u').textContent = (SEO.origin(v) || '').replace(/^https?:\/\//, '');
        pv.appendChild(card);
      }

      /* The one weakness of a block you paste by hand is forgetting to
         re-paste it. So the page reads what is actually deployed and says
         when the two have parted company. */
      function checkDeployed(v) {
        if (!drift || !SEO) return;
        drift.textContent = '';
        drift.className = 'seo-drift';

        fetch('/index.html', { cache: 'no-store' })
          .then(function (r) { return r.ok ? r.text() : null; })
          .then(function (html) {
            if (!html) return;
            var doc = new DOMParser().parseFromString(html, 'text/html');
            var c = context(v);
            var want = SEO.tagsFor(SEO.forRoute(c, ''), c);

            var stale = [];
            want.forEach(function (t) {
              if (t.kind === 'link') return;   // canonical is set live and is fine
              var live;
              if (t.kind === 'title') {
                var el = doc.querySelector('title');
                live = el ? el.textContent.trim() : '';
              } else {
                var sel = t.property ? 'meta[property="' + t.property + '"]'
                                     : 'meta[name="' + t.name + '"]';
                var m = doc.querySelector(sel);
                live = m ? (m.getAttribute('content') || '').trim() : '';
              }
              if (live !== String(t.content).trim()) {
                stale.push(t.kind === 'title' ? 'the title' : (t.property || t.name));
              }
            });

            if (!stale.length) {
              drift.className = 'seo-drift is-ok';
              drift.textContent = 'The deployed index.html matches these settings.';
              return;
            }
            drift.className = 'seo-drift is-stale';
            drift.textContent =
              'The deployed index.html is out of date: ' + stale.slice(0, 6).join(', ') +
              (stale.length > 6 ? ' and ' + (stale.length - 6) + ' more' : '') +
              '. A link shared right now will show the old version. Copy the block above ' +
              'into index.html and upload it.';
          })
          .catch(function () { /* offline, or opened from a file: say nothing */ });
      }
    }
  });
})();
