/* =====================================================================
   Vaultique Boutique Point — making and unmaking chat logins
   ---------------------------------------------------------------------
   The owner adds somebody who answers chats, hands them a temporary
   password, resets it when they forget, or removes them.

   WHY THIS IS A FUNCTION AND NOT A PAGE. Creating a login means creating
   a row in Supabase's own auth.users, and the only key that may do that
   is the service role key — the one that bypasses every row rule in the
   database. A key like that in a browser is the whole shop handed to
   anyone who opens the developer tools. So it lives in Netlify's
   environment, the browser never sees it, and this function is the only
   thing that holds it.

   WHO MAY CALL IT. The owner, and nobody else. The caller's own token is
   sent to the database to ask is_shop_owner(), exactly as send-email.js
   asks the admins table: the answer comes from the database's own rules
   rather than from anything this file decides. An administrator who is
   not the owner is refused, and so is everybody else.

   WHAT IT DELIBERATELY CANNOT DO. It cannot make an administrator, and
   it cannot touch one. Every account it makes goes into chat_staff and
   nowhere near admins, and the two remove paths refuse an id that is not
   in chat_staff — so this function can never be talked into deleting the
   shop's own login.
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

/* The website's own address and public key, read the same way robots.js
   and send-email.js read them: out of config.js, which netlify.toml puts
   into the bundle. One place for them rather than two that can drift. */
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

/* Asked of the database with the caller's own token, so the answer is
   the database's rule and not this file's opinion of it. */
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
  } catch (e) {
    return false;
  }
}

/* A password somebody has to read off a screen and type into a phone.
   No l, I, 1, O or 0, because a temporary password that cannot be told
   apart from itself is a support call. Four groups of four is 20 bits
   short of what the alphabet suggests and still far past guessing, and
   it only has to survive until they change it on the way in. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
function tempPassword() {
  const bytes = crypto.randomBytes(16);
  let out = '';
  for (let i = 0; i < 16; i++) {
    if (i && i % 4 === 0) out += '-';
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

function admin(site, serviceKey, urlPath, init) {
  return fetch(`${site.url}${urlPath}`, Object.assign({
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json'
    }
  }, init || {}));
}

/* What the database says about an account, asked with the service key
   because the owner's own token cannot read somebody else's staff row.
   Used to refuse anything that is not chat staff. */
async function staffRow(site, serviceKey, id) {
  const res = await admin(site, serviceKey,
    `/rest/v1/chat_staff?id=eq.${encodeURIComponent(id)}&select=id,email`);
  if (!res.ok) return null;
  const rows = await res.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' });

  const site = readConfig();
  if (!site.url || !site.key) {
    return json(500, {
      error: 'This page cannot read the website\'s own settings, so it cannot ' +
             'check who you are. That is a setup problem on the website, not a ' +
             'problem with your account.'
    });
  }

  const auth = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!(await callerIsOwner(token, site))) {
    return json(403, { error: 'Only the shop owner can add or change who answers chats.' });
  }

  /* Checked after the caller, on purpose: somebody who may not be here
     should be told that first, and should not learn anything about how
     the site is configured. */
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return json(500, {
      error: 'Adding a login needs the service role key, and this site does not have one yet.',
      fix: 'In Netlify: Site configuration > Environment variables > Add a variable. ' +
           'Name it SUPABASE_SERVICE_ROLE_KEY and paste the service_role key from ' +
           'Supabase > Project Settings > API. Then redeploy. SETUP.md has the steps.'
    });
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return json(400, { error: 'That request could not be read.' }); }
  const action = String(body.action || '');

  // ------------------------------------------------------------ create
  if (action === 'create') {
    const email = String(body.email || '').trim().toLowerCase();
    const name = String(body.name || '').trim().slice(0, 60);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json(400, { error: 'That does not look like an email address.' });
    }
    /* Their own if they typed one, otherwise ours. Either way it is
       temporary: chat_staff.must_change_password starts true and the
       admin page will not let them past it. */
    const password = String(body.password || '').trim() || tempPassword();
    if (password.length < 8) {
      return json(400, { error: 'A temporary password needs at least eight characters.' });
    }

    const made = await admin(site, serviceKey, '/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        email,
        password,
        /* Confirmed on the spot. The owner is standing there handing the
           password over; sending them a confirmation email to click
           would be a second thing to go wrong for no gain. */
        email_confirm: true,
        user_metadata: { chat_staff: true, display_name: name || null }
      })
    });
    const user = await made.json().catch(() => ({}));
    if (!made.ok) {
      const msg = String((user && (user.msg || user.message || user.error_description)) || '');
      return json(made.status === 422 || /already/i.test(msg) ? 409 : 500, {
        error: /already|exists|registered/i.test(msg)
          ? 'There is already an account with that email address. If it is theirs, ' +
            'you can reset the password instead of making a second one.'
          : ('The account could not be created: ' + (msg || made.status))
      });
    }

    const put = await admin(site, serviceKey, '/rest/v1/chat_staff', {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify({
        id: user.id, email, display_name: name || null, must_change_password: true
      })
    });
    if (!put.ok) {
      /* The login exists but nothing has been told it may answer chats,
         which is an account that can sign in and see nothing. Undone
         rather than left: half a person is worse than none. */
      await admin(site, serviceKey, `/auth/v1/admin/users/${user.id}`, { method: 'DELETE' })
        .catch(() => {});
      const why = await put.text().catch(() => '');
      return json(500, {
        error: 'The login was made but could not be given chat access, so it has been ' +
               'removed again. ' + (why ? '(' + why.slice(0, 200) + ')' : '')
      });
    }

    return json(200, { id: user.id, email, name: name || null, password });
  }

  // ------------------------------------------------------------- reset
  if (action === 'reset') {
    const id = String(body.id || '');
    const who = await staffRow(site, serviceKey, id);
    if (!who) return json(404, { error: 'That is not one of the chat logins.' });

    const password = String(body.password || '').trim() || tempPassword();
    if (password.length < 8) {
      return json(400, { error: 'A temporary password needs at least eight characters.' });
    }

    const put = await admin(site, serviceKey, `/auth/v1/admin/users/${id}`, {
      method: 'PUT', body: JSON.stringify({ password })
    });
    if (!put.ok) {
      const why = await put.text().catch(() => '');
      return json(500, { error: 'The password could not be changed. ' + why.slice(0, 200) });
    }
    /* Back to being temporary, so the next sign-in asks them to choose
       their own — the same as a new account. */
    await admin(site, serviceKey,
      `/rest/v1/chat_staff?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH', body: JSON.stringify({ must_change_password: true })
      });
    return json(200, { id, email: who.email, password });
  }

  // ------------------------------------------------------------ remove
  if (action === 'remove') {
    const id = String(body.id || '');
    const who = await staffRow(site, serviceKey, id);
    /* Not in chat_staff, not this function's business. This is what
       stops it from ever being aimed at an administrator's login. */
    if (!who) return json(404, { error: 'That is not one of the chat logins.' });

    const gone = await admin(site, serviceKey, `/auth/v1/admin/users/${id}`, { method: 'DELETE' });
    if (!gone.ok) {
      const why = await gone.text().catch(() => '');
      return json(500, { error: 'That login could not be removed. ' + why.slice(0, 200) });
    }
    /* chat_staff.id references auth.users on delete cascade, so the row
       is already gone. Said out loud because it is not obvious. */
    return json(200, { id, removed: true });
  }

  return json(400, { error: 'Unknown request.' });
};

/* For the tests. Nothing else reads this. */
exports._internals = { tempPassword, readConfig, ALPHABET };
