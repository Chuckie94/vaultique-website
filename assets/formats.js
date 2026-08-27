/* =====================================================================
   Vaultique Boutique Point - shared formatting
   ---------------------------------------------------------------------
   Turns the values held in Settings > General into the text customers
   read. Loaded by both the storefront and the admin so that a price, a
   date or a line of trading hours is written the same way in both, and
   the admin's preview of the hours matches what the site actually says.

   No dependencies, no database access. Pure functions over plain values.
   ===================================================================== */
(function () {
  'use strict';

  var DAYS = [
    { key: 'mon', label: 'Monday' },
    { key: 'tue', label: 'Tuesday' },
    { key: 'wed', label: 'Wednesday' },
    { key: 'thu', label: 'Thursday' },
    { key: 'fri', label: 'Friday' },
    { key: 'sat', label: 'Saturday' },
    { key: 'sun', label: 'Sunday' }
  ];

  var CURRENCY = {
    ZMW: 'K', USD: '$', ZAR: 'R', GBP: '£', EUR: '€',
    BWP: 'P', MWK: 'MK', TZS: 'TSh', KES: 'KSh', NGN: '₦',
    AED: 'د.إ', CNY: '¥'
  };

  /* thousands and decimal separator for each of the four choices */
  var NUMBER = {
    '1,234.56': { group: ',',      dec: '.' },
    /* the key holds a plain space so it matches the admin's option value;
       the separator itself is U+00A0 so a price never wraps mid-number */
    '1 234,56': { group: ' ', dec: ',' },
    '1.234,56': { group: '.',      dec: ',' },
    '1234.56':  { group: '',       dec: '.' }
  };

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  /* ---- numbers and money ------------------------------------------- */

  function groupDigits(intPart, sep) {
    if (!sep) return intPart;
    return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  }

  /* 1234.5 -> '1,234.50' in the chosen style. Decimals appear only when
     the amount actually has them, which is how the shop has always
     shown its prices. */
  function number(value, numberFormat, forceDecimals) {
    var spec = NUMBER[numberFormat] || NUMBER['1,234.56'];
    var n = Number(value);
    if (!isFinite(n)) n = 0;
    var neg = n < 0;
    n = Math.abs(n);

    var rounded = Math.round(n * 100) / 100;
    var wantDec = forceDecimals || (rounded % 1 !== 0);
    var text = rounded.toFixed(wantDec ? 2 : 0);
    var bits = text.split('.');
    var out = groupDigits(bits[0], spec.group) + (bits[1] ? spec.dec + bits[1] : '');
    return (neg ? '-' : '') + out;
  }

  function symbol(currency) {
    return CURRENCY[currency] || (currency ? currency + ' ' : 'K');
  }

  function money(value, currency, numberFormat, forceDecimals) {
    return symbol(currency) + number(value, numberFormat, forceDecimals);
  }

  /* ---- dates -------------------------------------------------------- */

  function date(value, dateFormat) {
    var d = (value instanceof Date) ? value : new Date(value);
    if (isNaN(d.getTime())) return '';
    var D = d.getDate(), M = d.getMonth(), Y = d.getFullYear();
    switch (dateFormat) {
      case 'MM/DD/YYYY':  return pad(M + 1) + '/' + pad(D) + '/' + Y;
      case 'YYYY-MM-DD':  return Y + '-' + pad(M + 1) + '-' + pad(D);
      case 'D MMMM YYYY': return D + ' ' + MONTHS[M] + ' ' + Y;
      case 'MMMM D, YYYY':return MONTHS[M] + ' ' + D + ', ' + Y;
      default:            return pad(D) + '/' + pad(M + 1) + '/' + Y;
    }
  }

  /* ---- times and trading hours -------------------------------------- */

  /* Minutes since midnight, or -1 when the time is not a valid HH:MM. */
  function minutes(hhmm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
    if (!m) return -1;
    var h = parseInt(m[1], 10), mi = parseInt(m[2], 10);
    if (h < 0 || h > 23 || mi < 0 || mi > 59) return -1;
    return h * 60 + mi;
  }

  /* '09:00' -> '9am', '17:30' -> '5.30pm' */
  function prettyTime(hhmm) {
    var t = minutes(hhmm);
    if (t < 0) return hhmm || '';
    var h = Math.floor(t / 60), mi = t % 60;
    var suffix = h < 12 ? 'am' : 'pm';
    var h12 = h % 12; if (h12 === 0) h12 = 12;
    return h12 + (mi ? '.' + pad(mi) : '') + suffix;
  }

  /* A one line summary of the week, collapsing runs of identical days:
     'Mon-Sat 9am-6pm · Sun closed'. */
  function summariseHours(hours) {
    hours = hours || {};
    var runs = [], cur = null;
    for (var i = 0; i < DAYS.length; i++) {
      var d = hours[DAYS[i].key] || { open: false };
      var sig = d.open ? (d.from + '-' + d.to) : 'closed';
      if (cur && cur.sig === sig) { cur.end = i; continue; }
      cur = { sig: sig, start: i, end: i, day: d };
      runs.push(cur);
    }
    if (!runs.length) return '';
    return runs.map(function (r) {
      var name = DAYS[r.start].label.slice(0, 3);
      if (r.end !== r.start) name += '-' + DAYS[r.end].label.slice(0, 3);
      if (!r.day.open) return name + ' closed';
      return name + ' ' + prettyTime(r.day.from) + '-' + prettyTime(r.day.to);
    }).join(' · ');
  }

  /* Where the clock stands in the shop's own time zone. Returns null if
     the browser cannot work with the zone, and every caller treats that
     as "do not claim to know whether we are open". */
  function nowInZone(timezone) {
    try {
      var parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone || 'UTC',
        weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false
      }).formatToParts(new Date());

      var got = {};
      parts.forEach(function (p) { got[p.type] = p.value; });
      var idx = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(got.weekday);
      if (idx < 0) return null;

      var h = parseInt(got.hour, 10);
      if (h === 24) h = 0;                       // some engines report midnight as 24
      return { dayIndex: idx, minutes: h * 60 + parseInt(got.minute, 10) };
    } catch (e) {
      return null;
    }
  }

  /* Is the shop open right now, and what should we say about it?
       { known: false }                              cannot tell
       { known: true, open: true,  text: '...' }     open, with closing time
       { known: true, open: false, text: '...' }     closed, with next opening */
  function openState(hours, timezone) {
    hours = hours || {};
    var now = nowInZone(timezone);
    if (!now) return { known: false, open: false, text: '' };

    var today = hours[DAYS[now.dayIndex].key];
    if (today && today.open) {
      var from = minutes(today.from), to = minutes(today.to);
      if (from >= 0 && to > from && now.minutes >= from && now.minutes < to) {
        return { known: true, open: true, text: 'Open now · until ' + prettyTime(today.to) };
      }
      if (from >= 0 && now.minutes < from) {
        return { known: true, open: false, text: 'Closed · opens ' + prettyTime(today.from) };
      }
    }

    /* Not open today, or already shut for the day: look ahead a week. */
    for (var step = 1; step <= 7; step++) {
      var d = DAYS[(now.dayIndex + step) % 7];
      var day = hours[d.key];
      if (!day || !day.open || minutes(day.from) < 0) continue;
      var when = (step === 1) ? 'tomorrow' : d.label;
      return { known: true, open: false, text: 'Closed · opens ' + when + ' ' + prettyTime(day.from) };
    }
    return { known: true, open: false, text: 'Closed' };
  }

  window.VBP_FORMAT = {
    DAYS: DAYS,
    CURRENCY: CURRENCY,
    symbol: symbol,
    number: number,
    money: money,
    date: date,
    minutes: minutes,
    prettyTime: prettyTime,
    summariseHours: summariseHours,
    nowInZone: nowInZone,
    openState: openState
  };
})();
