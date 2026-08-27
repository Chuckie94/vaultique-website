/* =====================================================================
   Vaultique Boutique Point - contact details
   ---------------------------------------------------------------------
   Phone numbers, WhatsApp links, social profiles and the messages that
   get pre-filled when a customer taps through. Loaded by the storefront,
   which uses it, and by the admin, which previews it, so the message
   shown while editing is the message a customer will send.

   No dependencies and no database access.
   ===================================================================== */
(function () {
  'use strict';

  /* ---- numbers -------------------------------------------------------- */

  /* wa.me wants digits only, no plus and no spaces. A number typed as
     "+260 97 832 3036" or "0978323036" has to survive either way, so a
     local number is given the dialling code it is missing. */
  function waDigits(raw, countryCode) {
    var s = String(raw || '').replace(/[^\d+]/g, '');
    if (!s) return '';
    if (s.charAt(0) === '+') return s.slice(1).replace(/\D/g, '');
    s = s.replace(/\D/g, '');
    if (!s) return '';
    /* A leading zero is the national trunk prefix: drop it and prepend
       the country code, which is what makes 0978… reach +260 97 8… */
    if (s.charAt(0) === '0' && countryCode) return String(countryCode).replace(/\D/g, '') + s.slice(1);
    return s;
  }

  /* What a tel: link should carry. Keeps the plus, drops everything else. */
  function telHref(raw) {
    var s = String(raw || '').trim();
    var plus = s.charAt(0) === '+';
    var digits = s.replace(/\D/g, '');
    return digits ? 'tel:' + (plus ? '+' : '') + digits : '';
  }

  function waUrl(number, text, countryCode) {
    var n = waDigits(number, countryCode);
    if (!n) return '';
    return 'https://wa.me/' + n + (text ? '?text=' + encodeURIComponent(text) : '');
  }

  /* ---- messages -------------------------------------------------------- */

  /* Fills {business}, {product}, {sku} and {price} in a message. An unknown
     placeholder is left alone rather than replaced with "undefined", so a
     typo shows itself instead of reaching a customer as a hole. */
  function fill(template, vars) {
    return String(template || '').replace(/\{(\w+)\}/g, function (whole, key) {
      return Object.prototype.hasOwnProperty.call(vars || {}, key) ? String(vars[key]) : whole;
    });
  }

  /* The greeting a contextual link uses. Each link on the site carries the
     reason it was tapped ("I'd like size and style advice."); the name in
     front of it comes from the settings rather than the markup. */
  function greet(business, intent, fallback) {
    var tail = String(intent || '').trim();
    if (!tail) return fill(fallback || '', { business: business });
    return 'Hello ' + (business || 'there') + ', ' + tail;
  }

  /* ---- social ---------------------------------------------------------- */

  /* Each network, how its profile address is built, and its mark. Handles
     are stored bare: "vaultique", not a whole address, so a change of
     domain (twitter.com to x.com) is one line here. */
  var SOCIALS = [
    { id: 'instagram', name: 'Instagram', prefix: 'instagram.com/', base: 'https://instagram.com/',
      placeholder: 'vaultiqueboutique',
      icon: "<path d='M12 2.2c3.2 0 3.6 0 4.85.07 1.17.05 1.8.25 2.23.42.56.22.96.48 1.38.9.42.42.68.82.9 1.38.17.42.37 1.06.42 2.23.06 1.25.07 1.65.07 4.85s-.01 3.6-.07 4.85c-.05 1.17-.25 1.8-.42 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.17-1.06.37-2.23.42-1.25.06-1.65.07-4.85.07s-3.6-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.42a3.7 3.7 0 01-1.38-.9 3.7 3.7 0 01-.9-1.38c-.17-.42-.37-1.06-.42-2.23C2.21 15.6 2.2 15.2 2.2 12s.01-3.6.07-4.85c.05-1.17.25-1.8.42-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.17 1.06-.37 2.23-.42C8.4 2.21 8.8 2.2 12 2.2zm0 1.8c-3.15 0-3.5.01-4.74.07-.89.04-1.37.19-1.69.31-.42.17-.73.37-1.04.68-.31.31-.51.62-.68 1.04-.12.32-.27.8-.31 1.69C3.21 8.5 3.2 8.85 3.2 12s.01 3.5.07 4.74c.04.89.19 1.37.31 1.69.17.42.37.73.68 1.04.31.31.62.51 1.04.68.32.12.8.27 1.69.31 1.24.06 1.59.07 4.74.07s3.5-.01 4.74-.07c.89-.04 1.37-.19 1.69-.31.42-.17.73-.37 1.04-.68.31-.31.51-.62.68-1.04.12-.32.27-.8.31-1.69.06-1.24.07-1.59.07-4.74s-.01-3.5-.07-4.74c-.04-.89-.19-1.37-.31-1.69a2.8 2.8 0 00-.68-1.04 2.8 2.8 0 00-1.04-.68c-.32-.12-.8-.27-1.69-.31C15.5 4.01 15.15 4 12 4zm0 3.06A4.94 4.94 0 1016.94 12 4.94 4.94 0 0012 7.06zm0 8.14A3.2 3.2 0 1115.2 12 3.2 3.2 0 0112 15.2zm5.14-8.34a1.15 1.15 0 11-1.15-1.15 1.15 1.15 0 011.15 1.15z'/>" },

    { id: 'facebook', name: 'Facebook', prefix: 'facebook.com/', base: 'https://facebook.com/',
      placeholder: 'vaultiqueboutique',
      icon: "<path d='M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5.02 3.66 9.18 8.44 9.94v-7.03H7.9v-2.91h2.54V9.85c0-2.52 1.5-3.91 3.77-3.91 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.78-1.63 1.57v1.89h2.78l-.44 2.91h-2.34V22c4.78-.76 8.44-4.92 8.44-9.94z'/>" },

    { id: 'tiktok', name: 'TikTok', prefix: 'tiktok.com/@', base: 'https://tiktok.com/@',
      placeholder: 'vaultiqueboutique',
      icon: "<path d='M16.6 5.82A4.28 4.28 0 0115.54 3h-3.09v12.4a2.59 2.59 0 01-2.59 2.5 2.59 2.59 0 01-2.59-2.59 2.59 2.59 0 012.59-2.59c.27 0 .53.04.78.12v-3.13a5.7 5.7 0 00-.78-.05A5.72 5.72 0 004.14 15.4a5.72 5.72 0 005.72 5.72 5.72 5.72 0 005.72-5.72V9.01a7.35 7.35 0 004.28 1.37V7.29a4.29 4.29 0 01-3.26-1.47z'/>" },

    { id: 'linkedin', name: 'LinkedIn', prefix: 'linkedin.com/company/', base: 'https://linkedin.com/company/',
      placeholder: 'vaultique-boutique',
      icon: "<path d='M20.45 20.45h-3.56v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05a3.74 3.74 0 013.37-1.85c3.6 0 4.27 2.37 4.27 5.46zM5.34 7.43a2.07 2.07 0 110-4.13 2.07 2.07 0 010 4.13zM7.12 20.45H3.55V9h3.57z'/>" },

    { id: 'x', name: 'X', prefix: 'x.com/', base: 'https://x.com/',
      placeholder: 'vaultique',
      icon: "<path d='M17.53 3h3.02l-6.6 7.54L21.75 21h-5.98l-4.68-6.12L5.72 21H2.7l7.06-8.07L2.5 3h6.13l4.23 5.6zm-1.06 16.2h1.67L7.6 4.72H5.81z'/>" },

    { id: 'youtube', name: 'YouTube', prefix: 'youtube.com/@', base: 'https://youtube.com/@',
      placeholder: 'vaultiqueboutique',
      icon: "<path d='M21.58 7.19a2.5 2.5 0 00-1.76-1.77C18.25 5 12 5 12 5s-6.25 0-7.82.42a2.5 2.5 0 00-1.76 1.77A26.1 26.1 0 002 12a26.1 26.1 0 00.42 4.81 2.5 2.5 0 001.76 1.77C5.75 19 12 19 12 19s6.25 0 7.82-.42a2.5 2.5 0 001.76-1.77A26.1 26.1 0 0022 12a26.1 26.1 0 00-.42-4.81zM10 15.02V8.98L15.2 12z'/>" }
  ];

  function social(id) {
    for (var i = 0; i < SOCIALS.length; i++) if (SOCIALS[i].id === id) return SOCIALS[i];
    return null;
  }

  /* A stored handle turned into an address. Someone will paste a whole
     URL, or an @name, or the right thing; all three have to work. */
  function socialUrl(id, handle) {
    var net = social(id);
    var h = String(handle || '').trim();
    if (!net || !h) return '';
    if (/^https?:\/\//i.test(h)) return h;
    h = h.replace(/^@+/, '').replace(/^\/+/, '').replace(/\/+$/, '');
    /* Pasting "instagram.com/name" or "www.x.com/name" should not end up
       doubled onto the front of the address. */
    h = h.replace(/^(www\.)?[a-z]+\.com\/(@)?/i, '');
    if (net.id === 'linkedin') h = h.replace(/^(company|in)\//i, '');
    return h ? net.base + h : '';
  }

  /* ---- maps ------------------------------------------------------------ */

  /* Whatever the shop pasted, turned into something that opens a map. A
     Google share link is used as-is; anything else is treated as a place
     to search for, which is what an address pasted straight in amounts to. */
  function mapsUrl(value, fallbackQuery) {
    var v = String(value || '').trim();
    if (/^https?:\/\//i.test(v)) return v;
    var q = v || String(fallbackQuery || '').trim();
    if (!q) return '';
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
  }

  window.VBP_CONTACT = {
    SOCIALS: SOCIALS,
    social: social,
    socialUrl: socialUrl,
    waDigits: waDigits,
    telHref: telHref,
    waUrl: waUrl,
    fill: fill,
    greet: greet,
    mapsUrl: mapsUrl
  };
})();
