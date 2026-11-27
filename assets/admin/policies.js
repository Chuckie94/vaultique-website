/* =====================================================================
   Vaultique Boutique Point — the Policies tab (build 90)
   ---------------------------------------------------------------------
   The owner, 26 November 2026: "Adding a new policy shouldn't take the
   windows to the bottom, instead, a policy window should just appear on
   the screen. Also, the numbers in order should auto correct when a new
   policy is added, instead of editing all the numbers."

   Until now every policy was a large form, one under another, and Add
   policy put an empty one numbered 999 at the very bottom. The order was
   a number typed by hand on each, so putting a policy third meant
   renumbering every one after it.

   Now:
     * The list is compact, under the same section headings the policies
       page shows, and each policy carries its number in the order
       customers see them: 1, 2, 3 ... Never a number typed to keep them
       apart.
     * Add policy and Edit open one window over the list: the title, the
       section, the number, the text. Choosing a number puts the policy
       there and the others move up or down to make room; the window says
       which, before anything is saved.
     * The list stays where it was. The policy just saved is marked, and
       if it is out of sight a "Show it" link takes you there.
     * Up and down move a policy one place within its section; the arrows
       on a section's heading move the whole section.
     * Delete closes the gap by itself.

   Each section stays together, as the policies page has always shown
   them (assets/app.js, renderPolicies: in order of number, each section
   where its first policy comes), and sections keep their order unless
   their own arrows move them. So a number among another section's
   policies is brought to the nearest place in the policy's own section,
   and the window says so before anything is saved.

   The order is kept where the shop has always read it, policies.sort.
   A change usually writes one row: a number between its new neighbours.
   When there is no room between them, or older numbers were typed equal
   or out of section, every number is written again as 10, 20, 30 ... in
   one step by policies_set_order() (supabase-shopping.sql), or row by
   row until that file has been run.

   The working-out is plain functions (VBP_POLICIES.plan), checked
   without a page by tests/policies-order.test.cjs.
   ===================================================================== */
