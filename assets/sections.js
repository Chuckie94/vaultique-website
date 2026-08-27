/* =====================================================================
   Vaultique Boutique Point - the homepage, section by section
   ---------------------------------------------------------------------
   One list, shared by the storefront and the admin, of everything that
   sits between the hero and the footer. The order below is the order the
   page ships in; Settings > Homepage stores the shop's own order over
   the top of it.

   The hero is not in the list. It is the frame rather than the contents,
   and it has its own switch in the same section.

   Adding a section later means adding a row here and giving the markup a
   matching id. A shop's saved order keeps whatever it knew about and
   picks up anything new at the position set here, so nobody has to
   re-save when the site gains a section.
   ===================================================================== */
(function () {
  'use strict';

  var SECTIONS = [
    { id: 'trustbar',        label: 'Trust bar',
      note: 'The narrow strip of promises directly under the hero.' },
    { id: 'collections-sec', label: 'Featured categories' },
    { id: 'sec-featured',    label: 'Featured products', row: true },
    { id: 'sec-new',         label: 'New arrivals', row: true },
    { id: 'sec-best',        label: 'Best sellers', row: true,
      note: 'Shows the pieces ticked as Best Seller in Products & Photos.' },
    { id: 'sec-women',       label: "Women's", row: true },
    { id: 'philosophy',      label: 'Philosophy band' },
    { id: 'sec-men',         label: "Men's", row: true },
    { id: 'sec-acc',         label: 'Accessories', row: true },
    { id: 'promo',           label: 'Promotional banner',
      note: 'Off until you give it something to say in the section above.' },
    { id: 'why',             label: 'Why Vaultique' },
    { id: 'story',           label: 'Our story' },
    { id: 'values-sec',      label: 'Core values' },
    { id: 'reviews',         label: 'Testimonials' },
    { id: 'lookbook',        label: 'Lookbook' },
    { id: 'care',            label: 'Customer care' },
    { id: 'rewards',         label: 'Rewards programme' },
    { id: 'wabanner',        label: 'WhatsApp banner' },
    { id: 'newsletter',      label: 'Newsletter' },
    { id: 'visit',           label: 'Find us' }
  ];

  function known(id) {
    for (var i = 0; i < SECTIONS.length; i++) if (SECTIONS[i].id === id) return SECTIONS[i];
    return null;
  }

  /* A shop's saved list, reconciled with the list above. Anything saved
     that no longer exists is dropped; anything new is inserted where this
     file puts it, rather than being appended to the end where it would
     look like an afterthought. */
  function reconcile(saved) {
    var out = [], seen = {};
    (Array.isArray(saved) ? saved : []).forEach(function (row) {
      if (!row || !row.id || seen[row.id] || !known(row.id)) return;
      seen[row.id] = true;
      out.push({
        id: row.id,
        on: row.on !== false,
        title: row.title || '',
        desc: row.desc || ''
      });
    });
    SECTIONS.forEach(function (def, i) {
      if (seen[def.id]) return;
      out.splice(Math.min(i, out.length), 0, { id: def.id, on: true, title: '', desc: '' });
    });
    return out;
  }

  window.VBP_SECTIONS = {
    ALL: SECTIONS,
    known: known,
    reconcile: reconcile
  };
})();
