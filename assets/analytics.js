/* =====================================================================
   Vaultique Boutique Point — the storefront's own record of its traffic
   ---------------------------------------------------------------------
   Records that somebody looked at a page. Nothing else, and nothing
   about who.

   WHAT IT SENDS. Four fields carry the whole thing: a random token for
   this browser, a random token for this visit, which page, and when.
   Alongside them, only what the shop actually asked to see — the word
   'mobile', 'tablet' or 'desktop', the sku of a piece that was opened,
   and the HOST of the site a visitor arrived from. That is the complete
   list. There is no name, no email, no account, no cart, no internet
   address and no browser string: the user agent is read once, turned
   into one of three words, and thrown away.

   THE TWO TOKENS ARE NOT AN IDENTITY. They are random numbers made in
   this browser. They are not derived from anything about the person,
   they mean nothing on any other website, and they are never sent
   anywhere but this shop's own database. Clearing site data ends them
   and the visitor counts as somebody new, which is the honest answer:
   after that there is genuinely no way to tell.

   IT ASKS FIRST. A browser sending Global Privacy Control, or Do Not
   Track, is asking not to be counted, and this honours that and records
   nothing at all for that visit. A shop that would rather it did not
   can set ANALYTICS_HONOUR_DNT to false in config.js. Automated
   browsers are skipped too, so a crawler is not counted as a customer.

   HOW LITTLE IT COSTS. There is no library — this file talks to the
   REST endpoint with fetch and is the only thing it loads, ever. Events
   are gathered and sent as one request rather than one each. Nothing is
   sent while the page is still drawing. If the analytics tables have
   not been created, the first request says so and this file stops for
   the rest of the visit and never speaks again.

   NOTHING HERE CAN BREAK THE SHOP. Every entry point is wrapped, every
   failure is silent, and the whole file is one guard away from doing
   nothing at all. A storefront with this file deleted behaves in every
   respect as it does now.
   ===================================================================== */
