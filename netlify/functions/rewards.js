/* =====================================================================
   Vaultique Boutique Point — Vaultique Rewards on the website
   ---------------------------------------------------------------------
   POST, signed in (the customer's own website session), with one of:

     { action: 'status' }              my points, if my account is linked
     { action: 'link', number }        prove a customer number is mine
     { action: 'verify', code }        the code from the email
     { action: 'join', name, phone }   not registered yet: ask the team
     { action: 'quote', due }          what my points would take off this much
     { action: 'hold', orderRef, due } promise them on this order
     { action: 'unlink' }              stop using rewards on this account

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
async function askTeam(userId, kind, extra) {
  try {
    await P.svc('POST', 'rewards_requests', Object.assign({ user_id: userId, kind }, extra || {}), 'return=minimal');
  } catch (e) {
    /* One open request of each kind per account: a second ask while the
       first waits is the same ask. */
    if (!/\b409\b|duplicate/.test(e.message)) throw e;
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

async function mailCode(to, code) {
  const [n, priv, general] = await Promise.all([
    settings('notifications'),
    P.svc('GET', 'site_settings_private?key=eq.notifications&select=data'),
    settings('general')
  ]);
  const secret = (priv && priv[0] && priv[0].data) || {};
  if (!n || !n.emailEnabled || !n.smtpHost || !n.senderEmail) return false;
  const shop = (general && general.businessName) || 'Vaultique Boutique Point';
  const sendMail = require('./send-email')._internals.sendMail;
  await sendMail({
    smtpHost: n.smtpHost, smtpPort: n.smtpPort, encryption: n.encryption,
    smtpUser: n.smtpUser, smtpPassword: secret.smtpPassword,
    senderName: n.senderName || shop, senderEmail: n.senderEmail, replyTo: n.replyTo,
    to,
    subject: 'Your ' + shop + ' Rewards code: ' + code,
    text: 'Your code is ' + code + '\n\n' +
          'Type it on the website to see and use your rewards points there. It works for ' +
          CODE_MINUTES + ' minutes.\n\n' +
          'If you did not ask for this, you can ignore this email: nothing changes unless the code is typed in.\n\n' +
          (n.signature || shop)
  });
  return true;
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
      let to = '';
      try {
        const state = await R.readPlatform();
        const cust = R.customerByNumber(state, number);
        const taken = await P.svc('GET', 'rewards_links?cust_no=eq.' + encodeURIComponent(number) + '&select=user_id');
        if (cust && !(taken && taken.length)) to = R.emailOf(cust);
      } catch (e) { to = ''; }

      const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
      let sent = false;
      if (to) { try { sent = await mailCode(to, code); } catch (e) { sent = false; } }

      const fresh = !(mine && mine[0]) || new Date(mine[0].window_at) <= new Date(hourAgo);
      await P.svc('POST', 'rewards_codes?on_conflict=user_id', {
        user_id: me.id, cust_no: number,
        code_hash: sent ? hash(me.id, code) : null,
        expires_at: new Date(Date.now() + CODE_MINUTES * 60000).toISOString(),
        tries: 0, sends: fresh ? 1 : mineSends + 1,
        window_at: fresh ? new Date().toISOString() : mine[0].window_at
      }, 'resolution=merge-duplicates,return=minimal');
      if (!sent) await askTeam(me.id, 'link', { cust_no: number });
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
      const name = String(body.name || '').trim().slice(0, 80);
      const phone = String(body.phone || '').replace(/[^\d+ ]/g, '').trim().slice(0, 30);
      if (!name || phone.replace(/\D/g, '').length < 9) {
        return P.json(400, { error: 'Please give your name and a phone number we can reach you on.' });
      }
      await askTeam(me.id, 'join', { name, phone });
      return P.json(200, { asked: true });
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
