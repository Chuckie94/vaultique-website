/* =====================================================================
   Vaultique Boutique Point — "Where are you browsing from?"
   ---------------------------------------------------------------------
   WHY IT ASKS. The map in Admin > Analytics places a visit from its
   internet connection, and Zambia's mobile networks send everybody
   through Lusaka: somebody browsing in Livingstone on mobile data is
   "Lusaka" to every website. The only way to know a visitor's real town
   is for them to say, so this asks, once, politely, and only somebody
   who has been looking around for a little while.

   HOW. A small card at the bottom of the screen: one tap on a town, or
   "Somewhere else" for Country, then Province, then Town. ✕ puts it
   away; it is not asked again on that phone for sixty days. An answer
   is remembered on the phone (localStorage) and every later visit from
   it is counted in that town, so nobody is ever asked twice.

   WHO IS NEVER ASKED. Anybody assets/analytics.js is not counting: the
   shop's own devices, a browser that asked not to be tracked, a robot.
   And nobody at all while the shop has it switched off (Settings >
   Shopping > Where visitors browse from).

   WHAT IS SENT. The id of the town picked, from the shop's own list of
   the world's towns (netlify/functions/_places.js). Nothing else: no
   GPS, no address, nothing typed. Somebody who never answers is counted
   exactly as before, from their connection.
   ===================================================================== */