(function () {
  'use strict';

  var cfg = window.VBP_CONFIG || {};
  var URL_BASE = String(cfg.SUPABASE_URL || '').replace(/\/+$/, '');
  var KEY = String(cfg.SUPABASE_ANON_KEY || '');

  /* Nothing to record to. This is the ordinary state of a shop that has
     not run supabase-analytics.sql, and it is not an error. */
  if (!URL_BASE || !KEY) return;

  /* ---- may we count this visit at all? ------------------------------ */

  /* Global Privacy Control is the one a browser sends on purpose; Do Not
     Track is the older one, and is read in all three of the places
     browsers have put it over the years. Either means no. */
  function askedNotToBe() {
    if (cfg.ANALYTICS_HONOUR_DNT === false) return false;
    try {
      if (navigator.globalPrivacyControl === true) return true;
      var dnt = navigator.doNotTrack || window.doNotTrack || navigator.msDoNotTrack;
      return dnt === '1' || dnt === 'yes' || dnt === 1;
    } catch (e) { return false; }
  }

  /* A crawler or a test runner is not a customer, and counting one as a
     customer makes every number on the page a little bit of a lie. */
  function isRobot() {
    try {
      if (navigator.webdriver) return true;
      return /bot|crawl|spider|slurp|headless|lighthouse|preview/i.test(navigator.userAgent || '');
    } catch (e) { return false; }
  }

  if (askedNotToBe() || isRobot()) return;

  /* ---- who and when, as far as this browser is concerned ------------- */

  var VISITOR_KEY = 'vbp_an_v';
  var SESSION_KEY = 'vbp_an_s';
  var VISIT_GAP = 30 * 60 * 1000;      // half an hour idle ends a visit

  /* Random, and made here. crypto is used where it exists because it is
     the right tool; the fallback is not a security boundary — nothing
     about this token needs to be unguessable, only unique enough not to
     collide with the shop's other visitors. */
  function token() {
    try {
      var a = new Uint8Array(16);
      crypto.getRandomValues(a);
      var out = '';
      for (var i = 0; i < a.length; i++) out += (a[i] + 256).toString(16).slice(1);
      return out;
    } catch (e) {
      return (Date.now().toString(36) + Math.random().toString(36).slice(2) +
              Math.random().toString(36).slice(2)).slice(0, 32);
    }
  }

  /* Storage that is switched off, full, or refused in a private window
     is not a reason to fail. It is a reason to count this visit and
     forget it afterwards, which is what the fallbacks below do. */
  function readStore(store, key) {
    try { return store.getItem(key); } catch (e) { return null; }
  }
  function writeStore(store, key, value) {
    try { store.setItem(key, value); return true; } catch (e) { return false; }
  }

  var isNewVisitor = false;
  var visitor = (function () {
    var have = readStore(localStorage, VISITOR_KEY);
    if (have && have.length >= 8) return have;
    isNewVisitor = true;
    var made = token();
    writeStore(localStorage, VISITOR_KEY, made);
    return made;
  })();

  var session = (function () {
    var raw = readStore(sessionStorage, SESSION_KEY);
    var now = Date.now();
    if (raw) {
      var parts = raw.split('|');
      if (parts[0] && parts[0].length >= 8 && (now - Number(parts[1] || 0)) < VISIT_GAP) {
        return parts[0];
      }
    }
    var made = token();
    writeStore(sessionStorage, SESSION_KEY, made + '|' + now);
    return made;
  })();

  function touchSession() {
    writeStore(sessionStorage, SESSION_KEY, session + '|' + Date.now());
  }

  /* ---- what kind of screen this is ----------------------------------- */

  /* Read once, reduced to one of three words, and the original never
     leaves this function. A user agent string is close enough to a
     fingerprint that there is no version of "we only kept it for
     analytics" worth writing down. */
  var device = (function () {
    var ua = '';
    try { ua = navigator.userAgent || ''; } catch (e) {}
    if (/iPad|Tablet|PlayBook|Silk|Kindle/i.test(ua)) return 'tablet';
    /* Android says "Mobile" on a phone and leaves it out on a tablet,
       which is the only reliable thing it says about its own size. */
    if (/Android/i.test(ua) && !/Mobile/i.test(ua)) return 'tablet';
    if (/Mobi|iPhone|iPod|Windows Phone/i.test(ua)) return 'mobile';
    /* An iPad running recent iPadOS calls itself a Mac, and the only
       thing that gives it away is that a Mac has no touch screen. */
    try {
      if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return 'tablet';
    } catch (e) {}
    return 'desktop';
  })();

  /* ---- where we are, said safely -------------------------------------- */

  /* The path and nothing else: no query string, no hash, no fragment.
     Those are where a search term, a discount code or an email address
     ends up, and none of them belong in a table anybody may write to.
     Cut to the length the database will accept, so a long path is
     shortened here rather than refused there. */
  function currentPath() {
    var p = '/';
    try {
      p = location.pathname || '/';
      var base = window.VBP_BASE || '/';
      if (base !== '/' && p.indexOf(base) === 0) p = p.slice(base.length - 1);
    } catch (e) {}
    p = String(p).replace(/index\.html?$/i, '') || '/';
    if (p.length > 1) p = p.replace(/\/+$/, '') || '/';
    return p.slice(0, 300);
  }

  /* The host of the site somebody arrived from, and never the rest of
     the address: a referring URL carries the search they typed, and
     sometimes who they are. Our own pages are not a referrer. */
  var referrer = (function () {
    try {
      var r = document.referrer;
      if (!r) return null;
      var host = new URL(r).hostname;
      if (!host || host === location.hostname) return null;
      return host.replace(/^www\./, '').slice(0, 120);
    } catch (e) { return null; }
  })();

  /* What to call this page. document.title is what the shop has already
     decided this page is called, so there is nothing to invent and
     nothing to keep in step with Settings > SEO. */
  function pageLabel() {
    try {
      return String(document.title || '').split(/\s+[|–—-]\s+/)[0].slice(0, 200) || null;
    } catch (e) { return null; }
  }

  /* ---- sending ------------------------------------------------------- */

  var EVENTS_URL = URL_BASE + '/rest/v1/site_events';
  var BEAT_URL = URL_BASE + '/rest/v1/rpc/site_beat';
  var queue = [];
  var timer = null;
  var stopped = false;          // the tables are not there; say no more about it
  var FLUSH_AFTER = 1500;       // gather a moment's worth, then send once
  var MAX_QUEUE = 20;

  function headers() {
    return {
      apikey: KEY,
      Authorization: 'Bearer ' + KEY,
      'Content-Type': 'application/json',
      /* Nothing is read back. Without this the database returns every
         row it just wrote, which is a reply nobody reads. */
      Prefer: 'return=minimal'
    };
  }

  function send(rows, leaving) {
    if (!rows.length || stopped) return;
    var body = JSON.stringify(rows);

    /* On the way out, fetch may be cancelled with the page. sendBeacon
       is the one thing a browser promises to finish, and it cannot
       carry headers — so the key goes in the address, which is what it
       is for on a public anon key. If the beacon is refused, the
       ordinary path below still has every other event of the visit. */
    if (leaving && navigator.sendBeacon) {
      try {
        var blob = new Blob([body], { type: 'application/json' });
        if (navigator.sendBeacon(EVENTS_URL + '?apikey=' + encodeURIComponent(KEY), blob)) return;
      } catch (e) { /* fall through to fetch */ }
    }

    try {
      fetch(EVENTS_URL, {
        method: 'POST',
        headers: headers(),
        body: body,
        /* Lets the request outlive the page it started on. */
        keepalive: true,
        mode: 'cors',
        /* No cookie is sent and none is wanted: this is not an account. */
        credentials: 'omit'
      }).then(function (res) {
        /* 404 and 401 mean the tables or the rules are not there, and
           they will not appear during this visit. Stop, quietly. A 5xx
           or a dropped connection is a bad moment, not a bad setup, so
           it is simply let go — the events in it are lost and nothing
           is retried, because a retry queue in a page nobody can see is
           more to go wrong than it is worth. */
        if (res && (res.status === 404 || res.status === 401 || res.status === 403)) stopped = true;
      }, function () {});
    } catch (e) { /* nothing here is worth an error in a shop's console */ }
  }

  function flush(leaving) {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!queue.length) return;
    var rows = queue;
    queue = [];
    send(rows, !!leaving);
  }

  function record(kind, extra) {
    if (stopped) return;
    var row = {
      kind: kind,
      path: currentPath(),
      label: pageLabel(),
      visitor: visitor,
      session: session,
      device: device,
      is_new: isNewVisitor,
      referrer: referrer
    };
    if (extra) {
      if (extra.sku) row.sku = String(extra.sku).slice(0, 64);
      if (extra.label) row.label = String(extra.label).slice(0, 200);
    }
    queue.push(row);
    touchSession();
    /* A visitor who opens twenty pages in one go is not twenty
       requests, and is not an unbounded queue either. */
    if (queue.length >= MAX_QUEUE) { flush(false); return; }
    if (!timer) timer = setTimeout(function () { flush(false); }, FLUSH_AFTER);
  }

  /* ---- the heartbeat, for the live count ------------------------------ */

  /* One small write a minute while somebody is actually looking at the
     page. It stops the moment the tab goes into the background, which
     is what makes "seven people on the site" mean seven people and not
     seven forgotten tabs. */
  var BEAT_EVERY = 60 * 1000;
  var beatTimer = null;
  var beatsLeft = 60;          // an hour of beating, then this visit is over

  function beat() {
    if (stopped || beatsLeft <= 0) return;
    if (document.hidden) return;
    beatsLeft--;
    try {
      fetch(BEAT_URL, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ p_session: session, p_device: device }),
        mode: 'cors',
        credentials: 'omit'
      }).then(function (res) {
        if (res && (res.status === 404 || res.status === 401 || res.status === 403)) stopped = true;
      }, function () {});
    } catch (e) {}
  }

  function startBeating() {
    if (beatTimer) return;
    beat();
    beatTimer = setInterval(beat, BEAT_EVERY);
  }
  function stopBeating() {
    if (!beatTimer) return;
    clearInterval(beatTimer);
    beatTimer = null;
  }

  /* ---- page views, without the storefront having to say so ------------ */

  var lastPath = null;

  function pageView() {
    var here = currentPath();
    /* The storefront rewrites an old #/ address into the real one as it
       routes, which is two changes and one page. */
    if (here === lastPath) return;
    lastPath = here;
    /* Drawn first, counted after: the title is what names the page, and
       it is set while the page renders. */
    setTimeout(function () { record('page_view'); }, 0);
  }

  /* Every way this site changes page goes through one of these. The two
     history methods are wrapped rather than replaced: the original is
     called first, with everything it was given, and its answer is
     handed back — so a caller cannot tell the difference, and a failure
     in the counting cannot stop a navigation. */
  function watchHistory(name) {
    var original = history[name];
    if (typeof original !== 'function') return;
    history[name] = function () {
      var out = original.apply(this, arguments);
      try { pageView(); } catch (e) {}
      return out;
    };
  }

  /* ---- what the storefront tells us itself ---------------------------- */

  /* Three things cannot be seen from the outside: which piece was
     opened, which was gathered, and when somebody set off to buy.
     assets/app.js says so through here, in one guarded line each. */
  window.VBP_TRACK = {
    event: function (kind, detail) {
      try {
        if (kind !== 'product_view' && kind !== 'add_to_cart' && kind !== 'checkout_start') return;
        record(kind, detail || null);
      } catch (e) {}
    }
  };

  /* ---- start ---------------------------------------------------------- */

  try {
    watchHistory('pushState');
    watchHistory('replaceState');
    window.addEventListener('popstate', function () { try { pageView(); } catch (e) {} });
    window.addEventListener('hashchange', function () { try { pageView(); } catch (e) {} });

    /* Sent as the page goes away, when a browser will still finish a
       beacon. pagehide covers the back-forward cache, which is where
       unload is never fired at all on a phone. */
    window.addEventListener('pagehide', function () { flush(true); });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { flush(true); stopBeating(); }
      else { touchSession(); startBeating(); }
    });

    pageView();
    startBeating();
  } catch (e) {
    /* Whatever went wrong here, the shop is still a shop. */
  }
})();
