/* =====================================================================
   Vaultique Boutique Point — live chat, the customer's side
   ---------------------------------------------------------------------
   The button in the corner, the window it opens, and the conversation
   inside it. Phase 1: a customer writes, the shop answers in the admin,
   and each sees the other's words.

   WHAT THIS DOES NOT DO. It takes no payment and asks for no card. It
   does not touch the POS, the cart or the WhatsApp checkout, all of
   which carry on exactly as before. WhatsApp is still where an order is
   sent; this is for the questions that come before one.

   HOW A GUEST CHATS SAFELY. Most people who write to the shop will not
   have an account, so there is no signed-in identity to key a database
   rule on. Instead, supabase-chat.sql keeps both tables shut to the
   anon key entirely, and opens four functions in the wall: start, send,
   poll and seen. Each asks for a token — 24 random bytes the SERVER
   made when the conversation started, handed once to this browser and
   kept in localStorage. Holding the token is what proves this browser
   owns this conversation. It is a password, so it is never put in a
   URL, never sent anywhere else, and never shown on the page.

   WHY IT POLLS RATHER THAN HOLDING A SOCKET. Supabase's realtime feed
   answers to the same row rules as everything else, and those rules
   say a guest may not read these tables directly — which is exactly
   what keeps one customer out of another's conversation. So the window
   asks, every few seconds while it is open and more slowly while it is
   not. At three seconds a reply lands about as fast as one arrives in
   any messaging app, and nothing about the schema would have to change
   to move to a socket later if the shop ever signs its customers in.
   ===================================================================== */
