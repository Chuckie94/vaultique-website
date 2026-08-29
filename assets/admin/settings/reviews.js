/* =====================================================================
   Vaultique Boutique Point - Admin > Settings > Reviews
   ---------------------------------------------------------------------
   Whether reviews are shown, whether customers may write them, and what
   happens to one when it arrives.

   Two of these were already built, in Settings > Shopping: whether the
   reviews you have appear, and whether new ones can be written. They
   have moved here with the rest of the subject rather than being asked
   twice - and a shop that had already turned either of them off keeps
   that answer: afterLoad carries the old values across the first time
   this section is opened, so moving them cannot quietly switch reviews
   back on for somebody who had switched them off.

   The brief asked for both "Require approval" and "Auto-publish". They
   are the same switch facing opposite ways, and two switches for one
   decision is two switches free to contradict each other. There is one,
   and it reads as a choice rather than as a pair of negatives.

   The one that matters:

   Holding a review for approval is enforced by the DATABASE, not by this
   page. A rule the website merely honours is a request - anybody can
   speak to the database directly, and a review arriving already marked
   approved would appear on the shop without ever being read. The insert
   policy asks this section's own settings before it allows a review to
   publish itself. See review_auto_publish() in supabase-setup.sql.
   ===================================================================== */
(function () {
  'use strict';
  if (!window.VBP_ADMIN) return;

  var A = window.VBP_ADMIN;

  var DEFAULTS = {
    showReviews: true,
    showRatings: true,
    customerReviews: true,
    anonymous: false,
    anonymousLabel: 'A customer',
    autoPublish: false,
    minAutoRating: 4
  };

  A.store.registerDefaults('reviews', DEFAULTS);

  var RATINGS = [
    { value: 1, label: '1 star and above — publish everything' },
    { value: 2, label: '2 stars and above' },
    { value: 3, label: '3 stars and above' },
    { value: 4, label: '4 stars and above' },
    { value: 5, label: '5 stars only' }
  ];

  A.registerSetting({
    key: 'reviews',
    title: 'Reviews',
    summary: 'Whether reviews appear, who may write them, and what happens to a new one.',
    render: function (host, ctx) {
      ctx.ui.form(host, {
        key: 'reviews',
        savedMessage: 'Saved ✓ — the site picks this up within about a minute',

        groups: [
          {
            title: 'On the website',
            fields: [
              { type: 'toggle', name: 'showReviews', label: 'Show reviews',
                hint: 'Whether the reviews you already have appear on the site.' },
              { type: 'toggle', name: 'showRatings', label: 'Show the star rating',
                hint: 'The score and the number of reviews, beside a product and at the top ' +
                      'of the reviews band. Turn this off to show what people wrote without ' +
                      'a score on everything.' }
            ]
          },
          {
            title: 'Writing a review',
            fields: [
              { type: 'toggle', name: 'customerReviews', label: 'Let customers write reviews',
                hint: 'Reviews already left are unaffected. Use Show reviews above to hide those.' },
              { type: 'toggle', name: 'anonymous', label: 'Allow a review without a name',
                showIf: function (v) { return !!v.customerReviews; },
                hint: 'Some people will say more honestly what they think when they do not ' +
                      'have to sign it.' },
              { type: 'text', name: 'anonymousLabel', label: 'Shown in place of a name',
                half: true, maxLength: 40, required: true,
                showIf: function (v) { return !!v.customerReviews && !!v.anonymous; } }
            ]
          },
          {
            title: 'When a review arrives',
            note: 'This is enforced by the database, not only by the website, so a review ' +
                  'cannot arrive already published when you have asked to read them first.',
            fields: [
              /* A switch rather than a pair of buttons: the choice field
                 keeps its value as text, so a boolean false would come
                 back as the string "false" and read as true everywhere
                 it was tested. */
              { type: 'toggle', name: 'autoPublish', label: 'Publish new reviews straight away',
                showIf: function (v) { return !!v.customerReviews; },
                hint: 'Off means nothing appears until you approve it in the Reviews tab. ' +
                      'On means it appears at once, and you can still remove it afterwards.' },
              { type: 'select', name: 'minAutoRating', label: 'Except below', options: RATINGS,
                showIf: function (v) { return !!v.customerReviews && !!v.autoPublish; },
                hint: 'A review below this still waits for you. Nothing is hidden — an unhappy ' +
                      'customer simply gets read before they are published, which is worth ' +
                      'doing anyway.' }
            ]
          }
        ],

        validate: function (v, problem) {
          /* A customer who writes a review and never sees it appear
             assumes it was lost, or thrown away. This guard came with
             the two switches from Shopping. */
          if (!v.showReviews && v.customerReviews) {
            problem('customerReviews', 'Reviews are hidden, so a customer would write one and ' +
                                       'never see it appear. Turn this off too, or show reviews.');
          }
        },

        afterLoad: function (values, form) {
          /* --- carry the two that moved ---------------------------- */
          /* A shop that had already switched either of these off in
             Shopping must not have them switched back on by the move.
             Only an explicit "off" is carried: the defaults here are on,
             so nothing else needs saying. */
          A.store.load('shopping').then(function (shop) {
            if (!shop) return;
            var moved = false;
            ['showReviews', 'customerReviews'].forEach(function (n) {
              if (shop[n] === false && values[n] !== false) {
                form.set(n, false);
                moved = true;
              }
            });
            if (!moved) return;
            var note = document.createElement('div');
            note.className = 'warn';
            note.textContent =
              'These two used to live in Settings > Shopping, and your answers there have ' +
              'been carried across. Press Save to keep them here.';
            host.insertBefore(note, host.firstChild);
          }).catch(function () {});

          /* --- where moderation actually happens ------------------- */
          var card = document.createElement('div');
          card.className = 'card';

          var h = document.createElement('h3');
          h.textContent = 'Reading and approving reviews';
          card.appendChild(h);

          var p = document.createElement('p');
          p.className = 'grp-note';
          p.textContent = 'Every review, approved or waiting, is in the Reviews tab: mark one ' +
                          'as from a genuine buyer, show or hide it, or delete it. It is not ' +
                          'repeated here, so there is only ever one list to work from.';
          card.appendChild(p);

          var row = document.createElement('div');
          row.className = 'row';
          var go = document.createElement('button');
          go.type = 'button';
          go.className = 'btn btn-out btn-sm';
          go.textContent = 'Open Reviews';
          go.addEventListener('click', function () { ctx.navigate('reviews', ''); });
          row.appendChild(go);
          card.appendChild(row);

          host.appendChild(card);
        }
      });
    }
  });
})();
