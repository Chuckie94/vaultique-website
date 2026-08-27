/* =====================================================================
   Vaultique Boutique Point - theme engine
   ---------------------------------------------------------------------
   Turns Settings > Branding & Appearance into the look of the
   storefront. Loaded by the storefront, which applies it, and by the
   admin, which uses the same code to draw a live preview, so what is
   previewed is what ships.

   The stylesheet exposes a small set of custom properties (see the
   :root block in styles.css). This file decides what those should be
   for a given branding row and writes them into a single <style> tag.

   The shop's palette is not six flat colours, it is six colours plus
   about a dozen shades derived from them. Those shades are worked out
   here rather than asked for, using the same saturation and lightness
   steps that separate the original Vaultique palette. Choosing the
   default colours therefore reproduces the original design exactly.

   Hue is never shifted. A shop that picks a green primary gets green
   shades, not green-ish-blue ones.
   ===================================================================== */
(function () {
  'use strict';

  /* ---- colour utilities --------------------------------------------- */

  function parseHex(hex) {
    var h = String(hex || '').trim().replace(/^#/, '');
    if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  function toHex(r, g, b) {
    function p(x) {
      var v = Math.max(0, Math.min(255, Math.round(x))).toString(16);
      return v.length < 2 ? '0' + v : v;
    }
    return '#' + p(r) + p(g) + p(b);
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), h, s, l = (mx + mn) / 2;
    if (mx === mn) { h = 0; s = 0; }
    else {
      var d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return [h * 360, s * 100, l * 100];
  }

  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360; s /= 100; l /= 100;
    if (s === 0) { var v = l * 255; return [v, v, v]; }
    function hue(p, q, t) {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    return [hue(p, q, h + 1 / 3) * 255, hue(p, q, h) * 255, hue(p, q, h - 1 / 3) * 255];
  }

  /* Move a colour by a saturation and lightness step, keeping its hue.
     When `mirror` is set and the colour sits on the far side of mid
     lightness from where the original palette sat, the lightness step is
     flipped. That is what lets a dark background theme work: the shades
     that were a little darker than a pale cream become a little lighter
     than a deep charcoal, instead of collapsing into black. */
  function shift(hex, dS, dL, mirror) {
    var rgb = parseHex(hex);
    if (!rgb) return hex;
    var hsl = rgbToHsl(rgb[0], rgb[1], rgb[2]);
    var l = hsl[2];
    var step = (mirror && ((mirror === 'light' && l < 50) || (mirror === 'dark' && l > 50))) ? -dL : dL;
    var out = hslToRgb(hsl[0], clamp(hsl[1] + dS, 0, 100), clamp(l + step, 0, 100));
    return toHex(out[0], out[1], out[2]);
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function channels(hex) {
    var rgb = parseHex(hex);
    return rgb ? Math.round(rgb[0]) + ',' + Math.round(rgb[1]) + ',' + Math.round(rgb[2]) : '0,0,0';
  }

  /* WCAG relative luminance, used to decide what to write on a colour. */
  function luminance(hex) {
    var rgb = parseHex(hex);
    if (!rgb) return 0;
    var a = rgb.map(function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  }

  function contrastRatio(a, b) {
    var la = luminance(a), lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  /* The readable text colour to put on a given background, choosing the
     better of two. Kept for callers that only ever have two options. */
  function textOn(bg, light, dark) {
    light = light || '#ffffff';
    dark = dark || '#15202e';
    return contrastRatio(bg, light) >= contrastRatio(bg, dark) ? light : dark;
  }

  /* The same question with more than two answers. Candidates are given in
     order of preference, and the first that is comfortably readable wins,
     so a brand colour is used where it can be. Where none is readable
     enough, the most readable is used rather than the most preferred.

     Two candidates is not enough in practice: on a gold button, white is
     unreadable and a dark green primary only reaches 3.8:1, so a version
     of this that only weighed those two would settle for the green. With
     the body ink in the running it reaches 6.8:1 instead. */
  function bestOn(bg, candidates, floor) {
    floor = floor || 4.5;
    var best = null, bestRatio = -1;
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      if (!c) continue;
      var r = contrastRatio(bg, c);
      if (r >= floor) return c;
      if (r > bestRatio) { bestRatio = r; best = c; }
    }
    return best || '#ffffff';
  }

  /* ---- the shades, as steps from each chosen colour ------------------ */
  /* Measured from the original palette, so the defaults rebuild it exactly.
     [saturation step, lightness step] */
  var SHADES = {
    primary: {
      'navy-2':      [ -1.850882,   2.745098],
      'navy-3':      [  7.884058,  -3.725490]
    },
    secondary: {
      'gold-2':      [  1.101187,  13.529412],
      'gold-deep':   [  3.091651, -11.372549],
      'gold-3':      [  0.996134,  12.745098],
      'gold-deep-2': [ 20.895884, -26.274510]
    },
    background: {
      'cream':       [-14.304993,  -3.921569],
      'paper':       [-13.067151,  -1.960784],
      'cream-2':     [-25.751880,  -7.254902],
      'cream-3':     [-15.037594,  -3.137255],
      'sand':        [-22.852002, -19.215686]
    },
    text: {
      'muted':       [-28.377263,  32.941176],
      'slate':       [-15.774971,  12.352941]
    }
  };

  /* The original Vaultique palette, written out. Converting a colour to
     HSL, stepping it and converting back loses a little precision, so
     deriving these would land a shade or two off the values the site was
     designed with. The steps above are for colours the shop has actually
     changed; when a colour is still the one it shipped with, the designed
     shade is used verbatim. */
  var EXACT = {
    '#0b1f3a': { 'navy-2': '#0e2545', 'navy-3': '#06152c' },
    '#c8a24a': { 'gold-2': '#d9bf7e', 'gold-deep': '#a9842f',
                 'gold-3': '#d8bd7b', 'gold-deep-2': '#7a5c12' },
    '#fbf8f0': { 'cream': '#F4EFE3', 'paper': '#F7F3EA', 'cream-2': '#ece7da',
                 'cream-3': '#f5f1e6', 'sand': '#d9cdb0' },
    '#15202e': { 'muted': '#6b7480', 'slate': '#33404f' }
  };

  /* ---- fonts --------------------------------------------------------- */
  /* A short, deliberate list. Each entry carries the family exactly as
     Google Fonts names it, the weights the site needs, and the stack to
     fall back through. */
  var FONTS = [
    { id: 'cormorant', name: 'Cormorant Garamond', kind: 'heading',
      google: 'Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600',
      stack: "'Cormorant Garamond',Georgia,serif" },
    { id: 'playfair', name: 'Playfair Display', kind: 'heading',
      google: 'Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;1,400;1,600',
      stack: "'Playfair Display',Georgia,serif" },
    { id: 'libre-baskerville', name: 'Libre Baskerville', kind: 'heading',
      google: 'Libre+Baskerville:ital,wght@0,400;0,700;1,400',
      stack: "'Libre Baskerville',Georgia,serif" },
    { id: 'lora', name: 'Lora', kind: 'heading',
      google: 'Lora:ital,wght@0,400;0,500;0,600;0,700;1,400;1,600',
      stack: "'Lora',Georgia,serif" },
    { id: 'marcellus', name: 'Marcellus', kind: 'heading',
      google: 'Marcellus',
      stack: "'Marcellus',Georgia,serif" },
    { id: 'dm-serif', name: 'DM Serif Display', kind: 'heading',
      google: 'DM+Serif+Display:ital@0;1',
      stack: "'DM Serif Display',Georgia,serif" },

    { id: 'jost', name: 'Jost', kind: 'body',
      google: 'Jost:wght@300;400;500;600',
      stack: "'Jost',system-ui,sans-serif" },
    { id: 'inter', name: 'Inter', kind: 'body',
      google: 'Inter:wght@300;400;500;600',
      stack: "'Inter',system-ui,sans-serif" },
    { id: 'montserrat', name: 'Montserrat', kind: 'body',
      google: 'Montserrat:wght@300;400;500;600',
      stack: "'Montserrat',system-ui,sans-serif" },
    { id: 'lato', name: 'Lato', kind: 'body',
      google: 'Lato:wght@300;400;700',
      stack: "'Lato',system-ui,sans-serif" },
    { id: 'work-sans', name: 'Work Sans', kind: 'body',
      google: 'Work+Sans:wght@300;400;500;600',
      stack: "'Work Sans',system-ui,sans-serif" },
    { id: 'dm-sans', name: 'DM Sans', kind: 'body',
      google: 'DM+Sans:wght@300;400;500;700',
      stack: "'DM Sans',system-ui,sans-serif" },
    { id: 'raleway', name: 'Raleway', kind: 'body',
      google: 'Raleway:wght@300;400;500;600',
      stack: "'Raleway',system-ui,sans-serif" },
    { id: 'poppins', name: 'Poppins', kind: 'body',
      google: 'Poppins:wght@300;400;500;600',
      stack: "'Poppins',system-ui,sans-serif" }
  ];

  function font(id) {
    for (var i = 0; i < FONTS.length; i++) if (FONTS[i].id === id) return FONTS[i];
    return null;
  }

  /* ---- presets -------------------------------------------------------- */

  var BUTTON_STYLES = {
    sharp:   '2px',
    rounded: '8px',
    pill:    '999px'
  };

  /* Multipliers on the rounding scale. The pill radius is not in here:
     tags, chips and the search field are pills by design and stay so. */
  var RADIUS_SCALES = {
    sharp:   0,
    subtle:  0.5,
    rounded: 1,
    soft:    2
  };
  var RADIUS_BASE = { xs: 2, sm: 4, md: 6, lg: 8, xl: 10 };

  var CARD_STYLES = ['minimal', 'bordered', 'shadow', 'framed'];

  /* ---- defaults ------------------------------------------------------- */

  var DEFAULTS = {
    logoMain: '', logoMobile: '', logoFooter: '', favicon: '', socialImage: '',
    primaryColour: '#0B1F3A',
    secondaryColour: '#C8A24A',
    accentColour: '#C8A24A',
    backgroundColour: '#FBF8F0',
    textColour: '#15202e',
    buttonColour: '#C8A24A',
    headingFont: 'cormorant',
    bodyFont: 'jost',
    buttonStyle: 'sharp',
    cardStyle: 'minimal',
    borderRadius: 'rounded',
    customCss: ''
  };

  function merged(b) {
    var out = {}, k;
    for (k in DEFAULTS) out[k] = DEFAULTS[k];
    if (b) for (k in b) {
      if (Object.prototype.hasOwnProperty.call(b, k) && b[k] !== null && b[k] !== undefined && b[k] !== '') {
        out[k] = b[k];
      }
    }
    return out;
  }

  /* ---- building the CSS ------------------------------------------------ */

  /* The custom properties for a branding row, as "name:value" pairs. */
  function variables(branding) {
    var b = merged(branding);
    var v = {};

    function family(group, base, mirror) {
      var set = SHADES[group], k;
      for (k in set) v[k] = one(base, k, set[k][0], set[k][1], mirror);
    }

    /* One derived shade. `as` names the step in the designed palette this
       shade corresponds to, so a colour still at its shipped value gets the
       designed shade rather than a re-derived near-miss. */
    function one(base, as, dS, dL, mirror) {
      var exact = EXACT[String(base).toLowerCase()];
      if (exact && exact[as]) return exact[as];
      return shift(base, dS, dL, mirror);
    }

    v['navy'] = b.primaryColour;
    v['navy-rgb'] = channels(b.primaryColour);
    family('primary', b.primaryColour);
    v['navy-3-rgb'] = channels(v['navy-3']);

    v['gold'] = b.secondaryColour;
    v['gold-rgb'] = channels(b.secondaryColour);
    family('secondary', b.secondaryColour);

    v['ivory'] = b.backgroundColour;
    v['ivory-rgb'] = channels(b.backgroundColour);
    family('background', b.backgroundColour, 'light');
    v['cream-rgb'] = channels(v['cream']);

    /* Anything raised off the page: inputs, selects, the shop toolbar, the
       button that floats over a product photo. White reads as raised on a
       pale site; on a dark one it would read as a hole, so a step lighter
       than the page is used instead. */
    v['surface'] = luminance(b.backgroundColour) > 0.5
      ? '#ffffff'
      : shift(b.backgroundColour, 0, 6);

    v['ink'] = b.textColour;
    family('text', b.textColour, 'dark');
    v['muted-rgb'] = channels(v['muted']);

    /* Small highlights: the section eyebrows, the New tag, the category
       line on a product card. */
    v['accent'] = b.accentColour;
    v['accent-rgb'] = channels(b.accentColour);
    v['accent-soft'] = one(b.accentColour, 'gold-2', 1.101187, 13.529412);
    v['accent-strong'] = one(b.accentColour, 'gold-deep', 3.091651, -11.372549);
    v['accent-on'] = bestOn(b.accentColour, [b.primaryColour, b.textColour, '#ffffff', '#000000']);

    v['btn'] = b.buttonColour;
    v['btn-rgb'] = channels(b.buttonColour);
    v['btn-hover'] = one(b.buttonColour, 'gold-2', 1.101187, 13.529412);
    v['btn-on'] = bestOn(b.buttonColour, [b.primaryColour, b.textColour, '#ffffff', '#000000']);
    v['btn-radius'] = BUTTON_STYLES[b.buttonStyle] || BUTTON_STYLES.sharp;

    /* What to write on the primary colour, so a pale primary does not end
       up with white text on it. */
    v['navy-on'] = bestOn(b.primaryColour, ['#ffffff', b.textColour, b.backgroundColour, '#000000']);

    var head = font(b.headingFont), body = font(b.bodyFont);
    if (head) v['font-head'] = head.stack;
    if (body) v['font-body'] = body.stack;

    var scale = RADIUS_SCALES[b.borderRadius];
    if (scale === undefined) scale = 1;
    for (var step in RADIUS_BASE) {
      v['radius-' + step] = Math.round(RADIUS_BASE[step] * scale) + 'px';
    }

    return v;
  }

  function cssFor(branding, scope) {
    var v = variables(branding), lines = [], k;
    for (k in v) lines.push('  --' + k + ':' + v[k] + ';');
    return (scope || ':root') + '{\n' + lines.join('\n') + '\n}';
  }

  /* The Google Fonts request for a branding row, or '' when the chosen
     fonts are the ones the page already links to. */
  function fontHref(branding) {
    var b = merged(branding);
    if (b.headingFont === DEFAULTS.headingFont && b.bodyFont === DEFAULTS.bodyFont) return '';
    var want = [], head = font(b.headingFont), body = font(b.bodyFont);
    if (head) want.push(head.google);
    if (body && (!head || body.google !== head.google)) want.push(body.google);
    if (!want.length) return '';
    return 'https://fonts.googleapis.com/css2?family=' + want.join('&family=') + '&display=swap';
  }

  /* ---- applying to a live document -------------------------------------- */

  function styleTag(doc, id) {
    var s = doc.getElementById(id);
    if (!s) {
      s = doc.createElement('style');
      s.id = id;
      doc.head.appendChild(s);
    }
    return s;
  }

  function setImage(doc, selector, url) {
    if (!url) return;
    var nodes = doc.querySelectorAll(selector);
    for (var i = 0; i < nodes.length; i++) nodes[i].setAttribute('src', url);
  }

  function setLink(doc, rel, url, type) {
    if (!url) return;
    var link = doc.querySelector('link[rel="' + rel + '"]');
    if (!link) {
      link = doc.createElement('link');
      link.setAttribute('rel', rel);
      doc.head.appendChild(link);
    }
    link.setAttribute('href', url);
    if (type) link.setAttribute('type', type);
  }

  function setMeta(doc, prop, value) {
    if (!value) return;
    var m = doc.querySelector('meta[property="' + prop + '"]');
    if (!m) {
      m = doc.createElement('meta');
      m.setAttribute('property', prop);
      doc.head.appendChild(m);
    }
    m.setAttribute('content', value);
  }

  var CUSTOM_CSS_LIMIT = 20000;

  function apply(branding, opts) {
    opts = opts || {};
    var doc = opts.document || document;
    var b = merged(branding);

    styleTag(doc, 'vbp-theme').textContent = cssFor(b);

    var href = fontHref(b);
    if (href) {
      var link = doc.getElementById('vbp-fonts');
      if (!link) {
        link = doc.createElement('link');
        link.id = 'vbp-fonts';
        link.rel = 'stylesheet';
        doc.head.appendChild(link);
      }
      if (link.getAttribute('href') !== href) link.setAttribute('href', href);
    }

    var root = doc.documentElement;
    CARD_STYLES.forEach(function (s) { root.classList.remove('cards-' + s); });
    var card = CARD_STYLES.indexOf(b.cardStyle) >= 0 ? b.cardStyle : 'minimal';
    root.classList.add('cards-' + card);

    if (opts.images !== false) {
      setImage(doc, '.brand-logo', b.logoMain);
      setImage(doc, '.mm-logo', b.logoMobile || b.logoMain);
      setImage(doc, '.foot-logo', b.logoFooter || b.logoMain);
      setLink(doc, 'icon', b.favicon);
      setMeta(doc, 'og:image', b.socialImage);
    }

    /* Custom CSS is written by the shop owner and applies to the
       storefront only, never to the admin, so a rule that hides
       everything can always be undone from the admin. It goes in last so
       it can override anything above it. */
    if (opts.customCss !== false) {
      var css = String(b.customCss || '');
      if (css.length > CUSTOM_CSS_LIMIT) css = css.slice(0, CUSTOM_CSS_LIMIT);
      styleTag(doc, 'vbp-custom').textContent = css;
    }

    return b;
  }

  window.VBP_THEME = {
    DEFAULTS: DEFAULTS,
    FONTS: FONTS,
    BUTTON_STYLES: BUTTON_STYLES,
    RADIUS_SCALES: RADIUS_SCALES,
    CARD_STYLES: CARD_STYLES,
    CUSTOM_CSS_LIMIT: CUSTOM_CSS_LIMIT,
    font: font,
    merged: merged,
    variables: variables,
    cssFor: cssFor,
    fontHref: fontHref,
    apply: apply,
    // colour helpers, also used by the admin to warn about contrast
    shift: shift,
    channels: channels,
    luminance: luminance,
    contrastRatio: contrastRatio,
    textOn: textOn,
    bestOn: bestOn,
    parseHex: parseHex
  };
})();
