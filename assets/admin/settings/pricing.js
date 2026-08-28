/* =====================================================================
   Vaultique Boutique Point - Admin > Settings > Pricing & Tax
   ---------------------------------------------------------------------
   How a price is written and what it says.

   Where prices come from
   ----------------------
   From the POS, always. Nothing in this section invents a price. The
   till holds one number for each piece and that number is the price.

   Which is why there is no box here for typing a sale price. When the
   shop reduces something in the POS, the reduction IS the sale, and the
   website's job is to notice it rather than to be told about it. The
   admin records the price it last saw against each piece; when the POS
   comes in lower, the recorded price becomes the "was" and the strike
   through, the percentage and the Sale badge follow from the difference.
   Settings > Pricing decides how big a drop has to be before it counts,
   and how long it stays worth mentioning.

   A price that moves the other way resets the record: a piece that went
   up is not on sale, and the shop stops saying so on its own.

   What is not here
   ----------------
   The currency itself lives in Settings > General, beside the time zone
   and the date format, because it belongs with the rest of the region
   settings and a shop should only choose it once. This section shows
   which currency is in force and links across rather than asking again.
   The separators between thousands and decimals are General's too. What
   is here is everything about the currency that General does not decide:
   the symbol, the side it sits on, and how many decimals show.

   Sale badges are Settings > Products & Shopping's "Show badges", which
   already governs New In, In Stock and Sold Out. One switch for badges,
   not two.
   ===================================================================== */
