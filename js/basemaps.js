// Base maps and raster overlays. Only open / freely usable sources, each with its attribution.
// `offline: false` marks servers whose usage policy forbids bulk prefetching (e.g. the main OSM tile server).

export const BASEMAPS = [
  {
    id: 'ihm', name: 'מפת טיולים (Israel Hiking Map)', sub: 'שבילים מסומנים, קווי גובה, עברית',
    tiles: ['https://israelhiking.osm.org.il/Hebrew/Tiles/{z}/{x}/{y}.png'], maxzoom: 16, offline: true,
    attribution: 'Tiles © <a href="https://israelhiking.osm.org.il">Israel Hiking</a> CC BY-NC-SA 3.0 · Map data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  {
    id: 'ihm-mtb', name: 'מפת אופניים ושטח (Israel Hiking Map)', sub: 'דרכי עפר וסינגלים',
    tiles: ['https://israelhiking.osm.org.il/Hebrew/mtbTiles/{z}/{x}/{y}.png'], maxzoom: 16, offline: true,
    attribution: 'Tiles © <a href="https://israelhiking.osm.org.il">Israel Hiking</a> CC BY-NC-SA 3.0 · Map data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  {
    id: 'topo', name: 'טופוגרפית (OpenTopoMap)', sub: 'הצללת תבליט וקווי גובה',
    tiles: ['https://a.tile.opentopomap.org/{z}/{x}/{y}.png', 'https://b.tile.opentopomap.org/{z}/{x}/{y}.png', 'https://c.tile.opentopomap.org/{z}/{x}/{y}.png'],
    maxzoom: 17, offline: true,
    attribution: '© <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA) · © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  {
    id: 'sat', name: 'תצלום אוויר (Esri)', sub: 'לווין וצילומי אוויר',
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], maxzoom: 19, offline: true,
    attribution: 'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community',
  },
  {
    id: 'esri-topo', name: 'מפה כללית (Esri Topo)', sub: 'כבישים ויישובים',
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}'], maxzoom: 19, offline: true,
    attribution: '© Esri and contributors',
  },
  {
    id: 'cyclosm', name: 'CyclOSM', sub: 'סוגי דרכים ומשטחים',
    tiles: ['https://a.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png', 'https://b.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png'],
    maxzoom: 19, offline: false,
    attribution: '<a href="https://www.cyclosm.org">CyclOSM</a> · © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  {
    id: 'osm', name: 'OpenStreetMap', sub: 'המפה הבסיסית (בלי הורדה לשימוש לא מקוון)',
    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], maxzoom: 19, offline: false,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
];

export const RASTER_OVERLAYS = [
  {
    id: 'trails', name: 'שבילים מסומנים (Waymarked Trails)', sub: 'שכבת שבילי הליכה מעל כל מפה',
    tiles: ['https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png'], maxzoom: 17, opacity: 0.9, offline: true,
    attribution: '<a href="https://hiking.waymarkedtrails.org">Waymarked Trails</a> CC-BY-SA',
  },
  {
    id: 'mtbtrails', name: 'מסלולי אופניים (Waymarked Trails)', sub: 'מסלולי MTB מסומנים',
    tiles: ['https://tile.waymarkedtrails.org/mtb/{z}/{x}/{y}.png'], maxzoom: 17, opacity: 0.9, offline: true,
    attribution: '<a href="https://mtb.waymarkedtrails.org">Waymarked Trails</a> CC-BY-SA',
  },
];

// Elevation (Terrarium encoded, AWS open data). Used for hillshade, 3D terrain and track elevation.
export const DEM = {
  tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
  encoding: 'terrarium', maxzoom: 15, tileSize: 256,
  attribution: 'Elevation: <a href="https://registry.opendata.aws/terrain-tiles/">Terrain Tiles</a> (Mapzen, AWS open data)',
};

export function tileHosts() {
  const all = [...BASEMAPS, ...RASTER_OVERLAYS, DEM];
  return [...new Set(all.flatMap(s => s.tiles.map(t => new URL(t.replace(/\{[^}]+\}/g, '0')).host)))];
}
