#!/usr/bin/env node
/**
 * Administrative backfill for the publication rules: gives every existing published book its create-only
 * binding (/folioCatalog/{bookId}/binding/owner), so no other account can add a link under its ID.
 * Run it once before releasing the rules that require bindings. It never deploys rules or changes a book.
 */
import { pathToFileURL } from 'node:url';

const PUBLICATION_ID = /^b-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHARE_TOKEN = /^[0-9a-f]{64}$/;
const UID = /^[^/]{1,128}$/;

/**
 * Bindings for author heads `{uid, bookId, data}` whose link head `{ownerUid}` exists and agrees.
 * Anything inconsistent is reported and skipped, never bound.
 */
export function planBindings(publications, linkHeadFor) {
  const bindings = [], skipped = [], seen = new Set();
  for (const { uid, bookId, data } of publications) {
    const reason = !PUBLICATION_ID.test(bookId || '') ? 'not a publication ID'
      : !UID.test(uid || '') || data?.ownerUid !== uid ? 'owner does not match its path'
      : !SHARE_TOKEN.test(data?.shareToken || '') ? 'no valid link token'
      : seen.has(bookId) ? 'another account lists the same book ID'
      : linkHeadFor(bookId, data.shareToken)?.ownerUid !== uid ? 'its link head is missing or has another owner' : '';
    if (reason) { skipped.push({ uid, bookId, reason }); continue; }
    seen.add(bookId);
    bindings.push({ path: `folioCatalog/${bookId}/binding/owner`, data: { ownerUid: uid, shareToken: data.shareToken } });
  }
  // A book ID listed by two accounts is never bound to either; every claimant is reported so an administrator decides.
  const reason = 'another account lists the same book ID';
  const contested = new Set(skipped.filter(item => item.reason === reason).map(item => item.bookId));
  for (const { path, data } of bindings) {
    const bookId = path.split('/')[1];
    if (contested.has(bookId)) skipped.push({ uid: data.ownerUid, bookId, reason });
  }
  return { bindings: bindings.filter(item => !contested.has(item.path.split('/')[1])), skipped };
}

function parseArguments(args) {
  const options = { apply: false, projectId: '' };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--project') options.projectId = args[++index] || '';
    else if (value === '--apply') options.apply = true;
    else if (value !== '--check') throw new Error(`Unknown option: ${value}. Usage: node scripts/bind-publications.mjs --project PROJECT_ID [--check | --apply]`);
  }
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(options.projectId)) throw new Error('Pass the exact Firebase project ID with --project.');
  return options;
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  let admin, firestore;
  try { [admin, firestore] = await Promise.all([import('firebase-admin/app'), import('firebase-admin/firestore')]); }
  catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND') throw new Error('Optional dependency missing. Install it with: npm install --no-save --package-lock=false firebase-admin');
    throw error;
  }
  const app = admin.initializeApp({ projectId: options.projectId, credential: admin.applicationDefault() }, 'folio-publication-bindings');
  try {
    const db = firestore.getFirestore(app);
    // Read only Folio's own collection; other applications share this project.
    const publications = [];
    for (const owner of await db.collection('folioUsers').listDocuments()) {
      for (const item of (await owner.collection('publications').get()).docs) publications.push({ uid: owner.id, bookId: item.id, data: item.data() });
    }
    const heads = new Map();
    for (const { bookId, data } of publications) {
      if (!PUBLICATION_ID.test(bookId) || !SHARE_TOKEN.test(data?.shareToken || '')) continue;
      const head = await db.doc(`folioCatalog/${bookId}/shares/${data.shareToken}`).get();
      heads.set(`${bookId}/${data.shareToken}`, head.exists ? head.data() : null);
    }
    const { bindings, skipped } = planBindings(publications, (bookId, token) => heads.get(`${bookId}/${token}`));
    for (const item of skipped) console.log(`  skipped ${item.uid}/${item.bookId}: ${item.reason}`);
    let created = 0, existing = 0;
    for (const { path, data } of bindings) {
      if (!options.apply) { const known = await db.doc(path).get(); if (known.exists) existing += 1; else console.log(`  would bind ${path}`); continue; }
      try { await db.doc(path).create(data); created += 1; }
      catch (error) { if (error.code === 6 || /already exists/i.test(error.message)) existing += 1; else throw error; }
    }
    console.log(JSON.stringify({ project: options.projectId, mode: options.apply ? 'apply' : 'check', publications: publications.length,
      bindable: bindings.length, created, alreadyBound: existing, skipped: skipped.length }));
  } finally { await admin.deleteApp(app); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(`Binding backfill failed: ${error.message}`); process.exitCode = 1; });
}
