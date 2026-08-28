/* =====================================================================
   Vaultique Boutique Point - Admin > Settings > Delivery & Collection
   ---------------------------------------------------------------------
   How an order reaches the customer, and what the shop says about it.

   What this section replaced
   --------------------------
   A paragraph welded into every product page:

     "We deliver nationwide across Zambia where possible, with fees
      calculated by distance and confirmed on WhatsApp before dispatch.
      Collection in person can also be arranged."

   It stated the areas, the charging and the collection offer, and the
   only way to change any of it was to edit the source.

   What is deliberately not here
   -----------------------------
   Phone numbers. Contact & Social already holds four: the business
   phone, the main WhatsApp number, the order number and the enquiry
   number. A fifth and sixth typed here would be six numbers free to
   disagree with each other. So delivery and collection follow the order
   number, and only carry their own when a shop actually answers those
   questions somewhere else - the same fallback Contact & Social already
   uses between its own numbers.

   The pickup address is General's physical address for the same reason,
   until a shop says otherwise.

   Long form terms. The policies page already ships seven of them:
   Delivery Policy, Delivery Charges, Delivery Timeframes, Delivery
   Delays, Failed Delivery, Click and Collect and Local Pickup. What is
   here is the line a buyer reads while deciding, with a way through to
   the rest. Writing the terms twice is how two versions of them start
   disagreeing.

   Money is written the way Settings > Pricing says, so a fee and a price
   never appear in two different currencies on one page.
   ===================================================================== */
