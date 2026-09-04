/* =====================================================================
   Vaultique Boutique Point — being told a customer is waiting
   ---------------------------------------------------------------------
   Two different things, kept in one file because they answer the same
   question and the shop should be able to reason about them together:

     * THE PHONE, when nobody has the panel open. A push, sent by the
       database through a Netlify function, shown by sw.js. Everything
       here does is ask the browser for permission and hand the
       subscription to the database. The buzzing happens elsewhere.

     * THE DESK, when somebody does. A short sound and a count in the
       tab title. A person with the panel open on a second monitor does
       not need their phone to buzz; they need to notice.

   WHY THE PERMISSION IS NOT ASKED FOR ON ARRIVAL. A browser only lets a
   site ask once. Asked the moment the page loads, before anything has
   happened, most people say no — and then it cannot be asked again from
   the site at all; it has to be undone in browser settings, which is a
   thing nobody knows how to do. So it is a button, pressed by somebody
   who has decided they want it.

   ON AN IPHONE. Safari will not deliver a push to a page in a tab, only
   to one added to the home screen. The button says so rather than
   failing, because "nothing happened" is the worst possible answer.
   ===================================================================== */
(function () {
  'use strict';

  var API = {};

  /* ---------------------------------------------------------- the phone */

  function supported() {
    return typeof navigator !== 'undefined' &&
           'serviceWorker' in navigator &&
           typeof window.PushManager !== 'undefined' &&
           typeof window.Notification !== 'undefined';
  }

  /* An iPhone or iPad that is looking at a tab rather than an installed
     app. standalone is Safari's own flag; display-mode covers everything
     else that installs. */
  function iosTab() {
    var ios = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
              (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (!ios) return false;
    var installed = window.navigator.standalone === true ||
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    return !installed;
  }

  function urlB64ToBytes(s) {
    var pad = '='.repeat((4 - (s.length % 4)) % 4);
    var raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function bytesToB64(buf) {
    var b = new Uint8Array(buf), s = '';
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /* Roughly what this browser is, so somebody with three devices
     subscribed can tell which is which when turning one off. Guessed
     from the user agent, which is guesswork — but "Chrome on Android"
     beside a Turn-off button is worth more than a row of identical
     endpoints. */
  function deviceLabel() {
    var ua = navigator.userAgent;
    var browser = /Edg\//.test(ua) ? 'Edge'
      : /OPR\//.test(ua) ? 'Opera'
      : /Firefox\//.test(ua) ? 'Firefox'
      : /Chrome\//.test(ua) ? 'Chrome'
      : /Safari\//.test(ua) ? 'Safari' : 'Browser';
    var os = /Android/.test(ua) ? 'Android'
      : /iPhone|iPad|iPod/.test(ua) ? 'iPhone or iPad'
      : /Windows/.test(ua) ? 'Windows'
      : /Mac OS X/.test(ua) ? 'a Mac'
      : /Linux/.test(ua) ? 'Linux' : 'this device';
    return browser + ' on ' + os;
  }

  var reg = null;
  function worker() {
    if (!supported()) return Promise.resolve(null);
    if (reg) return Promise.resolve(reg);
    return navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(function (r) { reg = r; return navigator.serviceWorker.ready; })
      .then(function (r) { reg = r || reg; return reg; })
      .catch(function () { return null; });
  }

  /* Whether this device is already set up. Asked of the browser, not of
     the database: the browser is the one that can have forgotten. */
  function current() {
    return worker().then(function (r) {
      if (!r) return null;
      return r.pushManager.getSubscription();
    }).catch(function () { return null; });
  }

  /* The state the button paints itself from. */
  API.state = function () {
    if (!supported()) {
      return Promise.resolve({ can: false, on: false,
        why: 'This browser cannot show notifications.' });
    }
    if (iosTab()) {
      return Promise.resolve({ can: false, on: false, ios: true,
        why: 'On an iPhone, add this page to the Home Screen first — ' +
             'Share, then Add to Home Screen — and open it from there.' });
    }
    if (Notification.permission === 'denied') {
      return Promise.resolve({ can: false, on: false, blocked: true,
        why: 'Notifications are blocked for this site. Turn them back on ' +
             'in the browser’s settings for this site, then try again.' });
    }
    return current().then(function (s) {
      return { can: true, on: !!s };
    });
  };

  /* Turning it on. Everything that can refuse does so with a sentence
     that says what to do next, because every one of these is something
     the person can fix and none of them is an error in the usual
     sense. */
  API.enable = function (sb) {
    if (!supported()) return Promise.reject(new Error('This browser cannot show notifications.'));
    if (iosTab()) {
      return Promise.reject(new Error(
        'On an iPhone, add this page to the Home Screen first — Share, then ' +
        'Add to Home Screen — and open it from there.'));
    }

    return Promise.resolve(Notification.requestPermission()).then(function (p) {
      if (p !== 'granted') {
        throw new Error(p === 'denied'
          ? 'Notifications are blocked for this site. You can turn them back ' +
            'on in the browser’s settings for this site.'
          : 'Nothing was chosen, so nothing changed. Press it again when ready.');
      }
      return worker();
    }).then(function (r) {
      if (!r) throw new Error('The notification helper could not start.');
      /* The public half of the shop's key pair. The database hands it
         out; the private half never leaves it. */
      return sb.rpc('chat_push_key').then(function (res) {
        if (res && res.error) throw res.error;
        var key = res && res.data;
        if (!key) {
          throw new Error('The shop’s notification keys are not set up yet. ' +
                          'Run supabase-chat-phase7.sql in Supabase first.');
        }
        return r.pushManager.getSubscription().then(function (existing) {
          /* A subscription made against a different key is dead to the
             new one and has to go before a new one can be made. */
          if (!existing) return r.pushManager.subscribe({
            userVisibleOnly: true, applicationServerKey: urlB64ToBytes(key)
          });
          return existing;
        });
      });
    }).then(function (sub) {
      var j = sub.toJSON ? sub.toJSON() : {};
      var keys = j.keys || {};
      return sb.rpc('chat_push_save', {
        p_endpoint: sub.endpoint,
        p_p256dh: keys.p256dh || bytesToB64(sub.getKey('p256dh')),
        p_auth: keys.auth || bytesToB64(sub.getKey('auth')),
        p_label: deviceLabel()
      }).then(function (res) {
        if (res && res.error) throw res.error;
        return true;
      });
    });
  };

  /* Turning it off on this device only. The browser subscription goes
     as well as the row, so the push service stops carrying messages
     that would arrive nowhere. */
  API.disable = function (sb) {
    return current().then(function (sub) {
      /* Nothing to turn off. A row could still be sitting in the
         database from a subscription this browser has since thrown
         away, but there is no way to name it from here — and the sender
         clears those itself the first time one answers 410. */
      if (!sub) return true;
      var endpoint = sub.endpoint;
      return Promise.resolve(sub.unsubscribe()).catch(function () { return false; })
        .then(function () {
          return sb.rpc('chat_push_drop', { p_endpoint: endpoint });
        })
        .then(function (res) {
          if (res && res.error) throw res.error;
          return true;
        });
    });
  };

  /* Called on every load of the chats page. A browser can replace a
     subscription on its own, and the row in the database then points at
     an address that answers 410 for ever. If this device is subscribed,
     the row is written again — chat_push_save is an upsert, so this is
     free when nothing has changed. */
  API.refresh = function (sb) {
    if (!supported() || Notification.permission !== 'granted') return Promise.resolve(false);
    return current().then(function (sub) {
      if (!sub) return false;
      var j = sub.toJSON ? sub.toJSON() : {};
      var keys = j.keys || {};
      return sb.rpc('chat_push_save', {
        p_endpoint: sub.endpoint,
        p_p256dh: keys.p256dh || bytesToB64(sub.getKey('p256dh')),
        p_auth: keys.auth || bytesToB64(sub.getKey('auth')),
        p_label: deviceLabel()
      }).then(function () { return true; });
    }).catch(function () { return false; });
  };

  /* --------------------------------------------------- where the shop is

     The database has to post to an absolute address to make a phone
     buzz, and it is the one thing a migration cannot know. Asking the
     shop to type it invites the one mistake that fails silently: the
     nudge is deliberately quiet when it fails, so a wrong address means
     phones that never buzz and nothing anywhere saying why.

     So the browser reports it instead — but not every address a browser
     might be looking at is the shop. This decides which ones count. It
     is handed the location rather than reading it, so all of it can be
     tested. */
  API.siteOrigin = function (loc) {
    var origin = String((loc && loc.origin) || '');
    var host = String((loc && loc.hostname) || '');

    /* http would send the hook secret in the clear. */
    if (origin.slice(0, 8) !== 'https://') return null;

    /* Somebody's working copy is not the shop. */
    if (host === 'localhost' || host === '::1' ||
        /^127\./.test(host) || /^192\.168\./.test(host) ||
        /^10\./.test(host) || /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host)) return null;

    /* A Netlify preview — deploy-preview-42--shop.netlify.app, or
       branch--shop.netlify.app. Those addresses stop answering when the
       next deploy replaces them, so a shop that opened one once would
       have had its notifications quietly pointed at a dead host. */
    if (host.indexOf('--') !== -1) return null;

    return origin;
  };

  /* ----------------------------------------------------------- the desk */

  /* A short two-note sound, made rather than downloaded. A file would be
     one more thing to upload, one more thing to 404, and one more thing
     to get the Content-Type wrong on. This is nine lines and cannot go
     missing.

     Browsers refuse to make a sound until the page has been clicked in
     at least once. Nothing here can change that, and nothing here should
     try: it is the rule that stops websites shouting at people. The
     first sound may be silent, and every one after it will not be. */
  var ac = null;
  function ding(volume) {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!ac) ac = new AC();
      if (ac.state === 'suspended' && ac.resume) ac.resume();
      var vol = typeof volume === 'number' ? Math.max(0, Math.min(1, volume)) : 0.35;
      [880, 1170].forEach(function (hz, i) {
        var o = ac.createOscillator(), g = ac.createGain();
        o.type = 'sine';
        o.frequency.value = hz;
        var t = ac.currentTime + i * 0.12;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
        o.connect(g); g.connect(ac.destination);
        o.start(t); o.stop(t + 0.18);
      });
    } catch (e) { /* a sound is never worth an exception */ }
  }
  API.ding = ding;

  /* The count in the tab title. Somebody working in another tab sees the
     shop's name change to "(2) Vaultique Admin", which is the one thing
     a browser will show them without permission of any kind. */
  var realTitle = null;
  API.badge = function (n) {
    if (realTitle === null) realTitle = document.title;
    document.title = n > 0 ? '(' + n + ') ' + realTitle : realTitle;
    /* And the number on the app icon, where the browser has one. */
    try {
      if (navigator.setAppBadge) {
        if (n > 0) navigator.setAppBadge(n); else navigator.clearAppBadge();
      }
    } catch (e) {}
  };

  window.VBP_CHAT_ALERTS = API;
})();
