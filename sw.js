const CACHE_NAME = 'melo-cache-v1';

self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(clients.claim()));

self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // On intercepte uniquement les fichiers MP3 de Backblaze
  if (url.includes('backblazeb2.com') || url.endsWith('.mp3')) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.match(event.request).then((response) => {
          // Si déjà en mémoire, on sert le fichier localement (0 data)
          if (response) return response;

          // Sinon, on télécharge et on clone le flux vers le cache
          return fetch(event.request).then((networkResponse) => {
            cache.put(event.request, networkResponse.clone());
            return networkResponse;
          });
        });
      })
    );
  }
});