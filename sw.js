// Service worker: makes Morso open and work with no connection (e.g. in the gym).
// All app files are cached together under a name derived from their content (VERSION, written by
// `npm run stamp`; a test fails if it is stale). Files are served from that one cache, so the phone
// never mixes old and new files; a new release installs in the background and takes over on the next
// launch. Only this site's own files are cached: GitHub and Open Food Facts requests go straight to the
// network and are never stored.

const VERSION = 'e73e21a5ba14';
const CACHE = `morso-${VERSION}`;
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/model.js',
  'js/store.js',
  'js/sync.js',
  'js/github.js',
  'js/off.js',
  'js/claude-import.js',
  'js/starter-foods.js',
  'js/ui.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' })))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = (await cache.match(request, { ignoreSearch: true })) || (request.mode === 'navigate' ? await cache.match('index.html') : null);
    if (hit) return hit;
    try {
      return await fetch(request);
    } catch {
      return Response.error();
    }
  })());
});
