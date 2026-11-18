import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pendingReminders } from '../src/bot/reminders.ts';
import { createCard, getUser, insertReview, markReminded, saveSrsState, updateUserSettings } from '../src/db/repo.ts';
import { DAY, HOUR, makeDb, makeUser, NOON } from './helpers.ts';

// NOON is 12:00 in Belgrade; the default reminder time is 19:00.
const EVENING = NOON + 7 * HOUR + 60_000;

test('reminds after the chosen time, once a day', () => {
  const db = makeDb(5);
  const user = makeUser(db);
  assert.equal(pendingReminders(db, NOON).length, 0);
  const pending = pendingReminders(db, EVENING);
  assert.equal(pending.length, 1);
  assert.deepEqual({ due: pending[0]!.due, fresh: pending[0]!.fresh, date: pending[0]!.date }, { due: 0, fresh: 5, date: '2026-03-10' });
  markReminded(db, user.id, pending[0]!.date);
  assert.equal(pendingReminders(db, EVENING + HOUR).length, 0);
  assert.equal(pendingReminders(db, EVENING + DAY).length, 1);
});

test('no reminder when there is nothing to do or reminders are off', () => {
  const db = makeDb(1);
  const user = makeUser(db);
  const card = createCard(db, user.id, 'w1', 'sr-ru', NOON);
  saveSrsState(db, card.id, { ...card, state: 2, due: NOON + 5 * DAY, reps: 1 });
  assert.equal(pendingReminders(db, EVENING).length, 0);
  assert.equal(pendingReminders(db, EVENING + 5 * DAY).length, 1);
  updateUserSettings(db, user.id, { remind_at: null });
  assert.equal(pendingReminders(db, EVENING + 5 * DAY).length, 0);
});

test('no reminder about new words to someone who has already studied today', () => {
  const db = makeDb(5);
  const user = makeUser(db);
  const card = createCard(db, user.id, 'w1', 'sr-ru', NOON);
  saveSrsState(db, card.id, { ...card, state: 2, due: NOON + 2 * DAY, reps: 1 });
  insertReview(db, { card_id: card.id, user_id: user.id, ts: NOON, rating: 3, exercise: 'choice', answer: 'w1', correct: true, elapsed_ms: null });
  assert.equal(pendingReminders(db, EVENING).length, 0);
  assert.equal(pendingReminders(db, EVENING + DAY).length, 1, 'the next day new words are worth a reminder again');
});

test('reminder time is in the user\'s time zone', () => {
  const db = makeDb(5);
  const user = makeUser(db);
  updateUserSettings(db, user.id, { tz: 'Asia/Vladivostok', remind_at: '21:00' }); // UTC+10: NOON is 21:00 there
  assert.equal(getUser(db, user.id)!.tz, 'Asia/Vladivostok');
  assert.equal(pendingReminders(db, NOON - 60_000).length, 0);
  assert.equal(pendingReminders(db, NOON).length, 1);
});
