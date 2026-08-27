/* =====================================================================
   Vaultique Boutique Point - Admin > Settings > Customer Accounts
   ---------------------------------------------------------------------
   Page shell only. Nothing is implemented in this section yet.

   To build this section later, work inside render() below and nowhere
   else. render() is handed an empty page body element plus a context
   object, so this file can be completed on its own without touching
   any other admin page.

     host  the empty <div class="page-body"> for this page
     ctx   { sb, cfg, esc, navigate } - shared helpers from the shell
   ===================================================================== */
(function () {
  'use strict';
  if (!window.VBP_ADMIN) return;

  window.VBP_ADMIN.registerSetting({
    key: 'customer-accounts',
    title: 'Customer Accounts',
    summary: 'Sign up, sign in, profiles and saved details for shoppers.',
    render: function (host, ctx) {
      host.innerHTML = '';
    }
  });
})();
