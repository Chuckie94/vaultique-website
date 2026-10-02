/* =====================================================================
   Vaultique Boutique Point — one email from the shop's own account
   ---------------------------------------------------------------------
   Settings > Notifications: the same account the admin's "Send a test
   email" uses. Returns false, quietly, when email is not set up or the
   send fails; the reason is written to the function log.
   ===================================================================== */
'use strict';
const P = require('./_pay');
const { settings } = require('./_seo-data');

async function shopMail(to, subject, lines) {
  if (!to) return false;
  try {
    const [n, priv, general] = await Promise.all([
      settings('notifications'),
      P.svc('GET', 'site_settings_private?key=eq.notifications&select=data'),
      settings('general')
    ]);
    const secret = (priv && priv[0] && priv[0].data) || {};
    if (!n || !n.emailEnabled || !n.smtpHost || !n.senderEmail) {
      console.error('[mail] not sent: email is not set up in Settings > Notifications');
      return false;
    }
    const shop = (general && general.businessName) || 'Vaultique Boutique Point';
    const sendMail = require('./send-email')._internals.sendMail;
    await sendMail({
      smtpHost: n.smtpHost, smtpPort: n.smtpPort, encryption: n.encryption,
      smtpUser: n.smtpUser, smtpPassword: secret.smtpPassword,
      senderName: n.senderName || shop, senderEmail: n.senderEmail, replyTo: n.replyTo,
      to,
      subject: String(subject).replace(/\{shop\}/g, shop),
      text: lines.join('\n\n').replace(/\{shop\}/g, shop) + '\n\n' + (n.signature || shop)
    });
    return true;
  } catch (e) {
    console.error('[mail] not sent:', e && e.message);
    return false;
  }
}

module.exports = { shopMail };