(function () {
  'use strict';

  var STEP = 10;

  /* ------------------------------------------------ the order, worked out */
  function secOf(p) { var s = String((p && p.section) || '').trim(); return s || 'Policies'; }
  /* As the policies page compares them: (sort || 0). */
  function sortOf(p) { var n = Number(p && p.sort); return isFinite(n) && n ? n : 0; }

  /* Each section together, in the order its first policy comes. */
  function grouped(list) {
    var order = [], groups = {};
    list.forEach(function (p) {
      var s = secOf(p);
      if (!groups[s]) { groups[s] = []; order.push(s); }
      groups[s].push(p);
    });
    var out = [];
    order.forEach(function (s) { out = out.concat(groups[s]); });
    return out;
  }

  /* As the shop shows them. Ties, which only hand-typed numbers make, go
     by title, so the list reads the same every time it is opened. */
  function ordered(rows) {
    return grouped((rows || []).slice().sort(function (a, b) {
      var x = sortOf(a), y = sortOf(b);
      if (x !== y) return x < y ? -1 : 1;
      var t = String(a.title || '').localeCompare(String(b.title || ''));
      return t || String(a.id || '').localeCompare(String(b.id || ''));
    }));
  }

  /* A number as typed: whole, at least 1, at most `max`; nothing typed
     (or nonsense) means the end. */
  function clampAt(at, max) {
    var s = String(at == null ? '' : at).trim();
    if (!/^\d{1,6}$/.test(s)) return max;
    var n = parseInt(s, 10);
    return n < 1 ? 1 : (n > max ? max : n);
  }

  /* The whole list with this policy (id null for a new one) put at number
     `at` with section `section`. The policy itself is marked me: true.
     Sections keep their order (only a section's own arrows move it), so
     a number outside the policy's section is brought to the nearest
     place inside it: its first or its last. A new section goes where it
     is asked if that is between two sections, or else after the section
     the number falls in. */
  function arrange(list, id, at, section) {
    var rest = list.filter(function (p) { return !id || p.id !== id; });
    var i = clampAt(at, rest.length + 1) - 1;
    var me = { id: id || null, section: section, me: true };
    var sec = secOf(me), s = -1, e = -1;
    rest.forEach(function (p, k) { if (secOf(p) === sec) { if (s < 0) s = k; e = k + 1; } });
    var j;
    if (s >= 0) j = Math.min(Math.max(i, s), e);
    else if (i === 0 || i === rest.length || secOf(rest[i - 1]) !== secOf(rest[i])) j = i;
    else { j = i; while (j < rest.length && secOf(rest[j]) === secOf(rest[i - 1])) j++; }
    return rest.slice(0, j).concat([me], rest.slice(j));
  }

  /* What the window says under the number, before anything is saved. */
  function describe(list, id, at, section) {
    var rest = list.filter(function (p) { return !id || p.id !== id; });
    var want = clampAt(at, rest.length + 1);
    var after = arrange(list, id, at, section);
    var got = 0;
    after.forEach(function (p, k) { if (p.me) got = k + 1; });
    var before = {};
    list.forEach(function (p, k) { before[p.id] = k + 1; });
    var moved = [];
    after.forEach(function (p, k) {
      if (!p.me && before[p.id] !== k + 1) moved.push({ from: before[p.id], by: k + 1 - before[p.id] });
    });
    var was = id ? before[id] : null;
    var say = (was === got ? 'It stays number ' + got : 'It will be number ' + got) +
              (got !== want ? ' (not ' + want + ': each section stays together, as on the policies page)' : '') + '.';
    if (moved.length) {
      var from = moved.map(function (m) { return m.from; });
      var lo = Math.min.apply(null, from), hi = Math.max.apply(null, from);
      var span = lo === hi ? 'Number ' + lo : 'Numbers ' + lo + ' to ' + hi;
      if (moved.every(function (m) { return m.by === 1; })) say += ' ' + span + (lo === hi ? ' moves' : ' each move') + ' down one.';
      else if (moved.every(function (m) { return m.by === -1; })) say += ' ' + span + (lo === hi ? ' moves' : ' each move') + ' up one.';
      else say += ' ' + moved.length + ' other ' + (moved.length === 1 ? 'policy changes' : 'policies change') +
                  ' number, because each section stays together.';
    } else if (!id && got === after.length) {
      say = 'It will be number ' + got + ', the last' +
            (got !== want ? ' (not ' + want + ': each section stays together, as on the policies page)' : '') + '.';
    }
    return { at: got, want: want, text: say, moved: moved.length };
  }

  /* A number for one policy between its new neighbours, or null when
     there is no room and the list must be numbered again. */
  function between(after) {
    var k = -1;
    after.forEach(function (p, i) { if (p.me) k = i; });
    var prev = k > 0 ? after[k - 1] : null, next = k < after.length - 1 ? after[k + 1] : null;
    var a = prev ? sortOf(prev) : null, b = next ? sortOf(next) : null;
    var s;
    if (a === null && b === null) s = STEP;
    else if (b === null) s = a + STEP;
    else if (a === null) s = b - STEP;
    else if (b - a >= 2) s = Math.floor((a + b) / 2);
    else return null;
    return s >= 1 ? s : null;
  }

  /* True when every number along the list goes up: the order is already
     what the policies page will show, and nothing else need be written. */
  function inOrder(after, mine) {
    var last = -Infinity;
    for (var i = 0; i < after.length; i++) {
      var s = after[i].me ? mine : sortOf(after[i]);
      if (!(s > last)) return false;
      last = s;
    }
    return true;
  }

  /* Every number written again, 10, 20, 30 ...: only the rows that change. */
  function renumber(after, ids) {
    var out = [];
    after.forEach(function (p, k) {
      var s = (k + 1) * STEP, id = p.me ? ids.me : p.id;
      if (p.me || sortOf(p) !== s) out.push({ id: id, sort: s });
    });
    return out;
  }

  /* Whole sections moved: `sec` one place up (-1) or down (+1). */
  function moveSection(list, sec, by) {
    var order = [];
    list.forEach(function (p) { if (order.indexOf(secOf(p)) < 0) order.push(secOf(p)); });
    var i = order.indexOf(sec), j = i + by;
    if (i < 0 || j < 0 || j >= order.length) return null;
    order.splice(i, 1);
    order.splice(j, 0, sec);
    var out = [];
    order.forEach(function (s) { list.forEach(function (p) { if (secOf(p) === s) out.push(p); }); });
    return out;
  }

  var plan = { secOf: secOf, ordered: ordered, grouped: grouped, clampAt: clampAt, arrange: arrange,
               describe: describe, between: between, inOrder: inOrder, renumber: renumber,
               moveSection: moveSection, STEP: STEP };

  /* ------------------------------------------------------------ the page */
  var S = { sb: null, rows: [], ready: false };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function $(id) { return document.getElementById(id); }
  function audit() { return (window.VBP_ADMIN || {}).audit; }
  function dialogs() { return window.VBP_DIALOGS || { ask: function () { return Promise.resolve(false); }, tell: function () { return Promise.resolve(true); } }; }
  function changedNothing(r) { return !r || !r.data || (Array.isArray(r.data) && r.data.length === 0); }
  var REFUSED = 'The database did not accept this change, so nothing was saved. This sign-in may not change policies. ' +
                'Sign out of the admin and sign in again with the shop owner’s account, or ask the owner to allow it ' +
                'for your role in Settings > Users & Roles.';

  function mount(opts) {
    S.sb = opts.sb;
    if (S.ready) return;
    S.ready = true;
    var add = $('polAdd');
    if (add) add.addEventListener('click', function () { openWindow(null, add); });
  }

  function status(text, kind, showId) {
    var st = $('polStat');
    if (!st) return;
    st.innerHTML = '';
    st.className = 'stat' + (kind ? ' ' + kind : '');
    st.appendChild(document.createTextNode(text || ''));
    if (showId) {
      var row = document.querySelector('.pol-row[data-id="' + showId + '"]');
      if (row && !inView(row)) {
        var go = el('button', 'pol-show', 'Show it');
        go.type = 'button';
        go.addEventListener('click', function () { row.scrollIntoView({ block: 'center' }); flash(showId); });
        st.appendChild(document.createTextNode(' '));
        st.appendChild(go);
      }
    }
  }
  function inView(node) {
    var r = node.getBoundingClientRect();
    return r.bottom > 0 && r.top < (window.innerHeight || document.documentElement.clientHeight);
  }
  function flash(id) {
    var row = document.querySelector('.pol-row[data-id="' + id + '"]');
    if (!row) return;
    row.classList.remove('pol-flash');
    void row.offsetWidth;
    row.classList.add('pol-flash');
  }

  /* Read the list again and draw it where it is: the page does not move. */
  function load(mark) {
    var host = $('polList');
    if (!host || !S.sb) return Promise.resolve();
    var y = window.pageYOffset || 0;
    if (!S.rows.length) host.innerHTML = '<p class="count">Loading…</p>';
    return Promise.resolve(S.sb.from('policies').select('*').order('sort', { ascending: true })).then(function (r) {
      if (r.error) { host.innerHTML = ''; host.appendChild(el('p', 'count', 'Error: ' + r.error.message)); return; }
      S.rows = ordered(r.data || []);
      draw();
      window.scrollTo({ top: y, behavior: 'instant' });
      if (mark) flash(mark);
    });
  }

  function preview(body) {
    var t = String(body || '').replace(/\s+/g, ' ').trim();
    return t.length > 140 ? t.slice(0, 139).replace(/\s+\S*$/, '') + '…' : t;
  }

  function draw() {
    var host = $('polList'), count = $('polCount');
    var rows = S.rows;
    if (count) count.textContent = rows.length === 1 ? '1 policy' : rows.length + ' policies';
    host.innerHTML = '';
    if (!rows.length) {
      host.appendChild(el('p', 'count', 'No policies yet. Click "Load starter policies" to add the ones from your manual, ' +
                                        'or "Add policy" to write your own.'));
      return;
    }
    var secs = [];
    rows.forEach(function (p) { if (secs.indexOf(secOf(p)) < 0) secs.push(secOf(p)); });
    var box = null, sec = null;
    rows.forEach(function (p, i) {
      var s = secOf(p);
      if (s !== sec) {
        sec = s;
        var first = i + 1, last = i;
        while (last < rows.length && secOf(rows[last]) === s) last++;
        box = el('div', 'pol-sec');
        var head = el('div', 'pol-sec-head');
        var h = el('h3', 'pol-sec-name', s);
        var span = el('span', 'hint', first === last ? 'Number ' + first : 'Numbers ' + first + ' to ' + last);
        head.appendChild(h);
        head.appendChild(span);
        var k = secs.indexOf(s);
        var acts = el('span', 'pol-sec-acts');
        acts.appendChild(arrow('↑', 'Move the ' + s + ' section up', k === 0, function () { moveWholeSection(s, -1); }));
        acts.appendChild(arrow('↓', 'Move the ' + s + ' section down', k === secs.length - 1, function () { moveWholeSection(s, 1); }));
        head.appendChild(acts);
        box.appendChild(head);
        host.appendChild(box);
      }
      box.appendChild(row(p, i));
    });
  }

  function arrow(sign, label, off, fn) {
    var b = el('button', 'btn btn-out btn-sm pol-arrow', sign);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.title = label;
    b.disabled = !!off;
    b.addEventListener('click', fn);
    return b;
  }

  function row(p, i) {
    var rows = S.rows;
    var d = el('div', 'pol-row');
    d.setAttribute('data-id', p.id);
    d.appendChild(el('div', 'pol-no', String(i + 1)));
    var main = el('div', 'pol-main');
    main.appendChild(el('div', 'pol-t', p.title || 'Untitled'));
    var pv = preview(p.body);
    main.appendChild(el('div', 'pol-p', pv || 'No text yet.'));
    d.appendChild(main);
    var acts = el('div', 'pol-acts');
    var firstOfSec = i === 0 || secOf(rows[i - 1]) !== secOf(p);
    var lastOfSec = i === rows.length - 1 || secOf(rows[i + 1]) !== secOf(p);
    acts.appendChild(arrow('↑', 'Move "' + (p.title || 'this policy') + '" up', firstOfSec, function () { moveOne(p, i, -1); }));
    acts.appendChild(arrow('↓', 'Move "' + (p.title || 'this policy') + '" down', lastOfSec, function () { moveOne(p, i, 1); }));
    var edit = el('button', 'btn btn-out btn-sm pol-edit', 'Edit');
    edit.type = 'button';
    edit.addEventListener('click', function () { openWindow(p, edit); });
    var del = el('button', 'btn btn-out btn-sm pol-del', 'Delete');
    del.type = 'button';
    del.addEventListener('click', function () { remove(p); });
    acts.appendChild(edit);
    acts.appendChild(del);
    d.appendChild(acts);
    return d;
  }

  /* ---------------------------------------------------- writing the order */
  /* `force`: the policy just written with a number of its own, rewritten
     here whatever its old number was. */
  function setOrder(ids, force) {
    var rows = S.rows;
    return Promise.resolve(S.sb.rpc('policies_set_order', { p_ids: ids })).then(function (r) {
      var d = r && !r.error ? r.data : null;
      if (d && d.ok) return { ok: true };
      if (d && d.why) return { ok: false, why: d.why };
      var msg = String((r && r.error && (r.error.message || r.error.code)) || '');
      if (!/policies_set_order|PGRST202|does not exist|Could not find/i.test(msg)) return { ok: false, why: msg || 'error' };
      /* supabase-shopping.sql not run yet: one row at a time. */
      var want = {};
      ids.forEach(function (id, k) { want[id] = (k + 1) * STEP; });
      var jobs = rows.filter(function (p) { return want[p.id] != null && (p.id === force || sortOf(p) !== want[p.id]); })
                     .map(function (p) { return { id: p.id, sort: want[p.id] }; });
      ids.forEach(function (id) { if (!rows.some(function (p) { return p.id === id; })) jobs.push({ id: id, sort: want[id] }); });
      return Promise.all(jobs.map(function (j) {
        return Promise.resolve(S.sb.from('policies').update({ sort: j.sort }).eq('id', j.id).select('id'))
          .then(function (x) { return !(x && x.error) && !changedNothing(x); }, function () { return false; });
      })).then(function (oks) {
        var bad = oks.filter(function (x) { return !x; }).length;
        return bad ? { ok: false, why: bad === oks.length ? 'refused' : 'part' } : { ok: true };
      });
    }, function (e) { return { ok: false, why: (e && e.message) || 'error' }; });
  }
  function orderProblem(why) {
    if (why === 'not_allowed' || why === 'refused') return REFUSED;
    if (why === 'stale') return 'Someone else changed the policies just now. The list has been read again: please try once more.';
    if (why === 'part') return 'Some numbers could not be saved, so the order may be partly changed. The list shows it as it is now: ' +
                               'move the policy again to finish.';
    return 'The order could not be saved just now (' + why + '). The list shows it as it is now.';
  }

  /* A policy's own row is written first, with a number between its new
     neighbours; then, only if the order still needs it, every number is
     written again. */
  function place(after) {
    var k = 0;
    after.forEach(function (p, i) { if (p.me) k = i; });
    var mine = between(after);
    return { sort: mine === null ? (k + 1) * STEP : mine,
             whole: mine === null || !inOrder(after, mine),
             order: function (id) { return after.map(function (p) { return p.me ? id : p.id; }); } };
  }

  function moveOne(p, i, by) {
    var rows = S.rows;
    var after = arrange(rows, p.id, i + 1 + by, p.section);
    var spot = place(after);
    status('Moving…', 'busy');
    var write = spot.whole
      ? setOrder(spot.order(p.id), p.id)
      : Promise.resolve(S.sb.from('policies').update({ sort: spot.sort }).eq('id', p.id).select('id')).then(function (r) {
          return r.error ? { ok: false, why: r.error.message } : (changedNothing(r) ? { ok: false, why: 'refused' } : { ok: true });
        });
    write.then(function (res) {
      if (!res.ok) { status('Not moved', 'err'); dialogs().tell(orderProblem(res.why), { title: 'Not moved' }); return load(); }
      var a = audit();
      if (a) a.record({ action: 'changed', module: 'Policies', record: p.title || 'a policy',
                        changes: [{ field: 'number', from: String(i + 1), to: String(i + 1 + by) }] });
      return load(p.id).then(function () { status('"' + (p.title || 'Policy') + '" is now number ' + (i + 1 + by) + '.', 'ok', p.id); });
    });
  }

  function moveWholeSection(sec, by) {
    var list = moveSection(S.rows, sec, by);
    if (!list) return;
    status('Moving…', 'busy');
    setOrder(list.map(function (p) { return p.id; })).then(function (res) {
      if (!res.ok) { status('Not moved', 'err'); dialogs().tell(orderProblem(res.why), { title: 'Not moved' }); return load(); }
      var a = audit();
      if (a) a.record({ action: 'changed', module: 'Policies', record: 'Section ' + sec,
                        changes: [{ field: 'place', from: '', to: by < 0 ? 'one section up' : 'one section down' }] });
      return load().then(function () { status('The ' + sec + ' section moved ' + (by < 0 ? 'up.' : 'down.'), 'ok'); });
    });
  }

  function remove(p) {
    dialogs().ask('Delete "' + (p.title || 'this policy') + '"?',
                  { danger: true, note: 'This cannot be undone. Customers will no longer see it on the policies page. ' +
                                        'The policies after it each move up one.' })
      .then(function (yes) {
        if (!yes) return;
        Promise.resolve(S.sb.from('policies').delete().eq('id', p.id).select('id')).then(function (r) {
          if (r.error || changedNothing(r)) {
            dialogs().tell(r.error ? r.error.message : REFUSED, { title: 'Not deleted' });
            return;
          }
          var a = audit();
          if (a) a.record({ action: 'deleted', module: 'Policies', record: p.title || 'a policy' });
          load().then(function () { status('"' + (p.title || 'Policy') + '" deleted. The numbers after it moved up one.', 'ok'); });
        });
      });
  }

  /* ---------------------------------------------------------- the window */
  function openWindow(p, opener) {
    if (document.querySelector('.polw-back')) return;
    var isNew = !p;
    var rows = S.rows;
    var max = isNew ? rows.length + 1 : rows.length;
    var was = isNew ? null : rows.indexOf(p) + 1;
    var secs = [];
    rows.forEach(function (x) { var s = String(x.section || '').trim(); if (s && secs.indexOf(s) < 0) secs.push(s); });

    var back = el('div', 'polw-back');
    back.setAttribute('role', 'dialog');
    back.setAttribute('aria-modal', 'true');
    back.setAttribute('aria-labelledby', 'polwTitle');
    var card = el('div', 'polw-card');
    card.innerHTML =
      '<div class="polw-head"><h3 id="polwTitle"></h3>' +
        '<button type="button" class="polw-x" aria-label="Close">×</button></div>' +
      '<div class="polw-body">' +
        '<div class="field"><label for="polw_title">Title</label><input type="text" id="polw_title" maxlength="200"></div>' +
        '<div class="polw-two">' +
          '<div class="field"><label for="polw_section">Section</label>' +
            '<input type="text" id="polw_section" maxlength="80" list="polw_sections" autocomplete="off">' +
            '<datalist id="polw_sections"></datalist></div>' +
          '<div class="field polw-nofield"><label for="polw_no">Number</label>' +
            '<input type="text" id="polw_no" inputmode="numeric" maxlength="4" autocomplete="off"></div>' +
        '</div>' +
        '<p class="hint polw-where" id="polw_where" aria-live="polite"></p>' +
        '<div class="field"><label for="polw_body">Text</label><textarea id="polw_body" rows="12"></textarea>' +
          '<div class="hint">Start a line with a dash for a bullet point. Leave a blank line between paragraphs.</div></div>' +
      '</div>' +
      '<div class="polw-foot"><span class="stat polw-stat" aria-live="polite"></span>' +
        '<button type="button" class="btn btn-out btn-sm polw-cancel">Cancel</button>' +
        '<button type="button" class="btn btn-gold btn-sm polw-save"></button></div>';
    back.appendChild(card);

    var tt = card.querySelector('#polw_title'), ss = card.querySelector('#polw_section'), nn = card.querySelector('#polw_no'),
        bb = card.querySelector('#polw_body'), where = card.querySelector('#polw_where'), stat = card.querySelector('.polw-stat'),
        save = card.querySelector('.polw-save'), dl = card.querySelector('#polw_sections');
    card.querySelector('#polwTitle').textContent = isNew ? 'Add a policy' : 'Edit policy';
    save.textContent = isNew ? 'Add policy' : 'Save';
    secs.forEach(function (s) { var o = document.createElement('option'); o.value = s; dl.appendChild(o); });

    /* A new policy goes at the end of the last section, unless a number is
       chosen; choosing a section without having typed a number puts it at
       the end of that section. */
    var lastSec = rows.length ? String(rows[rows.length - 1].section || '').trim() : '';
    tt.value = isNew ? '' : (p.title || '');
    ss.value = isNew ? lastSec : (p.section || '');
    nn.value = String(isNew ? max : was);
    bb.value = isNew ? '' : (p.body || '');
    var typedNo = false;
    var start = { t: tt.value, s: ss.value, n: nn.value, b: bb.value };

    /* The number just after the last policy of that section, counted
       without this one; the end of the list for a new section. */
    function endOfSection(sec) {
      var s = String(sec || '').trim() || 'Policies', last = 0;
      var rest = rows.filter(function (x) { return isNew || x.id !== p.id; });
      rest.forEach(function (x, k) { if (secOf(x) === s) last = k + 1; });
      return last ? last + 1 : rest.length + 1;
    }
    var firstSec = isNew ? null : String(p.section || '').trim();
    function hint() {
      if (!nn.value.trim()) { where.textContent = 'No number: it goes at the end of its section.'; return; }
      if (!/^\d{1,4}$/.test(nn.value.trim())) { where.textContent = 'The number is a whole number from 1 to ' + max + '.'; return; }
      var n = parseInt(nn.value, 10);
      var d = describe(rows, isNew ? null : p.id, n, ss.value.trim() || null);
      where.textContent = (n > max ? 'There ' + (rows.length === 1 ? 'is 1 policy' : 'are ' + rows.length + ' policies') + '. ' : '') +
                          (n < 1 ? 'Numbers start at 1. ' : '') + d.text;
    }
    ss.addEventListener('input', function () {
      if (!typedNo) nn.value = String(isNew || ss.value.trim() !== firstSec ? endOfSection(ss.value) : was);
      hint();
    });
    nn.addEventListener('input', function () { typedNo = true; hint(); });
    hint();

    var busy = false;
    function changed() { return tt.value !== start.t || ss.value !== start.s || nn.value !== start.n || bb.value !== start.b; }
    function close() {
      document.removeEventListener('keydown', onKey, true);
      back.classList.remove('in');
      setTimeout(function () { if (back.parentNode) back.parentNode.removeChild(back); }, 160);
      if (opener && opener.focus) { try { opener.focus({ preventScroll: true }); } catch (e) { opener.focus(); } }
    }
    function tryClose() {
      if (busy) return;
      if (!changed()) { close(); return; }
      dialogs().ask('Close without saving?', { title: 'Not saved yet', danger: true, okText: 'Close',
                                               note: 'What you typed in this window will be lost.' })
        .then(function (yes) { if (yes) close(); });
    }
    function onKey(e) {
      if (document.querySelector('.ask-back')) return;      // a question on top answers its own keys
      if (e.key === 'Escape') { e.preventDefault(); tryClose(); return; }
      if (e.key === 'Tab') {
        var f = [].slice.call(card.querySelectorAll('button,input,textarea')).filter(function (x) { return !x.disabled; });
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener('keydown', onKey, true);
    card.querySelector('.polw-x').addEventListener('click', tryClose);
    card.querySelector('.polw-cancel').addEventListener('click', tryClose);
    back.addEventListener('mousedown', function (e) { if (e.target === back) tryClose(); });

    save.addEventListener('click', function () {
      if (busy) return;
      var title = tt.value.trim();
      if (!title) { stat.textContent = 'A title is needed.'; stat.className = 'stat err polw-stat'; tt.focus(); return; }
      var raw = nn.value.trim();
      if (raw && !/^\d{1,4}$/.test(raw)) {
        stat.textContent = 'The number is a whole number from 1 to ' + max + '.'; stat.className = 'stat err polw-stat'; nn.focus(); return;
      }
      var section = ss.value.trim().replace(/\s+/g, ' ');
      var at = raw ? clampAt(raw, max) : (isNew ? endOfSection(section) : was);
      var after = arrange(rows, isNew ? null : p.id, at, section || null);
      var final = 0;
      after.forEach(function (x, k) { if (x.me) final = k + 1; });
      var spot = place(after);
      busy = true;
      save.disabled = true;
      stat.textContent = 'Saving…'; stat.className = 'stat busy polw-stat';
      var fields = { section: section, title: title, body: bb.value };
      var first = isNew
        ? Promise.resolve(S.sb.from('policies').insert(Object.assign({ sort: spot.sort }, fields)).select('id').single())
        : Promise.resolve(S.sb.from('policies').update(Object.assign({ sort: spot.sort, updated_at: new Date().toISOString() }, fields))
                                   .eq('id', p.id).select('id'));
      first.then(function (r) {
        if (r.error || changedNothing(r)) {
          busy = false; save.disabled = false;
          stat.textContent = 'Not saved'; stat.className = 'stat err polw-stat';
          dialogs().tell(r.error ? r.error.message : REFUSED, { title: 'Not saved' });
          return;
        }
        var id = isNew ? (r.data && r.data.id) : p.id;
        var then = spot.whole ? setOrder(spot.order(id), id) : Promise.resolve({ ok: true });
        return then.then(function (res) {
          var a = audit();
          if (a) {
            if (isNew) {
              a.record({ action: 'added', module: 'Policies', record: title,
                         changes: [{ field: 'number', from: '', to: String(final) }] });
            } else {
              var ch = a.diff ? a.diff({ section: p.section, title: p.title, body: p.body },
                                       { section: section, title: title, body: bb.value }, 'policies') : [];
              if (final !== was) ch = (ch || []).concat([{ field: 'number', from: String(was), to: String(final) }]);
              a.record({ action: 'changed', module: 'Policies', record: title, changes: ch });
            }
          }
          close();
          return load(id).then(function () {
            if (!res.ok) {
              status('Saved, but the order was not', 'err', id);
              dialogs().tell(orderProblem(res.why), { title: 'The order was not saved' });
              return;
            }
            status(isNew ? '"' + title + '" added as number ' + final + '.'
                         : (final !== was ? '"' + title + '" saved, now number ' + final + '.' : '"' + title + '" saved.'), 'ok', id);
          });
        });
      }, function (e) {
        busy = false; save.disabled = false;
        stat.textContent = 'Not saved'; stat.className = 'stat err polw-stat';
        dialogs().tell((e && e.message) || 'That could not be saved just now.', { title: 'Not saved' });
      });
    });

    document.body.appendChild(back);
    requestAnimationFrame(function () { back.classList.add('in'); });
    tt.focus();
  }

  window.VBP_POLICIES = { mount: mount, load: load, add: function (opener) { openWindow(null, opener); }, plan: plan };
})();
