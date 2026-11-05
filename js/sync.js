// Live sync of user items through Firestore: users/{uid}/items/{id}. Last write (updatedAt) wins.
// Firestore keeps its own offline cache, so edits made without signal upload when the phone is back online.
import { firebaseConfig, allowedEmails } from './firebaseConfig.js';

const SDK = '10.14.1';
let fs, auth, db, user, unsub, driveToken = null;
const listeners = new Set();

export const sync = {
  enabled: !!firebaseConfig,
  get user() { return user; },
  onChange(fn) { listeners.add(fn); },

  async init(onRemote) {
    if (!firebaseConfig) return emit('off');
    const appMod = await import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-app.js`);
    const authMod = await import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-auth.js`);
    fs = await import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-firestore.js`);
    const app = appMod.initializeApp(firebaseConfig);
    db = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) });
    auth = authMod.getAuth(app);
    this._authMod = authMod;
    authMod.onAuthStateChanged(auth, u => {
      if (u && allowedEmails.length && !allowedEmails.includes(u.email)) { authMod.signOut(auth); return emit('denied'); }
      user = u;
      if (unsub) { unsub(); unsub = null; }
      if (!u) return emit('signedout');
      emit('syncing');
      const col = fs.collection(db, 'users', u.uid, 'items');
      unsub = fs.onSnapshot(col, { includeMetadataChanges: true }, snap => {
        const changes = snap.docChanges().filter(c => !c.doc.metadata.hasPendingWrites).map(c => decode(c.doc.data()));
        if (changes.length) onRemote(changes);
        emit(snap.metadata.fromCache ? 'offline' : 'live');
      }, () => emit('error'));
    });
  },

  async signIn() {
    if (!auth) return;
    const p = new this._authMod.GoogleAuthProvider();
    try { await this._authMod.signInWithPopup(auth, p); }
    catch { await this._authMod.signInWithRedirect(auth, p); }
  },
  signOut() { driveToken = null; return auth && this._authMod.signOut(auth); },

  // Read-only Google Drive access for the private route library. The token lasts about an hour;
  // asking again opens Google's popup, which needs a tap (call it from a click handler).
  async driveToken(force = false) {
    if (!auth) throw new Error('sync off');
    if (!force && driveToken && driveToken.exp > Date.now()) return driveToken.token;
    const A = this._authMod, p = new A.GoogleAuthProvider();
    p.addScope('https://www.googleapis.com/auth/drive.readonly');
    if (user?.email) p.setCustomParameters({ login_hint: user.email });
    const res = await A.signInWithPopup(auth, p);
    const token = A.GoogleAuthProvider.credentialFromResult(res)?.accessToken;
    if (!token) throw new Error('no token');
    driveToken = { token, exp: Date.now() + 50 * 60 * 1000 };
    return token;
  },

  async push(item) {
    if (!user) return;
    await fs.setDoc(fs.doc(db, 'users', user.uid, 'items', item.id), encode(item));
  },
};

// Firestore does not allow nested arrays, so geometry travels as a JSON string.
function encode(item) { return { ...item, geometry: JSON.stringify(item.geometry) }; }
function decode(d) { return { ...d, geometry: typeof d.geometry === 'string' ? JSON.parse(d.geometry) : d.geometry }; }
function emit(state) { listeners.forEach(fn => fn(state)); }
