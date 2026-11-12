import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCard, saveSrsState, updateUserSettings, getUser } from '../src/db/repo.ts';
import { addExtraLesson, dailyLimit, dueCount, newAvailable, newIntroducedToday, nextItem } from '../src/srs/queue.ts';
import type { Card } from '../src/types.ts';
import { DAY, HOUR, makeDb, makeUser, NOON } from './helpers.ts';

function setDue(db: ReturnType<typeof makeDb>, card: Card, due: number, state = 2): void {
  saveSrsState(db, card.id, { ...card, due, state, reps: 1, last_review: NOON - DAY });
}

test('a fresh user gets new words in rank order', () => {
  const db = makeDb(5);
  const user = makeUser(db);
  const item = nextItem(db, user, NOON);
  assert.equal(item.kind, 'new');
  assert.equal(item.kind === 'new' && item.word.id, 'w1');
});

test('due cards come before new words, oldest first', () => {
  const db = makeDb(5);
  const user = makeUser(db);
  setDue(db, createCard(db, user.id, 'w1', 'sr-ru', NOON - 2 * DAY), NOON - HOUR);
  setDue(db, createCard(db, user.id, 'w2', 'sr-ru', NOON - 2 * DAY), NOON - 3 * HOUR);
  const item = nextItem(db, user, NOON);
  assert.equal(item.kind === 'review' && item.word.id, 'w2');
});

test('daily limit stops new words; cards not yet due are not shown', () => {
  const db = makeDb(10);
  let user = makeUser(db);
  updateUserSettings(db, user.id, { new_per_day: 2 });
  user = getUser(db, user.id)!;
  setDue(db, createCard(db, user.id, 'w1', 'sr-ru', NOON), NOON + 3 * DAY);
  assert.equal(newAvailable(db, user, NOON), 1);
  setDue(db, createCard(db, user.id, 'w2', 'sr-ru', NOON), NOON + 5 * DAY);
  assert.equal(newIntroducedToday(db, user, NOON), 2);
  assert.equal(newAvailable(db, user, NOON), 0);
  const item = nextItem(db, user, NOON);
  assert.deepEqual(item, { kind: 'done', nextDueAt: NOON + 3 * DAY });
});

test('the limit resets the next day', () => {
  const db = makeDb(10);
  let user = makeUser(db);
  updateUserSettings(db, user.id, { new_per_day: 1 });
  user = getUser(db, user.id)!;
  setDue(db, createCard(db, user.id, 'w1', 'sr-ru', NOON), NOON + 3 * DAY);
  assert.equal(nextItem(db, user, NOON).kind, 'done');
  const tomorrow = nextItem(db, user, NOON + DAY);
  assert.equal(tomorrow.kind === 'new' && tomorrow.word.id, 'w2');
});

test('cards in learning steps are shown early, the just-answered one last', () => {
  const db = makeDb(2);
  const user = makeUser(db);
  const a = createCard(db, user.id, 'w1', 'sr-ru', NOON);
  const b = createCard(db, user.id, 'w2', 'sr-ru', NOON);
  setDue(db, a, NOON + 60_000, 1);
  setDue(db, b, NOON + 10 * 60_000, 1);
  const afterA = nextItem(db, user, NOON, a.id);
  assert.equal(afterA.kind === 'review' && afterA.card.id, b.id);
  // With nothing else left, the same card is allowed again.
  setDue(db, b, NOON + 5 * DAY, 2);
  const onlyA = nextItem(db, user, NOON, a.id);
  assert.equal(onlyA.kind === 'review' && onlyA.card.id, a.id);
});

test('users do not see each other\'s cards', () => {
  const db = makeDb(3);
  const u1 = makeUser(db, 1);
  const u2 = makeUser(db, 2);
  setDue(db, createCard(db, u1.id, 'w1', 'sr-ru', NOON - DAY), NOON - HOUR);
  assert.equal(dueCount(db, u1.id, NOON), 1);
  assert.equal(dueCount(db, u2.id, NOON), 0);
  const item = nextItem(db, u2, NOON);
  assert.equal(item.kind === 'new' && item.word.id, 'w1');
});

test('empty dictionary', () => {
  const db = makeDb(0);
  assert.deepEqual(nextItem(db, makeUser(db), NOON), { kind: 'done', nextDueAt: null });
});

test('an extra lesson adds exactly one more portion, today only, and can be repeated', () => {
  const db = makeDb(20);
  let user = makeUser(db);
  updateUserSettings(db, user.id, { new_per_day: 3 });
  user = getUser(db, user.id)!;
  for (const id of ['w1', 'w2', 'w3']) setDue(db, createCard(db, user.id, id, 'sr-ru', NOON), NOON + 3 * DAY);
  assert.equal(nextItem(db, user, NOON).kind, 'done');

  addExtraLesson(db, user, NOON, 3);
  assert.equal(dailyLimit(db, user, NOON), 6);
  assert.equal(newAvailable(db, user, NOON), 3);
  const item = nextItem(db, user, NOON);
  assert.equal(item.kind === 'new' && item.word.id, 'w4');

  for (const id of ['w4', 'w5', 'w6']) setDue(db, createCard(db, user.id, id, 'sr-ru', NOON), NOON + 3 * DAY);
  assert.equal(nextItem(db, user, NOON).kind, 'done');
  addExtraLesson(db, user, NOON, 3);
  assert.equal(newAvailable(db, user, NOON), 3);

  assert.equal(dailyLimit(db, user, NOON + DAY), 3, 'the extra does not carry over to tomorrow');
});

test('an extra lesson does not stack on top of unused allowance', () => {
  const db = makeDb(20);
  let user = makeUser(db);
  updateUserSettings(db, user.id, { new_per_day: 5 });
  user = getUser(db, user.id)!;
  setDue(db, createCard(db, user.id, 'w1', 'sr-ru', NOON), NOON + 3 * DAY);
  addExtraLesson(db, user, NOON, 5);
  assert.equal(newAvailable(db, user, NOON), 9); // 4 left from today's 5, plus 5 extra
});
