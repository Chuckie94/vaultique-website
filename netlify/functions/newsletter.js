/* =====================================================================
   Vaultique Boutique Point — /.netlify/functions/newsletter
   ---------------------------------------------------------------------
   Joining the newsletter from the website's form (build 76).

   POST { email }         -> 200 { state }
        joined    a new address, now on the list
        already   on the list already
        confirm   it had unsubscribed: a link has gone to that inbox
        wait      a link went to that inbox in the last hour already
        contact   it had unsubscribed, and the link could not be sent
   GET  ?confirm=TOKEN    -> a page with one button, "Yes, send them again"
   POST confirm=TOKEN     -> that button: back on the list, or the link is
                             too old

   WHY THIS EXISTS. Up to build 75 the form put any address that had
   unsubscribed straight back on the list, so anybody could undo
   somebody else's "stop sending me these" by typing their address in.
   Now an address that unsubscribed is sent a link, through the shop's
   own email (Settings > Notifications), and only following it from that
   inbox puts it back. A new address joins at once, as before.

   WHY A BUTTON AND NOT JUST THE LINK. Some email services open every
   link in a message to check it for danger before the person sees it.
   A link that did the rejoining by being opened would be followed by
   those checkers, not by the person. A page with a button is not.

   The database does the deciding (newsletter_join, newsletter_confirm in
   supabase-hardening.sql, callable with the service key only), and
   throttles it per connection. Before that SQL has been run the form
   joins the old way, so nothing is lost to the order things were done in.
   ===================================================================== */
'use strict';
const P = require('./_pay');
const { settings } = require('./_seo-data');
const { shopMail } = require('./_mail');

const MAILISH = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN = /^[0-9a-f]{48}$/;

function missingFn(e) { return /PGRST202|Could not find the function/i.test(String(e && e.message)); }
function tooMany(e) { return /Too many/i.test(String(e && e.message)); }

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* The few pages this answers with: plain, self-contained, and not for
   search engines. The token is in the address, so nothing on the page
   loads from anywhere else or tells another site where it came from. */
function page(status, shop, home, title, lines, form) {
  const body = '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex">' +
    '<title>' + esc(title) + ' · ' + esc(shop) + '</title>' +
    '<style>body{margin:0;font:16px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f4ef;color:#1d2433}' +
    'main{max-width:30rem;margin:12vh auto;padding:2rem 1.5rem;background:#fff;border-radius:14px;box-shadow:0 1px 3px rgba(0,0,0,.08)}' +
    'h1{font-size:1.35rem;margin:0 0 .75rem}p{margin:.6rem 0}button{font:inherit;padding:.7rem 1.2rem;border:0;border-radius:999px;background:#1d2a4a;color:#fff;cursor:pointer}' +
    'a{color:#1d2a4a}</style></head><body><main>' +
    '<h1>' + esc(title) + '</h1>' +
    lines.map((l) => '<p>' + esc(l) + '</p>').join('') +
    (form || '') +
    (home ? '<p><a href="' + esc(home) + '/">Back to ' + esc(shop) + '</a></p>' : '') +
    '</main></body></html>';
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    },
    body,
  };
}

function formBody(event) {
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : String(event.body || '');
  const type = String((event.headers || {})['content-type'] || (event.headers || {})['Content-Type'] || '');
  if (/application\/x-www-form-urlencoded/i.test(type)) return { form: true, data: Object.fromEntries(new URLSearchParams(raw)) };
  try { return { form: false, data: JSON.parse(raw || '{}') || {} }; } catch (e) { return { form: false, data: null }; }
}

async function shopName() {
  try { return ((await settings('general')) || {}).businessName || 'Vaultique Boutique Point'; }
  catch (e) { return 'Vaultique Boutique Point'; }
}

