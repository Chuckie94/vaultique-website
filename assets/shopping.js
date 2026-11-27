/* =====================================================================
   Vaultique Boutique Point — shopping (website build 90)
   ---------------------------------------------------------------------
   The customer portal's shopping build (PLAN-CUSTOMER-PORTAL, website 90,
   from the owner's screenshot B), the parts that live on the shop's own
   pages. The account's pages for them are in assets/account.js.

     Compare      two to four pieces side by side: Compare on a piece's
                  page, a small bar while some are chosen, and /compare.
                  Kept on this device. Settings > Shopping, on unless
                  switched off.
     Alerts       "Email me when it's back" on a sold-out piece, "Email me
                  if the price drops" on one in stock: for a signed-in
                  customer, sent once by netlify/functions/product-alerts.js
                  (supabase-shopping.sql). Settings > Customer Accounts.
     Questions    the shop's published answers on a piece's page, and Ask
                  a question, which opens the live chat with the piece
                  named. The shop publishes answers in Admin > Reviews.
     A gift list  /gift/<key>: a customer's wishlist, shared by them from
                  their account; the pieces and their first name, nothing
                  else. Not indexed by search engines.
     Sizes        a signed-in customer's sizes (their account's Shopping
                  preferences) marked on a piece's size picker, and "My
                  sizes" in the shop.

   Nothing here prices, sells or holds anything: pieces go to the cart
   through the shop's own addToCart, priced as always. app.js hands this
   file what it needs (init) and calls it at the few places it draws.
   ===================================================================== */
