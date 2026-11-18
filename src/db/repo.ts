import { transaction, type Db } from './db.ts';
import type { Card, Direction, Exercise, Script, SrsState, User, Word, WordEntry } from '../types.ts';

function row<T>(value: unknown): T | undefined {
  return value === undefined ? undefined : (value as T);
}

// ---------- users ----------

export const DEFAULT_REMIND_AT = '19:00';
export const DEFAULT_LESSON_SIZE = 20;

function getUserByTgId(db: Db, tgId: number): User | undefined {
  return row<User>(db.prepare('SELECT * FROM users WHERE tg_id = ?').get(tgId));
}

export function getUser(db: Db, id: number): User | undefined {
  return row<User>(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
}

export function getOrCreateUser(db: Db, tgId: number, now: number): { user: User; created: boolean } {
  const existing = getUserByTgId(db, tgId);
  if (existing) return { user: existing, created: false };
  db.prepare('INSERT INTO users (tg_id, lesson_size, remind_at, created_at) VALUES (?, ?, ?, ?)').run(
    tgId,
    DEFAULT_LESSON_SIZE,
    DEFAULT_REMIND_AT,
    now,
  );
  return { user: getUserByTgId(db, tgId)!, created: true };
}

export interface UserSettings {
  script?: Script;
  lesson_size?: number;
  remind_at?: string | null;
  tz?: string;
}

const SETTING_COLUMNS = ['script', 'lesson_size', 'remind_at', 'tz'] as const;

export function updateUserSettings(db: Db, userId: number, patch: UserSettings): void {
  for (const column of SETTING_COLUMNS) {
    const value = patch[column];
    if (value !== undefined) db.prepare(`UPDATE users SET ${column} = ? WHERE id = ?`).run(value, userId);
  }
}

export function listUsersWithReminders(db: Db): User[] {
  return db.prepare('SELECT * FROM users WHERE remind_at IS NOT NULL').all() as unknown as User[];
}

export function markReminded(db: Db, userId: number, date: string): void {
  db.prepare('UPDATE users SET last_reminded_on = ? WHERE id = ?').run(date, userId);
}

/** Deletes everything the user has learned: cards, answer history, the current lesson. Settings stay. */
export function resetProgress(db: Db, userId: number): void {
  transaction(db, () => {
    for (const table of ['pending_questions', 'lesson_items', 'reviews', 'cards']) {
      db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(userId);
    }
  });
}

// ---------- words ----------

export function upsertWord(db: Db, w: WordEntry): void {
  db.prepare(
    `INSERT INTO words (id, lat, cyr, ru, pos, gender, pres1sg, aspect, pair, rank, tags,
                        false_friend, note, example_sr, example_ru, active)
     VALUES (:id, :lat, :cyr, :ru, :pos, :gender, :pres1sg, :aspect, :pair, :rank, :tags,
             :false_friend, :note, :example_sr, :example_ru, 1)
     ON CONFLICT (id) DO UPDATE SET
       lat = excluded.lat, cyr = excluded.cyr, ru = excluded.ru, pos = excluded.pos,
       gender = excluded.gender, pres1sg = excluded.pres1sg, aspect = excluded.aspect,
       pair = excluded.pair, rank = excluded.rank, tags = excluded.tags,
       false_friend = excluded.false_friend, note = excluded.note,
       example_sr = excluded.example_sr, example_ru = excluded.example_ru, active = 1`,
  ).run({
    id: w.id,
    lat: w.lat,
    cyr: w.cyr,
    ru: w.ru,
    pos: w.pos,
    gender: w.gender ?? null,
    pres1sg: w.pres1sg ?? null,
    aspect: w.aspect ?? null,
    pair: w.pair ?? null,
    rank: w.rank,
    tags: JSON.stringify(w.tags ?? []),
    false_friend: w.falseFriend ? 1 : 0,
    note: w.note ?? null,
    example_sr: w.example?.sr ?? null,
    example_ru: w.example?.ru ?? null,
  });
}

/** Hides words that are no longer in the content files. Existing cards keep working. */
export function deactivateWordsExcept(db: Db, keepIds: string[]): number {
  const keep = new Set(keepIds);
  const all = db.prepare('SELECT id FROM words WHERE active = 1').all() as unknown as { id: string }[];
  const stmt = db.prepare('UPDATE words SET active = 0 WHERE id = ?');
  let n = 0;
  for (const { id } of all) {
    if (!keep.has(id)) {
      stmt.run(id);
      n++;
    }
  }
  return n;
}

export function getWord(db: Db, id: string): Word | undefined {
  return row<Word>(db.prepare('SELECT * FROM words WHERE id = ?').get(id));
}

export function countActiveWords(db: Db): number {
  const r = db.prepare('SELECT COUNT(*) AS n FROM words WHERE active = 1').get() as { n: number };
  return r.n;
}

// ---------- cards ----------

export function getCard(db: Db, id: number): Card | undefined {
  return row<Card>(db.prepare('SELECT * FROM cards WHERE id = ?').get(id));
}

export function findCard(db: Db, userId: number, wordId: string, direction: Direction): Card | undefined {
  return row<Card>(
    db
      .prepare('SELECT * FROM cards WHERE user_id = ? AND word_id = ? AND direction = ?')
      .get(userId, wordId, direction),
  );
}

/** Creates a new card due immediately. Returns the existing one if it is already there. */
export function createCard(db: Db, userId: number, wordId: string, direction: Direction, now: number): Card {
  db.prepare(
    `INSERT INTO cards (user_id, word_id, direction, due, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (user_id, word_id, direction) DO NOTHING`,
  ).run(userId, wordId, direction, now, now);
  return findCard(db, userId, wordId, direction)!;
}

export function saveSrsState(db: Db, cardId: number, s: SrsState): void {
  db.prepare(
    `UPDATE cards SET due = :due, stability = :stability, difficulty = :difficulty, state = :state,
       reps = :reps, lapses = :lapses, scheduled_days = :scheduled_days,
       learning_steps = :learning_steps, last_review = :last_review
     WHERE id = :id`,
  ).run({
    id: cardId,
    due: s.due,
    stability: s.stability,
    difficulty: s.difficulty,
    state: s.state,
    reps: s.reps,
    lapses: s.lapses,
    scheduled_days: s.scheduled_days,
    learning_steps: s.learning_steps,
    last_review: s.last_review,
  });
}

// ---------- reviews ----------

export interface ReviewInput {
  card_id: number;
  user_id: number;
  ts: number;
  rating: number;
  exercise: Exercise;
  answer: string | null;
  correct: boolean;
  elapsed_ms: number | null;
}

export function insertReview(db: Db, r: ReviewInput): void {
  db.prepare(
    `INSERT INTO reviews (card_id, user_id, ts, rating, exercise, answer, correct, elapsed_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(r.card_id, r.user_id, r.ts, r.rating, r.exercise, r.answer, r.correct ? 1 : 0, r.elapsed_ms);
}

// ---------- pending question ----------

export interface PendingQuestion {
  user_id: number;
  card_id: number;
  reps: number;
  options: string[];
  sent_at: number;
}

export function setPending(db: Db, q: PendingQuestion): void {
  db.prepare(
    `INSERT INTO pending_questions (user_id, card_id, reps, options, sent_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET
       card_id = excluded.card_id, reps = excluded.reps, options = excluded.options, sent_at = excluded.sent_at`,
  ).run(q.user_id, q.card_id, q.reps, JSON.stringify(q.options), q.sent_at);
}

export function getPending(db: Db, userId: number): PendingQuestion | undefined {
  const r = db.prepare('SELECT * FROM pending_questions WHERE user_id = ?').get(userId) as
    | (Omit<PendingQuestion, 'options'> & { options: string })
    | undefined;
  return r ? { ...r, options: JSON.parse(r.options) as string[] } : undefined;
}

export function clearPending(db: Db, userId: number): void {
  db.prepare('DELETE FROM pending_questions WHERE user_id = ?').run(userId);
}
