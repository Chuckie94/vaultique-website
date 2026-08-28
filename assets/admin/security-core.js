/* =====================================================================
   Vaultique Boutique Point - admin security, the parts with no screen
   ---------------------------------------------------------------------
   The rules behind Settings > Security. Kept apart from the page because
   the page is not where they matter: the idle timer, the sign-in gate
   and the storage choice all have to run in the admin shell, before any
   settings page exists.

   Nothing here talks to the DOM, so all of it can be tested directly.

   A note on what security in a browser can and cannot be.

   Two things here are real in the strongest sense - they happen on
   Supabase's servers and no amount of fiddling in a browser undoes them:
   two factor authentication, and signing other devices out. Two are real
   but local: the idle timer genuinely ends the session in this browser,
   and the remember-me choice genuinely decides whether the session
   survives the browser closing.

   One is deliberately weaker than its name suggests. Counting failed
   sign-ins in a browser slows down somebody typing guesses at the shop's
   own laptop. It does nothing at all against anyone willing to open a
   new browser or skip the page entirely, and it is not pretended
   otherwise anywhere the owner can read. Supabase rate limits sign-ins
   on its own side, and that is the part that actually stops an attack.
   ===================================================================== */
(function () {
  'use strict';

  var api = (typeof window !== 'undefined' && window.VBP_ADMIN) || {};

  /* The preference outlives the session on purpose: an owner who chose
     "keep me signed in" should not have to choose again every time. */
  var REMEMBER = 'vbp_admin_remember';
  var TRIES = 'vbp_admin_tries';
  /* An admin password is held to a floor of its own, whatever customers
     are asked for. Customer rules are a shop decision; this is not. */
  var ADMIN_MIN = 10;

  function safeLocal() {
    try { return window.localStorage; } catch (e) { return null; }
  }
  function safeSession() {
    try { return window.sessionStorage; } catch (e) { return null; }
  }
  function readKey(store, k) { try { return store ? store.getItem(k) : null; } catch (e) { return null; } }
  function writeKey(store, k, v) { try { if (store) store.setItem(k, v); } catch (e) {} }
  function dropKey(store, k) { try { if (store) store.removeItem(k); } catch (e) {} }

  /* ---- remember me ---------------------------------------------------- */

  /* Defaults to remembering, which is what every admin who has used this
     page so far has already been getting. */
  function remembering() {
    return readKey(safeLocal(), REMEMBER) !== '0';
  }

  function remember(on) {
    writeKey(safeLocal(), REMEMBER, on ? '1' : '0');
  }

  /* Handed to supabase-js as its session store. Writing goes to whichever
     side the preference names and clears the other, so switching the
     choice moves an existing session rather than leaving two copies to
     disagree. Reading looks in both, so a session written before the
     choice changed is still found. */
  function sessionStore() {
    return {
      getItem: function (k) {
        var v = readKey(safeLocal(), k);
        return v !== null ? v : readKey(safeSession(), k);
      },
      setItem: function (k, v) {
        if (remembering()) { writeKey(safeLocal(), k, v); dropKey(safeSession(), k); }
        else { writeKey(safeSession(), k, v); dropKey(safeLocal(), k); }
      },
      removeItem: function (k) {
        dropKey(safeLocal(), k);
        dropKey(safeSession(), k);
      }
    };
  }

  /* ---- passwords ------------------------------------------------------ */

  /* The stricter of the shop's customer rule and the admin floor. The
     customer rules already exist in Settings > Customer Accounts and are
     not asked for a second time here: one set of rules, applied more
     strictly to the account that can change everything. */
  function passwordProblem(pw, customerRules) {
    var s = customerRules || {};
    var min = Math.max(ADMIN_MIN, Number(s.passwordMinLength) || 0);
    pw = String(pw || '');
    if (pw.length < min) return 'Use at least ' + min + ' characters.';
    if (!/[0-9]/.test(pw)) return 'Include at least one number.';
    if (s.passwordNeedsSymbol && !/[^A-Za-z0-9]/.test(pw)) return 'Include at least one symbol.';
    /* Length is the only thing that reliably helps, so nothing else is
       demanded - but the handful of passwords that are guessed first are
       worth refusing outright. */
    if (/^(password|admin|vaultique|12345678|letmein)/i.test(pw)) {
      return 'That is one of the first passwords anybody would try.';
    }
    return '';
  }

  function passwordRule(customerRules) {
    var s = customerRules || {};
    var min = Math.max(ADMIN_MIN, Number(s.passwordMinLength) || 0);
    return 'At least ' + min + ' characters, including a number' +
           (s.passwordNeedsSymbol ? ' and a symbol' : '') + '.';
  }

  /* ---- failed sign-ins ------------------------------------------------ */
  /* Deliberately per browser and per email. See the note at the top: this
     slows down guessing at the shop's own laptop and nothing more. */

  function tries() {
    var raw = readKey(safeLocal(), TRIES);
    if (!raw) return {};
    try { return JSON.parse(raw) || {}; } catch (e) { return {}; }
  }

  function saveTries(t) {
    try { writeKey(safeLocal(), TRIES, JSON.stringify(t)); } catch (e) {}
  }

  function key(email) { return String(email || '').trim().toLowerCase(); }

  /* How long the owner must wait, in seconds, or 0 to go ahead. */
  function lockedFor(email, settings, now) {
    var s = settings || {};
    if (!s.lockoutEnabled) return 0;
    var rec = tries()[key(email)];
    if (!rec) return 0;
    var limit = Number(s.lockoutAttempts) || 5;
    if (rec.n < limit) return 0;
    var until = rec.at + (Number(s.lockoutMinutes) || 15) * 60000;
    var left = Math.ceil((until - (now || Date.now())) / 1000);
    return left > 0 ? left : 0;
  }

  function noteFailure(email, now) {
    var t = tries(), k = key(email);
    var rec = t[k] || { n: 0, at: 0 };
    rec.n += 1;
    rec.at = now || Date.now();
    t[k] = rec;
    saveTries(t);
    return rec.n;
  }

  function clearFailures(email) {
    var t = tries();
    delete t[key(email)];
    saveTries(t);
  }

  /* ---- the idle timer -------------------------------------------------- */

  /* A browser throttles timers in a background tab, so a plain setTimeout
     for thirty minutes cannot be trusted to fire on time. Instead the
     time of the last real activity is recorded and checked on a short
     tick, which is accurate whether the tab was awake or not. */
  function idleTimer(minutes, onTimeout, opts) {
    var o = opts || {};
    var win = o.window || window;
    var doc = o.document || (win && win.document);
    var every = o.checkEvery || 20000;
    var limit = Number(minutes) * 60000;
    var last = (o.now || Date.now)();
    var tick = null;
    var stopped = false;

    var EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll', 'focus'];

    function seen() { last = (o.now || Date.now)(); }

    function check() {
      if (stopped) return;
      if (limit > 0 && (o.now || Date.now)() - last >= limit) {
        stop();
        onTimeout();
      }
    }

    function stop() {
      if (stopped) return;
      stopped = true;
      if (tick) { clearInterval(tick); tick = null; }
      EVENTS.forEach(function (e) {
        if (doc && doc.removeEventListener) doc.removeEventListener(e, seen, true);
      });
    }

    if (limit > 0) {
      EVENTS.forEach(function (e) {
        if (doc && doc.addEventListener) doc.addEventListener(e, seen, true);
      });
      tick = setInterval(check, every);
    }

    return { stop: stop, check: check, seen: seen,
             idleFor: function () { return (o.now || Date.now)() - last; } };
  }

  /* ---- two factor ------------------------------------------------------ */

  /* Which TOTP factors are actually finished. An enrolment that was never
     confirmed with a code is not protection and must not be shown as if
     it were. */
  function factors(sb) {
    if (!sb || !sb.auth || !sb.auth.mfa) return Promise.resolve([]);
    return sb.auth.mfa.listFactors().then(function (r) {
      if (r.error) throw r.error;
      var all = (r.data && (r.data.totp || r.data.all)) || [];
      return all.filter(function (f) { return f && f.status === 'verified'; });
    }).catch(function () { return []; });
  }

  /* Whether this sign-in still owes a code.

     This is the whole point of enrolling. Supabase hands back a session
     as soon as the password is right; that session sits at level aal1,
     and only entering a code lifts it to aal2. Without this check an
     enrolled factor would change nothing whatsoever about signing in.

     The answer is worked out here in the browser, from the session's own
     token and the factors listed on it - there is no request behind it.
     That matters: falling back to "nothing owed" cannot be provoked by
     cutting the network, because nothing about this asks the network.
     The fallback is reached only when there is no session at all, and
     then there is nothing to let anybody into. */
  function codeOwed(sb) {
    if (!sb || !sb.auth || !sb.auth.mfa) return Promise.resolve(false);
    return sb.auth.mfa.getAuthenticatorAssuranceLevel().then(function (r) {
      if (r.error) throw r.error;
      var d = r.data || {};
      return d.nextLevel === 'aal2' && d.currentLevel !== 'aal2';
    }).catch(function () { return false; });
  }

  /* Answer a challenge on the first verified factor. */
  function submitCode(sb, code) {
    return factors(sb).then(function (list) {
      if (!list.length) throw new Error('There is no authenticator set up on this account.');
      var id = list[0].id;
      return sb.auth.mfa.challenge({ factorId: id }).then(function (c) {
        if (c.error) throw c.error;
        return sb.auth.mfa.verify({
          factorId: id,
          challengeId: c.data.id,
          code: String(code || '').replace(/\s/g, '')
        });
      });
    }).then(function (r) {
      if (r.error) throw r.error;
      return r.data;
    });
  }

  var core = {
    ADMIN_MIN: ADMIN_MIN,
    remembering: remembering,
    remember: remember,
    sessionStore: sessionStore,
    passwordProblem: passwordProblem,
    passwordRule: passwordRule,
    lockedFor: lockedFor,
    noteFailure: noteFailure,
    clearFailures: clearFailures,
    idleTimer: idleTimer,
    factors: factors,
    codeOwed: codeOwed,
    submitCode: submitCode
  };

  api.security = core;
  if (typeof window !== 'undefined') window.VBP_ADMIN = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = core;
})();
