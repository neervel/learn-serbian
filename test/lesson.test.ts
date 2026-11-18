import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCard, getUser, saveSrsState, updateUserSettings } from '../src/db/repo.ts';
import { answerChoice, lessonLeft, nextInLesson, planLesson, startLesson } from '../src/lesson.ts';
import type { User } from '../src/types.ts';
import { DAY, HOUR, makeDb, makeUser, NOON } from './helpers.ts';

type TestDb = ReturnType<typeof makeDb>;

function userWithLesson(db: TestDb, size: number, tgId = 1000): User {
  const user = makeUser(db, tgId);
  updateUserSettings(db, user.id, { lesson_size: size });
  return getUser(db, user.id)!;
}

/** A card added `addedDaysAgo` days ago that is due at `due`. */
function addCard(db: TestDb, user: User, wordId: string, addedDaysAgo: number, due: number, state = 2): void {
  const card = createCard(db, user.id, wordId, 'sr-ru', NOON - addedDaysAgo * DAY);
  saveSrsState(db, card.id, { ...card, due, state, reps: 1, last_review: NOON - DAY });
}

/** Answers every question of the current lesson; `wrongOnce` words are missed the first time. */
function runLesson(db: TestDb, user: User, wrongOnce: string[] = []): string[] {
  const asked: string[] = [];
  const missed = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const item = nextInLesson(db, user, NOON);
    if (!item) return asked;
    asked.push(item.word.id);
    const wrong = wrongOnce.includes(item.word.id) && !missed.has(item.word.id);
    if (wrong) missed.add(item.word.id);
    answerChoice(db, user, item.card.id, item.card.reps, wrong ? 'nope' : item.word.id, NOON, null);
  }
  throw new Error('the lesson does not end');
}

test('30% of a lesson is new words, the rest are reviews', () => {
  const db = makeDb(100);
  const user = userWithLesson(db, 20);
  for (let n = 1; n <= 50; n++) addCard(db, user, `w${n}`, 60 - n, NOON - HOUR);
  const plan = planLesson(db, user, NOON);
  assert.equal(plan.fresh.length, 6);
  assert.equal(plan.reviews.length, 14);
  assert.deepEqual(plan.fresh, ['w51', 'w52', 'w53', 'w54', 'w55', 'w56']);
});

test('with more due cards than fit, the ones added earliest are taken', () => {
  const db = makeDb(100);
  const user = userWithLesson(db, 10);
  // w1 is the newest card and the most overdue one, w50 is the oldest.
  for (let n = 1; n <= 50; n++) addCard(db, user, `w${n}`, n, NOON - (60 - n) * HOUR);
  const plan = planLesson(db, user, NOON);
  assert.deepEqual(plan.reviews, ['w50', 'w49', 'w48', 'w47', 'w46', 'w45', 'w44']);
});

test('a lesson asks exactly its size when every answer is right', () => {
  const db = makeDb(100);
  const user = userWithLesson(db, 20);
  for (let n = 1; n <= 50; n++) addCard(db, user, `w${n}`, 60 - n, NOON - HOUR);
  assert.equal(startLesson(db, user, NOON), 20);
  const asked = runLesson(db, user);
  assert.equal(asked.length, 20);
  assert.equal(new Set(asked).size, 20);
  assert.equal(lessonLeft(db, user.id), 0);
});

test('new words are spread among the reviews', () => {
  const db = makeDb(100);
  const user = userWithLesson(db, 10);
  for (let n = 1; n <= 20; n++) addCard(db, user, `w${n}`, 30 - n, NOON - HOUR);
  startLesson(db, user, NOON);
  const kinds = runLesson(db, user).map((id) => (Number(id.slice(1)) > 20 ? 'new' : 'old'));
  assert.deepEqual(kinds, ['old', 'old', 'old', 'new', 'old', 'old', 'new', 'old', 'old', 'new']);
});

test('new words fill the lesson when there is little to review', () => {
  const db = makeDb(100);
  const user = userWithLesson(db, 10);
  assert.deepEqual(planLesson(db, user, NOON), { reviews: [], fresh: Array.from({ length: 10 }, (_, i) => `w${i + 1}`) });
  addCard(db, user, 'w1', 3, NOON - HOUR);
  addCard(db, user, 'w2', 3, NOON - HOUR);
  addCard(db, user, 'w3', 3, NOON + 5 * DAY); // not due yet
  const plan = planLesson(db, user, NOON);
  assert.deepEqual(plan.reviews, ['w1', 'w2']);
  assert.equal(plan.fresh.length, 8);
});

