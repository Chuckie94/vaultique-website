/* =====================================================================
   Vaultique Boutique Point — creating a customer account
   ---------------------------------------------------------------------
   POST { action: 'signup', email, password, name }
        { action: 'resend', email }

   WHY THIS EXISTS. Supabase can make the account and email the "confirm
   your address" link itself, but when its email fails the whole sign-up
   fails with it. Here the account is made with the website's service key
   and the link is sent through the shop's OWN email account (Settings >
   Notifications), the one the admin's "Send a test email" proves works.

   The storefront falls back to Supabase's own sign-up if this function is
   missing or not set up, so a sign-up is never worse off than before.

   WHAT IT KEEPS. Only a count of links sent in the last hour, per address
   and per connection, as fingerprints (signup_sends), so nobody can use
   the shop to fill a stranger's inbox.
   ===================================================================== */
'use strict';
const crypto = require('crypto');
const P = require('./_pay');
const { readConfig, settings, originFrom } = require('./_seo-data');
const { shopMail } = require('./_mail');

const PER_ADDRESS = 3;     // links an hour to one address
const PER_CONNECTION = 10; // sign-ups an hour from one connection

const MAILISH = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SAY_RESENT = 'If that address has an account waiting to be confirmed, a new link is on its way. ' +
  'Check your inbox and the spam or junk folder.';

