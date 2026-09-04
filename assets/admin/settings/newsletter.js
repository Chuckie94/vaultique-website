/* =====================================================================
   Vaultique Boutique Point - Admin > Settings > Newsletter
   ---------------------------------------------------------------------
   The words on the sign-up band, and what somebody is told when they
   join.

   Every one of them was written into index.html, where nobody without a
   text editor could reach them - the same thing that had happened to the
   help panels and the delivery wording. That is all this section is
   really for: handing them back.

   What is deliberately NOT here, because it already has a home:

     Whether the band appears at all, and where it sits on the page,
     belong to Settings > Homepage, which owns every band on the
     homepage. A second switch here would be a second answer to the same
     question, and the two would disagree the first time anyone used one
     of them.

     The list itself - who is on it, copying the addresses, writing to
     everybody - is the Subscribers tab. This page links to it rather
     than growing a second copy that could show a different count.

   The wording shipped below is exactly what the page says today, so
   uploading this build changes nothing on the site until the shop
   decides to change it.
   ===================================================================== */
(function () {
  'use strict';
  if (!window.VBP_ADMIN) return;

  var A = window.VBP_ADMIN;

  var DEFAULTS = {
    enabled: true,

    eyebrow: 'Stay in the know',
    heading: 'Join the list',
    blurb: 'New arrivals, private offers and styling notes, straight to your inbox.',
    placeholder: 'Your email address',
    buttonLabel: 'Subscribe',
    welcome: 'Thank you. You are on the list.',
    privacyNote: 'We respect your privacy and will never share your details.',

    offerAtSignup: false,
    signupLabel: 'Email me new arrivals and private offers',

    welcomeSubject: 'Welcome to the list',
    welcomeEmail: 'Thank you for joining us.\n\n' +
                  'You will hear from us when new pieces arrive and when we hold ' +
                  'something back for the list before it reaches the shop floor. ' +
                  'Never more often than that.\n\n' +
                  'If you would like anything found or held, simply reply to this ' +
                  'message.',
    unsubscribeMessage: 'You have been removed from our list and will not hear from ' +
                        'us again. You are welcome back any time.',
    footer: 'You are receiving this because you joined our list at ' +
            'vaultiqueboutique.com. Reply to this message to come off it.'
  };

  A.store.registerDefaults('newsletter', DEFAULTS);

  A.registerSetting({
    key: 'newsletter',
    title: 'Newsletter',
    summary: 'The words on the sign-up band, and what someone is told when they join.',
    render: function (host, ctx) {
      ctx.ui.form(host, {
        key: 'newsletter',
        savedMessage: 'Saved ✓ — the site picks this up within about a minute',

        groups: [
          {
            title: 'The list',
            fields: [
              { type: 'toggle', name: 'enabled', label: 'Run a newsletter',
                hint: 'Off means the sign-up band does not appear anywhere, the tick box on ' +
                      'the sign-up form is not offered, and nothing new is accepted. ' +
                      'Everyone already on the list stays on it.' }
            ]
          },
          {
            title: 'The invitation',
            note: 'The band that asks people to join. WHERE it sits on the homepage, and in ' +
                  'what order among the other bands, is set in Settings > Homepage. ' +
                  'Whether you run a list at all is the switch above, and it wins.',
            fields: [
              { type: 'text', name: 'eyebrow', label: 'Small line above', maxLength: 40,
                hint: 'The short line in capitals.' },
              { type: 'text', name: 'heading', label: 'Heading', maxLength: 70, required: true },
              { type: 'textarea', name: 'blurb', label: 'The invitation', rows: 3, maxLength: 200,
                hint: 'One sentence on what joining actually gets them. Vague promises are ' +
                      'what people ignore.' },
              { type: 'text', name: 'placeholder', label: 'Grey text in the box', half: true,
                maxLength: 50 },
              { type: 'text', name: 'buttonLabel', label: 'Button', half: true, maxLength: 30,
                required: true }
            ]
          },
          {
            title: 'When somebody joins',
            fields: [
              { type: 'textarea', name: 'welcome', label: 'What they see', rows: 3, maxLength: 220,
                required: true,
                hint: 'Shown in place of the box the moment they join. This is the only ' +
                      'thanks they get, so it is worth writing properly.' },
              { type: 'textarea', name: 'privacyNote', label: 'The small print', rows: 2,
                maxLength: 200,
                hint: 'Sits under the box. Leave empty for none.' }
            ]
          },
          {
            title: 'The welcome email',
            note: 'Sent from the Subscribers tab, one person at a time, so nobody is ' +
                  'written to by accident. The email account it goes out from — the ' +
                  'sender name, the address and the signature — is set once in ' +
                  'Settings > Notifications and used by everything the shop sends.',
            fields: [
              { type: 'text', name: 'welcomeSubject', label: 'Subject', maxLength: 120 },
              { type: 'textarea', name: 'welcomeEmail', label: 'The message', rows: 8,
                maxLength: 1500,
                hint: 'Your signature from Settings > Notifications is added underneath, ' +
                      'then the footer below.' },
              { type: 'textarea', name: 'footer', label: 'Footer', rows: 3, maxLength: 400,
                hint: 'The small print at the bottom of every newsletter email. Saying how ' +
                      'somebody came to be on the list, and how to leave, is what keeps ' +
                      'your messages out of a spam folder.' }
            ]
          },
          {
            title: 'Leaving the list',
            fields: [
              { type: 'textarea', name: 'unsubscribeMessage', label: 'What they are told',
                rows: 3, maxLength: 300,
                hint: 'Shown when you take somebody off the list from the Subscribers tab, ' +
                      'so you can copy it straight back to them.' }
            ]
          },
          {
            title: 'At account sign up',
            note: 'Somebody creating an account has already typed their email. Asking once, ' +
                  'there, is worth more than the band on its own.',
            fields: [
              { type: 'toggle', name: 'offerAtSignup', label: 'Offer the list when someone registers',
                hint: 'Adds a tick box to the sign-up form. It starts unticked: a list ' +
                      'somebody joined without noticing is a list they will report as spam.' },
              { type: 'text', name: 'signupLabel', label: 'What the tick box says', maxLength: 90,
                showIf: function (v) { return !!v.offerAtSignup; } }
            ]
          }
        ],

        afterLoad: function (values, form) {
          /* --- the list itself lives elsewhere --------------------- */
          var card = document.createElement('div');
          card.className = 'card';

          var h = document.createElement('h3');
          h.textContent = 'Who has joined';
          card.appendChild(h);

          var p = document.createElement('p');
          p.className = 'grp-note';
          p.textContent = 'The list is kept in the Subscribers tab: how many have joined, ' +
                          'every address, and a way to write to all of them at once. It is ' +
                          'not repeated here, so there is only ever one count to trust.';
          card.appendChild(p);

          var row = document.createElement('div');
          row.className = 'row';
          var go = document.createElement('button');
          go.type = 'button';
          go.className = 'btn btn-out btn-sm';
          go.textContent = 'Open Subscribers';
          go.addEventListener('click', function () { ctx.navigate('subscribers', ''); });
          row.appendChild(go);
          card.appendChild(row);

          host.appendChild(card);
        }
      });
    }
  });
})();
