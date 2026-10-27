/* =====================================================================
   Vaultique Boutique Point - the layby estimate
   ---------------------------------------------------------------------
   What a piece comes to on layby, for the lines under its price on the
   product page:

     deposit             the price x the deposit percentage
     remaining balance   the price - the deposit
     each month          the remaining balance / the number of months

   Both figures are the shop's: Settings > Payments > Layby estimate.

   AN ESTIMATE AND NOTHING MORE. This file only does arithmetic. It does
   not start a layby, take a deposit or hold a piece back; a layby is
   still arranged with the shop, on the terms it confirms in writing.

   WORKED IN NGWEE. Whole ngwee, never fractions of a kwacha, so no
   floating-point dust gets in. The deposit is rounded to the nearest
   ngwee and the balance is the rest of the price, so the two always add
   up to it exactly. Each month is the balance shared out to the nearest
   ngwee, and the last month takes whatever that rounding left over.

   No dependencies, no database access. Pure functions over plain values.
   ===================================================================== */
(function () {
  'use strict';

  /* What Settings > Payments starts from, for a shop that has not saved
     that page since the estimate arrived. */
  var DEFAULTS = { deposit: 30, months: 6 };

  function given(v) { return !(v === undefined || v === null || v === ''); }

  function wholeMonths(n) { return isFinite(n) && n >= 1 && Math.floor(n) === n; }

  /* The shop's terms out of its payments settings, or null when they make
     no sense: a deposit of nothing or of more than the price, a period
     that is not a whole number of months. No estimate is better than a
     wrong one. */
  function terms(pay) {
    pay = pay || {};
    var deposit = given(pay.laybyDeposit) ? Number(pay.laybyDeposit) : DEFAULTS.deposit;
    var months = given(pay.laybyMonths) ? Number(pay.laybyMonths) : DEFAULTS.months;
    if (!isFinite(deposit) || deposit <= 0 || deposit > 100) return null;
    if (!wholeMonths(months)) return null;
    return { deposit: deposit, months: months };
  }

  /* price in kwacha, percent as 30 for 30%, months a whole number.
     Answers in kwacha, every figure exact to the ngwee, or null for a
     price of nothing or terms that make no sense. */
  function estimate(price, percent, months) {
    var total = Math.round(Number(price) * 100);
    var bp = Math.round(Number(percent) * 100);           // 30% is 3000
    months = Number(months);
    if (!isFinite(total) || total <= 0) return null;
    if (!isFinite(bp) || bp <= 0 || bp > 10000) return null;
    if (!wholeMonths(months)) return null;

    var deposit = Math.floor((total * bp + 5000) / 10000);       // nearest ngwee, halves up
    var balance = total - deposit;
    var each = Math.floor((2 * balance + months) / (2 * months));
    /* Only a balance of a few ngwee spread over many months gets here:
       rounded up, the months before the last would come to more than the
       balance. Rounded down instead, the last month is never below zero. */
    if (each * (months - 1) > balance) each = Math.floor(balance / months);
    var last = balance - each * (months - 1);

    return {
      price: total / 100, percent: bp / 100, months: months,
      deposit: deposit / 100, balance: balance / 100,
      monthly: each / 100, last: last / 100
    };
  }

  window.VBP_LAYBY = { DEFAULTS: DEFAULTS, terms: terms, estimate: estimate };
})();
