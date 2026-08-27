/* =====================================================================
   Vaultique Boutique Point - Admin > Settings > Branding & Appearance
   ---------------------------------------------------------------------
   The logos, the palette, the typefaces and the shapes.

   Nothing here works out what a colour means; assets/theme.js does that,
   and the storefront runs the very same code. This file is the form, the
   preview drawn beside it, and the warnings shown when a pairing would
   be hard to read.

   Two things are deliberate:

   - Branding applies to the storefront only. The admin keeps its own
     look, so a colour or a line of custom CSS that makes something
     unreadable can always be undone from here.

   - The sharing image cannot be delivered by JavaScript. Facebook and
     WhatsApp read the page's HTML and never run scripts, so the tag has
     to be in index.html itself. The section stores the image and hands
     over the exact lines to paste; see the note under that field.
   ===================================================================== */
(function () {
  'use strict';
  if (!window.VBP_ADMIN) return;

  var A = window.VBP_ADMIN;
  var T = window.VBP_THEME;
  if (!T) return;                       // theme.js must load first

  A.store.registerDefaults('branding', T.DEFAULTS);

  /* ---- option lists -------------------------------------------------- */

  function fontOptions(kind) {
    return T.FONTS.filter(function (f) { return f.kind === kind; })
                  .map(function (f) { return { value: f.id, label: f.name }; });
  }

  /* Small drawings for the shape choices. Words like "pill" mean much
     less than the shape itself. */
  function buttonArt(radius) {
    return "<svg viewBox='0 0 72 32' aria-hidden='true'>" +
           "<rect x='6' y='7' width='60' height='18' rx='" + radius + "' " +
           "fill='none' stroke='currentColor' stroke-width='1.6'/></svg>";
  }
  function cardArt(kind) {
    var frame = {
      minimal:  "<rect x='9' y='3' width='54' height='20' rx='2' fill='currentColor' opacity='.16'/>",
      bordered: "<rect x='6' y='2' width='60' height='28' rx='3' fill='none' stroke='currentColor' stroke-width='1.4'/>" +
                "<rect x='11' y='6' width='50' height='15' rx='2' fill='currentColor' opacity='.16'/>",
      shadow:   "<rect x='8' y='5' width='58' height='26' rx='3' fill='currentColor' opacity='.13'/>" +
                "<rect x='6' y='2' width='58' height='26' rx='3' fill='none' stroke='currentColor' stroke-width='1.4'/>" +
                "<rect x='11' y='6' width='48' height='14' rx='2' fill='currentColor' opacity='.16'/>",
      framed:   "<rect x='6' y='2' width='60' height='28' rx='3' fill='currentColor' opacity='.1' stroke='currentColor' stroke-width='1.4'/>" +
                "<rect x='11' y='6' width='50' height='15' rx='2' fill='currentColor' opacity='.2'/>"
    }[kind] || '';
    return "<svg viewBox='0 0 72 32' aria-hidden='true'>" + frame + "</svg>";
  }
  function radiusArt(r) {
    return "<svg viewBox='0 0 72 32' aria-hidden='true'>" +
           "<rect x='16' y='4' width='40' height='24' rx='" + r + "' " +
           "fill='none' stroke='currentColor' stroke-width='1.6'/></svg>";
  }

  var BUTTON_CHOICES = [
    { value: 'sharp',   label: 'Square',  preview: buttonArt(1) },
    { value: 'rounded', label: 'Rounded', preview: buttonArt(6) },
    { value: 'pill',    label: 'Pill',    preview: buttonArt(9) }
  ];
  var CARD_CHOICES = [
    { value: 'minimal',  label: 'Minimal',  preview: cardArt('minimal') },
    { value: 'bordered', label: 'Bordered', preview: cardArt('bordered') },
    { value: 'shadow',   label: 'Raised',   preview: cardArt('shadow') },
    { value: 'framed',   label: 'Framed',   preview: cardArt('framed') }
  ];
  var RADIUS_CHOICES = [
    { value: 'sharp',   label: 'Square',  preview: radiusArt(0) },
    { value: 'subtle',  label: 'Subtle',  preview: radiusArt(2) },
    { value: 'rounded', label: 'Rounded', preview: radiusArt(5) },
    { value: 'soft',    label: 'Soft',    preview: radiusArt(10) }
  ];

  /* ---- the preview ---------------------------------------------------- */

  function previewMarkup(esc, general) {
    var name = (general && general.businessName) || 'Vaultique Boutique Point';
    var initials = name.split(/\s+/).slice(0, 2).map(function (w) { return w.charAt(0); })
                       .join('').toUpperCase();
    return '' +
      '<div class="pv-bar">' +
        '<span class="pv-mark" data-logo>' + esc(initials) + '</span>' +
        '<span class="pv-nav"><span>Home</span><span>Shop</span><span>Contact</span></span>' +
      '</div>' +
      '<div class="pv-hero">' +
        '<div class="pv-eyebrow">' + esc(name) + '</div>' +
        '<div class="pv-title">The Collection</div>' +
      '</div>' +
      '<div class="pv-body">' +
        '<div class="pv-grid">' +
          '<div class="pv-card">' +
            '<div class="pv-thumb"><span class="pv-init">' + esc(initials) + '</span>' +
              '<span class="pv-tag">New</span></div>' +
            '<div class="pv-cat">Women’s Fashion</div>' +
            '<div class="pv-name">Aurelia Silk Blouse</div>' +
            '<div class="pv-price">K920</div>' +
          '</div>' +
          '<div class="pv-card">' +
            '<div class="pv-thumb"><span class="pv-init">' + esc(initials) + '</span></div>' +
            '<div class="pv-cat">Accessories</div>' +
            '<div class="pv-name">Gilt Chain Necklace</div>' +
            '<div class="pv-price">K340</div>' +
          '</div>' +
        '</div>' +
        '<div class="pv-actions">' +
          '<span class="pv-btn">Buy on WhatsApp</span>' +
          '<span class="pv-btn ghost">View piece</span>' +
        '</div>' +
        '<div class="pv-field">Search pieces…</div>' +
        '<div class="pv-foot" data-tagline></div>' +
      '</div>';
  }

  /* ---- readability ---------------------------------------------------- */

  /* Pairings worth checking, and what each one is for. A ratio below 4.5
     is hard work for body-sized text; below 3 it is a problem at any
     size. These warn rather than block: it is the shop's own look, and
     a large heading can carry a lower ratio than a caption. */
  function contrastWarnings(values) {
    var v = T.variables(values);
    var checks = [
      { a: v['ink'],   b: v['ivory'], floor: 4.5, what: 'Body text on the page background' },
      { a: v['muted'], b: v['ivory'], floor: 3,   what: 'Small grey text on the page background' },
      { a: v['btn-on'], b: v['btn'],  floor: 4.5, what: 'The writing on your buttons' },
      { a: v['navy-on'], b: v['navy'], floor: 4.5, what: 'The header and hero text' },
      { a: v['accent-strong'], b: v['ivory'], floor: 3, what: 'Category labels and section headings' }
    ];
    var out = [];
    checks.forEach(function (c) {
      var r = T.contrastRatio(c.a, c.b);
      if (r >= c.floor) return;
      out.push({
        what: c.what,
        ratio: r,
        floor: c.floor,
        severe: r < c.floor - 1.5
      });
    });
    return out;
  }

  /* ---- the page -------------------------------------------------------- */

  A.registerSetting({
    key: 'branding',
    title: 'Branding & Appearance',
    summary: 'Logo, colours, fonts and the overall look of the storefront.',
    render: function (host, ctx) {
      var esc = ctx.esc;
      var D = T.DEFAULTS;

      /* The preview column, built once and repainted on every change. */
      var previewWrap = document.createElement('div');
      previewWrap.className = 'card prev-wrap';
      previewWrap.appendChild(mk('div', 'prev-note', 'Live preview — the storefront, not this page'));
      var shell = mk('div', 'prev-shell');
      var stage = mk('div', 'vbp-preview');
      shell.appendChild(stage);
      previewWrap.appendChild(shell);
      var warns = mk('div', 'warns');
      previewWrap.appendChild(warns);

      var themeTag = document.createElement('style');
      document.head.appendChild(themeTag);

      /* General owns the business name, which the preview borrows. */
      var general = A.store.defaults('general');
      A.store.load('general').then(function (g) { general = g; repaintFrame(); }).catch(function () {});

      function repaintFrame() {
        stage.innerHTML = previewMarkup(esc, general);
        if (lastValues) paint(lastValues);
      }

      var lastValues = null;

      function paint(values) {
        lastValues = values;
        themeTag.textContent = T.cssFor(values, '.vbp-preview');

        T.CARD_STYLES.forEach(function (s) { stage.classList.remove('cards-' + s); });
        stage.classList.add('cards-' + (T.CARD_STYLES.indexOf(values.cardStyle) >= 0
          ? values.cardStyle : 'minimal'));

        var mark = stage.querySelector('[data-logo]');
        if (mark) {
          if (values.logoMain) {
            mark.innerHTML = '';
            var im = document.createElement('img');
            im.src = values.logoMain;
            im.alt = '';
            mark.appendChild(im);
          } else if (mark.querySelector('img')) {
            repaintFrame();
            return;
          }
        }
        var tag = stage.querySelector('[data-tagline]');
        if (tag) tag.textContent = (general && general.tagline) || 'Curated Elegance, Accessible Luxury';

        /* Fonts the shop has chosen are not loaded in the admin, so ask
           for them here too or the preview would show a fallback. */
        var href = T.fontHref(values);
        if (href) {
          var link = document.getElementById('vbp-preview-fonts');
          if (!link) {
            link = document.createElement('link');
            link.id = 'vbp-preview-fonts';
            link.rel = 'stylesheet';
            document.head.appendChild(link);
          }
          if (link.getAttribute('href') !== href) link.setAttribute('href', href);
        }

        drawWarnings(values);
        drawSnippet(values);
      }

      function drawWarnings(values) {
        warns.innerHTML = '';
        contrastWarnings(values).forEach(function (w) {
          var d = mk('div', 'warn' + (w.severe ? ' bad-contrast' : ''));
          d.innerHTML = '<span>⚠</span><span><b>' + esc(w.what) + '</b> sits at ' +
            w.ratio.toFixed(1) + ':1 against its background. Aim for at least ' +
            w.floor + ':1 so it stays comfortable to read.</span>';
          warns.appendChild(d);
        });
      }

      /* ---- the sharing-image snippet ---- */
      var snipBox = null;
      function drawSnippet(values) {
        if (!snipBox) return;
        var url = values.socialImage;
        snipBox.innerHTML = '';
        if (!url) {
          snipBox.appendChild(mk('div', 'hint',
            'Choose an image above and the two lines to paste will appear here.'));
          return;
        }
        var lines =
          '<meta property="og:image" content="' + url + '" />\n' +
          '<meta name="twitter:card" content="summary_large_image" />';
        var box = mk('div', 'snip');
        var pre = document.createElement('pre');
        pre.textContent = lines;
        box.appendChild(pre);

        var bar = mk('div', 'snip-bar');
        var copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'btn btn-out btn-sm';
        copy.textContent = 'Copy both lines';
        var said = mk('span', 'stat');
        copy.addEventListener('click', function () {
          function done() { said.textContent = 'Copied'; said.className = 'stat ok'; }
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(lines).then(done, fallback);
          } else fallback();
          function fallback() {
            var t = document.createElement('textarea');
            t.value = lines;
            document.body.appendChild(t);
            t.select();
            try { document.execCommand('copy'); done(); }
            catch (e) { said.textContent = 'Select the text above and copy it'; said.className = 'stat'; }
            document.body.removeChild(t);
          }
        });
        bar.appendChild(copy);
        bar.appendChild(said);
        box.appendChild(bar);
        snipBox.appendChild(box);
      }

      /* ---- the form ---- */
      var formHost = document.createElement('div');

      ctx.ui.form(formHost, {
        key: 'branding',
        savedMessage: 'Saved ✓ — the storefront picks this up within about a minute',
        onChange: paint,
        afterLoad: function (values) { paint(values); },

        groups: [
          {
            title: 'Logos',
            note: 'Leave the mobile and footer logos empty to use the main one everywhere.',
            fields: [
              { type: 'image', name: 'logoMain', label: 'Main logo', previewOn: 'dark',
                prefix: 'branding/logo-main', maxSize: 512 * 1024,
                hint: 'Shown in the header. A wide logo on a transparent background works best.' },
              { type: 'image', name: 'logoMobile', label: 'Mobile logo', previewOn: 'dark',
                prefix: 'branding/logo-mobile', maxSize: 512 * 1024,
                hint: 'For narrow screens, where a wide logo would shrink too far.' },
              { type: 'image', name: 'logoFooter', label: 'Footer logo', previewOn: 'dark',
                prefix: 'branding/logo-footer', maxSize: 512 * 1024,
                hint: 'Often the same mark in a lighter treatment.' },
              { type: 'image', name: 'favicon', label: 'Favicon', previewOn: 'light',
                prefix: 'branding/favicon', maxSize: 128 * 1024,
                hint: 'The small square icon on a browser tab. A square PNG, 64 by 64 or larger.' },
              { type: 'image', name: 'socialImage', label: 'Social sharing image', previewOn: 'light',
                prefix: 'branding/social', maxSize: 1024 * 1024,
                hint: 'The picture shown when your link is shared. Landscape, about 1200 by 630.' }
            ]
          },
          {
            title: 'Colours',
            note: 'Six colours. The lighter and darker shades the site needs are worked out from them.',
            fields: [
              { type: 'colour', name: 'primaryColour', label: 'Primary colour', half: true,
                fallback: D.primaryColour, hint: 'The header, the hero and the deep areas.' },
              { type: 'colour', name: 'secondaryColour', label: 'Secondary colour', half: true,
                fallback: D.secondaryColour, hint: 'The metallic detail: rules, marks, small flourishes.' },
              { type: 'colour', name: 'accentColour', label: 'Accent colour', half: true,
                fallback: D.accentColour, hint: 'Small highlights: the New tag, category labels, section headings.' },
              { type: 'colour', name: 'buttonColour', label: 'Button colour', half: true,
                fallback: D.buttonColour, hint: 'The call to action. Its writing is chosen for contrast.' },
              { type: 'colour', name: 'backgroundColour', label: 'Background colour', half: true,
                fallback: D.backgroundColour, hint: 'The page itself. A dark value gives a dark shop.' },
              { type: 'colour', name: 'textColour', label: 'Text colour', half: true,
                fallback: D.textColour, hint: 'Body copy. Keep it well clear of the background.' }
            ]
          },
          {
            title: 'Typefaces',
            fields: [
              { type: 'select', name: 'headingFont', label: 'Heading font',
                options: fontOptions('heading'),
                hint: 'Product names, section titles and the hero.' },
              { type: 'select', name: 'bodyFont', label: 'Body font',
                options: fontOptions('body'),
                hint: 'Everything else. Changing either adds one request to Google Fonts.' }
            ]
          },
          {
            title: 'Shapes',
            fields: [
              { type: 'choice', name: 'buttonStyle', label: 'Button style',
                options: BUTTON_CHOICES },
              { type: 'choice', name: 'cardStyle', label: 'Product card style',
                options: CARD_CHOICES },
              { type: 'choice', name: 'borderRadius', label: 'Corner rounding',
                options: RADIUS_CHOICES,
                hint: 'Applies across the site. Round things such as badges stay round.' }
            ]
          },
          {
            title: 'Sharing image',
            note: 'One manual step, for a reason worth knowing.',
            fields: []
          },
          {
            title: 'Custom CSS',
            note: 'For small adjustments once everything else is set. Applies to the storefront only, ' +
                  'never to this admin, so anything you write here can always be undone from here.',
            fields: [
              { type: 'code', name: 'customCss', label: 'Custom CSS',
                rows: 9, maxLength: T.CUSTOM_CSS_LIMIT,
                placeholder: '.hero-title {\n  letter-spacing: .04em;\n}',
                hint: 'Added last, so it overrides everything above.' }
            ]
          }
        ]
      });

      /* Slot the sharing-image explanation into its group, and lay the
         form out beside the preview. */
      var layout = mk('div', 'brand-layout');
      var left = mk('div', 'brand-form');
      left.appendChild(formHost);
      layout.appendChild(left);
      layout.appendChild(previewWrap);
      host.appendChild(layout);

      /* The form draws asynchronously, so wait for the group to exist. */
      var tries = 0;
      (function attach() {
        var cards = formHost.querySelectorAll('.card');
        var target = null;
        for (var i = 0; i < cards.length; i++) {
          var h = cards[i].querySelector('h3');
          if (h && h.textContent === 'Sharing image') { target = cards[i]; break; }
        }
        if (!target) {
          if (tries++ < 60) setTimeout(attach, 50);
          return;
        }
        target.appendChild(mk('p', 'hint',
          'Facebook and WhatsApp read your page’s HTML and never run scripts, so a sharing ' +
          'image chosen here cannot reach them on its own. Paste these two lines into index.html, ' +
          'just below the other meta tags, and redeploy. You only need to do this again if you ' +
          'change the image.'));
        snipBox = mk('div');
        target.appendChild(snipBox);
        if (lastValues) drawSnippet(lastValues);
      })();
    }
  });

  function mk(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
})();
