/* =====================================================================
   Vaultique Boutique Point — making another administrator
   ---------------------------------------------------------------------
   The owner adds somebody who runs the whole shop, hands them a
   temporary password, and the admin makes them choose their own the
   first time they arrive.

   WHY THIS IS NOT IN chat-staff.js. That file says, at the top, that it
   cannot make an administrator and cannot touch one — and it is true of
   it, which is worth keeping true. Adding this power there would have
   made the sentence a lie and the file's own guarantee worthless. Two
   files, two jobs, and each says plainly what it may do.

   WHO MAY CALL IT. The owner, and nobody else. The caller's own token
   goes to the database to ask is_shop_owner(), so the answer is the
   database's rule rather than this file's opinion of it. An
   administrator who is not the owner is refused: being able to run the
   shop is not the same as being able to hand that out.

   WHAT IT DELIBERATELY CANNOT DO.
     * It cannot make an owner. Every account it makes is role 'agent',
       which is a full administrator and not somebody who can delete a
       conversation or promote anybody. Naming an owner stays a line of
       SQL, typed on purpose.
     * It cannot remove an owner, and it cannot remove the caller. A
       page that can lock the shop out of its own admin is a page worth
       attacking, and a slip of the finger is likelier than an attack.
     * It cannot delete a login. Removing somebody takes away their
       administrator's rights and leaves the account alone: it may be a
       customer account too, and deleting it would take their orders
       with it.
   ===================================================================== */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body)
  };
}

function readConfig() {
  const envUrl = process.env.SITE_SUPABASE_URL;
  const envKey = process.env.SITE_SUPABASE_ANON_KEY;
  if (envUrl && envKey) return { url: envUrl, key: envKey };
  for (const p of ['config.js', '../config.js', '../../config.js']) {
    try {
      const text = fs.readFileSync(path.join(process.cwd(), p), 'utf8');
      const url = (text.match(/SUPABASE_URL\s*:\s*['"]([^'"]+)['"]/) || [])[1];
      const key = (text.match(/SUPABASE_ANON_KEY\s*:\s*['"]([^'"]+)['"]/) || [])[1];
      if (url && key) return { url: url.replace(/\/+$/, ''), key };
    } catch (e) { /* try the next one */ }
  }
  return { url: '', key: '' };
}

