import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WordEntry } from './types.ts';

export const WORDS_DIR = new URL('../content/words/', import.meta.url).pathname;

const POS = new Set(['noun', 'verb', 'adj', 'adv', 'pron', 'prep', 'conj', 'num', 'part', 'intj', 'phrase']);
const GENDERS = new Set(['m', 'f', 'n']);
const ASPECTS = new Set(['impf', 'pf', 'both']);
// Ids go into Telegram callback data, which is limited to 64 bytes in total.
const ID = /^[a-z0-9-]{1,40}$/;
const LATIN = /^[a-zA-ZčćžšđČĆŽŠĐ ]+$/;
const CYRILLIC = /^[а-шА-ШђјљњћџЂЈЉЊЋЏ ]+$/;

export function listWordFiles(dir: string = WORDS_DIR): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => join(dir, f));
}

export function readWordFile(path: string): Partial<WordEntry>[] {
  const data: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(data)) throw new Error(`${path}: expected a JSON array`);
  return data as Partial<WordEntry>[];
}

/** Returns a list of problems; empty means the entries are ready to import. */
export function validateWords(entries: Partial<WordEntry>[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const ranks = new Set<number>();
  entries.forEach((w, i) => {
    const where = `#${i + 1} (${w.lat ?? w.id ?? '?'})`;
    const bad = (msg: string) => problems.push(`${where}: ${msg}`);
    if (!w.id || !ID.test(w.id)) bad('id is missing or not [a-z0-9-]{1,40} — run "npm run normalize-words"');
    else if (ids.has(w.id)) bad(`duplicate id "${w.id}"`);
    else ids.add(w.id);
    if (!w.lat || !LATIN.test(w.lat)) bad('lat is missing or has non-Latin characters');
    if (!w.cyr || !CYRILLIC.test(w.cyr)) bad('cyr is missing or has non-Cyrillic characters');
    if (!w.ru?.trim()) bad('ru is missing');
    if (!w.pos || !POS.has(w.pos)) bad(`unknown pos "${w.pos}"`);
    if (typeof w.rank !== 'number' || !Number.isInteger(w.rank) || w.rank < 1) bad('rank must be a positive integer');
    else if (ranks.has(w.rank)) bad(`duplicate rank ${w.rank}`);
    else ranks.add(w.rank);
    if (w.gender !== undefined && !GENDERS.has(w.gender)) bad(`unknown gender "${w.gender}"`);
    if (w.aspect !== undefined && !ASPECTS.has(w.aspect)) bad(`unknown aspect "${w.aspect}"`);
    if (w.pos === 'noun' && !w.gender) bad('noun without gender');
    if (w.falseFriend && !w.note) bad('false friend without a note explaining it');
    if (w.example && (!w.example.sr?.trim() || !w.example.ru?.trim())) bad('example needs both sr and ru');
  });
  return problems;
}

export function loadAllWords(dir: string = WORDS_DIR): WordEntry[] {
  const entries = listWordFiles(dir).flatMap(readWordFile);
  const problems = validateWords(entries);
  if (problems.length > 0) {
    throw new Error(`content/words has ${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
  }
  return entries as WordEntry[];
}
