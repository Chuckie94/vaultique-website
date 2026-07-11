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
  function formatPrice(n) {
    var num = Number(n) || 0;
    var hasDec = (Math.round(num * 100) / 100) % 1 !== 0;
    return 'K' + num.toLocaleString('en-US', {
      minimumFractionDigits: hasDec ? 2 : 0, maximumFractionDigits: 2
    });
  }
  function waUrl(num, text) {
    return 'https://wa.me/' + num + '?text=' + encodeURIComponent(text);
  }
  function waLink(p) {
    var msg = "Hello Vaultique Boutique, I'd like to buy: " + p.name +
      ' (SKU: ' + p.sku + '), ' + formatPrice(p.price) + '. Is it available?';
    return waUrl(WA_SHOP, msg);
  }
  function waGeneral(text) {
    return waUrl(WA_SHOP, text || 'Hello Vaultique Boutique, I would like to shop with you.');
  }
  function waEnquiry(text) {
    return waUrl(WA_ENQUIRY, text || 'Hello Vaultique Boutique, I have an enquiry.');
  }

  // safe storage (degrades to memory if blocked, e.g. in preview frames)
  var mem = {};
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return mem[k] || null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { mem[k] = v; } }
  };

  // ------------------------------------------------------------------ images
  function placeholderSrc() {
    var svg =
      "<svg xmlns='http://www.w3.org/2000/svg' width='480' height='600'>" +
      "<rect width='100%' height='100%' fill='%230B1F3A'/>" +
      "<rect x='20' y='20' width='440' height='560' fill='none' stroke='%23C8A24A' stroke-opacity='.4'/>" +
      "<text x='50%' y='45%' fill='%23C8A24A' font-family='Georgia,serif' font-size='78' " +
      "text-anchor='middle' letter-spacing='8'>VB</text>" +
      "<text x='50%' y='55%' fill='%23C8A24A' font-family='Arial' font-size='13' " +
      "letter-spacing='6' text-anchor='middle'>VAULTIQUE BOUTIQUE</text></svg>";
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
      if (i < IMG_EXTS.length) { imgEl.src = 'images/' + sku + '.' + IMG_EXTS[i]; }
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
      var url = 'images/' + sku + '.' + IMG_EXTS[i++];
      var im = new Image();
      im.onload = function () { cb(url); };
      im.onerror = tryNext;
      im.src = url;
    })();
  }
  function bgStyle(url) { return "background-image:url('" + url + "')"; }

  // ------------------------------------------------------------------ state
  var PRODUCTS = [];
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
  function parseList(s) { try { return s ? JSON.parse(s) : []; } catch (e) { return []; } }
  function saveWishlist() { store.set('vbp_wishlist', JSON.stringify(wishlist)); }
  function saveRecent() { store.set('vbp_recent', JSON.stringify(recent)); }

  function bySku(sku) { for (var i = 0; i < PRODUCTS.length; i++) if (PRODUCTS[i].sku === sku) return PRODUCTS[i]; return null; }

  // ------------------------------------------------------------------ data load
  function load() {
    fetch('/api/products', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('bad'); return r.json(); })
      .then(function (d) {
        PRODUCTS = (d && d.products) || [];
        if (!PRODUCTS.length) { usePreview(); return; }
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
      mergeMeta();
      applyContent(CONTENT);
      applyLocalBackgrounds();
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
      var u = 'images/hero-' + (i + 1) + '.jpg';
      preload(u, function (ok) { if (ok) e.style.backgroundImage = "url('" + u + "')"; });
    });
    for (var k = 1; k <= 6; k++) (function (k) {
      var e = $('#look' + k); if (!e || e.style.backgroundImage) return;
      var u = 'images/look-' + k + '.jpg';
      preload(u, function (ok) { if (ok) e.style.backgroundImage = "url('" + u + "')"; });
    })(k);
  }
  // pull the website's own photos + content (separate Supabase, read-only here)
  function loadWebsiteData(cb) {
    if (!WEB) { cb(); return; }
    var base = WEB.SUPABASE_URL.replace(/\/+$/, '');
    var h = { apikey: WEB.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + WEB.SUPABASE_ANON_KEY };
    var pending = 4;
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
  }
  function asArray(v) { if (Array.isArray(v)) return v; try { var a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  // attach per-product photos/flags from the website DB, and drop hidden items
  function mergeMeta() {
    PRODUCTS = PRODUCTS.map(function (p) {
      var m = META[p.sku];
      if (m) {
        p.image_url = m.image_url || '';
        p.gallery = asArray(m.gallery);
        p.videos = asArray(m.videos);
        p.featured = !!m.featured;
        p.is_new = !!m.is_new;
        p.hidden = !!m.hidden;
        if (m.description) p.customDesc = m.description;
      }
      return p;
    }).filter(function (p) { return !p.hidden; });
  }
  function boot() {
    computeCats();
    buildCategoryMenus();
    buildCollections();
    buildHomeRows();
    buildFilters();
    renderSiteReviews();
    updateWishCount();
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
      preload('images/collection-' + slug(c) + '.jpg', function (ok) {
        if (ok) { ph.classList.remove('fallback'); ph.style.cssText = bgStyle('images/collection-' + slug(c) + '.jpg'); }
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
    var newArrivals = PRODUCTS.filter(function (p) { return p.is_new; });
    if (!newArrivals.length) newArrivals = PRODUCTS.slice(0, 10); else newArrivals = newArrivals.slice(0, 12);
    var women = rowFor(function (p) { return /women|ladies/i.test(p.category); }, 10);
    var men = rowFor(function (p) { return /\bmen\b|gent/i.test(p.category) && !/women/i.test(p.category); }, 10);
    var acc = rowFor(function (p) { return /access|bag|jewel|shoe|footwear/i.test(p.category); }, 10);

    fillRow('row-featured', 'sec-featured', featured, false);
    fillRow('row-new', 'sec-new', newArrivals, true);
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
      preload('images/' + p.sku + '-2.jpg', function (ok) {
        if (!ok) return;
        var s = el('img', 'secondary'); s.alt = p.name + ' alternate view';
        s.loading = 'lazy'; s.src = 'images/' + p.sku + '-2.jpg';
        thumb.appendChild(s);
      });
    }

    var badges = el('div', 'badges');
    if (markNew || p.is_new) { var nb = el('span', 'tag new'); nb.textContent = 'New In'; badges.appendChild(nb); }
    var sb = el('span', 'tag ' + (p.available ? 'stock' : 'out'));
    sb.textContent = p.available ? 'In Stock' : 'Sold Out';
    badges.appendChild(sb);
    thumb.appendChild(badges);

    var wish = el('button', 'wish' + (isWished(p.sku) ? ' active' : ''));
    wish.setAttribute('aria-label', 'Add to wishlist');
    wish.innerHTML = heartIcon();
    wish.addEventListener('click', function (e) { e.stopPropagation(); toggleWish(p.sku, wish); });
    thumb.appendChild(wish);

    var quick = el('button', 'quick'); quick.textContent = 'Quick View';
    quick.addEventListener('click', function (e) { e.stopPropagation(); openQuickView(p.sku); });
    thumb.appendChild(quick);

    var info = el('div', 'card-info');
    info.innerHTML =
      '<div class="c">' + esc(p.category) + '</div>' +
      '<div class="n serif"></div>' +
      '<div class="a">' + esc(attrs) + '</div>' +
      '<div class="p">' + formatPrice(p.price) + '</div>';
    var nm = info.querySelector('.n'); nm.textContent = p.name;
    nm.addEventListener('click', function () { openProduct(p.sku); });

    var waLine = el('div', 'wa-line');
    var wa = el('a', 'btn btn-wa');
    wa.href = waLink(p); wa.target = '_blank'; wa.rel = 'noopener';
    wa.innerHTML = waIcon() + (p.available ? 'Buy on WhatsApp' : 'Enquire');
    waLine.appendChild(wa);
    info.appendChild(waLine);

    card.appendChild(thumb); card.appendChild(info);
    return card;
  }

  // ------------------------------------------------------------------ wishlist
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

  // ------------------------------------------------------------------ shop grid
  function currentList() {
    var term = searchTerm.toLowerCase().trim();
    var list = PRODUCTS.filter(function (p) {
      if (mode === 'wishlist' && !isWished(p.sku)) return false;
      var catOk = filterCat === 'All' || p.category === filterCat;
      if (filterColor !== 'All' && (p.color || '') !== filterColor) return false;
      if (filterSize !== 'All' && (p.size || '') !== filterSize) return false;
      if (inStockOnly && !p.available) return false;
      var s = !term ||
        (p.name && p.name.toLowerCase().indexOf(term) > -1) ||
        (p.sku && p.sku.toLowerCase().indexOf(term) > -1) ||
        (p.category && p.category.toLowerCase().indexOf(term) > -1) ||
        (p.color && p.color.toLowerCase().indexOf(term) > -1) ||
        (p.material && p.material.toLowerCase().indexOf(term) > -1);
      return catOk && s;
    });
    if (sortBy === 'price-asc') list.sort(function (a, b) { return a.price - b.price; });
    else if (sortBy === 'price-desc') list.sort(function (a, b) { return b.price - a.price; });
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
            waGeneral('Hello Vaultique Boutique, please let me know when ' + filterCat + ' is available.') +
            '">Notify me on WhatsApp</a></div>';
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
    var attrs = [['Category', p.category], ['Size', p.size], ['Colour', p.color], ['Material', p.material]]
      .filter(function (r) { return r[1]; });
    body.innerHTML =
      '<button class="qv-close" aria-label="Close">&times;</button>' +
      '<div class="c">' + esc(p.category) + '</div>' +
      '<h3 class="serif">' + esc(p.name) + '</h3>' +
      '<div class="p serif">' + formatPrice(p.price) + '</div>' +
      '<div class="detail-vat">Price includes 16% VAT</div>' +
      '<div class="meta">' + attrs.map(function (r) { return '<div><b style="color:#15202e">' + esc(r[0]) + ':</b> ' + esc(r[1]) + '</div>'; }).join('') +
      '<div style="margin-top:6px">' + (p.available ? 'In stock' : 'Sold out') + '</div></div>' +
      '<div class="detail-cta" style="max-width:none">' +
      '<a class="btn btn-wa" target="_blank" rel="noopener" href="' + waLink(p) + '">' + waIcon() + (p.available ? 'Buy on WhatsApp' : 'Enquire on WhatsApp') + '</a>' +
      '<button class="btn btn-outline" id="qvFull">View full details</button></div>';
    body.querySelector('.qv-close').addEventListener('click', closeQuickView);
    body.querySelector('#qvFull').addEventListener('click', function () { closeQuickView(); openProduct(sku); });
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeQuickView() { $('#qv').classList.remove('open'); document.body.style.overflow = ''; }

  // ------------------------------------------------------------------ product detail
  function openProduct(sku) { location.hash = '#/product/' + encodeURIComponent(sku); }
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

    var specs = [['Category', p.category], ['SKU', p.sku], ['Size', p.size],
    ['Colour', p.color], ['Material', p.material]].filter(function (r) { return r[1]; });
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
      '<div class="eyebrow">' + esc(p.category) + '</div>' +
      '<h1 class="serif">' + esc(p.name) + '</h1>' +
      '<div class="detail-price serif">' + formatPrice(p.price) + '</div>' +
      '<div class="detail-vat">Price includes 16% VAT</div>' +
      (prList.length ? '<div class="detail-rating">' + starsHtml(avgRating(prList)) + ' <a class="rating-link" id="ratingLink">' + avgRating(prList).toFixed(1) + ' (' + prList.length + ' review' + (prList.length > 1 ? 's' : '') + ')</a></div>' : '') +
      '<p class="desc">' + esc(desc) + '</p>' +
      (p.size ? '<div class="opt-block"><div class="lbl">Size</div><span class="opt-chip">' + esc(p.size) + '</span></div>' : '') +
      (p.color ? '<div class="opt-block"><div class="lbl">Colour</div><span class="opt-chip">' + esc(p.color) + '</span></div>' : '') +
      '<div class="avail-line ' + (p.available ? '' : 'out') + '"><span class="dot"></span>' + (p.available ? 'In stock — ready to order' : 'Currently sold out') + '</div>' +
      '<div class="detail-cta">' +
      '<a class="btn btn-wa" target="_blank" rel="noopener" href="' + waLink(p) + '">' + waIcon() + (p.available ? 'Buy on WhatsApp' : 'Enquire on WhatsApp') + '</a>' +
      '<button class="btn btn-outline" id="wishDetail">' + (isWished(p.sku) ? 'Saved to wishlist' : 'Add to wishlist') + '</button>' +
      '</div>' +
      accordion(specs) +
      '</div></div>' +
      ((p.videos && p.videos.length) ? '<div class="prod-videos"><div class="eyebrow">Watch</div><div class="pv-grid">' + p.videos.slice(0, 2).map(function (u) { return '<video controls preload="metadata" playsinline src="' + esc(u) + '"></video>'; }).join('') + '</div></div>' : '') +
      '<div id="prodReviews" class="prod-reviews"></div>' +
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
        preload('images/' + p.sku + suf + '.jpg', function (ok) {
          if (ok) { var u = 'images/' + p.sku + suf + '.jpg'; if (list.indexOf(u) < 0) extra[k] = u; }
          if (--pend === 0) setupGallery(list.concat(extra.filter(Boolean)));
        });
      });
      if (pend === 0) setupGallery(list);
    });

    // crumbs + wishlist + related
    host.querySelector('[data-home]').addEventListener('click', goHome);
    host.querySelector('[data-shop]').addEventListener('click', function () { goShop('All'); });
    var wd = $('#wishDetail');
    wd.addEventListener('click', function () { toggleWish(p.sku); wd.textContent = isWished(p.sku) ? 'Saved to wishlist' : 'Add to wishlist'; });
    setupAccordion(host);
    if (related.length) { var rg = $('#relGrid'); related.forEach(function (rp, i) { rg.appendChild(productCard(rp, i, false)); }); }
    if (recentItems.length) { var cg = $('#recGrid'); recentItems.forEach(function (rp, i) { cg.appendChild(productCard(rp, i, false)); }); }
    renderProductReviews(p.sku);
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
    return 'A considered piece from the Vaultique edit' + tail +
      ' Thoughtfully selected for quality and quiet sophistication. To purchase, arrange payment and nationwide delivery or collection directly with us on WhatsApp.';
  }
  function accordion(specs) {
    return '<div class="accordion">' +
      accItem('Product details',
        '<table class="spec-table">' + specs.map(function (r) {
          return '<tr><td class="l">' + esc(r[0]) + '</td><td class="r">' + esc(r[1]) + '</td></tr>';
        }).join('') + '</table>') +
      accItem('Delivery & collection',
        'We deliver nationwide across Zambia where possible, with fees calculated by distance and confirmed on WhatsApp before dispatch. Collection in person can also be arranged. Payment by Airtel Money, MTN Money, bank transfer or cash.') +
      accItem('Returns & assistance',
        'If something is not right, message us on WhatsApp within a reasonable time of receipt and we will make it right. Our team is happy to advise on sizing, fit and styling before you buy.') +
      '</div>';
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
    document.body.classList.toggle('on-home', which === 'home');
    updateHeader();
  }
  function goHome() { location.hash = ''; }
  function goShop(cat) {
    mode = 'shop';
    location.hash = '#/shop' + (cat && cat !== 'All' ? '/' + encodeURIComponent(cat) : '');
  }
  function route() {
    closeMobile(); closeSearch();
    var h = location.hash;
    var pm = h.match(/^#\/product\/(.+)$/);
    if (pm) { renderDetail(decodeURIComponent(pm[1])); return; }
    var polm = h.match(/^#\/policies(?:\/([^?]+))?$/);
    if (polm) { renderPolicies(polm[1] ? decodeURIComponent(polm[1]) : null); showView('policies'); window.scrollTo(0, 0); return; }
    if (h === '#/wishlist') {
      mode = 'wishlist'; filterCat = 'All'; searchTerm = '';
      var si = $('#shopSearch'); if (si) si.value = '';
      updateShopTitle(); renderChips(); renderGrid(); showView('shop'); window.scrollTo(0, 0); return;
    }
    var sm = h.match(/^#\/shop(?:\/(.+))?$/);
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
      r.innerHTML = '<span><span class="nm serif">' + esc(p.name) + '</span> &nbsp;<span style="opacity:.6;font-size:12px;letter-spacing:.1em">' + esc(p.category) + '</span></span><span class="px serif">' + formatPrice(p.price) + '</span>';
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
    { name: 'Vaultique Structured Tote', sku: 'BG-VATO-NV-OS', category: 'Bags', price: 1180, size: 'One size', color: 'Navy', material: 'Leather', available: false },
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
      e.addEventListener('click', function () { var id = e.getAttribute('data-scroll'); var t = document.getElementById(id); if (location.hash) { location.hash = ''; setTimeout(function () { if (t) t.scrollIntoView({ behavior: 'smooth' }); }, 60); } else if (t) t.scrollIntoView({ behavior: 'smooth' }); });
    });
    $('#menuBtn').addEventListener('click', openMobile);
    $('#mmClose').addEventListener('click', closeMobile);
    $('#searchBtn').addEventListener('click', openSearch);
    $('#soClose').addEventListener('click', closeSearch);
    $('#wishBtn').addEventListener('click', function () { location.hash = '#/wishlist'; });
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
    if (srb) srb.addEventListener('click', function () { openReviewForm(null); });
    var rvm = $('#reviewModal');
    if (rvm) rvm.addEventListener('click', function (e) { if (e.target === this) closeReviewModal(); });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closeSearch(); closeMobile(); closeQuickView(); closeLightbox(); closeReviewModal(); }
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
  }
  function bindEmailIg() {
    $all('[data-email]').forEach(function (a) {
      var addr = a.getAttribute('data-email') || EMAIL;
      a.href = 'mailto:' + addr;
      if (a.hasAttribute('data-email-text')) a.textContent = addr;
    });
    if (IG_HANDLE) $all('[data-ig]').forEach(function (a) { a.href = 'https://instagram.com/' + IG_HANDLE; });
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
    if (Array.isArray(c.testimonials)) {
      $all('#testiGrid .testi').forEach(function (cell, i) {
        var v = c.testimonials[i]; if (!v) return;
        var q = cell.querySelector('p'), who = cell.querySelector('.who');
        if (q && v.quote) q.textContent = v.quote;
        if (who) who.innerHTML = '<b>' + esc(v.name || '') + '</b>' + (v.city ? ' · ' + esc(v.city) : '');
      });
    }
    if (c.hours) { setText('#hoursVal', c.hours); setText('#footHours', c.hours); }
    if (Array.isArray(c.payments) && c.payments.length) {
      var pr = $('#payRow'); if (pr) pr.innerHTML = c.payments.map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('');
    }
    if (c.waShop) { WA_SHOP = String(c.waShop).replace(/[^0-9]/g, ''); setText('#waShopNum', c.waShop); }
    if (c.waEnquiry) { WA_ENQUIRY = String(c.waEnquiry).replace(/[^0-9]/g, ''); setText('#waEnqNum', c.waEnquiry); }
    if (c.email) EMAIL = c.email;
    if (c.ig) IG_HANDLE = String(c.ig).replace(/^@/, '');
    if (c.tagline) { setText('#footTagline', c.tagline); }
    if (c.care) {
      setText('#careSizeTitle', c.care.sizeTitle); setText('#careSizeBody', c.care.sizeBody);
      setText('#careDeliveryTitle', c.care.deliveryTitle); setText('#careDeliveryBody', c.care.deliveryBody);
      setText('#careReturnsTitle', c.care.returnsTitle); setText('#careReturnsBody', c.care.returnsBody);
    }
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

  // ---------------- website REST helpers ----------------
  function webBase() { return WEB.SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/'; }
  function webHeaders(extra) {
    var h = { apikey: WEB.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + WEB.SUPABASE_ANON_KEY };
    if (extra) { for (var k in extra) h[k] = extra[k]; }
    return h;
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
    var avgEl = $('#reviewsAvg');
    if (avgEl) {
      avgEl.innerHTML = list.length
        ? starsHtml(avgRating(list), 'stars lg') + ' <span class="avg-n">' + avgRating(list).toFixed(1) + ' / 5 · ' + list.length + ' review' + (list.length > 1 ? 's' : '') + '</span>'
        : '';
    }
    host.innerHTML = '';
    if (!list.length) {
      host.innerHTML = '<div class="reviews-empty"><p class="serif">No reviews yet</p><p>Be the first to share your experience.</p></div>';
      return;
    }
    list.slice(0, 6).forEach(function (r) {
      var d = el('div', 'testi reveal');
      d.innerHTML = '<div class="mark serif">&ldquo;</div><p>' + esc(r.comment || '') + '</p>' + starsHtml(r.rating) +
        '<div class="who"><b>' + esc(r.name) + '</b>' + (r.verified ? ' · <span class="verified">Verified</span>' : '') + '</div>';
      host.appendChild(d);
    });
    observeReveals();
  }
  function renderProductReviews(sku) {
    var host = $('#prodReviews'); if (!host) return;
    var list = reviewsFor(sku), avg = avgRating(list);
    host.innerHTML =
      '<div class="pr-head"><div><div class="eyebrow">Reviews</div><h2 class="serif" style="font-size:clamp(24px,3.4vw,34px)">Customer reviews</h2></div>' +
      '<button class="btn btn-outline btn-sm" id="prWrite">Write a review</button></div>' +
      (list.length
        ? '<div class="pr-avg">' + starsHtml(avg, 'stars lg') + ' <span class="avg-n">' + avg.toFixed(1) + ' / 5 · ' + list.length + ' review' + (list.length > 1 ? 's' : '') + '</span></div>'
        : '<p class="pr-none">No reviews yet for this piece. Be the first to review it.</p>') +
      '<div class="pr-list">' + list.map(function (r) {
        return '<div class="pr-item">' + starsHtml(r.rating) + '<p>' + esc(r.comment || '') + '</p><div class="who"><b>' + esc(r.name) + '</b>' + (r.verified ? ' · <span class="verified">Verified</span>' : '') + '</div></div>';
      }).join('') + '</div>';
    var w = $('#prWrite'); if (w) w.addEventListener('click', function () { openReviewForm(sku); });
  }
  function openReviewForm(sku) {
    var modal = $('#reviewModal'), body = $('#reviewBody'); if (!modal) return;
    body.innerHTML =
      '<button class="qv-close" id="rvClose" aria-label="Close">&times;</button>' +
      '<div class="c">' + (sku ? 'Your feedback' : 'Tell others about us') + '</div>' +
      '<h3 class="serif">' + (sku ? 'Write a review' : 'Review Vaultique') + '</h3>' +
      '<div class="rv-stars" id="rvStars">' + [1, 2, 3, 4, 5].map(function (i) { return '<span data-v="' + i + '">\u2605</span>'; }).join('') + '</div>' +
      '<label class="rv-lbl">Your name</label><input type="text" id="rvName" maxlength="60" autocomplete="name">' +
      '<label class="rv-lbl">Your review</label><textarea id="rvComment" maxlength="1000" rows="4"></textarea>' +
      '<div class="rv-actions"><button class="btn btn-navy" id="rvSubmit">Submit review</button><span class="rv-msg" id="rvMsg"></span></div>';
    var rating = 5, stars = $all('#rvStars span');
    function paint() { stars.forEach(function (s, i) { s.classList.toggle('on', i < rating); }); }
    stars.forEach(function (s) { s.addEventListener('click', function () { rating = Number(s.getAttribute('data-v')); paint(); }); });
    paint();
    $('#rvClose').addEventListener('click', closeReviewModal);
    $('#rvSubmit').addEventListener('click', function () {
      var name = $('#rvName').value.trim(), comment = $('#rvComment').value.trim(), msg = $('#rvMsg');
      if (!name) { msg.textContent = 'Please enter your name.'; msg.className = 'rv-msg err'; return; }
      if (!WEB) { msg.textContent = 'Reviews are not enabled yet.'; msg.className = 'rv-msg err'; return; }
      msg.textContent = 'Submitting…'; msg.className = 'rv-msg';
      var rec = { name: name, rating: rating, comment: comment }; if (sku) rec.sku = sku;
      webPost('reviews', rec).then(function () {
        REVIEWS.unshift({ sku: sku || null, name: name, rating: rating, comment: comment, verified: false, created_at: new Date().toISOString() });
        msg.textContent = 'Thank you! Your review is posted.'; msg.className = 'rv-msg ok';
        if (sku) renderProductReviews(sku); else renderSiteReviews();
        setTimeout(closeReviewModal, 1100);
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
  function initNewsletter() {
    var form = $('#nlForm'); if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = $('#nlEmail').value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { $('#nlEmail').focus(); return; }
      var done = function () { form.classList.add('hide'); $('#nlSuccess').classList.add('show'); };
      if (WEB) { webPost('subscribers', { email: email }).then(done).catch(done); }
      else { done(); }
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
      '<p>Our terms, policies and customer information for shopping with Vaultique Boutique. If anything is unclear, message us and we will gladly help.</p></div>';
    if (!order.length) { html += '<p class="pr-none">Policies are being updated. Please check back soon.</p>'; }
    order.forEach(function (s) {
      html += '<section class="pol-section"><h2 class="serif pol-sec-title">' + esc(s) + '</h2><div class="pol-list">';
      groups[s].forEach(function (p) {
        var sg = slug(p.title);
        html += '<details class="pol-item" id="pol-' + sg + '" data-slug="' + sg + '"><summary>' + esc(p.title) + '<span class="pol-ar" aria-hidden="true">+</span></summary><div class="pol-body">' + policyBodyHtml(p.body) + '</div></details>';
      });
      html += '</div></section>';
    });
    html += '<div class="pol-help"><p class="serif">Still have a question?</p><a class="btn btn-wa" data-wa="Hello Vaultique Boutique, I have a question about your policies.">Ask on WhatsApp</a></div></div>';
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
    bindStatic();
    initHero();
    initCarousels();
    initNewsletter();
    observeReveals();
    window.addEventListener('scroll', updateHeader, { passive: true });
    window.addEventListener('hashchange', route);
    updateHeader();
    load();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
