/* =====================================================================
   Vaultique Boutique Point — asking, in the shop's own voice
   ---------------------------------------------------------------------
   Replaces confirm() and alert(). Those carry the browser's chrome and
   the site's domain, which is a strange thing to be shown by your own
   admin halfway through deleting a policy.

     ask('Delete this policy?', { danger: true }) -> Promise<boolean>
     tell('No subscribers yet.')                  -> Promise<true>

   Escape cancels, Enter confirms, and focus goes back to whatever opened
   it, so a keyboard never gets stranded.

   Lifted out of admin.html unchanged so the chat desk at agent.html asks
   in the same voice. It depends on nothing but the document — no client,
   no settings, no admin — which is what made the move safe.
   ===================================================================== */
(function () {
  'use strict';
    function ask(question, opts) {
      opts = opts || {};
      var came = document.activeElement;

      return new Promise(function (resolve) {
        var back = document.createElement('div');
        back.className = 'ask-back';
        back.setAttribute('role', 'dialog');
        back.setAttribute('aria-modal', 'true');

        var card = document.createElement('div');
        card.className = 'ask-card';
        card.innerHTML =
          '<h3></h3><p></p>' +
          (opts.note ? '<div class="ask-note"></div>' : '') +
          '<div class="ask-row"></div>';
        card.querySelector('h3').textContent = opts.title || (opts.tell ? 'Just so you know' : 'Are you sure?');
        card.querySelector('p').textContent = question;
        if (!question) card.querySelector('p').style.display = 'none';
        if (opts.note) card.querySelector('.ask-note').textContent = opts.note;

        var box = null;
        if (opts.copyText) {
          box = document.createElement('textarea');
          box.readOnly = true;
          box.value = opts.copyText;
          box.style.cssText = 'width:100%;height:110px;margin-top:10px;font-size:12.5px';
          card.insertBefore(box, card.querySelector('.ask-row'));
        }

        /* Two shapes the browser's own prompt() used to cover: typing an
           answer, and picking one out of a list. Both belong here rather
           than in the one page that happened to need them — this is the
           admin's one way of asking, in the shop's voice, and some
           browsers block prompt() outright.

           With either of these the answer is the value or null, not a
           yes/no. Nothing that asks a plain question passes them, so
           everything that already called this still gets true or false. */
        var field = null;
        if (opts.input) {
          field = document.createElement('input');
          field.type = 'text';
          field.className = 'ask-input';
          field.placeholder = opts.input.placeholder || '';
          field.value = opts.input.value || '';
          if (opts.input.maxLength) field.setAttribute('maxlength', String(opts.input.maxLength));
          field.setAttribute('aria-label', opts.input.label || question || 'Your answer');
          field.style.cssText = 'width:100%;margin-top:10px;padding:10px 12px;font-size:14px';
          card.insertBefore(field, card.querySelector('.ask-row'));
        }

        var picks = [];
        if (opts.choices && opts.choices.length) {
          var list = document.createElement('div');
          list.className = 'ask-choices';
          list.style.cssText = 'margin-top:10px;display:flex;flex-direction:column;gap:6px;max-height:280px;overflow:auto';
          opts.choices.forEach(function (c) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'btn btn-out btn-sm';
            b.style.cssText = 'text-align:left;justify-content:flex-start';
            b.textContent = c.label;
            if (c.hint) {
              var h = document.createElement('span');
              h.className = 'hint';
              h.style.cssText = 'margin-left:8px';
              h.textContent = c.hint;
              b.appendChild(h);
            }
            b.addEventListener('click', function () { close(c.value); });
            picks.push(b);
            list.appendChild(b);
          });
          card.insertBefore(list, card.querySelector('.ask-row'));
        }

        var row = card.querySelector('.ask-row');
        var no = null;
        if (!opts.tell) {
          no = document.createElement('button');
          no.type = 'button';
          no.className = 'btn btn-out btn-sm';
          no.textContent = opts.cancelText || 'Cancel';
          row.appendChild(no);
        }
        /* A list of things to pick from answers itself, so there is
           nothing for a Yes button to mean. */
        var yes = null;
        if (!picks.length) {
          yes = document.createElement('button');
          yes.type = 'button';
          yes.className = 'btn btn-sm ' + (opts.danger ? 'btn-danger' : 'btn-gold');
          yes.textContent = opts.okText || (opts.tell ? 'Close' : (opts.danger ? 'Delete' : 'Yes'));
          row.appendChild(yes);
        }

        /* What Cancel, Escape and a click outside all mean. A question
           answered with a value says "nothing", not "no". */
        var nothing = (field || picks.length) ? null : false;

        back.appendChild(card);
        document.body.appendChild(back);
        requestAnimationFrame(function () { back.classList.add('in'); });

        /* A destructive answer should not be the one a stray keypress
           lands on, so Cancel takes the focus when there is something to
           destroy. */
        if (field) { field.focus(); field.select(); }
        else if (box) { box.focus(); box.select(); }
        else if (picks.length) picks[0].focus();
        else (opts.danger && no ? no : yes).focus();

        function close(answer) {
          document.removeEventListener('keydown', onKey, true);
          back.classList.remove('in');
          var gone = false;
          function drop() {
            if (gone) return;
            gone = true;
            if (back.parentNode) back.parentNode.removeChild(back);
            if (came && came.focus) { try { came.focus(); } catch (e) {} }
            resolve(answer);
          }
          back.addEventListener('transitionend', drop);
          setTimeout(drop, 220);            // in case the transition never fires
        }

        function said() { return field ? field.value : true; }

        function onKey(e) {
          if (e.key === 'Escape') { e.preventDefault(); close(nothing); return; }
          if (e.key === 'Enter' && document.activeElement !== no) {
            /* Enter on one of the choices is that choice; its own click
               handler already answers, so this stays out of the way. */
            if (picks.length && picks.indexOf(document.activeElement) > -1) return;
            if (picks.length && !field) return;
            e.preventDefault(); close(said()); return;
          }
          if (e.key !== 'Tab') return;
          /* Keep the tab ring inside the dialog: behind it sits a whole
             admin page nobody should be able to reach right now. */
          var stops = [field, box].concat(picks).concat([no, yes]).filter(Boolean);
          var first = stops[0], last = stops[stops.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }

        document.addEventListener('keydown', onKey, true);
        if (yes) yes.addEventListener('click', function () { close(said()); });
        if (no) no.addEventListener('click', function () { close(nothing); });
        back.addEventListener('click', function (e) { if (e.target === back) close(nothing); });
      });
    }
    function tell(message, opts) {
      opts = opts || {};
      opts.tell = true;
      return ask(message, opts);
    }
  window.VBP_DIALOGS = { ask: ask, tell: tell };
})();
