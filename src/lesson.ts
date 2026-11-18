// A lesson: which words go into it, in what order they are asked, and what an
// answer does to the word's card.

import { transaction, type Db } from './db/db.ts';
import {
  clearPending,
  createCard,
  findCard,
  getCard,
  getWord,
  insertReview,
  saveSrsState,
} from './db/repo.ts';
import { knownState, Rating, schedule, type RatingValue } from './scheduler.ts';
import type { Card, Exercise, SrsState, User, Word } from './types.ts';

/** Share of a lesson given to words the user has not seen yet. */
export const NEW_SHARE = 0.3;

/** Word ids picked for a lesson. */
export interface LessonPlan {
  reviews: string[];
  fresh: string[];
}

/**
 * A card is up for review when its time has come or when it is in the learning
 * steps (states 1 and 3: missed minutes ago). The latter count even if their
 * minute has not passed, so a word missed in one lesson is in the next one for sure.
 */
const TO_REVIEW = '(due <= ? OR state IN (1, 3))';

/** Cards to review by `until`, counted the same way a lesson picks them. */
export function dueCount(db: Db, userId: number, until: number): number {
  const r = db
    .prepare(`SELECT COUNT(*) AS n FROM cards WHERE user_id = ? AND ${TO_REVIEW}`)
    .get(userId, until) as { n: number };
  return r.n;
}

export function answeredSince(db: Db, userId: number, since: number): boolean {
  return db.prepare('SELECT 1 FROM reviews WHERE user_id = ? AND ts >= ? LIMIT 1').get(userId, since) !== undefined;
}

/** Cards to review, the ones added to the deck earliest first. */
function dueWordIds(db: Db, userId: number, now: number, limit: number): string[] {
  const rows = db
    .prepare(
      `SELECT word_id FROM cards
       WHERE user_id = ? AND direction = 'sr-ru' AND ${TO_REVIEW}
       ORDER BY created_at, id LIMIT ?`,
    )
    .all(userId, now, limit) as unknown as { word_id: string }[];
  return rows.map((r) => r.word_id);
}

function newWordIds(db: Db, userId: number, limit: number): string[] {
  const rows = db
    .prepare(
      `SELECT w.id FROM words w
       WHERE w.active = 1
         AND NOT EXISTS (SELECT 1 FROM cards c
                         WHERE c.user_id = ? AND c.word_id = w.id AND c.direction = 'sr-ru')
       ORDER BY w.rank, w.id LIMIT ?`,
    )
    .all(userId, limit) as unknown as { id: string }[];
  return rows.map((r) => r.id);
}

/**
 * Picks the words for a lesson of `user.lesson_size`: NEW_SHARE of it is new
 * words, the rest are due cards, earliest added first. When one kind runs
 * short, the other fills the gap.
 */
export function planLesson(db: Db, user: User, now: number): LessonPlan {
  const size = user.lesson_size;
  const due = dueWordIds(db, user.id, now, size);
  const freshWanted = Math.max(Math.round(size * NEW_SHARE), size - due.length);
  const fresh = newWordIds(db, user.id, freshWanted);
  return { reviews: due.slice(0, size - fresh.length), fresh };
}

/** Reviews with the new words spread evenly among them. */
function interleave(reviews: string[], fresh: string[]): string[] {
  const total = reviews.length + fresh.length;
  const out: string[] = [];
  let r = 0;
  let f = 0;
  for (let i = 0; i < total; i++) {
    const freshIsBehind = f < fresh.length && (f + 1) * total <= (i + 1) * fresh.length;
    if (freshIsBehind || r >= reviews.length) out.push(fresh[f++]!);
    else out.push(reviews[r++]!);
  }
  return out;
}

/** Replaces the user's current lesson with a new one. Returns the number of words in it. */
export function startLesson(db: Db, user: User, now: number): number {
  return transaction(db, () => {
    clearLesson(db, user.id);
    const plan = planLesson(db, user, now);
    const insert = db.prepare('INSERT INTO lesson_items (user_id, pos, word_id) VALUES (?, ?, ?)');
    const ids = interleave(plan.reviews, plan.fresh);
    ids.forEach((id, pos) => insert.run(user.id, pos, id));
    return ids.length;
  });
}

/** Drops the lesson together with the question the user is looking at. */
export function clearLesson(db: Db, userId: number): void {
  db.prepare('DELETE FROM lesson_items WHERE user_id = ?').run(userId);
  clearPending(db, userId);
}

export function lessonLeft(db: Db, userId: number): number {
  const r = db.prepare('SELECT COUNT(*) AS n FROM lesson_items WHERE user_id = ?').get(userId) as { n: number };
  return r.n;
}

/**
 * The next word of the lesson. A new word gets its card here, at the moment
 * it is first asked, so words of an abandoned lesson stay new.
 */
