#!/usr/bin/env node
/** Prepare a reviewed rules source; this script never authenticates or deploys. */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const BEGIN = '    // FOLIO PUBLICATIONS BEGIN: merge this block into the active shared policy.';
const END = '    // FOLIO PUBLICATIONS END';
const USAGE = 'Usage: node scripts/prepare-publication-rules.mjs [--replace --expect-old-sha256 HASH] --active ACTIVE.rules --output MERGED.rules';

/** Hash of a block with CRLF line endings read as LF, so a reviewed hash matches either checkout style. */
export const blockSha256 = block => createHash('sha256').update(block.replaceAll('\r\n', '\n'), 'utf8').digest('hex');

/** The repository block with LF endings, whatever the checkout used; callers convert it to the policy's style. */
function folioBlock(folio) {
  if (typeof folio !== 'string') throw new TypeError('Rules source must be text.');
  const begin = folio.indexOf(BEGIN);
  const end = folio.indexOf(END, begin) + END.length;
  if (begin < 0 || end < END.length || folio.indexOf(BEGIN, begin + BEGIN.length) !== -1) throw new Error('Expected one Folio publications block.');
  return folio.slice(begin, end).replaceAll('\r\n', '\n');
}

function occurrences(text, marker) {
  const found = [];
  for (let index = text.indexOf(marker); index !== -1; index = text.indexOf(marker, index + 1)) found.push(index);
  return found;
}

export function addPublicationRules(active, folio) {
  if (typeof active !== 'string' || typeof folio !== 'string') throw new TypeError('Rules source must be text.');
  const folioRules = folioBlock(folio);
  if (active.includes('folioPublication') || active.includes('FOLIO PUBLICATIONS')) throw new Error('The active policy already has publication rules. Review that version, then prepare a replacement with --replace.');
  const roots = [...active.matchAll(/match\s+\/databases\/\{[^}]+\}\/documents\s*\{/g)];
  if (roots.length !== 1 || !roots[0][0].includes('{database}')) throw new Error('Expected one default Firestore documents root using {database}.');
  const insertion = roots[0].index + roots[0][0].length;
  // The inserted lines follow the active policy's line endings.
  const eol = active.includes('\r\n') ? '\r\n' : '\n';
  const block = `\n${folioRules}\n`.replaceAll('\n', eol);
  const merged = active.slice(0, insertion) + block + active.slice(insertion);
  // Enforce byte-for-byte preservation of the policy around the one inserted block.
  if (merged.slice(0, insertion) + merged.slice(insertion + block.length) !== active) throw new Error('Existing rule preservation failed.');
  return { merged, insertion, addedBytes: Buffer.byteLength(block), previousBytes: Buffer.byteLength(active) };
}

/** Swap the one marked Folio block for the repository version; every byte outside it is preserved. */
export function replacePublicationRules(active, folio, expectedOldSha256) {
  if (typeof active !== 'string') throw new TypeError('Rules source must be text.');
  if (typeof expectedOldSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(expectedOldSha256)) throw new Error('Pass --expect-old-sha256 with the reviewed SHA-256 of the active Folio block.');
  const block = folioBlock(folio);
  const begins = occurrences(active, BEGIN);
  const ends = occurrences(active, END);
  if (begins.length !== 1 || ends.length !== 1 || ends[0] < begins[0]) throw new Error('Expected exactly one marked Folio publications block in the active policy.');
  const begin = begins[0];
  const oldEnd = ends[0] + END.length;
  if (begin > 0 && active[begin - 1] !== '\n') throw new Error('The Folio BEGIN marker must start its own line.');
  if (oldEnd < active.length && active[oldEnd] !== '\n' && active.slice(oldEnd, oldEnd + 2) !== '\r\n') throw new Error('The Folio END marker must end its own line.');
  const old = active.slice(begin, oldEnd);
  const crlf = old.includes('\r\n');
  if (crlf ? /\r(?!\n)|(?<!\r)\n/.test(old) : old.includes('\r')) throw new Error('The active Folio block mixes line endings.');
  const oldSha256 = blockSha256(old);
  if (oldSha256 !== expectedOldSha256) {
    throw new Error(`The active Folio block has SHA-256 ${oldSha256}, not the reviewed ${expectedOldSha256}. Someone may have edited it; compare it with the repository history before replacing it.`);
  }
  const outside = `${active.slice(0, begin)}\n${active.slice(oldEnd)}`;
  if (/folioPublication|FOLIO PUBLICATIONS/.test(outside)) throw new Error('Folio publication names or markers appear outside the marked block.');
  for (const [, name] of block.matchAll(/\bfunction\s+([A-Za-z_]\w*)\s*\(/g)) {
    if (new RegExp(`\\bfunction\\s+${name}\\s*\\(`).test(outside)) throw new Error(`Function ${name} is already defined outside the Folio block.`);
  }
  const replacement = crlf ? block.replaceAll('\n', '\r\n') : block;
  const merged = active.slice(0, begin) + replacement + active.slice(oldEnd);
  // Prove that the text and its UTF-8 bytes before and after the block are untouched.
  const before = Buffer.from(active.slice(0, begin));
  const after = Buffer.from(active.slice(oldEnd));
  const output = Buffer.from(merged);
  if (merged.slice(0, begin) !== active.slice(0, begin) || merged.slice(begin + replacement.length) !== active.slice(oldEnd)
    || !output.subarray(0, before.length).equals(before) || !output.subarray(output.length - after.length).equals(after)) {
    throw new Error('Existing rule preservation failed.');
  }
  return { merged, begin, previousBytes: Buffer.byteLength(active), mergedBytes: output.length, oldBytes: Buffer.byteLength(old),
    newBytes: Buffer.byteLength(replacement), oldSha256, newSha256: blockSha256(block), lineEndings: crlf ? 'crlf' : 'lf' };
}

export async function main(args = process.argv.slice(2)) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (name === '--replace' && !options.replace) { options.replace = true; continue; }
    if (!['--active', '--output', '--expect-old-sha256'].includes(name) || !args[index + 1] || options[name]) throw new Error(USAGE);
    options[name] = args[index += 1];
  }
  if (!options['--active'] || !options['--output'] || resolve(options['--active']) === resolve(options['--output'])) throw new Error('Choose distinct --active and --output rule paths.');
  if (Boolean(options.replace) !== Boolean(options['--expect-old-sha256'])) throw new Error('--replace and --expect-old-sha256 must be used together.');
  const [activeBytes, folio] = await Promise.all([readFile(resolve(options['--active'])), readFile(new URL('../firestore.rules', import.meta.url), 'utf8')]);
  const active = activeBytes.toString('utf8');
  if (!Buffer.from(active).equals(activeBytes)) throw new Error('The active policy is not valid UTF-8 text.');
  const output = resolve(options['--output']);
  if (options.replace) {
    const { merged, ...report } = replacePublicationRules(active, folio, options['--expect-old-sha256'].toLowerCase());
    await writeFile(output, merged, { mode: 0o600, flag: 'wx' });
    console.log(JSON.stringify({ mode: 'replace', output, ...report, preserved: true, deployed: false }));
    return;
  }
  const { merged, insertion, addedBytes, previousBytes } = addPublicationRules(active, folio);
  await writeFile(output, merged, { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ output, previousBytes, addedBytes, insertion, preserved: true, deployed: false }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(`Rules preparation failed: ${error.message}`); process.exitCode = 1; });
}
