/* =====================================================================
   Vaultique Boutique Point - order messages
   ---------------------------------------------------------------------
   The words the shop sends a customer as their order moves along, and
   the one place that turns a template into a finished message.

   Shared by the admin's Orders tab (where the messages are actually
   sent) and Settings > Notifications (where they are written), so the
   preview an owner edits against is produced by the same code that
   sends the real thing. Two copies of this would be two sets of wording
   free to drift apart.

   A note on how these reach a customer. The shop's whole checkout runs
   through WhatsApp: the customer taps a product, WhatsApp opens with a
   message already written, and the conversation carries the sale. These
   messages follow the same path - changing an order's status offers the
   matching message, one tap, in the same thread the order came from.
   Nothing is sent behind the shop's back, which for a boutique where
   every order is a conversation is the right way round.

   Placeholders any template may use:

     {name}        the customer's first name
     {business}    the shop's name
     {ref}         the order reference, e.g. VB-3F9K
     {total}       the order total, already formatted as money
     {items}       the items, one per line
     {fulfilment}  'delivery' or 'collection', in words
   ===================================================================== */
(function () {
  'use strict';

  /* Every state an order can be in, in the order it moves through them.

     'completed' is not offered as a step because it is not one - it is
     what older orders were marked before this list grew, and it is kept
     so those orders still read correctly rather than being silently
     rewritten to something they never were. */
  var FLOW = ['pending', 'confirmed', 'ready', 'dispatched', 'delivered', 'cancelled'];
  var LEGACY = ['completed'];

  var LABELS = {
    pending:    'Received',
    confirmed:  'Confirmed',
    ready:      'Ready',
    dispatched: 'On its way',
    delivered:  'Delivered',
    cancelled:  'Cancelled',
    completed:  'Completed'
  };

  /* What each status is called where an owner is choosing one. */
  var CHOICES = {
    pending:    'Received — not yet confirmed',
    confirmed:  'Confirmed — we have it in hand',
    ready:      'Ready — waiting for collection',
    dispatched: 'On its way — out for delivery',
    delivered:  'Delivered — the customer has it',
    cancelled:  'Cancelled',
    completed:  'Completed (older orders)'
  };

  var STARTER = {
    pending:
      'Hello {name}, thank you for your order with {business}.\n\n' +
      'Order {ref}\n{items}\nTotal: {total}\n\n' +
      'We are checking availability now and will confirm shortly.',

    confirmed:
      'Hello {name}, good news — your order {ref} is confirmed.\n\n' +
      '{items}\nTotal: {total}\n\n' +
      'We will let you know the moment it is ready.',

    ready:
      'Hello {name}, your order {ref} is ready for collection.\n\n' +
      'Please come through any time we are open, and ask for your order by ' +
      'reference. We look forward to seeing you.',

    dispatched:
      'Hello {name}, your order {ref} is on its way to you today.\n\n' +
      'Our driver will call you on this number when they are close.',

    delivered:
      'Hello {name}, your order {ref} has been delivered. Thank you for ' +
      'shopping with {business} — we hope you love it.\n\n' +
      'If anything is not right, reply here and we will put it straight.',

    cancelled:
      'Hello {name}, your order {ref} has been cancelled as discussed, and ' +
      'nothing has been charged.\n\n' +
      'Thank you for your patience, and do let us know if we can help with ' +
      'anything else.'
  };

  /* Older orders were marked completed where today they would be
     delivered, so they borrow that wording rather than having none. */
  STARTER.completed = STARTER.delivered;

  function fill(template, vars) {
    return String(template || '').replace(/\{(\w+)\}/g, function (whole, key) {
      return Object.prototype.hasOwnProperty.call(vars || {}, key) && vars[key] !== undefined
        ? String(vars[key]) : whole;
    });
  }

  /* Just the first name: "Hello Chanda" reads like a person wrote it,
     "Hello Chanda Mwansa" reads like a system did. */
  function firstName(full) {
    var s = String(full || '').trim();
    if (!s) return 'there';
    return s.split(/\s+/)[0];
  }

  function itemLines(items, money) {
    var list = items || [];
    if (!list.length) return '';
    return list.map(function (it) {
      var qty = Number(it.qty) || 1;
      var name = it.name || it.sku || 'Item';
      var price = money ? money(it.price) : '';
      return '• ' + (qty > 1 ? qty + ' × ' : '') + name + (price ? ' — ' + price : '');
    }).join('\n');
  }

  /* The template for one status, falling back to the starter wording so
     a status whose message was never written still says something
     sensible rather than sending an empty WhatsApp. */
  function template(status, settings) {
    var s = settings || {};
    var key = 'msg' + String(status || 'pending').charAt(0).toUpperCase() +
              String(status || 'pending').slice(1);
    var written = s[key];
    if (typeof written === 'string' && written.trim()) return written;
    return STARTER[status] || STARTER.pending;
  }

  /* Whether the shop asked to be offered a message for this status. */
  function enabled(status, settings) {
    var s = settings || {};
    if (s.whatsappEnabled === false) return false;
    var key = 'on' + String(status || '').charAt(0).toUpperCase() +
              String(status || '').slice(1);
    return s[key] !== false;
  }

  /* A finished message, ready to send. */
  function messageFor(status, order, settings, opts) {
    var o = order || {}, x = opts || {};
    return fill(template(status, settings), {
      name: firstName(o.name),
      business: x.business || 'us',
      ref: o.ref || '',
      total: x.money ? x.money(o.total) : (o.total != null ? String(o.total) : ''),
      items: itemLines(o.order_items || o.items, x.money),
      fulfilment: o.fulfilment === 'collection' ? 'collection' : 'delivery'
    });
  }

  /* A wa.me link carrying the message. Returns '' with no usable number,
     so a caller cannot accidentally build a link to nowhere. */
  function link(phone, text) {
    var num = String(phone || '').replace(/[^0-9]/g, '');
    if (num.length < 7) return '';
    return 'https://wa.me/' + num + (text ? '?text=' + encodeURIComponent(text) : '');
  }

  var api = {
    FLOW: FLOW, LEGACY: LEGACY, LABELS: LABELS, CHOICES: CHOICES, STARTER: STARTER,
    fill: fill, firstName: firstName, itemLines: itemLines,
    template: template, enabled: enabled, messageFor: messageFor, link: link
  };

  if (typeof window !== 'undefined') window.VBP_NOTIFY = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