/* ---------------------------------------------------- the link's page */
async function confirmPage(event, token, press) {
  const shop = await shopName();
  const home = P.siteOrigin(event);
  if (!TOKEN.test(token)) {
    return page(400, shop, home, 'That link is not complete',
      ['Open the link from the email again, or copy all of it into the address bar.']);
  }
  if (!press) {
    return page(200, shop, home, 'Back on the newsletter?', [
      'You asked to receive emails from ' + shop + ' again. Press the button to confirm.',
      'If you did not ask, close this page and nothing changes.'],
      '<form method="post"><input type="hidden" name="confirm" value="' + esc(token) + '">' +
      '<button type="submit">Yes, send them again</button></form>');
  }
  try {
    const ok = await P.svc('POST', 'rpc/newsletter_confirm', { p_token: token });
    if (ok === true) {
      return page(200, shop, home, 'You are back on the list',
        ['Thank you. You will receive emails from ' + shop + ' again.']);
    }
    return page(410, shop, home, 'That link has expired',
      ['Links are good for three days and work once. To get a new one, sign up again on the website.']);
  } catch (e) {
    console.error('[newsletter] confirm failed:', e && e.message);
    return page(502, shop, home, 'That did not go through',
      ['Please try the link again in a few minutes.']);
  }
}

/* ------------------------------------------------------- the website's form */
async function join(event, email) {
  if (!MAILISH.test(email) || email.length > 200) return P.json(400, { error: 'Please enter a valid email address.' });
  const client = P.clientAddr(event);
  let r;
  try {
    r = await P.svc('POST', 'rpc/newsletter_join', { p_email: email, p_client: client });
  } catch (e) {
    if (tooMany(e)) return P.json(429, { error: 'Too many tries just now. Please wait a little and try again.' });
    if (!missingFn(e)) throw e;
    /* supabase-hardening.sql not run yet: the old way. */
    await P.svc('POST', 'rpc/subscribe_email', { p_email: email, p_rejoin: true });
    return P.json(200, { state: 'joined' });
  }
  const state = (r && r.state) || 'joined';
  if (state !== 'confirm') return P.json(200, { state });

  const link = P.siteOrigin(event) + '/.netlify/functions/newsletter?confirm=' + encodeURIComponent(r.token);
  const sent = await shopMail(r.email || email, 'Receive emails from {shop} again?', [
    'Hello,',
    'Somebody, hopefully you, asked on our website to receive emails from {shop} again. This address unsubscribed earlier, so we are checking with you first.',
    'To start receiving them again, open this link and press the button:',
    link,
    'The link works for three days. If you did not ask, ignore this email and nothing changes.'
  ]);
  if (!sent) {
    /* Not sent: the hour's wait is lifted, so the next try sends one. */
    await P.svc('PATCH', 'subscribers?email=eq.' + encodeURIComponent(r.email || email),
      { rejoin_hash: null, rejoin_at: null }, 'return=minimal').catch(() => {});
    return P.json(200, { state: 'contact' });
  }
  return P.json(200, { state: 'confirm' });
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  if (event.httpMethod === 'GET') {
    if (q.confirm != null) return confirmPage(event, String(q.confirm), false);
    return P.json(405, { error: 'Use POST.' });
  }
  if (event.httpMethod !== 'POST') return P.json(405, { error: 'Use POST.' });

  const b = formBody(event);
  if (!b.data) return P.json(400, { error: 'That request could not be read.' });
  if (!P.serviceKey()) {
    if (b.form) return page(503, await shopName(), P.siteOrigin(event), 'Not set up yet', ['Please try again later.']);
    return P.json(503, { fallback: true, error: 'not set up' });
  }
  if (b.form) return confirmPage(event, String(b.data.confirm || q.confirm || ''), true);

  try {
    return await join(event, String(b.data.email || '').trim());
  } catch (e) {
    console.error('[newsletter]', e && e.message);
    if (/look like an email/i.test(String(e && e.message))) return P.json(400, { error: 'Please enter a valid email address.' });
    return P.json(502, { error: 'That did not go through. Please try again shortly.' });
  }
};
