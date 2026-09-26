/* =====================================================================
   Vaultique Boutique Point — Admin > Dashboard
   ---------------------------------------------------------------------
   One screen answering "what is happening on the website today".

   WHAT THIS PAGE IS NOT. It is not the shop's books and it is not the
   POS. The catalogue, the prices and whether a piece is in stock all
   arrive from the Business Platform through /api/products, and this
   page only ever READS that feed. There is nothing here that adjusts
   stock, orders from a supplier, or touches money beyond reporting what
   the website itself recorded.

   IT IS ALSO NOT WEBSITE ANALYTICS. That page exists, it is thorough,
   and this one deliberately stops well short of it: a handful of
   headline numbers for today with the week behind them for scale, and a
   link across for anybody who wants to ask a real question. No range
   picker, no grains, no device split — those live one tab away and
   there is no reason to have them twice.

   EVERY NUMBER COMES FROM SOMETHING THAT ALREADY EXISTED. No new table,
   no new function, no new endpoint:

     site_stats()        the visits, product views, carts and checkouts
     orders              what the website took, and what it was worth
     customers           who has an account
     subscribers         who is on the newsletter

   THE SHOP'S DAY, NOT THE READER'S. "Today" means today where the shop
   is, out of Settings > General. Rows are fetched over a slightly wider
   window in UTC and then sorted into days with dayStampInZone — the
   same helper the storefront prices with — so a shop in Lusaka and an
   administrator in London see the same figure for the same day.

   SECTIONS LOAD SEPARATELY AND FAIL SEPARATELY. A dashboard is a dozen
   questions at once and some of them will be refused: a role without
   Analytics cannot call site_stats, a shop that has not run the
   analytics SQL has no such function at all. Any one of those leaves
   its own card saying so and takes nothing else down with it.
   ===================================================================== */
