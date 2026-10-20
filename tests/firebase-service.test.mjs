import test from 'node:test';
import assert from 'node:assert/strict';
import { createFirebaseService, mergeReadingProgress } from '../js/firebase-service.js';
import { addPublicationRules } from '../scripts/prepare-publication-rules.mjs';
import { readFile } from 'node:fs/promises';

const tick = () => new Promise(resolve => setImmediate(resolve));
const config = { apiKey: 'test-public-key', projectId: 'test-folio', appId: 'test-web-app', authDomain: 'test-folio.firebaseapp.com' };

function harness({ user = { uid: 'user-a', displayName: 'Reader' }, status = 200, type = 'application/json', rawConfig = config, fetchGate } = {}) {
  const calls = { fetch: 0, load: 0, writes: 0, detached: 0, popup: 0, auth: [], queries: [], reads: [], batches: 0 };
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
      getDoc: async ref => { calls.reads.push(ref.path); return snap(ref.path); },
      writeBatch: () => {
        const pending = [];
        return {
          set: (ref, data) => { pending.push({ ref, data }); },
          commit: async () => { calls.batches += 1; for (const { ref, data } of pending) { docs.set(ref.path, data); calls.writes += 1; } },
        };
      },
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

const publicationInput = () => ({ title: 'The Coast & <Quiet>', author: 'Mara Ellison', description: 'A story by the sea.',
  genre: 'Literary fiction', category: 'Fiction', kind: 'shape', priceCents: 499,
  chapters: [{ title: 'An arrival', paragraphs: ['The house had been waiting.', 'She opened the window.'] },
    { title: 'The morning', paragraphs: ['The tide returned.'] }] });

test('publication creates two immutable capability snapshots in one batch, with server-owned identity', async () => {
  const { service, docs, calls } = harness();
  const { book, shareToken } = await service.publishBook('user-a', { ...publicationInput(), id: 'quiet', ownerUid: 'user-b', cover: '<script>unsafe</script>', published: true });
  assert.match(book.id, /^b-[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/);
  assert.match(shareToken, /^[a-f\d]{64}$/);
  assert.equal(book.ownerUid, 'user-a');
  assert.equal(book.cover, 'The Coast &amp; &lt;Quiet&gt;');
  assert.equal(book.priceCents, 499);
  assert.deepEqual(book.chapters, publicationInput().chapters);
  assert.equal(calls.batches, 1);
  assert.equal(calls.writes, 2);
  assert.equal(docs.has(`folioCatalog/${book.id}`), false, 'Link books never enter the global catalog.');
  const privateCopy = docs.get(`folioUsers/user-a/publications/${book.id}`);
  const sharedCopy = docs.get(`folioCatalog/${book.id}/shares/${shareToken}`);
  assert.equal(privateCopy.shareToken, shareToken);
  const { shareToken: omitted, ...common } = privateCopy;
  assert.deepEqual(common, sharedCopy);
  assert.equal(sharedCopy.chapters, undefined);
  assert.deepEqual(JSON.parse(sharedCopy.contentJson), publicationInput().chapters);
  assert.ok(sharedCopy.publishedAt instanceof Date);
});

test('publishing validates signed account, chapters, prices, styles, and UTF-8 byte bounds before writes', async () => {
  const { service, calls } = harness();
  await assert.rejects(service.publishBook('user-b', publicationInput()), { code: 'folio/wrong-account' });
  for (const invalid of [{ title: '' }, { author: 'x'.repeat(121) }, { chapters: [] }, { chapters: [{ title: 'Opening', paragraphs: [''] }] },
    { chapters: [{ title: 'Opening', paragraphs: ['x\u0000'] }] }, { priceCents: 98 }, { priceCents: 100_000 }, { priceCents: 499.5 }, { kind: 'custom" onclick="x' }]) {
    await assert.rejects(service.publishBook('user-a', { ...publicationInput(), ...invalid }), { code: 'folio/invalid-book' });
  }
  await assert.rejects(service.publishBook('user-a', { ...publicationInput(), chapters: Array.from({ length: 51 }, () => ({ title: 'A chapter', paragraphs: ['Words.'] })) }), { code: 'folio/book-too-large' });
  await assert.rejects(service.publishBook('user-a', { ...publicationInput(), chapters: [{ title: 'Opening', paragraphs: Array(6).fill('🌊'.repeat(20_000)) }] }), { code: 'folio/book-too-large' });
  assert.equal(calls.writes, 0);
  await service.signOut();
  await assert.rejects(service.publishBook('user-a', publicationInput()), { code: 'folio/not-signed-in' });
});

test('all six existing cover styles survive publishing and shared retrieval', async () => {
  const { service } = harness();
  for (const kind of ['shape', 'atlas', 'blue-hour', 'wild', 'slowly', 'tomorrow']) {
    const { book, shareToken } = await service.publishBook('user-a', { ...publicationInput(), kind });
    assert.equal(book.kind, kind);
    assert.equal((await service.getSharedBook(book.id, shareToken)).kind, kind);
  }
});

test('the same link retrieves its whole book in a separate signed-out service and rejects bad/missing links', async () => {
  const author = harness();
  const { book, shareToken } = await author.service.publishBook('user-a', publicationInput());
  const guest = harness({ user: null });
  const path = `folioCatalog/${book.id}/shares/${shareToken}`;
  guest.docs.set(path, author.docs.get(path));
  const received = await guest.service.getSharedBook(book.id, shareToken);
  assert.equal(received.id, book.id);
  assert.deepEqual(received.chapters, publicationInput().chapters);
  assert.equal((await guest.service.initFirebase()).user, null);
  assert.equal(guest.calls.auth.length, 0);
  assert.equal(guest.calls.writes, 0);
  assert.deepEqual(guest.calls.reads, [path]);
  await assert.rejects(guest.service.getSharedBook('../quiet', shareToken), { code: 'folio/share-not-found' });
  await assert.rejects(guest.service.getSharedBook(book.id, '../token'), { code: 'folio/share-not-found' });
  await assert.rejects(guest.service.getSharedBook(book.id, 'f'.repeat(64)), { code: 'folio/share-not-found' });
});

test('author publication lists and share recovery remain private and detach on account change', async () => {
  const { service, docs, watches, changeUser } = harness();
  const { book, shareToken } = await service.publishBook('user-a', publicationInput());
  const restored = await service.getPublicationShare('user-a', book.id);
  assert.equal(restored.shareToken, shareToken);
  let received;
  service.watchPublications('user-a', (books, error) => { assert.equal(error, null); received = books; });
  await tick();
  const privateData = docs.get(`folioUsers/user-a/publications/${book.id}`);
  watches[0].next({ docs: [{ id: book.id, data: () => privateData }] });
  assert.equal(watches[0].query.path, 'folioUsers/user-a/publications');
  assert.equal(received[0].shareToken, shareToken);
  assert.deepEqual(received[0].chapters, publicationInput().chapters);
  changeUser({ uid: 'user-b' });
  assert.equal(watches[0].closed, true);
  await assert.rejects(service.getPublicationShare('user-a', book.id), { code: 'folio/wrong-account' });
  watches[0].next({ docs: [] });
  assert.equal(received.length, 1);
});

test('shared claims persist only after successful retrieval and retain the original acquiredAt', async () => {
  const { service, docs, calls, changeUser } = harness();
  const { book, shareToken } = await service.publishBook('user-a', publicationInput());
  changeUser({ uid: 'recipient' });
  const received = await service.claimSharedBook('recipient', book.id, shareToken);
  assert.equal(received.id, book.id);
  const path = `folioUsers/recipient/owned/${book.id}`;
  const owned = docs.get(path);
  assert.deepEqual(Object.keys(owned).sort(), ['acquiredAt', 'bookId', 'shareToken', 'source']);
  assert.equal(owned.source, 'shared');
  const writes = calls.writes;
  await service.claimSharedBook('recipient', book.id, shareToken);
  assert.equal(calls.writes, writes);
  assert.equal(docs.get(path).acquiredAt, owned.acquiredAt);
  await assert.rejects(service.claimSharedBook('recipient', book.id, 'f'.repeat(64)), { code: 'folio/share-not-found' });
  await assert.rejects(service.claimSharedBook('user-a', book.id, shareToken), { code: 'folio/wrong-account' });
  assert.equal(calls.writes, writes);
});

test('signed ownership reload resolves full books and suppresses late snapshots and detached reads', async () => {
  const { service, docs, watches, changeUser, sdk } = harness();
  const { book, shareToken } = await service.publishBook('user-a', publicationInput());
  changeUser({ uid: 'recipient' });
  await service.claimSharedBook('recipient', book.id, shareToken);
  const received = [];
  const stop = service.watchOwnedBooks('recipient', (books, error) => { assert.equal(error, null); received.push(books); });
  await tick();
  const owned = docs.get(`folioUsers/recipient/owned/${book.id}`);
  watches[0].next({ docs: [{ id: book.id, data: () => owned }] });
  await tick();
  assert.equal(watches[0].query.path, 'folioUsers/recipient/owned');
  assert.deepEqual(received[0][0].chapters, publicationInput().chapters);
  assert.equal(received[0][0].shareToken, shareToken);
  stop();
  watches[0].next({ docs: [] });
  await tick();
  assert.equal(received.length, 1);

  let release;
  sdk.firestore.getDoc = async () => new Promise(resolve => { release = resolve; });
  service.watchOwnedBooks('recipient', books => received.push(books));
  await tick();
  watches[1].next({ docs: [{ id: book.id, data: () => owned }] });
  await tick();
  changeUser({ uid: 'unrelated' });
  release({ exists: () => true, data: () => docs.get(`folioCatalog/${book.id}/shares/${shareToken}`) });
  await tick();
  assert.equal(watches[1].closed, true);
  assert.equal(received.length, 1, 'An old account cannot deliver resolved book content to the next account.');
});

test('failed publishing and retrieval never leave partial ownership, and each new link uses independent random keys', async () => {
  const { service, sdk, docs, calls } = harness();
  const first = await service.publishBook('user-a', publicationInput());
  const second = await service.publishBook('user-a', publicationInput());
  assert.notEqual(first.book.id, second.book.id);
  assert.notEqual(first.shareToken, second.shareToken);
  const writes = calls.writes;
  sdk.firestore.writeBatch = () => ({ set() {}, commit: async () => { throw Object.assign(new Error('Offline'), { code: 'unavailable' }); } });
  await assert.rejects(service.publishBook('user-a', publicationInput()), { code: 'unavailable' });
  assert.equal(calls.writes, writes);
  assert.equal(docs.size, 4);
  const sharedPath = `folioCatalog/${first.book.id}/shares/${first.shareToken}`;
  docs.set(sharedPath, { ...docs.get(sharedPath), contentJson: 'not JSON' });
  await assert.rejects(service.claimSharedBook('user-a', first.book.id, first.shareToken), { code: 'folio/share-not-found' });
  assert.equal(docs.has(`folioUsers/user-a/owned/${first.book.id}`), false);
  assert.equal(calls.writes, writes);
});

test('owned subscriptions report configuration and retrieval failures without inventing an empty library', async () => {
  const unconfigured = harness({ status: 404 });
  let missing;
  unconfigured.service.watchOwnedBooks('user-a', (books, error) => { missing = { books, error }; });
  await tick();
  assert.equal(missing.books, null);
  assert.equal(missing.error.code, 'folio/not-configured');

  const { service, watches } = harness();
  let result;
  service.watchOwnedBooks('user-a', (books, error) => { result = { books, error }; });
  await tick();
  watches[0].next({ docs: [{ id: 'b-01234567-89ab-4cde-8fab-0123456789ab', data: () => ({ bookId: 'b-01234567-89ab-4cde-8fab-0123456789ab', source: 'shared', shareToken: 'a'.repeat(64) }) }] });
  await tick();
  assert.equal(result.books, null);
  assert.equal(result.error.code, 'folio/share-not-found');
});

test('additive rule preparation preserves every active byte and refuses duplicate publication policy', async () => {
  const folio = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8');
  const active = "rules_version = '2';\nservice cloud.firestore {\n  match /databases/{database}/documents {\n    match /anotherApp/{id} { allow read: if true; }\n  }\n}\n";
  const { merged, insertion, addedBytes } = addPublicationRules(active, folio);
  assert.equal(merged.slice(0, insertion) + merged.slice(insertion + addedBytes), active);
  assert.match(merged, /match \/folioCatalog\/\{bookId\}\/shares\/\{shareToken\}/);
  assert.match(merged, /allow list: if false/);
  assert.throws(() => addPublicationRules(merged, folio), /already/);
  assert.throws(() => addPublicationRules('service cloud.storage {}', folio), /documents root/);
});