export function nextInLesson(db: Db, user: User, now: number): { word: Word; card: Card } | undefined {
  for (;;) {
    const row = db
      .prepare('SELECT pos, word_id FROM lesson_items WHERE user_id = ? ORDER BY pos LIMIT 1')
      .get(user.id) as { pos: number; word_id: string } | undefined;
    if (!row) return undefined;
    const word = getWord(db, row.word_id);
    if (word) {
      const card = findCard(db, user.id, word.id, 'sr-ru') ?? createCard(db, user.id, word.id, 'sr-ru', now);
      return { word, card };
    }
    db.prepare('DELETE FROM lesson_items WHERE user_id = ? AND pos = ?').run(user.id, row.pos);
  }
}

/**
 * A word answered correctly leaves the lesson; a missed one goes to its end
 * and is asked again. A missed word that is the last one left also leaves, so
 * it is never asked twice in a row: it stays due and opens the next lesson.
 */
function recordLessonAnswer(db: Db, userId: number, wordId: string, correct: boolean): void {
  const others = db
    .prepare('SELECT COUNT(*) AS n FROM lesson_items WHERE user_id = ? AND word_id != ?')
    .get(userId, wordId) as { n: number };
  if (correct || others.n === 0) {
    db.prepare('DELETE FROM lesson_items WHERE user_id = ? AND word_id = ?').run(userId, wordId);
    return;
  }
  db.prepare(
    `UPDATE lesson_items
     SET pos = (SELECT MAX(pos) + 1 FROM lesson_items WHERE user_id = ?)
     WHERE user_id = ? AND word_id = ?`,
  ).run(userId, userId, wordId);
}

/** Marks "don't know" in the answer buttons. */
export const DONT_KNOW = '-';

/**
 * The card a button press refers to. `expectedReps` is the card's review count
 * when the question was sent; if it no longer matches, the press belongs to a
 * question that was already answered and is ignored.
 */
function askedCard(db: Db, user: User, cardId: number, expectedReps: number): { card: Card; word: Word } | undefined {
  const card = getCard(db, cardId);
  if (!card || card.user_id !== user.id || card.reps !== expectedReps) return undefined;
  const word = getWord(db, card.word_id);
  return word ? { card, word } : undefined;
}

function saveAnswer(
  db: Db,
  card: Card,
  now: number,
  a: { state: SrsState; rating: RatingValue; exercise: Exercise; answer: string | null; correct: boolean; elapsedMs: number | null },
): void {
  saveSrsState(db, card.id, a.state);
  insertReview(db, {
    card_id: card.id,
    user_id: card.user_id,
    ts: now,
    rating: a.rating,
    exercise: a.exercise,
    answer: a.answer,
    correct: a.correct,
    elapsed_ms: a.elapsedMs,
  });
  recordLessonAnswer(db, card.user_id, card.word_id, a.correct);
}

export type ChoiceOutcome =
  | { status: 'stale' }
  | { status: 'answered'; correct: boolean; word: Word; chosen: Word | undefined };

/** Records an answer to a multiple-choice question; `DONT_KNOW` counts as wrong. */
export function answerChoice(
  db: Db,
  user: User,
  cardId: number,
  expectedReps: number,
  chosenWordId: string,
  now: number,
  elapsedMs: number | null,
): ChoiceOutcome {
  return transaction(db, (): ChoiceOutcome => {
    const asked = askedCard(db, user, cardId, expectedReps);
    if (!asked) return { status: 'stale' };
    const { card, word } = asked;
    const correct = chosenWordId === word.id;
    const rating = correct ? Rating.Good : Rating.Again;
    // A new word guessed on first sight skips the minutes-long learning steps
    // and comes back in a couple of days; a missed one goes through them.
    const state = schedule(card, rating, now, { skipLearningSteps: correct && card.reps === 0 });
    saveAnswer(db, card, now, { state, rating, exercise: 'choice', answer: chosenWordId, correct, elapsedMs });
    return { status: 'answered', correct, word, chosen: getWord(db, chosenWordId) };
  });
}

export type KnownOutcome = { status: 'stale' } | { status: 'known'; word: Word };

/**
 * "I already know this word" on a new word: the card goes straight to a long
 * review interval and counts as learned. Only works before the first answer.
 */
export function markKnown(db: Db, user: User, cardId: number, now: number): KnownOutcome {
  return transaction(db, (): KnownOutcome => {
    const asked = askedCard(db, user, cardId, 0);
    if (!asked) return { status: 'stale' };
    saveAnswer(db, asked.card, now, {
      state: knownState(now),
      rating: Rating.Easy,
      exercise: 'known',
      answer: null,
      correct: true,
      elapsedMs: null,
    });
    return { status: 'known', word: asked.word };
  });
}
