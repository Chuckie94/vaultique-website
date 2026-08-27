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
    maintenanceMessage: 'We are making a few improvements and will be back shortly. ' +
                        'For anything urgent, please message us on WhatsApp.'
  };

  A.store.registerDefaults('general', DEFAULTS);

  /* ---- the page ------------------------------------------------------ */

  A.registerSetting({
    key: 'general',
    title: 'General',
    summary: 'Business name, branch details, trading hours, currency and time zone.',
    render: function (host, ctx) {
      ctx.ui.form(host, {
        key: 'general',
        savedMessage: 'Saved ✓ — the site picks this up within about a minute',

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
                hint: 'The address customers use to find the shop.' }
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
                hint: 'What customers see while maintenance mode is on.' }
            ]
          }
        ]
      });
    }
  });
})();
