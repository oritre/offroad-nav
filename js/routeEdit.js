// Hand corrections for guided routes: move or place stations and redraw the walking line.
// Corrections hold coordinates only (never the route text), live in the owner's synced items as kind 'routeEdit'
// with id 'redit-<routeId>', and are laid over the route each time it is loaded, on every device.
//
// Edit item geometry: { stations: { "<n>": [lon, lat] | null }, line?: [[lon, lat], ...] }

export const editId = routeId => `redit-${routeId}`;

export function applyEdits(route, edit) {
  if (!route) return route;
  const g = edit && !edit.deleted ? edit.geometry || {} : {};
  const st = g.stations || {};
  const out = { ...route, stations: route.stations.map(s => {
    if (!(String(s.n) in st)) return s;
    const c = st[String(s.n)];
    return c ? { ...s, lon: c[0], lat: c[1], conf: 'hand', edited: true } : { ...s, lon: null, lat: null, conf: null, edited: true };
  }) };
  if (g.line && g.line.length > 1) { out.line = g.line; out.extraLines = []; out.fit = 'hand'; out.lineEdited = true; }
  out.hasEdits = Object.keys(st).length > 0 || !!out.lineEdited;
  return out;
}

// How much a route still needs checking: weak/failed line, or stations without a reliable location.
export function needsFix(r) {
  if (!r) return false;
  if (r.fit === 'weak' || r.fit === 'failed') return true;
  return (r.stations || []).some(s => s.lat == null || s.conf === 'low');
}
