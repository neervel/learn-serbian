import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCard, insertReview, saveSrsState } from '../src/db/repo.ts';
import { getStats, streak } from '../src/stats.ts';
import { DAY, HOUR, makeDb, makeUser, NOON } from './helpers.ts';

test('streak counts consecutive days ending today or yesterday', () => {
  assert.equal(streak(new Set(), '2026-03-10'), 0);
  assert.equal(streak(new Set(['2026-03-10']), '2026-03-10'), 1);
  assert.equal(streak(new Set(['2026-03-08', '2026-03-09', '2026-03-10']), '2026-03-10'), 3);
  assert.equal(streak(new Set(['2026-03-08', '2026-03-09']), '2026-03-10'), 2);
  assert.equal(streak(new Set(['2026-03-07', '2026-03-08']), '2026-03-10'), 0);
  assert.equal(streak(new Set(['2026-03-06', '2026-03-09', '2026-03-10']), '2026-03-10'), 2);
});

test('stats for a user with some history', () => {
  const db = makeDb(30);
  const user = makeUser(db);
  const review = (cardId: number, ts: number, correct: boolean, exercise: 'choice' | 'known' = 'choice') =>
    insertReview(db, { card_id: cardId, user_id: user.id, ts, rating: correct ? 3 : 1, exercise, answer: null, correct, elapsed_ms: 1000 });

  const learned = createCard(db, user.id, 'w1', 'sr-ru', NOON - 40 * DAY);
  saveSrsState(db, learned.id, { ...learned, state: 2, scheduled_days: 30, due: NOON + 20 * DAY, reps: 5 });
  const young = createCard(db, user.id, 'w2', 'sr-ru', NOON - 2 * DAY);
  saveSrsState(db, young.id, { ...young, state: 2, scheduled_days: 3, due: NOON - HOUR, reps: 2 });
  const learning = createCard(db, user.id, 'w3', 'sr-ru', NOON - HOUR);
  saveSrsState(db, learning.id, { ...learning, state: 1, due: NOON + 2 * HOUR, reps: 1 });

  review(young.id, NOON - 2 * DAY, true);
  review(young.id, NOON - DAY, false);
  review(learning.id, NOON - HOUR, true);
  review(learned.id, NOON - HOUR, true, 'known'); // not an answer, excluded from accuracy
  review(learned.id, NOON - 20 * DAY, false); // older than 7 days

  const s = getStats(db, user, NOON);
  assert.equal(s.totalWords, 30);
  assert.equal(s.learned, 1);
  assert.equal(s.learning, 2);
  assert.equal(s.answers7d, 3);
  assert.ok(Math.abs(s.accuracy7d! - 2 / 3) < 1e-9);
  assert.equal(s.streakDays, 3);
  assert.equal(s.dueToday, 2); // young (overdue) + learning (later today)
  assert.equal(s.newToday, 9); // limit 10, one card created today
});

test('stats for a brand new user', () => {
  const db = makeDb(3);
  const s = getStats(db, makeUser(db), NOON);
  assert.deepEqual(
    { learned: s.learned, learning: s.learning, accuracy7d: s.accuracy7d, streakDays: s.streakDays, dueToday: s.dueToday, newToday: s.newToday },
    { learned: 0, learning: 0, accuracy7d: null, streakDays: 0, dueToday: 0, newToday: 3 },
  );
});
