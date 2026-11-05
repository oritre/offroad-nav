// Geometry helpers, GPX/KML import and GPX export.
import { gpx as gpxToGeo, kml as kmlToGeo } from '../vendor/togeojson.mjs';

const R = 6371008.8;
const rad = d => d * Math.PI / 180;

export function distance([lon1, lat1], [lon2, lat2]) {
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function bearing([lon1, lat1], [lon2, lat2]) {
  const y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

export function lineLength(coords) {
  let d = 0;
  for (let i = 1; i < coords.length; i++) d += distance(coords[i - 1], coords[i]);
  return d;
}

export const fmtDist = m => m < 1000 ? `${Math.round(m)} מ'` : `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} ק"מ`;
export const fmtTime = s => { const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h}:${String(m).padStart(2, '0')} ש'` : `${m} ד'`; };

export function bboxOf(geojson) {
  let w = 180, s = 90, e = -180, n = -90;
  const visit = c => { if (typeof c[0] === 'number') { w = Math.min(w, c[0]); e = Math.max(e, c[0]); s = Math.min(s, c[1]); n = Math.max(n, c[1]); } else c.forEach(visit); };
  (geojson.features || [geojson]).forEach(f => f.geometry && visit(f.geometry.coordinates));
  return [[w, s], [e, n]];
}

// Parse a GPX / KML / GeoJSON file into a list of {kind, name, desc, geometry}.
export async function parseFile(file) {
  const text = await file.text();
  const lower = file.name.toLowerCase();
  let fc;
  if (lower.endsWith('.geojson') || lower.endsWith('.json')) fc = JSON.parse(text);
  else {
    const dom = new DOMParser().parseFromString(text, 'text/xml');
    fc = lower.endsWith('.kml') ? kmlToGeo(dom) : gpxToGeo(dom);
  }
  const out = [];
  for (const f of fc.features || []) {
    if (!f.geometry) continue;
    const p = f.properties || {};
    const name = p.name || file.name.replace(/\.[^.]+$/, '');
    const desc = stripHtml(p.desc || p.description || p.cmt || '');
    const g = f.geometry;
    if (g.type === 'Point') out.push({ kind: 'point', name, desc, geometry: { type: 'Point', coordinates: g.coordinates.slice(0, 2) } });
    else if (g.type === 'LineString') out.push({ kind: 'track', name, desc, geometry: { type: 'LineString', coordinates: g.coordinates.map(c => c.slice(0, 3)) } });
    else if (g.type === 'MultiLineString') g.coordinates.forEach((line, i) =>
      out.push({ kind: 'track', name: g.coordinates.length > 1 ? `${name} (${i + 1})` : name, desc, geometry: { type: 'LineString', coordinates: line.map(c => c.slice(0, 3)) } }));
    else if (g.type === 'Polygon') out.push({ kind: 'track', name, desc, geometry: { type: 'LineString', coordinates: g.coordinates[0].map(c => c.slice(0, 2)) } });
  }
  return out;
}

function stripHtml(s) {
  if (typeof s !== 'string') s = s?.value || '';
  const d = new DOMParser().parseFromString(s, 'text/html');
  return (d.body.textContent || '').trim();
}

const esc = s => String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

export function toGPX(items, title = 'offroad-nav') {
  const wpts = items.filter(i => i.kind === 'point').map(i => {
    const [lon, lat] = i.geometry.coordinates;
    return `  <wpt lat="${lat}" lon="${lon}"><name>${esc(i.name)}</name>${i.desc ? `<desc>${esc(i.desc)}</desc>` : ''}</wpt>`;
  });
  const trks = items.filter(i => i.kind === 'track').map(i => {
    const pts = i.geometry.coordinates.map(c => `      <trkpt lat="${c[1]}" lon="${c[0]}">${c[2] != null ? `<ele>${c[2]}</ele>` : ''}${c[3] ? `<time>${new Date(c[3]).toISOString()}</time>` : ''}</trkpt>`).join('\n');
    return `  <trk><name>${esc(i.name)}</name>${i.desc ? `<desc>${esc(i.desc)}</desc>` : ''}\n    <trkseg>\n${pts}\n    </trkseg>\n  </trk>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="offroad-nav" xmlns="http://www.topografix.com/GPX/1/1">\n  <metadata><name>${esc(title)}</name></metadata>\n${[...wpts, ...trks].join('\n')}\n</gpx>\n`;
}

export function download(name, text, type = 'application/gpx+xml') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// Tile math for offline prefetch.
export function lonLatToTile(lon, lat, z) {
  const n = 2 ** z;
  const x = Math.floor((lon + 180) / 360 * n);
  const y = Math.floor((1 - Math.log(Math.tan(rad(lat)) + 1 / Math.cos(rad(lat))) / Math.PI) / 2 * n);
  return [Math.max(0, Math.min(n - 1, x)), Math.max(0, Math.min(n - 1, y))];
}
