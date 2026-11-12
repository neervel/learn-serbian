import type { Db } from './db/db.ts';
import { dueCount, newAvailable } from './srs/queue.ts';
import { addDays, DAY_MS, localDate, startOfLocalDay } from './time.ts';
import type { User } from './types.ts';

/** A word counts as learned once its review interval is longer than this. */
export const LEARNED_INTERVAL_DAYS = 21;

const HOUR_MS = 60 * 60 * 1000;

export interface Stats {
  totalWords: number;
  learning: number;
  learned: number;
  accuracy7d: number | null; // 0..1, null if no answers in the last 7 days
  answers7d: number;
  streakDays: number;
  dueToday: number;
  newToday: number;
}

/** Days in a row with at least one answer, ending today (or yesterday if today is still empty). */
export function streak(activeDates: Set<string>, today: string): number {
  let day = activeDates.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (activeDates.has(day)) {
    n++;
    day = addDays(day, -1);
  }
  return n;
}

function activeDates(db: Db, user: User, now: number): Set<string> {
  // Hour buckets keep this small; each bucket is converted to a local date.
  const rows = db
    .prepare('SELECT DISTINCT ts / ? AS h FROM reviews WHERE user_id = ? AND ts >= ?')
    .all(HOUR_MS, user.id, now - 400 * DAY_MS) as unknown as { h: number }[];
  return new Set(rows.map((r) => localDate(r.h * HOUR_MS, user.tz)));
}

export function getStats(db: Db, user: User, now: number): Stats {
  const words = db.prepare('SELECT COUNT(*) AS n FROM words WHERE active = 1').get() as { n: number };
  const cards = db
    .prepare(
      `SELECT COALESCE(SUM(state = 2 AND scheduled_days > ?), 0) AS learned, COUNT(*) AS total
       FROM cards WHERE user_id = ? AND direction = 'sr-ru'`,
    )
    .get(LEARNED_INTERVAL_DAYS, user.id) as { learned: number; total: number };
  const acc = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(correct), 0) AS ok FROM reviews
       WHERE user_id = ? AND ts >= ? AND exercise != 'known'`,
    )
    .get(user.id, now - 7 * DAY_MS) as { n: number; ok: number };
  const endOfDay = startOfLocalDay(now, user.tz) + DAY_MS;

  return {
    totalWords: words.n,
    learning: cards.total - cards.learned,
    learned: cards.learned,
    accuracy7d: acc.n === 0 ? null : acc.ok / acc.n,
    answers7d: acc.n,
    streakDays: streak(activeDates(db, user, now), localDate(now, user.tz)),
    dueToday: dueCount(db, user.id, endOfDay),
    newToday: newAvailable(db, user, now),
  };
}
