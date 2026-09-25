/* =====================================================================
   Vaultique Boutique Point - Admin > Settings > General
   ---------------------------------------------------------------------
   Who the business is, where it trades, how it shows numbers and dates,
   when it is open, and whether the website is currently serving
   customers.

   This section is the single source of truth for the business name,
   tagline and trading hours. The Site Content tab used to carry its own
   tagline and support-hours boxes; those have been removed so one value
   cannot disagree with itself in two places.

   The storefront reads this row directly out of site_settings, so
   nothing here needs copying anywhere else.
   ===================================================================== */
(function () {
  'use strict';
  if (!window.VBP_ADMIN) return;

  var A = window.VBP_ADMIN;

  /* ---- choices ------------------------------------------------------ */

  function opts(list) {
    return list.map(function (x) {
      return (typeof x === 'string') ? { value: x, label: x } : x;
    });
  }

  /* Zambia and its neighbours first, since that is where the shop
     trades, then the rest alphabetically. */
  var COUNTRIES = opts([
    'Zambia', 'Angola', 'Botswana', 'Democratic Republic of the Congo', 'Malawi',
    'Mozambique', 'Namibia', 'South Africa', 'Tanzania', 'Zimbabwe',
    'Algeria', 'Benin', 'Burkina Faso', 'Burundi', 'Cameroon', 'Cape Verde',
    'Central African Republic', 'Chad', 'Comoros', 'Republic of the Congo',
    'Ivory Coast', 'Djibouti', 'Egypt', 'Equatorial Guinea', 'Eritrea',
    'Eswatini', 'Ethiopia', 'Gabon', 'Gambia', 'Ghana', 'Guinea',
    'Guinea-Bissau', 'Kenya', 'Lesotho', 'Liberia', 'Libya', 'Madagascar',
    'Mali', 'Mauritania', 'Mauritius', 'Morocco', 'Niger', 'Nigeria',
    'Rwanda', 'Sao Tome and Principe', 'Senegal', 'Seychelles',
    'Sierra Leone', 'Somalia', 'South Sudan', 'Sudan', 'Togo', 'Tunisia',
    'Uganda',
    'Australia', 'Belgium', 'Brazil', 'Canada', 'China', 'Denmark', 'France',
    'Germany', 'India', 'Ireland', 'Italy', 'Japan', 'Netherlands',
    'New Zealand', 'Norway', 'Portugal', 'Qatar', 'Saudi Arabia', 'Singapore',
    'Spain', 'Sweden', 'Switzerland', 'Turkey', 'United Arab Emirates',
    'United Kingdom', 'United States'
  ]);

  var TIMEZONES = opts([
    { value: 'Africa/Lusaka', label: 'Africa/Lusaka — Central Africa Time (CAT, UTC+2)' },
    { value: 'Africa/Harare', label: 'Africa/Harare — CAT (UTC+2)' },
    { value: 'Africa/Johannesburg', label: 'Africa/Johannesburg — SAST (UTC+2)' },
    { value: 'Africa/Maputo', label: 'Africa/Maputo — CAT (UTC+2)' },
    { value: 'Africa/Gaborone', label: 'Africa/Gaborone — CAT (UTC+2)' },
    { value: 'Africa/Blantyre', label: 'Africa/Blantyre — CAT (UTC+2)' },
    { value: 'Africa/Windhoek', label: 'Africa/Windhoek — CAT (UTC+2)' },
    { value: 'Africa/Nairobi', label: 'Africa/Nairobi — EAT (UTC+3)' },
    { value: 'Africa/Dar_es_Salaam', label: 'Africa/Dar es Salaam — EAT (UTC+3)' },
    { value: 'Africa/Kampala', label: 'Africa/Kampala — EAT (UTC+3)' },
    { value: 'Africa/Kinshasa', label: 'Africa/Kinshasa — WAT (UTC+1)' },
    { value: 'Africa/Lagos', label: 'Africa/Lagos — WAT (UTC+1)' },
    { value: 'Africa/Accra', label: 'Africa/Accra — GMT (UTC+0)' },
    { value: 'Africa/Cairo', label: 'Africa/Cairo — EET (UTC+2)' },
    { value: 'Europe/London', label: 'Europe/London — GMT/BST' },
    { value: 'Europe/Paris', label: 'Europe/Paris — CET/CEST' },
    { value: 'Asia/Dubai', label: 'Asia/Dubai — GST (UTC+4)' },
    { value: 'Asia/Shanghai', label: 'Asia/Shanghai — CST (UTC+8)' },
    { value: 'America/New_York', label: 'America/New York — ET' },
    { value: 'UTC', label: 'UTC — Coordinated Universal Time' }
  ]);

  var CURRENCIES = opts([
    { value: 'ZMW', label: 'ZMW — Zambian Kwacha (K)' },
    { value: 'USD', label: 'USD — US Dollar ($)' },
    { value: 'ZAR', label: 'ZAR — South African Rand (R)' },
    { value: 'GBP', label: 'GBP — Pound Sterling (£)' },
    { value: 'EUR', label: 'EUR — Euro (€)' },
    { value: 'BWP', label: 'BWP — Botswana Pula (P)' },
    { value: 'MWK', label: 'MWK — Malawian Kwacha (MK)' },
    { value: 'TZS', label: 'TZS — Tanzanian Shilling (TSh)' },
    { value: 'KES', label: 'KES — Kenyan Shilling (KSh)' },
    { value: 'NGN', label: 'NGN — Nigerian Naira (₦)' },
    { value: 'AED', label: 'AED — UAE Dirham (د.إ)' },
    { value: 'CNY', label: 'CNY — Chinese Yuan (¥)' }
  ]);

  var DATE_FORMATS = opts([
    { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY — 26/08/2026' },
    { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY — 08/26/2026' },
    { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD — 2026-08-26' },
    { value: 'D MMMM YYYY', label: 'D MMMM YYYY — 26 August 2026' },
    { value: 'MMMM D, YYYY', label: 'MMMM D, YYYY — August 26, 2026' }
  ]);

  var NUMBER_FORMATS = opts([
    { value: '1,234.56', label: '1,234.56 — comma thousands, full stop decimal' },
    { value: '1 234,56', label: '1 234,56 — space thousands, comma decimal' },
    { value: '1.234,56', label: '1.234,56 — full stop thousands, comma decimal' },
    { value: '1234.56', label: '1234.56 — no thousands separator' }
  ]);

  var WEBSITE_STATUS = opts([
    { value: 'live', label: 'Live — open to customers' },
    { value: 'coming-soon', label: 'Coming soon — holding page, no shopping' },
    { value: 'closed', label: 'Closed — temporarily not trading' }
  ]);

  /* ---- defaults ----------------------------------------------------- */

  var DEFAULTS = {
    businessName: 'Vaultique Boutique Point',
    tradingName: '',
    registrationNumber: '',
    tagline: 'Curated Elegance, Accessible Luxury',
    description: '',
    country: 'Zambia',
    city: 'Lusaka',
    address: '',
    locations: [],
    mapPoints: [],
    timezone: 'Africa/Lusaka',
    currency: 'ZMW',
    dateFormat: 'DD/MM/YYYY',
    numberFormat: '1,234.56',
    businessHours: {
      mon: { open: true,  from: '09:00', to: '18:00' },
      tue: { open: true,  from: '09:00', to: '18:00' },
      wed: { open: true,  from: '09:00', to: '18:00' },
      thu: { open: true,  from: '09:00', to: '18:00' },
      fri: { open: true,  from: '09:00', to: '18:00' },
      sat: { open: true,  from: '09:00', to: '16:00' },
      sun: { open: false, from: '09:00', to: '16:00' }
    },
    websiteStatus: 'live',
    maintenanceMode: false,
    previewKey: '',
    maintenanceMessage: 'We are making a few improvements and will be back shortly. ' +
                        'For anything urgent, please message us on WhatsApp.'
  };

  A.store.registerDefaults('general', DEFAULTS);

  /* ---- map pins ------------------------------------------------------ */

  var lastMissed = [];
  var known = {};         // address -> {lat, lng}, from the last save

  /* OpenStreetMap's address search: free, no key, and it answers a
     browser directly. Its rule is at most one question a second, so the
     places are asked one after another with a pause between. */
  function lookUp(q) {
    return fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' +
                 encodeURIComponent(q), { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) {
        var r = rows && rows[0];
        var lat = r && Number(r.lat), lng = r && Number(r.lon);
        return (isFinite(lat) && isFinite(lng)) ? { lat: lat, lng: lng } : null;
      })
      .catch(function () { return null; });
  }
  function pause(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }
  function oneLine(s) { return String(s || '').replace(/\s*\n\s*/g, ', ').trim(); }

  function remember(points) {
    (Array.isArray(points) ? points : []).forEach(function (m) {
      if (m && m.query && isFinite(m.lat) && isFinite(m.lng)) known[m.query] = { lat: m.lat, lng: m.lng };
    });
  }
  function pinPlaces(values) {
    var country = values.country || '';
    var places = [];
    var main = oneLine(values.address);
    if (main || values.city) {
      places.push({ name: values.businessName || 'Our shop', address: main || values.city,
                    query: [main, values.city, country].filter(Boolean).join(', ') });
    }
    (Array.isArray(values.locations) ? values.locations : []).forEach(function (l) {
      var a = oneLine(l && l.address);
      if (!a) return;
      places.push({ name: l.name || a, address: a, query: [a, country].filter(Boolean).join(', ') });
    });

    var out = [], missed = [], chain = Promise.resolve(), asked = 0;
    places.forEach(function (pl) {
      chain = chain.then(function () {
        if (known[pl.query]) return known[pl.query];
        var wait = asked++ ? pause(1100) : Promise.resolve();
        return wait.then(function () { return lookUp(pl.query); });
      }).then(function (at) {
        if (at) { known[pl.query] = at; out.push({ name: pl.name, address: pl.address, query: pl.query, lat: at.lat, lng: at.lng }); }
        else missed.push(pl.name);
      });
    });
    return chain.then(function () { values.mapPoints = out; return missed; });
  }

  /* ---- the page ------------------------------------------------------ */

  A.registerSetting({
    key: 'general',
    title: 'General',
    summary: 'Business name, branch details, trading hours, currency and time zone.',
    render: function (host, ctx) {
      ctx.ui.form(host, {
        key: 'general',
        savedMessage: 'Saved ✓ — the site picks this up within about a minute',

        /* THE MAP PINS. The website map has to know where each place is,
           not just what it is called, so each address is looked up once,
           here, when it is saved -- not by every visitor on every visit.
           An address that has not changed keeps the position it had. One
           that cannot be found is still saved and listed; it just has no
           pin, and the owner is told which. */
        afterLoad: function (values) { remember(values.mapPoints); },
        beforeSave: function (values) {
          return pinPlaces(values).then(function (missed) {
            lastMissed = missed;
            return values;
          });
        },
        afterSave: function () {
          if (lastMissed.length && ctx.tell) {
            ctx.tell('Saved. These could not be found on the map, so they have no pin: ' +
                     lastMissed.join('; ') + '. Try writing the address the way Google Maps ' +
                     'shows it, with the town.');
          }
        },

        groups: [
          {
            title: 'Business identity',
            note: 'How the business is named on the website and in messages to customers.',
            fields: [
              { type: 'text', name: 'businessName', label: 'Business name',
                required: true, maxLength: 80,
                hint: 'The registered name of the business.' },
              { type: 'text', name: 'tradingName', label: 'Trading name', half: true,
                maxLength: 80, placeholder: 'Only if you trade under a different name' },
              { type: 'text', name: 'registrationNumber', label: 'Business registration number',
                half: true, maxLength: 40, placeholder: 'PACRA number' },
              { type: 'text', name: 'tagline', label: 'Tagline', maxLength: 90,
                hint: 'The short line under the logo and in the footer.' },
              { type: 'textarea', name: 'description', label: 'Business description',
                rows: 4, maxLength: 400,
                hint: 'A paragraph about the shop. Used for search results and sharing previews.' }
            ]
          },
          {
            title: 'Where you trade',
            fields: [
              { type: 'select', name: 'country', label: 'Country', half: true, options: COUNTRIES },
              { type: 'text', name: 'city', label: 'City', half: true, maxLength: 60 },
              { type: 'textarea', name: 'address', label: 'Physical address', rows: 3, maxLength: 200,
                hint: 'The address customers use to find the shop. It is the first pin on the map.' },
              { type: 'list', name: 'locations', label: 'Other shop locations',
                addLabel: 'Add a location', itemName: 'Location', max: 20,
                summary: function (row) { return row.name || row.address || 'New location'; },
                blank: function () { return { name: '', address: '' }; },
                fields: [
                  { type: 'text', name: 'name', label: 'Name', half: true, maxLength: 60,
                    required: true, placeholder: 'e.g. Lusaka, Manda Hill' },
                  { type: 'text', name: 'address', label: 'Address', half: true, maxLength: 200,
                    required: true, placeholder: 'Street, area, town' }
                ],
                hint: 'Every shop you list here gets its own pin on the website map, beside the ' +
                      'main address. Leave it empty if there is only the one.' }
            ]
          },
          {
            title: 'Region and formats',
            note: 'How times, prices and dates are read on the website.',
            fields: [
              { type: 'select', name: 'timezone', label: 'Time zone', options: TIMEZONES,
                hint: 'Trading hours and order times are shown in this zone.' },
              { type: 'select', name: 'currency', label: 'Default currency', half: true,
                options: CURRENCIES,
                hint: 'Prices come from the POS in this currency.' },
              { type: 'select', name: 'dateFormat', label: 'Date format', half: true,
                options: DATE_FORMATS },
              { type: 'select', name: 'numberFormat', label: 'Number format',
                options: NUMBER_FORMATS,
                hint: 'How thousands and decimals are separated in prices.' }
            ]
          },
          {
            title: 'Business hours',
            note: 'Switch a day off to show it as closed. Times are in the time zone set above.',
            fields: [
              { type: 'hours', name: 'businessHours', label: 'Trading hours' }
            ]
          },
          {
            title: 'Website status',
            note: 'Maintenance mode overrides the status above while it is on.',
            fields: [
              { type: 'select', name: 'websiteStatus', label: 'Website status',
                options: WEBSITE_STATUS,
                hint: 'The normal state of the site. Use maintenance mode for short interruptions.' },
              { type: 'toggle', name: 'maintenanceMode', label: 'Maintenance mode',
                hint: 'Shows the message below instead of the shop. Turn it off to trade again.' },
              { type: 'textarea', name: 'maintenanceMessage', label: 'Maintenance message',
                rows: 3, maxLength: 300, required: true,
                showIf: function (v) { return !!v.maintenanceMode; },
                hint: 'What customers see while maintenance mode is on.' },
              { type: 'text', name: 'previewKey', label: 'Preview key', maxLength: 60,
                hint: 'A word of your choosing. While the shop is shut, open it as ' +
                      'yourshop.com/?preview=THATWORD and you will see the real site ' +
                      'while everybody else still sees the notice. Leave it empty and ' +
                      'nobody gets past, yourself included.' },
              { type: 'note', name: 'previewNote', label: 'About the preview key',
                text: 'It keeps a customer from wandering in while you work; it is not ' +
                      'a password, and it is not meant to be. Orders, chats and the ' +
                      'product feed are all refused while the shop is shut, and this ' +
                      'key is what lets you test them anyway.' }
            ]
          }
        ]
      });
    }
  });
})();
