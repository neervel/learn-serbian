import { openDb, type Db } from '../src/db/db.ts';
import { getOrCreateUser, upsertWord } from '../src/db/repo.ts';
import type { User, WordEntry } from '../src/types.ts';

/** 2026-03-10 12:00 in Belgrade (11:00 UTC), far from midnight and DST switches. */
export const NOON = Date.UTC(2026, 2, 10, 11, 0, 0);
export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;

export function word(n: number, extra: Partial<WordEntry> = {}): WordEntry {
  return { id: `w${n}`, lat: `rec${n}`, cyr: `реч${n}`, ru: `слово${n}`, pos: 'noun', gender: 'f', rank: n, ...extra };
}

export function makeDb(wordCount = 0): Db {
  const db = openDb(':memory:');
  for (let n = 1; n <= wordCount; n++) upsertWord(db, word(n));
  return db;
}

export function makeUser(db: Db, tgId = 1000, now = NOON): User {
  return getOrCreateUser(db, tgId, now).user;
}
