// Guided routes: a route line plus numbered stations; each station's reading opens (and can be read aloud)
// when you arrive within ARRIVE_M of it. Route files are private and never ship with the app:
// they are imported from a file or fetched from a private library URL (e.g. the home Pi over Tailscale).
//
// Route JSON format (v1):
// { "id": "43257", "title": "...", "intro": [[type, text], ...], "line": [[lon,lat],...], "driveLine": [[lon,lat],...],
//   "stations": [{ "n": 1, "name": "...", "lat": 33.2, "lon": 35.7, "role": "walking"|"driving access", "blocks": [[type, text], ...] }] }
// block types: h = heading, p = paragraph, v = verse/quote, d = driving direction.
import { idb } from './idb.js';
import { distance } from './geo.js';
import { $, esc, toast } from './ui.js';

export const ARRIVE_M = 45;

export function normalizeRoute(raw, fallbackId) {
  // Accept the stations.json produced by the route pipeline as well as the v1 format.
  const stations = (raw.stations || []).map(s => ({
    n: s.n ?? s.number, name: s.short_name || s.name, lat: s.lat, lon: s.lon, role: s.role || 'walking', blocks: s.blocks || [],
  }));
  return {
    id: String(raw.id || raw.post_id || fallbackId || Date.now()),
    title: raw.title || raw.route || 'מסלול',
    intro: raw.intro || [],
    line: raw.line || [], driveLine: raw.driveLine || [],
    stations, importedAt: Date.now(),
  };
}

export function blocksToHtml(blocks) {
  return blocks.map(([t, text]) => {
    if (t === 'h') return `<h3>${esc(text)}</h3>`;
    if (t === 'v') return `<p class="verse">${esc(text)}</p>`;
    if (t === 'd') return `<p class="dir">${esc(text)}</p>`;
    return `<p>${esc(text)}</p>`;
  }).join('');
}

export function blocksToSpeech(blocks) { return blocks.filter(([t]) => t !== 'd').map(([, x]) => x).join('\n'); }

// --- reader -----------------------------------------------------------------
let speakingText = '';
export function openReader(title, blocks) {
  $('#readerTitle').textContent = title;
  $('#readerBody').innerHTML = blocksToHtml(blocks) || '<p class="dir">אין טקסט לתחנה הזו.</p>';
  $('#readerBody').scrollTop = 0;
  $('#reader').classList.remove('hidden');
  speakingText = blocksToSpeech(blocks);
  if (guide.autoSpeak) speak(speakingText);
}
export function closeReader() { $('#reader').classList.add('hidden'); speechSynthesis?.cancel(); }

export function speak(text) {
  if (!('speechSynthesis' in window) || !text) return toast('הקראה לא נתמכת בדפדפן הזה');
  speechSynthesis.cancel();
  const voices = speechSynthesis.getVoices();
  const he = voices.find(v => /^he|^iw/i.test(v.lang));
  // Long texts are split so the browser does not cut them off.
  const parts = text.match(/[^.!?\n]{1,220}[.!?\n]?/g) || [text];
  for (const p of parts) {
    const u = new SpeechSynthesisUtterance(p);
    u.lang = 'he-IL'; if (he) u.voice = he; u.rate = 0.95;
    speechSynthesis.speak(u);
  }
}
export function toggleSpeak() {
  if (speechSynthesis?.speaking) speechSynthesis.cancel(); else speak(speakingText);
}

// --- guiding state ----------------------------------------------------------
export const guide = {
  route: null, visited: new Set(), autoSpeak: false, wakeLock: null, onUpdate: null,

  async start(route) {
    this.route = route;
    this.visited = new Set(await idb.kvGet(`visited:${route.id}`, []));
    this.autoSpeak = await idb.kvGet('autoSpeak', false);
    try { this.wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* not supported */ }
    await idb.kvSet('activeRoute', route.id);
    this.onUpdate?.();
  },

  async stop() {
    this.route = null;
    try { await this.wakeLock?.release(); } catch { /* ignore */ }
    this.wakeLock = null;
    await idb.kvSet('activeRoute', null);
    this.onUpdate?.();
  },

  async resetProgress() {
    if (!this.route) return;
    this.visited.clear();
    await idb.kvSet(`visited:${this.route.id}`, []);
    this.onUpdate?.();
  },

  nextStation(pos) {
    if (!this.route) return null;
    const left = this.route.stations.filter(s => !this.visited.has(s.n));
    if (!left.length) return null;
    if (!pos) return left[0];
    return left.reduce((a, b) => distance(pos, [a.lon, a.lat]) <= distance(pos, [b.lon, b.lat]) ? a : b);
  },

  // Called on every GPS fix.
  async onPosition(pos) {
    if (!this.route) return;
    for (const s of this.route.stations) {
      if (this.visited.has(s.n)) continue;
      if (distance(pos, [s.lon, s.lat]) <= ARRIVE_M) {
        this.visited.add(s.n);
        await idb.kvSet(`visited:${this.route.id}`, [...this.visited]);
        navigator.vibrate?.([200, 100, 200]);
        openReader(`📖 ${s.n} · ${s.name}`, s.blocks);
        this.onUpdate?.();
        break;
      }
    }
  },
};

// Re-acquire the wake lock when the app returns to the foreground.
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && guide.route && (!guide.wakeLock || guide.wakeLock.released)) {
    try { guide.wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* ignore */ }
  }
});

export async function fetchLibraryIndex(base) {
  const r = await fetch(new URL('routes.json', base.endsWith('/') ? base : base + '/'), { credentials: 'include' });
  if (!r.ok) throw new Error('library ' + r.status);
  return r.json();
}
export async function fetchLibraryRoute(base, id) {
  const r = await fetch(new URL(`routes/${encodeURIComponent(id)}.json`, base.endsWith('/') ? base : base + '/'), { credentials: 'include' });
  if (!r.ok) throw new Error('route ' + r.status);
  return normalizeRoute(await r.json(), id);
}
