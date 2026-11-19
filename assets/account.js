/* =====================================================================
   Vaultique Boutique Point - customer accounts
   ---------------------------------------------------------------------
   Signing in, the account panel, saved addresses, and the wishlist that
   follows the person who made it.

   Kept out of app.js on purpose. The storefront is already long, and
   none of this exists at all for a shop with accounts switched off: with
   no Supabase client and no account settings, everything below is inert
   and the shop behaves exactly as it did before.

   What signing in does NOT do
   ---------------------------
   It gives a customer power over their own rows and nothing else.
   supabase-setup.sql keeps an admins table, and every rule that guards
   the shop's own data asks whether this user is in it. Before that file
   was rewritten, being signed in was enough to read the bank details.

   Guests are first class
   ----------------------
   A guest can buy, keep a wishlist and be remembered on their own
   device, because most people will never make an account and the shop
   should not punish them for it. Signing in adds; it does not gate.
   ===================================================================== */
(function () {
  'use strict';

  var api = {
    ready: false,
    user: null,          // { id, email, emailConfirmed }
    profile: null,       // row from customers
    settings: null,      // Settings > Customer Accounts
    addresses: [],
    /* Back from a "set a new password" email: signed in by the link, and
       asked for the new password before anything else. Read from the
       address now, because the client tidies its part of it away. */
    recovering: (function () {
      try {
        return /[?&]reset=1(&|$)/.test(location.search) ||
               /(^#|&)type=recovery(&|$)/.test(location.hash);
      } catch (e) { return false; }
    }())
  };

  var sb = null;
  var listeners = [];

  function tell() {
    listeners.forEach(function (fn) { try { fn(api); } catch (e) {} });
  }

  /* ---- what the shop has decided ------------------------------------ */

  function enabled() { return !!(api.settings && api.settings.accountsEnabled); }
  function canRegister() {
    return enabled() && (api.settings.registration || 'open') === 'open';
  }
  function guestsMayBuy() {
    /* Defaults to yes. A shop that has never opened the section lets
       everybody buy, which is how it ran before accounts existed. */
    return !api.settings || api.settings.guestCheckout !== false;
  }
  function needsVerifiedEmail() {
    return enabled() && api.settings.emailVerification !== false;
  }
  function signedIn() { return !!api.user; }

  /* Whether this person may reach the WhatsApp step at all. A guest may
     unless the shop has said otherwise; a customer always may once their
     email is confirmed. */
  function mayCheckout() {
    if (!enabled()) return true;
    if (signedIn()) {
      if (needsVerifiedEmail() && !api.user.emailConfirmed) return false;
      return true;
    }
    return guestsMayBuy();
  }
  function whyNotCheckout() {
    if (mayCheckout()) return '';
    if (signedIn()) return 'Please confirm your email address first — check your inbox.';
    return 'Please sign in to check out.';
  }

  /* ---- passwords ----------------------------------------------------
     Supabase enforces its own minimum on the server. Everything here can
     only ever be stricter, and says what it wants before somebody
     submits rather than after. */
  function passwordProblem(pw) {
    var s = api.settings || {};
    var min = Number(s.passwordMinLength);
    if (!isFinite(min) || min < 6) min = 8;
    if (!pw || pw.length < min) return 'Use at least ' + min + ' characters.';
    if (s.passwordNeedsNumber && !/[0-9]/.test(pw)) return 'Include at least one number.';
    if (s.passwordNeedsSymbol && !/[^A-Za-z0-9]/.test(pw)) return 'Include at least one symbol.';
    return '';
  }

  /* ---- the session --------------------------------------------------- */

  function readUser(u) {
    if (!u) return null;
    return {
      id: u.id,
      email: u.email || '',
      /* Supabase spells this differently between versions; both are read
         so a confirmed customer is never told to confirm again. */
      emailConfirmed: !!(u.email_confirmed_at || u.confirmed_at)
    };
  }

  function loadProfile() {
    if (!sb || !api.user) { api.profile = null; api.addresses = []; return Promise.resolve(); }
    return Promise.all([
      sb.from('customers').select('*').eq('id', api.user.id).maybeSingle(),
      sb.from('customer_addresses').select('*').eq('customer_id', api.user.id)
        .order('is_default', { ascending: false })
    ]).then(function (r) {
      api.profile = (r[0] && r[0].data) || null;
      api.addresses = (r[1] && r[1].data) || [];
      /* First sign-in on a device the shop has never seen: give them a
         row so a wishlist and a name have somewhere to live. */
      if (!api.profile) {
        return sb.from('customers')
          .upsert({ id: api.user.id, updated_at: new Date().toISOString() }, { onConflict: 'id' })
          .then(function () {
            api.profile = { id: api.user.id, wishlist: [] };
          }, function () {});
      }
    }, function () {});
  }

  /* The settings are known before the Supabase client is: the client is
     fetched over the network and the router runs long before it arrives.
     Taking them separately means enabled() tells the truth from the first
     moment, so #/account is not answered with the home page while a
     library downloads. */
  function configure(settings) {
    api.settings = settings || null;
    tell();
  }

  function start(client, settings) {
    sb = client || null;
    if (settings) api.settings = settings;

    if (!sb || !enabled()) { api.ready = true; tell(); return Promise.resolve(api); }

    return sb.auth.getSession().then(function (res) {
      var session = res && res.data && res.data.session;
      api.user = readUser(session && session.user);
      api.token = (session && session.access_token) || null;
      return loadProfile();
    }, function () {})
    .then(function () {
      api.ready = true;
      tell();
      /* A confirmation link brings them back signed in; a sign-out in
         another tab should not leave this one looking signed in. */
      try {
        sb.auth.onAuthStateChange(function (_e, session) {
          if (_e === 'PASSWORD_RECOVERY') api.recovering = true;
          var was = api.user && api.user.id;
          api.user = readUser(session && session.user);
          api.token = (session && session.access_token) || null;
          if ((api.user && api.user.id) === was) { tell(); return; }
          loadProfile().then(tell);
        });
      } catch (e) {}
      return api;
    });
  }

  /* ---- signing up, in and out ---------------------------------------- */

  /* The website's own sign-up (netlify/functions/account-signup.js): it
     makes the account and sends the confirm link through the shop's own
     email. Resolves null when that function is not there or not set up,
     and the caller then uses Supabase's own way. */
  var SIGNUP_FN = '/.netlify/functions/account-signup';
  function viaSite(payload) {
    if (typeof fetch !== 'function') return Promise.resolve(null);
    return fetch(SIGNUP_FN, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    }).then(function (res) {
      if (res.status === 404 || res.status === 405) return null;
      return res.json().catch(function () { return null; }).then(function (b) {
        /* Not this function's answer (a page, or nothing): not here. */
        if (!b || typeof b !== 'object' || b.fallback) return null;
        if (!res.ok) {
          if (!b.error) return null;
          var e = new Error(b.error);
          e.waiting = !!b.waiting; e.site = true;
          throw e;
        }
        if (payload.action === 'signup' && !b.created) return null;
        if (payload.action === 'resend' && !b.message) return null;
        return b;
      });
    }, function () { return null; });
  }

  function signUp(email, password, name) {
    if (!sb) return Promise.reject(new Error('Accounts are not available.'));
    if (!canRegister()) return Promise.reject(new Error('New accounts are closed at the moment.'));
    var bad = passwordProblem(password);
    if (bad) return Promise.reject(new Error(bad));
    var to = String(email || '').trim();

    return viaSite({ action: 'signup', email: to, password: password, name: String(name || '').trim() })
      .then(function (r) {
        if (!r) return supabaseSignUp(to, password, name);
        if (r.confirm) return { signedIn: false, confirm: true, emailed: r.emailed !== false, note: r.error || '' };
        /* No confirmation asked for: the account is ready, so sign in. */
        return signIn(to, password).then(function () {
          if (name) return saveProfile({ name: name });
        }).then(function () { return { signedIn: true }; });
      });
  }

  /* Supabase's own sign-up, which also sends its own confirm email. */
  function supabaseSignUp(email, password, name) {
    return sb.auth.signUp({
      email: email,
      password: password,
      options: {
        /* When they agreed, kept on the account itself, so the shop can
           show it was given. */
        data: { name: String(name || '').trim(), consent_at: new Date().toISOString() },
        emailRedirectTo: confirmLanding()
      }
    }).then(function (r) {
      if (r.error) throw r.error;
      var u = readUser(r.data && r.data.user);
      /* With email confirmation on, Supabase returns the user but no
         session. That is not a failure: they have an account and need to
         click a link. */
      if (r.data && r.data.session) {
        api.user = u;
        return loadProfile().then(function () {
          if (name) return saveProfile({ name: name });
        }).then(function () { tell(); return { signedIn: true }; });
      }
      return { signedIn: false, confirm: true };
    });
  }

  /* Where the link in the "confirm your email" message brings them back.
     Supabase only follows it if the address is allowed in its URL
     Configuration; otherwise it uses the Site URL there. */
  function confirmLanding() { return location.origin + (window.VBP_BASE || '/') + 'account'; }

  /* The confirm link, sent again. Supabase answers the same whether or not
     the address has an account, so nothing is given away. */
  function resendLink(email) {
    if (!sb) return Promise.reject(new Error('Accounts are not available.'));
    var to = String(email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return Promise.reject(new Error('Enter your email address first.'));
    return viaSite({ action: 'resend', email: to }).then(function (r) {
      if (r) return true;
      if (!sb.auth.resend) throw new Error('Please try creating the account again.');
      return sb.auth.resend({ type: 'signup', email: to, options: { emailRedirectTo: confirmLanding() } })
        .then(function (x) { if (x && x.error) throw x.error; return true; });
    });
  }

  /* A "send the link again" button, quiet for a minute after each send. */
  function resendButton(getEmail, msg) {
    var b = el('button', 'ac-link ac-resend', 'Send the link again');
    b.type = 'button';
    b.addEventListener('click', function () {
      say(msg, 'Sending…', 'busy'); b.disabled = true;
      resendLink(getEmail()).then(function () {
        say(msg, 'Sent again. Check your inbox and the spam or junk folder. It can take a few minutes.', 'ok');
        setTimeout(function () { b.disabled = false; }, 60000);
      }, function (e) { b.disabled = false; say(msg, friendly(e), 'err'); });
    });
    return b;
  }

  function signIn(email, password) {
    if (!sb) return Promise.reject(new Error('Accounts are not available.'));
    return sb.auth.signInWithPassword({
      email: String(email || '').trim(), password: password
    }).then(function (r) {
      if (r.error) throw r.error;
      api.user = readUser(r.data && r.data.user);
      return loadProfile().then(function () { tell(); return api; });
    });
  }

  function signOut() {
    if (!sb) return Promise.resolve();
    return sb.auth.signOut().then(function () {
      api.user = null; api.profile = null; api.addresses = [];
      tell();
    }, function () {});
  }

  function resetPassword(email) {
    if (!sb) return Promise.reject(new Error('Accounts are not available.'));
    if (api.settings && api.settings.passwordReset === false) {
      return Promise.reject(new Error('Password reset is not available. Please message us.'));
    }
    /* A real address with ?reset=1, not #/account: Supabase puts its own
       part of the link after a #, and two #s in one address broke it. */
    return sb.auth.resetPasswordForEmail(String(email || '').trim(), {
      redirectTo: location.origin + (window.VBP_BASE || '/') + 'account?reset=1'
    }).then(function (r) {
      if (r && r.error) throw r.error;
      return true;
    });
  }

  function changePassword(pw) {
    if (!sb || !api.user) return Promise.reject(new Error('Please sign in first.'));
    var bad = passwordProblem(pw);
    if (bad) return Promise.reject(new Error(bad));
    return sb.auth.updateUser({ password: pw }).then(function (r) {
      if (r.error) throw r.error;
      return true;
    });
  }

  /* ---- the profile ---------------------------------------------------- */

  function saveProfile(patch) {
    if (!sb || !api.user) return Promise.reject(new Error('Please sign in first.'));
    var row = { id: api.user.id, updated_at: new Date().toISOString() };
    for (var k in patch) {
      if (Object.prototype.hasOwnProperty.call(patch, k)) row[k] = patch[k];
    }
    return sb.from('customers').upsert(row, { onConflict: 'id' }).then(function (r) {
      if (r.error) throw r.error;
      api.profile = api.profile || {};
      for (var k2 in patch) {
        if (Object.prototype.hasOwnProperty.call(patch, k2)) api.profile[k2] = patch[k2];
      }
      tell();
      return api.profile;
    });
  }

  /* ---- addresses ------------------------------------------------------ */

  function addressesOn() {
    return enabled() && signedIn() && api.settings.savedAddresses !== false;
  }
  function addressLimit() {
    var n = Number(api.settings && api.settings.maxAddresses);
    return (isFinite(n) && n > 0) ? n : 5;
  }

  function saveAddress(a) {
    if (!addressesOn()) return Promise.reject(new Error('Saved addresses are not available.'));
    if (!a.id && api.addresses.length >= addressLimit()) {
      return Promise.reject(new Error('You can save up to ' + addressLimit() + ' addresses.'));
    }
    var row = {
      customer_id: api.user.id,
      label: a.label || '', recipient: a.recipient || '', phone: a.phone || '',
      address: a.address || '', city: a.city || '', is_default: !!a.is_default
    };
    if (a.id) row.id = a.id;

    /* One default, or none. Two would leave the checkout choosing
       arbitrarily between them. */
    var first = row.is_default
      ? sb.from('customer_addresses').update({ is_default: false }).eq('customer_id', api.user.id)
      : Promise.resolve();

    return Promise.resolve(first)
      .then(function () {
        return a.id
          ? sb.from('customer_addresses').update(row).eq('id', a.id)
          : sb.from('customer_addresses').insert(row);
      })
      .then(function (r) { if (r && r.error) throw r.error; return loadProfile(); })
      .then(function () { tell(); return api.addresses; });
  }

  function deleteAddress(id) {
    if (!addressesOn()) return Promise.resolve();
    return sb.from('customer_addresses').delete().eq('id', id)
      .then(function () { return loadProfile(); })
      .then(function () { tell(); });
  }

  function defaultAddress() {
    for (var i = 0; i < api.addresses.length; i++) {
      if (api.addresses[i].is_default) return api.addresses[i];
    }
    return api.addresses[0] || null;
  }

  /* ---- the wishlist ---------------------------------------------------
     The device keeps one and the account keeps one. On signing in they
     are merged rather than one overwriting the other: a customer who
     saved three pieces on their phone and two on a laptop should end up
     with five, not with whichever they signed in from last. */

  function wishlistFollows() {
    return enabled() && signedIn() && api.settings.wishlistFollowsAccount !== false;
  }

  function mergeWishlist(local) {
    if (!wishlistFollows()) return Promise.resolve(local || []);
    var mine = (api.profile && Array.isArray(api.profile.wishlist)) ? api.profile.wishlist : [];
    var out = mine.slice();
    (local || []).forEach(function (sku) { if (out.indexOf(sku) < 0) out.push(sku); });

    var changed = out.length !== mine.length;
    if (!changed) return Promise.resolve(out);
    return saveProfile({ wishlist: out }).then(function () { return out; },
                                              function () { return out; });
  }

  function pushWishlist(list) {
    if (!wishlistFollows()) return Promise.resolve();
    return saveProfile({ wishlist: list || [] }).then(function () {}, function () {});
  }

  /* ---- closing an account ---------------------------------------------
     BUILD 80 · A customer can always erase what identifies them, login and
     all. Until build 80 this ran here, in the browser: the profile and the
     addresses went and the orders lost their owner, but the login stayed,
     because removing one needs the website's service key, which no browser
     may ever hold. So the customer could sign in again with the same email
     and password, and the account seemed never to have closed.

     Now the website's own function does it (netlify/functions/
     account-delete.js), on the customer's own sign-in: the login goes, and
     the database takes the profile, the addresses and the rewards link with
     it; the orders stay, without their owner, as before. A login that is
     also one of the shop's administrators is refused there, and so is
     everything when Settings > Customer Accounts says customers may not
     close their account. Nothing is done here by halves: if the function
     cannot do it, nothing is removed and the customer is told why. */
  var CLOSE_FN = '/.netlify/functions/account-delete';
  function deleteAccount() {
    if (!sb || !api.user) return Promise.reject(new Error('Please sign in first.'));
    if (api.settings && api.settings.accountDeletion === false) {
      return Promise.reject(new Error('Please message us to close your account.'));
    }
    return Promise.resolve(sb.auth.getSession()).then(function (r) {
      var session = r && r.data && r.data.session;
      var token = session && session.access_token;
      if (!token) throw new Error('Please sign in again, then close your account.');
      return fetch(CLOSE_FN, { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (b) {
        if (!res.ok || !b || b.ok !== true) {
          throw new Error((b && b.error) ||
            'Your account could not be closed just now. Nothing has been removed. Please try again, or message us.');
        }
      });
    }, function (e) {
      if (e && e.message && !/fetch|network/i.test(e.message)) throw e;
      throw new Error('Check your connection and try again. Nothing has been removed.');
    }).then(function () {
      /* The login is gone, so signing out here only tidies this browser. */
      return signOut().catch(function () {});
    }).then(function () { return true; });
  }

  /* ---- orders ---------------------------------------------------------
     A row is written when somebody presses Continue, so it records what
     was ASKED FOR, not what the shop agreed to. Every new order is
     pending and the admin confirms or cancels it; the database refuses an
     insert that claims any other status.

     A guest's order carries no customer_id, which is what makes it
     unclaimable later: the rules only let a customer read orders that are
     already theirs.

     Failing to save must never stop the sale. The WhatsApp message is the
     order; this table is a convenience on top of it, and a shop should
     not lose a customer because a write timed out. */

  function historyOn() {
    return enabled() && api.settings.orderHistory !== false;
  }

  /* Recorded by the website's place-order function (build 76).

     The order used to be written from here, through the database's
     place_order, with the prices this page worked out. A browser can be
     made to say anything, so a WhatsApp order could reach the Orders tab
     saying K1 for anything and be added to Sales. Now this says only which
     pieces and how many; the function prices every line from the
     catalogue, the same way an online payment is priced, and writes the
     order with a key no browser holds.

     Who placed it goes with it as this browser's own sign-in, which the
     function checks with Supabase before filing the order under them.

     The reference is made in the database, so two people pressing
     Continue in the same second cannot land on the same one.

     Recorded whether or not customer accounts are switched on. This is
     the shop's own record of what was asked for; `orderHistory` is a
     setting about what an ACCOUNT holds, and it still governs whether a
     customer is shown their own, in myOrders() below. */
  function recordOrder(order) {
    var payload = {
      order: {
        name: order.name || null, phone: order.phone || null,
        email: order.email || null, address: order.address || null,
        notes: order.notes || null,
        fulfilment: order.fulfilment === 'collection' ? 'collection' : 'delivery'
      },
      /* The name rides along only for a piece the catalogue no longer
         knows, so the shop can still see what was asked for. */
      items: (order.items || []).map(function (it) {
        return { sku: it.sku || null, name: it.name || null, qty: it.qty || 1 };
      }),
      /* Nothing while the shop is open. While it is shut the database
         refuses an order, and this is the owner's way to test one. */
      preview: (typeof renderHooks.previewKey === 'function'
                  ? (renderHooks.previewKey() || null) : null)
    };

    function answer(d) {
      if (d && d.id) return { id: d.id, ref: d.ref };
      return { error: new Error('The order was not recorded.') };
    }
    function lost(e) { return { error: e }; }

    var send = renderHooks.placeOrder;
    if (!send) return Promise.resolve(null);
    var token = (sb && signedIn())
      ? Promise.resolve(sb.auth.getSession()).then(function (r) {
          var s = r && r.data && r.data.session;
          return (s && s.access_token) || null;
        }, function () { return null; })
      : Promise.resolve(null);
    return token.then(function (t) { return send(payload, t); }).then(answer, lost);
  }

  var ORDER_COLS = 'id, ref, status, total, currency, fulfilment, created_at, order_items(sku, name, price, qty)';
  /* BUILD 76 · what the till wrote when it rang the order up: the receipt
     the customer can download. supabase-pos-orders.sql adds these columns;
     until it has been run they are not there, and asking for them would
     lose the whole list, so the list is asked for again without them. */
  var RECEIPT_COLS = ', pos_receipt_no, pos_receipt, pos_completed_at';
  /* BUILD 78 · where the order is once the till has rung it up
     (supabase-order-progress.sql). Asked for the same way: until that file
     has been run they are not there, and the list is asked for without them,
     so nothing is lost and no button shows. */
  var PROGRESS_COLS = ', pos_sale_id, ship_note, dispatched_at, ready_at, delivered_at, delivered_by, auto_deliver_at, ' +
    'extend_days, extend_max, extend_used, remind_days, refund_state, refund_amount, refund_ref, refund_note, refund_at, paid_at';

  function myOrders() {
    if (!sb || !signedIn() || !historyOn()) return Promise.resolve([]);
    function ask(cols) {
      var q = sb.from('orders')
        .select(cols)
        .eq('customer_id', api.user.id)
        .order('created_at', { ascending: false });

      /* "Recent" is the shop's own window, so a customer is not shown five
         years of history when the shop meant one. */
      if ((api.settings.historyScope || 'all') === 'recent') {
        var months = Number(api.settings.historyMonths);
        if (isFinite(months) && months > 0) {
          var since = new Date();
          since.setMonth(since.getMonth() - months);
          q = q.gte('created_at', since.toISOString());
        }
      }
      return q;
    }
    function plain() {
      return ask(ORDER_COLS).then(function (r) { return (r && r.data) || []; }, function () { return []; });
    }
    function receipts() {
      return ask(ORDER_COLS + RECEIPT_COLS).then(function (r) {
        if (r && !r.error) return r.data || [];
        return plain();
      }, plain);
    }
    return ask(ORDER_COLS + RECEIPT_COLS + PROGRESS_COLS).then(function (r) {
      if (r && !r.error) return r.data || [];
      return receipts();
    }, receipts);
  }

  /* BUILD 78 · the customer's two buttons, on their own order. The answer is
     the database's; a request that never got there says so. */
  function deliveryStep(fn, id) {
    if (!sb || !signedIn()) return Promise.resolve({ ok: false, why: 'signin' });
    return Promise.resolve(sb.rpc(fn, { p_id: id })).then(function (r) {
      if (r && !r.error && r.data && typeof r.data === 'object') return r.data;
      return { ok: false, why: 'offline' };
    }, function () { return { ok: false, why: 'offline' }; });
  }
  function confirmDelivery(id) { return deliveryStep('order_confirm_delivery', id); }
  function askMoreTime(id) { return deliveryStep('order_extend_delivery', id); }

  /* ---- the receipt, as a PDF ------------------------------------------
     BUILD 76 · The owner: "If the customer has an account, a receipt can
     then appear in a download able manner."

     Written here, by hand, rather than with a PDF library: the site has
     none, and a receipt needs very little of one. One page the width of
     the till's own paper (80 mm), in Courier, the till receipt's own
     typeface, so every column lines up exactly as it does on the paper
     receipt. Courier is one of the fonts every PDF reader carries, so
     nothing is embedded and the file stays a few kilobytes.

     What it says comes from what the till printed (orders.pos_receipt),
     never from this page: the website is not where the sale was made. */
  var PDF_W = 226.77, PDF_MARGIN = 12, PDF_SIZE = 8, PDF_LEAD = 10.5;
  var PDF_COLS = Math.floor((PDF_W - 2 * PDF_MARGIN) / (PDF_SIZE * 0.6));   // 42, as the till's 80 mm paper

  /* Unicode to the PDF's standard WinAnsi letters; anything else is "?". */
  var WIN = { 0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86,
    0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E,
    0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
    0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F,
    0x2212: 0x2D };
  function winText(v) {
    var s = String(v == null ? '' : v), out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c === 9 || c === 10 || c === 13) c = 32;
      /* 0x80 to 0x9F are kept as they are: WinAnsi letters already (a
         second pass over text this has written must not spoil it). */
      if ((c >= 32 && c <= 126) || (c >= 0x80 && c <= 0xFF)) out += String.fromCharCode(c);
      else if (WIN[c]) out += String.fromCharCode(WIN[c]);
      else out += '?';
    }
    return out;
  }
  function pdfEsc(s) { return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'); }

  /* Words to lines of at most n letters. A word longer than a line is cut. */
  function wrap(text, n) {
    var words = winText(text).split(' '), lines = [], cur = '';
    words.forEach(function (w) {
      while (w.length > n) { if (cur) { lines.push(cur); cur = ''; } lines.push(w.slice(0, n)); w = w.slice(n); }
      if (!w) return;
      if (!cur) cur = w;
      else if ((cur + ' ' + w).length <= n) cur += ' ' + w;
      else { lines.push(cur); cur = w; }
    });
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  }
  /* A label on the left and a figure on the right, on one line. */
  function pair(left, right, n) {
    var r = winText(right), l = winText(left);
    if (!r) return wrap(l, n);
    var room = n - r.length - 1;
    if (room < 1) return [l.slice(0, n), r.slice(0, n)];
    if (l.length > room) {
      var first = wrap(l, room);
      var last = first.pop();
      return first.concat([last + new Array(n - last.length - r.length + 1).join(' ') + r]);
    }
    return [l + new Array(n - l.length - r.length + 1).join(' ') + r];
  }
  function centre(text, n) {
    return wrap(text, n).map(function (l) {
      var pad = Math.floor((n - l.length) / 2);
      return new Array(pad + 1).join(' ') + l;
    });
  }

  function receiptMoney(v) {
    var n = Number(v) || 0;
    if (renderHooks.money) return renderHooks.money(n);
    return 'K' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /* The receipt's lines: [text, bold]. */
  function receiptLines(o) {
    var r = o.pos_receipt || {}, shop = r.shop || {}, n = PDF_COLS, out = [];
    var dash = new Array(n + 1).join('-');
    function add(list, bold) { list.forEach(function (l) { out.push([l, !!bold]); }); }
    if (shop.name) add(centre(String(shop.name).toUpperCase(), n), true);
    if (shop.slogan) add(centre(shop.slogan, n));
    if (shop.address) add(centre(shop.address, n));
    if (shop.contact) add(centre(shop.contact, n));
    if (shop.taxId) add(centre('Tax ID / TPIN: ' + shop.taxId, n));
    if (shop.regNo) add(centre('Reg No: ' + shop.regNo, n));
    add([dash]);
    var when = r.date ? new Date(r.date) : (o.pos_completed_at ? new Date(o.pos_completed_at) : null);
    var whenText = when && !isNaN(when.getTime())
      ? (renderHooks.date ? renderHooks.date(when.toISOString()) : when.toLocaleDateString()) + ' ' +
        ('0' + when.getHours()).slice(-2) + ':' + ('0' + when.getMinutes()).slice(-2)
      : '';
    add(pair(whenText, r.cashier ? 'Cashier: ' + r.cashier : '', n));
    add(pair('Receipt: ' + (r.receiptNo || o.pos_receipt_no || ''), '', n));
    if (r.invoiceNo) add(pair('Invoice: ' + r.invoiceNo, '', n));
    if (r.txnId) add(pair('Transaction ID', r.txnId, n));
    add(pair('Online order: ' + (o.ref || ''), '', n));
    if (r.customer) add(wrap('Customer: ' + r.customer, n));
    add([dash]);
    /* Quantity and price in columns of their own, right-aligned. */
    function col(v, w) { v = winText(v); return v.length >= w ? v : new Array(w - v.length + 1).join(' ') + v; }
    add(pair('Item', col('Qty', 3) + ' ' + col('Price', 12), n));
    (r.lines || []).forEach(function (l) {
      var name = [l.sku, l.name].filter(Boolean).join(' ');
      add(pair(name, col(l.qty == null ? '' : l.qty, 3) + ' ' + col(receiptMoney(l.total), 12), n));
    });
    add([dash]);
    if (r.subtotalNet != null && r.vat != null && Number(r.vatRate)) add(pair('Subtotal (excl. VAT)', receiptMoney(r.subtotalNet), n));
    if (Number(r.discount) > 0) add(pair('Discount', '- ' + receiptMoney(r.discount), n));
    if (r.vat != null && Number(r.vatRate)) add(pair('VAT (' + r.vatRate + '%)', receiptMoney(r.vat), n));
    add(pair('Delivery', receiptMoney(r.delivery || 0), n));
    add(pair('TOTAL', receiptMoney(r.total != null ? r.total : o.total), n), true);
    var pts = r.points || null;
    if (pts && Number(pts.value) > 0.004) {
      add(pair('Points redeemed (' + (pts.points || 0) + ')', '- ' + receiptMoney(pts.value), n));
      add(pair('AMOUNT PAID', receiptMoney(r.amountPaid != null ? r.amountPaid : Math.max(0, (Number(r.total) || 0) - Number(pts.value))), n), true);
    }
    (r.payments || []).forEach(function (p) {
      add(pair(p.method || '', receiptMoney(p.amount), n));
      if (p.ref) add(pair('Ref / Auth', p.ref, n));
    });
    add([dash]);
    if (r.footer) add(centre(r.footer, n), true);
    return out;
  }

  /* The PDF itself, as bytes. Only the parts every reader needs: one page,
     two of the standard fonts, one stream of text. */
  function receiptPdf(o) {
    var lines = receiptLines(o);
    var h = Math.max(300, Math.ceil(2 * PDF_MARGIN + lines.length * PDF_LEAD + 6));
    var y = h - PDF_MARGIN - PDF_SIZE;
    var body = 'BT\n';
    lines.forEach(function (l) {
      body += '/' + (l[1] ? 'F2' : 'F1') + ' ' + PDF_SIZE + ' Tf 1 0 0 1 ' + PDF_MARGIN + ' ' + y.toFixed(2) +
              ' Tm (' + pdfEsc(l[0]) + ') Tj\n';
      y -= PDF_LEAD;
    });
    body += 'ET\n';
    var title = winText('Receipt ' + ((o.pos_receipt && o.pos_receipt.receiptNo) || o.pos_receipt_no || '') + ' ' + (o.ref || ''));
    var objs = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PDF_W + ' ' + h + '] ' +
        '/Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>',
      '<< /Length ' + body.length + ' >>\nstream\n' + body + 'endstream',
      '<< /Title (' + pdfEsc(title) + ') /Producer (Vaultique Boutique Point) >>'
    ];
    var out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', offs = [];
    objs.forEach(function (ob, i) {
      offs.push(out.length);
      out += (i + 1) + ' 0 obj\n' + ob + '\nendobj\n';
    });
    var xref = out.length;
    out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
    offs.forEach(function (off) { out += ('000000000' + off).slice(-10) + ' 00000 n \n'; });
    out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R /Info 7 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
    var bytes = new Uint8Array(out.length);
    for (var i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xFF;
    return bytes;
  }

  function receiptFileName(o) {
    var no = String((o.pos_receipt && o.pos_receipt.receiptNo) || o.pos_receipt_no || o.ref || 'receipt');
    return 'Receipt-' + no.replace(/[^0-9A-Za-z-]+/g, '-') + '.pdf';
  }

  function downloadReceipt(o) {
    var blob = new Blob([receiptPdf(o)], { type: 'application/pdf' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = receiptFileName(o); a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 4000);
  }

  /* ---- the page ------------------------------------------------------
     Signed out it is a sign-in form; signed in it is everything an
     account holds. Rendered here rather than in app.js so a shop with
     accounts off carries none of it. */

  var esc = function (v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  var renderHooks = {};    // set by the storefront: money, and the wishlist

  function render(host) {
    if (!host) return;
    host.innerHTML = '';
    if (!enabled()) {
      host.appendChild(el('p', 'ac-none', 'Accounts are not available at the moment.'));
      return;
    }
    if (!signedIn()) { drawSignedOut(host); return; }
    drawSignedIn(host);
  }

  function say(node, msg, kind) {
    node.textContent = msg || '';
    node.className = 'ac-msg' + (kind ? ' ' + kind : '');
  }

  function field(wrap, id, label, type, value, autocomplete) {
    var l = el('label', 'rv-lbl', label);
    l.setAttribute('for', id);
    var i = document.createElement('input');
    i.type = type; i.id = id;
    if (value) i.value = value;
    if (autocomplete) i.autocomplete = autocomplete;
    wrap.appendChild(l);
    /* A password nobody can see is a password typed twice as often and
       wrong half the time, especially on a phone keyboard. Every field
       that hides what is typed gets a way to look at it. */
    if (type === 'password') wrap.appendChild(reveal(i));
    else wrap.appendChild(i);
    return i;
  }

  /* The input, wrapped, with an eye beside it. Returns the wrapper; the
     caller keeps the input it passed in, so nothing else has to change. */
  function reveal(input) {
    var box = el('div', 'pw-box');
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pw-eye';
    box.appendChild(input);
    box.appendChild(btn);

    function paint() {
      var shown = input.type === 'text';
      btn.innerHTML = shown ? EYE_OFF : EYE_ON;
      /* Named for what pressing it does, not for the state it is in:
         a screen reader saying "Hide password" on a hidden password is
         the kind of help that is worse than none. */
      btn.setAttribute('aria-label', shown ? 'Hide password' : 'Show password');
      btn.setAttribute('title', shown ? 'Hide password' : 'Show password');
      btn.setAttribute('aria-pressed', shown ? 'true' : 'false');
    }
    btn.addEventListener('click', function () {
      /* Where the cursor was, kept: turning the eye on mid-word should
         not send you back to the start of what you were typing. */
      var at = input.selectionStart, to = input.selectionEnd;
      input.type = input.type === 'password' ? 'text' : 'password';
      paint();
      try { input.focus(); input.setSelectionRange(at, to); } catch (e) { input.focus(); }
    });
    paint();
    return box;
  }
  var EYE_ON =
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path d="M1.5 12S5 5.5 12 5.5 22.5 12 22.5 12 19 18.5 12 18.5 1.5 12 1.5 12z"/>' +
    '<circle cx="12" cy="12" r="3.2"/></svg>';
  var EYE_OFF =
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path d="M1.5 12S5 5.5 12 5.5c1.6 0 3 .34 4.2.87M22.5 12s-3.5 6.5-10.5 6.5c-1.6 0-3-.34-4.2-.87"/>' +
    '<path d="M9.9 9.9a3.2 3.2 0 004.2 4.2"/><path d="M3 3l18 18"/></svg>';

  function drawSignedOut(host) {
    var card = el('div', 'ac-card');
    var tabs = el('div', 'ac-tabs');
    var tIn = el('button', 'ac-tab active', 'Sign in');
    var tUp = el('button', 'ac-tab', 'Create an account');
    tIn.type = 'button'; tUp.type = 'button';
    tabs.appendChild(tIn);
    if (canRegister()) tabs.appendChild(tUp);
    card.appendChild(tabs);

    var body = el('div', 'ac-body');
    card.appendChild(body);
    host.appendChild(card);

    function signInForm() {
      body.innerHTML = '';
      var email = field(body, 'ac_email', 'Email address', 'email', '', 'email');
      var pw = field(body, 'ac_pw', 'Password', 'password', '', 'current-password');
      var msg = el('p', 'ac-msg');
      var go = el('button', 'btn btn-gold', 'Sign in');
      go.type = 'button';
      var forgot = el('button', 'ac-link', 'Forgotten your password?');
      forgot.type = 'button';

      var row = el('div', 'ac-actions');
      row.appendChild(go);
      if (!api.settings || api.settings.passwordReset !== false) row.appendChild(forgot);
      body.appendChild(row); body.appendChild(msg);

      go.addEventListener('click', function () {
        say(msg, 'Signing in…', 'busy');
        signIn(email.value, pw.value).then(function () {
          render(host);
        }, function (e) {
          say(msg, friendly(e), 'err');
          if (/email not confirmed/i.test(String((e && e.message) || '')) && !body.querySelector('.ac-resend')) {
            row.appendChild(resendButton(function () { return email.value; }, msg));
          }
        });
      });
      forgot.addEventListener('click', function () {
        if (!email.value.trim()) { say(msg, 'Enter your email address first.', 'err'); email.focus(); return; }
        say(msg, 'Sending…', 'busy');
        resetPassword(email.value).then(function () {
          say(msg, 'If that address has an account, a link to set a new password is on its ' +
                   'way. Check your inbox, and the spam folder.', 'ok');
        }, function (e) { say(msg, friendly(e), 'err'); });
      });
      body.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); go.click(); }
      });
    }

    function signUpForm() {
      body.innerHTML = '';
      var name = field(body, 'ac_name', 'Your name', 'text', '', 'name');
      var email = field(body, 'ac_email2', 'Email address', 'email', '', 'email');
      var pw = field(body, 'ac_pw2', 'Choose a password', 'password', '', 'new-password');
      var rule = el('p', 'ac-rule', passwordRule());
      body.appendChild(rule);
      /* The newsletter, offered once, here, where the address is already
         typed. It starts unticked on purpose: a list somebody joined
         without noticing is a list they report as spam. */
      var nl = renderHooks.newsletter || {};
      var joinBox = null;
      if (nl.enabled !== false && nl.offerAtSignup) {
        var joinLbl = el('label', 'ac-check');
        joinBox = document.createElement('input');
        joinBox.type = 'checkbox';
        joinLbl.appendChild(joinBox);
        joinLbl.appendChild(document.createTextNode(
          ' ' + (nl.signupLabel || 'Email me new arrivals and private offers')));
        body.appendChild(joinLbl);
      }

      /* CONSENT, ALWAYS. The same kind of box as at checkout: no account is
         made until it is ticked. The wording is Settings > Customer
         Accounts'; "Privacy Policy" in it links to the privacy policy, in a
         new tab so nothing typed here is lost. */
      var consent = consentBox();
      body.appendChild(consent.label);

      var msg = el('p', 'ac-msg');
      var go = el('button', 'btn btn-gold', 'Create account');
      go.type = 'button';
      var row = el('div', 'ac-actions'); row.appendChild(go);
      body.appendChild(row); body.appendChild(msg);

      /* Told as they type, rather than after they submit. */
      pw.addEventListener('input', function () {
        var bad = pw.value ? passwordProblem(pw.value) : '';
        rule.textContent = bad || (pw.value ? 'That will do.' : passwordRule());
        rule.className = 'ac-rule' + (pw.value ? (bad ? ' bad' : ' ok') : '');
      });

      go.addEventListener('click', function () {
        if (!name.value.trim()) { say(msg, 'Please give us a name to call you by.', 'err'); return; }
        if (!consent.input.checked) {
          say(msg, 'Please tick the box to confirm your details and give your consent.', 'err');
          consent.label.classList.remove('is-wrong'); void consent.label.offsetWidth; consent.label.classList.add('is-wrong');
          consent.input.focus();
          return;
        }
        say(msg, 'Creating your account…', 'busy');
        signUp(email.value, pw.value, name.value).then(function (r) {
          /* After the account, never instead of it. Joining a list must
             not be able to hold up or fail the thing they came to do, so
             it is fired and forgotten. */
          if (joinBox && joinBox.checked && typeof renderHooks.subscribe === 'function') {
            try { renderHooks.subscribe(email.value.trim()); } catch (e) {}
          }
          if (r && r.confirm) {
            body.innerHTML = '';
            body.appendChild(el('h3', 'serif', 'Almost there'));
            /* The same words whether or not the address already had an
               account (account-signup.js, build 77): the email it gets
               says which. */
            body.appendChild(el('p', 'ac-lead',
              'We have sent an email to ' + email.value.trim() +
              '. Follow the link in it to finish, then sign in.'));
            body.appendChild(el('p', 'ac-quiet', 'Not there after a few minutes? Check the spam or junk folder.'));
            var again = el('p', 'ac-msg');
            if (r.note) say(again, r.note, 'err');
            var ar = el('div', 'ac-actions');
            var sentTo = email.value;
            ar.appendChild(resendButton(function () { return sentTo; }, again));
            body.appendChild(ar); body.appendChild(again);
            return;
          }
          render(host);
        }, function (e) {
          say(msg, friendly(e), 'err');
          if (e && e.waiting && !row.querySelector('.ac-resend')) {
            row.appendChild(resendButton(function () { return email.value; }, msg));
          }
        });
      });
    }

    tIn.addEventListener('click', function () {
      tIn.classList.add('active'); tUp.classList.remove('active'); signInForm();
    });
    tUp.addEventListener('click', function () {
      tUp.classList.add('active'); tIn.classList.remove('active'); signUpForm();
    });
    signInForm();
  }

  var SIGNUP_CONSENT = 'I confirm that the information provided is accurate and consent to Vaultique Boutique processing my personal information for the purposes of creating and managing my account, including processing or storage by authorised service providers outside Zambia, in accordance with the Privacy Policy.';
  function consentBox() {
    var words = String((api.settings && api.settings.signupConsentText) || '').trim() || SIGNUP_CONSENT;
    var label = el('label', 'od-consent ac-consent');
    var input = document.createElement('input');
    input.type = 'checkbox'; input.id = 'ac_consent';
    label.appendChild(input);
    var span = document.createElement('span');
    var at = words.indexOf('Privacy Policy');
    var href = typeof renderHooks.privacyHref === 'function' ? renderHooks.privacyHref() : '/policies/privacy-policy';
    if (at > -1) {
      span.appendChild(document.createTextNode(words.slice(0, at)));
      var a = document.createElement('a');
      a.href = href; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Privacy Policy';
      span.appendChild(a);
      span.appendChild(document.createTextNode(words.slice(at + 'Privacy Policy'.length)));
    } else {
      span.textContent = words;
    }
    label.appendChild(span);
    input.addEventListener('change', function () { if (input.checked) label.classList.remove('is-wrong'); });
    return { label: label, input: input };
  }

  function passwordRule() {
    var s = api.settings || {};
    var min = Number(s.passwordMinLength);
    if (!isFinite(min) || min < 6) min = 8;
    var bits = ['at least ' + min + ' characters'];
    if (s.passwordNeedsNumber) bits.push('a number');
    if (s.passwordNeedsSymbol) bits.push('a symbol');
    return 'Use ' + bits.join(', ') + '.';
  }

  /* Supabase's own wording is written for developers. */
  function friendly(e) {
    var m = String((e && e.message) || e || '').toLowerCase();
    if (/invalid login/.test(m)) return 'That email and password do not match.';
    if (/email not confirmed/.test(m)) return 'Please confirm your email address first: click the link we emailed you.';
    if (/error sending|sending confirmation|smtp|email.*(fail|could not)/.test(m)) return 'We could not send the email just now. Please try again in a few minutes, or contact us.';
    if (/already registered|already exists/.test(m)) return 'There is already an account with that address. Try signing in.';
    if (/rate limit|too many/.test(m)) return 'Too many attempts. Please wait a minute and try again.';
    if (/network|fetch/.test(m)) return 'We could not reach the server. Check your connection.';
    return (e && e.message) || 'Something went wrong. Please try again.';
  }

  function drawSignedIn(host) {
    var head = el('div', 'ac-head');
    var h = el('h1', 'serif', (api.profile && api.profile.name) ? 'Hello, ' + api.profile.name : 'Your account');
    head.appendChild(h);
    var out = el('button', 'btn btn-outline btn-sm', 'Sign out');
    out.type = 'button';
    out.addEventListener('click', function () { signOut().then(function () { render(host); }); });
    head.appendChild(out);
    host.appendChild(head);

    if (api.recovering) { host.appendChild(recoveryCard(host)); return; }

    if (needsVerifiedEmail() && !api.user.emailConfirmed) {
      var warn = el('div', 'ac-warn');
      warn.textContent = 'Your email address is not confirmed yet, so you cannot check out. ' +
                         'Check your inbox for the link we sent to ' + api.user.email + '.';
      host.appendChild(warn);
    }

    host.appendChild(detailsCard(host));
    /* Vaultique Rewards: the points live on the business platform and are
       asked for as this customer, never kept here (assets/rewards.js). */
    if (window.VBP_REWARDS && window.VBP_REWARDS.enabled) host.appendChild(window.VBP_REWARDS.card());
    if (api.settings.savedAddresses !== false) host.appendChild(addressCard());
    if (historyOn()) host.appendChild(ordersCard());
    if (api.settings.accountDeletion !== false) host.appendChild(dangerCard(host));
  }

  /* The one thing to do after following a reset link. */
  function recoveryCard(host) {
    var c = card('Choose a new password');
    c.appendChild(el('p', 'ac-quiet', 'You asked to reset the password for ' + api.user.email + '.'));
    var pw1 = field(c, 'ac_reset1', 'New password', 'password', '', 'new-password');
    var pw2 = field(c, 'ac_reset2', 'Type it again', 'password', '', 'new-password');
    var rule = el('p', 'ac-rule', passwordRule());
    c.appendChild(rule);
    var msg = el('p', 'ac-msg');
    var go = el('button', 'btn btn-gold', 'Save new password');
    go.type = 'button';
    var row = el('div', 'ac-actions'); row.appendChild(go);
    c.appendChild(row); c.appendChild(msg);
    go.addEventListener('click', function () {
      if (pw1.value !== pw2.value) { say(msg, 'Those two are not the same.', 'err'); pw2.focus(); return; }
      say(msg, 'Saving…', 'busy');
      go.disabled = true;
      changePassword(pw1.value).then(function () {
        api.recovering = false;
        try { history.replaceState(null, '', location.pathname); } catch (e) {}
        render(host);
        var done = host.querySelector('.ac-card .ac-msg');
        if (done) say(done, 'Your new password is saved ✓', 'ok');
      }, function (e) { go.disabled = false; say(msg, friendly(e), 'err'); });
    });
    c.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); go.click(); } });
    return c;
  }

  function card(title) {
    var c = el('div', 'ac-card');
    c.appendChild(el('h2', 'serif', title));
    return c;
  }

  function detailsCard(host) {
    var c = card('Your details');
    var msg = el('p', 'ac-msg');
    var name = field(c, 'ac_pname', 'Name', 'text', (api.profile && api.profile.name) || '', 'name');
    var phone = field(c, 'ac_pphone', 'Phone', 'tel', (api.profile && api.profile.phone) || '', 'tel');
    var mail = el('p', 'ac-quiet', 'Signed in as ' + api.user.email);
    c.appendChild(mail);

    var save = el('button', 'btn btn-gold btn-sm', 'Save');
    save.type = 'button';
    save.addEventListener('click', function () {
      say(msg, 'Saving…', 'busy');
      saveProfile({ name: name.value.trim(), phone: phone.value.trim() })
        .then(function () { say(msg, 'Saved ✓', 'ok'); },
              function (e) { say(msg, friendly(e), 'err'); });
    });

    var pwBtn = el('button', 'ac-link', 'Change password');
    pwBtn.type = 'button';
    pwBtn.addEventListener('click', function () {
      var wrap = el('div', 'ac-inline');
      var pw = field(wrap, 'ac_newpw', 'New password', 'password', '', 'new-password');
      var go = el('button', 'btn btn-outline btn-sm', 'Set password');
      go.type = 'button';
      go.addEventListener('click', function () {
        say(msg, 'Saving…', 'busy');
        changePassword(pw.value).then(function () {
          say(msg, 'Password changed ✓', 'ok'); wrap.remove(); pwBtn.style.display = '';
        }, function (e) { say(msg, friendly(e), 'err'); });
      });
      wrap.appendChild(go);
      pwBtn.style.display = 'none';
      c.insertBefore(wrap, msg);
      pw.focus();
    });

    var row = el('div', 'ac-actions');
    row.appendChild(save);
    if (!api.settings || api.settings.passwordReset !== false) row.appendChild(pwBtn);
    c.appendChild(row); c.appendChild(msg);
    return c;
  }

  function addressCard() {
    var c = card('Saved addresses');
    var msg = el('p', 'ac-msg');
    var list = el('div', 'ac-list');
    c.appendChild(list);

    function draw() {
      list.innerHTML = '';
      if (!api.addresses.length) {
        list.appendChild(el('p', 'ac-quiet', 'None saved yet. Add one and the checkout fills itself in.'));
      }
      api.addresses.forEach(function (a) {
        var row = el('div', 'ac-addr');
        var lines = [a.label, a.recipient, a.address, a.city, a.phone].filter(Boolean);
        var body = el('div');
        lines.forEach(function (t, i) {
          var d = el('div', i === 0 ? 'ac-addr-l' : '');
          d.textContent = t;
          body.appendChild(d);
        });
        if (a.is_default) body.appendChild(el('span', 'ac-tag', 'Default'));
        row.appendChild(body);

        var del = el('button', 'ac-link', 'Remove');
        del.type = 'button';
        del.addEventListener('click', function () {
          say(msg, 'Removing…', 'busy');
          deleteAddress(a.id).then(function () { say(msg, ''); draw(); },
                                   function (e) { say(msg, friendly(e), 'err'); });
        });
        row.appendChild(del);
        list.appendChild(row);
      });
      add.style.display = api.addresses.length >= addressLimit() ? 'none' : '';
      limitNote.textContent = api.addresses.length >= addressLimit()
        ? 'You have saved the most we can keep (' + addressLimit() + ').' : '';
    }

    var form = el('div', 'ac-inline hide');
    var label = field(form, 'ac_alabel', 'Name for it', 'text', '');
    label.placeholder = 'Home';
    var recip = field(form, 'ac_arecip', 'Recipient', 'text', '', 'name');
    var addr = el('textarea'); addr.id = 'ac_aaddr'; addr.rows = 2;
    var al = el('label', 'rv-lbl', 'Address'); al.setAttribute('for', 'ac_aaddr');
    form.appendChild(al); form.appendChild(addr);
    var city = field(form, 'ac_acity', 'City', 'text', '');
    var phone = field(form, 'ac_aphone', 'Phone', 'tel', '', 'tel');
    var defLbl = el('label', 'ac-check');
    var def = document.createElement('input'); def.type = 'checkbox';
    defLbl.appendChild(def); defLbl.appendChild(document.createTextNode(' Use this one by default'));
    form.appendChild(defLbl);

    var save = el('button', 'btn btn-gold btn-sm', 'Save address');
    save.type = 'button';
    save.addEventListener('click', function () {
      if (!addr.value.trim()) { say(msg, 'An address needs an address.', 'err'); addr.focus(); return; }
      say(msg, 'Saving…', 'busy');
      saveAddress({ label: label.value.trim(), recipient: recip.value.trim(),
                    address: addr.value.trim(), city: city.value.trim(),
                    phone: phone.value.trim(), is_default: def.checked })
        .then(function () {
          say(msg, 'Saved ✓', 'ok');
          form.classList.add('hide'); add.style.display = '';
          label.value = recip.value = city.value = phone.value = ''; addr.value = ''; def.checked = false;
          draw();
        }, function (e) { say(msg, friendly(e), 'err'); });
    });
    form.appendChild(save);

    var add = el('button', 'btn btn-outline btn-sm', 'Add an address');
    add.type = 'button';
    add.addEventListener('click', function () {
      form.classList.remove('hide'); add.style.display = 'none'; label.focus();
    });
    var limitNote = el('p', 'ac-quiet');

    c.appendChild(form); c.appendChild(add); c.appendChild(limitNote); c.appendChild(msg);
    draw();
    return c;
  }

  function ordersCard() {
    var c = card('Your orders');
    var list = el('div', 'ac-list');
    list.appendChild(el('p', 'ac-quiet', 'Loading…'));
    c.appendChild(list);
    c.appendChild(el('p', 'ac-quiet',
      'An order here is what you asked for on WhatsApp. We confirm each one with you, ' +
      'so the status follows the conversation rather than replacing it.'));

    var PG = window.VBP_PROGRESS || null;
    function fill(said) {
    myOrders().then(function (rows) {
      list.innerHTML = '';
      if (!rows.length) {
        list.appendChild(el('p', 'ac-quiet', 'Nothing yet. Orders you place will appear here.'));
        return;
      }
      rows.forEach(function (o) {
        var row = el('div', 'ac-order');
        row.setAttribute('data-ref', o.ref || '');
        var top = el('div', 'ac-order-top');
        top.appendChild(el('span', 'ac-ref', o.ref || ''));
        /* BUILD 78 · rung up at the shop: where it is now, in the words the
           progress below uses. Any other order keeps the words it had. */
        var pg = PG && ('dispatched_at' in o) ? PG.fromRow(o) : null;
        var st = el('span', 'ac-status ' + (pg ? PG.badgeClass(pg) : 'is-' + (o.status || 'pending')));
        st.textContent = pg ? PG.headline(pg)
          : (o.status || 'pending').charAt(0).toUpperCase() + (o.status || 'pending').slice(1);
        top.appendChild(st);
        row.appendChild(top);

        var when = el('div', 'ac-quiet');
        when.textContent = (renderHooks.date ? renderHooks.date(o.created_at) : '') +
          (o.fulfilment === 'collection' ? ' · for collection' : ' · for delivery');
        row.appendChild(when);

        if (pg && pg.rungUp && o.status !== 'completed' && o.status !== 'cancelled') {
          PG.draw(row, pg, {
            money: renderHooks.money,
            message: said && said.ref === o.ref ? said.words : '',
            onConfirm: function () { return confirmDelivery(o.id); },
            onExtend: function () { return askMoreTime(o.id); },
            after: function (r, words) { fill({ ref: o.ref, words: words }); }
          });
        }

        (o.order_items || []).forEach(function (it) {
          var line = el('div', 'ac-item');
          line.textContent = (it.qty > 1 ? it.qty + ' × ' : '') + (it.name || it.sku || '');
          if (it.price != null && renderHooks.money) {
            line.textContent += ' — ' + renderHooks.money(it.price);
          }
          row.appendChild(line);
        });
        if (o.total != null && renderHooks.money) {
          row.appendChild(el('div', 'ac-total', 'Total ' + renderHooks.money(o.total)));
        }
        /* BUILD 76 · rung up at the shop: the receipt, to keep. BUILD 78 ·
           "Completed at the shop" only when it was: goods still to go are not. */
        if (o.pos_receipt_no || o.pos_receipt) {
          row.appendChild(el('div', 'ac-quiet ac-receipt-no',
            (o.status === 'completed' ? 'Completed at the shop' : 'Rung up at the shop') +
            (o.pos_receipt_no ? ' · Receipt ' + o.pos_receipt_no : '')));
          if (o.pos_receipt) {
            var dl = el('button', 'btn btn-outline btn-sm ac-receipt', 'Download receipt');
            dl.type = 'button';
            dl.addEventListener('click', function () { downloadReceipt(o); });
            row.appendChild(dl);
          }
        }
        list.appendChild(row);
      });
    });
    }
    fill(null);
    return c;
  }

  function dangerCard(host) {
    var c = card('Close your account');
    var msg = el('p', 'ac-msg');
    c.appendChild(el('p', 'ac-quiet',
      (api.settings && api.settings.deletionNote) ||
      'Your account and saved addresses are removed.'));
    var go = el('button', 'btn btn-outline btn-sm ac-danger', 'Close my account');
    go.type = 'button';
    go.addEventListener('click', function () {
      if (go.dataset.armed !== '1') {
        go.dataset.armed = '1';
        go.textContent = 'Yes, close it permanently';
        say(msg, 'This cannot be undone. Press again to confirm, or reload to cancel.', 'err');
        return;
      }
      say(msg, 'Closing…', 'busy');
      deleteAccount().then(function () { render(host); },
                          function (e) { say(msg, friendly(e), 'err'); });
    });
    c.appendChild(go); c.appendChild(msg);
    return c;
  }

  /* The signed-in customer's own access token. Nothing is minted here:
     it is the session Supabase already holds, and it is null whenever
     nobody is signed in. It exists so another part of the site — the
     chat — can make a request AS the customer rather than as the anon
     key, which is what lets the database recognise them. */
  function accessToken() { return api.token || null; }

  window.VBP_ACCOUNT = {
    render: render,
    accessToken: accessToken,
    hooks: renderHooks,
    state: api,
    configure: configure,
    start: start,
    onChange: function (fn) { listeners.push(fn); },

    enabled: enabled,
    canRegister: canRegister,
    guestsMayBuy: guestsMayBuy,
    signedIn: signedIn,
    mayCheckout: mayCheckout,
    whyNotCheckout: whyNotCheckout,
    passwordProblem: passwordProblem,

    signUp: signUp,
    signIn: signIn,
    signOut: signOut,
    resetPassword: resetPassword,
    changePassword: changePassword,
    saveProfile: saveProfile,

    addressesOn: addressesOn,
    addressLimit: addressLimit,
    saveAddress: saveAddress,
    deleteAddress: deleteAddress,
    defaultAddress: defaultAddress,

    wishlistFollows: wishlistFollows,
    mergeWishlist: mergeWishlist,
    pushWishlist: pushWishlist,

    historyOn: historyOn,
    recordOrder: recordOrder,
    myOrders: myOrders,
    receiptPdf: receiptPdf,
    receiptLines: receiptLines,
    receiptFileName: receiptFileName,

    deleteAccount: deleteAccount,
    confirmDelivery: confirmDelivery,
    askMoreTime: askMoreTime
  };
})();
