// APP_VERSION in app/index.html is de enige bron van waarheid. De registratie geeft
// die mee als ?v=, zodat de cachenaam nooit los kan drijven van de app.
const PREFIX = 'padel-bracket-';
const VERSION = new URL(self.location).searchParams.get('v') || 'dev';
const CACHE = PREFIX + VERSION;
const ASSETS = ['./', './index.html', './manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  // Ruim elke oude cache van deze app op, ongeacht hoe die heette
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});

// Echte web push (blijft werken als de app dicht is)
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch {}
  const title = data.title || 'PadelBracket';
  const body = data.body || '';
  const tag = data.tag || 'padel-round';
  const url = data.url || './';
  e.waitUntil(self.registration.showNotification(title, {
    body,
    tag,
    data: { url },
    icon: '../icon.svg',
    badge: '../icon.svg',
    vibrate: [200, 100, 200]
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url === url && 'focus' in c) return c.focus();
      }
      for (const c of list) {
        if ('focus' in c) { c.focus(); if ('navigate' in c) return c.navigate(url); return; }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
