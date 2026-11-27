// =====================================================================
// WHICH GATEWAY TAKES A CARD (website build 88): ready, routing nothing yet
//
// Zambian cards go to the local gateway (Lenco); international cards will
// go to the international gateway (DPO), once DPO is connected in a later
// build. Until then every card goes to Lenco, and the checkout asks nothing
// more than it does now.
//
// NO CARD DETAIL IS EVER TYPED ON THIS WEBSITE, not even a card's first six
// digits (the owner, 26 November). So nothing about the card itself decides
// the gateway before a payment: the customer says where their card was
// issued, with two buttons under Debit / Credit Card ("Card issued in
// Zambia", "International card"), shown only once a second card gateway
// exists (needsChoice). Every card detail is then typed in that gateway's
// own window.
//
// AFTERWARDS, from the gateway: after a card payment, Lenco gives the card's
// BIN (its first six digits, which say which bank issued it) beside the last
// four, never the whole number. Both are kept with the payment, as card
// schemes allow. With CARD_BINS_ZM in Netlify (the Zambian banks' BINs, from
// the acquirer: comma-separated, 4 to 8 digits each) the website can also
// say whether the card really was Zambian, so the shop sees how many
// international cards it gets and how often a customer chose wrongly. None
// is guessed: without the list, "not known".
// =====================================================================
'use strict';

const env = (n) => String(process.env[n] || '').trim();
const CHOICES = ['local', 'international'];

// The first six to eight digits of a BIN the gateway gave, or ''. Never more.
function cleanBin(v) {
  const d = String(v == null ? '' : v).replace(/\D/g, '');
  return d.length >= 6 ? d.slice(0, Math.min(8, d.length)) : '';
}
function prefixes(name) {
  return env(name).split(/[\s,;]+/).map((x) => x.replace(/\D/g, '')).filter((x) => x.length >= 4 && x.length <= 8);
}
// From the gateway's BIN, after a payment: 'ZM', a Zambian bank's card;
// 'INTL', a card not on the Zambian list; '', not known (no BIN, or no list).
function issuerOf(bin) {
  const b = cleanBin(bin);
  const list = prefixes('CARD_BINS_ZM');
  if (!b || !list.length) return '';
  return list.some((p) => b.indexOf(p) === 0) ? 'ZM' : 'INTL';
}

// The gateway for a card, from the customer's choice ('local' or
// 'international'; anything else is no choice). gateways: { local,
// international }, as the routes found them (local: 'lenco'; international:
// null until DPO is connected).
//   an international card, with an international gateway  -> international
//   anything else                                          -> local
//                                                             (today: every card)
function cardGateway(choice, gateways) {
  const local = (gateways && gateways.local) || null;
  const intl = (gateways && gateways.international) || null;
  const c = CHOICES.indexOf(String(choice || '')) > -1 ? String(choice) : '';
  if (c === 'international' && intl) return { gateway: intl, choice: c, why: 'an international card' };
  if (local) {
    return { gateway: local, choice: c, why: c === 'local' ? 'a card issued in Zambia'
      : c === 'international' ? 'no international card gateway yet' : 'no choice asked' };
  }
  return { gateway: intl, choice: c, why: 'the only card gateway' };
}

// Whether the checkout asks where the card was issued: only when two
// gateways take cards. Never today.
function needsChoice(gateways) {
  return !!(gateways && gateways.local && gateways.international);
}

module.exports = { CHOICES, cleanBin, issuerOf, cardGateway, needsChoice };
