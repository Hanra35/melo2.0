const CACHE_NAME = 'melo-cache-v1';

self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(clients.claim()));

self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // On cible les fichiers audio de Backblaze
  if (url.includes('backblazeb2.com') || url.endsWith('.mp3')) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.match(event.request).then((response) => {
          
          // 1. Si déjà en cache, on le lit de là
          if (response) return response;

          // 2. SINON : On laisse passer la requête normale vers le réseau
          // MAIS on ajoute un "listener" pour copier le résultat dans le cache
          return fetch(event.request).then((networkResponse) => {
            // On vérifie que la réponse est valide avant de la mettre en cache
            if (networkResponse.status === 200 || networkResponse.status === 206) {
              cache.put(event.request, networkResponse.clone());
            }
            return networkResponse;
          }).catch(() => {
            // Optionnel : message si erreur réseau
          });
        });
      })
    );
  }
});