(function () {
  'use strict';
  if (!window.VBP_ADMIN) return;

  var A = window.VBP_ADMIN;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function num(v) {
    var F = window.VBP_FORMAT;
    return F && F.number ? F.number(v || 0) : String(v || 0);
  }
  function svgEl(tag, attrs) {
    var n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) {
      n.setAttribute(k, attrs[k]);
    }
    return n;
  }
  /* 'Mon 8 Sep' for a chart foot, from a stamp rather than a Date, so it
     says the shop's day and not the reader's. */
  function shortDay(stamp) {
    var b = parts(stamp);
    var MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var wd = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][
      new Date(Date.UTC(b.y, b.m - 1, b.d)).getUTCDay()];
    return { top: wd, foot: b.d + ' ' + MON[b.m - 1] };
  }

  /* ---- the shop's own days ------------------------------------------- */

  /* Stamps are 'YYYY-MM-DD' and the arithmetic is UTC on purpose, for the
     reason set out at more length in analytics.js: a Date built from a
     local midnight lands on the day before for anybody west of
     Greenwich. */
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
  function dayIn(tz, when) {
    var F = window.VBP_FORMAT;
    if (F && F.dayStampInZone) return F.dayStampInZone(tz, when);
    return (when || new Date()).toISOString().slice(0, 10);
  }
  /* Monday, to agree with the database's own week and with Analytics. */
  function weekStart(stamp) {
    var b = parts(stamp);
    var day = new Date(Date.UTC(b.y, b.m - 1, b.d)).getUTCDay();   // 0 = Sunday
    return shift(stamp, -((day + 6) % 7));
  }

  /* The instant a query should reach back to, to be certain of holding
     every row belonging to `stamp` in the shop's timezone.

     A whole day early, and deliberately. Working out the exact moment
     local midnight happened means working out the zone's offset, and
     then working it out again for the days either side of a daylight
     saving change. Asking for one extra day of rows costs nothing — the
     rows are then sorted into days by dayStampInZone, which is exact —
     and there is no arithmetic here to get wrong. */
  function reachBackTo(stamp) {
    var b = parts(shift(stamp, -1));
    return new Date(Date.UTC(b.y, b.m - 1, b.d)).toISOString();
  }

  /* ---- what went wrong ----------------------------------------------- */

  function msgOf(e) { return (e && e.message) || String(e || ''); }
  /* The analytics SQL has not been run in this shop's database. */
  function notSetUp(e) {
    return /site_events|site_stats|site_daily|schema cache|does not exist|could not find/i
      .test(msgOf(e));
  }
  /* This role was not given the tab the number lives behind. */
  function refused(e) {
    return /permission|not have permission|row-level security|rls/i.test(msgOf(e));
  }
  function why(e) {
    if (notSetUp(e)) return 'Not set up in this shop yet.';
    if (refused(e))  return 'Your role has not been given this.';
    return 'Could not be read just now.';
  }

  /* ---- the tabs this account actually has ------------------------------
     The shell removes a tab it may not open rather than hiding it, so the
     navigation itself is the answer. Asked here rather than re-deriving
     the permissions, so there is one place that decides and not two. */
  function mayOpen(tab) {
    return !!document.querySelector('.tab[data-tab="' + tab + '"]');
  }

  /* ===================================================================== */

  A.registerPage({
    key: 'dashboard',
    title: 'Dashboard',
    summary: 'An overview of the storefront at a glance.',

    render: function (host, ctx) {
      var sb = (ctx && ctx.sb) || A.sb;
      var store = (ctx && ctx.store) || A.store;
      var navigate = (ctx && ctx.navigate) || function () {};

      var tz = 'UTC';
      var money = null;               // the shop's money style, once known
      var asking = 0;                 // bumped on teardown; stale answers are dropped

      host.innerHTML = '';
      var wrap = el('div', 'db-wrap');
      host.appendChild(wrap);

      /* ---- the greeting ------------------------------------------------ */
      var hello = el('div', 'db-hello');
      var helloTitle = el('h2', null, 'Welcome back');
      var helloSub = el('p', null, 'Here is what is happening on the website.');
      hello.appendChild(helloTitle);
      hello.appendChild(helloSub);
      wrap.appendChild(hello);

      /* ---- the eight cards ---------------------------------------------
         .an-kpi is Analytics' card, used here rather than copied. The big
         number is today; the line under it is the week behind it, which is
         what makes a quiet Tuesday readable as a quiet Tuesday rather than
         as something being broken.

         The last two are totals instead, because "how many customers
         registered today" is almost always nought and almost never the
         question being asked. */
      var KPIS = [
        { key: 'visits',          label: 'Website visits' },
        { key: 'product_views',   label: 'Product views' },
        { key: 'add_to_cart',     label: 'Added to cart' },
        { key: 'checkout_starts', label: 'Checkouts begun' },
        { key: 'orders',          label: 'Orders' },
        { key: 'sales',           label: 'Order value', money: true },
        { key: 'customers',       label: 'Registered customers', total: true },
        { key: 'subscribers',     label: 'Newsletter subscribers', total: true }
      ];
      var kpiBox = el('div', 'an-kpis');
      var kpi = {};
      KPIS.forEach(function (k) {
        var card = el('div', 'an-kpi');
        var n = el('div', 'an-kpi-n', '—');
        card.appendChild(n);
        card.appendChild(el('div', 'an-kpi-l', k.label));
        var s = el('div', 'an-kpi-s', '');
        card.appendChild(s);
        kpi[k.key] = { n: n, s: s, def: k };
        kpiBox.appendChild(card);
      });
      wrap.appendChild(kpiBox);

      function setKpi(key, big, small) {
        var c = kpi[key]; if (!c) return;
        c.n.textContent = big;
        c.s.textContent = small || '';
      }
      function failKpi(key, e) {
        var c = kpi[key]; if (!c) return;
        c.n.textContent = '—';
        c.s.textContent = why(e);
      }
      function asMoney(v) {
        var F = window.VBP_FORMAT;
        if (F && F.money && money) return F.money(v || 0, money);
        return num(Math.round(v || 0));
      }

      /* ---- what the storefront took ---------------------------------------
         ORDER VALUE, NOT SALES, AND THE DIFFERENCE MATTERS. The website
         does not take payment: every method in Settings > Payments is
         settled off the site — cash in person, a transfer, mobile money —
         so what is counted here is what customers asked the storefront
         for, not money that has arrived. The shop's books are the
         Business Platform's, and calling this "sales" would put a figure
         on this page that nobody should reconcile against them.

         ONE SCALE AT A TIME. Orders and their value are different
         measures and are never drawn on one pair of axes; the toggle
         changes which one the chart is of, and the chart says which. */
      var ovCard = el('div', 'card');
      var ovHead = el('div', 'db-head');
      ovHead.appendChild(el('h3', null, 'Orders taken'));
      var measure = 'orders';
      var measureBtns = {};
      /* an-grains for the look; db-measure so this toggle can be told from
         the one on the pieces list further down, which wears the same. */
      var mBox = el('div', 'an-grains db-measure');
      [{ key: 'orders', label: 'Orders' }, { key: 'value', label: 'Order value' }]
        .forEach(function (m) {
          var b = el('button', 'an-grain', m.label);
          b.type = 'button';
          b.addEventListener('click', function () {
            measure = m.key; paintMeasure(); drawTrend();
          });
          measureBtns[m.key] = b;
          mBox.appendChild(b);
        });
      ovHead.appendChild(mBox);
      ovCard.appendChild(ovHead);
      ovCard.appendChild(el('div', 'an-note',
        'What the storefront recorded. The website does not take payment — ' +
        'orders are settled off the site, and the Business Platform holds the ' +
        'shop\u2019s books.'));

      var periodBox = el('div', 'db-periods');
      var PERIODS = [
        { key: 'today', label: 'Today' },
        { key: 'week',  label: 'This week' },
        { key: 'month', label: 'This month' }
      ];
      var periodEls = {};
      PERIODS.forEach(function (pd) {
        var box = el('div', 'db-period');
        box.appendChild(el('div', 'db-period-l', pd.label));
        var n = el('div', 'db-period-n', '—');
        var sub = el('div', 'db-period-s', '');
        box.appendChild(n); box.appendChild(sub);
        periodEls[pd.key] = { n: n, s: sub };
        periodBox.appendChild(box);
      });
      ovCard.appendChild(periodBox);

      var trend = el('div', 'db-trend');
      var trendState = el('div', 'db-state', 'Reading the last seven days\u2026');
      trend.appendChild(trendState);
      ovCard.appendChild(trend);
      wrap.appendChild(ovCard);

      function paintMeasure() {
        for (var k in measureBtns) if (Object.prototype.hasOwnProperty.call(measureBtns, k)) {
          measureBtns[k].classList[k === measure ? 'add' : 'remove']('on');
        }
      }
      paintMeasure();

      /* ---- what is waiting, and what the shelves look like -----------------
         Two columns, and they answer different questions. The left is
         work: things somebody has to go and do, each of them a button
         that goes there. The right is the state of the catalogue as the
         storefront shows it.

         NOTHING HERE MANAGES STOCK. The counts on the right are read off
         the product feed's own `available` and `lowStock` flags, which
         are booleans the Business Platform works out before it sends
         them. The website is never told how many of a piece are left —
         products.js lists `stock` among the fields it omits forever — so
         this page can say a piece is out of stock and can never say how
         nearly. Restocking is the platform's, and stays there. */
      var twoCol = el('div', 'an-two');

      var attnCard = el('div', 'card');
      attnCard.appendChild(el('h3', null, 'Needs attention'));
      var attnBox = el('div', 'db-attn');
      attnBox.appendChild(el('div', 'db-state', 'Looking\u2026'));
      attnCard.appendChild(attnBox);
      twoCol.appendChild(attnCard);

      var stockCard = el('div', 'card');
      stockCard.appendChild(el('h3', null, 'On the storefront'));
      stockCard.appendChild(el('div', 'an-note',
        'What the shop front is showing, from the product feed. Stock itself ' +
        'is the Business Platform\u2019s \u2014 the website is told whether a piece ' +
        'is available, never how many are left.'));
      var stockBox = el('div', 'an-rows');
      stockBox.appendChild(el('div', 'db-state', 'Reading the feed\u2026'));
      stockCard.appendChild(stockBox);
      twoCol.appendChild(stockCard);

      wrap.appendChild(twoCol);

      /* One row of the "needs attention" list: a count, what it is, and
         where pressing it goes. */
      function attnRow(count, title, note, tab, tone) {
        var b = el('button', 'db-attn-item');
        b.type = 'button';
        var chip = el('span', 'db-chip' + (tone ? ' is-' + tone : ''), num(count));
        b.appendChild(chip);
        var t = el('span', 'db-attn-t', title);
        if (note) t.appendChild(el('small', null, note));
        b.appendChild(t);
        b.addEventListener('click', function () { navigate(tab, ''); });
        return b;
      }

      /* ---- how pieces are doing --------------------------------------------
         Four lists of the same catalogue, one at a time. Four columns of
         ten rows each would be unreadable on a desk and impossible on a
         phone, and three of the four are a question somebody asks
         deliberately rather than something to scan.

         Seven days, not today. A day's worth of views puts whichever
         piece somebody happened to open at the top, which is noise
         wearing the clothes of a finding.

         WHERE EACH COMES FROM. The first two are one call to
         site_top_products, sorted here two different ways rather than
         asked twice. Best selling reads the order lines belonging to the
         orders already fetched. Out of stock is the feed. */
      var perfCard = el('div', 'card');
      var perfHead = el('div', 'db-head');
      perfHead.appendChild(el('h3', null, 'How pieces are doing'));
      var VIEWS = [
        { key: 'viewed', label: 'Most viewed' },
        { key: 'carted', label: 'Added to cart' },
        { key: 'sold',   label: 'Best selling' },
        { key: 'out',    label: 'Out of stock' }
      ];
      var perfView = 'viewed';
      var perfBtns = {};
      var perfBox = el('div', 'an-grains db-perf-pick');
      VIEWS.forEach(function (v) {
        var b = el('button', 'an-grain', v.label);
        b.type = 'button';
        b.addEventListener('click', function () { perfView = v.key; paintPerf(); });
        perfBtns[v.key] = b;
        perfBox.appendChild(b);
      });
      perfHead.appendChild(perfBox);
      perfCard.appendChild(perfHead);
      var perfNote = el('div', 'an-note', 'Over the last seven days.');
      perfCard.appendChild(perfNote);
      /* an-rows for the look, db-perf so this list can be told from the
         stock figures above it, which are drawn with the same rows. */
      var perfRows = el('div', 'an-rows db-perf');
      perfRows.appendChild(el('div', 'db-state', 'Reading\u2026'));
      perfCard.appendChild(perfRows);
      wrap.appendChild(perfCard);

      /* ---- who has been in touch, and what has been changed ----------------- */
      var two2 = el('div', 'an-two');

      var custCard = el('div', 'card');
      custCard.appendChild(el('h3', null, 'Customer activity'));
      var custLine = el('div', 'an-note', '\u00a0');
      custCard.appendChild(custLine);
      var revBox = el('div');
      revBox.appendChild(el('div', 'db-state', 'Reading\u2026'));
      custCard.appendChild(revBox);
      two2.appendChild(custCard);

      var logCard = el('div', 'card');
      var logHead = el('div', 'db-head');
      logHead.appendChild(el('h3', null, 'Recent activity'));
      if (mayOpen('activity')) {
        var logLink = el('button', 'db-link', 'View activity log');
        logLink.type = 'button';
        logLink.addEventListener('click', function () { navigate('activity', ''); });
        logHead.appendChild(logLink);
      }
      logCard.appendChild(logHead);
      var logBox = el('div', 'db-log');
      logBox.appendChild(el('div', 'db-state', 'Reading\u2026'));
      logCard.appendChild(logBox);
      two2.appendChild(logCard);

      wrap.appendChild(two2);

      /* ---- quick actions ------------------------------------------------
         .set-item is the Settings menu's own button. Only what this
         account can actually open is offered: an action that lands on a
         tab the shell has removed is a dead end, and a dead end on the
         first screen reads as a broken admin. */
      var ACTIONS = [
        { tab: 'products',   title: 'Products & photos', note: 'Photos, descriptions and what is shown.' },
        { tab: 'orders',     title: 'Orders',            note: 'What the website has taken.' },
        { tab: 'chats',      title: 'Live Chat',         note: 'Answer whoever is waiting.' },
        { tab: 'reviews',    title: 'Reviews',           note: 'Read, approve and reply.' },
        { tab: 'subscribers',title: 'Subscribers',       note: 'Who is on the newsletter.' },
        { tab: 'analytics',  title: 'Website Analytics', note: 'The full picture, over any range.' }
      ];
      var actionsCard = el('div', 'card');
      actionsCard.appendChild(el('h3', null, 'Quick actions'));
      var actionsBox = el('div', 'db-actions');
      var offered = 0;
      ACTIONS.forEach(function (a) {
        if (!mayOpen(a.tab)) return;
        offered++;
        var b = el('button', 'set-item');
        b.type = 'button';
        b.appendChild(el('div', 't', a.title));
        b.appendChild(el('div', 'd', a.note));
        b.addEventListener('click', function () { navigate(a.tab, ''); });
        actionsBox.appendChild(b);
      });
      if (!offered) {
        actionsBox.appendChild(el('div', 'db-state',
          'Nothing else has been ticked for your role yet.'));
      }
      actionsCard.appendChild(actionsBox);

      /* Sections 2 to 4 are inserted above this by the phases that own
         them; Quick actions stays last because it is the thing somebody
         reaches for after reading, not before. */
      wrap.appendChild(actionsCard);

      /* ---- the numbers ---------------------------------------------------- */

      /* Visits, product views, carts and checkouts, today and over the week
         behind it. One function, asked twice — the same one the Analytics
         page asks, which is why a role without Analytics is refused here
         too and the four cards say so rather than showing a nought. */
      /* A role without the Analytics tab is refused by these functions
         every time: may_see_analytics() keys on the very permission the
         shell removed the tab for. So the question is not asked at all —
         three round trips saved, and the card can say something truer
         than "permission denied" while it is at it.

         A shop too old to have my_access() has no permissions to read, so
         the shell leaves every tab in place and the database is left to
         decide, exactly as it did before. */
      var ANALYTICS_NOT_YOURS =
        'Website Analytics is not part of what your role opens.';

      function loadTraffic(t) {
        var mine = asking;
        var weekAgo = shift(t, -6);

        if (!mayOpen('analytics')) {
          ['visits', 'product_views', 'add_to_cart', 'checkout_starts'].forEach(function (k) {
            setKpi(k, '\u2014', ANALYTICS_NOT_YOURS);
          });
          return;
        }
        Promise.all([
          Promise.resolve(sb.rpc('site_stats', { p_from: t, p_to: t, p_tz: tz })),
          Promise.resolve(sb.rpc('site_stats', { p_from: weekAgo, p_to: t, p_tz: tz }))
        ]).then(function (r) {
          if (mine !== asking) return;
          if (r[0].error) throw r[0].error;
          if (r[1].error) throw r[1].error;
          var day = r[0].data || {}, week = r[1].data || {};
          ['visits', 'product_views', 'add_to_cart', 'checkout_starts'].forEach(function (k) {
            setKpi(k, num(day[k] || 0), num(week[k] || 0) + ' in 7 days');
          });
        }).catch(function (e) {
          if (mine !== asking) return;
          ['visits', 'product_views', 'add_to_cart', 'checkout_starts'].forEach(function (k) {
            failKpi(k, e);
          });
        });
      }

      /* Orders and what they were worth. One query for the widest window
         any part of this page needs, sorted into days here — so the same
         rows answer "today", "this week" and "this month" without asking
         three times.

         A cancelled order is not a sale and is not counted as one. It is
         still an order that was placed, so it is not hidden either: the
         count is of orders that stand. */
      var ordersCache = null;         // shared with the phases that follow
      function loadOrders(t) {
        var mine = asking;
        var earliest = [weekStart(t), shift(t, -6), stampOf(parts(t).y, parts(t).m, 1)]
          .sort()[0];
        return Promise.resolve(
          sb.from('orders')
            /* '*' rather than a list: the payment columns exist only once
               supabase-payments.sql has been run, and naming them would
               break this read on a shop that has not run it. */
            .select('*')
            .gte('created_at', reachBackTo(earliest))
            .order('created_at', { ascending: false })
        ).then(function (r) {
          if (mine !== asking) return null;
          if (r.error) throw r.error;
          var rows = (r.data || []).map(function (o) {
            return {
              id: o.id, ref: o.ref,
              /* An order sent to pay online and not paid is not a sale, and
                 is treated here exactly like a cancelled one. */
              status: (o.payment_method === 'online' && o.payment_status !== 'paid')
                ? 'cancelled' : o.status,
              total: Number(o.total) || 0,
              at: o.created_at,
              day: dayIn(tz, new Date(o.created_at))
            };
          });
          ordersCache = rows;
          var mineToday = rows.filter(function (o) {
            return o.day === t && o.status !== 'cancelled';
          });
          var mineWeek = rows.filter(function (o) {
            return o.day >= shift(t, -6) && o.day <= t && o.status !== 'cancelled';
          });
          var sum = function (list) {
            return list.reduce(function (a, o) { return a + o.total; }, 0);
          };
          setKpi('orders', num(mineToday.length), num(mineWeek.length) + ' in 7 days');
          setKpi('sales', asMoney(sum(mineToday)), asMoney(sum(mineWeek)) + ' in 7 days');
          paintOverview(rows, t);
          loadSelling(rows, t);
          return rows;
        }).catch(function (e) {
          if (mine !== asking) return null;
          failKpi('orders', e);
          failKpi('sales', e);
          PERIODS.forEach(function (pd) {
            periodEls[pd.key].n.textContent = '—';
            periodEls[pd.key].s.textContent = '';
          });
          trend.innerHTML = '';
          trendState = el('div', 'db-state is-err', why(e));
          trend.appendChild(trendState);
          perfWhy.sold = why(e);
          perf.sold = null;
          paintPerf();
          return null;
        });
      }

      /* ---- the three windows, and the seven days ---------------------------
         All three read the rows already fetched. A window is whole days in
         the shop's timezone, so "this week" is the shop's week — Monday to
         today — and not a rolling seven days pretending to be one. */
      var trendDays = [];             // [{ day, orders, value }], oldest first

      function paintOverview(rows, t) {
        var monthStart = stampOf(parts(t).y, parts(t).m, 1);
        var wStart = weekStart(t);
        var stands = function (o) { return o.status !== 'cancelled'; };

        var windows = {
          today: function (o) { return o.day === t; },
          week:  function (o) { return o.day >= wStart && o.day <= t; },
          month: function (o) { return o.day >= monthStart && o.day <= t; }
        };
        PERIODS.forEach(function (pd) {
          var list = rows.filter(windows[pd.key]).filter(stands);
          var worth = list.reduce(function (a, o) { return a + o.total; }, 0);
          periodEls[pd.key].n.textContent = num(list.length) +
            (list.length === 1 ? ' order' : ' orders');
          periodEls[pd.key].s.textContent = asMoney(worth);
        });

        trendDays = [];
        for (var i = 6; i >= 0; i--) {
          var day = shift(t, -i);
          var of = rows.filter(function (o) { return o.day === day; }).filter(stands);
          trendDays.push({
            day: day,
            orders: of.length,
            value: of.reduce(function (a, o) { return a + o.total; }, 0)
          });
        }
        drawTrend();
      }

      /* Seven bars, one scale, every bar carrying its own number — so the
         chart is never the only thing saying what it says. Drawn rather
         than fetched from anywhere: it is the same rows again. */
      function drawTrend() {
        if (!trendDays.length) return;
        trend.innerHTML = '';

        var val = function (d) { return measure === 'value' ? d.value : d.orders; };
        var show = function (v) { return measure === 'value' ? asMoney(v) : num(v); };
        var top = 0;
        trendDays.forEach(function (d) { if (val(d) > top) top = val(d); });

        if (!top) {
          trend.appendChild(el('div', 'db-state',
            measure === 'value'
              ? 'Nothing was ordered in the last seven days.'
              : 'No orders in the last seven days.'));
          return;
        }

        var W = 700, H = 190;
        var padL = 8, padR = 8, padT = 26, padB = 34;
        var plotW = W - padL - padR, plotH = H - padT - padB;
        var slot = plotW / trendDays.length;
        var barW = Math.min(46, slot * 0.52);

        var svg = svgEl('svg', {
          viewBox: '0 0 ' + W + ' ' + H,
          preserveAspectRatio: 'xMidYMid meet',
          role: 'img',
          'aria-label': (measure === 'value' ? 'Order value' : 'Orders') +
                        ' for each of the last seven days'
        });

        /* The baseline only. A grid behind seven labelled bars is furniture. */
        svg.appendChild(svgEl('line', {
          x1: padL, y1: padT + plotH, x2: W - padR, y2: padT + plotH, class: 'db-axis'
        }));

        trendDays.forEach(function (d, i) {
          var v = val(d);
          var h = top ? Math.round((v / top) * plotH) : 0;
          if (v > 0 && h < 3) h = 3;                 // a real order is never invisible
          var cx = padL + slot * i + slot / 2;
          var x = cx - barW / 2;
          var y = padT + plotH - h;
          var names = shortDay(d.day);

          if (h > 0) {
            svg.appendChild(svgEl('rect', {
              x: x, y: y, width: barW, height: h, rx: 4, ry: 4, class: 'db-bar'
            }));
          }
          /* The number above the bar, so nothing here is told by height
             alone — and so a day with none reads as a nought rather than
             as a gap. */
          var lab = svgEl('text', {
            x: cx, y: Math.max(padT - 8, y - 7), 'text-anchor': 'middle', class: 'db-val'
          });
          lab.textContent = show(v);
          svg.appendChild(lab);

          var t1 = svgEl('text', {
            x: cx, y: padT + plotH + 14, 'text-anchor': 'middle', class: 'db-tick'
          });
          t1.textContent = names.top;
          svg.appendChild(t1);
          var t2 = svgEl('text', {
            x: cx, y: padT + plotH + 27, 'text-anchor': 'middle', class: 'db-tick'
          });
          t2.textContent = names.foot;
          svg.appendChild(t2);

          /* A full-height target so hovering anywhere in the column says
             the day, which a 3px bar on a quiet Tuesday could not. */
          var hit = svgEl('rect', {
            x: padL + slot * i, y: padT, width: slot, height: plotH, class: 'db-bar-hit'
          });
          var title = svgEl('title', {});
          title.textContent = names.top + ' ' + names.foot + ' — ' +
            num(d.orders) + (d.orders === 1 ? ' order' : ' orders') +
            ', ' + asMoney(d.value);
          hit.appendChild(title);
          svg.appendChild(hit);
        });

        trend.appendChild(svg);
      }

      /* How many people have an account, and how many joined this month.
         The total is a count with no rows fetched; the month is the
         created_at column alone over a bounded window, sorted into the
         shop's own days here rather than trusted to UTC. */
      function loadPeople(t) {
        var mine = asking;
        var monthStart = stampOf(parts(t).y, parts(t).m, 1);
        var since = reachBackTo(monthStart);

        function pair(table, key, extra) {
          var total = sb.from(table).select('*', { count: 'exact', head: true });
          var recent = sb.from(table).select('created_at').gte('created_at', since);
          if (extra) { total = extra(total); recent = extra(recent); }
          Promise.all([Promise.resolve(total), Promise.resolve(recent)])
            .then(function (r) {
              if (mine !== asking) return;
              if (r[0].error) throw r[0].error;
              if (r[1].error) throw r[1].error;
              var joined = (r[1].data || []).filter(function (row) {
                return dayIn(tz, new Date(row.created_at)) >= monthStart;
              }).length;
              setKpi(key, num(r[0].count || 0),
                     joined ? '+' + num(joined) + ' this month' : 'None yet this month');
            })
            .catch(function (e) { if (mine === asking) failKpi(key, e); });
        }

        pair('customers', 'customers', null);
        /* Somebody who has unsubscribed is not on the newsletter, and a
           figure that counts them is a figure that will be acted on. */
        pair('subscribers', 'subscribers', function (q) { return q.is('unsubscribed_at', null); });
      }

      /* ---- what is waiting ------------------------------------------------
         Four questions, asked only where this account could act on the
         answer: a role without Live Chat is not told that somebody is
         waiting in it, because it could not go and answer them and a
         count it cannot clear is a nag.

         Everything reads a count with no rows fetched, except the photos,
         which need the catalogue anyway for the column beside this one.

         A nought is not shown. This list is what needs doing, so an item
         with nothing to do is not an item — and a list with nothing in it
         says so in words rather than sitting empty. */
      var attn = {};                  // key -> { count, ...} as each answer lands
      var attnWaiting = 0;            // how many questions are still out

      /* Each of these settles exactly once, whatever the answer: a count
         that cannot be read is not an item needing attention, it is simply
         not an item. Written .then(...).catch(...) rather than
         .then(ok, fail) on purpose — the two-argument form does not catch
         a throw inside its own success handler, which is how a refused
         count became an unhandled rejection in the console. */
      function attnDone(key, value) {
        attn[key] = value;
        attnWaiting--;
        if (attnWaiting <= 0) paintAttention();
      }

      function paintAttention() {
        attnBox.innerHTML = '';
        var any = 0;

        /* First, and loudest, because nothing else on this page matters if
           it is true: the shop front is not open to anybody. */
        if (attn.gate) {
          var g = el('button', 'db-attn-item');
          g.type = 'button';
          g.appendChild(el('span', 'db-chip is-stop', '!'));
          var gt = el('span', 'db-attn-t', attn.gate.title);
          gt.appendChild(el('small', null, attn.gate.note));
          g.appendChild(gt);
          g.addEventListener('click', function () { navigate('settings', 'general'); });
          attnBox.appendChild(g);
          any++;
        }

        [
          { k: 'orders',  tab: 'orders',   tone: 'warn',
            t: function (n) { return n === 1 ? '1 order waiting' : num(n) + ' orders waiting'; },
            note: 'Not yet confirmed.' },
          { k: 'chats',   tab: 'chats',    tone: 'stop',
            t: function (n) { return n === 1 ? '1 chat unanswered' : num(n) + ' chats unanswered'; },
            note: 'Nobody has replied yet.' },
          { k: 'reviews', tab: 'reviews',  tone: 'warn',
            t: function (n) { return n === 1 ? '1 review waiting' : num(n) + ' reviews waiting'; },
            note: 'Held back until somebody reads it.' },
          { k: 'photos',  tab: 'products', tone: null,
            t: function (n) { return n === 1 ? '1 piece with no photo' : num(n) + ' pieces with no photo'; },
            note: 'Shown with a placeholder on the shop front.' }
        ].forEach(function (row) {
          var n = attn[row.k];
          if (!n) return;
          attnBox.appendChild(attnRow(n, row.t(n), row.note, row.tab, row.tone));
          any++;
        });

        if (!any) {
          var clear = el('div', 'db-clear');
          clear.appendChild(el('span', 'db-tick', '\u2713'));
          clear.appendChild(el('span', null, 'Nothing is waiting. The shop front is up to date.'));
          attnBox.appendChild(clear);
        }
      }

      function loadAttention(general) {
        var mine = asking;

        /* The storefront closed, or under maintenance. Read from the
           settings already in hand rather than asked for again. */
        if (general && general.maintenanceMode) {
          attn.gate = { title: 'The shop front is under maintenance',
                        note: 'Visitors see a notice instead of the shop.' };
        } else if (general && general.websiteStatus === 'closed') {
          attn.gate = { title: 'The shop front is closed',
                        note: 'Visitors see a notice instead of the shop.' };
        } else if (general && general.websiteStatus === 'coming-soon') {
          attn.gate = { title: 'The shop front is not open yet',
                        note: 'Visitors see the coming-soon notice.' };
        }

        var jobs = [];

        if (mayOpen('orders')) {
          jobs.push(Promise.resolve(
            sb.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'pending')
          ).then(function (r) {
            if (r.error) throw r.error;
            /* Orders still on the payment page are not waiting for the shop.
               Asked separately so a shop without the payment columns still
               gets its count: there, this second read fails and takes off 0. */
            return Promise.resolve(
              sb.from('orders').select('*', { count: 'exact', head: true })
                .eq('status', 'pending').eq('payment_method', 'online').neq('payment_status', 'paid')
            ).then(function (u) {
              return Math.max(0, (r.count || 0) - ((u && !u.error && u.count) || 0));
            }, function () { return r.count || 0; });
          }).then(function (n) {
            attnDone('orders', n);
          }).catch(function () { attnDone('orders', 0); }));
        }

        if (mayOpen('chats')) {
          jobs.push(Promise.resolve(sb.rpc('chat_stats', { p_days: 30 })).then(function (r) {
            if (r.error) throw r.error;
            attnDone('chats', (r.data && r.data.unanswered) || 0);
          }).catch(function () { attnDone('chats', 0); }));
        }

        if (mayOpen('reviews')) {
          jobs.push(Promise.resolve(
            sb.from('reviews').select('*', { count: 'exact', head: true }).eq('approved', false)
          ).then(function (r) {
            if (r.error) throw r.error;
            attnDone('reviews', r.count || 0);
          }).catch(function () { attnDone('reviews', 0); }));
        }

        attnWaiting = jobs.length;
        if (!jobs.length) paintAttention();
        return mine;
      }

      /* ---- the catalogue, as the shop front shows it ------------------------
         The same two things the Products page fetches — the feed, and the
         website's own notes about each piece — asked for once here and
         used by both columns, and by the pieces listed further down.

         HIDDEN PIECES ARE NOT ON THE STOREFRONT and are not counted as
         though they were. This card says what a visitor would find. */
      var catalogue = null;           // { shown: [...], meta: {} } once read

      function loadCatalogue() {
        var mine = asking;
        return Promise.all([
          fetch('/api/products', { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : { products: [] }; })
            .catch(function () { return null; }),
          Promise.resolve(sb.from('product_meta').select('sku,image_url,hidden'))
            .then(function (r) { return r.error ? null : (r.data || []); },
                  function () { return null; })
        ]).then(function (got) {
          if (mine !== asking) return;
          var feed = got[0], metaRows = got[1];

          if (!feed) {
            stockBox.innerHTML = '';
            stockBox.appendChild(el('div', 'db-state is-err',
              'The product feed could not be read, so the shop front may be ' +
              'showing nothing. This is the one thing on this page worth ' +
              'chasing straight away.'));
            attnWaiting++;
            attnDone('photos', 0);
            paintOutOfStock();
            return;
          }

          var meta = {};
          (metaRows || []).forEach(function (m) { if (m && m.sku) meta[m.sku] = m; });

          var all = (feed.products) || [];
          var shown = all.filter(function (p) {
            var m = meta[p.sku];
            return !(m && m.hidden);
          });
          catalogue = { all: all, shown: shown, meta: meta, metaKnown: metaRows !== null };

          var out = shown.filter(function (p) { return !p.available; });
          var low = shown.filter(function (p) { return p.available && p.lowStock; });
          var fine = shown.length - out.length - low.length;

          stockBox.innerHTML = '';
          if (!shown.length) {
            stockBox.appendChild(el('div', 'db-state',
              all.length
                ? 'Every piece in the catalogue is hidden from the shop front.'
                : 'The catalogue is empty. Pieces come from the Business Platform.'));
          } else {
            [
              { l: 'Pieces on the shop front', n: shown.length },
              { l: 'In stock',                 n: fine },
              { l: 'Running low',              n: low.length },
              { l: 'Out of stock',             n: out.length }
            ].forEach(function (r) {
              var row = el('div', 'an-row');
              var top = el('div', 'an-row-top');
              top.appendChild(el('div', 'an-row-l', r.l));
              top.appendChild(el('div', 'an-row-n', num(r.n)));
              row.appendChild(top);
              stockBox.appendChild(row);
            });
            if (all.length > shown.length) {
              stockBox.appendChild(el('div', 'an-note',
                num(all.length - shown.length) + ' more ' +
                (all.length - shown.length === 1 ? 'piece is' : 'pieces are') +
                ' hidden from the shop front.'));
            }
          }

          /* Counted only where the website's own notes could be read: with
             no product_meta there is no photo to have, and saying "every
             piece has no photo" would be worse than saying nothing. */
          attnWaiting++;
          attnDone('photos', metaRows === null ? 0 : shown.filter(function (p) {
            var m = meta[p.sku];
            return !(m && m.image_url);
          }).length);

          paintOutOfStock();
        });
      }

      /* ---- the four lists ---------------------------------------------------
         Rows are the .an-row the Analytics page ranks with, bar and all,
         so a list here and a list there read the same way. */
      var perf = { viewed: null, carted: null, sold: null, out: null };
      var perfWhy = { };

      function paintPerfRows(rows, unit) {
        perfRows.innerHTML = '';
        if (!rows || !rows.length) return false;
        var top = rows[0].n || 1;
        rows.forEach(function (r) {
          var row = el('div', 'an-row');
          var head = el('div', 'an-row-top');
          var l = el('div', 'an-row-l', r.label || r.sku || '\u2014');
          if (r.sku && r.sku !== r.label) l.appendChild(el('small', null, r.sku));
          head.appendChild(l);
          var n = el('div', 'an-row-n', r.n == null ? '' : num(r.n));
          if (r.extra) n.appendChild(el('small', null, r.extra));
          head.appendChild(n);
          row.appendChild(head);
          if (r.n != null && unit !== 'none') {
            var track = el('div', 'an-track');
            var fill = el('div', 'an-fill');
            fill.style.width = Math.max(2, Math.round((r.n / top) * 100)) + '%';
            track.appendChild(fill);
            row.appendChild(track);
          }
          perfRows.appendChild(row);
        });
        return true;
      }

      function paintPerf() {
        VIEWS.forEach(function (v) {
          perfBtns[v.key].classList[v.key === perfView ? 'add' : 'remove']('on');
        });
        perfNote.textContent = perfView === 'out'
          ? 'What a visitor cannot buy right now.'
          : 'Over the last seven days.';

        var rows = perf[perfView];
        if (rows === null) {
          perfRows.innerHTML = '';
          perfRows.appendChild(el('div', 'db-state',
            perfWhy[perfView] || 'Reading\u2026'));
          return;
        }
        if (!paintPerfRows(rows, perfView === 'out' ? 'none' : 'bar')) {
          perfRows.innerHTML = '';
          perfRows.appendChild(el('div', 'db-state', ({
            viewed: 'Nothing was opened in the last seven days.',
            carted: 'Nothing was added to a cart in the last seven days.',
            sold:   'Nothing was ordered in the last seven days.',
            out:    'Everything on the shop front is in stock.'
          })[perfView]));
        }
      }
      paintPerf();

      var TOP = 8;

      /* Most viewed and most added to cart. One call, sorted twice: the
         function already returns both counts per piece, and asking it
         again with a different order would be a second question with the
         same answer in it. */
      function loadPieces(t) {
        var mine = asking;

        if (!mayOpen('analytics')) {
          perfWhy.viewed = perfWhy.carted = ANALYTICS_NOT_YOURS;
          perf.viewed = perf.carted = null;
          /* Open on a list this role can actually read, rather than on one
             it will only be told it cannot have. */
          if (perfView === 'viewed' || perfView === 'carted') perfView = 'sold';
          paintPerf();
          return;
        }

        Promise.resolve(sb.rpc('site_top_products', {
          p_from: shift(t, -6), p_to: t, p_tz: tz, p_limit: 40
        })).then(function (r) {
          if (mine !== asking) return;
          if (r.error) throw r.error;
          var rows = r.data || [];
          perf.viewed = rows
            .filter(function (x) { return (x.views || 0) > 0; })
            .sort(function (a, b) { return (b.views || 0) - (a.views || 0); })
            .slice(0, TOP)
            .map(function (x) {
              return { sku: x.sku, label: x.label || x.sku, n: x.views || 0,
                       extra: (x.carts || 0) + ' to cart' };
            });
          perf.carted = rows
            .filter(function (x) { return (x.carts || 0) > 0; })
            .sort(function (a, b) { return (b.carts || 0) - (a.carts || 0); })
            .slice(0, TOP)
            .map(function (x) {
              return { sku: x.sku, label: x.label || x.sku, n: x.carts || 0,
                       extra: (x.views || 0) + ' viewed' };
            });
          paintPerf();
        }).catch(function (e) {
          if (mine !== asking) return;
          perfWhy.viewed = perfWhy.carted = why(e);
          perf.viewed = perf.carted = null;
          paintPerf();
        });
      }

      /* Best selling. The lines belonging to the orders already fetched —
         the last seven days of them, and never a cancelled one, so this
         agrees with the money above it rather than telling a second
         story. */
      function loadSelling(rows, t) {
        var mine = asking;
        var weekAgo = shift(t, -6);
        var ids = rows.filter(function (o) {
          return o.status !== 'cancelled' && o.day >= weekAgo && o.day <= t;
        }).map(function (o) { return o.id; }).slice(0, 300);

        if (!ids.length) { perf.sold = []; paintPerf(); return; }

        Promise.resolve(
          sb.from('order_items').select('sku,name,qty').in('order_id', ids)
        ).then(function (r) {
          if (mine !== asking) return;
          if (r.error) throw r.error;
          var by = {};
          (r.data || []).forEach(function (li) {
            var k = li.sku || li.name || '\u2014';
            if (!by[k]) by[k] = { sku: li.sku, label: li.name || li.sku, n: 0, orders: 0 };
            by[k].n += Number(li.qty) || 0;
            by[k].orders++;
          });
          var list = [];
          for (var k in by) if (Object.prototype.hasOwnProperty.call(by, k)) list.push(by[k]);
          perf.sold = list
            .sort(function (a, b) { return b.n - a.n; })
            .slice(0, TOP)
            .map(function (x) {
              return { sku: x.sku, label: x.label, n: x.n,
                       extra: 'in ' + x.orders + (x.orders === 1 ? ' order' : ' orders') };
            });
          paintPerf();
        }).catch(function (e) {
          if (mine !== asking) return;
          perfWhy.sold = why(e);
          perf.sold = null;
          paintPerf();
        });
      }

      /* Out of stock, straight off the feed. No number beside these: the
         website is never told how many are left, only that there are
         none. */
      function paintOutOfStock() {
        if (!catalogue) { perf.out = null; perfWhy.out = 'The product feed could not be read.'; }
        else {
          perf.out = catalogue.shown
            .filter(function (p) { return !p.available; })
            .slice(0, 12)
            .map(function (p) {
              return { sku: p.sku, label: p.name || p.sku, n: null,
                       extra: p.category || '' };
            });
        }
        paintPerf();
      }

      /* ---- customers, and the newest reviews --------------------------------
         The two counts are the same ones under the cards above, said once
         more in a sentence because this card is where somebody looks for
         them together. The reviews are what is actually new here. */
      function loadCustomerActivity(t) {
        var mine = asking;
        var monthStart = stampOf(parts(t).y, parts(t).m, 1);
        var since = reachBackTo(monthStart);
        var joined = null, subbed = null;

        function sayLine() {
          if (joined === null || subbed === null) return;
          var bits = [];
          bits.push(joined === 1 ? '1 person registered' : num(joined) + ' people registered');
          bits.push(subbed === 1 ? '1 joined the newsletter' : num(subbed) + ' joined the newsletter');
          custLine.textContent = bits.join(', ') + ' this month.';
        }

        Promise.resolve(sb.from('customers').select('created_at').gte('created_at', since))
          .then(function (r) {
            if (mine !== asking) return;
            joined = r.error ? 0 : (r.data || []).filter(function (row) {
              return dayIn(tz, new Date(row.created_at)) >= monthStart;
            }).length;
            sayLine();
          }).catch(function () { if (mine === asking) { joined = 0; sayLine(); } });

        Promise.resolve(sb.from('subscribers').select('created_at')
          .is('unsubscribed_at', null).gte('created_at', since))
          .then(function (r) {
            if (mine !== asking) return;
            subbed = r.error ? 0 : (r.data || []).filter(function (row) {
              return dayIn(tz, new Date(row.created_at)) >= monthStart;
            }).length;
            sayLine();
          }).catch(function () { if (mine === asking) { subbed = 0; sayLine(); } });

        if (!mayOpen('reviews')) {
          revBox.innerHTML = '';
          revBox.appendChild(el('div', 'db-state',
            'Reviews are not part of what your role opens.'));
          return;
        }

        Promise.resolve(
          sb.from('reviews').select('id,sku,name,rating,comment,approved,created_at')
            .order('created_at', { ascending: false }).limit(5)
        ).then(function (r) {
          if (mine !== asking) return;
          if (r.error) throw r.error;
          var list = r.data || [];
          revBox.innerHTML = '';
          if (!list.length) {
            revBox.appendChild(el('div', 'db-state', 'No reviews yet.'));
            return;
          }
          list.forEach(function (rv) {
            var box = el('div', 'db-rev');
            var top = el('div', 'db-rev-top');
            var stars = Math.max(0, Math.min(5, Number(rv.rating) || 0));
            var st = el('span', 'db-stars',
              new Array(stars + 1).join('\u2605') + new Array(6 - stars).join('\u2606'));
            st.setAttribute('aria-label', stars + ' out of 5');
            var who = el('div', 'db-rev-who', rv.name || 'A customer');
            top.appendChild(who);
            top.appendChild(st);
            box.appendChild(top);
            if (rv.comment) box.appendChild(el('div', 'db-rev-what', rv.comment));
            if (rv.approved === false) {
              var tag = el('div');
              tag.appendChild(el('span', 'db-rev-tag', 'Waiting'));
              box.appendChild(tag);
            }
            revBox.appendChild(box);
          });
        }).catch(function (e) {
          if (mine !== asking) return;
          revBox.innerHTML = '';
          revBox.appendChild(el('div', 'db-state is-err', why(e)));
        });
      }

      /* ---- the last few things anybody changed ------------------------------
         The Activity Log's own row, worn small. Six of them: enough to
         notice something unexpected, not so many that the card becomes
         the log. */
      var ACTIONS = { added: 'Added', changed: 'Changed', deleted: 'Deleted' };

      function loadRecentActivity() {
        var mine = asking;
        if (!mayOpen('activity')) {
          logBox.innerHTML = '';
          logBox.appendChild(el('div', 'db-state',
            'The activity log is not part of what your role opens.'));
          return;
        }
        Promise.resolve(
          sb.from('activity_log').select('id,at,actor_email,action,module,record')
            .order('at', { ascending: false }).limit(6)
        ).then(function (r) {
          if (mine !== asking) return;
          if (r.error) throw r.error;
          var list = r.data || [];
          logBox.innerHTML = '';
          if (!list.length) {
            logBox.appendChild(el('div', 'db-state', 'Nothing has been changed yet.'));
            return;
          }
          list.forEach(function (row) {
            var item = el('div', 'al-item');
            var head = el('div', 'al-head');
            head.appendChild(el('span', 'al-action is-' + (row.action || 'changed'),
                                ACTIONS[row.action] || 'Changed'));
            head.appendChild(el('span', 'al-module', row.module || '\u2014'));
            if (row.record) head.appendChild(el('span', 'al-record', row.record));
            item.appendChild(head);
            var foot = el('div', 'al-foot');
            foot.appendChild(el('span', null, whenText(row.at)));
            foot.appendChild(el('span', null, row.actor_email || 'an administrator'));
            item.appendChild(foot);
            logBox.appendChild(item);
          });
        }).catch(function (e) {
          if (mine !== asking) return;
          logBox.innerHTML = '';
          logBox.appendChild(el('div', 'db-state is-err', why(e)));
        });
      }

      /* "12 minutes ago" while it is still today, and the date once it is
         not. A dashboard is read for what has just happened. */
      function whenText(iso) {
        if (!iso) return '';
        var d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        var mins = Math.floor((Date.now() - d.getTime()) / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return mins + (mins === 1 ? ' minute ago' : ' minutes ago');
        var hrs = Math.floor(mins / 60);
        if (hrs < 24) return hrs + (hrs === 1 ? ' hour ago' : ' hours ago');
        var F = window.VBP_FORMAT;
        return F && F.date ? F.date(d, 'D MMMM YYYY') : d.toDateString();
      }

      /* ---- the greeting's words ------------------------------------------
         Worked out from the shop's clock rather than the reader's, so an
         owner in Lusaka is not wished good morning at nine at night. */
      function greet(general) {
        var F = window.VBP_FORMAT;
        var hour = 9;
        try {
          hour = Number(new Intl.DateTimeFormat('en-GB', {
            timeZone: tz, hour: '2-digit', hour12: false
          }).format(new Date())) || 0;
        } catch (e) {}
        var when = hour < 12 ? 'Good morning' : (hour < 17 ? 'Good afternoon' : 'Good evening');
        helloTitle.textContent = when;
        var shop = (general && general.businessName) || 'the shop';
        var day = '';
        try {
          day = new Intl.DateTimeFormat('en-GB', {
            timeZone: tz, weekday: 'long', day: 'numeric', month: 'long'
          }).format(new Date());
        } catch (e) {}
        helloSub.textContent = 'Here is what is happening at ' + shop +
                               (day ? ' — ' + day + '.' : '.');
      }

      /* ---- teardown -------------------------------------------------------
         The shell replaces this host when another page is opened. Bumping
         `asking` is what makes every answer still in flight nobody's, so a
         slow query cannot paint over a page that has since been left. */
      function teardown() { asking++; }
      if (typeof MutationObserver === 'function' && host.parentNode) {
        var obs = new MutationObserver(function () {
          if (!document.body.contains(host)) { teardown(); obs.disconnect(); }
        });
        obs.observe(document.body, { childList: true, subtree: true });
      }

      /* ---- go -------------------------------------------------------------
         General and Pricing first: the timezone decides what "today" means
         and every query below depends on it, and the money style decides
         what an order value looks like. Both fall back rather than fail. */
      var settings = store
        ? Promise.all([
            store.load('general').catch(function () { return {}; }),
            store.load('pricing').catch(function () { return {}; })
          ])
        : Promise.resolve([{}, {}]);

      settings.then(function (got) {
        if (asking) return;
        var general = got[0] || {}, pricing = got[1] || {};
        tz = general.timezone || (function () {
          try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
          catch (e) { return 'UTC'; }
        })();
        var F = window.VBP_FORMAT;
        money = (F && F.moneyStyle) ? F.moneyStyle(general, pricing) : null;

        greet(general);
        var t = dayIn(tz, new Date());
        loadTraffic(t);
        loadOrders(t);
        loadPeople(t);
        loadAttention(general);
        loadCatalogue();
        loadPieces(t);
        loadCustomerActivity(t);
        loadRecentActivity();
      });
    }
  });
})();
