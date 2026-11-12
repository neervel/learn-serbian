import type { Db } from '../db/db.ts';
import { DAY_MS, localDate, startOfLocalDay } from '../time.ts';
import type { Card, User, Word } from '../types.ts';

export type NextItem =
  | { kind: 'review'; card: Card; word: Word }
  | { kind: 'new'; word: Word }
  | { kind: 'done'; nextDueAt: number | null };

interface CardWithWord {
  card: Card;
  word: Word;
}

function loadCardWithWord(db: Db, card: Card | undefined): CardWithWord | undefined {
  if (!card) return undefined;
  const word = db.prepare('SELECT * FROM words WHERE id = ?').get(card.word_id) as unknown as Word | undefined;
  return word ? { card, word } : undefined;
}

/** New words started today. */
export function newIntroducedToday(db: Db, user: User, now: number): number {
  const dayStart = startOfLocalDay(now, user.tz);
  const r = db
    .prepare(
      "SELECT COUNT(*) AS n FROM cards WHERE user_id = ? AND direction = 'sr-ru' AND created_at >= ?",
    )
    .get(user.id, dayStart) as { n: number };
  return r.n;
}

/** Today's limit on new words: the daily setting plus any extra lessons asked for today. */
export function dailyLimit(db: Db, user: User, now: number): number {
  const r = db
    .prepare('SELECT count FROM extra_new WHERE user_id = ? AND day = ?')
    .get(user.id, localDate(now, user.tz)) as { count: number } | undefined;
  return user.new_per_day + (r?.count ?? 0);
}

/** Raises today's limit so that `count` more new words can be started right now. */
export function addExtraLesson(db: Db, user: User, now: number, count: number): void {
  // Unused allowance is not carried into the extra lesson: it always adds
  // exactly `count` words on top of what has been started today.
  const target = Math.max(dailyLimit(db, user, now), newIntroducedToday(db, user, now)) + count;
  db.prepare(
    `INSERT INTO extra_new (user_id, day, count) VALUES (?, ?, ?)
     ON CONFLICT (user_id, day) DO UPDATE SET count = excluded.count`,
  ).run(user.id, localDate(now, user.tz), target - user.new_per_day);
}

function nextNewWord(db: Db, userId: number): Word | undefined {
  return db
    .prepare(
      `SELECT w.* FROM words w
       WHERE w.active = 1
         AND NOT EXISTS (SELECT 1 FROM cards c
                         WHERE c.user_id = ? AND c.word_id = w.id AND c.direction = 'sr-ru')
       ORDER BY w.rank, w.id LIMIT 1`,
    )
    .get(userId) as unknown as Word | undefined;
}

/** Words in the dictionary the user has not started yet. */
export function remainingNewWords(db: Db, userId: number): number {
  const r = db
    .prepare(
      `SELECT COUNT(*) AS n FROM words w
       WHERE w.active = 1
         AND NOT EXISTS (SELECT 1 FROM cards c
                         WHERE c.user_id = ? AND c.word_id = w.id AND c.direction = 'sr-ru')`,
    )
    .get(userId) as { n: number };
  return r.n;
}

/** How many new words the user can still start today. */
export function newAvailable(db: Db, user: User, now: number): number {
  const left = Math.max(0, dailyLimit(db, user, now) - newIntroducedToday(db, user, now));
  return Math.min(left, remainingNewWords(db, user.id));
}

export function dueCount(db: Db, userId: number, until: number): number {
  const r = db.prepare('SELECT COUNT(*) AS n FROM cards WHERE user_id = ? AND due <= ?').get(userId, until) as {
    n: number;
  };
  return r.n;
}

/**
 * What to show next. Order:
 *  1. cards that are due now (oldest first);
 *  2. a new word, while under today's limit;
 *  3. cards still in the learning steps that come due later today — shown
 *     early so a session can be finished in one sitting. The card that was just
 *     answered goes last so it isn't repeated back-to-back when avoidable.
 */
export function nextItem(db: Db, user: User, now: number, justAnsweredCardId?: number): NextItem {
  const due = loadCardWithWord(
    db,
    db
      .prepare('SELECT * FROM cards WHERE user_id = ? AND due <= ? ORDER BY due, id LIMIT 1')
      .get(user.id, now) as unknown as Card | undefined,
  );
  if (due) return { kind: 'review', ...due };

  if (newIntroducedToday(db, user, now) < dailyLimit(db, user, now)) {
    const word = nextNewWord(db, user.id);
    if (word) return { kind: 'new', word };
  }

  const ahead = loadCardWithWord(
    db,
    db
      .prepare(
        `SELECT * FROM cards
         WHERE user_id = ? AND state IN (1, 3) AND due <= ?
         ORDER BY (id = ?), due, id LIMIT 1`,
      )
      .get(user.id, now + DAY_MS, justAnsweredCardId ?? -1) as unknown as Card | undefined,
  );
  if (ahead) return { kind: 'review', ...ahead };

  const next = db.prepare('SELECT MIN(due) AS due FROM cards WHERE user_id = ?').get(user.id) as {
    due: number | null;
  };
  return { kind: 'done', nextDueAt: next.due };
}
