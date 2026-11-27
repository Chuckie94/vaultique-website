// =====================================================================
// PRODUCT ALERTS: every thirty minutes (netlify.toml).  BUILD 90
//
// A signed-in customer asks on a piece's page: "Email me when it's back"
// (it is sold out) or "Email me if the price drops" (supabase-shopping.sql,
// alert_set). This reads the alerts still waiting, and the catalogue as the
// shop shows it (the platform's feed with the website's own prices and
// hidden pieces, exactly as place-order and pay-start price it), and emails
// each customer once about every piece of theirs that is back in stock, or
// cheaper than when they asked. Each alert is sent once and marked; asked
// again, it waits again.
//
// Nothing is sent, and nothing marked, while email is not set up (Settings
// > Notifications), while Settings > Customer Accounts has the alerts off,
// or before supabase-shopping.sql has been run. A piece that has left the
// catalogue, or is hidden or priced on request, waits. An alert not sent
// within 180 days is let go.
//
// Each alert is taken before its email goes (sent_at written where it was
// empty), so two runs at once never send it twice; one whose email could
// not go is put back for the next run.
// =====================================================================
const P = require('./_pay');
const M = require('./_mail');
const { settings } = require('./_seo-data');

const MAX_EMAILS = 40;          // a scheduled function has thirty seconds
const STOP_AFTER_MS = 20000;
const KEEP_DAYS = 180;
const enc = encodeURIComponent;
const iso = (ms) => new Date(ms).toISOString();
const first = (name) => (String(name || '').trim().split(/\s+/)[0]) || 'there';

/* Settings > Customer Accounts: accounts on, and the alerts not switched off. */
async function alertsOn() {
  try {
    const a = (await settings('customer-accounts')) || {};
    return a.accountsEnabled !== false && a.productAlerts !== false;
  } catch (e) {
    return true;
  }
}

/* Which waiting alerts are due now, and at what price: plain, for the tests. */
function dueNow(waiting, feed, meta, pricing, F, style) {
  const bySku = {};
  (feed || []).forEach((p) => { if (p && p.sku) bySku[p.sku] = p; });
  const out = [];
  (waiting || []).forEach((a) => {
    const base = bySku[a.sku];
    if (!base) return;
    const p = P.withMeta(base, (meta || {})[a.sku], pricing);
    if (p.hidden || !p.available) return;
    const v = F.priceView(p, pricing, style);
    if (a.kind === 'back') {
      out.push({ a, p, now: v.onRequest ? null : v.now });
    } else if (a.kind === 'price') {
      const was = Number(a.price_at);
      if (!v.onRequest && v.now > 0 && was > 0 && v.now <= was - 0.01) out.push({ a, p, now: v.now });
    }
  });
  return out;
}

/* One email for one customer, about each of their pieces. */
function compose(list, name, money, origin) {
  const link = (sku) => (origin ? origin + '/product/' + enc(sku) : '');
  const lines = ['Hello ' + first(name) + ','];
  list.forEach(({ a, p, now }) => {
    const title = p.name || a.name || a.sku;
    const l = link(p.sku);
    lines.push(a.kind === 'back'
      ? title + ' is back in stock' + (now ? ', at ' + money(now) : '') + '.' + (l ? '\n' + l : '')
      : title + ' is now ' + money(now) + ', down from ' + money(a.price_at) + ' when you asked.' + (l ? '\n' + l : ''));
  });
  lines.push(list.length > 1 ? 'Each is as the shop has it now, and can sell out again quickly.'
                             : 'It is as the shop has it now, and can sell out again quickly.');
  lines.push('You asked for this email on {shop}\'s website, and it is sent once.' +
             (origin ? ' To see or stop your alerts: ' + origin + '/account/alerts' : ' Your alerts are in your account.'));
  const one = list.length === 1 ? list[0] : null;
  const subject = one
    ? (one.a.kind === 'back' ? 'Back in stock: ' : 'Price drop: ') + (one.p.name || one.a.name || one.a.sku)
    : 'News about pieces you asked about';
  return { subject, lines };
}

