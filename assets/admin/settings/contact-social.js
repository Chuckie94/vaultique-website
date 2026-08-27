/* =====================================================================
   Vaultique Boutique Point - Admin > Settings > Contact & Social
   ---------------------------------------------------------------------
   Every way a customer reaches the shop: the numbers, the addresses, the
   social profiles, and the messages WhatsApp pre-fills when someone taps
   through.

   How the addresses are shared out, and why:

   - The physical address stays in Settings > General, next to the city
     and country it belongs with. It is shown here, read only, so the
     contact details can be read in one place.
   - Support hours follow the trading hours set in General unless the
     override below is switched on, because most shops answer messages
     on the days they trade and should not have to say so twice.
   - The WhatsApp numbers, the email and the Instagram handle used to
     live in the Site Content tab. They are here now, and that tab points
     at this section.

   The message templates take {business}, and the order one also takes
   {product}, {sku} and {price}. An unknown placeholder is left as it was
   written rather than becoming a hole in the message.
   ===================================================================== */
(function () {
  'use strict';
  if (!window.VBP_ADMIN) return;

  var A = window.VBP_ADMIN;
  var C = window.VBP_CONTACT;
  var F = window.VBP_FORMAT;
  if (!C) return;                     // contact.js must load first

  var DEFAULT_ORDER =
    "Hello {business}, I'd like to buy: {product} (SKU: {sku}), {price}. Is it available?";
  var DEFAULT_ENQUIRY =
    "Hello {business}, I have an enquiry.";

  var DEFAULTS = {
    phone: '',
    whatsapp: '',
    email: '',
    supportEmail: '',
    mapsUrl: '',
    supportHoursOverride: false,
    supportHours: null,

    instagram: '', facebook: '', tiktok: '', linkedin: '', x: '', youtube: '',

    orderNumber: '',
    enquiryNumber: '',
    orderMessage: DEFAULT_ORDER,
    enquiryMessage: DEFAULT_ENQUIRY
  };

  A.store.registerDefaults('contact', DEFAULTS);

  /* A number is optional, but if one is given it has to be usable. */
  function checkNumber(v) {
    if (!v) return '';
    var digits = String(v).replace(/\D/g, '');
    if (digits.length < 7) return 'That does not look like a complete number.';
    if (digits.length > 15) return 'That is longer than any phone number.';
    return '';
  }

  function checkEmail(v) {
    if (!v) return '';
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v).trim())
      ? '' : 'That does not look like an email address.';
  }

  function socialField(net) {
    return {
      type: 'handle',
      name: net.id,
      label: net.name,
      half: true,
      prefix: net.prefix,
      placeholder: net.placeholder,
      maxLength: 120,
      resolve: function (v) { return C.socialUrl(net.id, v); },
      tidy: function (v) {
        var url = C.socialUrl(net.id, v);
        if (!url) return String(v || '').trim();
        return url.indexOf(net.base) === 0 ? url.slice(net.base.length) : String(v || '').trim();
      }
    };
  }

  A.registerSetting({
    key: 'contact',
    title: 'Contact & Social',
    summary: 'Phone, WhatsApp, email, address and social media links.',
    render: function (host, ctx) {
      var esc = ctx.esc;

      /* General holds the business name, address and trading hours that
         this section leans on. */
      var general = A.store.defaults('general');
      var addressLine = null, hoursLine = null;

      function describeAddress() {
        var bits = [];
        if (general.address) bits.push(String(general.address).replace(/\s*\n\s*/g, ', '));
        if (general.city) bits.push(general.city);
        if (general.country) bits.push(general.country);
        return bits.join(' · ') || 'No address set yet.';
      }

      A.store.load('general').then(function (g) {
        general = g;
        if (addressLine) addressLine.textContent = describeAddress();
        if (hoursLine) hoursLine.textContent = trading();
        repaint();
      }).catch(function () {});

      function trading() {
        if (!F || !general.businessHours) return 'No trading hours set yet.';
        return F.summariseHours(general.businessHours) || 'No trading hours set yet.';
      }

      /* Switching the override on gives an empty week, which cannot be
         saved and is not what anyone means by it. Start from the trading
         hours instead, so it is an adjustment rather than a blank form. */
      var seeding = false;
      function seedHours(values, form) {
        if (seeding || !form || !form.set) return;
        if (!values.supportHoursOverride) return;
        var h = values.supportHours;
        var anyOpen = h && Object.keys(h).some(function (d) { return h[d] && h[d].open; });
        if (anyOpen) return;
        if (!general.businessHours) return;
        seeding = true;
        try { form.set('supportHours', general.businessHours); }
        finally { seeding = false; }
      }

      /* ---- the message preview ---- */
      var preview = null;
      var lastValues = null;

      function repaint() {
        if (!preview || !lastValues) return;
        var v = lastValues;
        var name = general.businessName || 'Vaultique Boutique Point';
        preview.innerHTML = '';

        var order = C.fill(v.orderMessage, {
          business: name, product: 'Aurelia Silk Blouse',
          sku: 'WF-AUSI-CR-S', price: 'K920'
        });
        var enquiry = C.fill(v.enquiryMessage, { business: name });

        preview.appendChild(bubble('When someone taps Buy on WhatsApp',
          order, C.waUrl(v.orderNumber || v.whatsapp, order)));
        preview.appendChild(bubble('When someone taps Enquire',
          enquiry, C.waUrl(v.enquiryNumber || v.orderNumber || v.whatsapp, enquiry)));

        var unknown = [];
        [v.orderMessage, v.enquiryMessage].forEach(function (t) {
          String(t || '').replace(/\{(\w+)\}/g, function (whole, key) {
            if (['business', 'product', 'sku', 'price'].indexOf(key) < 0 &&
                unknown.indexOf(whole) < 0) unknown.push(whole);
            return whole;
          });
        });
        if (unknown.length) {
          var w = mk('div', 'warn');
          w.innerHTML = '<span>⚠</span><span>' + esc(unknown.join(', ')) +
            (unknown.length > 1 ? ' are not things' : ' is not something') +
            ' the shop knows how to fill in, so it will be sent to the customer exactly as written.' +
            ' The ones that work are {business}, {product}, {sku} and {price}.</span>';
          preview.appendChild(w);
        }
      }

      function bubble(caption, text, href) {
        var d = mk('div', 'msg-prev');
        d.appendChild(mk('div', 'msg-cap', caption));
        d.appendChild(mk('div', 'msg-body', text));
        var foot = mk('div', 'msg-foot');
        if (href) {
          foot.textContent = 'Goes to ' + href.replace(/^https:\/\//, '').split('?')[0];
        } else {
          foot.textContent = 'No number set, so this link will be hidden.';
          foot.className = 'msg-foot none';
        }
        d.appendChild(foot);
        return d;
      }

      /* ---- the form ---- */
      var formHost = document.createElement('div');
      host.appendChild(formHost);

      ctx.ui.form(formHost, {
        key: 'contact',
        savedMessage: 'Saved ✓ — the site picks this up within about a minute',
        onChange: function (values, form) { lastValues = values; seedHours(values, form); repaint(); },
        afterLoad: function (values, form) { lastValues = values; seedHours(values, form); repaint(); },

        groups: [
          {
            title: 'Contact',
            note: 'Leave anything blank and the site simply does not show it.',
            fields: [
              { type: 'text', name: 'phone', label: 'Business phone', half: true,
                placeholder: '+260 …', maxLength: 30, validate: checkNumber,
                hint: 'Shown as a link that dials.' },
              { type: 'text', name: 'whatsapp', label: 'WhatsApp number', half: true,
                placeholder: '+260 …', maxLength: 30, validate: checkNumber,
                hint: 'The main number, used where no more specific one is set below.' },
              { type: 'text', name: 'email', label: 'Business email', half: true,
                maxLength: 120, validate: checkEmail,
                hint: 'For records and suppliers.' },
              { type: 'text', name: 'supportEmail', label: 'Customer support email', half: true,
                maxLength: 120, validate: checkEmail,
                hint: 'What customers see. Falls back to the business email.' },
              { type: 'text', name: 'mapsUrl', label: 'Google Maps location',
                maxLength: 400, placeholder: 'https://maps.app.goo.gl/…',
                hint: 'Open your shop in Google Maps, tap Share, and paste the link. ' +
                      'Left blank, the address above is used to search instead.' },
              { type: 'toggle', name: 'supportHoursOverride',
                label: 'Support hours differ from trading hours',
                hint: 'Off means the trading hours from General are used.' },
              { type: 'hours', name: 'supportHours', label: 'Support hours',
                showIf: function (v) { return !!v.supportHoursOverride; },
                hint: 'When messages get answered, which may run later than the shop is open.' }
            ]
          },
          {
            title: 'Social media',
            note: 'Type the handle only. An icon appears in the footer for each one you fill in, ' +
                  'and nothing appears for the ones you leave empty.',
            fields: C.SOCIALS.map(socialField)
          },
          {
            title: 'WhatsApp',
            note: 'Orders and enquiries can go to different phones. Leave either blank to use ' +
                  'the WhatsApp number above.',
            fields: [
              { type: 'text', name: 'orderNumber', label: 'Order WhatsApp number', half: true,
                placeholder: '+260 …', maxLength: 30, validate: checkNumber },
              { type: 'text', name: 'enquiryNumber', label: 'General enquiry WhatsApp number',
                half: true, placeholder: '+260 …', maxLength: 30, validate: checkNumber },
              { type: 'textarea', name: 'orderMessage', label: 'Default order message',
                rows: 3, maxLength: 400, required: true,
                hint: 'Pre-filled when someone buys a piece. Takes {business}, {product}, {sku} and {price}.' },
              { type: 'textarea', name: 'enquiryMessage', label: 'Default enquiry message',
                rows: 2, maxLength: 400, required: true,
                hint: 'Pre-filled for a general enquiry. Takes {business}.' }
            ]
          }
        ],

        validate: function (values, fail) {
          if (!values.orderNumber && !values.whatsapp) {
            fail('orderNumber', 'Give either this or the WhatsApp number above, or customers ' +
                               'will have no way to order.');
          }
        }
      });

      /* Half-width fields are drawn inside a shared row, so the element
         holding a field is not always the field itself. Walk up to the
         card's own child before inserting anything next to it. */
      function childOf(card, node) {
        var n = node;
        while (n && n.parentNode !== card) n = n.parentNode;
        return n;
      }

      /* Slot in the two read-only notes and the message preview once the
         form has drawn its cards. */
      var tries = 0;
      (function attach() {
        var cards = formHost.querySelectorAll('.card');
        var contactCard = null, waCard = null;
        for (var i = 0; i < cards.length; i++) {
          var h = cards[i].querySelector('h3');
          if (!h) continue;
          if (h.textContent === 'Contact') contactCard = cards[i];
          if (h.textContent === 'WhatsApp') waCard = cards[i];
        }
        if (!contactCard || !waCard) {
          if (tries++ < 60) setTimeout(attach, 50);
          return;
        }

        var addrBox = mk('div', 'field');
        addrBox.appendChild(mk('label', null, 'Physical address'));
        var moved = mk('p', 'moved');
        moved.appendChild(document.createTextNode('Kept with the city and country in '));
        var go = document.createElement('button');
        go.type = 'button';
        go.textContent = 'Settings › General';
        go.addEventListener('click', function () { ctx.navigate('settings', 'general'); });
        moved.appendChild(go);
        moved.appendChild(document.createTextNode('. It currently reads:'));
        addrBox.appendChild(moved);
        addressLine = mk('div', 'ro-line', describeAddress());
        addrBox.appendChild(addressLine);
        var firstField = childOf(contactCard, contactCard.querySelector('.field'));
        if (firstField) contactCard.insertBefore(addrBox, firstField);
        else contactCard.appendChild(addrBox);

        var hoursBox = mk('div', 'field');
        hoursBox.appendChild(mk('div', 'hint', 'Trading hours, from General:'));
        hoursLine = mk('div', 'ro-line', trading());
        hoursBox.appendChild(hoursLine);
        var toggle = contactCard.querySelector('#f_supportHoursOverride');
        var tf = toggle ? childOf(contactCard, toggle) : null;
        if (tf) contactCard.insertBefore(hoursBox, tf);
        else contactCard.appendChild(hoursBox);

        preview = mk('div', 'msg-prevs');
        waCard.appendChild(preview);
        repaint();
      })();
    }
  });

  function mk(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
})();
