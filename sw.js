// Termin web — service worker : la coquille de la page reste disponible sans
// réseau (réseau d'abord, cache en secours). L'agenda lui-même vit dans le
// cache local de la page (dernière synchronisation) et dans iCloud.
const VERSION = 'termin-web-7';
const COQUILLE = ['./', './index.html', './styles.css', './regles.js', './magasin.js', './config.js', './app.js', './manifest.webmanifest', './icone-192.png', './icone-512.png', 'https://cdn.apple-cloudkit.com/ck/2/cloudkit.js'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => Promise.allSettled(COQUILLE.map((u) => c.add(u)))).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((cles) => Promise.all(cles.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  const estCoquille = e.request.method === 'GET' && (url.origin === self.location.origin || url.host === 'cdn.apple-cloudkit.com');
  if (!estCoquille) return;   // les appels CloudKit passent tels quels
  e.respondWith(fetch(e.request).then((r) => { if (r && (r.ok || r.type === 'opaque')) { const copie = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copie)); } return r; })
    .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html'))));
});
