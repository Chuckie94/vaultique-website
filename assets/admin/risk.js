/* =====================================================================
   Vaultique Boutique Point - Admin > Fraud & Risk          BUILD 91
   ---------------------------------------------------------------------
   What the fraud check (netlify/functions/_risk.js) has scored, and the
   cases waiting for somebody: each with its reasons, and Approve, Reject
   or Escalate. Read from supabase-risk.sql: risk_summary for the totals,
   risk_cases for the cases, risk_decide for the answers, audit_verify for
   the sealed record.

   Opened by the owner, or a role given Fraud & Risk in Settings > Users &
   Roles (which must use two-factor). The database decides who may see a
   case and who may answer one; this page only asks.

   APPROVING A HELD PAYMENT does not mark it paid here. The website asks
   the payment's gateway about it once more and marks it paid on the
   gateway's word, with the customer's confirmation email (risk-release);
   the fifteen-minute watch asks again if that call does not get through.
   ===================================================================== */
(function () {
  'use strict';
  if (!window.VBP_ADMIN) return;
  var A = window.VBP_ADMIN;

  var WORD = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };
  var LEVELS = ['low', 'medium', 'high', 'critical'];
  var MOMENT = {
    order_placed: 'WhatsApp order', payment_start: 'Payment starting', payment_paid: 'Payment received',
    refund: 'Refund asked for', staff: 'Team activity'
  };
  var DID = { none: 'Nothing done', shown: 'Marked', held: 'Held', refused: 'Refused' };
  var WOULD = { none: 'nothing', shown: 'marked it', held: 'held it', refused: 'refused it' };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  /* Times as Lusaka keeps them, whatever the computer's own clock says. */
  function when(t) {
    try {
      return new Date(t).toLocaleString('en-GB', { timeZone: 'Africa/Lusaka', day: 'numeric', month: 'short',
                                                   hour: '2-digit', minute: '2-digit' });
    } catch (e) { return String(t || ''); }
  }
  function day(d) {
    try { return new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); }
    catch (e) { return String(d || ''); }
  }
  var num = function (n) { return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); };
  var money = function (n) { return 'K' + Number(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); };
  function badge(level) {
    var b = el('span', 'rk-lv rk-' + (LEVELS.indexOf(level) > -1 ? level : 'low'), WORD[level] || level);
    return b;
  }

  A.registerPage({
    key: 'risk',
    title: 'Fraud & Risk',
    summary: 'What the fraud check has scored, and the cases waiting for you to approve, reject or escalate.',

    render: function (host, ctx) {
      var sb = (ctx && ctx.sb) || A.sb;
      var D = window.VBP_DIALOGS || {};
      var ask = (ctx && ctx.ask) || D.ask;
      var tell = (ctx && ctx.tell) || D.tell;
      var wrap = el('div', 'rk-wrap an-wrap');
      host.appendChild(wrap);
      var days = 7;

      function missing(e) {
        return /risk_|audit_|does not exist|could not find|schema cache|PGRST20[25]/i.test(String((e && e.message) || ''));
      }
      function setUpNote() {
        wrap.innerHTML = '';
        var c = el('div', 'card');
        c.appendChild(el('h3', null, 'The fraud check is not set up yet'));
        c.appendChild(el('p', 'an-note', 'Run supabase-risk.sql in this website’s Supabase SQL Editor (START-HERE.txt), then open this page again.'));
        wrap.appendChild(c);
      }
      function refusedNote() {
        wrap.innerHTML = '';
        var c = el('div', 'card');
        c.appendChild(el('h3', null, 'This sign-in cannot open Fraud & Risk'));
        c.appendChild(el('p', 'an-note', 'The shop owner can, and so can anybody whose role has Fraud & Risk ticked in Settings > Users & Roles.'));
        wrap.appendChild(c);
      }

      /* ---- the frame: what the check is doing, the range ---- */
      var status = el('div', 'card rk-status');
      var bar = el('div', 'an-bar');
      var presets = el('div', 'an-presets');
      [[7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days']].forEach(function (p) {
        var b = el('button', 'an-preset' + (p[0] === days ? ' on' : ''), p[1]);
        b.type = 'button';
        b.addEventListener('click', function () {
          days = p[0];
          Array.prototype.forEach.call(presets.children, function (x) { x.classList.toggle('on', x === b); });
          loadSummary();
        });
        presets.appendChild(b);
      });
      bar.appendChild(presets);
      var kpis = el('div', 'an-kpis');
      var spread = el('div', 'card');
      var trend = el('div', 'card');
      var queue = el('div', 'card rk-queue');
      var record = el('div', 'card rk-record');
      var recent = el('div', 'card');
      [status, bar, kpis, spread, trend, queue, record, recent].forEach(function (n) { wrap.appendChild(n); });

      function drawStatus(s) {
        status.innerHTML = '';
        var mode = s.mode || 'watch';
        var h = el('h3', null, mode === 'act' ? 'The check is acting' : mode === 'off' ? 'The check is off' : 'The check is watching');
        status.appendChild(h);
        var p = el('p', 'an-note');
        if (mode === 'watch') {
          var since = s.watchSince ? new Date(s.watchSince) : null;
          var n = since ? Math.max(1, Math.ceil((Date.now() - since.getTime()) / 86400000)) : 0;
          p.textContent = 'Every order, payment and refund is scored and recorded; nothing is held or refused. Each case says ' +
            'what acting would have done. ' + (since ? 'Watching since ' + when(s.watchSince) + ': day ' + n + ' of the 14 you decided on (D5).'
                                                   : 'Nothing has been scored yet.');
        } else if (mode === 'act') {
          p.textContent = 'High is held for review: a payment is marked "needs attention" when it comes in, a refund is not sent, a ' +
            'WhatsApp order is marked. Critical is refused before a payment starts, and you are emailed.';
        } else {
          p.textContent = 'Nothing is scored. Orders, payments and refunds go on exactly as before build 91.';
        }
        status.appendChild(p);
        var go = el('button', 'btn btn-out btn-sm', 'Settings > Fraud & Risk');
        go.type = 'button';
        go.addEventListener('click', function () { if (ctx && ctx.navigate) ctx.navigate('settings', 'risk'); });
        status.appendChild(go);
      }

      function kpi(n, label, sub) {
        var k = el('div', 'an-kpi');
        k.appendChild(el('div', 'an-kpi-n', n));
        k.appendChild(el('div', 'an-kpi-l', label));
        k.appendChild(el('div', 'an-kpi-s', sub || ''));
        return k;
      }
      function drawKpis(s) {
        kpis.innerHTML = '';
        var lv = s.levels || {};
        var watch = (s.mode || 'watch') !== 'act';
        kpis.appendChild(kpi(num(s.assessed), 'Scored', num(lv.medium) + ' Medium · ' + num(lv.high) + ' High · ' + num(lv.critical) + ' Critical'));
        kpis.appendChild(kpi(num(s.held), 'Held', watch && s.wouldHold ? num(s.wouldHold) + ' would have been, acting' : (s.released ? num(s.released) + ' released since' : '')));
        kpis.appendChild(kpi(num(s.refused), 'Refused', watch && s.wouldRefuse ? num(s.wouldRefuse) + ' would have been, acting' : ''));
        kpis.appendChild(kpi(num(s.open), 'Waiting for you', 'open or escalated, any day'));
        kpis.appendChild(kpi(num(s.failedPayments), 'Failed payments', ''));
        kpis.appendChild(kpi(num(s.duplicateAttempts), 'Orders tried more than once', num(s.paidTwice) + ' paid twice'));
        var rf = s.refunds || null;
        kpis.appendChild(kpi(rf ? num(rf.count) : '–', 'Refunds asked for', rf ? money(rf.amount) : 'Online Refund is not set up'));
        kpis.appendChild(kpi('–', 'Suspicious sign-ins', 'counted from build 92'));
      }

      /* ---- the spread of scores: one series, so no legend ---- */
      function drawSpread(s) {
        spread.innerHTML = '';
        spread.appendChild(el('h3', null, 'The spread of scores'));
        var h = (s.histogram || []).map(function (v) { return Number(v) || 0; });
        while (h.length < 10) h.push(0);
        var max = Math.max.apply(null, h.concat([1]));
        var plot = el('div', 'rk-hist');
        plot.setAttribute('role', 'img');
        plot.setAttribute('aria-label', 'Cases by score: ' + h.map(function (v, i) { return (i === 9 ? '90 and over' : (i * 10) + ' to ' + (i * 10 + 9)) + ', ' + v; }).join('; '));
        h.forEach(function (v, i) {
          var col = el('div', 'rk-col');
          var name = i === 9 ? '90+' : (i * 10) + '–' + (i * 10 + 9);
          col.title = num(v) + (v === 1 ? ' case' : ' cases') + ' scored ' + (i === 9 ? '90 or more' : name);
          var n = el('div', 'rk-n', v ? num(v) : '');
          var b = el('div', 'rk-b');
          b.style.height = (v ? Math.max(3, Math.round(v / max * 100)) : 0) + '%';
          var stack = el('div', 'rk-stack');
          stack.appendChild(n); stack.appendChild(b);
          col.appendChild(stack);
          col.appendChild(el('div', 'rk-x', name));
          plot.appendChild(col);
        });
        spread.appendChild(plot);
        spread.appendChild(el('p', 'an-note', 'Points out of the signals each case was given. Settings > Fraud & Risk says where Medium, High and Critical begin.'));
      }

      /* ---- cases per day, by level: an ordered ramp, a legend, a table ---- */
      function drawTrend(s) {
        trend.innerHTML = '';
        trend.appendChild(el('h3', null, 'Cases per day, by level'));
        var t = s.trend || [];
        var max = 1;
        t.forEach(function (d) { max = Math.max(max, LEVELS.reduce(function (a, l) { return a + (Number(d[l]) || 0); }, 0)); });
        var plot = el('div', 'rk-trend');
        plot.setAttribute('role', 'img');
        plot.setAttribute('aria-label', 'Cases per day by level, the table below gives every figure.');
        t.forEach(function (d) {
          var col = el('div', 'rk-col');
          var tot = LEVELS.reduce(function (a, l) { return a + (Number(d[l]) || 0); }, 0);
          col.title = day(d.day) + ': ' + (tot ? LEVELS.map(function (l) { return num(d[l]) + ' ' + WORD[l]; }).join(', ') : 'nothing scored');
          var stack = el('div', 'rk-stack');
          stack.appendChild(el('div', 'rk-n', tot ? num(tot) : ''));
          var bars = el('div', 'rk-bars');
          bars.style.height = (tot ? Math.max(3, Math.round(tot / max * 100)) : 0) + '%';
          LEVELS.slice().reverse().forEach(function (l) {
            var v = Number(d[l]) || 0;
            if (!v) return;
            var seg = el('div', 'rk-seg rk-' + l);
            seg.style.flexGrow = String(v);
            bars.appendChild(seg);
          });
          stack.appendChild(bars);
          col.appendChild(stack);
          col.appendChild(el('div', 'rk-x', t.length > 31 ? '' : day(d.day)));
          plot.appendChild(col);
        });
        trend.appendChild(plot);
        var legend = el('div', 'an-legend');
        LEVELS.forEach(function (l) {
          var k = el('span', 'an-key');
          k.appendChild(el('i', 'rk-' + l));
          k.appendChild(document.createTextNode(WORD[l]));
          legend.appendChild(k);
        });
        trend.appendChild(legend);
        /* The same figures as a table, folded. */
        var det = el('details', 'rk-table');
        det.appendChild(el('summary', null, 'Every figure'));
        var tb = el('table');
        var hr = el('tr');
        ['Day'].concat(LEVELS.map(function (l) { return WORD[l]; })).forEach(function (x) { hr.appendChild(el('th', null, x)); });
        tb.appendChild(hr);
        t.forEach(function (d) {
          var tr = el('tr');
          tr.appendChild(el('td', null, day(d.day)));
          LEVELS.forEach(function (l) { tr.appendChild(el('td', null, num(d[l]))); });
          tb.appendChild(tr);
        });
        det.appendChild(tb);
        trend.appendChild(det);
      }

      function loadSummary() {
        return Promise.resolve(sb.rpc('risk_summary', { p_days: days })).then(function (r) {
          if (r.error) {
            if (missing(r.error)) { setUpNote(); return; }
            throw r.error;
          }
          var s = r.data || {};
          if (s.ok === false && s.why === 'not_allowed') { refusedNote(); return; }
          drawStatus(s); drawKpis(s); drawSpread(s); drawTrend(s);
        }).catch(function (e) {
          kpis.innerHTML = '';
          kpis.appendChild(el('p', 'count', 'The totals could not be read: ' + ((e && e.message) || e)));
        });
      }

      /* ---- one case ---- */
      function caseRow(c, withActions) {
        var row = el('div', 'rk-case');
        var top = el('div', 'rk-case-top');
        top.appendChild(badge(c.level));
        top.appendChild(el('span', 'rk-score', num(c.score) + ' points'));
        top.appendChild(el('span', 'rk-what', (MOMENT[c.moment] || c.moment) + (c.order_ref ? ' · ' + c.order_ref : '')));
        top.appendChild(el('span', 'rk-when', when(c.at)));
        row.appendChild(top);
        var did = c.mode === 'act'
          ? DID[c.action] || c.action
          : 'Watching: nothing done' + (c.would && c.would !== 'none' ? '; acting, it would have ' + (WOULD[c.would] || c.would) : '');
        if (c.released_at) did += ' · released (paid) ' + when(c.released_at);
        if (c.review_state && c.review_state !== 'none' && c.review_state !== 'open') {
          did += ' · ' + ({ approved: 'Approved', rejected: 'Rejected', escalated: 'Escalated' }[c.review_state] || c.review_state) +
                 (c.reviewed_at ? ' ' + when(c.reviewed_at) : '') + (c.review_note ? ': “' + c.review_note + '”' : '');
        }
        row.appendChild(el('div', 'rk-did', did));
        var ul = el('ul', 'rk-why');
        (Array.isArray(c.reasons) ? c.reasons : []).forEach(function (x) {
          ul.appendChild(el('li', null, String(x.said || x.signal || '') + (x.points ? ' (' + x.points + ')' : '')));
        });
        if (!ul.children.length) ul.appendChild(el('li', null, 'No signal at all.'));
        row.appendChild(ul);
        if (withActions) {
          var acts = el('div', 'rk-acts');
          var say = el('span', 'rk-say');
          var mk = function (label, cls, go) {
            var b = el('button', 'btn btn-sm ' + cls, label);
            b.type = 'button';
            b.addEventListener('click', function () { go(b); });
            acts.appendChild(b);
            return b;
          };
          var busy = function (on) { Array.prototype.forEach.call(acts.querySelectorAll('button'), function (b) { b.disabled = on; }); };
          mk('Approve', 'btn-gold', function () {
            var held = c.action === 'held' && c.moment === 'payment_paid';
            Promise.resolve(ask(held
              ? 'The payment is asked about once more and marked paid on the gateway’s word, and the customer is emailed then.'
              : c.moment === 'refund' && c.action === 'refused'
                ? 'The platform can then ask for the refund again, and it will be sent.'
                : 'The case is closed as approved.', { title: 'Approve this case?', okText: 'Approve' })).then(function (yes) {
              if (yes) decideCase(c, 'approve', '', busy, say);
            });
          });
          mk('Reject', 'btn-out', function () {
            Promise.resolve(ask('Say why, for the record. It stays held or refused; a held payment is refunded from the gateway’s own account.',
              { title: 'Reject this case?', okText: 'Reject', danger: true,
                input: { label: 'Why', maxLength: 500, placeholder: 'e.g. the customer could not be reached' } })).then(function (why) {
              if (why === null || why === false || why === undefined) return;
              if (!String(why).trim()) { tell('A reason is needed to reject a case.'); return; }
              decideCase(c, 'reject', String(why), busy, say);
            });
          });
          if (c.review_state !== 'escalated') {
            mk('Escalate', 'btn-out', function () {
              Promise.resolve(ask('It stays as it is, and the owner is emailed.', { title: 'Escalate to the owner?', okText: 'Escalate',
                input: { label: 'A note for the owner (optional)', maxLength: 500 } })).then(function (note) {
                if (note === null || note === false || note === undefined) return;
                decideCase(c, 'escalate', String(note || ''), busy, say);
              });
            });
          }
          acts.appendChild(say);
          row.appendChild(acts);
        }
        return row;
      }

      function accessToken() {
        if (!sb.auth || typeof sb.auth.getSession !== 'function') return Promise.resolve('');
        return Promise.resolve(sb.auth.getSession()).then(function (r) {
          return (r && r.data && r.data.session && r.data.session.access_token) || '';
        }, function () { return ''; });
      }
      /* A held payment, approved: asked of its gateway at once. */
      function release(c, say) {
        say.textContent = 'Approved. Asking the gateway about the payment…';
        return accessToken().then(function (token) {
          if (!token || typeof fetch !== 'function') throw new Error('no sign-in');
          return fetch('/.netlify/functions/risk-release', {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
            body: JSON.stringify({ id: c.id })
          }).then(function (res) { return res.json().catch(function () { return {}; }); });
        }).then(function (j) {
          say.textContent = j.status === 'paid'
            ? 'Approved and released: marked paid on the gateway’s word, and the customer emailed.'
            : 'Approved. The gateway has not confirmed it again yet; the website asks every 15 minutes and marks it paid then.';
        }, function () {
          say.textContent = 'Approved. The website asks the gateway within 15 minutes and marks it paid then.';
        });
      }
      function decideCase(c, decision, note, busy, say) {
        busy(true);
        say.textContent = 'Saving…';
        return Promise.resolve(sb.rpc('risk_decide', { p_id: c.id, p_decision: decision, p_note: note || null })).then(function (r) {
          if (r.error) throw r.error;
          var d = r.data || {};
          if (!d.ok) {
            busy(false);
            say.textContent = { not_allowed: 'This sign-in may not answer cases.', answered: 'Somebody has already answered this case.',
                                say_why: 'A reason is needed to reject a case.', not_found: 'This case is no longer there.' }[d.why] ||
                              'It could not be saved (' + (d.why || 'no reason given') + ').';
            return;
          }
          var after = d.release ? release(c, say) : Promise.resolve(say.textContent =
            decision === 'approve' ? 'Approved.' : decision === 'reject' ? 'Rejected.' : 'Escalated: the owner is emailed within 15 minutes.');
          return after.then(function () { setTimeout(function () { loadQueue(); loadRecent(); loadSummary(); }, 2500); });
        }).catch(function (e) {
          busy(false);
          say.textContent = 'It could not be saved: ' + ((e && e.message) || e);
        });
      }

      function loadQueue() {
        queue.innerHTML = '';
        queue.appendChild(el('h3', null, 'Waiting for you'));
        return Promise.resolve(sb.from('risk_cases').select('*').in('review_state', ['open', 'escalated'])
          .order('at', { ascending: false }).limit(50)).then(function (r) {
          if (r.error) { if (missing(r.error)) return; throw r.error; }
          var list = r.data || [];
          if (!list.length) { queue.appendChild(el('p', 'count', 'Nothing is waiting. Every High or Critical case comes here.')); return; }
          list.forEach(function (c) { queue.appendChild(caseRow(c, true)); });
        }).catch(function (e) {
          queue.appendChild(el('p', 'count', 'The cases could not be read: ' + ((e && e.message) || e)));
        });
      }
      function loadRecent() {
        recent.innerHTML = '';
        recent.appendChild(el('h3', null, 'The latest cases'));
        return Promise.resolve(sb.from('risk_cases').select('*').order('at', { ascending: false }).limit(30)).then(function (r) {
          if (r.error) { if (missing(r.error)) return; throw r.error; }
          var list = r.data || [];
          if (!list.length) { recent.appendChild(el('p', 'count', 'Nothing scored yet.')); return; }
          list.forEach(function (c) { recent.appendChild(caseRow(c, false)); });
        }).catch(function (e) {
          recent.appendChild(el('p', 'count', 'The cases could not be read: ' + ((e && e.message) || e)));
        });
      }

      /* ---- the sealed record ---- */
      function drawRecord() {
        record.innerHTML = '';
        record.appendChild(el('h3', null, 'The sealed record'));
        record.appendChild(el('p', 'an-note', 'Every decision of the check, and every change to orders, payments, refunds, the team’s logins and ' +
          'roles, and settings, is written by the database itself, each entry sealed with the one before it. An entry changed ' +
          'afterwards, or taken out, shows here (the newest, once the fifteen-minute copy of them has been made).'));
        var b = el('button', 'btn btn-out btn-sm', 'Check the record now');
        b.type = 'button';
        var out = el('p', 'rk-said');
        b.addEventListener('click', function () {
          b.disabled = true;
          out.className = 'rk-said';
          out.textContent = 'Checking…';
          Promise.resolve(sb.rpc('audit_verify', { p_limit: 20000 })).then(function (r) {
            b.disabled = false;
            if (r.error) throw r.error;
            var v = r.data || {};
            if (v.ok) {
              out.className = 'rk-said ok';
              out.textContent = 'Intact: ' + num(v.checked) + ' entr' + (v.checked === 1 ? 'y' : 'ies') + ' checked' +
                (v.entries > v.checked ? ' (the latest ' + num(v.checked) + ' of ' + num(v.entries) + ')' : '') +
                (v.lastAt ? ', the latest ' + when(v.lastAt) : '') + (v.anchors ? '; ' + num(v.anchors) + ' anchors agree' : '') + '.';
            } else if (v.why === 'not_allowed') {
              out.className = 'rk-said err';
              out.textContent = 'This sign-in may not check the record.';
            } else {
              out.className = 'rk-said err';
              out.textContent = 'NOT INTACT: entry ' + (v.at || '?') + ' ' + ({ link: 'does not follow the entry before it',
                seal: 'has been changed since it was written', anchor: 'does not match the anchor kept for it' }[v.why] || 'does not check out') +
                '. Tell whoever looks after the database, and keep this page as it is.';
            }
          }).catch(function (e) {
            b.disabled = false;
            out.className = 'rk-said err';
            out.textContent = missing(e) ? 'The record starts once supabase-risk.sql has been run.' : 'It could not be checked: ' + ((e && e.message) || e);
          });
        });
        record.appendChild(b);
        record.appendChild(out);
      }

      drawRecord();
      loadSummary();
      loadQueue();
      loadRecent();
    }
  });
})();
