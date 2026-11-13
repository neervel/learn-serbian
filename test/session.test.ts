import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findCard, getCard } from '../src/db/repo.ts';
import { answerChoice, DONT_KNOW, startLearning } from '../src/session.ts';
import { nextItem } from '../src/srs/queue.ts';
import { DAY, makeDb, makeUser, NOON } from './helpers.ts';

function reviewCount(db: ReturnType<typeof makeDb>): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM reviews').get() as { n: number }).n;
}

test('a correct answer moves the card into the future and logs a review', () => {
  const db = makeDb(5);
  const user = makeUser(db);
  const card = startLearning(db, user, 'w1', NOON)!;
  const outcome = answerChoice(db, user, card.id, 0, 'w1', NOON, 1500);
  assert.equal(outcome.status === 'answered' && outcome.correct, true);
  const after = getCard(db, card.id)!;
  assert.equal(after.reps, 1);
  assert.ok(after.due > NOON);
  assert.equal(after.last_review, NOON);
  assert.equal(reviewCount(db), 1);
});

test('a wrong answer comes back sooner than a right one', () => {
  const db = makeDb(5);
  const user = makeUser(db);
  const right = startLearning(db, user, 'w1', NOON)!;
  const wrong = startLearning(db, user, 'w2', NOON)!;
  answerChoice(db, user, right.id, 0, 'w1', NOON, null);
  const outcome = answerChoice(db, user, wrong.id, 0, 'w3', NOON, null);
  assert.equal(outcome.status === 'answered' && outcome.correct, false);
  assert.equal(outcome.status === 'answered' && outcome.chosen?.id, 'w3');
  assert.ok(getCard(db, wrong.id)!.due < getCard(db, right.id)!.due);
});

test('pressing an old button twice does not count twice', () => {
  const db = makeDb(5);
  const user = makeUser(db);
  const card = startLearning(db, user, 'w1', NOON)!;
  assert.equal(answerChoice(db, user, card.id, 0, 'w1', NOON, null).status, 'answered');
  assert.equal(answerChoice(db, user, card.id, 0, 'w1', NOON, null).status, 'stale');
  assert.equal(reviewCount(db), 1);
});

test('another user cannot answer someone else\'s card', () => {
  const db = makeDb(5);
  const owner = makeUser(db, 1);
  const other = makeUser(db, 2);
  const card = startLearning(db, owner, 'w1', NOON)!;
  assert.equal(answerChoice(db, other, card.id, 0, 'w1', NOON, null).status, 'stale');
  assert.equal(reviewCount(db), 0);
});

test('a new word guessed on first sight goes straight to days; a missed one stays in minutes', () => {
  const db = makeDb(5);
  const user = makeUser(db);
  const guessed = startLearning(db, user, 'w1', NOON)!;
  answerChoice(db, user, guessed.id, 0, 'w1', NOON, null);
  const g = getCard(db, guessed.id)!;
  assert.equal(g.state, 2);
  const days = (g.due - NOON) / DAY;
  assert.ok(days >= 2 && days <= 3, `due in ${days} days`);

  // Missed first, then right: the second answer is not "first sight" any more.
  const missed = startLearning(db, user, 'w2', NOON)!;
  answerChoice(db, user, missed.id, 0, 'w3', NOON, null);
  answerChoice(db, user, missed.id, 1, 'w2', NOON + 60_000, null);
  const m = getCard(db, missed.id)!;
  assert.ok(m.due - NOON < DAY, 'still in the learning steps');
});

test('"don\'t know" counts as a wrong answer', () => {
  const db = makeDb(5);
  const user = makeUser(db);
  const card = startLearning(db, user, 'w1', NOON)!;
  const outcome = answerChoice(db, user, card.id, 0, DONT_KNOW, NOON, null);
  assert.equal(outcome.status === 'answered' && outcome.correct, false);
  assert.equal(outcome.status === 'answered' && outcome.chosen, undefined);
  assert.ok(getCard(db, card.id)!.due - NOON < 10 * 60_000);
});

test('repeated correct answers grow the interval past the "learned" threshold', () => {
  const db = makeDb(1);
  const user = makeUser(db);
  const card = startLearning(db, user, 'w1', NOON)!;
  let now = NOON;
  for (let i = 0; i < 12; i++) {
    const current = getCard(db, card.id)!;
    now = Math.max(now, current.due) + 1000;
    assert.equal(answerChoice(db, user, card.id, current.reps, 'w1', now, null).status, 'answered');
  }
  const final = getCard(db, card.id)!;
  assert.equal(final.state, 2);
  assert.ok(final.scheduled_days > 21, `interval ${final.scheduled_days} days`);
});

test('a whole first session: new words, then their learning steps, then done', () => {
  const db = makeDb(3);
  const user = makeUser(db);
  let now = NOON;
  let lastCard: number | undefined;
  let steps = 0;
  for (; steps < 50; steps++) {
    const item = nextItem(db, user, now, lastCard);
    if (item.kind === 'done') break;
    if (item.kind === 'new') {
      startLearning(db, user, item.word.id, now);
    } else {
      answerChoice(db, user, item.card.id, item.card.reps, item.word.id, now, null);
      lastCard = item.card.id;
    }
    now += 5000;
  }
  assert.ok(steps < 50, 'session must end');
  const cards = db.prepare('SELECT state, due FROM cards').all() as unknown as { state: number; due: number }[];
  assert.equal(cards.length, 3);
  for (const c of cards) {
    assert.equal(c.state, 2);
    assert.ok(c.due > now);
  }
});
