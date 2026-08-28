/* =====================================================================
   Vaultique Boutique Point - the help panels, shared
   ---------------------------------------------------------------------
   The four panels the site came with, and the icons a panel can wear.
   Read by the storefront and by Settings > Customer Care so both draw
   the same thing when a shop has written none of its own.

   Three of these four used to be written into index.html, where nobody
   could edit them. They are here so that an empty settings list still
   shows a shop what it already has, rather than emptying its home page
   the first time somebody opens the section.
   ===================================================================== */
(function () {
  'use strict';

  var ICONS = {
    ruler:  "<path d='M3 6h18M3 12h18M3 18h18'/>",
    van:    "<rect x='1' y='3' width='15' height='13'/><path d='M16 8h4l3 3v5h-7V8z'/>" +
            "<circle cx='5.5' cy='18.5' r='2.5'/><circle cx='18.5' cy='18.5' r='2.5'/>",
    shield: "<path d='M3 7v6a9 9 0 009 9 9 9 0 009-9V7'/><path d='M3 7l9-4 9 4-9 4-9-4z'/>",
    card:   "<rect x='2' y='5' width='20' height='14' rx='2'/><path d='M2 10h20'/>",
    chat:   "<path d='M21 11.5a8.38 8.38 0 01-9 8.5 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.2A8.38 " +
            "8.38 0 014 11.5 8.5 8.5 0 0112.5 3 8.5 8.5 0 0121 11.5z'/>",
    clock:  "<circle cx='12' cy='12' r='9'/><path d='M12 7v5l3 2'/>",
    gift:   "<rect x='3' y='8' width='18' height='13' rx='1'/><path d='M3 12h18M12 8v13'/>" +
            "<path d='M12 8S9 3 7 4.5 9 8 12 8zM12 8s3-5 5-3.5S15 8 12 8z'/>"
  };

  var STARTER = [
    { title: 'Size & style advice', icon: 'ruler', source: 'own',
      body: 'Tell us your usual size and the look you are going for, and we will ' +
            'recommend the right fit before you buy. Share your measurements (bust, ' +
            'waist, hips, or shoe size) on WhatsApp and we will match you to the best ' +
            'piece. We can also suggest styling and pairings so your purchase works ' +
            'with your wardrobe.',
      ask: "I'd like size and style advice.", policy: '' },
    { title: 'Deliveries', icon: 'van', source: 'delivery', body: '',
      ask: 'I have a question about delivery.', policy: 'Delivery Policy' },
    { title: 'Exchanges & returns', icon: 'shield', source: 'own',
      body: '1. If something is not right, message us on WhatsApp within 7 days of ' +
            'receiving your order.\n' +
            '2. Tell us what you would like to exchange or return and why.\n' +
            '3. Keep the item unworn, with tags, in its original condition.\n' +
            '4. We arrange the exchange or a return, and confirm any difference in ' +
            'price or delivery. Sale items and intimate pieces may be exchange-only.',
      ask: "I'd like to arrange an exchange or return.", policy: 'Return Policy' },
    { title: 'How to pay', icon: 'card', source: 'payments', body: '',
      ask: 'I have a question about paying.', policy: 'Payment Policy' }
  ];

  function icon(name) {
    return "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.4'>" +
           (ICONS[name] || ICONS.chat) + '</svg>';
  }

  /* A shop that has written none of its own keeps what it had. */
  function cards(saved) {
    var list = (saved || []).filter(function (c) { return c && c.title; });
    return list.length ? list : STARTER.slice();
  }

  var api = { ICONS: ICONS, STARTER: STARTER, icon: icon, cards: cards };
  if (typeof window !== 'undefined') window.VBP_CARE = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
