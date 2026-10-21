/** Firebase is optional: a missing config never creates an account or loads the SDK. */
const SDK_BASE = 'https://www.gstatic.com/firebasejs/13.0.0';
const CONFIG_URL = new URL('../firebase-config.json', import.meta.url);
const MAX_WORD_OFFSET = 10_000_000;
const MAX_TIMESTAMP = 4_102_444_800_000;
const BOOK_ID = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const PUBLICATION_ID = /^b-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHARE_TOKEN = /^[0-9a-f]{64}$/;
const MAX_PUBLICATION_BYTES = 450_000;
const COVER_KINDS = new Set(['shape', 'atlas', 'blue-hour', 'wild', 'slowly', 'tomorrow']);

async function loadBrowserSdk() {
  const [app, auth, firestore] = await Promise.all([
    import(`${SDK_BASE}/firebase-app.js`),
    import(`${SDK_BASE}/firebase-auth.js`),
    import(`${SDK_BASE}/firebase-firestore.js`),
  ]);
  return { app, auth, firestore };
}

const ERROR_MESSAGES = {
  'folio/not-configured': 'Accounts are not available yet. You can keep reading as a guest.',
  'folio/invalid-config': 'Account services need to be configured. Your guest library is still available.',
  'folio/invalid-input': 'Please check the information you entered and try again.',
  'folio/not-signed-in': 'Sign in to sync your library and reading position.',
  'folio/wrong-account': 'This library belongs to a different account. Please sign in again.',
  'folio/share-not-found': 'This book link is unavailable. Ask the author for a new link.',
  'folio/book-too-large': 'This book is too large. Use up to 50 chapters and 450 KB of text.',
  'folio/invalid-book': 'Check the title, author, and chapter text before publishing.',
  'auth/invalid-email': 'Enter a valid email address.',
  'auth/missing-email': 'Enter your email address.',
  'auth/missing-password': 'Enter your password.',
  'auth/weak-password': 'Choose a stronger password that meets the account password requirements.',
  'auth/password-does-not-meet-requirements': 'Choose a password that meets the account password requirements.',
  'auth/email-already-in-use': 'An account already uses that email. Sign in or reset your password.',
  'auth/invalid-credential': 'The email or password is incorrect. Please try again.',
  'auth/wrong-password': 'The email or password is incorrect. Please try again.',
  'auth/user-not-found': 'The email or password is incorrect. Please try again.',
  'auth/user-disabled': 'This account is unavailable. Please contact the site owner.',
  'auth/too-many-requests': 'There have been too many attempts. Wait a moment and try again.',
  'auth/network-request-failed': 'Could not connect. Check your connection and try again.',
  'auth/popup-closed-by-user': 'Google sign-in was closed before it finished.',
  'auth/cancelled-popup-request': 'A sign-in window is already open. Please finish there.',
  'auth/popup-blocked': 'Allow the Google sign-in window, then try again.',
  'auth/unauthorized-domain': 'Sign-in is not enabled for this website address yet.',
  'auth/operation-not-allowed': 'This sign-in method is not enabled yet.',
  'auth/admin-restricted-operation': 'New accounts are created by your administrator. Sign in with an existing account.',
  'auth/account-exists-with-different-credential': 'That email uses another sign-in method. Use your original method first.',
  'auth/requires-recent-login': 'Please sign in again to continue.',
  'auth/invalid-api-key': 'Account services need to be configured. Your guest library is still available.',
  'permission-denied': 'Your account cannot access this data. Please sign in again.',
  'unauthenticated': 'Please sign in again to sync your library.',
  'unavailable': 'Cloud sync is unavailable right now. Your reading can continue on this device.',
  'failed-precondition': 'Cloud sync is not ready yet. Your reading can continue on this device.',
};

export function authErrorMessage(error) {
  return ERROR_MESSAGES[error?.code] || 'Something interrupted the connection. Please try again.';
}

function serviceError(code, message) {
  return Object.assign(new Error(message || ERROR_MESSAGES[code] || ERROR_MESSAGES['folio/invalid-input']), { code });
}

