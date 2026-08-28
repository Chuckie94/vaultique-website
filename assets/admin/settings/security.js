/* =====================================================================
   Vaultique Boutique Point - Admin > Settings > Security
   ---------------------------------------------------------------------
   The account that can change every price, read the bank details and
   empty the shop is protected by one password. This page is where that
   stops being the only thing standing in the way.

   What is on this page is chosen by one test: does it actually stop
   somebody, or does it only look as though it does.

     Two factor            real, and enforced at sign in rather than
                           merely enrolled - see the note in the shell
     Sign out other devices real, done on Supabase's side
     Idle timeout          real for this browser: the session is ended
     Remember me           real: the session stops surviving the browser
     Failed sign-in delay   honest but weak, and labelled as such
     Active session list    NOT BUILT - see below
     Roles and permissions  NOT BUILT - see below

   Two things the brief asked for are deliberately absent.

   A list of every device signed in cannot be got at from a browser.
   Supabase offers no such call to a page; only the service_role key can
   ask, and that key reads and writes everything while ignoring every
   security rule in the database. Shipping it to the website to populate
   a list would hand an attacker the whole shop in exchange for a nicety.
   So this page shows the session it can honestly see - this one - and
   offers the button the list existed to reach: sign every other device
   out.

   Roles and permissions are not built because hiding a tab is not a
   permission. Every rule in the database asks is_admin() and nothing
   finer, so a "limited" admin whose tabs were hidden would still be able
   to change anything by other means. Real roles mean a column on the
   admins table and every policy rewritten to respect it. That is a
   database change and a decision about staff, so it is asked for rather
   than assumed.
   ===================================================================== */
