/* =====================================================================
   Vaultique Boutique Point - admin module registry
   ---------------------------------------------------------------------
   Every admin page (Dashboard, Activity Log and each Settings category)
   registers itself here. The admin shell reads this registry to build
   the navigation and to render a page when it is opened.

   Nothing in this file touches the database, storage or any API. It is
   plumbing only. Registration order is script tag order, and that is
   the order the navigation is shown in.
   ===================================================================== */
(function () {
  'use strict';

  var api = window.VBP_ADMIN || {};
  api.pages = api.pages || {};       // top level pages, keyed
  api.settings = api.settings || []; // settings categories, ordered

  /* Register a top level admin page (Dashboard, Activity Log). */
  api.registerPage = function (def) {
    if (!def || !def.key) return;
    api.pages[def.key] = def;
  };

  /* Register one Settings category. Re registering a key replaces it. */
  api.registerSetting = function (def) {
    if (!def || !def.key) return;
    for (var i = 0; i < api.settings.length; i++) {
      if (api.settings[i].key === def.key) { api.settings[i] = def; return; }
    }
    api.settings.push(def);
  };

  /* Look up one Settings category by key. Returns null when not found. */
  api.setting = function (key) {
    for (var i = 0; i < api.settings.length; i++) {
      if (api.settings[i].key === key) return api.settings[i];
    }
    return null;
  };

  window.VBP_ADMIN = api;
})();
