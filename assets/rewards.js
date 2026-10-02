/* =====================================================================
   Vaultique Boutique Point — Vaultique Rewards, in the customer's account
   ---------------------------------------------------------------------
   The platform owns the points. This file only asks the website's own
   server function (netlify/functions/rewards.js), as the signed-in
   customer, and shows what it is told: their points, what they are
   worth, and the milestone. Nothing is kept in the browser.

   Switched on in Settings > Shopping ("Vaultique Rewards on the
   website"), and only for a customer who is signed in.
   ===================================================================== */
(function () {
  'use strict';

  var FN = '/.netlify/functions/rewards';
  var MONEY = function (n) { return 'K' + Number(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); };
  var last = null, lastAt = 0;

  function acct() { return window.VBP_ACCOUNT || null; }
  function on() { return !!(window.VBP_REWARDS && window.VBP_REWARDS.enabled); }
  function ready() { var A = acct(); return on() && A && A.enabled() && A.signedIn(); }
  function points(n) { return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  function ask(action, data) {
    var A = acct();
    var token = A && A.accessToken();
    if (!token) return Promise.reject(new Error('Please sign in to your account first.'));
    return fetch(FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(Object.assign({ action: action }, data || {}))
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (b) {
        if (!r.ok) throw new Error(b.error || 'Rewards could not be reached just now.');
        return b;
      });
    });
  }
  function status(fresh) {
    if (!fresh && last && Date.now() - lastAt < 30000) return Promise.resolve(last);
    return ask('status').then(function (s) { last = s; lastAt = Date.now(); return s; });
  }
  function forget() { last = null; lastAt = 0; }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  /* ---- the card in the account page ------------------------------- */
  function card() {
    var c = el('div', 'ac-card rw-card');
    c.appendChild(el('h2', 'serif', 'Vaultique Rewards'));
    var body = el('div', 'rw-body');
    body.appendChild(el('p', 'ac-quiet', 'Reading your rewards…'));
    c.appendChild(body);
    draw(body, false);
    return c;
  }

  function draw(body, fresh) {
    status(fresh).then(function (s) {
      body.innerHTML = '';
      if (!s.linked) return linkForm(body, s);
      if (s.unavailable) { body.appendChild(el('p', 'ac-quiet', 'Your points cannot be read just now. Please try again shortly.')); return; }
      if (s.missing) {
        body.appendChild(el('p', 'ac-quiet', 'Customer number ' + s.number + ' could not be found on our records. Please ask us.'));
        return;
      }
      var big = el('div', 'rw-points');
      big.appendChild(el('span', 'rw-n', points(s.points)));
      big.appendChild(el('span', 'rw-l', 'points'));
      body.appendChild(big);
      if (s.worth > 0) body.appendChild(el('p', 'rw-worth', 'Worth ' + MONEY(s.worth) + ' off your next order'));
      if (s.milestone) {
        var m = s.milestone, prev = m.next - m.milestone;
        var pct = Math.max(0, Math.min(100, Math.round(((s.points - prev) / m.milestone) * 100)));
        var bar = el('div', 'rw-bar'); var fill = el('i'); fill.style.width = pct + '%'; bar.appendChild(fill);
        body.appendChild(bar);
        body.appendChild(el('p', 'ac-quiet', m.reached
          ? 'Milestone reached. Next at ' + points(m.next) + ' points.'
          : points(Math.max(0, m.next - s.points)) + ' points to your milestone' +
            (s.milestoneValue ? ' (worth ' + MONEY(s.milestoneValue) + ')' : '') + '.'));
      }
      body.appendChild(el('p', 'ac-quiet rw-how', 'You earn ' + points(s.perK1) + ' points for every K1 when your order is ' +
        'recorded under your customer number. You can use your points at checkout, before or after the milestone.'));
      var foot = el('p', 'rw-foot');
      foot.appendChild(document.createTextNode('Customer number ' + s.number + ' · '));
      var un = el('button', 'ac-link', 'Not you?');
      un.type = 'button';
      un.addEventListener('click', function () {
        if (!window.confirm('Stop showing these rewards on this account? Your points stay where they are.')) return;
        ask('unlink').then(function () { forget(); draw(body, true); });
      });
      foot.appendChild(un);
      body.appendChild(foot);
    }, function (e) {
      body.innerHTML = '';
      body.appendChild(el('p', 'ac-quiet', e.message));
    });
  }

  function field(wrap, id, label, type, attrs) {
    var l = el('label', 'rv-lbl', label); l.setAttribute('for', id);
    var i = document.createElement('input'); i.type = type; i.id = id;
    Object.keys(attrs || {}).forEach(function (k) { i.setAttribute(k, attrs[k]); });
    wrap.appendChild(l); wrap.appendChild(i);
    return i;
  }

  function linkForm(body, s) {
    var waiting = (s.waiting || []);
    var A = acct(), me = (A && A.state && A.state.profile) || {};

    /* Waiting on the team: say so, and nothing else to fill in. */
    if (waiting.indexOf('join') > -1) {
      body.appendChild(el('p', 'rw-note', 'We have your request to join. We will register you and email you your ' +
        'customer number, usually within a day. Your points will show here.'));
      return;
    }
    if (waiting.indexOf('link') > -1) body.appendChild(el('p', 'rw-note', 'Our team is checking your customer number and will be in touch.'));

    body.appendChild(el('p', 'ac-quiet', 'Earn points every time you shop with us, in the shop or online, and use them ' +
      'to pay less.'));

    /* Two doors: new to rewards, or already a customer. */
    var pick = el('div', 'rw-pick');
    var newBtn = el('button', 'btn btn-gold rw-pick-new', 'I\u2019m new \u2013 join');
    var oldBtn = el('button', 'btn btn-outline rw-pick-old', 'I have a customer number');
    newBtn.type = oldBtn.type = 'button';
    pick.appendChild(newBtn); pick.appendChild(oldBtn);
    body.appendChild(pick);

    /* ---- new: the team registers them on the platform ---------------- */
    var join = el('div', 'rw-join hide');
    var myEmail = (A && A.state && A.state.user && A.state.user.email) || '';
    join.appendChild(el('p', 'ac-quiet', 'We register you with your email' + (myEmail ? ' (' + myEmail + ')' : '') +
      ' and email you your customer number once it is done.'));
    var jn = field(join, 'rw_jname', 'Your name', 'text', { autocomplete: 'name', maxlength: '80' });
    if (me.name) jn.value = me.name;
    var jm = el('p', 'ac-msg');
    var jb = el('button', 'btn btn-gold', 'Join Vaultique Rewards'); jb.type = 'button';
    var r3 = el('div', 'ac-actions'); r3.appendChild(jb);
    join.appendChild(r3); join.appendChild(jm);
    body.appendChild(join);
    jb.addEventListener('click', function () {
      jm.textContent = 'Sending\u2026'; jm.className = 'ac-msg busy'; jb.disabled = true;
      ask('join', { name: jn.value }).then(function (r) {
        jm.textContent = 'Thank you. We will register you and email you your customer number' +
          (r && r.emailed ? '. We have sent you a confirmation email.' : '.');
        jm.className = 'ac-msg ok';
        forget();
      }, function (e) { jb.disabled = false; jm.textContent = e.message; jm.className = 'ac-msg err'; });
    });

    /* ---- already a customer: prove the number with a code ------------ */
    var have = el('div', 'rw-have hide');
    have.appendChild(el('p', 'ac-quiet', 'Your customer number is printed on your receipts. We send a code to the ' +
      'email on your customer record to confirm it is yours.'));
    var num = field(have, 'rw_num', 'Customer number', 'text', { autocomplete: 'off', maxlength: '30', placeholder: 'e.g. VB-0123' });
    var msg = el('p', 'ac-msg');
    var go = el('button', 'btn btn-gold', 'Send me a code'); go.type = 'button';
    var row = el('div', 'ac-actions'); row.appendChild(go);
    have.appendChild(row); have.appendChild(msg);

    var codeBox = el('div', 'rw-code hide');
    var code = field(codeBox, 'rw_code', 'The 6-digit code', 'text', { inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6' });
    var check = el('button', 'btn btn-gold', 'Confirm'); check.type = 'button';
    var row2 = el('div', 'ac-actions'); row2.appendChild(check);
    codeBox.appendChild(row2);
    var msg2 = el('p', 'ac-msg'); codeBox.appendChild(msg2);
    have.appendChild(codeBox);
    body.appendChild(have);

    go.addEventListener('click', function () {
      msg.textContent = 'Sending\u2026'; msg.className = 'ac-msg busy'; go.disabled = true;
      ask('link', { number: num.value }).then(function (r) {
        go.disabled = false;
        msg.textContent = r.message; msg.className = 'ac-msg ok';
        codeBox.classList.remove('hide'); code.focus();
      }, function (e) { go.disabled = false; msg.textContent = e.message; msg.className = 'ac-msg err'; });
    });
    check.addEventListener('click', function () {
      msg2.textContent = 'Checking\u2026'; msg2.className = 'ac-msg busy'; check.disabled = true;
      ask('verify', { code: code.value }).then(function () { forget(); draw(body, true); },
        function (e) { check.disabled = false; msg2.textContent = e.message; msg2.className = 'ac-msg err'; });
    });

    function show(which) {
      join.classList.toggle('hide', which !== 'new');
      have.classList.toggle('hide', which !== 'have');
      newBtn.className = 'btn rw-pick-new ' + (which === 'new' ? 'btn-gold' : 'btn-outline');
      oldBtn.className = 'btn rw-pick-old ' + (which === 'have' ? 'btn-gold' : 'btn-outline');
      newBtn.setAttribute('aria-pressed', String(which === 'new'));
      oldBtn.setAttribute('aria-pressed', String(which === 'have'));
      (which === 'new' ? (jn.value ? jb : jn) : num).focus();
    }
    newBtn.addEventListener('click', function () { show('new'); });
    oldBtn.addEventListener('click', function () { show('have'); });
    /* Asked before: go straight back to the number. */
    if (waiting.indexOf('link') > -1) show('have');
  }

  /* ---- at checkout --------------------------------------------------
     What the points would take off this much, or null. Quiet on every
     failure: a checkout must never wait on, or fail because of, rewards. */
  function quote(due) {
    if (!ready() || !(due > 0)) return Promise.resolve(null);
    return status(false).then(function (s) {
      if (!s.linked || !s.canRedeem) return null;
      return ask('quote', { due: due }).then(function (r) { return r.quote || null; });
    }).catch(function () { return null; });
  }
  /* Promise the points on this order, recomputed on the server. */
  function hold(orderRef, due) {
    return ask('hold', { orderRef: orderRef, due: due }).then(function (r) { forget(); return r; });
  }
  function newRef() {
    var a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', s = '';
    for (var i = 0; i < 6; i++) s += a.charAt(Math.floor(Math.random() * a.length));
    return 'RW-' + s;
  }

  window.VBP_REWARDS = {
    enabled: false,          // set by the storefront from Settings > Shopping
    ready: ready, card: card, quote: quote, hold: hold, newRef: newRef,
    status: status, forget: forget, money: MONEY, points: points
  };
})();
