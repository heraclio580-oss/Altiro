// Altiro service worker: shows workout reminders pushed from the server, and opens the app when one is
// tapped. It doesn't cache anything, so the app always loads its latest version.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data && event.data.text() }; }
  const title = data.title || 'Altiro';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: 'icons/icon-192.png',
    badge: 'icons/badge-96.png',
    tag: data.tag || 'altiro-reminder', // a newer reminder replaces an older one instead of stacking
    data: { url: data.url || './' },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || './', self.registration.scope).href;
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const app = open.find(c => c.url.startsWith(self.registration.scope));
    if (app) { await app.focus(); app.postMessage({ type: 'altiro-open-today' }); return; }
    await self.clients.openWindow(url);
  })());
});
