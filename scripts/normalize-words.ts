// Fills in the mechanical fields of content/words/*.json so that new entries
// can be written with just lat / ru / pos / grammar / example:
//   id    ASCII slug of the Latin form (never changed once set — progress is keyed by it)
//   cyr   Cyrillic form generated from Latin (proofread it: lj/nj/dž can be ambiguous)
//   rank  learning order; new entries continue after the highest existing rank
// Rewrites the files with one entry per line.
//
// Usage: node scripts/normalize-words.ts

import { listWordFiles, readWordFile, reportProblems, writeWordFile } from '../src/content.ts';
import { latToCyr } from '../src/translit.ts';

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

for (const { path, entries } of files) writeWordFile(path, entries);

console.log(`${all.length} words in ${files.length} file(s), ${filled} field(s) filled in`);
reportProblems(all);
