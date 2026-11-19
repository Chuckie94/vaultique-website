/* =====================================================================
   Vaultique Boutique Point — one email from the shop's own account
   ---------------------------------------------------------------------
   Settings > Notifications: the same account the admin's "Send a test
   email" uses. shopMail returns false, quietly, when email is not set up
   or the send fails; the reason is written to the function log.

   THE PASSWORD (build 77). It is read here, on the server, and nowhere
   else. Since supabase-hardening.sql (build 77) the database keeps it in
   a private row that nobody signed in can read, not even the owner
   ('mail_secret'): Settings can replace it but never show it. Before
   that SQL has been run it is still beside the other private settings,
   and is read from there.
   ===================================================================== */
'use strict';
const P = require('./_pay');
const { settings } = require('./_seo-data');

async function mailAccount() {
  const [n, priv, general] = await Promise.all([
    settings('notifications'),
    P.svc('GET', 'site_settings_private?key=in.(mail_secret,notifications)&select=key,data'),
    settings('general')
  ]);
  const rows = {};
  (priv || []).forEach((r) => { rows[r.key] = (r && r.data) || {}; });
  const pub = n || {};
  return {
    pub,
    password: (rows.mail_secret && rows.mail_secret.smtpPassword) ||
              (rows.notifications && rows.notifications.smtpPassword) || '',
    shop: (general && general.businessName) || 'Vaultique Boutique Point',
    ready: !!(pub.emailEnabled && pub.smtpHost && pub.senderEmail)
  };
}

/* What sendMail needs, from the account as stored. */
function accountConfig(a) {
  return {
    smtpHost: a.pub.smtpHost, smtpPort: a.pub.smtpPort, encryption: a.pub.encryption,
    smtpUser: a.pub.smtpUser, smtpPassword: a.password,
    senderName: a.pub.senderName || a.shop, senderEmail: a.pub.senderEmail, replyTo: a.pub.replyTo
  };
}

async function shopMail(to, subject, lines) {
  if (!to) return false;
  try {
    const a = await mailAccount();
    if (!a.ready) {
      console.error('[mail] not sent: email is not set up in Settings > Notifications');
      return false;
    }
    const sendMail = require('./send-email')._internals.sendMail;
    await sendMail(Object.assign(accountConfig(a), {
      to,
      subject: String(subject).replace(/\{shop\}/g, a.shop),
      text: lines.join('\n\n').replace(/\{shop\}/g, a.shop) + '\n\n' + (a.pub.signature || a.shop)
    }));
    return true;
  } catch (e) {
    console.error('[mail] not sent:', e && e.message);
    return false;
  }
}

module.exports = { shopMail, mailAccount, accountConfig };
