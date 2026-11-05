// Public open-data point layers, fetched for the visible area and cached for offline use.
// Sources: OpenStreetMap via Overpass API (ODbL), Wikipedia geosearch (CC BY-SA), Open-Meteo (CC BY 4.0).

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

export const POI_LAYERS = [
  { id: 'springs', name: 'מעיינות ומקורות מים', icon: '💧', color: '#1e88e5',
    q: 'nwr["natural"="spring"];nwr["amenity"="drinking_water"];nwr["natural"="water"]["water"="pond"];nwr["man_made"="water_well"];' },
  { id: 'views', name: 'תצפיות', icon: '👁️', color: '#00897b', q: 'nwr["tourism"="viewpoint"];' },
  { id: 'peaks', name: 'פסגות', icon: '⛰️', color: '#6d4c41', q: 'node["natural"="peak"]["name"];' },
  { id: 'history', name: 'עתיקות ואתרי מורשת', icon: '🏛️', color: '#8d6e63',
    q: 'nwr["historic"~"archaeological_site|ruins|castle|fort|tomb|monument|memorial"]["name"];' },
  { id: 'caves', name: 'מערות', icon: '🕳️', color: '#455a64', q: 'nwr["natural"="cave_entrance"];' },
  { id: 'water', name: 'מפלים ובריכות', icon: '🌊', color: '#0277bd', q: 'nwr["waterway"="waterfall"];nwr["natural"="water"]["name"];' },
  { id: 'camp', name: 'חניוני לילה ופיקניק', icon: '⛺', color: '#558b2f',
    q: 'nwr["tourism"~"camp_site|picnic_site"];nwr["leisure"="picnic_table"]["name"];' },
  { id: 'parks', name: 'שמורות, גנים ויערות', icon: '🌳', color: '#2e7d32',
    q: 'nwr["boundary"="protected_area"]["name"];nwr["leisure"="nature_reserve"]["name"];nwr["landuse"="forest"]["name"];' },
  { id: 'tourism', name: 'אטרקציות ומוזיאונים', icon: '🎯', color: '#ad1457', q: 'nwr["tourism"~"attraction|museum"]["name"];' },
  { id: 'fuel', name: 'דלק', icon: '⛽', color: '#ef6c00', q: 'nwr["amenity"="fuel"];' },
  { id: 'danger', name: 'שטחים מוגבלים ושטחי אש', icon: '⚠️', color: '#c62828',
    q: 'nwr["landuse"="military"];nwr["military"~"danger_area|range"];nwr["access"="no"]["name"];' },
];

const cacheKey = (layer, bb) => `poi:${layer}:${bb.map(n => n.toFixed(2)).join(',')}`;

function roundedBounds(map) {
  const b = map.getBounds();
  // Snap to a ~0.05° grid so small pans reuse the cached query.
  const s = 0.05;
  return [Math.floor(b.getSouth() / s) * s, Math.floor(b.getWest() / s) * s, Math.ceil(b.getNorth() / s) * s, Math.ceil(b.getEast() / s) * s];
}

async function overpass(query) {
  let lastErr;
  for (const url of OVERPASS) {
    try {
      const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(query),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      if (r.ok) return r.json();
      lastErr = new Error('Overpass ' + r.status);
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

function osmToGeoJSON(json, layer) {
  const features = [];
  for (const el of json.elements || []) {
    const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
    if (lat == null) continue;
    const t = el.tags || {};
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: {
        layer: layer.id, icon: layer.icon, color: layer.color,
        name: t['name:he'] || t.name || t['name:en'] || layer.name,
        desc: [t.description, t['description:he'], t.ele && `גובה ${t.ele} מ'`, t.website].filter(Boolean).join(' · '),
        wiki: t.wikipedia || '', osm: `https://www.openstreetmap.org/${el.type}/${el.id}`,
      } });
  }
  return features;
}

export async function loadPoiLayer(map, layer, { idb }) {
  const bb = roundedBounds(map);
  const key = cacheKey(layer.id, bb);
  const cached = await idb.get('cache', key);
  if (cached && Date.now() - cached.t < 7 * 864e5) return cached.features;
  const area = bb.join(',');
  const body = layer.q.split(';').filter(Boolean).map(s => `${s}(${area});`).join('');
  const json = await overpass(`[out:json][timeout:25];(${body});out center 800;`);
  const features = osmToGeoJSON(json, layer);
  await idb.put('cache', { key, t: Date.now(), features });
  return features;
}

export async function loadWikipedia(map, { idb }) {
  const c = map.getCenter();
  const key = `wiki:${c.lat.toFixed(2)},${c.lng.toFixed(2)}`;
  const cached = await idb.get('cache', key);
  if (cached && Date.now() - cached.t < 14 * 864e5) return cached.features;
  const features = [];
  for (const lang of ['he', 'en']) {
    const url = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=geosearch`
      + `&ggscoord=${c.lat}|${c.lng}&ggsradius=10000&ggslimit=50&prop=coordinates|extracts|info&exintro=1&explaintext=1&exsentences=3&inprop=url`;
    try {
      const j = await (await fetch(url)).json();
      for (const p of Object.values(j.query?.pages || {})) {
        const co = p.coordinates?.[0]; if (!co) continue;
        if (lang === 'en' && features.some(f => Math.abs(f.geometry.coordinates[1] - co.lat) < 1e-4)) continue;
        features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [co.lon, co.lat] },
          properties: { layer: 'wiki', icon: '📚', color: '#37474f', name: p.title, desc: p.extract || '', url: p.fullurl, lang } });
      }
    } catch { /* offline or blocked: skip */ }
  }
  await idb.put('cache', { key, t: Date.now(), features });
  return features;
}

export async function weatherAt(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
    + '&current=temperature_2m,wind_speed_10m,precipitation,weather_code'
    + '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset&timezone=auto&forecast_days=3';
  return (await fetch(url)).json();
}

export const WMO = { 0: 'בהיר', 1: 'בהיר ברובו', 2: 'מעונן חלקית', 3: 'מעונן', 45: 'ערפל', 48: 'ערפל', 51: 'טפטוף', 53: 'טפטוף', 55: 'טפטוף',
  61: 'גשם קל', 63: 'גשם', 65: 'גשם חזק', 71: 'שלג', 73: 'שלג', 75: 'שלג כבד', 80: 'ממטרים', 81: 'ממטרים', 82: 'ממטרים חזקים', 95: 'סופת רעמים', 96: 'ברד', 99: 'ברד' };
