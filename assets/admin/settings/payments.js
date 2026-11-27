/* =====================================================================
   Vaultique Boutique Point - Admin > Settings > Payments
   ---------------------------------------------------------------------
   Which ways of paying the shop accepts, what each is called, what
   customers are told about it, and the account details behind it.

   The methods, and why they are these methods
   -------------------------------------------
   Airtel Money and MTN Money are both mobile money, so they are not
   separate payment methods here: Mobile Money is one method holding as
   many accounts as the shop has, each with its provider, number and
   account name. Adding Zamtel Kwacha later is adding a row.

   Cash and Payment on Delivery overlap but are not the same. Cash is
   paying in person at the shop. Payment on delivery is paying whoever
   brings the order. A shop may accept one and not the other.

   What is public and what is not
   ------------------------------
   The website reads its settings with the anon key, so everything in the
   ordinary settings table can be read by anyone. Which methods are
   accepted, what they are called and the instructions customers see are
   all meant to be public and live there.

   Account numbers do not. Bank details and mobile money numbers are kept
   in site_settings_private, which has no public read policy at all, so
   they never reach a customer's browser. They are marked private below
   and the form saves them to the other table on their own.

   Because instructions are public, the section checks them for anything
   that looks like an account number and says so, since that would put
   back exactly what the private table is for.

   Online payment and its gateways (build 88)
   ------------------------------------------
   Customers choose a way of paying (Mobile Money, Debit / Credit Card,
   and Instant Bank Transfer once a gateway offers one), never a gateway.
   Each gateway has its own switch here, off until the shop switches it
   on: Lenco, the primary gateway for Zambia, and Flutterwave, kept for
   when its merchant account is approved. Lenco offers only what the shop
   has ticked as activated on its Lenco account. The keys stay in Netlify;
   this page only says whether each is there, and can ask the gateway
   whether it accepts it. Payment activity, under the gateways, reads the
   payments, Lenco's notices and the record of changes to this page,
   administrators only.

   The layby estimate
   ------------------
   A deposit percentage and a number of months, public because the
   product page reads them to show an estimate under the price
   (assets/layby.js). Display only: nothing on the website starts a
   layby, and layby itself is still arranged with the shop.
   ===================================================================== */