async function callerIsOwner(token, site) {
  if (!token) return false;
  try {
    const res = await fetch(`${site.url}/rest/v1/rpc/is_shop_owner`, {
      method: 'POST',
      headers: {
        apikey: site.key,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: '{}'
    });
    if (!res.ok) return false;
    return (await res.json()) === true;
  } catch (e) { return false; }
}

/* No l, I, 0 or O. This gets read down a phone line. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
function tempPassword() {
  const bytes = crypto.randomBytes(16);
  let out = '';
  for (let i = 0; i < 16; i++) {
    if (i && i % 4 === 0) out += '-';
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

function svc(site, serviceKey, urlPath, init) {
  return fetch(`${site.url}${urlPath}`, Object.assign({
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json'
    }
  }, init || {}));
}

async function adminRow(site, serviceKey, id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return null;
  const res = await svc(site, serviceKey,
    `/rest/v1/admins?id=eq.${encodeURIComponent(id)}&select=id,email,role`);
  if (!res.ok) return null;
  const rows = await res.json().catch(() => []);
  return rows[0] || null;
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' });

  const site = readConfig();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!site.url || !site.key) {
    return json(500, { error: 'The website is not connected to its database yet.' });
  }
  if (!serviceKey) {
    return json(500, {
      error: 'Adding an administrator needs the Supabase service role key. Put it in ' +
             'Netlify as SUPABASE_SERVICE_ROLE_KEY and redeploy. Everything else on ' +
             'this page works without it.'
    });
  }

  const auth = (event.headers &&
    (event.headers.authorization || event.headers.Authorization)) || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!(await callerIsOwner(token, site))) {
    return json(403, {
      error: 'Only the shop owner can add or remove an administrator.'
    });
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return json(400, { error: 'Could not read that request.' }); }
  const action = String(body.action || '');

  // ------------------------------------------------------------ create
  if (action === 'create') {
    const email = String(body.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json(400, { error: 'That does not look like an email address.' });
    }
    const password = String(body.password || '').trim() || tempPassword();
    if (password.length < 8) {
      return json(400, { error: 'A temporary password needs at least eight characters.' });
    }

    const made = await svc(site, serviceKey, '/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        email,
        password,
        /* Confirmed on the spot. The owner is standing there handing the
           password over; a confirmation email to click would be a second
           thing to go wrong for no gain. */
        email_confirm: true
      })
    });
    const user = await made.json().catch(() => ({}));
    if (!made.ok || !user.id) {
      const msg = String((user && (user.msg || user.message || user.error_description)) || '');
      return json(made.status === 422 || /already/i.test(msg) ? 409 : 500, {
        error: /already|exists|registered/i.test(msg)
          ? 'There is already an account with that email address. If it is theirs, ' +
            'making them an administrator has to be done in Supabase so that their ' +
            'existing account is kept rather than replaced.'
          : ('The account could not be created: ' + (msg || made.status))
      });
    }

    /* role 'agent' is a full administrator. Only an owner may delete a
       conversation or name another owner, and this cannot make one. */
    const put = await svc(site, serviceKey, '/rest/v1/admins', {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify({
        id: user.id, email, role: 'agent', must_change_password: true
      })
    });
    if (!put.ok) {
      /* A login that exists and has been told nothing is an account that
         signs in and sees a refusal. Undone rather than left. */
      await svc(site, serviceKey, `/auth/v1/admin/users/${user.id}`, { method: 'DELETE' })
        .catch(() => {});
      const why = await put.text().catch(() => '');
      return json(500, {
        error: 'The login was made but could not be given administrator access, so it ' +
               'has been removed again. ' +
               (/must_change_password/.test(why)
                 ? 'Run supabase-chat-phase9.sql in Supabase first.'
                 : (why ? '(' + why.slice(0, 200) + ')' : ''))
      });
    }

    return json(200, { id: user.id, email, password });
  }

  // ------------------------------------------------------------- reset
  if (action === 'reset') {
    const who = await adminRow(site, serviceKey, body.id);
    if (!who) return json(404, { error: 'That is not one of the administrators.' });
    if (who.role === 'owner') {
      return json(403, {
        error: 'An owner\'s password is not reset from here. They can change it in ' +
               'Settings > Security, or through Supabase.'
      });
    }

    const password = String(body.password || '').trim() || tempPassword();
    if (password.length < 8) {
      return json(400, { error: 'A temporary password needs at least eight characters.' });
    }

    const res = await svc(site, serviceKey, `/auth/v1/admin/users/${who.id}`, {
      method: 'PUT', body: JSON.stringify({ password })
    });
    if (!res.ok) {
      const why = await res.text().catch(() => '');
      return json(500, { error: 'The password could not be changed. ' + why.slice(0, 200) });
    }

    /* Made to choose their own again, because this one has been read out
       loud to somebody. */
    await svc(site, serviceKey, `/rest/v1/admins?id=eq.${encodeURIComponent(who.id)}`, {
      method: 'PATCH', body: JSON.stringify({ must_change_password: true })
    }).catch(() => {});

    return json(200, { id: who.id, email: who.email, password });
  }

  // ------------------------------------------------------------ remove
  if (action === 'remove') {
    const who = await adminRow(site, serviceKey, body.id);
    if (!who) return json(404, { error: 'That is not one of the administrators.' });
    if (who.role === 'owner') {
      return json(403, {
        error: 'An owner cannot be removed here. Name somebody else the owner in ' +
               'Supabase first, on purpose.'
      });
    }

    /* Never the person doing the removing. A slip of the finger that
       locks the shop out of its own admin is likelier than an attack. */
    const meRes = await fetch(`${site.url}/auth/v1/user`, {
      headers: { apikey: site.key, Authorization: `Bearer ${token}` }
    });
    const me = meRes.ok ? await meRes.json().catch(() => ({})) : {};
    if (me && me.id && me.id === who.id) {
      return json(400, { error: 'You cannot remove yourself.' });
    }

    const res = await svc(site, serviceKey,
      `/rest/v1/admins?id=eq.${encodeURIComponent(who.id)}`, { method: 'DELETE' });
    if (!res.ok) {
      const why = await res.text().catch(() => '');
      return json(500, { error: 'That could not be removed. ' + why.slice(0, 200) });
    }

    /* The login is left alone on purpose. It may be a customer account
       as well, and deleting it would take their orders with it. */
    return json(200, { removed: true, id: who.id, email: who.email });
  }

  return json(400, { error: 'Unknown request.' });
};
