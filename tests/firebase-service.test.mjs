import test from 'node:test';
import assert from 'node:assert/strict';
import { createFirebaseService, mergeReadingProgress, splitPublicationContent } from '../js/firebase-service.js';
import { MAX_BOOK_BYTES, PART_BYTES, MAX_PARTS, MAX_CHAPTERS, MAX_PARAGRAPHS_PER_CHAPTER, MAX_PARAGRAPH_CHARS } from '../js/publication-limits.js';
import { addPublicationRules, replacePublicationRules, blockSha256, main as prepareRules } from '../scripts/prepare-publication-rules.mjs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tick = () => new Promise(resolve => setImmediate(resolve));
const config = { apiKey: 'test-public-key', projectId: 'test-folio', appId: 'test-web-app', authDomain: 'test-folio.firebaseapp.com' };
const DELETE_FIELD = Symbol('deleteField');
const utf8Bytes = text => Buffer.byteLength(text, 'utf8');
// Approximates Firestore's stored size so the fake rejects what production would (1 MiB documents, 10 MiB requests).
const storedBytes = data => Object.entries(data).reduce((sum, [key, value]) => sum + utf8Bytes(key) + 1 + (typeof value === 'string' ? utf8Bytes(value) + 1 : 8), 32);

function harness({ user = { uid: 'user-a', displayName: 'Reader' }, status = 200, type = 'application/json', rawConfig = config, fetchGate } = {}) {
  const calls = { fetch: 0, load: 0, writes: 0, detached: 0, popup: 0, auth: [], queries: [], reads: [], batches: 0, deletes: [], requestBytes: [] };
  const docs = new Map();
  function commitWrites(pending) {
    const next = new Map(docs);
    let requestBytes = 0;
    for (const { type: kind, ref, data, options } of pending) {
      if (kind === 'delete') { next.delete(ref.path); continue; }
      if (kind === 'update' && !next.has(ref.path)) throw Object.assign(new Error('No document to update.'), { code: 'not-found' });
      const value = { ...(kind === 'update' || options?.merge ? next.get(ref.path) : {}), ...data };
      for (const [key, field] of Object.entries(value)) if (field === DELETE_FIELD) delete value[key];
      if (storedBytes(value) > 1_048_576) throw Object.assign(new Error('Document too large.'), { code: 'invalid-argument' });
      requestBytes += storedBytes(data);
      next.set(ref.path, value);
    }
    if (requestBytes > 10 * 1024 * 1024) throw Object.assign(new Error('Request too large.'), { code: 'invalid-argument' });
    calls.requestBytes.push(requestBytes);
    docs.clear();
    for (const [path, value] of next) docs.set(path, value);
    calls.writes += pending.length;
    for (const { type: kind, ref } of pending) if (kind === 'delete') calls.deletes.push(ref.path);
  }
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
      deleteField: () => DELETE_FIELD,
      getDoc: async ref => { calls.reads.push(ref.path); return snap(ref.path); },
      writeBatch: () => {
        const pending = [];
        return {
          set: (ref, data, options) => { pending.push({ type: 'set', ref, data, options }); },
          update: (ref, data) => { pending.push({ type: 'update', ref, data }); },
          delete: ref => { pending.push({ type: 'delete', ref }); },
          commit: async () => { calls.batches += 1; commitWrites(pending); },
        };
      },
      runTransaction: async (_db, body) => {
        const pending = [];
        const result = await body({
          get: async ref => snap(ref.path),
          set: (ref, data, options) => pending.push({ type: 'set', ref, data, options }),
          update: (ref, data) => pending.push({ type: 'update', ref, data }),
          delete: ref => pending.push({ type: 'delete', ref }),
        });
        commitWrites(pending);
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
const LEGACY_ID = 'b-01234567-89ab-4cde-8fab-0123456789ab';
const LEGACY_TOKEN = 'c'.repeat(64);
const authorPath = (uid, bookId) => `folioUsers/${uid}/publications/${bookId}`;
const headPath = (bookId, token) => `folioCatalog/${bookId}/shares/${token}`;
const partPath = (bookId, token, index) => `${headPath(bookId, token)}/parts/${index}`;
const storedParts = (docs, bookId, token) => [...docs.keys()].filter(path => path.startsWith(`${headPath(bookId, token)}/parts/`)).sort();

/** One chapter whose JSON is exactly `target` UTF-8 bytes, filled with `unit` and padded with ASCII. */
function bookOfBytes(target, unit = 'x') {
  const full = unit.repeat(Math.floor((MAX_PARAGRAPH_CHARS - 8) / unit.length));
  const paragraphs = [''];
  const size = () => utf8Bytes(JSON.stringify([{ title: 'Opening', paragraphs }]));
  while (target - size() > utf8Bytes(full) + 3) paragraphs.splice(-1, 0, full);
  const remaining = target - size();
  assert.ok(remaining > 0);
  paragraphs[paragraphs.length - 1] = 'x'.repeat(remaining % utf8Bytes(unit)) + unit.repeat(Math.floor(remaining / utf8Bytes(unit)));
  assert.equal(size(), target);
  return [{ title: 'Opening', paragraphs }];
}

function seedLegacyBook(docs, chapters = publicationInput().chapters) {
  const data = { bookId: LEGACY_ID, ownerUid: 'user-a', title: 'An Older Book', author: 'Mara Ellison', genre: 'Fiction', kind: 'wild',
    kicker: 'An original story', description: '', category: 'Fiction', priceCents: 299, contentJson: JSON.stringify(chapters), publishedAt: new Date(5_000) };
  docs.set(authorPath('user-a', LEGACY_ID), { ...data, shareToken: LEGACY_TOKEN });
  docs.set(headPath(LEGACY_ID, LEGACY_TOKEN), data);
}

test('publication writes both heads and the manuscript parts in one batch, with server-owned identity', async () => {
  const { service, docs, calls } = harness();
  const { book, shareToken } = await service.publishBook('user-a', { ...publicationInput(), id: 'quiet', ownerUid: 'user-b', cover: '<script>unsafe</script>', published: true, revision: 9 });
  assert.match(book.id, /^b-[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/);
  assert.match(shareToken, /^[a-f\d]{64}$/);
  assert.equal(book.ownerUid, 'user-a');
  assert.equal(book.cover, 'The Coast &amp; &lt;Quiet&gt;');
  assert.equal(book.priceCents, 499);
  assert.deepEqual(book.chapters, publicationInput().chapters);
  const json = JSON.stringify(publicationInput().chapters);
  assert.deepEqual({ revision: book.revision, chapterCount: book.chapterCount, wordCount: book.wordCount, pages: book.pages, contentBytes: book.contentBytes },
    { revision: 1, chapterCount: 2, wordCount: 12, pages: 1, contentBytes: utf8Bytes(json) });
  assert.equal(calls.batches, 1);
  assert.equal(calls.writes, 3);
  assert.equal(docs.has(`folioCatalog/${book.id}`), false, 'Link books never enter the global catalog.');
  const privateCopy = docs.get(authorPath('user-a', book.id));
  const sharedCopy = docs.get(headPath(book.id, shareToken));
  assert.equal(privateCopy.shareToken, shareToken);
  const { shareToken: omitted, ...common } = privateCopy;
  assert.deepEqual(common, sharedCopy);
  assert.equal(sharedCopy.chapters, undefined);
  assert.equal(sharedCopy.contentJson, undefined, 'The manuscript is stored once, in parts.');
  assert.deepEqual({ revision: sharedCopy.revision, partCount: sharedCopy.partCount, chapterCount: sharedCopy.chapterCount, wordCount: sharedCopy.wordCount },
    { revision: 1, partCount: 1, chapterCount: 2, wordCount: 12 });
  assert.ok(sharedCopy.publishedAt instanceof Date);
  assert.equal(sharedCopy.updatedAt, sharedCopy.publishedAt);
  assert.deepEqual(docs.get(partPath(book.id, shareToken, 0)), { bookId: book.id, ownerUid: 'user-a', revision: 1, index: 0, text: json });
});

test('publishing validates signed account, chapters, prices, styles, and UTF-8 byte bounds before writes', async () => {
  const { service, calls } = harness();
  await assert.rejects(service.publishBook('user-b', publicationInput()), { code: 'folio/wrong-account' });
  for (const invalid of [{ title: '' }, { author: 'x'.repeat(121) }, { chapters: [] }, { chapters: [{ title: 'Opening', paragraphs: [''] }] },
    { chapters: [{ title: 'Opening', paragraphs: ['x\u0000'] }] }, { priceCents: 98 }, { priceCents: 100_000 }, { priceCents: 499.5 }, { kind: 'custom" onclick="x' },
    { chapters: [{ title: 'Opening', paragraphs: ['x'.repeat(MAX_PARAGRAPH_CHARS + 1)] }] },
    { chapters: [{ title: 'Opening', paragraphs: Array(MAX_PARAGRAPHS_PER_CHAPTER + 1).fill('Words.') }] }]) {
    await assert.rejects(service.publishBook('user-a', { ...publicationInput(), ...invalid }), { code: 'folio/invalid-book' });
  }
  await assert.rejects(service.publishBook('user-a', { ...publicationInput(), chapters: Array.from({ length: MAX_CHAPTERS + 1 }, () => ({ title: 'A chapter', paragraphs: ['Words.'] })) }),
    { code: 'folio/book-too-large', message: 'This book is too large. Use up to 1,000 chapters and 5 MB of text.' });
  await assert.rejects(service.publishBook('user-a', { ...publicationInput(), chapters: [{ title: 'Opening', paragraphs: Array(26).fill('🌊'.repeat(50_000)) }] }), { code: 'folio/book-too-large' });
  await assert.rejects(service.publishBook('user-a', { ...publicationInput(), chapters: bookOfBytes(MAX_BOOK_BYTES + 1) }), { code: 'folio/book-too-large' });
  assert.equal(calls.writes, 0);
  const many = await service.publishBook('user-a', { ...publicationInput(), chapters: Array.from({ length: MAX_CHAPTERS }, (_, index) => ({ title: `Chapter ${index + 1}`, paragraphs: ['Words here.'] })) });
  assert.equal(many.book.chapterCount, MAX_CHAPTERS);
  await service.signOut();
  await assert.rejects(service.publishBook('user-a', publicationInput()), { code: 'folio/not-signed-in' });
});

test('manuscript parts never split an emoji or CJK character and rejoin exactly', () => {
  for (const [text, sizes] of [
    ['a'.repeat(PART_BYTES - 2) + '🌊b', [PART_BYTES - 2, 5]],
    ['a'.repeat(PART_BYTES - 4) + '🌊', [PART_BYTES]],
    ['a'.repeat(PART_BYTES - 1) + '海洋', [PART_BYTES - 1, 6]],
    ['é'.repeat(PART_BYTES / 2 + 1), [PART_BYTES, 2]],
    ['海'.repeat(700_000), [999_999, 999_999, 100_002]],
    ['🌊'.repeat(250_001), [PART_BYTES, 4]],
  ]) {
    const parts = splitPublicationContent(text);
    assert.deepEqual(parts.map(utf8Bytes), sizes);
    assert.ok(parts.every(part => part.isWellFormed()));
    assert.equal(parts.join(''), text);
  }
});

test('a full 5 MB manuscript is stored once in at most six parts and read back exactly', async () => {
  const { service, docs, calls } = harness();
  const chapters = bookOfBytes(MAX_BOOK_BYTES, '🌊');
  const { book, shareToken } = await service.publishBook('user-a', { ...publicationInput(), chapters });
  const paths = storedParts(docs, book.id, shareToken);
  assert.equal(paths.length, MAX_PARTS, 'Code-point boundaries leave each part a few bytes short, so the sixth part is needed.');
  const texts = paths.map(path => docs.get(path).text);
  assert.ok(texts.every(text => utf8Bytes(text) <= PART_BYTES && text.isWellFormed()));
  assert.equal(texts.join(''), JSON.stringify(chapters));
  assert.deepEqual(paths.map(path => docs.get(path).index), [0, 1, 2, 3, 4, 5]);
  assert.equal(book.contentBytes, MAX_BOOK_BYTES);
  assert.equal(docs.get(headPath(book.id, shareToken)).partCount, MAX_PARTS);
  assert.ok(calls.requestBytes[0] < 10 * 1024 * 1024);
  calls.reads.length = 0;
  const read = await service.getBookContent(book.id, shareToken);
  assert.deepEqual(read.chapters, chapters);
  assert.equal(read.contentBytes, MAX_BOOK_BYTES);
  assert.deepEqual(calls.reads, [headPath(book.id, shareToken), ...paths]);
});

test('all six existing cover styles survive publishing and shared retrieval', async () => {
  const { service } = harness();
  for (const kind of ['shape', 'atlas', 'blue-hour', 'wild', 'slowly', 'tomorrow']) {
    const { book, shareToken } = await service.publishBook('user-a', { ...publicationInput(), kind });
    assert.equal(book.kind, kind);
    assert.equal((await service.getSharedBook(book.id, shareToken)).kind, kind);
  }
});

test('the same link gives metadata and then the whole book in a separate signed-out service, and rejects bad/missing links', async () => {
  const author = harness();
  const { book, shareToken } = await author.service.publishBook('user-a', publicationInput());
  const guest = harness({ user: null });
  const path = headPath(book.id, shareToken);
  for (const stored of [path, partPath(book.id, shareToken, 0)]) guest.docs.set(stored, author.docs.get(stored));
  const received = await guest.service.getSharedBook(book.id, shareToken);
  assert.equal(received.id, book.id);
  assert.equal(received.chapters, undefined, 'Link metadata never downloads the manuscript.');
  assert.deepEqual(Object.keys(received).sort(), ['author', 'category', 'chapterCount', 'contentBytes', 'cover', 'description', 'genre', 'id', 'kicker', 'kind',
    'ownerUid', 'pages', 'priceCents', 'publishedAt', 'revision', 'source', 'title', 'updatedAt', 'wordCount']);
  assert.equal(received.source, 'folio-publication');
  assert.deepEqual(guest.calls.reads, [path]);
  const full = await guest.service.getBookContent(book.id, shareToken);
  assert.deepEqual(full.chapters, publicationInput().chapters);
  assert.deepEqual({ ...full, chapters: undefined }, { ...received, chapters: undefined });
  assert.equal((await guest.service.initFirebase()).user, null);
  assert.equal(guest.calls.auth.length, 0);
  assert.equal(guest.calls.writes, 0);
  assert.deepEqual(guest.calls.reads, [path, path, partPath(book.id, shareToken, 0)]);
  for (const read of [guest.service.getSharedBook, guest.service.getBookContent]) {
    await assert.rejects(read('../quiet', shareToken), { code: 'folio/share-not-found' });
    await assert.rejects(read(book.id, '../token'), { code: 'folio/share-not-found' });
    await assert.rejects(read(book.id, 'f'.repeat(64)), { code: 'folio/share-not-found' });
  }
});

test('author publication lists and share recovery remain private, metadata-only, and detach on account change', async () => {
  const { service, docs, watches, changeUser } = harness();
  const { book, shareToken } = await service.publishBook('user-a', publicationInput());
  seedLegacyBook(docs);
  const restored = await service.getPublicationShare('user-a', book.id);
  assert.equal(restored.shareToken, shareToken);
  assert.equal(restored.book.chapters, undefined);
  assert.equal(restored.book.revision, 1);
  let received;
  service.watchPublications('user-a', (books, error) => { assert.equal(error, null); received = books; });
  await tick();
  const privateData = docs.get(authorPath('user-a', book.id));
  watches[0].next({ docs: [{ id: book.id, data: () => privateData }, { id: LEGACY_ID, data: () => docs.get(authorPath('user-a', LEGACY_ID)) }] });
  assert.equal(watches[0].query.path, 'folioUsers/user-a/publications');
  assert.equal(received[0].shareToken, shareToken);
  assert.equal(received[0].chapters, undefined);
  assert.deepEqual({ title: received[0].title, revision: received[0].revision, chapterCount: received[0].chapterCount, wordCount: received[0].wordCount },
    { title: 'The Coast & <Quiet>', revision: 1, chapterCount: 2, wordCount: 12 });
  assert.deepEqual({ shareToken: received[1].shareToken, revision: received[1].revision, chapterCount: received[1].chapterCount, publishedAt: received[1].publishedAt, updatedAt: received[1].updatedAt, chapters: received[1].chapters },
    { shareToken: LEGACY_TOKEN, revision: 0, chapterCount: 2, publishedAt: 5_000, updatedAt: 5_000, chapters: undefined });
  changeUser({ uid: 'user-b' });
  assert.equal(watches[0].closed, true);
  await assert.rejects(service.getPublicationShare('user-a', book.id), { code: 'folio/wrong-account' });
  watches[0].next({ docs: [] });
  assert.equal(received.length, 2);
});

test('shared claims verify only the link head and retain the original acquiredAt', async () => {
  const { service, docs, calls, changeUser } = harness();
  const { book, shareToken } = await service.publishBook('user-a', publicationInput());
  changeUser({ uid: 'recipient' });
  calls.reads.length = 0;
  const received = await service.claimSharedBook('recipient', book.id, shareToken);
  assert.equal(received.id, book.id);
  assert.equal(received.shareToken, shareToken);
  assert.equal(received.chapters, undefined);
  assert.deepEqual(calls.reads, [headPath(book.id, shareToken)], 'A claim never downloads manuscript parts.');
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

test('signed ownership reload resolves book metadata and suppresses late snapshots and detached reads', async () => {
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
  assert.equal(received[0][0].title, 'The Coast & <Quiet>');
  assert.equal(received[0][0].revision, 1);
  assert.equal(received[0][0].chapters, undefined);
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
  release({ exists: () => true, data: () => docs.get(headPath(book.id, shareToken)) });
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
  const writeBatch = sdk.firestore.writeBatch;
  sdk.firestore.writeBatch = () => ({ set() {}, commit: async () => { throw Object.assign(new Error('Offline'), { code: 'unavailable' }); } });
  await assert.rejects(service.publishBook('user-a', publicationInput()), { code: 'unavailable' });
  assert.equal(calls.writes, writes);
  assert.equal(docs.size, 6);
  sdk.firestore.writeBatch = writeBatch;
  const sharedPath = headPath(first.book.id, first.shareToken);
  docs.set(sharedPath, { ...docs.get(sharedPath), partCount: MAX_PARTS + 1 });
  await assert.rejects(service.claimSharedBook('user-a', first.book.id, first.shareToken), { code: 'folio/share-not-found' });
  docs.set(sharedPath, { ...docs.get(sharedPath), partCount: 1, contentJson: 'not JSON' });
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

test('the owner edits a book in place: same link, next revision, parts grown and trimmed', async () => {
  const { service, docs, calls } = harness();
  const { book, shareToken } = await service.publishBook('user-a', publicationInput());
  const longer = bookOfBytes(2_500_000, '海');
  const grown = await service.updateBook('user-a', book.id, { ...publicationInput(), title: 'The Coast, Revised', priceCents: 699, kind: 'atlas', chapters: longer },
    { expectedRevision: 1 });
  assert.equal(grown.shareToken, shareToken);
  assert.equal(grown.book.id, book.id);
  assert.deepEqual({ revision: grown.book.revision, title: grown.book.title, priceCents: grown.book.priceCents, kind: grown.book.kind,
    publishedAt: grown.book.publishedAt, updatedAt: grown.book.updatedAt, contentBytes: grown.book.contentBytes },
  { revision: 2, title: 'The Coast, Revised', priceCents: 699, kind: 'atlas', publishedAt: 123_456, updatedAt: 30_000, contentBytes: 2_500_000 });
  assert.deepEqual(grown.book.chapters, longer);
  const authorCopy = docs.get(authorPath('user-a', book.id));
  const linkCopy = docs.get(headPath(book.id, shareToken));
  const { shareToken: kept, ...common } = authorCopy;
  assert.equal(kept, shareToken);
  assert.deepEqual(common, linkCopy, 'Both heads stay identical apart from the author copy\'s link token.');
  assert.deepEqual({ revision: linkCopy.revision, partCount: linkCopy.partCount, publishedAt: linkCopy.publishedAt.getTime() }, { revision: 2, partCount: 3, publishedAt: 123_456 });
  assert.deepEqual(storedParts(docs, book.id, shareToken).map(path => docs.get(path).revision), [2, 2, 2]);
  assert.ok(Math.max(...calls.requestBytes) < 10 * 1024 * 1024);
  const read = await service.getBookContent(book.id, shareToken);
  assert.deepEqual(read.chapters, longer);
  assert.equal(read.revision, 2);

  const shrunk = await service.updateBook('user-a', book.id, publicationInput(), { expectedRevision: 2 });
  assert.equal(shrunk.book.revision, 3);
  assert.equal(shrunk.book.title, 'The Coast & <Quiet>');
  assert.deepEqual(storedParts(docs, book.id, shareToken), [partPath(book.id, shareToken, 0)]);
  assert.deepEqual(calls.deletes, [partPath(book.id, shareToken, 1), partPath(book.id, shareToken, 2)]);
  assert.deepEqual((await service.getBookContent(book.id, shareToken)).chapters, publicationInput().chapters);
  assert.equal((await service.getSharedBook(book.id, shareToken)).revision, 3);
});

test('an edit from an out-of-date copy is an edit conflict, never a silent overwrite or a sign-in prompt', async () => {
  const { service, docs, calls, sdk } = harness();
  const { book, shareToken } = await service.publishBook('user-a', publicationInput());
  await service.updateBook('user-a', book.id, { ...publicationInput(), title: 'Tab A' }, { expectedRevision: 1 });
  const writes = calls.writes;
  await assert.rejects(service.updateBook('user-a', book.id, { ...publicationInput(), title: 'Tab B' }, { expectedRevision: 1 }),
    { code: 'folio/edit-conflict', message: 'This book was changed somewhere else. Reopen it to get the latest edition, then make your changes again.' });
  assert.equal(calls.writes, writes);
  assert.equal(docs.get(headPath(book.id, shareToken)).title, 'Tab A');

  // The rules refuse a commit that lost a race as permission-denied; the service re-reads the head to explain it.
  const path = headPath(book.id, shareToken);
  const deniedAfter = change => async (_db, body) => {
    await body({ get: async ref => ({ exists: () => docs.has(ref.path), data: () => docs.get(ref.path) }), set() {}, update() {}, delete() {} });
    change();
    throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
  };
  sdk.firestore.runTransaction = deniedAfter(() => docs.set(path, { ...docs.get(path), revision: 3 }));
  await assert.rejects(service.updateBook('user-a', book.id, publicationInput(), { expectedRevision: 2 }), { code: 'folio/edit-conflict' });
  sdk.firestore.runTransaction = deniedAfter(() => {});
  await assert.rejects(service.updateBook('user-a', book.id, publicationInput(), { expectedRevision: 3 }), { code: 'permission-denied' });
  assert.equal(calls.writes, writes);
});

test('only the signed-in owner can edit, with a valid book and revision', async () => {
  const { service, calls, changeUser } = harness();
  const { book } = await service.publishBook('user-a', publicationInput());
  const writes = calls.writes;
  await assert.rejects(service.updateBook('user-b', book.id, publicationInput(), { expectedRevision: 1 }), { code: 'folio/wrong-account' });
  for (const options of [undefined, null, {}, { expectedRevision: -1 }, { expectedRevision: 1.5 }, { expectedRevision: '1' }]) {
    await assert.rejects(service.updateBook('user-a', book.id, publicationInput(), options), { code: 'folio/invalid-input' });
  }
  await assert.rejects(service.updateBook('user-a', '../quiet', publicationInput(), { expectedRevision: 1 }), { code: 'folio/share-not-found' });
  await assert.rejects(service.updateBook('user-a', book.id, { ...publicationInput(), chapters: [] }, { expectedRevision: 1 }), { code: 'folio/invalid-book' });
  await assert.rejects(service.updateBook('user-a', book.id, { ...publicationInput(), chapters: bookOfBytes(MAX_BOOK_BYTES + 1) }, { expectedRevision: 1 }), { code: 'folio/book-too-large' });
  changeUser({ uid: 'user-b' });
  await assert.rejects(service.updateBook('user-b', book.id, publicationInput(), { expectedRevision: 1 }), { code: 'folio/share-not-found' });
  await service.signOut();
  await assert.rejects(service.updateBook('user-a', book.id, publicationInput(), { expectedRevision: 1 }), { code: 'folio/not-signed-in' });
  assert.equal(calls.writes, writes);
});

test('legacy inline books stay readable as revision 0 and move to parts on their first edit', async () => {
  const { service, docs, calls } = harness();
  seedLegacyBook(docs);
  const path = headPath(LEGACY_ID, LEGACY_TOKEN);
  const meta = await service.getSharedBook(LEGACY_ID, LEGACY_TOKEN);
  assert.deepEqual({ revision: meta.revision, chapterCount: meta.chapterCount, wordCount: meta.wordCount, pages: meta.pages, publishedAt: meta.publishedAt,
    updatedAt: meta.updatedAt, contentBytes: meta.contentBytes, chapters: meta.chapters },
  { revision: 0, chapterCount: 2, wordCount: 12, pages: 1, publishedAt: 5_000, updatedAt: 5_000, contentBytes: utf8Bytes(JSON.stringify(publicationInput().chapters)), chapters: undefined });
  assert.deepEqual((await service.getBookContent(LEGACY_ID, LEGACY_TOKEN)).chapters, publicationInput().chapters);
  assert.deepEqual(calls.reads, [path, path], 'Legacy books need no part reads.');
  await assert.rejects(service.updateBook('user-a', LEGACY_ID, publicationInput(), { expectedRevision: 1 }), { code: 'folio/edit-conflict' });
  const edited = await service.updateBook('user-a', LEGACY_ID, { ...publicationInput(), title: 'An Older Book, Revised' }, { expectedRevision: 0 });
  assert.deepEqual({ revision: edited.book.revision, shareToken: edited.shareToken, publishedAt: edited.book.publishedAt }, { revision: 1, shareToken: LEGACY_TOKEN, publishedAt: 5_000 });
  for (const stored of [authorPath('user-a', LEGACY_ID), path]) {
    assert.equal('contentJson' in docs.get(stored), false);
    assert.deepEqual({ revision: docs.get(stored).revision, partCount: docs.get(stored).partCount, title: docs.get(stored).title }, { revision: 1, partCount: 1, title: 'An Older Book, Revised' });
  }
  assert.deepEqual(calls.deletes, [1, 2, 3, 4, 5].map(index => partPath(LEGACY_ID, LEGACY_TOKEN, index)));
  assert.deepEqual((await service.getBookContent(LEGACY_ID, LEGACY_TOKEN)).chapters, publicationInput().chapters);
  assert.equal((await service.updateBook('user-a', LEGACY_ID, publicationInput(), { expectedRevision: 1 })).book.revision, 2);
});

test('content reads retry until the head and every part share one revision', async () => {
  const { service, sdk, docs, calls } = harness();
  const chapters = bookOfBytes(1_500_000);
  const { book, shareToken } = await service.publishBook('user-a', { ...publicationInput(), chapters });
  const head = headPath(book.id, shareToken);
  const getDoc = sdk.firestore.getDoc;
  let stale = 1;
  sdk.firestore.getDoc = async ref => {
    const result = await getDoc(ref);
    if (ref.path !== partPath(book.id, shareToken, 1) || stale-- <= 0) return result;
    return { exists: () => true, data: () => ({ ...result.data(), revision: 0 }) };
  };
  calls.reads.length = 0;
  assert.deepEqual((await service.getBookContent(book.id, shareToken)).chapters, chapters);
  assert.equal(calls.reads.filter(path => path === head).length, 2);
  // A part removed by a concurrent shrink is retried too; a book that never settles reports an interruption.
  sdk.firestore.getDoc = async ref => (ref.path === partPath(book.id, shareToken, 1) ? { exists: () => false, data: () => undefined } : getDoc(ref));
  await assert.rejects(service.getBookContent(book.id, shareToken), { code: 'aborted', message: 'Something interrupted the connection. Please try again.' });
  sdk.firestore.getDoc = getDoc;
  const first = partPath(book.id, shareToken, 0);
  docs.set(first, { ...docs.get(first), index: 1 });
  await assert.rejects(service.getBookContent(book.id, shareToken), { code: 'folio/share-not-found' });
  docs.set(first, { ...docs.get(first), index: 0, text: 'not JSON' });
  await assert.rejects(service.getBookContent(book.id, shareToken), { code: 'folio/share-not-found' });
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

const RULES_BEGIN = '    // FOLIO PUBLICATIONS BEGIN: merge this block into the active shared policy.';
const RULES_END = '    // FOLIO PUBLICATIONS END';
const deployedBlock = `${RULES_BEGIN}\n    function folioPublicationOwner(uid) {\n      return request.auth != null && request.auth.uid == uid;\n    }\n${RULES_END}`;
const sharedPolicy = (block = deployedBlock, newline = '\n') => ("rules_version = '2';\nservice cloud.firestore {\n  match /databases/{database}/documents {\n"
  + `    match /anotherApp/{id} { allow read: if true; }\n\n${block}\n\n    match /otherApp/{id} { allow write: if false; }\n  }\n}\n`).replaceAll('\n', newline);
const repositoryBlock = folio => folio.slice(folio.indexOf(RULES_BEGIN), folio.indexOf(RULES_END) + RULES_END.length);

test('rule replacement swaps only the reviewed Folio block and preserves every other byte and line ending', async () => {
  const folio = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8');
  const block = repositoryBlock(folio);
  const active = sharedPolicy();
  const result = replacePublicationRules(active, folio, blockSha256(deployedBlock));
  assert.equal(result.merged, active.replace(deployedBlock, () => block));
  assert.equal(result.merged.slice(0, result.begin), active.slice(0, result.begin));
  assert.equal(result.merged.slice(result.begin + block.length), active.slice(result.begin + deployedBlock.length));
  assert.deepEqual({ oldSha256: result.oldSha256, newSha256: result.newSha256, oldBytes: result.oldBytes, newBytes: result.newBytes, lineEndings: result.lineEndings },
    { oldSha256: blockSha256(deployedBlock), newSha256: blockSha256(block), oldBytes: utf8Bytes(deployedBlock), newBytes: utf8Bytes(block), lineEndings: 'lf' });
  const windows = sharedPolicy(deployedBlock, '\r\n');
  const converted = replacePublicationRules(windows, folio, blockSha256(deployedBlock));
  assert.equal(converted.merged, windows.replace(deployedBlock.replaceAll('\n', '\r\n'), () => block.replaceAll('\n', '\r\n')));
  assert.equal(converted.lineEndings, 'crlf');
  assert.equal(replacePublicationRules(result.merged, folio, result.newSha256).merged, result.merged, 'A reviewed rerun is a no-op.');
  const unicode = sharedPolicy().replace('anotherApp', 'autreAppé\u{1F30A}');
  const kept = replacePublicationRules(unicode, folio, blockSha256(deployedBlock)).merged;
  assert.ok(Buffer.from(kept).subarray(0, Buffer.byteLength(unicode.slice(0, unicode.indexOf(RULES_BEGIN)))).equals(Buffer.from(unicode.slice(0, unicode.indexOf(RULES_BEGIN)))));
});

test('rule replacement refuses hand edits, marker anomalies, mixed line endings, and name collisions', async () => {
  const folio = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8');
  const reviewed = blockSha256(deployedBlock);
  const refuse = (active, pattern, expected = reviewed, source = folio) => assert.throws(() => replacePublicationRules(active, source, expected), pattern);
  refuse(sharedPolicy(), /expect-old-sha256/, null);
  refuse(sharedPolicy(), /expect-old-sha256/, 'not-a-hash');
  refuse(sharedPolicy(deployedBlock.replace('uid;', 'uid; // edited')), /not the reviewed/);
  refuse(sharedPolicy(`${deployedBlock}\n${deployedBlock}`), /exactly one/);
  refuse(sharedPolicy(deployedBlock.replace(RULES_END, '')), /exactly one/);
  refuse(sharedPolicy(deployedBlock.replace(RULES_BEGIN, '')), /exactly one/);
  refuse(sharedPolicy(''), /exactly one/);
  refuse(sharedPolicy(`${RULES_END}\n${deployedBlock.replace(RULES_END, '')}`), /exactly one/);
  refuse(sharedPolicy(`x${deployedBlock}`), /start its own line/);
  refuse(sharedPolicy(`${deployedBlock} trailing`), /end its own line/);
  refuse(sharedPolicy(deployedBlock.replace('\n', '\r\n')), /mixes line endings/);
  refuse(sharedPolicy().replace('match /otherApp', 'function folioPublicationOwner(uid) { return true; }\n    match /otherApp'), /outside the marked block/);
  refuse(sharedPolicy().replace('match /otherApp', '// FOLIO PUBLICATIONS BEGIN\n    match /otherApp'), /outside the marked block/);
  const helperSource = `${RULES_BEGIN}\n    function sharedHelper() { return true; }\n${RULES_END}\n`;
  refuse(sharedPolicy().replace('match /otherApp', 'function sharedHelper() { return false; }\n    match /otherApp'), /sharedHelper is already defined/, reviewed, helperSource);
});

test('rules preparation requires a reviewed hash to replace and never overwrites its output', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'folio-rules-'));
  const log = console.log;
  const printed = [];
  console.log = line => printed.push(JSON.parse(line));
  try {
    const active = join(dir, 'active.rules');
    const output = join(dir, 'merged.rules');
    await writeFile(active, sharedPolicy(deployedBlock, '\r\n'));
    const replace = target => prepareRules(['--replace', '--expect-old-sha256', blockSha256(deployedBlock).toUpperCase(), '--active', active, '--output', target]);
    await assert.rejects(prepareRules(['--replace', '--active', active, '--output', output]), /together/);
    await assert.rejects(prepareRules(['--expect-old-sha256', blockSha256(deployedBlock), '--active', active, '--output', output]), /together/);
    await assert.rejects(prepareRules(['--active', active, '--output', output]), /--replace/);
    await assert.rejects(prepareRules(['--replace', '--expect-old-sha256', blockSha256(deployedBlock), '--active', active, '--output', active]), /distinct/);
    await replace(output);
    const merged = await readFile(output, 'utf8');
    assert.match(merged, /folioPublicationParts/);
    assert.equal(merged.replaceAll('\r\n', '').includes('\n'), false, 'CRLF policies stay CRLF.');
    assert.deepEqual({ mode: printed[0].mode, preserved: printed[0].preserved, deployed: printed[0].deployed, oldSha256: printed[0].oldSha256 },
      { mode: 'replace', preserved: true, deployed: false, oldSha256: blockSha256(deployedBlock) });
    await assert.rejects(replace(output), { code: 'EEXIST' });
    assert.equal(await readFile(output, 'utf8'), merged);
    const invalid = join(dir, 'invalid.rules');
    await writeFile(invalid, Buffer.concat([Buffer.from(sharedPolicy()), Buffer.from([0xff])]));
    await assert.rejects(prepareRules(['--replace', '--expect-old-sha256', blockSha256(deployedBlock), '--active', invalid, '--output', join(dir, 'other.rules')]), /UTF-8/);
  } finally {
    console.log = log;
    await rm(dir, { recursive: true, force: true });
  }
});
