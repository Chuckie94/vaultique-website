/* =====================================================================
   Vaultique Boutique Point - admin settings store
   ---------------------------------------------------------------------
   One place that reads and writes the site_settings table. Every
   Settings category uses this instead of talking to Supabase itself, so
   they all behave the same way and none of them can invent its own
   storage rules.

   Each category owns one row, keyed by the same key it registers with:

     site_settings.key   'general'
     site_settings.data  { businessName: 'Vaultique', ... }

   Loaded rows are cached for the life of the page, so re-opening a
   section is instant and does not re-fetch. Saving updates the cache.

   Usage from inside a category's render():

     ctx.store.load('general').then(function (values) { ... });
     ctx.store.save('general', values).then(...)

   Defaults are registered per key. load() always returns defaults with
   the stored values layered on top, so a category never has to check
   whether a field exists yet.
   ===================================================================== */
(function () {
  'use strict';

  var api = window.VBP_ADMIN || {};
  var TABLE = 'site_settings';
  /* Anything the storefront can read is public, because it reads with the
     anon key. Settings that must not be are kept in a separate table with
     no public read policy at all, reachable only by a signed-in admin. */
  var PRIVATE_TABLE = 'site_settings_private';

  var defaults = {};   // key -> defaults object
  var cache = {};      // key -> loaded values object
  var inflight = {};   // key -> promise, so two callers share one request

  /* Shallow copy. Values are plain JSON, and nested objects (business
     hours) are replaced wholesale rather than merged field by field. */
  function copy(obj) {
    var out = {}, k;
    for (k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
    return out;
  }

  /* Defaults underneath, stored values on top. Only keys that are
     actually present in the stored row override a default, so a field
     added to a category later still gets its default on an old row. */
  function merge(key, stored) {
    var base = copy(defaults[key] || {}), k;
    if (stored) {
      for (k in stored) {
        if (!Object.prototype.hasOwnProperty.call(stored, k)) continue;
        if (stored[k] === null || stored[k] === undefined) continue;
        base[k] = stored[k];
      }
    }
    return base;
  }

  var store = {
    /* Declare the defaults for one category. Call this at registration
       time, before anything tries to load the category. */
    registerDefaults: function (key, obj) {
      defaults[key] = obj || {};
    },

    /* The defaults for one category, as a fresh copy. */
    defaults: function (key) {
      return copy(defaults[key] || {});
    },

    /* Read one category. Resolves with a values object, never rejects
       for "no row yet" - that simply means defaults. A real database
       error does reject, so the page can show it. */
    load: function (key) {
      if (cache[key]) return Promise.resolve(copy(cache[key]));
      if (inflight[key]) return inflight[key].then(function () { return copy(cache[key]); });

      var sb = api.sb;
      if (!sb) return Promise.reject(new Error('The database is not connected.'));

      inflight[key] = sb.from(TABLE).select('data').eq('key', key).maybeSingle()
        .then(function (r) {
          if (r.error) throw r.error;
          cache[key] = merge(key, r.data && r.data.data);
          delete inflight[key];
        })
        .catch(function (e) {
          delete inflight[key];
          throw e;
        });

      return inflight[key].then(function () { return copy(cache[key]); });
    },

    /* Write one category. Resolves with the saved values. */
    save: function (key, values) {
      var sb = api.sb;
      if (!sb) return Promise.reject(new Error('The database is not connected.'));

      var payload = copy(values || {});
      /* Taken before the write, because afterwards there is nothing left
         to compare against. */
      var before = cache[key] ? copy(cache[key]) : null;

      return sb.from(TABLE)
        .upsert({ key: key, data: payload, updated_at: new Date().toISOString() }, { onConflict: 'key' })
        .then(function (r) {
          if (r.error) throw r.error;
          cache[key] = merge(key, payload);
          /* The activity log is told after the save has succeeded, and
             never before: a line saying something changed when it did
             not is worse than no line at all. It cannot fail the save -
             see the note at the top of audit.js. */
          if (api.audit) api.audit.settingsSaved(key, before, cache[key]);
          return copy(cache[key]);
        });
    },

    /* The private side of a category. Same shape, different table, and
       deliberately no defaults: an account number has no sensible default
       and an empty one must read as empty rather than as something. */
    loadPrivate: function (key) {
      var sb = api.sb;
      if (!sb) return Promise.reject(new Error('The database is not connected.'));
      return sb.from(PRIVATE_TABLE).select('data').eq('key', key).maybeSingle()
        .then(function (r) {
          if (r.error) throw r.error;
          return (r.data && r.data.data) || {};
        });
    },

    savePrivate: function (key, values) {
      var sb = api.sb;
      if (!sb) return Promise.reject(new Error('The database is not connected.'));

      /* Private rows are not cached, so the previous version has to be
         read to know which fields moved. Only the NAMES are ever
         recorded - audit.js will not write the values of a private
         category whatever it is handed. */
      var before = null;
      var known = api.audit
        ? store.loadPrivate(key).then(function (v) { before = v; }).catch(function () {})
        : Promise.resolve();

      return known.then(function () {
        return sb.from(PRIVATE_TABLE)
          .upsert({ key: key, data: copy(values || {}), updated_at: new Date().toISOString() },
                  { onConflict: 'key' });
      }).then(function (r) {
        if (r.error) throw r.error;
        if (api.audit) api.audit.settingsSaved(key, before, copy(values || {}));
        return copy(values || {});
      });
    },

    /* Drop a cached category so the next load() re-reads it. No key
       clears everything. */
    forget: function (key) {
      if (key) delete cache[key]; else cache = {};
    }
  };

  api.store = store;
  window.VBP_ADMIN = api;
})();
