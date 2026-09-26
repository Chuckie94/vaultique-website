/* =====================================================================
   Vaultique Boutique Point - Admin > Settings > Payments
   ---------------------------------------------------------------------
   Which ways of paying the shop accepts, what each is called, what
   customers are told about it, and the account details behind it.

   The methods, and why they are these methods
   -------------------------------------------
   Airtel Money and MTN Money are both mobile money, so they are not
   separate payment methods here: Mobile Money is one method holding as
   many accounts as the shop has, each with its provider, number and
   account name. Adding Zamtel Kwacha later is adding a row.

   Cash and Payment on Delivery overlap but are not the same. Cash is
   paying in person at the shop. Payment on delivery is paying whoever
   brings the order. A shop may accept one and not the other.

   What is public and what is not
   ------------------------------
   The website reads its settings with the anon key, so everything in the
   ordinary settings table can be read by anyone. Which methods are
   accepted, what they are called and the instructions customers see are
   all meant to be public and live there.

   Account numbers do not. Bank details and mobile money numbers are kept
   in site_settings_private, which has no public read policy at all, so
   they never reach a customer's browser. They are marked private below
   and the form saves them to the other table on their own.

   Because instructions are public, the section checks them for anything
   that looks like an account number and says so, since that would put
   back exactly what the private table is for.
   ===================================================================== */
