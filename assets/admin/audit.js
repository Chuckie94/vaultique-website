/* =====================================================================
   Vaultique Boutique Point - admin activity log, the recording half
   ---------------------------------------------------------------------
   One place that writes a line to the activity log, so every part of the
   admin records a change the same way and none of them can invent its
   own idea of what a record looks like.

   Two rules are built into this file rather than left as something to
   remember.

   THE FIRST: a private value is never written down. The bank details and
   the SMTP password live in a table with no public read rule at all. A
   log line saying "account number changed from 0123456789 to 0987654321"
   would put that number straight back into a table an ordinary admin
   query can read, in plain text, for years - undoing the whole point of
   keeping it apart. So a change to a private field records that the
   field changed and nothing more. There is no flag to turn this off.

   THE SECOND: recording must never break the thing it is recording. Every
   call here swallows its own failures. An owner who cannot save a price
   because the log was unreachable would rightly throw the whole thing
   out, and a missing line is a far smaller problem than a shop that
   cannot change its prices.
   ===================================================================== */
(function () {
  'use strict';

  var api = (typeof window !== 'undefined' && window.VBP_ADMIN) || {};

  /* Settings categories whose values are private, and the individual
     fields elsewhere that are secret in their own right. Anything named
     here is recorded as "changed" with no before and no after. */
  var PRIVATE_KEYS = ['payments', 'notifications'];
  var SECRET_FIELDS = ['smtpPassword', 'password', 'secret', 'token', 'apiKey',
                       'bankAccountNumber', 'bankBranchCode', 'mobileAccounts'];

  /* How each settings row is named where a person reads it. */
  var MODULES = {
    general: 'Settings · General',
    branding: 'Settings · Branding & Appearance',
    contact: 'Settings · Contact & Social',
    shopping: 'Settings · Shopping',
    pricing: 'Settings · Pricing & Tax',
    delivery: 'Settings · Delivery & Collection',
    payments: 'Settings · Payments',
    'customer-accounts': 'Settings · Customer Accounts',
    notifications: 'Settings · Notifications',
    seo: 'Settings · SEO',
    homepage: 'Settings · Homepage',
    'customer-care': 'Settings · Customer Care',
    newsletter: 'Settings · Newsletter',
    security: 'Settings · Security',
    system: 'Settings · System & Maintenance'
  };

  function moduleFor(key) { return MODULES[key] || ('Settings · ' + key); }

  /* Everywhere else in the admin that writes a line. The settings names
     above are generated from their own keys; these are written by hand
     where the change happens, and the log's filter needs the whole
     vocabulary — a list built from whatever has been paged in can only
     offer the sections that happen to have been busy lately. */
  var OTHER_MODULES = ['Products & Photos', 'Orders', 'Reviews', 'Subscribers', 'Policies'];

  function moduleNames() {
    var out = [], seen = {}, k, i;
    for (k in MODULES) {
      if (!Object.prototype.hasOwnProperty.call(MODULES, k)) continue;
      if (seen[MODULES[k]]) continue;
      seen[MODULES[k]] = true; out.push(MODULES[k]);
    }
    for (i = 0; i < OTHER_MODULES.length; i++) {
      if (seen[OTHER_MODULES[i]]) continue;
      seen[OTHER_MODULES[i]] = true; out.push(OTHER_MODULES[i]);
    }
    return out.sort();
  }

  function isPrivateKey(key) {
    for (var i = 0; i < PRIVATE_KEYS.length; i++) if (PRIVATE_KEYS[i] === key) return true;
    return false;
  }

  function isSecretField(name) {
    var n = String(name || '').toLowerCase();
    for (var i = 0; i < SECRET_FIELDS.length; i++) {
      if (n.indexOf(String(SECRET_FIELDS[i]).toLowerCase()) > -1) return true;
    }
    return false;
  }

  /* A value short enough to read in a table and safe to keep. Long text
     is cut rather than stored whole: the log is for telling what changed,
     not for holding a second copy of the shop's content. */
  function brief(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'boolean') return v ? 'on' : 'off';
    if (typeof v === 'number') return String(v);
    if (typeof v === 'object') {
      var many = Array.isArray(v) ? v.length + (v.length === 1 ? ' item' : ' items') : 'updated';
      return many;
    }
    var s = String(v);
    return s.length > 120 ? s.slice(0, 117) + '…' : s;
  }

  function same(a, b) {
    if (a === b) return true;
    if (a === null || a === undefined) a = '';
    if (b === null || b === undefined) b = '';
    if (typeof a === 'object' || typeof b === 'object') {
      try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; }
    }
    return String(a) === String(b);
  }

  /* What actually changed between two versions of a settings row.

     `key` names the category, so a private one records field names only.
     A field that is secret in its own right is held back even inside an
     otherwise public category. */
  function diff(before, after, key) {
    var out = [], hidden = isPrivateKey(key), n;
    var seen = {};
    for (n in after) {
      if (!Object.prototype.hasOwnProperty.call(after, n)) continue;
      seen[n] = true;
      if (same(before ? before[n] : undefined, after[n])) continue;
      out.push(hidden || isSecretField(n)
        ? { field: n, hidden: true }
        : { field: n, from: brief(before ? before[n] : undefined), to: brief(after[n]) });
    }
    /* A field removed altogether still counts as a change. */
    for (n in before) {
      if (!Object.prototype.hasOwnProperty.call(before, n) || seen[n]) continue;
      if (same(before[n], undefined)) continue;
      out.push(hidden || isSecretField(n)
        ? { field: n, hidden: true }
        : { field: n, from: brief(before[n]), to: '' });
    }
    return out;
  }

  /* The browser and device, as the browser is willing to say. Not a
     location and not an address: a page cannot know either, and a column
     labelled "session information" holding a guess would be worse than
     one holding the little that is true. */
  function device() {
    try {
      var ua = navigator.userAgent || '';
      var name = /Edg\//.test(ua) ? 'Edge'
        : /OPR\//.test(ua) ? 'Opera'
        : /Chrome\//.test(ua) ? 'Chrome'
        : /Safari\//.test(ua) ? 'Safari'
        : /Firefox\//.test(ua) ? 'Firefox' : 'a browser';
      var os = /Windows/.test(ua) ? 'Windows'
        : /Android/.test(ua) ? 'Android'
        : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
        : /Mac OS X/.test(ua) ? 'macOS'
        : /Linux/.test(ua) ? 'Linux' : '';
      return name + (os ? ' on ' + os : '');
    } catch (e) { return ''; }
  }

  /* Write one line. Resolves either way: see the second rule at the top. */
  function record(entry) {
    var sb = api.sb;
    if (!sb || !entry) return Promise.resolve(null);

    var changes = entry.changes || null;
    if (changes && !changes.length) return Promise.resolve(null);   // nothing moved

    return Promise.resolve(sb.auth.getSession()).then(function (r) {
      var user = r && r.data && r.data.session && r.data.session.user;
      return sb.from('activity_log').insert({
        actor_id: (user && user.id) || null,
        actor_email: (user && user.email) || null,
        action: entry.action || 'changed',
        module: entry.module || '',
        record: entry.record || '',
        changes: changes,
        device: device()
      });
    }).then(function () { return true; })
      .catch(function () { return null; });
  }

  /* The shape almost every caller wants: a settings row was saved. */
  function settingsSaved(key, before, after) {
    return record({
      action: 'changed',
      module: moduleFor(key),
      record: isPrivateKey(key) ? 'Private details' : 'Section settings',
      changes: diff(before, after, key)
    });
  }

  var audit = {
    record: record,
    diff: diff,
    settingsSaved: settingsSaved,
    moduleFor: moduleFor,
    moduleNames: moduleNames,
    OTHER_MODULES: OTHER_MODULES,
    isPrivateKey: isPrivateKey,
    isSecretField: isSecretField,
    brief: brief,
    device: device,
    MODULES: MODULES
  };

  api.audit = audit;
  if (typeof window !== 'undefined') window.VBP_ADMIN = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = audit;
})();
