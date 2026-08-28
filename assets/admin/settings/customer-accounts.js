/* =====================================================================
   Vaultique Boutique Point - Admin > Settings > Customer Accounts
   ---------------------------------------------------------------------
   Whether customers can have an account, and what one is worth having.

   The thing this section could not exist without
   ----------------------------------------------
   Every policy in the database used to say `auth.role() = 'authenticated'`,
   which in Supabase means ANYONE SIGNED IN. That was safe while the admin
   was the only person who could sign in at all.

   A customer account ends that. The first person to register would have
   become 'authenticated' too, and inherited write access to prices,
   settings, reviews, policies, the photo bucket and site_settings_private
   - the table holding the bank details, made private because those
   details are confidential.

   So supabase-setup.sql now keeps an `admins` table and every rule asks
   is_admin() instead. Registration cannot safely be switched on until
   that file has been run, which is why the section says so at the top
   rather than in a footnote.

   What moved here, and why
   ------------------------
   Guest checkout was in Products & Shopping, switched off and waiting for
   this section. It is a question about accounts - may somebody buy
   without one - so it belongs beside the accounts rather than beside the
   catalogue. Shopping points here now instead of holding it.

   The wishlist itself stays in Shopping: whether the shop HAS a wishlist
   is a shopping decision. What is here is only whether a wishlist follows
   the person who made it.

   Passwords are half Supabase's
   -----------------------------
   The real minimum length is set in the Supabase dashboard and enforced
   on the server. Anything here can only ever be stricter, and is checked
   in the browser. The section says so rather than implying the site is in
   charge of something it is not.
   ===================================================================== */