(function () {
  'use strict';
  if (!window.VBP_ADMIN) return;

  var A = window.VBP_ADMIN;

  var PROVIDERS = [
    { value: 'Airtel Money', label: 'Airtel Money' },
    { value: 'MTN Money',    label: 'MTN Money' },
    { value: 'Zamtel Kwacha', label: 'Zamtel Kwacha' },
    { value: 'Other',        label: 'Other' }
  ];

  var DEFAULTS = {
    cashEnabled: true,
    cashName: 'Cash',
    cashInstructions: 'Pay in person when you collect.',

    bankEnabled: true,
    bankName: 'Bank Transfer',
    bankInstructions: 'Transfer before dispatch. We will send the account details on WhatsApp.',

    mobileEnabled: true,
    mobileName: 'Mobile Money',
    mobileInstructions: 'Send to our mobile money account. We will confirm the number on WhatsApp.',

    cardEnabled: false,
    cardName: 'Card Payment',
    cardInstructions: 'Card payment can be arranged in person at the shop.',

    // Online payment through Flutterwave. Off until the shop is ready.
    onlineEnabled: false,
    onlineMode: 'test',
    onlineCard: true,
    onlineMobile: true,
    onlineLabel: '',
    onlineConfirmEmail: true,
    onlineNotifyShop: true,

    codEnabled: false,
    codName: 'Payment on Delivery',
    codInstructions: 'Pay the courier when your order arrives.',

    // kept out of the website's reach
    bankAccountBank: '',
    bankAccountName: '',
    bankAccountNumber: '',
    bankBranch: '',
    bankBranchCode: '',
    mobileAccounts: []
  };

  var PRIVATE = ['bankAccountBank', 'bankAccountName', 'bankAccountNumber',
                 'bankBranch', 'bankBranchCode', 'mobileAccounts'];

  A.store.registerDefaults('payments', DEFAULTS);

  /* Instructions are shown on the website. A run of digits long enough to
     be an account number almost certainly should not be. */
  function noAccountNumbers(v) {
    if (!v) return '';
    var run = String(v).replace(/[\s-]/g, '');
    return /\d{7,}/.test(run)
      ? 'That looks like an account number. Those belong in the private details ' +
        'further down, which the website never sees. Anything written here is public.'
      : '';
  }

  function method(prefix, label, note) {
    return [
      { type: 'toggle', name: prefix + 'Enabled', label: 'Accept ' + label.toLowerCase(),
        hint: note },
      { type: 'text', name: prefix + 'Name', label: 'Shown to customers as', half: true,
        maxLength: 40, showIf: on(prefix),
        validate: function (v, all) {
          return (all[prefix + 'Enabled'] && !v) ? 'Give this method a name.' : '';
        } },
      { type: 'text', name: prefix + 'Instructions', label: 'What customers are told',
        maxLength: 200, showIf: on(prefix), validate: noAccountNumbers,
        hint: 'Public. Keep account numbers out of it.' }
    ];
  }
  function on(prefix) {
    return function (v) { return !!v[prefix + 'Enabled']; };
  }

  A.registerSetting({
    key: 'payments',
    title: 'Payments',
    summary: 'Accepted payment methods and the payment instructions customers see.',
    render: function (host, ctx) {
      ctx.ui.form(host, {
        key: 'payments',
        privateKey: 'payments',
        savedMessage: 'Saved ✓ — the site picks this up within about a minute',

        groups: [
          {
            title: 'Online payment',
            note: 'Card and mobile money, paid on Flutterwave\u2019s secure page. A second button ' +
                  'appears under "Continue on WhatsApp" at checkout; WhatsApp ordering stays ' +
                  'exactly as it is.',
            fields: [
              { type: 'toggle', name: 'onlineEnabled', label: 'Take payments online',
                hint: 'Off: the button disappears straight away, and the server refuses ' +
                      'new payments. A payment already under way still completes.' },
              { type: 'select', name: 'onlineMode', label: 'Mode', half: true,
                showIf: function (v) { return !!v.onlineEnabled; },
                options: [
                  { value: 'test', label: 'Test \u2014 practise, no real money moves' },
                  { value: 'live', label: 'Live \u2014 real payments' }
                ] },
              { type: 'text', name: 'onlineLabel', label: 'Button wording', half: true,
                maxLength: 50, placeholder: 'Pay now \u2014 card or mobile money',
                showIf: function (v) { return !!v.onlineEnabled; } },
              { type: 'toggle', name: 'onlineCard', label: 'Accept cards', half: true,
                showIf: function (v) { return !!v.onlineEnabled; } },
              { type: 'toggle', name: 'onlineMobile', label: 'Accept mobile money', half: true,
                hint: 'MTN, Airtel and Zamtel, as Flutterwave supports them.',
                showIf: function (v) { return !!v.onlineEnabled; } },
              { type: 'toggle', name: 'onlineConfirmEmail',
                label: 'Email the customer a confirmation automatically',
                hint: 'Sent the moment a payment is confirmed, from the email account in ' +
                      'Settings > Notifications. Customers paying online always give an email.',
                showIf: function (v) { return !!v.onlineEnabled; } },
              { type: 'toggle', name: 'onlineNotifyShop',
                label: 'Email the shop when a payment arrives',
                hint: 'To the business email in Contact & Social.',
                showIf: function (v) { return !!v.onlineEnabled; } },
              { type: 'note', name: 'onlineLiveNote', tone: 'warn',
                label: 'Live mode takes real money',
                text: 'Make one small test purchase yourself after switching to Live, and ' +
                      'check it arrives in the Orders tab marked Paid.',
                showIf: function (v) { return !!v.onlineEnabled && v.onlineMode === 'live'; } }
            ]
          },
          {
            title: 'Ways to pay',
            note: 'Turn on what you accept. Whatever is on appears in the footer and ' +
                  'under How to pay.',
            fields: [].concat(
              method('cash', 'Cash', 'Paying in person at the shop.'),
              method('bank', 'Bank transfer', 'Account details are set further down and stay private.'),
              method('mobile', 'Mobile money', 'Airtel, MTN and anything else, as one method.'),
              method('card', 'Card payment', 'Only if you have a card machine or a payment link.'),
              method('cod', 'Payment on delivery', 'Paying whoever brings the order, which is not the same as cash at the shop.')
            )
          },
          {
            title: 'Bank details',
            note: 'PRIVATE — kept in a table the website cannot read, and never sent to a ' +
                  'customer’s browser. Send these on WhatsApp when an order is agreed.',
            fields: [
              { type: 'text', name: 'bankAccountBank', label: 'Bank name', half: true,
                maxLength: 80, private: true, showIf: on('bank') },
              { type: 'text', name: 'bankAccountName', label: 'Account name', half: true,
                maxLength: 80, private: true, showIf: on('bank') },
              { type: 'text', name: 'bankAccountNumber', label: 'Account number', half: true,
                maxLength: 40, private: true, showIf: on('bank') },
              { type: 'text', name: 'bankBranch', label: 'Branch', half: true,
                maxLength: 80, private: true, showIf: on('bank') },
              { type: 'text', name: 'bankBranchCode', label: 'Branch code',
                maxLength: 30, private: true, showIf: on('bank') }
            ]
          },
          {
            title: 'Mobile money accounts',
            note: 'PRIVATE — as above. Add one row per account: Airtel and MTN are two rows, ' +
                  'not two payment methods.',
            fields: [
              { type: 'list', name: 'mobileAccounts', label: 'Accounts', private: true,
                addLabel: 'Add an account', itemName: 'Account', max: 6,
                showIf: on('mobile'),
                summary: function (row) {
                  return [row.provider, row.number].filter(Boolean).join(' · ');
                },
                blank: function () { return { provider: 'Airtel Money', number: '', name: '' }; },
                fields: [
                  { type: 'select', name: 'provider', label: 'Provider', half: true,
                    options: PROVIDERS },
                  { type: 'text', name: 'number', label: 'Mobile number', half: true,
                    maxLength: 30, required: true, placeholder: '+260 …',
                    validate: function (v) {
                      if (!v) return '';
                      var d = String(v).replace(/\D/g, '');
                      return (d.length >= 7 && d.length <= 15)
                        ? '' : 'That does not look like a complete number.';
                    } },
                  { type: 'text', name: 'name', label: 'Account name', maxLength: 80,
                    required: true }
                ] }
            ]
          }
        ],

        validate: function (values, fail) {
          var any = ['cash', 'bank', 'mobile', 'card', 'cod']
            .some(function (k) { return values[k + 'Enabled']; });
          if (!any) {
            fail('cashEnabled', 'Accept at least one way of paying, or customers have no way ' +
                                'to complete an order.');
          }
          if (values.onlineEnabled && values.onlineCard === false && values.onlineMobile === false) {
            fail('onlineCard', 'Online payment is on but accepts nothing. Turn on cards, ' +
                               'mobile money, or both.');
          }
          if (values.mobileEnabled && (!values.mobileAccounts || !values.mobileAccounts.length)) {
            fail('mobileAccounts', 'Mobile money is on but there are no accounts. Add one, ' +
                                   'or turn the method off.');
          }
        }
      });

      /* Whether the keys are in place on Netlify. Asked of the server, which
         answers yes or no for each and never shows the keys themselves. */
      (function readiness() {
        var box = null, tries2 = 0;
        (function find() {
          var cards = host.querySelectorAll('.card');
          for (var i = 0; i < cards.length; i++) {
            var h = cards[i].querySelector('h3');
            if (h && h.textContent === 'Online payment') { box = cards[i]; break; }
          }
          if (!box) { if (tries2++ < 60) setTimeout(find, 50); return; }
          var line = document.createElement('div');
          line.className = 'pay-ready';
          line.textContent = 'Checking the payment setup\u2026';
          var h3 = box.querySelector('h3');
          h3.parentNode.insertBefore(line, h3.nextSibling);
          fetch('/.netlify/functions/pay-status?check=1', { cache: 'no-store' })
            .then(function (r) { return r.json(); })
            .then(function (c) {
              var bits = [
                [c.test, 'Flutterwave test key'], [c.live, 'Flutterwave live key'],
                [c.hash, 'Webhook secret hash'], [c.service, 'Supabase service key'],
                [c.formats, 'Price rules']
              ];
              line.innerHTML = '';
              bits.forEach(function (b) {
                var s2 = document.createElement('span');
                s2.className = b[0] ? 'ok' : 'no';
                s2.textContent = (b[0] ? '\u2713 ' : '\u2715 ') + b[1];
                line.appendChild(s2);
              });
              var all = c.hash && c.service && c.formats && (c.test || c.live);
              var note = document.createElement('div');
              note.className = 'pay-ready-note';
              note.textContent = all
                ? 'Ready. The keys live in Netlify and are never shown here.'
                : 'Not ready yet: add the missing items in Netlify > Site configuration > ' +
                  'Environment variables, then redeploy. SETUP.md has the steps.';
              line.appendChild(note);
            })
            .catch(function () {
              line.textContent = 'The payment setup could not be checked from here (the ' +
                                 'Netlify functions may not be deployed yet).';
            });
        })();
      })();

      /* A visible reminder of which half of this page the website can see. */
      var tries = 0;
      (function mark() {
        var cards = host.querySelectorAll('.card');
        if (!cards.length) { if (tries++ < 60) setTimeout(mark, 50); return; }
        Array.prototype.forEach.call(cards, function (c) {
          var h = c.querySelector('h3');
          var note = c.querySelector('.grp-note');
          if (!h || !note || note.textContent.indexOf('PRIVATE') !== 0) return;
          note.classList.add('shut-note');
          var band = document.createElement('div');
          band.className = 'shut';
          var head = document.createElement('div');
          head.className = 'shut-head';
          head.textContent = '● Not sent to the website';
          band.appendChild(head);
          band.appendChild(note.cloneNode(true));
          note.parentNode.replaceChild(band, note);
        });
      })();
    }
  });
})();
