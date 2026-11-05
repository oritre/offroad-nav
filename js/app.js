import { BASEMAPS, RASTER_OVERLAYS, DEM } from './basemaps.js';
import { POI_LAYERS, loadPoiLayer, loadWikipedia, weatherAt, WMO } from './overlays.js';
import { idb } from './idb.js';
import { sync } from './sync.js';
import { distance, bearing, lineLength, fmtDist, fmtTime, bboxOf, parseFile, toGPX, download } from './geo.js';
import { downloadArea, countTiles, cacheStats, clearTiles, MAX_TILES } from './offline.js';
import { guide, openReader, closeReader, toggleSpeak, normalizeRoute, fetchLibraryIndex, fetchLibraryRoute, ARRIVE_M } from './guided.js';
import { $, esc, openSheet, closeSheet, sheetOpen, toast, swatches, bindSwatches } from './ui.js';

const ISRAEL = [35.0, 31.6];
const settings = {
  base: await idb.kvGet('base', 'ihm'),
  overlays: new Set(await idb.kvGet('overlays', [])),
  pois: new Set(await idb.kvGet('pois', [])),
  wiki: await idb.kvGet('wiki', false),
  hillshade: await idb.kvGet('hillshade', false),
  terrain: await idb.kvGet('terrain', false),
  libraryUrl: await idb.kvGet('libraryUrl', ''),
};
const view = await idb.kvGet('view', { center: ISRAEL, zoom: 7.5 });

