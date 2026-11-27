/* =====================================================================
   Vaultique Boutique Point - Admin > Settings > Backups      BUILD 92
   ---------------------------------------------------------------------
   The copies GitHub makes of the website (.github/workflows/backup.yml):
   how the last ones went, read from backup_runs (supabase-backup.sql).

   YOUR BACKUP KEY is made here, in this browser (Web Crypto, RSA-OAEP,
   4096 bits). The public half is shown to copy into GitHub; the private
   half is saved as a file on this computer and goes nowhere else: not to
   GitHub, not to the website, not to Supabase. Only it opens a copy.

   AFTER A RESTORE (RECOVERY.md): the payment gateways are asked what
   happened after the copy (netlify/functions/after-restore.js), and
   refunds are held until you say the restore is finished.
   ===================================================================== */
(function () {
  'use strict';
  if (!window.VBP_ADMIN) return;
  var A = window.VBP_ADMIN;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function when(t) {
    try {
      return new Date(t).toLocaleString('en-GB', { timeZone: 'Africa/Lusaka', day: 'numeric', month: 'short', year: 'numeric',
                                                   hour: '2-digit', minute: '2-digit' });
    } catch (e) { return String(t || ''); }
  }
  function ago(t) {
    var m = Math.round((Date.now() - new Date(t).getTime()) / 60000);
    if (m < 60) return m + ' minute' + (m === 1 ? '' : 's') + ' ago';
    var h = Math.round(m / 60);
    if (h < 48) return h + ' hour' + (h === 1 ? '' : 's') + ' ago';
    return Math.round(h / 24) + ' days ago';
  }
  function kb(n) { n = Number(n) || 0; return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function num(n) { return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  /* ---- the key, made in this browser ---- */
  function pem(kind, buf) {
    var b = new Uint8Array(buf), s = '';
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    var body = btoa(s).match(/.{1,64}/g).join('\n');
    return '-----BEGIN ' + kind + ' KEY-----\n' + body + '\n-----END ' + kind + ' KEY-----\n';
  }
  function hex(buf) {
    return Array.prototype.map.call(new Uint8Array(buf), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }
  function makeKey() {
    var subtle = window.crypto && window.crypto.subtle;
    if (!subtle) return Promise.reject(new Error('This browser cannot make the key here. Use an up-to-date Chrome, Edge, Firefox or Safari.'));
    return subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 4096, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
                              true, ['encrypt', 'decrypt']).then(function (pair) {
      return Promise.all([subtle.exportKey('spki', pair.publicKey), subtle.exportKey('pkcs8', pair.privateKey)]).then(function (x) {
        return subtle.digest('SHA-256', x[0]).then(function (d) {
          return { publicPem: pem('PUBLIC', x[0]), privatePem: pem('PRIVATE', x[1]), kid: hex(d).slice(0, 16) };
        });
      });
    });
  }
  function download(name, text) {
    var blob = new Blob([text], { type: 'application/x-pem-file' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }

  A.registerSetting({
    key: 'backups',
    title: 'Backups',
    summary: 'Copies of the website made off Supabase and checked by restoring them; your backup key; and the check after a restore.',
    render: function (host, ctx) {
      var sb = (ctx && ctx.sb) || A.sb;
      var D = window.VBP_DIALOGS || {};
      var ask = (ctx && ctx.ask) || D.ask;
      var tell = (ctx && ctx.tell) || D.tell;
      var wrap = el('div', 'bk-wrap');
      host.appendChild(wrap);
      var status = el('div', 'card bk-status'), keyCard = el('div', 'card bk-key'), after = el('div', 'card bk-after');
      [status, keyCard, after].forEach(function (c) { wrap.appendChild(c); });

      /* ---- how the copies are doing ---- */
      function drawStatus(rows, err) {
        status.innerHTML = '';
        status.appendChild(el('h3', null, 'Your copies'));
        if (err) {
          status.appendChild(el('p', 'an-note', /backup_runs|does not exist|schema cache|PGRST20[25]/i.test(err)
            ? 'Run supabase-backup.sql (it is in the chat) in this website’s Supabase, then open this page again.'
            : 'The copies’ record could not be read: ' + err));
          return;
        }
        var copies = rows.filter(function (r) { return r.kind === 'copy'; });
        var drills = rows.filter(function (r) { return r.kind === 'drill'; });
        if (!copies.length) {
          status.appendChild(el('p', 'bk-big', 'No copy yet.'));
          status.appendChild(el('p', 'an-note', 'Copies start once the backup is set up on GitHub and switched on (SETUP.md, “Backups”: ' +
            'about twenty minutes on a laptop). Until then, there is no copy of the shop outside Supabase.'));
          return;
        }
        var last = copies[0];
        var good = copies.filter(function (r) { return r.ok; })[0];
        var line = el('p', 'bk-big ' + (last.ok ? 'ok' : 'err'), last.ok
          ? 'The last copy, ' + ago(last.at) + ', checked out by restoring it.'
          : 'THE LAST COPY, ' + ago(last.at).toUpperCase() + ', DID NOT CHECK OUT.');
        status.appendChild(line);
        var dl = el('dl', 'bk-facts');
        function fact(k, v) { dl.appendChild(el('dt', null, k)); dl.appendChild(el('dd', null, v)); }
        fact('Made', when(last.at) + (last.copy_id ? ' (' + last.copy_id + ')' : ''));
        fact('Held', num(last.tables) + ' tables, ' + num(last.rows) + ' rows, ' + num(last.logins) + ' logins');
        fact('Size, sealed', kb(last.size_bytes));
        fact('Pictures', num(last.pictures_total) + ' kept' + (last.pictures_new ? ', ' + num(last.pictures_new) + ' new in this copy' : ''));
        fact('Copies kept', num(last.copies_kept) + ' (every copy for two days, then one a day for thirty)');
        if (last.detail && last.detail.kid) fact('Sealed for key', last.detail.kid);
        if (!last.ok && good) fact('The last good copy', when(good.at) + ', ' + ago(good.at));
        var dayAgo = Date.now() - 86400000;
        var lastDay = copies.filter(function (r) { return new Date(r.at).getTime() > dayAgo; });
        var failed = lastDay.filter(function (r) { return !r.ok; }).length;
        fact('The last day', lastDay.length + ' cop' + (lastDay.length === 1 ? 'y' : 'ies') + (failed ? ', ' + failed + ' not checked out' : ', all checked out'));
        if (lastDay.length) {
          var secs = lastDay.reduce(function (a, r) { return a + (Number(r.seconds) || 0); }, 0) / lastDay.length;
          // GitHub counts each run in whole minutes, with about 45 s of its own.
          var perRun = Math.ceil((secs + 45) / 60);
          fact('GitHub minutes', 'about ' + num(perRun * lastDay.length * 30) + ' a month at this rate (a private repository on ' +
               'GitHub Free has 2,000 for this and the tests together; a public one is not counted)');
        }
        var drill = drills[0];
        fact('The last drill', drill ? when(drill.at) + (drill.ok ? ', the copy opened with your key and restored' : ', DID NOT PASS') : 'not yet');
        status.appendChild(dl);
        if (!drill || Date.now() - new Date(drill.at).getTime() > 92 * 86400000) {
          status.appendChild(el('p', 'bk-due', 'A drill is due: every three months, open a copy with your key and restore it (RECOVERY.md, “The drill”).'));
        }
        if (last.problems && last.problems.length) {
          var ul = el('ul', 'bk-problems');
          last.problems.slice(0, 8).forEach(function (p) { ul.appendChild(el('li', null, String(p))); });
          status.appendChild(el('p', 'an-note', 'What went wrong in the last copy:'));
          status.appendChild(ul);
        }
      }
      function loadStatus() {
        return Promise.resolve(sb.from('backup_runs').select('*').order('at', { ascending: false }).limit(80)).then(function (r) {
          drawStatus(r.data || [], r.error ? (r.error.message || 'error') : '');
        }, function (e) { drawStatus([], (e && e.message) || String(e)); });
      }

      /* ---- your backup key ---- */
      function drawKey() {
        keyCard.innerHTML = '';
        keyCard.appendChild(el('h3', null, 'Your backup key'));
        keyCard.appendChild(el('p', 'an-note', 'Every copy is sealed so that only your key opens it. The key has two halves, made ' +
          'here in this browser. The PUBLIC half goes to GitHub, which seals the copies with it. The PRIVATE half is saved as a ' +
          'file on this computer and goes nowhere else: keep it in two safe places (a USB stick in a drawer, and a password ' +
          'manager). Without it no copy can ever be opened, by you or anyone.'));
        var b = el('button', 'btn btn-gold btn-sm', 'Make my backup key');
        b.type = 'button';
        var out = el('div', 'bk-made');
        b.addEventListener('click', function () {
          Promise.resolve(ask('A new key means copies made from now on need the new private key. Copies already made still need the ' +
            'old one, so keep that too.', { title: 'Make a new backup key?', okText: 'Make it' })).then(function (yes) {
            if (!yes) return;
            b.disabled = true;
            out.textContent = 'Making the key (a few seconds)…';
            makeKey().then(function (k) {
              out.innerHTML = '';
              download('vaultique-backup-private-key-' + k.kid + '.pem', k.privatePem);
              out.appendChild(el('p', 'bk-ok', 'Made. Key ' + k.kid + '. The private half has been saved to this computer’s ' +
                'Downloads as vaultique-backup-private-key-' + k.kid + '.pem: move it to its two safe places now.'));
              out.appendChild(el('p', 'an-note', 'The public half, to copy into GitHub as the variable BACKUP_PUBLIC_KEY (SETUP.md, “Backups”):'));
              var ta = el('textarea', 'bk-pub');
              ta.readOnly = true; ta.rows = 6; ta.value = k.publicPem;
              out.appendChild(ta);
              var c = el('button', 'btn btn-out btn-sm', 'Copy the public half');
              c.type = 'button';
              c.addEventListener('click', function () {
                ta.select();
                var done = function () { c.textContent = 'Copied ✓'; };
                if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(k.publicPem).then(done, function () { document.execCommand('copy'); done(); });
                else { document.execCommand('copy'); done(); }
              });
              out.appendChild(c);
              b.disabled = false;
            }, function (e) {
              b.disabled = false;
              out.textContent = (e && e.message) || 'The key could not be made.';
            });
          });
        });
        keyCard.appendChild(b);
        keyCard.appendChild(out);
      }

      /* ---- after a restore ---- */
      function call(method, body) {
        return Promise.resolve(sb.auth && sb.auth.getSession ? sb.auth.getSession() : null).then(function (r) {
          var token = r && r.data && r.data.session && r.data.session.access_token;
          return fetch('/.netlify/functions/after-restore', {
            method: method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (token || '') },
            body: body ? JSON.stringify(body) : undefined
          }).then(function (res) { return res.json().catch(function () { return {}; }).then(function (j) { j._code = res.status; return j; }); });
        });
      }
      function drawAfter(state) {
        after.innerHTML = '';
        after.appendChild(el('h3', null, 'After a restore'));
        after.appendChild(el('p', 'an-note', 'Only when the website has been restored from a copy (RECOVERY.md). The payment gateways are asked ' +
          'what happened after the copy: payments still waiting in it are confirmed on the gateway’s word, and payments or ' +
          'refunds made after it are listed for you. Refunds are held until you press “The restore is finished”, so none is ' +
          'sent twice. The owner only.'));
        var hold = state && state.hold;
        if (hold && hold.active) {
          after.appendChild(el('p', 'bk-due', 'Refunds are held: the website was restored from the copy of ' + when(hold.since) +
            (hold.checkedAt ? '; the gateways were asked ' + ago(hold.checkedAt) : '') + '.'));
        }
        var row = el('div', 'bk-row');
        var lab = el('label', null, 'The copy you restored was made on');
        var input = el('input');
        input.type = 'datetime-local';
        input.className = 'bk-since';
        row.appendChild(lab); row.appendChild(input);
        after.appendChild(row);
        var go = el('button', 'btn btn-out btn-sm', 'Check the gateways now');
        go.type = 'button';
        var say = el('p', 'bk-say');
        go.addEventListener('click', function () {
          if (!input.value) { say.textContent = 'Choose when the copy you restored was made (it is in the copy’s name, in UTC).'; return; }
          go.disabled = true;
          say.textContent = 'Asking Lenco and Flutterwave…';
          call('POST', { action: 'start', since: new Date(input.value).toISOString() }).then(function (j) {
            go.disabled = false;
            if (j._code !== 200) { say.textContent = j.error || 'It could not be done just now.'; return; }
            say.textContent = j.settled + ' waiting payment' + (j.settled === 1 ? '' : 's') + ' confirmed; ' + (j.findings || []).length +
              ' thing' + ((j.findings || []).length === 1 ? '' : 's') + ' found. You have been emailed the list. Refunds stay held.';
            loadAfter();
          }, function () { go.disabled = false; say.textContent = 'It could not be reached just now.'; });
        });
        after.appendChild(go);
        if (hold && hold.active) {
          var fin = el('button', 'btn btn-gold btn-sm', 'The restore is finished');
          fin.type = 'button';
          fin.addEventListener('click', function () {
            Promise.resolve(ask('Refunds can be sent again. Before this, make sure every refund on the list has been recorded on the ' +
              'platform, so none is asked for twice.', { title: 'Finish the restore?', okText: 'It is finished' })).then(function (yes) {
              if (!yes) return;
              call('POST', { action: 'finish' }).then(function (j) {
                if (j._code !== 200) { tell(j.error || 'It could not be done just now.'); return; }
                loadAfter();
              });
            });
          });
          after.appendChild(fin);
        }
        after.appendChild(say);
        var list = (state && state.findings) || [];
        if (list.length) {
          var words = { payment_not_in_copy: 'Paid after the copy: its order was lost; contact the customer',
                        refund_not_in_copy: 'Refunded after the copy: do not refund it again',
                        payment_settled: 'Waiting in the copy, now confirmed paid' };
          var ul = el('ul', 'bk-findings');
          list.slice(0, 50).forEach(function (f) {
            ul.appendChild(el('li', f.resolved_at ? 'done' : '', (words[f.kind] || f.kind) + ' · ' + (f.reference || '') + ' · ' +
              (f.currency || '') + ' ' + (f.amount != null ? f.amount : '') + ' · ' + (f.gateway === 'lenco' ? 'Lenco' : 'Flutterwave') +
              (f.mode === 'test' ? ' (test)' : '') + (f.happened_at ? ' · ' + when(f.happened_at) : '')));
          });
          after.appendChild(ul);
        }
      }
      function loadAfter() {
        return call('GET').then(function (j) { drawAfter(j._code === 200 ? j : null); }, function () { drawAfter(null); });
      }

      drawKey();
      drawAfter(null);
      loadStatus();
      loadAfter();
    }
  });
})();
