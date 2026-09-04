/* =====================================================================
   Vaultique Boutique Point — Admin > Live Chats
   ---------------------------------------------------------------------
   Where the shop answers. The conversations on the left, most recently
   spoken in first; the one being read on the right; and a box to reply
   in at the bottom of it.

   Unlike the customer's side, this page talks to the two tables
   directly. It may: chc_admin and chm_admin in supabase-chat.sql give
   a signed-in admin full access, and is_admin() asks the admins table
   rather than merely "is somebody signed in", so a customer account
   carries no power here. The customer's four functions exist because a
   guest has no such standing; an operator does.

   It polls rather than holding a socket, for the same reason the
   customer's side does, and so that both halves of the feature behave
   the same way and can be reasoned about together.

   Phase 3 adds the second person. A conversation can belong to one of
   you, be handed to another, and carry notes the customer never sees —
   those live in chat_notes, a table no customer-facing function
   mentions, so a note has no path to the person it is about.
   ===================================================================== */
(function () {
  'use strict';
  if (!window.VBP_ADMIN) return;

  var A = window.VBP_ADMIN;
  var LIST_EVERY = 6000;      // the left column, while the page is open
  var THREAD_EVERY = 3000;    // the conversation being read
  var PRESENCE_EVERY = 45000; // saying you are still at the desk
  var PAGE = 60;

  /* An agent counts as here if they said so recently. A browser closed
     without warning stops saying anything, and this is what makes that
     read as "gone" rather than as "online forever". */
  var HERE_WITHIN = 120000;
  /* Said something recently, whatever they said. This is the difference
     between somebody who is there and somebody whose browser was closed
     without warning. */
  function agentPresent(a) {
    return !!(a && a.status !== 'offline' && a.last_seen_at &&
              (Date.now() - new Date(a.last_seen_at).getTime()) < HERE_WITHIN);
  }
  /* And actually at the desk. "Away" used to count the same as "online"
     everywhere, which is why choosing it changed nothing anybody could
     see — not the presence bar, and not the light the customer's window
     shows. Away means present but not answering, and it should read
     that way to both. */
  function agentOnline(a) { return agentPresent(a) && a.status === 'online'; }
  function agentHere(a) { return agentPresent(a); }   // kept: older callers

  /* A conversation somebody has taken is theirs to answer, and phase 7
     makes that a rule in the database rather than an understanding
     between colleagues. The three ways out are written in
     chat_may_speak_in(); what follows is the same rule in the browser,
     so that the box goes grey with a reason on it instead of taking a
     reply and having the database throw it away.

     WHY IT IS SAID TWICE. It would be tidier to ask the database and
     paint the answer. But the answer changes while the panel is open —
     somebody goes away, five minutes pass — and asking on every keypress
     is a request per keypress. The rule is small enough to hold in both
     places; the database is the one that decides, and this one only
     decides what to draw. Both are tested against the same cases.

     FIVE MINUTES, AND ONLINE. Both match the SQL exactly. The presence
     bar's two minutes is right for a green light and wrong for taking
     work off somebody: a person reading a long message has not gone
     home. "Away" counts as gone because away means present and not
     answering, and a customer should not queue behind that. */
  var HOLD_WITHIN = 300000;
  function holderPresent(a) {
    return !!(a && a.status === 'online' && a.last_seen_at &&
              (Date.now() - new Date(a.last_seen_at).getTime()) < HOLD_WITHIN);
  }
  /* A name to answer to. The shop never typed one, so it is taken from
     the address they sign in with rather than left as a bare uuid. */
  function nameFromEmail(email) {
    var local = String(email || '').split('@')[0].replace(/[._-]+/g, ' ').trim();
    if (!local) return 'Agent';
    return local.charAt(0).toUpperCase() + local.slice(1);
  }

  /* Money, in the shop's own currency.

     Three figures are shown from here — an order in the customer's
     history, a piece being offered, an order being quoted — and all three
     used to be written with a hardcoded K and none of the shop's number
     format. A shop trading in dollars was quoted kwacha by its own chat
     window, which is the one place where the wrong symbol is said
     directly to a customer.

     Chats may be the first tab opened, so the two settings behind the
     figure are fetched here rather than borrowed from a tab that may
     never have run. The store caches them, so this is one read however
     many conversations are opened. */
  var moneyStyle = null;
  function plainStyle() {
    var F = window.VBP_FORMAT;
    return (F && F.moneyStyle) ? F.moneyStyle({}, {}) : null;
  }
  function loadMoney() {
    if (moneyStyle || !A.store) return Promise.resolve();
    return Promise.all([
      A.store.load('general').catch(function () { return {}; }),
      A.store.load('pricing').catch(function () { return {}; })
    ]).then(function (r) {
      var F = window.VBP_FORMAT;
      if (F && F.moneyStyle) moneyStyle = F.moneyStyle(r[0] || {}, r[1] || {});
    }, function () {});
  }
  function money(n) {
    if (n == null || n === '') return '';
    var F = window.VBP_FORMAT;
    if (!F || !F.money) return String(n);
    return F.money(n, moneyStyle || plainStyle());
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function clock(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  /* A list of conversations is read by scanning it, so each line says
     how long ago rather than a date to be decoded. */
  function ago(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var s = Math.max(0, (Date.now() - d.getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    var days = Math.floor(s / 86400);
    if (days < 7) return days + 'd ago';
    var F = window.VBP_FORMAT;
    return F && F.date ? F.date(d, 'D MMM YYYY') : d.toDateString();
  }
  function who(c) {
    return c.name || c.phone || c.email ||
           (c.customer_id ? 'Signed-in customer' : 'Someone browsing');
  }
  /* Whether the shop is speaking to somebody it already knows. An
     account is worth saying out loud: it means there is a history
     behind this conversation, and the operator can look it up. */
  function standing(c) {
    if (c.customer_id) return 'Has an account';
    if (c.name || c.phone || c.email) return 'Guest';
    return 'Guest · has not said who';
  }
  /* Where they are, but only while that is still true. A page somebody
     was on an hour ago is not where they are, and an operator acting on
     it would be acting on nothing. */
  function viewingNow(c) {
    if (!c.viewing || !c.viewing_at) return '';
    var age = (Date.now() - new Date(c.viewing_at).getTime()) / 1000;
    if (!isFinite(age) || age > 120) return '';
    return c.viewing;
  }

  A.registerPage({
    key: 'chats',
    title: 'Live Chats',
    summary: 'Conversations customers have started on the website.',

    render: function (host, ctx) {
      host.innerHTML = '';
      ctx = ctx || {};
      var sb = ctx.sb || A.sb;
      loadMoney();            // so a figure sent to a customer is in the shop's money

      var convs = [];           // the left column
      var openId = null;        // the conversation being read
      var msgs = [];            // its messages
      var filter = 'open';      // open | mine | free | all
      var listTimer = null, threadTimer = null, presenceTimer = null;
      var sending = false;
      var me = null;            // this operator's own agent row id
      /* Whether this operator is the shop's owner, which is what decides
         if a conversation can be deleted. Answered by the database, not
         assumed: false until it says otherwise, so a failed or slow
         lookup shows no delete button rather than one that errors. */
      var isOwner = false;
      /* Settings > Live Chat, for the three tools it can switch off. The
         built-in answer is yes to all of them, so a shop that has never
         opened that page sees the row it has always seen. */
      var chatSet = { sendProducts: true, sendOrders: true, sendPhotos: true };
      var myName = '';
      var fallbackName = '';    // made from the sign-in address, if nothing better
      var agents = [];          // everybody who has ever opened this page
      var notes = [];           // for the conversation being read
      var canned = [];          // answers the shop wrote once
      var catalogue = null;     // the product feed, fetched once if needed
      var noteListEl = null;    // where they are drawn, while a thread is open
      var whoEl   = null;       // the identity block at the top of a thread
      var logEl   = null;       // the messages, and only the messages
      var painted = '';         // what the log is currently showing
      /* A reply that was typed but not sent, held across a repaint.
         Telling somebody their words are still in the box and then
         rebuilding the box out from under them would be worse than
         saying nothing. */
      var draft = '';
      /* Whether the customer is writing, and when we last said that we
         are. Both live here rather than on the conversation row because
         both are about this moment and this browser, and neither is
         worth keeping when the panel is closed. */
      var theyAreTyping = false;
      var saidTypingAt = 0;

      /* Whether somebody else is in the middle of this one. The same
         three ways out as chat_may_speak_in(), in the same order. */
      function heldByOther(c) {
        if (!c || !c.assigned_to) return null;      // nobody has taken it
        if (c.assigned_to === me) return null;      // it is yours
        if (isOwner) return null;                   // the owner may always step in
        var a = agents.filter(function (x) { return x.id === c.assigned_to; })[0];
        if (!holderPresent(a)) return null;         // they are not at the desk
        return a || { id: c.assigned_to };
      }

      /* ---- the frame ------------------------------------------------ */
      var bar = el('div', 'toolbar');
      var count = el('span', 'count', 'Reading…');
      bar.appendChild(count);

      var pick = document.createElement('select');
      pick.className = 'al-pick';
      pick.appendChild(new Option('Open conversations', 'open'));
      pick.appendChild(new Option('Mine', 'mine'));
      pick.appendChild(new Option('Nobody has taken', 'free'));
      pick.appendChild(new Option('Everything', 'all'));
      pick.setAttribute('aria-label', 'Which conversations to show');
      bar.appendChild(pick);

      /* Who else is at the desk, and whether this operator is. Their own
         status is a control; everybody else's is a fact. */
      var whoBar = el('span', 'lc-presence');
      bar.appendChild(whoBar);

      /* The name colleagues see beside a conversation. Made from the
         sign-in address to begin with, because a shop should not have to
         fill anything in before it can answer — but an address is not a
         name, and "chimukachipini" is not how anybody writes theirs. */
      var meName = document.createElement('input');
      meName.type = 'text';
      meName.className = 'al-pick lc-name';
      meName.maxLength = 40;
      meName.placeholder = 'Your name';
      meName.setAttribute('aria-label', 'The name your colleagues see');
      meName.title = 'The name your colleagues see beside a conversation.';
      bar.appendChild(meName);

      /* Whether this operator has touched the box.

         The page fills it in with a name made from the sign-in address,
         and that happens a moment after the page opens — one round trip
         to say they are at the desk, and another to read back who is.
         Somebody who opens Live Chats and types their name straight away
         had it wiped when those landed. A rare thing to hit and a
         maddening one: the name goes back to "Chimukachipini" while you
         are looking at it, and typing it again works, so it reads as the
         page being broken rather than as a race.

         Found by a test that had been flaking for days and was being
         read as a slow machine. */
      var nameTouched = false;
      meName.addEventListener('input', function () { nameTouched = true; });

      var mePick = document.createElement('select');
      mePick.className = 'al-pick';
      /* The words are the shop's; the values behind them are not. "away"
         stays "away" in the database, because it is what the customer's
         light reads and what decides when a held conversation comes free
         — and there is already a third state, "offline", written when
         somebody leaves the page. Renaming the stored value to match the
         label would have collided with it. */
      mePick.appendChild(new Option('Online', 'online'));
      mePick.appendChild(new Option('Offline', 'away'));
      mePick.setAttribute('aria-label', 'Your status');
      bar.appendChild(mePick);

      var statsBtn = el('button', 'btn btn-out btn-sm', 'Numbers');
      statsBtn.type = 'button';
      bar.appendChild(statsBtn);

      /* Notifications on this device. One button, and it says which of
         the two things it will do — a switch that does not say which way
         it is pointing is worse than no switch. */
      var bellBtn = el('button', 'btn btn-out btn-sm lc-bell', 'Notify me here');
      bellBtn.type = 'button';
      bar.appendChild(bellBtn);

      host.appendChild(bar);

      var statsBox = el('div', 'lc-stats');
      statsBox.style.display = 'none';
      host.appendChild(statsBox);

      var wrap = el('div', 'lc-wrap');
      var listCol = el('div', 'lc-list');
      var threadCol = el('div', 'lc-thread');
      wrap.appendChild(listCol);
      wrap.appendChild(threadCol);
      host.appendChild(wrap);

      /* ---- reading -------------------------------------------------- */
      function loadList() {
        var q = sb.from('chat_conversations')
          .select('id,name,phone,email,customer_id,status,last_message_at,shop_unread,customer_unread,' +
                  'created_at,started_on,viewing,viewing_at,assigned_to,assigned_at')
          .order('last_message_at', { ascending: false })
          .limit(PAGE);
        if (filter !== 'all') q = q.eq('status', 'open');
        /* "Mine" with nobody to be means nobody's, not everybody's. The
           filter used to be dropped when me was null — the session not
           resolved yet, or this operator not in chat_agents — and the
           list then showed every open conversation under a label saying
           they were all this person's. Wrong rows under a confident
           label are worse than an empty list. */
        if (filter === 'mine') {
          if (!me) {
            convs = [];
            paintList();
            count.textContent = 'Not signed in as an agent yet, so nothing is yours. ' +
                                'Give it a moment, or choose another view.';
            return Promise.resolve();
          }
          q = q.eq('assigned_to', me);
        }
        if (filter === 'free') q = q.is('assigned_to', null);
        return q.then(function (r) {
          if (r.error) { count.textContent = 'Could not read the conversations.'; return; }
          convs = r.data || [];
          paintList();
          refreshStats();      // the numbers move with the list, not with the panel opening
          paintWho();
          alertOnNew();        // the sound and the count in the tab title
        });
      }

      function loadThread(id) {
        if (!id) return Promise.resolve();
        return sb.from('chat_messages')
          .select('id,sender,body,created_at,meta')
          .eq('conversation_id', id)
          .order('created_at', { ascending: true })
          .then(function (r) {
            if (r.error) return;
            /* They opened something else while this was in flight. Its
               messages are not this conversation's and must not be
               painted into it. */
            if (id !== openId) return;
            msgs = r.data || [];
            /* The whole panel is built once, when a conversation is
               opened. After that a poll touches the messages and the
               identity line and nothing else — because rebuilding the
               panel takes the reply box with it, and on a phone that
               takes the keyboard away too. A keyboard cannot be brought
               back by script; only a tap does that, so an operator
               typing a reply on a phone lost it every three seconds.
               When nothing has been said, nothing moves at all. */
            if (!logEl) { paintThread(); return; }
            paintWho();
            if (messageSig() !== painted) paintMessages();
            readTyping(id);
            /* Read, because somebody is looking at it. Not while the tab
               is in the background: nobody is reading a conversation
               they cannot see. */
            if (!document.hidden) markRead(id);
          });
      }

      /* Enough to tell one state of the log from another without
         comparing every field: ids in order, plus how many there are. */
      function messageSig() {
        var c = convs.filter(function (x) { return x.id === openId; })[0];
        return msgs.length + ':' + msgs.map(function (m) { return m.id; }).join(',') +
               ':' + (c ? (Number(c.customer_unread) ? 'waiting' : 'seen') : '');
      }

      /* Opening a conversation is what marks it read, and so is every
         poll while it stays open — otherwise a message arriving under
         the operator's eyes raises a badge on the row they are reading,
         and it never comes down.

         Counted rather than zeroed. Writing a zero threw away the
         trigger's increment for anything that landed between the
         reading and the writing, so a message the operator never saw
         never raised a badge at all. chat_mark_read is told the moment
         this window last drew, and counts what has arrived since: a
         message that lands during the call is newer than that moment
         and survives it. */
      function markRead(id) {
        var upto = null;
        for (var i = msgs.length - 1; i >= 0; i--) {
          if (msgs[i] && msgs[i].created_at) { upto = msgs[i].created_at; break; }
        }
        return Promise.resolve(sb.rpc('chat_mark_read', { p_conversation: id, p_upto: upto }))
          .then(function (r) {
            if (r && r.error) return;
            var left = Number(r && r.data) || 0;
            convs.forEach(function (c) { if (c.id === id) c.shop_unread = left; });
            paintList();
          }, function () {});
      }

      function agentName(id) {
        if (!id) return '';
        for (var i = 0; i < agents.length; i++) {
          if (agents[i].id === id) return agents[i].display_name || 'Agent';
        }
        return 'Someone';
      }

      function loadAgents() {
        return sb.from('chat_agents').select('id,display_name,status,last_seen_at')
          .then(function (r) {
            if (r.error) return;
            agents = r.data || [];
            paintPresence();
          });
      }

      /* Asked once, on the way in. A shop that has not run the phase 5
         migration has no such function, and the error that comes back is
         the correct answer: no owner named, so no delete button, and the
         page carries on exactly as it did before.

         If a thread was already open when the answer lands, it is drawn
         again — the button belongs in a header that was built before we
         knew whether to build it. */
      function loadOwner() {
        return sb.rpc('is_shop_owner').then(function (r) {
          var yes = !!(r && !r.error && r.data === true);
          if (yes === isOwner) return;
          isOwner = yes;
          if (openId) { painted = ''; paintThread(); }
        }, function () {});
      }

      /* Where this website actually answers, told to the database by the
         browser looking at it.

         The database has to post to an absolute address to make a phone
         buzz, and it is the one thing the migration cannot know. Asking
         the shop to type it is asking for the one mistake that fails
         silently: the nudge is deliberately quiet when it fails, so a
         wrong address means phones that never buzz and nothing anywhere
         saying why. This way nobody types it, and it follows the shop to
         a new domain on its own.

         Owner only, in the database as well as here — the hook secret
         travels to whatever address this sets. */
      function tellSiteAddress() {
        if (!isOwner || !alerts || !alerts.siteOrigin) return Promise.resolve();
        var origin = alerts.siteOrigin(window.location);
        if (!origin) return Promise.resolve();
        /* Quiet either way. This is housekeeping the shop never asked
           for, and a shop that has not run phase 7 has no such function
           — the error that comes back is the correct answer. */
        return sb.rpc('chat_push_site', { p_url: origin })
          .then(function () {}, function () {});
      }

      /* Everybody who is at the desk right now, named. An operator
         deciding whether to hand a conversation over needs to know who
         is actually there to take it. */
      function paintPresence() {
        function named(a) { return (a.display_name || 'Agent') + (a.id === me ? ' (you)' : ''); }
        var atDesk = agents.filter(agentOnline).map(named);
        var away   = agents.filter(function (a) { return agentPresent(a) && !agentOnline(a); }).map(named);

        whoBar.innerHTML = '';
        if (!atDesk.length && !away.length) { whoBar.textContent = ''; return; }

        if (atDesk.length) {
          whoBar.appendChild(el('span', 'lc-live-dot'));
          whoBar.appendChild(document.createTextNode(
            atDesk.length === 1 ? atDesk[0] + ' at the desk' : atDesk.join(', ') + ' at the desk'));
        }
        if (away.length) {
          if (atDesk.length) whoBar.appendChild(document.createTextNode(' · '));
          whoBar.appendChild(el('span', 'lc-live-dot off'));
          whoBar.appendChild(document.createTextNode(
            away.length === 1 ? away[0] + ' away' : away.join(', ') + ' away'));
        }
      }

      /* Said on opening the page, then every so often, then once more on
         the way out. A browser that closes without warning simply stops
         saying it, which is what makes the absence read correctly. */
      /* A name given explicitly as null is a deliberate "say nothing":
         chat_presence keeps whatever is already stored when it is handed
         none, which is what lets a chosen name survive the next beat. */
      function sayHere(status, name) {
        var say = (name === null ? null : (name || myName || null));
        return sb.rpc('chat_presence', { p_status: status, p_name: say })
          .then(function () {
            /* A name typed here is the name the owner's staff list should
               show as well. A no-op for an administrator, who has no
               chat_staff row, and absent entirely before phase 6 — both
               of which come back as an error and are ignored. */
            if (!say) return;
            return Promise.resolve(sb.rpc('chat_staff_rename', { p_name: say }))
              .catch(function () {});
          })
          .then(loadAgents, function () {});
      }

      /* Saved answers, and which tools this shop uses.

         The answers are the shop's now: Settings > Live Chat writes them
         and this reads them. chat_canned is still read for a shop that
         has not opened that page yet — the five it was seeded with are
         somebody's work and should not vanish the day this ships. Once
         the section has been saved, the section is the only source. */
      function loadCanned() {
        var fromSettings = A.store
          ? A.store.load('chat').catch(function () { return {}; })
          : Promise.resolve({});
        return fromSettings.then(function (d) {
          d = d || {};
          chatSet.sendProducts = d.sendProducts !== false;
          chatSet.sendOrders   = d.sendOrders   !== false;
          chatSet.sendPhotos   = d.sendPhotos   !== false;

          var written = Array.isArray(d.canned) ? d.canned.filter(function (q) {
            return q && String(q.title || '').trim() && String(q.body || '').trim();
          }) : [];
          if (written.length) {
            canned = written.map(function (q, i) {
              return { id: 's' + i, title: q.title, body: q.body, sort: i };
            });
            return;
          }
          return sb.from('chat_canned').select('id,title,body,sort')
            .order('sort', { ascending: true })
            .then(function (r) { canned = (r && r.data) || []; }, function () {});
        });
      }

      /* The same public feed the storefront reads. Fetched once, and
         only when somebody actually goes looking for a piece to send. */
      function products() {
        if (catalogue) return Promise.resolve(catalogue);
        return fetch('/api/products', { cache: 'no-store' })
          .then(function (r) { return r.ok ? r.json() : { products: [] }; })
          .then(function (d) { catalogue = (d && d.products) || []; return catalogue; })
          .catch(function () { catalogue = []; return catalogue; });
      }

      /* A reply with something attached. The body still carries words,
         because a card with no sentence around it reads as a machine. */
      function sendWith(body, meta) {
        if (!openId) return Promise.resolve();
        return sb.from('chat_messages')
          .insert({ conversation_id: openId, sender: 'shop',
                    body: (body || '').slice(0, 2000), author_id: me, meta: meta })
          .then(function () { return loadThread(openId); })
          .then(loadList);
      }

      function loadNotes(id) {
        return sb.from('chat_notes')
          .select('id,author_id,kind,body,created_at')
          .eq('conversation_id', id)
          .order('created_at', { ascending: true })
          .then(function (r) {
            notes = (r && r.data) || [];
            paintNotes();
          }, function () {});
      }

      /* The numbers used to be counted once, when the panel was opened,
         and then left there while the list beside them went on moving.
         Open it in the morning, answer a conversation at noon, and it
         still said "Still open 0" over a list with an open conversation
         at the top of it — the panel was not wrong when it was drawn,
         and it had no way to stop being right.

         So it counts again with the list. The list polls every six
         seconds and this is an aggregate over a month, so it is held to
         one count every fifteen; between those the panel says how long
         ago it counted rather than implying it is this second's. */
      var STATS_EVERY = 15000;
      var statsAt = 0;
      var statsBusy = false;

      function showStats() {
        var on = statsBox.style.display !== 'none';
        if (on) { statsBox.style.display = 'none'; return; }
        statsBox.style.display = 'block';
        statsBox.innerHTML = '<div class="lc-empty">Counting…</div>';
        statsAt = 0;
        paintStats();
      }

      /* Called by the poll. Does nothing unless the panel is showing. */
      function refreshStats() {
        if (statsBox.style.display === 'none') return;
        if (Date.now() - statsAt < STATS_EVERY) { stampStats(); return; }
        paintStats();
      }

      function stampStats() {
        var s = statsBox.querySelector('.lc-stat-note');
        if (!s || !statsAt) return;
        var ago = Math.round((Date.now() - statsAt) / 1000);
        s.textContent = 'The last 30 days · counted ' +
          (ago < 10 ? 'just now' : ago < 60 ? ago + ' seconds ago'
                                            : Math.round(ago / 60) + ' minutes ago');
      }

      function paintStats() {
        if (statsBusy) return;
        statsBusy = true;
        sb.rpc('chat_stats', { p_days: 30 }).then(function (r) {
          statsBusy = false;
          if (statsBox.style.display === 'none') return;
          if (r.error || !r.data) { statsBox.innerHTML =
            '<div class="lc-empty">Could not read the numbers.</div>'; return; }
          statsAt = Date.now();
          var d = r.data, t = d.totals || {};
          statsBox.innerHTML = '';
          var grid = el('div', 'lc-stat-grid');
          [['Conversations', t.started], ['Still open', t.open],
           ['Nobody has answered', t.unanswered], ['Messages waiting', t.waiting],
           ['Average first reply', t.avg_first_reply_seconds == null
              ? '—' : mmss(t.avg_first_reply_seconds)]
          ].forEach(function (row) {
            var cell = el('div', 'lc-stat');
            cell.appendChild(el('div', 'lc-stat-n', String(row[1] == null ? '—' : row[1])));
            cell.appendChild(el('div', 'lc-stat-l', row[0]));
            grid.appendChild(cell);
          });
          statsBox.appendChild(grid);
          statsBox.appendChild(el('div', 'lc-stat-note', 'The last 30 days.'));
          stampStats();

          (d.agents || []).forEach(function (a) {
            var row = el('div', 'lc-hist-row');
            row.appendChild(el('span', 'lc-hist-ref', a.agent));
            row.appendChild(el('span', 'lc-hist-mid',
              a.replies + (a.replies === 1 ? ' reply' : ' replies') +
              ' across ' + a.conversations +
              (a.conversations === 1 ? ' conversation' : ' conversations')));
            row.appendChild(el('span', 'lc-hist-end',
              a.open_assigned ? a.open_assigned + ' open' : '—'));
            statsBox.appendChild(row);
          });
        }, function () {
          statsBusy = false;
          if (statsBox.style.display === 'none') return;
          statsBox.innerHTML = '<div class="lc-empty">Could not read the numbers.</div>';
        });
      }
      function mmss(sec) {
        sec = Number(sec) || 0;
        if (sec < 60) return Math.round(sec) + 's';
        if (sec < 3600) return Math.round(sec / 60) + ' min';
        return (sec / 3600).toFixed(1) + ' h';
      }

      /* ---- the left column ------------------------------------------ */
      function paintList() {
        var waiting = convs.reduce(function (n, c) { return n + (c.shop_unread || 0); }, 0);
        count.textContent = convs.length
          ? convs.length + (convs.length === 1 ? ' conversation' : ' conversations') +
            (waiting ? ' · ' + waiting + ' unread' : '')
          : 'No conversations yet.';

        listCol.innerHTML = '';
        if (!convs.length) {
          /* What is empty depends on what was asked for. "No customer
             has written yet" in front of somebody who filtered to their
             own conversations is simply untrue. */
          listCol.appendChild(el('div', 'lc-empty',
            filter === 'open' ? 'Nothing open. When a customer writes from the website, it appears here.'
          : filter === 'mine' ? 'Nothing is assigned to you.'
          : filter === 'free' ? 'Everything open has somebody dealing with it.'
                              : 'No customer has written yet.'));
          return;
        }
        convs.forEach(function (c) {
          var row = el('button', 'lc-row' + (c.id === openId ? ' active' : '') +
                                 (c.shop_unread ? ' unread' : '') +
                                 (c.assigned_to && c.assigned_to !== me ? ' theirs' : ''));
          row.type = 'button';
          var top = el('div', 'lc-row-top');
          top.appendChild(el('span', 'lc-who', who(c)));
          top.appendChild(el('span', 'lc-when', ago(c.last_message_at)));
          row.appendChild(top);

          var meta = [];
          var seeing = viewingNow(c);
          if (seeing) meta.push('on ' + seeing);
          else if (c.phone) meta.push(c.phone);
          if (c.customer_id) meta.push('account');
          if (c.assigned_to) meta.push(c.assigned_to === me ? 'yours' : agentName(c.assigned_to));
          if (c.status === 'closed') meta.push('Closed');
          row.appendChild(el('div', 'lc-meta' + (seeing ? ' live' : ''),
                             meta.join(' · ') || 'No details given'));

          if (c.shop_unread) {
            row.appendChild(el('span', 'lc-dot', String(c.shop_unread)));
          }
          row.addEventListener('click', function () { openConversation(c.id); });
          listCol.appendChild(row);
        });
      }

      /* ---- the conversation ----------------------------------------- */
      /* Who the shop is speaking to, and where they are while they are
         still there — the difference between "do you have it in a 42"
         and knowing which piece they mean. Repainted on every poll,
         because it is the part that goes stale, and it holds no control
         anybody can be halfway through using. */
      function paintWho() {
        if (!whoEl) return;
        var c = convs.filter(function (x) { return x.id === openId; })[0];
        if (!c) return;
        whoEl.innerHTML = '';

        var nameRow = el('div', 'lc-head-who');
        nameRow.appendChild(document.createTextNode(who(c)));
        nameRow.appendChild(el('span', 'lc-tag' + (c.customer_id ? ' known' : ''), standing(c)));
        whoEl.appendChild(nameRow);

        var bits = [];
        if (c.phone) bits.push(c.phone);
        if (c.email) bits.push(c.email);
        bits.push('Started ' + ago(c.created_at));
        if (c.started_on) bits.push('from ' + c.started_on);
        whoEl.appendChild(el('div', 'lc-head-meta', bits.join(' · ')));

        /* Whether the person is still on the other end. The same test
           the customer's window applies to the shop, turned around: they
           are here if their browser said so in the last two minutes.
           A conversation they ended is not one they are in. */
        var live = el('div', 'lc-viewing');
        var fresh = c.status === 'open' && !!viewingNow(c);
        live.appendChild(el('span', 'lc-live-dot' + (fresh ? '' : ' off')));
        var seeing = viewingNow(c);
        live.appendChild(document.createTextNode(
          c.status !== 'open' ? 'This conversation is closed'
          : fresh ? ('Here now' + (seeing ? ' · looking at ' + seeing : ''))
          : 'Not on the site right now'));
        whoEl.appendChild(live);
      }

      /* The messages, into a log that is already on the page. Nothing
         around it is touched, which is the whole point. */
      function paintMessages() {
        if (!logEl) return;
        logEl.innerHTML = '';
        if (!msgs.length) {
          logEl.appendChild(el('div', 'lc-empty', 'Nothing said yet.'));
        } else {
          msgs.forEach(function (m) {
            var row = el('div', 'lc-msg ' + (m.sender === 'shop' ? 'from-shop' : 'from-customer'));
            if (m.body) row.appendChild(el('div', 'lc-bubble', m.body));
            var card = adminCard(m.meta);
            if (card) row.appendChild(card);
            row.appendChild(el('div', 'lc-at', clock(m.created_at)));
            logEl.appendChild(row);
          });
        }
        /* Only under the shop's own last message: the one whose reading
           the operator cannot see for themselves. customer_unread is
           moved by the trigger when the shop writes and cleared when the
           customer's window reads, so nothing waiting means it landed. */
        var c = convs.filter(function (x) { return x.id === openId; })[0];
        var last = msgs[msgs.length - 1];
        if (c && last && last.sender === 'shop' && !Number(c.customer_unread)) {
          logEl.appendChild(el('div', 'lc-seen', 'Seen'));
        }

        logEl.scrollTop = logEl.scrollHeight;
        painted = messageSig();
        /* This just emptied the log, so the dot goes back if it is still
           wanted. It has to come after the seen line, because it stands
           where the next message will land and that is the bottom. */
        paintTyping();
      }

      function paintThread() {
        threadCol.innerHTML = '';
        whoEl = null; logEl = null; painted = '';
        var c = convs.filter(function (x) { return x.id === openId; })[0];
        if (!c) {
          threadCol.appendChild(el('div', 'lc-empty',
            'Choose a conversation on the left to read it and reply.'));
          return;
        }

        /* Worked out before anything is built, because the header, the
           reply box and the tools all read it. */
        var held = heldByOther(c);

        var head = el('div', 'lc-head');
        var idn = el('div');
        head.appendChild(idn);
        whoEl = idn;
        paintWho();

        var acts = el('div', 'lc-acts');

        /* Who is dealing with this. Taking it and handing it on are the
           same control, because they are the same decision.

           The away marker uses the five-minute rule rather than the
           presence bar's two, because this is the question the marker is
           actually being read for: not "is their light green" but "will
           this conversation be answered if I give it to them". */
        var owner = document.createElement('select');
        owner.className = 'al-pick';
        owner.setAttribute('aria-label', 'Who is dealing with this');
        owner.appendChild(new Option('Nobody has taken it', ''));
        agents.forEach(function (a) {
          var label = (a.display_name || 'Agent') + (a.id === me ? ' (me)' : '') +
                      (holderPresent(a) ? '' : ' — away');
          var o = new Option(label, a.id);
          if (a.id === c.assigned_to) o.selected = true;
          owner.appendChild(o);
        });
        /* Greyed for a colleague who may not take it, so the refusal is
           seen before the attempt rather than after. The database
           refuses either way; this only saves the round trip and the
           moment of thinking it worked. */
        owner.disabled = !!held;
        if (held) owner.title = 'Only ' + (held.display_name || 'the person holding it') +
                                ' can hand this on.';
        owner.addEventListener('change', function () {
          var to = owner.value || null;
          /* Handing a live conversation to somebody is worth a question
             when it leaves your hands — and worth none when you are
             taking one on, which is a thing to get on with. */
          var ask = (ctx && ctx.ask) || (A && A.ask);
          var leaving = c.assigned_to === me && to && to !== me;
          if (!leaving || !ask) { assign(c, to); return; }
          var toName = (agents.filter(function (x) { return x.id === to; })[0] || {}).display_name ||
                       agentName(to) || 'them';
          var awayNote = holderPresent(agents.filter(function (x) { return x.id === to; })[0])
            ? '' : toName + ' is not at the desk just now, so it may sit unanswered. ';
          ask('Hand this conversation to ' + toName + '?', {
            okText: 'Hand it over',
            note: awayNote + 'They will be told, and it stops being yours to answer.'
          }).then(function (yes) {
            if (yes) assign(c, to);
            else { owner.value = c.assigned_to || ''; }
          });
        });
        acts.appendChild(owner);

        var closeBtn = el('button', 'btn btn-out btn-sm',
                          c.status === 'open' ? 'End this chat' : 'Reopen this chat');
        closeBtn.type = 'button';
        closeBtn.addEventListener('click', function () {
          if (c.status !== 'open') { setStatus(c, 'open'); return; }
          /* Ending one is not undoable from the customer's side — they
             would have to start again — so it is asked rather than done
             on a single tap. */
          var ask = (ctx && ctx.ask) || (A && A.ask);
          if (!ask) { setStatus(c, 'closed'); return; }
          ask('End this chat with ' + who(c) + '?',
              { danger: true, okText: 'End it',
                note: 'They can start a new one whenever they like, and you can reopen this.' })
            .then(function (yes) { if (yes) setStatus(c, 'closed'); });
        });
        acts.appendChild(closeBtn);

        /* Deleting one, which only the shop's owner may do.

           Ending a conversation is reversible and deleting it is not, so
           it is not a power everybody who answers chats needs. The
           button is only built for the owner, and the database asks
           again: chat_delete refuses anybody else, so a button conjured
           up in a console gets an error rather than a deletion. */
        if (isOwner) {
          var delBtn = el('button', 'btn btn-out btn-sm lc-del', 'Delete');
          delBtn.type = 'button';
          delBtn.addEventListener('click', function () {
            var ask = (ctx && ctx.ask) || (A && A.ask);
            if (!ask) return;
            ask('Delete this conversation with ' + who(c) + '?', {
              danger: true, okText: 'Delete it', title: 'This cannot be undone',
              note: 'Every message and every internal note in it goes too. ' +
                    'If you only want it out of the way, end it instead.'
            }).then(function (yes) { if (yes) removeConversation(c); });
          });
          acts.appendChild(delBtn);
        }

        head.appendChild(acts);
        threadCol.appendChild(head);

        /* Somebody else is in the middle of this one.

           Said plainly and above the messages, because the alternative —
           a box that quietly refuses — is how two people end up
           answering one customer over each other, or how somebody types
           a careful paragraph and loses it. It can still be read: the
           lock is on speaking, not on looking, so a colleague can catch
           up before taking it on. */
        if (held) {
          var lock = el('div', 'lc-lock');
          lock.appendChild(el('span', 'lc-lock-who',
            (held.display_name || agentName(held.id) || 'A colleague') +
            ' is answering this one.'));
          lock.appendChild(el('span', 'lc-lock-why',
            'You can read it. To reply, ask them to hand it over — or wait: ' +
            'it comes free on its own if they go away.'));
          threadCol.appendChild(lock);
        }

        var log = el('div', 'lc-log');
        threadCol.appendChild(log);
        logEl = log;
        paintMessages();

        var form = el('form', 'lc-form');
        var box = document.createElement('textarea');
        box.rows = 1;
        box.placeholder = held
          ? 'Held by ' + (held.display_name || agentName(held.id) || 'a colleague')
          : (c.status === 'open'
              ? 'Reply to ' + who(c) : 'Reopen this conversation to reply');
        box.setAttribute('aria-label', 'Your reply');
        box.disabled = c.status !== 'open' || !!held;
        box.addEventListener('input', function () {
          box.style.height = 'auto';
          box.style.height = Math.min(box.scrollHeight, 110) + 'px';
          /* Not from a box that cannot send: a rescued draft in somebody
             else's conversation must not make a dot breathe at the
             customer for a reply that is not coming. */
          if (!box.readOnly && !box.disabled) sayTyping();
        });
        box.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); reply(box); }
        });
        form.appendChild(box);

        var send = el('button', 'btn btn-gold btn-sm', 'Send');
        send.type = 'submit';
        send.disabled = c.status !== 'open' || !!held;
        form.appendChild(send);
        form.addEventListener('submit', function (e) { e.preventDefault(); reply(box); });

        /* Everything a reply can carry beyond words, in one row above
           the box it goes into. All of them go dead together when the
           conversation is closed: a shop cannot send a photo into a
           thread it cannot speak in. */
        var tools = el('div', 'lc-tools');
        var off = c.status !== 'open' || !!held;

        var cannedPick = document.createElement('select');
        cannedPick.className = 'al-pick';
        cannedPick.setAttribute('aria-label', 'A saved answer');
        cannedPick.disabled = off;
        cannedPick.appendChild(new Option('Saved answers\u2026', ''));
        canned.forEach(function (q) { cannedPick.appendChild(new Option(q.title, q.id)); });
        cannedPick.addEventListener('change', function () {
          var q = canned.filter(function (x) { return x.id === cannedPick.value; })[0];
          cannedPick.value = '';
          if (!q) return;
          /* Put into the box, not sent. Every one of these wants a name
             or a detail added before it goes. */
          box.value = box.value ? box.value + '\n' + q.body : q.body;
          box.focus();
          box.dispatchEvent(new Event('input'));
        });
        tools.appendChild(cannedPick);

        /* A tool the shop has switched off is not built, rather than
           built and disabled: a greyed button says "not now", and the
           answer here is "not at all". */
        if (chatSet.sendPhotos) {
          var photo = document.createElement('input');
          photo.type = 'file';
          photo.accept = 'image/*';
          photo.className = 'lc-file';
          photo.id = 'lcPhoto';
          photo.disabled = off;
          var photoLabel = el('label', 'btn btn-out btn-sm lc-file-label', 'Photo');
          photoLabel.setAttribute('for', 'lcPhoto');
          photo.addEventListener('change', function () { sendPhoto(photo, toolMsg); });
          tools.appendChild(photo);
          tools.appendChild(photoLabel);
        }

        if (chatSet.sendProducts) {
          var prodBtn = el('button', 'btn btn-out btn-sm', 'Send a piece');
          prodBtn.type = 'button';
          prodBtn.disabled = off;
          prodBtn.addEventListener('click', function () { pickProduct(toolMsg); });
          tools.appendChild(prodBtn);
        }

        if (chatSet.sendOrders) {
          var ordBtn = el('button', 'btn btn-out btn-sm', 'Send an order');
          ordBtn.type = 'button';
          ordBtn.disabled = off;
          ordBtn.addEventListener('click', function () { pickOrder(c, toolMsg); });
          tools.appendChild(ordBtn);
        }

        var toolMsg = el('span', 'lc-tool-msg');
        tools.appendChild(toolMsg);
        threadCol.appendChild(tools);
        threadCol.appendChild(form);

        /* Notes between staff. Marked, coloured differently and headed
           with who can see them, because the one mistake that matters
           here is typing into the wrong box. */
        var noteWrap = el('div', 'lc-notes');
        noteWrap.appendChild(el('div', 'lc-notes-head', 'Internal notes — the customer never sees these'));
        var noteList = el('div', 'lc-note-list');
        noteWrap.appendChild(noteList);
        var noteForm = el('form', 'lc-note-form');
        var noteBox = document.createElement('input');
        noteBox.type = 'text';
        noteBox.placeholder = 'Add a note for your colleagues';
        noteBox.setAttribute('aria-label', 'Internal note');
        noteBox.maxLength = 500;
        noteForm.appendChild(noteBox);
        var noteBtn = el('button', 'btn btn-out btn-sm', 'Note');
        noteBtn.type = 'submit';
        noteForm.appendChild(noteBtn);
        noteForm.addEventListener('submit', function (e) {
          e.preventDefault();
          addNote(noteBox);
        });
        noteWrap.appendChild(noteForm);
        threadCol.appendChild(noteWrap);
        noteListEl = noteList;
        paintNotes();

        /* What they have bought before, and what they have asked before.
           Both are read here rather than carried on the conversation,
           because both change without it. */
        var side = el('div', 'lc-side');
        threadCol.appendChild(side);
        loadHistory(c, side);

        /* An unsent reply put back where it was. It stays readable even
           if the box has since been greyed, so the words can be copied
           out and given to whoever now holds the conversation. */
        if (draft) {
          box.value = draft;
          draft = '';
          box.readOnly = box.disabled;
          box.disabled = false;
          box.dispatchEvent(new Event('input'));
        }

        setTimeout(function () { if (!box.disabled) box.focus(); }, 40);
      }

      /* Orders and earlier conversations for whoever this is. A customer
         with an account is matched on the account; a guest can only be
         matched on the phone number they gave, and is not matched at all
         when they gave none — guessing which stranger is which from a
         name would put one customer's orders in front of another. */
      function loadHistory(c, host) {
        host.innerHTML = '';
        var byAccount = !!c.customer_id;

        /* An account is proof; a phone number typed into a chat box is
           not. chat_identify writes whatever it is handed to anybody
           holding a conversation token, so a stranger could type a real
           customer's number and have that customer's last five orders —
           reference, total, item names — drawn into this panel as though
           they were theirs. The operator would then discuss them.

           This file already refused to match on a name, for exactly this
           reason. A number nobody checked is the same kind of guess, so
           it is not followed on its own either: it is offered, with what
           it is worth said plainly, and the operator decides. */
        if (!byAccount) {
          if (!c.phone) return;
          var offer = el('div', 'lc-hist-ask');
          offer.appendChild(el('div', 'lc-hist-mid',
            'This number was typed into the chat and has not been checked against ' +
            'anything. Look it up only if you are sure who you are speaking to.'));
          var go = el('button', 'btn btn-out btn-sm', 'Look up ' + c.phone);
          go.type = 'button';
          go.addEventListener('click', function () { fetchHistory(c, host, false); });
          offer.appendChild(go);
          host.appendChild(offer);
          return;
        }
        fetchHistory(c, host, true);
      }

      function fetchHistory(c, host, byAccount) {
        host.innerHTML = '';

        var orders = sb.from('orders')
          .select('ref,status,total,currency,created_at,order_items(name,qty)')
          .order('created_at', { ascending: false }).limit(5);
        orders = byAccount ? orders.eq('customer_id', c.customer_id) : orders.eq('phone', c.phone);

        var past = sb.from('chat_conversations')
          .select('id,created_at,status')
          .neq('id', c.id)
          .order('last_message_at', { ascending: false }).limit(5);
        past = byAccount ? past.eq('customer_id', c.customer_id) : past.eq('phone', c.phone);

        Promise.all([orders, past]).then(function (r) {
          var os = (r[0] && r[0].data) || [];
          var cs = (r[1] && r[1].data) || [];
          if (!os.length && !cs.length) {
            host.appendChild(el('div', 'lc-hist-mid', 'Nothing found for that number.'));
            return;
          }
          if (!byAccount) {
            host.appendChild(el('div', 'lc-hist-mid',
              'Found by an unverified phone number — not by an account.'));
          }

          var box = el('details', 'lc-hist');
          var sum = el('summary', null,
            [os.length ? os.length + (os.length === 1 ? ' order' : ' orders') : null,
             cs.length ? cs.length + ' earlier ' + (cs.length === 1 ? 'chat' : 'chats') : null]
              .filter(Boolean).join(' · '));
          box.appendChild(sum);

          os.forEach(function (o) {
            var line = el('div', 'lc-hist-row');
            var items = (o.order_items || []).map(function (i) {
              return (i.qty > 1 ? i.qty + ' × ' : '') + i.name; }).join(', ');
            line.appendChild(el('span', 'lc-hist-ref', o.ref || '—'));
            line.appendChild(el('span', 'lc-hist-mid', items || 'No items recorded'));
            var amount = money(o.total);
            line.appendChild(el('span', 'lc-hist-end',
              [amount, o.status].filter(Boolean).join(' · ')));
            box.appendChild(line);
          });
          cs.forEach(function (p) {
            var line = el('div', 'lc-hist-row');
            line.appendChild(el('span', 'lc-hist-ref', 'Chat'));
            line.appendChild(el('span', 'lc-hist-mid', ago(p.created_at)));
            line.appendChild(el('span', 'lc-hist-end', p.status));
            box.appendChild(line);
          });
          host.appendChild(box);
        }, function () { /* history is a convenience, never a blocker */ });
      }

      /* The same three cards the customer sees, so an operator is never
         guessing what landed at the other end. */
      function adminCard(meta) {
        if (!meta || typeof meta !== 'object') return null;
        if (meta.kind === 'image' && meta.path) {
          var a = document.createElement('a');
          a.className = 'lc-card lc-photo';
          a.target = '_blank'; a.rel = 'noopener';
          a.href = photoUrl(meta.path);
          var im = document.createElement('img');
          im.alt = 'Photo sent'; im.loading = 'lazy'; im.src = photoUrl(meta.path);
          a.appendChild(im);
          return a;
        }
        if (meta.kind === 'product') {
          var pc = el('div', 'lc-card lc-card-prod');
          pc.appendChild(el('span', 'lc-card-n', meta.name || meta.sku || 'A piece'));
          if (meta.price) pc.appendChild(el('span', 'lc-card-p', meta.price));
          if (meta.sku) pc.appendChild(el('span', 'lc-card-s', meta.sku));
          return pc;
        }
        if (meta.kind === 'order') {
          var oc = el('div', 'lc-card lc-card-order');
          oc.appendChild(el('span', 'lc-card-n', 'Order ' + meta.ref));
          if (meta.status) oc.appendChild(el('span', 'lc-card-s', meta.status));
          if (meta.total) oc.appendChild(el('span', 'lc-card-p', meta.total));
          return oc;
        }
        return null;
      }
      function photoUrl(path) {
        var base = (ctx.cfg && ctx.cfg.SUPABASE_URL) ||
                   (window.VBP_CONFIG && window.VBP_CONFIG.SUPABASE_URL) || '';
        return String(base).replace(/\/+$/, '') +
               '/storage/v1/object/public/chat-uploads/' + path;
      }

      /* A photo, straight into the bucket only an admin may write to.
         The name is random rather than the customer's file name: what
         somebody calls a file on their phone is not something to
         publish, and two people sending IMG_0001.jpg must not collide. */
      function sendPhoto(input, msgHost) {
        var file = input.files && input.files[0];
        input.value = '';
        if (!file || !openId) return;
        if (!/^image\//.test(file.type)) { tell(msgHost, 'That is not an image.'); return; }
        if (file.size > 5 * 1024 * 1024) { tell(msgHost, 'That photo is over 5MB.'); return; }

        tell(msgHost, 'Sending the photo…');
        var ext = (file.name.match(/\.([a-z0-9]+)$/i) || [null, 'jpg'])[1].toLowerCase();
        var path = openId + '/' + Date.now() + '-' +
                   Math.random().toString(36).slice(2, 10) + '.' + ext;

        sb.storage.from('chat-uploads').upload(path, file, { contentType: file.type })
          .then(function (r) {
            if (r && r.error) throw r.error;
            return sendWith('', { kind: 'image', path: path });
          })
          .then(function () { tell(msgHost, ''); },
                function () {
                  tell(msgHost, 'The photo did not send.');
                  /* The upload may well have landed even though the
                     message did not. Nothing points at it now and
                     nothing ever will, so it goes back out of the bucket
                     rather than being paid for for ever. */
                  Promise.resolve(sb.storage.from('chat-uploads').remove([path]))
                    .catch(function () {});
                });
      }
      function tell(host, words) {
        if (!host) return;
        host.textContent = words || '';
        host.style.display = words ? 'inline' : 'none';
      }

      /* Asking, in the admin's own dialog rather than the browser's.

         These four questions used to be window.prompt(), including a
         numbered list pasted into a prompt box for the operator to
         answer with "3". Some browsers refuse prompt() outright, in
         which case the tool silently did nothing; the rest show a bare
         system box in the middle of a page that has its own voice.

         ask() now takes a typed answer or a list to pick from, so the
         numbering is gone: the pieces are buttons with their SKU beside
         them. */
      var askHere = (ctx && ctx.ask) || (A && A.ask);
      function askFor(question, opts) {
        if (!askHere) return Promise.resolve(null);
        return Promise.resolve(askHere(question, opts));
      }

      /* A piece from the shop's own feed. Searched rather than listed:
         a boutique has more pieces than fit in a dropdown. */
      function pickProduct(msgHost) {
        return askFor('Type part of a name or a SKU.', {
          title: 'Which piece?',
          okText: 'Search',
          input: { label: 'Name or SKU', placeholder: 'e.g. Rose gold, or WF-12' }
        }).then(function (typed) {
          if (typed === null || typed === false) return;
          var term = String(typed || '').trim().toLowerCase();
          if (!term) return;
          tell(msgHost, 'Looking…');
          return products().then(function (list) {
            var hit = list.filter(function (p) {
              return String(p.name || '').toLowerCase().indexOf(term) > -1 ||
                     String(p.sku  || '').toLowerCase().indexOf(term) > -1;
            }).slice(0, 8);
            if (!hit.length) { tell(msgHost, 'Nothing matched "' + term + '".'); return; }
            if (hit.length === 1) return sendProduct(hit[0], msgHost);

            tell(msgHost, '');
            return askFor('', {
              title: 'Which one?',
              choices: hit.map(function (p, i) {
                return { value: i, label: p.name || p.sku, hint: p.sku };
              })
            }).then(function (i) {
              if (i === null || i === false) { tell(msgHost, ''); return; }
              return sendProduct(hit[i] || hit[0], msgHost);
            });
          }, function () { tell(msgHost, 'Could not read the product list.'); });
        });
      }
      function sendProduct(pick, msgHost) {
        tell(msgHost, '');
        var price = pick.priceOnRequest ? '' : money(pick.price);
        return sendWith('This is the one:', {
          kind: 'product', sku: pick.sku, name: pick.name, price: price
        });
      }

      /* An order, looked up through the function rather than by reading
         the orders table into a chat window. */
      function pickOrder(c, msgHost) {
        tell(msgHost, 'Looking…');
        return sb.rpc('chat_find_orders', {
          p_customer: c.customer_id || null,
          p_phone: c.phone || null,
          p_ref: null
        }).then(function (r) {
          var list = (r && r.data) || [];
          if (r && r.error) throw r.error;
          if (!list.length) {
            /* Nothing on file for this customer, so ask for the
               reference rather than saying "no orders" to somebody
               holding one. */
            tell(msgHost, '');
            return askFor('Nothing on file for them. If they are holding a reference, type it.', {
              title: 'Which order?',
              okText: 'Look it up',
              input: { label: 'Order reference', placeholder: 'e.g. VBP-1042' }
            }).then(function (ref) {
              if (!ref) { tell(msgHost, ''); return; }
              tell(msgHost, 'Looking…');
              return sb.rpc('chat_find_orders', { p_customer: null, p_phone: null, p_ref: ref })
                .then(function (r2) { return offerOrders((r2 && r2.data) || [], msgHost); });
            });
          }
          return offerOrders(list, msgHost);
        }, function () { tell(msgHost, 'Could not look that up.'); });
      }
      function offerOrders(list, msgHost) {
        if (!list.length) { tell(msgHost, 'No order with that reference.'); return; }
        if (list.length === 1) return sendOrder(list[0], msgHost);
        tell(msgHost, '');
        return askFor('', {
          title: 'Which order?',
          choices: list.map(function (o, i) {
            return { value: i, label: o.ref, hint: o.status };
          })
        }).then(function (i) {
          if (i === null || i === false) { tell(msgHost, ''); return; }
          return sendOrder(list[i] || list[0], msgHost);
        });
      }
      function sendOrder(pick, msgHost) {
        tell(msgHost, '');
        var total = money(pick.total);
        return sendWith('Here is where your order has got to:', {
          kind: 'order', ref: pick.ref, status: pick.status, total: total
        });
      }

      function paintNotes() {
        if (!noteListEl) return;
        noteListEl.innerHTML = '';
        if (!notes.length) {
          noteListEl.appendChild(el('div', 'lc-note-empty', 'No notes yet.'));
          return;
        }
        notes.forEach(function (n) {
          var row = el('div', 'lc-note' + (n.kind === 'event' ? ' is-event' : ''));
          var by = n.kind === 'event' ? '' : (agentName(n.author_id) || 'Someone') + ' · ';
          row.appendChild(el('span', 'lc-note-body', n.body));
          row.appendChild(el('span', 'lc-note-by', by + ago(n.created_at)));
          noteListEl.appendChild(row);
        });
      }

      function addNote(box) {
        var body = (box.value || '').trim();
        if (!body || !openId) return;
        box.value = '';
        sb.from('chat_notes')
          .insert({ conversation_id: openId, author_id: me, kind: 'note', body: body.slice(0, 500) })
          .then(function (r) {
            if (r && r.error) { box.value = body; return; }
            return loadNotes(openId);
          }, function () { box.value = body; });
      }

      /* Taking, handing over and releasing all go through the database
         function rather than a plain update: it writes the line in the
         history that says who did it, and refuses an agent who is not
         one. */
      function assign(c, agentId) {
        var notice = (ctx && ctx.tell) || (A && A.tell);
        sb.rpc('chat_assign', { p_conversation: c.id, p_agent: agentId })
          .then(function (r) {
            if (r && r.error) throw r.error;
            c.assigned_to = agentId;
            return Promise.all([loadNotes(c.id), loadList()]);
          })
          .then(function () { paintThread(); }, function (e) {
            /* Phase 7 made this refusable. Before, the only way it could
               fail was a lost connection, and swallowing that was
               reasonable. Now it fails when a colleague has it — which
               is a thing the person tapping needs told, in the words the
               database used, because those words say what to do about
               it. Repainting afterwards puts the dropdown back to who
               actually holds it rather than who was just chosen. */
            var msg = (e && e.message) || '';
            if (notice) {
              notice(/hand it over|is with/i.test(msg)
                       ? msg
                       : 'That could not be changed' + (msg ? ': ' + msg : '.'));
            }
            return loadList().then(paintThread);
          });
      }

      /* ---- somebody is writing --------------------------------------
         Six seconds, the same window the database uses, worked out here
         as well so the dot goes out on time even if a poll is missed.
         The row is read on the message poll's beat: one indexed lookup
         every three seconds while a conversation is open, and none at
         all when none is. */
      var TYPING_FOR = 6000;
      function readTyping(id) {
        return sb.from('chat_conversations')
          .select('customer_typing_at')
          .eq('id', id)
          .then(function (r) {
            if (r.error || id !== openId) return;
            var at = r.data && r.data[0] && r.data[0].customer_typing_at;
            var on = !!at && (Date.now() - new Date(at).getTime()) < TYPING_FOR;
            if (on === theyAreTyping) return;
            theyAreTyping = on;
            paintTyping();
          }, function () {});
      }

      /* Saying that we are. Throttled to one every two seconds: a person
         types far faster than that, and the database only needs to know
         it happened recently, not how many keys were pressed. */
      function sayTyping() {
        if (!openId) return;
        var now = Date.now();
        if (now - saidTypingAt < 2000) return;
        saidTypingAt = now;
        sb.rpc('chat_typing_shop', { p_conversation: openId })
          .then(function () {}, function () {});
      }

      /* The dot itself, put in and taken out on its own rather than by
         redrawing the log — rebuilding the messages every three seconds
         would fight the scroll position, and on a phone it would take
         the keyboard away. */
      function paintTyping() {
        if (!logEl) return;
        var dot = logEl.querySelector('.lc-typing');
        if (!theyAreTyping) { if (dot) dot.parentNode.removeChild(dot); return; }
        if (!dot) {
          dot = el('div', 'lc-typing');
          /* No words, by request. It is announced to a screen reader,
             which cannot see a dot breathe. */
          dot.setAttribute('role', 'status');
          dot.setAttribute('aria-label', 'They are typing');
          dot.appendChild(el('span', 'lc-dot'));
        }
        /* Always last: it stands where their message will land. */
        logEl.appendChild(dot);
        var near = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight;
        if (near < 80) logEl.scrollTop = logEl.scrollHeight;
      }

      function openConversation(id) {
        openId = id;
        msgs = [];
        /* Whoever was writing, it was in the conversation just left. */
        theyAreTyping = false;
        saidTypingAt = 0;
        paintList();
        paintThread();
        loadThread(id).then(function () { return markRead(id); });
        loadNotes(id);
        beatThread();
      }

      function reply(box) {
        /* readOnly rather than disabled is how a rescued draft is shown
           in a conversation somebody else has taken — readable and
           copyable, but not sendable. Pressing Enter in it must not
           start a round trip that can only be refused. */
        if (sending || !openId || box.readOnly) return;
        var body = (box.value || '').replace(/\s+$/, '');
        if (!body.trim()) return;
        sending = true;
        box.value = '';
        box.style.height = 'auto';

        /* The trigger in supabase-chat.sql stamps the conversation and
           moves both unread counts, so nothing here does that
           arithmetic: one place to be right about it. */
        sb.from('chat_messages')
          .insert({ conversation_id: openId, sender: 'shop', body: body.slice(0, 2000),
                    author_id: me })
          .then(function (r) {
            sending = false;
            if (r.error) {
              /* The words go back in the box, always: whatever went
                 wrong, a reply somebody typed is not something to lose.

                 And it is said out loud. The box is greyed when a
                 colleague holds the conversation, but the list only
                 refreshes every few seconds — so somebody can take it
                 between the last poll and this keystroke, and the
                 refusal arrives at a person who was looking at an
                 enabled box. Silence there reads as a broken panel. */
              box.value = body;
              box.dispatchEvent(new Event('input'));
              var notice = (ctx && ctx.tell) || (A && A.tell);
              var msg = (r.error && r.error.message) || '';
              if (notice && /hand it over|is with/i.test(msg)) {
                notice(msg + ' Your reply is still in the box.');
                draft = body;                    // survives the repaint below
                loadList().then(paintThread);
              } else if (notice) {
                notice('That did not send. Your reply is still in the box.');
              }
              return;
            }
            return loadThread(openId).then(loadList);
          })
          .catch(function () {
            sending = false;
            box.value = body;
            box.dispatchEvent(new Event('input'));
          });
      }

      function setStatus(c, status) {
        sb.from('chat_conversations').update({ status: status }).eq('id', c.id)
          .then(function () { c.status = status; paintThread(); return loadList(); });
      }

      /* Gone, with its messages and its notes. The thread column is
         emptied first because the conversation it was showing no longer
         exists, and a panel left standing over a deleted row is the next
         poll's error. */
      function removeConversation(c) {
        /* The admin's own notice, not the tell(host, words) further down
           this file that writes into a tool's message line. */
        var notice = (ctx && ctx.tell) || (A && A.tell);
        sb.rpc('chat_delete', { p_id: c.id }).then(function (r) {
          if (r && r.error) throw r.error;
          if (openId === c.id) { openId = null; msgs = []; notes = []; painted = ''; }
          return loadList();
        }).then(function () { paintThread(); }, function (e) {
          var msg = (e && e.message) || String(e);
          if (!notice) return;
          notice(/permitted|owner/i.test(msg)
                   ? 'Only the shop owner can delete a conversation.'
                   : 'That could not be deleted: ' + msg);
        });
      }

      /* ---- keeping up ------------------------------------------------ */
      function beatList() {
        if (listTimer) clearInterval(listTimer);
        listTimer = setInterval(function () {
          if (!document.hidden) loadList();
        }, LIST_EVERY);
      }
      function beatThread() {
        if (threadTimer) clearInterval(threadTimer);
        threadTimer = setInterval(function () {
          if (!document.hidden && openId) loadThread(openId);
        }, THREAD_EVERY);
      }

      pick.addEventListener('change', function () {
        filter = pick.value;
        loadList();
      });
      mePick.addEventListener('change', function () { sayHere(mePick.value); });
      meName.addEventListener('change', function () {
        var typed = (meName.value || '').trim();
        myName = typed || fallbackName;
        meName.value = myName;
        sayHere(mePick.value);
      });
      statsBtn.addEventListener('click', showStats);

      /* ---- being told ------------------------------------------------
         The phone, and the desk. chat-alerts.js does the work; this
         decides when to ask it to. */
      var alerts = window.VBP_CHAT_ALERTS || null;
      var bellBusy = false;

      function paintBell() {
        if (!alerts) { bellBtn.style.display = 'none'; return; }
        alerts.state().then(function (s) {
          bellBtn.disabled = bellBusy;
          if (!s.can) {
            /* Still shown, and still pressable on an iPhone: pressing it
               is how somebody finds out what to do about it. A hidden
               button explains nothing. */
            bellBtn.textContent = s.ios ? 'Notifications…' : 'Notifications off';
            bellBtn.title = s.why || '';
            bellBtn.classList.remove('is-on');
            bellBtn.disabled = !s.ios;
            return;
          }
          bellBtn.textContent = s.on ? 'Notifying this device' : 'Notify me here';
          bellBtn.classList.toggle('is-on', !!s.on);
          bellBtn.title = s.on
            ? 'This device buzzes when a customer writes. Press to stop.'
            : 'Buzz this device when a customer writes, even with the panel closed.';
        }, function () {});
      }

      bellBtn.addEventListener('click', function () {
        if (!alerts || bellBusy) return;
        var notice = (ctx && ctx.tell) || (A && A.tell);
        bellBusy = true;
        bellBtn.disabled = true;
        alerts.state().then(function (s) {
          if (!s.can) throw new Error(s.why || 'Notifications are not available here.');
          if (s.on) {
            return alerts.disable(sb).then(function () {
              if (notice) notice('This device will stop buzzing. Your others still will.');
            });
          }
          return alerts.enable(sb).then(function () {
            /* Proof, immediately. The whole feature is invisible until
               something arrives, and somebody who presses a button and
               sees nothing has no way of telling it worked. */
            alerts.ding(0.3);
            if (notice) {
              notice('This device will now buzz when a customer writes — ' +
                     'even with the panel closed.');
            }
          });
        }).then(function () {
          bellBusy = false; paintBell();
        }, function (e) {
          bellBusy = false;
          if (notice) notice((e && e.message) || 'That did not work.');
          paintBell();
        });
      });

      /* Tapping a notification when the panel is already open. sw.js
         sends this rather than reloading, which would throw away a
         half-typed reply. */
      function onWorkerMessage(e) {
        var d = e && e.data;
        if (!d) return;
        if (d.type === 'chat-resubscribe' && alerts) { alerts.refresh(sb); return; }
        if (d.type === 'chat-open') {
          /* This handler only exists while the chats page is on screen,
             so there is usually nowhere to go — the useful part is
             fetching straight away rather than waiting out the poll, so
             the message being pointed at is already there. */
          if (ctx && ctx.navigate) { try { ctx.navigate('chats'); } catch (err) {} }
          loadList();
        }
      }
      if (navigator.serviceWorker && navigator.serviceWorker.addEventListener) {
        navigator.serviceWorker.addEventListener('message', onWorkerMessage);
      }

      /* The sound and the tab count, for somebody who has the panel open
         in another tab. Only messages from customers count, and only
         ones that arrived after this page loaded — a backlog from
         yesterday is not something to be startled by. */
      var seenTotal = null;
      function alertOnNew() {
        if (!alerts) return;
        var waiting = convs.reduce(function (n, c) {
          return n + (c.status === 'open' ? (Number(c.shop_unread) || 0) : 0);
        }, 0);

        if (seenTotal === null) { seenTotal = waiting; alerts.badge(waiting); return; }
        if (waiting > seenTotal && document.hidden && chatSet.deskSound !== false) {
          /* The setting is out of ten, because that is a number somebody
             can pick; the sound wants nought to one. */
          var v = Number(chatSet.deskVolume);
          alerts.ding(isFinite(v) && v > 0 ? Math.min(10, v) / 10 : 0.4);
        }
        seenTotal = waiting;
        alerts.badge(waiting);
      }

      /* Who this operator is. Everything that attributes a reply, a note
         or a hand-over needs it, so the page waits for it before it
         announces itself at the desk. */
      function findMe() {
        return Promise.resolve(sb.auth.getSession()).then(function (r) {
          var u = r && r.data && r.data.session && r.data.session.user;
          me = (u && u.id) || null;
          fallbackName = nameFromEmail(u && u.email);
          if (!me) return loadAgents();
          /* Announced without a name the first time, so that a name this
             operator chose is not written over by one invented from
             their email address before it has even been read. */
          return sayHere('online', null).then(function () {
            var mine = agents.filter(function (a) { return a.id === me; })[0];
            myName = (mine && mine.display_name) || fallbackName;
            /* Never over something they have already started typing. */
            if (!nameTouched) meName.value = myName;
            /* Nothing stored yet: put the made-up one in, so a colleague
               sees a name rather than a blank. */
            if (!(mine && mine.display_name)) return sayHere('online');
          });
        }, function () { return loadAgents(); });
      }
      function beatPresence() {
        if (presenceTimer) clearInterval(presenceTimer);
        presenceTimer = setInterval(function () {
          if (!document.hidden && me) sayHere(mePick.value);
        }, PRESENCE_EVERY);
      }

      /* The admin shell replaces this host when another page is opened.
         Without this the timers would outlive the page and keep asking
         for conversations nobody is looking at. */
      function teardown() {
        if (listTimer) clearInterval(listTimer);
        if (threadTimer) clearInterval(threadTimer);
        if (presenceTimer) clearInterval(presenceTimer);
        /* Leaving the page is leaving the desk. Said rather than left to
           time out, so a colleague sees it straight away. */
        if (me) sayHere('offline');
        /* The shop's name back in the tab, and the number off the app
           icon. Leaving "(3)" on a tab that is now showing Orders is a
           count of something the person is no longer looking at. */
        if (alerts) alerts.badge(0);
        if (navigator.serviceWorker && navigator.serviceWorker.removeEventListener) {
          navigator.serviceWorker.removeEventListener('message', onWorkerMessage);
        }
      }
      if (typeof MutationObserver === 'function' && host.parentNode) {
        var obs = new MutationObserver(function () {
          if (!document.body.contains(host)) { teardown(); obs.disconnect(); }
        });
        obs.observe(document.body, { childList: true, subtree: true });
      }
      window.addEventListener('beforeunload', function () {
        if (presenceTimer) clearInterval(presenceTimer);
      });

      paintThread();
      paintBell();
      findMe()
        .then(loadAgents)
        .then(loadOwner)
        .then(loadCanned)
        .then(beatPresence)
        .then(loadList)
        .then(beatList)
        .then(tellSiteAddress)
        .then(function () {
          /* A browser can quietly replace a subscription, at which point
             the row in the database points at an address that will
             answer 410 for ever and this device stops buzzing without
             anybody being told. Rewriting it on every visit is one
             upsert and closes that off. */
          if (alerts) return alerts.refresh(sb).then(paintBell, paintBell);
        });
    }
  });
})();
