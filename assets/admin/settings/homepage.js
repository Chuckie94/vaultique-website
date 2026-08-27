/* =====================================================================
   Vaultique Boutique Point - Admin > Settings > Homepage
   ---------------------------------------------------------------------
   The announcement bar, the hero, the story and the core values: the
   parts of the homepage that are words and pictures rather than
   products. Which sections appear and in what order is the next build.

   This section took over from the Site Content tab, which had been
   emptying out since the first of these builds. A few things people
   look for here are deliberately elsewhere:

     Footer tagline          Settings > General
     Payment information     Settings > Payments
     Customer care panels    Settings > Customer Care
     Newsletter wording      Settings > Newsletter

   Each of those is one value in one place, which is the whole point of
   moving them.
   ===================================================================== */
(function () {
  'use strict';
  if (!window.VBP_ADMIN) return;

  var A = window.VBP_ADMIN;
  var SEC = window.VBP_SECTIONS;
  if (!SEC) return;      // sections.js must load first

  var DEFAULTS = {
    announceEnabled: true,
    announceText: 'Nationwide delivery where possible · <b>Shop &amp; buy on WhatsApp</b>',

    heroEnabled: true,
    heroImage1: '', heroImage2: '', heroImage3: '',
    heroEyebrow: 'Zambia',
    heroTitle: 'Curated Elegance,',
    heroTitleEm: 'Accessible Luxury',
    heroSubtitle: "A curated edit of women's and men's fashion, footwear, bags and " +
                  'accessories, chosen for quality and quiet sophistication.',
    heroCtaText: 'Shop the collection',
    heroCtaLink: '',

    storyHeading: 'The Vaultique story',
    storyP1: '',
    storyP2: '',

    values: [],

    promoEnabled: false,
    promoTitle: '',
    promoText: '',
    promoCtaText: '',
    promoCtaLink: '',
    promoImage: '',

    sections: [],

    testimonials: [],
    lookImages: [],
    look1: '', look2: '', look3: '', look4: '', look5: '', look6: ''
  };

  A.store.registerDefaults('homepage', DEFAULTS);

  /* A link may be left blank for the shop, or point at a page on this
     site, or go somewhere else entirely. Anything else is a typo. */
  function checkLink(v) {
    if (!v) return '';
    var s = String(v).trim();
    if (/^#\//.test(s)) return '';
    if (/^https?:\/\//i.test(s)) return '';
    if (/^(mailto|tel):/i.test(s)) return '';
    return 'Start with #/ for a page on this site, or https:// for somewhere else. ' +
           'Leave it blank to go to the shop.';
  }

  A.registerSetting({
    key: 'homepage',
    title: 'Homepage',
    summary: 'Which sections appear on the homepage and the order they run in.',
    render: function (host, ctx) {
      ctx.ui.form(host, {
        key: 'homepage',
        savedMessage: 'Saved ✓ — the site picks this up within about a minute',

        groups: [
          {
            title: 'Announcement bar',
            note: 'The thin strip along the very top of every page.',
            fields: [
              { type: 'toggle', name: 'announceEnabled', label: 'Show the announcement bar' },
              { type: 'text', name: 'announceText', label: 'Announcement text',
                maxLength: 140, showIf: function (v) { return !!v.announceEnabled; },
                validate: function (v, all) {
                  return (all.announceEnabled && !v) ? 'Write something, or switch the bar off.' : '';
                },
                hint: 'Keep it short. <b>bold</b> works if you want to emphasise a word.' }
            ]
          },
          {
            title: 'Hero',
            note: 'The full-height picture and headline at the top of the homepage.',
            fields: [
              { type: 'toggle', name: 'heroEnabled', label: 'Show the hero',
                hint: 'Off starts the page at the collections instead.' },
              { type: 'text', name: 'heroEyebrow', label: 'Small line above the heading',
                half: true, maxLength: 40, showIf: heroOn },
              { type: 'text', name: 'heroCtaText', label: 'Button text', half: true,
                maxLength: 40, showIf: heroOn,
                validate: function (v, all) {
                  return (all.heroEnabled && !v) ? 'The button needs words on it.' : '';
                } },
              { type: 'text', name: 'heroTitle', label: 'Heading, first line', half: true,
                maxLength: 60, showIf: heroOn },
              { type: 'text', name: 'heroTitleEm', label: 'Heading, second line', half: true,
                maxLength: 60, showIf: heroOn,
                hint: 'Set in italics, in the heading typeface.' },
              { type: 'textarea', name: 'heroSubtitle', label: 'Subtitle', rows: 3,
                maxLength: 260, showIf: heroOn },
              { type: 'text', name: 'heroCtaLink', label: 'Button goes to',
                maxLength: 300, showIf: heroOn, validate: checkLink,
                placeholder: 'Leave blank for the shop',
                hint: 'Blank goes to the shop. #/policies or a full https:// address also work.' },
              { type: 'image', name: 'heroImage1', label: 'Hero photo 1', previewOn: 'dark',
                prefix: 'hero/h1', maxSize: 900 * 1024, showIf: heroOn,
                hint: 'Landscape, and large: this fills the screen. The three rotate.' },
              { type: 'image', name: 'heroImage2', label: 'Hero photo 2', previewOn: 'dark',
                prefix: 'hero/h2', maxSize: 900 * 1024, showIf: heroOn },
              { type: 'image', name: 'heroImage3', label: 'Hero photo 3', previewOn: 'dark',
                prefix: 'hero/h3', maxSize: 900 * 1024, showIf: heroOn }
            ]
          },
          {
            title: 'Our story',
            fields: [
              { type: 'text', name: 'storyHeading', label: 'Heading', maxLength: 80 },
              { type: 'textarea', name: 'storyP1', label: 'First paragraph', rows: 4,
                maxLength: 600 },
              { type: 'textarea', name: 'storyP2', label: 'Second paragraph', rows: 4,
                maxLength: 600, hint: 'Leave either blank to drop that paragraph.' }
            ]
          },
          {
            title: 'Core values',
            note: 'The short row of promises under the story. Leave the list empty to keep ' +
                  'the four the site shipped with.',
            fields: [
              { type: 'list', name: 'values', label: 'Values', addLabel: 'Add a value',
                itemName: 'Value', max: 6,
                summary: function (row) { return row.t || 'New value'; },
                blank: function () { return { t: '', s: '' }; },
                fields: [
                  { type: 'text', name: 't', label: 'Value', half: true, maxLength: 40,
                    required: true },
                  { type: 'text', name: 's', label: 'One line about it', half: true,
                    maxLength: 60, required: true }
                ] }
            ]
          },
          {
            title: 'Promotional banner',
            note: 'A band you can drop anywhere on the page: a sale, a new arrival, ' +
                  'a closing date. Position it in the section list below.',
            fields: [
              { type: 'toggle', name: 'promoEnabled', label: 'Show the promotional banner' },
              { type: 'text', name: 'promoTitle', label: 'Headline', maxLength: 70,
                showIf: promoOn,
                validate: function (v, all) {
                  return (all.promoEnabled && !v) ? 'Give the banner a headline, or switch it off.' : '';
                } },
              { type: 'textarea', name: 'promoText', label: 'Supporting line', rows: 2,
                maxLength: 200, showIf: promoOn },
              { type: 'text', name: 'promoCtaText', label: 'Button text', half: true,
                maxLength: 40, showIf: promoOn, placeholder: 'Leave blank for no button' },
              { type: 'text', name: 'promoCtaLink', label: 'Button goes to', half: true,
                maxLength: 300, showIf: promoOn, validate: checkLink,
                placeholder: 'Leave blank for the shop' },
              { type: 'image', name: 'promoImage', label: 'Background photo', previewOn: 'dark',
                prefix: 'promo/banner', maxSize: 900 * 1024, showIf: promoOn,
                hint: 'Optional. Without one the banner uses your brand colours.' }
            ]
          },
          {
            title: 'Testimonials',
            note: 'Quotes shown alongside the reviews customers leave themselves. ' +
                  'Leave the list empty to show only real reviews.',
            fields: [
              { type: 'list', name: 'testimonials', label: 'Quotes',
                addLabel: 'Add a quote', itemName: 'Quote', max: 6,
                summary: function (row) { return row.name || 'New quote'; },
                blank: function () { return { quote: '', name: '', city: '' }; },
                fields: [
                  { type: 'textarea', name: 'quote', label: 'What they said', rows: 3,
                    maxLength: 300, required: true },
                  { type: 'text', name: 'name', label: 'Who said it', half: true,
                    maxLength: 60, required: true },
                  { type: 'text', name: 'city', label: 'Where they are', half: true,
                    maxLength: 60 }
                ] }
            ]
          },
          {
            title: 'Lookbook photos',
            note: 'Six square photos for the lookbook band. Leave any empty and the ' +
                  'band shows the rest.',
            fields: [1, 2, 3, 4, 5, 6].map(function (n) {
              return { type: 'image', name: 'look' + n, label: 'Photo ' + n,
                       previewOn: 'light', prefix: 'look/l' + n, maxSize: 700 * 1024,
                       half: true };
            })
          },
          {
            title: 'Sections',
            note: 'Everything between the hero and the footer. Switch a section off to ' +
                  'hide it, move it with the arrows, and give it your own heading. ' +
                  'Leave a heading blank to keep the wording the site came with.',
            fields: [
              { type: 'list', name: 'sections', label: 'Order and headings',
                fixed: true, reorder: true, itemName: 'Section',
                summary: function (row) {
                  var def = SEC.known(row.id);
                  var name = (def && def.label) || row.id;
                  return name + (row.on === false ? ' — hidden' : '');
                },
                fields: [
                  { type: 'toggle', name: 'on', label: 'Show this section' },
                  { type: 'text', name: 'title', label: 'Heading', half: true, maxLength: 70 },
                  { type: 'text', name: 'desc', label: 'Line underneath', half: true,
                    maxLength: 160 }
                ] }
            ]
          }
        ],

        afterLoad: function (values, form) {
          /* The saved list is reconciled against the sections the site
             actually has, so a shop never sees one that has gone and
             always sees one that has arrived. */
          form.set('sections', SEC.reconcile(values.sections));
          var shots = Array.isArray(values.lookImages) ? values.lookImages : [];
          [1, 2, 3, 4, 5, 6].forEach(function (n) { form.set('look' + n, shots[n - 1] || ''); });
        },

        beforeSave: function (values) {
          values.sections = SEC.reconcile(values.sections);
          /* The six photo slots are separate fields so each has its own
             uploader, and one array so the storefront can just walk it. */
          values.lookImages = [1, 2, 3, 4, 5, 6]
            .map(function (n) { return values['look' + n] || ''; });
          return values;
        }
      });
    }
  });

  function heroOn(v) { return !!v.heroEnabled; }
  function promoOn(v) { return !!v.promoEnabled; }
})();