(function () {
  'use strict';
  if (!window.VBP_ADMIN) return;

  var A = window.VBP_ADMIN;
  var S = A.security || {};

  var DEFAULTS = {
    sessionTimeout: 30,        // minutes of no activity; 0 means never
    offerRememberMe: true,
    lockoutEnabled: true,
    lockoutAttempts: 5,
    lockoutMinutes: 15
  };

  A.store.registerDefaults('security', DEFAULTS);

  var TIMEOUTS = [
    { value: 0,   label: 'Never sign me out' },
    { value: 15,  label: 'After 15 minutes of no activity' },
    { value: 30,  label: 'After 30 minutes of no activity' },
    { value: 60,  label: 'After 1 hour of no activity' },
    { value: 120, label: 'After 2 hours of no activity' },
    { value: 480, label: 'After 8 hours of no activity' }
  ];

  /* ---- helpers -------------------------------------------------------- */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function errText(e) {
    if (!e) return 'no reason given';
    return e.message || e.error_description || String(e);
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

  /* A labelled input inside one of the small inline forms. */
  function input(into, label, type, autocomplete) {
    var wrap = el('div', 'field');
    var id = 'sec_' + Math.random().toString(36).slice(2, 9);
    var lab = el('label', null, label);
    lab.setAttribute('for', id);
    var box = document.createElement('input');
    box.type = type || 'text';
    box.id = id;
    if (autocomplete) box.autocomplete = autocomplete;
    wrap.appendChild(lab);
    wrap.appendChild(box);
    into.appendChild(wrap);
    return box;
  }

  function say(node, msg, kind) {
    node.textContent = msg || '';
    node.className = 'sec-msg' + (kind ? ' ' + kind : '');
  }

  /* Check a password without disturbing the session that is open.

     Signing in again on the live client would replace the current
     session, and on an account with two factor enrolled it would drop it
     back to the unverified level half way through the page. A throwaway
     client that persists nothing answers the same question and leaves
     everything alone. */
  function passwordIsRight(ctx, email, password) {
    var cfg = ctx.cfg || {};
    if (!window.supabase || !window.supabase.createClient) {
      return Promise.reject(new Error('Could not check your password here.'));
    }
    var probe = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
    return probe.auth.signInWithPassword({ email: email, password: password })
      .then(function (r) {
        /* Sign the throwaway session straight back out so it cannot be
           left lying around in memory any longer than the check needs. */
        try { probe.auth.signOut({ scope: 'local' }); } catch (e) {}
        return !r.error;
      });
  }

  /* ---- the page -------------------------------------------------------- */

  A.registerSetting({
    key: 'security',
    title: 'Security',
    summary: 'Your login, two factor authentication, and who else can sign in.',
    render: function (host, ctx) {
      host.innerHTML = '';
      var sb = ctx.sb;
      var tell = ctx.tell || A.tell;
      var ask = ctx.ask || A.ask;
      var me = null;            // the signed in user
      var customerRules = {};   // password rules from Customer Accounts

      /* ============== your login ================================== */
      var loginCard = el('div', 'card');
      loginCard.appendChild(el('h3', null, 'Your login'));
      loginCard.appendChild(el('p', 'grp-note',
        'The email and password you use to open this admin. Changing either ' +
        'asks for your current password first.'));

      var whoRow = el('div', 'sys-row');
      whoRow.appendChild(el('span', 'sys-label', 'Signed in as'));
      var whoVal = el('span', 'sys-value', 'Reading…');
      whoRow.appendChild(whoVal);
      loginCard.appendChild(whoRow);

      var lastRow = el('div', 'sys-row');
      lastRow.appendChild(el('span', 'sys-label', 'This sign in began'));
      var lastVal = el('span', 'sys-value', '—');
      lastRow.appendChild(lastVal);
      loginCard.appendChild(lastRow);

      var loginBtns = el('div', 'row');
      var emailBtn = el('button', 'btn btn-out btn-sm', 'Change email');
      emailBtn.type = 'button';
      var pwBtn = el('button', 'btn btn-out btn-sm', 'Change password');
      pwBtn.type = 'button';
      loginBtns.appendChild(emailBtn);
      loginBtns.appendChild(pwBtn);
      loginCard.appendChild(loginBtns);

      var emailForm = el('div', 'sec-form hide');
      var pwForm = el('div', 'sec-form hide');
      loginCard.appendChild(emailForm);
      loginCard.appendChild(pwForm);
      host.appendChild(loginCard);

      /* --- change email --- */
      (function () {
        emailForm.appendChild(el('h4', null, 'Change the email you sign in with'));
        var cur = input(emailForm, 'Your current password', 'password', 'current-password');
        var next = input(emailForm, 'New email address', 'email', 'email');
        var msg = el('p', 'sec-msg');
        emailForm.appendChild(msg);
        var row = el('div', 'row');
        var go = el('button', 'btn btn-gold btn-sm', 'Change email');
        go.type = 'button';
        var no = el('button', 'btn btn-out btn-sm', 'Cancel');
        no.type = 'button';
        row.appendChild(go); row.appendChild(no);
        emailForm.appendChild(row);

        emailBtn.addEventListener('click', function () {
          pwForm.classList.add('hide');
          emailForm.classList.toggle('hide');
          if (!emailForm.classList.contains('hide')) cur.focus();
        });
        no.addEventListener('click', function () {
          emailForm.classList.add('hide'); cur.value = ''; next.value = ''; say(msg, '');
        });

        go.addEventListener('click', function () {
          var address = String(next.value || '').trim();
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) {
            say(msg, 'That does not look like an email address.', 'err'); return;
          }
          if (!cur.value) { say(msg, 'Enter your current password.', 'err'); return; }
          go.disabled = true;
          say(msg, 'Checking…');
          passwordIsRight(ctx, me.email, cur.value).then(function (right) {
            if (!right) { go.disabled = false; say(msg, 'That password is not right.', 'err'); return; }
            return sb.auth.updateUser({ email: address }).then(function (r) {
              go.disabled = false;
              if (r.error) { say(msg, errText(r.error), 'err'); return; }
              cur.value = ''; next.value = '';
              say(msg, '');
              emailForm.classList.add('hide');
              /* Supabase will not move the login until the address is
                 confirmed, and says so in a mail to both. Anything less
                 than that would let a typo lock the owner out. */
              tell('A confirmation link has been sent to ' + address + '. Your login stays ' +
                   'as it is until you open that link. Check the new address, and the old ' +
                   'one too - Supabase writes to both.',
                { title: 'Almost done' });
            });
          }).catch(function (e) {
            go.disabled = false;
            say(msg, errText(e), 'err');
          });
        });
      })();

      /* --- change password --- */
      (function () {
        pwForm.appendChild(el('h4', null, 'Change your password'));
        var cur = input(pwForm, 'Your current password', 'password', 'current-password');
        var a = input(pwForm, 'New password', 'password', 'new-password');
        var b = input(pwForm, 'New password again', 'password', 'new-password');
        var rule = el('p', 'count');
        pwForm.appendChild(rule);
        var msg = el('p', 'sec-msg');
        pwForm.appendChild(msg);
        var row = el('div', 'row');
        var go = el('button', 'btn btn-gold btn-sm', 'Change password');
        go.type = 'button';
        var no = el('button', 'btn btn-out btn-sm', 'Cancel');
        no.type = 'button';
        row.appendChild(go); row.appendChild(no);
        pwForm.appendChild(row);

        function refreshRule() {
          rule.textContent = S.passwordRule ? S.passwordRule(customerRules) : '';
        }
        refreshRule();

        a.addEventListener('input', function () {
          if (!a.value) { refreshRule(); return; }
          var bad = S.passwordProblem ? S.passwordProblem(a.value, customerRules) : '';
          rule.textContent = bad || 'That will do.';
        });

        pwBtn.addEventListener('click', function () {
          emailForm.classList.add('hide');
          pwForm.classList.toggle('hide');
          refreshRule();
          if (!pwForm.classList.contains('hide')) cur.focus();
        });
        no.addEventListener('click', function () {
          pwForm.classList.add('hide');
          cur.value = ''; a.value = ''; b.value = ''; say(msg, ''); refreshRule();
        });

        go.addEventListener('click', function () {
          var bad = S.passwordProblem ? S.passwordProblem(a.value, customerRules) : '';
          if (bad) { say(msg, bad, 'err'); return; }
          if (a.value !== b.value) { say(msg, 'The two new passwords are not the same.', 'err'); return; }
          if (!cur.value) { say(msg, 'Enter your current password.', 'err'); return; }
          if (cur.value === a.value) { say(msg, 'That is the password you already have.', 'err'); return; }

          go.disabled = true;
          say(msg, 'Checking…');
          passwordIsRight(ctx, me.email, cur.value).then(function (right) {
            if (!right) { go.disabled = false; say(msg, 'That password is not right.', 'err'); return; }
            return sb.auth.updateUser({ password: a.value }).then(function (r) {
              go.disabled = false;
              if (r.error) { say(msg, errText(r.error), 'err'); return; }
              cur.value = ''; a.value = ''; b.value = '';
              pwForm.classList.add('hide');
              say(msg, '');
              return ask('Your password is changed. Sign out every other device as well? ' +
                         'Anyone still signed in elsewhere with the old password stays signed in ' +
                         'until you do.',
                { title: 'Password changed', okText: 'Sign the others out', cancelText: 'Not now' })
                .then(function (yes) {
                  if (!yes) return;
                  return signOutOthers();
                });
            });
          }).catch(function (e) {
            go.disabled = false;
            say(msg, errText(e), 'err');
          });
        });
      })();

      /* ============== two factor =================================== */
      var mfaCard = el('div', 'card');
      mfaCard.appendChild(el('h3', null, 'Two factor authentication'));
      mfaCard.appendChild(el('p', 'grp-note',
        'A six digit code from an app on your phone, on top of your password. ' +
        'Somebody who learns your password still cannot sign in without your phone. ' +
        'Use Google Authenticator, Microsoft Authenticator, Authy, or any app of that kind.'));

      var mfaRow = el('div', 'sys-row');
      mfaRow.appendChild(el('span', 'sys-label', 'Status'));
      var mfaVal = el('span', 'sys-value', 'Reading…');
      mfaRow.appendChild(mfaVal);
      mfaCard.appendChild(mfaRow);

      var mfaBtns = el('div', 'row');
      var setupBtn = el('button', 'btn btn-gold btn-sm', 'Set up two factor');
      setupBtn.type = 'button';
      setupBtn.classList.add('hide');
      var offBtn = el('button', 'btn btn-out btn-sm', 'Turn two factor off');
      offBtn.type = 'button';
      offBtn.classList.add('hide');
      mfaBtns.appendChild(setupBtn);
      mfaBtns.appendChild(offBtn);
      mfaCard.appendChild(mfaBtns);

      var mfaForm = el('div', 'sec-form hide');
      mfaCard.appendChild(mfaForm);
      host.appendChild(mfaCard);

      var pendingFactor = null;

      function paintMfa(list) {
        if (list.length) {
          mfaVal.className = 'sys-value sys-ok';
          mfaVal.textContent = '✓ On — a code is required every time you sign in';
          setupBtn.classList.add('hide');
          offBtn.classList.remove('hide');
        } else {
          mfaVal.className = 'sys-value sys-warn';
          mfaVal.textContent = '! Off — your password is the only thing protecting the shop';
          setupBtn.classList.remove('hide');
          offBtn.classList.add('hide');
        }
      }

      function refreshMfa() {
        return S.factors(sb).then(paintMfa);
      }

      setupBtn.addEventListener('click', function () {
        mfaForm.innerHTML = '';
        mfaForm.classList.remove('hide');
        mfaForm.appendChild(el('p', 'count', 'Setting up…'));

        sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Vaultique admin' })
          .then(function (r) {
            if (r.error) throw r.error;
            pendingFactor = r.data.id;
            var totp = r.data.totp || {};
            mfaForm.innerHTML = '';
            mfaForm.appendChild(el('h4', null, 'Scan this with your authenticator app'));

            if (totp.qr_code) {
              var img = document.createElement('img');
              img.className = 'sec-qr';
              img.alt = 'QR code for setting up two factor authentication';
              img.src = totp.qr_code;
              mfaForm.appendChild(img);
            }

            mfaForm.appendChild(el('p', 'count',
              'Cannot scan it? Type this into the app by hand instead:'));
            var code = el('p', 'sec-secret', totp.secret || '');
            mfaForm.appendChild(code);

            var box = input(mfaForm, 'Now enter the six digit code the app shows', 'text');
            box.setAttribute('inputmode', 'numeric');
            box.setAttribute('autocomplete', 'one-time-code');
            box.maxLength = 7;

            var msg = el('p', 'sec-msg');
            mfaForm.appendChild(msg);

            var row = el('div', 'row');
            var go = el('button', 'btn btn-gold btn-sm', 'Confirm');
            go.type = 'button';
            var no = el('button', 'btn btn-out btn-sm', 'Cancel');
            no.type = 'button';
            row.appendChild(go); row.appendChild(no);
            mfaForm.appendChild(row);
            box.focus();

            function cancel() {
              /* An enrolment nobody confirmed is not protection, and
                 leaving it behind would clutter the account with factors
                 that never worked. */
              if (pendingFactor) {
                sb.auth.mfa.unenroll({ factorId: pendingFactor }).catch(function () {});
                pendingFactor = null;
              }
              mfaForm.classList.add('hide');
              mfaForm.innerHTML = '';
            }
            no.addEventListener('click', cancel);

            go.addEventListener('click', function () {
              var typed = String(box.value || '').replace(/\s/g, '');
              if (!/^\d{6}$/.test(typed)) {
                say(msg, 'The code is six digits.', 'err'); return;
              }
              go.disabled = true;
              say(msg, 'Checking…');
              sb.auth.mfa.challenge({ factorId: pendingFactor }).then(function (c) {
                if (c.error) throw c.error;
                return sb.auth.mfa.verify({
                  factorId: pendingFactor, challengeId: c.data.id, code: typed
                });
              }).then(function (r) {
                go.disabled = false;
                if (r.error) { say(msg, errText(r.error), 'err'); return; }
                pendingFactor = null;
                mfaForm.classList.add('hide');
                mfaForm.innerHTML = '';
                return refreshMfa().then(function () {
                  return tell('Two factor is on. From now on, signing in asks for a code ' +
                              'from your phone as well as your password. Keep the app - ' +
                              'without it you would need Supabase to let you back in.',
                    { title: 'Two factor is on' });
                });
              }).catch(function (e) {
                go.disabled = false;
                say(msg, errText(e), 'err');
              });
            });
          })
          .catch(function (e) {
            mfaForm.innerHTML = '';
            mfaForm.appendChild(el('p', 'err-txt', 'Two factor could not be set up: ' + errText(e)));
          });
      });

      offBtn.addEventListener('click', function () {
        ask('Turn two factor off? Your password becomes the only thing between anyone ' +
            'and the whole shop, including the bank details.',
          { title: 'Turn two factor off?', danger: true, okText: 'Turn it off' })
          .then(function (yes) {
            if (!yes) return;
            return S.factors(sb).then(function (list) {
              if (!list.length) return refreshMfa();
              return sb.auth.mfa.unenroll({ factorId: list[0].id }).then(function (r) {
                if (r.error) throw r.error;
                return refreshMfa();
              });
            });
          })
          .catch(function (e) { tell(errText(e), { title: 'That did not work' }); });
      });

      /* ============== devices ====================================== */
      var devCard = el('div', 'card');
      devCard.appendChild(el('h3', null, 'This device, and the others'));
      devCard.appendChild(el('p', 'grp-note',
        'A list of every device signed in is not something a web page can be told - ' +
        'only a key that can read and write your entire database could ask, and that ' +
        'key has no business being on the website. So this shows the session it can ' +
        'honestly see, and offers the button the list would have been for.'));

      var expRow = el('div', 'sys-row');
      expRow.appendChild(el('span', 'sys-label', 'This session'));
      var expVal = el('span', 'sys-value', '—');
      expRow.appendChild(expVal);
      devCard.appendChild(expRow);

      var remRow = el('div', 'sys-row');
      remRow.appendChild(el('span', 'sys-label', 'On this device'));
      var remVal = el('span', 'sys-value', '—');
      remRow.appendChild(remVal);
      devCard.appendChild(remRow);

      var devBtns = el('div', 'row');
      var othersBtn = el('button', 'btn btn-out btn-sm', 'Sign out every other device');
      othersBtn.type = 'button';
      devBtns.appendChild(othersBtn);
      devCard.appendChild(devBtns);
      host.appendChild(devCard);

      function signOutOthers() {
        return sb.auth.signOut({ scope: 'others' }).then(function (r) {
          if (r && r.error) throw r.error;
          return tell('Every other device has been signed out. This one is still signed in.',
            { title: 'Done' });
        }).catch(function (e) {
          return tell('That did not work: ' + errText(e), { title: 'Still signed in' });
        });
      }

      othersBtn.addEventListener('click', function () {
        ask('Sign out every device except this one? Anyone signed in elsewhere - ' +
            'another phone, another computer - will have to sign in again.',
          { title: 'Sign the others out?', okText: 'Sign them out' })
          .then(function (yes) { if (yes) return signOutOthers(); });
      });

      /* ============== administrators =============================== */
      var admCard = el('div', 'card');
      admCard.appendChild(el('h3', null, 'Administrators'));
      admCard.appendChild(el('p', 'grp-note',
        'Everyone who can sign in to this admin. Adding and removing is done in ' +
        'Supabase rather than here, on purpose: a page that could promote an account ' +
        'is a page worth attacking.'));
      var admList = el('div', 'sec-admins');
      admList.appendChild(el('p', 'count', 'Reading…'));
      admCard.appendChild(admList);
      host.appendChild(admCard);

      sb.from('admins').select('id, email, added_at').then(function (r) {
        admList.innerHTML = '';
        if (r.error) {
          admList.appendChild(el('p', 'err-txt', 'The list could not be read: ' + errText(r.error)));
          return;
        }
        var rows = r.data || [];
        if (!rows.length) {
          admList.appendChild(el('p', 'count', 'No administrators are listed.'));
          return;
        }
        rows.forEach(function (row) {
          var line = el('div', 'sys-row');
          line.appendChild(el('span', 'sys-label', row.email || '(no email recorded)'));
          var right = el('span', 'sys-value');
          right.textContent = (me && row.id === me.id ? 'You' : 'Administrator') +
            (row.added_at ? ' · added ' + when(row.added_at) : '');
          line.appendChild(right);
          admList.appendChild(line);
        });
      });

      /* ============== the saved settings =========================== */
      /* Everything above acts immediately. Only this last group is a form
         with a save bar, so the bar belongs at the bottom of the page. */
      ctx.ui.form(host, {
        key: 'security',
        savedMessage: 'Saved ✓ — takes effect the next time you sign in',
        groups: [
          {
            title: 'Signing in',
            note: 'How this admin behaves while you are using it.',
            fields: [
              { type: 'select', name: 'sessionTimeout', label: 'Sign me out automatically',
                options: TIMEOUTS,
                hint: 'A shared or shop-floor computer should not stay signed in. ' +
                      'Moving the mouse or typing counts as activity.' },
              { type: 'toggle', name: 'offerRememberMe', label: 'Offer "keep me signed in"',
                hint: 'When off, closing the browser always signs you out.' },
              { type: 'toggle', name: 'lockoutEnabled', label: 'Slow down repeated failed sign-ins',
                hint: 'After several wrong passwords, this device has to wait before trying ' +
                      'again. It stops somebody guessing at your own counter. It does not ' +
                      'stop a real attacker, who would simply use another browser - ' +
                      'Supabase limits sign-in attempts on its own side, and that is the ' +
                      'part that does.' },
              { type: 'number', name: 'lockoutAttempts', label: 'Wrong passwords allowed',
                half: true, min: 3, max: 20,
                showIf: function (v) { return !!v.lockoutEnabled; } },
              { type: 'number', name: 'lockoutMinutes', label: 'Then wait this many minutes',
                half: true, min: 1, max: 120,
                showIf: function (v) { return !!v.lockoutEnabled; } }
            ]
          }
        ]
      });

      /* ============== fill in what needs the server ================ */

      A.store.load('customer-accounts').then(function (v) { customerRules = v || {}; })
        .catch(function () {});

      sb.auth.getSession().then(function (r) {
        var session = r.data && r.data.session;
        me = (session && session.user) || null;
        whoVal.textContent = (me && me.email) || 'Not signed in';
        lastVal.textContent = me && me.last_sign_in_at
          ? when(me.last_sign_in_at) : '—';
        if (session && session.expires_at) {
          expVal.textContent = 'Expires ' + when(new Date(session.expires_at * 1000).toISOString());
        }
        remVal.textContent = S.remembering && S.remembering()
          ? 'Stays signed in when the browser closes'
          : 'Signed out when the browser closes';
      });

      refreshMfa();
    }
  });
})();
