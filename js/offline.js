// Offline maps: download the tiles of the visible area into Cache Storage. The service worker serves them cache-first.
import { lonLatToTile } from './geo.js';

export const TILE_CACHE = 'tiles-saved';
export const MAX_TILES = 6000;

export function countTiles(bounds, zMin, zMax) {
  let n = 0;
  for (let z = zMin; z <= zMax; z++) {
    const [x0, y0] = lonLatToTile(bounds.getWest(), bounds.getNorth(), z);
    const [x1, y1] = lonLatToTile(bounds.getEast(), bounds.getSouth(), z);
    n += (x1 - x0 + 1) * (y1 - y0 + 1);
  }
  return n;
}

function* tileUrls(source, bounds, zMin, zMax) {
  for (let z = zMin; z <= Math.min(zMax, source.maxzoom); z++) {
    const [x0, y0] = lonLatToTile(bounds.getWest(), bounds.getNorth(), z);
    const [x1, y1] = lonLatToTile(bounds.getEast(), bounds.getSouth(), z);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const t = source.tiles[(x + y) % source.tiles.length];
      yield t.replace('{z}', z).replace('{x}', x).replace('{y}', y);
    }
  }
}

// Downloads politely: 4 parallel requests, skipping tiles already cached.
export async function downloadArea(sources, bounds, zMin, zMax, onProgress, signal) {
  const cache = await caches.open(TILE_CACHE);
  const urls = sources.flatMap(s => [...tileUrls(s, bounds, zMin, zMax)]);
  let done = 0, failed = 0;
  const queue = urls.slice();
  async function worker() {
    while (queue.length && !signal?.aborted) {
      const url = queue.shift();
      try {
        if (!(await caches.match(url))) {
          const r = await fetch(url, { mode: 'cors' });
          if (r.ok) await cache.put(url, r); else failed++;
        }
      } catch { failed++; }
      done++;
      if (done % 10 === 0 || done === urls.length) onProgress(done, urls.length, failed);
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  return { total: urls.length, failed };
}

export async function cacheStats() {
  const keys = await (await caches.open(TILE_CACHE)).keys();
  let bytes = null;
  if (navigator.storage?.estimate) bytes = (await navigator.storage.estimate()).usage;
  return { tiles: keys.length, bytes };
}

export async function clearTiles() { await caches.delete(TILE_CACHE); await caches.delete('tiles-v1'); }
