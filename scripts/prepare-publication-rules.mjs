#!/usr/bin/env node
/** Prepare a strictly additive source; this script never authenticates or deploys. */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const BEGIN = '    // FOLIO PUBLICATIONS BEGIN: merge this block into the active shared policy.';
const END = '    // FOLIO PUBLICATIONS END';

export function addPublicationRules(active, folio) {
  if (typeof active !== 'string' || typeof folio !== 'string') throw new TypeError('Rules source must be text.');
  const begin = folio.indexOf(BEGIN);
  const end = folio.indexOf(END, begin) + END.length;
  if (begin < 0 || end < END.length || folio.indexOf(BEGIN, begin + BEGIN.length) !== -1) throw new Error('Expected one Folio publications block.');
  if (active.includes('folioPublication') || active.includes('FOLIO PUBLICATIONS')) throw new Error('The active policy already has publication rules. Review that version before preparing a replacement.');
  const roots = [...active.matchAll(/match\s+\/databases\/\{[^}]+\}\/documents\s*\{/g)];
  if (roots.length !== 1 || !roots[0][0].includes('{database}')) throw new Error('Expected one default Firestore documents root using {database}.');
  const insertion = roots[0].index + roots[0][0].length;
  const block = `\n${folio.slice(begin, end)}\n`;
  const merged = active.slice(0, insertion) + block + active.slice(insertion);
  // Enforce byte-for-byte preservation of the policy around the one inserted block.
  if (merged.slice(0, insertion) + merged.slice(insertion + block.length) !== active) throw new Error('Existing rule preservation failed.');
  return { merged, insertion, addedBytes: Buffer.byteLength(block), previousBytes: Buffer.byteLength(active) };
}

export async function main(args = process.argv.slice(2)) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    if (!['--active', '--output'].includes(name) || !args[index + 1] || options[name]) throw new Error('Usage: node scripts/prepare-publication-rules.mjs --active ACTIVE.rules --output MERGED.rules');
    options[name] = resolve(args[index + 1]);
  }
  if (!options['--active'] || !options['--output'] || options['--active'] === options['--output']) throw new Error('Choose distinct --active and --output rule paths.');
  const [active, folio] = await Promise.all([readFile(options['--active'], 'utf8'), readFile(new URL('../firestore.rules', import.meta.url), 'utf8')]);
  const { merged, insertion, addedBytes, previousBytes } = addPublicationRules(active, folio);
  await writeFile(options['--output'], merged, { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ output: options['--output'], previousBytes, addedBytes, insertion, preserved: true, deployed: false }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(`Rules preparation failed: ${error.message}`); process.exitCode = 1; });
}
