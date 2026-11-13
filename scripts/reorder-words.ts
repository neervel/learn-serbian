// Reassigns `rank` (the learning order) in content/words/*.json so that every
// lesson is a mix of parts of speech instead of a run of pronouns or
// prepositions. Within each group the existing order is kept.
//
// Each group is spread evenly over a share of the whole list: function words
// are needed early, so they are packed into the first 40%; nouns run the full
// length. Words already being learned are not affected — rank only decides
// which new word comes next.
//
// Usage: node scripts/reorder-words.ts   (then: npm run import-words)

import { writeFileSync } from 'node:fs';
import { listWordFiles, readWordFile, validateWords } from '../src/content.ts';
import type { WordEntry } from '../src/types.ts';

/** Share of the list over which a group is spread (1 = evenly to the very end). */
const SPREAD: Record<string, number> = { noun: 1, adj: 0.9, verb: 0.8, adv: 0.6, function: 0.4 };

function group(pos: string): string {
  return pos in SPREAD ? pos : 'function'; // pron, prep, conj, part, num, intj, phrase
}

const files = listWordFiles().map((path) => ({ path, entries: readWordFile(path) as WordEntry[] }));
const all = files.flatMap((f) => f.entries).sort((a, b) => a.rank - b.rank);

const groups = new Map<string, WordEntry[]>();
for (const w of all) {
  const g = group(w.pos);
  groups.set(g, [...(groups.get(g) ?? []), w]);
}

const placed: { word: WordEntry; position: number }[] = [];
for (const [g, words] of groups) {
  words.forEach((word, i) => placed.push({ word, position: ((i + 0.5) / words.length) * SPREAD[g]! }));
}
placed.sort((a, b) => a.position - b.position || a.word.rank - b.word.rank);
placed.forEach((p, i) => {
  p.word.rank = i + 1;
});

for (const { path, entries } of files) {
  writeFileSync(path, `[\n${entries.map((w) => JSON.stringify(w)).join(',\n')}\n]\n`);
}

const problems = validateWords(all);
if (problems.length > 0) {
  console.error(`${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
  process.exitCode = 1;
}
const ordered = placed.map((p) => p.word);
console.log(`${ordered.length} words reordered. First lessons:`);
for (let i = 0; i < 40; i += 10) {
  console.log(`  ${i + 1}-${i + 10}: ${ordered.slice(i, i + 10).map((w) => w.lat).join(', ')}`);
}