function mappedError(error) {
  if (error?.folioMapped) return error;
  const result = serviceError(error?.code || 'folio/service-error', authErrorMessage(error));
  result.folioMapped = true;
  result.cause = error;
  return result;
}

function timestampMillis(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value instanceof Date) return value.getTime();
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  return 0;
}

function validProgress(progress, fallbackTime = 0) {
  if (!progress || !Number.isInteger(progress.wordOffset) || progress.wordOffset < 0 || progress.wordOffset > MAX_WORD_OFFSET
    || !Number.isFinite(progress.fraction) || progress.fraction < 0 || progress.fraction > 1) {
    throw serviceError('folio/invalid-input');
  }
  const suppliedTime = progress.clientUpdatedAt ?? progress.updatedAt;
  const updatedAt = suppliedTime == null ? fallbackTime : timestampMillis(suppliedTime);
  if (!Number.isSafeInteger(updatedAt) || updatedAt < 0 || updatedAt > MAX_TIMESTAMP) {
    throw serviceError('folio/invalid-input');
  }
  return { wordOffset: progress.wordOffset, fraction: progress.fraction, updatedAt };
}

/** Choose the most recently read position; a timestamp tie preserves the furthest position. */
export function mergeReadingProgress(local, remote) {
  const safe = value => { try { return validProgress(value); } catch { return null; } };
  const a = safe(local);
  const b = safe(remote);
  if (!a) return b;
  if (!b) return a;
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  if (a.wordOffset !== b.wordOffset) return a.wordOffset > b.wordOffset ? a : b;
  return a.fraction >= b.fraction ? a : b;
}

function cleanMetadata(metadata) {
  const result = {};
  for (const [key, max] of Object.entries({ title: 200, author: 120, genre: 80, kind: 80 })) {
    if (typeof metadata?.[key] === 'string') result[key] = metadata[key].trim().slice(0, max);
  }
  return result;
}

function assertBookId(bookId) {
  if (typeof bookId !== 'string' || !BOOK_ID.test(bookId)) throw serviceError('folio/invalid-input');
}

function assertShare(bookId, shareToken) {
  if (typeof bookId !== 'string' || !PUBLICATION_ID.test(bookId)
    || typeof shareToken !== 'string' || !SHARE_TOKEN.test(shareToken)) throw serviceError('folio/share-not-found');
}

function publicationText(input, key, maximum, fallback = '') {
  const value = input?.[key] ?? fallback;
  if (typeof value !== 'string' || value.trim().length > maximum || /\u0000/.test(value)) throw serviceError('folio/invalid-book');
  return value.trim();
}

/** Plain text only: published cover HTML is generated locally from the escaped title. */
function cleanPublication(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw serviceError('folio/invalid-book');
  const title = publicationText(input, 'title', 200);
  const author = publicationText(input, 'author', 120);
  if (!title || !author || !Array.isArray(input.chapters) || !input.chapters.length) throw serviceError('folio/invalid-book');
  if (input.chapters.length > 50) throw serviceError('folio/book-too-large');
  const chapters = input.chapters.map(chapter => {
    const chapterTitle = publicationText(chapter, 'title', 200);
    if (!chapterTitle || !Array.isArray(chapter.paragraphs) || !chapter.paragraphs.length || chapter.paragraphs.length > 2_000) {
      throw serviceError('folio/invalid-book');
    }
    const paragraphs = chapter.paragraphs.map(paragraph => {
      if (typeof paragraph !== 'string' || !paragraph.trim() || paragraph.length > 100_000 || /\u0000/.test(paragraph)) {
        throw serviceError('folio/invalid-book');
      }
      return paragraph.trim();
    });
    return { title: chapterTitle, paragraphs };
  });
  const priceCents = input.priceCents ?? 499;
  if (!Number.isInteger(priceCents) || priceCents < 99 || priceCents > 99_999) throw serviceError('folio/invalid-book');
  const kind = input.kind ?? 'shape';
  if (!COVER_KINDS.has(kind)) throw serviceError('folio/invalid-book');
  const result = { title, author, genre: publicationText(input, 'genre', 80, 'Fiction'), kind,
    kicker: publicationText(input, 'kicker', 80, 'An original story'),
    description: publicationText(input, 'description', 3_000), category: publicationText(input, 'category', 80, 'Fiction'),
    priceCents, chapters };
  if (new TextEncoder().encode(JSON.stringify(result)).length > MAX_PUBLICATION_BYTES) throw serviceError('folio/book-too-large');
  return result;
}

