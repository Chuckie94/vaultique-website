/* =====================================================================
   Vaultique Boutique Point - Admin > Settings > Notifications
   ---------------------------------------------------------------------
   What the shop says to a customer as their order moves along, and the
   email account those messages can be sent from.

   How the messages reach a customer. This shop's whole checkout runs
   through WhatsApp - a customer taps a product, WhatsApp opens with the
   message already written, and the sale happens in that thread. These
   messages follow the same path: changing an order's status in the
   Orders tab offers the matching message, one tap, in the conversation
   the order already came from. The wording is written here; the sending
   happens there, where the order is.

   What is not asked for twice:

     The number itself      Contact & Social owns the WhatsApp numbers
     The order enquiry      Contact & Social owns the message a CUSTOMER
                            sends the shop. These are the ones the SHOP
                            sends the customer, which is the other half
                            of the same conversation.
     Password reset mail    Supabase sends those, using its own settings
     Verification mail      likewise
     Password rules         Customer Accounts owns them

   The brief listed the six order events twice, once under WhatsApp and
   once under customer notifications. They are one set of six: each has
   one switch and one message, rather than two switches that can
   disagree about whether the customer hears anything.
   ===================================================================== */
(function () {
  'use strict';
  if (!window.VBP_ADMIN) return;

  var A = window.VBP_ADMIN;
  var N = window.VBP_NOTIFY || {};

  /* The SMTP password is the one thing here that must never reach a
     customer's browser, so it lives in the table with no public read
     rule - the same place the bank details are kept. Everything else on
     this page is ordinary shop wording. */
  var PRIVATE_KEY = 'notifications';

  var DEFAULTS = {
    emailEnabled: false,
    senderName: '',
    senderEmail: '',
    replyTo: '',
    smtpHost: '',
    smtpPort: 587,
    smtpUser: '',
    encryption: 'starttls',
    signature: '',

    whatsappEnabled: true,

    onPending: true,     msgPending: '',
    onConfirmed: true,   msgConfirmed: '',
    onReady: true,       msgReady: '',
    onDispatched: true,  msgDispatched: '',
    onDelivered: true,   msgDelivered: '',
    onCancelled: true,   msgCancelled: ''
  };

  A.store.registerDefaults('notifications', DEFAULTS);

  var ENCRYPTION = [
    { value: 'starttls', label: 'STARTTLS — usually port 587' },
    { value: 'tls',      label: 'SSL/TLS — usually port 465' },
    { value: 'none',     label: 'None — only on a server you run yourself' }
  ];

  /* One order, invented, for previewing the wording against. */
  var SAMPLE = {
    name: 'Chanda Mwansa',
    ref: 'VB-3F9K',
    total: 1680,
    fulfilment: 'delivery',
    order_items: [
      { name: 'Silk scarf, ivory', qty: 2, price: 420 },
      { name: 'Leather clutch', qty: 1, price: 840 }
    ]
  };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function cap(s) { return String(s).charAt(0).toUpperCase() + String(s).slice(1); }

  function errText(e) {
    if (!e) return 'no reason given';
    return e.message || e.error_description || String(e);
  }

  /* A field for each of the six events: whether to offer a message at
     all, and what it says. Built rather than written out six times, so
     a seventh status would be one line in notify.js and nothing here. */
  function eventFields() {
    var out = [];
    N.FLOW.forEach(function (status) {
      var Name = cap(status);
      out.push({
        type: 'toggle', name: 'on' + Name,
        label: N.CHOICES[status] || Name,
        hint: status === 'pending'
          ? 'Offered the moment an order arrives, before you have confirmed anything.'
          : undefined
      });
      out.push({
        type: 'textarea', name: 'msg' + Name, label: 'What it says',
        rows: 5, maxLength: 900,
        placeholder: N.STARTER[status],
        showIf: (function (n) { return function (v) { return !!v[n]; }; })('on' + Name),
        hint: 'Leave empty to use the wording shown in grey.'
      });
    });
    return out;
  }

  A.registerSetting({
    key: 'notifications',
    title: 'Notifications',
    summary: 'What you say to a customer as their order moves along, and the email account behind it.',
    render: function (host, ctx) {
      var tell = ctx.tell || A.tell;
      var general = {};
      var pricing = {};

      var controller = ctx.ui.form(host, {
        key: 'notifications',
        privateKey: PRIVATE_KEY,
        savedMessage: 'Saved ✓',

        groups: [
          {
            title: 'Messages to your customer',
            note: 'Each of these is offered in the Orders tab when you set an order to ' +
                  'that status. You send it with one tap, in the same WhatsApp ' +
                  'conversation the order came from.',
            fields: [
              { type: 'toggle', name: 'whatsappEnabled', label: 'Offer these messages',
                hint: 'Turn off to change order statuses without being offered anything to send.' },
              { type: 'note', label: 'Writing the messages',
                text: 'You can use {name} for the customer’s first name, {ref} for the ' +
                      'order reference, {items} for the list of items, {total} for the total, ' +
                      '{business} for your shop name, and {fulfilment} for delivery or ' +
                      'collection. Anything you leave empty uses the wording underneath it.' }
            ].concat(eventFields())
          },
          {
            title: 'Sending email',
            note: 'An email account the shop can send from. Your host or email provider ' +
                  'gives you these five details.',
            fields: [
              { type: 'toggle', name: 'emailEnabled', label: 'Email is set up' },
              { type: 'text', name: 'senderName', label: 'Sender name', half: true,
                maxLength: 80, placeholder: 'Vaultique Boutique Point',
                showIf: function (v) { return !!v.emailEnabled; } },
              { type: 'text', name: 'senderEmail', label: 'Sender email', half: true,
                maxLength: 160, placeholder: 'orders@yourshop.com',
                showIf: function (v) { return !!v.emailEnabled; } },
              { type: 'text', name: 'replyTo', label: 'Reply-to email', maxLength: 160,
                placeholder: 'Only if replies should go somewhere else',
                showIf: function (v) { return !!v.emailEnabled; } },
              { type: 'text', name: 'smtpHost', label: 'SMTP host', half: true,
                maxLength: 160, placeholder: 'smtp.yourhost.com',
                showIf: function (v) { return !!v.emailEnabled; } },
              { type: 'number', name: 'smtpPort', label: 'SMTP port', half: true,
                min: 1, max: 65535,
                showIf: function (v) { return !!v.emailEnabled; } },
              { type: 'select', name: 'encryption', label: 'Encryption', options: ENCRYPTION,
                showIf: function (v) { return !!v.emailEnabled; } },
              { type: 'text', name: 'smtpUser', label: 'SMTP username', half: true,
                maxLength: 160, placeholder: 'Often the same as the sender email',
                showIf: function (v) { return !!v.emailEnabled; } },
              { type: 'text', name: 'smtpPassword', label: 'SMTP password', half: true,
                private: true, secret: true, maxLength: 200,
                showIf: function (v) { return !!v.emailEnabled; },
                hint: 'Kept where customers cannot reach it, with your bank details.' },
              { type: 'textarea', name: 'signature', label: 'Email signature', rows: 4,
                maxLength: 400, placeholder: 'Vaultique Boutique Point\nManda Hill, Lusaka',
                showIf: function (v) { return !!v.emailEnabled; } }
            ]
          }
        ],

        validate: function (v, problem) {
          if (!v.emailEnabled) return;
          var mail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!v.senderEmail) problem('senderEmail', 'An email cannot be sent without a sender.');
          else if (!mail.test(String(v.senderEmail).trim())) problem('senderEmail', 'That is not an email address.');
          if (v.replyTo && !mail.test(String(v.replyTo).trim())) problem('replyTo', 'That is not an email address.');
          if (!v.smtpHost) problem('smtpHost', 'Your provider gives you this.');
          var port = Number(v.smtpPort);
          if (!port || port < 1 || port > 65535) problem('smtpPort', 'Usually 587, or 465 for SSL/TLS.');
        },

        afterLoad: function (values, form) {
          buildExtras(values, form);
        }
      });

      /* ---- the parts the form kit does not draw --------------------- */

      function money(v) {
        var F = window.VBP_FORMAT || {};
        if (!F.money) return String(v == null ? '' : v);
        return F.money(v, F.moneyStyle ? F.moneyStyle(general, pricing) : (general.currency || 'ZMW'));
      }

      function buildExtras(values, form) {
        /* --- preview, under the message group ----------------------- */
        var previewCard = el('div', 'card');
        previewCard.appendChild(el('h3', null, 'How it will read'));
        previewCard.appendChild(el('p', 'grp-note',
          'The same code that sends the real message, against an invented order. ' +
          'Change a message above and this follows it.'));

        var pick = el('select', 'note-pick');
        N.FLOW.forEach(function (status) {
          var op = document.createElement('option');
          op.value = status;
          op.textContent = N.CHOICES[status] || status;
          pick.appendChild(op);
        });
        pick.value = 'confirmed';
        previewCard.appendChild(pick);

        var bubble = el('pre', 'wa-preview');
        previewCard.appendChild(bubble);
        host.appendChild(previewCard);

        function drawPreview() {
          var live = form && form.values ? form.values() : values;
          bubble.textContent = N.messageFor(pick.value, SAMPLE, live, {
            business: general.businessName || 'Vaultique Boutique Point',
            money: money
          });
        }
        pick.addEventListener('change', drawPreview);
        host.addEventListener('input', drawPreview);
        host.addEventListener('change', drawPreview);
        drawPreview();

        /* --- the test email ---------------------------------------- */
        var testCard = el('div', 'card');
        testCard.appendChild(el('h3', null, 'Send a test email'));
        testCard.appendChild(el('p', 'grp-note',
          'Sends one real email using the details above, so you can see whether they ' +
          'work rather than hoping. Save your changes first.'));

        var toWrap = el('div', 'field');
        var toLab = el('label', null, 'Send it to');
        toLab.setAttribute('for', 'notif_test_to');
        var toBox = document.createElement('input');
        toBox.type = 'email';
        toBox.id = 'notif_test_to';
        toBox.placeholder = 'your own address';
        toWrap.appendChild(toLab);
        toWrap.appendChild(toBox);
        testCard.appendChild(toWrap);

        var testMsg = el('p', 'sec-msg');
        testCard.appendChild(testMsg);

        var testRow = el('div', 'row');
        var testBtn = el('button', 'btn btn-out btn-sm', 'Send test email');
        testBtn.type = 'button';
        testRow.appendChild(testBtn);
        testCard.appendChild(testRow);
        host.appendChild(testCard);

        testBtn.addEventListener('click', function () {
          var to = String(toBox.value || '').trim();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
            testMsg.textContent = 'Enter the address to send the test to.';
            testMsg.className = 'sec-msg err';
            return;
          }
          testBtn.disabled = true;
          testMsg.textContent = 'Sending…';
          testMsg.className = 'sec-msg';

          /* Read back what is stored rather than what is on screen: a
             test that passes on unsaved details would prove nothing
             about the shop that is actually running. */
          Promise.all([
            A.store.load('notifications'),
            A.store.loadPrivate(PRIVATE_KEY),
            ctx.sb.auth.getSession()
          ]).then(function (r) {
            var saved = r[0] || {}, shut = r[1] || {};
            var session = r[2] && r[2].data && r[2].data.session;
            if (!session) throw new Error('You are not signed in.');

            return fetch('/.netlify/functions/send-email', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + session.access_token
              },
              body: JSON.stringify({
                smtpHost: saved.smtpHost, smtpPort: saved.smtpPort,
                encryption: saved.encryption,
                smtpUser: saved.smtpUser, smtpPassword: shut.smtpPassword,
                senderName: saved.senderName, senderEmail: saved.senderEmail,
                replyTo: saved.replyTo,
                to: to,
                subject: 'Test message from ' + (general.businessName || 'your website'),
                text: 'This is a test from your website admin.\n\n' +
                      'If you are reading it, your email settings work.\n\n' +
                      (saved.signature || '')
              })
            });
          }).then(function (res) {
            return res.json().catch(function () {
              throw new Error('The mail sender did not answer properly.');
            });
          }).then(function (out) {
            testBtn.disabled = false;
            if (out.sent) {
              testMsg.textContent = 'Sent. Check ' + to + ', including the junk folder.';
              testMsg.className = 'sec-msg ok';
              return;
            }
            testMsg.textContent = out.error || 'It did not send.';
            testMsg.className = 'sec-msg err';
          }).catch(function (e) {
            testBtn.disabled = false;
            /* The function only exists on the deployed site, so opening
               admin.html straight off a disk cannot reach it. Say that
               rather than showing a bare network error. */
            testMsg.textContent = errText(e) +
              ' If you are not on your live website address, the sender is not there to answer.';
            testMsg.className = 'sec-msg err';
          });
        });
      }

      /* The shop's own name and money, for the preview. */
      Promise.all([
        A.store.load('general').catch(function () { return {}; }),
        A.store.load('pricing').catch(function () { return {}; })
      ]).then(function (r) {
        general = r[0] || {};
        pricing = r[1] || {};
      });
    }
  });
})();
