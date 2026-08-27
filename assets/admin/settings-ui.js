/* =====================================================================
   Vaultique Boutique Point - admin settings form kit
   ---------------------------------------------------------------------
   The shared building blocks every Settings category uses to draw its
   form. A category describes the fields it wants and this file does the
   rest: drawing them, loading the saved values in, tracking unsaved
   changes, validating, saving, and reporting what happened.

   A category never touches the database and never writes markup.

     ctx.ui.form(host, {
       key: 'general',
       groups: [
         { title: 'Business identity', note: 'Shown to customers.',
           fields: [
             { type: 'text', name: 'businessName', label: 'Business name',
               required: true, maxLength: 80, hint: 'The legal name.' },
             { type: 'text', name: 'city', label: 'City', half: true },
             { type: 'text', name: 'country', label: 'Country', half: true }
           ] }
       ],
       validate: function (values, fail) { ... },   // optional, cross-field
       beforeSave: function (values) { ... }        // optional, may return a promise
     });

   Field types
     text      one line of text
     textarea  several lines            (rows)
     select    a fixed list of choices  (options: [{ value, label }])
     toggle    on or off                (stored as true / false)
     hours     a seven day open/close grid

   Shared options
     name       the key this field is stored under        (required)
     label      what the admin sees                       (required)
     hint       small grey line under the field
     half       pair this field with the next half field
     required   must not be left blank
     maxLength  cap, with a live counter
     validate   function (value, values) returning an error string or ''
     showIf     function (values) - hide the field when it returns false
   ===================================================================== */
