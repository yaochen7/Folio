import test from 'node:test';
import assert from 'node:assert/strict';
import { createFirebaseService, mergeReadingProgress } from '../js/firebase-service.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const config = { apiKey: 'test-public-key', projectId: 'test-folio', appId: 'test-web-app', authDomain: 'test-folio.firebaseapp.com' };

function harness({ user = { uid: 'user-a', displayName: 'Reader' }, status = 200, type = 'application/json', rawConfig = config, fetchGate } = {}) {
  const calls = { fetch: 0, load: 0, writes: 0, detached: 0, popup: 0, auth: [], queries: [] };
  const docs = new Map();
  const watches = [];
  const authObservers = new Set();
  const authInstance = { currentUser: user, authStateReady: async () => {} };
  function changeUser(next) { authInstance.currentUser = next; for (const callback of authObservers) callback(next); }
  const snap = path => ({ exists: () => docs.has(path), data: () => docs.get(path) });
  const sdk = {
    app: { getApps: () => [], initializeApp: options => ({ name: 'folio', options }) },
    auth: {
      getAuth: () => authInstance,
      browserLocalPersistence: 'local', inMemoryPersistence: 'memory',
      setPersistence: async () => {},
      onAuthStateChanged: (_auth, callback) => { authObservers.add(callback); queueMicrotask(() => callback(authInstance.currentUser)); return () => authObservers.delete(callback); },
      signInWithEmailAndPassword: async (_auth, email, password) => { calls.auth.push({ email, password }); const next = { uid: 'signed-in-user', email }; changeUser(next); return { user: next }; },
      createUserWithEmailAndPassword: async (_auth, email, password) => { calls.auth.push({ email, password }); const next = { uid: 'new-user', email }; changeUser(next); return { user: next }; },
      updateProfile: async (target, value) => { Object.assign(target, value); },
      sendPasswordResetEmail: async (_auth, email) => { calls.auth.push({ reset: email }); },
      signOut: async () => { changeUser(null); },
      GoogleAuthProvider: class { setCustomParameters() {} },
      signInWithPopup: async () => { calls.popup += 1; const next = { uid: 'google-user' }; changeUser(next); return { user: next }; },
    },
    firestore: {
      getFirestore: () => ({}),
      doc: (_db, ...parts) => ({ path: parts.join('/') }),
      collection: (_db, ...parts) => ({ path: parts.join('/') }),
      query: (collection, ...constraints) => ({ ...collection, constraints }),
      orderBy: (...value) => ({ orderBy: value }), where: (...value) => ({ where: value }), limit: value => ({ limit: value }),
      serverTimestamp: () => new Date(123_456),
      runTransaction: async (_db, body) => {
        const pending = [];
        const result = await body({
          get: async ref => snap(ref.path),
          set: (ref, data, options) => pending.push({ ref, data, options }),
        });
        for (const { ref, data, options } of pending) { docs.set(ref.path, { ...(options?.merge ? docs.get(ref.path) : {}), ...data }); calls.writes += 1; }
        return result;
      },
      deleteDoc: async ref => { docs.delete(ref.path); calls.writes += 1; },
      onSnapshot: (query, next, error) => { const watcher = { query, next, error, closed: false }; watches.push(watcher); return () => { watcher.closed = true; calls.detached += 1; }; },
      getDocs: async query => { calls.queries.push(query); return { docs: [] }; },
    },
  };
  const service = createFirebaseService({
    fetchImpl: async () => { calls.fetch += 1; if (fetchGate) await fetchGate; return { ok: status >= 200 && status < 300, status, headers: { get: () => type }, json: async () => rawConfig }; },
    loadSdk: async () => { calls.load += 1; return sdk; },
    now: () => 30_000,
  });
  return { service, sdk, calls, docs, watches, changeUser };
}

test('missing configuration keeps a real guest session and never downloads Firebase', async () => {
  const { service, calls } = harness({ status: 404 });
  const seen = [];
  service.subscribeAuth(user => seen.push(user));
  assert.deepEqual(await service.initFirebase(), { configured: false, user: null, googleSignInEnabled: true, emailSignUpEnabled: true });
  await assert.rejects(service.signIn('reader@example.test', 'password'), { code: 'folio/not-configured' });
  assert.equal(calls.load, 0);
  assert.equal(calls.auth.length, 0);
  assert.deepEqual(seen, [null]);
});

test('an SPA fallback HTML response is also unconfigured guest mode', async () => {
  const { service, calls } = harness({ type: 'text/html; charset=utf-8' });
  assert.equal((await service.initFirebase()).configured, false);
  assert.equal(calls.load, 0);
});

