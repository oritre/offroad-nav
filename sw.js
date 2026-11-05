// Service worker: app shell offline, map tiles cache-first (filled by browsing and by "download area").
const VERSION = 'v1';
const SHELL = `shell-${VERSION}`;
const TILES = 'tiles-v1'; // tiles seen while browsing (trimmed)
// 'tiles-saved' holds downloaded areas and is never trimmed.
const RUNTIME = 'runtime-v1';
const SHELL_FILES = [
  './', './index.html', './css/app.css', './manifest.webmanifest',
  './vendor/maplibre-gl.js', './vendor/maplibre-gl.css', './vendor/togeojson.mjs',
  './js/app.js', './js/basemaps.js', './js/overlays.js', './js/idb.js', './js/sync.js', './js/firebaseConfig.js',
  './js/geo.js', './js/offline.js', './js/guided.js', './js/ui.js',
  './icons/icon-192.png', './icons/icon-512.png',
];
const TILE_HOSTS = ['israelhiking.osm.org.il', 'tile.opentopomap.org', 'server.arcgisonline.com', 'tile.openstreetmap.org',
  'tile-cyclosm.openstreetmap.fr', 'tile.waymarkedtrails.org', 's3.amazonaws.com'];
const RUNTIME_HOSTS = ['www.gstatic.com'];
const MAX_RUNTIME_TILES = 8000;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('shell-') && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});

const isTile = url => TILE_HOSTS.some(h => url.hostname === h || url.hostname.endsWith('.' + h));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (isTile(url)) {
    e.respondWith((async () => {
      const hit = await caches.match(req.url);
      if (hit) return hit;
      const cache = await caches.open(TILES);
      try {
        const r = await fetch(req);
        if (r.ok) { cache.put(req.url, r.clone()); trim(cache); }
        return r;
      } catch { return new Response('', { status: 504 }); }
    })());
    return;
  }

  if (url.origin === location.origin) {
    // App shell: network first (so updates arrive), cache fallback offline.
    e.respondWith(fetch(req).then(r => {
      if (r.ok) caches.open(SHELL).then(c => c.put(req, r.clone()));
      return r;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./index.html'))));
    return;
  }

  if (RUNTIME_HOSTS.includes(url.hostname)) {
    e.respondWith(caches.open(RUNTIME).then(async c => (await c.match(req)) || fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; })));
  }
});

let trimming = false;
async function trim(cache) {
  if (trimming) return; trimming = true;
  try {
    const keys = await cache.keys();
    if (keys.length > MAX_RUNTIME_TILES) for (const k of keys.slice(0, keys.length - MAX_RUNTIME_TILES)) await cache.delete(k);
  } finally { trimming = false; }
}
