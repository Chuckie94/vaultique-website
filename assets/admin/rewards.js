/* =====================================================================
   Vaultique Boutique Point - Admin > Rewards
   ---------------------------------------------------------------------
   The website's side of Vaultique Rewards. The points themselves live on
   the business platform, and nothing on this page reads or shows them:
   the team checks anything about a customer on the platform, where it
   belongs. This page holds only what the website did:

     * Customers asking to link a customer number (when no code could be
       emailed) or to be registered.
     * Points promised on website orders, waiting for the order to be rung
       up on the till under that customer number.
     * Website accounts linked to a customer number.

   Opened by the owner, or a role allowed Orders.
   ===================================================================== */
(function () {
  'use strict';
  if (!window.VBP_ADMIN) return;
  var A = window.VBP_ADMIN;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function when(t) {
    try { return new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return String(t || ''); }
  }
  var pts = function (n) { return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); };
  var money = function (n) { return 'K' + Number(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); };

  A.registerPage({
    key: 'rewards',
    title: 'Rewards',
    summary: 'Customers linking their rewards, and points promised on website orders.',

    render: function (host, ctx) {
      var sb = (ctx && ctx.sb) || A.sb;

      var how = el('div', 'card rw-how');
      how.innerHTML =
        '<h3>How it works</h3>' +
        '<p class="an-note">The points live on the business platform, and only there. A customer who uses points ' +
        'on a website order pays less in their WhatsApp message, which names their <b>customer number</b> and a ' +
        '<b>Ref RW-…</b>. Ring that order up on the till <b>under that customer</b> (not Online Customer), press ' +
        '<b>Redeem points</b>, then mark it below as rung up. The customer earns their points on that sale as ' +
        'usual. If the order is cancelled, release the points so the customer can use them again.</p>';
      host.appendChild(how);

      var reqCard = el('div', 'card'); reqCard.appendChild(el('h3', null, 'Waiting for you'));
      var reqBody = el('div', 'rw-list'); reqCard.appendChild(reqBody); host.appendChild(reqCard);
      var holdCard = el('div', 'card'); holdCard.appendChild(el('h3', null, 'Points promised on website orders'));
      var holdBody = el('div', 'rw-list'); holdCard.appendChild(holdBody); host.appendChild(holdCard);
      var linkCard = el('div', 'card'); linkCard.appendChild(el('h3', null, 'Linked accounts'));
      var linkBody = el('div', 'rw-list'); linkCard.appendChild(linkBody); host.appendChild(linkCard);

      function missing(e) {
        return /rewards_|does not exist|could not find|schema cache/i.test((e && e.message) || '');
      }
      function setUpNote() {
        host.innerHTML = '';
        var c = el('div', 'card');
        c.appendChild(el('h3', null, 'Rewards are not set up yet'));
        c.appendChild(el('p', 'an-note', 'Run supabase-rewards.sql in this website’s Supabase SQL Editor, then open this page again.'));
        host.appendChild(c);
      }
      function row(parent, title, sub, actions) {
        var r = el('div', 'rw-row');
        var t = el('div', 'rw-row-t');
        t.appendChild(el('div', 'rw-row-h', title));
        if (sub) t.appendChild(el('div', 'rw-row-s', sub));
        r.appendChild(t);
        var a = el('div', 'rw-row-a');
        (actions || []).forEach(function (x) {
          var b = el('button', 'btn btn-sm ' + (x.primary ? 'btn-gold' : 'btn-outline'), x.label);
          b.type = 'button';
          b.addEventListener('click', function () {
            if (x.confirm && !window.confirm(x.confirm)) return;
            b.disabled = true;
            Promise.resolve(x.run()).then(load, function (e) {
              b.disabled = false;
              window.alert((e && e.message) || 'That could not be done.');
            });
          });
          a.appendChild(b);
        });
        r.appendChild(a);
        parent.appendChild(r);
      }
      function rpc(name, args) {
        return Promise.resolve(sb.rpc(name, args)).then(function (r) { if (r.error) throw r.error; return r.data; });
      }

      function load() {
        Promise.all([
          sb.from('rewards_requests').select('*').eq('status', 'waiting').order('created_at', { ascending: true }),
          sb.from('rewards_holds').select('*').eq('status', 'promised').order('created_at', { ascending: true }),
          sb.from('rewards_links').select('*').order('linked_at', { ascending: false }).limit(200)
        ]).then(function (res) {
          for (var i = 0; i < res.length; i++) { if (res[i].error) throw res[i].error; }
          var reqs = res[0].data || [], holds = res[1].data || [], links = res[2].data || [];
          /* The website account's own name and phone (the customer typed
             them on the website), so the team knows who to call. */
          var ids = {};
          reqs.concat(holds, links).forEach(function (x) { ids[x.user_id] = true; });
          var list = Object.keys(ids);
          return (list.length ? sb.from('customers').select('id,name,phone').in('id', list) : Promise.resolve({ data: [] }))
            .then(function (c) {
              var who = {};
              ((c && c.data) || []).forEach(function (x) { who[x.id] = x; });
              paint(reqs, holds, links, who);
            });
        }).catch(function (e) {
          if (missing(e)) { setUpNote(); return; }
          reqBody.innerHTML = '';
          reqBody.appendChild(el('p', 'count', 'These could not be read: ' + ((e && e.message) || e)));
        });
      }

      function person(who, id) {
        var w = who[id] || {};
        return [w.name, w.phone].filter(Boolean).join(' · ') || 'Website account';
      }

      function paint(reqs, holds, links, who) {
        reqBody.innerHTML = ''; holdBody.innerHTML = ''; linkBody.innerHTML = '';
        if (!reqs.length) reqBody.appendChild(el('p', 'count', 'Nothing waiting.'));
        reqs.forEach(function (q) {
          if (q.kind === 'link') {
            row(reqBody, 'Link customer number ' + q.cust_no,
              person(who, q.user_id) + ' · asked ' + when(q.created_at) +
              '. Check on the platform that this number is theirs before approving.', [
              { label: 'Approve', primary: true, confirm: 'Link this website account to customer number ' + q.cust_no + '?',
                run: function () { return rpc('rewards_decide', { p_request: q.id, p_approve: true }); } },
              { label: 'Decline', run: function () { return rpc('rewards_decide', { p_request: q.id, p_approve: false }); } }
            ]);
          } else {
            row(reqBody, 'Register ' + (q.name || 'a new customer'),
              (q.phone || '') + ' · asked ' + when(q.created_at) +
              '. Register them on the platform, then tell them their customer number so they can link it.', [
              { label: 'Done', primary: true, run: function () { return rpc('rewards_decide', { p_request: q.id, p_approve: true }); } },
              { label: 'Decline', run: function () { return rpc('rewards_decide', { p_request: q.id, p_approve: false }); } }
            ]);
          }
        });

        if (!holds.length) holdBody.appendChild(el('p', 'count', 'No points waiting for the till.'));
        holds.forEach(function (h) {
          row(holdBody, h.order_ref + ' · customer number ' + h.cust_no,
            pts(h.points) + ' points (−' + money(h.value) + ') · ' + person(who, h.user_id) + ' · ' + when(h.created_at), [
            { label: 'Rung up on the till', primary: true,
              confirm: 'Was ' + h.order_ref + ' rung up under customer number ' + h.cust_no + ', with Redeem points pressed?',
              run: function () { return rpc('rewards_settle', { p_hold: h.id, p_rung_up: true }); } },
            { label: 'Release', confirm: 'Give these points back to the customer? Do this if the order was cancelled.',
              run: function () { return rpc('rewards_settle', { p_hold: h.id, p_rung_up: false }); } }
          ]);
        });

        if (!links.length) linkBody.appendChild(el('p', 'count', 'No accounts linked yet.'));
        links.forEach(function (l) {
          row(linkBody, 'Customer number ' + l.cust_no,
            person(who, l.user_id) + ' · ' + (l.how === 'team' ? 'approved by the team' : 'confirmed by email code') +
            ' · ' + when(l.linked_at), [
            { label: 'Unlink', confirm: 'Unlink this website account from customer number ' + l.cust_no + '? Their points on the platform are not touched.',
              run: function () { return rpc('rewards_unlink', { p_user: l.user_id }); } }
          ]);
        });
      }

      load();
    }
  });
})();
