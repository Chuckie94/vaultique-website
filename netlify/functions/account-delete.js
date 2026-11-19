/* =====================================================================
   Vaultique Boutique Point — closing a customer's account (build 80)
   ---------------------------------------------------------------------
   POST, with the signed-in customer's own token (Authorization: Bearer).

   WHY THIS EXISTS. Until build 80, "Close my account" ran in the browser:
   the saved addresses and the profile went and the orders lost their
   owner, but the login itself stayed, because removing a login needs the
   website's service key, which no browser may ever hold. So the customer
   could sign in again with the same email and password, and the account
   seemed never to have closed. Here, on the server, with the service key,
   the login goes too.

   WHAT GOES. The login first, in one step: with it, the database removes
   what it keeps against that login (the profile, the saved addresses,
   the rewards link, the chat name), and the orders stay, without their
   owner, exactly as before: the shop's record of a sale is the shop's.
   Then the same three steps the browser used to take, which by then find
   nothing left to do (they are there for a database made differently).
   If the login cannot be removed, nothing has been removed, and the
   customer is told so and can try again.

   WHAT IS REFUSED.
     * A token Supabase does not recognise: nobody is closed by guesswork.
     * Any login on the admin list (Settings > Users & Roles), active or
       not, the owner's included: closing it would take that person's way
       into the admin with it. That is done in the admin, never from the
       shop. If the list cannot be read, nothing is closed.
     * Closing accounts switched off (Settings > Customer Accounts): the
       shop then closes an account when asked.
   ===================================================================== */
'use strict';
const P = require('./_pay');
const { readConfig, settings } = require('./_seo-data');

function authBase() {
  const { url } = readConfig();
  return url ? url.replace(/\/+$/, '') + '/auth/v1' : '';
}

/* Who the token belongs to, asked of Supabase itself. */
async function whoIs(token) {
  const { key } = readConfig();
  if (!token || !key || token === key || !authBase()) return null;
  try {
    const res = await fetch(authBase() + '/user', { headers: { apikey: key, Authorization: 'Bearer ' + token } });
    if (!res.ok) return null;
    const u = await res.json();
    return u && u.id ? { id: String(u.id), email: String(u.email || '').trim().toLowerCase() } : null;
  } catch (e) {
    return null;
  }
}

/* On the admin list, by the login itself or by its email. The list is a
   handful of rows; reading it fails closed. */
async function onAdminList(who) {
  const list = await P.svc('GET', 'admins?select=id,email');
  return (list || []).some((a) => a && (String(a.id) === who.id ||
    (who.email && String(a.email || '').trim().toLowerCase() === who.email)));
}

async function removeLogin(id) {
  const key = P.serviceKey();
  const res = await fetch(authBase() + '/admin/users/' + encodeURIComponent(id), {
    method: 'DELETE',
    headers: { apikey: key, Authorization: 'Bearer ' + key, Accept: 'application/json' }
  });
  // Gone already (a second press, two tabs): that is what was asked for.
  if (res.ok || res.status === 404) return true;
  const b = await res.json().catch(() => ({}));
  console.error('[account-delete] the login was not removed:', res.status,
    String((b && (b.msg || b.message || b.error_description || b.error)) || '').slice(0, 200));
  return false;
}

const SAY = {
  method: 'Use POST.',
  notSetUp: 'Closing an account is not available just now. Please message us and we will close it for you.',
  signIn: 'Please sign in again, then close your account.',
  off: 'Please message us to close your account.',
  admin: 'This login is one of the shop’s administrators, so it cannot be closed from the shop. ' +
         'That is done in the admin, Settings > Users & Roles.',
  failed: 'Your account could not be closed just now. Nothing has been removed. Please try again in a ' +
          'minute, or message us.'
};

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return P.json(405, { error: SAY.method });
  if (!P.serviceKey() || !authBase()) return P.json(503, { error: SAY.notSetUp });
  const h = event.headers || {};
  const token = String(h.authorization || h.Authorization || '').replace(/^Bearer\s+/i, '').trim();
  const who = await whoIs(token);
  if (!who) return P.json(401, { error: SAY.signIn });

  try {
    const s = (await settings('customer-accounts')) || {};
    if (s.accountDeletion === false) return P.json(403, { error: SAY.off });
    if (await onAdminList(who)) return P.json(403, { error: SAY.admin, admin: true });

    if (!(await removeLogin(who.id))) return P.json(502, { error: SAY.failed });

    // The login is gone: anything below is tidying, and the answer stands.
    const id = encodeURIComponent(who.id);
    try {
      await P.svc('DELETE', 'customer_addresses?customer_id=eq.' + id, undefined, 'return=minimal');
      await P.svc('PATCH', 'orders?customer_id=eq.' + id, { customer_id: null }, 'return=minimal');
      await P.svc('DELETE', 'customers?id=eq.' + id, undefined, 'return=minimal');
    } catch (e) {
      console.error('[account-delete] tidying after the login:', e && e.message);
    }
    return P.json(200, { ok: true });
  } catch (e) {
    console.error('[account-delete]', e && e.message);
    return P.json(502, { error: SAY.failed });
  }
};

module.exports._internals = { whoIs, onAdminList, removeLogin, SAY };
