#!/usr/bin/env node
/** Optional administrative tool. Dry-run never imports Firebase or accesses credentials. */
import { pathToFileURL } from 'node:url';
import { books } from '../js/books.js';

const MAX_DOCUMENT_BYTES = 1_048_576;
const DOCUMENT_HEADROOM = 4_096;
const MAX_BATCH_BYTES = 8 * 1_048_576;
const BOOK_ID = /^[a-z0-9][a-z0-9_-]{0,79}$/;

const stringBytes = value => Buffer.byteLength(value, 'utf8') + 1;

// Firebase's documented storage-size calculation for the plain field types used here.
// https://firebase.google.com/docs/firestore/storage-size
function valueBytes(value) {
  if (typeof value === 'string') return stringBytes(value);
  if (typeof value === 'boolean' || value === null) return 1;
  if (typeof value === 'number' || value instanceof Date) return 8;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + valueBytes(item), 0);
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return 32 + Object.entries(value).reduce((sum, [key, item]) => sum + stringBytes(key) + valueBytes(item), 0);
  }
  throw new Error('Catalog contains an unsupported field type.');
}

function text(book, field, { optional = false, maximum = 10_000 } = {}) {
  const value = book[field];
  if (optional && value == null) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    throw new Error(`Book ${book.id || '(unknown)'} has an invalid ${field}.`);
  }
  return value;
}

/** Returns a validated immutable write plan; no Firebase SDK is required. */
export function prepareCatalog(sourceBooks) {
  if (!Array.isArray(sourceBooks) || !sourceBooks.length) throw new Error('The source catalog is empty.');
  const seen = new Set();
  return sourceBooks.map(book => {
    if (!book || typeof book.id !== 'string' || !BOOK_ID.test(book.id) || seen.has(book.id)) {
      throw new Error('Each catalog book needs a unique lowercase slug of at most 80 characters.');
    }
    seen.add(book.id);
    if (!Array.isArray(book.chapters) || !book.chapters.length) throw new Error(`${book.id} has no chapters.`);
    const chapters = book.chapters.map((chapter, index) => {
      if (!chapter || typeof chapter.title !== 'string' || !chapter.title.trim()
        || !Array.isArray(chapter.paragraphs) || !chapter.paragraphs.length
        || chapter.paragraphs.some(paragraph => typeof paragraph !== 'string' || !paragraph.trim())) {
        throw new Error(`${book.id}, chapter ${index + 1}, must contain a title and complete text paragraphs.`);
      }
      return { title: chapter.title, paragraphs: [...chapter.paragraphs] };
    });
    const data = {
      title: text(book, 'title', { maximum: 200 }),
      author: text(book, 'author', { maximum: 120 }),
      genre: text(book, 'genre', { maximum: 80 }),
      kind: text(book, 'kind', { maximum: 80 }),
      description: text(book, 'description'),
      chapters,
      published: true,
      contentVersion: 1,
      source: 'folio-original-catalog',
      // The apply step replaces this eight-byte value with a real server timestamp.
      updatedAt: new Date(0),
    };
    for (const field of ['kicker', 'cover', 'category']) {
      const value = text(book, field, { optional: true, maximum: 300 });
      if (value !== undefined) data[field] = value;
    }
    if (Number.isInteger(book.pages) && book.pages > 0) data.pages = book.pages;
    const bytes = stringBytes('folioCatalog') + stringBytes(book.id) + 16 + valueBytes(data);
    if (bytes + DOCUMENT_HEADROOM >= MAX_DOCUMENT_BYTES) {
      throw new Error(`${book.id} is too large for a single Firestore document (${bytes} estimated bytes). Split its content before seeding.`);
    }
    return { id: book.id, data, bytes, chapters: chapters.length };
  });
}

function usage() {
  console.log(`Folio catalog seed\n\n  node scripts/seed-firestore.mjs --project PROJECT_ID [--dry-run | --apply]\n\nDefault: --dry-run. Validates the full local chapters and prints the write plan.\n--apply: upserts /folioCatalog documents using Firebase Admin + Application Default Credentials.\nNo browser config, credential-file argument, or service-account upload is accepted.`);
}

function parseArguments(args) {
  const options = { apply: false, projectId: '', help: false };
  let explicitMode;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--help' || value === '-h') options.help = true;
    else if (value === '--project') options.projectId = args[++index] || '';
    else if (value.startsWith('--project=')) options.projectId = value.slice('--project='.length);
    else if (value === '--apply' || value === '--dry-run') {
      if (explicitMode && explicitMode !== value) throw new Error('Choose --dry-run or --apply, not both.');
      explicitMode = value;
      options.apply = value === '--apply';
    } else throw new Error(`Unknown option: ${value}. Run with --help for usage.`);
  }
  if (!options.help && !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(options.projectId)) {
    throw new Error('Pass the exact Firebase project ID with --project (6–30 lowercase letters, digits, or hyphens).');
  }
  return options;
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  if (options.help) { usage(); return; }
  const plan = prepareCatalog(books);
  console.log(`${options.apply ? 'Apply' : 'Dry run'}: ${plan.length} catalog books → project ${options.projectId}`);
  for (const item of plan) console.log(`  folioCatalog/${item.id}: ${item.chapters} chapters, ${item.bytes.toLocaleString('en-US')} estimated bytes`);
  if (!options.apply) {
    console.log('No SDK loaded, credentials accessed, or remote data changed. Add --apply to execute this plan.');
    return;
  }

  let admin;
  let firestore;
  try {
    [admin, firestore] = await Promise.all([import('firebase-admin/app'), import('firebase-admin/firestore')]);
  } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND') {
      throw new Error('Optional dependency missing. Install it with: npm install --no-save --package-lock=false firebase-admin');
    }
    throw error;
  }
  // Explicit project selection avoids silently writing to an unrelated ADC default project.
  const app = admin.initializeApp({ projectId: options.projectId, credential: admin.applicationDefault() }, 'folio-catalog-seed');
  try {
    const db = firestore.getFirestore(app);
    let batch = db.batch();
    let count = 0;
    let batchBytes = 0;
    const commit = async () => {
      if (!count) return;
      await batch.commit();
      batch = db.batch();
      count = 0;
      batchBytes = 0;
    };
    for (const item of plan) {
      const upperBound = item.bytes + DOCUMENT_HEADROOM;
      if (count >= 400 || batchBytes + upperBound > MAX_BATCH_BYTES) await commit();
      batch.set(db.collection('folioCatalog').doc(item.id), {
        ...item.data, updatedAt: firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      count += 1;
      batchBytes += upperBound;
    }
    await commit();
    console.log(`Published ${plan.length} catalog books. Existing unrelated documents and user libraries were preserved.`);
  } finally {
    await admin.deleteApp(app);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`Catalog seed failed: ${error.message}`);
    process.exitCode = 1;
  });
}
