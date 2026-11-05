// Private route library in the owner's Google Drive. Route JSON files live in a Drive folder named
// "offroad-nav-routes" that only the owner can see; the app reads them with the owner's Google sign-in
// (read-only Drive access) and keeps downloaded routes on the device for offline use.
// An optional "routes.json" in the same folder adds search details per file:
// { "routes": [{ "file": "43257.route.json", "title": "...", "region": "...", "length_km": 6.1, "difficulty": "...",
//                "lat": 33.24, "lon": 35.75, "stations": 13, "stationNames": "..." }] }
import { normalizeRoute } from './guided.js';

export const DRIVE_FOLDER = 'offroad-nav-routes';
const API = 'https://www.googleapis.com/drive/v3/files';

async function api(token, params, path = '') {
  const r = await fetch(`${API}${path}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 401) { const e = new Error('auth'); e.auth = true; throw e; }
  if (!r.ok) throw new Error('drive ' + r.status);
  return r;
}

export async function listDriveRoutes(token) {
  const folders = (await (await api(token, {
    q: `name='${DRIVE_FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`, fields: 'files(id)', pageSize: 10,
  })).json()).files;
  if (!folders.length) return { folder: false, files: [] };
  const files = [];
  for (const f of folders) {
    let pageToken;
    do {
      const res = await (await api(token, {
        q: `'${f.id}' in parents and trashed=false and (mimeType='application/json' or name contains '.json')`,
        fields: 'nextPageToken,files(id,name,size,modifiedTime)', pageSize: 1000, orderBy: 'name', ...(pageToken ? { pageToken } : {}),
      })).json();
      files.push(...res.files); pageToken = res.nextPageToken;
    } while (pageToken);
  }
  const idxFile = files.find(f => f.name === 'routes.json');
  let meta = {};
  if (idxFile) {
    try { for (const m of (await (await api(token, { alt: 'media' }, `/${idxFile.id}`)).json()).routes || []) meta[m.file] = m; } catch { /* index optional */ }
  }
  return {
    folder: true, folderIds: folders.map(f => f.id),
    files: files.filter(f => f !== idxFile).map(f => ({ title: f.name.replace(/(\.route)?\.json$/i, ''), ...meta[f.name], ...f })),
  };
}

// Optional drawn route map stored next to the route JSON (e.g. 43257.map.jpg).
export async function getDriveImage(token, folderIds, name) {
  for (const id of folderIds) {
    const res = await (await api(token, { q: `'${id}' in parents and name='${name.replace(/'/g, "\\'")}' and trashed=false`, fields: 'files(id)' })).json();
    if (res.files[0]) return (await api(token, { alt: 'media' }, `/${res.files[0].id}`)).blob();
  }
  return null;
}

export async function getDriveRoute(token, file) {
  const raw = await (await api(token, { alt: 'media' }, `/${encodeURIComponent(file.id)}`)).json();
  const r = normalizeRoute(raw, file.id);
  r.driveId = file.id; r.driveModified = file.modifiedTime;
  return r;
}
