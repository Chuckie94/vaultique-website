/* =====================================================================
   Vaultique Boutique Point - an order's progress, for the customer
   ---------------------------------------------------------------------
   BUILD 78. Once the platform's till has rung an order up, the customer
   sees where it is: Paid, Preparing, On its way (or Ready for
   collection), Delivered (or Collected). While it is on its way they
   have two buttons, Confirm delivery and Ask for more time.

   One copy of the steps and their words, used by the account page
   (assets/account.js) and by the private link a customer gets by email
   (assets/app.js), so the two never say different things about the same
   order. It draws; the two pages ask the database.

   The shape is what supabase-order-progress.sql hands out
   (order_progress_out); fromRow() turns an orders row, as the account
   page reads it, into the same shape.
   ===================================================================== */
(function () {
  'use strict';

  var LABELS = {
    placed: 'Paid',
    preparing: 'Preparing',
    onway: 'On its way',
    ready: 'Ready for collection',
    delivered: 'Delivered',
    collected: 'Collected'
  };
  var BY = {
    customer: 'confirmed by you',
    shop: 'marked by the shop',
    auto: 'marked automatically when the days ran out'
  };

  function num(v, d) { var n = Number(v); return isFinite(n) && v !== null && v !== '' ? n : d; }

  /* An orders row (the account page's own read) as order_progress_out has it. */
  function fromRow(o) {
    o = o || {};
    var days = num(o.extend_days, 3), max = num(o.extend_max, 2), used = num(o.extend_used, 0);
    var status = o.status || 'pending';
    return {
      ref: o.ref,
      status: status,
      fulfilment: o.fulfilment === 'collection' ? 'collection' : 'delivery',
      rungUp: !!(o.pos_completed_at || o.pos_receipt_no || o.pos_sale_id),
      paidAt: o.paid_at || o.pos_completed_at || null,
      preparingAt: o.pos_completed_at || null,
      dispatchedAt: o.dispatched_at || null,
      readyAt: o.ready_at || null,
      deliveredAt: o.delivered_at || null,
      deliveredBy: o.delivered_by || null,
      note: o.ship_note || null,
      autoAt: o.auto_deliver_at || null,
      remindDays: o.remind_days == null ? null : num(o.remind_days, null),
      extend: {
        days: days, max: max, used: used, left: Math.max(0, max - used),
        can: status === 'dispatched' && !!o.auto_deliver_at && !o.delivered_at && used < max && days > 0
      },
      refund: o.refund_state ? { state: o.refund_state, amount: o.refund_amount, ref: o.refund_ref,
                                 note: o.refund_note, at: o.refund_at } : null
    };
  }

  /* "23 Nov 2026, 10:30", in the customer's own time. */
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function when(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear() + ', ' +
      ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }

  /* The word on the order's badge. Orders the till never rang up keep the
     words they always had. */
  function headline(p) {
    var s = p.status;
    if (s === 'cancelled') return 'Cancelled';
    if (s === 'completed') return 'Completed';
    if (s === 'delivered') return p.fulfilment === 'collection' ? LABELS.collected : LABELS.delivered;
    if (s === 'dispatched') return LABELS.onway;
    if (s === 'ready') return LABELS.ready;
    if (s === 'confirmed' && p.rungUp) return LABELS.preparing;
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  /* The badge's own class: Preparing reads as its own state. */
  function badgeClass(p) {
    return 'is-' + (p.status === 'confirmed' && p.rungUp ? 'preparing' : p.status);
  }

  /* The four steps, each done or not, with its date. */
  function steps(p) {
    var collect = p.fulfilment === 'collection';
    var s = p.status;
    var gone = s === 'dispatched' || s === 'ready' || s === 'delivered';
    return [
      { key: 'placed', label: LABELS.placed, at: p.paidAt, done: true },
      { key: 'preparing', label: LABELS.preparing, at: p.preparingAt, done: true, now: s === 'confirmed' },
      collect
        ? { key: 'ready', label: LABELS.ready, at: p.readyAt, done: s === 'ready' || s === 'delivered', now: s === 'ready',
            note: s === 'ready' ? p.note : null }
        : { key: 'onway', label: LABELS.onway, at: p.dispatchedAt, done: s === 'dispatched' || s === 'delivered',
            now: s === 'dispatched', note: gone ? p.note : null },
      { key: 'delivered', label: collect ? LABELS.collected : LABELS.delivered, at: p.deliveredAt,
        done: s === 'delivered', now: s === 'delivered', by: s === 'delivered' ? BY[p.deliveredBy] || '' : '' }
    ];
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  /* Draw the steps, what happens next, a refund, and the two buttons.
     opts.money(v)        the shop's money, as the page shows it
     opts.onConfirm()     a promise of the database's answer
     opts.onExtend()      the same, for more time
     opts.after(answer, words)  once either has answered: the page redraws,
                          and shows the words on the order drawn again
     opts.message         those words, on the order drawn again */
  function draw(host, p, opts) {
    opts = opts || {};
    var box = el('div', 'pg');
    var list = el('ol', 'pg-steps');
    steps(p).forEach(function (st) {
      var li = el('li', 'pg-step' + (st.done ? ' done' : '') + (st.now ? ' now' : ''));
      li.setAttribute('data-step', st.key);
      li.appendChild(el('span', 'pg-dot'));
      var t = el('div', 'pg-txt');
      t.appendChild(el('b', null, st.label));
      if (st.done && st.at) t.appendChild(el('span', 'pg-at', ' ' + when(st.at)));
      if (st.by) t.appendChild(el('span', 'pg-by', ' · ' + st.by));
      if (st.note) t.appendChild(el('div', 'pg-note', st.note));
      li.appendChild(t);
      list.appendChild(li);
    });
    box.appendChild(list);

    if (p.status === 'dispatched' && p.autoAt) {
      box.appendChild(el('p', 'pg-auto', 'It will be marked delivered on ' + when(p.autoAt) +
        ' unless you confirm first.'));
    }
    var ex = p.extend || {};
    if (p.status === 'dispatched' && p.autoAt) {
      box.appendChild(el('p', 'pg-more', ex.can
        ? 'Not arrived yet? You can ask for ' + ex.days + ' more days' +
          (ex.left === 1 ? ', once more.' : ', ' + ex.left + ' times.')
        : 'More time has been given as often as it can be. If it has not arrived, please contact the shop.'));
    }
    if (p.refund) {
      var money = opts.money || function (v) { return String(v); };
      box.appendChild(el('p', 'pg-refund', (p.refund.state === 'part' ? 'Part refunded: ' : 'Refunded: ') +
        money(p.refund.amount) + (p.refund.at ? ' on ' + when(p.refund.at) : '') +
        (p.refund.ref ? ' (reference ' + p.refund.ref + ')' : '') + '.'));
    }

    var msg = el('p', 'pg-msg');
    if (opts.message) { msg.textContent = opts.message; msg.className = 'pg-msg ok'; }
    if (p.status === 'dispatched' && (opts.onConfirm || opts.onExtend)) {
      var acts = el('div', 'pg-acts');
      var mk = function (label, cls, fn, done) {
        var b = el('button', 'btn btn-sm ' + cls, label);
        b.type = 'button';
        b.addEventListener('click', function () {
          var all = acts.querySelectorAll('button');
          for (var i = 0; i < all.length; i++) all[i].disabled = true;
          msg.textContent = 'One moment…'; msg.className = 'pg-msg busy';
          Promise.resolve().then(fn).then(function (r) {
            if (r && r.ok) {
              var said = done(r);
              if (opts.after) { opts.after(r, said); return; }
              msg.textContent = said; msg.className = 'pg-msg ok';
              return;
            }
            msg.textContent = sorry(r && r.why); msg.className = 'pg-msg err';
            for (var j = 0; j < all.length; j++) all[j].disabled = false;
          }, function () {
            msg.textContent = sorry('offline'); msg.className = 'pg-msg err';
            for (var j = 0; j < all.length; j++) all[j].disabled = false;
          });
        });
        return b;
      };
      if (opts.onConfirm) acts.appendChild(mk('Confirm delivery', 'btn-gold pg-confirm', opts.onConfirm, function () {
        return 'Thank you. Your order is marked delivered.';
      }));
      if (opts.onExtend && ex.can) acts.appendChild(mk('Ask for more time', 'btn-outline pg-extend', opts.onExtend, function (r) {
        var np = (r && r.progress) || {};
        return 'Done: ' + ex.days + ' more days. It will now be marked delivered on ' + when(np.autoAt) + '.';
      }));
      box.appendChild(acts);
    }
    box.appendChild(msg);
    host.appendChild(box);
    return box;
  }

  function sorry(why) {
    if (why === 'no_more_time') return 'More time has been given as often as it can be. Please contact the shop.';
    if (why === 'not_on_its_way') return 'This order is no longer on its way, so there is nothing to confirm. Reload to see where it is.';
    if (why === 'signin') return 'Please sign in again, then try once more.';
    if (why === 'not_found') return 'This order could not be found.';
    return 'That did not go through. Check the internet and try again.';
  }

  window.VBP_PROGRESS = { LABELS: LABELS, fromRow: fromRow, steps: steps, headline: headline,
                          badgeClass: badgeClass, when: when, draw: draw, sorry: sorry };
})();
