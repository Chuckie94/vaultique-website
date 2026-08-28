/* =====================================================================
   Vaultique Boutique Point - Admin > Activity / Audit Log
   ---------------------------------------------------------------------
   What changed in this admin, when, and who changed it.

   Reading only. There is no way to edit or remove a line from here, and
   no way to do it from anywhere else either: the table has a policy to
   write a line and a policy to read the lines, and none at all to change
   or delete one. A record the recorded person can tidy up afterwards is
   not a record of anything.

   Two columns are worth explaining, because both could easily have been
   filled with something that looks better than the truth.

   Previous and new value are empty for anything private. A change to the
   bank account number shows that the account number changed, and never
   what it changed from or to - putting that number here would undo the
   whole reason it is kept in a table the website cannot read. It is held
   back in the recording, not merely hidden in the showing, so it is not
   in the database to be found.

   Session information is the browser and the device, because that is
   what a page can honestly know. It is not a location and not an
   internet address: a browser cannot see either, and a column labelled
   "session" holding a guess would be worse than one holding the little
   that is true.
   ===================================================================== */
(function () {
  'use strict';
  if (!window.VBP_ADMIN) return;

  var A = window.VBP_ADMIN;
  var PAGE = 50;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function when(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var F = window.VBP_FORMAT || {};
    var day = F.date ? F.date(d, 'D MMMM YYYY') : d.toDateString();
    return day + ' at ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  var ACTIONS = { added: 'Added', changed: 'Changed', deleted: 'Deleted' };

  A.registerPage({
    key: 'activity',
    title: 'Activity / Audit Log',
    summary: 'A record of changes made in the admin, and who made them.',
    render: function (host, ctx) {
      host.innerHTML = '';

      var rows = [];          // everything fetched so far
      var reachedEnd = false;
      var loading = false;

      /* ---- the controls -------------------------------------------- */
      var bar = el('div', 'toolbar');
      var count = el('span', 'count', 'Reading…');
      bar.appendChild(count);

      var search = document.createElement('input');
      search.type = 'search';
      search.className = 'sub-search';
      search.placeholder = 'Search by person, section or record';
      search.setAttribute('aria-label', 'Search the activity log');
      bar.appendChild(search);

      var modulePick = document.createElement('select');
      modulePick.className = 'al-pick';
      modulePick.appendChild(new Option('Everywhere', ''));
      bar.appendChild(modulePick);

      var actionPick = document.createElement('select');
      actionPick.className = 'al-pick';
      actionPick.appendChild(new Option('Anything', ''));
      Object.keys(ACTIONS).forEach(function (k) {
        actionPick.appendChild(new Option(ACTIONS[k], k));
      });
      bar.appendChild(actionPick);

      host.appendChild(bar);

      var body = el('div', 'al-list');
      body.appendChild(el('p', 'count', 'Reading…'));
      host.appendChild(body);

      var moreRow = el('div', 'row');
      var moreBtn = el('button', 'btn btn-out btn-sm', 'Show older');
      moreBtn.type = 'button';
      moreRow.appendChild(moreBtn);
      moreRow.classList.add('hide');
      host.appendChild(moreRow);

      /* ---- reading -------------------------------------------------- */
      function fetchMore() {
        if (loading || reachedEnd) return Promise.resolve();
        loading = true;
        moreBtn.disabled = true;
        var from = rows.length;

        return ctx.sb.from('activity_log')
          .select('*')
          .order('at', { ascending: false })
          .range(from, from + PAGE - 1)
          .then(function (r) {
            loading = false;
            moreBtn.disabled = false;
            if (r.error) throw r.error;
            var batch = r.data || [];
            rows = rows.concat(batch);
            if (batch.length < PAGE) reachedEnd = true;
            refreshModules();
            draw();
          })
          .catch(function (e) {
            loading = false;
            moreBtn.disabled = false;
            body.innerHTML = '';
            var msg = (e && e.message) || String(e);
            var p = el('p', 'count');
            /* Almost always one thing: the table is not there yet. Say
               which file makes it rather than showing the raw error. */
            p.textContent = /activity_log|schema cache|does not exist/i.test(msg)
              ? 'The activity log has not been set up in the database yet. ' +
                'Running supabase-setup.sql once creates it, and changes from then on are recorded.'
              : 'The log could not be read: ' + msg;
            body.appendChild(p);
            count.textContent = '';
          });
      }

      function refreshModules() {
        var have = {}, i;
        for (i = 1; i < modulePick.options.length; i++) have[modulePick.options[i].value] = true;
        var found = [];
        rows.forEach(function (r) { if (r.module && !have[r.module]) { have[r.module] = true; found.push(r.module); } });
        found.sort().forEach(function (m) { modulePick.appendChild(new Option(m, m)); });
      }

      /* ---- drawing --------------------------------------------------- */
      function matches(r) {
        if (modulePick.value && r.module !== modulePick.value) return false;
        if (actionPick.value && (r.action || 'changed') !== actionPick.value) return false;
        var q = (search.value || '').trim().toLowerCase();
        if (!q) return true;
        return [r.actor_email, r.module, r.record, r.action]
          .some(function (v) { return String(v || '').toLowerCase().indexOf(q) > -1; });
      }

      function changeLines(r) {
        var list = Array.isArray(r.changes) ? r.changes : [];
        if (!list.length) return null;
        var wrap = el('div', 'al-changes');
        list.forEach(function (c) {
          var line = el('div', 'al-change');
          line.appendChild(el('span', 'al-field', c.field));
          if (c.hidden) {
            /* The value is not withheld here - it was never recorded. */
            line.appendChild(el('span', 'al-hidden', 'changed · value not recorded'));
          } else {
            line.appendChild(el('span', 'al-from', c.from === '' || c.from == null ? '—' : c.from));
            line.appendChild(el('span', 'al-arrow', '→'));
            line.appendChild(el('span', 'al-to', c.to === '' || c.to == null ? '—' : c.to));
          }
          wrap.appendChild(line);
        });
        return wrap;
      }

      function entry(r) {
        var item = el('div', 'al-item');

        var head = el('div', 'al-head');
        var act = el('span', 'al-action is-' + (r.action || 'changed'),
                     ACTIONS[r.action] || 'Changed');
        head.appendChild(act);
        head.appendChild(el('span', 'al-module', r.module || '—'));
        if (r.record) head.appendChild(el('span', 'al-record', r.record));
        item.appendChild(head);

        var lines = changeLines(r);
        if (lines) item.appendChild(lines);

        var foot = el('div', 'al-foot');
        foot.appendChild(el('span', null, when(r.at)));
        foot.appendChild(el('span', null, r.actor_email || 'an administrator'));
        if (r.device) foot.appendChild(el('span', null, r.device));
        item.appendChild(foot);

        return item;
      }

      function draw() {
        var shown = rows.filter(matches);
        body.innerHTML = '';

        count.textContent = rows.length
          ? shown.length + (shown.length === 1 ? ' entry' : ' entries') +
            (shown.length !== rows.length ? ' of ' + rows.length : '') +
            (reachedEnd ? '' : ' so far')
          : '';

        if (!rows.length) {
          body.appendChild(el('p', 'count',
            'Nothing recorded yet. Every change made in this admin from now on appears here.'));
          moreRow.classList.add('hide');
          return;
        }
        if (!shown.length) {
          body.appendChild(el('p', 'count', 'Nothing matches those filters.'));
        } else {
          shown.forEach(function (r) { body.appendChild(entry(r)); });
        }
        moreRow.classList[reachedEnd ? 'add' : 'remove']('hide');
      }

      search.addEventListener('input', draw);
      modulePick.addEventListener('change', draw);
      actionPick.addEventListener('change', draw);
      moreBtn.addEventListener('click', function () { fetchMore(); });

      fetchMore();
    }
  });
})();
