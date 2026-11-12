import { fsrs, type Card as FsrsCard, type Grade } from 'ts-fsrs';
import type { SrsState } from '../types.ts';

/** Same numeric values as ts-fsrs Rating. */
export const Rating = { Again: 1, Hard: 2, Good: 3, Easy: 4 } as const;
export type RatingValue = (typeof Rating)[keyof typeof Rating];

/** Same numeric values as ts-fsrs State. */
export const CardState = { New: 0, Learning: 1, Review: 2, Relearning: 3 } as const;

const engine = fsrs({ request_retention: 0.9, maximum_interval: 365, enable_fuzz: true });

function toFsrs(s: SrsState): FsrsCard {
  return {
    due: new Date(s.due),
    stability: s.stability,
    difficulty: s.difficulty,
    scheduled_days: s.scheduled_days,
    learning_steps: s.learning_steps,
    reps: s.reps,
    lapses: s.lapses,
    state: s.state as FsrsCard['state'],
    last_review: s.last_review === null ? undefined : new Date(s.last_review),
  };
}

function fromFsrs(c: FsrsCard): SrsState {
  return {
    due: c.due.getTime(),
    stability: c.stability,
    difficulty: c.difficulty,
    state: c.state,
    reps: c.reps,
    lapses: c.lapses,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    last_review: c.last_review ? c.last_review.getTime() : null,
  };
}

/** Applies an answer to a card and returns its new spaced-repetition state. */
export function schedule(current: SrsState, rating: RatingValue, now: number): SrsState {
  const result = engine.next(toFsrs(current), new Date(now), rating as Grade);
  return fromFsrs(result.card);
}
