/**
 * Opt-in Firestore rules suite: FIREBASE_CLI=/path/to/firebase npm run check:rules
 * Starts a throwaway local emulator (demo-* projects, empty CLI config, no credentials) and talks plain REST.
 * FOLIO_RULES_FILE=MERGED.rules runs the same checks against a prepared shared policy instead of the template.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { splitPublicationContent } from '../js/firebase-service.js';
import { MAX_BOOK_BYTES, MAX_PARTS, PART_BYTES } from '../js/publication-limits.js';
import { blockSha256, replacePublicationRules } from '../scripts/prepare-publication-rules.mjs';

const cli = process.env.FIREBASE_CLI;
const skip = cli ? false : 'Set FIREBASE_CLI to a firebase-tools binary to run the Firestore rules emulator suite.';
const customRules = process.env.FOLIO_RULES_FILE;
const PROJECT = 'demo-folio';
const MERGED_PROJECT = 'demo-folio-merged';
const LEGACY_COMMIT = '13fed3b';
const LEGACY_BLOCK_SHA256 = '86281897fa5e09d21eb02e981355fd0d80ab9a1d46ea292bc0f59849aa71af86';
const BOOK = 'b-01234567-89ab-4cde-8fab-0123456789ab';
const TOKEN = 'a'.repeat(64);
const OTHER_BOOK = 'b-89abcdef-0123-4567-89ab-cdef01234567';
const utf8Bytes = text => Buffer.byteLength(text, 'utf8');

let emulator;
let child;
let workDir;
let output = '';

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
  });
}

before(async () => {
  if (skip) return;
  workDir = await mkdtemp(join(tmpdir(), 'folio-rules-emulator-'));
  await mkdir(join(workDir, 'xdg'));
  const [port, websocketPort, hubPort, loggingPort] = [await freePort(), await freePort(), await freePort(), await freePort()];
  await writeFile(join(workDir, 'firebase.json'), JSON.stringify({ emulators: {
    firestore: { host: '127.0.0.1', port, websocketPort }, hub: { host: '127.0.0.1', port: hubPort },
    logging: { host: '127.0.0.1', port: loggingPort }, ui: { enabled: false }, singleProjectMode: false } }));
  // No saved CLI login, service account or cloud SDK configuration reaches the emulator process.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(GOOGLE_|GCLOUD|GCP_|CLOUDSDK_|FIREBASE_)/.test(key)));
  child = spawn(cli, ['emulators:start', '--only', 'firestore', '--project', PROJECT, '--config', join(workDir, 'firebase.json')],
    { cwd: workDir, env: { ...env, XDG_CONFIG_HOME: join(workDir, 'xdg'), NO_UPDATE_NOTIFIER: '1' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  emulator = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 120_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`The Firestore emulator exited early:\n${output}`);
    try { if ((await fetch(`${emulator}/`)).ok) break; } catch { /* still starting */ }
    if (Date.now() > deadline) throw new Error(`The Firestore emulator did not start:\n${output}`);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  await loadRules(PROJECT, await readFile(customRules || new URL('../firestore.rules', import.meta.url), 'utf8'));
});

after(async () => {
  if (child && child.exitCode === null) {
    const exited = new Promise(resolve => child.once('exit', resolve));
    try { process.kill(-child.pid, 'SIGINT'); } catch { /* already stopped */ }
    const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already stopped */ } }, 20_000);
    await exited;
    clearTimeout(timer);
  }
  // The CLI can exit before the emulator's JVM; stop anything left in the process group.
  if (child) for (let attempt = 0; attempt < 40; attempt += 1) {
    try { process.kill(-child.pid, 0); } catch { break; }
    if (attempt === 39) try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (workDir) await rm(workDir, { recursive: true, force: true });
});

async function loadRules(project, source) {
  const response = await fetch(`${emulator}/emulator/v1/projects/${project}:securityRules`, { method: 'PUT',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content: source }] } }) });
  assert.equal(response.status, 200, `Rules did not compile: ${await response.text()}`);
}

