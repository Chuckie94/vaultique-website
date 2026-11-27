/* =====================================================================
   Vaultique Boutique Point - Admin > Settings > Fraud & Risk   BUILD 91
   ---------------------------------------------------------------------
   How the fraud check (netlify/functions/_risk.js) scores and what it
   does. Every field here is private: it is kept in the table the website
   cannot read (site_settings_private, 'risk'), so nobody can look up the
   thresholds from the shop's public pages and stay just under them.

   Watching (decision D5) is the starting point: every order, payment and
   refund is scored and recorded, and nothing is held or refused. Acting
   holds High and refuses Critical. Off asks nothing at all.
   ===================================================================== */
(function () {
  'use strict';
  if (!window.VBP_ADMIN) return;
  var A = window.VBP_ADMIN;

  /* The same defaults as the server's (_risk.js, DEFAULTS). */
  var DEFAULTS = {
    mode: 'watch', medium: 30, high: 60, critical: 90, alertEmail: true, alertTo: '',
    w_ordersPhone: 15, w_ordersEmail: 15, w_ordersClient: 10, w_ordersAccount: 10,
    w_failedPayments: 15, w_paymentRefs: 15, w_addressNew: 15,
    w_emailOdd: 20, w_phoneOdd: 20, w_basketHigh: 20, w_refused: 25,
    w_refundsCustomer: 25, w_refundQuick: 15, w_refundsStaff: 20, w_refundLarge: 15,
    w_staffDeletes: 25, w_staffRoles: 25, w_staffSettings: 20,
    l_ordersPerDay: 3, l_failedPerDay: 3, l_paymentRefs: 3, l_basketTimes: 5, l_basketMinOrders: 20,
    l_refundsPer90: 2, l_refundQuickHours: 2, l_refundsStaffDay: 5,
    l_staffDeletesHour: 10, l_staffRolesHour: 3, l_staffSettingsHour: 15
  };
  /* Only what the form shows before anything is saved; every value is
     saved privately (none goes to the public row). */
  A.store.registerDefaults('risk', { mode: 'watch', alertEmail: true });

  var WEIGHTS = [
    ['w_ordersPhone', 'Several orders from one phone number in a day'],
    ['w_ordersEmail', 'Several orders from one email address in a day'],
    ['w_ordersClient', 'Several orders from one connection in a day'],
    ['w_ordersAccount', 'Several orders from one account in a day'],
    ['w_failedPayments', 'Several failed payments from one phone number in a day'],
    ['w_paymentRefs', 'Several payment attempts on one order'],
    ['w_addressNew', 'A delivery address added just before ordering'],
    ['w_emailOdd', 'An email address that does not look real, or a throwaway one'],
    ['w_phoneOdd', 'A phone number that does not look real'],
    ['w_basketHigh', 'An order far above the shop’s usual'],
    ['w_refused', 'A piece or quantity the shop refused from the same connection'],
    ['w_refundsCustomer', 'Several refunds for one customer'],
    ['w_refundQuick', 'A refund asked for soon after the payment'],
    ['w_refundsStaff', 'Many refunds asked for by one person in a day'],
    ['w_refundLarge', 'A refund far above the shop’s usual order'],
    ['w_staffDeletes', 'The team: many records deleted in an hour'],
    ['w_staffRoles', 'The team: logins or roles changed several times in an hour'],
    ['w_staffSettings', 'The team: many settings changes in an hour']
  ];
  var LIMITS = [
    ['l_ordersPerDay', 'Orders in a day that count as several', 1, 50],
    ['l_failedPerDay', 'Failed payments in a day that count as several', 1, 50],
    ['l_paymentRefs', 'Payment attempts on one order that count as several', 1, 20],
    ['l_basketTimes', 'Times the usual order that counts as far above it', 2, 100],
    ['l_basketMinOrders', 'Orders in 90 days before "the usual" is trusted', 5, 1000],
    ['l_refundsPer90', 'Refunds for one customer in 90 days that count as several', 1, 50],
    ['l_refundQuickHours', 'Hours after the payment that count as soon', 1, 168],
    ['l_refundsStaffDay', 'Refunds by one person in a day that count as many', 1, 100],
    ['l_staffDeletesHour', 'Deletions by one person in an hour that count as many', 1, 500],
    ['l_staffRolesHour', 'Login or role changes in an hour that count as several', 1, 50],
    ['l_staffSettingsHour', 'Settings changes in an hour that count as many', 1, 500]
  ];
  function priv(f) { f.private = true; return f; }

  A.registerSetting({
    key: 'risk',
    title: 'Fraud & Risk',
    summary: 'How the fraud check scores orders, payments and refunds, and whether it only watches or acts.',
    render: function (host, ctx) {
      var acting = function (v) { return v.mode === 'act'; };
      var on = function (v) { return v.mode !== 'off'; };
      ctx.ui.form(host, {
        key: 'risk',
        privateKey: 'risk',
        savedMessage: 'Saved ✓. The check uses it within a minute.',
        beforeSave: function (v) {
          var out = {}, n;
          for (n in v) if (Object.prototype.hasOwnProperty.call(v, n)) out[n] = v[n];
          /* An empty box keeps the default, as the server reads it. */
          for (n in DEFAULTS) if (out[n] === '' || out[n] === undefined) out[n] = DEFAULTS[n];
          return out;
        },
        validate: function (v, fail) {
          var num = function (x, d) { return (x === '' || x === undefined || x === null) ? d : Number(x); };
          var m = num(v.medium, DEFAULTS.medium), h = num(v.high, DEFAULTS.high), c = num(v.critical, DEFAULTS.critical);
          if (!(h > m)) fail('high', 'High must be above Medium.');
          if (!(c > h)) fail('critical', 'Critical must be above High.');
          if (v.alertTo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v.alertTo).trim())) fail('alertTo', 'That is not an email address.');
        },
        groups: [
          {
            title: 'What the check does',
            fields: [
              priv({ type: 'select', name: 'mode', label: 'Mode',
                options: [
                  { value: 'watch', label: 'Watch: score and record everything, hold and refuse nothing' },
                  { value: 'act', label: 'Act: hold High for review, refuse Critical' },
                  { value: 'off', label: 'Off: ask nothing' }
                ],
                hint: 'Your decision (D5): watch for 14 days first. Admin > Fraud & Risk shows what acting would have done ' +
                      'in that time, case by case, so the levels can be judged before they hold anybody’s payment.' }),
              { type: 'note', label: 'Acting', tone: 'warn', showIf: acting,
                text: 'High: a payment is held when it comes in (marked "needs attention", which the till leaves alone, ' +
                      'and the customer is told it is being checked); a refund is not sent; a WhatsApp order is marked. ' +
                      'Critical: a payment is refused before it starts, and nothing is charged; and an email to you. ' +
                      'Nothing is held or refused because the check itself failed.' },
              priv({ type: 'toggle', name: 'alertEmail', label: 'Email me about Critical cases', showIf: on }),
              priv({ type: 'text', name: 'alertTo', label: 'Send those to', maxLength: 160, showIf: on,
                placeholder: 'the shop’s contact email',
                hint: 'Empty: the email address in Contact & Social. Held payments are emailed here too.' })
            ]
          },
          {
            title: 'The levels',
            note: 'Each signal adds points; the total gives the level. With the starting figures no single signal reaches High ' +
                  'on its own, even at twice its limit: it takes two or more.',
            fields: [
              priv({ type: 'number', name: 'medium', label: 'Medium from (points)', min: 1, max: 1000, half: true, placeholder: '30' }),
              priv({ type: 'number', name: 'high', label: 'High from (points)', min: 2, max: 1000, half: true, placeholder: '60' }),
              priv({ type: 'number', name: 'critical', label: 'Critical from (points)', min: 3, max: 2000, placeholder: '90' })
            ]
          },
          {
            title: 'Points for each signal',
            note: 'A count at twice its limit gives twice the points. 0 switches a signal off.',
            fields: WEIGHTS.map(function (w) {
              return priv({ type: 'number', name: w[0], label: w[1], min: 0, max: 500, placeholder: String(DEFAULTS[w[0]]) });
            })
          },
          {
            title: 'What counts as several',
            fields: LIMITS.map(function (l) {
              return priv({ type: 'number', name: l[0], label: l[1], min: l[2], max: l[3], placeholder: String(DEFAULTS[l[0]]) });
            })
          }
        ]
      });
    }
  });
})();