test('reviews fill the lesson when the dictionary runs out of new words', () => {
  const db = makeDb(22);
  const user = userWithLesson(db, 10);
  for (let n = 1; n <= 20; n++) addCard(db, user, `w${n}`, 30 - n, NOON - HOUR);
  const plan = planLesson(db, user, NOON);
  assert.deepEqual(plan.fresh, ['w21', 'w22']);
  assert.equal(plan.reviews.length, 8);
});

test('a missed word is asked again at the end of the lesson, until it is answered', () => {
  const db = makeDb(5);
  const user = userWithLesson(db, 5);
  startLesson(db, user, NOON);
  assert.deepEqual(runLesson(db, user, ['w2']), ['w1', 'w2', 'w3', 'w4', 'w5', 'w2']);
});

test('a word missed as the last one is not asked twice in a row', () => {
  const db = makeDb(5);
  const user = userWithLesson(db, 5);
  startLesson(db, user, NOON);
  // w5 is the last word: missing it ends the lesson.
  assert.deepEqual(runLesson(db, user, ['w5']), ['w1', 'w2', 'w3', 'w4', 'w5']);
  // Missed again when it comes back at the end: the lesson ends as well.
  startLesson(db, user, NOON + HOUR);
  const again = nextInLesson(db, user, NOON + HOUR)!;
  assert.equal(again.word.id, 'w5', 'the missed word is due and opens the next lesson');
  answerChoice(db, user, again.card.id, again.card.reps, 'nope', NOON + HOUR, null);
  assert.equal(lessonLeft(db, user.id), 0);
});

test('nothing due and no new words: an empty lesson', () => {
  const db = makeDb(1);
  const user = userWithLesson(db, 10);
  addCard(db, user, 'w1', 3, NOON + 5 * DAY);
  assert.equal(startLesson(db, user, NOON), 0);
  assert.equal(nextInLesson(db, user, NOON), undefined);
  assert.equal(startLesson(db, makeUser(makeDb(0)), NOON), 0);
});

test('starting a lesson replaces the unfinished one; unseen new words stay new', () => {
  const db = makeDb(30);
  const user = userWithLesson(db, 10);
  startLesson(db, user, NOON);
  const first = nextInLesson(db, user, NOON)!;
  answerChoice(db, user, first.card.id, 0, first.word.id, NOON, null);
  assert.equal(lessonLeft(db, user.id), 9);
  assert.equal(startLesson(db, user, NOON), 10);
  assert.equal(nextInLesson(db, user, NOON)!.word.id, 'w2');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM cards').get() as { n: number }).n, 2);
});

test('users have separate lessons', () => {
  const db = makeDb(10);
  const u1 = userWithLesson(db, 5, 1);
  const u2 = userWithLesson(db, 5, 2);
  startLesson(db, u1, NOON);
  assert.equal(lessonLeft(db, u2.id), 0);
  startLesson(db, u2, NOON);
  runLesson(db, u1);
  assert.equal(lessonLeft(db, u2.id), 5);
});

test('a database from the older version is migrated on open', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { DatabaseSync } = await import('node:sqlite');
  const { openDb } = await import('../src/db/db.ts');
  const path = join(mkdtempSync(join(tmpdir(), 'serbian-')), 'app.db');
  const old = new DatabaseSync(path);
  old.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, tg_id INTEGER NOT NULL UNIQUE,
    script TEXT NOT NULL DEFAULT 'lat', new_per_day INTEGER NOT NULL DEFAULT 10, remind_at TEXT,
    tz TEXT NOT NULL DEFAULT 'Europe/Belgrade', last_reminded_on TEXT, created_at INTEGER NOT NULL);
    CREATE TABLE extra_new (user_id INTEGER, day TEXT, count INTEGER);
    CREATE TABLE pending_questions (user_id INTEGER PRIMARY KEY, card_id INTEGER NOT NULL, reps INTEGER NOT NULL,
      options TEXT NOT NULL, sent_at INTEGER NOT NULL);
    INSERT INTO users (tg_id, new_per_day, created_at) VALUES (5, 20, 0);`);
  old.close();
  const db = openDb(path);
  assert.equal(makeUser(db, 5).lesson_size, 20);
  assert.equal(makeUser(db, 6).lesson_size, 20);
  const columns = db.prepare('PRAGMA table_info(pending_questions)').all() as unknown as { name: string }[];
  assert.ok(columns.some((c) => c.name === 'direction'));
  db.close();
  openDb(path).close(); // opening again is a no-op
});