function authBase() {
  const { url } = readConfig();
  return url ? url.replace(/\/+$/, '') + '/auth/v1' : '';
}
async function admin(method, path, body) {
  const key = P.serviceKey();
  const res = await fetch(authBase() + path, {
    method,
    headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const b = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body: b || {} };
}
function says(b) { return String((b && (b.msg || b.message || b.error_description || b.error)) || ''); }
function linkOf(b) { return String((b && (b.action_link || (b.properties && b.properties.action_link))) || ''); }

/* The rules the admin set (Settings > Customer Accounts), checked again
   here: a browser can be told anything. */
function passwordProblem(pw, s) {
  let min = Number(s.passwordMinLength);
  if (!isFinite(min) || min < 6) min = 8;
  if (!pw || pw.length < min) return 'Use at least ' + min + ' characters.';
  if (s.passwordNeedsNumber && !/[0-9]/.test(pw)) return 'Include at least one number.';
  if (s.passwordNeedsSymbol && !/[^A-Za-z0-9]/.test(pw)) return 'Include at least one symbol.';
  if (pw.length > 72) return 'Use 72 characters or fewer.';
  return '';
}

/* Fingerprints, never the address or the connection itself. */
function fp(kind, v) {
  return crypto.createHmac('sha256', P.serviceKey() || 'vbp').update(kind + ':' + v).digest('hex').slice(0, 40);
}
/* True when one more send is allowed, and counts it. If the table is not
   there yet (SQL not run), sign-up is not held up by it. */
async function allowed(key, max) {
  try {
    const hourAgo = Date.now() - 3600000;
    const r = await P.svc('GET', 'signup_sends?k=eq.' + key + '&select=sends,window_at');
    const row = r && r[0];
    const fresh = !row || new Date(row.window_at).getTime() <= hourAgo;
    const sends = fresh ? 0 : Number(row.sends) || 0;
    if (sends >= max) return false;
    await P.svc('POST', 'signup_sends?on_conflict=k', {
      k: key, sends: sends + 1, window_at: fresh ? new Date().toISOString() : row.window_at
    }, 'resolution=merge-duplicates,return=minimal');
    return true;
  } catch (e) {
    console.error('[account-signup] limit not checked:', e && e.message);
    return true;
  }
}

/* What Supabase knows of an address: 'none', 'waiting' or 'confirmed'.
   Asked through a database function only the service key may call. */
async function stateOf(email) {
  const r = await P.svc('POST', 'rpc/account_signup_state', { p_email: email });
  return String(r || 'none');
}

function landing(event) {
  const site = String(process.env.URL || '').replace(/\/+$/, '') || originFrom(event);
  return site + '/account';
}

async function sendLink(to, link, name) {
  return shopMail(to, 'Confirm your email for {shop}', [
    'Hello' + (name ? ' ' + String(name).split(' ')[0] : '') + ',',
    'Thank you for creating an account with {shop}. Open this link to confirm your email address and finish setting it up:',
    link,
    'The link works once, for 24 hours. If you did not create an account, ignore this email and nothing happens.'
  ]);
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return P.json(405, { error: 'POST only' });
  let body = {};
  try { body = JSON.parse(event.body || '{}') || {}; } catch (e) { return P.json(400, { error: 'unreadable' }); }

  /* Not set up: the storefront uses Supabase's own sign-up instead. */
  if (!P.serviceKey() || !authBase()) return P.json(503, { fallback: true, error: 'not set up' });

  const s = (await settings('customer-accounts')) || {};
  if (!s.accountsEnabled || (s.registration || 'open') !== 'open') {
    return P.json(403, { error: 'New accounts are closed at the moment.' });
  }
  const verify = s.emailVerification !== false;
  const email = String(body.email || '').trim().toLowerCase();
  if (!MAILISH.test(email) || email.length > 160) return P.json(400, { error: 'Please enter a valid email address.' });
  const ip = String((event.headers || {})['x-nf-client-connection-ip'] || (event.headers || {})['x-forwarded-for'] || '').split(',')[0].trim();
  const action = String(body.action || '');

  try {
    /* ---------------------------------------------------------- resend */
    if (action === 'resend') {
      if (!(await allowed(fp('e', email), PER_ADDRESS))) {
        return P.json(429, { error: 'Too many links have been sent to that address. Please try again in an hour.' });
      }
      if ((await stateOf(email)) === 'waiting') {
        /* A one-time sign-in link: opening it confirms the address. */
        const g = await admin('POST', '/admin/generate_link', { type: 'magiclink', email, redirect_to: landing(event) });
        if (g.ok && linkOf(g.body)) await sendLink(email, linkOf(g.body), '');
        else console.error('[account-signup] resend link not made:', g.status, says(g.body));
      }
      return P.json(200, { message: SAY_RESENT });
    }

    /* ---------------------------------------------------------- signup */
    if (action !== 'signup') return P.json(400, { error: 'unknown action' });
    const name = String(body.name || '').trim().slice(0, 80);
    if (!name) return P.json(400, { error: 'Please give us a name to call you by.' });
    const password = String(body.password || '');
    const bad = passwordProblem(password, s);
    if (bad) return P.json(400, { error: bad });
    if (ip && !(await allowed(fp('ip', ip), PER_CONNECTION))) {
      return P.json(429, { error: 'Too many attempts. Please try again in an hour.' });
    }

    const known = await stateOf(email);
    if (known !== 'none') {
      return P.json(409, { error: known === 'waiting'
        ? 'There is already an account with that address waiting to be confirmed. Use "Send the link again" below.'
        : 'There is already an account with that address. Try signing in.', waiting: known === 'waiting' });
    }
    const meta = { name, consent_at: new Date().toISOString() };

    /* The shop does not ask for confirmation: the account is ready now. */
    if (!verify) {
      const c = await admin('POST', '/admin/users', { email, password, email_confirm: true, user_metadata: meta });
      if (!c.ok) {
        console.error('[account-signup] not created:', c.status, says(c.body));
        return P.json(c.status >= 500 ? 502 : 400, { error: 'Your account could not be created: ' + (says(c.body) || c.status) });
      }
      return P.json(200, { created: true, confirm: false });
    }

    if (!(await allowed(fp('e', email), PER_ADDRESS))) {
      return P.json(429, { error: 'Too many links have been sent to that address. Please try again in an hour.' });
    }
    /* Makes the account (not yet confirmed) and the link, and sends
       nothing: the link goes out through the shop's own email. */
    const g = await admin('POST', '/admin/generate_link', {
      type: 'signup', email, password, data: meta, redirect_to: landing(event)
    });
    if (!g.ok || !linkOf(g.body)) {
      console.error('[account-signup] not created:', g.status, says(g.body));
      if (/already|exists|registered/i.test(says(g.body))) {
        return P.json(409, { error: 'There is already an account with that address. Try signing in.' });
      }
      return P.json(g.status >= 500 ? 502 : 400, { error: 'Your account could not be created: ' + (says(g.body) || g.status) });
    }
    const sent = await sendLink(email, linkOf(g.body), name);
    if (!sent) {
      return P.json(200, { created: true, confirm: true, emailed: false,
        error: 'Your account was made, but the email with the link could not be sent. Use "Send the link again" in a few minutes, or contact us.' });
    }
    return P.json(200, { created: true, confirm: true, emailed: true });
  } catch (e) {
    console.error('[account-signup]', e && e.message);
    /* Most often: the SQL for this has not been run yet. Let the
       storefront use Supabase's own sign-up instead. */
    if (/account_signup_state|signup_sends|404|PGRST/i.test(String(e && e.message))) {
      return P.json(503, { fallback: true, error: 'not set up' });
    }
    return P.json(500, { error: 'Your account could not be created just now. Please try again shortly.' });
  }
};

module.exports._internals = { passwordProblem, linkOf };
