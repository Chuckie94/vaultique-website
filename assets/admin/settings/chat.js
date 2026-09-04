/* =====================================================================
   Vaultique Boutique Point - Admin > Settings > Live Chat
   ---------------------------------------------------------------------
   Everything about the chat window that is the shop's decision rather
   than the code's, and the people who answer it.

   WHAT IS HERE AND WHAT IS NOT. Every setting on this page is read by
   something. The wording is read by the customer's window, the switches
   by the window or the answering page, the hours by both. Nothing here
   is a preference the site quietly ignores, and things that looked like
   settings but are really mechanisms — how often the window asks for new
   messages, how long a browser waits before it calls somebody away —
   stayed in the code where they can be reasoned about.

   THE PEOPLE. Below the form is the list of chat logins, which is not a
   settings field because no settings field can create an account. Adding
   one goes to a Netlify function holding the service role key; see
   netlify/functions/chat-staff.js for why it has to.

   Only the shop's owner sees that half. An administrator who is not the
   owner sees the settings and not the staff, which is the same line
   phase 5 drew around deleting a conversation.
   ===================================================================== */
(function () {
  'use strict';
  if (!window.VBP_ADMIN) return;

  var A = window.VBP_ADMIN;

  /* The wording the customer's window falls back to when the shop has
     not written its own. Kept identical to the strings in chat.js and
     index.html: a default that disagrees with the built-in one would
     change the site the first time this section was saved, which is not
     what saving a form nobody edited should do. */
  var DEFAULTS = {
    enabled: true,
    title: 'Chat with us',
    hereText: 'Someone is here now',
    awayText: 'Leave a message — we will reply as soon as we are back',
    intro: 'Ask us anything — sizes, fit, colours, delivery, or a piece you ' +
           'cannot find. A member of the team will reply here.',
    placeholder: 'Write a message',

    askName: true,
    askNameText: 'Who are we speaking to?',

    useHours: false,
    hours: null,
    hideOutsideHours: false,
    outsideHoursText: 'We are closed just now — leave a message and we will reply when we open',

    sendProducts: true,
    sendOrders: true,
    sendPhotos: true,
    waHandover: true,

    /* Notifications. All on, because a shop that has not opened this
       page still wants to know a customer is waiting — which is the
       whole point of the feature. pushPreview is read by the Netlify
       function that sends them, pushAll by the same, and the two desk
       settings by Live Chats itself. */
    pushPreview: true,
    pushAll: true,
    deskSound: true,
    deskVolume: 4,

    rememberHours: 4,
    canned: null
  };

  /* The store hands these back for anything the shop has not saved, and
     the storefront applies the same set of its own — see chat.js. */
  A.store.registerDefaults('chat', DEFAULTS);

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  A.registerSetting({
    key: 'chat',
    title: 'Live Chat',
    summary: 'The chat window on the website, and the people who answer it.',

    render: function (host, ctx) {
      ctx.ui.form(host, {
        key: 'chat',
        savedMessage: 'Saved ✓ — the website picks this up within about a minute',

        groups: [
          {
            title: 'The chat window',
            note: 'Turning this off takes the button off the website entirely. ' +
                  'Conversations already had are kept and still readable in Live Chats.',
            fields: [
              { type: 'toggle', name: 'enabled', label: 'Offer live chat on the website' },
              { type: 'text', name: 'title', label: 'What the window is called',
                maxLength: 40, showIf: on('enabled'),
                hint: 'Across the top of the chat window.' },
              { type: 'textarea', name: 'intro', label: 'What it says before anybody has written',
                maxLength: 300, rows: 3, showIf: on('enabled') },
              { type: 'text', name: 'placeholder', label: 'The grey words in the message box',
                maxLength: 60, showIf: on('enabled') }
            ]
          },
          {
            title: 'Whether anybody is there',
            note: 'The line under the title changes on its own, depending on whether ' +
                  'somebody has the Live Chats page open and is not marked away. ' +
                  'These are the two things it says.',
            fields: [
              { type: 'text', name: 'hereText', label: 'When somebody is at the desk',
                maxLength: 80, showIf: on('enabled') },
              { type: 'text', name: 'awayText', label: 'When nobody is',
                maxLength: 120, showIf: on('enabled'),
                hint: 'Say what happens next. A customer who knows their message will be ' +
                      'read later is far more likely to leave one.' }
            ]
          },
          {
            title: 'Asking who they are',
            note: 'Offered, never demanded: a customer who would rather just ask their ' +
                  'question still gets an answer, and the box goes away once they have ' +
                  'said or declined.',
            fields: [
              { type: 'toggle', name: 'askName', label: 'Ask for a name after the first message',
                showIf: on('enabled') },
              { type: 'text', name: 'askNameText', label: 'How to ask', maxLength: 60,
                showIf: function (v) { return !!v.enabled && !!v.askName; } }
            ]
          },
          {
            title: 'Hours',
            note: 'Separate from the shop\'s trading hours in Settings > General, because ' +
                  'the hours somebody is at a keyboard are rarely the hours the doors are ' +
                  'open. Leave this off and the window is offered around the clock.',
            fields: [
              { type: 'toggle', name: 'useHours', label: 'Only offer chat at set times',
                showIf: on('enabled') },
              { type: 'hours', name: 'hours', label: 'When chat is offered',
                showIf: function (v) { return !!v.enabled && !!v.useHours; } },
              { type: 'toggle', name: 'hideOutsideHours',
                label: 'Hide the button outside those hours',
                hint: 'Off is usually better: a message left overnight is a customer who ' +
                      'came back. On is for a shop that would rather not be asked.',
                showIf: function (v) { return !!v.enabled && !!v.useHours; } },
              { type: 'text', name: 'outsideHoursText', label: 'What it says outside them',
                maxLength: 120,
                showIf: function (v) { return !!v.enabled && !!v.useHours && !v.hideOutsideHours; } }
            ]
          },
          {
            title: 'What the shop can send',
            note: 'The buttons above the reply box in Live Chats. Turning one off takes ' +
                  'the button away; it does not remove anything already sent.',
            fields: [
              { type: 'toggle', name: 'sendProducts', label: 'Send a piece', showIf: on('enabled'),
                hint: 'A card with the name, the price and a link to the piece.' },
              { type: 'toggle', name: 'sendOrders', label: 'Send an order', showIf: on('enabled'),
                hint: 'Where one of their orders has got to.' },
              { type: 'toggle', name: 'sendPhotos', label: 'Send a photo', showIf: on('enabled') },
              { type: 'toggle', name: 'waHandover', label: 'Offer WhatsApp as a way out',
                showIf: on('enabled'),
                hint: 'A link at the foot of the conversation carrying what was said, so ' +
                      'the customer can carry on there without starting again.' }
            ]
          },
          {
            title: 'How long a browser remembers',
            note: 'A customer who comes back the same afternoon finds their conversation ' +
                  'where they left it. A browser is not a person, though — a shop tablet or ' +
                  'a shared computer would otherwise hand one customer\'s conversation to ' +
                  'the next person to open the site.',
            fields: [
              { type: 'number', name: 'rememberHours', label: 'Hours', min: 1, max: 72,
                showIf: on('enabled'),
                hint: 'After this, the browser forgets and the next visitor gets a clean ' +
                      'window. A conversation you have ended is forgotten straight away, ' +
                      'whatever this says.' }
            ]
          },
          {
            title: 'Being told a customer is waiting',
            note: 'Each person turns their own phone on, in Live Chats — the button ' +
                  'marked “Notify me here”, pressed on the device that should buzz. ' +
                  'A browser only lets the shop ask once, so it is asked when somebody ' +
                  'presses it rather than the moment the page opens. These settings ' +
                  'decide what those notifications say, and what happens at the desk.',
            fields: [
              { type: 'toggle', name: 'pushPreview',
                label: 'Show what the customer wrote',
                showIf: on('enabled'),
                hint: 'On, the notification carries the message itself. Off, it says only ' +
                      'who wrote. Turn it off if the shop phone is ever handed round, or ' +
                      'left face up on a counter — a notification shows on a locked screen.' },
              { type: 'toggle', name: 'pushAll',
                label: 'Tell everybody about a conversation nobody has taken',
                showIf: on('enabled'),
                hint: 'On, an unanswered conversation buzzes every phone until somebody ' +
                      'takes it. Off, only the shop owner is told. Once somebody has ' +
                      'taken a conversation, only they are told about it either way.' },
              { type: 'toggle', name: 'deskSound',
                label: 'A sound at the desk',
                showIf: on('enabled'),
                hint: 'For somebody with the panel open in another tab. It plays only ' +
                      'when the tab is in the background — nobody needs a chime for a ' +
                      'message they are looking at.' },
              { type: 'number', name: 'deskVolume', label: 'How loud, out of 10',
                min: 1, max: 10,
                showIf: function (v) { return !!v.enabled && v.deskSound !== false; } }
            ]
          },
          {
            title: 'Saved answers',
            note: 'The things you find yourself typing. They appear in a dropdown above ' +
                  'the reply box, and putting one in the box does not send it — it is a ' +
                  'starting point you can change first.',
            fields: [
              { type: 'list', name: 'canned', label: 'Answers',
                addLabel: 'Add an answer', max: 30,
                summary: function (row) { return row.title || 'New answer'; },
                fields: [
                  { type: 'text', name: 'title', label: 'What to call it', maxLength: 60,
                    required: true },
                  { type: 'textarea', name: 'body', label: 'The answer', maxLength: 1000,
                    rows: 3, required: true }
                ] }
            ]
          }
        ],

        validate: function (values, fail) {
          if (values.enabled && values.useHours) {
            var h = values.hours || {};
            var any = Object.keys(h).some(function (k) { return h[k] && h[k].open; });
            if (!any) {
              fail('hours', 'Chat is set to open at certain times and no times are set, ' +
                            'so it would never be offered. Set at least one day, or turn ' +
                            'the hours off.');
            }
          }
        }
      });

      staffPanel(host, ctx);
    }
  });

  function on(name) {
    return function (v) { return !!v[name]; };
  }

  /* =====================================================================
     The people who answer
     ---------------------------------------------------------------------
     Not a settings field, because a settings field cannot make a login.
     This half talks to two places: the database, for the list and for
     switching somebody off, and a Netlify function for the three things
     that need the service role key.
     ===================================================================== */
  function staffPanel(host, ctx) {
    var sb = (ctx && ctx.sb) || A.sb;
    var ask = (ctx && ctx.ask) || A.ask;
    var tell = (ctx && ctx.tell) || A.tell;

    var card = el('div', 'card set-staff');
    card.style.marginTop = '18px';
    card.appendChild(el('h3', null, 'Chat agents'));
    var lead = el('p', 'hint',
      'Somebody hired to answer customers, and nothing else. They sign in at a page ' +
      'of their own — /agent.html — which shows the conversations and has no other ' +
      'tabs at all. They cannot reach products, orders, payments or these settings, ' +
      'and that is refused by the database rather than merely hidden. You give them ' +
      'a temporary password; the site makes them choose their own before they can ' +
      'answer anything.');
    card.appendChild(lead);
    var where = el('p', 'hint');
    where.appendChild(document.createTextNode('Their sign-in page: '));
    var link = document.createElement('a');
    link.href = '/agent.html';
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = '/agent.html';
    where.appendChild(link);
    where.appendChild(document.createTextNode(
      ' — send them that address, not this one. Somebody who should run the whole ' +
      'shop is an administrator instead: Settings > Security.'));
    card.appendChild(where);

    var msg = el('div', 'msg');
    var listHost = el('div', 'staff-list');
    listHost.appendChild(el('p', 'count', 'Reading…'));

    var addBtn = el('button', 'btn btn-out btn-sm', 'Add somebody');
    addBtn.type = 'button';
    var bar = el('div', 'row');
    bar.style.marginTop = '14px';
    bar.appendChild(addBtn);

    card.appendChild(listHost);
    card.appendChild(bar);
    card.appendChild(msg);
    host.appendChild(card);

    function say(text, kind) {
      msg.textContent = text || '';
      msg.className = 'msg' + (kind ? ' ' + kind : '');
    }

    /* The owner's token, sent to the function so it can ask the database
       who is calling rather than taking this page's word for it. */
    function token() {
      return Promise.resolve(sb.auth.getSession()).then(function (r) {
        return (r && r.data && r.data.session && r.data.session.access_token) || '';
      }, function () { return ''; });
    }

    function callFunction(payload) {
      return token().then(function (t) {
        return fetch('/.netlify/functions/chat-staff', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
          body: JSON.stringify(payload)
        });
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          if (!res.ok) {
            var e = new Error(body.error || ('That did not work (' + res.status + ').'));
            e.fix = body.fix;
            /* 404 means the function is not deployed at all, which reads
               to a browser exactly like a page that does not exist. */
            if (res.status === 404) {
              e.message = 'This site does not have the chat-logins function deployed yet. ' +
                          'Upload the latest files, including netlify/functions/chat-staff.js, ' +
                          'and let Netlify finish building.';
            }
            throw e;
          }
          return body;
        });
      });
    }

    function draw(rows) {
      listHost.innerHTML = '';
      if (!rows.length) {
        listHost.appendChild(el('p', 'count',
          'Nobody yet. You answer chats yourself until you add somebody.'));
        return;
      }
      rows.forEach(function (s) {
        var row = el('div', 'staff-row');

        var who = el('div', 'staff-who');
        who.appendChild(el('div', 'staff-name', s.display_name || s.email || 'Unnamed'));
        var bits = [];
        if (s.display_name && s.email) bits.push(s.email);
        bits.push(s.active ? 'can answer' : 'switched off');
        if (s.must_change_password) bits.push('has not chosen a password yet');
        bits.push(Number(s.replies || 0) + (Number(s.replies) === 1 ? ' reply' : ' replies'));
        who.appendChild(el('div', 'hint', bits.join(' · ')));
        row.appendChild(who);

        var acts = el('div', 'staff-acts');

        var onOff = el('button', 'btn btn-out btn-sm', s.active ? 'Switch off' : 'Switch on');
        onOff.type = 'button';
        onOff.addEventListener('click', function () { setActive(s, !s.active); });
        acts.appendChild(onOff);

        var reset = el('button', 'btn btn-out btn-sm', 'New password');
        reset.type = 'button';
        reset.addEventListener('click', function () { resetOne(s); });
        acts.appendChild(reset);

        var del = el('button', 'btn btn-out btn-sm lc-del', 'Remove');
        del.type = 'button';
        del.addEventListener('click', function () { removeOne(s); });
        acts.appendChild(del);

        row.appendChild(acts);
        listHost.appendChild(row);
      });
    }

    function load() {
      return Promise.resolve(sb.rpc('chat_staff_list')).then(function (r) {
        if (r && r.error) throw r.error;
        draw((r && r.data) || []);
      }, function (e) {
        listHost.innerHTML = '';
        var why = (e && e.message) || String(e);
        listHost.appendChild(el('p', 'count',
          /owner/i.test(why)
            ? 'Only the shop owner can see who answers chats.'
            : /does not exist|schema cache/i.test(why)
              ? 'This has not been set up in the database yet. Run ' +
                'supabase-chat-phase6.sql once and reopen this page.'
              : 'The list could not be read: ' + why));
        bar.style.display = 'none';
      });
    }

    function setActive(s, active) {
      say(active ? 'Switching on…' : 'Switching off…', 'busy');
      Promise.resolve(sb.rpc('chat_staff_set_active', { p_id: s.id, p_active: active }))
        .then(function (r) {
          if (r && r.error) throw r.error;
          say(active ? (s.display_name || s.email) + ' can answer chats again.'
                     : (s.display_name || s.email) + ' can no longer answer chats.', 'ok');
          return load();
        })
        .catch(function (e) { say('That did not work: ' + ((e && e.message) || e), 'err'); });
    }

    /* Shown once, and only once: the site never stores it and cannot show
       it again. Said plainly, so nobody closes the box expecting to find
       it later. */
    function showPassword(who, password, isNew) {
      return ask('', {
        title: isNew ? 'Account made' : 'New password set',
        okText: 'Done', cancelText: 'Close',
        note: 'Give ' + who + ' this password. They will be asked to choose their own ' +
              'the first time they sign in. It is not stored anywhere and cannot be ' +
              'shown again — if it is lost, set another one.',
        copyText: password
      });
    }

    function addOne() {
      var wrap = el('div');
      say('');
      ask('', {
        title: 'Add somebody who answers chats',
        okText: 'Create the login',
        note: 'They sign in at /agent.html with the email you give here.',
        fields: null,
        input: { label: 'Their email address', placeholder: 'name@example.com' }
      }).then(function (email) {
        if (!email) return;
        email = String(email).trim();
        return ask('', {
          title: 'What should colleagues call them?',
          okText: 'Create the login',
          note: 'Shown on the presence bar and beside their replies. You can leave ' +
                'this blank and let them set it themselves.',
          input: { label: 'Name', placeholder: 'e.g. Bwalya' }
        }).then(function (name) {
          if (name === null || name === false) return;
          say('Creating the login…', 'busy');
          return callFunction({ action: 'create', email: email, name: String(name || '') })
            .then(function (made) {
              say('');
              return showPassword(made.name || made.email, made.password, true).then(load);
            });
        });
      }).catch(function (e) {
        say((e && e.message) || String(e), 'err');
        if (e && e.fix) say(((e && e.message) || '') + ' ' + e.fix, 'err');
      });
      return wrap;
    }
    addBtn.addEventListener('click', addOne);

    function resetOne(s) {
      ask('Set a new temporary password for ' + (s.display_name || s.email) + '?', {
        title: 'New password',
        okText: 'Set one',
        note: 'Their current password stops working straight away, and they will be ' +
              'asked to choose a new one when they next sign in.'
      }).then(function (yes) {
        if (!yes) return;
        say('Setting a new password…', 'busy');
        return callFunction({ action: 'reset', id: s.id }).then(function (done) {
          say('');
          return showPassword(s.display_name || s.email, done.password, false).then(load);
        });
      }).catch(function (e) { say((e && e.message) || String(e), 'err'); });
    }

    function removeOne(s) {
      ask('Remove ' + (s.display_name || s.email) + '?', {
        title: 'This cannot be undone',
        danger: true, okText: 'Remove them',
        note: 'Their login is deleted and they can no longer sign in. Replies they have ' +
              'already sent stay in the conversations, which is how those conversations ' +
              'still read correctly. If you only want to stop them answering for now, ' +
              'switch them off instead.'
      }).then(function (yes) {
        if (!yes) return;
        say('Removing…', 'busy');
        return callFunction({ action: 'remove', id: s.id }).then(function () {
          say((s.display_name || s.email) + ' has been removed.', 'ok');
          return load();
        });
      }).catch(function (e) { say((e && e.message) || String(e), 'err'); });
    }

    /* Only the owner is shown any of this. The database refuses the list
       to anybody else anyway, but a panel that appears and then says you
       may not use it is worse than one that was never there. */
    Promise.resolve(sb.rpc('is_shop_owner')).then(function (r) {
      if (!r || r.error || r.data !== true) { card.remove(); return; }
      return load();
    }, function () { card.remove(); });
  }
})();