(function () {
  'use strict';
  if (!window.VBP_ADMIN) return;

  var A = window.VBP_ADMIN;

  var PROVIDERS = [
    { value: 'Airtel Money', label: 'Airtel Money' },
    { value: 'MTN Money',    label: 'MTN Money' },
    { value: 'Zamtel Kwacha', label: 'Zamtel Kwacha' },
    { value: 'Other',        label: 'Other' }
  ];

  var DEFAULTS = {
    cashEnabled: true,
    cashName: 'Cash',
    cashInstructions: 'Pay in person when you collect.',

    bankEnabled: true,
    bankName: 'Bank Transfer',
    bankInstructions: 'Transfer before dispatch. We will send the account details on WhatsApp.',

    mobileEnabled: true,
    mobileName: 'Mobile Money',
    mobileInstructions: 'Send to our mobile money account. We will confirm the number on WhatsApp.',

    cardEnabled: false,
    cardName: 'Card Payment',
    cardInstructions: 'Card payment can be arranged in person at the shop.',

    // Online payment through Flutterwave. Off until the shop is ready.
    onlineEnabled: false,
    onlineMode: 'test',
    onlineCard: true,
    onlineMobile: true,
    onlineLabel: '',
    onlineConfirmEmail: true,
    onlineNotifyShop: true,

    // Build 88: each gateway off until switched on. Lenco offers only what is
    // ticked as activated on the shop's Lenco account.
    lencoEnabled: false,
    lencoAirtel: false,
    lencoMtn: false,
    lencoZamtel: false,
    lencoCard: false,
    flwEnabled: false,

    codEnabled: false,
    codName: 'Payment on Delivery',
    codInstructions: 'Pay the courier when your order arrives.',

    // The layby estimate under the price on each product page. Display
    // only: assets/layby.js does the arithmetic and nothing else.
    laybyDeposit: 30,
    laybyMonths: 6,

    // kept out of the website's reach
    bankAccountBank: '',
    bankAccountName: '',
    bankAccountNumber: '',
    bankBranch: '',
    bankBranchCode: '',
    mobileAccounts: []
  };

  var PRIVATE = ['bankAccountBank', 'bankAccountName', 'bankAccountNumber',
                 'bankBranch', 'bankBranchCode', 'mobileAccounts'];

  A.store.registerDefaults('payments', DEFAULTS);

  /* Instructions are shown on the website. A run of digits long enough to
     be an account number almost certainly should not be. */
  function noAccountNumbers(v) {
    if (!v) return '';
    var run = String(v).replace(/[\s-]/g, '');
    return /\d{7,}/.test(run)
      ? 'That looks like an account number. Those belong in the private details ' +
        'further down, which the website never sees. Anything written here is public.'
      : '';
  }

  function method(prefix, label, note) {
    return [
      { type: 'toggle', name: prefix + 'Enabled', label: 'Accept ' + label.toLowerCase(),
        hint: note },
      { type: 'text', name: prefix + 'Name', label: 'Shown to customers as', half: true,
        maxLength: 40, showIf: on(prefix),
        validate: function (v, all) {
          return (all[prefix + 'Enabled'] && !v) ? 'Give this method a name.' : '';
        } },
      { type: 'text', name: prefix + 'Instructions', label: 'What customers are told',
        maxLength: 200, showIf: on(prefix), validate: noAccountNumbers,
        hint: 'Public. Keep account numbers out of it.' }
    ];
  }
  function on(prefix) {
    return function (v) { return !!v[prefix + 'Enabled']; };
  }

  /* What the readiness check found beyond "installed or not": a key that
     is the wrong one of the three on Flutterwave's API keys page, and
     whether Flutterwave's webhook is getting through. */
  function healthLines(c) {
    var out = [];
    var when = function (iso) {
      var d = new Date(iso);
      return isNaN(d.getTime()) ? iso : d.toLocaleString();
    };
    if (c.test && c.testKeyLooksRight === false) {
      out.push({ warn: true, text: 'The test key does not look like a Flutterwave secret key: it should ' +
        'start FLWSECK_TEST-. The public key and the encryption key are on the same page; it is the ' +
        'Secret key that goes in Netlify.' });
    }
    if (c.live && c.liveKeyLooksRight === false) {
      out.push({ warn: true, text: 'The live key does not look like a Flutterwave secret key: it should ' +
        'start FLWSECK- (and not FLWSECK_TEST-).' });
    }
    /* The webhook times are only told to a signed-in administrator. Not
       told is not the same as "none yet", so nothing is said. */
    if (!('lastWebhookAt' in c)) return out;
    if (c.lastWebhookAt) {
      out.push({ text: 'Flutterwave last reached the webhook ' + when(c.lastWebhookAt) + '.' });
    } else if (c.hash) {
      out.push({ text: 'No webhook from Flutterwave yet. After your first test payment, the time it ' +
        'arrived shows here.' });
    }
    if (c.lastRefusedAt && (!c.lastWebhookAt || c.lastRefusedAt > c.lastWebhookAt)) {
      /* Anybody can call the webhook address, so this cannot be sure it
         was Flutterwave; it says so. */
      out.push({ warn: true, text: 'A webhook arrived ' + when(c.lastRefusedAt) + ' with a secret hash ' +
        'that does not match, so it was ignored. If that was Flutterwave, the secret hash in Flutterwave ' +
        '(Settings > Webhooks) must be exactly the same as FLW_WEBHOOK_HASH in Netlify. Payments still ' +
        'go through: the site checks with Flutterwave every fifteen minutes.' });
    }
    return out;
  }

  /* The administrator's own sign-in, for the questions only an
     administrator may ask the payment service. '' when there is none. */
  function adminToken() {
    var sb = A.sb;
    return Promise.resolve(sb && sb.auth ? sb.auth.getSession() : null).then(function (r) {
      return (r && r.data && r.data.session && r.data.session.access_token) || '';
    }, function () { return ''; });
  }

  /* Asks Flutterwave whether it accepts the installed keys. Nothing is
     created or charged; it is the same "where is this payment?" question
     the site asks after every payment, about one that does not exist. */
  function keyCheck() {
    var wrap = document.createElement('div');
    wrap.className = 'pay-ready-note';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-out btn-sm';
    btn.textContent = 'Check the keys with Flutterwave';
    var said = document.createElement('span');
    said.className = 'pay-key-said';
    wrap.appendChild(btn);
    wrap.appendChild(said);
    var words = { accepted: 'accepted ✓', refused: 'refused ✕ — copy the Secret key again',
                  missing: 'not installed', unreachable: 'Flutterwave could not be reached just now',
                  unclear: 'no clear answer' };
    btn.addEventListener('click', function () {
      btn.disabled = true;
      said.textContent = ' Asking Flutterwave…';
      adminToken().then(function (t) {
        return fetch('/.netlify/functions/pay-status?check=1', {
          method: 'POST', cache: 'no-store',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (t || '') },
          body: JSON.stringify({ action: 'test-keys' })
        });
      }).then(function (res) {
        return res.json().then(function (j) { j._code = res.status; return j; });
      }).then(function (j) {
        btn.disabled = false;
        if (j._code !== 200) { said.textContent = ' ' + (j.error || 'Flutterwave could not be asked just now.'); return; }
        said.textContent = ' Test key: ' + (words[j.test] || j.test) + ' · Live key: ' + (words[j.live] || j.live);
      }, function () {
        btn.disabled = false;
        said.textContent = ' Flutterwave could not be asked just now.';
      });
    });
    return wrap;
  }

  /* ---- BUILD 88 · Lenco's section, and the payment activity ------------- */
  function findCard(host, title, cb) {
    var tries = 0;
    (function look() {
      var cards = host.querySelectorAll('.card');
      for (var i = 0; i < cards.length; i++) {
        var h = cards[i].querySelector('h3');
        if (h && h.textContent === title) { cb(cards[i]); return; }
      }
      if (tries++ < 60) setTimeout(look, 50);
    })();
  }
  function whenIs(iso) {
    var d = new Date(iso);
    return isNaN(d.getTime()) ? String(iso || '') : d.toLocaleString();
  }
  function noteLine(parent, text, warn, cls) {
    var n = document.createElement('div');
    n.className = (cls || 'lenco-ready-note') + (warn ? ' lenco-ready-warn' : '');
    n.textContent = text;
    parent.appendChild(n);
    return n;
  }

  /* Whether Lenco can take payments: each key there or not (never a value),
     the database file, when Lenco last reached its webhook, anything that
     reached it unsigned, Lenco's last error, and a button that asks Lenco
     whether it accepts the tokens, charging nothing. */
  function lencoReady(host, c) {
    findCard(host, 'Lenco', function (box) {
      var old = box.querySelector('.lenco-ready');
      if (old) old.parentNode.removeChild(old);
      var line = document.createElement('div');
      line.className = 'lenco-ready';
      var h3 = box.querySelector('h3');
      h3.parentNode.insertBefore(line, h3.nextSibling);
      if (!c) { noteLine(line, 'Lenco’s setup could not be checked from here.'); return; }
      var ls = c.lencoSetup;
      if (!ls) {
        noteLine(line, (c.lenco && (c.lenco.live || c.lenco.test))
          ? 'Lenco’s keys are in Netlify.' : 'Lenco’s keys are not in Netlify yet. SETUP.md has the steps.');
        return;
      }
      [[ls.live.secret, 'Live API token'], [ls.live.public, 'Live public key'],
       [ls.test.secret, 'Sandbox API token'], [ls.test.public, 'Sandbox public key'],
       [ls.test.base, 'Sandbox API address'], [c.lencoDb === true, 'Database (supabase-lenco.sql)']]
        .forEach(function (b) {
          var s2 = document.createElement('span');
          s2.className = b[0] ? 'ok' : 'no';
          s2.textContent = (b[0] ? '✓ ' : '✕ ') + b[1];
          line.appendChild(s2);
        });
      var db = c.lencoDb === true;
      var live = db && ls.live.mobile, test = db && ls.test.mobile;
      noteLine(line, !db
        ? 'Not ready: run supabase-lenco.sql in the website’s Supabase (SQL Editor). Until then Lenco is not offered.'
        : live && test ? 'Ready for Test and Live payments. The keys live in Netlify and are never shown here.'
        : live ? 'Ready for Live payments. Test mode also needs the sandbox token and the sandbox API address.'
        : test ? 'Ready for Test payments only. Live needs LENCO_SECRET_KEY_LIVE and LENCO_PUBLIC_KEY_LIVE in Netlify.'
        : 'Not ready yet: add Lenco’s keys in Netlify > Site configuration > Environment variables, then ' +
          'redeploy. SETUP.md has the steps.');
      if ((ls.live.secret && !ls.live.public) || (ls.test.secret && !ls.test.public)) {
        noteLine(line, 'Cards need the public key as well as the API token (LENCO_PUBLIC_KEY_LIVE, ' +
                       'LENCO_PUBLIC_KEY_TEST). Mobile money works without it.', true);
      }
      noteLine(line, 'Webhook address to give Lenco: ' + location.origin + '/.netlify/functions/lenco-webhook');
      if (c.lencoLastWebhookAt) noteLine(line, 'Lenco last reached the webhook ' + whenIs(c.lencoLastWebhookAt) + '.');
      else if (ls.live.secret || ls.test.secret) {
        noteLine(line, 'No notice from Lenco yet. After your first payment, the time it arrived shows here.');
      }
      if (c.lencoLastRefusedAt && (!c.lencoLastWebhookAt || c.lencoLastRefusedAt > c.lencoLastWebhookAt)) {
        noteLine(line, 'A call reached the Lenco webhook ' + whenIs(c.lencoLastRefusedAt) + ' without a valid ' +
          'signature, so it was ignored (' + (c.lencoRefused || 1) + ' so far). If that was Lenco, the API token ' +
          'in Netlify must be the one your Lenco account signs with. Payments still go through: the site asks ' +
          'Lenco itself every fifteen minutes.', true);
      }
      if (c.lencoLastError) {
        noteLine(line, 'Lenco’s last error, ' + whenIs(c.lencoLastErrorAt) + ': ' + c.lencoLastError, true);
      }
      if (!(ls.live.secret || ls.test.secret)) return;
      var wrap = document.createElement('div');
      wrap.className = 'lenco-ready-note';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-out btn-sm';
      btn.textContent = 'Check the keys with Lenco';
      var said = document.createElement('span');
      said.className = 'lenco-key-said';
      wrap.appendChild(btn);
      wrap.appendChild(said);
      line.appendChild(wrap);
      var words = { accepted: 'accepted ✓', refused: 'refused ✕ — copy the API token again',
                    missing: 'not installed', 'no-address': 'no sandbox address (LENCO_API_BASE_TEST)',
                    unreachable: 'Lenco could not be reached just now', unclear: 'no clear answer' };
      btn.addEventListener('click', function () {
        btn.disabled = true;
        said.textContent = ' Asking Lenco…';
        adminToken().then(function (t) {
          return fetch('/.netlify/functions/pay-status?check=1', {
            method: 'POST', cache: 'no-store',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (t || '') },
            body: JSON.stringify({ action: 'test-keys' })
          });
        }).then(function (res) {
          return res.json().then(function (j) { j._code = res.status; return j; });
        }).then(function (j) {
          btn.disabled = false;
          if (j._code !== 200) { said.textContent = ' ' + (j.error || 'Lenco could not be asked just now.'); return; }
          said.textContent = ' Sandbox token: ' + (words[j.lencoTest] || j.lencoTest || '—') +
                             ' · Live token: ' + (words[j.lencoLive] || j.lencoLive || '—');
        }, function () {
          btn.disabled = false;
          said.textContent = ' Lenco could not be asked just now.';
        });
      });
    });
  }

  /* PAYMENT ACTIVITY: the latest online payments (waiting, failed, needing
     attention), Lenco's notices, the fifteen-minute check-up and the
     gateways' errors, and every change to this page. Read with the
     administrator's own sign-in: the database decides who may see it. */
  var NET_NAME = { airtel: 'Airtel Money', mtn: 'MTN MoMo', zamtel: 'Zamtel Kwacha' };
  function payWords(p) {
    var d = p.detail || {};
    if (p.status === 'paid') return 'Paid';
    if (p.status === 'review') return d.duplicate ? 'Paid twice: refund one' : 'Needs attention';
    if (p.status === 'failed') return 'Failed';
    if (p.status === 'expired') return 'Not completed';
    if (p.status === 'started') {
      if (p.provider_status === 'pay-offline') return 'Waiting for approval on the phone';
      if (p.provider_status === 'no-answer') return 'Waiting: Lenco did not answer at first';
      return 'Waiting';
    }
    return p.status || '';
  }
  function payRow(p) {
    var r = document.createElement('div');
    r.className = 'pay-act-row';
    var d = p.detail || {};
    var way = (p.method === 'card' || p.channel === 'card') ? 'Card'
      : 'Mobile Money' + (p.network && NET_NAME[p.network] ? ' · ' + NET_NAME[p.network] : '');
    var gw = p.provider === 'lenco' ? 'Lenco' : 'Flutterwave';
    var amt = (p.currency || '') + ' ' + Number(p.amount || 0).toFixed(2);
    var ref = String(p.tx_ref || '').split('-').slice(0, 2).join('-');
    var top = document.createElement('div');
    top.className = 'pay-act-top';
    top.textContent = whenIs(p.created_at) + ' · ' + ref + ' · ' + amt + ' · ' + way + ' · ' + gw +
                      (p.mode === 'test' ? ' · TEST' : '');
    var st = document.createElement('div');
    st.className = 'pay-act-st pay-act-' + (p.status || 'x');
    st.textContent = payWords(p) +
      (p.failure_reason ? ' · ' + p.failure_reason : (d.why ? ' · ' + d.why : '')) +
      (p.provider_ref || d.lenco_ref || d.flw_ref ? ' · ' + gw + ' ref ' + (p.provider_ref || d.lenco_ref || d.flw_ref) : '') +
      (p.verified_at ? ' · last asked ' + whenIs(p.verified_at) : '');
    r.appendChild(top);
    r.appendChild(st);
    return r;
  }
  function activity(host, c) {
    findCard(host, 'Flutterwave', function (flw) {
      if (host.querySelector('.pay-act')) return;
      var card = document.createElement('div');
      card.className = 'card pay-act';
      var h = document.createElement('h3');
      h.textContent = 'Payment activity';
      var n = document.createElement('p');
      n.className = 'grp-note';
      n.textContent = 'The latest online payments, the notices Lenco sent, the fifteen-minute check-up, the ' +
                      'gateways’ errors, and every change to this page. Administrators only.';
      card.appendChild(h);
      card.appendChild(n);
      var tabs = document.createElement('div');
      tabs.className = 'pay-act-tabs';
      tabs.setAttribute('role', 'tablist');
      var list = document.createElement('div');
      list.className = 'pay-act-list';
      card.appendChild(tabs);
      card.appendChild(list);
      flw.parentNode.insertBefore(card, flw.nextSibling);

      var sb = A.sb;
      var got = { pays: null, hooks: null, audit: null, payErr: '', hookErr: '', auditErr: '' };
      var read = function (q) {
        return Promise.resolve(q).then(function (r) {
          if (r && r.error) throw r.error;
          return (r && r.data) || [];
        });
      };
      var notYet = 'Not recorded yet. It starts once supabase-lenco.sql has been run.';
      var loads = !(sb && sb.from) ? Promise.resolve() : Promise.all([
        read(sb.from('payments').select('*').order('created_at', { ascending: false }).limit(60))
          .then(function (x) { got.pays = x; }, function (e) { got.payErr = 'Payments could not be read: ' + ((e && e.message) || 'not allowed'); }),
        read(sb.from('payment_webhooks').select('*').order('at', { ascending: false }).limit(30))
          .then(function (x) { got.hooks = x; }, function () { got.hookErr = notYet; }),
        read(sb.from('payment_settings_audit').select('*').order('at', { ascending: false }).limit(20))
          .then(function (x) { got.audit = x; }, function () { got.auditErr = notYet; })
      ]);
      var since3h = Date.now() - 3 * 3600000, since7d = Date.now() - 7 * 86400000;
      var pick = function (fn) { return (got.pays || []).filter(fn); };
      var TABS = [
        { k: 'recent', t: 'Recent', draw: function () { return pays(got.pays); } },
        { k: 'waiting', t: 'Waiting', draw: function () {
          return pays(pick(function (p) { return p.status === 'started' && Date.parse(p.created_at) > since3h; }),
                      'No payment is waiting.'); } },
        { k: 'failed', t: 'Failed', draw: function () {
          return pays(pick(function (p) { return (p.status === 'failed' || p.status === 'expired') && Date.parse(p.created_at) > since7d; }),
                      'No failed payment in the last seven days.'); } },
        { k: 'review', t: 'Needs attention', draw: function () {
          return pays(pick(function (p) { return p.status === 'review'; }), 'Nothing needs attention.'); } },
        { k: 'notices', t: 'Notices', draw: hooks },
        { k: 'checkup', t: 'Check-up & errors', draw: checkup },
        { k: 'changes', t: 'Changes', draw: changes }
      ];
      function pays(rows, empty) {
        if (got.payErr) return [txt(got.payErr)];
        if (!rows || !rows.length) return [txt(empty || 'No online payment yet.')];
        return rows.slice(0, 25).map(payRow);
      }
      function txt(t) { var e = document.createElement('div'); e.className = 'pay-act-empty'; e.textContent = t; return e; }
      function line(top, st, cls) {
        var r = document.createElement('div');
        r.className = 'pay-act-row';
        var a = document.createElement('div'); a.className = 'pay-act-top'; a.textContent = top;
        var b = document.createElement('div'); b.className = 'pay-act-st' + (cls ? ' ' + cls : ''); b.textContent = st;
        r.appendChild(a); r.appendChild(b);
        return r;
      }
      function hooks() {
        if (got.hookErr) return [txt(got.hookErr)];
        if (!got.hooks || !got.hooks.length) return [txt('No notice from Lenco yet.')];
        return got.hooks.map(function (w) {
          return line(whenIs(w.at) + ' · ' + (w.provider === 'lenco' ? 'Lenco' : w.provider) + ' · ' + w.event +
                      (w.mode === 'test' ? ' · TEST' : ''),
                      (w.reference ? String(w.reference).split('-').slice(0, 2).join('-') + ' · ' : '') +
                      'the site asked Lenco: ' + (w.outcome || '—'),
                      w.outcome === 'error' ? 'pay-act-failed' : '');
        });
      }
      function checkup() {
        var out = [];
        if (!c || !('reconcileAt' in c)) return [txt('The check-up’s record is shown to administrators only.')];
        var rc = c.reconcile || {};
        out.push(c.reconcileAt
          ? line('The fifteen-minute check-up last ran ' + whenIs(c.reconcileAt),
                 'Asked about ' + (rc.checked || 0) + ', found paid ' + (rc.paid || 0) + ', failed ' + (rc.failed || 0) +
                 ', needing attention ' + (rc.review || 0) + ', orders caught up ' + (rc.repaired || 0) + '.')
          : txt('The fifteen-minute check-up has not recorded a run yet.'));
        if (c.lencoLastError) out.push(line('Lenco’s last error, ' + whenIs(c.lencoLastErrorAt), c.lencoLastError, 'pay-act-failed'));
        if (c.lencoLastRefusedAt) {
          out.push(line('Unsigned calls to the Lenco webhook: ' + (c.lencoRefused || 0),
                        'The last ' + whenIs(c.lencoLastRefusedAt) + '. Ignored, and nothing changed.', 'pay-act-failed'));
        }
        if (c.lastRefusedAt) {
          out.push(line('Flutterwave webhook with the wrong hash', 'The last ' + whenIs(c.lastRefusedAt) + '. Ignored.', 'pay-act-failed'));
        }
        if (out.length === 1 && c.reconcileAt) out.push(txt('No gateway error recorded.'));
        return out;
      }
      function changes() {
        if (got.auditErr) return [txt(got.auditErr)];
        if (!got.audit || !got.audit.length) return [txt('No change recorded yet.')];
        return got.audit.map(function (a) {
          var what = a.which === 'private'
            ? 'Private details changed: ' + (Array.isArray(a.changed) ? a.changed.join(', ') : '')
            : Object.keys(a.changed || {}).map(function (k) {
                var v = a.changed[k] || [];
                var f = function (x) { return x === null || x === undefined ? '—' : (typeof x === 'object' ? JSON.stringify(x) : String(x)); };
                return k + ': ' + f(v[0]) + ' → ' + f(v[1]);
              }).join(' · ');
          return line(whenIs(a.at) + ' · ' + (a.by_email || 'the database'), what);
        });
      }
      var on = 'recent';
      function draw() {
        tabs.innerHTML = '';
        TABS.forEach(function (t) {
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'pay-act-tab' + (t.k === on ? ' on' : '');
          b.setAttribute('role', 'tab');
          b.setAttribute('aria-selected', t.k === on ? 'true' : 'false');
          b.textContent = t.t;
          b.addEventListener('click', function () { on = t.k; draw(); });
          tabs.appendChild(b);
        });
        list.innerHTML = '';
        var t = TABS.filter(function (x) { return x.k === on; })[0];
        (t.draw() || []).forEach(function (e) { list.appendChild(e); });
      }
      list.appendChild(txt('Loading…'));
      loads.then(draw, draw);
    });
  }

  /* More than nothing and no more than the whole price, to a hundredth of
     a percent: 12.5% is a deposit, 12.555% is a slip of the finger. */
  function depositOk(v) {
    if (v === '' || v === null || v === undefined) return '';   // "required" says so
    var n = Number(v);
    if (!isFinite(n)) return 'Enter a percentage, for example 30.';
    if (n <= 0) return 'The deposit must be more than 0%.';
    if (n > 100) return 'The deposit cannot be more than 100%.';
    if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return 'Use at most two decimal places.';
    return '';
  }
  /* Whole months only: a layby is paid month by month. */
  function monthsOk(v) {
    if (v === '' || v === null || v === undefined) return '';
    var n = Number(v);
    if (!isFinite(n) || n < 1 || Math.floor(n) !== n) return 'Enter a whole number of months, 1 or more.';
    if (n > 120) return 'Cannot be more than 120 months.';
    return '';
  }

  A.registerSetting({
    key: 'payments',
    title: 'Payments',
    summary: 'Accepted payment methods and the payment instructions customers see.',
    render: function (host, ctx) {
      ctx.ui.form(host, {
        key: 'payments',
        privateKey: 'payments',
        savedMessage: 'Saved ✓ — the site picks this up within about a minute',

        groups: [
          {
            title: 'Online payment',
            note: 'Customers choose how to pay: Mobile Money or Debit / Credit Card. "Website checkout" ' +
                  'appears beside "WhatsApp checkout" once a gateway below is switched on and its keys ' +
                  'are in Netlify; WhatsApp ordering stays exactly as it is.',
            fields: [
              { type: 'toggle', name: 'onlineEnabled', label: 'Take payments online',
                hint: 'Off: the button disappears straight away, and the server refuses ' +
                      'new payments. A payment already under way still completes.' },
              { type: 'select', name: 'onlineMode', label: 'Mode', half: true,
                showIf: function (v) { return !!v.onlineEnabled; },
                options: [
                  { value: 'test', label: 'Test \u2014 practise, no real money moves' },
                  { value: 'live', label: 'Live \u2014 real payments' }
                ] },
              { type: 'text', name: 'onlineLabel', label: 'Button wording', half: true,
                maxLength: 50, placeholder: 'Website checkout',
                showIf: function (v) { return !!v.onlineEnabled; } },
              { type: 'toggle', name: 'onlineMobile', label: 'Offer Mobile Money', half: true,
                hint: 'The networks offered are the ones ticked under Lenco.',
                showIf: function (v) { return !!v.onlineEnabled; } },
              { type: 'toggle', name: 'onlineCard', label: 'Offer Debit / Credit Card', half: true,
                hint: 'Entered in the gateway\u2019s own secure window, never on this website.',
                showIf: function (v) { return !!v.onlineEnabled; } },
              { type: 'toggle', name: 'onlineConfirmEmail',
                label: 'Email the customer a confirmation automatically',
                hint: 'Sent the moment a payment is confirmed, from the email account in ' +
                      'Settings > Notifications. Customers paying online always give an email.',
                showIf: function (v) { return !!v.onlineEnabled; } },
              { type: 'toggle', name: 'onlineNotifyShop',
                label: 'Email the shop when a payment arrives',
                hint: 'To the business email in Contact & Social.',
                showIf: function (v) { return !!v.onlineEnabled; } },
              { type: 'note', name: 'onlineLiveNote', tone: 'warn',
                label: 'Live mode takes real money',
                text: 'Make one small test purchase yourself after switching to Live, and ' +
                      'check it arrives in the Orders tab marked Paid.',
                showIf: function (v) { return !!v.onlineEnabled && v.onlineMode === 'live'; } },
              { type: 'note', name: 'onlineNoGateway', tone: 'warn',
                label: 'No gateway is switched on',
                text: 'Switch on Lenco below (or Flutterwave, once approved). Until then customers ' +
                      'see WhatsApp checkout only.',
                showIf: function (v) { return !!v.onlineEnabled && !v.lencoEnabled && !v.flwEnabled; } }
            ]
          },
          {
            title: 'Lenco',
            note: 'The primary gateway for Zambia (Lenco by BroadPay). Mobile Money by a request ' +
                  'to the customer\u2019s phone, approved there with their PIN; Debit / Credit Cards in ' +
                  'Lenco\u2019s own secure window. Tick only what Lenco has activated on your merchant ' +
                  'account: nothing else is offered to customers.',
            fields: [
              { type: 'toggle', name: 'lencoEnabled', label: 'Use Lenco',
                hint: 'Off: nothing is sent to Lenco and its ways of paying are not offered. ' +
                      'A payment already under way still completes.' },
              { type: 'toggle', name: 'lencoAirtel', label: 'Airtel Money activated', half: true,
                showIf: function (v) { return !!v.lencoEnabled; } },
              { type: 'toggle', name: 'lencoMtn', label: 'MTN MoMo activated', half: true,
                showIf: function (v) { return !!v.lencoEnabled; } },
              { type: 'toggle', name: 'lencoZamtel', label: 'Zamtel Kwacha activated', half: true,
                showIf: function (v) { return !!v.lencoEnabled; } },
              { type: 'toggle', name: 'lencoCard', label: 'Cards activated', half: true,
                showIf: function (v) { return !!v.lencoEnabled; } },
              { type: 'note', name: 'lencoBankNote', tone: 'info',
                label: 'Instant Bank Transfer',
                text: 'Not offered: Lenco\u2019s API takes cards and mobile money only. Instant Bank ' +
                      'Transfer appears at checkout once a gateway that offers it is connected.',
                showIf: function (v) { return !!v.lencoEnabled; } },
              { type: 'note', name: 'lencoRefundNote', tone: 'info',
                label: 'Refunds',
                text: 'Lenco\u2019s API has no refund. A payment made through Lenco is refunded from ' +
                      'your Lenco account; the platform\u2019s Online Refund says so rather than sending one.',
                showIf: function (v) { return !!v.lencoEnabled; } }
            ]
          },
          {
            title: 'Flutterwave',
            note: 'Kept for when your Flutterwave merchant account is approved. While switched off, no ' +
                  'payment is sent to Flutterwave. Payments already made through it are still checked, ' +
                  'and can still be refunded.',
            fields: [
              { type: 'toggle', name: 'flwEnabled', label: 'Use Flutterwave',
                hint: 'Switch on only once Flutterwave has approved your account. It then takes any ' +
                      'way of paying Lenco does not.' }
            ]
          },
          {
            title: 'Ways to pay',
            note: 'Turn on what you accept. Whatever is on appears in the footer and ' +
                  'under How to pay.',
            fields: [].concat(
              method('cash', 'Cash', 'Paying in person at the shop.'),
              method('bank', 'Bank transfer', 'Account details are set further down and stay private.'),
              method('mobile', 'Mobile money', 'Airtel, MTN and anything else, as one method.'),
              method('card', 'Card payment', 'Only if you have a card machine or a payment link.'),
              method('cod', 'Payment on delivery', 'Paying whoever brings the order, which is not the same as cash at the shop.')
            )
          },
          {
            title: 'Layby estimate',
            note: 'Shown under the price on each product page: the deposit, the balance ' +
                  'and what that comes to each month (not on sold-out pieces or prices on ' +
                  'request). It is an estimate only. Viewing it does not start a layby, take ' +
                  'a deposit or hold the piece; laybys are still arranged with you. Set these ' +
                  'to match your layby terms.',
            fields: [
              { type: 'number', name: 'laybyDeposit', label: 'Layby deposit percentage',
                suffix: '%', half: true, required: true, placeholder: '30',
                hint: 'Paid to start a layby, as a share of the price.',
                validate: depositOk },
              { type: 'number', name: 'laybyMonths', label: 'Layby payment duration',
                suffix: 'months', half: true, required: true, placeholder: '6',
                hint: 'How many monthly payments the rest is spread over.',
                validate: monthsOk }
            ]
          },
          {
            title: 'Bank details',
            note: 'PRIVATE — kept in a table the website cannot read, and never sent to a ' +
                  'customer’s browser. Send these on WhatsApp when an order is agreed.',
            fields: [
              { type: 'text', name: 'bankAccountBank', label: 'Bank name', half: true,
                maxLength: 80, private: true, showIf: on('bank') },
              { type: 'text', name: 'bankAccountName', label: 'Account name', half: true,
                maxLength: 80, private: true, showIf: on('bank') },
              { type: 'text', name: 'bankAccountNumber', label: 'Account number', half: true,
                maxLength: 40, private: true, showIf: on('bank') },
              { type: 'text', name: 'bankBranch', label: 'Branch', half: true,
                maxLength: 80, private: true, showIf: on('bank') },
              { type: 'text', name: 'bankBranchCode', label: 'Branch code',
                maxLength: 30, private: true, showIf: on('bank') }
            ]
          },
          {
            title: 'Mobile money accounts',
            note: 'PRIVATE — as above. Add one row per account: Airtel and MTN are two rows, ' +
                  'not two payment methods.',
            fields: [
              { type: 'list', name: 'mobileAccounts', label: 'Accounts', private: true,
                addLabel: 'Add an account', itemName: 'Account', max: 6,
                showIf: on('mobile'),
                summary: function (row) {
                  return [row.provider, row.number].filter(Boolean).join(' · ');
                },
                blank: function () { return { provider: 'Airtel Money', number: '', name: '' }; },
                fields: [
                  { type: 'select', name: 'provider', label: 'Provider', half: true,
                    options: PROVIDERS },
                  { type: 'text', name: 'number', label: 'Mobile number', half: true,
                    maxLength: 30, required: true, placeholder: '+260 …',
                    validate: function (v) {
                      if (!v) return '';
                      var d = String(v).replace(/\D/g, '');
                      return (d.length >= 7 && d.length <= 15)
                        ? '' : 'That does not look like a complete number.';
                    } },
                  { type: 'text', name: 'name', label: 'Account name', maxLength: 80,
                    required: true }
                ] }
            ]
          }
        ],

        validate: function (values, fail) {
          var any = ['cash', 'bank', 'mobile', 'card', 'cod']
            .some(function (k) { return values[k + 'Enabled']; });
          if (!any) {
            fail('cashEnabled', 'Accept at least one way of paying, or customers have no way ' +
                                'to complete an order.');
          }
          if (values.onlineEnabled && values.onlineCard === false && values.onlineMobile === false) {
            fail('onlineCard', 'Online payment is on but accepts nothing. Turn on cards, ' +
                               'mobile money, or both.');
          }
          if (values.lencoEnabled && !values.lencoAirtel && !values.lencoMtn && !values.lencoZamtel &&
              !values.lencoCard) {
            fail('lencoAirtel', 'Lenco is on but nothing is ticked as activated. Tick what Lenco has ' +
                                'activated on your account, or switch Lenco off.');
          }
          if (values.mobileEnabled && (!values.mobileAccounts || !values.mobileAccounts.length)) {
            fail('mobileAccounts', 'Mobile money is on but there are no accounts. Add one, ' +
                                   'or turn the method off.');
          }
        }
      });

      /* Whether the keys are in place on Netlify. Asked of the server, which
         answers yes or no for each and never shows the keys themselves. */
      (function readiness() {
        var box = null, tries2 = 0;
        (function find() {
          var cards = host.querySelectorAll('.card');
          for (var i = 0; i < cards.length; i++) {
            var h = cards[i].querySelector('h3');
            if (h && h.textContent === 'Flutterwave') { box = cards[i]; break; }
          }
          if (!box) { if (tries2++ < 60) setTimeout(find, 50); return; }
          var line = document.createElement('div');
          line.className = 'pay-ready';
          line.textContent = 'Checking the payment setup\u2026';
          var h3 = box.querySelector('h3');
          h3.parentNode.insertBefore(line, h3.nextSibling);
          /* Sent with the sign-in: the key checks and the webhook times
             are only told to an administrator. */
          adminToken()
            .then(function (t) {
              return fetch('/.netlify/functions/pay-status?check=1', {
                cache: 'no-store', headers: t ? { Authorization: 'Bearer ' + t } : {}
              });
            })
            .then(function (r) { return r.json(); })
            .then(function (c) {
              lencoReady(host, c);             // build 88: Lenco's section, from the same answer
              activity(host, c);               // build 88: payment activity
              /* A key that is there but is the wrong one of Flutterwave's
                 three is not a tick. */
              var testOk = c.test && c.testKeyLooksRight !== false;
              var liveOk = c.live && c.liveKeyLooksRight !== false;
              var bits = [
                [testOk, 'Flutterwave test key'], [liveOk, 'Flutterwave live key'],
                [c.hash, 'Webhook secret hash'], [c.service, 'Supabase service key'],
                [c.formats, 'Price rules']
              ];
              line.innerHTML = '';
              bits.forEach(function (b) {
                var s2 = document.createElement('span');
                s2.className = b[0] ? 'ok' : 'no';
                s2.textContent = (b[0] ? '\u2713 ' : '\u2715 ') + b[1];
                line.appendChild(s2);
              });
              var there = c.hash && c.service && c.formats && (c.test || c.live);
              var all = there && (!c.test || testOk) && (!c.live || liveOk);
              var note = document.createElement('div');
              note.className = 'pay-ready-note';
              note.textContent = all
                ? 'Ready. The keys live in Netlify and are never shown here.'
                : there
                  ? 'Almost: a key needs another look, below.'
                  : 'Not ready yet: add the missing items in Netlify > Site configuration > ' +
                    'Environment variables, then redeploy. SETUP.md has the steps.';
              line.appendChild(note);
              healthLines(c).forEach(function (h) {
                var n = document.createElement('div');
                n.className = 'pay-ready-note' + (h.warn ? ' pay-ready-warn' : '');
                n.textContent = h.text;
                line.appendChild(n);
              });
              if (c.test || c.live) line.appendChild(keyCheck());
            })
            .catch(function () {
              line.textContent = 'The payment setup could not be checked from here (the ' +
                                 'Netlify functions may not be deployed yet).';
              lencoReady(host, null);
              activity(host, null);
            });
        })();
      })();

      /* A visible reminder of which half of this page the website can see. */
      var tries = 0;
      (function mark() {
        var cards = host.querySelectorAll('.card');
        if (!cards.length) { if (tries++ < 60) setTimeout(mark, 50); return; }
        Array.prototype.forEach.call(cards, function (c) {
          var h = c.querySelector('h3');
          var note = c.querySelector('.grp-note');
          if (!h || !note || note.textContent.indexOf('PRIVATE') !== 0) return;
          note.classList.add('shut-note');
          var band = document.createElement('div');
          band.className = 'shut';
          var head = document.createElement('div');
          head.className = 'shut-head';
          head.textContent = '● Not sent to the website';
          band.appendChild(head);
          band.appendChild(note.cloneNode(true));
          note.parentNode.replaceChild(band, note);
        });
      })();
    }
  });
})();
