/* =====================================================================
   Vaultique Boutique Point — Vaultique Rewards on the website
   ---------------------------------------------------------------------
   POST, signed in (the customer's own website session), with one of:

     { action: 'status' }              my points, if my account is linked
     { action: 'link', number }        prove a customer number is mine
     { action: 'verify', code }        the code from the email
     { action: 'join', name }          not registered yet: ask the team
                                       (with the account's own email)
     { action: 'quote', due }          what my points would take off this much
     { action: 'hold', orderRef, due } promise them on this order
     { action: 'unlink' }              stop using rewards on this account
     { action: 'team', op, request, number }
                                       Admin > Rewards: link a new customer
                                       (join_done), approve or decline; the
                                       customer is emailed the outcome

   WHAT IT NEVER SAYS. Whether a customer number exists, whether it has an
   email, whose it is, or anything on the platform record. Linking answers
   the same way for a real number, a made-up one and one with no email:
   "if this number is on our records with an email, a code is on its way;
   if not, our team will confirm with you." Only after the code has proved
   the email is the customer's do they see their points -- and then only
   their points and what they are worth.

   WHAT IT NEVER KEEPS. The platform is read for the moment of the answer
   (netlify/functions/_rewards.js) and nothing it said is stored: not the
   balance, not the email, not the name.
   ===================================================================== */
'use strict';
const crypto = require('crypto');
const P = require('./_pay');
const R = require('./_rewards');
const { readConfig, settings } = require('./_seo-data');

const CODE_MINUTES = 10;
const MAX_TRIES = 5;
const SENDS_PER_HOUR = 3;

const SAY_SENT = 'If this number is on our records with an email address, we have sent a 6-digit code ' +
  'to that email. If it is not, or there is no email on it, our team will confirm it with you.';