(function () {
  'use strict';
  if (!window.VBP_ADMIN) return;

  var A = window.VBP_ADMIN;
  var F = window.VBP_FORMAT;

  var POSITIONS = [
    { value: 'before',       label: 'Before the amount — K1,200' },
    { value: 'before-space', label: 'Before, with a space — K 1,200' },
    { value: 'after',        label: 'After the amount — 1,200K' },
    { value: 'after-space',  label: 'After, with a space — 1,200 K' }
  ];

  var DECIMALS = [
    { value: 'auto', label: 'Only when needed — K1,200 and K1,200.50' },
    { value: '0',    label: 'Never — K1,200 and K1,201' },
    { value: '2',    label: 'Always two — K1,200.00 and K1,200.50' }
  ];

  var TAX_MODES = [
    { value: 'included', label: 'Included in the price shown' },
    { value: 'excluded', label: 'Added at checkout' },
    { value: 'none',     label: 'Do not mention tax' }
  ];

  var PERCENT_WHERE = [
    { value: 'badge',  label: 'On the photo, as a badge' },
    { value: 'inline', label: 'Beside the price' },
    { value: 'both',   label: 'Both' }
  ];

  var PROMO_SCOPES = [
    { value: 'all',        label: 'Everything in the shop' },
    { value: 'categories', label: 'Only the categories I list' }
  ];

  var PROMO_TYPES = [
    { value: 'percent', label: 'A percentage off' },
    { value: 'amount',  label: 'An amount off' }
  ];

  /* ---- defaults ------------------------------------------------------
     Chosen so that a shop which never opens this section looks exactly as
     it did before it existed: the same symbol, the same side, the same
     decimals, and the same VAT line the storefront used to have printed
     into it. */
  var DEFAULTS = {
    currencySymbol: '',
    currencyPosition: 'before',
    decimalPlaces: 'auto',

    taxMode: 'included',
    taxRate: 16,
    taxLabel: 'VAT',

    trackReductions: true,
    minReductionPercent: 5,
    reductionDays: 30,
    showSalePrice: true,
    showOriginalPrice: true,
    showDiscountPercent: true,
    percentWhere: 'both',

    onRequestEnabled: true,
    onRequestText: 'Price on request',
    onRequestButton: 'Ask about this piece',

    promoEnabled: false,
    promoName: '',
    promoType: 'percent',
    promoAmount: '',
    promoScope: 'all',
    promoCategories: '',
    promoFrom: '',
    promoTo: '',

    overridesEnabled: false
  };

  A.store.registerDefaults('pricing', DEFAULTS);

  /* The currency is General's. Read it so this page can show a live
     example in the shop's real money rather than a made up one. */
  function generalSettings() {
    return A.store.load('general').catch(function () { return {}; });
  }

  A.registerSetting({
    key: 'pricing',
    title: 'Pricing & Tax',
    summary: 'How prices are written, what they say about tax, and how reductions are shown.',
    render: function (host, ctx) {
      var general = {};

      generalSettings().then(function (g) {
        general = g || {};
        draw();
      });

      function draw() {
        var code = general.currency || 'ZMW';
        var symbolNow = F ? F.symbol(code) : 'K';

        /* A worked example, redrawn on every keystroke, so nobody has to
           save and go and look. */
        function example(v) {
          if (!F) return '';
          var style = F.moneyStyle(general, v);
          var view = F.priceView({ price: 900, wasPrice: 1200, category: 'Bags' }, v, style);
          var bits = [view.nowText];
          if (view.wasText) bits.push('was ' + view.wasText);
          if (view.offText) bits.push(view.offText);
          var line = bits.join('  ·  ');
          if (view.tax) line += '\n' + view.tax;
          return line;
        }

        mountExample();
        var formHost = document.createElement('div');
        host.appendChild(formHost);

        ctx.ui.form(formHost, {
          key: 'pricing',
          savedMessage: 'Saved ✓ — the site picks this up within about a minute',

          onChange: function (v) { showExample(example(v)); },
          afterLoad: function (v) { showExample(example(v)); },

          groups: [
            {
              title: 'Currency',
              note: 'The currency itself is set in Settings > General, with the time zone and ' +
                    'date format. What is here is how it is written.',
              fields: [
                { type: 'note', name: 'currencyNote',
                  label: 'Currency in force: ' + code,
                  text: 'Prices arrive from the POS in ' + code + '. To trade in a different ' +
                        'currency, change it in Settings > General — the whole site follows ' +
                        'from there. Thousands and decimal separators are set there too.' },
                { type: 'text', name: 'currencySymbol', label: 'Currency symbol', half: true,
                  maxLength: 6, placeholder: symbolNow,
                  hint: 'Leave empty to use ' + symbolNow + ', the usual symbol for ' + code + '.' },
                { type: 'select', name: 'currencyPosition', label: 'Symbol position',
                  half: true, options: POSITIONS },
                { type: 'select', name: 'decimalPlaces', label: 'Decimal places',
                  options: DECIMALS,
                  hint: 'Most of the shop is priced in whole kwacha, so "only when needed" ' +
                        'keeps prices short without hiding the odd amount that has ngwee.' }
              ]
            },
            {
              title: 'Tax',
              note: 'One line under the price on the product page and the quick view.',
              fields: [
                { type: 'select', name: 'taxMode', label: 'Tax on displayed prices',
                  options: TAX_MODES,
                  hint: 'Zambian retail prices normally already include VAT.' },
                { type: 'number', name: 'taxRate', label: 'Rate', half: true,
                  suffix: '%', min: 0, max: 100, placeholder: '16',
                  showIf: function (v) { return v.taxMode !== 'none'; },
                  hint: 'Leave empty to name the tax without stating a rate.' },
                { type: 'text', name: 'taxLabel', label: 'What the tax is called',
                  half: true, maxLength: 20, placeholder: 'VAT',
                  showIf: function (v) { return v.taxMode !== 'none'; } }
              ]
            },
            {
              title: 'Reductions',
              note: 'Reduce a piece in the POS and the website shows it as reduced. ' +
                    'There is nothing to type here for an individual piece.',
              fields: [
                { type: 'note', name: 'reductionNote',
                  label: 'How a sale price gets here',
                  text: 'The admin records the price it last saw for each piece. When the POS ' +
                        'comes in lower, the older price is shown struck through and the ' +
                        'percentage is worked out from the two. Put a price back up and the ' +
                        'piece stops being on sale on its own. You can see and clear the ' +
                        'recorded price for any piece in the Products tab.' },
                { type: 'toggle', name: 'trackReductions', label: 'Mark POS reductions as sales',
                  hint: 'Off means every piece simply shows its current price, with no ' +
                        'strike through and no percentage.' },
                { type: 'number', name: 'minReductionPercent', label: 'Smallest drop that counts',
                  half: true, suffix: '%', min: 0, max: 90,
                  showIf: function (v) { return !!v.trackReductions; },
                  hint: 'A price corrected by a hair is not a sale.' },
                { type: 'number', name: 'reductionDays', label: 'A sale stays news for',
                  half: true, suffix: 'days', min: 1, max: 365,
                  showIf: function (v) { return !!v.trackReductions; },
                  hint: 'After this, the piece keeps its lower price but stops being ' +
                        'advertised as reduced.' },
                { type: 'toggle', name: 'showSalePrice', label: 'Show the reduced price',
                  showIf: function (v) { return !!v.trackReductions; },
                  hint: 'Off shows only the current price with nothing to compare it to.' },
                { type: 'toggle', name: 'showOriginalPrice', label: 'Show the original, struck through',
                  showIf: function (v) { return !!v.trackReductions && !!v.showSalePrice; } },
                { type: 'toggle', name: 'showDiscountPercent', label: 'Show how much is off',
                  showIf: function (v) { return !!v.trackReductions && !!v.showSalePrice; } },
                { type: 'select', name: 'percentWhere', label: 'Where the percentage appears',
                  options: PERCENT_WHERE,
                  showIf: function (v) {
                    return !!v.trackReductions && !!v.showSalePrice && !!v.showDiscountPercent;
                  } }
              ]
            },
            {
              title: 'Price on request',
              note: 'For pieces whose price is settled in conversation.',
              fields: [
                { type: 'toggle', name: 'onRequestEnabled', label: 'Allow price on request',
                  hint: 'Tick a piece in the Products tab to hide its figure. Off here shows ' +
                        'every price normally, whatever is ticked.' },
                { type: 'text', name: 'onRequestText', label: 'Shown instead of the price',
                  half: true, maxLength: 40, placeholder: 'Price on request',
                  showIf: function (v) { return !!v.onRequestEnabled; } },
                { type: 'text', name: 'onRequestButton', label: 'Button text', half: true,
                  maxLength: 30, placeholder: 'Ask about this piece',
                  showIf: function (v) { return !!v.onRequestEnabled; },
                  hint: 'The WhatsApp button asks rather than buys: nobody can agree to a ' +
                        'price they have not been shown.' }
              ]
            },
            {
              title: 'Promotional pricing',
              note: 'One reduction across the shop, on top of nothing else.',
              fields: [
                { type: 'toggle', name: 'promoEnabled', label: 'Run a promotion',
                  hint: 'A piece the POS has already reduced keeps its own price. The two ' +
                        'never stack, so nothing is ever cut twice.' },
                { type: 'text', name: 'promoName', label: 'What the promotion is called',
                  maxLength: 60, placeholder: 'Mid-season',
                  showIf: function (v) { return !!v.promoEnabled; },
                  hint: 'For your own records. Customers see the reduced prices, not the name.' },
                { type: 'select', name: 'promoType', label: 'Type', half: true,
                  options: PROMO_TYPES,
                  showIf: function (v) { return !!v.promoEnabled; } },
                { type: 'number', name: 'promoAmount', label: 'Amount', half: true,
                  min: 0, placeholder: '20',
                  showIf: function (v) { return !!v.promoEnabled; },
                  hint: 'A percentage, or an amount in ' + code + '.' },
                { type: 'select', name: 'promoScope', label: 'Applies to', options: PROMO_SCOPES,
                  showIf: function (v) { return !!v.promoEnabled; } },
                { type: 'text', name: 'promoCategories', label: 'Categories',
                  maxLength: 200, placeholder: 'Bags, Shoes',
                  showIf: function (v) {
                    return !!v.promoEnabled && v.promoScope === 'categories';
                  },
                  hint: 'Separated by commas, spelled as they are in the POS. Capitals do ' +
                        'not matter.' },
                { type: 'date', name: 'promoFrom', label: 'Starts', half: true,
                  showIf: function (v) { return !!v.promoEnabled; },
                  hint: 'Leave empty to start now.' },
                { type: 'date', name: 'promoTo', label: 'Ends', half: true,
                  showIf: function (v) { return !!v.promoEnabled; },
                  hint: 'Leave empty to run until you switch it off.' }
              ]
            },
            {
              title: 'Manual price overrides',
              fields: [
                { type: 'toggle', name: 'overridesEnabled', label: 'Allow website prices to differ from the POS',
                  hint: 'Off, and the POS price is the price everywhere. This is how the shop ' +
                        'runs today.' },
                { type: 'note', name: 'overrideNote', tone: 'warn',
                  label: 'An override outranks the till',
                  text: 'A piece with an override sells at the website price and ignores the ' +
                        'POS, including any reduction made there. Overridden pieces are marked ' +
                        'in the Products tab with the POS price beside yours, so one cannot ' +
                        'sit forgotten against a till that has moved on.' }
              ]
            }
          ],

          validate: function (v, fail) {
            if (v.taxMode !== 'none' && v.taxRate !== '' &&
                (Number(v.taxRate) < 0 || Number(v.taxRate) > 100)) {
              fail('taxRate', 'A tax rate is between 0 and 100.');
            }
            if (v.promoEnabled) {
              if (v.promoAmount === '' || Number(v.promoAmount) <= 0) {
                fail('promoAmount', 'A promotion needs an amount above zero.');
              } else if (v.promoType === 'percent' && Number(v.promoAmount) >= 100) {
                fail('promoAmount', 'A promotion of 100% or more would make everything free.');
              }
              if (v.promoScope === 'categories' && !String(v.promoCategories || '').trim()) {
                fail('promoCategories', 'Name at least one category, or apply it to everything.');
              }
              if (v.promoFrom && v.promoTo && v.promoTo < v.promoFrom) {
                fail('promoTo', 'The promotion ends before it starts.');
              }
            }
          }
        });
      }

      /* ---- the worked example ---------------------------------------
         Sits under the form and shows a real piece priced the way the
         settings above would price it. */
      var exNode = null;
      function mountExample() {
        var card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = '<h3>How a reduced piece reads</h3>';
        exNode = document.createElement('pre');
        exNode.className = 'px-example';
        exNode.style.cssText = 'font-family:inherit;white-space:pre-wrap;font-size:15px;' +
                               'color:var(--navy);line-height:1.8;margin:0';
        card.appendChild(exNode);
        var foot = document.createElement('div');
        foot.className = 'hint';
        foot.textContent = 'A piece the POS has brought down from 1,200 to 900.';
        card.appendChild(foot);
        host.appendChild(card);
      }
      function showExample(text) { if (exNode) exNode.textContent = text; }
    }
  });
})();
