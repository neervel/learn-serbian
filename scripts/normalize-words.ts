// Fills in the mechanical fields of content/words/*.json so that new entries
// can be written with just lat / ru / pos / grammar / example:
//   id    ASCII slug of the Latin form (never changed once set — progress is keyed by it)
//   cyr   Cyrillic form generated from Latin (proofread it: lj/nj/dž can be ambiguous)
//   rank  learning order; new entries continue after the highest existing rank
// Rewrites the files with one entry per line.
//
// Usage: node scripts/normalize-words.ts

import { writeFileSync } from 'node:fs';
import { listWordFiles, readWordFile, validateWords } from '../src/content.ts';
import { latToCyr } from '../src/text/translit.ts';
import type { WordEntry } from '../src/types.ts';

const FIELD_ORDER: (keyof WordEntry)[] = [
  'id', 'lat', 'cyr', 'ru', 'pos', 'rank', 'gender', 'pres1sg', 'aspect', 'pair',
  'tags', 'falseFriend', 'note', 'example',
];

function slug(lat: string): string {
  return lat
    .toLowerCase()
    .replace(/[čć]/g, 'c')
    .replace(/š/g, 's')
    .replace(/ž/g, 'z')
    .replace(/đ/g, 'dj')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const files = listWordFiles().map((path) => ({ path, entries: readWordFile(path) }));
const all = files.flatMap((f) => f.entries);

const ids = new Set(all.map((w) => w.id).filter((id): id is string => !!id));
let nextRank = Math.max(0, ...all.map((w) => w.rank ?? 0)) + 1;
let filled = 0;

for (const w of all) {
  if (!w.lat) continue; // reported by validation below
  if (!w.id) {
    let id = slug(w.lat);
    if (ids.has(id)) id = `${id}-${w.pos}`;
    for (let n = 2; ids.has(id); n++) id = `${slug(w.lat)}-${w.pos}-${n}`;
    ids.add(id);
    w.id = id;
    filled++;
  }
  if (!w.cyr) {
    w.cyr = latToCyr(w.lat);
    filled++;
  }
  if (w.rank === undefined) {
    w.rank = nextRank++;
    filled++;
  }
}

for (const { path, entries } of files) {
  const lines = entries.map((w) => {
    const ordered: Record<string, unknown> = {};
    for (const key of FIELD_ORDER) if (w[key] !== undefined) ordered[key] = w[key];
    for (const [key, value] of Object.entries(w)) if (!(key in ordered)) ordered[key] = value;
    return JSON.stringify(ordered);
  });
  writeFileSync(path, `[\n${lines.join(',\n')}\n]\n`);
}

console.log(`${all.length} words in ${files.length} file(s), ${filled} field(s) filled in`);
const problems = validateWords(all);
if (problems.length > 0) {
  console.error(`${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
  process.exitCode = 1;
}
