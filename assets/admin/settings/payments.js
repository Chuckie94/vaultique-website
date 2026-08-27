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
          if (values.mobileEnabled && (!values.mobileAccounts || !values.mobileAccounts.length)) {
            fail('mobileAccounts', 'Mobile money is on but there are no accounts. Add one, ' +
                                   'or turn the method off.');
          }
        }
      });

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
