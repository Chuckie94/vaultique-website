/* =====================================================================
   Vaultique Boutique Point - Admin > Settings > System & Maintenance
   ---------------------------------------------------------------------
   What is actually true about the site right now, and the few actions
   that only an owner should be able to take.

   This page deliberately has no form. Everything on it is either a fact
   read live from somewhere real, or a button that does something. There
   is nothing here to type and nothing here to save.

   The rule this page is built on: never show a number that is decoration.
   A version that is guessed, a "last backup" that is really "last time
   you clicked", a green tick that is hardcoded - all of those are worse
   than showing nothing, because they get believed. So:

     Version / build / notes   read from assets/version.js, written when
                               the build is packaged
     Went live                 recorded by the admin itself, the first
                               time it sees a build number it has not
                               seen before
     Database / storage / POS  a real request, timed, reporting whatever
                               actually came back
     Private settings sealed   a genuinely signed out client trying to
                               read the bank details, which must fail
     Last updated              the updated_at column of site_settings

   Maintenance mode is NOT set here. It lives in Settings > General with
   the rest of the website status, because "live / coming soon / closed /
   under maintenance" is one decision and splitting it across two pages
   is how an owner ends up with two switches disagreeing. This page shows
   its live state and links to it.
   ===================================================================== */
(function () {
  'use strict';
  if (!window.VBP_ADMIN) return;

  var A = window.VBP_ADMIN;
  var F = window.VBP_FORMAT || {};

  /* The site_settings row this page keeps its deployment history in. It
     is an ordinary row in an existing table, so this section needs no
     database changes of any kind. */
  var HKEY = 'system';
  var HISTORY_MAX = 20;
  /* Once a browser has recorded a build there is nothing more to learn
     from it, so the record costs one read and one write per build, ever,
     and nothing at all on every admin visit after that. */
  var SEEN_MEMO = 'vbp_build_seen';

  var BACKUP_FORMAT = 1;
  /* A backup takes whatever rows the two settings tables actually hold,
     rather than a list of section names kept here. A list would have to
     be updated every time a section was added, and the day someone
     forgot, backups would quietly start missing a section while still
     looking complete. Reading the tables whole cannot go stale. */

  /* ---- small helpers ------------------------------------------------- */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function stamp() { return window.VBP_VERSION || {}; }

  function memo(k, v) {
    try {
      if (v === undefined) return localStorage.getItem(k);
      localStorage.setItem(k, v);
    } catch (e) { /* private browsing; the record just re-runs next time */ }
    return null;
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  /* '28 August 2026 at 09:44'. Dates on this page are facts about the
     system rather than shop-facing copy, so they are spelled out in full
     rather than following the shop's date format. */
  function when(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var day = F.date ? F.date(d, 'D MMMM YYYY') : d.toDateString();
    return day + ' at ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  /* 'today', 'yesterday', '5 days ago'. Shown beside a full date, never
     instead of one: "3 days ago" alone is not something you can check. */
  function ago(iso) {
    if (!iso) return '';
    var then = new Date(iso).getTime();
    if (isNaN(then)) return '';
    var days = Math.floor((Date.now() - then) / 86400000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 31) return days + ' days ago';
    var months = Math.round(days / 30.4);
    if (months < 24) return months + (months === 1 ? ' month ago' : ' months ago');
    return Math.round(days / 365) + ' years ago';
  }

  /* ---- the deployment record ----------------------------------------- */

  /* Called by the admin shell once, on load. When the running build is
     one this browser has not recorded, it is written to the history with
     the time it was first seen - which is the closest thing to "when did
     this go live" that a page in a browser can honestly know. The zip's
     own build date is stamped separately, and the two differ whenever a
     build sits unuploaded for a while.

     It never throws and never blocks the admin: a failure here must not
     be able to keep an owner out of their own shop. */
  function record() {
    var v = stamp();
    if (!v.build) return Promise.resolve(null);
    if (memo(SEEN_MEMO) === String(v.build)) return Promise.resolve(null);

    return A.store.load(HKEY).then(function (row) {
      var list = Array.isArray(row.deployments) ? row.deployments.slice() : [];
      var i;
      for (i = 0; i < list.length; i++) {
        /* Another browser already recorded it. Remember that here too so
           this one stops asking, but do not rewrite the date: the first
           sighting is the honest one. */
        if (list[i] && list[i].build === v.build) {
          memo(SEEN_MEMO, String(v.build));
          return null;
        }
      }
      list.unshift({
        build: v.build,
        version: v.version || '',
        notes: v.notes || '',
        builtAt: v.builtAt || '',
        liveAt: new Date().toISOString()
      });
      if (list.length > HISTORY_MAX) list = list.slice(0, HISTORY_MAX);
      /* Saving writes the whole row, so the row has to be carried and
         edited rather than rebuilt: this key also holds the date of the
         last backup, and rebuilding would quietly wipe it every time a
         new build went live. */
      row.deployments = list;
      return A.store.save(HKEY, row).then(function () {
        memo(SEEN_MEMO, String(v.build));
        return list[0];
      });
    }).catch(function () { return null; });
  }

  function history() {
    return A.store.load(HKEY).then(function (row) {
      return Array.isArray(row.deployments) ? row.deployments : [];
    }).catch(function () { return []; });
  }

  /* ---- live checks ---------------------------------------------------- */
  /* Every check resolves - none of them reject - with the same shape, so
     the page can render a list of them without knowing what each one did:

       { ok: true|false|'warn', label, detail }  */

  function pass(label, detail) { return { ok: true, label: label, detail: detail || '' }; }
  function fail(label, detail) { return { ok: false, label: label, detail: detail || '' }; }
  function warn(label, detail) { return { ok: 'warn', label: label, detail: detail || '' }; }

  function errText(e) {
    if (!e) return 'no reason given';
    return e.message || e.error_description || String(e);
  }

  function checkDatabase(ctx) {
    var t0 = Date.now();
    return ctx.sb.from('site_settings').select('key').limit(1)
      .then(function (r) {
        if (r.error) throw r.error;
        return pass('Database', 'Answering normally, in ' + (Date.now() - t0) + 'ms.');
      })
      .catch(function (e) {
        return fail('Database', 'Could not be reached: ' + errText(e));
      });
  }

  function checkStorage(ctx) {
    var bucket = (ctx.cfg && ctx.cfg.IMAGE_BUCKET) || 'product-images';
    var t0 = Date.now();
    return ctx.sb.storage.from(bucket).list('', { limit: 100 })
      .then(function (r) {
        if (r.error) throw r.error;
        var n = (r.data || []).length;
        return pass('Photo storage',
          'Answering normally, in ' + (Date.now() - t0) + 'ms. ' +
          (n >= 100 ? 'At least 100 files stored.' : n + (n === 1 ? ' file stored.' : ' files stored.')));
      })
      .catch(function (e) {
        return fail('Photo storage', 'Could not be reached: ' + errText(e));
      });
  }

  function checkPos() {
    var t0 = Date.now();
    return fetch('/.netlify/functions/products', { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('the till feed answered ' + r.status);
        return r.json();
      })
      .then(function (data) {
        var list = Array.isArray(data) ? data : (data && data.products) || [];
        if (!list.length) {
          return warn('Till (POS) feed',
            'Reachable, but it sent no products. The shop would look empty.');
        }
        return pass('Till (POS) feed',
          list.length + ' products, in ' + (Date.now() - t0) + 'ms.');
      })
      .catch(function (e) {
        return fail('Till (POS) feed', 'Could not be read: ' + errText(e));
      });
  }

  /* The check that matters most, and the reason this page exists.

     Payment details live in site_settings_private, which has no public
     read rule at all. This proves it, rather than trusting it: it builds
     a second connection that is deliberately NOT signed in - the same
     view of the database a stranger on the internet gets - and asks it
     for the bank details. Nothing coming back is the pass.

     If this ever fails, the shop's bank and mobile money details are
     readable by anyone who visits the site. It is the one red on this
     page that means stop trading and fix it. */
  function checkPrivacy(ctx) {
    var cfg = ctx.cfg || {};
    if (!window.supabase || !window.supabase.createClient || !cfg.SUPABASE_URL) {
      return Promise.resolve(warn('Payment details sealed off', 'Could not be tested here.'));
    }
    var anon;
    try {
      anon = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
        /* Without this it would quietly borrow the signed in admin
           session out of this browser and prove nothing at all. */
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
      });
    } catch (e) {
      return Promise.resolve(warn('Payment details sealed off', 'Could not be tested: ' + errText(e)));
    }

    return anon.from('site_settings_private').select('key')
      .then(function (r) {
        if (r.error) {
          /* A refusal is also a pass: the rules turned it away. Only a
             missing table is a genuine problem, and a different one. */
          if (/does not exist|schema cache/i.test(errText(r.error))) {
            return fail('Payment details sealed off',
              'The private settings table is missing. Payment details have nowhere safe to live.');
          }
          return pass('Payment details sealed off', 'A signed out visitor is refused.');
        }
        var rows = (r.data || []).length;
        if (rows > 0) {
          return fail('Payment details sealed off',
            'SERIOUS: a signed out visitor can read ' + rows + ' row(s) of your private settings. ' +
            'Your bank and mobile money details are exposed. Re-run supabase-setup.sql.');
        }
        return pass('Payment details sealed off', 'A signed out visitor sees nothing.');
      })
      .catch(function (e) {
        return warn('Payment details sealed off', 'Could not be tested: ' + errText(e));
      });
  }

  /* The handful of settings whose absence quietly breaks something a
     customer would notice. */
  function checkSettings() {
    return Promise.all([
      A.store.load('contact').catch(function () { return {}; }),
      A.store.load('branding').catch(function () { return {}; }),
      A.store.load('seo').catch(function () { return {}; }),
      A.store.load('general').catch(function () { return {}; })
    ]).then(function (all) {
      var contact = all[0], branding = all[1], seo = all[2], general = all[3];
      var missing = [];
      if (!contact.whatsapp) missing.push('the WhatsApp number (no customer could check out)');
      if (!branding.logoMain) missing.push('the logo');
      if (!seo.canonicalBase) missing.push('the website address used for sharing links');
      if (!general.businessName) missing.push('the business name');

      if (missing.length) {
        return warn('Settings filled in', 'Still empty: ' + missing.join(', ') + '.');
      }
      return pass('Settings filled in', 'Everything a customer depends on is set.');
    });
  }

  function checkMaintenance() {
    return A.store.load('general').then(function (g) {
      if (g.maintenanceMode) {
        return warn('Shop open to customers',
          'Maintenance mode is ON. Customers see the maintenance notice, not the shop.');
      }
      if (g.websiteStatus && g.websiteStatus !== 'live') {
        return warn('Shop open to customers',
          'Website status is "' + g.websiteStatus + '". Customers cannot buy.');
      }
      return pass('Shop open to customers', 'The shop is live and taking orders.');
    }).catch(function (e) {
      return warn('Shop open to customers', 'Could not be read: ' + errText(e));
    });
  }

  function runAll(ctx) {
    return Promise.all([
      checkDatabase(ctx), checkStorage(ctx), checkPos(),
      checkPrivacy(ctx), checkSettings(), checkMaintenance()
    ]);
  }

  /* ---- when each section was last changed ----------------------------- */

  function lastUpdated(ctx) {
    return ctx.sb.from('site_settings').select('key, updated_at')
      .order('updated_at', { ascending: false })
      .then(function (r) {
        if (r.error) throw r.error;
        return r.data || [];
      })
      .catch(function () { return []; });
  }

  /* ---- backup --------------------------------------------------------- */

  /* Everything in both settings tables, in one file. Sections that have
     never been saved are simply absent rather than written as empty, so
     restoring cannot blank a section that the backup never knew about. */
  function gather(ctx) {
    var out = {
      vaultique_backup: BACKUP_FORMAT,
      takenAt: new Date().toISOString(),
      version: stamp().version || '',
      build: stamp().build || 0,
      settings: {},
      privateSettings: {}
    };

    return ctx.sb.from('site_settings').select('key, data')
      .then(function (r) {
        if (r.error) throw r.error;
        (r.data || []).forEach(function (row) {
          if (row && row.key) out.settings[row.key] = row.data || {};
        });
        return ctx.sb.from('site_settings_private').select('key, data');
      })
      .then(function (r) {
        /* A backup missing the private half is still worth having, but
           the owner must be told rather than left to assume. */
        if (r.error) { out.privateFailed = errText(r.error); return out; }
        (r.data || []).forEach(function (row) {
          if (row && row.key) out.privateSettings[row.key] = row.data || {};
        });
        return out;
      });
  }

  function download(obj) {
    var text = JSON.stringify(obj, null, 2);
    var d = new Date();
    var name = 'vaultique-settings-' + d.getFullYear() + '-' +
               pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '.json';
    var blob = new Blob([text], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    return name;
  }

  /* A file is only a Vaultique backup if it says so and carries a
     settings object. Anything else is refused by name rather than
     half applied. */
  function validate(obj) {
    if (!obj || typeof obj !== 'object') return 'That file is not readable.';
    if (!obj.vaultique_backup) return 'That is not a Vaultique settings backup.';
    if (obj.vaultique_backup > BACKUP_FORMAT) {
      return 'That backup was made by a newer version of the website than the one running now.';
    }
    if (!obj.settings || typeof obj.settings !== 'object') return 'That backup has no settings in it.';
    return '';
  }

  /* Restore writes back only the sections the file actually contains.
     A section the backup never knew about is left exactly as it is,
     which is what makes restoring an old backup safe rather than
     destructive. */
  function restore(ctx, obj) {
    var jobs = [], k;
    for (k in obj.settings) {
      if (Object.prototype.hasOwnProperty.call(obj.settings, k)) {
        jobs.push(A.store.save(k, obj.settings[k]));
      }
    }
    var priv = obj.privateSettings || {};
    for (k in priv) {
      if (Object.prototype.hasOwnProperty.call(priv, k)) {
        jobs.push(A.store.savePrivate(k, priv[k]));
      }
    }
    return Promise.all(jobs).then(function () { A.store.forget(); return jobs.length; });
  }

  function sectionsIn(obj) {
    var names = [], k;
    for (k in obj.settings) {
      if (Object.prototype.hasOwnProperty.call(obj.settings, k)) names.push(k);
    }
    return names;
  }

  /* ---- the page -------------------------------------------------------- */

  A.registerSetting({
    key: 'system-maintenance',
    title: 'System & Maintenance',
    summary: 'Which build is live, whether everything is working, and settings backups.',
    render: function (host, ctx) {
      host.innerHTML = '';
      var v = stamp();

      /* The shell offers its dialogs both on the page context and on the
         registry. Take either, so this page cannot be broken by which
         one a future shell keeps. */
      var ask = ctx.ask || A.ask;
      var tell = ctx.tell || A.tell;

      /* --- a status line: label on the left, live result on the right --- */
      function statusRow(into, label, initial) {
        var row = el('div', 'sys-row');
        row.appendChild(el('span', 'sys-label', label));
        var val = el('span', 'sys-value', initial || 'Checking…');
        row.appendChild(val);
        into.appendChild(row);
        return val;
      }

      function paintCheck(node, res) {
        node.className = 'sys-value ' +
          (res.ok === true ? 'sys-ok' : res.ok === 'warn' ? 'sys-warn' : 'sys-bad');
        node.textContent = (res.ok === true ? '✓ ' : res.ok === 'warn' ? '! ' : '✕ ') +
          (res.detail || (res.ok === true ? 'Working' : 'Not working'));
      }

      /* ================= System information ========================= */
      var info = el('div', 'card');
      info.appendChild(el('h3', null, 'System information'));
      info.appendChild(el('p', 'grp-note',
        'What is running right now. These are read from the live site, not typed in.'));

      if (v.build) {
        statusRow(info, 'Website version', v.version || '—').className = 'sys-value';
        statusRow(info, 'Build number', String(v.build)).className = 'sys-value';
        statusRow(info, 'This build was packaged',
          when(v.builtAt) + (v.builtAt ? ' (' + ago(v.builtAt) + ')' : '')).className = 'sys-value';
      } else {
        var noStamp = el('div', 'warn');
        noStamp.textContent =
          'This build has no version stamp, so the version and deployment history below ' +
          'cannot be shown. The file assets/version.js is missing from the upload.';
        info.appendChild(noStamp);
      }

      var liveEl = statusRow(info, 'Went live', '—');
      var dbEl = statusRow(info, 'Database');
      var storeEl = statusRow(info, 'Photo storage');
      var updEl = statusRow(info, 'Settings last changed', '—');
      host.appendChild(info);

      checkDatabase(ctx).then(function (r) { paintCheck(dbEl, r); });
      checkStorage(ctx).then(function (r) { paintCheck(storeEl, r); });

      lastUpdated(ctx).then(function (rows) {
        if (!rows.length) { updEl.textContent = 'Nothing saved yet'; return; }
        var top = rows[0];
        updEl.textContent = when(top.updated_at) + ' (' + ago(top.updated_at) + ')';
      });

      /* ================= Maintenance ================================ */
      var maint = el('div', 'card');
      maint.appendChild(el('h3', null, 'Maintenance'));

      var modeNote = el('p', 'grp-note',
        'The maintenance switch itself lives in Settings > General, with the rest of the ' +
        'website status, so there is only ever one switch to find.');
      maint.appendChild(modeNote);

      var modeEl = statusRow(maint, 'Maintenance mode');
      var toGeneral = el('div', 'row');
      var gBtn = el('button', 'btn btn-out btn-sm', 'Open website status in General');
      gBtn.type = 'button';
      gBtn.addEventListener('click', function () { ctx.navigate('settings', 'general'); });
      toGeneral.appendChild(gBtn);
      maint.appendChild(toGeneral);

      checkMaintenance().then(function (r) {
        modeEl.className = 'sys-value ' + (r.ok === true ? 'sys-ok' : 'sys-warn');
        modeEl.textContent = (r.ok === true ? '✓ Off — ' : '! ') + r.detail;
      });

      maint.appendChild(el('h3', 'sys-sub', 'Refresh the website data'));
      maint.appendChild(el('p', 'grp-note',
        'The admin keeps a copy of your settings while you work, so moving between ' +
        'sections is instant. This throws that copy away and reads everything fresh. ' +
        'Use it if a change you saved is not showing up here.'));

      var refreshRow = el('div', 'row');
      var refreshBtn = el('button', 'btn btn-out btn-sm', 'Refresh website data');
      refreshBtn.type = 'button';
      refreshRow.appendChild(refreshBtn);
      maint.appendChild(refreshRow);

      var refreshNote = el('p', 'count',
        'This affects the admin only. Customers already read your settings fresh on ' +
        'every visit, so a change you save reaches them the next time they open the site.');
      maint.appendChild(refreshNote);

      refreshBtn.addEventListener('click', function () {
        ask('Throw away the admin\'s copy of your settings and read everything again?',
          { title: 'Refresh website data', okText: 'Refresh' }).then(function (yes) {
          if (!yes) return;
          A.store.forget();
          location.reload();
        });
      });

      maint.appendChild(el('h3', 'sys-sub', 'System health check'));
      maint.appendChild(el('p', 'grp-note',
        'Tests everything at once, including whether your bank details are still ' +
        'sealed off from the public. Worth running after every upload.'));

      var healthRow = el('div', 'row');
      var healthBtn = el('button', 'btn btn-gold btn-sm', 'Run health check');
      healthBtn.type = 'button';
      healthRow.appendChild(healthBtn);
      maint.appendChild(healthRow);
      var healthOut = el('div', 'sys-health');
      maint.appendChild(healthOut);
      host.appendChild(maint);

      healthBtn.addEventListener('click', function () {
        healthBtn.disabled = true;
        healthBtn.textContent = 'Checking…';
        healthOut.innerHTML = '';
        runAll(ctx).then(function (results) {
          healthBtn.disabled = false;
          healthBtn.textContent = 'Run health check again';
          var bad = 0, warns = 0;
          results.forEach(function (r) {
            if (r.ok === false) bad++; else if (r.ok === 'warn') warns++;
            var line = el('div', 'sys-row');
            line.appendChild(el('span', 'sys-label', r.label));
            var val = el('span', 'sys-value');
            paintCheck(val, r);
            line.appendChild(val);
            healthOut.appendChild(line);
          });
          var summary = el('div', bad ? 'warn' : 'count');
          summary.textContent = bad
            ? bad + ' problem' + (bad === 1 ? '' : 's') + ' found. Read the red lines above.'
            : warns
              ? 'Nothing broken. ' + warns + ' thing' + (warns === 1 ? '' : 's') + ' worth a look.'
              : 'Everything is working.';
          healthOut.appendChild(summary);
        });
      });

      /* ================= Backup ===================================== */
      var back = el('div', 'card');
      back.appendChild(el('h3', null, 'Backup'));
      back.appendChild(el('p', 'grp-note',
        'A backup is a single file holding every setting on every page of this admin: ' +
        'your business details, prices, delivery, payment details, policies and the rest. ' +
        'Keep one somewhere safe before you make big changes.'));

      var whatNot = el('div', 'warn');
      whatNot.textContent =
        'A backup does not include your product photos, orders, customers or reviews. ' +
        'Those stay in the database and are backed up by Supabase itself.';
      back.appendChild(whatNot);

      var lastBackEl = statusRow(back, 'Last backup taken', '—');

      var backRow = el('div', 'row');
      var dlBtn = el('button', 'btn btn-gold btn-sm', 'Download a backup');
      dlBtn.type = 'button';
      var upBtn = el('button', 'btn btn-out btn-sm', 'Restore from a backup');
      upBtn.type = 'button';
      backRow.appendChild(dlBtn);
      backRow.appendChild(upBtn);
      back.appendChild(backRow);

      var picker = el('input');
      picker.type = 'file';
      picker.accept = '.json,application/json';
      picker.className = 'hide';
      back.appendChild(picker);
      host.appendChild(back);

      function showLastBackup() {
        A.store.load(HKEY).then(function (row) {
          if (!row.lastBackupAt) { lastBackEl.textContent = 'No backup taken yet'; return; }
          lastBackEl.textContent = when(row.lastBackupAt) + ' (' + ago(row.lastBackupAt) + ')';
        }).catch(function () { lastBackEl.textContent = '—'; });
      }
      showLastBackup();

      dlBtn.addEventListener('click', function () {
        ask('This file will contain your bank account and mobile money details in ' +
                'plain, readable text. Anyone who opens the file can read them. Save it ' +
                'somewhere only you can get to, and do not email it to anyone.',
          { title: 'Before you download', okText: 'I understand, download it' })
          .then(function (yes) {
            if (!yes) return;
            dlBtn.disabled = true;
            dlBtn.textContent = 'Preparing…';
            return gather(ctx).then(function (obj) {
              var name = download(obj);
              dlBtn.disabled = false;
              dlBtn.textContent = 'Download a backup';
              /* Recording the time is a convenience, not the backup, so a
                 failure to record must not read as a failed backup. */
              return A.store.load(HKEY).then(function (row) {
                row.lastBackupAt = new Date().toISOString();
                return A.store.save(HKEY, row);
              }).catch(function () {}).then(function () {
                showLastBackup();
                var msg = 'Saved as ' + name + ', usually in your Downloads folder.';
                if (obj.privateFailed) {
                  msg += ' Note: your payment details could not be included (' +
                         obj.privateFailed + ').';
                }
                return tell(msg, { title: 'Backup downloaded' });
              });
            }).catch(function (e) {
              dlBtn.disabled = false;
              dlBtn.textContent = 'Download a backup';
              return tell('The backup could not be made: ' + errText(e),
                { title: 'That did not work' });
            });
          });
      });

      upBtn.addEventListener('click', function () { picker.click(); });

      picker.addEventListener('change', function () {
        var file = picker.files && picker.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
          var obj = null, problem = '';
          try { obj = JSON.parse(reader.result); }
          catch (e) { problem = 'That file is not readable as a backup.'; }
          if (!problem) problem = validate(obj);
          picker.value = '';                       // so the same file can be picked again
          if (problem) { tell(problem, { title: 'That file cannot be used' }); return; }

          var names = sectionsIn(obj);
          var priv = obj.privateSettings && Object.keys(obj.privateSettings).length;
          ask('This will replace ' + names.length + ' section' +
                  (names.length === 1 ? '' : 's') + ' of your settings' +
                  (priv ? ', including your payment details' : '') +
                  ' with what was saved on ' + (when(obj.takenAt) || 'the date in the file') +
                  '. Anything not in the file is left alone. This cannot be undone.',
            { title: 'Restore these settings?', danger: true, okText: 'Restore',
              note: names.join(', ') })
            .then(function (yes) {
              if (!yes) return;
              return restore(ctx, obj).then(function (n) {
                return tell('Restored ' + n + ' section' + (n === 1 ? '' : 's') +
                                '. The admin will reload so everything is read fresh.',
                  { title: 'Restored' }).then(function () { location.reload(); });
              }).catch(function (e) {
                return tell('The restore did not finish: ' + errText(e) +
                                ' Some sections may have been changed. Check them before trading.',
                  { title: 'That did not work' });
              });
            });
        };
        reader.readAsText(file);
      });

      /* ================= Deployment history ========================= */
      var hist = el('div', 'card');
      hist.appendChild(el('h3', null, 'Deployment history'));
      hist.appendChild(el('p', 'grp-note',
        'Every build of the website that has gone live, newest first. This is written ' +
        'automatically the first time the admin sees a new build, so there is nothing ' +
        'to keep up to date.'));
      var histBody = el('div', 'sys-hist');
      histBody.appendChild(el('p', 'count', 'Reading…'));
      hist.appendChild(histBody);
      host.appendChild(hist);

      history().then(function (list) {
        histBody.innerHTML = '';
        if (!list.length) {
          histBody.appendChild(el('p', 'count',
            'Nothing recorded yet. The first entry appears once this build has been ' +
            'uploaded to the live site.'));
          liveEl.textContent = 'Not recorded yet';
          return;
        }

        var current = null, i;
        for (i = 0; i < list.length; i++) {
          if (list[i] && list[i].build === v.build) { current = list[i]; break; }
        }
        if (current) {
          liveEl.textContent = when(current.liveAt) + ' (' + ago(current.liveAt) + ')';
        } else {
          liveEl.textContent = 'Not recorded yet';
        }

        list.forEach(function (d, idx) {
          var item = el('div', 'sys-deploy' + (d.build === v.build ? ' sys-now' : ''));
          var head = el('div', 'sys-deploy-head');
          head.appendChild(el('strong', null, 'Version ' + (d.version || '?') +
                                              '  ·  build ' + d.build));
          var tag = idx === 0 ? 'Current' : (idx === 1 ? 'Previous' : '');
          if (d.build === v.build) tag = 'Running now';
          if (tag) head.appendChild(el('span', 'sys-tag', tag));
          item.appendChild(head);
          item.appendChild(el('div', 'count', 'Went live ' + when(d.liveAt) +
                                              ' (' + ago(d.liveAt) + ')'));
          if (d.notes) item.appendChild(el('p', 'sys-notes', d.notes));
          histBody.appendChild(item);
        });
      });
    }
  });

  /* The shell calls record() once, after sign in. Exposed here rather
     than run on load so this file stays a page that can be opened, not a
     script with a side effect. */
  A.system = { record: record, runAll: runAll, validate: validate };
})();