function publicationRecord(bookId, data) {
  if (!PUBLICATION_ID.test(bookId) || data?.bookId !== bookId || typeof data.ownerUid !== 'string'
    || !data.ownerUid || data.ownerUid.length > 128 || data.ownerUid.includes('/') || typeof data.contentJson !== 'string') {
    throw serviceError('folio/share-not-found');
  }
  let chapters;
  try { chapters = JSON.parse(data.contentJson); } catch { throw serviceError('folio/share-not-found'); }
  let book;
  try { book = cleanPublication({ ...data, chapters }); } catch { throw serviceError('folio/share-not-found'); }
  const words = book.chapters.reduce((sum, chapter) => sum + chapter.paragraphs.join(' ').split(/\s+/u).length, 0);
  const cover = book.title.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  return { ...book, id: bookId, ownerUid: data.ownerUid, publishedAt: timestampMillis(data.publishedAt),
    source: 'folio-publication', pages: Math.max(1, Math.ceil(words / 250)), cover };
}

function validatedConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw serviceError('folio/invalid-config');
  const result = {};
  const keys = ['apiKey', 'authDomain', 'projectId', 'appId', 'storageBucket', 'messagingSenderId', 'measurementId', 'databaseURL'];
  for (const key of keys) {
    if (typeof input[key] === 'string' && input[key].trim()) result[key] = input[key].trim();
  }
  for (const key of ['apiKey', 'authDomain', 'projectId', 'appId']) {
    if (!result[key] || /REPLACE_|REPLACE-WITH|YOUR_|[<>]/i.test(result[key])) throw serviceError('folio/invalid-config');
  }
  if (/\s|\//.test(result.authDomain)) throw serviceError('folio/invalid-config');
  return result;
}

