/* =====================================================================
   Vaultique Boutique Point — rewards, asked of the platform
   ---------------------------------------------------------------------
   THE PLATFORM OWNS THE POINTS. Earning, redeeming, the receipt and the
   books all happen there (its build 453). The website keeps no balance,
   no customer details and no sales of its own. It asks, at the moment it
   needs to, about ONE customer, and keeps nothing it was told.

   THE CUSTOMER NUMBER IS THE KEY. A website account is linked to the
   number printed on the customer's receipts (custNo), never to the
   platform's internal id, name, phone or email.

   WHAT LEAVES THIS FILE. Only ever, for one verified customer: the
   points, what they are worth in kwacha, and where they stand against
   the milestone. Never a name, a phone, an email or a sale. The email on
   the platform record is read only to send a code to it, and is never
   returned, logged or stored.

   READ ONLY. This file never writes to the platform. The tills save the
   business as one document with a careful conflict check; a second
   writer there is how a till's sale gets lost.

   THE FORMULA is the platform's own, js/services/loyaltyEngine.js at its
   build 453, copied function for function so the website and the till
   can never disagree. tests/rewards-engine.test.cjs runs the platform's
   own file beside this one when a copy is available, and fixed cases
   when it is not.
   ===================================================================== */
'use strict';

/* ---------------- the platform's formula (loyaltyEngine.js, build 453) */

function _sameId(a, b) { return a != null && b != null && String(a) === String(b); }

const POINTS_PER_K100 = 1;
const POINTS_PER_K1 = 100;
const WELCOME_POINTS = 500;

function pointsPer100(settings) {
  const v = Number(settings && settings.pointsPer100);
  return (isFinite(v) && v > 0) ? v : POINTS_PER_K100;
}
function pointsForSale(total, settings) { return Math.floor((Number(total) || 0) / 100) * pointsPer100(settings); }
function customerSales(custId, sales) {
  return (sales || []).filter((s) => !s.voided && _sameId(s.customerId, custId));
}
function _setting(v) { if (v === '' || v == null) return NaN; const n = Number(v); return isFinite(n) ? n : NaN; }
function rewardsCfg(settings) {
  const s = settings || {};
  const r = _setting(s.rewardsPointsPerK1), w = _setting(s.rewardsWelcomePoints);
  const m = _setting(s.rewardsMilestonePoints), v = _setting(s.rewardsMilestoneValue);
  const perK1 = r >= 0 ? r : POINTS_PER_K1;
  const welcome = w >= 0 ? Math.floor(w) : WELCOME_POINTS;
  const milestone = m > 0 ? Math.floor(m) : 0;
  const milestoneValue = v > 0 ? Math.round(v * 100) / 100 : 0;
  return { perK1, welcome, milestone, milestoneValue,
           perPoint: (milestone > 0 && milestoneValue > 0) ? milestoneValue / milestone : 0 };
}
function isMember(cust) {
  return !!cust && cust.id != null && cust.id !== '' && cust.type !== 'Walk-in';
}
function _settled(s) {
  const total = Number(s.total) || 0;
  const paid = (typeof s.amountPaid === 'number') ? s.amountPaid : total;
  return paid + 0.5 >= total;
}
function returnedValue(saleId, returns) {
  return (returns || []).reduce((a, r) => a + ((r && _sameId(r.saleId, saleId)) ? (Number(r.total) || 0) : 0), 0);
}
function earnedOnSale(sale, settings, returns) {
  if (!sale || sale.voided) return 0;
  if (sale.pointsRate == null) return pointsForSale(sale.total, settings);
  const rate = Number(sale.pointsRate) || 0;
  if (rate <= 0 || !_settled(sale)) return 0;
  const kept = Math.max(0, (Number(sale.total) || 0) - returnedValue(sale.id, returns));
  return Math.floor(kept + 1e-9) * rate;
}
function redeemedOnSale(sale) {
  return (!sale || sale.voided) ? 0 : Math.max(0, Number(sale.pointsRedeemed) || 0);
}
function pointsBalance(cust, sales, settings, returns) {
  if (!isMember(cust)) return 0;
  const mine = customerSales(cust.id, sales);
  const earned = mine.reduce((a, s) => a + earnedOnSale(s, settings, returns), 0);
  const used = mine.reduce((a, s) => a + redeemedOnSale(s), 0);
  return (Number(cust.welcomePoints) || 0) + earned - used;
}
function pointsWorth(points, settings) {
  const v = rewardsCfg(settings).perPoint;
  if (!(v > 0) || !(points > 0)) return 0;
  return Math.floor(points * v * 100 + 1e-6) / 100;
}
function redeemQuote(balance, due, settings) {
  const v = rewardsCfg(settings).perPoint;
  const d = Math.round((Number(due) || 0) * 100) / 100;
  if (!(v > 0) || !(balance > 0) || !(d >= 0.01)) return null;
  const worth = pointsWorth(balance, settings);
  if (!(worth >= 0.01)) return null;
  const value = Math.min(worth, d);
  const points = Math.min(Math.floor(balance), Math.ceil(value / v - 1e-6));
  return { points, value };
}
function milestoneState(balance, settings) {
  const m = rewardsCfg(settings).milestone;
  if (!(m > 0)) return null;
  const reached = Math.max(0, Math.floor((Number(balance) || 0) / m));
  return { milestone: m, reached, next: (reached + 1) * m };
}

