import { transaction, type Db } from './db/db.ts';
import { createCard, getCard, getWord, insertReview, saveSrsState } from './db/repo.ts';
import { Rating, schedule, type RatingValue } from './srs/scheduler.ts';
import type { Card, Exercise, User, Word } from './types.ts';

function applyReview(
  db: Db,
  card: Card,
  rating: RatingValue,
  now: number,
  review: { exercise: Exercise; answer: string | null; correct: boolean; elapsedMs: number | null },
): void {
  saveSrsState(db, card.id, schedule(card, rating, now));
  insertReview(db, {
    card_id: card.id,
    user_id: card.user_id,
    ts: now,
    rating,
    exercise: review.exercise,
    answer: review.answer,
    correct: review.correct,
    elapsed_ms: review.elapsedMs,
  });
}

/** Puts a new word into the user's deck; it is due immediately. */
export function startLearning(db: Db, user: User, wordId: string, now: number): Card | undefined {
  if (!getWord(db, wordId)) return undefined;
  return createCard(db, user.id, wordId, 'sr-ru', now);
}

/** Marks "don't know" in the answer buttons. */
export const DONT_KNOW = '-';

export type ChoiceOutcome =
  | { status: 'stale' }
  | { status: 'answered'; correct: boolean; word: Word; chosen: Word | undefined; card: Card };

/**
 * Records an answer to a multiple-choice question (`DONT_KNOW` counts as wrong). `expectedReps` is the card's
 * review count when the question was sent; if it no longer matches, the button
 * belongs to a question that was already answered and is ignored.
 */
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
    const card = getCard(db, cardId);
    if (!card || card.user_id !== user.id || card.reps !== expectedReps) return { status: 'stale' };
    const word = getWord(db, card.word_id);
    if (!word) return { status: 'stale' };
    const correct = chosenWordId === card.word_id;
    // A new word guessed on first sight skips the short learning steps (Easy)
    // and comes back in days; otherwise a plain right/wrong.
    const rating = !correct ? Rating.Again : card.reps === 0 ? Rating.Easy : Rating.Good;
    applyReview(db, card, rating, now, {
      exercise: 'choice',
      answer: chosenWordId,
      correct,
      elapsedMs,
    });
    return { status: 'answered', correct, word, chosen: getWord(db, chosenWordId), card };
  });
}
