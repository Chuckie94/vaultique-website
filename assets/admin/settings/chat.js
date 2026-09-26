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

   THE PEOPLE ARE NOT HERE. This page used to carry a second list — chat
   logins, made here, signing in on a page of their own. There is one
   kind of person now: everybody signs in at /admin.html and their role
   decides what they see. They are made and changed in Settings > Users
   & Roles, and this page is the settings alone.
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
    openingText: 'Tell us what you are looking for — we would love to help',
    hereText: 'Someone is here now',
    awayText: 'Leave a message — we will reply as soon as we are back',
    intro: 'Ask us anything — sizes, fit, colours, delivery, or a piece you ' +
           'cannot find. A member of the team will reply here.',
    placeholder: 'Write a message',

    askName: true,
    askNameText: 'Who are we speaking to?',
    jobReply: '',

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
    summary: 'The chat window on the website, and how it behaves.',

    render: function (host, ctx) {
      /* Somebody looking for the people will look here first, because
         this is where they used to be. One line, at the top, rather
         than leaving them to hunt. */
      var moved = document.createElement('p');
      moved.className = 'grp-note';
      moved.style.marginBottom = '14px';
      moved.textContent = 'Who answers the chats is set in Settings > Users & Roles: ' +
                          'create somebody, and tick Live Chats against their role.';
      host.appendChild(moved);

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
            title: 'The line under the title',
            note: 'It says one of three things. Before anybody has written there is ' +
                  'nothing known about the desk, so it shows the first. Once a ' +
                  'conversation is going it changes on its own, depending on whether ' +
                  'somebody has the Live Chats page open and is not marked away.',
            fields: [
              { type: 'text', name: 'openingText', label: 'Before anybody has written',
                maxLength: 120, showIf: on('enabled'),
                hint: 'The first thing a customer reads. This is the greeting — make ' +
                      'it sound like somebody who wants to hear from them.' },
              { type: 'text', name: 'hereText', label: 'When somebody is at the desk',
                maxLength: 80, showIf: on('enabled') },
              { type: 'text', name: 'awayText', label: 'When nobody is',
                maxLength: 120, showIf: on('enabled'),
                hint: 'Say what happens next. A customer who knows their message will be ' +
                      'read later is far more likely to leave one.' }
            ]
          },
          {
            title: 'When somebody asks about a job',
            note: 'People ask a boutique for work, and those are not questions ' +
                  'the desk should have to answer one at a time. A message that ' +
                  'clearly asks about a job is answered straight away, and the ' +
                  'conversation is kept out of the queue — under "Job enquiries" ' +
                  'in Live Chats, never deleted. The customer is never shown a ' +
                  'label; they just get the answer below.',
            fields: [
              { type: 'textarea', name: 'jobReply', label: 'What to say', maxLength: 400,
                showIf: on('enabled'),
                placeholder: 'Thank you for your interest in working with Vaultique ' +
                             'Boutique Point. Job applications and vacancy enquiries ' +
                             'are not handled through Live Chat. Please use our ' +
                             'official recruitment channels for any available ' +
                             'opportunities.',
                hint: 'Leave it empty to say exactly what is written above. Point ' +
                      'people at wherever you actually want applications to go.' }
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
              { type: 'toggle', name: 'sendPhotos', label: 'Send a photo', showIf: on('enabled') }
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
            /* Folded away to begin with. Thirty answers is a long list to
               scroll past every time the shop opens this page to change
               something else. */
            collapsible: true,
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

    }
  });

  function on(name) {
    return function (v) { return !!v[name]; };
  }

})();
