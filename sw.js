const CACHE_NAME = 'pokedex-shell-v2';
const SHELL_FILES = [
  './', './index.html', './style.css', './app.js', './manifest.json',
  './pokemon-fr.json', './type-fr.json', './move-fr.json', './ability-fr.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // App shell: cache-first
  if (SHELL_FILES.some((f) => request.url.endsWith(f.replace('./', '')))) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request))
    );
    return;
  }

  // PokeAPI + sprites: stale-while-revalidate style
  if (request.url.includes('pokeapi.co') || request.url.includes('raw.githubusercontent.com')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        const fetchPromise = fetch(request)
          .then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          })
          .catch(() => cached);
        return cached || fetchPromise;
      })
    );
  }
});
