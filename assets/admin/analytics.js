/* =====================================================================
   Vaultique Boutique Point — Admin > Website Analytics
   ---------------------------------------------------------------------
   How many people came to the shop, what they looked at, and on what.

   READING ONLY. There is nothing on this page that writes anything, and
   the tables underneath have no policy that would let it: a visit, once
   recorded, cannot be edited by anybody at all, this page included.

   WHERE THE NUMBERS COME FROM. Six functions in the database, each of
   which asks may_see_analytics() before it answers. That is the same
   shape as the chat: the tab being hidden from a role is a courtesy,
   and the database refusing the question is the rule. Somebody who
   rewrote this page in their browser would get an error and no data.

   DAYS ARE THE SHOP'S DAYS. "Today" means today where the shop is, out
   of Settings > General, not where the person reading this happens to
   be sitting. Every range is whole days in that timezone, which is why
   the date boxes have no times in them.

   THE THREE COLOURS ARE IN admin.css AND THE NOTE THERE MATTERS. They
   were checked for colour blindness and for contrast against the card,
   and every bar on this page carries its own number as well, so nothing
   here is told by colour alone.
   ===================================================================== */
(function () {
  'use strict';
  if (!window.VBP_ADMIN) return;

  var A = window.VBP_ADMIN;
  var LIVE_EVERY = 30000;         // how often "here now" is asked again
  var TOP = 8;                    // how many pages and pieces are listed

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function svgEl(tag, attrs) {
    var n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) {
      n.setAttribute(k, attrs[k]);
    }
    return n;
  }
  function num(v) {
    var F = window.VBP_FORMAT;
    return F && F.number ? F.number(v || 0) : String(v || 0);
  }

  /* ---- days, in the shop's own timezone ------------------------------ */

  /* Stamps are 'YYYY-MM-DD' throughout and the arithmetic is done in UTC
     on purpose. A Date built from a local midnight lands on the previous
     day for anybody west of Greenwich, and "Yesterday" showing the day
     before yesterday is the kind of wrong nobody reports because they
     assume it is them. */
  function shift(stamp, days) {
    var b = String(stamp).split('-');
    var d = new Date(Date.UTC(+b[0], +b[1] - 1, +b[2]));
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
  function parts(stamp) {
    var b = String(stamp).split('-');
    return { y: +b[0], m: +b[1], d: +b[2] };
  }
  function stampOf(y, m, d) {
    return y + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;
  }
  /* Monday, because that is what the database's own week starts on and
     two definitions of "this week" in one product is one too many. */
  function weekStart(stamp) {
    var b = parts(stamp);
    var day = new Date(Date.UTC(b.y, b.m - 1, b.d)).getUTCDay();  // 0 = Sunday
    return shift(stamp, -((day + 6) % 7));
  }
  function today(tz) {
    var F = window.VBP_FORMAT;
    if (F && F.dayStampInZone) return F.dayStampInZone(tz);
    return new Date().toISOString().slice(0, 10);
  }

  /* The ranges the toolbar offers, each worked out from today. */
  function rangeFor(key, tz) {
    var t = today(tz), b = parts(t);
    switch (key) {
      case 'today':     return { from: t, to: t };
      case 'yesterday': return { from: shift(t, -1), to: shift(t, -1) };
      /* Seven days INCLUDING today, which is what everybody means by it
         and what makes the number comparable week to week. */
      case 'last7':     return { from: shift(t, -6), to: t };
      case 'week':      return { from: weekStart(t), to: t };
      case 'month':     return { from: stampOf(b.y, b.m, 1), to: t };
      case 'year':      return { from: stampOf(b.y, 1, 1), to: t };
      default:          return { from: t, to: t };
    }
  }

  var PRESETS = [
    { key: 'today',     label: 'Today' },
    { key: 'yesterday', label: 'Yesterday' },
    { key: 'last7',     label: 'Last 7 days' },
    { key: 'week',      label: 'This week' },
    { key: 'month',     label: 'This month' },
    { key: 'year',      label: 'This year' }
  ];

  var GRAINS = [
    { key: 'day',   label: 'Daily' },
    { key: 'week',  label: 'Weekly' },
    { key: 'month', label: 'Monthly' },
    { key: 'year',  label: 'Yearly' }
  ];

  function spanDays(from, to) {
    var a = parts(from), b = parts(to);
    return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000) + 1;
  }

  /* A day per point up to a couple of months, then weeks, then months.
     Sixty points is about as many as a chart this wide can show without
     the labels running into each other. */
  function grainFor(from, to) {
    var n = spanDays(from, to);
    if (n <= 62) return 'day';
    if (n <= 400) return 'week';
    return 'month';
  }

  /* Every bucket the range covers, so a quiet week is a nought on the
     chart rather than a gap the line jumps over. The database returns
     only the buckets that had traffic, deliberately: it does not know
     which range was asked for and this does. */
  function bucketsIn(from, to, grain) {
    var out = [], seen = {}, cur = from, guard = 0;
    while (cur <= to && guard++ < 4000) {
      var b = parts(cur), key;
      if (grain === 'year')       key = stampOf(b.y, 1, 1);
      else if (grain === 'month') key = stampOf(b.y, b.m, 1);
      else if (grain === 'week')  key = weekStart(cur);
      else                        key = cur;
      if (!seen[key]) { seen[key] = true; out.push(key); }
      cur = shift(cur, 1);
    }
    return out;
  }

  function bucketLabel(stamp, grain) {
    var F = window.VBP_FORMAT, b = parts(stamp);
    var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
               'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    if (grain === 'year')  return String(b.y);
    if (grain === 'month') return MON[b.m - 1] + ' ' + String(b.y).slice(2);
    if (grain === 'week')  return b.d + ' ' + MON[b.m - 1];
    return F && F.date ? F.date(new Date(Date.UTC(b.y, b.m - 1, b.d)), 'DD/MM/YYYY').slice(0, 5)
                       : b.d + '/' + b.m;
  }
  /* The address as somebody would say it. Only the ones the storefront
     draws itself are named; anything else is left exactly as recorded,
     because a guess would be worse than the path. */
  function prettyPath(path) {
    var p = String(path || '').replace(/\/+$/, '') || '/';
    var NAMED = {
      '/': 'Home page',
      '/shop': 'Shop',
      '/policies': 'Policies',
      '/account': 'Account',
      '/cart': 'Cart',
      '/wishlist': 'Wishlist'
    };
    if (NAMED[p]) return NAMED[p];
    if (p.indexOf('/product/') === 0) return 'Piece \u2014 ' + p.slice(9);
    return path;
  }

  function bucketFull(stamp, grain) {
    var b = parts(stamp);
    var MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
               'August', 'September', 'October', 'November', 'December'];
    if (grain === 'year')  return String(b.y);
    if (grain === 'month') return MON[b.m - 1] + ' ' + b.y;
    if (grain === 'week')  return 'Week of ' + b.d + ' ' + MON[b.m - 1].slice(0, 3);
    return b.d + ' ' + MON[b.m - 1].slice(0, 3) + ' ' + b.y;
  }

  /* ---- the page ------------------------------------------------------- */

  A.registerPage({
    key: 'analytics',
    title: 'Website Analytics',
    summary: 'Who came to the shop, what they looked at, and on what.',

    render: function (host, ctx) {
      var sb = (ctx && ctx.sb) || A.sb;
      var store = (ctx && ctx.store) || A.store;

      var tz = 'UTC';
      var preset = 'last7';
      var range = null;
      var grain = 'day';
      var grainPicked = false;      // the shop chose, so stop choosing for them
      var asking = 0;               // which question is in flight
      var liveTimer = null;
      var series = [];
      var missing = false;          // the tables are not there yet

      host.innerHTML = '';
      var wrap = el('div', 'an-wrap');
      host.appendChild(wrap);

      /* ---- the range bar ---------------------------------------------- */
      var bar = el('div', 'an-bar');
      var presetBox = el('div', 'an-presets');
      var presetBtns = {};
      PRESETS.forEach(function (p) {
        var b = el('button', 'an-preset', p.label);
        b.type = 'button';
        b.addEventListener('click', function () { choosePreset(p.key); });
        presetBtns[p.key] = b;
        presetBox.appendChild(b);
      });
      bar.appendChild(presetBox);

      var custom = el('div', 'an-custom');
      var fromBox = document.createElement('input');
      fromBox.type = 'date'; fromBox.className = 'an-date';
      fromBox.setAttribute('aria-label', 'From');
      var toBox = document.createElement('input');
      toBox.type = 'date'; toBox.className = 'an-date';
      toBox.setAttribute('aria-label', 'To');
      custom.appendChild(fromBox);
      custom.appendChild(el('span', 'an-sep', 'to'));
      custom.appendChild(toBox);
      bar.appendChild(custom);
      wrap.appendChild(bar);

      var liveRow = el('div', 'an-bar');
      var live = el('div', 'an-live is-off');
      live.appendChild(el('span', 'an-dot'));
      var liveText = el('span', null, 'Counting…');
      live.appendChild(liveText);
      liveRow.appendChild(live);
      var rangeSaid = el('span', 'count', '');
      liveRow.appendChild(rangeSaid);
      wrap.appendChild(liveRow);

      /* ---- the six cards ---------------------------------------------- */
      var KPIS = [
        { key: 'visits',          label: 'Total visits',    note: 'Separate visits to the shop.' },
        { key: 'visitors',        label: 'Unique visitors', note: 'People, counted once each.' },
        { key: 'page_views',      label: 'Page views',      note: 'Every page opened.' },
        { key: 'product_views',   label: 'Product views',   note: 'A piece opened to read about.' },
        { key: 'add_to_cart',     label: 'Added to cart',   note: 'A piece gathered to buy.' },
        { key: 'checkout_starts', label: 'Checkouts begun', note: 'Set off to WhatsApp to order.' }
      ];
      var kpiBox = el('div', 'an-kpis');
      var kpiNums = {};
      KPIS.forEach(function (k) {
        var card = el('div', 'an-kpi');
        var n = el('div', 'an-kpi-n', '—');
        card.appendChild(n);
        card.appendChild(el('div', 'an-kpi-l', k.label));
        card.appendChild(el('div', 'an-kpi-s', k.note));
        kpiNums[k.key] = n;
        kpiBox.appendChild(card);
      });
      wrap.appendChild(kpiBox);

      /* ---- the chart --------------------------------------------------- */
      var chartCard = el('div', 'card');
      var chartHead = el('div', 'an-chart-head');
      chartHead.appendChild(el('h3', null, 'Traffic'));
      var grainBox = el('div', 'an-grains');
      var grainBtns = {};
      GRAINS.forEach(function (g) {
        var b = el('button', 'an-grain', g.label);
        b.type = 'button';
        b.addEventListener('click', function () {
          grainPicked = true; grain = g.key; paintGrains(); loadSeries();
        });
        grainBtns[g.key] = b;
        grainBox.appendChild(b);
      });
      chartHead.appendChild(grainBox);
      chartCard.appendChild(chartHead);

      var plot = el('div', 'an-plot');
      var tip = el('div', 'an-tip');
      plot.appendChild(tip);
      chartCard.appendChild(plot);

      var legend = el('div', 'an-legend');
      [['--an-1', 'Visits'], ['--an-2', 'Unique visitors']].forEach(function (pair) {
        var k = el('span', 'an-key');
        var sw = el('i');
        sw.style.background = 'var(' + pair[0] + ')';
        k.appendChild(sw);
        k.appendChild(el('span', null, pair[1]));
        legend.appendChild(k);
      });
      chartCard.appendChild(legend);
      wrap.appendChild(chartCard);

      /* ---- most looked at ---------------------------------------------- */
      var two = el('div', 'an-two');
      var pagesCard = el('div', 'card');
      pagesCard.appendChild(el('h3', null, 'Most viewed pages'));
      var pagesRows = el('div', 'an-rows');
      pagesRows.appendChild(el('p', 'count', 'Reading…'));
      pagesCard.appendChild(pagesRows);
      two.appendChild(pagesCard);

      var prodCard = el('div', 'card');
      prodCard.appendChild(el('h3', null, 'Most viewed pieces'));
      var prodRows = el('div', 'an-rows');
      prodRows.appendChild(el('p', 'count', 'Reading…'));
      prodCard.appendChild(prodRows);
      two.appendChild(prodCard);
      wrap.appendChild(two);

      /* ---- devices, and who had been before ----------------------------- */
      var two2 = el('div', 'an-two');
      var devCard = el('div', 'card');
      devCard.appendChild(el('h3', null, 'What they came on'));
      var devRows = el('div', 'an-rows');
      devCard.appendChild(devRows);
      two2.appendChild(devCard);

      var newCard = el('div', 'card');
      newCard.appendChild(el('h3', null, 'New and returning'));
      var newBody = el('div');
      newCard.appendChild(newBody);
      two2.appendChild(newCard);
      wrap.appendChild(two2);

      /* ---- the plain-English footnote ------------------------------------ */
      var note = el('div', 'card');
      note.appendChild(el('h3', null, 'About these numbers'));
      var noteP = el('p', 'an-note');
      noteP.innerHTML =
        '<b>A visit</b> is one person\'s trip through the shop; it ends after ' +
        'half an hour of nothing happening. <b>A unique visitor</b> is one ' +
        'browser, counted once however many times they came — so ten visits by ' +
        'the same person over a week is ten visits and one visitor.<br><br>' +
        'Nothing here identifies anybody. No name, no email, no account, no ' +
        'internet address and no browser string is recorded: a visit is a random ' +
        'token that means nothing outside this shop, which page, and when. A ' +
        'browser that asks not to be counted is not counted, and someone who ' +
        'clears their site data comes back as a new visitor — which is the ' +
        'honest answer, because after that there is genuinely no way to tell.';
      note.appendChild(noteP);
      wrap.appendChild(note);

      /* ---- asking the database ------------------------------------------- */

      function whenMissing(e) {
        var msg = (e && e.message) || String(e || '');
        return /site_events|site_stats|site_daily|schema cache|does not exist|could not find/i.test(msg);
      }

      function sayNotSetUp() {
        if (missing) return;
        missing = true;
        wrap.innerHTML = '';
        var card = el('div', 'card');
        card.appendChild(el('h3', null, 'Not set up yet'));
        var p = el('div', 'an-setup');
        p.innerHTML =
          'The website is not recording its traffic yet. Open the Supabase ' +
          'SQL Editor for this website\'s project, paste in ' +
          '<code>supabase-analytics.sql</code> and run it once. Visits are ' +
          'counted from that moment on, and this page fills itself in.<br><br>' +
          'Nothing else needs setting up — no key, no scheduled job — and until ' +
          'it is run the storefront behaves exactly as it does now.';
        card.appendChild(p);
        wrap.appendChild(card);
        stopLive();
      }

      function refused(e) {
        var msg = (e && e.message) || String(e || '');
        return /permission|not have permission/i.test(msg);
      }

      function sayRefused() {
        wrap.innerHTML = '';
        var card = el('div', 'card');
        card.appendChild(el('h3', null, 'Not yours to see'));
        card.appendChild(el('p', 'an-note',
          'Your role has not been given Website Analytics. The shop owner can ' +
          'tick it in Settings > Users & Roles.'));
        wrap.appendChild(card);
        stopLive();
      }

      function trouble(e) {
        if (whenMissing(e)) { sayNotSetUp(); return true; }
        if (refused(e)) { sayRefused(); return true; }
        return false;
      }

      function loadAll() {
        var mine = ++asking;
        rangeSaid.textContent = 'Reading…';
        if (!grainPicked) { grain = grainFor(range.from, range.to); paintGrains(); }

        Promise.resolve(sb.rpc('site_stats', {
          p_from: range.from, p_to: range.to, p_tz: tz
        })).then(function (r) {
          if (mine !== asking) return;
          if (r.error) throw r.error;
          paintKpis(r.data || {});
          paintDevices(r.data || {});
          paintNewReturning(r.data || {});
          rangeSaid.textContent = saidRange();
        }).catch(function (e) {
          if (mine !== asking) return;
          if (trouble(e)) return;
          rangeSaid.textContent = 'These could not be read: ' + ((e && e.message) || e);
        });

        loadSeries(mine);
        loadTops(mine);
      }

      function loadSeries(mine) {
        if (mine == null) mine = asking;
        Promise.resolve(sb.rpc('site_series', {
          p_from: range.from, p_to: range.to, p_tz: tz, p_grain: grain
        })).then(function (r) {
          if (mine !== asking) return;
          if (r.error) throw r.error;
          series = fillGaps(r.data || []);
          drawChart();
        }).catch(function (e) {
          if (mine !== asking) return;
          if (trouble(e)) return;
          Array.prototype.forEach.call(plot.querySelectorAll('svg'), function (n) { n.remove(); });
        });
      }

      function loadTops(mine) {
        Promise.resolve(sb.rpc('site_top_pages', {
          p_from: range.from, p_to: range.to, p_tz: tz, p_limit: TOP
        })).then(function (r) {
          if (mine !== asking) return;
          if (r.error) throw r.error;
          paintRows(pagesRows, (r.data || []).map(function (x) {
            /* "/" is the shop front, and reads as a stray mark in a list
               where everything else is a word. Named, like the rest. */
            return { label: prettyPath(x.path), sub: x.label, n: x.views, extra: x.visitors };
          }), 'view', 'viewer');
        }).catch(function (e) { if (mine === asking && !trouble(e)) paintRows(pagesRows, [], 'view', 'viewer'); });

        Promise.resolve(sb.rpc('site_top_products', {
          p_from: range.from, p_to: range.to, p_tz: tz, p_limit: TOP
        })).then(function (r) {
          if (mine !== asking) return;
          if (r.error) throw r.error;
          paintRows(prodRows, (r.data || []).map(function (x) {
            return { label: x.label || x.sku, sub: x.sku, n: x.views, cart: x.carts };
          }), 'view', 'viewer');
        }).catch(function (e) { if (mine === asking && !trouble(e)) paintRows(prodRows, [], 'view', 'viewer'); });
      }

      /* ---- painting -------------------------------------------------------- */

      function saidRange() {
        var n = spanDays(range.from, range.to);
        if (n === 1) return bucketFull(range.from, 'day');
        return bucketFull(range.from, 'day') + ' to ' + bucketFull(range.to, 'day') +
               ' · ' + n + ' days';
      }

      function paintKpis(d) {
        KPIS.forEach(function (k) { kpiNums[k.key].textContent = num(d[k.key] || 0); });
      }

      function paintPresets() {
        PRESETS.forEach(function (p) {
          presetBtns[p.key].classList[p.key === preset ? 'add' : 'remove']('on');
        });
      }
      function paintGrains() {
        GRAINS.forEach(function (g) {
          grainBtns[g.key].classList[g.key === grain ? 'add' : 'remove']('on');
        });
      }

      function paintRows(hostEl, rows, one, someone) {
        hostEl.innerHTML = '';
        if (!rows.length) {
          hostEl.appendChild(el('p', 'count', 'Nothing recorded in this range.'));
          return;
        }
        var top = rows[0].n || 1;
        rows.forEach(function (r) {
          var row = el('div', 'an-row');
          var head = el('div', 'an-row-top');
          var l = el('div', 'an-row-l', r.label || '—');
          if (r.sub && r.sub !== r.label) l.appendChild(el('small', null, r.sub));
          head.appendChild(l);
          var n = el('div', 'an-row-n', num(r.n));
          if (r.cart != null) n.appendChild(el('small', null, num(r.cart) + ' to cart'));
          else if (r.extra != null) {
            n.appendChild(el('small', null, num(r.extra) +
              ' ' + someone + (r.extra === 1 ? '' : 's')));
          }
          head.appendChild(n);
          row.appendChild(head);
          var track = el('div', 'an-track');
          var fill = el('div', 'an-fill');
          fill.style.width = Math.max(2, Math.round((r.n / top) * 100)) + '%';
          track.appendChild(fill);
          row.appendChild(track);
          hostEl.appendChild(row);
        });
      }

      function paintDevices(d) {
        var rows = [
          { label: 'Mobile',  n: d.mobile || 0,  cls: '' },
          { label: 'Desktop', n: d.desktop || 0, cls: 'is-2' },
          { label: 'Tablet',  n: d.tablet || 0,  cls: 'is-3' }
        ];
        var total = rows.reduce(function (a, r) { return a + r.n; }, 0);
        devRows.innerHTML = '';
        if (!total) {
          devRows.appendChild(el('p', 'count', 'Nothing recorded in this range.'));
          return;
        }
        rows.forEach(function (r) {
          var row = el('div', 'an-row ' + r.cls);
          var head = el('div', 'an-row-top');
          head.appendChild(el('div', 'an-row-l', r.label));
          var n = el('div', 'an-row-n', num(r.n));
          n.appendChild(el('small', null, Math.round((r.n / total) * 100) + '%'));
          head.appendChild(n);
          row.appendChild(head);
          var track = el('div', 'an-track');
          var fill = el('div', 'an-fill');
          fill.style.width = Math.max(r.n ? 2 : 0, Math.round((r.n / total) * 100)) + '%';
          track.appendChild(fill);
          row.appendChild(track);
          devRows.appendChild(row);
        });
        devRows.appendChild(el('p', 'an-note',
          'Counted per visit, not per page: somebody who reads nine pages on a ' +
          'phone is one phone, not nine.'));
      }

      function paintNewReturning(d) {
        var fresh = d.new_visitors || 0;
        var back = d.returning_visitors || 0;
        var all = fresh + back;
        newBody.innerHTML = '';
        if (!all) {
          newBody.appendChild(el('p', 'count', 'Nothing recorded in this range.'));
          return;
        }
        var split = el('div', 'an-split');
        var a = el('span', 'a'); a.style.width = (fresh / all * 100) + '%';
        var b = el('span', 'b'); b.style.width = (back / all * 100) + '%';
        split.appendChild(a); split.appendChild(b);
        newBody.appendChild(split);

        [['a', 'New', fresh], ['b', 'Returning', back]].forEach(function (pair) {
          var row = el('div', 'an-row' + (pair[0] === 'b' ? '' : ' is-2'));
          var head = el('div', 'an-row-top');
          head.appendChild(el('div', 'an-row-l', pair[1]));
          var n = el('div', 'an-row-n', num(pair[2]));
          n.appendChild(el('small', null, Math.round(pair[2] / all * 100) + '%'));
          head.appendChild(n);
          row.appendChild(head);
          newBody.appendChild(row);
        });

        newBody.appendChild(el('p', 'an-note',
          'A visitor is new the first time this shop ever saw their browser. ' +
          'Somebody who clears their site data, or comes back on a different ' +
          'device, counts as new again — there is no way to know otherwise ' +
          'without keeping something about them, and nothing about them is kept.'));
      }

      /* Every bucket the range covers, whether or not it had traffic. */
      function fillGaps(rows) {
        var have = {};
        (rows || []).forEach(function (r) { have[String(r.bucket).slice(0, 10)] = r; });
        return bucketsIn(range.from, range.to, grain).map(function (b) {
          var r = have[b] || {};
          return {
            bucket: b,
            visits: Number(r.visits || 0),
            visitors: Number(r.visitors || 0),
            page_views: Number(r.page_views || 0)
          };
        });
      }

      /* ---- the chart itself ------------------------------------------------ */

      /* Drawn at the width it is actually being shown at rather than
         scaled from a fixed one, so the labels are the size they are
         meant to be on a phone as well as on a desk. */
      var PAD = { t: 14, r: 14, b: 26, l: 40 };
      var HEIGHT = 240;

      function niceTop(max) {
        if (max <= 4) return 4;
        var pow = Math.pow(10, Math.floor(Math.log(max) / Math.LN10));
        var steps = [1, 2, 2.5, 5, 10];
        for (var i = 0; i < steps.length; i++) {
          var t = steps[i] * pow;
          if (t >= max) return t;
        }
        return 10 * pow;
      }

      function drawChart() {
        Array.prototype.forEach.call(plot.querySelectorAll('svg'), function (n) { n.remove(); });
        tip.classList.remove('on');
        if (!series.length) {
          return;
        }
        var W = Math.max(280, Math.round(plot.clientWidth || 640));
        var innerW = W - PAD.l - PAD.r;
        var innerH = HEIGHT - PAD.t - PAD.b;
        var top = niceTop(series.reduce(function (m, r) {
          return Math.max(m, r.visits, r.visitors);
        }, 0));

        var svg = svgEl('svg', {
          viewBox: '0 0 ' + W + ' ' + HEIGHT,
          width: W, height: HEIGHT,
          role: 'img',
          'aria-label': 'Visits and unique visitors, ' + saidRange()
        });

        function x(i) {
          return series.length === 1
            ? PAD.l + innerW / 2
            : PAD.l + (i / (series.length - 1)) * innerW;
        }
        function y(v) { return PAD.t + innerH - (v / top) * innerH; }

        /* The grid, kept well back: it is there to be measured against,
           not to be looked at. */
        var lines = 4;
        for (var g = 0; g <= lines; g++) {
          var v = (top / lines) * g;
          var gy = y(v);
          svg.appendChild(svgEl('line', {
            x1: PAD.l, y1: gy, x2: W - PAD.r, y2: gy,
            stroke: 'var(--an-grid)', 'stroke-width': 1
          }));
          var lab = svgEl('text', {
            x: PAD.l - 7, y: gy + 4, 'text-anchor': 'end',
            'font-size': 11, fill: 'var(--muted)', 'font-family': 'Jost, sans-serif'
          });
          lab.textContent = num(Math.round(v));
          svg.appendChild(lab);
        }

        /* Enough labels to read the axis and no more: past about eight
           they start touching, and a label you cannot read is worse than
           one that is not there. */
        var every = Math.max(1, Math.ceil(series.length / 8));
        series.forEach(function (r, i) {
          if (i % every !== 0 && i !== series.length - 1) return;
          var t = svgEl('text', {
            x: x(i), y: HEIGHT - 8, 'text-anchor': 'middle',
            'font-size': 11, fill: 'var(--muted)', 'font-family': 'Jost, sans-serif'
          });
          t.textContent = bucketLabel(r.bucket, grain);
          svg.appendChild(t);
        });

        function path(key) {
          var d = '';
          series.forEach(function (r, i) {
            d += (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(r[key]).toFixed(1) + ' ';
          });
          return d.trim();
        }

        /* Visits behind, as a wash, so the two lines never have to be
           told apart by hue alone at the point where they touch. */
        var area = path('visits') +
                   ' L' + x(series.length - 1).toFixed(1) + ' ' + y(0).toFixed(1) +
                   ' L' + x(0).toFixed(1) + ' ' + y(0).toFixed(1) + ' Z';
        svg.appendChild(svgEl('path', {
          d: area, fill: 'var(--an-1)', opacity: '.10', stroke: 'none'
        }));

        svg.appendChild(svgEl('path', {
          d: path('visits'), fill: 'none', stroke: 'var(--an-1)',
          'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round'
        }));
        svg.appendChild(svgEl('path', {
          d: path('visitors'), fill: 'none', stroke: 'var(--an-2)',
          'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round'
        }));

        /* One point per bucket where there are few enough to see. */
        if (series.length <= 32) {
          series.forEach(function (r, i) {
            [['visits', 'var(--an-1)'], ['visitors', 'var(--an-2)']].forEach(function (pair) {
              svg.appendChild(svgEl('circle', {
                cx: x(i), cy: y(r[pair[0]]), r: 3.5,
                fill: pair[1], stroke: '#fff', 'stroke-width': 2
              }));
            });
          });
        }

        /* ---- the crosshair ---- */
        var rule = svgEl('line', {
          x1: 0, y1: PAD.t, x2: 0, y2: PAD.t + innerH,
          stroke: 'var(--navy)', 'stroke-width': 1, opacity: '0'
        });
        svg.appendChild(rule);
        var hitA = svgEl('circle', { r: 5.5, fill: 'var(--an-1)', stroke: '#fff', 'stroke-width': 2, opacity: '0' });
        var hitB = svgEl('circle', { r: 5.5, fill: 'var(--an-2)', stroke: '#fff', 'stroke-width': 2, opacity: '0' });
        svg.appendChild(hitA); svg.appendChild(hitB);

        function nearest(clientX) {
          var box = svg.getBoundingClientRect();
          var px = (clientX - box.left) * (W / box.width);
          var best = 0, bestD = Infinity;
          for (var i = 0; i < series.length; i++) {
            var d = Math.abs(x(i) - px);
            if (d < bestD) { bestD = d; best = i; }
          }
          return best;
        }
        function showAt(i) {
          var r = series[i];
          rule.setAttribute('x1', x(i)); rule.setAttribute('x2', x(i));
          rule.setAttribute('opacity', '.25');
          hitA.setAttribute('cx', x(i)); hitA.setAttribute('cy', y(r.visits)); hitA.setAttribute('opacity', '1');
          hitB.setAttribute('cx', x(i)); hitB.setAttribute('cy', y(r.visitors)); hitB.setAttribute('opacity', '1');
          tip.innerHTML = '';
          tip.appendChild(el('b', null, bucketFull(r.bucket, grain)));
          tip.appendChild(document.createTextNode(
            num(r.visits) + (r.visits === 1 ? ' visit' : ' visits') + ' · ' +
            num(r.visitors) + (r.visitors === 1 ? ' visitor' : ' visitors')));
          tip.appendChild(document.createElement('br'));
          tip.appendChild(document.createTextNode(
            num(r.page_views) + (r.page_views === 1 ? ' page view' : ' page views')));
          var box = svg.getBoundingClientRect();
          var scale = box.width / W;
          /* Kept inside the card at both ends. The tooltip is centred on the
             point it belongs to, so without this the first and last points
             hang half of it off the side of the page. */
          var half = tip.offsetWidth / 2;
          var want = x(i) * scale;
          tip.style.left = Math.round(
            Math.min(Math.max(want, half), Math.max(half, box.width - half))) + 'px';
          tip.style.top = Math.max(0, Math.round(y(Math.max(r.visits, r.visitors)) * scale) - 10) + 'px';
          tip.classList.add('on');
        }
        function hide() {
          rule.setAttribute('opacity', '0');
          hitA.setAttribute('opacity', '0');
          hitB.setAttribute('opacity', '0');
          tip.classList.remove('on');
        }
        svg.addEventListener('pointermove', function (e) { showAt(nearest(e.clientX)); });
        svg.addEventListener('pointerleave', hide);
        /* A finger is a pointer that never leaves, so a tap outside puts
           the tooltip away rather than leaving it stranded. */
        svg.addEventListener('pointerdown', function (e) { showAt(nearest(e.clientX)); });

        plot.appendChild(svg);
      }

      /* ---- who is here now ---------------------------------------------- */

      /* The shell hides a tab rather than emptying it, so being off screen
         does not tear this page down the way leaving it does. Asking every
         thirty seconds for a page that is behind Orders is thirty questions
         an hour about something nobody is looking at. */
      function onScreen() {
        return document.body.contains(host) && host.offsetParent !== null;
      }

      function askLive() {
        if (!onScreen()) return;
        Promise.resolve(sb.rpc('site_live')).then(function (r) {
          if (r.error) throw r.error;
          var n = Number(r.data || 0);
          live.classList.remove('is-off');
          live.classList[n ? 'remove' : 'add']('is-quiet');
          liveText.textContent = n
            ? n + (n === 1 ? ' person here now' : ' people here now')
            : 'Nobody on the site right now';
        }).catch(function (e) {
          if (whenMissing(e) || refused(e)) { stopLive(); live.classList.add('hide'); return; }
          live.classList.add('is-off');
          liveText.textContent = 'Cannot tell just now';
        });
      }
      function startLive() {
        if (liveTimer) return;
        askLive();
        liveTimer = setInterval(function () {
          if (!document.hidden) askLive();
        }, LIVE_EVERY);
      }
      function stopLive() {
        if (!liveTimer) return;
        clearInterval(liveTimer);
        liveTimer = null;
      }

      /* ---- driving --------------------------------------------------------- */

      function choosePreset(key) {
        preset = key;
        range = rangeFor(key, tz);
        fromBox.value = range.from;
        toBox.value = range.to;
        grainPicked = false;
        paintPresets();
        loadAll();
      }

      function chooseCustom() {
        var a = fromBox.value, b = toBox.value;
        if (!a || !b) return;
        /* Back to front is a slip, not a range with no days in it. */
        if (a > b) { var t = a; a = b; b = t; fromBox.value = a; toBox.value = b; }
        preset = '';
        range = { from: a, to: b };
        grainPicked = false;
        paintPresets();
        loadAll();
      }
      fromBox.addEventListener('change', chooseCustom);
      toBox.addEventListener('change', chooseCustom);

      var resizeTimer = null;
      function onResize() {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () { if (!missing) drawChart(); }, 150);
      }
      window.addEventListener('resize', onResize);

      /* The shell replaces this host when another page is opened. Without
         this the live count would go on asking for a page nobody has
         open, exactly as the chat's timers would. */
      function teardown() {
        stopLive();
        if (resizeTimer) clearTimeout(resizeTimer);
        window.removeEventListener('resize', onResize);
        asking++;                       // any answer still in flight is nobody's
      }
      if (typeof MutationObserver === 'function' && host.parentNode) {
        var obs = new MutationObserver(function () {
          if (!document.body.contains(host)) { teardown(); obs.disconnect(); }
        });
        obs.observe(document.body, { childList: true, subtree: true });
      }

      /* The shop's own timezone first, because every range below depends
         on it and asking a day early would put "Today" on the wrong day.
         A shop that has saved no timezone gets the browser's, which is
         the closest thing to right that can be had without asking. */
      var whereWeAre = store
        ? store.load('general').then(function (g) { return (g && g.timezone) || ''; },
                                     function () { return ''; })
        : Promise.resolve('');

      whereWeAre.then(function (saved) {
        tz = saved || (function () {
          try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
          catch (e) { return 'UTC'; }
        })();
        choosePreset('last7');
        startLive();
      });
    }
  });
})();