/** Injectable I/O keeps the production module usable in a browser and testable without credentials. */
export function createFirebaseService({
  fetchImpl = (...args) => globalThis.fetch(...args),
  loadSdk = loadBrowserSdk,
  configUrl = CONFIG_URL,
  now = Date.now,
  hostname = globalThis.location?.hostname || '',
  cryptoImpl = globalThis.crypto,
} = {}) {
  let initialization;
  let sdk;
  let auth;
  let db;
  let currentUser = null;
  let configured = false;
  let googleSignInEnabled = true;
  let emailSignUpEnabled = true;
  let initialized = false;
  let initError;
  const authSubscribers = new Set();
  const accountWatches = new Set();

  function notifyAuth() {
    const signature = currentUser ? `${currentUser.uid}|${currentUser.displayName || ''}|${currentUser.emailVerified}` : 'guest';
    for (const entry of authSubscribers) {
      if (entry.signature !== signature) {
        entry.signature = signature;
        try { entry.callback(currentUser); }
        catch { console.warn('A Folio account observer could not update.'); }
      }
    }
  }

  function receiveUser(user) {
    if (currentUser?.uid !== user?.uid) for (const stop of [...accountWatches]) stop();
    currentUser = user || null;
    if (initialized) notifyAuth();
  }

  async function initFirebase() {
    if (initialization) {
      const result = await initialization;
      return { ...result, user: configured ? currentUser : null, googleSignInEnabled, emailSignUpEnabled };
    }
    initialization = (async () => {
      try {
        const response = await fetchImpl(configUrl, { cache: 'no-store', credentials: 'same-origin' });
        // SPA hosts may serve index.html for an absent config; that is still guest mode.
        const contentType = response.headers?.get?.('content-type') || '';
        if (response.status === 404 || contentType.includes('text/html')) return { configured: false, user: null, googleSignInEnabled, emailSignUpEnabled };
        if (!response.ok) throw serviceError('unavailable');
        const rawConfig = await response.json();
        googleSignInEnabled = rawConfig?.googleSignInEnabled !== false;
        emailSignUpEnabled = rawConfig?.emailSignUpEnabled !== false;
        const config = validatedConfig(rawConfig);
        if (rawConfig.useEmulators === true && !['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)) {
          throw serviceError('folio/invalid-config');
        }
        sdk = await loadSdk();
        const existing = sdk.app.getApps().find(app => app.name === 'folio');
        if (existing && existing.options.projectId !== config.projectId) throw serviceError('folio/invalid-config');
        const app = existing || sdk.app.initializeApp(config, 'folio');
        auth = sdk.auth.getAuth(app);
        db = sdk.firestore.getFirestore(app);
        if (rawConfig.useEmulators === true) {
          sdk.auth.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
          sdk.firestore.connectFirestoreEmulator(db, '127.0.0.1', 8080);
        }
        try { await sdk.auth.setPersistence(auth, sdk.auth.browserLocalPersistence); }
        catch { await sdk.auth.setPersistence(auth, sdk.auth.inMemoryPersistence); }
        await auth.authStateReady();
        currentUser = auth.currentUser || null;
        sdk.auth.onAuthStateChanged(auth, receiveUser);
        configured = true;
        return { configured: true, user: currentUser, googleSignInEnabled, emailSignUpEnabled };
      } catch (error) {
        initError = authErrorMessage(error);
        currentUser = null;
        return { configured: false, user: null, googleSignInEnabled, emailSignUpEnabled, error: initError };
      } finally {
        initialized = true;
        notifyAuth();
      }
    })();
    return initialization;
  }

  async function requireReady() {
    const result = await initFirebase();
    if (!result.configured || !configured) throw serviceError('folio/not-configured', initError);
  }

  function assertOwner(uid) {
    if (!currentUser) throw serviceError('folio/not-signed-in');
    if (typeof uid !== 'string' || uid !== currentUser.uid) throw serviceError('folio/wrong-account');
  }

  function userDoc(uid, branch, bookId) {
    assertOwner(uid);
    assertBookId(bookId);
    return sdk.firestore.doc(db, 'folioUsers', uid, branch, bookId);
  }

  function subscribeAuth(callback) {
    if (typeof callback !== 'function') throw new TypeError('subscribeAuth requires a callback.');
    const entry = { callback, signature: null };
    authSubscribers.add(entry);
    if (initialized) queueMicrotask(() => { if (authSubscribers.has(entry)) notifyAuth(); });
    else void initFirebase();
    return () => authSubscribers.delete(entry);
  }

  async function authAction(action) {
    try { await requireReady(); return await action(); }
    catch (error) { throw mappedError(error); }
  }

  function credentials(email, password) {
    if (typeof email !== 'string' || !email.trim() || typeof password !== 'string' || !password) {
      throw serviceError('folio/invalid-input');
    }
    return [email.trim(), password];
  }

  async function signUp(email, password, displayName = '') {
    return authAction(async () => {
      if (!emailSignUpEnabled) throw serviceError('auth/admin-restricted-operation');
      const [cleanEmail, untouchedPassword] = credentials(email, password);
      if (typeof displayName !== 'string' || displayName.trim().length > 80) throw serviceError('folio/invalid-input');
      const result = await sdk.auth.createUserWithEmailAndPassword(auth, cleanEmail, untouchedPassword);
      if (displayName.trim()) {
        // The account remains usable if an optional profile update is interrupted.
        try { await sdk.auth.updateProfile(result.user, { displayName: displayName.trim() }); } catch { /* optional */ }
      }
      receiveUser(result.user);
      return result.user;
    });
  }

  async function signIn(email, password) {
    return authAction(async () => {
      const result = await sdk.auth.signInWithEmailAndPassword(auth, ...credentials(email, password));
      receiveUser(result.user);
      return result.user;
    });
  }

  async function signInWithGoogle() {
    return authAction(async () => {
      if (!googleSignInEnabled) throw serviceError('auth/operation-not-allowed');
      const provider = new sdk.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const result = await sdk.auth.signInWithPopup(auth, provider);
      receiveUser(result.user);
      return result.user;
    });
  }

  async function sendPasswordReset(email) {
    return authAction(async () => {
      if (typeof email !== 'string' || !email.trim()) throw serviceError('auth/missing-email');
      try { await sdk.auth.sendPasswordResetEmail(auth, email.trim()); }
      catch (error) {
        // A reset form must not reveal whether a particular email has an account.
        if (error.code !== 'auth/user-not-found') throw error;
      }
    });
  }

  async function signOut() {
    return authAction(async () => { await sdk.auth.signOut(auth); receiveUser(null); });
  }

  function watchQuery(uid, makeQuery, transform, callback) {
    if (typeof callback !== 'function') throw new TypeError('A subscription requires a callback.');
    let closed = false;
    let detach = () => {};
    const stop = () => { closed = true; detach(); accountWatches.delete(stop); };
    if (uid !== null) accountWatches.add(stop);
    void requireReady().then(() => {
      if (closed) return;
      if (uid !== null) assertOwner(uid);
      detach = sdk.firestore.onSnapshot(makeQuery(), snapshot => {
        if (!closed && (uid === null || currentUser?.uid === uid)) {
          try { callback(transform(snapshot), null); }
          catch (error) { callback(null, mappedError(error)); stop(); }
        }
      }, error => {
        if (!closed) { callback(null, mappedError(error)); stop(); }
      });
    }).catch(error => { if (!closed) { callback(null, mappedError(error)); stop(); } });
    return stop;
  }

  /** callback(items, error); errors use items=null and never pretend the library is empty. */
  function watchLibrary(uid, callback) {
    return watchQuery(uid, () => sdk.firestore.query(
      sdk.firestore.collection(db, 'folioUsers', uid, 'library'),
      sdk.firestore.orderBy('addedAt', 'desc'), sdk.firestore.limit(500),
    ), snapshot => snapshot.docs.map(item => {
      const data = item.data();
      return { ...data, id: item.id, bookId: item.id, addedAt: timestampMillis(data.addedAt), savedAt: timestampMillis(data.addedAt), updatedAt: timestampMillis(data.updatedAt) };
    }), callback);
  }

  /** callback({[bookId]: {wordOffset,fraction,updatedAt}}, error), with millisecond timestamps. */
  function watchReadingProgress(uid, callback) {
    return watchQuery(uid, () => sdk.firestore.query(
      sdk.firestore.collection(db, 'folioUsers', uid, 'progress'), sdk.firestore.limit(500),
    ), snapshot => Object.fromEntries(snapshot.docs.map(item => {
      const data = item.data();
      return [item.id, { wordOffset: data.wordOffset, fraction: data.fraction,
        updatedAt: timestampMillis(data.clientUpdatedAt) || timestampMillis(data.updatedAt) }];
    })), callback);
  }

  async function saveLibraryBook(uid, bookId, metadata = {}) {
    try {
      await requireReady();
      const ref = userDoc(uid, 'library', bookId);
      const details = cleanMetadata(metadata);
      await sdk.firestore.runTransaction(db, async transaction => {
        const previous = await transaction.get(ref);
        assertOwner(uid);
        const data = { bookId, ...details, updatedAt: sdk.firestore.serverTimestamp() };
        if (!previous.exists()) data.addedAt = sdk.firestore.serverTimestamp();
        transaction.set(ref, data, { merge: true });
      });
    } catch (error) { throw mappedError(error); }
  }

  async function removeLibraryBook(uid, bookId) {
    try { await requireReady(); await sdk.firestore.deleteDoc(userDoc(uid, 'library', bookId)); }
    catch (error) { throw mappedError(error); }
  }

  async function saveReadingProgress(uid, bookId, progress) {
    try {
      await requireReady();
      const ref = userDoc(uid, 'progress', bookId);
      const incoming = validProgress(progress, Math.trunc(now()));
      return await sdk.firestore.runTransaction(db, async transaction => {
        const previous = await transaction.get(ref);
        assertOwner(uid);
        const existing = previous.exists() ? validProgress(previous.data()) : null;
        const chosen = mergeReadingProgress(incoming, existing);
        // Compare values as the merge helper returns a normalized copy.
        if (existing && chosen.updatedAt === existing.updatedAt && chosen.wordOffset === existing.wordOffset
          && chosen.fraction === existing.fraction) return existing;
        transaction.set(ref, { bookId, wordOffset: incoming.wordOffset, fraction: incoming.fraction,
          clientUpdatedAt: incoming.updatedAt, updatedAt: sdk.firestore.serverTimestamp() }, { merge: true });
        return incoming;
      });
    } catch (error) { throw mappedError(error); }
  }

  function catalogQuery() {
    return sdk.firestore.query(sdk.firestore.collection(db, 'folioCatalog'),
      sdk.firestore.where('published', '==', true), sdk.firestore.limit(200));
  }

  function catalogRecords(snapshot) { return snapshot.docs.map(item => ({ ...item.data(), id: item.id })); }

  async function getCatalog() {
    try { await requireReady(); return catalogRecords(await sdk.firestore.getDocs(catalogQuery())); }
    catch (error) { throw mappedError(error); }
  }

  function watchCatalog(callback) { return watchQuery(null, catalogQuery, catalogRecords, callback); }

  function shareDoc(bookId, shareToken) {
    assertShare(bookId, shareToken);
    return sdk.firestore.doc(db, 'folioCatalog', bookId, 'shares', shareToken);
  }

  function randomPublicationKeys() {
    if (typeof cryptoImpl?.getRandomValues !== 'function') throw serviceError('folio/service-error', 'A secure connection is required to publish a book.');
    const bytes = cryptoImpl.getRandomValues(new Uint8Array(48));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
    return { bookId: `b-${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`,
      shareToken: hex.slice(32) };
  }

  /** Immutable author copy + a get-only capability. A link never exposes a catalog listing. */
  async function publishBook(uid, input) {
    try {
      await requireReady();
      assertOwner(uid);
      const { chapters, ...metadata } = cleanPublication(input);
      const { bookId, shareToken } = randomPublicationKeys();
      const data = { bookId, ownerUid: uid, ...metadata, contentJson: JSON.stringify(chapters), publishedAt: sdk.firestore.serverTimestamp() };
      const batch = sdk.firestore.writeBatch(db);
      batch.set(userDoc(uid, 'publications', bookId), { ...data, shareToken });
      batch.set(shareDoc(bookId, shareToken), data);
      assertOwner(uid);
      await batch.commit();
      assertOwner(uid);
      return { book: publicationRecord(bookId, { ...data, publishedAt: Math.trunc(now()) }), shareToken };
    } catch (error) { throw mappedError(error); }
  }

  /** Public, exact-document retrieval; possession of the 256-bit token grants this book. */
  async function getSharedBook(bookId, shareToken) {
    try {
      assertShare(bookId, shareToken);
      await requireReady();
      const snapshot = await sdk.firestore.getDoc(shareDoc(bookId, shareToken));
      if (!snapshot.exists()) throw serviceError('folio/share-not-found');
      return publicationRecord(bookId, snapshot.data());
    } catch (error) { throw mappedError(error); }
  }

  function watchPublications(uid, callback) {
    return watchQuery(uid, () => sdk.firestore.query(sdk.firestore.collection(db, 'folioUsers', uid, 'publications'),
      sdk.firestore.orderBy('publishedAt', 'desc'), sdk.firestore.limit(200)),
    snapshot => snapshot.docs.map(item => {
      const data = item.data();
      assertShare(item.id, data.shareToken);
      if (data.ownerUid !== uid) throw serviceError('folio/share-not-found');
      return { ...publicationRecord(item.id, data), shareToken: data.shareToken };
    }), callback);
  }

  async function getPublicationShare(uid, bookId) {
    try {
      await requireReady();
      if (!PUBLICATION_ID.test(bookId)) throw serviceError('folio/share-not-found');
      const snapshot = await sdk.firestore.getDoc(userDoc(uid, 'publications', bookId));
      assertOwner(uid);
      if (!snapshot.exists()) throw serviceError('folio/share-not-found');
      const data = snapshot.data();
      assertShare(bookId, data.shareToken);
      if (data.ownerUid !== uid) throw serviceError('folio/share-not-found');
      return { book: publicationRecord(bookId, data), shareToken: data.shareToken };
    } catch (error) { throw mappedError(error); }
  }

  /** A signed-in reader keeps the shared book across devices; repeated claims preserve ownership. */
  async function claimSharedBook(uid, bookId, shareToken) {
    try {
      await requireReady();
      assertOwner(uid);
      const book = await getSharedBook(bookId, shareToken);
      const ref = userDoc(uid, 'owned', bookId);
      let retainedToken = shareToken;
      await sdk.firestore.runTransaction(db, async transaction => {
        const previous = await transaction.get(ref);
        assertOwner(uid);
        if (previous.exists()) {
          const data = previous.data();
          assertShare(bookId, data.shareToken);
          if (data.bookId !== bookId || data.source !== 'shared') throw serviceError('folio/share-not-found');
          retainedToken = data.shareToken;
          return;
        }
        transaction.set(ref, { bookId, shareToken, source: 'shared', acquiredAt: sdk.firestore.serverTimestamp() });
      });
      assertOwner(uid);
      return { ...(retainedToken === shareToken ? book : await getSharedBook(bookId, retainedToken)), shareToken: retainedToken };
    } catch (error) { throw mappedError(error); }
  }

  function watchOwnedBooks(uid, callback) {
    if (typeof callback !== 'function') throw new TypeError('A subscription requires a callback.');
    let closed = false;
    let sequence = 0;
    const resolved = new Map();
    const stopQuery = watchQuery(uid, () => sdk.firestore.query(sdk.firestore.collection(db, 'folioUsers', uid, 'owned'),
      sdk.firestore.orderBy('acquiredAt', 'desc'), sdk.firestore.limit(500)), snapshot => snapshot.docs.map(item => ({ ...item.data(), id: item.id })), (records, error) => {
      const revision = ++sequence;
      if (closed) return;
      if (error) { callback(null, error); return; }
      if (currentUser?.uid !== uid) return;
      void Promise.all(records.map(async record => {
        assertShare(record.id, record.shareToken);
        if (record.bookId !== record.id || record.source !== 'shared') throw serviceError('folio/share-not-found');
        const key = `${record.id}/${record.shareToken}`;
        if (!resolved.has(key)) resolved.set(key, getSharedBook(record.id, record.shareToken).catch(error => { resolved.delete(key); throw error; }));
        return { ...await resolved.get(key), shareToken: record.shareToken, acquiredAt: timestampMillis(record.acquiredAt) };
      })).then(books => {
        if (!closed && revision === sequence && currentUser?.uid === uid) callback(books, null);
      }).catch(error => {
        if (!closed && revision === sequence && currentUser?.uid === uid) callback(null, mappedError(error));
      });
    });
    return () => { closed = true; sequence += 1; resolved.clear(); stopQuery(); };
  }

  return { initFirebase, subscribeAuth, signUp, signIn, signInWithGoogle, sendPasswordReset, signOut,
    watchLibrary, watchReadingProgress, saveLibraryBook, removeLibraryBook, saveReadingProgress, getCatalog, watchCatalog,
    publishBook, getSharedBook, watchPublications, getPublicationShare, claimSharedBook, watchOwnedBooks };
}

const service = createFirebaseService();
export const { initFirebase, subscribeAuth, signUp, signIn, signInWithGoogle, sendPasswordReset, signOut,
  watchLibrary, watchReadingProgress, saveLibraryBook, removeLibraryBook, saveReadingProgress, getCatalog, watchCatalog,
  publishBook, getSharedBook, watchPublications, getPublicationShare, claimSharedBook, watchOwnedBooks } = service;
