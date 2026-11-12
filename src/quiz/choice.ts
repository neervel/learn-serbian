import type { Db } from '../db/db.ts';
import type { Word } from '../types.ts';

const POOL_SIZE = 12;
const OPTIONS = 4;

function shuffle<T>(items: T[], random: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/**
 * Picks the answer options for a multiple-choice question: the word itself plus
 * up to three distractors of the same part of speech and similar frequency.
 * Distractors never share a translation or spelling with the answer or each other.
 */
export function buildOptions(db: Db, word: Word, random: () => number = Math.random): Word[] {
  const samePos = db
    .prepare(
      `SELECT * FROM words WHERE active = 1 AND id != ? AND pos = ?
       ORDER BY ABS(rank - ?), id LIMIT ?`,
    )
    .all(word.id, word.pos, word.rank, POOL_SIZE) as unknown as Word[];
  const anyPos = db
    .prepare(
      `SELECT * FROM words WHERE active = 1 AND id != ? AND pos != ?
       ORDER BY ABS(rank - ?), id LIMIT ?`,
    )
    .all(word.id, word.pos, word.rank, POOL_SIZE) as unknown as Word[];

  const chosen: Word[] = [word];
  const clashes = (w: Word) => chosen.some((c) => c.ru === w.ru || c.lat === w.lat);
  for (const candidate of [...shuffle(samePos, random), ...shuffle(anyPos, random)]) {
    if (chosen.length >= OPTIONS) break;
    if (!clashes(candidate)) chosen.push(candidate);
  }
  return shuffle(chosen, random);
}