/* ---------------- customer numbers ----------------------------------- */

/* The platform's own comparison (salesData.customerByNumber): case and
   punctuation do not matter, so "vb-0123" and "VB 0123" are VB0123. */
function numberKey(v) { return String(v == null ? '' : v).toUpperCase().replace(/[^0-9A-Z]/g, ''); }
/* What a person may type. Anything longer or stranger is refused before
   anybody is asked. */
function plausibleNumber(v) { const k = numberKey(v); return k.length >= 3 && k.length <= 24; }

/* ---------------- reading the platform, read only -------------------- */

/* The same project the product feed reads. Its address is not a secret. */
function platformUrl() {
  return String(process.env.POS_SUPABASE_URL || 'https://xbrchpxdmptwuvivdiqj.supabase.co').replace(/\/+$/, '');
}
/* Only a secret key will do here. Customers and sales must never be read
   with a key that is also in a web page, so the publishable key the
   product feed falls back to is deliberately not a fallback for this. */
function platformKey() {
  const k = String(process.env.POS_SUPABASE_KEY || '').trim();
  return /^sb_publishable_/.test(k) ? '' : k;
}
function stateRow() { return String(process.env.POS_STATE_ROW || '100').trim(); }

function tryParse(s) { try { const v = JSON.parse(s); return v && typeof v === 'object' ? v : null; } catch (e) { return null; } }
function locate(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj.customers) || Array.isArray(obj.sales)) return obj;
  for (const key of ['state', 'data', 'app_state', 'snapshot', 'value', 'payload']) {
    const o = obj[key];
    if (o && typeof o === 'object' && (Array.isArray(o.customers) || Array.isArray(o.sales))) return o;
  }
  return null;
}
function findState(row) {
  if (!row || typeof row !== 'object') return null;
  const c = [];
  for (const v of Object.values(row)) {
    if (v == null) continue;
    if (typeof v === 'string') { const p = tryParse(v); if (p) c.push(p); }
    else if (typeof v === 'object') c.push(v);
  }
  c.push(row);
  for (const x of c) { const f = locate(x); if (f) return f; }
  return null;
}

/* One read of the business document, held for a few seconds so that a
   customer opening their rewards and then checking out is one read, not
   two. Held in this function's memory only; never written anywhere. */
let held = null;
const HOLD_MS = 20000;
async function readPlatform() {
  if (held && Date.now() - held.at < HOLD_MS) return held.state;
  const url = platformUrl(), key = platformKey();
  if (!url || !key) throw Object.assign(new Error('rewards are not connected'), { code: 'not-connected' });
  const res = await fetch(url + '/rest/v1/app_state?id=eq.' + encodeURIComponent(stateRow()) + '&select=*', {
    headers: { apikey: key, Authorization: 'Bearer ' + key, Accept: 'application/json' }
  });
  if (!res.ok) throw Object.assign(new Error('the platform could not be read (' + res.status + ')'), { code: 'unreadable' });
  const rows = await res.json();
  const state = findState(Array.isArray(rows) ? rows[0] : rows);
  if (!state) throw Object.assign(new Error('the platform record has no customers'), { code: 'unreadable' });
  held = { at: Date.now(), state };
  return state;
}
function forget() { held = null; }

/* The one customer with this number, or null. A number shared by two
   records is treated as unknown: guessing between two people's points is
   exactly the careless reveal this must never make. */
function customerByNumber(state, number) {
  const want = numberKey(number);
  if (!want) return null;
  const found = (state.customers || []).filter((c) => c && c.custNo && numberKey(c.custNo) === want && isMember(c));
  return found.length === 1 ? found[0] : null;
}

/* What may be said about a customer: points and their worth, nothing
   else. `promised` is points this website has already promised on orders
   the till has not rung up yet. */
function standing(state, cust, promised) {
  const settings = state.settings || {};
  const cfg = rewardsCfg(settings);
  const raw = pointsBalance(cust, state.sales || [], settings, state.returns || []);
  const balance = Math.floor(raw - (Number(promised) || 0));
  return {
    points: balance,
    worth: pointsWorth(balance, settings),
    perK1: cfg.perK1,
    canRedeem: cfg.perPoint > 0 && balance > 0,
    milestone: milestoneState(balance, settings),
    milestoneValue: cfg.milestoneValue
  };
}

/* The email to send a code to, or '' -- read here, used once, returned to
   nobody. */
function emailOf(cust) {
  const e = String((cust && cust.email) || '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : '';
}

module.exports = {
  // the formula
  rewardsCfg, isMember, earnedOnSale, redeemedOnSale, pointsBalance, pointsWorth,
  redeemQuote, milestoneState, pointsForSale, returnedValue,
  // numbers
  numberKey, plausibleNumber,
  // the platform
  readPlatform, forget, findState, customerByNumber, standing, emailOf, platformKey
};