function hash(user, code) {
  return crypto.createHmac('sha256', P.serviceKey() || 'vbp').update(String(user) + ':' + String(code)).digest('hex');
}
function same(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/* Who is asking: the website account behind the session token, checked
   with this website's own Supabase. Nothing a browser says about itself
   is taken on trust. */
async function whoIs(event) {
  const h = event.headers || {};
  const token = String(h.authorization || h.Authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const site = readConfig();
  if (!site.url || !site.key) return null;
  const res = await fetch(site.url.replace(/\/+$/, '') + '/auth/v1/user', {
    headers: { apikey: site.key, Authorization: 'Bearer ' + token }
  });
  if (!res.ok) return null;
  const u = await res.json().catch(() => null);
  return u && u.id ? { id: String(u.id), email: String(u.email || '') } : null;
}

async function linkOf(userId) {
  const r = await P.svc('GET', 'rewards_links?user_id=eq.' + encodeURIComponent(userId) + '&select=cust_no,linked_at');
  return (r && r[0]) || null;
}
async function promised(custNo) {
  const r = await P.svc('GET', 'rewards_holds?cust_no=eq.' + encodeURIComponent(custNo) + '&status=eq.promised&select=points');
  return (r || []).reduce((a, h) => a + (Number(h.points) || 0), 0);
}
async function openRequests(userId) {
  const r = await P.svc('GET', 'rewards_requests?user_id=eq.' + encodeURIComponent(userId) + '&status=eq.waiting&select=kind');
  return (r || []).map((x) => x.kind);
}
/* True when this is a new request, false when one was already waiting. */
async function askTeam(userId, kind, extra) {
  const row = Object.assign({ user_id: userId, kind }, extra || {});
  try {
    await P.svc('POST', 'rewards_requests', row, 'return=minimal');
    return true;
  } catch (e) {
    /* One open request of each kind per account: a second ask while the
       first waits is the same ask. */
    if (/\b409\b|duplicate/.test(e.message)) return false;
    /* A database from before the team's note was added: ask without it. */
    for (const col of ['note', 'email']) {
      if (row[col] !== undefined && new RegExp('\\b' + col + '\\b').test(e.message)) {
        delete row[col];
        return askTeam(userId, kind, row);
      }
    }
    throw e;
  }
}

/* The customer's points, asked of the platform now, less what website
   orders have already promised. Null when the number is no longer one
   customer's on the platform. */
async function standingOf(custNo) {
  const state = await R.readPlatform();
  const cust = R.customerByNumber(state, custNo);
  if (!cust) return { state, cust: null, standing: null };
  return { state, cust, standing: R.standing(state, cust, await promised(custNo)) };
}

const mail = require('./_mail').shopMail;

function mailCode(to, code) {
  return mail(to, 'Your {shop} Rewards code: ' + code, [
    'Your code is ' + code,
    'Type it on the website to see and use your rewards points there. It works for ' + CODE_MINUTES + ' minutes.',
    'If you did not ask for this, you can ignore this email: nothing changes unless the code is typed in.'
  ]);
}

/* The shop's own inbox, told that something is waiting in Admin > Rewards.
   Never a customer's details from the platform: only what the shopper
   typed on the website, which the team sees in the admin anyway. */
async function tellShop(what) {
  try {
    const [contact, n] = await Promise.all([settings('contact'), settings('notifications')]);
    const to = String((contact && (contact.email || contact.supportEmail)) || (n && n.replyTo) || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return false;
    return mail(to, 'Rewards: ' + what, [
      what + '.',
      'Open your website admin > Rewards > Waiting for you to answer it.'
    ]);
  } catch (e) { return false; }
}

/* A website account's own email (the one they signed up with), read with
   the website's service key. Used to tell them what the team decided. */
async function accountEmail(userId) {
  const site = readConfig();
  const key = P.serviceKey();
  if (!site.url || !key) return '';
  try {
    const res = await fetch(site.url.replace(/\/+$/, '') + '/auth/v1/admin/users/' + encodeURIComponent(userId), {
      headers: { apikey: key, Authorization: 'Bearer ' + key }
    });
    if (!res.ok) return '';
    const u = await res.json();
    return R.emailOf({ email: u && (u.email || (u.user && u.user.email)) });
  } catch (e) { return ''; }
}

/* A team decision, made with the team member's OWN session, so the
   database's own check (may_handle_rewards) decides who may make it. */
async function asTeam(token, fnName, args) {
  const site = readConfig();
  const res = await fetch(site.url.replace(/\/+$/, '') + '/rest/v1/rpc/' + fnName, {
    method: 'POST',
    headers: { apikey: site.key, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(args)
  });
  if (res.ok) return;
  const b = await res.json().catch(() => ({}));
  const e = new Error((b && b.message) || 'That could not be done.');
  e.team = true;
  throw e;
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return P.json(405, { error: 'POST only' });
  let body = {};
  try { body = JSON.parse(event.body || '{}') || {}; } catch (e) { return P.json(400, { error: 'unreadable' }); }

  let me;
  try { me = await whoIs(event); } catch (e) { me = null; }
  if (!me) return P.json(401, { error: 'Please sign in to your account first.' });
  if (!P.serviceKey()) return P.json(503, { error: 'Rewards are not switched on yet.' });

  const action = String(body.action || '');
  try {
    /* ---------------------------------------------------------- status */
    if (action === 'status') {
      const link = await linkOf(me.id);
      if (!link) return P.json(200, { linked: false, waiting: await openRequests(me.id) });
      let s;
      try { s = await standingOf(link.cust_no); }
      catch (e) { return P.json(200, { linked: true, number: link.cust_no, unavailable: true }); }
      if (!s.cust) return P.json(200, { linked: true, number: link.cust_no, missing: true });
      return P.json(200, Object.assign({ linked: true, number: link.cust_no }, s.standing));
    }

    /* ------------------------------------------------------------ link */
    if (action === 'link') {
      if (!R.plausibleNumber(body.number)) {
        return P.json(400, { error: 'That does not look like a customer number. It is printed on your receipts.' });
      }
      const number = R.numberKey(body.number);
      if (await linkOf(me.id)) return P.json(400, { error: 'This account is already linked to your rewards.' });

      /* No more than a few codes an hour, for this account and for this
         number, so nobody can fill a customer's inbox. */
      const hourAgo = new Date(Date.now() - 3600000).toISOString();
      const mine = await P.svc('GET', 'rewards_codes?user_id=eq.' + encodeURIComponent(me.id) + '&select=sends,window_at');
      const recent = await P.svc('GET', 'rewards_codes?cust_no=eq.' + encodeURIComponent(number) +
        '&window_at=gt.' + encodeURIComponent(hourAgo) + '&select=sends');
      const mineSends = (mine && mine[0] && new Date(mine[0].window_at) > new Date(hourAgo)) ? Number(mine[0].sends) || 0 : 0;
      const numberSends = (recent || []).reduce((a, r) => a + (Number(r.sends) || 0), 0);
      if (mineSends >= SENDS_PER_HOUR || numberSends >= SENDS_PER_HOUR) {
        return P.json(429, { error: 'Too many codes have been asked for. Please try again in an hour.' });
      }

      /* Whether the number is real, already someone's, or has no email is
         never said. Only what happens next differs, and only inside here. */
      /* Why no code went is written for the team only (Admin > Rewards),
         never for the person asking. */
      let to = '', why = '';
      try {
        const state = await R.readPlatform();
        const cust = R.customerByNumber(state, number);
        const taken = await P.svc('GET', 'rewards_links?cust_no=eq.' + encodeURIComponent(number) + '&select=user_id');
        if (!cust) why = 'This number is not on exactly one customer on the platform (not found, a Walk-in, or used twice).';
        else if (taken && taken.length) why = 'This number is already linked to another website account.';
        else if (!(to = R.emailOf(cust))) why = 'The customer record on the platform has no email address.';
      } catch (e) { to = ''; why = 'The platform could not be read just now.'; }

      const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
      let sent = false;
      if (to) {
        sent = await mailCode(to, code);
        if (!sent) why = 'The code email could not be sent. Check Settings > Notifications.';
      }

      const fresh = !(mine && mine[0]) || new Date(mine[0].window_at) <= new Date(hourAgo);
      await P.svc('POST', 'rewards_codes?on_conflict=user_id', {
        user_id: me.id, cust_no: number,
        code_hash: sent ? hash(me.id, code) : null,
        expires_at: new Date(Date.now() + CODE_MINUTES * 60000).toISOString(),
        tries: 0, sends: fresh ? 1 : mineSends + 1,
        window_at: fresh ? new Date().toISOString() : mine[0].window_at
      }, 'resolution=merge-duplicates,return=minimal');
      if (!sent && await askTeam(me.id, 'link', { cust_no: number, note: why })) {
        await tellShop('a customer asked to link customer number ' + number);
      }
      return P.json(200, { asked: true, message: SAY_SENT });
    }

    /* ---------------------------------------------------------- verify */
    if (action === 'verify') {
      const code = String(body.code || '').replace(/\D/g, '');
      const rows = await P.svc('GET', 'rewards_codes?user_id=eq.' + encodeURIComponent(me.id) + '&select=*');
      const row = rows && rows[0];
      const wrong = 'That code is not right, or it has run out. Check the email, or ask for a new code.';
      if (!row || !row.code_hash || new Date(row.expires_at) < new Date() || row.tries >= MAX_TRIES || code.length !== 6) {
        return P.json(400, { error: wrong });
      }
      if (!same(row.code_hash, hash(me.id, code))) {
        await P.svc('PATCH', 'rewards_codes?user_id=eq.' + encodeURIComponent(me.id), { tries: row.tries + 1 }, 'return=minimal');
        return P.json(400, { error: wrong });
      }
      try {
        await P.svc('POST', 'rewards_links', { user_id: me.id, cust_no: row.cust_no, how: 'code' }, 'return=minimal');
      } catch (e) {
        if (!/\b409\b|duplicate/.test(e.message)) throw e;
        await askTeam(me.id, 'link', { cust_no: row.cust_no });
        return P.json(409, { error: 'This number could not be linked here. Our team will confirm it with you.' });
      }
      await P.svc('DELETE', 'rewards_codes?user_id=eq.' + encodeURIComponent(me.id), undefined, 'return=minimal');
      return P.json(200, { linked: true });
    }

    /* ------------------------------------------------------------ join */
    if (action === 'join') {
      /* Email only: the account's own, already confirmed by Supabase. */
      const name = String(body.name || '').trim().slice(0, 80);
      if (!name) return P.json(400, { error: 'Please give your name.' });
      if (!R.emailOf(me)) return P.json(400, { error: 'Your account has no email address we can use.' });
      const fresh = await askTeam(me.id, 'join', { name, email: me.email });
      let emailed = false;
      if (fresh) {
        await tellShop(name + ' asked to join Vaultique Rewards');
        emailed = await mail(R.emailOf(me), 'We have your request to join {shop} Rewards', [
          'Hello ' + name.split(' ')[0] + ',',
          'Thank you for asking to join {shop} Rewards. We will register you and email you your customer number, ' +
          'usually within a day. Once you have it, your points show in your account on the website.'
        ]);
      }
      return P.json(200, { asked: true, emailed });
    }

    /* ----------------------------------------------------- quote, hold */
    if (action === 'quote' || action === 'hold') {
      const link = await linkOf(me.id);
      if (!link) return P.json(400, { error: 'Link your rewards first.' });
      const due = Math.round((Number(body.due) || 0) * 100) / 100;
      const s = await standingOf(link.cust_no);
      if (!s.cust) return P.json(400, { error: 'Your rewards could not be found. Please ask us.' });
      const q = R.redeemQuote(s.standing.points, due, s.state.settings || {});
      if (!q || !(q.points > 0)) return P.json(200, { quote: null });
      if (action === 'quote') return P.json(200, { quote: q });

      const ref = String(body.orderRef || '').trim().slice(0, 40);
      if (!/^[A-Za-z0-9-]{4,40}$/.test(ref)) return P.json(400, { error: 'unreadable order reference' });
      try {
        await P.svc('POST', 'rewards_holds', {
          user_id: me.id, cust_no: link.cust_no, order_ref: ref, points: q.points, value: q.value
        }, 'return=minimal');
      } catch (e) {
        if (/\b409\b|duplicate/.test(e.message)) return P.json(409, { error: 'Points are already promised on this order.' });
        throw e;
      }
      return P.json(200, { held: q, number: link.cust_no });
    }

    /* ------------------------------------------------------------ team
       Admin > Rewards. The decision is the database's to allow; this only
       adds the email to the customer afterwards. */
    if (action === 'team') {
      const id = String(body.request || '');
      if (!/^[0-9a-f-]{36}$/i.test(id)) return P.json(400, { error: 'unreadable request' });
      const token = String((event.headers || {}).authorization || (event.headers || {}).Authorization || '').replace(/^Bearer\s+/i, '');
      const op = String(body.op || '');
      try {
        if (op === 'join_done') await asTeam(token, 'rewards_join_done', { p_request: id, p_cust_no: String(body.number || '') });
        else if (op === 'approve' || op === 'decline') await asTeam(token, 'rewards_decide', { p_request: id, p_approve: op === 'approve' });
        else return P.json(400, { error: 'unknown step' });
      } catch (e) {
        if (e.team) return P.json(400, { error: e.message });
        throw e;
      }
      if (op === 'decline') return P.json(200, { done: true, emailed: false });

      const q = await P.svc('GET', 'rewards_requests?id=eq.' + encodeURIComponent(id) + '&select=user_id,kind,cust_no,name');
      const req = q && q[0];
      let emailed = false;
      if (req && req.cust_no) {
        const to = await accountEmail(req.user_id);
        emailed = await mail(to, req.kind === 'join' ? 'Welcome to {shop} Rewards' : 'Your {shop} Rewards are linked', [
          req.kind === 'join'
            ? 'Hello' + (req.name ? ' ' + String(req.name).split(' ')[0] : '') + ', you are now registered for {shop} Rewards.'
            : 'Your website account is now linked to your {shop} Rewards.',
          'Your customer number is ' + req.cust_no + '. Give it at the till so your purchases earn points.',
          'Sign in on the website and open your account to see your points and use them on your next order.'
        ]);
      }
      return P.json(200, { done: true, emailed });
    }

    /* ---------------------------------------------------------- unlink */
    if (action === 'unlink') {
      await P.svc('DELETE', 'rewards_links?user_id=eq.' + encodeURIComponent(me.id), undefined, 'return=minimal');
      return P.json(200, { linked: false });
    }

    return P.json(400, { error: 'unknown action' });
  } catch (e) {
    console.error('[rewards]', e && e.message);
    return P.json(500, { error: 'Rewards could not be reached just now. Please try again shortly.' });
  }
};

module.exports._internals = { hash, SAY_SENT };