test('example placeholders are rejected before SDK import', async () => {
  const { service, calls } = harness({ rawConfig: { ...config, apiKey: 'REPLACE_WITH_FIREBASE_WEB_API_KEY' } });
  const result = await service.initFirebase();
  assert.equal(result.configured, false);
  assert.match(result.error, /configured/);
  assert.equal(calls.load, 0);
});

test('concurrent initialization fetches/imports once and returns the current real user', async () => {
  const { service, calls } = harness();
  const results = await Promise.all([service.initFirebase(), service.initFirebase(), service.initFirebase()]);
  assert.ok(results.every(result => result.configured && result.user.uid === 'user-a' && result.googleSignInEnabled === true && result.emailSignUpEnabled === true));
  assert.equal(calls.fetch, 1);
  assert.equal(calls.load, 1);
  await service.signOut();
  assert.equal((await service.initFirebase()).user, null);
});

test('sign-up preserves password bytes, trims email/name, and resolves the SDK user', async () => {
  const { service, calls } = harness({ user: null });
  const user = await service.signUp(' reader@example.test ', ' with spaces ', ' Reader Name ');
  assert.equal(user.uid, 'new-user');
  assert.equal(user.displayName, 'Reader Name');
  assert.deepEqual(calls.auth[0], { email: 'reader@example.test', password: ' with spaces ' });
  assert.equal((await service.initFirebase()).user, user);
});

test('cross-account writes and path injection fail before writing any document', async () => {
  const { service, calls } = harness();
  await assert.rejects(service.saveLibraryBook('user-b', 'quiet'), { code: 'folio/wrong-account' });
  await assert.rejects(service.saveReadingProgress('user-a', '../quiet', { wordOffset: 5, fraction: 0.5 }), { code: 'folio/invalid-input' });
  assert.equal(calls.writes, 0);
});

test('library updates preserve addedAt and discard unsupported metadata', async () => {
  const { service, docs } = harness();
  const path = 'folioUsers/user-a/library/quiet';
  const firstAdded = new Date(100);
  docs.set(path, { bookId: 'quiet', addedAt: firstAdded, updatedAt: firstAdded, title: 'Old title' });
  await service.saveLibraryBook('user-a', 'quiet', { title: ' The Shape of Quiet ', author: 'Mara Ellison', genre: 'Fiction', kind: 'shape', admin: true, uid: 'user-b' });
  assert.equal(docs.get(path).addedAt, firstAdded);
  assert.equal(docs.get(path).title, 'The Shape of Quiet');
  assert.equal(docs.get(path).kind, 'shape');
  assert.equal(docs.get(path).admin, undefined);
  assert.equal(docs.get(path).uid, undefined);
});

test('older guest progress cannot replace newer cloud progress; a new backward read can', async () => {
  const { service, docs, calls } = harness();
  const path = 'folioUsers/user-a/progress/quiet';
  docs.set(path, { bookId: 'quiet', wordOffset: 800, fraction: 0.8, clientUpdatedAt: 20_000, updatedAt: new Date(21_000) });
  await service.saveReadingProgress('user-a', 'quiet', { wordOffset: 100, fraction: 0.1, updatedAt: 10_000 });
  assert.equal(docs.get(path).wordOffset, 800);
  assert.equal(calls.writes, 0);
  await service.saveReadingProgress('user-a', 'quiet', { wordOffset: 300, fraction: 0.3 });
  assert.equal(docs.get(path).wordOffset, 300);
  assert.equal(docs.get(path).clientUpdatedAt, 30_000);
  assert.ok(docs.get(path).updatedAt instanceof Date);
});

test('invalid progress ranges/types never write', async () => {
  const { service, calls } = harness();
  for (const progress of [{ wordOffset: -1, fraction: 0 }, { wordOffset: 1.5, fraction: 0.5 }, { wordOffset: 2, fraction: 1.1 }, { wordOffset: 2, fraction: NaN }]) {
    await assert.rejects(service.saveReadingProgress('user-a', 'quiet', progress), { code: 'folio/invalid-input' });
  }
  assert.equal(calls.writes, 0);
});

test('unsubscribe works even before configuration finishes', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { service, watches } = harness({ fetchGate: gate });
  const stop = service.watchLibrary('user-a', () => assert.fail('Detached watch must not deliver.'));
  stop();
  release();
  await service.initFirebase();
  await tick();
  assert.equal(watches.length, 0);
});

test('account switches detach private watches and suppress late snapshots', async () => {
  const { service, watches, changeUser } = harness();
  const received = [];
  service.watchLibrary('user-a', value => received.push(value));
  await service.initFirebase();
  await tick();
  assert.equal(watches.length, 1);
  changeUser({ uid: 'user-b' });
  assert.equal(watches[0].closed, true);
  watches[0].next({ docs: [] });
  assert.deepEqual(received, []);
});

