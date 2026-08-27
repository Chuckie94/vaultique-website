/* =====================================================================
   Vaultique Boutique Point - Admin > Settings > Shopping
   ---------------------------------------------------------------------
   What customers see on a product, and what they can do with it.

   Two things that look like duplicates but are not:

     Show product reviews    whether the reviews you already have appear
     Customer reviews        whether new ones can be written

   Turning the second off leaves the reviews already collected on show;
   turning the first off hides them without deleting anything.

   Stock: the POS feed sends whether a piece is in stock and whether only
   a few are left, and never the count itself. That comparison happens on
   the server, so "Show low stock warning" can exist without the number
   ever reaching a browser. Where "a few" begins is set by LOW_STOCK_AT
   in the Netlify environment variables, and is three by default.

   Checkout: the shop has no cart and no order records. Ordering happens
   on WhatsApp, which is the design. What the checkout settings decide is
   what gets asked for before that message is composed, so the first
   thing to arrive is a complete order rather than "is this available?".
   Nothing is stored; the details travel in the message.

   Guest checkout is shown but locked. With no customer accounts there is
   nothing for it to be the alternative to, and a switch that does
   nothing is worse than one that says why.
   ===================================================================== */
(function () {
  'use strict';
  if (!window.VBP_ADMIN) return;

  var A = window.VBP_ADMIN;

  var SORTS = [
    { value: 'featured',    label: 'Featured' },
    { value: 'price-asc',   label: 'Price: low to high' },
    { value: 'price-desc',  label: 'Price: high to low' },
    { value: 'name',        label: 'Name A–Z' },
    { value: 'available',   label: 'In stock first' }
  ];

  var DEFAULTS = {
    showOutOfStock: true,
    showSku: true,
    showLowStock: true,
    showCategory: true,
    showBadges: true,
    showReviews: true,
    defaultSort: 'featured',

    enquiries: true,
    wishlist: true,
    sharing: true,
    customerReviews: true,

    whatsappCheckout: true,
    guestCheckout: true,
    requireName: true,
    requirePhone: true,
    requireEmail: false,
    requireAddress: false,
    orderNotes: true,
    checkoutLabel: 'Buy on WhatsApp'
  };

  A.store.registerDefaults('shopping', DEFAULTS);

  A.registerSetting({
    key: 'shopping',
    title: 'Shopping',
    summary: 'Catalogue behaviour, stock display and how customers place an order.',
    render: function (host, ctx) {
      ctx.ui.form(host, {
        key: 'shopping',
        savedMessage: 'Saved ✓ — the site picks this up within about a minute',

        groups: [
          {
            title: 'Product display',
            note: 'What appears on a product card and on its page.',
            fields: [
              { type: 'toggle', name: 'showOutOfStock', label: 'Show pieces that are sold out',
                hint: 'Off hides them entirely. On shows them marked Sold Out, which lets ' +
                      'someone ask you to let them know when it is back.' },
              { type: 'toggle', name: 'showBadges', label: 'Show badges',
                hint: 'The New In and In Stock marks on a photo.' },
              { type: 'toggle', name: 'showLowStock', label: 'Show low stock warning',
                hint: 'Shows "Only a few left" when a piece is running down. The number ' +
                      'itself stays in the POS and never reaches the website.' },
              { type: 'toggle', name: 'showCategory', label: 'Show category',
                hint: 'The small line above a product name, and its row in the details.' },
              { type: 'toggle', name: 'showSku', label: 'Show product code',
                hint: 'The SKU row in the product details. Customers rarely need it, ' +
                      'but it makes an order unambiguous.' },
              { type: 'toggle', name: 'showReviews', label: 'Show reviews',
                hint: 'Whether reviews already left appear on the site.' },
              { type: 'select', name: 'defaultSort', label: 'Default sorting', options: SORTS,
                hint: 'How the shop is ordered before anyone changes it.' }
            ]
          },
          {
            title: 'What customers can do',
            fields: [
              { type: 'toggle', name: 'enquiries', label: 'Product enquiries',
                hint: 'The Enquire on WhatsApp button on a piece that is sold out.' },
              { type: 'toggle', name: 'wishlist', label: 'Wishlist',
                hint: 'The heart on each piece, and the saved list behind it. Off also ' +
                      'removes the wishlist from the header.' },
              { type: 'toggle', name: 'sharing', label: 'Product sharing',
                hint: 'A share button on each piece. Opens the phone’s own share ' +
                      'sheet, and copies the link on a computer.' },
              { type: 'toggle', name: 'customerReviews', label: 'Customer reviews',
                hint: 'Whether new reviews can be written. Reviews already left are ' +
                      'unaffected; use Show reviews above to hide those.' }
            ]
          },
          {
            title: 'Checkout',
            note: 'Ordering happens on WhatsApp. Anything marked below is asked for first, ' +
                  'so the message that reaches you is a complete order rather than a question.',
            fields: [
              { type: 'toggle', name: 'whatsappCheckout', label: 'WhatsApp checkout',
                hint: 'Off turns the shop into a catalogue: prices and pieces stay, ' +
                      'the buy buttons go. Enquiries are separate and stay as you set them above.' },
              { type: 'text', name: 'checkoutLabel', label: 'Checkout button text',
                maxLength: 40, required: true,
                showIf: function (v) { return !!v.whatsappCheckout; },
                hint: 'What the button on each piece says.' },
              { type: 'toggle', name: 'guestCheckout', label: 'Guest checkout',
                disabled: true,
                disabledReason: 'Customer accounts have not been built yet.',
                hint: 'Everyone shops as a guest at the moment. This becomes a real choice ' +
                      'once Settings > Customer Accounts exists.' },
              { type: 'toggle', name: 'requireName', label: 'Ask for a name',
                showIf: function (v) { return !!v.whatsappCheckout; } },
              { type: 'toggle', name: 'requirePhone', label: 'Ask for a phone number',
                showIf: function (v) { return !!v.whatsappCheckout; },
                hint: 'Worth having even though WhatsApp carries a number: the one they ' +
                      'message from is not always the one to call about a delivery.' },
              { type: 'toggle', name: 'requireEmail', label: 'Ask for an email address',
                showIf: function (v) { return !!v.whatsappCheckout; } },
              { type: 'toggle', name: 'requireAddress', label: 'Ask for a delivery address',
                showIf: function (v) { return !!v.whatsappCheckout; } },
              { type: 'toggle', name: 'orderNotes', label: 'Offer a notes box',
                showIf: function (v) { return !!v.whatsappCheckout; },
                hint: 'An optional line for anything else: a landmark, a gift message, ' +
                      'a preferred delivery day.' }
            ]
          }
        ],

        validate: function (values, fail) {
          if (!values.showReviews && values.customerReviews) {
            fail('customerReviews', 'Reviews are hidden, so a customer would write one and ' +
                                    'never see it appear. Turn this off too, or show reviews.');
          }
        }
      });
    }
  });
})();
