/* =====================================================================
   Vaultique Boutique Point - Admin > Settings > Customer Care
   ---------------------------------------------------------------------
   The help panels on the home page, and the questions customers ask
   before they buy.

   Why this section is mostly not what was asked for
   ------------------------------------------------
   Almost everything under "Customer Care & Policies" already existed
   somewhere, and building it again would have meant two places carrying
   the same answer:

     Support email, phone, WhatsApp     Settings > Contact & Social
     Support hours                      Contact & Social, and shown on
                                        the site beside trading hours
     Delivery information               Settings > Delivery & Collection
     Payment information                Settings > Payments
     All seven policies                 the Policies tab, already written

   The policies especially. The site ships sixty-four of them across
   eleven sections - Privacy, Terms and Conditions, Return, Exchange,
   Delivery, Order Cancellation and Payment among them. A settings page
   cannot be a better editor for sixty-four long documents than the tab
   built for exactly that, so they stay there.

   What was missing was not the words. It was the connection: a Returns
   card that does not link to the Return Policy, and no way to edit three
   of the four cards at all.

   Where the cards used to come from
   ---------------------------------
   The Site Content row, retired several sections ago. Three of the four
   cards had their wording written into index.html and were not editable
   from anywhere. They are a list now.

   Borrowing rather than repeating
   ------------------------------
   A card can take its answer from the section that owns it: Delivery
   from Settings > Delivery, Payment from Settings > Payments - which is
   how the payment card already worked. Change a delivery fee once and
   the card follows. Writing your own words instead is always available;
   what is not available is having both and watching them drift apart.
   ===================================================================== */