// ---------------------------------------------------------------- map
const sources = {}, layers = [];
for (const b of [...BASEMAPS, ...RASTER_OVERLAYS]) {
  sources[b.id] = { type: 'raster', tiles: b.tiles, tileSize: 256, maxzoom: b.maxzoom, attribution: b.attribution };
}
sources.dem = { type: 'raster-dem', tiles: DEM.tiles, encoding: DEM.encoding, tileSize: DEM.tileSize, maxzoom: DEM.maxzoom, attribution: DEM.attribution };
for (const b of BASEMAPS) layers.push({ id: b.id, type: 'raster', source: b.id, layout: { visibility: b.id === settings.base ? 'visible' : 'none' } });
layers.push({ id: 'hillshade', type: 'hillshade', source: 'dem', layout: { visibility: settings.hillshade ? 'visible' : 'none' },
  paint: { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': '#3b3424' } });
for (const o of RASTER_OVERLAYS) layers.push({ id: o.id, type: 'raster', source: o.id, paint: { 'raster-opacity': o.opacity },
  layout: { visibility: settings.overlays.has(o.id) ? 'visible' : 'none' } });

const map = new maplibregl.Map({
  container: 'map', center: view.center, zoom: view.zoom, maxPitch: 70, attributionControl: { compact: true },
  style: { version: 8, sources, layers }, dragRotate: true, pitchWithRotate: true,
});
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');
map.on('moveend', () => idb.kvSet('view', { center: map.getCenter().toArray(), zoom: map.getZoom() }));

const empty = () => ({ type: 'FeatureCollection', features: [] });
map.on('load', () => {
  if (settings.terrain) map.setTerrain({ source: 'dem', exaggeration: 1.3 });
  map.addSource('pois', { type: 'geojson', data: empty() });
  map.addSource('mine', { type: 'geojson', data: empty() });
  map.addSource('guide', { type: 'geojson', data: empty() });
  map.addSource('rec', { type: 'geojson', data: empty() });
  map.addSource('navline', { type: 'geojson', data: empty() });
  map.addSource('accuracy', { type: 'geojson', data: empty() });

  map.addLayer({ id: 'accuracy', type: 'fill', source: 'accuracy', paint: { 'fill-color': '#1a73e8', 'fill-opacity': 0.12 } });
  map.addLayer({ id: 'guide-drive', type: 'line', source: 'guide', filter: ['==', ['get', 'kind'], 'drive'],
    paint: { 'line-color': '#6b6b6b', 'line-width': 3, 'line-dasharray': [2, 2] } });
  map.addLayer({ id: 'guide-walk-casing', type: 'line', source: 'guide', filter: ['==', ['get', 'kind'], 'walk'],
    paint: { 'line-color': '#ffffff', 'line-width': 8, 'line-opacity': 0.8 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
  map.addLayer({ id: 'guide-walk', type: 'line', source: 'guide', filter: ['==', ['get', 'kind'], 'walk'],
    paint: { 'line-color': '#7d3cff', 'line-width': 5 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
  map.addLayer({ id: 'mine-lines', type: 'line', source: 'mine', filter: ['==', ['geometry-type'], 'LineString'],
    paint: { 'line-color': ['coalesce', ['get', 'color'], '#d63b2f'], 'line-width': 4 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
  map.addLayer({ id: 'rec-line', type: 'line', source: 'rec', paint: { 'line-color': '#d63b2f', 'line-width': 4, 'line-dasharray': [1, 1] } });
  map.addLayer({ id: 'navline', type: 'line', source: 'navline', paint: { 'line-color': '#1a73e8', 'line-width': 3, 'line-dasharray': [2, 1.5] } });
  map.addLayer({ id: 'pois', type: 'circle', source: 'pois',
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 3, 14, 7], 'circle-color': ['get', 'color'],
      'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } });
  map.addLayer({ id: 'mine-points', type: 'circle', source: 'mine', filter: ['==', ['geometry-type'], 'Point'],
    paint: { 'circle-radius': 8, 'circle-color': ['coalesce', ['get', 'color'], '#7d3cff'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2.5 } });

  for (const id of ['pois', 'mine-points', 'mine-lines']) {
    map.on('click', id, e => showFeaturePopup(e.features[0], e.lngLat));
    map.on('mouseenter', id, () => map.getCanvas().style.cursor = 'pointer');
    map.on('mouseleave', id, () => map.getCanvas().style.cursor = '');
  }
  renderMine();
  refreshPois();
  restoreRecording();
  restoreGuide();
});
map.on('moveend', debounce(refreshPois, 800));

// Long-press (touch) or right-click adds a point.
let pressTimer;
map.on('touchstart', e => { if (e.originalEvent.touches.length === 1) pressTimer = setTimeout(() => editPoint(null, e.lngLat), 650); });
['touchend', 'touchmove', 'dragstart', 'zoomstart'].forEach(ev => map.on(ev, () => clearTimeout(pressTimer)));
map.on('contextmenu', e => editPoint(null, e.lngLat));

// ---------------------------------------------------------------- user items (synced)
const items = new Map((await idb.all('items')).map(i => [i.id, i]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

async function saveItem(item) {
  item.updatedAt = Date.now();
  items.set(item.id, item);
  await idb.put('items', item);
  renderMine();
  sync.push(item).catch(() => toast('השמירה בענן תושלם כשתחזור הקליטה'));
}
async function deleteItem(id) {
  const it = items.get(id); if (!it) return;
  await saveItem({ ...it, deleted: true, geometry: { type: 'Point', coordinates: [0, 0] } });
}
function liveItems(kind) { return [...items.values()].filter(i => !i.deleted && (!kind || i.kind === kind)); }

function renderMine() {
  const src = map.getSource('mine'); if (!src) return;
  src.setData({ type: 'FeatureCollection', features: liveItems().filter(i => !i.hidden).map(i => ({ type: 'Feature', geometry: i.geometry,
    properties: { id: i.id, kind: i.kind, name: i.name, desc: i.desc || '', color: i.color || null, mine: true } })) });
}

sync.onChange(state => {
  const chip = $('#syncChip');
  const label = { off: 'מקומי בלבד', signedout: 'לא מחובר', syncing: 'מסנכרן…', live: 'מסונכרן ✓', offline: 'שמור, יסונכרן', error: 'שגיאת סנכרון', denied: 'חשבון לא מורשה' }[state] || state;
  chip.textContent = label;
  chip.classList.toggle('ok', state === 'live');
});
sync.init(async remote => {
  for (const r of remote) {
    const local = items.get(r.id);
    if (!local || (r.updatedAt || 0) > (local.updatedAt || 0)) { items.set(r.id, r); await idb.put('items', r); }
  }
  renderMine();
}).catch(() => toast('הסנכרון לא זמין כרגע'));

// ---------------------------------------------------------------- open data
async function refreshPois() {
  const src = map.getSource('pois'); if (!src) return;
  const wanted = POI_LAYERS.filter(l => settings.pois.has(l.id));
  if ((!wanted.length && !settings.wiki) || map.getZoom() < 10) { src.setData(empty()); return; }
  const all = [];
  await Promise.all(wanted.map(async l => {
    try { all.push(...await loadPoiLayer(map, l, { idb })); } catch { toast(`לא ניתן לטעון: ${l.name}`); }
  }));
  if (settings.wiki) all.push(...await loadWikipedia(map, { idb }));
  src.setData({ type: 'FeatureCollection', features: all });
}

// ---------------------------------------------------------------- popups
let popup;
function showFeaturePopup(f, lngLat) {
  const p = f.properties;
  const coord = f.geometry.type === 'Point' ? f.geometry.coordinates : [lngLat.lng, lngLat.lat];
  let html = `<div class="popup"><h4>${p.icon ? p.icon + ' ' : ''}${esc(p.name)}</h4>`;
  if (p.desc) html += `<p>${esc(p.desc)}</p>`;
  if (p.kind === 'track') {
    const it = items.get(p.id);
    if (it) html += `<p>אורך: ${fmtDist(lineLength(it.geometry.coordinates))}</p>`;
  }
  html += '<div class="btns">';
  if (f.geometry.type === 'Point') html += `<button class="btn primary" data-act="nav">נווט לכאן</button>`;
  if (p.mine) html += `<button class="btn" data-act="edit">עריכה</button><button class="btn" data-act="gpx">GPX</button><button class="btn danger" data-act="del">מחק</button>`;
  else html += `<button class="btn" data-act="save">שמור אצלי</button>`;
  if (p.url) html += `<a class="btn" href="${esc(p.url)}" target="_blank" rel="noopener">ויקיפדיה</a>`;
  if (p.osm) html += `<a class="btn" href="${esc(p.osm)}" target="_blank" rel="noopener">OSM</a>`;
  html += '</div></div>';
  popup?.remove();
  popup = new maplibregl.Popup({ maxWidth: '290px' }).setLngLat(coord).setHTML(html).addTo(map);
  const el = popup.getElement();
  el.querySelector('[data-act=nav]')?.addEventListener('click', () => { popup.remove(); startNav({ name: p.name, coord }); });
  el.querySelector('[data-act=edit]')?.addEventListener('click', () => { popup.remove(); p.kind === 'track' ? editTrack(items.get(p.id)) : editPoint(items.get(p.id)); });
  el.querySelector('[data-act=del]')?.addEventListener('click', async () => { if (confirm(`למחוק את "${p.name}"?`)) { popup.remove(); await deleteItem(p.id); } });
  el.querySelector('[data-act=gpx]')?.addEventListener('click', () => { const it = items.get(p.id); download(`${it.name}.gpx`, toGPX([it], it.name)); });
  el.querySelector('[data-act=save]')?.addEventListener('click', async () => {
    popup.remove();
    await saveItem({ id: uid(), kind: 'point', name: p.name, desc: [p.desc, p.url || p.osm].filter(Boolean).join('\n'), color: '#1e88e5', geometry: { type: 'Point', coordinates: coord } });
    toast('נשמר בנקודות שלך');
  });
}

// ---------------------------------------------------------------- edit forms
function editPoint(item, lngLat) {
  const isNew = !item;
  item = item || { id: uid(), kind: 'point', name: '', desc: '', color: '#7d3cff', geometry: { type: 'Point', coordinates: [lngLat.lng, lngLat.lat] } };
  let color = item.color || '#7d3cff';
  const [lon, lat] = item.geometry.coordinates;
  openSheet('edit', isNew ? 'נקודה חדשה' : 'עריכת נקודה', `
    <label class="field"><span>שם</span><input id="fName" value="${esc(item.name)}" placeholder="למשל: חניה, מעיין, תצפית"></label>
    <label class="field"><span>תיאור</span><textarea id="fDesc">${esc(item.desc)}</textarea></label>
    <div class="field"><span>צבע</span>${swatches(color)}</div>
    <p class="note">${lat.toFixed(5)}, ${lon.toFixed(5)}</p>
    <div class="btns"><button class="btn primary" id="fSave">שמור</button><button class="btn" id="fCancel">ביטול</button></div>`, root => {
    bindSwatches(root, c => color = c);
    root.querySelector('#fName').focus();
    root.querySelector('#fCancel').onclick = closeSheet;
    root.querySelector('#fSave').onclick = async () => {
      await saveItem({ ...item, name: root.querySelector('#fName').value.trim() || 'נקודה', desc: root.querySelector('#fDesc').value.trim(), color });
      closeSheet(); toast('נשמר');
    };
  });
}

function editTrack(item) {
  let color = item.color || '#d63b2f';
  openSheet('edit', 'עריכת מסלול', `
    <label class="field"><span>שם</span><input id="fName" value="${esc(item.name)}"></label>
    <label class="field"><span>תיאור</span><textarea id="fDesc">${esc(item.desc || '')}</textarea></label>
    <div class="field"><span>צבע</span>${swatches(color)}</div>
    <p class="note">אורך ${fmtDist(lineLength(item.geometry.coordinates))}</p>
    <div class="btns"><button class="btn primary" id="fSave">שמור</button><button class="btn" id="fCancel">ביטול</button></div>`, root => {
    bindSwatches(root, c => color = c);
    root.querySelector('#fCancel').onclick = closeSheet;
    root.querySelector('#fSave').onclick = async () => {
      await saveItem({ ...item, name: root.querySelector('#fName').value.trim() || item.name, desc: root.querySelector('#fDesc').value.trim(), color });
      closeSheet();
    };
  });
}

// ---------------------------------------------------------------- GPS
let me = null, meMarker, follow = false, heading = null, watchId = null;
function startGps() {
  if (watchId != null) return;
  if (!navigator.geolocation) return toast('אין GPS במכשיר הזה');
  $('#gpsChip').textContent = 'GPS: מחפש…';
  watchId = navigator.geolocation.watchPosition(onFix, err => {
    $('#gpsChip').textContent = err.code === 1 ? 'GPS: אין הרשאה' : 'GPS: אין קליטה';
  }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
}
function onFix(p) {
  const { longitude: lon, latitude: lat, accuracy, altitude, heading: h, speed } = p.coords;
  me = { coord: [lon, lat], accuracy, altitude, speed, t: p.timestamp };
  if (h != null && !Number.isNaN(h) && speed > 0.7) heading = h;
  $('#gpsChip').textContent = `GPS: ±${Math.round(accuracy)} מ'${altitude != null ? ` · ${Math.round(altitude)} מ' גובה` : ''}`;
  if (!meMarker) {
    const el = document.createElement('div'); el.className = 'me-dot'; el.innerHTML = '<div class="head"></div>';
    meMarker = new maplibregl.Marker({ element: el, rotationAlignment: 'map' }).setLngLat(me.coord).addTo(map);
  }
  meMarker.setLngLat(me.coord);
  meMarker.getElement().querySelector('.head').style.display = heading == null ? 'none' : '';
  if (heading != null) meMarker.setRotation(heading);
  map.getSource('accuracy')?.setData(circle(me.coord, accuracy));
  if (follow) map.easeTo({ center: me.coord, duration: 500 });
  onRecordFix(p);
  updateNav();
  guide.onPosition(me.coord);
}
function circle([lon, lat], r) {
  const pts = [];
  for (let i = 0; i <= 40; i++) {
    const a = i / 40 * 2 * Math.PI;
    pts.push([lon + (r / (111320 * Math.cos(lat * Math.PI / 180))) * Math.cos(a), lat + (r / 110540) * Math.sin(a)]);
  }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [pts] } };
}
// Compass for the heading arrow when standing still.
window.addEventListener('deviceorientationabsolute', e => { if (e.alpha != null && !(me?.speed > 0.7)) { heading = (360 - e.alpha) % 360; meMarker?.setRotation(heading); updateNav(); } }, true);

$('#btnLocate').onclick = () => {
  startGps();
  follow = !follow;
  $('#btnLocate').classList.toggle('active', follow);
  if (me) map.easeTo({ center: me.coord, zoom: Math.max(map.getZoom(), 15) });
};
map.on('dragstart', () => { if (follow) { follow = false; $('#btnLocate').classList.remove('active'); } });
$('#btnNorth').onclick = () => map.easeTo({ bearing: 0, pitch: 0 });

// ---------------------------------------------------------------- recording
let rec = null; // { coords: [[lon,lat,ele,t]], start }
async function restoreRecording() {
  rec = await idb.kvGet('recording', null);
  if (rec) { startGps(); updateRecUi(); toast('ממשיך את ההקלטה שהתחלת'); }
}
$('#btnRecord').onclick = async () => {
  if (!rec) {
    startGps();
    rec = { coords: [], start: Date.now() };
    await idb.kvSet('recording', rec);
    try { rec.lock = await navigator.wakeLock?.request('screen'); } catch { /* ignore */ }
    toast('ההקלטה התחילה. השאר את האפליקציה פתוחה');
  } else {
    const r = rec; rec = null; await idb.kvSet('recording', null);
    if (r.coords.length > 1) {
      const name = `הקלטה ${new Date(r.start).toLocaleDateString('he-IL')} ${new Date(r.start).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`;
      const item = { id: uid(), kind: 'track', name, desc: `${fmtDist(lineLength(r.coords))} · ${fmtTime((Date.now() - r.start) / 1000)}`, color: '#d63b2f',
        geometry: { type: 'LineString', coordinates: r.coords } };
      await saveItem(item);
      editTrack(item);
    } else toast('ההקלטה קצרה מדי ולא נשמרה');
    map.getSource('rec')?.setData(empty());
  }
  updateRecUi();
};
function onRecordFix(p) {
  if (!rec) return;
  const { longitude: lon, latitude: lat, accuracy, altitude } = p.coords;
  if (accuracy > 35) return;
  const last = rec.coords[rec.coords.length - 1];
  if (last && distance(last, [lon, lat]) < Math.max(4, accuracy / 3)) return;
  rec.coords.push([+lon.toFixed(6), +lat.toFixed(6), altitude != null ? Math.round(altitude) : null, p.timestamp]);
  idb.kvSet('recording', { coords: rec.coords, start: rec.start });
  map.getSource('rec')?.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: rec.coords.map(c => [c[0], c[1]]) } });
  updateRecUi();
}
function updateRecUi() {
  $('#btnRecord').classList.toggle('recording', !!rec);
  $('#btnRecord').lastChild.textContent = rec ? 'עצור' : 'הקלטה';
  $('#recChip').classList.toggle('hidden', !rec);
  if (rec) $('#recStats').textContent = `${fmtDist(lineLength(rec.coords))} · ${fmtTime((Date.now() - rec.start) / 1000)}`;
}
setInterval(() => rec && updateRecUi(), 15000);

// ---------------------------------------------------------------- navigate to point
let navTarget = null;
function startNav(t) { navTarget = t; startGps(); $('#navBanner').classList.remove('hidden'); updateNav(); }
$('#navStop').onclick = () => {
  if (guide.route && !navTarget) { if (confirm('לסיים את המסלול המודרך?')) guide.stop(); return; }
  navTarget = null; $('#navBanner').classList.add('hidden'); map.getSource('navline')?.setData(empty()); updateNav();
};
function updateNav() {
  let t = navTarget;
  if (!t && guide.route) {
    const s = guide.nextStation(me?.coord);
    if (s) t = { name: `תחנה ${s.n} · ${s.name}`, coord: [s.lon, s.lat] };
    $('#navBanner').classList.remove('hidden');
    if (!s) { $('#navTitle').textContent = `${guide.route.title}: כל התחנות נקראו`; $('#navSub').textContent = ''; return; }
  }
  if (!t) { map.getSource('navline')?.setData(empty()); return; }
  $('#navTitle').textContent = t.name;
  if (!me) { $('#navSub').textContent = 'מחכה ל-GPS…'; return; }
  const d = distance(me.coord, t.coord), b = bearing(me.coord, t.coord);
  $('#navSub').textContent = `${fmtDist(d)} · כיוון ${Math.round(b)}°`;
  $('#navArrow').style.transform = `rotate(${b - (heading ?? map.getBearing())}deg)`;
  map.getSource('navline')?.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [me.coord, t.coord] } });
}

// ---------------------------------------------------------------- guided routes
const stationMarkers = [];
function drawGuide() {
  stationMarkers.splice(0).forEach(m => m.remove());
  const r = guide.route;
  const src = map.getSource('guide'); if (!src) return;
  if (!r) { src.setData(empty()); return updateNav(); }
  const features = [];
  if (r.line.length) features.push({ type: 'Feature', properties: { kind: 'walk' }, geometry: { type: 'LineString', coordinates: r.line } });
  if (r.driveLine.length) features.push({ type: 'Feature', properties: { kind: 'drive' }, geometry: { type: 'LineString', coordinates: r.driveLine } });
  src.setData({ type: 'FeatureCollection', features });
  for (const s of r.stations) {
    const el = document.createElement('div');
    el.className = 'station-pin' + (guide.visited.has(s.n) ? ' done' : '');
    el.textContent = s.n;
    el.title = s.name;
    el.onclick = ev => { ev.stopPropagation(); openReader(`📖 ${s.n} · ${s.name}`, s.blocks); };
    stationMarkers.push(new maplibregl.Marker({ element: el }).setLngLat([s.lon, s.lat]).addTo(map));
  }
  updateNav();
}
guide.onUpdate = drawGuide;
async function restoreGuide() {
  const id = await idb.kvGet('activeRoute', null);
  if (id) { const r = await idb.get('routes', id); if (r) { await guide.start(r); startGps(); } }
}
async function startRoute(r) {
  await guide.start(r);
  startGps();
  const all = [...r.line, ...r.driveLine, ...r.stations.map(s => [s.lon, s.lat])];
  if (all.length) map.fitBounds(bboxOf({ type: 'Feature', geometry: { type: 'MultiPoint', coordinates: all } }), { padding: 60, duration: 800 });
  closeSheet();
  if (r.intro?.length) openReader(r.title, r.intro);
}
$('#readerClose').onclick = closeReader;
$('#readerSpeak').onclick = toggleSpeak;

// ---------------------------------------------------------------- files
$('#fileInput').onchange = async e => {
  let n = 0;
  for (const f of e.target.files) {
    try {
      if (/\.json$/i.test(f.name)) {
        const raw = JSON.parse(await f.text());
        if (raw.stations) { // guided route file
          const r = normalizeRoute(raw, f.name);
          await idb.put('routes', r); toast(`נוסף מסלול מודרך: ${r.title}`); n++;
          if (sheetOpen() === 'library') panels.library(); continue;
        }
      }
      const parsed = await parseFile(f);
      for (const p of parsed) await saveItem({ id: uid(), ...p, color: p.kind === 'track' ? '#d63b2f' : '#7d3cff' });
      n += parsed.length;
      if (parsed.length) map.fitBounds(bboxOf({ type: 'FeatureCollection', features: parsed.map(p => ({ type: 'Feature', geometry: p.geometry })) }), { padding: 60 });
    } catch (err) { toast(`לא הצלחתי לקרוא את ${f.name}`); console.error(err); }
  }
  if (n) toast(`יובאו ${n} פריטים`);
  e.target.value = '';
};

// ---------------------------------------------------------------- panels
const panels = {
  layers() {
    openSheet('layers', 'מפות ושכבות', `
      <div class="group">מפת בסיס</div>
      ${BASEMAPS.map(b => `<label class="row"><input type="radio" name="base" value="${b.id}" ${b.id === settings.base ? 'checked' : ''}>
        <div class="grow"><div class="title">${b.name}</div><div class="sub">${b.sub}</div></div></label>`).join('')}
      <div class="group">שכבות מעל המפה</div>
      ${RASTER_OVERLAYS.map(o => `<label class="row"><input type="checkbox" data-ov="${o.id}" ${settings.overlays.has(o.id) ? 'checked' : ''}>
        <div class="grow"><div class="title">${o.name}</div><div class="sub">${o.sub}</div></div></label>`).join('')}
      <label class="row"><input type="checkbox" id="hs" ${settings.hillshade ? 'checked' : ''}><div class="grow"><div class="title">הצללת תבליט</div><div class="sub">מדגיש הרים וערוצים</div></div></label>
      <label class="row"><input type="checkbox" id="t3d" ${settings.terrain ? 'checked' : ''}><div class="grow"><div class="title">תלת־ממד</div><div class="sub">הטה את המפה בשתי אצבעות</div></div></label>`, root => {
      root.querySelectorAll('input[name=base]').forEach(i => i.onchange = () => {
        for (const b of BASEMAPS) map.setLayoutProperty(b.id, 'visibility', b.id === i.value ? 'visible' : 'none');
        settings.base = i.value; idb.kvSet('base', i.value);
      });
      root.querySelectorAll('[data-ov]').forEach(i => i.onchange = () => {
        const id = i.dataset.ov;
        i.checked ? settings.overlays.add(id) : settings.overlays.delete(id);
        map.setLayoutProperty(id, 'visibility', i.checked ? 'visible' : 'none');
        idb.kvSet('overlays', [...settings.overlays]);
      });
      root.querySelector('#hs').onchange = e => { settings.hillshade = e.target.checked; idb.kvSet('hillshade', settings.hillshade);
        map.setLayoutProperty('hillshade', 'visibility', settings.hillshade ? 'visible' : 'none'); };
      root.querySelector('#t3d').onchange = e => { settings.terrain = e.target.checked; idb.kvSet('terrain', settings.terrain);
        map.setTerrain(settings.terrain ? { source: 'dem', exaggeration: 1.3 } : null);
        if (settings.terrain) map.easeTo({ pitch: 55 }); else map.easeTo({ pitch: 0 }); };
    });
  },

  async data() {
    openSheet('data', 'מידע ציבורי פתוח', `
      <p class="note">נטען לאזור שעל המסך (מזום 10 ומעלה) ונשמר לשימוש בלי קליטה. מקורות: OpenStreetMap, ויקיפדיה, Open-Meteo.</p>
      ${POI_LAYERS.map(l => `<label class="row"><input type="checkbox" data-poi="${l.id}" ${settings.pois.has(l.id) ? 'checked' : ''}>
        <div class="grow"><div class="title">${l.icon} ${l.name}</div></div><span style="width:12px;height:12px;border-radius:50%;background:${l.color}"></span></label>`).join('')}
      <label class="row"><input type="checkbox" id="wiki" ${settings.wiki ? 'checked' : ''}><div class="grow"><div class="title">📚 ערכי ויקיפדיה באזור</div><div class="sub">מקומות עם מאמר, בעברית ובאנגלית</div></div></label>
      <div class="group">מזג אוויר במרכז המפה</div><div id="wx" class="note">טוען…</div>`, async root => {
      root.querySelectorAll('[data-poi]').forEach(i => i.onchange = () => {
        i.checked ? settings.pois.add(i.dataset.poi) : settings.pois.delete(i.dataset.poi);
        idb.kvSet('pois', [...settings.pois]); refreshPois();
      });
      root.querySelector('#wiki').onchange = e => { settings.wiki = e.target.checked; idb.kvSet('wiki', settings.wiki); refreshPois(); };
      try {
        const c = map.getCenter(); const w = await weatherAt(c.lat.toFixed(3), c.lng.toFixed(3));
        const d = w.daily;
        root.querySelector('#wx').innerHTML = `עכשיו ${Math.round(w.current.temperature_2m)}°, ${WMO[w.current.weather_code] || ''}, רוח ${Math.round(w.current.wind_speed_10m)} קמ"ש<br>`
          + d.time.map((t, i) => `${new Date(t).toLocaleDateString('he-IL', { weekday: 'short' })}: ${Math.round(d.temperature_2m_min[i])}°–${Math.round(d.temperature_2m_max[i])}°, גשם ${d.precipitation_probability_max[i] ?? 0}%`
          + ` · זריחה ${d.sunrise[i].slice(11)} שקיעה ${d.sunset[i].slice(11)}`).join('<br>');
      } catch { root.querySelector('#wx').textContent = 'אין חיבור למזג האוויר כרגע'; }
    });
  },

  async library() {
    const saved = await idb.all('routes');
    openSheet('library', 'מסלולים מודרכים', `
      <p class="note">מסלול עם תחנות: הקו על המפה, וקטע הקריאה של כל תחנה נפתח לבד כשמגיעים אליה (במרחק ${ARRIVE_M} מ'). התוכן פרטי ונטען רק מקובץ או מהספרייה הפרטית שלך.</p>
      ${guide.route ? `<div class="row"><div class="grow"><div class="title">פעיל: ${esc(guide.route.title)}</div><div class="sub">${guide.visited.size}/${guide.route.stations.length} תחנות נקראו</div></div>
        <button class="btn" id="gReset">מההתחלה</button><button class="btn danger" id="gStop">סיום</button></div>` : ''}
      <label class="row"><input type="checkbox" id="autoSpeak" ${guide.autoSpeak ? 'checked' : ''}><div class="grow"><div class="title">🔊 הקראה אוטומטית בהגעה לתחנה</div></div></label>
      <div class="group">שמורים במכשיר</div>
      ${saved.length ? saved.map(r => `<div class="row"><div class="grow"><div class="title">${esc(r.title)}</div><div class="sub">${r.stations.length} תחנות${r.line.length ? ` · ${fmtDist(lineLength(r.line))}` : ''}</div></div>
        <button class="btn primary" data-start="${esc(r.id)}">התחל</button><button class="btn" data-rm="${esc(r.id)}">✕</button></div>`).join('') : '<p class="note">עדיין אין מסלולים. ייבא קובץ מסלול (JSON) או חבר את הספרייה הפרטית.</p>'}
      <div class="btns"><button class="btn" id="gImport">ייבוא קובץ מסלול</button></div>
      <div class="group">הספרייה הפרטית (ה-Pi בבית)</div>
      <label class="field"><span>כתובת הספרייה</span><input id="libUrl" dir="ltr" value="${esc(settings.libraryUrl)}" placeholder="https://…ts.net/offroad-library/"></label>
      <div class="btns"><button class="btn" id="libSave">שמור והצג</button></div>
      <label class="field"><span>חיפוש בספרייה</span><input id="libQ" placeholder="שם מסלול, אזור…"></label>
      <div id="libList"></div>`, root => {
      root.querySelector('#autoSpeak').onchange = e => { guide.autoSpeak = e.target.checked; idb.kvSet('autoSpeak', guide.autoSpeak); };
      root.querySelector('#gStop')?.addEventListener('click', async () => { await guide.stop(); panels.library(); });
      root.querySelector('#gReset')?.addEventListener('click', async () => { await guide.resetProgress(); panels.library(); });
      root.querySelectorAll('[data-start]').forEach(b => b.onclick = async () => startRoute(await idb.get('routes', b.dataset.start)));
      root.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => { if (confirm('להסיר מהמכשיר?')) { await idb.del('routes', b.dataset.rm); panels.library(); } });
      root.querySelector('#gImport').onclick = () => $('#fileInput').click();
      const list = root.querySelector('#libList');
      let index = [];
      const show = () => {
        const q = root.querySelector('#libQ').value.trim();
        const rows = index.filter(r => !q || (r.title + ' ' + (r.region || '')).includes(q)).slice(0, 60);
        list.innerHTML = rows.map(r => `<div class="row"><div class="grow"><div class="title">${esc(r.title)}</div><div class="sub">${esc([r.region, r.length, r.difficulty].filter(Boolean).join(' · '))}${r.stations ? ` · ${r.stations} תחנות` : ''}</div></div>
          <button class="btn" data-get="${esc(r.id)}">הורד</button></div>`).join('') || '<p class="note">לא נמצאו מסלולים.</p>';
        list.querySelectorAll('[data-get]').forEach(b => b.onclick = async () => {
          try { const r = await fetchLibraryRoute(settings.libraryUrl, b.dataset.get); await idb.put('routes', r); toast('נשמר במכשיר'); panels.library(); }
          catch { toast('לא הצלחתי להוריד. בדוק שה-Tailscale פעיל'); }
        });
      };
      const loadIndex = async () => {
        if (!settings.libraryUrl) return;
        list.innerHTML = '<p class="note">טוען…</p>';
        try { index = (await fetchLibraryIndex(settings.libraryUrl)).routes || []; show(); }
        catch { list.innerHTML = '<p class="note">הספרייה לא זמינה כרגע (צריך קליטה ו-Tailscale).</p>'; }
      };
      root.querySelector('#libSave').onclick = () => { settings.libraryUrl = root.querySelector('#libUrl').value.trim(); idb.kvSet('libraryUrl', settings.libraryUrl); loadIndex(); };
      root.querySelector('#libQ').oninput = debounce(show, 200);
      loadIndex();
    });
  },

  mine() {
    const pts = liveItems('point'), trks = liveItems('track');
    const row = i => `<div class="row"><span style="width:12px;height:12px;border-radius:50%;background:${i.color || '#7d3cff'}"></span>
      <div class="grow"><div class="title">${esc(i.name)}</div><div class="sub">${i.kind === 'track' ? fmtDist(lineLength(i.geometry.coordinates)) : esc(i.desc || '')}</div></div>
      <button class="btn" data-go="${i.id}">הצג</button><button class="btn" data-hide="${i.id}">${i.hidden ? '👁️‍🗨️' : '👁️'}</button></div>`;
    openSheet('mine', 'הנקודות והמסלולים שלי', `
      <p class="note">נשמרים במכשיר ומסתנכרנים בין המכשירים שלך. לחיצה ארוכה על המפה מוסיפה נקודה.</p>
      <div class="btns"><button class="btn" id="imp">ייבוא GPX / KML</button><button class="btn" id="exp">ייצוא הכל ל-GPX</button></div>
      <div class="group">מסלולים (${trks.length})</div>${trks.map(row).join('') || '<p class="note">אין עדיין.</p>'}
      <div class="group">נקודות (${pts.length})</div>${pts.map(row).join('') || '<p class="note">אין עדיין.</p>'}`, root => {
      root.querySelector('#imp').onclick = () => $('#fileInput').click();
      root.querySelector('#exp').onclick = () => download(`offroad-nav-${new Date().toISOString().slice(0, 10)}.gpx`, toGPX(liveItems()));
      root.querySelectorAll('[data-go]').forEach(b => b.onclick = () => {
        const i = items.get(b.dataset.go); closeSheet();
        if (i.kind === 'point') map.flyTo({ center: i.geometry.coordinates, zoom: 15 });
        else map.fitBounds(bboxOf({ type: 'Feature', geometry: i.geometry }), { padding: 60 });
      });
      root.querySelectorAll('[data-hide]').forEach(b => b.onclick = async () => { const i = items.get(b.dataset.hide); await saveItem({ ...i, hidden: !i.hidden }); panels.mine(); });
    });
  },

  async more() {
    const st = await cacheStats();
    const b = map.getBounds(), z = Math.floor(map.getZoom());
    const zMax = Math.min(16, z + 3);
    const base = BASEMAPS.find(x => x.id === settings.base);
    const n = countTiles(b, z, zMax);
    openSheet('more', 'עוד', `
      <div class="group">מפות בלי קליטה</div>
      <p class="note">מוריד את האזור שעל המסך, מזום ${z} עד ${zMax}, של "${base.name}"${settings.hillshade || settings.terrain ? ' ונתוני גובה' : ''}. בערך ${n} אריחים.
        ${base.offline ? '' : '<br><b>המפה הזו לא מאפשרת הורדה. בחר מפת טיולים, טופוגרפית או תצלום אוויר.</b>'}</p>
      <div class="btns"><button class="btn primary" id="dl" ${base.offline && n <= MAX_TILES ? '' : 'disabled'}>הורד את האזור</button><button class="btn" id="clr">מחק מפות שמורות</button></div>
      ${n > MAX_TILES ? `<p class="note">האזור גדול מדי (${n} אריחים, מקסימום ${MAX_TILES}). התקרב קצת.</p>` : ''}
      <p class="note" id="dlProg">שמורים: ${st.tiles} אריחים${st.bytes ? ` · ${(st.bytes / 1048576).toFixed(0)} MB` : ''}</p>
      <div class="group">סנכרון</div>
      <p class="note">${sync.enabled ? (sync.user ? `מחובר כ-${esc(sync.user.email)}` : 'התחבר עם גוגל כדי לסנכרן בין המכשירים.') : 'הסנכרון עוד לא הוגדר (Firebase). בינתיים הכל נשמר במכשיר.'}</p>
      ${sync.enabled ? `<div class="btns">${sync.user ? '<button class="btn" id="so">התנתק</button>' : '<button class="btn primary" id="si">התחברות עם Google</button>'}</div>` : ''}
      <div class="group">אודות ומקורות</div>
      <p class="note">אפליקציה אישית. מפות ומידע: Israel Hiking Map (CC BY-NC-SA), OpenStreetMap (ODbL), OpenTopoMap, Esri, Waymarked Trails, Terrain Tiles (AWS), ויקיפדיה (CC BY-SA), Open-Meteo.
        אין באפליקציה תוכן מאתרים בתשלום. מסלולים מודרכים נטענים רק מהקבצים הפרטיים שלך.</p>`, root => {
      const ctl = new AbortController();
      root.querySelector('#dl').onclick = async e => {
        e.target.disabled = true;
        const srcs = [base, ...RASTER_OVERLAYS.filter(o => settings.overlays.has(o.id) && o.offline)];
        if (settings.hillshade || settings.terrain) srcs.push({ ...DEM, maxzoom: Math.min(DEM.maxzoom, 12) });
        const r = await downloadArea(srcs, b, z, zMax, (d, t, f) => { const el = root.querySelector('#dlProg'); if (el) el.textContent = `מוריד… ${d}/${t}${f ? ` (${f} נכשלו)` : ''}`; }, ctl.signal);
        toast(r.failed ? `הורדה הסתיימה, ${r.failed} אריחים נכשלו` : 'האזור נשמר לשימוש בלי קליטה');
        if (sheetOpen() === 'more') panels.more();
      };
      root.querySelector('#clr').onclick = async () => { if (confirm('למחוק את כל המפות השמורות?')) { await clearTiles(); panels.more(); } };
      root.querySelector('#si')?.addEventListener('click', () => sync.signIn());
      root.querySelector('#so')?.addEventListener('click', async () => { await sync.signOut(); panels.more(); });
    });
  },
};

document.querySelectorAll('.toolbar button[data-panel]').forEach(b => b.onclick = () => {
  if (sheetOpen() === b.dataset.panel) closeSheet(); else panels[b.dataset.panel]();
});
$('#sheetClose').onclick = closeSheet;

// ---------------------------------------------------------------- misc
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
if (navigator.storage?.persist) navigator.storage.persist();
startGps();
