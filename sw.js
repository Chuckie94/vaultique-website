/* =====================================================================
   Vaultique Boutique Point — the part that is awake when nobody is
   ---------------------------------------------------------------------
   A service worker is the only thing a browser will run when its tab is
   shut and the phone is in a pocket. That is the whole reason this file
   exists. It receives the push the shop's server sent, shows it, and
   opens the chats screen when it is tapped.

   WHY IT DOES NOT CACHE ANYTHING. A service worker can also serve files
   from its own store, and most of them do. This one deliberately has no
   fetch handler at all. The admin panel is updated by uploading a new
   folder; a caching worker would go on serving yesterday's JavaScript to
   a shop that had just been told the fix was live, and the usual cure —
   clearing site data on a phone — is not something to ask of anyone. A
   notification worker that caches nothing cannot be wrong about
   anything.

   WHERE IT LIVES. At the site root, and it has to be. A worker's reach
   is the folder it was served from, so one at /assets/sw.js could not
   watch over /admin.html.
   ===================================================================== */

/* A new upload takes over at once rather than waiting for every tab in
   the shop to be closed — which, on a till that is never shut down,
   could be weeks. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

const ICON = '/images/icon-192.png';
const BADGE = '/images/badge-96.png';

self.addEventListener('push', (event) => {
  /* Everything below has to survive a push that arrives malformed. A
     browser that is handed a push its worker throws on will, after a few
     of them, quietly stop delivering pushes to the site at all — so the
     cost of an unguarded parse here is not one lost buzz, it is all of
     them. */
  let d = {};
  try { d = event.data ? event.data.json() : {}; }
  catch (e) {
    try { d = { body: event.data ? event.data.text() : '' }; }
    catch (e2) { d = {}; }
  }

  const title = d.title || 'Vaultique Boutique';
  const options = {
    body: d.body || 'Someone is waiting in chat.',
    icon: ICON,
    badge: BADGE,
    /* One notification per conversation. A customer sending four
       messages should leave one line on the lock screen saying the
       newest thing, not four saying the same. */
    tag: d.tag || 'chat',
    renotify: true,
    /* It buzzes even if an older one from the same person is still
       showing — a second question is still a customer waiting. */
    vibrate: [200, 100, 200],
    timestamp: Date.now(),
    data: { url: d.url || '/admin.html#/chats' }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) ||
                 '/admin.html#/chats';

  event.waitUntil((async () => {
    const open = await self.clients.matchAll({
      type: 'window', includeUncontrolled: true
    });

    /* If the admin panel is already open somewhere — very often it is,
       on the shop's own computer — bring that window forward rather than
       opening a second copy of it. Two admin tabs polling the same
       conversation is how a reply gets sent twice. */
    for (const c of open) {
      if (c.url.indexOf('/admin.html') !== -1) {
        try { await c.focus(); } catch (e) {}
        /* The panel listens for this and moves itself to the right
           conversation without reloading, which would lose a half-typed
           reply. */
        try { c.postMessage({ type: 'chat-open', url: target }); } catch (e) {}
        return;
      }
    }

    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});

/* A browser may replace a subscription on its own — after an update, or
   when it has not been used for a long time. The old one stops working
   the moment it does.

   There is nothing this file can do about that by itself: saving the new
   subscription means writing to the database, and a service worker has
   no login. So it tells any open page, which does have one. If no page
   is open, the next person to open the panel puts it right, because the
   panel checks its subscription every time it loads. */
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({
      type: 'window', includeUncontrolled: true
    });
    for (const c of open) {
      try { c.postMessage({ type: 'chat-resubscribe' }); } catch (e) {}
    }
  })());
});

/* The panel asks for this after uploading a new build, so the new worker
   does not sit waiting behind the old one. */
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'skip-waiting') self.skipWaiting();
});