(function () {
  'use strict';

  var H = {};
  var COMPARE_KEY = 'vbp_compare';
  var COMPARE_MAX = 4;

  function init(hooks) { H = hooks || {}; }

  /* ---------------------------------------------------------- small help */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function store() {
    try { return window.localStorage; } catch (e) { return null; }
  }
  function shop() { return (H.settings && H.settings().shop) || {}; }
  function accounts() { return (H.settings && H.settings().accounts) || {}; }
  function acct() { return window.VBP_ACCOUNT || null; }
  function signedIn() { var A = acct(); return !!(A && A.enabled && A.enabled() && A.signedIn && A.signedIn()); }
  function client() { return H.client ? H.client() : null; }
  function missingFn(err) {
    return /PGRST202|Could not find the function|does not exist|PGRST205|Could not find the table/i.test(String((err && (err.message || err.code)) || err || ''));
  }

  /* ------------------------------------------------------------ compare */
  function compareOn() { return shop().compare !== false; }
  function compareList() {
    var s = store(), raw = null;
    try { raw = s && s.getItem(COMPARE_KEY); } catch (e) { raw = null; }
    var list = [];
    try { list = JSON.parse(raw || '[]'); } catch (e) { list = []; }
    if (!Array.isArray(list)) list = [];
    return list.filter(function (x) { return typeof x === 'string' && x; }).slice(0, COMPARE_MAX);
  }
  function compareSave(list) {
    var s = store();
    try { if (s) s.setItem(COMPARE_KEY, JSON.stringify(list.slice(0, COMPARE_MAX))); } catch (e) { /* this device keeps nothing */ }
    paintCompareBar();
    document.querySelectorAll('[data-compare-sku]').forEach(paintCompareBtn);
  }
  function compareHas(sku) { return compareList().indexOf(sku) > -1; }
  /* Returns false when it could not be added (four already chosen). */
  function compareToggle(sku) {
    var list = compareList();
    var i = list.indexOf(sku);
    if (i > -1) { list.splice(i, 1); compareSave(list); return true; }
    if (list.length >= COMPARE_MAX) return false;
    list.push(sku);
    compareSave(list);
    return true;
  }
  function paintCompareBtn(b) {
    var on = compareHas(b.getAttribute('data-compare-sku'));
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.textContent = on ? 'Comparing ✓' : 'Compare';
  }
  function compareButton(p) {
    if (!compareOn() || !p) return null;
    var b = el('button', 'btn btn-outline cmp-btn');
    b.type = 'button';
    b.setAttribute('data-compare-sku', p.sku);
    paintCompareBtn(b);
    b.addEventListener('click', function () {
      if (!compareToggle(p.sku)) {
        b.textContent = 'Four at most: remove one first';
        clearTimeout(b._t);
        b._t = setTimeout(function () { paintCompareBtn(b); }, 1800);
        return;
      }
      paintCompareBtn(b);
    });
    return b;
  }
  var onComparePage = false;
  function paintCompareBar() {
    var bar = document.getElementById('cmpBar');
    var list = compareOn() ? compareList() : [];
    if (!list.length || onComparePage) { if (bar) bar.classList.add('hide'); return; }
    if (!bar) {
      bar = el('div', 'cmp-bar hide');
      bar.id = 'cmpBar';
      bar.setAttribute('role', 'region');
      bar.setAttribute('aria-label', 'Pieces to compare');
      var go = el('a', 'cmp-go');
      go.href = '/compare';
      go.addEventListener('click', function (e) {
        if (!H.go || e.ctrlKey || e.metaKey) return;
        e.preventDefault();
        H.go('compare');
      });
      var x = el('button', 'cmp-x', '×');
      x.type = 'button';
      x.setAttribute('aria-label', 'Clear the pieces to compare');
      x.addEventListener('click', function () { compareSave([]); });
      bar.appendChild(go);
      bar.appendChild(x);
      document.body.appendChild(bar);
    }
    var go2 = bar.querySelector('.cmp-go');
    go2.textContent = list.length < 2 ? 'Compare: choose one more' : 'Compare ' + list.length + ' pieces';
    bar.classList.remove('hide');
  }

  /* /compare: the chosen pieces in columns, their details in rows. */
  function renderCompare(host) {
    onComparePage = true;
    paintCompareBar();
    var list = compareList().map(function (s) { return H.bySku ? H.bySku(s) : null; }).filter(Boolean);
    host.innerHTML = '';
    var wrap = el('div', 'wrap cmp-wrap');
    var crumbs = el('div', 'crumbs');
    crumbs.innerHTML = '<a data-home>Home</a> / <a data-shop>Shop</a> / Compare';
    wrap.appendChild(crumbs);
    wrap.appendChild(el('h1', 'serif cmp-title', 'Compare'));
    if (list.length < 2) {
      wrap.appendChild(el('p', 'cmp-lead', list.length
        ? 'Choose one more piece: press Compare on its page. You can compare up to four.'
        : 'Choose two to four pieces to compare: press Compare on each piece\'s page.'));
      var back = el('a', 'btn btn-gold cmp-shop', 'Go to the shop');
      back.href = '/shop';
      back.addEventListener('click', function (e) { if (!H.go) return; e.preventDefault(); H.go('shop'); });
      wrap.appendChild(back);
      host.appendChild(wrap);
      bindCrumbs(host);
      return;
    }
    wrap.appendChild(el('p', 'cmp-lead', 'Side by side, as the shop has them now.'));
    var rows = [
      ['Price', function (p) { var v = H.priceOf(p); return v.onRequest ? v.nowText : v.nowText + (v.wasText ? ' (was ' + v.wasText + ')' : ''); }],
      ['Availability', function (p) { return p.available ? (p.lowStock && shop().showLowStock !== false ? 'In stock, only a few left' : 'In stock') : 'Sold out'; }],
      ['Category', function (p) { return p.category; }],
      ['Brand', function (p) { return p.brand; }],
      ['Size', function (p) { return p.size; }],
      ['Colour', function (p) { return p.color; }],
      ['Material', function (p) { return p.material; }]
    ];
    /* Then every detail the platform sends for any of them, in the order
       the first piece that has it gives it. */
    var labels = [];
    list.forEach(function (p) {
      (H.detailRows ? H.detailRows(p) : []).forEach(function (r) { if (labels.indexOf(r[0]) < 0) labels.push(r[0]); });
    });
    labels.forEach(function (lab) {
      if (rows.some(function (r) { return r[0] === lab; })) return;
      rows.push([lab, function (p) {
        var hit = (H.detailRows ? H.detailRows(p) : []).filter(function (r) { return r[0] === lab; })[0];
        return hit ? hit[1] : '';
      }]);
    });
    rows = rows.filter(function (r) { return list.some(function (p) { return !!r[1](p); }); });

    var scroll = el('div', 'cmp-scroll');
    scroll.setAttribute('tabindex', '0');
    scroll.setAttribute('aria-label', 'The pieces side by side; scroll sideways on a small screen');
    var t = el('table', 'cmp-table');
    var head = el('tr');
    head.appendChild(el('th', 'cmp-corner'));
    list.forEach(function (p) {
      var th = el('th', 'cmp-piece');
      th.setAttribute('scope', 'col');
      var a = el('a', 'cmp-pic');
      a.href = '/product/' + encodeURIComponent(p.sku);
      a.addEventListener('click', function (e) { if (!H.go) return; e.preventDefault(); H.go('product/' + encodeURIComponent(p.sku)); });
      var img = el('img');
      img.alt = p.name;
      img.loading = 'lazy';
      if (H.imgChain) H.imgChain(img, p);
      a.appendChild(img);
      th.appendChild(a);
      var nm = el('a', 'cmp-name', p.name);
      nm.href = a.href;
      nm.addEventListener('click', function (e) { if (!H.go) return; e.preventDefault(); H.go('product/' + encodeURIComponent(p.sku)); });
      th.appendChild(nm);
      head.appendChild(th);
    });
    t.appendChild(head);
    rows.forEach(function (r) {
      var tr = el('tr');
      var th = el('th', 'cmp-lab', r[0]);
      th.setAttribute('scope', 'row');
      tr.appendChild(th);
      list.forEach(function (p) { tr.appendChild(el('td', '', r[1](p) || '—')); });
      t.appendChild(tr);
    });
    var acts = el('tr', 'cmp-acts');
    acts.appendChild(el('th', 'cmp-lab'));
    list.forEach(function (p) {
      var td = el('td');
      if (H.canBuy && H.canBuy(p) && H.cartButton) td.appendChild(H.cartButton(p));
      var rm = el('button', 'cmp-rm', 'Remove');
      rm.type = 'button';
      rm.addEventListener('click', function () { compareToggle(p.sku); renderCompare(host); });
      td.appendChild(rm);
      acts.appendChild(td);
    });
    t.appendChild(acts);
    scroll.appendChild(t);
    wrap.appendChild(scroll);
    host.appendChild(wrap);
    bindCrumbs(host);
  }
  function leaveCompare() { onComparePage = false; paintCompareBar(); }
  function bindCrumbs(host) {
    var h = host.querySelector('[data-home]'), s = host.querySelector('[data-shop]');
    if (h) h.addEventListener('click', function () { if (H.go) H.go(''); });
    if (s) s.addEventListener('click', function () { if (H.go) H.go('shop'); });
  }

  /* ------------------------------------------------------------- alerts */
  function alertsOn() { return accounts().accountsEnabled !== false && accounts().productAlerts !== false; }
  var MINE = null;          // this customer's alerts, read once a page
  var MINE_FOR = '';
  function myAlerts() {
    var A = acct(), sb = client();
    var who = (A && A.state && A.state.user && A.state.user.id) || '';
    if (!sb || !who) return Promise.resolve(null);
    if (MINE && MINE_FOR === who) return MINE;
    MINE_FOR = who;
    MINE = Promise.resolve(sb.from('product_alerts').select('id,sku,kind,sent_at,price_at')).then(function (r) {
      if (r && r.error) return missingFn(r.error) ? null : [];
      return (r && r.data) || [];
    }, function () { return []; });
    return MINE;
  }
  function forget() { MINE = null; }
  /* The line under a piece's buttons: "Email me when it's back" for a sold
     out piece, "Email me if the price drops" for one in stock. Nothing for
     a piece priced on request, or with the alerts off. */
  function alertLine(p) {
    if (!p || !alertsOn() || !(acct() && acct().enabled && acct().enabled())) return null;
    var v = H.priceOf ? H.priceOf(p) : {};
    if (v.onRequest) return null;
    var kind = p.available ? 'price' : 'back';
    var box = el('div', 'alert-line');
    var b = el('button', 'alert-btn');
    b.type = 'button';
    b.setAttribute('data-alert-kind', kind);
    var msg = el('span', 'alert-msg');
    msg.setAttribute('aria-live', 'polite');
    var label = kind === 'back' ? 'Email me when it’s back' : 'Email me if the price drops';
    function paint(on, sent) {
      b.innerHTML = '';
      b.appendChild(bell());
      b.appendChild(document.createTextNode(on ? (kind === 'back' ? 'We’ll email you when it’s back' : 'We’ll email you if the price drops')
                                                 : label));
      b.classList.toggle('is-on', !!on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b._on = !!on;
      if (on) b.title = 'Press to stop the email';
      else b.removeAttribute('title');
      if (sent) msg.textContent = '';
    }
    paint(false);
    if (signedIn()) {
      myAlerts().then(function (list) {
        if (list === null) { box.classList.add('hide'); return; }      // supabase-shopping.sql not run yet
        var hit = (list || []).filter(function (a) { return a.sku === p.sku && a.kind === kind && !a.sent_at; })[0];
        b._id = hit ? hit.id : null;
        paint(!!hit);
      });
    }
    b.addEventListener('click', function () {
      msg.textContent = '';
      if (!signedIn()) {
        msg.innerHTML = '';
        var a = el('a', 'alert-signin', 'Sign in');
        a.href = '/account';
        a.addEventListener('click', function (e) { if (!H.go) return; e.preventDefault(); H.go('account'); });
        msg.appendChild(a);
        msg.appendChild(document.createTextNode(' to be emailed: the email goes to your account’s address.'));
        return;
      }
      var sb = client();
      if (!sb) return;
      b.disabled = true;
      if (b._on && b._id) {
        Promise.resolve(sb.from('product_alerts').delete().eq('id', b._id)).then(function (r) {
          b.disabled = false;
          if (r && r.error) { msg.textContent = 'That could not be stopped just now.'; return; }
          b._id = null; forget(); paint(false);
          msg.textContent = 'Stopped.';
        }, function () { b.disabled = false; msg.textContent = 'That could not be stopped just now.'; });
        return;
      }
      Promise.resolve(sb.rpc('alert_set', { p_sku: p.sku, p_kind: kind, p_name: p.name, p_price: kind === 'price' ? (v.now || null) : null }))
        .then(function (r) {
          b.disabled = false;
          var d = r && !r.error ? r.data : null;
          if (!d || !d.ok) {
            var why = d && d.why;
            msg.textContent = why === 'too_many' ? 'You have sixty alerts waiting already. Stop some in your account first.'
              : why === 'busy' ? 'That is a lot of alerts at once. Please try again later.'
              : why === 'no_email' ? 'Your account has no email address to send it to.'
              : why === 'signin' ? 'Please sign in again.'
              : (r && r.error && missingFn(r.error)) ? 'Email alerts are not ready yet.'
              : 'That could not be saved just now.';
            return;
          }
          b._id = d.id; forget(); paint(true);
          msg.textContent = 'Saved. We email you once' + (kind === 'back' ? ', when it is back in stock.' : ', if it costs less than now.');
        }, function () { b.disabled = false; msg.textContent = 'That could not be saved just now.'; });
    });
    box.appendChild(b);
    box.appendChild(msg);
    return box;
  }
  function bell() {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('class', 'alert-ic');
    s.innerHTML = '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>';
    return s;
  }

  /* ------------------------------------------------- questions & answers */
  function questionsBlock(p) {
    if (!p) return null;
    var box = el('div', 'qa');
    box.id = 'prodQuestions';
    var head = el('div', 'qa-head');
    var h = el('div');
    h.appendChild(el('div', 'eyebrow', 'Questions'));
    h.appendChild(el('h2', 'serif qa-title', 'Questions & answers'));
    head.appendChild(h);
    if (H.enquire && shop().enquiries !== false) {
      var ask = el('a', 'btn btn-outline btn-sm qa-ask');
      ask.href = '#';
      H.enquire(ask, 'I have a question about ' + p.name + ' (SKU: ' + p.sku + '): ', 'Ask a question');
      head.appendChild(ask);
    }
    box.appendChild(head);
    var list = el('div', 'qa-list');
    list.appendChild(el('p', 'qa-none', 'Loading…'));
    box.appendChild(list);
    var url = H.restUrl ? H.restUrl('product_questions?select=question,answer,created_at&published=eq.true&sku=eq.' +
                                    encodeURIComponent(p.sku) + '&order=sort.asc,created_at.asc') : null;
    (url ? fetch(url.href, { headers: url.headers }).then(function (r) { return r.ok ? r.json() : []; }) : Promise.resolve([]))
      .catch(function () { return []; })
      .then(function (rows) {
        list.innerHTML = '';
        if (!rows || !rows.length) {
          list.appendChild(el('p', 'qa-none', 'No questions yet. Ask us in the chat: we answer quickly, and may publish the answer here for others.'));
          return;
        }
        rows.forEach(function (q) {
          var it = el('div', 'qa-item');
          var qq = el('p', 'qa-q');
          qq.appendChild(el('b', '', 'Q '));
          qq.appendChild(document.createTextNode(q.question));
          var aa = el('p', 'qa-a');
          aa.appendChild(el('b', '', 'A '));
          aa.appendChild(document.createTextNode(q.answer));
          it.appendChild(qq);
          it.appendChild(aa);
          list.appendChild(it);
        });
      });
    return box;
  }

  /* --------------------------------------------------------- gift lists */
  function renderGift(host, token) {
    host.innerHTML = '';
    var wrap = el('div', 'wrap gift-wrap');
    var crumbs = el('div', 'crumbs');
    crumbs.innerHTML = '<a data-home>Home</a> / A gift list';
    wrap.appendChild(crumbs);
    var title = el('h1', 'serif gift-title', 'A gift list');
    wrap.appendChild(title);
    var lead = el('p', 'gift-lead', 'Loading…');
    wrap.appendChild(lead);
    var grid = el('div', 'grid gift-grid');
    wrap.appendChild(grid);
    host.appendChild(wrap);
    bindCrumbs(host);
    var call = H.rpc ? H.rpc('gift_list_get', { p_token: String(token || '') }) : Promise.reject(new Error('no'));
    call.then(function (d) {
      if (!d || !d.ok) {
        title.textContent = 'This gift list is not shared any more';
        lead.textContent = 'Whoever shared it has stopped sharing it, or the link is not complete. You can still look around the shop.';
        return;
      }
      var who = d.firstName ? d.firstName + '’s' : 'A';
      title.textContent = d.title || (who + ' gift list');
      lead.textContent = (d.note ? d.note + ' ' : '') +
        'Buying one as a present? Add it to your cart, and say it is a gift in the order’s notes.';
      var skus = Array.isArray(d.skus) ? d.skus : [];
      var pieces = skus.map(function (s) { return H.bySku ? H.bySku(s) : null; }).filter(Boolean);
      if (!pieces.length) {
        grid.appendChild(el('p', 'gift-none', 'There is nothing on this list just now.'));
        return;
      }
      pieces.forEach(function (p, i) { if (H.productCard) grid.appendChild(H.productCard(p, i, false)); });
    }, function () {
      title.textContent = 'This gift list could not be opened';
      lead.textContent = 'Please try again in a moment.';
    });
  }

  /* -------------------------------------------------------------- sizes */
  function prefs() {
    var A = acct();
    var pr = A && A.state && A.state.profile && A.state.profile.preferences;
    if (!pr || typeof pr !== 'object' || accounts().shoppingPrefs === false || !signedIn()) return { sizes: [], categories: [] };
    return { sizes: Array.isArray(pr.sizes) ? pr.sizes.map(String) : [],
             categories: Array.isArray(pr.categories) ? pr.categories.map(String) : [] };
  }
  /* The customer's sizes, marked on a piece's size picker. */
  function markSizes(host) {
    var mine = prefs().sizes;
    if (!host || !mine.length) return;
    var blocks = host.querySelectorAll('.opt-block');
    Array.prototype.forEach.call(blocks, function (b) {
      var lbl = b.querySelector('.lbl');
      if (!lbl || !/^size$/i.test(lbl.textContent.trim())) return;
      Array.prototype.forEach.call(b.querySelectorAll('.opt-pick, .opt-chip'), function (o) {
        if (mine.indexOf(o.textContent.trim()) > -1) {
          o.classList.add('opt-mine');
          o.setAttribute('title', 'Your size');
          if (!o.querySelector('.opt-mine-dot')) o.appendChild(el('span', 'opt-mine-dot'));
        }
      });
    });
  }
  /* "My sizes" in the shop: a piece in one of the customer's sizes, or one
     that comes in one size only. */
  function fitsMe(p) {
    var mine = prefs().sizes;
    if (!mine.length) return true;
    return !p.size || mine.indexOf(String(p.size)) > -1;
  }

  window.VBP_SHOPPING = {
    init: init,
    compareOn: compareOn, compareList: compareList, compareToggle: compareToggle, compareHas: compareHas,
    compareButton: compareButton, paintCompareBar: paintCompareBar, renderCompare: renderCompare, leaveCompare: leaveCompare,
    alertsOn: alertsOn, alertLine: alertLine, forgetAlerts: forget,
    questionsBlock: questionsBlock,
    renderGift: renderGift,
    prefs: prefs, markSizes: markSizes, fitsMe: fitsMe,
    COMPARE_MAX: COMPARE_MAX
  };
})();
