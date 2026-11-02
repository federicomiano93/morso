// Service worker: makes Morso open and work with no connection (e.g. in the gym).
// Strategy: network first (so a new release shows up as soon as the phone is online), falling back
// to the cached copy after a short wait or when offline. Only this site's own files are cached;
// GitHub and Open Food Facts requests go straight to the network and are never stored.

const CACHE = 'morso-shell';
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
const NETWORK_WAIT_MS = 4000;

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

function fromNetwork(request) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('slow')), NETWORK_WAIT_MS);
    fetch(request).then(
      (res) => { clearTimeout(timer); resolve(res); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fromNetwork(request);
      if (res.ok) cache.put(request, res.clone());
      return res;
    } catch {
      const hit = (await cache.match(request, { ignoreSearch: true })) || (request.mode === 'navigate' ? await cache.match('index.html') : null);
      return hit || Response.error();
    }
  })());
});
