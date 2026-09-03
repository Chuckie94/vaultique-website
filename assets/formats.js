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

  /* The shop's own money style, gathered in one place. Settings > General
     chooses the currency and the separators; Settings > Pricing chooses
     the symbol, which side it sits on and how many decimals are shown.
     Anything missing falls back to what the shop looked like before those
     settings existed, so a shop that has never opened Pricing is unchanged. */
  function moneyStyle(general, pricing) {
    general = general || {}; pricing = pricing || {};
    var code = general.currency || 'ZMW';
    return {
      currency: code,
      symbol: String(pricing.currencySymbol || '').trim() || symbol(code),
      position: pricing.currencyPosition || 'before',
      decimals: pricing.decimalPlaces || 'auto',
      numberFormat: general.numberFormat || '1,234.56',
      /* Carried with the money because it travels with it: a promotion's
         dates are the shop's dates, and this is the only thing handed to
         priceView that has ever been told where the shop is. */
      timezone: general.timezone || ''
    };
  }

  /* Puts the symbol on the side the shop asked for. The space, where there
     is one, is a non-breaking one: a price must never wrap between its
     symbol and its digits. */
  function place(sym, digits, position) {
    switch (position) {
      case 'after':        return digits + sym;
      case 'after-space':  return digits + ' ' + sym;
      case 'before-space': return sym + ' ' + digits;
      default:             return sym + digits;
    }
  }

  /* money(value, currency, numberFormat, forceDecimals) still works exactly
     as it did. Pass a style object as the second argument instead and the
     symbol, its side and the decimal places all come from the shop's own
     settings. */
  function money(value, currencyOrStyle, numberFormat, forceDecimals) {
    if (currencyOrStyle && typeof currencyOrStyle === 'object') {
      var st = currencyOrStyle;
      var digits;
      if (st.decimals === '0' || st.decimals === 0) {
        digits = number(Math.round(toNum(value)), st.numberFormat, false);
      } else if (st.decimals === '2' || st.decimals === 2) {
        digits = number(value, st.numberFormat, true);
      } else {
        digits = number(value, st.numberFormat, !!forceDecimals);
      }
      return place(st.symbol, digits, st.position);
    }
    return symbol(currencyOrStyle) + number(value, numberFormat, forceDecimals);
  }

  /* ---- what a price says ---------------------------------------------

     One product, one answer. The card, the quick view, the detail page,
     the search row and the WhatsApp message all ask this, so none of them
     can ever disagree about what a piece costs.

       p        a product from the feed, carrying its saved meta
       pricing  Settings > Pricing
       style    from moneyStyle() above

     Returns { onRequest, now, nowText, wasText, offText, percent, saved,
     tax, isSale, overridden }. `now` is the number to send to WhatsApp and
     to sort by; the rest is text for the page, and each piece of it is ''
     when there is nothing to say. */
  function priceView(p, pricing, style, opts) {
    p = p || {}; pricing = pricing || {}; opts = opts || {};
    var out = { onRequest: false, now: toNum(p.price), nowText: '', wasText: '',
                offText: '', percent: 0, saved: 0, tax: '', isSale: false,
                overridden: false };

    if (p.priceOnRequest && pricing.onRequestEnabled !== false) {
      out.onRequest = true;
      out.nowText = pricing.onRequestText || 'Price on request';
      out.now = 0;
      return out;
    }

    /* An override replaces the till's price outright. A reduction is a
       different thing: the till's own price, marked as having come down. */
    var base = toNum(p.price);
    if (pricing.overridesEnabled && toNum(p.priceOverride) > 0) {
      base = toNum(p.priceOverride);
      out.overridden = true;
    }

    var was = 0;
    if (!out.overridden && pricing.trackReductions !== false) was = toNum(p.wasPrice);
    if (was > 0 && !isRealReduction(was, base, pricing)) was = 0;

    /* A shop-wide promotion applies only where the till has not already
       brought the price down. A piece is never reduced twice. */
    if (!was && !out.overridden) {
      var promo = promoCut(p, pricing, opts.now, style && style.timezone);
      if (promo > 0 && promo < base) { was = base; base = promo; }
    }

    out.now = base;
    out.nowText = money(base, style);

    if (was > base && pricing.showSalePrice !== false) {
      out.isSale = true;
      out.saved = Math.round((was - base) * 100) / 100;
      out.percent = Math.round((was - base) / was * 100);
      if (pricing.showOriginalPrice !== false) out.wasText = money(was, style);
      if (pricing.showDiscountPercent !== false && out.percent > 0) {
        out.offText = '-' + out.percent + '%';
      }
    }

    out.tax = taxLine(pricing);
    return out;
  }

  /* A price that moved by a hair is a correction, not a sale, and the shop
     should not shout about it. Where "a hair" ends is the shop's to set. */
  function isRealReduction(was, now, pricing) {
    pricing = pricing || {};
    if (!(was > now)) return false;
    var floor = Number(pricing.minReductionPercent);
    if (!isFinite(floor) || floor < 0) floor = 5;
    return (was - now) / was * 100 >= floor;
  }

  /* What a shop-wide promotion brings one piece down to, or 0 when it does
     not apply to it, is switched off, or is outside its dates. */
  function promoCut(p, pricing, nowDate, timezone) {
    p = p || {}; pricing = pricing || {};
    if (!pricing.promoEnabled) return 0;

    var today = dayStampInZone(timezone, nowDate || new Date());
    if (pricing.promoFrom && today < pricing.promoFrom) return 0;
    if (pricing.promoTo && today > pricing.promoTo) return 0;

    if (pricing.promoScope === 'categories') {
      var want = String(pricing.promoCategories || '').split(',').map(trimLower).filter(Boolean);
      if (!want.length) return 0;
      if (want.indexOf(trimLower(p.category)) < 0) return 0;
    }

    var base = toNum(p.price), amount = toNum(pricing.promoAmount);
    if (!(base > 0) || !(amount > 0)) return 0;

    var cut = pricing.promoType === 'amount' ? base - amount
                                             : base - (base * amount / 100);
    return cut > 0 ? Math.round(cut * 100) / 100 : 0;
  }

  /* The line under a price about tax. Empty when the shop would rather not
     raise the subject at all. */
  function taxLine(pricing) {
    pricing = pricing || {};
    var mode = pricing.taxMode || 'none';
    if (mode !== 'included' && mode !== 'excluded') return '';
    var rate = Number(pricing.taxRate);
    var label = String(pricing.taxLabel || '').trim() || 'VAT';
    var rateText = (isFinite(rate) && rate > 0)
      ? (Math.round(rate * 100) / 100) + '% ' + label
      : label;
    return mode === 'included' ? 'Price includes ' + rateText
                               : rateText + ' added at checkout';
  }

  function toNum(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function trimLower(s) { return String(s == null ? '' : s).trim().toLowerCase(); }
  function dayStamp(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  /* Today's date as the shop counts it, rather than as the visitor's
     computer does. A sale set to end on the 31st has to end at one
     moment for everybody, and that moment is the shop's midnight — not
     a different one for every customer, and not one the admin's own
     preview disagrees with. Trading hours already worked this way; the
     promotion dates did not.

     No timezone, or a name this browser has never heard of, falls back
     to the old behaviour rather than to nothing: a shop that has not
     filled the setting in still sells. */
  function dayStampInZone(timezone, d) {
    var when = d || new Date();
    if (!timezone) return dayStamp(when);
    try {
      var parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'
      }).formatToParts(when);
      var got = {};
      parts.forEach(function (p) { got[p.type] = p.value; });
      if (!got.year || !got.month || !got.day) return dayStamp(when);
      return got.year + '-' + got.month + '-' + got.day;
    } catch (e) {
      return dayStamp(when);
    }
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

    /* A window that ends before it starts is one that crosses midnight —
       20:00 to 02:00 is a shop open late, not a shop shut. It used to
       read as closed all evening while the page beside it printed
       "Mon 8pm-2am", so the site disagreed with itself.

       An overnight window belongs to the day it began on: at one in the
       morning the shop is inside Monday's 20:00-02:00, not Tuesday's, so
       yesterday is asked first. */
    var yest = hours[DAYS[(now.dayIndex + 6) % 7].key];
    if (yest && yest.open) {
      var yFrom = minutes(yest.from), yTo = minutes(yest.to);
      if (yFrom >= 0 && yTo >= 0 && yTo <= yFrom && now.minutes < yTo) {
        return { known: true, open: true, text: 'Open now · until ' + prettyTime(yest.to) };
      }
    }

    var today = hours[DAYS[now.dayIndex].key];
    if (today && today.open) {
      var from = minutes(today.from), to = minutes(today.to);
      if (from >= 0 && to >= 0) {
        var overnight = to <= from;
        var inside = overnight ? (now.minutes >= from || now.minutes < to)
                               : (now.minutes >= from && now.minutes < to);
        if (inside) {
          return { known: true, open: true, text: 'Open now · until ' + prettyTime(today.to) };
        }
        if (now.minutes < from) {
          return { known: true, open: false, text: 'Closed · opens ' + prettyTime(today.from) };
        }
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
    moneyStyle: moneyStyle,
    priceView: priceView,
    taxLine: taxLine,
    promoCut: promoCut,
    dayStampInZone: dayStampInZone,
    isRealReduction: isRealReduction,
    date: date,
    minutes: minutes,
    prettyTime: prettyTime,
    summariseHours: summariseHours,
    nowInZone: nowInZone,
    openState: openState
  };
})();