(function () {
  'use strict';
  if (!window.VBP_ADMIN) return;

  var A = window.VBP_ADMIN;

  /* Where a card can borrow its answer from. 'own' is the default: most
     cards are the shop's own words and have no other home. */
  var SOURCES = [
    { value: 'own',      label: 'What I write below' },
    { value: 'delivery', label: 'Settings > Delivery & Collection' },
    { value: 'payments', label: 'Settings > Payments' }
  ];

  var ICONS = [
    { value: 'ruler',  label: 'Ruler — sizing and fit' },
    { value: 'van',    label: 'Van — delivery' },
    { value: 'shield', label: 'Shield — returns and guarantees' },
    { value: 'card',   label: 'Card — payment' },
    { value: 'chat',   label: 'Speech bubble — talking to us' },
    { value: 'clock',  label: 'Clock — timing' },
    { value: 'gift',   label: 'Gift — orders and packaging' }
  ];

  var DEFAULTS = {
    careEnabled: true,
    careEyebrow: 'Here to help',
    careHeading: 'Size, delivery & returns',
    careSub: 'Everything you need to shop with confidence. Still unsure? Message us any time.',
    cards: [],

    faqEnabled: false,
    faqEyebrow: 'Questions',
    faqHeading: 'Frequently asked',
    faqSub: '',
    faqs: [],
    faqAskEnabled: true,
    faqAskText: 'Still not sure? Ask us on WhatsApp'
  };

  A.store.registerDefaults('customer-care', DEFAULTS);

  A.registerSetting({
    key: 'customer-care',
    title: 'Customer Care',
    summary: 'The help panels on the home page, and the questions customers ask.',
    render: function (host, ctx) {
      var policies = [];

      /* The policy list, so a card can point at one by name rather than
         by an address somebody has to look up and keep correct. */
      ctx.sb.from('policies').select('title,section').order('sort', { ascending: true })
        .then(function (r) {
          policies = (r && r.data) || [];
          draw();
        }, function () { draw(); });

      function policyOptions() {
        var out = [{ value: '', label: 'No link' }];
        policies.forEach(function (p) {
          if (p && p.title) out.push({ value: p.title, label: p.title });
        });
        return out;
      }

      function draw() {
        var formHost = document.createElement('div');
        host.appendChild(formHost);

        var CARE = window.VBP_CARE;

        ctx.ui.form(formHost, {
          key: 'customer-care',
          savedMessage: 'Saved ✓ — the site picks this up within about a minute',

          /* A shop that has saved nothing still has four panels on its
             home page, so the list opens holding them rather than empty.
             Three of them had no editor at all before this, and offering
             a blank list would mean retyping what is already showing. */
          afterLoad: function (values, form) {
            if (CARE && !(values.cards || []).length) {
              form.set('cards', CARE.cards([]));
            }
          },

          groups: [
            {
              title: 'Where the answers already live',
              fields: [
                { type: 'note', name: 'elsewhereNote',
                  label: 'Most of Customer Care is already set, elsewhere',
                  text: 'Support email, phone and WhatsApp are in Contact & Social, with ' +
                        'support hours, which the site shows beside your trading hours. ' +
                        'Delivery information is in Delivery & Collection, payment ' +
                        'information in Payments. All seven policies you would expect — ' +
                        'Privacy, Terms, Return, Exchange, Delivery, Cancellation and ' +
                        'Payment — are already written in the Policies tab, along with ' +
                        'fifty-seven more. Nothing here repeats any of it; the cards below ' +
                        'can point at it instead.' }
              ]
            },
            {
              title: 'The help panels',
              fields: [
                { type: 'toggle', name: 'careEnabled', label: 'Show the help panels',
                  hint: 'Off removes the whole band from the home page.' },
                { type: 'text', name: 'careEyebrow', label: 'Small line above', half: true,
                  maxLength: 40, showIf: careOn },
                { type: 'text', name: 'careHeading', label: 'Heading', half: true,
                  maxLength: 70, showIf: careOn },
                { type: 'textarea', name: 'careSub', label: 'Line under the heading',
                  rows: 2, maxLength: 200, showIf: careOn },

                { type: 'list', name: 'cards', label: 'Panels',
                  addLabel: 'Add a panel', itemName: 'Panel', max: 8,
                  showIf: careOn,
                  summary: function (row) { return row.title || 'New panel'; },
                  blank: function () {
                    return { title: '', icon: 'chat', source: 'own', body: '',
                             ask: '', policy: '' };
                  },
                  fields: [
                    { type: 'text', name: 'title', label: 'Heading', half: true,
                      maxLength: 60, required: true },
                    { type: 'select', name: 'icon', label: 'Icon', half: true,
                      options: ICONS },
                    { type: 'select', name: 'source', label: 'Where the answer comes from',
                      options: SOURCES,
                      hint: 'Borrowing means changing it once, in the section that owns it, ' +
                            'rather than here as well.' },
                    { type: 'textarea', name: 'body', label: 'What it says', rows: 5,
                      maxLength: 900,
                      hint: 'A line each for numbered steps. Left empty on a borrowing ' +
                            'panel, the other section fills it.' },
                    { type: 'select', name: 'policy', label: 'Link to a policy',
                      options: policyOptions(),
                      hint: 'Adds "Read the full policy" under the panel. The short answer ' +
                            'and the long one finally point at each other.' },
                    { type: 'text', name: 'ask', label: 'WhatsApp message', maxLength: 120,
                      hint: 'What the Ask on WhatsApp button starts. Leave empty for no ' +
                            'button on this panel.' }
                  ] },

                { type: 'note', name: 'starterNote',
                  label: 'These four are what your site shows today',
                  text: 'Three of them had their wording written into the site itself and ' +
                        'could not be edited from anywhere. They are filled in here ready to ' +
                        'change, and nothing is saved until you press Save. Remove them all ' +
                        'and the site falls back to exactly these four rather than showing ' +
                        'an empty band.',
                  showIf: careOn }
              ]
            },
            {
              title: 'Frequently asked questions',
              note: 'A band of questions that open when tapped, at its own address /faq.',
              fields: [
                { type: 'toggle', name: 'faqEnabled', label: 'Show an FAQ',
                  hint: 'It stays hidden until you have written at least one question, ' +
                        'whatever this says.' },
                { type: 'text', name: 'faqEyebrow', label: 'Small line above', half: true,
                  maxLength: 40, showIf: faqOn },
                { type: 'text', name: 'faqHeading', label: 'Heading', half: true,
                  maxLength: 70, showIf: faqOn },
                { type: 'textarea', name: 'faqSub', label: 'Line under the heading',
                  rows: 2, maxLength: 200, showIf: faqOn },

                { type: 'list', name: 'faqs', label: 'Questions',
                  addLabel: 'Add a question', itemName: 'Question', max: 30,
                  showIf: faqOn,
                  summary: function (row) { return row.q || 'New question'; },
                  blank: function () { return { q: '', a: '', policy: '' }; },
                  fields: [
                    { type: 'text', name: 'q', label: 'Question', maxLength: 160,
                      required: true },
                    { type: 'textarea', name: 'a', label: 'Answer', rows: 4,
                      maxLength: 900, required: true },
                    { type: 'select', name: 'policy', label: 'Link to a policy',
                      options: policyOptions() }
                  ] },

                { type: 'toggle', name: 'faqAskEnabled', label: 'Offer WhatsApp at the end',
                  showIf: faqOn,
                  hint: 'A question you have not answered is the one somebody needs ' +
                        'answered.' },
                { type: 'text', name: 'faqAskText', label: 'What the button says',
                  maxLength: 60, required: true,
                  showIf: function (v) { return faqOn(v) && !!v.faqAskEnabled; } }
              ]
            },
            {
              title: 'The policies themselves',
              fields: [
                { type: 'note', name: 'policyNote',
                  label: policies.length
                    ? policies.length + ' policies, edited in the Policies tab'
                    : 'The Policies tab',
                  text: 'They are long documents rather than settings, so they are edited ' +
                        'where there is room for them. What is new is that a panel or a ' +
                        'question can now point at one, so a customer reading the short ' +
                        'answer can reach the full one.' }
              ]
            }
          ],

          validate: function (v, fail) {
            if (v.faqEnabled && !(v.faqs || []).filter(function (f) { return f && f.q; }).length) {
              fail('faqs', 'An FAQ with no questions in it shows nothing. Add one, or ' +
                           'switch the FAQ off.');
            }
          }
        });
      }

      function careOn(v) { return !!v.careEnabled; }
      function faqOn(v) { return !!v.faqEnabled; }
    }
  });
})();