test('listener failures report null plus a mapped error, never a false empty library', async () => {
  const { service, watches } = harness();
  let result;
  service.watchLibrary('user-a', (items, error) => { result = { items, error }; });
  await service.initFirebase();
  await tick();
  watches[0].error({ code: 'permission-denied' });
  assert.equal(result.items, null);
  assert.equal(result.error.code, 'permission-denied');
  assert.match(result.error.message, /sign in/);
});

test('reading-progress snapshots convert cloud timestamps to original client milliseconds', async () => {
  const { service, watches } = harness();
  let result;
  service.watchReadingProgress('user-a', map => { result = map; });
  await service.initFirebase();
  await tick();
  watches[0].next({ docs: [{ id: 'quiet', data: () => ({ wordOffset: 42, fraction: 0.4, clientUpdatedAt: 12_000, updatedAt: { toMillis: () => 99_000 } }) }] });
  assert.deepEqual(result, { quiet: { wordOffset: 42, fraction: 0.4, updatedAt: 12_000 } });
});

test('progress merge chooses newer reads, breaks ties by furthest offset, and tolerates absent sides', () => {
  const older = { wordOffset: 900, fraction: 0.9, updatedAt: 100 };
  const newer = { wordOffset: 200, fraction: 0.2, updatedAt: 200 };
  assert.deepEqual(mergeReadingProgress(older, newer), newer);
  assert.deepEqual(mergeReadingProgress({ ...older, updatedAt: 200 }, newer), { ...older, updatedAt: 200 });
  assert.deepEqual(mergeReadingProgress(undefined, newer), newer);
  assert.equal(mergeReadingProgress(null, { wordOffset: -5, fraction: 0 }), null);
});

test('Folio reads and writes only its dedicated top-level collections', async () => {
  const { service, watches, calls, docs } = harness();
  service.watchLibrary('user-a', () => {});
  service.watchReadingProgress('user-a', () => {});
  service.watchCatalog(() => {});
  await service.initFirebase();
  await tick();
  assert.deepEqual(watches.map(watch => watch.query.path).sort(), [
    'folioUsers/user-a/library', 'folioUsers/user-a/progress', 'folioCatalog',
  ].sort());
  await service.getCatalog();
  assert.equal(calls.queries[0].path, 'folioCatalog');
  await service.saveLibraryBook('user-a', 'quiet', { title: 'The Shape of Quiet' });
  await service.saveReadingProgress('user-a', 'quiet', { wordOffset: 42, fraction: 0.2 });
  assert.deepEqual([...docs.keys()].sort(), ['folioUsers/user-a/library/quiet', 'folioUsers/user-a/progress/quiet']);
});

test('disabled Google provider survives repeat initialization and leaves email authentication working', async () => {
  const { service, calls } = harness({ user: null, rawConfig: { ...config, googleSignInEnabled: false } });
  const first = await service.initFirebase();
  assert.equal(first.configured, true);
  assert.equal(first.googleSignInEnabled, false);
  await assert.rejects(service.signInWithGoogle(), { code: 'auth/operation-not-allowed' });
  assert.equal(calls.popup, 0);
  const user = await service.signIn('reader@example.test', 'password');
  assert.equal(user.uid, 'signed-in-user');
  const repeated = await service.initFirebase();
  assert.equal(repeated.googleSignInEnabled, false);
  assert.equal(repeated.user, user);
});

test('administrator-managed accounts reject self signup before the SDK request while keeping sign-in and reset', async () => {
  const { service, calls } = harness({ user: null, rawConfig: { ...config, googleSignInEnabled: false, emailSignUpEnabled: false } });
  const first = await service.initFirebase();
  assert.equal(first.configured, true);
  assert.equal(first.emailSignUpEnabled, false);
  assert.equal(first.googleSignInEnabled, false);
  await assert.rejects(service.signUp('new@example.test', 'password', 'New Reader'), {
    code: 'auth/admin-restricted-operation',
    message: 'New accounts are created by your administrator. Sign in with an existing account.',
  });
  assert.equal(calls.auth.length, 0, 'Disabled signup must not reach an Auth SDK credential request.');
  await service.sendPasswordReset('existing@example.test');
  assert.deepEqual(calls.auth[0], { reset: 'existing@example.test' });
  const user = await service.signIn('existing@example.test', 'password');
  assert.equal(user.uid, 'signed-in-user');
  const repeated = await service.initFirebase();
  assert.equal(repeated.emailSignUpEnabled, false);
  assert.equal(repeated.googleSignInEnabled, false);
  assert.equal(repeated.user, user);
});
