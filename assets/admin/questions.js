/* =====================================================================
   Vaultique Boutique Point — questions & answers (build 90)
   ---------------------------------------------------------------------
   The customer portal's plan: "questions on a piece (answered in the live
   chat, and the shop may publish an answer)". Customers ask with Ask a
   question on a piece's page, which opens the live chat with the piece
   named. The answers worth keeping are published here, in Admin >
   Reviews, Questions & answers, and show on the piece's page under its
   reviews (supabase-shopping.sql, product_questions).

   One window over the list to add or change one, as Admin > Policies
   has (the same look: assets/admin/admin.css, .polw-*).
   ===================================================================== */
(function () {
  'use strict';

  var S = { sb: null, rows: [], pieces: null, ready: false };

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function dialogs() { return window.VBP_DIALOGS || { ask: function () { return Promise.resolve(false); }, tell: function () { return Promise.resolve(true); } }; }
  function audit() { return (window.VBP_ADMIN || {}).audit; }
  function changedNothing(r) { return !r || !r.data || (Array.isArray(r.data) && r.data.length === 0); }
  function notReady(e) { return /PGRST205|42P01|Could not find the table|relation .* does not exist/i.test(String((e && (e.message || e.code)) || '')); }
  function refused(e) { return /row-level security|permission denied|42501/i.test(String((e && (e.message || e.code)) || '')); }
  var REFUSED = 'The database did not accept this change, so nothing was saved. This sign-in may not change reviews. ' +
                'Sign out of the admin and sign in again with the shop owner’s account, or ask the owner to allow ' +
                'it for your role in Settings > Users & Roles.';

  function mount(opts) {
    S.sb = opts.sb;
    if (S.ready) return;
    S.ready = true;
    var add = $('qaAdd');
    if (add) add.addEventListener('click', function () { openWindow(null, add); });
  }

  /* The shop's pieces, for choosing which one an answer is about. */
  function pieces() {
    if (S.pieces) return S.pieces;
    S.pieces = fetch('/api/products').then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (b) { return (b && b.products) || []; }, function () { return []; });
    return S.pieces;
  }
  function nameOf(list, sku) {
    var p = (list || []).filter(function (x) { return x.sku === sku; })[0];
    return p ? p.name : '';
  }

  function status(text, kind) {
    var st = $('qaStat');
    if (!st) return;
    st.textContent = text || '';
    st.className = 'stat' + (kind ? ' ' + kind : '');
  }

  function load() {
    var host = $('qaList');
    if (!host || !S.sb) return Promise.resolve();
    host.innerHTML = '<p class="count">Loading…</p>';
    return Promise.all([
      Promise.resolve(S.sb.from('product_questions').select('*').order('sku', { ascending: true }).order('sort', { ascending: true })),
      pieces()
    ]).then(function (got) {
      var r = got[0], list = got[1];
      host.innerHTML = '';
      if (r && r.error) {
        host.appendChild(el('p', 'count', notReady(r.error)
          ? 'Not ready yet: run supabase-shopping.sql once in the website’s Supabase (SQL Editor), then come back here.'
          : 'Error: ' + r.error.message));
        return;
      }
      S.rows = (r && r.data) || [];
      var cnt = $('qaCount');
      if (cnt) cnt.textContent = S.rows.length === 1 ? '1 answer' : S.rows.length + ' answers';
      if (!S.rows.length) {
        host.appendChild(el('p', 'count', 'No answers published yet. When a customer asks something others would want to know, ' +
                                          'press Add an answer.'));
        return;
      }
      S.rows.forEach(function (q) { host.appendChild(row(q, list)); });
    });
  }

  function row(q, list) {
    var d = el('div', 'qa-row card');
    d.setAttribute('data-id', q.id);
    var top = el('div', 'qa-row-top');
    top.appendChild(el('span', 'sku', q.sku + (nameOf(list, q.sku) ? ' · ' + nameOf(list, q.sku) : '')));
    top.appendChild(el('span', 'qa-state' + (q.published ? ' on' : ''), q.published ? 'Published' : 'Not shown'));
    d.appendChild(top);
    var qq = el('p', 'qa-row-q');
    qq.appendChild(el('b', '', 'Q '));
    qq.appendChild(document.createTextNode(q.question));
    var aa = el('p', 'qa-row-a');
    aa.appendChild(el('b', '', 'A '));
    aa.appendChild(document.createTextNode(q.answer));
    d.appendChild(qq);
    d.appendChild(aa);
    var acts = el('div', 'row');
    var edit = el('button', 'btn btn-out btn-sm', 'Edit');
    edit.type = 'button';
    edit.addEventListener('click', function () { openWindow(q, edit); });
    var del = el('button', 'btn btn-out btn-sm', 'Delete');
    del.type = 'button';
    del.addEventListener('click', function () {
      dialogs().ask('Delete this answer?', { danger: true, note: 'It is taken off the piece’s page. This cannot be undone.' })
        .then(function (yes) {
          if (!yes) return;
          Promise.resolve(S.sb.from('product_questions').delete().eq('id', q.id).select('id')).then(function (r) {
            if (r.error || changedNothing(r)) { dialogs().tell(r.error ? r.error.message : REFUSED, { title: 'Not deleted' }); return; }
            var a = audit();
            if (a) a.record({ action: 'deleted', module: 'Reviews', record: 'Answer on ' + q.sku });
            load().then(function () { status('Deleted.', 'ok'); });
          });
        });
    });
    acts.appendChild(edit);
    acts.appendChild(del);
    d.appendChild(acts);
    return d;
  }

  function openWindow(q, opener) {
    if (document.querySelector('.polw-back')) return;
    var isNew = !q;
    var back = el('div', 'polw-back');
    back.setAttribute('role', 'dialog');
    back.setAttribute('aria-modal', 'true');
    back.setAttribute('aria-labelledby', 'qawTitle');
    var card = el('div', 'polw-card');
    card.innerHTML =
      '<div class="polw-head"><h3 id="qawTitle"></h3><button type="button" class="polw-x" aria-label="Close">×</button></div>' +
      '<div class="polw-body">' +
        '<div class="field"><label for="qaw_sku">The piece</label>' +
          '<input type="text" id="qaw_sku" maxlength="60" list="qaw_skus" autocomplete="off" placeholder="Its code, or start typing its name">' +
          '<datalist id="qaw_skus"></datalist><div class="hint" id="qaw_which"></div></div>' +
        '<div class="field"><label for="qaw_q">The question</label><textarea id="qaw_q" rows="3" maxlength="500"></textarea></div>' +
        '<div class="field"><label for="qaw_a">The answer</label><textarea id="qaw_a" rows="6" maxlength="2000"></textarea></div>' +
        '<label class="qaw-pub"><input type="checkbox" id="qaw_pub"> Show it on the piece’s page</label>' +
      '</div>' +
      '<div class="polw-foot"><span class="stat polw-stat" aria-live="polite"></span>' +
        '<button type="button" class="btn btn-out btn-sm polw-cancel">Cancel</button>' +
        '<button type="button" class="btn btn-gold btn-sm polw-save"></button></div>';
    back.appendChild(card);
    var sku = card.querySelector('#qaw_sku'), qq = card.querySelector('#qaw_q'), aa = card.querySelector('#qaw_a'),
        pub = card.querySelector('#qaw_pub'), which = card.querySelector('#qaw_which'), dl = card.querySelector('#qaw_skus'),
        stat = card.querySelector('.polw-stat'), save = card.querySelector('.polw-save');
    card.querySelector('#qawTitle').textContent = isNew ? 'Add an answer' : 'Edit the answer';
    save.textContent = isNew ? 'Publish' : 'Save';
    sku.value = isNew ? '' : q.sku;
    qq.value = isNew ? '' : q.question;
    aa.value = isNew ? '' : q.answer;
    pub.checked = isNew ? true : !!q.published;
    var list = [];
    pieces().then(function (l) {
      list = l || [];
      list.slice(0, 2000).forEach(function (p) {
        var o = document.createElement('option');
        o.value = p.sku;
        o.label = p.name;
        o.textContent = p.name;
        dl.appendChild(o);
      });
      say();
    });
    function say() {
      var v = sku.value.trim();
      var n = nameOf(list, v);
      which.textContent = !v ? '' : (n ? n : (list.length ? 'No piece in the shop has this code.' : ''));
    }
    sku.addEventListener('input', say);
    var start = { s: sku.value, q: qq.value, a: aa.value, p: pub.checked };
    function changed() { return sku.value !== start.s || qq.value !== start.q || aa.value !== start.a || pub.checked !== start.p; }
    var busy = false;
    function close() {
      document.removeEventListener('keydown', onKey, true);
      if (back.parentNode) back.parentNode.removeChild(back);
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
      if (document.querySelector('.ask-back')) return;
      if (e.key === 'Escape') { e.preventDefault(); tryClose(); }
    }
    document.addEventListener('keydown', onKey, true);
    card.querySelector('.polw-x').addEventListener('click', tryClose);
    card.querySelector('.polw-cancel').addEventListener('click', tryClose);
    back.addEventListener('mousedown', function (e) { if (e.target === back) tryClose(); });
    save.addEventListener('click', function () {
      if (busy) return;
      var s = sku.value.trim(), question = qq.value.trim(), answer = aa.value.trim();
      var bad = !s ? 'Which piece is it about?' : question.length < 3 ? 'The question is needed.' : !answer ? 'The answer is needed.' : '';
      if (bad) { stat.textContent = bad; stat.className = 'stat err polw-stat'; return; }
      busy = true; save.disabled = true;
      stat.textContent = 'Saving…'; stat.className = 'stat busy polw-stat';
      var rowData = { sku: s, question: question, answer: answer, published: pub.checked, updated_at: new Date().toISOString() };
      var call = isNew
        ? S.sb.from('product_questions').insert(rowData).select('id')
        : S.sb.from('product_questions').update(rowData).eq('id', q.id).select('id');
      Promise.resolve(call).then(function (r) {
        busy = false; save.disabled = false;
        if (r.error || changedNothing(r)) {
          stat.textContent = 'Not saved'; stat.className = 'stat err polw-stat';
          dialogs().tell(!r.error || refused(r.error) ? REFUSED
                         : notReady(r.error) ? 'Run supabase-shopping.sql once first.' : r.error.message,
                         { title: 'Not saved' });
          return;
        }
        var a = audit();
        if (a) a.record({ action: isNew ? 'added' : 'changed', module: 'Reviews', record: 'Answer on ' + s });
        close();
        load().then(function () { status(isNew ? (pub.checked ? 'Published on ' + s + '.' : 'Saved, not shown.') : 'Saved.', 'ok'); });
      }, function (e) {
        busy = false; save.disabled = false;
        stat.textContent = 'Not saved'; stat.className = 'stat err polw-stat';
        dialogs().tell((e && e.message) || 'That could not be saved just now.', { title: 'Not saved' });
      });
    });
    document.body.appendChild(back);
    requestAnimationFrame(function () { back.classList.add('in'); });
    (isNew ? sku : qq).focus();
  }

  window.VBP_QUESTIONS = { mount: mount, load: load };
})();