(function () {
  'use strict';

  var api = window.VBP_ADMIN || {};

  var DAYS = [
    { key: 'mon', label: 'Monday' },
    { key: 'tue', label: 'Tuesday' },
    { key: 'wed', label: 'Wednesday' },
    { key: 'thu', label: 'Thursday' },
    { key: 'fri', label: 'Friday' },
    { key: 'sat', label: 'Saturday' },
    { key: 'sun', label: 'Sunday' }
  ];

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  /* ---------- business hours helpers ---------------------------------- */
  /* The wording lives in assets/formats.js so that the preview shown while
     editing is the very same text the storefront prints. */
  var F = window.VBP_FORMAT;

  function emptyHours() {
    var out = {};
    DAYS.forEach(function (d) { out[d.key] = { open: false, from: '09:00', to: '17:00' }; });
    return out;
  }
  function minutes(hhmm) { return F.minutes(hhmm); }
  function pretty(hhmm) { return F.prettyTime(hhmm); }
  function summariseHours(hours) { return F.summariseHours(hours); }

  /* ---------- individual field builders ------------------------------ */

  /* Every field builder returns a controller the form drives:
       node   the element to place in the page
       get()  read the current value
       set(v) write a value in
       mark(msg) show or clear an inline error */
  function baseField(f) {
    var wrap = el('div', 'field');
    var lab = el('label', null, f.label);
    lab.setAttribute('for', 'f_' + f.name);
    if (f.required) { var star = el('span', 'req', ' *'); lab.appendChild(star); }
    wrap.appendChild(lab);
    return { wrap: wrap, label: lab };
  }

  function attachExtras(ctrl, f, input) {
    if (f.hint) ctrl.wrap.appendChild(el('div', 'hint', f.hint));
    var errLine = el('div', 'err-txt');
    ctrl.wrap.appendChild(errLine);

    var counter = null;
    if (f.maxLength) {
      counter = el('div', 'cnt');
      ctrl.wrap.appendChild(counter);
      input.setAttribute('maxlength', String(f.maxLength));
    }

    ctrl.mark = function (msg) {
      if (msg) { ctrl.wrap.classList.add('bad'); errLine.textContent = msg; }
      else { ctrl.wrap.classList.remove('bad'); errLine.textContent = ''; }
    };
    ctrl.count = function () {
      if (!counter) return;
      var n = (input.value || '').length;
      counter.textContent = n + ' / ' + f.maxLength;
      counter.classList[n >= f.maxLength ? 'add' : 'remove']('full');
    };
    ctrl.focus = function () { try { input.focus(); } catch (e) {} };
  }

  function textField(f, changed) {
    var c = baseField(f);
    var input = el('input');
    input.type = 'text';
    input.id = 'f_' + f.name;
    if (f.placeholder) input.placeholder = f.placeholder;
    c.wrap.appendChild(input);

    var ctrl = { node: c.wrap, wrap: c.wrap };
    attachExtras(ctrl, f, input);
    input.addEventListener('input', function () { ctrl.count(); ctrl.mark(''); changed(); });

    ctrl.get = function () { return input.value.trim(); };
    ctrl.set = function (v) { input.value = (v === undefined || v === null) ? '' : String(v); ctrl.count(); };
    return ctrl;
  }

  function textareaField(f, changed) {
    var c = baseField(f);
    var input = el('textarea');
    input.id = 'f_' + f.name;
    input.rows = f.rows || 3;
    if (f.placeholder) input.placeholder = f.placeholder;
    c.wrap.appendChild(input);

    var ctrl = { node: c.wrap, wrap: c.wrap };
    attachExtras(ctrl, f, input);
    input.addEventListener('input', function () { ctrl.count(); ctrl.mark(''); changed(); });

    ctrl.get = function () { return input.value.trim(); };
    ctrl.set = function (v) { input.value = (v === undefined || v === null) ? '' : String(v); ctrl.count(); };
    return ctrl;
  }

  function selectField(f, changed) {
    var c = baseField(f);
    var sel = el('select');
    sel.id = 'f_' + f.name;
    (f.options || []).forEach(function (o) {
      var opt = el('option', null, o.label);
      opt.value = o.value;
      sel.appendChild(opt);
    });
    c.wrap.appendChild(sel);

    var ctrl = { node: c.wrap, wrap: c.wrap };
    attachExtras(ctrl, f, sel);
    sel.addEventListener('change', function () { ctrl.mark(''); changed(); });

    ctrl.get = function () { return sel.value; };
    ctrl.set = function (v) {
      sel.value = (v === undefined || v === null) ? '' : String(v);
      /* A stored value that is no longer on the list would silently
         reset the field, so keep it and show it as retired. */
      if (sel.selectedIndex < 0 && v) {
        var opt = el('option', null, String(v) + ' (no longer listed)');
        opt.value = String(v);
        sel.insertBefore(opt, sel.firstChild);
        sel.value = String(v);
      }
    };
    return ctrl;
  }

  function toggleField(f, changed) {
    var wrap = el('div', 'field sw-field');
    var row = el('label', 'sw-row');
    var box = el('input');
    box.type = 'checkbox';
    box.id = 'f_' + f.name;
    var track = el('span', 'sw');
    var text = el('span', 'sw-lab', f.label);
    row.appendChild(box); row.appendChild(track); row.appendChild(text);
    wrap.appendChild(row);
    /* Shown, and explained, but not yet a choice: a setting whose other
       half has not been built has to say so rather than pretend. */
    if (f.disabled) {
      box.disabled = true;
      wrap.classList.add('locked');
      row.setAttribute('title', f.disabledReason || '');
    }
    if (f.hint) wrap.appendChild(el('div', 'hint', f.hint));
    var errLine = el('div', 'err-txt');
    wrap.appendChild(errLine);

    var ctrl = { node: wrap, wrap: wrap };
    box.addEventListener('change', function () { ctrl.mark(''); changed(); });
    ctrl.get = function () { return !!box.checked; };
    ctrl.set = function (v) { box.checked = !!v; };
    ctrl.mark = function (msg) {
      if (msg) { wrap.classList.add('bad'); errLine.textContent = msg; }
      else { wrap.classList.remove('bad'); errLine.textContent = ''; }
    };
    ctrl.focus = function () { try { box.focus(); } catch (e) {} };
    return ctrl;
  }

  function hoursField(f, changed) {
    var wrap = el('div', 'field');
    wrap.appendChild(el('label', null, f.label));
    if (f.hint) wrap.appendChild(el('div', 'hint', f.hint));

    var grid = el('div', 'hrs');
    grid.id = 'f_' + f.name;
    grid.setAttribute('role', 'group');
    grid.setAttribute('aria-label', f.label);
    var rows = {};
    DAYS.forEach(function (d) {
      var row = el('div', 'hrs-row');

      var toggleWrap = el('label', 'hrs-day');
      var box = el('input'); box.type = 'checkbox';
      var track = el('span', 'sw sw-sm');
      var name = el('span', null, d.label);
      toggleWrap.appendChild(box); toggleWrap.appendChild(track); toggleWrap.appendChild(name);

      var times = el('div', 'hrs-times');
      var from = el('input'); from.type = 'time'; from.setAttribute('aria-label', d.label + ' opening time');
      var dash = el('span', 'hrs-dash', '–');
      var to = el('input'); to.type = 'time'; to.setAttribute('aria-label', d.label + ' closing time');
      var shut = el('span', 'hrs-shut', 'Closed');
      times.appendChild(from); times.appendChild(dash); times.appendChild(to); times.appendChild(shut);

      row.appendChild(toggleWrap);
      row.appendChild(times);
      grid.appendChild(row);

      function sync() { row.classList[box.checked ? 'remove' : 'add']('shut'); }
      box.addEventListener('change', function () { sync(); ctrl.mark(''); changed(); });
      from.addEventListener('change', function () { ctrl.mark(''); changed(); });
      to.addEventListener('change', function () { ctrl.mark(''); changed(); });

      rows[d.key] = { box: box, from: from, to: to, sync: sync };
    });
    wrap.appendChild(grid);

    /* Setting seven days one at a time is tedious, and most shops keep
       one pattern with a different weekend. */
    var copyBtn = el('button', 'btn btn-out btn-sm', 'Apply Monday’s times to every open day');
    copyBtn.type = 'button';
    copyBtn.addEventListener('click', function () {
      var m = rows.mon;
      DAYS.forEach(function (d) {
        if (d.key === 'mon') return;
        var r = rows[d.key];
        if (!r.box.checked) return;
        r.from.value = m.from.value;
        r.to.value = m.to.value;
      });
      ctrl.mark('');
      changed();
    });
    var tools = el('div', 'hrs-tools');
    tools.appendChild(copyBtn);
    wrap.appendChild(tools);

    var errLine = el('div', 'err-txt');
    wrap.appendChild(errLine);

    var summary = el('div', 'hrs-sum');
    wrap.appendChild(summary);

    var ctrl = { node: wrap, wrap: wrap };

    function refreshSummary() {
      var s = summariseHours(ctrl.get());
      summary.textContent = s ? 'Customers will see: ' + s : '';
    }

    ctrl.get = function () {
      var out = {};
      DAYS.forEach(function (d) {
        var r = rows[d.key];
        out[d.key] = { open: !!r.box.checked, from: r.from.value || '', to: r.to.value || '' };
      });
      return out;
    };
    ctrl.set = function (v) {
      var val = v && typeof v === 'object' ? v : emptyHours();
      DAYS.forEach(function (d) {
        var r = rows[d.key], day = val[d.key] || {};
        r.box.checked = !!day.open;
        r.from.value = day.from || '09:00';
        r.to.value = day.to || '17:00';
        r.sync();
      });
      refreshSummary();
    };
    ctrl.mark = function (msg) {
      if (msg) { wrap.classList.add('bad'); errLine.textContent = msg; }
      else { wrap.classList.remove('bad'); errLine.textContent = ''; }
    };
    ctrl.focus = function () { try { rows.mon.box.focus(); } catch (e) {} };
    ctrl.afterChange = refreshSummary;

    /* Built-in rule: an open day needs a closing time later than its
       opening time, otherwise the summary line is nonsense. */
    ctrl.check = function () {
      var bad = [];
      DAYS.forEach(function (d) {
        var r = rows[d.key];
        if (!r.box.checked) return;
        var a = minutes(r.from.value), b = minutes(r.to.value);
        if (a < 0 || b < 0) { bad.push(d.label + ' needs an opening and a closing time'); return; }
        if (b <= a) bad.push(d.label + ' closes before it opens');
      });
      if (!DAYS.some(function (d) { return rows[d.key].box.checked; })) {
        return 'Pick at least one open day, or the shop reads as closed all week.';
      }
      return bad.length ? bad.join('. ') + '.' : '';
    };
    return ctrl;
  }


  /* An uploaded image: a logo, a favicon, a sharing picture. The stored
     value is the public URL of the file. Uploading replaces whatever was
     there; removing clears the setting but leaves the file in the bucket,
     since another section may well be pointing at it. */
  function imageField(f, changed) {
    var wrap = el('div', 'field');
    var lab = el('label', null, f.label);
    lab.setAttribute('for', 'f_' + f.name);      // clicking the label opens the picker
    wrap.appendChild(lab);
    if (f.hint) wrap.appendChild(el('div', 'hint', f.hint));

    var row = el('div', 'img-row');
    var frame = el('div', 'img-frame' + (f.previewOn === 'dark' ? ' on-dark' : ''));
    var img = el('img');
    img.alt = '';
    var empty = el('div', 'img-empty', 'Nothing chosen');
    frame.appendChild(img);
    frame.appendChild(empty);

    var side = el('div', 'img-side');
    var pick = el('button', 'btn btn-out btn-sm', 'Choose image');
    pick.type = 'button';
    var drop = el('button', 'btn btn-out btn-sm img-remove', 'Remove');
    drop.type = 'button';
    var file = el('input');
    file.type = 'file';
    file.id = 'f_' + f.name;
    file.accept = f.accept || 'image/*';
    file.className = 'hide';
    var stat = el('span', 'stat');

    var actions = el('div', 'img-actions');
    actions.appendChild(pick);
    actions.appendChild(drop);
    side.appendChild(actions);
    side.appendChild(stat);
    if (f.note) side.appendChild(el('div', 'hint', f.note));
    side.appendChild(file);

    row.appendChild(frame);
    row.appendChild(side);
    wrap.appendChild(row);

    var errLine = el('div', 'err-txt');
    wrap.appendChild(errLine);

    var value = '';
    var busy = false;
    var ctrl = { node: wrap, wrap: wrap };

    function paint() {
      if (value) {
        img.src = value;
        frame.classList.remove('is-empty');
      } else {
        img.removeAttribute('src');
        frame.classList.add('is-empty');
      }
      drop.classList[value && !busy ? 'remove' : 'add']('hide');
      pick.disabled = busy;
    }

    var MAX = f.maxSize || 2 * 1024 * 1024;

    pick.addEventListener('click', function () { file.click(); });
    drop.addEventListener('click', function () {
      value = '';
      stat.textContent = '';
      stat.className = 'stat';
      ctrl.mark('');
      paint();
      changed();
    });

    file.addEventListener('change', function () {
      var chosen = file.files && file.files[0];
      file.value = '';                     // so picking the same file again still fires
      if (!chosen) return;

      if (chosen.size > MAX) {
        ctrl.mark('That image is ' + Math.round(chosen.size / 1024) + 'KB. Please keep it under ' +
                  Math.round(MAX / 1024) + 'KB.');
        return;
      }
      if (!/^image\//.test(chosen.type)) {
        ctrl.mark('That file is not an image.');
        return;
      }

      var up = (window.VBP_ADMIN || {}).uploadImage;
      if (typeof up !== 'function') {
        ctrl.mark('Uploading is not available on this page.');
        return;
      }

      ctrl.mark('');
      busy = true;
      paint();
      stat.textContent = 'Uploading\u2026';
      stat.className = 'stat busy';

      up(chosen, f.prefix || ('branding/' + f.name)).then(function (url) {
        value = url;
        busy = false;
        paint();
        stat.textContent = 'Uploaded \u2014 remember to save';
        stat.className = 'stat ok';
        changed();
      }).catch(function (e) {
        busy = false;
        paint();
        stat.textContent = '';
        stat.className = 'stat';
        ctrl.mark('Upload failed: ' + (e && e.message ? e.message : e));
      });
    });

    ctrl.get = function () { return value; };
    ctrl.set = function (v) { value = (v === undefined || v === null) ? '' : String(v); paint(); };
    ctrl.mark = function (msg) {
      if (msg) { wrap.classList.add('bad'); errLine.textContent = msg; }
      else { wrap.classList.remove('bad'); errLine.textContent = ''; }
    };
    ctrl.focus = function () { try { pick.focus(); } catch (e) {} };
    /* An upload in flight is not a saved setting. */
    ctrl.check = function () { return busy ? 'Wait for the image to finish uploading.' : ''; };
    return ctrl;
  }


  /* A colour. The swatch opens the operating system's picker; the box next
     to it takes a typed hex, which is what most people have to hand from a
     brand sheet. The two are kept in step, and an unreadable value is
     refused rather than quietly ignored. */
  function colourField(f, changed) {
    var c = baseField(f);
    var row = el('div', 'col-row');

    var swatch = el('input', 'col-swatch');
    swatch.type = 'color';
    swatch.setAttribute('aria-label', f.label + ' colour picker');
    swatch.tabIndex = -1;          // the hex box is the keyboard route in

    var text = el('input', 'col-hex');
    text.type = 'text';
    text.id = 'f_' + f.name;       // the label points here, and it is what gets typed in
    text.spellcheck = false;
    text.placeholder = '#000000';

    var reset = el('button', 'col-reset', 'Reset');
    reset.type = 'button';
    reset.title = 'Back to the shipped colour';

    row.appendChild(swatch);
    row.appendChild(text);
    if (f.fallback) row.appendChild(reset);
    c.wrap.appendChild(row);
    if (f.hint) c.wrap.appendChild(el('div', 'hint', f.hint));

    var errLine = el('div', 'err-txt');
    c.wrap.appendChild(errLine);

    var ctrl = { node: c.wrap, wrap: c.wrap };

    function normalise(v) {
      var h = String(v || '').trim();
      if (h && h.charAt(0) !== '#') h = '#' + h;
      if (/^#[0-9a-fA-F]{3}$/.test(h)) {
        h = '#' + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2) + h.charAt(3) + h.charAt(3);
      }
      return /^#[0-9a-fA-F]{6}$/.test(h) ? h.toLowerCase() : null;
    }

    swatch.addEventListener('input', function () {
      text.value = swatch.value;
      ctrl.mark('');
      changed();
    });
    text.addEventListener('input', function () {
      var v = normalise(text.value);
      if (v) { swatch.value = v; ctrl.mark(''); }
      changed();
    });
    /* Tidy the typed value once, on the way out. Rewriting mid-keystroke
       would fight whoever is typing. */
    text.addEventListener('blur', function () {
      var v = normalise(text.value);
      if (v && text.value !== v) { text.value = v; changed(); }
    });
    reset.addEventListener('click', function () {
      ctrl.set(f.fallback);
      ctrl.mark('');
      changed();
    });

    ctrl.get = function () { return normalise(text.value) || text.value.trim(); };
    ctrl.set = function (v) {
      var n = normalise(v) || normalise(f.fallback) || '#000000';
      text.value = n;
      swatch.value = n;
    };
    ctrl.mark = function (msg) {
      if (msg) { c.wrap.classList.add('bad'); errLine.textContent = msg; }
      else { c.wrap.classList.remove('bad'); errLine.textContent = ''; }
    };
    ctrl.focus = function () { try { text.focus(); } catch (e) {} };
    ctrl.check = function () {
      return normalise(text.value) ? '' : 'That is not a colour. Use a hex value such as #0B1F3A.';
    };
    return ctrl;
  }

  /* One of a handful of options, shown as things to look at rather than a
     list to read. Used for the button and product card styles, where the
     words mean much less than the shape. */
  function choiceField(f, changed) {
    var wrap = el('div', 'field');
    wrap.appendChild(el('label', null, f.label));
    if (f.hint) wrap.appendChild(el('div', 'hint', f.hint));

    var row = el('div', 'choice-row');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', f.label);
    row.id = 'f_' + f.name;
    var buttons = {};
    var value = '';

    (f.options || []).forEach(function (o) {
      var b = el('button', 'choice');
      b.type = 'button';
      b.setAttribute('aria-pressed', 'false');
      if (o.preview) {
        var art = el('span', 'choice-art');
        art.innerHTML = o.preview;
        b.appendChild(art);
      }
      b.appendChild(el('span', 'choice-lab', o.label));
      b.addEventListener('click', function () {
        value = o.value;
        paint();
        changed();
      });
      buttons[o.value] = b;
      row.appendChild(b);
    });
    wrap.appendChild(row);

    var errLine = el('div', 'err-txt');
    wrap.appendChild(errLine);

    function paint() {
      for (var k in buttons) {
        var on = (k === value);
        buttons[k].classList[on ? 'add' : 'remove']('on');
        buttons[k].setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    }

    var ctrl = { node: wrap, wrap: wrap };
    ctrl.get = function () { return value; };
    ctrl.set = function (v) {
      value = (v === undefined || v === null) ? '' : String(v);
      if (!buttons[value] && f.options && f.options.length) value = f.options[0].value;
      paint();
    };
    ctrl.mark = function (msg) {
      if (msg) { wrap.classList.add('bad'); errLine.textContent = msg; }
      else { wrap.classList.remove('bad'); errLine.textContent = ''; }
    };
    ctrl.focus = function () { try { row.querySelector('button').focus(); } catch (e) {} };
    return ctrl;
  }

  /* A block of code, currently only ever custom CSS. Monospaced, with the
     length shown against its cap so the limit is never a surprise. */
  function codeField(f, changed) {
    var c = baseField(f);
    var input = el('textarea', 'code-box');
    input.id = 'f_' + f.name;
    input.rows = f.rows || 8;
    input.spellcheck = false;
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('autocomplete', 'off');
    if (f.placeholder) input.placeholder = f.placeholder;
    c.wrap.appendChild(input);

    var ctrl = { node: c.wrap, wrap: c.wrap };
    attachExtras(ctrl, f, input);
    input.addEventListener('input', function () { ctrl.count(); ctrl.mark(''); changed(); });

    /* Tab should indent, not jump out of the box. */
    input.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab' || e.shiftKey) return;
      e.preventDefault();
      var a = input.selectionStart, b = input.selectionEnd;
      input.value = input.value.slice(0, a) + '  ' + input.value.slice(b);
      input.selectionStart = input.selectionEnd = a + 2;
      changed();
    });

    ctrl.get = function () { return input.value; };
    ctrl.set = function (v) { input.value = (v === undefined || v === null) ? '' : String(v); ctrl.count(); };
    return ctrl;
  }


  /* A social handle, shown behind the address it belongs to so the shape
     of the answer is obvious. Pasting a whole URL still works; the field
     tidies it back to a bare handle on the way out. */
  function handleField(f, changed) {
    var c = baseField(f);
    var row = el('div', 'handle-row');
    var pre = el('span', 'handle-pre', f.prefix || '');
    var input = el('input', 'handle-in');
    input.type = 'text';
    input.id = 'f_' + f.name;
    input.spellcheck = false;
    input.setAttribute('autocapitalize', 'off');
    if (f.placeholder) input.placeholder = f.placeholder;
    row.appendChild(pre);
    row.appendChild(input);
    c.wrap.appendChild(row);

    var ctrl = { node: c.wrap, wrap: c.wrap };
    attachExtras(ctrl, f, input);

    var out = el('a', 'handle-out');
    out.target = '_blank';
    out.rel = 'noopener';
    c.wrap.appendChild(out);

    function preview() {
      var url = (typeof f.resolve === 'function') ? f.resolve(input.value) : '';
      if (url) { out.href = url; out.textContent = url; out.classList.add('on'); }
      else { out.removeAttribute('href'); out.textContent = ''; out.classList.remove('on'); }
    }

    input.addEventListener('input', function () { ctrl.count(); ctrl.mark(''); preview(); changed(); });
    input.addEventListener('blur', function () {
      /* Someone pastes the whole address; keep just the handle. */
      if (typeof f.tidy !== 'function') return;
      var t = f.tidy(input.value);
      if (t !== input.value) { input.value = t; preview(); changed(); }
    });

    ctrl.get = function () { return input.value.trim(); };
    ctrl.set = function (v) {
      input.value = (v === undefined || v === null) ? '' : String(v);
      ctrl.count();
      preview();
    };
    ctrl.afterChange = preview;
    return ctrl;
  }


  /* A repeating group: as many of something as the shop has. Used for
     mobile money accounts, where Airtel and MTN are two rows rather than
     two settings, and any future provider is another row.

     The value is an array of plain objects. Each row draws the same
     sub-fields, which are ordinary field definitions, so anything the kit
     can draw can appear inside a row.

       { type: 'list', name: 'mobileAccounts', label: 'Accounts',
         addLabel: 'Add an account', max: 6,
         summary: function (row) { return row.provider || 'New account'; },
         fields: [ { type: 'select', name: 'provider', ... }, ... ] } */
  function listField(f, changed) {
    var wrap = el('div', 'field');
    wrap.appendChild(el('label', null, f.label));
    if (f.hint) wrap.appendChild(el('div', 'hint', f.hint));

    var host = el('div', 'list-rows');
    host.id = 'f_' + f.name;
    wrap.appendChild(host);

    var add = el('button', 'btn btn-out btn-sm list-add', f.addLabel || 'Add');
    add.type = 'button';
    /* A fixed list is a known set of things that can be reordered and
       edited but not invented or thrown away, such as the sections of a
       page. */
    if (f.fixed) add.classList.add('hide');
    wrap.appendChild(add);

    var errLine = el('div', 'err-txt');
    wrap.appendChild(errLine);

    var rows = [];          // [{ node, ctrls: { name -> ctrl } }]
    var ctrl = { node: wrap, wrap: wrap };

    function renumber() {
      rows.forEach(function (r, i) {
        var cap = r.node.querySelector('.list-cap');
        if (cap) {
          var vals = readRow(r);
          var text = (typeof f.summary === 'function') ? f.summary(vals, i) : '';
          cap.textContent = text || ((f.itemName || 'Item') + ' ' + (i + 1));
        }
        var moves = r.node.querySelectorAll('.list-move');
        if (moves.length === 2) {
          moves[0].disabled = (i === 0);
          moves[1].disabled = (i === rows.length - 1);
        }
      });
      if (!f.fixed) add.classList[(f.max && rows.length >= f.max) ? 'add' : 'remove']('hide');
    }

    /* A row keeps everything it was given and overwrites only what it
       draws. Without this, a value the row carries but does not show — a
       section's id, say — would be dropped the moment anything was saved,
       and the row would come back as an anonymous one. */
    function readRow(r) {
      var out = {}, k;
      for (k in r.kept) {
        if (Object.prototype.hasOwnProperty.call(r.kept, k)) out[k] = r.kept[k];
      }
      (f.fields || []).forEach(function (sub) {
        if (r.ctrls[sub.name]) out[sub.name] = r.ctrls[sub.name].get();
      });
      return out;
    }

    function addRow(values) {
      var row = el('div', 'list-row');
      var head = el('div', 'list-head');
      head.appendChild(el('span', 'list-cap'));

      var up = el('button', 'list-move', '\u2191');
      up.type = 'button';
      up.title = 'Move up';
      up.setAttribute('aria-label', 'Move up');
      var down = el('button', 'list-move', '\u2193');
      down.type = 'button';
      down.title = 'Move down';
      down.setAttribute('aria-label', 'Move down');
      if (f.reorder) { head.appendChild(up); head.appendChild(down); }

      var drop = el('button', 'list-drop', 'Remove');
      drop.type = 'button';
      if (f.fixed) drop.classList.add('hide');
      head.appendChild(drop);
      row.appendChild(head);

      var body = el('div', 'list-body');
      row.appendChild(body);

      var entry = { node: row, ctrls: {}, kept: values || {} };

      var subs = (f.fields || []).filter(function (x) { return BUILDERS[x.type]; });
      var idx = rows.length;

      function build(sub) {
        /* Sub-fields are named per row so two rows never share an id. */
        var scoped = {};
        for (var k in sub) scoped[k] = sub[k];
        scoped.name = f.name + '__' + idx + '__' + sub.name;
        var c = BUILDERS[sub.type](scoped, function () { renumber(); changed(); });
        c.set(values ? values[sub.name] : undefined);
        entry.ctrls[sub.name] = c;
        return c;
      }

      /* Two half-width sub-fields share a row here as well, which matters
         most on a long list where every saved line is a shorter scroll. */
      for (var i = 0; i < subs.length; i++) {
        var a = build(subs[i]);
        var next = subs[i + 1];
        if (subs[i].half && next && next.half) {
          var bcs = build(next);
          var pair = el('div', 'grid2 pair');
          pair.appendChild(a.node);
          pair.appendChild(bcs.node);
          body.appendChild(pair);
          i++;
          continue;
        }
        body.appendChild(a.node);
      }

      drop.addEventListener('click', function () {
        if (f.fixed) return;
        var i = rows.indexOf(entry);
        if (i >= 0) rows.splice(i, 1);
        row.parentNode.removeChild(row);
        renumber();
        changed();
      });

      /* Up and down rather than dragging: this admin is used on a phone
         as often as a desktop, and dragging a row on a touch screen
         fights with scrolling the page. */
      function move(by) {
        var i = rows.indexOf(entry);
        var j = i + by;
        if (i < 0 || j < 0 || j >= rows.length) return;
        rows.splice(i, 1);
        rows.splice(j, 0, entry);
        host.innerHTML = '';
        rows.forEach(function (r) { host.appendChild(r.node); });
        renumber();
        changed();
        try { (by < 0 ? up : down).focus(); } catch (e) {}
      }
      up.addEventListener('click', function () { move(-1); });
      down.addEventListener('click', function () { move(1); });

      rows.push(entry);
      host.appendChild(row);
      return entry;
    }

    add.addEventListener('click', function () {
      if (f.max && rows.length >= f.max) return;
      addRow(f.blank ? f.blank() : {});
      renumber();
      changed();
      var last = rows[rows.length - 1];
      var first = last && last.node.querySelector('input,select,textarea');
      if (first) first.focus();
    });

    ctrl.get = function () { return rows.map(readRow); };
    ctrl.set = function (v) {
      rows = [];
      host.innerHTML = '';
      (Array.isArray(v) ? v : []).forEach(function (row) { addRow(row); });
      renumber();
    };
    ctrl.mark = function (msg) {
      if (msg) { wrap.classList.add('bad'); errLine.textContent = msg; }
      else { wrap.classList.remove('bad'); errLine.textContent = ''; }
    };
    ctrl.focus = function () { try { add.focus(); } catch (e) {} };
    /* Each row is checked with the rule its own sub-field carries. */
    ctrl.check = function () {
      var problems = [];
      rows.forEach(function (r, i) {
        var vals = readRow(r);
        (f.fields || []).forEach(function (sub) {
          var c = r.ctrls[sub.name];
          if (!c) return;
          c.mark('');
          var v = vals[sub.name];
          var msg = '';
          if (sub.required && !v) msg = sub.label + ' is needed.';
          if (!msg && typeof sub.validate === 'function') msg = sub.validate(v, vals) || '';
          if (msg) { c.mark(msg); problems.push((i + 1) + ': ' + msg); }
        });
      });
      return problems.length ? 'Some rows need attention.' : '';
    };
    return ctrl;
  }

  var BUILDERS = {
    text: textField,
    textarea: textareaField,
    select: selectField,
    toggle: toggleField,
    hours: hoursField,
    image: imageField,
    colour: colourField,
    choice: choiceField,
    code: codeField,
    handle: handleField,
    list: listField
  };

  /* ---------- the form itself ---------------------------------------- */

  function form(host, spec) {
    spec = spec || {};
    var key = spec.key;
    var fields = {};     // name -> controller
    var defs = {};       // name -> field definition
    var order = [];      // names, in the order they were drawn
    var loaded = null;   // snapshot of the values as last loaded or saved
    var saving = false;

    var body = el('div');
    host.appendChild(body);

    var loading = el('p', 'count', 'Loading…');
    body.appendChild(loading);

    /* --- save bar ---------------------------------------------------- */
    var bar = el('div', 'save-bar hide');
    var saveBtn = el('button', 'btn btn-gold', 'Save changes');
    saveBtn.type = 'button';
    var undoBtn = el('button', 'btn btn-out btn-sm', 'Discard changes');
    undoBtn.type = 'button';
    var stat = el('span', 'stat');
    bar.appendChild(saveBtn); bar.appendChild(undoBtn); bar.appendChild(stat);

    function say(msg, kind) {
      stat.textContent = msg || '';
      stat.className = 'stat' + (kind ? ' ' + kind : '');
    }

    function current() {
      var out = {};
      order.forEach(function (n) { out[n] = fields[n].get(); });
      return out;
    }
    function isDirty() {
      if (!loaded) return false;
      return JSON.stringify(current()) !== JSON.stringify(loaded);
    }
    function refreshBar() {
      var dirty = isDirty();
      saveBtn.disabled = !dirty || saving;
      undoBtn.classList[dirty && !saving ? 'remove' : 'add']('hide');
      if (dirty && !saving && stat.className.indexOf('ok') >= 0) say('');
    }

    /* Hiding a field that depends on another (the maintenance message
       only matters while maintenance mode is on) keeps the form short. */
    function applyVisibility() {
      var values = current();
      order.forEach(function (n) {
        var f = defs[n];
        if (typeof f.showIf !== 'function') return;
        var on = !!f.showIf(values);
        fields[n].node.classList[on ? 'remove' : 'add']('hide');
        var pair = fields[n].node.parentNode;
        if (pair && pair.classList.contains('pair')) {
          var anyVisible = Array.prototype.some.call(pair.children, function (c) {
            return !c.classList.contains('hide');
          });
          pair.classList[anyVisible ? 'remove' : 'add']('hide');
        }
      });
    }

    function changed() {
      applyVisibility();
      order.forEach(function (n) {
        if (typeof fields[n].afterChange === 'function') fields[n].afterChange();
      });
      refreshBar();
      /* Sections that show a live preview redraw from here. */
      if (typeof spec.onChange === 'function') {
        try { spec.onChange(current(), controller); } catch (e) {}
      }
    }

    /* --- drawing ----------------------------------------------------- */
    function drawFields(into, list) {
      var i = 0;
      while (i < list.length) {
        var f = list[i];
        var builder = BUILDERS[f.type];
        if (!builder) { i++; continue; }

        var ctrl = builder(f, changed);
        fields[f.name] = ctrl;
        defs[f.name] = f;
        order.push(f.name);

        /* Two consecutive half-width fields share one row. */
        var next = list[i + 1];
        if (f.half && next && next.half && BUILDERS[next.type]) {
          var ctrl2 = BUILDERS[next.type](next, changed);
          fields[next.name] = ctrl2;
          defs[next.name] = next;
          order.push(next.name);

          var pair = el('div', 'grid2 pair');
          pair.appendChild(ctrl.node);
          pair.appendChild(ctrl2.node);
          into.appendChild(pair);
          i += 2;
          continue;
        }

        into.appendChild(ctrl.node);
        i++;
      }
    }

    function draw() {
      (spec.groups || []).forEach(function (g) {
        var card = el('div', 'card');
        if (g.title) card.appendChild(el('h3', null, g.title));
        if (g.note) card.appendChild(el('p', 'grp-note', g.note));
        drawFields(card, g.fields || []);
        body.appendChild(card);
      });
      body.appendChild(bar);
      bar.classList.remove('hide');
    }

    /* --- validation --------------------------------------------------- */
    function validate() {
      var values = current();
      var problems = [];

      order.forEach(function (n) { fields[n].mark(''); });

      order.forEach(function (n) {
        var f = defs[n], ctrl = fields[n], v = values[n];
        if (ctrl.node.classList.contains('hide')) return;   // hidden, so not required

        var msg = '';
        if (typeof ctrl.check === 'function') msg = ctrl.check();
        if (!msg && f.required) {
          var blank = (v === '' || v === null || v === undefined);
          if (blank) msg = f.label + ' cannot be left blank.';
        }
        if (!msg && f.maxLength && typeof v === 'string' && v.length > f.maxLength) {
          msg = f.label + ' is longer than ' + f.maxLength + ' characters.';
        }
        if (!msg && typeof f.validate === 'function') msg = f.validate(v, values) || '';
        if (msg) { ctrl.mark(msg); problems.push(n); }
      });

      if (typeof spec.validate === 'function') {
        spec.validate(values, function (name, msg) {
          if (fields[name]) { fields[name].mark(msg); problems.push(name); }
        });
      }
      return problems;
    }

    /* --- save --------------------------------------------------------- */
    function doSave() {
      if (saving) return;

      var problems = validate();
      if (problems.length) {
        say('Please fix the highlighted fields.', 'err');
        if (fields[problems[0]].focus) fields[problems[0]].focus();
        return;
      }

      var values = current();
      saving = true;
      refreshBar();
      say('Saving…', 'busy');

      Promise.resolve(typeof spec.beforeSave === 'function' ? spec.beforeSave(values) : values)
        .then(function (final) {
          var all = final || values;
          if (!spec.privateKey) return api.store.save(key, all);

          /* A field marked private is kept in a table the website cannot
             read. Splitting happens here rather than in each section, so
             a section only has to say which fields those are. */
          var open = {}, shut = {}, n;
          for (n in all) {
            if (!Object.prototype.hasOwnProperty.call(all, n)) continue;
            if (defs[n] && defs[n].private) shut[n] = all[n]; else open[n] = all[n];
          }
          return api.store.savePrivate(spec.privateKey, shut)
            .then(function () { return api.store.save(key, open); });
        })
        .then(function (saved) {
          loaded = current();
          saving = false;
          refreshBar();
          say(spec.savedMessage || 'Saved ✓', 'ok');
          if (typeof spec.afterSave === 'function') spec.afterSave(saved);
        })
        .catch(function (e) {
          saving = false;
          refreshBar();
          say('Could not save: ' + (e && e.message ? e.message : e), 'err');
        });
    }

    saveBtn.addEventListener('click', doSave);
    undoBtn.addEventListener('click', function () {
      if (!loaded) return;
      order.forEach(function (n) { fields[n].set(loaded[n]); fields[n].mark(''); });
      changed();
      say('Changes discarded.', '');
    });

    /* --- unsaved changes guard ---------------------------------------- */
    var controller = {
      isDirty: isDirty,
      values: current,
      /* Write one field from outside the form. A section uses this to fill
         in a sensible starting point, such as copying the trading hours
         into a support-hours grid the moment it is switched on. */
      set: function (name, value) {
        if (!fields[name]) return;
        fields[name].set(value);
        fields[name].mark('');
        changed();
      },
      /* The shell calls this before it leaves the page. */
      confirmLeave: function () {
        if (!isDirty()) return true;
        return window.confirm('You have unsaved changes on this page. Leave without saving?');
      },
      release: function () { if (api.activeForm === controller) api.activeForm = null; }
    };
    api.activeForm = controller;

    /* --- load --------------------------------------------------------- */
    var loading_ = spec.privateKey
      ? Promise.all([api.store.load(key), api.store.loadPrivate(spec.privateKey)])
          .then(function (both) {
            var merged = both[0], shut = both[1] || {}, n;
            for (n in shut) {
              if (Object.prototype.hasOwnProperty.call(shut, n)) merged[n] = shut[n];
            }
            return merged;
          })
      : api.store.load(key);

    loading_.then(function (values) {
      body.removeChild(loading);
      draw();
      order.forEach(function (n) { fields[n].set(values[n]); });
      applyVisibility();
      order.forEach(function (n) {
        if (typeof fields[n].afterChange === 'function') fields[n].afterChange();
      });
      loaded = current();
      refreshBar();
      if (typeof spec.afterLoad === 'function') spec.afterLoad(values, controller);
    }).catch(function (e) {
      loading.textContent = 'This section could not be loaded: ' +
        (e && e.message ? e.message : e) +
        ' If this is the first time, check that site_settings exists in Supabase (see supabase-setup.sql).';
      loading.className = 'count err-txt';
    });

    return controller;
  }

  api.ui = {
    form: form,
    days: DAYS,
    emptyHours: emptyHours,
    summariseHours: summariseHours,
    prettyTime: pretty
  };
  window.VBP_ADMIN = api;
})();