(function () {
  'use strict';
  if (!window.VBP_ADMIN) return;

  var A = window.VBP_ADMIN;

  var REGISTRATION = [
    { value: 'open',   label: 'Open — anyone can create an account' },
    { value: 'closed', label: 'Closed — no new accounts, existing ones still work' }
  ];

  var HISTORY_SCOPE = [
    { value: 'all',    label: 'Every order they have placed' },
    { value: 'recent', label: 'Only recent orders' }
  ];

  var DEFAULTS = {
    accountsEnabled: false,
    registration: 'open',
    guestCheckout: true,

    emailVerification: true,
    phoneVerification: false,

    passwordMinLength: 8,
    passwordNeedsNumber: true,
    passwordNeedsSymbol: false,
    passwordReset: true,

    accountDeletion: true,
    deletionNote: 'Your account and saved addresses are removed. Orders already placed ' +
                  'are kept, since we need them for our own records.',

    orderHistory: true,
    historyScope: 'all',
    historyMonths: 12,

    savedAddresses: true,
    maxAddresses: 5,

    wishlistFollowsAccount: true
  };

  A.store.registerDefaults('customer-accounts', DEFAULTS);

  function on(v) { return !!v.accountsEnabled; }

  A.registerSetting({
    key: 'customer-accounts',
    title: 'Customer Accounts',
    summary: 'Whether customers can register, what an account holds, and guest checkout.',
    render: function (host, ctx) {
      ctx.ui.form(host, {
        key: 'customer-accounts',
        savedMessage: 'Saved ✓ — the site picks this up within about a minute',

        groups: [
          {
            title: 'Before switching this on',
            fields: [
              { type: 'note', name: 'sqlNote', tone: 'warn',
                label: 'Run supabase-setup.sql first',
                text: 'Until it is run, every rule in your database treats anyone signed ' +
                      'in as an administrator — which was fine while you were the only ' +
                      'person who could sign in. The first customer to register would ' +
                      'otherwise be able to read and change your prices, your settings ' +
                      'and your bank details. The file adds an admins table, carries your ' +
                      'existing login into it so you cannot be locked out, and rewrites ' +
                      'every rule to ask who is signed in rather than whether anyone is. ' +
                      'It is safe to run more than once.' }
            ]
          },
          {
            title: 'Accounts',
            fields: [
              { type: 'toggle', name: 'accountsEnabled', label: 'Offer customer accounts',
                hint: 'Off removes sign in from the site entirely. Everybody shops as a ' +
                      'guest, which is how the shop runs today.' },
              { type: 'select', name: 'registration', label: 'New accounts',
                options: REGISTRATION, showIf: on,
                hint: 'Closed keeps existing customers signed in but stops new sign-ups.' },
              { type: 'toggle', name: 'guestCheckout', label: 'Guest checkout',
                hint: 'On lets anyone buy without an account. Off requires signing in ' +
                      'before checkout, which loses the customers who will not bother.' },
              { type: 'note', name: 'guestNote',
                label: 'Nobody can buy',
                text: 'Accounts are off and so is guest checkout, which leaves no way to ' +
                      'reach the WhatsApp step at all. Turn one of them on.',
                showIf: function (v) { return !v.accountsEnabled && !v.guestCheckout; },
                tone: 'warn' },
              { type: 'note', name: 'movedNote',
                label: 'Guest checkout moved here',
                text: 'It used to sit in Products & Shopping, switched off and waiting for ' +
                      'this section. Whether somebody may buy without an account is a ' +
                      'question about accounts, so it lives beside them now.' }
            ]
          },
          {
            title: 'Verifying who signed up',
            fields: [
              { type: 'toggle', name: 'emailVerification', label: 'Verify email addresses',
                showIf: on,
                hint: 'Supabase sends the message. A customer can sign in but cannot check ' +
                      'out until they have clicked the link.' },
              { type: 'toggle', name: 'phoneVerification', label: 'Verify phone numbers',
                showIf: on,
                hint: 'Needs an SMS provider connected to Supabase, which costs money per ' +
                      'message. Without one this stays dormant and the site says so ' +
                      'rather than failing quietly on your customers.' },
              { type: 'note', name: 'smsNote',
                label: 'This needs setting up in Supabase first',
                text: 'Authentication > Providers > Phone, with a Twilio or MessageBird ' +
                      'account behind it. Until that is done the switch is saved but the ' +
                      'site does not act on it, so nobody is stuck at a code that will ' +
                      'never arrive.',
                showIf: function (v) { return on(v) && !!v.phoneVerification; } }
            ]
          },
          {
            title: 'Passwords',
            note: 'Supabase enforces its own minimum on the server. These can only be ' +
                  'stricter, and are checked in the browser as somebody types.',
            fields: [
              { type: 'number', name: 'passwordMinLength', label: 'Minimum length',
                half: true, suffix: 'characters', min: 6, max: 64, showIf: on },
              { type: 'toggle', name: 'passwordNeedsNumber', label: 'Must contain a number',
                half: true, showIf: on },
              { type: 'toggle', name: 'passwordNeedsSymbol', label: 'Must contain a symbol',
                showIf: on,
                hint: 'Length does more for a password than punctuation does. Worth leaving ' +
                      'off unless you have a reason.' },
              { type: 'toggle', name: 'passwordReset', label: 'Offer password reset',
                showIf: on,
                hint: 'Off means a customer who forgets theirs has to message you. There is ' +
                      'rarely a good reason to switch this off.' }
            ]
          },
          {
            title: 'What an account holds',
            fields: [
              { type: 'toggle', name: 'orderHistory', label: 'Order history', showIf: on },
              { type: 'note', name: 'historyNote',
                label: 'What an order here actually is',
                text: 'The shop is settled on WhatsApp, so a saved order records what ' +
                      'somebody asked for, not what you agreed. New orders arrive as ' +
                      'pending and you confirm or cancel them in the Orders tab. It is ' +
                      'only worth showing a customer for as long as somebody keeps it ' +
                      'honest.',
                showIf: function (v) { return on(v) && !!v.orderHistory; } },
              { type: 'select', name: 'historyScope', label: 'Show them', options: HISTORY_SCOPE,
                showIf: function (v) { return on(v) && !!v.orderHistory; } },
              { type: 'number', name: 'historyMonths', label: 'Going back', half: true,
                suffix: 'months', min: 1, max: 120,
                showIf: function (v) {
                  return on(v) && !!v.orderHistory && v.historyScope === 'recent';
                } },
              { type: 'toggle', name: 'savedAddresses', label: 'Saved addresses', showIf: on,
                hint: 'Without an account the checkout already remembers one address on ' +
                      'one device. An account makes it several, on any device.' },
              { type: 'number', name: 'maxAddresses', label: 'How many they may save',
                half: true, min: 1, max: 20,
                showIf: function (v) { return on(v) && !!v.savedAddresses; } },
              { type: 'toggle', name: 'wishlistFollowsAccount',
                label: 'Wishlist follows the account', showIf: on,
                hint: 'On, a signed-in wishlist moves between their phone and their laptop, ' +
                      'and whatever they saved before signing in is merged in rather than ' +
                      'lost. Off leaves every wishlist on the device that made it.' },
              { type: 'note', name: 'wishlistNote',
                label: 'The wishlist itself is a shopping setting',
                text: 'Whether the shop has a wishlist at all is in Products & Shopping. ' +
                      'What is here is only whether one follows the person who made it.',
                showIf: on }
            ]
          },
          {
            title: 'Closing an account',
            fields: [
              { type: 'toggle', name: 'accountDeletion', label: 'Let customers delete their account',
                showIf: on,
                hint: 'The Data Protection Act No. 3 of 2021 gives people the right to have ' +
                      'their personal information deleted, and your own privacy policy ' +
                      'already promises it. Switching this off does not remove the ' +
                      'obligation, only the button.' },
              { type: 'textarea', name: 'deletionNote', label: 'What they are told',
                rows: 3, maxLength: 300,
                showIf: function (v) { return on(v) && !!v.accountDeletion; },
                hint: 'Shown before they confirm. Say plainly what goes and what stays.' }
            ]
          }
        ],

        validate: function (v, fail) {
          if (!v.accountsEnabled && !v.guestCheckout) {
            fail('guestCheckout',
                 'With accounts off and guest checkout off there is no way to buy anything.');
          }
          if (v.accountsEnabled && !v.guestCheckout && v.registration === 'closed') {
            fail('registration',
                 'Guest checkout is off and new accounts are closed, so nobody new can ' +
                 'ever buy. Open registration, or allow guests.');
          }
          if (v.passwordMinLength !== '' && Number(v.passwordMinLength) < 6) {
            fail('passwordMinLength', 'Six characters is the shortest Supabase will accept.');
          }
        }
      });
    }
  });
})();
