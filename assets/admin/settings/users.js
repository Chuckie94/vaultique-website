/* =====================================================================
   Vaultique Boutique Point — Settings > Users & Roles
   ---------------------------------------------------------------------
   Everybody who signs in, in one place: create them, give them a role,
   change what a role may do, reset a password, switch somebody off.

   HOW PERMISSION WORKS. A person has a role. A role is a name with a set
   of ticks against it, kept in Settings. Change the ticks and everybody
   with that role is changed, straight away, without touching the person.

   The ticks decide which tabs the admin draws. Two of them the database
   enforces as well — answering chats and deleting a conversation — so
   those cannot be got round by a page rewritten in a browser. The rest
   are the page being tidy; a shop that needs the others enforced in the
   database should say so and they will be.

   THE OWNER IS NEVER LIMITED. Whatever the roles say, the owner gets
   everything, so no edit here can lock the shop out of its own admin.
   ===================================================================== */
(function () {
  'use strict';
  if (!window.VBP_ADMIN) return;
  var A = window.VBP_ADMIN;

  /* The admin's own tabs, in the order they appear, plus the one power
     that is not a tab. Adding a tab later means adding a line here. */
  var RIGHTS = [
    { key: 'dashboard',   label: 'Dashboard' },
    { key: 'analytics',   label: 'Website Analytics' },
    { key: 'products',    label: 'Products & Photos' },
    { key: 'orders',      label: 'Orders' },
    { key: 'chats',       label: 'Live Chats' },
    { key: 'reviews',     label: 'Reviews' },
    { key: 'subscribers', label: 'Subscribers' },
    { key: 'policies',    label: 'Policies' },
    { key: 'settings',    label: 'Settings' },
    { key: 'activity',    label: 'Activity Log' },
    { key: 'deleteChats', label: 'Delete a conversation', hard: true }
  ];

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  A.registerSetting({
    key: 'users',
    title: 'Users & Roles',
    summary: 'Who can sign in, and what each of them can do.',

    render: function (host, ctx) {
      var sb = (ctx && ctx.sb) || A.sb;
      var ask = (ctx && ctx.ask) || A.ask;
      var me = null;
      var roles = {};       // { key: { label, permissions } }
      var users = [];
      var iAmOwner = false;

      host.innerHTML = '';

      // ---------------------------------------------------------- people
      var card = el('div', 'card');
      card.appendChild(el('h3', null, 'Users'));
      card.appendChild(el('p', 'grp-note',
        'Everybody who signs in at this address. What each one can do comes ' +
        'from their role, below.'));
      var list = el('div', 'staff-list');
      list.appendChild(el('p', 'count', 'Reading…'));
      card.appendChild(list);
      var bar = el('div', 'staff-bar');
      var addBtn = el('button', 'btn btn-out btn-sm', 'Create user');
      addBtn.type = 'button';
      bar.appendChild(addBtn);
      var msg = el('span', 'staff-msg');
      bar.appendChild(msg);
      card.appendChild(bar);
      host.appendChild(card);

      // ----------------------------------------------------------- roles
      var rcard = el('div', 'card');
      rcard.style.marginTop = '18px';
      rcard.appendChild(el('h3', null, 'Roles'));
      rcard.appendChild(el('p', 'grp-note',
        'Tick what each role can open. Changes apply to everybody with that ' +
        'role the next time they load a page. The owner always has everything.'));
      var rlist = el('div', 'role-list');
      rcard.appendChild(rlist);
      var rbar = el('div', 'staff-bar');
      var newRole = el('button', 'btn btn-out btn-sm', 'Add a role');
      newRole.type = 'button';
      rbar.appendChild(newRole);
      var saveRoles = el('button', 'btn btn-gold btn-sm', 'Save roles');
      saveRoles.type = 'button';
      rbar.appendChild(saveRoles);
      var rmsg = el('span', 'staff-msg');
      rbar.appendChild(rmsg);
      rcard.appendChild(rbar);
      host.appendChild(rcard);

      function say(where, text, kind) {
        where.textContent = text || '';
        where.className = 'staff-msg' + (kind ? ' is-' + kind : '');
      }

      /* Everything that makes or changes a login goes through the server,
         because only the server holds the key that can. */
      function call(payload) {
        return Promise.resolve(sb.auth.getSession()).then(function (r) {
          return (r && r.data && r.data.session && r.data.session.access_token) || '';
        }, function () { return ''; }).then(function (t) {
          return fetch('/.netlify/functions/admin-users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
            body: JSON.stringify(payload)
          });
        }).then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (body) {
            if (!res.ok) {
              var e = new Error(body.error || ('That did not work (' + res.status + ').'));
              if (res.status === 404) {
                e.message = 'The admin-users function is not deployed yet. Upload ' +
                            'netlify/functions/admin-users.js and let Netlify build.';
              }
              throw e;
            }
            return body;
          });
        });
      }

      function roleLabel(key) {
        return (roles[key] && roles[key].label) || key;
      }

      // ------------------------------------------------------- the people
      function drawUsers() {
        list.innerHTML = '';
        if (!users.length) {
          list.appendChild(el('p', 'count', 'Nobody yet.'));
          return;
        }
        users.forEach(function (u) {
          var row = el('div', 'staff-row');
          var who = el('div', 'staff-who');
          who.appendChild(el('div', 'staff-name', u.display_name || u.email || 'Unnamed'));
          var bits = [];
          if (u.display_name && u.email) bits.push(u.email);
          bits.push(u.role === 'owner' ? 'Owner' : roleLabel(u.role));
          if (me && u.id === me) bits.push('you');
          if (!u.active) bits.push('switched off');
          if (u.must_change_password) bits.push('has not set a password');
          bits.push(Number(u.replies || 0) + (Number(u.replies) === 1 ? ' reply' : ' replies'));
          who.appendChild(el('div', 'hint', bits.join(' · ')));
          row.appendChild(who);

          var acts = el('div', 'staff-acts');
          var mine = !!(me && u.id === me);

          if (iAmOwner && u.role !== 'owner') {
            var pick = document.createElement('select');
            pick.className = 'al-pick';
            pick.setAttribute('aria-label', 'Role for ' + (u.email || 'this user'));
            Object.keys(roles).forEach(function (k) {
              var o = new Option(roles[k].label || k, k);
              if (k === u.role) o.selected = true;
              pick.appendChild(o);
            });
            pick.addEventListener('change', function () { setRole(u, pick.value); });
            acts.appendChild(pick);

            var pw = el('button', 'btn btn-out btn-sm', 'New password');
            pw.type = 'button';
            pw.addEventListener('click', function () { resetPassword(u); });
            acts.appendChild(pw);

            if (!mine) {
              var onOff = el('button', 'btn btn-out btn-sm', u.active ? 'Switch off' : 'Switch on');
              onOff.type = 'button';
              onOff.addEventListener('click', function () { setActive(u, !u.active); });
              acts.appendChild(onOff);

              var del = el('button', 'btn btn-out btn-sm lc-del', 'Remove');
              del.type = 'button';
              del.addEventListener('click', function () { removeUser(u); });
              acts.appendChild(del);
            }
          }
          row.appendChild(acts);
          list.appendChild(row);
        });
      }

      /* .catch, not a second argument to .then: the success arm throws
         when the database answers with an error rather than rejecting,
         and a rejection handler passed alongside cannot catch what its
         own partner threw. It went to the browser instead, and the page
         sat on "Reading…" with nothing said. */
      function loadUsers() {
        return Promise.resolve(sb.rpc('users_list')).then(function (r) {
          if (r && r.error) throw r.error;
          users = (r && r.data) || [];
          drawUsers();
          drawRoles();          // "3 users" under a role is only known now
        }).catch(function (e) {
          list.innerHTML = '';
          var why = (e && e.message) || String(e);
          if (/owner/i.test(why)) {
            list.appendChild(el('p', 'count',
              'Only the owner can manage users. This account is not the owner.'));
            list.appendChild(el('p', 'hint', 'To make it the owner, run this once in ' +
              'Supabase > SQL Editor with your own address:'));
            list.appendChild(el('pre', 'set-sql',
              "update public.admins set role = 'owner'\n where email = 'you@example.com';"));
          } else if (/does not exist|schema cache/i.test(why)) {
            list.appendChild(el('p', 'count', 'Not set up in the database yet.'));
            list.appendChild(el('p', 'hint',
              'Run supabase-chat-phase10.sql once in Supabase > SQL Editor, then reopen.'));
          } else {
            list.appendChild(el('p', 'count', why));
          }
          bar.style.display = 'none';
        });
      }

      /* Shown once. The site does not store it and cannot show it again. */
      function showPassword(who, password, isNew) {
        return ask('', {
          title: isNew ? 'User created' : 'New password',
          okText: 'Done', cancelText: 'Close',
          note: 'Give ' + who + ' this password. They will be asked to choose their own ' +
                'the first time they sign in. It is not stored and cannot be shown again.',
          copyText: password
        });
      }

      function createUser() {
        say(msg, '');
        var keys = Object.keys(roles);
        if (!keys.length) { say(msg, 'Add a role first.', 'err'); return; }
        return ask('', {
          title: 'Create user',
          okText: 'Next',
          input: { label: 'Their email address', placeholder: 'name@example.com' }
        }).then(function (email) {
          if (!email) return;
          return ask('', {
            title: 'Their role',
            okText: 'Create',
            choices: keys.map(function (k) {
              var p = (roles[k] && roles[k].permissions) || {};
              var can = RIGHTS.filter(function (x) { return p[x.key]; })
                              .map(function (x) { return x.label; });
              return { value: k, label: roles[k].label || k,
                       hint: can.length ? can.join(', ') : 'nothing yet' };
            })
          }).then(function (role) {
            /* A list of things to pick from answers with the one that
               was picked, and with null when nobody picked anything. */
            if (!role) return;
            say(msg, 'Creating…', 'busy');
            return call({ action: 'create', email: String(email).trim(), role: role })
              .then(function (b) {
                say(msg, '');
                return showPassword(b.email, b.password, true);
              })
              .then(loadUsers)
              .catch(function (e) { say(msg, (e && e.message) || String(e), 'err'); });
          });
        });
      }

      function setRole(u, role) {
        say(msg, 'Saving…', 'busy');
        Promise.resolve(sb.rpc('user_set_role', { p_id: u.id, p_role: role }))
          .then(function (r) {
            if (r && r.error) throw r.error;
            say(msg, (u.email || 'They') + ' is now ' + roleLabel(role) + '.', 'ok');
            return loadUsers();
          })
          .catch(function (e) { say(msg, (e && e.message) || String(e), 'err'); return loadUsers(); });
      }

      function setActive(u, active) {
        say(msg, 'Saving…', 'busy');
        Promise.resolve(sb.rpc('user_set_active', { p_id: u.id, p_active: active }))
          .then(function (r) {
            if (r && r.error) throw r.error;
            say(msg, '');
            return loadUsers();
          })
          .catch(function (e) { say(msg, (e && e.message) || String(e), 'err'); });
      }

      function resetPassword(u) {
        say(msg, '');
        return ask('Set a new password for ' + (u.email || 'this user') + '?', {
          okText: 'Set a new one',
          note: 'Their current password stops working. They choose their own next sign-in.'
        }).then(function (yes) {
          if (!yes) return;
          say(msg, 'Setting…', 'busy');
          return call({ action: 'reset', id: u.id })
            .then(function (b) { say(msg, ''); return showPassword(b.email, b.password, false); })
            .then(loadUsers)
            .catch(function (e) { say(msg, (e && e.message) || String(e), 'err'); });
        });
      }

      function removeUser(u) {
        say(msg, '');
        return ask('Remove ' + (u.email || 'this user') + '?', {
          danger: true, okText: 'Remove', title: 'They lose access',
          note: 'Their replies stay in the conversations they handled. Their login is left ' +
                'alone in case it is also a customer account.'
        }).then(function (yes) {
          if (!yes) return;
          say(msg, 'Removing…', 'busy');
          return call({ action: 'remove', id: u.id })
            .then(function () { say(msg, ''); return loadUsers(); })
            .catch(function (e) { say(msg, (e && e.message) || String(e), 'err'); });
        });
      }

      // -------------------------------------------------------- the roles
      function drawRoles() {
        rlist.innerHTML = '';
        var keys = Object.keys(roles);
        if (!keys.length) {
          rlist.appendChild(el('p', 'count', 'No roles yet. Add one.'));
          return;
        }
        keys.forEach(function (k) {
          var r = roles[k] || {};
          r.permissions = r.permissions || {};
          var box = el('div', 'role-card');

          var head = el('div', 'role-head');
          var name = document.createElement('input');
          name.type = 'text';
          name.className = 'al-pick role-name';
          name.value = r.label || k;
          name.maxLength = 40;
          name.setAttribute('aria-label', 'Role name');
          name.addEventListener('input', function () { r.label = name.value; });
          head.appendChild(name);

          var used = users.filter(function (u) { return u.role === k; }).length;
          head.appendChild(el('span', 'hint',
            used ? used + (used === 1 ? ' user' : ' users') : 'nobody yet'));

          var drop = el('button', 'btn btn-out btn-sm lc-del', 'Delete role');
          drop.type = 'button';
          drop.disabled = used > 0;
          if (used > 0) drop.title = 'Move those users to another role first.';
          drop.addEventListener('click', function () {
            delete roles[k];
            drawRoles();
          });
          head.appendChild(drop);
          box.appendChild(head);

          var ticks = el('div', 'role-ticks');
          RIGHTS.forEach(function (right) {
            var lab = el('label', 'role-tick');
            var cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = r.permissions[right.key] === true;
            cb.addEventListener('change', function () {
              r.permissions[right.key] = cb.checked;
            });
            lab.appendChild(cb);
            lab.appendChild(el('span', null, right.label));
            if (right.hard) lab.appendChild(el('span', 'role-hard', 'enforced'));
            ticks.appendChild(lab);
          });
          box.appendChild(ticks);
          rlist.appendChild(box);
        });
      }

      /* A copy of our own to edit. The store hands back a shallow copy,
         so the role objects inside it are the ones it is holding — and
         ticking a box would quietly change what every other page thinks
         the roles are, saved or not. */
      function loadRoles() {
        return A.store.load('roles').then(function (d) {
          try { roles = JSON.parse(JSON.stringify(d || {})); }
          catch (e) { roles = {}; }
          if (!roles || typeof roles !== 'object') roles = {};
          drawRoles();
        }, function () { roles = {}; drawRoles(); });
      }

      newRole.addEventListener('click', function () {
        return ask('', {
          title: 'Add a role', okText: 'Add',
          input: { label: 'What to call it', placeholder: 'e.g. Stock' }
        }).then(function (label) {
          if (!label) return;
          var key = String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
          if (!key) { say(rmsg, 'Give it a name with letters in it.', 'err'); return; }
          if (roles[key]) { say(rmsg, 'There is already a role called that.', 'err'); return; }
          roles[key] = { label: String(label).trim(), permissions: {} };
          drawRoles();
          say(rmsg, 'Tick what it can do, then Save roles.', 'ok');
        });
      });

      saveRoles.addEventListener('click', function () {
        say(rmsg, 'Saving…', 'busy');
        saveRoles.disabled = true;
        A.store.save('roles', roles).then(function () {
          saveRoles.disabled = false;
          say(rmsg, 'Saved. Everybody with these roles picks them up on their next page.', 'ok');
          return loadUsers();
        }, function (e) {
          saveRoles.disabled = false;
          say(rmsg, (e && e.message) || String(e), 'err');
        });
      });

      addBtn.addEventListener('click', createUser);

      // ------------------------------------------------------------- boot
      Promise.resolve(sb.auth.getSession()).then(function (r) {
        me = (r && r.data && r.data.session && r.data.session.user &&
              r.data.session.user.id) || null;
        return sb.rpc('is_shop_owner');
      }, function () { return null; }).then(function (r) {
        iAmOwner = !!(r && !r.error && r.data === true);
        bar.style.display = iAmOwner ? '' : 'none';
        rbar.style.display = iAmOwner ? '' : 'none';
        return loadRoles();
      }, function () { return loadRoles(); }).then(loadUsers);
    }
  });
})();
