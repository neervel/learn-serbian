import { fsrs, type Card as FsrsCard, type Grade } from 'ts-fsrs';
import type { SrsState } from './types.ts';

/** Same numeric values as ts-fsrs Rating. */
export const Rating = { Again: 1, Hard: 2, Good: 3, Easy: 4 } as const;
export type RatingValue = (typeof Rating)[keyof typeof Rating];

/** Same numeric values as ts-fsrs State. */
export const CardState = { New: 0, Learning: 1, Review: 2, Relearning: 3 } as const;

const PARAMS = { request_retention: 0.9, maximum_interval: 365, enable_fuzz: true };
const engine = fsrs(PARAMS);
// Same algorithm without the short (minutes) learning steps: a correct answer
// on a new card goes straight to an interval of a couple of days.
const directEngine = fsrs({ ...PARAMS, learning_steps: [] });

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

/** Days until a word the user marked as already known is checked for the first time. */
export const KNOWN_INTERVAL_DAYS = 60;

/** State of a card for a word the user already knows: in review, with a long interval. */
export function knownState(now: number): SrsState {
  return {
    due: now + KNOWN_INTERVAL_DAYS * 24 * 60 * 60 * 1000,
    stability: KNOWN_INTERVAL_DAYS,
    difficulty: 3,
    state: CardState.Review,
    reps: 1,
    lapses: 0,
    scheduled_days: KNOWN_INTERVAL_DAYS,
    learning_steps: 0,
    last_review: now,
  };
}

/**
 * Applies an answer to a card and returns its new spaced-repetition state.
 * With `skipLearningSteps` a card that would enter the minutes-long learning
 * steps is scheduled in days right away.
 */
export function schedule(
  current: SrsState,
  rating: RatingValue,
  now: number,
  opts: { skipLearningSteps?: boolean } = {},
): SrsState {
  const fsrsEngine = opts.skipLearningSteps ? directEngine : engine;
  const result = fsrsEngine.next(toFsrs(current), new Date(now), rating as Grade);
  return fromFsrs(result.card);
}