(function () {
  'use strict';

  /* ---------------------------------------------------------- settings */
  var MEMO       = 'vbp_chat';     // { token, at } for this browser

  /* How long a browser goes on remembering a conversation.
  
     The token is what proves this browser owns a conversation, and it
     has to outlive a page load or a customer loses their thread the
     moment they click anything. But a browser is not a person: a shop
     laptop, a tablet on the counter, a shared computer — the next person
     to open the site would otherwise inherit the last one's
     conversation, unread badge and all, and be able to read every word
     of it.
  
     So it is remembered for a working stretch and no longer, and it is
     forgotten outright once the conversation is closed. A customer
     coming back the same afternoon still finds their thread; a stranger
     the next morning gets a clean window. */
  var REMEMBER_FOR = 4 * 60 * 60 * 1000;   // Settings > Live Chat may change this
  var OPEN_EVERY = 3000;           // asking, with the window open
  var IDLE_EVERY = 25000;          // asking, with it closed
  var MAX_LEN    = 2000;           // the database trims here too

  var CFG = (window.VBP_CONFIG &&
             window.VBP_CONFIG.SUPABASE_URL &&
             window.VBP_CONFIG.SUPABASE_ANON_KEY) ? window.VBP_CONFIG : null;

  /* ------------------------------------------------- the shop's answers
     Settings > Live Chat. Read here rather than handed over by app.js,
     for the same reason everything else in this file is: the window is
     self-contained and works on a page that never finished loading the
     rest of the storefront.

     Every one of these has a built-in value identical to the admin
     section's default, so a shop that has never opened that page sees
     exactly what it saw before. */
  var SET = {
    enabled: true,
    title: 'Chat with us',
    hereText: 'Someone is here now',
    awayText: 'Leave a message — we will reply as soon as we are back',
    intro: 'Ask us anything — sizes, fit, colours, delivery, or a piece you ' +
           'cannot find. A member of the team will reply here.',
    placeholder: 'Write a message',
    askName: true,
    askNameText: 'Who are we speaking to?',
    useHours: false,
    hours: null,
    hideOutsideHours: false,
    outsideHoursText: 'We are closed just now — leave a message and we will reply when we open',
    waHandover: true,
    rememberHours: 4
  };

  /* The shop's own clock, needed the moment chat hours are used. Without
     it nowInZone falls back to UTC, which is two hours off in Lusaka —
     a chat set to open at eight would have been answering at six. */
  var TZ = '';

  function settingsRow(key) {
    return fetch(CFG.SUPABASE_URL + '/rest/v1/site_settings?key=eq.' + key + '&select=data', {
      headers: { apikey: CFG.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + CFG.SUPABASE_ANON_KEY }
    })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) { return (rows && rows[0] && rows[0].data) || null; })
      .catch(function () { return null; });
  }

  function loadSettings() {
    if (!CFG) return Promise.resolve();
    return Promise.all([settingsRow('chat'), settingsRow('general')])
      .then(function (both) {
        var d = both[0];
        if (d) {
          for (var k in d) {
            if (Object.prototype.hasOwnProperty.call(d, k) &&
                d[k] !== null && d[k] !== undefined) SET[k] = d[k];
          }
          var hrs = Number(SET.rememberHours);
          if (isFinite(hrs) && hrs > 0) REMEMBER_FOR = hrs * 60 * 60 * 1000;
        }
        TZ = (both[1] && both[1].timezone) || '';
      })
      /* Unreachable settings are not a reason to have no chat. The
         built-in wording is the wording this file shipped with. */
      .catch(function () {});
  }

  /* Whether chat is being offered at this moment, by the clock the shop
     set. Worked out with the same function the storefront uses for
     trading hours, so "open" means the same thing in both places. */
  function withinHours() {
    if (!SET.useHours || !SET.hours) return true;
    var F = window.VBP_FORMAT;
    if (!F || !F.openState) return true;      // cannot tell, so do not refuse
    var st = F.openState(SET.hours, TZ);
    return st && st.known ? !!st.open : true;
  }

  /* ------------------------------------------------------------- state */
  var token   = null;      // this browser's proof it owns a conversation
  var msgs    = [];        // everything shown, oldest first
  var lastAt  = null;      // the newest timestamp we hold, for the next ask
  var unread  = 0;         // replies that arrived while the window was shut
  var seen    = false;     // the shop has read what was said to it
  var here    = false;     // somebody is at the desk to answer
  var typing  = false;     // somebody at the shop is writing, as of a moment ago
  var saidTypingAt = 0;    // when we last told them we are
  var status  = 'open';    // open | closed, as the shop left it
  var open    = false;
  var timer   = null;
  var sending = false;
  var started = false;     // whether a conversation exists yet
  var named   = true;      // whether the shop knows who it is speaking to
  var asked   = false;     // whether we have already offered the name box

  /* ------------------------------------------------------------ helpers */
  function $(s, r) { return (r || document).querySelector(s); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* localStorage can be switched off, and in a preview frame it throws
     rather than returning nothing. The chat degrades to this-page-only
     rather than breaking the page it sits on. */
  var mem = {};
  function memoGet() {
    try { return JSON.parse(localStorage.getItem(MEMO) || 'null') || null; }
    catch (e) { return mem[MEMO] || null; }
  }
  function memoSet(v) {
    /* Stamped as it is written, so that reading it can tell a
       conversation somebody is having from one somebody had. */
    var withTime = v ? { token: v.token, at: Date.now() } : null;
    try { localStorage.setItem(MEMO, JSON.stringify(withTime)); }
    catch (e) { mem[MEMO] = withTime; }
  }
  /* The remembered conversation, or nothing if it has gone stale. An old
     one is cleared rather than merely ignored, so it cannot come back. */
  function memoFresh() {
    var saved = memoGet();
    if (!saved || !saved.token) return null;
    var at = Number(saved.at) || 0;
    if (!at || (Date.now() - at) > REMEMBER_FOR) { memoSet(null); return null; }
    return saved;
  }

  /* The signed-in customer's own token where there is one, the anon key
     where there is not. It is what lets the database tell a customer
     from a stranger — chat_claim and chat_resume answer only to
     somebody it can recognise, and to a guest they simply do nothing. */
  function bearer() {
    try {
      var A = window.VBP_ACCOUNT;
      var t = A && A.accessToken && A.accessToken();
      if (t) return t;
    } catch (e) {}
    return CFG.SUPABASE_ANON_KEY;
  }

  /* Every call is one POST to a function. The tables behind them cannot
     be reached this way at all, which is the point. */
  function rpc(fn, args) {
    if (!CFG) return Promise.reject(new Error('no backend'));
    return fetch(CFG.SUPABASE_URL + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: {
        'apikey': CFG.SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + bearer(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(args || {})
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error(t || r.status); });
      return r.status === 204 ? null : r.json();
    });
  }

  /* Where the customer is, in words an operator can act on. Read from
     the page rather than tracked: it is whatever the site is already
     showing, and it is only ever sent while a conversation is open. */
  function whereTheyAre() {
    var path = location.pathname + location.hash;
    var m = path.match(/\/product\/([^?#/]+)/);
    if (m) {
      var sku = decodeURIComponent(m[1]);
      var h1 = document.querySelector('#view-detail h1');
      var name = h1 ? h1.textContent.trim() : '';
      return name ? name + ' (' + sku + ')' : 'Product ' + sku;
    }
    var cat = path.match(/\/shop\/([^?#]+)/);
    if (cat) return 'Shop \u00b7 ' + decodeURIComponent(cat[1]);
    if (/\/shop\b/.test(path)) return 'Shop';
    if (/\/wishlist\b/.test(path)) return 'Wishlist';
    if (/\/account\b/.test(path)) return 'Their account';
    if (/\/policies/.test(path)) return 'Policies';
    return 'Home page';
  }

  function timeOf(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var h = d.getHours(), m = d.getMinutes();
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  /* ------------------------------------------------------------ markup */
  function build() {
    var btn = $('#chatFab');
    var panel = $('#chatPanel');
    if (!btn || !panel) return false;

    btn.addEventListener('click', function () { open ? close() : show(); });
    /* The cross ends the conversation and the dash puts it away. The
       dash is what the cross used to do; keeping both means nobody
       loses a conversation reaching for the corner of the screen. */
    $('#chatClose', panel).addEventListener('click', endChat);
    var mini = $('#chatMin', panel);
    if (mini) mini.addEventListener('click', close);

    var form = $('#chatForm', panel);
    form.addEventListener('submit', function (e) { e.preventDefault(); send(); });

    var box = $('#chatInput', panel);
    box.setAttribute('maxlength', MAX_LEN);
    /* Enter sends, shift+Enter starts a line: what every messaging app
       does, and what a customer's hands already expect. */
    box.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    box.addEventListener('input', function () { grow(); sayTyping(); });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && open) close();
    });
    return true;
  }

  /* Telling the shop somebody is writing.

     Once every two seconds at most. A person types many times faster
     than that, and the shop's side only needs to know it happened
     recently — not how many keys were pressed. Nothing is sent before a
     conversation exists, so a visitor who types a word and thinks better
     of it still costs the database nothing. */
  function sayTyping() {
    if (!token || status !== 'open') return;
    var now = Date.now();
    if (now - saidTypingAt < 2000) return;
    saidTypingAt = now;
    rpc('chat_typing', { p_token: token }).catch(function () {});
  }

  /* The box grows with what is being typed, up to a point, so a long
     question is visible while it is being written. */
  function grow() {
    var box = $('#chatInput');
    if (!box) return;
    box.style.height = 'auto';
    box.style.height = Math.min(box.scrollHeight, 96) + 'px';
  }

  /* ------------------------------------------------------------ drawing */
  function paintBadge() {
    var b = $('#chatCount');
    if (!b) return;
    b.textContent = unread;
    b.style.display = unread ? 'flex' : 'none';
    var fab = $('#chatFab');
    if (fab) {
      fab.setAttribute('aria-label',
        unread ? 'Chat with us, ' + unread + (unread === 1 ? ' new reply' : ' new replies')
               : 'Chat with us');
    }
  }

  /* Whether there is anybody there to answer, said plainly. Before the
     first ask there is nothing to say, so the invitation stays. */
  function paintPresence() {
    var dot = $('#chatDot'), sub = $('#chatSub');
    if (!dot || !sub) return;
    dot.hidden = false;
    dot.className = 'chat-dot' + (here ? ' on' : '');
    dot.setAttribute('title', here ? 'Someone is at the desk' : 'Nobody is at the desk right now');
    sub.textContent = here ? SET.hereText
                           : (SET.useHours && !withinHours() ? SET.outsideHoursText
                                                             : SET.awayText);
  }

  function paint() {
    var log = $('#chatLog');
    if (!log) return;

    if (!msgs.length) {
      log.innerHTML = '';
      var intro = el('div', 'chat-intro');
      intro.appendChild(el('p', null, SET.intro));
      log.appendChild(intro);
      return;
    }

    log.innerHTML = '';
    var lastDay = '';
    msgs.forEach(function (m) {
      var d = new Date(m.at);
      var day = isNaN(d.getTime()) ? '' : d.toDateString();
      if (day && day !== lastDay) {
        lastDay = day;
        log.appendChild(el('div', 'chat-day', dayLabel(d)));
      }
      var row = el('div', 'chat-msg ' + (m.sender === 'shop' ? 'from-shop' : 'from-me'));
      if (m.body) row.appendChild(el('div', 'chat-bubble', m.body));
      var card = cardFor(m.meta);
      if (card) row.appendChild(card);
      row.appendChild(el('div', 'chat-at', timeOf(m.at)));
      log.appendChild(row);
    });

    /* Where their last message has got to. Only ever under their own,
       because that is the only one whose progress they cannot see for
       themselves, and only the last, because a column of the same word
       tells nobody anything.

       Three states, and they are the three a person actually wants:
       still going, arrived but nobody has picked it up, and read. A
       message still on its way carries an id this page made up. */
    var last = msgs[msgs.length - 1];
    if (last && last.sender !== 'shop') {
      var state = String(last.id).charAt(0) === 'p' ? 'Sending…'
                : seen ? 'Seen'
                : 'Queued';
      var line = el('div', 'chat-seen' + (state === 'Seen' ? ' is-seen' : ''), state);
      line.setAttribute('title', state === 'Queued'
        ? 'Delivered. Nobody has picked it up yet — we will reply here.'
        : (state === 'Seen' ? 'Somebody at the shop has read this.' : 'Still sending.'));
      log.appendChild(line);
    }

    if (status === 'closed') {
      log.appendChild(el('div', 'chat-day',
        'This conversation was closed. Write again to start a new one.'));
    }
    log.scrollTop = log.scrollHeight;
    /* The log was just emptied and refilled, so the dot goes back if
       somebody is still writing. Last, because it stands where their
       message will land. */
    paintTyping();
    paintHandover();
  }

  /* Somebody at the shop is writing. A dot and nothing else — no words,
     because there is nothing to say that the dot does not. */
  function paintTyping() {
    var log = $('#chatLog');
    if (!log) return;
    var dot = log.querySelector('.chat-typing');
    if (!typing || status === 'closed') {
      if (dot) dot.parentNode.removeChild(dot);
      return;
    }
    if (!dot) {
      dot = el('div', 'chat-typing');
      /* Announced to a screen reader, which cannot see it breathe. */
      dot.setAttribute('role', 'status');
      dot.setAttribute('aria-label', 'Someone at the shop is typing');
      /* Not chat-dot — that is the header's at-the-desk light. */
      dot.appendChild(el('span', 'chat-typing-dot'));
    }
    log.appendChild(dot);
    /* Only follow it down if they were already at the bottom: somebody
       reading back through the conversation should not be dragged
       away from it by a dot. */
    var near = log.scrollHeight - log.scrollTop - log.clientHeight;
    if (near < 80) log.scrollTop = log.scrollHeight;
  }

  /* What the shop attached, if anything. Only the shop can attach: see
     the note in supabase-chat-phase4.sql. An unknown kind draws nothing
     rather than guessing, so an older page meeting a newer message
     shows the words and skips the rest. */
  function cardFor(meta) {
    if (!meta || typeof meta !== 'object') return null;
    if (meta.kind === 'image')   return imageCard(meta);
    if (meta.kind === 'product') return productCard(meta);
    if (meta.kind === 'order')   return orderCard(meta);
    return null;
  }

  /* The address is built here from this shop's own project and the path
     stored on the message, so a row can never point a customer at
     somebody else's server. */
  function imageUrl(path) {
    return CFG.SUPABASE_URL.replace(/\/+$/, '') +
           '/storage/v1/object/public/chat-uploads/' + String(path || '');
  }
  function imageCard(meta) {
    if (!meta.path) return null;
    var wrap = el('a', 'chat-card chat-photo');
    wrap.href = imageUrl(meta.path);
    wrap.target = '_blank';
    wrap.rel = 'noopener';
    var img = document.createElement('img');
    img.alt = 'Photo from the shop';
    img.loading = 'lazy';
    img.src = imageUrl(meta.path);
    wrap.appendChild(img);
    return wrap;
  }

  function productCard(meta) {
    if (!meta.sku && !meta.name) return null;
    var a = el('a', 'chat-card chat-prod');
    a.href = (window.VBP_BASE || '/') + 'product/' + encodeURIComponent(meta.sku || '');
    if (meta.image) {
      var im = document.createElement('img');
      im.alt = ''; im.loading = 'lazy'; im.src = meta.image;
      a.appendChild(im);
    }
    var txt = el('span', 'chat-card-txt');
    txt.appendChild(el('span', 'chat-card-n', meta.name || meta.sku));
    if (meta.price) txt.appendChild(el('span', 'chat-card-p', meta.price));
    txt.appendChild(el('span', 'chat-card-go', 'View this piece'));
    a.appendChild(txt);
    return a;
  }

  function orderCard(meta) {
    if (!meta.ref) return null;
    var box = el('div', 'chat-card chat-order');
    var txt = el('span', 'chat-card-txt');
    txt.appendChild(el('span', 'chat-card-n', 'Order ' + meta.ref));
    if (meta.status) {
      txt.appendChild(el('span', 'chat-card-s ' + 'is-' + String(meta.status).replace(/\W+/g, ''),
                          orderWords(meta.status)));
    }
    if (meta.total) txt.appendChild(el('span', 'chat-card-p', meta.total));
    box.appendChild(txt);
    return box;
  }
  /* The shop's own words for where an order has got to, matching the
     ones the admin uses, so a customer is not shown a database value. */
  function orderWords(status) {
    var say = {
      pending: 'Received', confirmed: 'Confirmed', ready: 'Ready for you',
      dispatched: 'On its way', delivered: 'Delivered',
      cancelled: 'Cancelled', completed: 'Completed'
    };
    return say[String(status).toLowerCase()] || String(status);
  }

  function dayLabel(d) {
    var today = new Date();
    var same = d.toDateString() === today.toDateString();
    if (same) return 'Today';
    var y = new Date(today.getTime() - 86400000);
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    var F = window.VBP_FORMAT;
    return F && F.date ? F.date(d, 'D MMMM YYYY') : d.toDateString();
  }

  /* Offered once the customer has actually said something, never before:
     a name box in front of the question is a form, and a shop that puts
     a form in front of a question gets fewer questions. It can be
     ignored — the conversation works perfectly well without it — and it
     goes as soon as it is answered or dismissed. */
  /* The way out to WhatsApp, and the answer to "can I send you a
     picture". The shop already runs WhatsApp, it already handles photos
     well, and opening this site's storage to anonymous uploads to
     duplicate that would be a bill waiting to happen. The conversation
     is summarised into the message so the shop does not start again. */
  function waHandover() {
    var CT = window.VBP_CONTACT;
    var num = '';
    try {
      var C = (window.VBP_CHAT_CONTACT || {});
      num = C.orderNumber || C.whatsapp || '';
    } catch (e) {}
    if (!num) num = document.body.getAttribute('data-wa-number') || '';
    if (!num) {
      /* Read off a link the page is already showing rather than
         hardcoding a number the shop may have changed. */
      var a = document.querySelector('a[href*="wa.me/"]');
      var m = a && a.href.match(/wa\.me\/(\d+)/);
      num = m ? m[1] : '';
    }
    if (!num) return '';

    var said = msgs.filter(function (m) { return m.sender === 'customer' && m.body; })
                   .slice(-3).map(function (m) { return m.body; }).join(' / ');
    var text = 'Hello, I was chatting on your website' +
               (said ? ' about: ' + said : '') + '.';
    if (CT && CT.waUrl) return CT.waUrl(num, text);
    return 'https://wa.me/' + num + '?text=' + encodeURIComponent(text);
  }

  function paintHandover() {
    var host = $('#chatWa');
    if (!host) return;
    if (!SET.waHandover) { host.style.display = 'none'; return; }
    var url = waHandover();
    if (!url || !msgs.length) { host.style.display = 'none'; return; }
    host.style.display = 'block';
    if (host.dataset.built === '1') { host.querySelector('a').href = url; return; }
    host.dataset.built = '1';
    host.innerHTML = '<a target="_blank" rel="noopener">Need to send a photo? Continue on WhatsApp</a>';
    host.querySelector('a').href = url;
  }

  function paintAsk() {
    var host = $('#chatAsk');
    if (!host) return;
    var wanted = SET.askName && !named && msgs.length > 0 && !asked && status === 'open';
    if (!wanted) { host.style.display = 'none'; host.innerHTML = ''; return; }
    if (host.dataset.built === '1') { host.style.display = 'block'; return; }

    host.dataset.built = '1';
    host.style.display = 'block';
    host.innerHTML =
      '<span class="chat-ask-q"></span>' +
      '<span class="chat-ask-row">' +
        '<input id="chatWho" type="text" maxlength="60" placeholder="Your name" ' +
               'autocomplete="given-name" aria-label="Your name">' +
        '<button type="button" id="chatWhoOk" class="chat-ask-ok">Save</button>' +
        '<button type="button" id="chatWhoNo" class="chat-ask-no">Not now</button>' +
      '</span>';

    /* Set as text rather than written into the markup: it is the shop's
       wording, and the shop's wording is not this file's HTML. */
    var q = host.querySelector('.chat-ask-q');
    if (q) q.textContent = SET.askNameText;

    var box = $('#chatWho', host);
    function keep() {
      var v = (box.value || '').trim();
      if (!v) { drop(); return; }
      named = true; asked = true;
      paintAsk();
      rpc('chat_identify', { p_token: token, p_name: v }).catch(function () {});
    }
    function drop() { asked = true; paintAsk(); }

    $('#chatWhoOk', host).addEventListener('click', keep);
    $('#chatWhoNo', host).addEventListener('click', drop);
    box.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); keep(); }
    });
  }

  function say(text, kind) {
    var n = $('#chatNote');
    if (!n) return;
    n.textContent = text || '';
    n.className = 'chat-note' + (kind ? ' ' + kind : '');
    n.style.display = text ? 'block' : 'none';
  }

  /* ------------------------------------------------------------ opening */
  /* On a phone the window takes the whole screen, and a page quietly
     scrolling behind it is disorienting. On a computer it is a card in
     the corner with the shop still visible around it, where locking the
     page would be wrong. */
  function fullScreen() {
    try { return window.matchMedia('(max-width: 560px)').matches; }
    catch (e) { return false; }
  }

  function show() {
    var panel = $('#chatPanel');
    if (!panel) return;
    open = true;
    if (fullScreen()) document.body.style.overflow = 'hidden';
    /* Signed in on a device that has never chatted? This is where their
       conversation comes back, rather than at start-up only: by the time
       somebody opens the window they have usually just signed in. */
    followTheCustomer();
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    var fab = $('#chatFab');
    if (fab) fab.classList.add('is-open');
    paint();
    markSeen();
    beat();
    var box = $('#chatInput');
    if (box) setTimeout(function () { box.focus(); }, 80);
  }

  /* Minimising is what the cross used to do: the window goes away and
     the conversation does not. Ending it is the new one, and it is a
     different thing, so it asks first — a tap meant for the corner of
     the screen should not throw away what somebody was saying. */
  /* Asked inside the panel rather than through the browser's confirm
     box. The rest of this window is the shop's; a grey system dialog
     saying the site's domain name in the middle of it is not, and on a
     phone it takes over the whole screen for a question about a chat.

     Resolves false if anything is missing, which is the safe way round:
     a question that cannot be asked has not been answered yes. */
  function askInPanel(question, yesText) {
    var panel = $('#chatPanel');
    if (!panel) return Promise.resolve(false);
    return new Promise(function (resolve) {
      /* chat-confirm, not chat-ask: the panel already has a chat-ask —
         the "Who are we speaking to?" box — and reusing the name would
         have put this one's dark backdrop behind that one. */
      var back = el('div', 'chat-confirm');
      var card = el('div', 'chat-confirm-card');
      card.appendChild(el('p', 'chat-confirm-q', question));
      var row = el('div', 'chat-confirm-row');
      var no = el('button', 'chat-confirm-no', 'Keep it open');
      var yes = el('button', 'chat-confirm-yes', yesText || 'Yes');
      no.type = 'button'; yes.type = 'button';
      row.appendChild(no); row.appendChild(yes);
      card.appendChild(row);
      back.appendChild(card);
      panel.appendChild(back);
      no.focus();

      function done(answer) {
        document.removeEventListener('keydown', onKey, true);
        if (back.parentNode) back.parentNode.removeChild(back);
        resolve(answer);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); done(false); return; }
        if (e.key !== 'Tab') return;
        /* Two buttons and nothing else: the ring stays between them. */
        if (e.shiftKey && document.activeElement === no) { e.preventDefault(); yes.focus(); }
        else if (!e.shiftKey && document.activeElement === yes) { e.preventDefault(); no.focus(); }
      }
      document.addEventListener('keydown', onKey, true);
      no.addEventListener('click', function () { done(false); });
      yes.addEventListener('click', function () { done(true); });
      back.addEventListener('click', function (e) { if (e.target === back) done(false); });
    });
  }

  function endChat() {
    if (!token) { close(); return; }
    if (!msgs.length) return finishChat();
    askInPanel('End this chat? You can always start another.', 'End it')
      .then(function (yes) { if (yes) finishChat(); });
  }
  function finishChat() {
    var t = token;
    rpc('chat_end', { p_token: t }).catch(function () {});
    token = null; memoSet(null); msgs = []; lastAt = null;
    unread = 0; started = false; seen = false; status = 'open';
    paintBadge(); paint();
    close();
  }

  function close() {
    var panel = $('#chatPanel');
    if (!panel) return;
    open = false;
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    var fab = $('#chatFab');
    if (fab) { fab.classList.remove('is-open'); fab.focus(); }
    beat();
  }

  /* --------------------------------------------------------- the talking */
  function send() {
    var box = $('#chatInput');
    if (!box || sending) return;
    var body = box.value.replace(/\s+$/, '');
    if (!body.trim()) return;

    sending = true;
    say('');
    box.value = '';
    grow();

    /* Shown before it is sent. A message that sat there doing nothing
       while the network thought about it would read as a failure. */
    var pending = { id: 'p' + Date.now(), sender: 'customer', body: body, at: new Date().toISOString() };
    msgs.push(pending);
    paint();

    ensureConversation()
      .then(function () { return rpc('chat_send', { p_token: token, p_body: body }); })
      .then(function () {
        sending = false;
        /* Stamped again by the act of saying something, so a
           conversation somebody is actually having does not go stale
           underneath them four hours in. */
        if (token) memoSet({ token: token });
        followTheCustomer();
        /* The row the database actually stored replaces the stand-in on
           the next ask, timestamp and all. */
        return ask();
      })
      .catch(function (e) {
        sending = false;
        /* A conversation the shop closed reopens by being written in
           again, so that is worth one more try rather than an error. */
        if (String(e.message || '').indexOf('no open conversation') > -1) {
          return reopenAndResend(body);
        }
        msgs = msgs.filter(function (m) { return m.id !== pending.id; });
        paint();
        box.value = body;
        grow();
        say('That did not send. Check your connection and try again.', 'err');
      });
  }

  /* The shop closed the thread and the customer has more to say. Rather
     than telling them to start again, start one for them. */
  function reopenAndResend(body) {
    token = null;
    memoSet(null);
    started = false;
    return ensureConversation()
      .then(function () { return rpc('chat_send', { p_token: token, p_body: body }); })
      .then(function () { msgs = []; lastAt = null; status = 'open'; return ask(); })
      .catch(function () {
        say('That did not send. Check your connection and try again.', 'err');
      });
  }

  function ensureConversation() {
    if (token) return Promise.resolve(token);
    /* Whatever the shop already knows about a signed-in customer travels
       with the conversation, so the operator is not asking a name the
       site could have told them. A guest simply has none of this. */
    var who = {};
    try {
      var A = window.VBP_ACCOUNT;
      if (A && A.signedIn && A.signedIn()) {
        var pr = (A.state && A.state.profile) || {};
        who.p_name = pr.name || null;
        who.p_phone = pr.phone || null;
        who.p_email = (A.state.user && A.state.user.email) || null;
      }
    } catch (e) {}

    who.p_started_on = whereTheyAre();
    /* The database refuses a new conversation while the shop is shut.
       The owner testing carries the key that gets past it. */
    try {
      if (typeof window.VBP_PREVIEW === 'function') who.p_preview = window.VBP_PREVIEW() || null;
    } catch (e) {}

    return rpc('chat_start', who).then(function (t) {
      token = t;
      started = true;
      memoSet({ token: token });
      /* Until now there was no conversation to ask about, so beat() had
         nothing to start. There is one now: without this the first
         conversation a visitor ever has would sit there receiving
         nothing until they reloaded the page. */
      beat();
      followTheCustomer();
      return token;
    });
  }

  /* One ask: whatever is newer than what we hold, and the state around
     it. Nothing is requested before a conversation exists, so a visitor
     who never opens the chat costs the database nothing at all. */
  function ask() {
    if (!token) return Promise.resolve();
    return rpc('chat_poll', { p_token: token, p_after: lastAt, p_viewing: whereTheyAre() })
      .then(function (r) {
        if (!r) {                       // the shop deleted it: start clean
          token = null; memoSet(null); msgs = []; lastAt = null; unread = 0;
          started = false; paintBadge(); paint();
          return;
        }
        var wasSeen = seen;
        var was = status;
        status = r.status || 'open';
        /* Closed is finished. The window still shows it for as long as
           this page is open, so the customer sees what happened, but
           nothing is carried into the next page load — and so nothing is
           carried to whoever opens this browser next. */
        if (status === 'closed') memoSet(null);
        named = r.named !== false;
        seen = r.seen === true;
        here = r.here === true;
        var wasTyping = typing;
        typing = r.typing === true;
        paintPresence();
        /* On its own, so a dot appearing or going does not redraw the
           conversation underneath it. */
        if (typing !== wasTyping) paintTyping();
        var fresh = r.messages || [];
        if (fresh.length) {
          /* Anything still waiting on the network is dropped in favour
             of what the database says it stored. */
          msgs = msgs.filter(function (m) { return String(m.id).charAt(0) !== 'p'; });
          fresh.forEach(function (m) {
            if (!msgs.some(function (x) { return x.id === m.id; })) msgs.push(m);
          });
          msgs.sort(function (a, b) { return new Date(a.at) - new Date(b.at); });
          lastAt = msgs[msgs.length - 1].at;
          paint();
        } else if (status !== was || seen !== wasSeen) {
          /* The shop closing or reopening the thread changes what the
             window should say without adding a word to it. Drawing only
             on new messages would leave the customer reading a
             conversation that is no longer the one they are in. */
          paint();
        }
        /* After the messages are merged, never before: whether to offer
           the name box depends on whether anything has been said, and
           asking that question too early answers it wrongly. */
        paintAsk();
        unread = open ? 0 : Number(r.unread) || 0;
        paintBadge();
        if (open && Number(r.unread)) markSeen();
      })
      .catch(function () { /* one missed ask is not worth a message */ });
  }

  function markSeen() {
    if (!token || !unread && !open) return;
    unread = 0;
    paintBadge();
    rpc('chat_seen', { p_token: token }).catch(function () {});
  }

  /* A customer who signed in after starting as a guest, and a customer
     signing in on a second device. Both are asked of the database
     rather than worked out here: it answers only to a session it can
     recognise, and to a guest it does nothing at all. */
  function followTheCustomer() {
    var A = window.VBP_ACCOUNT;
    if (!A || !A.signedIn || !A.signedIn()) return;
    if (!A.accessToken || !A.accessToken()) return;

    if (token) {
      /* Theirs now, if it was nobody's. A conversation already claimed
         is left alone by the database, not by this. */
      rpc('chat_claim', { p_token: token }).catch(function () {});
      return;
    }
    /* Nothing in this browser: they may have been talking on another. */
    rpc('chat_resume', {}).then(function (t) {
      if (!t || token) return;
      token = t;
      started = true;
      memoSet({ token: token });
      lastAt = null;
      return ask().then(beat);
    }).catch(function () {});
  }

  /* Fast while somebody is reading, slow while nobody is. */
  function beat() {
    if (timer) clearInterval(timer);
    if (!token) return;
    timer = setInterval(ask, open ? OPEN_EVERY : IDLE_EVERY);
  }

  /* ------------------------------------------------------------ start up */
  function init() {
    /* No website Supabase project, no chat: there would be nowhere for a
       message to go. The button is not drawn rather than drawn dead. */
    if (!CFG) return;
    if (!build()) return;
    /* The window is built either way and shown afterwards, so the shop's
       wording is in place before anybody can open it. A button that
       appears and then changes what it says under the customer's hand is
       worse than one that appears a moment later. */
    loadSettings().then(start);
  }

  function start() {
    if (!SET.enabled) return;                       // chat is switched off
    if (SET.useHours && SET.hideOutsideHours && !withinHours()) return;

    var titleEl = document.querySelector('#chatPanel .chat-title');
    if (titleEl && SET.title) titleEl.textContent = SET.title;
    var inputEl = $('#chatInput');
    if (inputEl && SET.placeholder) inputEl.placeholder = SET.placeholder;
    var sub = $('#chatSub');
    if (sub && !started) sub.textContent = SET.useHours && !withinHours()
      ? SET.outsideHoursText : sub.textContent;

    var fab = $('#chatFab');
    if (fab) fab.classList.remove('hide');

    var saved = memoFresh();
    if (saved && saved.token) {
      token = saved.token;
      started = true;
      ask().then(beat);
    }

    /* The account layer arrives after this does, and a customer can sign
       in or out without the page reloading, so this is asked again each
       time that changes rather than once at start-up. */
    try {
      var A = window.VBP_ACCOUNT;
      if (A && A.onChange) A.onChange(followTheCustomer);
      followTheCustomer();
    } catch (e) {}

    /* A tab left open all afternoon should not keep asking. It catches
       up the moment it is looked at again. */
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { if (timer) clearInterval(timer); timer = null; }
      else if (token) { ask(); beat(); }
    });
  }

  /* Said by the storefront when it puts up a closed or maintenance
     notice. The panel is hidden by then; this is what stops it going on
     asking the database for messages nobody can read. */
  window.VBP_CHAT = window.VBP_CHAT || {};
  window.VBP_CHAT.standDown = function () {
    try { if (timer) clearInterval(timer); } catch (e) {}
    timer = null;
    try { close(); } catch (e) {}
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