async function run() {
  if (!P.serviceKey()) return { skipped: 'no service key' };
  const began = Date.now();
  const late = () => Date.now() - began > STOP_AFTER_MS;
  let waiting;
  try {
    waiting = await P.svc('GET', 'product_alerts?select=id,customer_id,email,sku,kind,name,price_at,created_at' +
                                 '&sent_at=is.null&order=created_at.asc&limit=1000');
  } catch (e) {
    return { skipped: 'supabase-shopping.sql has not been run' };
  }
  const out = { waiting: (waiting || []).length, due: 0, emails: 0, sent: 0, expired: 0 };

  // Let go of the ones nobody has needed for half a year.
  const gone = await P.svc('DELETE', 'product_alerts?sent_at=is.null&created_at=lt.' + enc(iso(began - KEEP_DAYS * 86400000)),
                           undefined, 'return=representation').catch(() => []);
  out.expired = Array.isArray(gone) ? gone.length : 0;
  const keep = new Set((Array.isArray(gone) ? gone : []).map((g) => g.id));
  waiting = (waiting || []).filter((a) => !keep.has(a.id));
  if (!waiting.length) return out;
  if (!(await alertsOn())) { out.skipped = 'alerts are off in Settings > Customer Accounts'; return out; }

  const s = await P.shopSettings();
  const F = P.formats();
  const style = F.moneyStyle(s.general, s.pricing);
  const money = (v) => F.money(Number(v), style);
  const skus = Array.from(new Set(waiting.map((a) => a.sku)));
  let feed, meta;
  try {
    [feed, meta] = await Promise.all([P.catalogue(), P.productMeta(skus)]);
  } catch (e) {
    out.skipped = 'the catalogue could not be read';
    return out;
  }
  const due = dueNow(waiting, feed, meta, s.pricing, F, style);
  out.due = due.length;
  if (!due.length) return out;

  // One email for each customer, about all of theirs that are due.
  const byCustomer = new Map();
  due.forEach((d) => {
    const k = d.a.customer_id + '|' + d.a.email;
    if (!byCustomer.has(k)) byCustomer.set(k, []);
    byCustomer.get(k).push(d);
  });
  const ids = Array.from(new Set(due.map((d) => d.a.customer_id)));
  const names = {};
  try {
    const rows = await P.svc('GET', 'customers?select=id,name&id=in.(' + ids.map(enc).join(',') + ')');
    (rows || []).forEach((r) => { names[r.id] = r.name; });
  } catch (e) { /* a first name is a nicety */ }
  const origin = P.siteOrigin();

  for (const [k, list] of byCustomer) {
    if (late() || out.emails >= MAX_EMAILS) break;
    // Take each first, so another run cannot send it as well.
    const taken = [];
    for (const d of list) {
      const got = await P.svc('PATCH', 'product_alerts?id=eq.' + enc(d.a.id) + '&sent_at=is.null',
                              { sent_at: iso(Date.now()), sent_price: d.now }).catch(() => null);
      if (Array.isArray(got) && got.length) taken.push(d);
    }
    if (!taken.length) continue;
    const mail = compose(taken, names[taken[0].a.customer_id], money, origin);
    if (await M.shopMail(taken[0].a.email, mail.subject, mail.lines)) {
      out.emails++;
      out.sent += taken.length;
    } else {
      // Not sent (email not set up, or the server refused): put back.
      for (const d of taken) {
        await P.svc('PATCH', 'product_alerts?id=eq.' + enc(d.a.id), { sent_at: null, sent_price: null }, 'return=minimal').catch(() => {});
      }
      break;
    }
  }
  return out;
}

exports.handler = async function () {
  try {
    return { statusCode: 200, body: JSON.stringify(await run()) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: String((e && e.message) || e).slice(0, 200) }) };
  }
};
exports._internals = { run, dueNow, compose, alertsOn, MAX_EMAILS, KEEP_DAYS };
