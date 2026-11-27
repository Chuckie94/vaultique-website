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

  /* BUILD 86 · Signing out is this device only, unless asked otherwise.
     Until build 86 it was every device: the Supabase library's own default
     is 'global', so signing out on a laptop also signed the customer out on
     their phone. 'others' keeps this device signed in; 'global' is every
     one, this included. Resolves { ok }: whether Supabase heard it. This
     device is signed out either way (the library forgets the session even
     when the server cannot be reached), except for 'others'. */
  function signOut(scope) {
    if (!sb) return Promise.resolve({ ok: true });
    var how = (scope === 'global' || scope === 'others') ? scope : 'local';
    return Promise.resolve(sb.auth.signOut({ scope: how })).then(function (r) {
      if (how !== 'others') {
        api.user = null; api.profile = null; api.addresses = []; api.token = null;
        tell();
      }
      return { ok: !(r && r.error) };
    }, function () { return { ok: false }; });
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
  /* BUILD 86 · what an order's own page shows: where it goes, how it was
     paid, and what it came to (supabase-payments.sql, website 77). Asked
     for the same way: a database without them still lists every order. */
  var DETAIL_COLS = ', address, payment_method, payment_status, pay_channel, goods_total, delivery_fee, paid_amount, updated_at';

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
    function progress() {
      return ask(ORDER_COLS + RECEIPT_COLS + PROGRESS_COLS).then(function (r) {
        if (r && !r.error) return r.data || [];
        return receipts();
      }, receipts);
    }
    return ask(ORDER_COLS + RECEIPT_COLS + PROGRESS_COLS + DETAIL_COLS).then(function (r) {
      if (r && !r.error) return r.data || [];
      return progress();
    }, progress);
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

  /* BUILD 86 · render(host, page, detail, soft). The page is the account
     page asked for (/account/<page>/<detail>, the customer portal below).
     Soft is the shop saying "something about the account changed": the
     page is drawn again only if who is signed in, or the page, did. Until
     build 86 every change drew it again, a new sign-in token every hour
     included, which emptied whatever the customer was typing and swallowed
     "Saved" before it could be seen. */
  function render(host, sec, arg, soft) {
    if (!host) return;
    if (arguments.length > 1) view = { sec: String(sec || ''), arg: String(arg || '') };
    var key = [enabled() ? 1 : 0, api.user ? api.user.id : '-', api.user && api.user.emailConfirmed ? 1 : 0,
               api.recovering ? 1 : 0, view.sec, view.arg].join('|');
    if (soft && key === drawn && host.firstChild) return;
    drawn = key;
    host.innerHTML = '';
    if (!enabled()) {
      host.appendChild(el('p', 'ac-none', 'Accounts are not available at the moment.'));
      return;
    }
    if (!signedIn()) { showNotice(host); drawSignedOut(host); return; }
    drawSignedIn(host);
  }
  /* A word that outlives the next few drawings of the page (a sign-in, a
     change of address), then goes. */
  var notice = { text: '', until: 0 };
  function noteFor(text) { notice = { text: text, until: Date.now() + 8000 }; }
  function showNotice(host) {
    if (notice.text && Date.now() < notice.until) host.appendChild(el('p', 'ac-msg ok pt-flash', notice.text));
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

  /* ---- BUILD 86 · the customer portal ----------------------------------
     The owner, 21 November 2026: "I would make Vaultique's customer account
     a complete customer relationship portal rather than simply a place to
     view orders", "Customer dashboard should be as shown in the
     screenshots, just use Vaultique Boutique Point navy blue for the top
     color", and "every new customer-account feature must connect to the
     Business Platform where appropriate".

     Signed in, /account is the dashboard: a navy top with the customer's
     own figures (orders, wishlist, points), then three groups, each item a
     page of its own at /account/<page>, so the phone's back button goes
     back to the dashboard. Everything the account page had before is on
     one of them, with the classes it had, so nothing a customer could do
     is gone.

     What is whose. The orders, refunds and points are the business
     platform's: the orders and refunds are read from what the platform's
     till, Online Orders and Online Refund wrote here, and the points are
     asked of the platform each time (assets/rewards.js). Nothing on these
     pages keeps a figure of its own. The few records that only the shop may
     read (the newsletter list, refunds on their way, the data file) are
     asked of the website's own function, netlify/functions/
     account-portal.js, which reads them for the signed-in customer only. */

  var view = { sec: '', arg: '' };   // the page, from the address: /account/<sec>/<arg>
  var drawn = '';                    // who and which page the account view shows now

  var BASE_PATH = function () { return (window.VBP_BASE || '/'); };
  function pagePath(sec, arg) {
    return 'account' + (sec ? '/' + sec : '') + (arg ? '/' + encodeURIComponent(arg) : '');
  }
  /* To another page of the account. Through the shop's own router when it
     is there, so the page is not loaded again; otherwise the address. */
  function nav(sec, arg) {
    var to = pagePath(sec, arg);
    if (typeof renderHooks.go === 'function') { renderHooks.go(to); return; }
    location.href = BASE_PATH() + to;
  }
  /* A link to an account page: a real address (it can be opened in a new
     tab), which the shop's router answers without loading the page again. */
  function pageLink(cls, sec, arg) {
    var a = el('a', cls);
    a.href = BASE_PATH() + pagePath(sec, arg);
    a.addEventListener('click', function (e) {
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return;
      if (typeof renderHooks.go !== 'function') return;
      e.preventDefault();
      renderHooks.go(pagePath(sec, arg));
    });
    return a;
  }

  /* The icons: drawn with lines, in the colour of the text around them. */
  var ICONS = {
    box: '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
    turn: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 3v5h5"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 21v-5h-5"/>',
    heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21.2l8.8-8.8a5.5 5.5 0 0 0 0-7.8z"/>',
    eye: '<path d="M1.5 12S5 5.5 12 5.5 22.5 12 22.5 12 19 18.5 12 18.5 1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
    pin: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/>',
    award: '<circle cx="12" cy="9" r="6"/><path d="M8.5 14.2L7 22l5-3 5 3-1.5-7.8"/>',
    chat: '<path d="M21 11.5a8.5 8.5 0 0 1-12.5 7.5L3 20.5l1.6-4.9A8.5 8.5 0 1 1 21 11.5z"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
    back: '<path d="M15 5l-7 7 7 7"/>'
  };
  function icon(name, cls) {
    var s = el('span', cls || 'pt-ic');
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = '<svg viewBox="0 0 24 24" focusable="false">' + (ICONS[name] || '') + '</svg>';
    return s;
  }

  /* ---- what is on, as the shop has set it ------------------------------ */
  function always() { return true; }
  function wishlistOn() { return typeof renderHooks.wishlistOn === 'function' ? !!renderHooks.wishlistOn() : true; }
  function rewardsOn() { return !!(window.VBP_REWARDS && window.VBP_REWARDS.enabled); }
  function addressesAllowed() { return !api.settings || api.settings.savedAddresses !== false; }
  function passwordOn() { return !api.settings || api.settings.passwordReset !== false; }
  function closingOn() { return !api.settings || api.settings.accountDeletion !== false; }
  function newsletterOn() { var n = renderHooks.newsletter || {}; return n.enabled !== false; }

  /* The dashboard's three groups, as the owner's screenshots have them.
     Gift cards and My wallet are left out (decision D9): the platform has
     both switched off. Product alerts come with website build 90 (89 before build 88 was put first). */
  var SHOPPING = [
    { sec: 'orders', ic: 'box', t: 'My orders', s: 'Order history and tracking', on: historyOn },
    { sec: 'refunds', ic: 'turn', t: 'Returns & refunds', s: 'Manage order issues', on: historyOn },
    { shop: 'wishlist', ic: 'heart', t: 'My wishlist', s: 'Saved products', on: wishlistOn },
    { sec: 'recent', ic: 'eye', t: 'Recently viewed', s: 'Continue shopping', on: always }
  ];
  var MINE = [
    { sec: 'details', ic: 'user', t: 'Personal details', on: always },
    { sec: 'addresses', ic: 'pin', t: 'Address book', on: addressesAllowed },
    { sec: 'rewards', ic: 'award', t: 'Rewards & membership', on: rewardsOn },
    { sec: 'support', ic: 'chat', t: 'Customer support', on: always },
    { sec: 'notifications', ic: 'bell', t: 'Notifications', on: always }
  ];
  var SAFE = [
    { sec: 'password', t: 'Password and authentication', on: passwordOn },
    { sec: 'sessions', t: 'Active devices and sessions', on: always },
    { sec: 'privacy', t: 'Privacy and marketing preferences', on: always },
    { sec: 'data', t: 'Download my personal data', on: always },
    { sec: 'close', t: 'Close my account', on: closingOn }
  ];

  function drawSignedIn(host) {
    if (api.recovering) {
      var head = el('div', 'ac-head');
      head.appendChild(el('h1', 'serif', 'Your account'));
      host.appendChild(head);
      host.appendChild(recoveryCard(host));
      return;
    }
    var page = PAGES[view.sec];
    if (!view.sec || !page || !page.on()) { drawDashboard(host); return; }
    drawPage(host, page);
  }

  /* ---- the dashboard --------------------------------------------------- */
  function brandWord() {
    var n = typeof renderHooks.shopName === 'function' ? String(renderHooks.shopName() || '') : '';
    return (n.trim().split(/\s+/)[0] || 'Vaultique').toUpperCase();
  }
  function two(n) { n = Math.max(0, Math.round(Number(n) || 0)); return n < 10 ? '0' + n : String(n); }

  function drawDashboard(host) {
    var box = el('div', 'pt');
    var hero = el('div', 'pt-hero');
    var top = el('div', 'pt-top');
    top.appendChild(el('span', 'pt-brand', brandWord()));
    top.appendChild(el('span', 'pt-badge', 'Customer portal'));
    hero.appendChild(top);
    hero.appendChild(el('h1', 'pt-welcome', 'Welcome back'));
    hero.appendChild(el('p', 'pt-sub', 'Your shopping, rewards and account at a glance.'));

    /* The three figures, each the customer's own and each from where it
       lives: the orders from the shop's records, the wishlist from this
       account, the points from the business platform. */
    var tiles = el('div', 'pt-tiles');
    function tile(cls, sec, shop, label) {
      var a = shop ? el('a', 'pt-tile ' + cls) : pageLink('pt-tile ' + cls, sec);
      if (shop) {
        a.href = BASE_PATH() + shop;
        a.addEventListener('click', function (e) {
          if (typeof renderHooks.go !== 'function' || e.ctrlKey || e.metaKey) return;
          e.preventDefault(); renderHooks.go(shop);
        });
      }
      var n = el('b', 'pt-n', '··');
      a.appendChild(n);
      a.appendChild(el('span', 'pt-l', label));
      tiles.appendChild(a);
      return { n: n, a: a };
    }
    if (historyOn()) {
      var tOrders = tile('pt-t-orders', 'orders', '', 'Orders');
      myOrders().then(function (rows) { tOrders.n.textContent = two(rows.length); },
                      function () { tOrders.n.textContent = '–'; });
    }
    if (wishlistOn()) {
      var tWish = tile('pt-t-wish', '', 'wishlist', 'Wishlist');
      tWish.n.textContent = two(wishlistNow().length);
    }
    if (rewardsOn()) {
      var tPts = tile('pt-t-points', 'rewards', '', 'Points');
      window.VBP_REWARDS.status(false).then(function (s) {
        if (s && s.linked && !s.unavailable && !s.missing) {
          tPts.n.textContent = window.VBP_REWARDS.points(s.points);
        } else if (s && !s.linked) {
          tPts.n.textContent = 'Join';
          tPts.a.querySelector('.pt-l').textContent = 'Rewards';
        } else {
          tPts.n.textContent = '–';
        }
      }, function () { tPts.n.textContent = '–'; });
    }
    tiles.className = 'pt-tiles pt-tiles-' + tiles.children.length;
    if (tiles.children.length) hero.appendChild(tiles);
    box.appendChild(hero);

    var body = el('div', 'pt-body');
    showNotice(body);
    if (needsVerifiedEmail() && !api.user.emailConfirmed) {
      body.appendChild(el('div', 'ac-warn',
        'Your email address is not confirmed yet, so you cannot check out. ' +
        'Check your inbox for the link we sent to ' + api.user.email + '.'));
    }

    var groups = 0;
    function group(title) {
      if (groups++) body.appendChild(el('hr', 'pt-rule'));
      body.appendChild(el('h2', 'pt-h', title));
    }

    var shopping = SHOPPING.filter(function (x) { return x.on(); });
    if (shopping.length) {
      group('My shopping');
      var grid = el('div', 'pt-grid');
      shopping.forEach(function (x) {
        var a = x.shop ? el('a', 'pt-card') : pageLink('pt-card', x.sec);
        if (x.shop) {
          a.href = BASE_PATH() + x.shop;
          a.addEventListener('click', function (e) {
            if (typeof renderHooks.go !== 'function' || e.ctrlKey || e.metaKey) return;
            e.preventDefault(); renderHooks.go(x.shop);
          });
        }
        a.setAttribute('data-page', x.sec || x.shop);
        a.appendChild(icon(x.ic));
        a.appendChild(el('span', 'pt-t', x.t));
        a.appendChild(el('span', 'pt-s', x.s));
        grid.appendChild(a);
      });
      body.appendChild(grid);
    }

    var mine = MINE.filter(function (x) { return x.on(); });
    /* The owner, 21 November: "Where it's written My Vaultique, write My Vault". */
    group('My Vault');
    var rows = el('div', 'pt-rows');
    mine.forEach(function (x) {
      var a = pageLink('pt-row', x.sec);
      a.setAttribute('data-page', x.sec);
      a.appendChild(icon(x.ic));
      a.appendChild(el('span', 'pt-t', x.t));
      rows.appendChild(a);
    });
    body.appendChild(rows);

    group('Security and privacy');
    var ul = el('ul', 'pt-list');
    SAFE.filter(function (x) { return x.on(); }).forEach(function (x) {
      var li = el('li');
      var a = pageLink('pt-li', x.sec);
      a.setAttribute('data-page', x.sec);
      a.textContent = x.t;
      li.appendChild(a);
      ul.appendChild(li);
    });
    body.appendChild(ul);

    var foot = el('div', 'pt-foot');
    foot.appendChild(el('span', 'pt-who', 'Signed in as ' + api.user.email));
    var out = el('button', 'btn btn-outline btn-sm pt-out', 'Sign out');
    out.type = 'button';
    out.addEventListener('click', function () {
      out.disabled = true;
      signOut('local').then(function () { nav(''); render(host); });
    });
    foot.appendChild(out);
    body.appendChild(foot);

    box.appendChild(body);
    host.appendChild(box);
  }
  /* The wishlist as it is once this device's and the account's are put
     together (mergeWishlist): drawn before the shop has merged them, the
     dashboard would count only this device's. */
  function wishlistNow() {
    var local = typeof renderHooks.wishlist === 'function' ? (renderHooks.wishlist() || []) : [];
    var out = Array.isArray(local) ? local.slice() : [];
    var mine = (wishlistFollows() && api.profile && Array.isArray(api.profile.wishlist)) ? api.profile.wishlist : [];
    mine.forEach(function (sku) { if (out.indexOf(sku) < 0) out.push(sku); });
    return out;
  }
  function brandName() {
    var n = typeof renderHooks.shopName === 'function' ? String(renderHooks.shopName() || '') : '';
    return n.trim().split(/\s+/)[0] || 'Vaultique';
  }

  /* ---- a page of the account -------------------------------------------- */
  var PAGES = {
    orders: { title: 'My orders', on: historyOn, draw: drawOrdersPage },
    refunds: { title: 'Returns & refunds', on: historyOn, draw: drawRefunds },
    recent: { title: 'Recently viewed', on: always, draw: drawRecent },
    details: { title: 'Personal details', on: always, draw: function (host) { host.appendChild(detailsCard(host)); } },
    addresses: { title: 'Address book', on: addressesAllowed, draw: function (host) { host.appendChild(addressCard()); } },
    rewards: { title: 'Rewards & membership', on: rewardsOn, draw: drawRewards },
    support: { title: 'Customer support', on: always, draw: drawSupport },
    notifications: { title: 'Notifications', on: always, draw: drawNotifications },
    password: { title: 'Password and authentication', on: passwordOn, draw: drawPassword },
    sessions: { title: 'Active devices and sessions', on: always, draw: drawSessions },
    privacy: { title: 'Privacy and marketing preferences', on: always, draw: drawPrivacy },
    data: { title: 'Download my personal data', on: always, draw: drawData },
    close: { title: 'Close my account', on: closingOn, draw: function (host) { host.appendChild(dangerCard(host)); } }
  };

  function drawPage(host, page) {
    var bar = el('div', 'pt-bar');
    var detail = view.sec === 'orders' && view.arg;
    var back = pageLink('pt-back', detail ? 'orders' : '');
    back.appendChild(icon('back', 'pt-back-ic'));
    back.appendChild(document.createTextNode(detail ? 'My orders' : 'My account'));
    bar.appendChild(back);
    host.appendChild(bar);
    host.appendChild(el('h1', 'pt-title serif', detail ? 'Order ' + view.arg : page.title));
    page.draw(host);
  }

  /* The website's own function for the records only the shop may read,
     asked as the signed-in customer (netlify/functions/account-portal.js). */
  var PORTAL_FN = '/.netlify/functions/account-portal';
  function portalAsk(action, data) {
    if (!sb || !api.user) return Promise.reject(new Error('Please sign in first.'));
    return Promise.resolve(sb.auth.getSession()).then(function (r) {
      var s = r && r.data && r.data.session;
      var token = (s && s.access_token) || api.token;
      if (!token) throw new Error('Please sign in again.');
      return fetch(PORTAL_FN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify(Object.assign({ action: action }, data || {}))
      });
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (b) {
        if (!b || typeof b !== 'object') throw new Error('That could not be read just now. Please try again shortly.');
        if (!res.ok) throw new Error(b.error || 'That could not be done just now. Please try again shortly.');
        return b;
      });
    }, function (e) {
      if (e && e.message && !/fetch|network|load failed/i.test(e.message)) throw e;
      throw new Error('Check your connection and try again.');
    });
  }

  function money(v) { return renderHooks.money ? renderHooks.money(Number(v) || 0) : 'K' + (Number(v) || 0).toFixed(2); }
  function day(iso) { return iso ? (renderHooks.date ? renderHooks.date(iso) : new Date(iso).toLocaleDateString()) : ''; }

  /* ---- an order's state, in the owner's words ---------------------------
     "The account should distinguish between requested, confirmed, paid,
     fulfilled and completed orders." One word for the badge, from what the
     shop's records say, and the same words everywhere an order is shown. */
  function rungUp(o) { return !!(o.pos_completed_at || o.pos_receipt_no || o.pos_sale_id); }
  function paidOnline(o) { return o.payment_method === 'online' && o.payment_status === 'paid'; }
  function stage(o) {
    var s = o.status || 'pending', collect = o.fulfilment === 'collection';
    if (s === 'cancelled') return { key: 'cancelled', word: 'Cancelled' };
    if (s === 'completed') return { key: 'completed', word: 'Completed' };
    if (s === 'delivered') return { key: 'delivered', word: collect ? 'Collected' : 'Delivered' };
    if (s === 'dispatched') return { key: 'dispatched', word: 'On its way' };
    if (s === 'ready') return { key: 'ready', word: 'Ready for collection' };
    if (s === 'confirmed' && rungUp(o)) return { key: 'preparing', word: 'Preparing' };
    if (paidOnline(o)) return { key: 'paid', word: 'Paid' };
    if (s === 'confirmed') return { key: 'confirmed', word: 'Confirmed' };
    if (o.payment_method === 'online' && (o.payment_status === 'failed' || o.payment_status === 'expired')) {
      return { key: 'unpaid', word: 'Payment not completed' };
    }
    if (o.payment_method === 'online') return { key: 'awaiting', word: 'Awaiting payment' };
    return { key: 'requested', word: 'Requested' };
  }
  /* What the word means, in a line. */
  function stageNote(o, st) {
    var collect = o.fulfilment === 'collection';
    switch (st.key) {
      case 'requested': return 'You sent this order. We confirm it with you on WhatsApp before anything is paid.';
      case 'awaiting': return 'The payment was started but has not been confirmed yet.';
      case 'unpaid': return 'The payment was not completed, so nothing was charged. You can order again at any time.';
      case 'paid': return 'Paid online. We are getting it ready.';
      case 'confirmed': return 'We have confirmed your order.';
      case 'preparing': return 'Paid, and we are getting it ready' + (collect ? ' for you to collect.' : ' to send.');
      case 'dispatched': return 'On its way to you.';
      case 'ready': return 'Ready for you to collect at the shop.';
      case 'delivered': return collect ? 'You have collected it.' : 'Delivered.';
      case 'completed': return 'Completed at the shop.';
      case 'cancelled': return 'This order was cancelled.';
    }
    return '';
  }
  /* The five steps, each done or not, with its date. */
  function journey(o) {
    var s = o.status || 'pending', collect = o.fulfilment === 'collection';
    var rung = rungUp(o), cancelled = s === 'cancelled';
    var paid = !cancelled && (paidOnline(o) || rung || !!o.paid_at);
    var confirmed = !cancelled && (s !== 'pending' || rung || paidOnline(o));
    var fulfilled = s === 'delivered' || s === 'completed';
    var done = fulfilled;
    var steps = [
      { key: 'requested', label: 'Requested', at: o.created_at, done: true },
      { key: 'confirmed', label: 'Confirmed', at: o.pos_completed_at || (paidOnline(o) ? o.paid_at : null), done: confirmed },
      { key: 'paid', label: 'Paid', at: o.paid_at || o.pos_completed_at, done: paid },
      { key: 'fulfilled', label: collect ? 'Collected' : 'Delivered', at: o.delivered_at || (s === 'completed' ? o.pos_completed_at : null), done: fulfilled },
      { key: 'completed', label: 'Completed', at: o.delivered_at || (s === 'completed' ? o.pos_completed_at : null), done: done }
    ];
    if (cancelled) steps = [steps[0], { key: 'cancelled', label: 'Cancelled', at: o.updated_at || null, done: true, stop: true }];
    var last = -1;
    steps.forEach(function (x, i) { if (x.done) last = i; });
    if (last > -1) steps[last].now = true;
    return steps;
  }
  function journeyRail(o) {
    var steps = journey(o);
    var ol = el('ol', 'oj oj-' + steps.length);
    ol.setAttribute('aria-label', 'Where your order is');
    steps.forEach(function (x) {
      var li = el('li', 'oj-step' + (x.done ? ' done' : '') + (x.now ? ' now' : '') + (x.stop ? ' stop' : ''));
      li.setAttribute('data-step', x.key);
      li.appendChild(el('b', null, x.label));
      if (x.done && x.at) li.appendChild(el('span', 'oj-at', day(x.at)));
      ol.appendChild(li);
    });
    return ol;
  }

  /* ---- My orders --------------------------------------------------------- */
  function drawOrdersPage(host) {
    if (view.arg) { orderDetail(host, view.arg); return; }
    host.appendChild(ordersCard());
  }

  function ordersCard() {
    var c = card('Your orders');
    var list = el('div', 'ac-list');
    list.appendChild(el('p', 'ac-quiet', 'Loading…'));
    c.appendChild(list);
    /* What the words on an order mean, so the five are told apart. */
    var key = el('p', 'ac-quiet ac-key');
    key.textContent = 'Requested: you sent it, and we have not confirmed it yet (an order sent on WhatsApp is ' +
      'confirmed with you there). Confirmed: we have it in hand. Paid: paid online or at the shop. ' +
      'Delivered or Collected: it is with you. Completed: nothing is left to do.';
    c.appendChild(key);

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
        /* BUILD 86 · one word for where it is, the same as on its own page. */
        var stg = stage(o);
        top.appendChild(el('span', 'ac-status is-' + stg.key, stg.word));
        row.appendChild(top);

        var when = el('div', 'ac-quiet');
        when.textContent = day(o.created_at) +
          (o.fulfilment === 'collection' ? ' · for collection' : ' · for delivery');
        row.appendChild(when);

        /* BUILD 78 · rung up at the shop, with goods still to go: the steps
           and, while it is on its way, the customer's two buttons. */
        var pg = PG && ('dispatched_at' in o) ? PG.fromRow(o) : null;
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
        }
        var acts = el('div', 'ac-order-acts');
        if (o.pos_receipt) {
          var dl = el('button', 'btn btn-outline btn-sm ac-receipt', 'Download receipt');
          dl.type = 'button';
          dl.addEventListener('click', function () { downloadReceipt(o); });
          acts.appendChild(dl);
        }
        /* BUILD 86 · everything about it, on a page of its own. */
        if (o.ref) {
          var open = pageLink('btn btn-gold btn-sm ac-view', 'orders', o.ref);
          open.textContent = 'View order';
          acts.appendChild(open);
        }
        row.appendChild(acts);
        list.appendChild(row);
      });
    });
    }
    fill(null);
    return c;
  }

  /* ---- one order, in full ------------------------------------------------- */
  function orderDetail(host, ref) {
    var c = el('div', 'ac-card acd');
    c.appendChild(el('p', 'ac-quiet', 'Loading…'));
    host.appendChild(c);
    var PG = window.VBP_PROGRESS || null;

    function draw(said) {
      myOrders().then(function (rows) {
        var o = null;
        for (var i = 0; i < rows.length; i++) {
          if (String(rows[i].ref || '').toUpperCase() === String(ref).toUpperCase()) { o = rows[i]; break; }
        }
        c.innerHTML = '';
        if (!o) {
          c.appendChild(el('p', 'ac-lead', 'This order is not on your account.'));
          var back = pageLink('btn btn-outline btn-sm', 'orders');
          back.textContent = 'See my orders';
          c.appendChild(back);
          return;
        }
        c.setAttribute('data-ref', o.ref || '');
        var st = stage(o);
        var top = el('div', 'ac-order-top');
        top.appendChild(el('span', 'ac-ref', o.ref || ''));
        top.appendChild(el('span', 'ac-status is-' + st.key, st.word));
        c.appendChild(top);
        c.appendChild(el('p', 'ac-lead acd-note', stageNote(o, st)));
        c.appendChild(journeyRail(o));

        /* Rung up, the goods still to go: the same steps and buttons as the
           list and the private link (assets/progress.js), while there is
           something still to happen. Its refund line is left to Refunds,
           below, which has every refund. */
        var pg = PG && ('dispatched_at' in o) ? PG.fromRow(o) : null;
        if (pg && pg.rungUp && ['confirmed', 'dispatched', 'ready'].indexOf(o.status) > -1) {
          PG.draw(c, Object.assign({}, pg, { refund: null }), {
            money: renderHooks.money,
            message: said || '',
            onConfirm: function () { return confirmDelivery(o.id); },
            onExtend: function () { return askMoreTime(o.id); },
            after: function (r, words) { draw(words); }
          });
        }

        /* What was ordered, and what it came to. */
        c.appendChild(el('h3', 'acd-h', 'What you ordered'));
        var items = el('div', 'acd-items');
        (o.order_items || []).forEach(function (it) {
          var line = el('div', 'acd-line');
          line.appendChild(el('span', 'acd-what', (it.qty > 1 ? it.qty + ' × ' : '') + (it.name || it.sku || '')));
          line.appendChild(el('span', 'acd-amt', it.price != null ? money(Number(it.price) * (Number(it.qty) || 1)) : ''));
          items.appendChild(line);
        });
        c.appendChild(items);
        var sums = el('div', 'acd-sums');
        function sum(label, v, strong) {
          if (v == null || v === '') return;
          var line = el('div', 'acd-line' + (strong ? ' acd-total' : ''));
          line.appendChild(el('span', 'acd-what', label));
          line.appendChild(el('span', 'acd-amt', money(v)));
          sums.appendChild(line);
        }
        if (o.goods_total != null && o.delivery_fee != null) {
          sum('Pieces', o.goods_total);
          sum(o.fulfilment === 'collection' ? 'Collection' : 'Delivery', o.delivery_fee);
        }
        sum('Total', o.total, true);
        if (paidOnline(o) && o.paid_amount != null) sum('Paid online', o.paid_amount);
        c.appendChild(sums);

        /* How it was ordered, and where it goes. */
        c.appendChild(el('h3', 'acd-h', 'Ordering and delivery'));
        var kv = el('dl', 'acd-kv');
        function pair(k, v) { if (!v) return; kv.appendChild(el('dt', null, k)); kv.appendChild(el('dd', null, v)); }
        pair('Placed', day(o.created_at));
        pair('How', o.payment_method === 'online'
          ? 'On the website, paying online' + (o.pay_channel ? ' (' + channelWord(o.pay_channel) + ')' : '')
          : 'On WhatsApp, paying at the shop or as agreed with us');
        pair(o.fulfilment === 'collection' ? 'Collection' : 'Delivery to',
             o.fulfilment === 'collection' ? 'At the shop' : (o.address || ''));
        if (o.ship_note) pair('From the shop', o.ship_note);
        if (o.delivered_at) {
          pair(o.fulfilment === 'collection' ? 'Collected' : 'Delivered',
               day(o.delivered_at) + (BY_WHOM[o.delivered_by] ? ', ' + BY_WHOM[o.delivered_by] : ''));
        }
        if (o.pos_receipt_no) pair('Receipt', o.pos_receipt_no);
        c.appendChild(kv);

        /* Refunds on this order: the platform's, as Flutterwave or the till
           recorded them, and any still on its way. */
        var rf = el('div', 'acd-refunds');
        c.appendChild(rf);
        refundLines(o, rf);

        var acts = el('div', 'ac-actions');
        if (o.pos_receipt) {
          var dl = el('button', 'btn btn-outline btn-sm ac-receipt', 'Download receipt');
          dl.type = 'button';
          dl.addEventListener('click', function () { downloadReceipt(o); });
          acts.appendChild(dl);
        }
        var ask = askLink('Hello, I have a question about my order ' + o.ref + '.', 'Ask about this order');
        if (ask) acts.appendChild(ask);
        c.appendChild(acts);

        /* BUILD 87 · its requests, and the buttons to ask the shop. */
        requestsBlock(c, o, function (words) { reqSaid = words || ''; draw(''); }, reqSaid);
        reqSaid = '';
      });
    }
    var reqSaid = '';
    draw('');
  }

  var BY_WHOM = { customer: 'confirmed by you', shop: 'marked by the shop', auto: 'marked when the days ran out' };
  function channelWord(ch) {
    ch = String(ch || '').toLowerCase();
    if (/mobile|mpesa|airtel|mtn|zamtel/.test(ch)) return 'mobile money';
    if (/card/.test(ch)) return 'card';
    if (/bank|account|transfer/.test(ch)) return 'bank';
    return ch;
  }

  /* The ask-us button the rest of the shop uses: the live chat when it is
     open, WhatsApp when it is not (assets/app.js, enquireLink). */
  function askLink(text, label) {
    var a = el('a', 'btn btn-outline btn-sm ac-ask');
    if (typeof renderHooks.enquire === 'function') {
      try { renderHooks.enquire(a, text, label); } catch (e) { return null; }
      return a;
    }
    return null;
  }

  /* ---- Returns & refunds -------------------------------------------------- */
  var REFUND_WORDS = {
    'new': 'Being sent', sending: 'Being sent', unknown: 'Being sent',
    pending: 'On its way to you',
    completed: 'Refunded',
    failed: 'Not sent: we will contact you', refused: 'Not sent: we will contact you'
  };
  function refundRow(r) {
    var row = el('div', 'ac-refund');
    row.setAttribute('data-state', r.state || '');
    var top = el('div', 'ac-order-top');
    top.appendChild(el('span', 'ac-ref', r.order_ref || ''));
    top.appendChild(el('span', 'ac-status is-' + (r.state === 'completed' ? 'delivered' : (r.state === 'failed' || r.state === 'refused') ? 'unpaid' : 'awaiting'),
      REFUND_WORDS[r.state] || 'Being sent'));
    row.appendChild(top);
    row.appendChild(el('div', 'ac-item', (r.whole ? 'The whole order: ' : 'Part of the order: ') + money(r.amount)));
    var when = r.completed_at ? 'Refunded on ' + day(r.completed_at)
      : r.accepted_at ? 'Accepted by the payment service on ' + day(r.accepted_at) + '. Banks and mobile money can take a few days.'
      : r.requested_at ? 'Asked for on ' + day(r.requested_at) : '';
    if (when) row.appendChild(el('div', 'ac-quiet', when));
    return row;
  }
  /* A refund the platform recorded on the order itself (website 78, 81). */
  function orderRefundRow(o) {
    return refundRow({ order_ref: o.ref, state: 'completed', amount: o.refund_amount,
                       whole: o.refund_state === 'full', completed_at: o.refund_at });
  }
  var refundsAsked = null;
  function refundsOnTheWay() {
    if (!refundsAsked) {
      refundsAsked = portalAsk('refunds').then(function (b) { return Array.isArray(b.refunds) ? b.refunds : null; },
                                               function () { return null; });
      setTimeout(function () { refundsAsked = null; }, 30000);
    }
    return refundsAsked;
  }
  function refundLines(o, host) {
    refundsOnTheWay().then(function (list) {
      var mine = (list || []).filter(function (r) { return r.order_ref === o.ref; });
      if (!mine.length && o.refund_state) mine = null;
      if (!mine && !o.refund_state) return;
      host.appendChild(el('h3', 'acd-h', 'Refunds'));
      if (mine && mine.length) mine.forEach(function (r) { host.appendChild(refundRow(r)); });
      else host.appendChild(orderRefundRow(o));
      if (o.refund_ref) host.appendChild(el('p', 'ac-quiet', 'Reference ' + o.refund_ref));
    });
  }

  function drawRefunds(host) {
    var c = card('Refunds');
    var list = el('div', 'ac-list');
    list.appendChild(el('p', 'ac-quiet', 'Loading…'));
    c.appendChild(list);
    host.appendChild(c);
    Promise.all([myOrders(), refundsOnTheWay()]).then(function (got) {
      var orders = got[0] || [], sent = got[1];
      list.innerHTML = '';
      var shown = {};
      (sent || []).forEach(function (r) { shown[r.order_ref] = true; list.appendChild(refundRow(r)); });
      orders.forEach(function (o) { if (o.refund_state && !shown[o.ref]) list.appendChild(orderRefundRow(o)); });
      if (!list.children.length) {
        list.appendChild(el('p', 'ac-quiet', 'No refunds. When we refund an order, it shows here, and we email you.'));
      }
      if (sent === null) {
        list.appendChild(el('p', 'ac-quiet', 'Refunds still on their way could not be read just now.'));
      }
    });

    requestsCard(host);
  }

  /* ---- BUILD 87 · asking the shop: cancel, return, exchange, a problem ----
     The owner, 21 November 2026: "Every new customer-account feature must
     connect to the Business Platform where appropriate. For example, an
     approved refund must reflect in the website, Flutterwave and the
     Business Platform."

     So here a customer only ASKS. The request is kept by the website's
     database (supabase-customer-requests.sql); the shop accepts or
     declines it in the business platform's Online Orders (platform 512),
     or by hand in Admin > Orders; a refund that follows is the platform's
     Online Refund, as every refund is; and the customer is emailed each
     answer (netlify/functions/order-progress.js). These pages show what
     the shop decided, read back each time: nothing here keeps a state of
     its own.

     Switched off until Settings > Customer Accounts says so. Off, the
     database refuses a request whatever a browser sends, and the pages
     keep "Message us", as before. Photos go in the chat, which already
     takes them, with the request's number. */
  function requestsOn() { return historyOn() && api.settings.customerRequests === true; }

  var REASON_WORDS = {
    changed_mind: 'I changed my mind',
    ordered_by_mistake: 'I ordered it by mistake',
    too_slow: 'It is taking too long',
    wrong_size: 'The size or fit is wrong',
    not_as_shown: 'It is not as shown on the website',
    damaged: 'It arrived damaged',
    quality: 'A problem with its quality',
    wrong_item: 'It is not what I ordered',
    missing: 'Something is missing',
    other: 'Something else'
  };
  var KIND_WORDS = { cancel: 'Cancel the order', 'return': 'Return', exchange: 'Exchange', problem: 'A problem' };
  var REQUEST_STATES = {
    requested: { key: 'awaiting', word: 'With the shop' },
    accepted: { key: 'confirmed', word: 'Accepted' },
    declined: { key: 'unpaid', word: 'Not accepted' },
    done: { key: 'delivered', word: 'Done' },
    withdrawn: { key: 'requested', word: 'Withdrawn' }
  };
  /* Why a request cannot be sent, in the customer's words. */
  function requestWhy(kind, why) {
    switch (why) {
      case 'off': return 'Requests are not open just now. Please message us instead.';
      case 'signin': return 'Please sign in again.';
      case 'not_found': return 'This order is not on your account.';
      case 'cancelled': return 'This order is cancelled.';
      case 'say_more': return 'Please tell us a little more, in the box.';
      case 'say_instead': return 'Please say what you would like instead.';
      case 'which_pieces': return 'Please tick the pieces.';
      case 'unreadable': return 'Please choose a reason.';
      case 'answered': return 'The shop has already answered this request.';
      case 'too_late':
        if (kind === 'cancel') return 'This order is already being prepared or on its way, so it can no longer be cancelled here. Please message us.';
        if (kind === 'problem') return 'It is more than 30 days since this order arrived. Please message us.';
        return 'The days for a return or an exchange have passed. Please message us if something is wrong.';
      case 'not_yet':
        return kind === 'problem' ? 'You can report a problem once the order is on its way.'
                                  : 'You can ask once the order has arrived.';
    }
    return 'That could not be sent just now. Please try again shortly.';
  }
  function rpcAnswer(r) {
    if (r && r.error) throw r.error;
    return (r && r.data) || null;
  }
  /* Every request of the signed-in customer, newest first; none before the
     SQL has been run, or when they cannot be read just now. */
  function myRequests() {
    if (!sb || !signedIn()) return Promise.resolve([]);
    return Promise.resolve(sb.rpc('requests_mine')).then(function (r) {
      var d = r && !r.error ? r.data : null;
      return Array.isArray(d) ? d : [];
    }, function () { return []; });
  }
  /* What may be asked of one order now, as the database says. */
  function requestChoices(orderId) {
    if (!sb || !signedIn() || !requestsOn() || !orderId) return Promise.resolve(null);
    return Promise.resolve(sb.rpc('request_choices', { p_order: orderId })).then(function (r) {
      var d = r && !r.error ? r.data : null;
      return d && d.ok && d.choices ? d.choices : null;
    }, function () { return null; });
  }
  function requestOpen(rq) { return rq.status === 'requested' || rq.status === 'accepted'; }
  function piecesOf(rq) {
    return (Array.isArray(rq.items) ? rq.items : []).map(function (i) {
      return (Number(i.qty) > 1 ? i.qty + ' × ' : '') + (i.name || i.sku || '');
    }).filter(Boolean).join(', ');
  }

  /* One request: what was asked, and where it stands. */
  function requestRow(rq, opts) {
    opts = opts || {};
    var row = el('div', 'ac-refund rq-row');
    row.setAttribute('data-rq', rq.ref || '');
    row.setAttribute('data-state', rq.status || '');
    var st = REQUEST_STATES[rq.status] || REQUEST_STATES.requested;
    var top = el('div', 'ac-order-top');
    var title = el('span', 'ac-ref', KIND_WORDS[rq.kind] || 'Request');
    if (opts.withOrder && rq.orderRef) {
      title.appendChild(document.createTextNode(' · '));
      title.appendChild(el('span', 'rq-oref', rq.orderRef));   // the number kept on one line
    }
    top.appendChild(title);
    top.appendChild(el('span', 'ac-status is-' + st.key, st.word));
    row.appendChild(top);
    row.appendChild(el('div', 'ac-item', REASON_WORDS[rq.reason] || ''));
    if (piecesOf(rq)) row.appendChild(el('div', 'ac-quiet', piecesOf(rq)));
    if (rq.wants) row.appendChild(el('div', 'ac-quiet', 'Instead: ' + rq.wants));
    if (rq.detail) row.appendChild(el('div', 'ac-quiet rq-said', '“' + rq.detail + '”'));
    if (rq.answer) row.appendChild(el('div', 'rq-answer', 'From the shop: ' + rq.answer));
    var when = rq.status === 'done' && rq.doneAt ? 'Done on ' + day(rq.doneAt)
      : rq.decidedAt && rq.status !== 'withdrawn' ? 'Answered on ' + day(rq.decidedAt)
      : 'Asked on ' + day(rq.createdAt);
    row.appendChild(el('div', 'ac-quiet', when + ' · ' + (rq.ref || '')));

    var acts = el('div', 'ac-actions');
    var msg = el('p', 'ac-msg');
    if (rq.status === 'requested' && sb) {
      var wd = el('button', 'ac-link rq-withdraw', 'Withdraw');
      wd.type = 'button';
      var armed = false, timer = null;
      var disarm = function () { armed = false; wd.disabled = false; wd.textContent = 'Withdraw'; };
      wd.addEventListener('click', function () {
        if (!armed) {
          armed = true;
          wd.textContent = 'Withdraw it? Tap again';
          timer = setTimeout(disarm, 5000);
          return;
        }
        clearTimeout(timer);
        wd.disabled = true;
        say(msg, 'Withdrawing…', 'busy');
        Promise.resolve(sb.rpc('request_withdraw', { p_id: rq.id })).then(rpcAnswer).then(function (d) {
          if (!d || !d.ok) {
            disarm();
            say(msg, requestWhy(rq.kind, d && d.why), 'err');
            if (d && d.why === 'answered' && opts.after) opts.after(requestWhy(rq.kind, 'answered'));
            return;
          }
          if (opts.after) opts.after('Withdrawn. You can ask again while the order allows it.');
        }, function (e) { disarm(); say(msg, friendly(e), 'err'); });
      });
      acts.appendChild(wd);
    }
    if (requestOpen(rq) && rq.kind !== 'cancel') {
      var ph = askLink('Hello, here are photos for my request ' + rq.ref + ' (order ' + (rq.orderRef || '') + ').', 'Send photos');
      if (ph) { ph.classList.add('rq-photos-btn'); acts.appendChild(ph); }
    }
    if (opts.withOrder && rq.orderRef) {
      var open = pageLink('ac-link', 'orders', rq.orderRef);
      open.textContent = 'Open the order';
      acts.appendChild(open);
    }
    if (acts.children.length) { row.appendChild(acts); row.appendChild(msg); }
    return row;
  }

  /* The form for one kind of request, or for a return or an exchange. */
  function requestForm(host, o, kinds, ch, done, close) {
    var f = el('div', 'ac-inline rq-form');
    f.setAttribute('data-kinds', kinds.join(' '));
    var kind = kinds[0];
    var id = 'rq_' + String(o.ref || 'o').replace(/[^A-Za-z0-9]/g, '');
    f.appendChild(el('p', 'ac-lead rq-lead', kind === 'cancel'
      ? 'We will email you our answer. If we accept and you paid online, your money comes back the way you paid.'
      : kind === 'problem' ? 'Tell us what is wrong. We will email you our answer.'
      : 'Tell us which pieces and why. We will email you our answer, and arrange it with you.'));

    if (kinds.length > 1) {
      f.appendChild(el('span', 'rv-lbl', 'What would you like?'));
      var choice = el('div', 'rq-kinds');
      kinds.forEach(function (k, i) {
        var l = el('label', 'ac-check');
        var r = document.createElement('input');
        r.type = 'radio'; r.name = id + '_kind'; r.value = k; r.checked = i === 0;
        r.addEventListener('change', function () { if (r.checked) { kind = k; paint(); } });
        l.appendChild(r);
        l.appendChild(document.createTextNode(' ' + (k === 'return' ? 'Return it' : 'Exchange it for something else')));
        choice.appendChild(l);
      });
      f.appendChild(choice);
    }

    var pcsLbl = el('span', 'rv-lbl', 'Which pieces?');
    var pcsWrap = el('div', 'rq-pieces');
    f.appendChild(pcsLbl);
    f.appendChild(pcsWrap);
    var lines = o.order_items || [];
    var picks = lines.map(function (it) {
      var line = el('div', 'rq-piece');
      var l = el('label', 'ac-check');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = lines.length === 1;
      l.appendChild(cb);
      l.appendChild(document.createTextNode(' ' + (it.name || it.sku || '')));
      line.appendChild(l);
      var n = Math.max(1, Math.floor(Number(it.qty) || 1)), qty = null;
      if (n > 1) {
        qty = document.createElement('select');
        qty.className = 'rq-qty';
        qty.setAttribute('aria-label', 'How many of ' + (it.name || it.sku || 'this piece'));
        for (var q = 1; q <= n; q++) {
          var op = document.createElement('option');
          op.value = String(q); op.textContent = q + ' of ' + n;
          qty.appendChild(op);
        }
        qty.value = String(n);
        line.appendChild(qty);
      }
      pcsWrap.appendChild(line);
      return { sku: it.sku, cb: cb, qty: qty };
    });

    var rl = el('label', 'rv-lbl', 'Why?');
    rl.setAttribute('for', id + '_reason');
    var reason = document.createElement('select');
    reason.id = id + '_reason';
    f.appendChild(rl);
    f.appendChild(reason);

    var wl = el('label', 'rv-lbl', 'What would you like instead?');
    wl.setAttribute('for', id + '_wants');
    var wants = document.createElement('input');
    wants.type = 'text'; wants.id = id + '_wants'; wants.maxLength = 300;
    wants.placeholder = 'The same in another size, or another piece';
    f.appendChild(wl);
    f.appendChild(wants);

    var dl = el('label', 'rv-lbl', 'Tell us more');
    dl.setAttribute('for', id + '_detail');
    var detail = el('textarea');
    detail.id = id + '_detail'; detail.rows = 3; detail.maxLength = 1000;
    f.appendChild(dl);
    f.appendChild(detail);

    var photos = el('p', 'ac-quiet rq-photos', 'Photos help. Once this is sent, press Send photos beside it.');
    f.appendChild(photos);

    var acts = el('div', 'ac-actions');
    var send = el('button', 'btn btn-gold btn-sm rq-send', 'Send to the shop');
    send.type = 'button';
    var back = el('button', 'ac-link', 'Not now');
    back.type = 'button';
    back.addEventListener('click', close);
    acts.appendChild(send);
    acts.appendChild(back);
    f.appendChild(acts);
    var msg = el('p', 'ac-msg');
    f.appendChild(msg);
    /* What was missing is no longer said once they change something. */
    var unsay = function () { if (/\berr\b/.test(msg.className)) say(msg, ''); };
    f.addEventListener('input', unsay);
    f.addEventListener('change', unsay);

    function paint() {
      var reasons = (ch[kind] && ch[kind].reasons) || [];
      var was = reason.value;
      reason.innerHTML = '';
      var none = document.createElement('option');
      none.value = ''; none.textContent = 'Choose…';
      reason.appendChild(none);
      reasons.forEach(function (k) {
        var op = document.createElement('option');
        op.value = k; op.textContent = REASON_WORDS[k] || k;
        reason.appendChild(op);
      });
      if (reasons.indexOf(was) > -1) reason.value = was;
      var pieces = kind !== 'cancel' && picks.length > 0;
      pcsLbl.textContent = kind === 'problem' ? 'Which pieces, if any?' : 'Which pieces?';
      pcsLbl.style.display = pcsWrap.style.display = pieces ? '' : 'none';
      wl.style.display = wants.style.display = kind === 'exchange' ? '' : 'none';
      photos.style.display = kind === 'cancel' ? 'none' : '';
      dl.textContent = reason.value === 'other' ? 'Tell us more' : 'Tell us more (if you like)';
      send.textContent = kind === 'cancel' ? 'Ask to cancel' : 'Send to the shop';
    }
    reason.addEventListener('change', paint);
    paint();

    send.addEventListener('click', function () {
      var items = [];
      picks.forEach(function (p) {
        if (p.cb.checked && p.sku) items.push({ sku: p.sku, qty: p.qty ? Number(p.qty.value) : 1 });
      });
      if (!reason.value) { say(msg, requestWhy(kind, 'unreadable'), 'err'); reason.focus(); return; }
      if ((kind === 'return' || kind === 'exchange') && !items.length) { say(msg, requestWhy(kind, 'which_pieces'), 'err'); return; }
      if (kind === 'exchange' && !wants.value.trim()) { say(msg, requestWhy(kind, 'say_instead'), 'err'); wants.focus(); return; }
      if (reason.value === 'other' && !detail.value.trim()) { say(msg, requestWhy(kind, 'say_more'), 'err'); detail.focus(); return; }
      send.disabled = true;
      say(msg, 'Sending…', 'busy');
      Promise.resolve(sb.rpc('request_open', {
        p_order: o.id, p_kind: kind, p_reason: reason.value,
        p_detail: detail.value.trim() || null,
        p_items: kind === 'cancel' ? [] : items,
        p_wants: kind === 'exchange' ? wants.value.trim() : null
      })).then(rpcAnswer).then(function (d) {
        send.disabled = false;
        if (!d || !d.ok) { say(msg, requestWhy(kind, d && d.why), 'err'); return; }
        var ref = (d.request && d.request.ref) || '';
        done(d.again ? 'You had asked already: your request ' + ref + ' stands, below.'
                     : 'Sent: request ' + ref + '. The shop will email you its answer, and it shows here.');
      }, function (e) { send.disabled = false; say(msg, friendly(e), 'err'); });
    });

    host.appendChild(f);
    return f;
  }

  /* On an order's own page: its requests, and the buttons to ask. */
  function requestsBlock(c, o, after, said) {
    if (!sb || !signedIn() || !o || !o.id) return;
    var box = el('div', 'acd-requests');
    c.appendChild(box);
    Promise.all([myRequests(), requestChoices(o.id)]).then(function (got) {
      box.setAttribute('data-ready', 'yes');
      var mine = got[0].filter(function (rq) { return rq.orderRef === o.ref; });
      var ch = got[1];
      var openKind = {};
      mine.forEach(function (rq) { if (requestOpen(rq)) openKind[rq.kind] = true; });
      var can = function (k) { return !!(ch && ch[k] && ch[k].can && !openKind[k]); };
      var offers = [];
      if (can('cancel')) offers.push({ label: 'Cancel this order', kinds: ['cancel'] });
      var re = ['return', 'exchange'].filter(can);
      if (re.length) offers.push({ label: re.length === 2 ? 'Return or exchange' : re[0] === 'return' ? 'Return a piece' : 'Exchange a piece', kinds: re });
      if (can('problem')) offers.push({ label: 'Report a problem', kinds: ['problem'] });
      var late = !!(ch && ch['return'] && ch['return'].why === 'too_late' && !openKind['return'] && !openKind.exchange);
      if (!mine.length && !offers.length && !late && !said) return;

      box.appendChild(el('h3', 'acd-h', 'Requests'));
      if (said) box.appendChild(el('p', 'ac-msg ok rq-said-now', said));
      mine.forEach(function (rq) { box.appendChild(requestRow(rq, { after: after })); });
      if (late) box.appendChild(el('p', 'ac-quiet rq-late', requestWhy('return', 'too_late')));
      if (!offers.length) return;
      var row = el('div', 'ac-actions rq-offers');
      var formHost = el('div', 'rq-form-host');
      offers.forEach(function (of) {
        var b = el('button', 'btn btn-outline btn-sm rq-ask', of.label);
        b.type = 'button';
        b.setAttribute('data-kinds', of.kinds.join(' '));
        b.addEventListener('click', function () {
          row.style.display = 'none';
          formHost.innerHTML = '';
          var f = requestForm(formHost, o, of.kinds, ch, after, function () {
            formHost.innerHTML = '';
            row.style.display = '';
          });
          var first = f.querySelector('select, input');
          if (first && first.focus) {
            try { first.focus(); } catch (e) { /* nothing to do */ }
          }
        });
        row.appendChild(b);
      });
      box.appendChild(row);
      box.appendChild(formHost);
    });
  }

  /* Returns & refunds: every request, newest first, and how to ask. */
  function requestsCard(host) {
    var on = requestsOn();
    var r = card('Returns and exchanges');
    var list = el('div', 'ac-list rq-list');
    r.appendChild(list);
    r.appendChild(el('p', 'ac-lead', on
      ? 'To cancel an order, return or exchange a piece, or tell us about a problem, open the order in My orders.'
      : 'Would you like to return or exchange a piece, or is something wrong with an order? ' +
        'Message us with your order number and we will arrange it with you.'));
    var acts = el('div', 'ac-actions');
    if (on) {
      var mo = pageLink('btn btn-gold btn-sm rq-orders', 'orders');
      mo.textContent = 'My orders';
      acts.appendChild(mo);
    }
    var ask = askLink('Hello, I would like to return or exchange a piece from my order ', 'Message us');
    if (ask) acts.appendChild(ask);
    r.appendChild(acts);
    host.appendChild(r);
    function fill(said) {
      myRequests().then(function (rows) {
        list.innerHTML = '';
        if (said) list.appendChild(el('p', 'ac-msg ok', said));
        rows.forEach(function (rq) { list.appendChild(requestRow(rq, { withOrder: true, after: fill })); });
        list.style.display = list.children.length ? '' : 'none';
        list.setAttribute('data-ready', 'yes');
      });
    }
    list.style.display = 'none';
    fill('');
  }

  /* ---- Recently viewed ---------------------------------------------------- */
  function drawRecent(host) {
    var cards = typeof renderHooks.recentCards === 'function' ? renderHooks.recentCards() : [];
    if (!cards || !cards.length) {
      var c = card('Nothing yet');
      c.appendChild(el('p', 'ac-quiet', 'Pieces you look at on this device show here, so you can find them again.'));
      var shop = el('a', 'btn btn-gold btn-sm');
      shop.textContent = 'Go to the shop';
      shop.href = BASE_PATH() + 'shop';
      shop.addEventListener('click', function (e) {
        if (typeof renderHooks.go !== 'function') return;
        e.preventDefault(); renderHooks.go('shop');
      });
      c.appendChild(shop);
      host.appendChild(c);
      return;
    }
    host.appendChild(el('p', 'ac-quiet pt-lead', 'Pieces you looked at on this device, the latest first.'));
    var grid = el('div', 'grid pt-recent');
    cards.forEach(function (n) { grid.appendChild(n); });
    host.appendChild(grid);
  }

  /* ---- Rewards & membership: the platform's, asked each time ------------- */
  function drawRewards(host) {
    host.appendChild(window.VBP_REWARDS.card());
  }

  /* ---- Customer support --------------------------------------------------- */
  function drawSupport(host) {
    var c = card('Message us');
    c.appendChild(el('p', 'ac-lead', 'Our team answers in the live chat, or on WhatsApp when the chat is closed.'));
    var acts = el('div', 'ac-actions');
    var ask = askLink('Hello, ', 'Message us');
    if (ask) acts.appendChild(ask);
    c.appendChild(acts);
    host.appendChild(c);

    if (!historyOn()) return;
    var o = card('About an order');
    var list = el('div', 'ac-list');
    o.appendChild(list);
    host.appendChild(o);
    myOrders().then(function (rows) {
      if (!rows.length) { list.appendChild(el('p', 'ac-quiet', 'Orders you place will be listed here, to ask about.')); return; }
      rows.slice(0, 5).forEach(function (x) {
        var row = el('div', 'ac-addr');
        var b = el('div');
        b.appendChild(el('div', 'ac-addr-l', x.ref || ''));
        b.appendChild(el('div', null, day(x.created_at) + ' · ' + stage(x).word));
        row.appendChild(b);
        var a = askLink('Hello, I have a question about my order ' + x.ref + '.', 'Ask about it');
        if (a) row.appendChild(a);
        list.appendChild(row);
      });
    });
  }

  /* ---- Notifications ------------------------------------------------------ */
  function drawNotifications(host) {
    var e = card('Emails about your orders');
    e.appendChild(el('p', 'ac-lead', 'We email the address given with each order: when you pay online, when it is on its ' +
      'way, before it is marked delivered, once it is delivered or collected, and when a refund is made.'));
    host.appendChild(e);

    var ch = card('Chat replies');
    ch.appendChild(el('p', 'ac-lead', 'In the chat window, the bell lets this device tell you when we reply.'));
    var acts = el('div', 'ac-actions');
    var open = askLink('', 'Open the chat');
    if (open) acts.appendChild(open);
    ch.appendChild(acts);
    host.appendChild(ch);

    if (newsletterOn()) {
      var n = card('Emails from ' + brandName());
      var line = el('p', 'ac-lead', 'Reading…');
      n.appendChild(line);
      var change = pageLink('ac-link', 'privacy');
      change.textContent = 'Change this';
      n.appendChild(change);
      host.appendChild(n);
      portalAsk('newsletter').then(function (b) {
        line.textContent = b.state === 'on'
          ? 'You receive our emails about new arrivals and offers, at ' + (b.email || api.user.email) + '.'
          : 'You do not receive our emails about new arrivals and offers.';
      }, function (er) { line.textContent = er.message; });
    }
  }

  /* ---- Password and authentication --------------------------------------- */
  function changePasswordChecked(current, next) {
    if (!sb || !api.user) return Promise.reject(new Error('Please sign in first.'));
    if (!current) return Promise.reject(new Error('Type the password you use now first.'));
    var bad = passwordProblem(next);
    if (bad) return Promise.reject(new Error(bad));
    if (current === next) return Promise.reject(new Error('Choose a password different from the one you use now.'));
    /* The password they use now is checked by signing in with it again,
       so a phone left signed in cannot have its password changed by
       whoever picks it up. */
    return Promise.resolve(sb.auth.signInWithPassword({ email: api.user.email, password: current })).then(function (r) {
      if (r && r.error) {
        if (/invalid login/i.test(String(r.error.message || ''))) throw new Error('That is not the password you use now.');
        throw r.error;
      }
      return sb.auth.updateUser({ password: next });
    }).then(function (r) {
      if (r && r.error) throw r.error;
      return true;
    });
  }

  function drawPassword(host) {
    var c = card('Change your password');
    c.appendChild(el('p', 'ac-quiet', 'Signed in as ' + api.user.email));
    var now = field(c, 'ac_curpw', 'The password you use now', 'password', '', 'current-password');
    var pw1 = field(c, 'ac_newpw', 'New password', 'password', '', 'new-password');
    var pw2 = field(c, 'ac_newpw2', 'Type the new one again', 'password', '', 'new-password');
    var rule = el('p', 'ac-rule', passwordRule());
    c.appendChild(rule);
    var msg = el('p', 'ac-msg');
    var go = el('button', 'btn btn-gold btn-sm', 'Change password');
    go.type = 'button';
    var row = el('div', 'ac-actions'); row.appendChild(go);
    c.appendChild(row); c.appendChild(msg);
    pw1.addEventListener('input', function () {
      var bad = pw1.value ? passwordProblem(pw1.value) : '';
      rule.textContent = bad || (pw1.value ? 'That will do.' : passwordRule());
      rule.className = 'ac-rule' + (pw1.value ? (bad ? ' bad' : ' ok') : '');
    });
    go.addEventListener('click', function () {
      if (pw1.value !== pw2.value) { say(msg, 'The two new passwords are not the same.', 'err'); pw2.focus(); return; }
      say(msg, 'Changing…', 'busy'); go.disabled = true;
      changePasswordChecked(now.value, pw1.value).then(function () {
        now.value = pw1.value = pw2.value = '';
        go.disabled = false;
        say(msg, 'Your password is changed ✓', 'ok');
      }, function (e) { go.disabled = false; say(msg, friendly(e), 'err'); });
    });
    c.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); go.click(); } });
    host.appendChild(c);

    var f = card('Forgotten the password you use now?');
    f.appendChild(el('p', 'ac-quiet', 'We email a link to ' + api.user.email + ' to choose a new one.'));
    var fm = el('p', 'ac-msg');
    var send = el('button', 'btn btn-outline btn-sm', 'Email me a link');
    send.type = 'button';
    send.addEventListener('click', function () {
      say(fm, 'Sending…', 'busy'); send.disabled = true;
      resetPassword(api.user.email).then(function () {
        say(fm, 'Sent. Check your inbox, and the spam folder.', 'ok');
      }, function (e) { send.disabled = false; say(fm, friendly(e), 'err'); });
    });
    var fr = el('div', 'ac-actions'); fr.appendChild(send);
    f.appendChild(fr); f.appendChild(fm);
    host.appendChild(f);
  }

  /* ---- Active devices and sessions --------------------------------------- */
  function drawSessions(host) {
    var c = card('This device');
    c.appendChild(el('p', 'ac-lead', 'You are signed in here as ' + api.user.email + '.'));
    var m1 = el('p', 'ac-msg');
    var here = el('button', 'btn btn-outline btn-sm pt-out-here', 'Sign out of this device');
    here.type = 'button';
    here.addEventListener('click', function () {
      here.disabled = true;
      signOut('local').then(function () { nav(''); render(host); });
    });
    var r1 = el('div', 'ac-actions'); r1.appendChild(here);
    c.appendChild(r1); c.appendChild(m1);
    host.appendChild(c);

    var o = card('Your other devices');
    o.appendChild(el('p', 'ac-lead', 'Signed in on a phone or computer that is not yours, or one you no longer have? ' +
      'Sign it out from here. Each device asks for your password again.'));
    o.appendChild(el('p', 'ac-quiet', 'A device that is open on the shop right now can stay signed in for up to an hour.'));
    var m2 = el('p', 'ac-msg');
    var others = el('button', 'btn btn-gold btn-sm pt-out-others', 'Sign out of my other devices');
    others.type = 'button';
    others.addEventListener('click', function () {
      others.disabled = true; say(m2, 'Signing them out…', 'busy');
      signOut('others').then(function (r) {
        others.disabled = false;
        say(m2, r && r.ok ? 'Done. Every other device is signed out; you are still signed in here.'
                          : 'That did not go through. Check your connection and try again.', r && r.ok ? 'ok' : 'err');
      });
    });
    var all = el('button', 'btn btn-outline btn-sm pt-out-all', 'Sign out everywhere');
    all.type = 'button';
    all.addEventListener('click', function () {
      all.disabled = true; say(m2, 'Signing out everywhere…', 'busy');
      signOut('global').then(function (r) {
        noteFor(r && r.ok ? 'You are signed out of every device.'
          : 'You are signed out here. Your other devices could not be reached just now: sign in, then try again.');
        nav(''); render(host);
      });
    });
    var r2 = el('div', 'ac-actions'); r2.appendChild(others); r2.appendChild(all);
    o.appendChild(r2); o.appendChild(m2);
    host.appendChild(o);
  }

  /* ---- Privacy and marketing preferences --------------------------------- */
  function drawPrivacy(host) {
    if (newsletterOn()) {
      var c = card('Emails about new arrivals and offers');
      var line = el('p', 'ac-lead', 'Reading…');
      c.appendChild(line);
      var msg = el('p', 'ac-msg');
      var acts = el('div', 'ac-actions');
      c.appendChild(acts); c.appendChild(msg);
      host.appendChild(c);
      var paint = function (b) {
        acts.innerHTML = '';
        var on = b.state === 'on';
        line.textContent = on ? 'You receive them, at ' + (b.email || api.user.email) + '.'
                              : 'You do not receive them.';
        var btn = el('button', 'btn btn-sm ' + (on ? 'btn-outline pt-nl-off' : 'btn-gold pt-nl-on'),
                     on ? 'Stop sending me these' : 'Send me these');
        btn.type = 'button';
        btn.addEventListener('click', function () {
          btn.disabled = true; say(msg, 'One moment…', 'busy');
          portalAsk('newsletter-set', { on: !on }).then(function (r) {
            if (r.state === 'confirm') {
              say(msg, 'You left this list before, so we have emailed you a link to confirm. Open it to start receiving them again.', 'ok');
              btn.disabled = false;
              return;
            }
            say(msg, r.state === 'on' ? 'Done: you will receive them.' : 'Done: we will not send them any more.', 'ok');
            paint(r);
          }, function (e) { btn.disabled = false; say(msg, e.message, 'err'); });
        });
        acts.appendChild(btn);
      };
      portalAsk('newsletter').then(paint, function (e) { line.textContent = e.message; });
    }

    var p = card('Your information');
    p.appendChild(el('p', 'ac-lead', 'How we look after what you give us, and why we keep it, is in our Privacy Policy. ' +
      'You can download everything we hold about you, or close your account, at any time.'));
    var row = el('div', 'ac-actions');
    var pol = el('a', 'btn btn-outline btn-sm');
    pol.textContent = 'Read the Privacy Policy';
    pol.href = typeof renderHooks.privacyHref === 'function' ? renderHooks.privacyHref() : '/policies/privacy-policy';
    pol.target = '_blank'; pol.rel = 'noopener';
    row.appendChild(pol);
    var dl = pageLink('btn btn-outline btn-sm', 'data');
    dl.textContent = 'Download my data';
    row.appendChild(dl);
    p.appendChild(row);
    host.appendChild(p);
  }

  /* ---- Download my personal data ----------------------------------------- */
  function drawData(host) {
    var c = card('A copy of everything we hold about you');
    c.appendChild(el('p', 'ac-lead', 'One file with your account, details, addresses, orders, payments, refunds, ' +
      'newsletter choice, chats with us and your rewards link, and your points as our business platform has them now.'));
    c.appendChild(el('p', 'ac-quiet', 'The file is in JSON, a plain text format any computer can open. Card numbers are ' +
      'never in it: they are never kept by us, only by the payment service.'));
    var msg = el('p', 'ac-msg');
    var go = el('button', 'btn btn-gold btn-sm pt-data', 'Download my data');
    go.type = 'button';
    go.addEventListener('click', function () {
      go.disabled = true; say(msg, 'Gathering it…', 'busy');
      myData().then(function (d) {
        saveFile(JSON.stringify(d, null, 2), 'application/json',
                 brandName() + '-my-data-' + new Date().toISOString().slice(0, 10) + '.json');
        go.disabled = false;
        say(msg, 'Downloaded ✓', 'ok');
      }, function (e) { go.disabled = false; say(msg, e.message, 'err'); });
    });
    var row = el('div', 'ac-actions'); row.appendChild(go);
    c.appendChild(row); c.appendChild(msg);
    host.appendChild(c);
  }
  /* The website's records, from the function; the points, from the
     platform, as the account page shows them; and what this device keeps
     for itself (the wishlist and the pieces looked at). */
  function myData() {
    return portalAsk('data').then(function (d) {
      var R = window.VBP_REWARDS;
      var pts = rewardsOn() ? R.status(true).then(function (s) { return s; }, function () { return null; }) : Promise.resolve(null);
      return pts.then(function (s) {
        if (s && s.linked && !s.unavailable && !s.missing) {
          d.rewards = d.rewards || {};
          d.rewards.points = { points: s.points, worth: s.worth, asOf: new Date().toISOString(),
                               from: 'the business platform, which keeps the points' };
        }
        d.thisDevice = {
          wishlist: typeof renderHooks.wishlist === 'function' ? (renderHooks.wishlist() || []).slice() : [],
          recentlyViewed: typeof renderHooks.recentSkus === 'function' ? (renderHooks.recentSkus() || []).slice() : []
        };
        return d;
      });
    });
  }
  function saveFile(text, type, name) {
    var blob = new Blob([text], { type: type });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name.replace(/[^0-9A-Za-z._-]+/g, '-'); a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 4000);
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
        /* BUILD 86 · said on the dashboard, which is drawn next. */
        noteFor('Your new password is saved ✓');
        render(host);
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

    var row = el('div', 'ac-actions');
    row.appendChild(save);
    /* BUILD 86 · the password has a page of its own, which asks for the one
       in use first. */
    if (passwordOn()) {
      var pwBtn = pageLink('ac-link', 'password');
      pwBtn.textContent = 'Change password';
      row.appendChild(pwBtn);
    }
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
      deleteAccount().then(function () { nav(''); render(host); },
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
    askMoreTime: askMoreTime,

    /* BUILD 86 · the customer portal */
    stage: stage,
    journey: journey,
    pages: function () { return Object.keys(PAGES); }
  };
})();