async function resetData(project = PROJECT) {
  const response = await fetch(`${emulator}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' });
  assert.equal(response.status, 200);
}

const base64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
function authorization(uid, project) {
  if (!uid) return {};
  if (uid === 'admin') return { authorization: 'Bearer owner' };
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: `https://securetoken.google.com/${project}`, aud: project, sub: uid, user_id: uid, iat: now, exp: now + 3600, auth_time: now,
    firebase: { sign_in_provider: 'password', identities: {} } };
  return { authorization: `Bearer ${base64({ alg: 'none', typ: 'JWT' })}.${base64(claims)}.` };
}

const documents = project => `${emulator}/v1/projects/${project}/databases/(default)/documents`;
const name = (project, path) => `projects/${project}/databases/(default)/documents/${path}`;

function encode(value) {
  if (typeof value === 'string') return { stringValue: value };
  if (Number.isInteger(value)) return { integerValue: String(value) };
  if (typeof value === 'number') return { doubleValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  throw new TypeError(`Unsupported value ${value}`);
}
const fields = data => Object.fromEntries(Object.entries(data).map(([key, value]) => [key, encode(value)]));
const decode = document => Object.fromEntries(Object.entries(document.fields || {}).map(([key, value]) => [key,
  value.integerValue !== undefined ? Number(value.integerValue) : value.stringValue ?? value.timestampValue ?? value.booleanValue ?? value.doubleValue]));
const serverTimes = names => names.map(fieldPath => ({ fieldPath, setToServerValue: 'REQUEST_TIME' }));

/** Write builders for one REST commit; each commit is atomic like a batch or transaction. */
const set = (project, path, data, times = []) => ({ update: { name: name(project, path), fields: fields(data) }, updateTransforms: serverTimes(times) });
const merge = (project, path, data, times = [], removed = []) => ({ update: { name: name(project, path), fields: fields(data) },
  updateMask: { fieldPaths: [...Object.keys(data), ...removed] }, updateTransforms: serverTimes(times), currentDocument: { exists: true } });
const remove = (project, path) => ({ delete: name(project, path) });

async function commit(uid, writes, project = PROJECT) {
  const response = await fetch(`${documents(project)}:commit`, { method: 'POST', headers: { 'content-type': 'application/json', ...authorization(uid, project) },
    body: JSON.stringify({ writes }) });
  return { status: response.status, body: await response.text() };
}
async function read(uid, path, project = PROJECT) {
  const response = await fetch(`${documents(project)}/${path}`, { headers: authorization(uid, project) });
  return { status: response.status, data: response.ok ? decode(await response.json()) : null };
}

const authorCopy = (uid, bookId = BOOK) => `folioUsers/${uid}/publications/${bookId}`;
const share = (bookId = BOOK, token = TOKEN) => `folioCatalog/${bookId}/shares/${token}`;
const part = (index, bookId = BOOK, token = TOKEN) => `${share(bookId, token)}/parts/${index}`;
const range = (start, end) => Array.from({ length: Math.max(0, end - start) }, (_, index) => start + index);

function head(uid, parts, { revision = 1, bookId = BOOK, ...overrides } = {}) {
  const contentBytes = Math.min(MAX_BOOK_BYTES, parts.reduce((sum, text) => sum + utf8Bytes(text), 0));
  return { bookId, ownerUid: uid, title: 'The Coast', author: 'Mara Ellison', genre: 'Fiction', kind: 'shape', kicker: 'An original story',
    description: 'A story by the sea.', category: 'Fiction', priceCents: 499, revision, partCount: parts.length, contentBytes, chapterCount: 1, wordCount: 3, ...overrides };
}

function publishWrites(uid, parts, { project = PROJECT, bookId = BOOK, token = TOKEN, headOverrides = {}, authorOverrides = {}, partOverrides = {} } = {}) {
  const data = head(uid, parts, { bookId, ...headOverrides });
  return [
    set(project, authorCopy(uid, bookId), { ...data, shareToken: token, ...authorOverrides }, ['publishedAt', 'updatedAt']),
    set(project, share(bookId, token), data, ['publishedAt', 'updatedAt']),
    ...parts.map((text, index) => set(project, part(index, bookId, token), { bookId, ownerUid: uid, revision: 1, index, text, ...partOverrides })),
  ];
}

function editWrites(uid, parts, revision, { project = PROJECT, previousParts = 0, legacy = false, headOverrides = {}, authorOverrides = {}, partRevision = revision } = {}) {
  const data = head(uid, parts, { revision, ...headOverrides });
  const removed = legacy ? ['contentJson'] : [];
  return [
    merge(project, authorCopy(uid), { ...data, ...authorOverrides }, ['updatedAt'], removed),
    merge(project, share(), data, ['updatedAt'], removed),
    ...parts.map((text, index) => set(project, part(index), { bookId: BOOK, ownerUid: uid, revision: partRevision, index, text })),
    ...range(parts.length, previousParts).map(index => remove(project, part(index))),
  ];
}

/** Chapters JSON of exactly `target` UTF-8 bytes, mostly 4-byte emoji, as the app would store it. */
function manuscriptOfBytes(target) {
  const paragraphs = [''];
  const size = () => utf8Bytes(JSON.stringify([{ title: 'Opening', paragraphs }]));
  const full = '🌊'.repeat(49_996);
  while (target - size() > utf8Bytes(full) + 3) paragraphs.splice(-1, 0, full);
  const remaining = target - size();
  paragraphs[paragraphs.length - 1] = 'x'.repeat(remaining % 4) + '🌊'.repeat(Math.floor(remaining / 4));
  const json = JSON.stringify([{ title: 'Opening', paragraphs }]);
  assert.equal(utf8Bytes(json), target);
  return json;
}

const small = ['[{"title":"Opening",', '"paragraphs":["The tide returned."]}]'];
const allowed = async (promise, label) => { const result = await promise; assert.equal(result.status, 200, `${label}: ${result.body?.slice(0, 300)}`); };
const denied = async (promise, label) => { const result = await promise; assert.equal(result.status, 403, `${label} should be denied: ${result.body?.slice(0, 300)}`); };

test('a 5 MB book publishes at the six-part maximum and only exact link reads are public', { skip }, async () => {
  await resetData();
  const parts = splitPublicationContent(manuscriptOfBytes(MAX_BOOK_BYTES));
  assert.equal(parts.length, MAX_PARTS);
  assert.ok(parts.every(text => utf8Bytes(text) <= PART_BYTES));
  await allowed(commit('user-a', publishWrites('user-a', parts)), 'publish at MAX_PARTS');
  const linkHead = await read(null, share());
  assert.equal(linkHead.status, 200);
  assert.deepEqual({ revision: linkHead.data.revision, partCount: linkHead.data.partCount, contentBytes: linkHead.data.contentBytes, contentJson: linkHead.data.contentJson },
    { revision: 1, partCount: MAX_PARTS, contentBytes: MAX_BOOK_BYTES, contentJson: undefined });
  const texts = [];
  for (const index of range(0, MAX_PARTS)) {
    const result = await read(null, part(index));
    assert.equal(result.status, 200);
    texts.push(result.data.text);
  }
  assert.equal(texts.join(''), parts.join(''));
  assert.equal((await read(null, part(MAX_PARTS))).status, 403, 'Part indexes stop at MAX_PARTS - 1.');
  assert.equal((await read(null, `folioCatalog/${BOOK}/shares`)).status, 403, 'Shares cannot be listed.');
  assert.equal((await read(null, `${share()}/parts`)).status, 403, 'Parts cannot be listed.');
  assert.equal((await read('user-b', `${share()}/parts`)).status, 403);
  assert.equal((await read('user-a', authorCopy('user-a'))).status, 200);
  assert.equal((await read('user-b', authorCopy('user-a'))).status, 403);
  assert.equal((await read(null, authorCopy('user-a'))).status, 403);
  assert.equal((await read('user-a', `folioUsers/user-a/publications`)).status, 200, 'Authors can list their own publications.');
  assert.equal((await read('user-b', `folioUsers/user-a/publications`)).status, 403);
});

test('a publish must be complete, consistent, owned, and within part limits', { skip }, async () => {
  await resetData();
  const oversized = 'x'.repeat(PART_BYTES + 1);
  await denied(commit('user-a', publishWrites('user-a', [oversized])), 'a part over 1,000,000 bytes');
  await denied(commit('user-a', publishWrites('user-a', ['海'.repeat(333_334)])), 'a 3-byte part over 1,000,000 UTF-8 bytes');
  await denied(commit('user-a', publishWrites('user-a', small).slice(0, 3)), 'a head naming a part that was not written');
  await denied(commit('user-a', publishWrites('user-a', small).slice(0, 2)), 'heads without parts');
  await denied(commit('user-a', publishWrites('user-a', small, { headOverrides: { revision: 2 } })), 'a first revision other than 1');
  await denied(commit('user-a', publishWrites('user-a', small, { headOverrides: { partCount: MAX_PARTS + 1 } })), 'a part count above MAX_PARTS');
  await denied(commit('user-a', publishWrites('user-a', small, { headOverrides: { contentBytes: MAX_BOOK_BYTES + 1 } })), 'content over 5 MB');
  await denied(commit('user-a', publishWrites('user-a', small, { headOverrides: { chapterCount: 1_001 } })), 'more than 1,000 chapters');
  await denied(commit('user-a', publishWrites('user-a', small, { headOverrides: { contentJson: '[]' } })), 'a v2 head with inline contentJson');
  await denied(commit('user-a', publishWrites('user-a', small, { authorOverrides: { title: 'Different' } })), 'heads that disagree');
  await denied(commit('user-a', publishWrites('user-a', small, { partOverrides: { revision: 2 } })), 'parts from another revision');
  await denied(commit('user-a', publishWrites('user-a', small, { partOverrides: { extra: true } })), 'parts with extra fields');
  await denied(commit('user-b', publishWrites('user-a', small)), 'publishing as another account');
  const legacy = head('user-a', small);
  for (const key of ['revision', 'partCount', 'contentBytes', 'chapterCount', 'wordCount']) delete legacy[key];
  const legacyData = { ...legacy, contentJson: small.join('') };
  await denied(commit('user-a', [set(PROJECT, authorCopy('user-a'), { ...legacyData, shareToken: TOKEN }, ['publishedAt']),
    set(PROJECT, share(), legacyData, ['publishedAt'])]), 'the retired inline (v1) publish');
  await allowed(commit('user-a', publishWrites('user-a', small)), 'a complete publish');
  await denied(commit('user-a', publishWrites('user-a', small)), 'publishing over an existing book');
});

test('the owner grows and shrinks an edition in place, deleting trimmed parts in the same edit', { skip }, async () => {
  await resetData();
  await allowed(commit('user-a', publishWrites('user-a', small)), 'publish');
  const six = splitPublicationContent(manuscriptOfBytes(MAX_BOOK_BYTES));
  await allowed(commit('user-a', editWrites('user-a', six, 2, { headOverrides: { title: 'The Coast, Revised' } })), 'grow to MAX_PARTS');
  const grown = await read(null, share());
  assert.deepEqual({ revision: grown.data.revision, partCount: grown.data.partCount, title: grown.data.title }, { revision: 2, partCount: MAX_PARTS, title: 'The Coast, Revised' });
  for (const index of range(0, MAX_PARTS)) assert.equal((await read(null, part(index))).data.revision, 2);
  await allowed(commit('user-a', editWrites('user-a', ['[{"title":"Opening","paragraphs":["Short."]}]'], 3, { previousParts: MAX_PARTS })), 'shrink to one part with deletes');
  for (const index of range(1, MAX_PARTS)) assert.equal((await read(null, part(index))).status, 404);
  const shrunk = await read('user-a', authorCopy('user-a'));
  assert.deepEqual({ revision: shrunk.data.revision, partCount: shrunk.data.partCount, shareToken: shrunk.data.shareToken }, { revision: 3, partCount: 1, shareToken: TOKEN });
  assert.equal(shrunk.data.publishedAt, (await read(null, share())).data.publishedAt);
});

test('edits must advance the revision by one and keep identity, links, and both heads consistent', { skip }, async () => {
  await resetData();
  await allowed(commit('user-a', publishWrites('user-a', small)), 'publish');
  await denied(commit('user-a', editWrites('user-a', small, 1)), 'an edit without a revision bump');
  await denied(commit('user-a', editWrites('user-a', small, 3)), 'an edit that skips a revision');
  await denied(commit('user-a', editWrites('user-a', small, 2).slice(0, 2)), 'a head-only edit that leaves old parts');
  await denied(commit('user-a', editWrites('user-a', small, 2, { partRevision: 1 })), 'an edit with stale parts');
  await denied(commit('user-a', editWrites('user-a', small, 2).slice(2)), 'part writes without a head edit');
  await denied(commit('user-a', [set(PROJECT, part(0), { bookId: BOOK, ownerUid: 'user-a', revision: 1, index: 0, text: '[]' })]), 'rewriting a current part without a head edit');
  await denied(commit('user-a', [remove(PROJECT, part(1))]), 'deleting a part without a head edit');
  await denied(commit('user-a', editWrites('user-a', small, 2, { headOverrides: { publishedAt: new Date(1_000) } })), 'changing publishedAt');
  await denied(commit('user-a', editWrites('user-a', small, 2, { authorOverrides: { shareToken: 'b'.repeat(64) } })), 'changing the link token');
  await denied(commit('user-a', editWrites('user-a', small, 2, { authorOverrides: { title: 'Only here' } })), 'heads that disagree');
  await denied(commit('user-a', editWrites('user-a', small, 2, { headOverrides: { ownerUid: 'user-b' } })), 'changing the owner');
  await denied(commit('user-a', editWrites('user-a', small, 2, { headOverrides: { contentJson: '[]' } })), 'adding inline content');
  await allowed(commit('user-a', editWrites('user-a', small, 2, { headOverrides: { title: 'Tab A' } })), 'the first edit from revision 1');
  await denied(commit('user-a', editWrites('user-a', small, 2, { headOverrides: { title: 'Tab B' } })), 'a second edit from the same stale revision');
  assert.equal((await read(null, share())).data.title, 'Tab A');
});

test('other accounts cannot edit heads or write, replace, or delete parts', { skip }, async () => {
  await resetData();
  await allowed(commit('user-a', publishWrites('user-a', small)), 'publish');
  await denied(commit('user-b', [merge(PROJECT, share(), head('user-a', small, { revision: 2 }), ['updatedAt'])]), 'another account editing the link head');
  await denied(commit('user-b', [merge(PROJECT, authorCopy('user-a'), head('user-a', small, { revision: 2 }), ['updatedAt'])]), 'another account editing the author copy');
  await denied(commit('user-b', editWrites('user-a', small, 2)), 'another account submitting a whole edit');
  await denied(commit('user-b', [set(PROJECT, part(0), { bookId: BOOK, ownerUid: 'user-b', revision: 1, index: 0, text: 'x' })]), 'another account replacing a part');
  await denied(commit('user-b', [set(PROJECT, part(2), { bookId: BOOK, ownerUid: 'user-b', revision: 1, index: 2, text: 'x' })]), 'another account adding a part');
  await denied(commit('user-b', [remove(PROJECT, part(1))]), 'another account deleting a part');
  await denied(commit(null, [remove(PROJECT, part(1))]), 'a signed-out delete');
  await denied(commit('user-a', [remove(PROJECT, share())]), 'deleting a link head');
  await denied(commit('user-a', [remove(PROJECT, authorCopy('user-a'))]), 'deleting an author copy');
  assert.equal((await read(null, part(1))).data.text, small[1]);
});

test('legacy inline books stay readable and migrate to parts on their first edit', { skip }, async () => {
  await resetData();
  const legacy = { bookId: BOOK, ownerUid: 'user-a', title: 'An Older Book', author: 'Mara Ellison', genre: 'Fiction', kind: 'wild', kicker: 'An original story',
    description: '', category: 'Fiction', priceCents: 299, contentJson: small.join(''), publishedAt: new Date(5_000) };
  await allowed(commit('admin', [set(PROJECT, authorCopy('user-a'), { ...legacy, shareToken: TOKEN }), set(PROJECT, share(), legacy)]), 'seed a legacy book');
  assert.equal((await read(null, share())).data.contentJson, small.join(''));
  assert.equal((await read('user-a', authorCopy('user-a'))).status, 200);
  await allowed(commit('recipient', [set(PROJECT, `folioUsers/recipient/owned/${BOOK}`, { bookId: BOOK, shareToken: TOKEN, source: 'shared' }, ['acquiredAt'])]), 'claiming a legacy link');
  await denied(commit('user-a', editWrites('user-a', small, 1)), 'an edit that keeps inline contentJson');
  await denied(commit('user-a', editWrites('user-a', small, 2, { legacy: true })), 'a legacy edit that skips revision 1');
  await denied(commit('user-b', editWrites('user-a', small, 1, { legacy: true })), 'another account migrating the book');
  await allowed(commit('user-a', editWrites('user-a', small, 1, { legacy: true, previousParts: MAX_PARTS })), 'the migrating first edit');
  for (const path of [share(), authorCopy('user-a')]) {
    const migrated = await read('user-a', path);
    assert.deepEqual({ contentJson: migrated.data.contentJson, revision: migrated.data.revision, partCount: migrated.data.partCount, publishedAt: Date.parse(migrated.data.publishedAt) },
      { contentJson: undefined, revision: 1, partCount: 2, publishedAt: 5_000 });
  }
  assert.equal((await read(null, part(1))).data.text, small[1]);
  await allowed(commit('user-a', editWrites('user-a', small, 2)), 'a normal second edit');
});

test('library, progress, owned, and catalog rules still behave', { skip }, async () => {
  await resetData();
  const library = { bookId: 'quiet', title: 'The Shape of Quiet' };
  await allowed(commit('user-a', [set(PROJECT, 'folioUsers/user-a/library/quiet', library, ['addedAt', 'updatedAt'])]), 'saving to your library');
  await denied(commit('user-b', [set(PROJECT, 'folioUsers/user-a/library/quiet', library, ['addedAt', 'updatedAt'])]), 'saving to another library');
  await denied(commit('user-a', [set(PROJECT, 'folioUsers/user-a/library/loud', { bookId: 'loud', admin: true }, ['addedAt', 'updatedAt'])]), 'unknown library fields');
  assert.equal((await read('user-a', 'folioUsers/user-a/library/quiet')).status, 200);
  assert.equal((await read('user-b', 'folioUsers/user-a/library/quiet')).status, 403);
  const progress = { bookId: 'quiet', wordOffset: 42, fraction: 0.5, clientUpdatedAt: 1_000 };
  await allowed(commit('user-a', [set(PROJECT, 'folioUsers/user-a/progress/quiet', progress, ['updatedAt'])]), 'saving progress');
  await denied(commit('user-a', [set(PROJECT, 'folioUsers/user-a/progress/quiet', { ...progress, wordOffset: -1 }, ['updatedAt'])]), 'negative progress');
  await denied(commit('user-b', [set(PROJECT, 'folioUsers/user-a/progress/quiet', progress, ['updatedAt'])]), 'another account\'s progress');

  await allowed(commit('user-a', publishWrites('user-a', small)), 'publish');
  const owned = path => set(PROJECT, path, { bookId: BOOK, shareToken: TOKEN, source: 'shared' }, ['acquiredAt']);
  await allowed(commit('recipient', [owned(`folioUsers/recipient/owned/${BOOK}`)]), 'claiming a real link');
  await denied(commit('recipient', [set(PROJECT, `folioUsers/recipient/owned/${OTHER_BOOK}`, { bookId: OTHER_BOOK, shareToken: TOKEN, source: 'shared' }, ['acquiredAt'])]), 'claiming a missing link');
  await denied(commit('recipient', [set(PROJECT, `folioUsers/recipient/owned/${BOOK}`, { bookId: BOOK, shareToken: 'b'.repeat(64), source: 'shared' }, ['acquiredAt'])]), 'replacing a claim');
  await denied(commit('user-b', [owned(`folioUsers/recipient/owned/${BOOK}`)]), 'claiming for another account');
  assert.equal((await read('recipient', `folioUsers/recipient/owned/${BOOK}`)).status, 200);
  assert.equal((await read('user-b', `folioUsers/recipient/owned/${BOOK}`)).status, 403);

  await allowed(commit('admin', [set(PROJECT, 'folioCatalog/quiet', { title: 'The Shape of Quiet', published: true }),
    set(PROJECT, 'folioCatalog/draft', { title: 'A Draft', published: false })]), 'seeding the catalog');
  assert.equal((await read(null, 'folioCatalog/quiet')).status, 200);
  assert.equal((await read(null, 'folioCatalog/draft')).status, 403);
  await denied(commit('user-a', [set(PROJECT, 'folioCatalog/quiet', { title: 'Mine now', published: true, admin: true })]), 'a browser catalog write');
  if (!customRules) await denied(commit('user-a', [set(PROJECT, 'anotherCollection/doc', { value: 1 })]), 'the template\'s catch-all denial');
});

test('the --replace output for a shared policy compiles and enforces the new Folio rules', { skip: skip || (customRules && 'FOLIO_RULES_FILE is already a prepared policy.') }, async t => {
  const history = spawnSync('git', ['show', `${LEGACY_COMMIT}:firestore.rules`], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  if (history.status !== 0) { t.skip(`Repository history for ${LEGACY_COMMIT} is unavailable.`); return; }
  const begin = history.stdout.indexOf('    // FOLIO PUBLICATIONS BEGIN');
  const end = history.stdout.indexOf('    // FOLIO PUBLICATIONS END') + '    // FOLIO PUBLICATIONS END'.length;
  const deployed = history.stdout.slice(begin, end);
  assert.equal(blockSha256(deployed), LEGACY_BLOCK_SHA256, 'The documented hash matches the block released at 13fed3b.');
  const active = "rules_version = '2';\nservice cloud.firestore {\n  match /databases/{database}/documents {\n"
    + '    match /anotherApp/{id} {\n      allow read: if true;\n      allow write: if request.auth != null;\n    }\n\n'
    + `${deployed}\n\n    match /folioUsers/{uid}/library/{bookId} {\n      allow read, write: if request.auth != null && request.auth.uid == uid;\n    }\n  }\n}\n`;
  const { merged } = replacePublicationRules(active, await readFile(new URL('../firestore.rules', import.meta.url), 'utf8'), LEGACY_BLOCK_SHA256);
  await loadRules(MERGED_PROJECT, merged);
  await resetData(MERGED_PROJECT);
  await allowed(commit('user-a', publishWrites('user-a', small, { project: MERGED_PROJECT }), MERGED_PROJECT), 'publish under the merged policy');
  await allowed(commit('user-a', editWrites('user-a', small.slice(0, 1), 2, { project: MERGED_PROJECT, previousParts: 2 }), MERGED_PROJECT), 'edit under the merged policy');
  await denied(commit('user-a', editWrites('user-a', small, 2, { project: MERGED_PROJECT }), MERGED_PROJECT), 'a stale edit under the merged policy');
  await denied(commit('user-b', [set(MERGED_PROJECT, part(0), { bookId: BOOK, ownerUid: 'user-b', revision: 2, index: 0, text: 'x' })], MERGED_PROJECT), 'another account\'s part');
  assert.equal((await read(null, `folioCatalog/${BOOK}/shares`, MERGED_PROJECT)).status, 403);
  await allowed(commit('user-b', [set(MERGED_PROJECT, 'anotherApp/one', { value: 1 })], MERGED_PROJECT), 'the other application\'s own rule');
});
