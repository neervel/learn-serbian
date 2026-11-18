import type { Bot } from 'grammy';
import type { ReplyKeyboardMarkup } from 'grammy/types';
import type { Db } from '../db/db.ts';
import { listUsersWithReminders, markReminded } from '../db/repo.ts';
import { answeredSince, dueCount, planLesson } from '../lesson.ts';
import { localDate, localTime, startOfLocalDay } from '../time.ts';
import type { User } from '../types.ts';
import { reminderText } from './render.ts';

const CHECK_INTERVAL_MS = 30_000;

export interface Reminder {
  user: User;
  date: string;
  due: number;
  fresh: number;
}

/**
 * Users whose reminder time has passed today, who haven't been reminded today
 * and who have something to do: cards to review, or new words if they have not
 * studied today yet.
 */
export function pendingReminders(db: Db, now: number): Reminder[] {
  const out: Reminder[] = [];
  for (const user of listUsersWithReminders(db)) {
    if (user.remind_at === null) continue;
    const date = localDate(now, user.tz);
    if (user.last_reminded_on === date) continue;
    if (localTime(now, user.tz) < user.remind_at) continue;
    const due = dueCount(db, user.id, now);
    const fresh = planLesson(db, user, now).fresh.length;
    if (due === 0 && (fresh === 0 || answeredSince(db, user.id, startOfLocalDay(now, user.tz)))) continue;
    out.push({ user, date, due, fresh });
  }
  return out;
}

/** `menuKeyboard` is passed in so this module does not have to load grammY itself. */
export function startReminders(bot: Bot, db: Db, menuKeyboard: ReplyKeyboardMarkup): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      for (const r of pendingReminders(db, Date.now())) {
        // Mark first: a user who blocked the bot must not be retried every 30 seconds.
        markReminded(db, r.user.id, r.date);
        try {
          await bot.api.sendMessage(r.user.tg_id, reminderText(r.due, r.fresh), { reply_markup: menuKeyboard });
        } catch (err) {
          console.error(`reminder to user ${r.user.id} failed:`, err instanceof Error ? err.message : err);
        }
      }
    } catch (err) {
      console.error('reminder tick failed:', err);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, CHECK_INTERVAL_MS);
  return () => clearInterval(timer);
}