(function () {
  'use strict';
  if (!window.VBP_ADMIN) return;

  var A = window.VBP_ADMIN;
  var F = window.VBP_FORMAT;

  var SPEEDS = [
    { value: 'standard', label: 'Standard only' },
    { value: 'both',     label: 'Standard and same-day' }
  ];

  /* ---- defaults ------------------------------------------------------
     The shipped wording is what the product page used to have printed
     into it, so a shop that never opens this section reads as it did. */
  var DEFAULTS = {
    deliveryEnabled: true,
    areas: [],
    showFees: false,
    standardFee: '',
    standardDays: 'Confirmed on WhatsApp',
    freeOver: '',
    feesNote: 'Fees are calculated by distance and confirmed on WhatsApp before dispatch.',

    speeds: 'standard',
    sameDayFee: '',
    sameDayCutoff: '14:00',
    sameDayNote: 'Same-day delivery in Lusaka for orders confirmed before the cut-off.',

    pickupEnabled: true,
    pickupUseShopAddress: true,
    pickupLocation: '',
    pickupInstructions: 'Message us when you are on your way and we will have your order ready.',
    pickupNumberOverride: false,
    pickupNumber: '',

    terms: 'We deliver nationwide across Zambia where possible. Collection in person ' +
           'can also be arranged.',
    instructions: 'Tell us your area when you message and we will confirm the fee and ' +
                  'the timing before anything is dispatched.',
    numberOverride: false,
    number: ''
  };

  A.store.registerDefaults('delivery', DEFAULTS);

  A.registerSetting({
    key: 'delivery',
    title: 'Delivery & Collection',
    summary: 'Where you deliver, what it costs, how long it takes, and collection in person.',
    render: function (host, ctx) {
      var general = {}, contact = {}, pricing = {};

      Promise.all([
        A.store.load('general').catch(function () { return {}; }),
        A.store.load('contact').catch(function () { return {}; }),
        A.store.load('pricing').catch(function () { return {}; })
      ]).then(function (r) {
        general = r[0] || {}; contact = r[1] || {}; pricing = r[2] || {};
        draw();
      });

      function orderNumber() {
        return contact.orderNumber || contact.whatsapp || '';
      }
      function shopAddress() {
        var bits = [general.address, general.city, general.country]
          .map(function (x) { return String(x || '').trim(); })
          .filter(Boolean);
        return bits.join(', ');
      }
      function money(n) {
        if (!F) return String(n);
        return F.money(n, F.moneyStyle(general, pricing));
      }
      var code = general.currency || 'ZMW';
      var symbol = F ? F.symbol(code) : 'K';

      function deliveryOn(v) { return !!v.deliveryEnabled; }
      function feesOn(v) { return !!v.deliveryEnabled && !!v.showFees; }
      function sameDayOn(v) { return !!v.deliveryEnabled && v.speeds === 'both'; }
      function pickupOn(v) { return !!v.pickupEnabled; }

      function draw() {
        mountPreview();
        var formHost = document.createElement('div');
        host.appendChild(formHost);

        ctx.ui.form(formHost, {
          key: 'delivery',
          savedMessage: 'Saved ✓ — the site picks this up within about a minute',
          onChange: function (v) { showPreview(v); },
          afterLoad: function (v) { showPreview(v); },

          groups: [
            {
              title: 'Delivery',
              fields: [
                { type: 'toggle', name: 'deliveryEnabled', label: 'Offer delivery',
                  hint: 'Off removes every mention of delivery from the site, including ' +
                        'the address box at checkout.' },
                { type: 'note', name: 'offNote', tone: 'warn',
                  label: 'Two settings elsewhere lean on this',
                  text: 'With delivery off, "Payment on delivery" in Settings > Payments ' +
                        'has nothing to attach to, and "Ask for a delivery address" in ' +
                        'Products & Shopping asks for something nobody needs. Both are ' +
                        'worth turning off with it.',
                  showIf: function (v) { return !v.deliveryEnabled; } }
              ]
            },
            {
              title: 'Where you deliver',
              note: 'Leave the list empty and the site simply says you deliver, without ' +
                    'naming anywhere.',
              fields: [
                { type: 'list', name: 'areas', label: 'Delivery areas',
                  addLabel: 'Add an area', itemName: 'Area', max: 20,
                  showIf: deliveryOn,
                  summary: function (row) { return row.name || 'New area'; },
                  blank: function () { return { name: '', fee: '', days: '', sameDay: false }; },
                  fields: [
                    { type: 'text', name: 'name', label: 'Area', half: true,
                      maxLength: 60, required: true, placeholder: 'Lusaka' },
                    { type: 'text', name: 'days', label: 'How long it takes', half: true,
                      maxLength: 40, placeholder: 'Same day or next day' },
                    { type: 'number', name: 'fee', label: 'Delivery fee', half: true,
                      prefix: symbol, min: 0,
                      hint: 'Leave empty for free, or to settle it in conversation.' },
                    { type: 'toggle', name: 'sameDay', label: 'Same-day possible here', half: true }
                  ] }
              ]
            },
            {
              title: 'Charges',
              fields: [
                { type: 'toggle', name: 'showFees', label: 'Show delivery fees on the site',
                  showIf: deliveryOn,
                  hint: 'Off names your areas and how long they take, but keeps the ' +
                        'figures out of it and says fees are confirmed on WhatsApp.' },
                { type: 'textarea', name: 'feesNote', label: 'What is said instead of a fee',
                  rows: 2, maxLength: 200,
                  showIf: function (v) { return deliveryOn(v) && !v.showFees; } },
                { type: 'number', name: 'standardFee', label: 'Standard delivery fee',
                  half: true, prefix: symbol, min: 0, showIf: feesOn,
                  hint: 'Used for anywhere not named above.' },
                { type: 'number', name: 'freeOver', label: 'Free delivery over',
                  half: true, prefix: symbol, min: 0, showIf: feesOn,
                  hint: 'Leave empty for no free delivery.' },
                { type: 'text', name: 'standardDays', label: 'Usual delivery time',
                  maxLength: 60, showIf: deliveryOn,
                  hint: 'For anywhere not named above. In plain words rather than a number.' }
              ]
            },
            {
              title: 'Speed',
              fields: [
                { type: 'select', name: 'speeds', label: 'Delivery speeds offered',
                  options: SPEEDS, showIf: deliveryOn },
                { type: 'number', name: 'sameDayFee', label: 'Same-day fee', half: true,
                  prefix: symbol, min: 0,
                  showIf: function (v) { return sameDayOn(v) && v.showFees; } },
                { type: 'text', name: 'sameDayCutoff', label: 'Order by', half: true,
                  maxLength: 5, placeholder: '14:00', showIf: sameDayOn,
                  hint: 'Orders confirmed after this go the next day.',
                  validate: function (v) {
                    if (!v) return '';
                    return /^([01]?\d|2[0-3]):[0-5]\d$/.test(v) ? '' : 'Write the time as HH:MM, like 14:00.';
                  } },
                { type: 'textarea', name: 'sameDayNote', label: 'What same-day means here',
                  rows: 2, maxLength: 200, showIf: sameDayOn }
              ]
            },
            {
              title: 'Collection in person',
              fields: [
                { type: 'toggle', name: 'pickupEnabled', label: 'Offer collection' },
                { type: 'toggle', name: 'pickupUseShopAddress',
                  label: 'Collect from the shop address', showIf: pickupOn,
                  hint: shopAddress()
                    ? 'From General: ' + shopAddress()
                    : 'No address in Settings > General yet. Add one there, or switch ' +
                      'this off and write the collection point below.' },
                { type: 'textarea', name: 'pickupLocation', label: 'Collection point',
                  rows: 3, maxLength: 200, required: true,
                  showIf: function (v) { return pickupOn(v) && !v.pickupUseShopAddress; },
                  hint: 'Where customers actually come, if it is not the shop.' },
                { type: 'textarea', name: 'pickupInstructions', label: 'Collection instructions',
                  rows: 3, maxLength: 300, showIf: pickupOn,
                  hint: 'What to do on arrival, parking, who to ask for.' },
                { type: 'toggle', name: 'pickupNumberOverride',
                  label: 'Collection questions go to a different number', showIf: pickupOn,
                  hint: orderNumber()
                    ? 'Off sends them to the order number, ' + orderNumber() + '.'
                    : 'Off sends them to the order number in Contact & Social.' },
                { type: 'text', name: 'pickupNumber', label: 'Collection number',
                  maxLength: 24, required: true,
                  showIf: function (v) { return pickupOn(v) && !!v.pickupNumberOverride; },
                  hint: 'With the country code, as 260 …',
                  validate: phoneCheck }
              ]
            },
            {
              title: 'What customers are told',
              note: 'Shown on the product page and at checkout.',
              fields: [
                { type: 'textarea', name: 'terms', label: 'Delivery terms', rows: 3,
                  maxLength: 400,
                  hint: 'A line or two. The full terms stay on the policies page.' },
                { type: 'note', name: 'policyNote',
                  label: 'The long form already exists',
                  text: 'Your policies page carries Delivery Policy, Delivery Charges, ' +
                        'Delivery Timeframes, Delivery Delays, Failed Delivery, Click and ' +
                        'Collect and Local Pickup. The site links through to them from ' +
                        'here, so this box only needs the summary. Edit the rest in the ' +
                        'Policies tab.' },
                { type: 'textarea', name: 'instructions', label: 'Delivery instructions',
                  rows: 3, maxLength: 400,
                  showIf: deliveryOn,
                  hint: 'What the customer should do or expect. Shown at checkout, where ' +
                        'they are deciding.' },
                { type: 'toggle', name: 'numberOverride',
                  label: 'Delivery questions go to a different number', showIf: deliveryOn,
                  hint: orderNumber()
                    ? 'Off sends them to the order number, ' + orderNumber() + '.'
                    : 'Off sends them to the order number in Contact & Social.' },
                { type: 'text', name: 'number', label: 'Delivery number', maxLength: 24,
                  required: true,
                  showIf: function (v) { return deliveryOn(v) && !!v.numberOverride; },
                  hint: 'With the country code, as 260 …',
                  validate: phoneCheck }
              ]
            }
          ],

          validate: function (v, fail) {
            if (!v.deliveryEnabled && !v.pickupEnabled) {
              fail('pickupEnabled',
                   'With both off there is no way for an order to reach anyone. ' +
                   'Keep at least one.');
            }
            if (v.showFees && v.freeOver !== '' && v.standardFee !== '' &&
                Number(v.freeOver) > 0 && Number(v.freeOver) <= Number(v.standardFee)) {
              fail('freeOver',
                   'Free delivery starts below the delivery fee itself, which cannot be right.');
            }
            (v.areas || []).forEach(function (a, i) {
              if (a && a.sameDay && v.speeds !== 'both') {
                fail('speeds', 'An area offers same-day delivery, so the speeds above ' +
                               'should include it.');
              }
            });
          }
        });
      }

      function phoneCheck(v) {
        var digits = String(v || '').replace(/[^0-9]/g, '');
        if (!digits) return '';
        if (digits.length < 9) return 'That looks too short for a number with its country code.';
        if (digits.length > 15) return 'That looks too long for a phone number.';
        return '';
      }

      /* ---- what the customer will read ------------------------------
         The same lines the product page and checkout will show, so the
         wording can be judged here rather than after a save. */
      var pv = null;
      function mountPreview() {
        var card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = '<h3>What a customer reads</h3>';
        pv = document.createElement('div');
        pv.className = 'dl-preview';
        card.appendChild(pv);
        host.appendChild(card);
      }
      function showPreview(v) {
        if (!pv) return;
        var out = [];

        if (v.deliveryEnabled) {
          var areas = (v.areas || []).filter(function (a) { return a && a.name; });
          if (areas.length) {
            out.push(['Delivery', areas.map(function (a) {
              var bits = [a.name];
              if (a.days) bits.push(a.days);
              if (v.showFees) {
                bits.push(a.fee === '' || a.fee === undefined ? 'free' : money(a.fee));
              }
              return bits.join(' · ');
            }).join('\n')]);
          } else {
            out.push(['Delivery', v.standardDays || 'Available']);
          }
          if (v.showFees) {
            var charge = [];
            if (v.standardFee !== '') charge.push('Elsewhere ' + money(v.standardFee));
            if (v.freeOver !== '') charge.push('Free over ' + money(v.freeOver));
            if (charge.length) out.push(['Charges', charge.join(' · ')]);
          } else if (v.feesNote) {
            out.push(['Charges', v.feesNote]);
          }
          if (v.speeds === 'both') {
            var sd = 'Same-day' + (v.sameDayCutoff ? ' if confirmed before ' + v.sameDayCutoff : '');
            if (v.showFees && v.sameDayFee !== '') sd += ' · ' + money(v.sameDayFee);
            out.push(['Same-day', sd]);
          }
        }

        if (v.pickupEnabled) {
          var where = v.pickupUseShopAddress ? shopAddress() : v.pickupLocation;
          out.push(['Collection', where || 'No address set yet']);
          if (v.pickupInstructions) out.push(['On arrival', v.pickupInstructions]);
        }

        if (v.terms) out.push(['Terms', v.terms]);
        if (!out.length) out.push(['', 'Nothing is offered, so the site says nothing.']);

        pv.innerHTML = '';
        out.forEach(function (row) {
          var line = document.createElement('div');
          line.className = 'dl-line';
          var k = document.createElement('span');
          k.className = 'dl-k';
          k.textContent = row[0];
          var t = document.createElement('span');
          t.className = 'dl-v';
          t.textContent = row[1];
          line.appendChild(k); line.appendChild(t);
          pv.appendChild(line);
        });
      }
    }
  });
})();
