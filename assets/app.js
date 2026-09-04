/* =====================================================================
   Vaultique Boutique Point — storefront app
   Vanilla JS, no dependencies. Reads the product-only feed at /api/products
   (served by the Netlify function) and renders the luxury storefront.
   WhatsApp is the checkout. The POS is never contacted by the browser.
   ===================================================================== */
(function () {
  'use strict';

  // ------------------------------------------------------------------ config
  var WA_SHOP = '260978323036';              // +260 97 832 3036  (default: orders & shopping)
  var WA_ENQUIRY = '260963539728';           // +260 96 353 9728  (general enquiries)
  var IG_HANDLE = '';                        // set your Instagram handle (no @) when ready
  var EMAIL = 'vaultiqueboutique@outlook.com';
  var IMG_EXTS = ['jpg', 'jpeg', 'png', 'webp'];
  var YEAR = new Date().getFullYear();

  // website's own Supabase (presentation data only; separate from POS).
  // Configured in config.js. If absent, the site runs on the POS feed alone.
  var WEB = (window.VBP_CONFIG && window.VBP_CONFIG.SUPABASE_URL && window.VBP_CONFIG.SUPABASE_ANON_KEY)
    ? window.VBP_CONFIG : null;
  var META = {};      // sku -> { image_url, gallery[], featured, is_new, hidden, description }
  var CONTENT = {};   // editable site content document
  var REVIEWS = [];   // approved reviews (site-wide when sku is null)
  // Settings > General in the admin. Defaults match the admin's own, so the
  // site reads the same whether or not the row has ever been saved.
  var SETTINGS = {
    businessName: 'Vaultique Boutique Point',
    tagline: 'Curated Elegance, Accessible Luxury',
    description: '',
    country: 'Zambia',
    city: 'Lusaka',
    address: '',
    timezone: 'Africa/Lusaka',
    currency: 'ZMW',
    dateFormat: 'DD/MM/YYYY',
    numberFormat: '1,234.56',
    businessHours: null,
    websiteStatus: 'live',
    maintenanceMode: false,
    maintenanceMessage: '',
    previewKey: ''
  };
  var FMT = window.VBP_FORMAT || null;
  var THEME = window.VBP_THEME || null;
  var CT = window.VBP_CONTACT || null;
  var CONTACT = null;               // Settings > Contact & Social
  // Settings > Payments. Only the public half ever reaches here: which
  // methods are accepted, what they are called and what customers are
  // told. Account numbers live in a table this key cannot read.
  var PAY = null;
  // Settings > Homepage. The announcement, the hero, the story and the
  // values: the parts of the page that are words rather than products.
  var HOME = null;
  var SEC = window.VBP_SECTIONS || null;
  var HOME_TESTIMONIALS = [];       // quotes the shop wrote, not reviews customers left
  // Settings > Shopping. Defaults match the admin's, so the shop behaves the
  // same whether or not that section has ever been opened.
  var SHOP = {
    showOutOfStock: true, showSku: true, showLowStock: true, showCategory: true,
    showBadges: true, showReviews: true, defaultSort: 'featured',
    enquiries: true, wishlist: true, sharing: true, customerReviews: true,
    whatsappCheckout: true,
    requireName: true, requirePhone: true, requireEmail: false, requireAddress: false,
    orderNotes: true, checkoutLabel: 'Buy on WhatsApp'
  };
  // Settings > Pricing & Tax. Defaults match the admin's, and match the way
  // the shop was written before the section existed: a K in front, decimals
  // only when the amount has them, and the VAT line that used to be typed
  // into the product page by hand.
  var PRICING = {
    currencySymbol: '', currencyPosition: 'before', decimalPlaces: 'auto',
    taxMode: 'included', taxRate: 16, taxLabel: 'VAT',
    trackReductions: true, minReductionPercent: 5, reductionDays: 30,
    showSalePrice: true, showOriginalPrice: true, showDiscountPercent: true,
    percentWhere: 'both',
    onRequestEnabled: true, onRequestText: 'Price on request',
    onRequestButton: 'Ask about this piece',
    // promoName is the shop's own label for a promotion and is never shown
    // to a customer. It is mirrored here anyway so this list and the admin's
    // stay identical: a settings row the storefront only half-knows is how
    // a shop starts behaving differently the moment somebody presses Save.
    promoEnabled: false, promoName: '', promoType: 'percent', promoAmount: '',
    promoScope: 'all', promoCategories: '', promoFrom: '', promoTo: '',
    overridesEnabled: false
  };
  var MONEY = null;                 // the shop's money style, built once per load
  var ACCT = window.VBP_ACCOUNT || null;
  var SEO = window.VBP_SEO || null;
  var CARE = window.VBP_CARE || null;
  // Settings > Customer Care. An empty card list means the four the site
  // came with, so a shop that has never opened the section keeps them.
  /* Settings > Newsletter. Every one of these was written into
     index.html until now. The values here are exactly what the page has
     always said, so a shop that never opens the section sees no change. */
  /* Settings > Reviews. showReviews and customerReviews used to live in
     Shopping; they are read from there as a fallback so a shop that
     switched either off, and has not opened the new section yet, keeps
     its answer. See reviewsShown() and reviewsOpen(). */
  var REVIEWSET = {
    showReviews: true,
    showRatings: true,
    customerReviews: true,
    anonymous: false,
    anonymousLabel: 'A customer',
    autoPublish: false,
    minAutoRating: 4
  };

  var REVIEW_ROW = false;   // whether Settings > Reviews has ever been saved

  var NEWSLETTER = {
    enabled: true,
    eyebrow: 'Stay in the know',
    heading: 'Join the list',
    blurb: 'New arrivals, private offers and styling notes, straight to your inbox.',
    placeholder: 'Your email address',
    buttonLabel: 'Subscribe',
    welcome: 'Thank you. You are on the list.',
    privacyNote: 'We respect your privacy and will never share your details.',
    /* Carried so the admin and the shop declare the same set. The sign-up
       form reads them from here through account.js, not from the band. */
    offerAtSignup: false,
    signupLabel: 'Email me new arrivals and private offers',
    /* Carried so the admin and the shop declare the same set. These four
       are the wording of an email the shop sends from the admin; nothing
       on the customer's side of the site reads them. */
    welcomeSubject: '', welcomeEmail: '', unsubscribeMessage: '', footer: ''
  };

  var CARESET = {
    careEnabled: true,
    careEyebrow: 'Here to help',
    careHeading: 'Size, delivery & returns',
    careSub: 'Everything you need to shop with confidence. Still unsure? Message us any time.',
    cards: [],
    faqEnabled: false, faqEyebrow: 'Questions', faqHeading: 'Frequently asked',
    faqSub: '', faqs: [], faqAskEnabled: true,
    faqAskText: 'Still not sure? Ask us on WhatsApp'
  };
  // Settings > SEO. Empty by default: with nothing saved, every page falls
  // back to General's name and description, which is what it did before.
  var SEOSET = {
    title: '', description: '', keywords: '',
    /* Empty, so that a shop which has never opened Settings > SEO
       describes itself by the address it is actually being read at.
       A domain written in here would be claimed as the real home of
       every page on any site running this code, which is how a site
       gets dropped in favour of the one it names. seo.js falls back to
       location.origin when this is blank. */
    canonicalBase: '',
    ogTitle: '', ogDescription: '',
    googleVerification: '', bingVerification: '',
    sitemapEnabled: true, indexing: 'index', robotsExtra: '',
    pages: {}
  };
  // Settings > Customer Accounts. Off by default: a shop that has never
  // opened the section has no sign in anywhere, which is how it ran before.
  var ACCOUNTS = {
    accountsEnabled: false, registration: 'open', guestCheckout: true,
    emailVerification: true, phoneVerification: false,
    passwordMinLength: 8, passwordNeedsNumber: true, passwordNeedsSymbol: false,
    passwordReset: true,
    accountDeletion: true,
    deletionNote: 'Your account and saved addresses are removed. Orders already placed ' +
                  'are kept, since we need them for our own records.',
    orderHistory: true, historyScope: 'all', historyMonths: 12,
    savedAddresses: true, maxAddresses: 5,
    wishlistFollowsAccount: true
  };
  // Settings > Delivery & Collection. Defaults match the admin's, and the
  // wording matches the paragraph that used to be printed into the product
  // page, so a shop that has never opened the section reads as it did.
  var DELIVERY = {
    deliveryEnabled: true, areas: [], showFees: false,
    standardFee: '', standardDays: 'Confirmed on WhatsApp', freeOver: '',
    feesNote: 'Fees are calculated by distance and confirmed on WhatsApp before dispatch.',
    speeds: 'standard', sameDayFee: '', sameDayCutoff: '14:00',
    sameDayNote: 'Same-day delivery in Lusaka for orders confirmed before the cut-off.',
    pickupEnabled: true, pickupUseShopAddress: true, pickupLocation: '',
    pickupInstructions: 'Your order is held at the boutique for collection during trading hours. We will confirm on WhatsApp as soon as it is ready.',
    pickupNumberOverride: false, pickupNumber: '',
    terms: 'We deliver nationwide across Zambia where possible. Collection in person ' +
           'can also be arranged.',
    instructions: 'Tell us your area when you message and we will confirm the fee and ' +
                  'the timing before anything is dispatched.',
    numberOverride: false, number: ''
  };
  var BRANDING = null;              // Settings > Branding & Appearance
  var THEME_MEMO = 'vbp_theme';     // last applied theme, so a return visit is not repainted
  var POLICIES = (window.VBP_DEFAULT_POLICIES || []).slice();  // editable in admin

  // ------------------------------------------------------------------ helpers
  function $(s, r) { return (r || document).querySelector(s); }
  function $all(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function el(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function slug(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
  function moneyStyle() {
    if (MONEY) return MONEY;
    if (FMT) MONEY = FMT.moneyStyle(SETTINGS, PRICING);
    return MONEY;
  }
  function formatPrice(n) {
    if (FMT) return FMT.money(n, moneyStyle());
    var num = Number(n) || 0;
    var hasDec = (Math.round(num * 100) / 100) % 1 !== 0;
    return 'K' + num.toLocaleString('en-US', {
      minimumFractionDigits: hasDec ? 2 : 0, maximumFractionDigits: 2
    });
  }
  /* Everything a price has to say about one piece, worked out once. The
     card, the quick view, the detail page, the search row and the message
     that goes to WhatsApp all read this, so none of them can disagree. */
  function priceOf(p) {
    if (FMT && FMT.priceView) return FMT.priceView(p, PRICING, moneyStyle());
    return { onRequest: false, now: Number(p.price) || 0, nowText: formatPrice(p.price),
             wasText: '', offText: '', percent: 0, saved: 0, tax: '', isSale: false };
  }
  /* The price as a line of text, with the original and the saving where
     there is one. Used wherever a price is a string rather than markup. */
  function priceLine(p) {
    var v = priceOf(p);
    if (v.onRequest) return v.nowText;
    return v.wasText ? v.nowText + ' (was ' + v.wasText + ')' : v.nowText;
  }
  /* The price as markup, for the places that can afford the strike
     through and the percentage. */
  function priceHtml(p, cls) {
    var v = priceOf(p);
    var out = '<span class="px-now">' + esc(v.nowText) + '</span>';
    if (v.wasText) out += ' <span class="px-was">' + esc(v.wasText) + '</span>';
    if (v.offText && PRICING.percentWhere !== 'badge') {
      out += ' <span class="px-off">' + esc(v.offText) + '</span>';
    }
    return '<div class="' + (cls || 'p') + (v.onRequest ? ' on-request' : '') + '">' + out + '</div>';
  }
  /* The tax line, or nothing at all when the shop would rather not say. */
  function taxHtml() {
    var t = FMT && FMT.taxLine ? FMT.taxLine(PRICING) : '';
    return t ? '<div class="detail-vat">' + esc(t) + '</div>' : '';
  }
  /* A piece with no price shown cannot be bought, only asked about: nobody
     can agree to a figure they have not seen. */
  function sortPrice(p, whenHidden) {
    if (onRequest(p)) return whenHidden;
    return priceOf(p).now;
  }
  function onRequest(p) {
    return !!(p && p.priceOnRequest) && PRICING.onRequestEnabled !== false;
  }
  function formatDate(v) {
    if (FMT) return FMT.date(v, SETTINGS.dateFormat);
    var d = new Date(v);
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString();
  }
  function waUrl(num, text) {
    if (CT) return CT.waUrl(num, text);
    return num ? 'https://wa.me/' + num + '?text=' + encodeURIComponent(text) : '';
  }
  function shopName() {
    return (SETTINGS && SETTINGS.businessName) || 'Vaultique Boutique';
  }
  /* Which number answers which kind of message. Orders and enquiries can
     go to different phones; either falls back to the main number, and
     that falls back to the number the site shipped with. */
  function orderNumber() {
    return (CONTACT && (CONTACT.orderNumber || CONTACT.whatsapp)) || WA_SHOP;
  }
  function enquiryNumber() {
    return (CONTACT && (CONTACT.enquiryNumber || CONTACT.orderNumber || CONTACT.whatsapp)) || WA_ENQUIRY;
  }
  function orderMessage(p) {
    var tpl = (CONTACT && CONTACT.orderMessage) ||
      "Hello {business}, I'd like to buy: {product} (SKU: {sku}), {price}. Is it available?";
    if (!CT) return tpl;
    return CT.fill(tpl, {
      business: shopName(), product: p.name, sku: p.sku, price: priceLine(p)
    });
  }
  function enquiryMessage() {
    var tpl = (CONTACT && CONTACT.enquiryMessage) || 'Hello {business}, I have an enquiry.';
    return CT ? CT.fill(tpl, { business: shopName() }) : tpl;
  }
  /* Each link on the page carries the reason it was tapped; the greeting
     in front of it is built from the business name. */
  function waSay(intent) {
    return CT ? CT.greet(shopName(), intent, enquiryMessage()) : (intent || '');
  }
  function waLink(p) {
    /* A piece held back for a conversation asks what it costs; it does not
       offer to buy at a figure nobody has been shown. Sold out pieces keep
       the ordinary message, which already ends by asking if it is
       available. */
    if (onRequest(p)) {
      return waUrl(enquiryNumber(), askPriceMessage(p));
    }
    return waUrl(orderNumber(), orderMessage(p));
  }
  function askPriceMessage(p) {
    var text = "Hello " + shopName() + ", could you tell me the price of " +
               p.name + " (SKU: " + p.sku + ")?";
    return text;
  }
  function checkoutLabel() {
    return (SHOP && SHOP.checkoutLabel) || 'Buy on WhatsApp';
  }
  /* Whether a piece can be bought at all. With WhatsApp checkout off the
     shop is a catalogue: the pieces and prices stay, the buy buttons go.
     Enquiries are a separate switch and are unaffected. */
  function canBuy(p) {
    if (onRequest(p)) return false;
    return !!p.available && SHOP.whatsappCheckout !== false;
  }
  /* Whether THIS person may reach the WhatsApp step. Guest checkout and
     email confirmation both live in Settings > Customer Accounts, so the
     question is asked there rather than answered here twice. */
  function mayCheckout() { return !ACCT || ACCT.mayCheckout(); }
  function canAsk(p) {
    if (SHOP.enquiries === false) return false;
    /* A piece whose price is not shown can only be asked about, whether or
       not it is in stock: the price is the thing the conversation settles. */
    if (onRequest(p)) return true;
    return !p.available;
  }
  /* What the button says when it is not a buy button. A piece held back
     for a conversation gets the shop's own wording; a sold out piece keeps
     the plain word. */
  function askLabel(p, long) {
    if (onRequest(p) && PRICING.onRequestButton) return PRICING.onRequestButton;
    return long ? 'Enquire on WhatsApp' : 'Enquire';
  }
  function waGeneral(text) {
    return waUrl(orderNumber(), waSay(text));
  }
  function waEnquiry(text) {
    return waUrl(enquiryNumber(), waSay(text));
  }

  // safe storage (degrades to memory if blocked, e.g. in preview frames)
  var mem = {};
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return mem[k] || null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { mem[k] = v; } }
  };

  // ------------------------------------------------------------------ images
  // The stand-in shown for a product with no photo. It is drawn here rather
  // than in CSS, so it has to be told the brand colours; left hardcoded it
  // was the one navy-and-gold patch left on a re-branded shop.
  function placeholderSrc() {
    var ink = '#0B1F3A', mark = '#C8A24A', name = 'VAULTIQUE BOUTIQUE';
    if (THEME) {
      var v = THEME.variables(BRANDING);
      ink = v['navy'] || ink;
      mark = v['gold'] || mark;
    }
    var label = (SETTINGS && SETTINGS.businessName) ? SETTINGS.businessName.toUpperCase() : name;
    // The lettering is widely spaced, so a long name would run off the edge.
    if (label.length > 24) label = label.slice(0, 23).replace(/\s+$/, '') + '\u2026';
    var initials = label.split(/\s+/).slice(0, 2).map(function (w) { return w.charAt(0); }).join('');
    function enc(hex) { return hex.replace('#', '%23'); }
    var svg =
      "<svg xmlns='http://www.w3.org/2000/svg' width='480' height='600'>" +
      "<rect width='100%' height='100%' fill='" + enc(ink) + "'/>" +
      "<rect x='20' y='20' width='440' height='560' fill='none' stroke='" + enc(mark) + "' stroke-opacity='.4'/>" +
      "<text x='50%' y='45%' fill='" + enc(mark) + "' font-family='Georgia,serif' font-size='78' " +
      "text-anchor='middle' letter-spacing='8'>" + esc(initials) + "</text>" +
      "<text x='50%' y='55%' fill='" + enc(mark) + "' font-family='Arial' font-size='13' " +
      "letter-spacing='6' text-anchor='middle'>" + esc(label) + "</text></svg>";
    return 'data:image/svg+xml;charset=utf-8,' + svg;
  }
  // Optional local image files (images/<SKU>.jpg and friends) are only looked up
  // when the admin is NOT connected. Once photos are managed in the admin, probing
  // for files that do not exist would fire a 404 for every product, so we skip it.
  // Set LOCAL_IMAGES: true in config.js to force the local file fallback back on.
  var USE_LOCAL = (window.VBP_CONFIG && typeof window.VBP_CONFIG.LOCAL_IMAGES === 'boolean')
    ? window.VBP_CONFIG.LOCAL_IMAGES
    : !WEB;

  // <img> with: admin photo (if any) -> SKU files (if enabled) -> placeholder
  function attachImgChain(imgEl, p) {
    var sku = (p && p.sku) ? p.sku : p;
    var url = (p && typeof p === 'object') ? p.image_url : null;
    if (PREVIEW) { imgEl.src = placeholderSrc(); return; }
    if (url) { imgEl.onerror = function () { imgEl.onerror = null; imgEl.src = placeholderSrc(); }; imgEl.src = url; return; }
    if (!USE_LOCAL) { imgEl.src = placeholderSrc(); return; }
    var i = -1;
    function next() {
      i++;
      if (i < IMG_EXTS.length) { imgEl.src = '/images/' + sku + '.' + IMG_EXTS[i]; }
      else { imgEl.onerror = null; imgEl.src = placeholderSrc(); }
    }
    imgEl.onerror = next;
    next();
  }
  function preload(url, cb) {
    if (PREVIEW || !USE_LOCAL) { cb(false); return; }
    var im = new Image();
    im.onload = function () { cb(true); };
    im.onerror = function () { cb(false); };
    im.src = url;
  }
  // resolve a usable primary image: admin photo -> first existing SKU file -> placeholder
  function resolvePrimary(p, cb) {
    var sku = (p && p.sku) ? p.sku : p;
    if (p && typeof p === 'object' && p.image_url) { cb(p.image_url); return; }
    if (PREVIEW || !USE_LOCAL) { cb(placeholderSrc()); return; }
    var i = 0;
    (function tryNext() {
      if (i >= IMG_EXTS.length) { cb(placeholderSrc()); return; }
      var url = '/images/' + sku + '.' + IMG_EXTS[i++];
      var im = new Image();
      im.onload = function () { cb(url); };
      im.onerror = tryNext;
      im.src = url;
    })();
  }
  function bgStyle(url) { return "background-image:url('" + url + "')"; }

  // ------------------------------------------------------------------ state
  var PRODUCTS = [];
  /* Whether the feed has answered yet. The cart can be opened before it
     has, and a cart that called every piece in it missing because the
     products had not arrived would be lying. */
  var FEED_LOADED = false;
  var PREVIEW = false;
  var CATEGORIES = [];   // categories that currently have products
  var ALLCATS = [];      // all categories to show (master list + product categories)
  // The full set of categories the boutique plans to carry. Any of these with no
  // products yet shows automatically as "Coming soon". Editable via site content
  // (set a "categories" array) or just edit this list.
  var MASTER_CATEGORIES = [
    "WOMEN'S APPAREL", "MEN'S FORMAL WEAR", "FOOTWEAR", "HANDBAGS & LEATHER GOODS",
    "FASHION ACCESSORIES", "JEWELLERY", "BEAUTY & PERSONAL CARE",
    "BRIDAL & WEDDING COLLECTION", "PREMIUM LUXURY COLLECTION",
    "LOCAL & CULTURAL PRODUCTS", "GIFT & LIFESTYLE COLLECTION"
  ];
  var filterCat = 'All';
  var filterColor = 'All';
  var filterSize = 'All';
  var inStockOnly = false;
  var searchTerm = '';
  var sortBy = 'featured';
  var mode = 'shop'; // or 'wishlist'

  var wishlist = parseList(store.get('vbp_wishlist'));
  var recent = parseList(store.get('vbp_recent'));
  /* The cart lives in this browser and nowhere else. Adding a piece to it
     reserves nothing, holds nothing and deducts no stock: the POS is not
     told, because until an order is sent there is no order. */
  var CART_MEMO = 'vbp_cart';
  var CART_MAX = 99;
  /* Photos already worked out for the cart, kept for as long as the page
     lives. The panel is redrawn whole on every change, and without this
     every thumbnail would blink each time somebody tapped plus. */
  var CART_IMG = {};
  var cart = parseCart(store.get(CART_MEMO));
  function parseList(s) { try { return s ? JSON.parse(s) : []; } catch (e) { return []; } }
  function saveWishlist() {
    store.set('vbp_wishlist', JSON.stringify(wishlist));
    /* The device keeps its own copy either way, so a customer who signs
       out still has what they saved. The account copy is the one that
       travels. */
    if (ACCT && ACCT.wishlistFollows()) ACCT.pushWishlist(wishlist);
  }
  function saveRecent() { store.set('vbp_recent', JSON.stringify(recent)); }

  function bySku(sku) { for (var i = 0; i < PRODUCTS.length; i++) if (PRODUCTS[i].sku === sku) return PRODUCTS[i]; return null; }



  // ------------------------------------------------------------------ theme
  // Branding arrives with everything else, which would mean a moment of the
  // default navy and gold before the shop's own colours land. The stylesheet
  // that was worked out last time is kept and re-applied straight away, so a
  // returning visitor sees the right colours from the first paint. It is
  // replaced as soon as the real settings arrive.
  function preApplyCachedTheme() {
    if (!WEB || !THEME) return;
    var css = store.get(THEME_MEMO);
    if (!css) return;
    var tag = document.getElementById('vbp-theme');
    if (!tag) {
      tag = document.createElement('style');
      tag.id = 'vbp-theme';
      document.head.appendChild(tag);
    }
    tag.textContent = css;
  }

  function applyTheme() {
    if (!THEME) return;
    THEME.apply(BRANDING);
    try { store.set(THEME_MEMO, THEME.cssFor(BRANDING)); } catch (e) {}
  }



  // Settings > Shopping on the page. The per-product pieces are handled
  // where each card and page is drawn; this covers what sits outside them.
  function applyShopSettings() {
    // The shop opens on the chosen order, and the dropdown agrees with it.
    if (SHOP.defaultSort) {
      sortBy = SHOP.defaultSort;
      var sel = $('#sortSelect');
      if (sel) {
        sel.value = SHOP.defaultSort;
        if (sel.selectedIndex < 0) { sel.selectedIndex = 0; sortBy = sel.value; }
      }
    }

    // With the wishlist off, its heart in the header has nothing behind it.
    if (!SHOP.wishlist) {
      var wb = $('#wishBtn');
      if (wb) wb.classList.add('hide');
    }

    /* A shop with WhatsApp checkout switched off is a catalogue: no piece
       carries a buy button, so no piece carries an add-to-cart button, and
       a cart icon over an empty cart nobody can fill is furniture. The
       cart itself is left alone — whatever a customer gathered before the
       switch was thrown is still theirs when it is thrown back. */
    if (SHOP.whatsappCheckout === false) {
      var cbn = $('#cartBtn');
      if (cbn) cbn.classList.add('hide');
    }

    // Reviews: showing them and accepting them are separate switches.
    if (!reviewsShown()) {
      var sec = $('#reviews');
      if (sec) sec.classList.add('hide');
    }
    if (!reviewsOpen()) {
      $all('#siteReviewBtn, [data-review-open]').forEach(function (b) { b.classList.add('hide'); });
    }
  }




  // ---------------------------------------------------------------- homepage
  // Settings > Homepage on the page. Runs after applyContent, so where the
  // two still overlap it is the setting that has the last word.
  function applyHomepageSettings() {
    var h = HOME;
    if (!h) return;                       // never saved: leave Site Content's work

    // Announcement bar
    var bar = $('#announceBar');
    if (bar) {
      if (h.announceEnabled === false) bar.classList.add('hide');
      else {
        bar.classList.remove('hide');
        if (h.announceText) bar.innerHTML = h.announceText;
      }
    }

    // Hero
    var hero = $('#hero');
    if (h.heroEnabled === false) {
      if (hero) hero.classList.add('hide');
    } else {
      if (hero) hero.classList.remove('hide');
      setText('#heroEyebrow', h.heroEyebrow);
      setText('#heroTitle', h.heroTitle);
      setText('#heroTitleEm', h.heroTitleEm);
      setText('#heroSub', h.heroSubtitle);
      ['#heroPhoto1', '#heroPhoto2', '#heroPhoto3'].forEach(function (sel, i) {
        var url = h['heroImage' + (i + 1)];
        var e = $(sel);
        if (e && url) e.style.backgroundImage = "url('" + url + "')";
      });
      applyHeroCta(h);
    }

    // Our story. Once this section has been saved, a paragraph left empty
    // is meant to be gone rather than left as the words the site shipped.
    setText('#storyHeading', h.storyHeading);
    [['#storyP1', h.storyP1], ['#storyP2', h.storyP2]].forEach(function (pair) {
      var e = $(pair[0]);
      if (!e) return;
      if (pair[1]) { e.textContent = pair[1]; e.classList.remove('hide'); }
      else e.classList.add('hide');
    });

    applyValues(h.values);
    applyTestimonials(h.testimonials);
    applyLookbook(h.lookImages);
    applyPromo();
    applySections();      // last, so it moves sections that are already dressed
  }

  /* The first hero button. Blank sends it to the shop, which is what it has
     always done; anything else is followed as written. */
  function applyHeroCta(h) {
    var btn = $('.hero-cta [data-go-shop]') || $('.hero-cta .btn');
    if (!btn) return;
    if (h.heroCtaText) btn.textContent = h.heroCtaText;

    var link = (h.heroCtaLink || '').trim();
    if (!link) return;                    // leave the built-in shop behaviour
    var a = document.createElement('a');
    a.className = btn.className;
    a.textContent = btn.textContent;
    a.href = link;
    if (/^https?:/i.test(link)) { a.target = '_blank'; a.rel = 'noopener'; }
    btn.parentNode.replaceChild(a, btn);
  }

  /* Quotes the shop has written down, shown alongside the reviews
     customers leave. An empty list means only real reviews appear. */
  function applyTestimonials(list) {
    if (!Array.isArray(list)) return;
    HOME_TESTIMONIALS = list.filter(function (t) { return t && t.quote; });
    if (reviewsShown()) renderSiteReviews();
  }

  /* The placeholder class has to come off before the photo goes on. It
     paints its gradient with the `background` shorthand, which quietly
     resets size, position and repeat as well, so a photo left underneath
     it renders at its natural size in the tile's top left corner and
     tiles across — which looks like a flat patch of colour rather than a
     photograph. The category cards have always taken it off; the lookbook
     never did. */
  function dressTile(e, url) {
    if (!e || !url) return;
    e.classList.remove('fallback');
    e.style.backgroundImage = "url('" + url + "')";
  }
  /* One row of hours: the chip saying where the clock stands right now,
     then the week itself. The chip is left off when the browser cannot
     work with the shop's time zone, because a guess about whether the
     shop is open is worse than saying nothing. */
  function writeHours(sel, line, state) {
    var host = $(sel);
    if (!host) return;
    host.textContent = '';
    if (state && state.known) {
      var chip = el('span', 'open-chip' + (state.open ? ' is-open' : ''));
      chip.textContent = state.text;
      host.appendChild(chip);
      host.appendChild(document.createTextNode(' '));
    }
    host.appendChild(document.createTextNode(line));
  }

  /* ---- delivery and collection, in words ----------------------------
     One place answers what the shop offers, so the product page, the
     checkout step and the homepage band cannot describe it differently.
     Everything here returns '' when there is nothing to say, and a shop
     that offers neither says nothing at all rather than an empty heading. */

  function deliversAnywhere() { return DELIVERY.deliveryEnabled !== false; }
  function collectsInPerson() { return DELIVERY.pickupEnabled !== false; }
  function feesShown() { return deliversAnywhere() && !!DELIVERY.showFees; }
  function sameDayOffered() { return deliversAnywhere() && DELIVERY.speeds === 'both'; }

  function deliveryAreas() {
    return (DELIVERY.areas || []).filter(function (a) { return a && a.name; });
  }

  /* A fee written the shop's way, or the word for having none. An area
     with an empty fee is free where fees are shown, because a shop that
     publishes its charges and leaves one blank is saying it costs
     nothing, not that it forgot. */
  function feeText(fee) {
    if (fee === '' || fee === null || fee === undefined) return 'Free';
    var n = Number(fee);
    if (!isFinite(n) || n <= 0) return 'Free';
    return formatPrice(n);
  }

  /* 'Lusaka · same day · K80' — as much of it as the shop has said. */
  function areaLine(a) {
    var bits = [a.name];
    if (a.days) bits.push(a.days);
    if (feesShown()) bits.push(feeText(a.fee));
    return bits.join(' · ');
  }

  /* Where an order can be collected: the shop's own address unless the
     shop collects somewhere else. */
  function pickupWhere() {
    if (!collectsInPerson()) return '';
    if (DELIVERY.pickupUseShopAddress === false) return String(DELIVERY.pickupLocation || '').trim();
    var bits = [SETTINGS.address, SETTINGS.city, SETTINGS.country]
      .map(function (x) { return String(x || '').trim(); })
      .filter(Boolean);
    return bits.join(', ');
  }

  /* Which number answers a delivery or collection question. Contact &
     Social holds the numbers; this only chooses between them, so a shop
     never ends up with two that disagree. */
  function deliveryNumber() {
    if (DELIVERY.numberOverride && DELIVERY.number) {
      return String(DELIVERY.number).replace(/[^0-9]/g, '');
    }
    return orderNumber();
  }
  function pickupNumber() {
    if (DELIVERY.pickupNumberOverride && DELIVERY.pickupNumber) {
      return String(DELIVERY.pickupNumber).replace(/[^0-9]/g, '');
    }
    return orderNumber();
  }

  /* The delivery half, as lines of text. */
  function deliveryLines() {
    if (!deliversAnywhere()) return [];
    var out = [];
    var areas = deliveryAreas();
    if (areas.length) areas.forEach(function (a) { out.push(areaLine(a)); });
    else if (DELIVERY.standardDays) out.push(DELIVERY.standardDays);

    if (feesShown()) {
      var charge = [];
      if (DELIVERY.standardFee !== '' && Number(DELIVERY.standardFee) > 0) {
        charge.push('Elsewhere ' + formatPrice(DELIVERY.standardFee));
      }
      if (DELIVERY.freeOver !== '' && Number(DELIVERY.freeOver) > 0) {
        charge.push('Free over ' + formatPrice(DELIVERY.freeOver));
      }
      if (charge.length) out.push(charge.join(' · '));
    } else if (DELIVERY.feesNote) {
      out.push(DELIVERY.feesNote);
    }

    if (sameDayOffered()) {
      var sd = DELIVERY.sameDayNote || 'Same-day delivery available.';
      if (DELIVERY.sameDayCutoff) sd += ' Order by ' + DELIVERY.sameDayCutoff + '.';
      if (feesShown() && DELIVERY.sameDayFee !== '' && Number(DELIVERY.sameDayFee) > 0) {
        sd += ' ' + formatPrice(DELIVERY.sameDayFee) + '.';
      }
      out.push(sd);
    }
    return out;
  }

  /* The collection half. */
  function pickupLines() {
    if (!collectsInPerson()) return [];
    var out = [];
    var where = pickupWhere();
    out.push(where ? 'Collect in person from ' + where + '.' : 'Collection in person can be arranged.');
    if (DELIVERY.pickupInstructions) out.push(DELIVERY.pickupInstructions);
    return out;
  }

  /* What the product page's Delivery & collection panel says. This used
     to be a paragraph typed into the source, stating the areas, the
     charging and the collection offer, changeable only by editing code. */
  function deliveryPanelHtml() {
    var parts = [];
    var d = deliveryLines();
    if (d.length) {
      parts.push('<div class="dl-block"><span class="dl-h">Delivery</span>' +
                 d.map(function (t) { return '<div>' + esc(t) + '</div>'; }).join('') + '</div>');
    }
    var c = pickupLines();
    if (c.length) {
      parts.push('<div class="dl-block"><span class="dl-h">Collection</span>' +
                 c.map(function (t) { return '<div>' + esc(t) + '</div>'; }).join('') + '</div>');
    }
    /* Terms are terms of something. On a shop that neither delivers nor
       collects there is nothing for them to be about, and a panel built
       from leftover wording alone would stand there saying so. */
    if (!parts.length) return '';
    if (DELIVERY.terms) parts.push('<div class="dl-terms">' + esc(DELIVERY.terms) + '</div>');
    /* The seven delivery policies already on the site are one tap away
       rather than repeated here. */
    if (hasDeliveryPolicy()) {
      parts.push('<a class="dl-more" href="' + pathFor('policies') + '">Read the full delivery policy</a>');
    }
    return parts.join('');
  }
  function hasDeliveryPolicy() {
    return (POLICIES || []).some(function (p) {
      return p && String(p.section || '').toLowerCase().indexOf('deliver') > -1;
    });
  }

  /* ---- customer accounts ---------------------------------------------
     Everything about accounts lives in assets/account.js. This is only
     the wiring: hand it the client and the settings, then keep the
     header, the wishlist and the checkout in step with who is signed in.

     A shop with accounts off never gets past the first line. */
  function startAccounts() {
    if (!ACCT) return;
    ACCT.hooks.money = formatPrice;
    ACCT.hooks.date = formatDate;
    /* The newsletter wording, and the one way to join it. Handed over
       rather than reached for, so account.js never has to know how this
       site talks to its database. */
    ACCT.hooks.newsletter = NEWSLETTER;
    /* The tick-box beside a new account. p_rejoin is deliberately NOT
       set: opening an account is not asking to undo an unsubscribe, and
       the row that records that wish is there precisely so no form on
       the site can quietly walk over it. */
    ACCT.hooks.subscribe = function (email) {
      if (!WEB || !email) return Promise.resolve();
      return webRpc('subscribe_email', { p_email: email }).catch(function () {});
    };
    /* Recording an order needs the database, and a shop with accounts
       switched off never asks for the client. The Orders tab is the
       shop's own record either way, so the call is offered here as well,
       plainly. */
    ACCT.hooks.placeOrder = function (payload) {
      if (!WEB) return Promise.reject(new Error('not configured'));
      return webRpc('place_order', payload);
    };
    /* The database refuses an order while the shop is shut. This is what
       lets the owner place one anyway while they are testing. */
    ACCT.hooks.previewKey = previewKey;
    /* Told what the shop has decided straight away, so the router knows
       whether #/account is a page here before the client has downloaded. */
    ACCT.configure(ACCOUNTS);

    withClient(function (client) { begin(client); });

    function begin(client) {
    ACCT.start(client, ACCOUNTS).then(function () {
      paintAccount();
      /* A session found after the page had already drawn: the account
         view needs redrawing, or it would sit there offering a sign-in to
         somebody already signed in. */
      if (location.hash === '#/account') renderAccount();
      /* Whatever was wished for on this device before signing in is
         merged with whatever the account already held, so nothing is
         lost by signing in on a second phone. */
      if (ACCT.wishlistFollows()) {
        ACCT.mergeWishlist(wishlist).then(function (merged) {
          if (merged && merged.join('|') !== wishlist.join('|')) {
            wishlist = merged;
            saveWishlist();
            updateWishCount();
            if (mode === 'wishlist') renderGrid();
          }
        });
      }
    });

    ACCT.onChange(function () {
      paintAccount();
      if (location.hash === '#/account') renderAccount();
    });
    }
  }

  /* Fetches the Supabase client, but only for a shop that has accounts
     switched on. Everyone else never asks for it, so the library is not
     on the critical path of a page that would never use it. */
  var CLIENT_SRC = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
  function withClient(then) {
    if (!WEB || !ACCOUNTS.accountsEnabled) { then(null); return; }
    if (window.supabase && window.supabase.createClient) { then(webClient()); return; }
    var tag = document.createElement('script');
    tag.src = CLIENT_SRC;
    tag.async = true;
    tag.onload = function () { then(webClient()); };
    /* A shop whose customers cannot reach the CDN still sells: the
       account panel simply never appears, and guests carry on. */
    tag.onerror = function () { then(null); };
    document.head.appendChild(tag);
  }

  /* The storefront reads with the anon key; the account layer needs the
     same client so a signed-in customer's own rows come back. Built once,
     and only where accounts are actually on. */
  var WEB_CLIENT = null;
  function webClient() {
    if (WEB_CLIENT) return WEB_CLIENT;
    if (!WEB || !ACCOUNTS.accountsEnabled) return null;
    if (!window.supabase || !window.supabase.createClient) return null;
    try {
      WEB_CLIENT = window.supabase.createClient(WEB.SUPABASE_URL, WEB.SUPABASE_ANON_KEY);
    } catch (e) { WEB_CLIENT = null; }
    return WEB_CLIENT;
  }

  function paintAccount() {
    var btn = $('#acctBtn');
    if (!btn) return;
    if (!ACCT || !ACCT.enabled()) { btn.classList.add('hide'); return; }
    btn.classList.remove('hide');
    btn.setAttribute('aria-label', ACCT.signedIn() ? 'Your account' : 'Sign in');
    btn.classList[ACCT.signedIn() ? 'add' : 'remove']('is-in');
  }

  function renderAccount() {
    if (ACCT) ACCT.render($('#accountBody'));
  }

  /* ---- the help panels and the FAQ -----------------------------------
     Three of the four panels used to have their wording written into
     index.html, where nobody could edit them; the fourth was already
     filled from Settings > Payments. All four are settings now, and a
     panel can still borrow its answer from the section that owns it
     rather than repeating it here. */

  function applyCare() {
    drawCare();
    drawFaq();
  }

  function careSource(card) {
    /* A borrowing panel takes the lines the owning section already
       produces. Its own words are the fallback, so a panel set to borrow
       from a section that has nothing to say is not left blank. */
    if (card.source === 'delivery') {
      var d = deliveryLines().concat(pickupLines());
      if (d.length) return d;
    }
    if (card.source === 'payments') {
      var told = (payMethods() || []).filter(function (m) { return m.instructions; });
      if (told.length) {
        return told.map(function (m) { return m.name + ': ' + m.instructions; });
      }
    }
    return String(card.body || '').split(/\n+/).filter(function (t) { return t.trim(); });
  }

  function policyHref(title) {
    if (!title || !SEO) return '';
    var found = (POLICIES || []).filter(function (p) {
      return p && p.title === title;
    })[0];
    if (!found) return '';
    return pathFor('policies/' + SEO.slug(found.title));
  }

  function drawCare() {
    var sec = $('#care'), grid = $('#careGrid');
    if (!sec || !grid) return;

    if (CARESET.careEnabled === false) { sec.classList.add('hide'); return; }

    var list = CARE ? CARE.cards(CARESET.cards) : (CARESET.cards || []);
    grid.innerHTML = '';

    var drawn = 0;
    list.forEach(function (card, i) {
      var lines = careSource(card);
      /* A panel with nothing to say is worse than one fewer panel. */
      if (!lines.length) return;
      drawn++;

      var cell = el('div', 'care-card reveal d' + ((i % 3) + 1));
      var ic = el('div', 'ic');
      ic.innerHTML = CARE ? CARE.icon(card.icon) : '';
      cell.appendChild(ic);

      var h = el('h3', 'serif');
      h.textContent = card.title || '';
      cell.appendChild(h);

      var body = el('div', 'care-body');
      body.textContent = lines.join('\n');
      cell.appendChild(body);

      var href = policyHref(card.policy);
      if (href) {
        var more = el('a', 'care-policy');
        more.href = href;
        more.textContent = 'Read the full policy';
        cell.appendChild(more);
      }

      if (card.ask) {
        var wa = el('a', 'btn btn-wa care-wa');
        wa.href = waUrl(enquiryNumber(), waSay(card.ask));
        wa.target = '_blank'; wa.rel = 'noopener';
        wa.textContent = 'Ask on WhatsApp';
        cell.appendChild(wa);
      }
      grid.appendChild(cell);
    });

    setText('#careEyebrow', CARESET.careEyebrow);
    setText('#careHeading', CARESET.careHeading);
    var sub = $('#careSub');
    if (sub) {
      sub.textContent = CARESET.careSub || '';
      sub.classList[CARESET.careSub ? 'remove' : 'add']('hide');
    }
    sec.classList[drawn ? 'remove' : 'add']('hide');
  }

  function drawFaq() {
    var sec = $('#faq'), host = $('#faqList');
    if (!sec || !host) return;

    var qs = (CARESET.faqs || []).filter(function (f) { return f && f.q && f.a; });
    /* Switched on with nothing written is an empty heading, so the
       questions decide rather than the switch. */
    if (!CARESET.faqEnabled || !qs.length) { sec.classList.add('hide'); return; }

    setText('#faqEyebrow', CARESET.faqEyebrow);
    setText('#faqHeading', CARESET.faqHeading);
    var sub = $('#faqSub');
    if (sub) {
      sub.textContent = CARESET.faqSub || '';
      sub.classList[CARESET.faqSub ? 'remove' : 'add']('hide');
    }

    host.innerHTML = '';
    qs.forEach(function (f, i) {
      var item = el('div', 'faq-item');
      var head = el('button', 'faq-q');
      head.type = 'button';
      head.setAttribute('aria-expanded', 'false');
      head.setAttribute('aria-controls', 'faq-a-' + i);
      head.innerHTML = '<span></span><span class="pm">+</span>';
      head.querySelector('span').textContent = f.q;

      var body = el('div', 'faq-a');
      body.id = 'faq-a-' + i;
      var inner = el('div', 'inner');
      inner.textContent = f.a;

      var href = policyHref(f.policy);
      if (href) {
        var more = el('a', 'care-policy');
        more.href = href;
        more.textContent = 'Read the full policy';
        inner.appendChild(document.createElement('br'));
        inner.appendChild(more);
      }
      body.appendChild(inner);

      head.addEventListener('click', function () {
        var open = item.classList.toggle('open');
        head.setAttribute('aria-expanded', open ? 'true' : 'false');
        head.querySelector('.pm').textContent = open ? '−' : '+';
      });

      item.appendChild(head); item.appendChild(body);
      host.appendChild(item);
    });

    var foot = $('#faqAsk');
    if (!foot) {
      foot = el('div', 'faq-foot');
      foot.id = 'faqAsk';
      host.parentNode.appendChild(foot);
    }
    foot.innerHTML = '';
    if (CARESET.faqAskEnabled !== false) {
      var a = el('a', 'btn btn-wa');
      a.href = waUrl(enquiryNumber(), waSay('I have a question.'));
      a.target = '_blank'; a.rel = 'noopener';
      a.innerHTML = waIcon() + (CARESET.faqAskText || 'Ask us on WhatsApp');
      foot.appendChild(a);
    }
    sec.classList.remove('hide');
  }

  function applyLookbook(list) {
    if (!Array.isArray(list)) return;
    for (var i = 0; i < 6; i++) dressTile($('#look' + (i + 1)), list[i]);
  }

  /* The row of promises under the story. Rebuilt rather than filled in, so
     a shop can have three or six rather than exactly four. The icons cycle
     through the set the design shipped with. */
  var VALUE_ICONS = [
    "<path d='M12 2l2.4 7.4H22l-6 4.5 2.3 7.1L12 16.6 5.7 21l2.3-7.1-6-4.5h7.6z'/>",
    "<path d='M20 12l-8 8-8-8a5 5 0 017-7l1 1 1-1a5 5 0 017 7z'/>",
    "<path d='M21 11.5a8.38 8.38 0 01-9 8.5 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.2A8.38 8.38 0 014 11.5 8.5 8.5 0 0112.5 3 8.5 8.5 0 0121 11.5z'/>",
    "<path d='M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'/>"
  ];
  function applyValues(list) {
    if (!Array.isArray(list) || !list.length) return;   // keep the shipped four
    var host = $('#valuesGrid');
    if (!host) return;
    host.innerHTML = '';
    list.forEach(function (v, i) {
      if (!v || (!v.t && !v.s)) return;
      var cell = el('div', 'trust-cell');
      cell.innerHTML =
        "<svg viewBox='0 0 24 24'>" + VALUE_ICONS[i % VALUE_ICONS.length] + '</svg>' +
        '<div><div class="t"></div><div class="s"></div></div>';
      cell.querySelector('.t').textContent = v.t || '';
      cell.querySelector('.s').textContent = v.s || '';
      host.appendChild(cell);
    });
  }


  // The order of the page, the sections that are on it, and their wording.
  // Sections are siblings inside <main>, so putting them in the shop's order
  // is a matter of re-appending them in that order.
  function applySections() {
    if (!HOME || !SEC) return;
    var list = SEC.reconcile(HOME.sections);
    if (!list.length) return;

    var main = document.querySelector('main');
    if (!main) return;

    list.forEach(function (row) {
      var sec = document.getElementById(row.id);
      if (!sec || sec.parentNode !== main) return;   // never move a page view

      if (row.on === false) { sec.classList.add('hide'); }
      else if (row.id !== 'promo') { sec.classList.remove('hide'); }

      /* Its own heading, where the shop has given one. */
      if (row.title) {
        var h = sec.querySelector('.section-head h2, .row-head h2');
        if (h) h.textContent = row.title;
      }
      if (row.desc) {
        var head = sec.querySelector('.section-head');
        if (head) {
          var para = head.querySelector('p');
          if (!para) { para = el('p'); head.appendChild(para); }
          para.textContent = row.desc;
        }
      }

      main.appendChild(sec);        // moving, not copying: this is the order
    });
  }

  /* The promotional banner. It only appears when it has been switched on
     and given something to say, since an empty band is worse than none. */
  /* The homepage band. Two cards at most, and it hides itself entirely
     when the shop offers neither, rather than standing there as a heading
     over nothing. */
  function applyDeliveryBand() {
    var sec = $('#delivery-sec');
    if (!sec) return;

    var cards = [];
    var d = deliveryLines();
    if (d.length) cards.push(['Delivery', deliveryIcon(), d]);
    var c = pickupLines();
    if (c.length) cards.push(['Collection', pickupIcon(), c]);

    if (!cards.length) { sec.classList.add('hide'); return; }

    var grid = $('#deliveryGrid');
    if (grid) {
      grid.innerHTML = '';
      cards.forEach(function (card) {
        var cell = el('div', 'dl-card');
        cell.innerHTML = '<div class="ic">' + card[1] + '</div>' +
          '<h3 class="serif"></h3>' +
          card[2].map(function () { return '<div class="dl-l"></div>'; }).join('');
        cell.querySelector('h3').textContent = card[0];
        var lines = cell.querySelectorAll('.dl-l');
        card[2].forEach(function (t, i) { if (lines[i]) lines[i].textContent = t; });
        grid.appendChild(cell);
      });
    }

    var sub = $('#deliverySub');
    if (sub) {
      sub.textContent = DELIVERY.terms || '';
      sub.classList[DELIVERY.terms ? 'remove' : 'add']('hide');
    }

    var foot = $('#deliveryFoot');
    if (foot) {
      foot.innerHTML = '';
      var num = deliversAnywhere() ? deliveryNumber() : pickupNumber();
      if (num) {
        var a = el('a', 'btn btn-wa');
        a.href = waUrl(num, waSay('I have a question about delivery.'));
        a.target = '_blank'; a.rel = 'noopener';
        a.innerHTML = waIcon() + 'Ask about delivery';
        foot.appendChild(a);
      }
      if (hasDeliveryPolicy()) {
        var more = el('a', 'dl-more');
        more.href = pathFor('policies');
        more.textContent = 'Read the full delivery policy';
        foot.appendChild(more);
      }
    }
    sec.classList.remove('hide');
  }
  function deliveryIcon() {
    return "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.4'>" +
           "<rect x='1' y='3' width='15' height='13'/><path d='M16 8h4l3 3v5h-7V8z'/>" +
           "<circle cx='5.5' cy='18.5' r='2.5'/><circle cx='18.5' cy='18.5' r='2.5'/></svg>";
  }
  function pickupIcon() {
    return "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.4'>" +
           "<path d='M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z'/>" +
           "<circle cx='12' cy='10' r='3'/></svg>";
  }

  function applyPromo() {
    var sec = $('#promo');
    if (!sec || !HOME) return;
    if (!HOME.promoEnabled || !HOME.promoTitle) { sec.classList.add('hide'); return; }

    setText('#promoTitle', HOME.promoTitle);
    var text = $('#promoText');
    if (text) {
      text.textContent = HOME.promoText || '';
      text.classList[HOME.promoText ? 'remove' : 'add']('hide');
    }
    var bg = $('#promoBg');
    if (bg) bg.style.backgroundImage = HOME.promoImage ? "url('" + HOME.promoImage + "')" : '';

    var cta = $('#promoCta');
    if (cta) {
      if (HOME.promoCtaText) {
        cta.textContent = HOME.promoCtaText;
        var link = (HOME.promoCtaLink || '').trim();
        if (link) {
          cta.href = link;
          if (/^https?:/i.test(link)) { cta.target = '_blank'; cta.rel = 'noopener'; }
        } else {
          cta.href = '#/shop';
        }
        cta.classList.remove('hide');
      } else {
        cta.classList.add('hide');
      }
    }
    sec.classList.remove('hide');
  }

  // ---------------------------------------------------------------- payments
  // Which ways of paying to show, and what to say about each. The account
  // numbers behind them are deliberately unreachable from here.
  var PAY_METHODS = [
    { key: 'cash',   fallback: 'Cash' },
    { key: 'bank',   fallback: 'Bank Transfer' },
    { key: 'mobile', fallback: 'Mobile Money' },
    { key: 'card',   fallback: 'Card Payment' },
    { key: 'cod',    fallback: 'Payment on Delivery' }
  ];

  function payMethods() {
    if (!PAY) return null;                   // nothing saved yet
    return PAY_METHODS
      .filter(function (m) { return PAY[m.key + 'Enabled']; })
      .map(function (m) {
        return {
          key: m.key,
          name: PAY[m.key + 'Name'] || m.fallback,
          instructions: PAY[m.key + 'Instructions'] || ''
        };
      });
  }

  function applyPaymentSettings() {
    var list = payMethods();
    if (!list) return;                       // leave what Site Content left

    var row = $('#payRow');
    if (row) {
      row.innerHTML = '';
      list.forEach(function (m) {
        var s = el('span');
        s.textContent = m.name;
        row.appendChild(s);
      });
      row.classList[list.length ? 'remove' : 'add']('hide');
    }

    /* The How to pay panel used to be built here. It is a Customer Care
       panel now, like the other three, and borrows these instructions
       instead of being a fourth card with its own rules. */
  }

  // ---------------------------------------------------------------- ordering
  // WhatsApp is the checkout, and this is the step in front of it.
  // Whatever Settings > Shopping asks for is collected here and folded
  // into the message, so the first thing the shop receives is a complete
  // order rather than "is this available?" followed by four rounds of
  // questions. A single piece and a whole cart both come through here:
  // see orderOf() and orderOfCart() below.
  //
  // The buyer's own details are kept in this browser only, so a returning
  // customer does not retype them, and they travel inside the WhatsApp
  // message rather than being sent anywhere on their own.

  var ORDER_MEMO = 'vbp_buyer';

  function buyerFields() {
    return [
      { key: 'name',    on: SHOP.requireName,    label: 'Your name',        type: 'text',  ac: 'name' },
      { key: 'phone',   on: SHOP.requirePhone,   label: 'Phone number',     type: 'tel',   ac: 'tel' },
      { key: 'email',   on: SHOP.requireEmail,   label: 'Email address',    type: 'email', ac: 'email' },
      /* Only worth asking where something is going if something is being
         sent. With delivery off, or with the customer collecting, the box
         asks for what nobody needs. */
      { key: 'address', on: SHOP.requireAddress && deliversAnywhere(),
        label: 'Delivery address', type: 'area',  ac: 'street-address',
        onlyWhenDelivering: true }
    ].filter(function (f) { return f.on; });
  }

  /* The customer is asked how they want the order only when there is a
     real choice to make. One option is not a choice, it is a sentence. */
  function offersBoth() { return deliversAnywhere() && collectsInPerson(); }

  /* The delivery-or-collection choice rides along inside the details step
     rather than being a reason to create one. A shop that has switched off
     every question is saying "do not interrupt, just open WhatsApp", and
     putting a step back for one more question would contradict it. Where
     there is no step, the conversation settles it, as it always did. */
  function needsDetails() {
    return buyerFields().length > 0 || !!SHOP.orderNotes;
  }

  function savedBuyer() {
    try { return JSON.parse(store.get(ORDER_MEMO) || '{}') || {}; }
    catch (e) { return {}; }
  }
  function rememberBuyer(d) {
    try { store.set(ORDER_MEMO, JSON.stringify(d)); } catch (e) {}
  }

  /* What is being ordered, in the one shape the details step, the record
     and the message all read. A piece bought on its own is a cart of one,
     which is what lets both go through the same door rather than growing
     a second checkout beside the first. */
  function orderOf(p) {
    return { lines: [{ product: p, qty: 1 }], single: p };
  }
  /* The cart as an order: the lines the shop can actually sell today. A
     piece that sold out while it sat there is left behind rather than
     sent, so the message and the total agree with the panel. */
  function orderOfCart() {
    var lines = cartRows().filter(function (r) { return r.priced; })
      .map(function (r) { return { product: r.product, qty: r.line.qty }; });
    return { lines: lines, single: null };
  }
  function orderTotal(order) {
    var t = 0;
    order.lines.forEach(function (l) {
      var v = priceOf(l.product);
      if (!v.onRequest) t += v.now * l.qty;
    });
    return t;
  }
  function orderItemCount(order) {
    var n = 0;
    order.lines.forEach(function (l) { n += l.qty; });
    return n;
  }
  /* What the details step calls the thing being bought. */
  function orderTitle(order) {
    if (order.single) return order.single.name;
    var n = orderItemCount(order);
    return n + (n === 1 ? ' item' : ' items');
  }

  /* A whole cart as a message. The single-piece template is not stretched
     over it: {product}, {sku} and {price} each name one thing, and a shop
     that rewrote that template wrote it about one piece. So the list is
     built here instead, from the same prices, currency and tax line the
     cart panel was showing a moment ago. */
  function cartMessageLines(order) {
    var out = ['Hello ' + shopName() + ", I'd like to order:", ''];
    order.lines.forEach(function (l, i) {
      var v = priceOf(l.product);
      out.push((i + 1) + '. ' + l.product.name + ' (SKU: ' + l.product.sku + ')');
      out.push('   ' + l.qty + ' \u00d7 ' + v.nowText + ' = ' + formatPrice(v.now * l.qty));
    });
    out.push('');
    out.push('Total: ' + formatPrice(orderTotal(order)));
    var tax = taxLineText();
    if (tax) out.push('(' + tax + ')');
    return out;
  }

  /* The order message: what is being bought first, then whatever was
     collected, each on its own line so it reads as an order in WhatsApp. */
  function composeOrder(order, details) {
    /* One piece keeps the shop's own template, exactly as it always has:
       a shop that customised it sees no change. */
    var lines = order.single ? [orderMessage(order.single)] : cartMessageLines(order);
    var labels = { name: 'Name', phone: 'Phone', email: 'Email',
                   address: 'Delivery address', notes: 'Notes' };
    ['name', 'phone', 'email', 'address', 'notes'].forEach(function (k) {
      var v = details && details[k];
      if (v) lines.push(labels[k] + ': ' + v);
    });
    /* Only said when the customer was actually given the choice. On a
       shop that only delivers, "Delivery" in the message is noise. */
    if (offersBoth() && details && details.how) {
      lines.push(details.how === 'collection' ? 'Collecting in person' : 'To be delivered');
    }
    return lines.join('\n');
  }

  function openOrderForm(order) {
    var modal = $('#orderModal'), body = $('#orderBody');
    /* No dialog on the page: straight to WhatsApp with what we have,
       which for a cart still has to be composed rather than read off a
       link the markup was carrying. */
    if (!modal || !body) {
      var direct = order.single ? waLink(order.single)
                                : waUrl(orderNumber(), composeOrder(order, null));
      if (direct) window.open(direct, '_blank', 'noopener');
      return;
    }

    var fields = buyerFields();
    var saved = savedBuyer();

    /* A signed-in customer's default address beats what this device
       happens to remember: they chose it deliberately, and it is the one
       that follows them between phones. */
    var book = (ACCT && ACCT.addressesOn()) ? ACCT.state.addresses : [];
    var chosen = (ACCT && ACCT.addressesOn()) ? ACCT.defaultAddress() : null;
    var me = (ACCT && ACCT.signedIn()) ? (ACCT.state.profile || {}) : {};

    /* Somebody signed in has already told the shop their name, their phone
       and where they live. Asking again is asking them to prove they can
       type. Their own details come first, then the address they chose,
       then whatever this device happened to remember. */
    if (chosen || me.name || me.phone) {
      saved = {
        name: (chosen && chosen.recipient) || me.name || saved.name || '',
        phone: (chosen && chosen.phone) || me.phone || saved.phone || '',
        email: (ACCT && ACCT.signedIn() && ACCT.state.user.email) || saved.email || '',
        address: chosen ? [chosen.address, chosen.city].filter(Boolean).join(', ')
                        : (saved.address || ''),
        how: saved.how
      };
    }

    body.innerHTML =
      '<button class="qv-close" id="odClose" aria-label="Close">&times;</button>' +
      '<div class="c">' + esc(orderTitle(order)) + '</div>' +
      '<h3 class="serif">Your details</h3>' +
      '<p class="od-lead">So your order arrives complete. We will carry on from here on WhatsApp.</p>' +
      /* Delivery or collection, asked before anything else, because the
         answer decides whether the address below is worth filling in. */
      (offersBoth()
        ? '<div class="od-how" role="radiogroup" aria-label="How would you like your order">' +
            '<label class="od-pick"><input type="radio" name="odHow" value="delivery"' +
              (saved.how === 'collection' ? '' : ' checked') + '><span>Delivered</span></label>' +
            '<label class="od-pick"><input type="radio" name="odHow" value="collection"' +
              (saved.how === 'collection' ? ' checked' : '') + '><span>Collected in person</span></label>' +
          '</div>'
        : '') +
      /* Only where there is a choice to make. One saved address needs no
         picker: it is already in the boxes below. */
      (book.length > 1
        ? '<label class="rv-lbl" for="od_book">Deliver to</label>' +
          '<select id="od_book">' +
          book.map(function (a, i) {
            var t = [a.label, a.address, a.city].filter(Boolean).join(' · ');
            return '<option value="' + i + '"' +
              (chosen && a.id === chosen.id ? ' selected' : '') + '>' + esc(t) + '</option>';
          }).join('') +
          '</select>'
        : '') +
      fields.map(function (f) {
        var v = esc(saved[f.key] || '');
        return '<label class="rv-lbl" for="od_' + f.key + '">' + esc(f.label) + '</label>' +
          (f.type === 'area'
            ? '<textarea id="od_' + f.key + '" rows="2" maxlength="200" autocomplete="' + f.ac + '">' + v + '</textarea>'
            : '<input type="' + f.type + '" id="od_' + f.key + '" maxlength="120" autocomplete="' + f.ac + '" value="' + v + '">');
      }).join('') +
      (SHOP.orderNotes
        ? '<label class="rv-lbl" for="od_notes">Anything else <span class="od-opt">optional</span></label>' +
          '<textarea id="od_notes" rows="2" maxlength="300" placeholder="A landmark, a gift message, a preferred day"></textarea>'
        : '') +
      '<div class="rv-actions">' +
        '<button class="btn btn-wa" id="odGo">' + waIcon() + 'Continue on WhatsApp</button>' +
        '<span class="rv-msg" id="odMsg"></span>' +
      '</div>' +
      '<p class="od-note">Your details are kept on this device so you do not have to type ' +
      'them again. They are sent only inside your WhatsApp message.</p>';

    $('#odClose').addEventListener('click', closeOrderForm);

    var picker = $('#od_book', body);
    if (picker) {
      picker.addEventListener('change', function () {
        var a = book[Number(picker.value)] || {};
        var an = $('#od_address', body), nm = $('#od_name', body), ph = $('#od_phone', body);
        if (an) an.value = [a.address, a.city].filter(Boolean).join(', ');
        if (nm && a.recipient) nm.value = a.recipient;
        if (ph && a.phone) ph.value = a.phone;
      });
    }

    /* The address box follows the choice: asked for when the order is
       being sent somewhere, put away when it is being fetched. The note
       under it follows too, so the customer reads the right thing. */
    var howInputs = $all('input[name="odHow"]', body);
    var addrWrap = null, addrLabel = null;
    if (howInputs.length) {
      var addrBox = $('#od_address', body);
      if (addrBox) {
        addrWrap = addrBox;
        addrLabel = body.querySelector('label[for="od_address"]');
      }
      var howNote = el('p', 'od-how-note');
      var howAnchor = body.querySelector('.od-how');
      if (howAnchor) howAnchor.parentNode.insertBefore(howNote, howAnchor.nextSibling);

      var applyHow = function () {
        var collecting = chosenHow() === 'collection';
        if (addrWrap) {
          addrWrap.classList[collecting ? 'add' : 'remove']('hide');
          if (addrLabel) addrLabel.classList[collecting ? 'add' : 'remove']('hide');
        }
        /* Short, here. A customer at the point of sending is deciding, not
           reading a tariff: where to come if they are collecting, and what
           happens next if they are not. The full areas and fees are on the
           product page and the homepage band. */
        var lines = collecting
          ? pickupLines()
          : (DELIVERY.instructions ? [DELIVERY.instructions] : []);
        howNote.textContent = lines.join(' ');
        howNote.classList[lines.length ? 'remove' : 'add']('hide');
      };
      howInputs.forEach(function (r) { r.addEventListener('change', applyHow); });
      applyHow();
    }

    function chosenHow() {
      if (!offersBoth()) return deliversAnywhere() ? 'delivery' : 'collection';
      var picked = body.querySelector('input[name="odHow"]:checked');
      return picked ? picked.value : 'delivery';
    }

    function collect() {
      var out = {};
      var how = chosenHow();
      fields.forEach(function (f) {
        /* An address typed before the customer switched to collection is
           not sent: it would have you delivering to somewhere they said
           they were coming to fetch from. */
        if (f.onlyWhenDelivering && how === 'collection') { out[f.key] = ''; return; }
        var e = $('#od_' + f.key);
        out[f.key] = e ? e.value.trim() : '';
      });
      var n = $('#od_notes');
      if (n) out.notes = n.value.trim();
      out.how = how;
      return out;
    }

    function go() {
      var d = collect();
      var msg = $('#odMsg');
      /* A field that does not apply cannot be missing. Asking a customer
         who is collecting to fill in a delivery address before they are
         allowed to continue would be a dead end. */
      var missing = fields.filter(function (f) {
        if (f.onlyWhenDelivering && d.how === 'collection') return false;
        return !d[f.key];
      });
      if (missing.length) {
        msg.textContent = 'Please fill in ' + missing[0].label.toLowerCase() + '.';
        msg.className = 'rv-msg err';
        var e = $('#od_' + missing[0].key);
        if (e) e.focus();
        return;
      }
      if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) {
        msg.textContent = 'That does not look like an email address.';
        msg.className = 'rv-msg err';
        $('#od_email').focus();
        return;
      }
      /* Remembered for next time: their details and how they liked to
         receive it. An address is only overwritten when one was given, so
         collecting once does not lose the address they typed before. */
      var keep = savedBuyer();
      fields.forEach(function (f) {
        if (f.onlyWhenDelivering && d.how === 'collection') return;
        keep[f.key] = d[f.key];
      });
      keep.how = d.how;
      rememberBuyer(keep);                 // notes are for this order only

      /* Recorded before the tab opens, and never in its way. The WhatsApp
         message IS the order; this row is a convenience on top of it, so
         a write that fails or is slow must not cost the sale. */
      if (ACCT) {
        /* recordOrder has always taken a list of items; until now it only
           ever got one. A cart fills the same list. */
        ACCT.recordOrder({
          name: d.name, phone: d.phone, email: d.email,
          address: d.address, notes: d.notes,
          fulfilment: d.how,
          total: orderTotal(order),
          currency: SETTINGS.currency,
          items: order.lines.map(function (l) {
            var v = priceOf(l.product);
            return { sku: l.product.sku, name: l.product.name,
                     price: v.onRequest ? null : v.now, qty: l.qty };
          })
        });
      }

      var url = waUrl(orderNumber(), composeOrder(order, d));
      closeOrderForm();
      if (url) window.open(url, '_blank', 'noopener');
    }

    $('#odGo').addEventListener('click', go);
    body.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); go(); }
    });

    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    var first = $('#od_' + (fields[0] ? fields[0].key : 'notes'));
    if (first) setTimeout(function () { first.focus(); }, 60);
  }

  function closeOrderForm() {
    var m = $('#orderModal');
    if (m) m.classList.remove('open');
    document.body.style.overflow = '';
  }

  /* Every buy button comes through here. With nothing to ask for, it is
     the straight-to-WhatsApp link the shop has always had. */
  function startOrder(e, p) {
    /* A shop that requires an account, or an unconfirmed email address,
       stops here rather than at WhatsApp. Being told why on the page is
       better than a conversation that goes nowhere. */
    if (!mayCheckout()) {
      e.preventDefault();
      openCheckoutBlock();
      return;
    }
    if (!needsDetails()) return;          // let the anchor follow its href
    e.preventDefault();
    openOrderForm(orderOf(p));
  }

  /* The cart's way to the same place. There is no anchor behind this one
     to fall through to, so where a piece with nothing to ask would follow
     its href, a cart composes its message and opens WhatsApp itself. */
  function startCartCheckout() {
    var order = orderOfCart();
    /* An empty cart cannot be sent, and neither can one holding only
       pieces the shop can no longer sell. The button is not drawn in
       either case; this is the second lock, for a click that reached
       here another way. */
    if (!order.lines.length) return;
    if (!mayCheckout()) { closeCart(); openCheckoutBlock(); return; }
    closeCart();
    if (needsDetails()) { openOrderForm(order); return; }
    /* Nothing to ask for: straight out, the way a buy button with no
       questions behind it goes straight to WhatsApp. */
    var url = waUrl(orderNumber(), composeOrder(order, null));
    if (url) window.open(url, '_blank', 'noopener');
  }

  /* Not a form: a sentence and a way forward. */
  function openCheckoutBlock() {
    var modal = $('#orderModal'), body = $('#orderBody');
    var why = ACCT ? ACCT.whyNotCheckout() : '';
    if (!modal || !body) { go('account'); return; }
    body.innerHTML =
      '<button class="qv-close" id="odClose" aria-label="Close">&times;</button>' +
      '<h3 class="serif">One moment</h3>' +
      '<p class="od-lead"></p>' +
      '<div class="rv-actions"><button class="btn btn-gold" id="odAcct">Go to your account</button></div>';
    body.querySelector('.od-lead').textContent = why;
    $('#odClose').addEventListener('click', closeOrderForm);
    $('#odAcct').addEventListener('click', function () {
      closeOrderForm();
      go('account');
    });
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  // ------------------------------------------------------------------ share
  function shareIcon() {
    return "<svg viewBox='0 0 24 24' aria-hidden='true'>" +
      "<circle cx='18' cy='5' r='3'/><circle cx='6' cy='12' r='3'/><circle cx='18' cy='19' r='3'/>" +
      "<line x1='8.6' y1='10.6' x2='15.4' y2='6.4'/><line x1='8.6' y1='13.4' x2='15.4' y2='17.6'/></svg>";
  }

  /* Hand a piece to whatever the phone uses for sharing. On a computer, or
     anywhere the share sheet is unavailable, the address is copied instead
     and the button says so. */
  function shareProduct(p, btn) {
    var url = location.origin + location.pathname + '#/product/' + encodeURIComponent(p.sku);
    var data = {
      title: p.name,
      /* priceLine, not the till's number: a shared piece must carry the
         price the page was showing. Sharing the raw figure would put the
         old price on a reduced piece, and the hidden one on a piece whose
         price is meant to be asked for. */
      text: p.name + ' · ' + priceLine(p) + ' · ' + shopName(),
      url: url
    };
    function said(msg) {
      if (!btn) return;
      var had = btn.getAttribute('data-label') || btn.textContent;
      btn.setAttribute('data-label', had);
      btn.textContent = msg;
      setTimeout(function () { btn.innerHTML = shareIcon() + had.replace(/^\s+/, ''); }, 1800);
    }
    if (navigator.share) {
      navigator.share(data).catch(function () { /* dismissed, which is not a failure */ });
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { said('Link copied'); },
                                              function () { said('Could not copy'); });
      return;
    }
    var t = document.createElement('textarea');
    t.value = url;
    document.body.appendChild(t);
    t.select();
    try { document.execCommand('copy'); said('Link copied'); }
    catch (e) { said('Could not copy'); }
    document.body.removeChild(t);
  }

  // ------------------------------------------------------------------ gate
  // Maintenance mode, and any website status other than Live, replace the
  // shop with a notice. Maintenance wins, which is what the admin promises.
  //
  // The check needs the settings row, so it cannot happen before the page
  // has painted. To keep an ordinary visit fast we do not hide the shop
  // while we wait; instead we remember the last known state and hide up
  // front only for a browser that was gated last time. A normal customer
  // therefore pays nothing, and during a real closure only the very first
  // view of that browser can flash the shop.
  var GATE_MEMO = 'vbp_gate';

  /* Testing a shop that is shut.

     The owner has to open the site to see their changes, and the moment
     they do a customer can be on it as well. A preview key settles that:
     the shop stays shut to everybody, and one address lets the owner in.

         https://yourshop.com/?preview=YOURKEY

     Held for the tab rather than carried in every link, so moving around
     the site does not need it repeated and closing the tab forgets it.

     It is a door key, not a lock. It sits in the settings the storefront
     already reads, so it is not a secret and is not meant to be one:
     what it stops is a customer wandering in during an hour's work,
     which is the thing that actually happens. Left empty, nobody walks
     past the notice at all. */
  var PREVIEW_MEMO = 'vbp_preview';
  function previewKey() {
    var given = '';
    try {
      var m = (location.search || '').match(/[?&]preview=([^&#]*)/);
      if (m) given = decodeURIComponent(m[1]);
    } catch (e) {}
    try {
      if (given) { sessionStorage.setItem(PREVIEW_MEMO, given); return given; }
      return sessionStorage.getItem(PREVIEW_MEMO) || '';
    } catch (e) { return given; }
  }
  /* Whether this browser may see the shop while it is shut. The database
     asks the same question again of anything that writes, so a browser
     saying yes to itself here buys nothing it should not have. */
  function previewing() {
    var want = String(SETTINGS.previewKey || '').trim();
    return !!want && previewKey().trim() === want;
  }
  window.VBP_PREVIEW = previewKey;      // the chat widget sends it too

  function gateReason() {
    if (previewing()) return '';        // the owner, testing
    if (SETTINGS.maintenanceMode) return 'maintenance';
    if (SETTINGS.websiteStatus === 'coming-soon') return 'coming-soon';
    if (SETTINGS.websiteStatus === 'closed') return 'closed';
    return '';
  }

  function preHideIfLastGated() {
    if (!WEB) return;                      // no settings to read; never hide
    if (store.get(GATE_MEMO) !== '1') return;
    document.documentElement.classList.add('vbp-gated');
    // A request that fails rejects and we carry on, but one that simply
    // hangs never would, and this visitor would be left looking at an
    // empty screen. Give up waiting and show the shop; if the settings do
    // arrive and say we are closed, applyGate puts the notice back.
    setTimeout(function () {
      if (!$('.gate')) document.documentElement.classList.remove('vbp-gated');
    }, 6000);
  }

  function gateCopy(reason) {
    var name = SETTINGS.businessName || 'Vaultique Boutique Point';
    if (reason === 'maintenance') {
      return {
        eyebrow: 'Back shortly',
        title: 'We are just making a few improvements',
        body: SETTINGS.maintenanceMessage ||
              'We are making a few improvements and will be back shortly.',
        showHours: false
      };
    }
    if (reason === 'coming-soon') {
      return {
        eyebrow: 'Opening soon',
        title: name + ' is on its way',
        body: SETTINGS.description ||
              'Our online boutique is being prepared. Message us any time and we will let you know the moment we open.',
        showHours: true
      };
    }
    return {
      eyebrow: 'Temporarily closed',
      title: 'We are not trading at the moment',
      body: SETTINGS.description ||
            'We are closed for now. Message us and we will come back to you as soon as we reopen.',
      showHours: true
    };
  }

  function renderGate(reason) {
    var c = gateCopy(reason);
    var wrap = el('div', 'gate');

    var inner = el('div', 'gate-inner');
    var brand = el('div', 'gate-brand serif');
    brand.textContent = SETTINGS.businessName || 'Vaultique Boutique Point';
    var eyebrow = el('div', 'gate-eyebrow');
    eyebrow.textContent = c.eyebrow;
    var h = el('h1', 'gate-title serif');
    h.textContent = c.title;
    var p = el('p', 'gate-body');
    p.textContent = c.body;

    inner.appendChild(brand);
    inner.appendChild(eyebrow);
    inner.appendChild(h);
    inner.appendChild(p);

    if (c.showHours && SETTINGS.businessHours && FMT) {
      var line = FMT.summariseHours(SETTINGS.businessHours);
      if (line) {
        var hrs = el('div', 'gate-hours');
        hrs.textContent = 'Usual trading hours · ' + line;
        inner.appendChild(hrs);
      }
    }

    var acts = el('div', 'gate-actions');
    var wa = el('a', 'gate-btn');
    /* waSay() already opens with "Hello <shop>, " — see greet() in
       contact.js. Writing it here as well is how the notice used to hand
       a customer a message beginning "Hello Shop, Hello Shop, ". */
    wa.href = waGeneral('I have a question.');
    wa.target = '_blank'; wa.rel = 'noopener';
    wa.textContent = 'Message us on WhatsApp';
    acts.appendChild(wa);

    if (EMAIL) {
      var mail = el('a', 'gate-btn gate-btn-quiet');
      mail.href = 'mailto:' + EMAIL;
      mail.textContent = EMAIL;
      acts.appendChild(mail);
    }
    inner.appendChild(acts);

    if (SETTINGS.tagline) {
      var tag = el('div', 'gate-tagline');
      tag.textContent = SETTINGS.tagline;
      inner.appendChild(tag);
    }

    wrap.appendChild(inner);
    document.body.appendChild(wrap);
    document.documentElement.classList.add('vbp-gated');
    document.title = (SETTINGS.businessName || 'Vaultique Boutique Point') + ' · ' + c.eyebrow;

    /* A shop that is closed, coming soon or under maintenance should not
       be gathering search traffic to a notice. The page stays followable
       so a crawler still finds the links, and comes back to a real shop
       once the notice is gone.

       The whole set is applied rather than the one tag, because apply()
       replaces what it owns: handing it robots alone would take the shop
       name and the sharing picture off a page people still share. */
    if (SEO) {
      try {
        /* Its own name: `c` up at the top of this function is the notice
           the shop is showing, and a second `var c` was quietly the same
           variable — harmless only because nothing used the first one
           after this point, which is not a thing to leave standing. */
        var seoCtx = seoContext();
        var view = SEO.forRoute(seoCtx, '');
        view.robots = 'noindex, follow';
        view.title = document.title;      // the notice named itself just above
        SEO.apply(SEO.tagsFor(view, seoCtx));
      } catch (e) {}
    }
  }

  // Returns true when the site is gated and the shop must not be built.
  function applyGate() {
    var reason = gateReason();
    store.set(GATE_MEMO, reason ? '1' : '0');
    if (!reason) {
      document.documentElement.classList.remove('vbp-gated');
      return false;
    }
    renderGate(reason);
    /* Nothing should carry on working behind the notice. The chat panel
       is hidden by the gate's stylesheet, but hidden is not stopped: it
       would go on asking the database for messages nobody can read. */
    try {
      var C = window.VBP_CHAT;
      if (C && typeof C.standDown === 'function') C.standDown();
    } catch (e) {}
    return true;
  }

  // ------------------------------------------------------------------ data load
  function load() {
    fetch('/api/products' + (previewKey() ? '?preview=' + encodeURIComponent(previewKey()) : ''),
          { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('bad'); return r.json(); })
      .then(function (d) {
        PRODUCTS = (d && d.products) || [];
        /* A feed that answers with nothing is not a feed that failed. An
           empty POS is a real answer and the shop should show an empty
           shop, not twelve invented pieces. Only a request that could not
           be made or could not be read falls back to the samples, which
           is what makes opening this file straight off a disk still show
           the design. */
        finishLoad();
      })
      .catch(function () { usePreview(); });
  }
  function usePreview() {
    PREVIEW = true;
    var b = $('#previewBanner'); if (b) b.classList.add('show');
    PRODUCTS = SAMPLE.slice();
    finishLoad();
  }
  function finishLoad() {
    loadWebsiteData(function () {
      applyContent(CONTENT);          // contact details first, the gate uses them
      applyTheme();                   // the notice below is branded too
      if (applyGate()) return;        // closed or under maintenance: build nothing
      mergeMeta();
      applySettings();
      applyShopSettings();
      /* Before the homepage, and outside it: applyHomepageSettings gives up
         early on a shop that has never saved that section, and the delivery
         band is not the homepage's to withhold. Drawn first so that when
         the homepage does run, applySections can move a band that is
         already dressed. */
      applyDeliveryBand();
      applyNewsletter();
      applyHomepageSettings();
      applyPaymentSettings();
      /* After Payments and Delivery, because a panel can borrow from
         either and both have to have spoken first. */
      applyCare();
      applyContactSettings();
      bindWa();                       // rebuild every link with the real numbers
      bindEmailIg();
      applyLocalBackgrounds();
      startAccounts();
      boot();
    });
  }
  // Hero and lookbook photos normally come from the admin. If the admin is not
  // connected, fall back to optional local files, but only then (no 404 probing
  // once the admin is in use).
  function applyLocalBackgrounds() {
    if (!USE_LOCAL) return;
    ['#heroPhoto1', '#heroPhoto2', '#heroPhoto3'].forEach(function (id, i) {
      var e = $(id); if (!e || e.style.backgroundImage) return;
      var u = '/images/hero-' + (i + 1) + '.jpg';
      preload(u, function (ok) { if (ok) e.style.backgroundImage = "url('" + u + "')"; });
    });
    for (var k = 1; k <= 6; k++) (function (k) {
      var e = $('#look' + k); if (!e || e.style.backgroundImage) return;
      var u = '/images/look-' + k + '.jpg';
      preload(u, function (ok) { if (ok) dressTile(e, u); });
    })(k);
  }
  // pull the website's own photos + content (separate Supabase, read-only here)
  function loadWebsiteData(cb) {
    if (!WEB) { cb(); return; }
    var base = WEB.SUPABASE_URL.replace(/\/+$/, '');
    var h = { apikey: WEB.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + WEB.SUPABASE_ANON_KEY };
    var pending = 17;
    function done() { if (--pending === 0) cb(); }
    fetch(base + '/rest/v1/product_meta?select=*', { headers: h })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) { (rows || []).forEach(function (m) { if (m && m.sku) META[m.sku] = m; }); })
      .catch(function () {}).then(done);
    fetch(base + '/rest/v1/site_content?id=eq.1&select=data', { headers: h })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) { if (rows && rows[0] && rows[0].data) CONTENT = rows[0].data || {}; })
      .catch(function () {}).then(done);
    fetch(base + '/rest/v1/reviews?approved=eq.true&select=*&order=created_at.desc', { headers: h })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) { REVIEWS = rows || []; })
      .catch(function () {}).then(done);
    fetch(base + '/rest/v1/policies?select=*&order=sort.asc', { headers: h })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (rows) { if (rows && rows.length) POLICIES = rows; })
      .catch(function () {}).then(done);
    fetch(base + '/rest/v1/site_settings?key=eq.homepage&select=data', { headers: h })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) { HOME = (rows && rows[0] && rows[0].data) || null; })
      .catch(function () {}).then(done);
    fetch(base + '/rest/v1/site_settings?key=eq.payments&select=data', { headers: h })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) { PAY = (rows && rows[0] && rows[0].data) || null; })
      .catch(function () {}).then(done);
    fetch(base + '/rest/v1/site_settings?key=eq.shopping&select=data', { headers: h })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) {
        var d = rows && rows[0] && rows[0].data;
        if (!d) return;
        for (var k in d) {
          if (Object.prototype.hasOwnProperty.call(d, k) && d[k] !== null && d[k] !== undefined) SHOP[k] = d[k];
        }
      })
      .catch(function () {}).then(done);
    fetch(base + '/rest/v1/site_settings?key=eq.reviews&select=data', { headers: h })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) {
        var d = rows && rows[0] && rows[0].data;
        if (!d) return;
        REVIEW_ROW = true;
        for (var k in d) {
          if (Object.prototype.hasOwnProperty.call(d, k) && d[k] !== null && d[k] !== undefined) {
            REVIEWSET[k] = d[k];
          }
        }
      })
      .catch(function () {}).then(done);
    fetch(base + '/rest/v1/site_settings?key=eq.newsletter&select=data', { headers: h })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) {
        var d = rows && rows[0] && rows[0].data;
        if (!d) return;
        for (var k in d) {
          if (Object.prototype.hasOwnProperty.call(d, k) && d[k] !== null && d[k] !== undefined) {
            NEWSLETTER[k] = d[k];
          }
        }
      })
      .catch(function () {}).then(done);
    fetch(base + '/rest/v1/site_settings?key=eq.customer-care&select=data', { headers: h })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) {
        var d = rows && rows[0] && rows[0].data;
        if (!d) return;
        for (var k in d) {
          if (Object.prototype.hasOwnProperty.call(d, k) && d[k] !== null && d[k] !== undefined) {
            CARESET[k] = d[k];
          }
        }
      })
      .catch(function () {}).then(done);
    fetch(base + '/rest/v1/site_settings?key=eq.seo&select=data', { headers: h })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) {
        var d = rows && rows[0] && rows[0].data;
        if (!d) return;
        for (var k in d) {
          if (Object.prototype.hasOwnProperty.call(d, k) && d[k] !== null && d[k] !== undefined) {
            SEOSET[k] = d[k];
          }
        }
      })
      .catch(function () {}).then(done);
    fetch(base + '/rest/v1/site_settings?key=eq.customer-accounts&select=data', { headers: h })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) {
        var d = rows && rows[0] && rows[0].data;
        if (!d) return;
        for (var k in d) {
          if (Object.prototype.hasOwnProperty.call(d, k) && d[k] !== null && d[k] !== undefined) {
            ACCOUNTS[k] = d[k];
          }
        }
      })
      .catch(function () {}).then(done);
    fetch(base + '/rest/v1/site_settings?key=eq.delivery&select=data', { headers: h })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) {
        var d = rows && rows[0] && rows[0].data;
        if (!d) return;
        for (var k in d) {
          if (Object.prototype.hasOwnProperty.call(d, k) && d[k] !== null && d[k] !== undefined) {
            DELIVERY[k] = d[k];
          }
        }
      })
      .catch(function () {}).then(done);
    fetch(base + '/rest/v1/site_settings?key=eq.pricing&select=data', { headers: h })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) {
        var d = rows && rows[0] && rows[0].data;
        if (!d) return;
        for (var k in d) {
          if (Object.prototype.hasOwnProperty.call(d, k) && d[k] !== null && d[k] !== undefined) {
            PRICING[k] = d[k];
          }
        }
      })
      .catch(function () {}).then(done);
    fetch(base + '/rest/v1/site_settings?key=eq.contact&select=data', { headers: h })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) { CONTACT = (rows && rows[0] && rows[0].data) || null; })
      .catch(function () {}).then(done);
    fetch(base + '/rest/v1/site_settings?key=eq.branding&select=data', { headers: h })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) { BRANDING = (rows && rows[0] && rows[0].data) || null; })
      .catch(function () {}).then(done);
    fetch(base + '/rest/v1/site_settings?key=eq.general&select=data', { headers: h })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) {
        var d = rows && rows[0] && rows[0].data;
        if (!d) return;
        for (var k in d) {
          if (Object.prototype.hasOwnProperty.call(d, k) && d[k] !== null && d[k] !== undefined) {
            SETTINGS[k] = d[k];
          }
        }
      })
      .catch(function () {}).then(done);
  }
  function asArray(v) { if (Array.isArray(v)) return v; try { var a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  // attach per-product photos/flags from the website DB, and drop hidden items
  /* A sale that has been running for months is not news. After the shop's
     chosen number of days the piece keeps its lower price and simply stops
     being advertised as reduced. A missing date is treated as recent,
     because a reduction we cannot date is better shown than hidden. */
  function freshReduction(recordedAt) {
    if (PRICING.trackReductions === false) return false;
    var days = Number(PRICING.reductionDays);
    if (!isFinite(days) || days <= 0) return true;
    if (!recordedAt) return true;
    var t = new Date(recordedAt).getTime();
    if (isNaN(t)) return true;
    return (Date.now() - t) <= days * 86400000;
  }
  function mergeMeta() {
    PRODUCTS = PRODUCTS.map(function (p) {
      var m = META[p.sku];
      if (m) {
        p.image_url = m.image_url || '';
        p.gallery = asArray(m.gallery);
        p.videos = asArray(m.videos);
        p.featured = !!m.featured;
        p.is_new = !!m.is_new;
        p.best_seller = !!m.best_seller;
        p.hidden = !!m.hidden;
        if (m.description) p.customDesc = m.description;

        /* Pricing. The price itself is the POS's and is left alone. What
           the meta adds is only what the POS cannot say: the higher price
           this piece was last seen at, a website price that replaces the
           till's, and whether the figure is shown at all. */
        p.priceOnRequest = !!m.on_request;
        if (m.price_override !== null && m.price_override !== undefined && m.price_override !== '') {
          p.priceOverride = Number(m.price_override) || 0;
        }
        /* A former price sent by the till itself outranks the one the
           admin remembered: it is the shop's own record rather than the
           website's observation. The memory is the fallback for tills that
           do not keep one. */
        var ref = Number(m.ref_price);
        if (!(Number(p.wasPrice) > 0) &&
            isFinite(ref) && ref > 0 && freshReduction(m.ref_price_at)) {
          p.wasPrice = ref;
        }
      }
      return p;
    }).filter(function (p) { return !p.hidden; });
  }
  function boot() {
    FEED_LOADED = true;
    computeCats();
    buildCategoryMenus();
    buildCollections();
    buildHomeRows();
    buildFilters();
    if (reviewsShown()) renderSiteReviews();
    updateWishCount();
    updateCartCount();
    /* Opened before the products landed, the cart said "one moment". They
       have landed, so it can now say what it holds. */
    if (cartOpen()) renderCart();
    bindAccountButton();
    route();
  }
  function catHasProducts(c) {
    var n = String(c || '').trim().toLowerCase();
    return PRODUCTS.some(function (p) { return String(p.category || '').trim().toLowerCase() === n; });
  }
  function computeCats() {
    var fromProducts = [];
    PRODUCTS.forEach(function (p) { if (p.category && fromProducts.indexOf(p.category) === -1) fromProducts.push(p.category); });
    CATEGORIES = fromProducts;
    // Start with the real categories from the POS (these have products), then add
    // any planned categories that are not already present (case-insensitive), so a
    // category that has products is never duplicated or shown as "coming soon".
    var union = fromProducts.slice();
    var base = (Array.isArray(CONTENT.categories) && CONTENT.categories.length) ? CONTENT.categories : MASTER_CATEGORIES;
    base.forEach(function (c) {
      if (!c) return;
      var exists = union.some(function (u) { return String(u).trim().toLowerCase() === String(c).trim().toLowerCase(); });
      if (!exists) union.push(c);
    });
    ALLCATS = union;
  }

  // ------------------------------------------------------------------ category menus
  function buildCategoryMenus() {
    var dd = $('#navCats'), mm = $('#mmCats');
    if (dd) {
      dd.innerHTML = '';
      var all = el('a'); all.textContent = 'All Products'; all.addEventListener('click', function () { goShop('All'); });
      dd.appendChild(all);
      ALLCATS.forEach(function (c) {
        var a = el('a'); a.textContent = c;
        if (!catHasProducts(c)) { a.classList.add('cat-soon'); a.innerHTML = esc(c) + ' <span class="soon">Soon</span>'; }
        a.addEventListener('click', function () { goShop(c); });
        dd.appendChild(a);
      });
    }
    if (mm) {
      ALLCATS.forEach(function (c) {
        var a = el('a'); a.style.fontSize = '20px';
        a.textContent = c;
        if (!catHasProducts(c)) { a.classList.add('cat-soon'); a.innerHTML = esc(c) + ' <span class="soon">Soon</span>'; }
        a.addEventListener('click', function () { closeMobile(); goShop(c); });
        mm.appendChild(a);
      });
    }
  }

  // ------------------------------------------------------------------ collections
  function buildCollections() {
    var host = $('#collections'); if (!host) return;
    host.innerHTML = '';
    ALLCATS.slice(0, 12).forEach(function (c) {
      var has = catHasProducts(c);
      var card = el('a', 'col-card reveal' + (has ? '' : ' col-soon'));
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', c + ' collection');
      var ph = el('div', 'ph fallback');
      preload('/images/collection-' + slug(c) + '.jpg', function (ok) {
        if (ok) { ph.classList.remove('fallback'); ph.style.cssText = bgStyle('/images/collection-' + slug(c) + '.jpg'); }
      });
      var ov = el('div', 'ov');
      ov.innerHTML = '<div class="k">Collection</div><div class="n serif">' + esc(c) + '</div>' +
        (has ? '<div class="go">Explore →</div>' : '<div class="go soon-go">Coming soon</div>');
      card.appendChild(ph); card.appendChild(ov);
      if (!has) { var rib = el('div', 'soon-ribbon'); rib.textContent = 'Coming soon'; card.appendChild(rib); }
      card.addEventListener('click', function () { goShop(c); });
      host.appendChild(card);
    });
    observeReveals();
  }

  // ------------------------------------------------------------------ home rows
  function rowFor(test, limit) {
    var out = [];
    for (var i = 0; i < PRODUCTS.length && out.length < (limit || 10); i++) {
      if (test(PRODUCTS[i])) out.push(PRODUCTS[i]);
    }
    return out;
  }
  function buildHomeRows() {
    var featured = PRODUCTS.filter(function (p) { return p.featured; }).slice(0, 12);
    var best = PRODUCTS.filter(function (p) { return p.best_seller; }).slice(0, 12);
    var newArrivals = PRODUCTS.filter(function (p) { return p.is_new; });
    if (!newArrivals.length) newArrivals = PRODUCTS.slice(0, 10); else newArrivals = newArrivals.slice(0, 12);
    var women = rowFor(function (p) { return /women|ladies/i.test(p.category); }, 10);
    var men = rowFor(function (p) { return /\bmen\b|gent/i.test(p.category) && !/women/i.test(p.category); }, 10);
    var acc = rowFor(function (p) { return /access|bag|jewel|shoe|footwear/i.test(p.category); }, 10);

    fillRow('row-featured', 'sec-featured', featured, false);
    fillRow('row-new', 'sec-new', newArrivals, true);
    fillRow('row-best', 'sec-best', best, false);
    fillRow('row-women', 'sec-women', women, false);
    fillRow('row-men', 'sec-men', men, false);
    fillRow('row-acc', 'sec-acc', acc, false);
  }
  function fillRow(trackId, secId, list, markNew) {
    var track = document.getElementById(trackId);
    var sec = document.getElementById(secId);
    if (!track || !sec) return;
    if (!list.length) { sec.style.display = 'none'; return; }
    sec.style.display = '';
    track.innerHTML = '';
    list.forEach(function (p, i) { track.appendChild(productCard(p, i, markNew)); });
  }

  // ------------------------------------------------------------------ product card
  function productCard(p, idx, markNew) {
    var card = el('div', 'card');
    var attrs = [p.size, p.color, p.material].filter(Boolean).join(' · ');

    var thumb = el('div', 'thumb');
    thumb.addEventListener('click', function () { openProduct(p.sku); });

    var img = el('img', 'primary');
    img.alt = p.name; img.loading = 'lazy';
    attachImgChain(img, p);
    thumb.appendChild(img);
    // secondary image on hover: admin gallery photo, else images/<SKU>-2.jpg
    var sec2 = (p.gallery && p.gallery[0]) ? p.gallery[0] : null;
    if (sec2) {
      var s2 = el('img', 'secondary'); s2.alt = p.name + ' alternate view';
      s2.loading = 'lazy'; s2.src = sec2; thumb.appendChild(s2);
    } else {
      preload('/images/' + p.sku + '-2.jpg', function (ok) {
        if (!ok) return;
        var s = el('img', 'secondary'); s.alt = p.name + ' alternate view';
        s.loading = 'lazy'; s.src = '/images/' + p.sku + '-2.jpg';
        thumb.appendChild(s);
      });
    }

    if (SHOP.showBadges) {
      var badges = el('div', 'badges');
      if (markNew || p.is_new) { var nb = el('span', 'tag new'); nb.textContent = 'New In'; badges.appendChild(nb); }
      /* Reduced pieces say so here rather than under their own switch:
         Settings > Products & Shopping already governs badges. */
      var pv = priceOf(p);
      if (pv.offText && PRICING.percentWhere !== 'inline') {
        var db = el('span', 'tag sale'); db.textContent = pv.offText; badges.appendChild(db);
      } else if (pv.isSale && !pv.offText) {
        var sb0 = el('span', 'tag sale'); sb0.textContent = 'Sale'; badges.appendChild(sb0);
      }
      var sb = el('span', 'tag ' + (p.available ? 'stock' : 'out'));
      /* The feed says whether only a few are left without saying how many. */
      sb.textContent = !p.available ? 'Sold Out'
        : (SHOP.showLowStock && p.lowStock) ? 'Only a few left' : 'In Stock';
      if (p.available && SHOP.showLowStock && p.lowStock) sb.className = 'tag low';
      badges.appendChild(sb);
      thumb.appendChild(badges);
    }

    if (SHOP.wishlist) {
      var wish = el('button', 'wish' + (isWished(p.sku) ? ' active' : ''));
      wish.setAttribute('aria-label', 'Add to wishlist');
      wish.innerHTML = heartIcon();
      wish.addEventListener('click', function (e) { e.stopPropagation(); toggleWish(p.sku, wish); });
      thumb.appendChild(wish);
    }

    var quick = el('button', 'quick'); quick.textContent = 'Quick View';
    quick.addEventListener('click', function (e) { e.stopPropagation(); openQuickView(p.sku); });
    thumb.appendChild(quick);

    var info = el('div', 'card-info');
    info.innerHTML =
      (SHOP.showCategory ? '<div class="c">' + esc(p.category) + '</div>' : '') +
      '<div class="n serif"></div>' +
      '<div class="a">' + esc(attrs) + '</div>' +
      priceHtml(p);
    var nm = info.querySelector('.n'); nm.textContent = p.name;
    nm.addEventListener('click', function () { openProduct(p.sku); });

    /* A piece carries a button when it can be bought, or when it is sold
       out and enquiries are on. With neither there is nothing useful for
       one to do. */
    if (canBuy(p) || canAsk(p)) {
      var waLine = el('div', 'wa-line');
      var wa = el('a', 'btn btn-wa');
      wa.href = waLink(p); wa.target = '_blank'; wa.rel = 'noopener';
      wa.innerHTML = waIcon() + (canBuy(p) ? checkoutLabel() : askLabel(p, false));
      if (canBuy(p)) wa.addEventListener('click', function (e) { startOrder(e, p); });
      waLine.appendChild(wa);
      /* Beneath the buy button, not instead of it. A piece that can be
         bought can also be gathered for later; one that can only be asked
         about has nothing to gather. */
      if (canBuy(p)) waLine.appendChild(cartButton(p));
      info.appendChild(waLine);
    }

    card.appendChild(thumb); card.appendChild(info);
    return card;
  }

  // ------------------------------------------------------------------ wishlist
  function bindAccountButton() {
    var b = $('#acctBtn');
    if (b) b.addEventListener('click', function () { go('account'); });
  }
  function isWished(sku) { return wishlist.indexOf(sku) > -1; }
  function toggleWish(sku, btn) {
    var i = wishlist.indexOf(sku);
    if (i > -1) wishlist.splice(i, 1); else wishlist.push(sku);
    saveWishlist(); updateWishCount();
    if (btn) btn.classList.toggle('active', isWished(sku));
    if (mode === 'wishlist') renderGrid();
  }
  function updateWishCount() {
    var c = $('#wishCount'); if (!c) return;
    c.textContent = wishlist.length;
    c.style.display = wishlist.length ? 'flex' : 'none';
  }


  // ---------------------------------------------------------------------- cart
  /* Pieces a customer has gathered, before they say a word to the shop.
     It is a list held in this browser: nothing is reserved, no stock is
     deducted and the POS never hears about it, because a cart is not an
     order. Checkout is still WhatsApp, unchanged and still one piece at a
     time; this is the step in front of it.

     Only the SKU and the quantity are kept. Names, prices and photos are
     read from the live feed every time the cart is drawn, so a piece that
     changed price overnight can never be shown at yesterday's figure. The
     name is stored beside them as a label of last resort, and used for
     one thing only: saying which piece has since left the shop. */

  function parseCart(s) {
    var raw;
    try { raw = s ? JSON.parse(s) : []; } catch (e) { return []; }
    if (!Array.isArray(raw)) return [];
    var seen = {}, out = [];
    raw.forEach(function (it) {
      if (!it || typeof it !== 'object') return;
      var sku = String(it.sku == null ? '' : it.sku);
      /* One line per piece. Two lines for the same SKU would be two
         answers to "how many of these do you want". */
      if (!sku || seen[sku]) return;
      seen[sku] = 1;
      out.push({ sku: sku, qty: clampQty(it.qty), name: String(it.name == null ? '' : it.name) });
    });
    return out;
  }
  function clampQty(n) {
    n = Math.floor(Number(n));
    if (!isFinite(n) || n < 1) return 1;
    return n > CART_MAX ? CART_MAX : n;
  }
  function saveCart() { store.set(CART_MEMO, JSON.stringify(cart)); }
  function cartLine(sku) {
    for (var i = 0; i < cart.length; i++) if (cart[i].sku === sku) return cart[i];
    return null;
  }
  function cartQty(sku) { var l = cartLine(sku); return l ? l.qty : 0; }
  function cartCount() {
    var n = 0;
    cart.forEach(function (l) { n += l.qty; });
    return n;
  }

  /* Everything the cart needs to know about one line, worked out against
     the feed as it stands now. A piece that has sold out, or left the shop
     altogether, stays in the cart and says so rather than disappearing:
     silently emptying somebody's cart is worse than telling them. */
  function cartRows() {
    return cart.map(function (line) {
      var p = bySku(line.sku);
      var view = p ? priceOf(p) : null;
      var priced = !!(p && p.available && view && !view.onRequest);
      return {
        line: line,
        product: p,
        name: (p && p.name) || line.name || line.sku,
        gone: !p,
        soldOut: !!p && !p.available,
        priced: priced,
        unit: priced ? view.now : 0,
        unitText: priced ? view.nowText : '',
        sub: priced ? view.now * line.qty : 0
      };
    });
  }
  function cartTotal() {
    var t = 0;
    cartRows().forEach(function (r) { if (r.priced) t += r.sub; });
    return t;
  }

  function addToCart(p, btn) {
    /* The same rule the buy button follows. A piece that cannot be bought
       cannot be gathered either, so nothing reaches the cart that the shop
       would then have to explain. */
    if (!p || !canBuy(p)) return;
    var line = cartLine(p.sku);
    if (line) {
      if (line.qty >= CART_MAX) { flashCartBtn(btn, 'That is the most we can add'); return; }
      line.qty = clampQty(line.qty + 1);
      line.name = p.name;
    } else {
      cart.push({ sku: p.sku, qty: 1, name: p.name });
    }
    saveCart();
    afterCartChange();
    flashCartBtn(btn, 'Added');
    bumpCartIcon();
  }
  function setCartQty(sku, qty) {
    var line = cartLine(sku);
    if (!line) return;
    line.qty = clampQty(qty);
    saveCart();
    afterCartChange();
  }
  function removeFromCart(sku) {
    cart = cart.filter(function (l) { return l.sku !== sku; });
    saveCart();
    afterCartChange();
  }
  /* One place for what has to happen after the cart moves, so a count, a
     button and an open panel can never end up telling three stories. */
  function afterCartChange() {
    updateCartCount();
    syncCartButtons();
    if (!cartOpen()) return;
    /* The panel is redrawn whole, which on its own would drop the keyboard
       back to the top of the page on every tap. Whoever was on the plus
       button is put back on it. */
    var keep = focusedCartControl();
    renderCart();
    restoreCartFocus(keep);
  }
  function focusedCartControl() {
    var node = document.activeElement;
    if (!node || !node.getAttribute) return null;
    var names = ['data-inc', 'data-dec', 'data-rm'];
    for (var i = 0; i < names.length; i++) {
      var v = node.getAttribute(names[i]);
      if (v != null) return { attr: names[i], sku: v };
    }
    return null;
  }
  function restoreCartFocus(keep) {
    if (!keep) return;
    var body = $('#cartBody');
    if (!body) return;
    var line = body.querySelector('.cart-line[data-sku="' + cssEsc(keep.sku) + '"]');
    var b = line && line.querySelector('[' + keep.attr + ']');
    if (b && !b.disabled) { b.focus(); return; }
    /* The button can disable itself under the finger — the minus that
       reached one — and the line can be gone altogether. Fall back to the
       nearest control that still exists, then to the way out. */
    var alt = line && line.querySelector('.qty-btn:not(:disabled), .cart-rm');
    if (alt) { alt.focus(); return; }
    var c = $('#ctClose', body);
    if (c) c.focus();
  }

  function updateCartCount() {
    var n = cartCount();
    var c = $('#cartCount');
    if (c) {
      c.textContent = n;
      c.style.display = n ? 'flex' : 'none';
    }
    /* The badge is a number with no word beside it. Read aloud it would be
       "cart, 3"; this says what the 3 is. */
    var b = $('#cartBtn');
    if (b) b.setAttribute('aria-label', n ? 'Cart, ' + n + (n === 1 ? ' item' : ' items') : 'Cart');
  }
  /* The icon acknowledges the tap, for the customer who added from the
     bottom of a long page and never saw the header. */
  function bumpCartIcon() {
    var b = $('#cartBtn');
    if (!b) return;
    b.classList.remove('bump');
    void b.offsetWidth;
    b.classList.add('bump');
  }

  // ------------------------------------------------------------- cart buttons
  function bagIcon() {
    return "<svg viewBox='0 0 24 24' aria-hidden='true' fill='none' stroke='currentColor' " +
      "stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'>" +
      "<path d='M6.4 7h13.2l-1.5 10.4a2 2 0 01-2 1.6H9.9a2 2 0 01-2-1.6z'/>" +
      "<path d='M9.2 7V5.6a2.8 2.8 0 015.6 0V7'/></svg>";
  }
  function tickIcon() {
    return "<svg viewBox='0 0 24 24' aria-hidden='true' fill='none' stroke='currentColor' " +
      "stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>" +
      "<polyline points='20 6 9 17 4 12'/></svg>";
  }
  /* What an add-to-cart button says depends on what the cart already
     holds, so it is written here rather than at each of the three places
     one is drawn. */
  function paintCartBtn(btn) {
    var n = cartQty(btn.getAttribute('data-cart-sku'));
    btn.innerHTML = bagIcon() + (n ? 'In cart · ' + n : 'Add to cart');
    btn.setAttribute('aria-label', n ? 'In your cart, ' + n + '. Add another' : 'Add to cart');
    btn.classList.toggle('in-cart', !!n);
  }
  function cartButton(p) {
    var b = el('button', 'btn btn-outline btn-cart');
    b.type = 'button';
    b.setAttribute('data-cart-sku', p.sku);
    paintCartBtn(b);
    b.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      addToCart(p, b);
    });
    return b;
  }
  /* A tap has to be seen to have worked, and on a phone the header badge
     is often off screen. The button says so itself for a moment, then goes
     back to saying what the cart now holds. */
  function flashCartBtn(btn, word) {
    if (!btn) return;
    btn.classList.add('is-flash');
    btn.innerHTML = tickIcon() + esc(word);
    clearTimeout(btn._cartFlash);
    btn._cartFlash = setTimeout(function () {
      btn.classList.remove('is-flash');
      paintCartBtn(btn);
    }, 1500);
  }
  /* Every add-to-cart button on the page, brought back into line after the
     cart changes anywhere else — including from inside the cart itself. A
     button mid-flash is left alone and repaints when its moment is up. */
  function syncCartButtons() {
    $all('[data-cart-sku]').forEach(function (b) {
      if (!b.classList.contains('is-flash')) paintCartBtn(b);
    });
  }

  // --------------------------------------------------------------- cart panel
  function cartOpen() {
    var m = $('#cartModal');
    return !!m && m.classList.contains('open');
  }
  function openCart() {
    var m = $('#cartModal');
    if (!m) return;
    renderCart();
    m.classList.add('open');
    document.body.style.overflow = 'hidden';
    var c = $('#ctClose');
    if (c) setTimeout(function () { c.focus(); }, 60);
  }
  function closeCart() {
    var m = $('#cartModal');
    if (m) m.classList.remove('open');
    document.body.style.overflow = '';
  }

  function renderCart() {
    var body = $('#cartBody');
    if (!body) return;

    var head =
      '<button class="qv-close" id="ctClose" aria-label="Close">&times;</button>' +
      '<div class="c">Your selection</div>' +
      '<h3 class="serif">Your cart</h3>';

    if (!cart.length) {
      body.innerHTML = head +
        '<p class="od-lead">Nothing here yet. Add a piece and it will wait for you, ' +
        'on this device, until you are ready.</p>' +
        '<div class="rv-actions"><button class="btn btn-gold" id="ctShop">Browse the collection</button></div>';
      bindCartChrome(body);
      return;
    }

    /* Opened before the feed has answered. The lines are known, their
       prices are not, and inventing either would be worse than a pause. */
    if (!FEED_LOADED) {
      body.innerHTML = head +
        '<p class="od-lead">One moment — fetching today\u2019s prices.</p>';
      bindCartChrome(body);
      return;
    }

    var rows = cartRows();
    var n = cartCount();
    var unbuyable = rows.filter(function (r) { return !r.priced; }).length;
    /* Whether there is an order to send at all: at least one line the shop
       can still sell, and a shop still taking orders. */
    var sendable = rows.length > unbuyable && SHOP.whatsappCheckout !== false;

    body.innerHTML = head +
      '<p class="od-lead">' + n + (n === 1 ? ' item' : ' items') +
        '. Nothing is reserved: your pieces are held here on this device only.</p>' +
      '<div class="cart-lines">' +
        rows.map(cartLineHtml).join('') +
      '</div>' +
      '<div class="cart-foot">' +
        '<div class="cart-total"><span>Total</span><span class="serif" id="ctTotal">' +
          esc(formatPrice(cartTotal())) + '</span></div>' +
        (taxLineText() ? '<div class="cart-tax">' + esc(taxLineText()) + '</div>' : '') +
        (unbuyable
          ? '<div class="cart-warn">' +
              (unbuyable === 1
                ? 'One piece is no longer available and is not counted in the total' +
                  (sendable ? ' or sent.' : '.')
                : unbuyable + ' pieces are no longer available and are not counted in the total' +
                  (sendable ? ' or sent.' : '.')) +
            '</div>'
          : '') +
        /* Nothing to send is not an error to explain after the fact: the
           button is simply not there, and the line says what is missing. */
        (sendable
          ? '<div class="cart-actions">' +
              '<button class="btn btn-wa" id="ctGo">' + waIcon() + 'Checkout via WhatsApp</button>' +
              '<button class="btn btn-outline" id="ctShop">Continue shopping</button>' +
            '</div>' +
            '<p class="cart-note">Your whole cart goes across in one message, ' +
              'and we carry on from there. Nothing is paid on this site.</p>'
          : '<p class="cart-note">Nothing here can be ordered at the moment. ' +
              'Remove what has sold out, or add a piece that is in stock.</p>' +
            '<div class="cart-actions">' +
              '<button class="btn btn-gold" id="ctShop">Continue shopping</button>' +
            '</div>') +
      '</div>';

    bindCartChrome(body);
    bindCartLines(body);

    /* Only the photos this page has not worked out yet. The ones it has
       are already in the markup above; asking for them again is what made
       the thumbnails blink on every tap. A piece with no photo of its own
       gets the same stand-in the cards use. */
    rows.forEach(function (r) {
      if (!r.product || CART_IMG[r.line.sku]) return;
      resolvePrimary(r.product, function (src) {
        CART_IMG[r.line.sku] = src;
        var t = body.querySelector('.cart-line[data-sku="' + cssEsc(r.line.sku) + '"] .cart-thumb');
        if (t) t.innerHTML = cartThumbImg(src);
      });
    });
  }

  /* Quotes and backslashes inside a SKU would break out of the attribute
     selector above. Nothing in the feed looks like that today, but a SKU
     is typed by a person at a till. */
  function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }

  function taxLineText() {
    return (FMT && FMT.taxLine) ? FMT.taxLine(PRICING) : '';
  }

  function cartLineHtml(r) {
    var sku = r.line.sku;
    /* Settings-sourced wording can reach this line, so it is built as
       plain text and escaped once on the way in. */
    var status = r.gone ? 'No longer in the collection'
               : r.soldOut ? 'Sold out'
               : !r.priced ? (PRICING.onRequestText || 'Price on request')
               : r.unitText + ' each';
    return '<div class="cart-line' + (r.priced ? '' : ' is-off') + '" data-sku="' + esc(sku) + '">' +
      '<div class="cart-thumb">' + (CART_IMG[sku] ? cartThumbImg(CART_IMG[sku]) : '') + '</div>' +
      '<div class="cart-meta">' +
        '<div class="cart-name serif">' + esc(r.name) + '</div>' +
        '<div class="cart-unit">' + esc(status) + '</div>' +
        '<div class="cart-qty">' +
          '<button type="button" class="qty-btn" data-dec="' + esc(sku) + '"' +
            (r.line.qty <= 1 ? ' disabled' : '') +
            ' aria-label="One fewer ' + esc(r.name) + '">&minus;</button>' +
          '<span class="qty-n" aria-live="polite">' + r.line.qty + '</span>' +
          '<button type="button" class="qty-btn" data-inc="' + esc(sku) + '"' +
            (r.line.qty >= CART_MAX ? ' disabled' : '') +
            ' aria-label="One more ' + esc(r.name) + '">+</button>' +
          '<button type="button" class="cart-rm" data-rm="' + esc(sku) + '"' +
            ' aria-label="Remove ' + esc(r.name) + ' from your cart">Remove</button>' +
        '</div>' +
      '</div>' +
      '<div class="cart-sub serif">' + (r.priced ? esc(formatPrice(r.sub)) : '&mdash;') + '</div>' +
    '</div>';
  }

  /* The name is already beside it, so the photo is decoration and is left
     unnamed rather than read out twice. */
  function cartThumbImg(src) { return '<img alt="" src="' + esc(src) + '">'; }

  function bindCartChrome(body) {
    var c = $('#ctClose', body);
    if (c) c.addEventListener('click', closeCart);
    var s = $('#ctShop', body);
    if (s) s.addEventListener('click', function () { closeCart(); goShop('All'); });
    var g = $('#ctGo', body);
    if (g) g.addEventListener('click', startCartCheckout);
  }
  function bindCartLines(body) {
    $all('[data-inc]', body).forEach(function (b) {
      b.addEventListener('click', function () {
        var sku = b.getAttribute('data-inc');
        setCartQty(sku, cartQty(sku) + 1);
      });
    });
    $all('[data-dec]', body).forEach(function (b) {
      b.addEventListener('click', function () {
        var sku = b.getAttribute('data-dec');
        /* One is the floor. Removing is its own button, so that a customer
           tapping minus quickly cannot delete a line by overshooting. */
        if (cartQty(sku) > 1) setCartQty(sku, cartQty(sku) - 1);
      });
    });
    $all('[data-rm]', body).forEach(function (b) {
      b.addEventListener('click', function () { removeFromCart(b.getAttribute('data-rm')); });
    });
  }

  // ------------------------------------------------------------------ shop grid
  function currentList() {
    var term = searchTerm.toLowerCase().trim();
    var list = PRODUCTS.filter(function (p) {
      if (mode === 'wishlist' && !isWished(p.sku)) return false;
      var catOk = filterCat === 'All' || p.category === filterCat;
      if (filterColor !== 'All' && (p.color || '') !== filterColor) return false;
      if (filterSize !== 'All' && (p.size || '') !== filterSize) return false;
      if (inStockOnly && !p.available) return false;
      if (!SHOP.showOutOfStock && !p.available) return false;
      var s = !term ||
        (p.name && p.name.toLowerCase().indexOf(term) > -1) ||
        (p.sku && p.sku.toLowerCase().indexOf(term) > -1) ||
        (p.category && p.category.toLowerCase().indexOf(term) > -1) ||
        (p.color && p.color.toLowerCase().indexOf(term) > -1) ||
        (p.material && p.material.toLowerCase().indexOf(term) > -1);
      return catOk && s;
    });
    /* Sort by what a piece actually costs today, not what the till holds:
       a reduced piece belongs where its reduced price puts it. A piece with
       no price shown sorts last either way, having no figure to place. */
    if (sortBy === 'price-asc') {
      list.sort(function (a, b) { return sortPrice(a, Infinity) - sortPrice(b, Infinity); });
    } else if (sortBy === 'price-desc') {
      list.sort(function (a, b) { return sortPrice(b, -Infinity) - sortPrice(a, -Infinity); });
    }
    else if (sortBy === 'name') list.sort(function (a, b) { return a.name.localeCompare(b.name); });
    else if (sortBy === 'available') list.sort(function (a, b) { return (b.available ? 1 : 0) - (a.available ? 1 : 0); });
    return list;
  }
  function renderChips() {
    var host = $('#chips'); if (!host) return;
    var cats = ['All'].concat(ALLCATS);
    host.innerHTML = '';
    cats.forEach(function (c) {
      var isSoon = c !== 'All' && !catHasProducts(c);
      var b = el('button', 'chip' + (c === filterCat && mode !== 'wishlist' ? ' active' : '') + (isSoon ? ' chip-soon' : ''));
      b.textContent = c;
      b.addEventListener('click', function () { mode = 'shop'; filterCat = c; updateShopTitle(); renderChips(); renderGrid(); });
      host.appendChild(b);
    });
  }
  function updateShopTitle() {
    var t = $('#shopTitle'); if (!t) return;
    if (mode === 'wishlist') t.textContent = 'Your Wishlist';
    else t.textContent = filterCat === 'All' ? 'The Collection' : filterCat;
  }
  function renderGrid() {
    var grid = $('#grid'), empty = $('#shopEmpty'), count = $('#resultCount');
    if (!grid) return;
    var list = currentList();
    if (count) count.textContent = list.length + (list.length === 1 ? ' piece' : ' pieces');
    if (!list.length) {
      grid.innerHTML = '';
      if (empty) {
        empty.style.display = 'block';
        if (mode === 'wishlist') {
          empty.innerHTML = '<span class="serif">Your wishlist is empty</span>Tap the heart on any piece to save it here.';
        } else if (filterCat !== 'All' && !catHasProducts(filterCat)) {
          empty.innerHTML = '<span class="serif">Coming soon</span>New pieces in ' + esc(filterCat) +
            ' are arriving shortly. Message us to be the first to know.' +
            '<div style="margin-top:18px"><a class="btn btn-wa" target="_blank" rel="noopener" href="' +
            waGeneral('please let me know when ' + filterCat + ' is available.') +
            '">Notify me on WhatsApp</a></div>';
        } else if (!PRODUCTS.length) {
          /* Not a search that found nothing: there is nothing to search. */
          empty.innerHTML = '<span class="serif">The collection is on its way</span>' +
            'New pieces are being added. Message us and we will let you know the moment they land.' +
            '<div style="margin-top:18px"><a class="btn btn-wa" target="_blank" rel="noopener" href="' +
            waGeneral('please let me know when new pieces arrive.') +
            '">' + waIcon() + 'Tell me when</a></div>';
        } else {
          empty.innerHTML = '<span class="serif">Nothing here yet</span>No pieces match your search. Try another category.';
        }
      }
      return;
    }
    if (empty) empty.style.display = 'none';
    grid.innerHTML = '';
    list.forEach(function (p, i) { grid.appendChild(productCard(p, i, false)); });
  }

  // ------------------------------------------------------------------ quick view
  function openQuickView(sku) {
    var p = bySku(sku); if (!p) return;
    var modal = $('#qv'); var body = $('#qvBody'); var imgWrap = $('#qvImg');
    resolvePrimary(p, function (src) { imgWrap.innerHTML = '<img alt="' + esc(p.name) + '" src="' + src + '">'; });
    var attrs = [
      SHOP.showCategory ? ['Category', p.category] : null,
      ['Size', p.size], ['Colour', p.color], ['Material', p.material]
    ].filter(function (r) { return r && r[1]; });
    body.innerHTML =
      '<button class="qv-close" aria-label="Close">&times;</button>' +
      (SHOP.showCategory ? '<div class="c">' + esc(p.category) + '</div>' : '') +
      '<h3 class="serif">' + esc(p.name) + '</h3>' +
      priceHtml(p, 'p serif') +
      taxHtml() +
      '<div class="meta">' + attrs.map(function (r) { return '<div><b style="color:#15202e">' + esc(r[0]) + ':</b> ' + esc(r[1]) + '</div>'; }).join('') +
      '<div style="margin-top:6px">' +
        (p.available
          ? ((SHOP.showLowStock && p.lowStock) ? 'In stock — only a few left' : 'In stock')
          : 'Sold out') + '</div></div>' +
      '<div class="detail-cta" style="max-width:none">' +
      ((canBuy(p) || canAsk(p))
        ? '<a class="btn btn-wa" id="qvBuy" target="_blank" rel="noopener" href="' + waLink(p) + '">' +
          waIcon() + (canBuy(p) ? checkoutLabel() : askLabel(p, true)) + '</a>'
        : '') +
      '<span id="qvCartSlot"></span>' +
      '<button class="btn btn-outline" id="qvFull">View full details</button></div>';
    body.querySelector('.qv-close').addEventListener('click', closeQuickView);
    /* The quick view keeps the modal open after an add: the point of it is
       looking at several pieces without leaving the grid. */
    var qcs = body.querySelector('#qvCartSlot');
    if (qcs && canBuy(p)) qcs.parentNode.replaceChild(cartButton(p), qcs);
    else if (qcs) qcs.parentNode.removeChild(qcs);
    var qb = body.querySelector('#qvBuy');
    if (qb && canBuy(p)) qb.addEventListener('click', function (e) {
      closeQuickView();
      startOrder(e, p);
    });
    body.querySelector('#qvFull').addEventListener('click', function () { closeQuickView(); openProduct(sku); });
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeQuickView() { $('#qv').classList.remove('open'); document.body.style.overflow = ''; }

  // ------------------------------------------------------------------ product detail
  function openProduct(sku) { go('product/' + encodeURIComponent(sku)); }
  function pushRecent(sku) {
    recent = recent.filter(function (s) { return s !== sku; });
    recent.unshift(sku);
    if (recent.length > 10) recent = recent.slice(0, 10);
    saveRecent();
  }
  function renderDetail(sku) {
    var p = bySku(sku); var host = $('#view-detail');
    if (!p) { goShop('All'); return; }
    pushRecent(sku);

    var specs = [
      SHOP.showCategory ? ['Category', p.category] : null,
      SHOP.showSku ? ['SKU', p.sku] : null,
      ['Size', p.size], ['Colour', p.color], ['Material', p.material]
    ].filter(function (r) { return r && r[1]; });
    var related = PRODUCTS.filter(function (x) { return x.category === p.category && x.sku !== p.sku; }).slice(0, 4);
    var recentItems = recent.map(bySku).filter(function (x) { return x && x.sku !== p.sku; }).slice(0, 4);
    var desc = p.customDesc || buildDescription(p);
    var prList = reviewsFor(p.sku);

    host.innerHTML =
      '<div class="wrap">' +
      '<div class="crumbs"><a data-home>Home</a> / <a data-shop>Shop</a> / ' + esc(p.category) + '</div>' +
      '<div class="detail-grid">' +
      '<div class="gallery"><div class="gallery-main" id="galMain"><img id="galImg" alt="' + esc(p.name) + '"><button class="gal-nav prev" id="galPrev" type="button" aria-label="Previous image"><svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg></button><button class="gal-nav next" id="galNext" type="button" aria-label="Next image"><svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg></button><div class="gal-count" id="galCount"></div></div>' +
      '<div class="gallery-thumbs" id="galThumbs"></div></div>' +
      '<div class="detail-info">' +
      (SHOP.showCategory ? '<div class="eyebrow">' + esc(p.category) + '</div>' : '') +
      '<h1 class="serif">' + esc(p.name) + '</h1>' +
      priceHtml(p, 'detail-price serif') +
      taxHtml() +
      ((ratingsShown() && prList.length) ? '<div class="detail-rating">' + starsHtml(avgRating(prList)) + ' <a class="rating-link" id="ratingLink">' + avgRating(prList).toFixed(1) + ' (' + prList.length + ' review' + (prList.length > 1 ? 's' : '') + ')</a></div>' : '') +
      '<p class="desc">' + esc(desc) + '</p>' +
      (p.size ? '<div class="opt-block"><div class="lbl">Size</div><span class="opt-chip">' + esc(p.size) + '</span></div>' : '') +
      (p.color ? '<div class="opt-block"><div class="lbl">Colour</div><span class="opt-chip">' + esc(p.color) + '</span></div>' : '') +
      '<div class="avail-line ' + (p.available ? '' : 'out') + '"><span class="dot"></span>' +
        (p.available
          ? ((SHOP.showLowStock && p.lowStock) ? 'In stock — only a few left' : 'In stock — ready to order')
          : 'Currently sold out') + '</div>' +
      '<div class="detail-cta">' +
      ((canBuy(p) || canAsk(p))
        ? '<a class="btn btn-wa" id="buyDetail" target="_blank" rel="noopener" href="' + waLink(p) + '">' +
          waIcon() + (canBuy(p) ? checkoutLabel() : askLabel(p, true)) + '</a>'
        : '') +
      (canBuy(p) ? '<span id="cartSlot"></span>' : '') +
      (SHOP.wishlist
        ? '<button class="btn btn-outline" id="wishDetail">' +
          (isWished(p.sku) ? 'Saved to wishlist' : 'Add to wishlist') + '</button>'
        : '') +
      (SHOP.sharing
        ? '<button class="btn btn-outline" id="shareDetail">' + shareIcon() + 'Share</button>'
        : '') +
      '</div>' +
      accordion(specs) +
      '</div></div>' +
      ((p.videos && p.videos.length) ? '<div class="prod-videos"><div class="eyebrow">Watch</div><div class="pv-grid">' + p.videos.slice(0, 2).map(function (u) { return '<video controls preload="metadata" playsinline src="' + esc(u) + '"></video>'; }).join('') + '</div></div>' : '') +
      (reviewsShown() ? '<div id="prodReviews" class="prod-reviews"></div>' : '') +
      (related.length ? relatedBlock('You may also like', 'More in ' + p.category, 'relGrid') : '') +
      (recentItems.length ? relatedBlock('Recently viewed', 'Pieces you looked at', 'recGrid') : '') +
      '</div>';

    // gallery
    resolvePrimary(p, function (primSrc) {
      var list = [primSrc];
      (p.gallery || []).forEach(function (u) { if (u && list.indexOf(u) < 0) list.push(u); });
      var extra = [null, null, null];
      var pend = 3;
      ['-2', '-3', '-4'].forEach(function (suf, k) {
        preload('/images/' + p.sku + suf + '.jpg', function (ok) {
          if (ok) { var u = '/images/' + p.sku + suf + '.jpg'; if (list.indexOf(u) < 0) extra[k] = u; }
          if (--pend === 0) setupGallery(list.concat(extra.filter(Boolean)));
        });
      });
      if (pend === 0) setupGallery(list);
    });

    // crumbs + wishlist + related
    host.querySelector('[data-home]').addEventListener('click', goHome);
    host.querySelector('[data-shop]').addEventListener('click', function () { goShop('All'); });
    /* These two are only drawn when their setting is on, so neither is
       guaranteed to be here. */
    var wd = $('#wishDetail');
    if (wd) wd.addEventListener('click', function () {
      toggleWish(p.sku);
      wd.textContent = isWished(p.sku) ? 'Saved to wishlist' : 'Add to wishlist';
    });
    var sd = $('#shareDetail');
    if (sd) sd.addEventListener('click', function () { shareProduct(p, sd); });
    var bd = $('#buyDetail');
    if (bd && canBuy(p)) bd.addEventListener('click', function (e) { startOrder(e, p); });
    var cs = $('#cartSlot', host);
    if (cs) cs.parentNode.replaceChild(cartButton(p), cs);
    setupAccordion(host);
    if (related.length) { var rg = $('#relGrid'); related.forEach(function (rp, i) { rg.appendChild(productCard(rp, i, false)); }); }
    if (recentItems.length) { var cg = $('#recGrid'); recentItems.forEach(function (rp, i) { cg.appendChild(productCard(rp, i, false)); }); }
    if (reviewsShown()) renderProductReviews(p.sku);
    var rl = $('#ratingLink'); if (rl) rl.addEventListener('click', function () { var t = $('#prodReviews'); if (t) t.scrollIntoView({ behavior: 'smooth' }); });

    showView('detail');
    window.scrollTo(0, 0);
  }
  function setupGallery(srcs) {
    var galImg = $('#galImg'), main = $('#galMain'), thumbs = $('#galThumbs');
    var prev = $('#galPrev'), next = $('#galNext'), count = $('#galCount');
    if (!galImg || !srcs.length) return;
    var i = 0, multi = srcs.length > 1;
    function show(n) {
      i = (n + srcs.length) % srcs.length;
      galImg.src = srcs[i];
      if (thumbs) $all('#galThumbs button').forEach(function (x, k) { x.classList.toggle('active', k === i); });
      if (count) count.textContent = (i + 1) + ' / ' + srcs.length;
    }
    if (thumbs) {
      if (!multi) { thumbs.style.display = 'none'; }
      else {
        thumbs.style.display = ''; thumbs.innerHTML = '';
        srcs.forEach(function (s, k) {
          var b = el('button', k === 0 ? 'active' : '');
          b.setAttribute('aria-label', 'View image ' + (k + 1));
          b.innerHTML = '<img src="' + s + '" alt="">';
          b.addEventListener('click', function () { show(k); });
          thumbs.appendChild(b);
        });
      }
    }
    if (prev) { prev.style.display = multi ? '' : 'none'; prev.onclick = function (e) { e.stopPropagation(); show(i - 1); }; }
    if (next) { next.style.display = multi ? '' : 'none'; next.onclick = function (e) { e.stopPropagation(); show(i + 1); }; }
    if (count) count.style.display = multi ? '' : 'none';
    // swipe on touch devices
    var sx = 0, sdx = 0;
    main.ontouchstart = function (e) { sx = e.touches[0].clientX; sdx = 0; };
    main.ontouchmove = function (e) { sdx = e.touches[0].clientX - sx; };
    main.ontouchend = function () { if (multi && Math.abs(sdx) > 40) show(sdx < 0 ? i + 1 : i - 1); };
    // click the image (not the arrows) to zoom
    galImg.onclick = function () { openLightbox(galImg.src); };
    show(0);
  }
  function relatedBlock(eyebrow, title, gridId) {
    return '<div style="margin-top:70px"><div class="section-head" style="text-align:left;margin:0 0 28px;max-width:none">' +
      '<div class="eyebrow">' + esc(eyebrow) + '</div><h2 class="serif" style="font-size:clamp(26px,3.6vw,38px)">' + esc(title) + '</h2></div>' +
      '<div class="grid" id="' + gridId + '"></div></div>';
  }
  function buildDescription(p) {
    var bits = [];
    if (p.material) bits.push('crafted in ' + p.material.toLowerCase());
    if (p.color) bits.push('finished in ' + p.color.toLowerCase());
    var tail = bits.length ? ', ' + bits.join(' and ') + '.' : '.';
    /* The closing sentence used to promise nationwide delivery and
       collection whatever the shop actually offered. */
    var how = deliversAnywhere() && collectsInPerson() ? 'delivery or collection'
            : deliversAnywhere() ? 'delivery'
            : collectsInPerson() ? 'collection' : '';
    var close = how
      ? ' To purchase, arrange payment and ' + how + ' directly with us on WhatsApp.'
      : ' To purchase, message us on WhatsApp.';
    /* The shop's own name, not the one this file was written for. A
       rebrand changes the setting and everything follows; it used to
       leave the old name sitting in every product description. */
    return 'A considered piece from the ' + shopName() + ' edit' + tail +
      ' Thoughtfully selected for quality and quiet sophistication.' + close;
  }
  function accordion(specs) {
    return '<div class="accordion">' +
      accItem('Product details',
        '<table class="spec-table">' + specs.map(function (r) {
          return '<tr><td class="l">' + esc(r[0]) + '</td><td class="r">' + esc(r[1]) + '</td></tr>';
        }).join('') + '</table>') +
      /* Was a paragraph typed into this file, naming the areas, the
         charging and the collection offer. It is Settings > Delivery &
         Collection's to say now, and the panel disappears entirely for a
         shop that offers neither. */
      (deliveryPanelHtml()
        ? accItem(deliveryPanelTitle(), deliveryPanelHtml())
        : '') +
      accItem('Returns & assistance',
        'If something is not right, message us on WhatsApp within a reasonable time of receipt and we will make it right. Our team is happy to advise on sizing, fit and styling before you buy.') +
      '</div>';
  }
  /* A panel called "Delivery & collection" on a shop that only collects
     is a small lie in a heading. */
  function deliveryPanelTitle() {
    if (deliversAnywhere() && collectsInPerson()) return 'Delivery & collection';
    if (deliversAnywhere()) return 'Delivery';
    return 'Collection';
  }
  function accItem(title, inner) {
    return '<div class="acc-item"><button class="acc-head">' + esc(title) +
      '<span class="pm">+</span></button><div class="acc-body"><div class="inner">' + inner + '</div></div></div>';
  }
  function setupAccordion(root) {
    $all('.acc-head', root).forEach(function (h) {
      h.addEventListener('click', function () {
        var item = h.parentElement; var body = h.nextElementSibling;
        var open = item.classList.toggle('open');
        body.style.maxHeight = open ? body.firstElementChild.scrollHeight + 30 + 'px' : '0px';
      });
    });
    // open the first by default
    var first = $('.acc-item', root);
    if (first) { first.classList.add('open'); var b = $('.acc-body', first); b.style.maxHeight = b.firstElementChild.scrollHeight + 30 + 'px'; }
  }

  // ------------------------------------------------------------------ lightbox
  function openLightbox(src) {
    var lb = $('#lightbox'); $('#lbImg').src = src; lb.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeLightbox() { $('#lightbox').classList.remove('open'); document.body.style.overflow = ''; }

  // ------------------------------------------------------------------ views + routing
  function showView(which) {
    $('#view-home').style.display = which === 'home' ? 'block' : 'none';
    $('#view-shop').style.display = which === 'shop' ? 'block' : 'none';
    $('#view-detail').style.display = which === 'detail' ? 'block' : 'none';
    var vp = $('#view-policies'); if (vp) vp.style.display = which === 'policies' ? 'block' : 'none';
    var va = $('#view-account'); if (va) va.style.display = which === 'account' ? 'block' : 'none';
    document.body.classList.toggle('on-home', which === 'home');
    updateHeader();
  }
  /* ---- addresses -----------------------------------------------------
     The site used to live entirely behind a #, which meant every page
     shared one address. To a search engine that is one page: a sitemap
     would list a single entry, every canonical URL would be identical,
     and per-page titles would describe a page nobody could link to.

     So paths are real now. #/shop still works — anyone with one
     bookmarked, or sitting in a WhatsApp thread from months ago, is
     moved to the real address on arrival rather than shown nothing.

     netlify.toml sends unmatched paths to index.html so /shop is not a
     404, with the assets, the admin and the API listed above the
     catch-all so it cannot swallow them. */

  var BASE = (function () {
    /* Where the site is mounted. On this package that is always '/', and
       this block is what would let it be something else.

       It does not on its own: index.html asks for its stylesheet and its
       twelve scripts by absolute path ("/assets/app.js"), so a copy of
       this folder placed in /shop/ would load nothing at all and never
       reach this code. Moving it takes rewriting those paths in
       index.html and admin.html as well — the comment here used to say a
       subfolder install "still works", which was true of this function
       and of nothing else.

       The reckoning below is right either way, and is what everything
       that builds an address depends on, so it stays.

       It cannot be worked out from location.pathname. On /product/WF-1
       that would read as the folder /product/, and every address after
       it would be wrong: the canonical URL would say /WF-1 and the route
       would never match. The address bar is a page the site drew, not a
       place on disk.

       So it comes from where this script is actually served, which is a
       real file path whatever page is being shown. */
    var src = '';
    try {
      var here = document.currentScript;
      if (!here) {
        var all = document.getElementsByTagName('script');
        for (var i = all.length - 1; i >= 0; i--) {
          if (/\/app\.js(\?|$)/.test(all[i].src || '')) { here = all[i]; break; }
        }
      }
      src = (here && here.src) || '';
    } catch (e) {}
    var m = src && src.match(/^(?:https?:)?\/\/[^/]+(\/.*?)assets\/[^/]*$/);
    if (m) return m[1];
    var rel = src && src.match(/^(\/.*?)assets\/[^/]*$/);
    if (rel) return rel[1];
    return '/';
  })();

  function pathFor(route) {
    return BASE + String(route || '').replace(/^\/+/, '');
  }
  function go(route, replace) {
    var url = pathFor(route) + location.search;
    try {
      history[replace ? 'replaceState' : 'pushState']({}, '', url);
      route_();
    } catch (e) {
      /* No History API, or a file:// page: fall back to the hash, which
         still routes correctly. */
      location.hash = '#/' + String(route || '').replace(/^\/+/, '');
    }
  }
  function goHome() { go(''); }
  function goShop(cat) {
    mode = 'shop';
    go('shop' + (cat && cat !== 'All' ? '/' + encodeURIComponent(cat) : ''));
  }

  /* Where we are, as a plain route with no leading slash: '', 'shop',
     'product/WF-1'. A hash address is read as one and then rewritten. */
  /* What this page says about itself. Google runs JavaScript, so this is
     eventually read; WhatsApp and Facebook do not, which is why the
     static <head> matters and why Settings > SEO hands over a block to
     paste into it. Both are kept saying the same thing. */
  function applySeo(route) {
    if (!SEO) return;
    var extra = {};
    var pm = String(route || '').match(/^product\/(.+)$/);
    if (pm) {
      var p = bySku(decodeURIComponent(pm[1]));
      if (p) extra.product = p;
    }
    var polm = String(route || '').match(/^policies\/(.+)$/);
    if (polm) {
      var want = decodeURIComponent(polm[1]);
      extra.policy = (POLICIES || []).filter(function (x) {
        return x && SEO.slug(x.title) === want;
      })[0];
    }
    try {
      var view = SEO.forRoute(seoContext(), route, extra);
      SEO.apply(SEO.tagsFor(view, seoContext()));
    } catch (e) { /* a page that draws is worth more than a perfect tag */ }
  }

  /* Everything the SEO engine needs, gathered once so the storefront, the
     admin preview and the sitemap all describe a page the same way. */
  function seoContext() {
    return {
      general: SETTINGS,
      seo: SEOSET,
      branding: BRANDING || {},
      categories: ALLCATS || [],
      money: { text: function (p) {
        var v = priceOf(p);
        return v.onRequest ? '' : v.nowText;
      } }
    };
  }

  /* Where the site is mounted, for the files that cannot work it out.
     chat.js builds product links from this; without it every card in a
     conversation pointed at the domain root, which is right on this
     package and wrong the moment the folder is moved. See the note
     above BASE for what moving it actually takes. */
  window.VBP_BASE = BASE;

  function currentRoute() {
    var h = location.hash;
    if (h && h.indexOf('#/') === 0) return h.slice(2);
    var p = location.pathname;
    if (p.indexOf(BASE) === 0) p = p.slice(BASE.length);
    return p.replace(/^\/+/, '').replace(/index\.html?$/i, '');
  }

  function route() {
    /* An old #/ address is swapped for the real one before anything is
       drawn, so the page a visitor lands on and the page they can link
       to are the same page. */
    if (location.hash && location.hash.indexOf('#/') === 0) {
      var r = location.hash.slice(2);
      try {
        history.replaceState({}, '', pathFor(r) + location.search);
      } catch (e) { /* leave the hash alone where history is unavailable */ }
    }
    route_();
  }

  function route_() {
    closeMobile(); closeSearch();
    var h = currentRoute();
    applySeo(h);

    var pm = h.match(/^product\/(.+)$/);
    if (pm) { renderDetail(decodeURIComponent(pm[1])); return; }

    var polm = h.match(/^policies(?:\/([^?]+))?$/);
    if (polm) { renderPolicies(polm[1] ? decodeURIComponent(polm[1]) : null); showView('policies'); window.scrollTo(0, 0); return; }

    if (h === 'account') {
      /* Asking for the account page on a shop that has none is not an
         error, it is a shop without accounts: show the home page. */
      if (ACCT && ACCT.enabled()) {
        renderAccount(); showView('account'); window.scrollTo(0, 0); return;
      }
      showView('home'); return;
    }
    if (h === 'faq') {
      /* The FAQ has its own address so it can be linked to and found, but
         it lives on the home page: send them there and scroll to it. */
      showView('home');
      var f = $('#faq');
      if (f && !f.classList.contains('hide')) {
        setTimeout(function () { f.scrollIntoView({ behavior: 'smooth' }); }, 60);
      } else {
        window.scrollTo(0, 0);
      }
      return;
    }
    if (h === 'wishlist') {
      mode = 'wishlist'; filterCat = 'All'; searchTerm = '';
      var si = $('#shopSearch'); if (si) si.value = '';
      updateShopTitle(); renderChips(); renderGrid(); showView('shop'); window.scrollTo(0, 0); return;
    }
    var sm = h.match(/^shop(?:\/(.+))?$/);
    if (sm) {
      mode = 'shop';
      filterCat = sm[1] ? decodeURIComponent(sm[1]) : 'All';
      if (ALLCATS.indexOf(filterCat) === -1 && filterCat !== 'All') filterCat = 'All';
      updateShopTitle(); renderChips(); renderGrid(); showView('shop'); window.scrollTo(0, 0); return;
    }
    showView('home');
  }

  // ------------------------------------------------------------------ header / scroll
  function updateHeader() {
    var hd = $('#header'); if (!hd) return;
    var onHome = document.body.classList.contains('on-home');
    var scrolled = window.scrollY > 60;
    if (onHome && !scrolled) { hd.classList.add('transparent'); hd.classList.remove('solid'); }
    else { hd.classList.remove('transparent'); hd.classList.add('solid'); }
    var tt = $('#toTop'); if (tt) tt.classList.toggle('show', window.scrollY > 600);
  }

  // ------------------------------------------------------------------ hero slider
  function initHero() {
    var slides = $all('.hero-slide'); var dots = $('#heroDots');
    if (!slides.length) return;
    var cur = 0;
    if (dots) {
      slides.forEach(function (_, i) {
        var b = el('button'); if (i === 0) b.className = 'active';
        b.setAttribute('aria-label', 'Slide ' + (i + 1));
        b.addEventListener('click', function () { go(i); });
        dots.appendChild(b);
      });
    }
    function go(n) {
      slides[cur].classList.remove('active');
      if (dots) dots.children[cur].classList.remove('active');
      cur = (n + slides.length) % slides.length;
      slides[cur].classList.add('active');
      if (dots) dots.children[cur].classList.add('active');
    }
    if (slides.length > 1) {
      var t = setInterval(function () { if (!document.hidden) go(cur + 1); }, 6500);
      window.addEventListener('beforeunload', function () { clearInterval(t); });
    }
  }

  // ------------------------------------------------------------------ search overlay
  function openSearch() { $('#searchOverlay').classList.add('open'); setTimeout(function () { $('#soInput').focus(); }, 80); }
  function closeSearch() { var o = $('#searchOverlay'); if (o) o.classList.remove('open'); }
  function runOverlaySearch(term) {
    var host = $('#soResults'); var t = term.toLowerCase().trim();
    if (!t) { host.innerHTML = ''; return; }
    var res = PRODUCTS.filter(function (p) {
      return p.name.toLowerCase().indexOf(t) > -1 || p.category.toLowerCase().indexOf(t) > -1 ||
        (p.sku && p.sku.toLowerCase().indexOf(t) > -1);
    }).slice(0, 8);
    host.innerHTML = '';
    if (!res.length) { host.innerHTML = '<div class="so-result"><span class="nm serif">No matches</span></div>'; return; }
    res.forEach(function (p) {
      var r = el('div', 'so-result');
      r.innerHTML = '<span><span class="nm serif">' + esc(p.name) + '</span> &nbsp;<span style="opacity:.6;font-size:12px;letter-spacing:.1em">' + esc(p.category) + '</span></span><span class="px serif">' + esc(priceOf(p).nowText) + '</span>';
      r.addEventListener('click', function () { closeSearch(); openProduct(p.sku); });
      host.appendChild(r);
    });
  }

  // ------------------------------------------------------------------ mobile menu
  function openMobile() { $('#mobileMenu').classList.add('open'); document.body.style.overflow = 'hidden'; }
  function closeMobile() { var m = $('#mobileMenu'); if (m) m.classList.remove('open'); document.body.style.overflow = ''; }

  // (newsletter now writes to the subscribers table; see initNewsletter below)

  // ------------------------------------------------------------------ reveal animations
  var revObserver;
  function observeReveals() {
    if (!('IntersectionObserver' in window)) { $all('.reveal').forEach(function (e) { e.classList.add('in'); }); return; }
    if (!revObserver) {
      revObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); revObserver.unobserve(en.target); } });
      }, { threshold: 0.12 });
    }
    $all('.reveal:not(.in)').forEach(function (e) { revObserver.observe(e); });
  }

  // ------------------------------------------------------------------ carousels
  function initCarousels() {
    $all('.carousel').forEach(function (car) {
      var track = $('.carousel-track', car);
      var prev = $('.car-btn.prev', car), next = $('.car-btn.next', car);
      function step() { return Math.max(track.clientWidth * 0.8, 260); }
      if (prev) prev.addEventListener('click', function () { track.scrollBy({ left: -step(), behavior: 'smooth' }); });
      if (next) next.addEventListener('click', function () { track.scrollBy({ left: step(), behavior: 'smooth' }); });
    });
  }

  // ------------------------------------------------------------------ icons
  function waIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M.057 24l1.687-6.163a11.867 11.867 0 01-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 018.413 3.488 11.824 11.824 0 013.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 01-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>';
  }
  function heartIcon() { return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>'; }

  // ------------------------------------------------------------------ sample data (preview only)
  var SAMPLE = [
    { name: 'Sussex Tailored Shirt', sku: 'MF-SUCO-BK-M', category: "Men's Fashion", price: 680, size: 'M', color: 'Black', material: 'Cotton', available: true },
    { name: 'Aurelia Silk Blouse', sku: 'WF-AUSI-CR-S', category: "Women's Fashion", price: 920, size: 'S', color: 'Cream', material: 'Silk', available: true },
    { name: 'Monaco Leather Loafers', sku: 'SH-MOLE-TN-42', category: 'Shoes', price: 1450, size: '42', color: 'Tan', material: 'Leather', available: true },
    { name: 'Structured Leather Tote', sku: 'BG-STTO-NV-OS', category: 'Bags', price: 1180, size: 'One size', color: 'Navy', material: 'Leather', available: false },
    { name: 'Gilt Chain Necklace', sku: 'AC-GICH-GD-OS', category: 'Accessories', price: 340, size: '', color: 'Gold', material: 'Brass', available: true },
    { name: 'Riviera Linen Trousers', sku: 'MF-RILI-BG-32', category: "Men's Fashion", price: 740, size: '32', color: 'Beige', material: 'Linen', available: true },
    { name: 'Celeste Wrap Dress', sku: 'WF-CEWR-EM-M', category: "Women's Fashion", price: 980, size: 'M', color: 'Emerald', material: 'Viscose', available: true },
    { name: 'Heritage Suede Belt', sku: 'AC-HESU-BR-L', category: 'Accessories', price: 290, size: 'L', color: 'Brown', material: 'Suede', available: true },
    { name: 'Astoria Cashmere Knit', sku: 'WF-ASCA-CM-M', category: "Women's Fashion", price: 1120, size: 'M', color: 'Camel', material: 'Cashmere', available: true },
    { name: 'Carter Oxford Shoes', sku: 'SH-CAOX-BK-43', category: 'Shoes', price: 1390, size: '43', color: 'Black', material: 'Leather', available: true },
    { name: 'Mirren Pleated Skirt', sku: 'WF-MIPL-NV-S', category: "Women's Fashion", price: 760, size: 'S', color: 'Navy', material: 'Wool', available: true },
    { name: 'Belmont Wool Blazer', sku: 'MF-BEWO-NV-L', category: "Men's Fashion", price: 1680, size: 'L', color: 'Navy', material: 'Wool', available: true }
  ];

  // ------------------------------------------------------------------ init
  function bindStatic() {
    $all('[data-go-home]').forEach(function (e) { e.addEventListener('click', goHome); });
    $all('[data-go-shop]').forEach(function (e) { e.addEventListener('click', function () { goShop('All'); }); });
    $all('[data-scroll]').forEach(function (e) {
      e.addEventListener('click', function () {
        var id = e.getAttribute('data-scroll');
        var t = document.getElementById(id);
        /* These point at bands on the home page, so from anywhere else we
           go home first and scroll once it is drawn. */
        if (currentRoute()) {
          go('');
          setTimeout(function () { if (t) t.scrollIntoView({ behavior: 'smooth' }); }, 60);
        } else if (t) t.scrollIntoView({ behavior: 'smooth' });
      });
    });
    $('#menuBtn').addEventListener('click', openMobile);
    $('#mmClose').addEventListener('click', closeMobile);
    $('#searchBtn').addEventListener('click', openSearch);
    $('#soClose').addEventListener('click', closeSearch);
    $('#wishBtn').addEventListener('click', function () { go('wishlist'); });
    var cb = $('#cartBtn');
    if (cb) cb.addEventListener('click', openCart);
    $('#soInput').addEventListener('input', function () { runOverlaySearch(this.value); });
    $('#toTop').addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
    $('#lbClose').addEventListener('click', closeLightbox);
    $('#lightbox').addEventListener('click', function (e) { if (e.target === this) closeLightbox(); });
    $('#qv').addEventListener('click', function (e) { if (e.target === this) closeQuickView(); });

    var ss = $('#shopSearch');
    if (ss) ss.addEventListener('input', function () { searchTerm = this.value; renderGrid(); });
    var sel = $('#sortSelect');
    if (sel) sel.addEventListener('change', function () { sortBy = this.value; renderGrid(); });
    var fc = $('#filterColor');
    if (fc) fc.addEventListener('change', function () { filterColor = this.value; renderGrid(); });
    var fz = $('#filterSize');
    if (fz) fz.addEventListener('change', function () { filterSize = this.value; renderGrid(); });
    var fst = $('#filterStock');
    if (fst) fst.addEventListener('change', function () { inStockOnly = this.checked; renderGrid(); });

    var srb = $('#siteReviewBtn');
    if (srb) srb.addEventListener('click', function () {
      if (!reviewsOpen()) return;
      openReviewForm(null);
    });
    var rvm = $('#reviewModal');
    if (rvm) rvm.addEventListener('click', function (e) { if (e.target === this) closeReviewModal(); });
    var odm = $('#orderModal');
    if (odm) odm.addEventListener('click', function (e) { if (e.target === this) closeOrderForm(); });
    var ctm = $('#cartModal');
    if (ctm) ctm.addEventListener('click', function (e) { if (e.target === this) closeCart(); });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closeSearch(); closeMobile(); closeQuickView(); closeLightbox(); closeReviewModal(); closeOrderForm(); closeCart(); }
    });

    // WhatsApp / email / Instagram links
    bindWa();
    bindEmailIg();

    // year
    var y = $('#year'); if (y) y.textContent = YEAR;
  }

  function bindWa() {
    $all('[data-wa]').forEach(function (a) { a.href = waGeneral(a.getAttribute('data-wa') || ''); });
    $all('[data-wa-enq]').forEach(function (a) { a.href = waEnquiry(a.getAttribute('data-wa-enq') || ''); });
    /* The chat panel needs the same number, and it is a separate file
       with no way to reach these settings. It has always looked for this
       and nothing ever set it, so it fell back to reading a wa.me link
       off whatever page happened to be showing one — and on a page
       showing none, the handover to WhatsApp simply disappeared.

       Refreshed here rather than set once, because this runs after the
       contact settings land and again whenever they change. */
    window.VBP_CHAT_CONTACT = { orderNumber: orderNumber(), whatsapp: orderNumber() };
  }
  function bindEmailIg() {
    $all('[data-email]').forEach(function (a) {
      var addr = a.getAttribute('data-email') || EMAIL;
      a.href = 'mailto:' + addr;
      if (a.hasAttribute('data-email-text')) a.textContent = addr;
    });
    /* [data-ig] links only make sense when there is a handle behind them.
       One used to sit in the footer with a WhatsApp address as its
       fallback, which is where a customer went if no handle was set. */
    var ig = (CONTACT && CONTACT.instagram) || IG_HANDLE;
    var igUrl = (CT && ig) ? CT.socialUrl('instagram', ig) : '';
    $all('[data-ig]').forEach(function (a) {
      if (igUrl) { a.href = igUrl; a.classList.remove('hide'); }
      else { a.removeAttribute('href'); a.classList.add('hide'); }
    });
  }

  // apply admin-editable content over the default page (every field optional)
  function setText(sel, val) { if (val == null || val === '') return; var e = $(sel); if (e) e.textContent = val; }
  function applyContent(c) {
    if (!c) c = {};
    if (c.announce) { var a = $('#announceBar'); if (a) a.innerHTML = c.announce; }
    if (c.hero) {
      setText('#heroEyebrow', c.hero.eyebrow);
      setText('#heroTitle', c.hero.title);
      setText('#heroTitleEm', c.hero.titleEm);
      setText('#heroSub', c.hero.subtitle);
      if (Array.isArray(c.hero.images)) {
        ['#heroPhoto1', '#heroPhoto2', '#heroPhoto3'].forEach(function (id, i) {
          var e = $(id); if (e && c.hero.images[i]) e.style.backgroundImage = "url('" + c.hero.images[i] + "')";
        });
      }
    }
    if (c.story) { setText('#storyHeading', c.story.heading); setText('#storyP1', c.story.p1); setText('#storyP2', c.story.p2); }
    if (Array.isArray(c.values)) {
      $all('#valuesGrid .trust-cell').forEach(function (cell, i) {
        var v = c.values[i]; if (!v) return;
        var t = cell.querySelector('.t'), s = cell.querySelector('.s');
        if (t && v.t) t.textContent = v.t; if (s && v.s) s.textContent = v.s;
      });
    }
    /* Testimonials used to be written into the grid here and then wiped a
       moment later, because renderSiteReviews clears it and rebuilds from
       the reviews customers actually left. They are drawn there now, after
       the real ones. Settings > Homepage owns them. */
    if (Array.isArray(c.testimonials) && !HOME_TESTIMONIALS.length) {
      HOME_TESTIMONIALS = c.testimonials.filter(function (t) { return t && t.quote; });
    }
    /* Moved to Settings > Payments. Still read so a shop that has not
       opened that section keeps the list it already had;
       applyPaymentSettings runs afterwards and wins. */
    if (Array.isArray(c.payments) && c.payments.length) {
      var pr = $('#payRow'); if (pr) pr.innerHTML = c.payments.map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('');
    }
    /* These four moved to Settings > Contact & Social. They are still read
       here so a shop that has not opened that section yet keeps the numbers
       it already had; applyContactSettings runs afterwards and wins. */
    if (c.waShop) { WA_SHOP = String(c.waShop).replace(/[^0-9]/g, ''); setText('#waShopNum', c.waShop); }
    if (c.waEnquiry) { WA_ENQUIRY = String(c.waEnquiry).replace(/[^0-9]/g, ''); setText('#waEnqNum', c.waEnquiry); }
    if (c.email) EMAIL = c.email;
    if (c.ig) IG_HANDLE = String(c.ig).replace(/^@/, '');
    /* The care panels used to be filled from here, and three of them had
       no other home at all. They are Settings > Customer Care's now, and
       a shop that has written none of its own still gets the four the
       site came with. */
    if (c.rewards) { setText('#rewardsTitle', c.rewards.title); setText('#rewardsBody', c.rewards.body); }
    if (Array.isArray(c.lookImages)) {
      for (var li = 0; li < 6; li++) {
        var le = $('#look' + (li + 1));
        if (le && c.lookImages[li]) le.style.backgroundImage = "url('" + c.lookImages[li] + "')";
      }
    }
    bindWa();
    bindEmailIg();
  }


  // Put Settings > General on the page. Runs after applyContent, so where the
  // two ever overlapped it is General that has the last word.
  function applySettings() {
    MONEY = null;                   // currency or pricing may just have changed
    var s = SETTINGS;

    if (s.tagline) setText('#footTagline', s.tagline);

    // Location: the address when there is one, otherwise city and country.
    var place = [];
    if (s.address) place.push(s.address.replace(/\s*\n\s*/g, ', '));
    else {
      if (s.city) place.push(s.city);
      if (s.country) place.push(s.country);
    }
    var placeLine = place.join(' · ');
    if (placeLine) {
      setText('#locVal', placeLine);
      setText('#footLocation', s.city && s.country ? s.city + ', ' + s.country : placeLine);
    }

    /* Two timetables, and they are not the same question. Trading hours
       say when the shop is open; support hours say when somebody answers
       WhatsApp. The site used to show one row that quietly became the
       other, so a shop whose support ran later than its doors had no way
       to say so.

       The second row only appears when the two actually differ. Printing
       the same line twice under two headings tells a customer nothing and
       makes them read it twice to find that out. */
    if (FMT && s.businessHours) {
      var trading = FMT.summariseHours(s.businessHours);
      if (trading) {
        setText('#footHours', trading);
        writeHours('#hoursVal', trading, FMT.openState(s.businessHours, s.timezone));
      }
    }

    var supportRow = $('#supportRow');
    var support = (CONTACT && CONTACT.supportHoursOverride && CONTACT.supportHours)
      ? CONTACT.supportHours : null;
    if (supportRow) {
      var supportLine = (support && FMT) ? FMT.summariseHours(support) : '';
      if (supportLine) {
        writeHours('#supportVal', supportLine, FMT.openState(support, s.timezone));
        supportRow.classList.remove('hide');
      } else {
        supportRow.classList.add('hide');
      }
    }

    /* The title and the description used to be assembled here. They are
       Settings > SEO's now — it falls back to exactly this when nothing
       has been written there, so the wording is unchanged, but only one
       place decides it and the two cannot drift apart. */
  }


  // Settings > Contact & Social on the page: the numbers, the addresses,
  // the social icons and the directions link.
  function applyContactSettings() {
    if (!CT) return;
    var c = CONTACT || {};

    // Email. What customers see is the support address, falling back to
    // the business one, falling back to whatever Site Content had.
    var mail = c.supportEmail || c.email || EMAIL;
    if (mail) EMAIL = mail;

    // The numbers shown in the Visit panel, where they are set.
    if (c.orderNumber || c.whatsapp) setText('#waShopNum', c.orderNumber || c.whatsapp);
    if (c.enquiryNumber || c.orderNumber || c.whatsapp) {
      setText('#waEnqNum', c.enquiryNumber || c.orderNumber || c.whatsapp);
    }
    $all('[data-email][data-email-text]').forEach(function (a) { a.textContent = EMAIL; });

    // Phone, shown only when there is one.
    var phoneRow = $('#phoneRow'), phoneVal = $('#phoneVal');
    if (phoneRow && phoneVal) {
      var href = CT.telHref(c.phone);
      if (href) {
        phoneVal.href = href;
        phoneVal.textContent = c.phone;
        phoneRow.classList.remove('hide');
      } else {
        phoneRow.classList.add('hide');
      }
    }

    // Directions. A pasted Google link is used as it is; with none, the
    // address from General is searched for instead.
    var maps = $('#mapsLink');
    if (maps) {
      var where = [SETTINGS.address, SETTINGS.city, SETTINGS.country]
        .filter(Boolean).join(', ').replace(/\s*\n\s*/g, ', ');
      var url = CT.mapsUrl(c.mapsUrl, where);
      if (url) { maps.href = url; maps.classList.remove('hide'); }
      else { maps.classList.add('hide'); }
    }

    buildSocial(c);
  }

  /* The footer row of icons. Only the networks with a handle appear:
     an icon that goes nowhere, or somewhere unrelated, is worse than
     no icon at all. */
  function buildSocial(c) {
    var host = $('#footSocial');
    if (!host) return;
    host.innerHTML = '';

    function icon(paths) {
      return "<svg viewBox='0 0 24 24' aria-hidden='true'>" + paths + "</svg>";
    }
    function add(href, label, paths, opts) {
      var a = el('a');
      a.href = href;
      a.setAttribute('aria-label', label);
      if (opts && opts.blank) { a.target = '_blank'; a.rel = 'noopener'; }
      a.innerHTML = icon(paths);
      host.appendChild(a);
    }

    CT.SOCIALS.forEach(function (net) {
      var url = CT.socialUrl(net.id, c[net.id]);
      if (url) add(url, net.name, net.icon, { blank: true });
    });

    var wa = waEnquiry('I have an enquiry.');
    if (wa) add(wa, 'WhatsApp',
      "<path d='M12 2a10 10 0 00-8.6 15L2 22l5.2-1.4A10 10 0 1012 2zm0 18a8 8 0 01-4.1-1.1l-.3-.2-3.1.8.8-3-.2-.3A8 8 0 1112 20zm4.4-5.8c-.2-.1-1.4-.7-1.6-.8s-.4-.1-.6.1-.6.8-.8 1-.3.2-.6.1a6.6 6.6 0 01-1.9-1.2 7.3 7.3 0 01-1.4-1.7c-.1-.3 0-.4.1-.5l.4-.5a1.8 1.8 0 00.3-.4.5.5 0 000-.5c0-.1-.6-1.4-.8-1.9s-.4-.4-.6-.4h-.5a1 1 0 00-.7.3 2.9 2.9 0 00-.9 2.2 5 5 0 001.1 2.7 11.5 11.5 0 004.4 3.9 8.3 8.3 0 001.5.5 3.5 3.5 0 001.6.1 2.6 2.6 0 001.7-1.2 2.1 2.1 0 00.1-1.2c0-.1-.2-.2-.4-.3z'/>",
      { blank: true });

    /* A filled envelope, not an outlined one: .foot-social svg fills every
       path, which turned the outline version into a solid square. */
    if (EMAIL) add('mailto:' + EMAIL, 'Email',
      "<path d='M2 6.5A2.5 2.5 0 014.5 4h15A2.5 2.5 0 0122 6.5v11a2.5 2.5 0 01-2.5 2.5h-15A2.5 2.5 0 012 17.5zm2.35-.4L12 12.35l7.65-6.25a.5.5 0 00-.15-.03h-15a.5.5 0 00-.15.03zM20 8.03l-7.63 6.23a.6.6 0 01-.74 0L4 8.03V17.5c0 .28.22.5.5.5h15c.28 0 .5-.22.5-.5z'/>");
  }

  // ---------------- website REST helpers ----------------
  function webBase() { return WEB.SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/'; }
  function webHeaders(extra) {
    var h = { apikey: WEB.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + WEB.SUPABASE_ANON_KEY };
    if (extra) { for (var k in extra) h[k] = extra[k]; }
    return h;
  }
  /* The same REST endpoint the Supabase client would call, for the shops
     that never download it. A database function is addressed under rpc/,
     and unlike webPost the answer is wanted: place_order hands back the
     order's id and its reference. */
  function webRpc(name, args) {
    if (!WEB) return Promise.reject(new Error('not configured'));
    return fetch(webBase() + 'rpc/' + name, {
      method: 'POST',
      headers: webHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(args || {})
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error(t || ('HTTP ' + r.status)); });
      return r.json();
    });
  }
  function webPost(table, obj) {
    if (!WEB) return Promise.reject(new Error('not configured'));
    return fetch(webBase() + table, {
      method: 'POST', headers: webHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
      body: JSON.stringify(obj)
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error(t || ('HTTP ' + r.status)); });
      return true;
    });
  }

  // ---------------- stars + reviews ----------------

  /* Whether reviews appear, and whether new ones may be written.

     Both moved from Settings > Shopping to Settings > Reviews. A shop
     that never opens the new section, or that switched one off in the
     old one and has not saved the new one yet, keeps the answer it gave:
     the Reviews row wins only once it exists. */
  function reviewsShown() {
    if (REVIEW_ROW) return REVIEWSET.showReviews !== false;
    return SHOP.showReviews !== false;
  }
  function reviewsOpen() {
    if (!reviewsShown()) return false;
    if (REVIEW_ROW) return REVIEWSET.customerReviews !== false;
    return SHOP.customerReviews !== false;
  }
  /* The score and the count, which a shop can drop while still showing
     what people wrote. */
  function ratingsShown() { return reviewsShown() && REVIEWSET.showRatings !== false; }

  /* Whether a review of this rating publishes itself. The database asks
     the same question of the same settings before it accepts the row -
     this is only so the page can tell the customer the truth about what
     just happened. */
  function autoPublishes(rating) {
    if (!REVIEWSET.autoPublish) return false;
    return Number(rating) >= (Number(REVIEWSET.minAutoRating) || 1);
  }

  function starsHtml(rating, cls) {
    var r = Math.round(rating || 0), out = '';
    for (var i = 1; i <= 5; i++) out += '<span class="' + (i <= r ? 'on' : '') + '">\u2605</span>';
    return '<span class="' + (cls || 'stars') + '">' + out + '</span>';
  }
  function avgRating(list) { if (!list.length) return 0; var s = 0; list.forEach(function (r) { s += Number(r.rating) || 0; }); return s / list.length; }
  function reviewsFor(sku) { return REVIEWS.filter(function (r) { return r.sku === sku; }); }
  function siteReviews() { return REVIEWS.filter(function (r) { return !r.sku; }); }

  function renderSiteReviews() {
    var host = $('#testiGrid'); if (!host) return;
    var list = siteReviews();
    /* The score is a separate decision from the words: a shop may want
       what people wrote without a mark out of five on everything. */
    var avgEl = $('#reviewsAvg');
    if (avgEl) {
      avgEl.innerHTML = (ratingsShown() && list.length)
        ? starsHtml(avgRating(list), 'stars lg') + ' <span class="avg-n">' + avgRating(list).toFixed(1) + ' / 5 · ' + list.length + ' review' + (list.length > 1 ? 's' : '') + '</span>'
        : '';
      avgEl.classList[ratingsShown() && list.length ? 'remove' : 'add']('hide');
    }
    host.innerHTML = '';
    var quotes = HOME_TESTIMONIALS || [];
    if (!list.length && !quotes.length) {
      host.innerHTML = '<div class="reviews-empty"><p class="serif">No reviews yet</p><p>Be the first to share your experience.</p></div>';
      return;
    }
    list.slice(0, 6).forEach(function (r) {
      var d = el('div', 'testi reveal');
      var when = r.created_at ? formatDate(r.created_at) : '';
      d.innerHTML = '<div class="mark serif">&ldquo;</div><p>' + esc(r.comment || '') + '</p>' +
        (ratingsShown() ? starsHtml(r.rating) : '') +
        '<div class="who"><b>' + esc(r.name) + '</b>' + (r.verified ? ' · <span class="verified">Verified</span>' : '') +
        (when ? ' · <span class="when">' + esc(when) + '</span>' : '') + '</div>';
      host.appendChild(d);
    });

    /* The shop's own quotes fill whatever room is left. A review someone
       actually left is worth more than one the shop wrote down, so those
       come first and these never push one out. */
    quotes.slice(0, Math.max(0, 6 - Math.min(list.length, 6))).forEach(function (t) {
      var d = el('div', 'testi reveal');
      d.innerHTML = '<div class="mark serif">&ldquo;</div><p></p>' +
        '<div class="who"><b></b></div>';
      d.querySelector('p').textContent = t.quote || '';
      var who = d.querySelector('.who b');
      who.textContent = t.name || '';
      if (t.city) {
        d.querySelector('.who').appendChild(document.createTextNode(' \u00b7 ' + t.city));
      }
      host.appendChild(d);
    });
    observeReveals();
  }
  function renderProductReviews(sku) {
    var host = $('#prodReviews'); if (!host) return;
    var list = reviewsFor(sku), avg = avgRating(list);
    host.innerHTML =
      '<div class="pr-head"><div><div class="eyebrow">Reviews</div><h2 class="serif" style="font-size:clamp(24px,3.4vw,34px)">Customer reviews</h2></div>' +
      (reviewsOpen() ? '<button class="btn btn-outline btn-sm" id="prWrite">Write a review</button>' : '') + '</div>' +
      (list.length
        ? (ratingsShown()
            ? '<div class="pr-avg">' + starsHtml(avg, 'stars lg') + ' <span class="avg-n">' + avg.toFixed(1) + ' / 5 · ' + list.length + ' review' + (list.length > 1 ? 's' : '') + '</span></div>'
            : '')
        : '<p class="pr-none">No reviews yet for this piece. Be the first to review it.</p>') +
      '<div class="pr-list">' + list.map(function (r) {
        return '<div class="pr-item">' + (ratingsShown() ? starsHtml(r.rating) : '') + '<p>' + esc(r.comment || '') + '</p><div class="who"><b>' + esc(r.name) + '</b>' + (r.verified ? ' · <span class="verified">Verified</span>' : '') + '</div></div>';
      }).join('') + '</div>';
    var w = $('#prWrite'); if (w) w.addEventListener('click', function () { openReviewForm(sku); });
  }
  function openReviewForm(sku) {
    var modal = $('#reviewModal'), body = $('#reviewBody'); if (!modal) return;
    body.innerHTML =
      '<button class="qv-close" id="rvClose" aria-label="Close">&times;</button>' +
      '<div class="c">' + (sku ? 'Your feedback' : 'Tell others about us') + '</div>' +
      '<h3 class="serif">' + (sku ? 'Write a review' : 'Review ' + shopName()) + '</h3>' +
      '<div class="rv-stars" id="rvStars">' + [1, 2, 3, 4, 5].map(function (i) { return '<span data-v="' + i + '">\u2605</span>'; }).join('') + '</div>' +
      '<label class="rv-lbl">Your name' +
        (REVIEWSET.anonymous ? '<span class="od-opt">optional</span>' : '') +
        '</label><input type="text" id="rvName" maxlength="60" autocomplete="name">' +
      '<label class="rv-lbl">Your review</label><textarea id="rvComment" maxlength="1000" rows="4"></textarea>' +
      /* Said before they write, not after they submit. Somebody who
         would rather not be read straight away should know that. */
      (REVIEWSET.autoPublish ? '' :
        '<p class="rv-wait">Reviews are read before they appear, so yours will not show ' +
        'straight away.</p>') +
      '<div class="rv-actions"><button class="btn btn-navy" id="rvSubmit">Submit review</button><span class="rv-msg" id="rvMsg"></span></div>';
    var rating = 5, stars = $all('#rvStars span');
    function paint() { stars.forEach(function (s, i) { s.classList.toggle('on', i < rating); }); }
    stars.forEach(function (s) { s.addEventListener('click', function () { rating = Number(s.getAttribute('data-v')); paint(); }); });
    paint();
    $('#rvClose').addEventListener('click', closeReviewModal);
    $('#rvSubmit').addEventListener('click', function () {
      var name = $('#rvName').value.trim(), comment = $('#rvComment').value.trim(), msg = $('#rvMsg');
      /* The table needs a name, so an unsigned review carries the word
         the shop chose rather than an empty one. */
      if (!name && REVIEWSET.anonymous) name = REVIEWSET.anonymousLabel || 'A customer';
      if (!name) { msg.textContent = 'Please enter your name.'; msg.className = 'rv-msg err'; return; }
      if (!WEB) { msg.textContent = 'Reviews are not enabled yet.'; msg.className = 'rv-msg err'; return; }
      msg.textContent = 'Submitting…'; msg.className = 'rv-msg';

      /* Sent explicitly, and checked again by the database, which asks
         the same settings before it will accept a published one. */
      var live = autoPublishes(rating);
      var rec = { name: name, rating: rating, comment: comment, approved: live };
      if (sku) rec.sku = sku;

      webPost('reviews', rec).then(function () {
        if (live) {
          /* Only shown at once when it really did publish at once.
             Telling somebody their review is up when it is waiting is
             how they come back, not find it, and write again. */
          REVIEWS.unshift({ sku: sku || null, name: name, rating: rating, comment: comment,
                            verified: false, created_at: new Date().toISOString() });
          msg.textContent = 'Thank you! Your review is posted.';
          if (sku) renderProductReviews(sku); else renderSiteReviews();
        } else {
          msg.textContent = 'Thank you. We read every review before it appears, so yours ' +
                            'will show shortly.';
        }
        msg.className = 'rv-msg ok';
        setTimeout(closeReviewModal, live ? 1100 : 2200);
      }).catch(function () { msg.textContent = 'Could not submit. Please try again.'; msg.className = 'rv-msg err'; });
    });
    modal.classList.add('open'); document.body.style.overflow = 'hidden';
  }
  function closeReviewModal() { var m = $('#reviewModal'); if (m) m.classList.remove('open'); document.body.style.overflow = ''; }

  // ---------------- shop filters ----------------
  function uniqueVals(field) {
    var set = [];
    PRODUCTS.forEach(function (p) { var v = (p[field] || '').trim(); if (v && set.indexOf(v) < 0) set.push(v); });
    return set.sort();
  }
  function buildFilters() {
    var cs = $('#filterColor'), ss = $('#filterSize');
    if (cs) {
      cs.innerHTML = '<option value="All">All colours</option>' + uniqueVals('color').map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
      cs.value = filterColor;
    }
    if (ss) {
      ss.innerHTML = '<option value="All">All sizes</option>' + uniqueVals('size').map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
      ss.value = filterSize;
    }
  }

  // ---------------- newsletter -> subscribers ----------------

  /* The band's wording. index.html still carries the same words, so a
     visitor whose scripts never arrive reads the shop's own invitation
     rather than an empty box - these overwrite them once the settings
     are in, and the two agree until somebody edits the settings. */
  function applyNewsletter() {
    var n = NEWSLETTER;

    /* A shop that is not running a list should not be asking anybody to
       join one. This is the switch in Settings > Newsletter, and it wins
       over the homepage's own ordering: Homepage decides where the band
       sits, this decides whether there is a band at all. */
    var band = $('#newsletter');
    if (band) band.classList[n.enabled === false ? 'add' : 'remove']('hide');
    if (n.enabled === false) return;

    setText('#nlEyebrow', n.eyebrow);
    setText('#nlHeading', n.heading);
    setText('#nlBlurb', n.blurb);
    setText('#nlBtn', n.buttonLabel);
    setText('#nlSuccess', n.welcome);

    var box = $('#nlEmail');
    if (box && n.placeholder) box.placeholder = n.placeholder;

    /* An empty note is no note, rather than an empty line under the box. */
    var note = $('#nlNote');
    if (note) {
      note.textContent = n.privacyNote || '';
      note.classList[n.privacyNote ? 'remove' : 'add']('hide');
    }
  }

  function initNewsletter() {
    var form = $('#nlForm'); if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (NEWSLETTER.enabled === false) return;   // not running a list
      var email = $('#nlEmail').value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { $('#nlEmail').focus(); return; }
      /* An address already on the list comes back as a conflict. That is
         still a success as far as the person is concerned, and saying so
         also avoids telling a stranger who is on the list. */
      var err = $('#nlError');
      var done = function () {
        if (err) { err.textContent = ''; err.classList.remove('show'); }
        form.classList.add('hide');
        $('#nlSuccess').classList.add('show');
      };
      /* Told the truth, both ways.
      
         This used to write straight at the table and count every answer
         as a yes, so a visitor was thanked whether or not anything had
         been written down — and somebody who had unsubscribed could
         never get back on, because their row still holds the address and
         the browser may only insert. The conflict read as success and
         they stayed off the list.
      
         subscribe_email settles both. An address already on the list is
         still a success, and still says nothing about who is on it; a
         person typing their own address into this form is asking to
         rejoin, so p_rejoin is set here and nowhere else; and a real
         failure now reaches the person who can do something about it. */
      var failed = function () {
        if (!err) return;
        err.textContent = 'That did not go through. Please check your connection and try again.';
        err.classList.add('show');
      };
      if (!WEB) { done(); return; }
      webRpc('subscribe_email', { p_email: email, p_rejoin: true }).then(done, failed);
    });
  }

  // ---------------- policies ----------------
  function policyBodyHtml(body) {
    var lines = String(body || '').split('\n'), html = '', inUl = false;
    lines.forEach(function (ln) {
      ln = ln.trim(); if (!ln) return;
      var isBullet = ln.charAt(0) === '\u2022' || ln.indexOf('- ') === 0;
      if (isBullet) {
        if (!inUl) { html += '<ul>'; inUl = true; }
        html += '<li>' + esc(ln.replace(/^\u2022\s?/, '').replace(/^-\s?/, '')) + '</li>';
      } else {
        if (inUl) { html += '</ul>'; inUl = false; }
        html += '<p>' + esc(ln) + '</p>';
      }
    });
    if (inUl) html += '</ul>';
    return html;
  }
  function renderPolicies(focus) {
    var host = $('#view-policies'); if (!host) return;
    var order = [], groups = {};
    POLICIES.slice().sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); }).forEach(function (p) {
      var s = p.section || 'Policies';
      if (!groups[s]) { groups[s] = []; order.push(s); }
      groups[s].push(p);
    });
    var html = '<div class="wrap policies-wrap">' +
      '<div class="crumbs"><a data-home>Home</a> / Policies</div>' +
      '<div class="policies-head"><div class="eyebrow">Customer information</div><h1 class="serif">Policies &amp; Customer Information</h1>' +
      '<p>Our terms, policies and customer information for shopping with ' + esc(shopName()) +
      '. If anything is unclear, message us and we will gladly help.</p></div>';
    if (!order.length) { html += '<p class="pr-none">Policies are being updated. Please check back soon.</p>'; }
    order.forEach(function (s) {
      html += '<section class="pol-section"><h2 class="serif pol-sec-title">' + esc(s) + '</h2><div class="pol-list">';
      groups[s].forEach(function (p) {
        var sg = slug(p.title);
        html += '<details class="pol-item" id="pol-' + sg + '" data-slug="' + sg + '"><summary>' + esc(p.title) + '<span class="pol-ar" aria-hidden="true">+</span></summary><div class="pol-body">' + policyBodyHtml(p.body) + '</div></details>';
      });
      html += '</div></section>';
    });
    html += '<div class="pol-help"><p class="serif">Still have a question?</p><a class="btn btn-wa" data-wa="I have a question about your policies.">Ask on WhatsApp</a></div></div>';
    host.innerHTML = html;
    var hb = host.querySelector('[data-home]'); if (hb) hb.addEventListener('click', goHome);
    bindWa();
    if (focus) focusPolicy(host, focus);
  }
  function focusPolicy(host, focus) {
    var items = host.querySelectorAll('.pol-item'), match = null;
    function pick(test) { items.forEach(function (it) { if (!match && test(it.getAttribute('data-slug') || '')) match = it; }); }
    pick(function (s) { return s === focus; });
    if (!match) pick(function (s) { return s.indexOf(focus) === 0; });
    if (!match) pick(function (s) { return s.indexOf(focus) > -1; });
    if (match) {
      match.open = true;
      match.classList.add('pol-focus');
      setTimeout(function () { match.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 80);
    }
  }

  function init() {
    preHideIfLastGated();   // only hides when this browser was gated last time
    preApplyCachedTheme();  // the colours from last time, until the real ones land
    bindStatic();
    /* The badge is drawn from the cart alone, so it is right before the
       feed answers. A returning customer sees what they left in it
       straight away rather than after the products land. */
    updateCartCount();
    initHero();
    initCarousels();
    initNewsletter();
    observeReveals();
    window.addEventListener('scroll', updateHeader, { passive: true });
    /* Back and forward now move through real addresses, so popstate is
       what carries navigation. hashchange stays for the old #/ links,
       which are still typed, bookmarked and pasted into WhatsApp. */
    window.addEventListener('popstate', route);
    window.addEventListener('hashchange', route);

    /* Any link to a page of this site is followed without a reload. The
       browser would otherwise fetch the whole page again for something
       the shop can already draw. Anything else — another site, a file, a
       new tab, a modified click — is left alone. */
    document.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target.closest && e.target.closest('a[href]');
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      var href = a.getAttribute('href') || '';
      if (!href || href.charAt(0) === '#' || /^[a-z]+:/i.test(href)) return;
      var url;
      try { url = new URL(a.href); } catch (err) { return; }
      if (url.origin !== location.origin) return;
      if (url.pathname.indexOf(BASE) !== 0) return;
      if (/\.[a-z0-9]+$/i.test(url.pathname) && !/\.html?$/i.test(url.pathname)) return;
      e.preventDefault();
      go(url.pathname.slice(BASE.length) + url.hash);
    });
    updateHeader();
    load();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