(function () {
  'use strict';

  var KEY = 'vbp_place';                 // { id, name, at } once answered
  var SKIP = 'vbp_place_skip';           // when ✕ was pressed
  var SKIP_DAYS = 60;
  var AFTER_MS = 20000;                  // twenty seconds of looking around,
  var MIN_MS = 6000;                     // or two pages after six seconds
  var FN = '/.netlify/functions/places';

  /* If the lists cannot be reached, these still work: they are the same
     towns the server offers a visitor in Zambia. */
  var FALLBACK = [
    { id: '909137', name: 'Lusaka' }, { id: '911148', name: 'Kitwe' }, { id: '901344', name: 'Ndola' },
    { id: '910111', name: 'Livingstone' }, { id: '916095', name: 'Kabwe' }, { id: '918702', name: 'Chipata' }
  ];

  var cfg = { enabled: false, title: '', note: '' };
  var started = false, box = null, body = null, watch = null, resizer = null;

  function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function write(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function answered() {
    try { var v = JSON.parse(read(KEY) || 'null'); return !!(v && v.id); } catch (e) { return false; }
  }
  function putAwayRecently() {
    var t = Number(read(SKIP) || 0);
    return !!t && (Date.now() - t) < SKIP_DAYS * 86400000;
  }
  /* The visit counter, but only when it is actually counting this visitor. */
  function tracker() {
    var t = window.VBP_TRACK;
    return t && t.counting === true && typeof t.where === 'function' ? t : null;
  }
  /* Something else has the visitor's attention. */
  function busy() {
    return !!document.querySelector('.modal.open, .search-overlay.open, .mobile-menu.open, .chat-panel.open, .lightbox.open');
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function getJSON(q) {
    return fetch(FN + q, { credentials: 'omit' }).then(function (r) {
      if (!r.ok) throw new Error('places ' + r.status);
      return r.json();
    });
  }

  /* ---- when to ask ---------------------------------------------------- */

  function start() {
    if (started) return;
    started = true;
    if (!cfg.enabled || answered() || putAwayRecently()) return;
    var t0 = Date.now();
    var timer = setInterval(function () {
      var tr = tracker();
      /* Not counted, so not asked. The counter loads by itself; give it a
         minute to say so before giving up for this page. */
      if (!tr) { if (Date.now() - t0 > 60000) clearInterval(timer); return; }
      var waited = Date.now() - t0;
      var pages = 0;
      try { pages = Number(tr.pages()) || 0; } catch (e) {}
      if (!(waited >= AFTER_MS || (pages >= 2 && waited >= MIN_MS))) return;
      if (document.hidden || busy()) return;
      clearInterval(timer);
      open();
    }, 1000);
  }

  function open() {
    if (box || answered()) return;
    getJSON('?near=1').then(function (d) {
      build(d && d.country, (d && d.quick && d.quick.length) ? d.quick : FALLBACK);
    }, function () { build(null, FALLBACK); });
  }

  /* ---- the card --------------------------------------------------------- */

  function build(country, quick) {
    if (box || answered()) return;
    var title = cfg.title || 'Where are you browsing from?';
    box = el('div', 'wq');
    box.setAttribute('role', 'region');
    box.setAttribute('aria-label', title);
    var x = el('button', 'wq-x', '×');
    x.type = 'button';
    x.setAttribute('aria-label', 'Not now');
    x.addEventListener('click', putAway);
    box.appendChild(x);
    box.appendChild(el('p', 'wq-t serif', title));
    box.appendChild(el('p', 'wq-n', cfg.note ||
      'One tap helps us know where our customers are. We will not ask again.'));
    body = el('div', 'wq-body');
    box.appendChild(body);
    drawChips(country, quick);
    document.body.appendChild(box);

    document.addEventListener('keydown', onKey);
    /* The floating buttons step up out of its way on a phone, by however
       tall it is at the moment. */
    lift();
    if (window.ResizeObserver) { resizer = new ResizeObserver(lift); resizer.observe(box); }
    /* Out of the way while something else is open, back afterwards. */
    watch = setInterval(function () { if (box) box.classList.toggle('wq-away', busy()); }, 600);
    requestAnimationFrame(function () { requestAnimationFrame(function () { if (box) box.classList.add('in'); }); });
  }

  function drawChips(country, quick) {
    body.innerHTML = '';
    var row = el('div', 'wq-chips');
    quick.forEach(function (q) {
      var b = el('button', 'wq-chip', q.name);
      b.type = 'button';
      if (q.sub) b.title = q.sub;
      b.addEventListener('click', function () { choose(q); });
      row.appendChild(b);
    });
    var other = el('button', 'wq-chip wq-else', 'Somewhere else…');
    other.type = 'button';
    other.addEventListener('click', function () { drawLists(country, quick); });
    row.appendChild(other);
    body.appendChild(row);
    lift();
  }

  /* Country, then province or state, then town. */
  function drawLists(country, quick) {
    body.innerHTML = '';
    var wrap = el('div', 'wq-pick');
    function field(label, id) {
      var l = el('label', 'wq-lbl', label);
      l.setAttribute('for', id);
      var s = el('select', 'wq-sel');
      s.id = id;
      wrap.appendChild(l);
      wrap.appendChild(s);
      return s;
    }
    var sc = field('Country', 'wq_country');
    var sp = field('Province or state', 'wq_prov');
    var st = field('Town or city', 'wq_town');
    var msg = el('p', 'wq-msg');
    var back = el('button', 'wq-back', '← Back');
    back.type = 'button';
    back.addEventListener('click', function () { drawChips(country, quick); });
    wrap.appendChild(msg);
    wrap.appendChild(back);
    body.appendChild(wrap);

    function fill(sel, placeholder, items, value, labelOf) {
      sel.innerHTML = '';
      var o = el('option', null, placeholder);
      o.value = '';
      sel.appendChild(o);
      items.forEach(function (it) {
        var op = el('option', null, labelOf(it));
        op.value = value(it);
        sel.appendChild(op);
      });
      sel.disabled = !items.length;
    }
    function failed() { msg.textContent = 'The list could not be loaded just now. Please try again.'; }

    fill(sp, 'Choose the country first', [], null, null);
    fill(st, 'Choose the province first', [], null, null);

    function loadProvinces(cc) {
      msg.textContent = '';
      fill(sp, 'Loading…', [], null, null);
      fill(st, 'Choose the province first', [], null, null);
      if (!cc) { fill(sp, 'Choose the country first', [], null, null); return; }
      getJSON('?cc=' + encodeURIComponent(cc)).then(function (d) {
        if (sc.value !== cc) return;
        fill(sp, 'Choose your province or state', (d && d.provinces) || [],
          function (p) { return p.code; }, function (p) { return p.name; });
      }, failed);
    }
    function loadTowns(cc, code) {
      msg.textContent = '';
      fill(st, 'Loading…', [], null, null);
      if (!code) { fill(st, 'Choose the province first', [], null, null); return; }
      getJSON('?cc=' + encodeURIComponent(cc) + '&p=' + encodeURIComponent(code)).then(function (d) {
        if (sp.value !== code) return;
        fill(st, 'Choose your town or city', (d && d.towns) || [],
          function (t) { return t.id; }, function (t) { return t.name; });
      }, failed);
    }

    fill(sc, 'Loading…', [], null, null);
    getJSON('?list=countries').then(function (d) {
      fill(sc, 'Choose your country', (d && d.countries) || [],
        function (c) { return c.cc; }, function (c) { return c.name; });
      /* Start on the country the connection suggests (Zambia when it says
         nothing): most visitors only have to choose the province and town. */
      var first = /^[A-Z]{2}$/.test(country || '') ? country : 'ZM';
      if (sc.querySelector('option[value="' + first + '"]')) { sc.value = first; loadProvinces(first); }
    }, failed);

    sc.addEventListener('change', function () { loadProvinces(sc.value); });
    sp.addEventListener('change', function () { loadTowns(sc.value, sp.value); });
    lift();
    st.addEventListener('change', function () {
      if (!st.value) return;
      var label = st.options[st.selectedIndex] ? st.options[st.selectedIndex].text : '';
      choose({ id: st.value, name: label });
    });
    try { sc.focus(); } catch (e) {}
  }

  /* ---- the answer ------------------------------------------------------- */

  function choose(q) {
    write(KEY, JSON.stringify({ id: String(q.id), name: String(q.name || ''), at: Date.now() }));
    var tr = tracker();
    if (tr) { try { tr.where(String(q.id)); } catch (e) {} }
    body.innerHTML = '';
    var said = String(q.name || '').replace(/^Somewhere else in /, '');
    body.appendChild(el('p', 'wq-thanks', 'Thank you' + (said ? ' — ' + said + '.' : '.')));
    lift();
    setTimeout(close, 1800);
  }

  function putAway() {
    write(SKIP, String(Date.now()));
    close();
  }

  function onKey(e) { if (e.key === 'Escape' && box && !busy()) putAway(); }

  function lift() {
    if (!box || !box.parentNode) return;
    try {
      document.documentElement.style.setProperty('--wq-h', (box.offsetHeight + 12) + 'px');
      document.body.classList.add('wq-on');
    } catch (e) {}
  }

  function close() {
    if (!box) return;
    var b = box;
    box = null;
    clearInterval(watch);
    if (resizer) { try { resizer.disconnect(); } catch (e) {} resizer = null; }
    document.removeEventListener('keydown', onKey);
    document.body.classList.remove('wq-on');
    b.classList.remove('in');
    setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 500);
  }

  window.VBP_WHERE = {
    /* From Settings > Shopping, by assets/app.js. */
    configure: function (o) {
      o = o || {};
      cfg.enabled = !!o.enabled;
      cfg.title = String(o.title || '').slice(0, 80);
      cfg.note = String(o.note || '').slice(0, 200);
    },
    start: function () { try { start(); } catch (e) {} }
  };
})();
