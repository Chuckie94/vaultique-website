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
    addresses: []
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

  function signUp(email, password, name) {
    if (!sb) return Promise.reject(new Error('Accounts are not available.'));
    if (!canRegister()) return Promise.reject(new Error('New accounts are closed at the moment.'));
    var bad = passwordProblem(password);
    if (bad) return Promise.reject(new Error(bad));

    return sb.auth.signUp({
      email: String(email || '').trim(),
      password: password,
      options: { data: { name: String(name || '').trim() } }
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
    return sb.auth.resetPasswordForEmail(String(email || '').trim(), {
      redirectTo: location.origin + location.pathname + '#/account'
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
     A customer can always erase what identifies them. Their auth user
     cannot be removed from the browser - that needs a service key, which
     no browser may ever hold - so the profile and addresses go, the
     orders keep their content but lose their owner, and the shop is told
     to finish the job. Saying that plainly is better than a button that
     quietly does half of it. */
  function deleteAccount() {
    if (!sb || !api.user) return Promise.reject(new Error('Please sign in first.'));
    if (api.settings && api.settings.accountDeletion === false) {
      return Promise.reject(new Error('Please message us to close your account.'));
    }
    var id = api.user.id;
    return sb.from('customer_addresses').delete().eq('customer_id', id)
      .then(function () { return sb.from('orders').update({ customer_id: null }).eq('customer_id', id); })
      .then(function () { return sb.from('customers').delete().eq('id', id); })
      .then(function () { return signOut(); })
      .then(function () { return true; });
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

  /* Written through place_order() in the database rather than by
     inserting here, because a guest cannot do it from this side.
     `or_insert` lets the row in, but PostgreSQL applies the table's
     SELECT policies to anything an insert RETURNs, and asking for the
     new row's id — which the lines need — made the whole insert fail
     for anyone not signed in. The lines were refused as well:
     `oi_insert` asks whether the order exists, and that question is
     answered under the caller's own reading rights, which show a guest
     nothing. One call to a function that has the standing to do it
     settles both, and writes the order and its lines together, so the
     Orders tab never shows half of one.

     The reference is made in there too, so two people pressing Continue
     in the same second cannot land on the same one.

     Recorded whether or not customer accounts are switched on. This is
     the shop's own record of what was asked for; `orderHistory` is a
     setting about what an ACCOUNT holds, and it still governs whether a
     customer is shown their own, in myOrders() below. */
  function recordOrder(order) {
    var payload = {
      p_order: {
        name: order.name || null, phone: order.phone || null,
        email: order.email || null, address: order.address || null,
        notes: order.notes || null,
        fulfilment: order.fulfilment === 'collection' ? 'collection' : 'delivery',
        total: (order.total === undefined || order.total === null) ? null : Number(order.total),
        currency: order.currency || null
      },
      p_items: (order.items || []).map(function (it) {
        return { sku: it.sku || null, name: it.name || null,
                 price: (it.price === undefined ? null : Number(it.price)),
                 qty: it.qty || 1 };
      })
    };

    function answer(d) {
      if (d && d.id) return { id: d.id, ref: d.ref };
      return { error: new Error('The order was not recorded.') };
    }
    function lost(e) { return { error: e }; }

    /* With a client, because it carries the session: an order placed by
       somebody signed in has to be filed under them, and auth.uid()
       inside the function is what does that. */
    if (sb) {
      return sb.rpc('place_order', payload).then(function (r) {
        if (r && r.error) return lost(r.error);
        return answer(r && r.data);
      }, lost);
    }

    /* Without one, because a shop with accounts switched off never
       downloads it — and those orders are still the shop's to keep. The
       storefront hands over the same call made plainly, the way reviews
       and the newsletter already go. Nobody can be signed in without a
       client, so this path is always a guest and the function files it
       as one. */
    var direct = renderHooks.placeOrder;
    if (!direct) return Promise.resolve(null);
    return Promise.resolve().then(function () { return direct(payload); }).then(answer, lost);
  }

  function myOrders() {
    if (!sb || !signedIn() || !historyOn()) return Promise.resolve([]);
    var q = sb.from('orders')
      .select('id, ref, status, total, currency, fulfilment, created_at, order_items(sku, name, price, qty)')
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
    return q.then(function (r) { return (r && r.data) || []; }, function () { return []; });
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
    wrap.appendChild(l); wrap.appendChild(i);
    return i;
  }

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
        }, function (e) { say(msg, friendly(e), 'err'); });
      });
      forgot.addEventListener('click', function () {
        if (!email.value.trim()) { say(msg, 'Enter your email address first.', 'err'); email.focus(); return; }
        say(msg, 'Sending…', 'busy');
        resetPassword(email.value).then(function () {
          say(msg, 'Check your inbox for a link to set a new password.', 'ok');
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
            body.appendChild(el('p', 'ac-lead',
              'We have sent a link to ' + email.value.trim() +
              '. Click it to confirm your address, then sign in.'));
            return;
          }
          render(host);
        }, function (e) { say(msg, friendly(e), 'err'); });
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
    if (/email not confirmed/.test(m)) return 'Please confirm your email address first — check your inbox.';
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

    if (needsVerifiedEmail() && !api.user.emailConfirmed) {
      var warn = el('div', 'ac-warn');
      warn.textContent = 'Your email address is not confirmed yet, so you cannot check out. ' +
                         'Check your inbox for the link we sent to ' + api.user.email + '.';
      host.appendChild(warn);
    }

    host.appendChild(detailsCard(host));
    if (api.settings.savedAddresses !== false) host.appendChild(addressCard());
    if (historyOn()) host.appendChild(ordersCard());
    if (api.settings.accountDeletion !== false) host.appendChild(dangerCard(host));
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

    myOrders().then(function (rows) {
      list.innerHTML = '';
      if (!rows.length) {
        list.appendChild(el('p', 'ac-quiet', 'Nothing yet. Orders you place will appear here.'));
        return;
      }
      rows.forEach(function (o) {
        var row = el('div', 'ac-order');
        var top = el('div', 'ac-order-top');
        top.appendChild(el('span', 'ac-ref', o.ref || ''));
        var st = el('span', 'ac-status is-' + (o.status || 'pending'));
        st.textContent = (o.status || 'pending').charAt(0).toUpperCase() + (o.status || 'pending').slice(1);
        top.appendChild(st);
        row.appendChild(top);

        var when = el('div', 'ac-quiet');
        when.textContent = (renderHooks.date ? renderHooks.date(o.created_at) : '') +
          (o.fulfilment === 'collection' ? ' · for collection' : ' · for delivery');
        row.appendChild(when);

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
        list.appendChild(row);
      });
    });
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

    deleteAccount: deleteAccount
  };
})();
