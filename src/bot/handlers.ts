import { Bot, InlineKeyboard, Keyboard, type Context } from 'grammy';
import type { Config } from '../config.ts';
import type { Db } from '../db/db.ts';
import {
  clearPending,
  countActiveWords,
  getOrCreateUser,
  getPending,
  getUser,
  getWord,
  markReminded,
  setPending,
  updateUserSettings,
} from '../db/repo.ts';
import { buildOptions } from '../quiz/choice.ts';
import { answerChoice, DONT_KNOW, startLearning } from '../session.ts';
import { addExtraLesson, nextItem, remainingNewWords } from '../srs/queue.ts';
import { getStats } from '../stats.ts';
import { isValidTimeZone, localDate } from '../time.ts';
import type { User, Word } from '../types.ts';
import { answerText, doneText, esc, questionText, settingsText, START_TEXT, statsText } from './render.ts';

const HTML = { parse_mode: 'HTML' } as const;
const NEW_PER_DAY_OPTIONS = [5, 10, 15, 20];
const REMIND_OPTIONS = ['09:00', '13:00', '19:00', '21:00'];

// Labels of the buttons under the message field.
export const BTN = {
  learn: '📚 Учить',
  stats: '📊 Прогресс',
  settings: '⚙️ Настройки',
  more: '➕ Ещё урок',
  dontKnow: '🤷 Не знаю',
  stop: '⏹ Хватит',
} as const;

/** Options longer than this get a row each, otherwise Telegram cuts them off. */
const TWO_COLUMN_MAX_LENGTH = 14;

/** The keyboard shown between sessions; `withMore` adds the "one more lesson" button. */
export function menuKeyboard(withMore = false): Keyboard {
  const kb = new Keyboard().text(withMore ? BTN.more : BTN.learn).row();
  return kb.text(BTN.stats).text(BTN.settings).resized().persistent();
}

function questionKeyboard(options: Word[]): Keyboard {
  const kb = new Keyboard();
  const perRow = options.every((o) => o.ru.length <= TWO_COLUMN_MAX_LENGTH) ? 2 : 1;
  options.forEach((o, i) => {
    if (i > 0 && i % perRow === 0) kb.row();
    kb.text(o.ru);
  });
  return kb.row().text(BTN.dontKnow).text(BTN.stop).resized().persistent().placeholder('Выбери перевод');
}

function settingsKeyboard(user: User): InlineKeyboard {
  const mark = (on: boolean, label: string) => (on ? `• ${label}` : label);
  const kb = new InlineKeyboard()
    .text(mark(user.script === 'lat', 'Latinica'), 's:script:lat')
    .text(mark(user.script === 'cyr', 'Ћирилица'), 's:script:cyr')
    .row();
  for (const n of NEW_PER_DAY_OPTIONS) kb.text(mark(user.new_per_day === n, String(n)), `s:new:${n}`);
  kb.row();
  kb.text(mark(user.remind_at === null, 'выкл'), 's:rem:off');
  for (const t of REMIND_OPTIONS) kb.text(mark(user.remind_at === t, t), `s:rem:${t.replace(':', '')}`);
  return kb;
}

export function createBot(config: Config, db: Db): Bot {
  const bot = new Bot(config.botToken);

  // Private chats only, and only allowed users if a whitelist is configured.
  bot.use(async (ctx, next) => {
    if (ctx.chat?.type !== 'private' || !ctx.from) return;
    if (config.allowedUserIds.size > 0 && !config.allowedUserIds.has(ctx.from.id)) {
      console.log(`rejected user ${ctx.from.id}`);
      if (ctx.message) await ctx.reply('Это закрытый бот.');
      return;
    }
    await next();
  });

  function currentUser(ctx: Context): User {
    const now = Date.now();
    const { user, created } = getOrCreateUser(db, ctx.from!.id, now);
    if (created) {
      console.log(`new user: telegram id ${ctx.from!.id}`);
      // Don't send today's reminder to someone who has just started.
      markReminded(db, user.id, localDate(now, user.tz));
    }
    return user;
  }

  /** Sends the next question, or the end-of-session message. */
  async function sendNext(ctx: Context, user: User, justAnswered?: number): Promise<void> {
    const now = Date.now();
    const item = nextItem(db, user, now, justAnswered);
    if (item.kind === 'done') {
      clearPending(db, user.id);
      const canDoMore = remainingNewWords(db, user.id) > 0;
      const text = doneText(item.nextDueAt, now, user, {
        noWords: countActiveWords(db) === 0,
        moreLabel: canDoMore ? BTN.more : null,
      });
      await ctx.reply(text, { ...HTML, reply_markup: menuKeyboard(canDoMore) });
      return;
    }
    // A new word goes straight into the deck and is asked like any other card:
    // the translation is only revealed after the user has tried to answer.
    const card = item.kind === 'new' ? startLearning(db, user, item.word.id, now) : item.card;
    if (!card) return;
    const options = buildOptions(db, item.word);
    setPending(db, { user_id: user.id, card_id: card.id, reps: card.reps, options: options.map((o) => o.id), sent_at: now });
    await ctx.reply(questionText(item.word, user, card.reps === 0), {
      ...HTML,
      reply_markup: questionKeyboard(options),
    });
  }

  /** Handles a tap on an answer button. Returns false if the text is not an answer to the current question. */
  async function handleAnswer(ctx: Context, user: User, text: string): Promise<boolean> {
    const pending = getPending(db, user.id);
    if (!pending) return false;
    const chosenId =
      text === BTN.dontKnow ? DONT_KNOW : pending.options.find((id) => getWord(db, id)?.ru === text);
    if (chosenId === undefined) return false;

    const now = Date.now();
    const outcome = answerChoice(db, user, pending.card_id, pending.reps, chosenId, now, now - pending.sent_at);
    if (outcome.status === 'stale') {
      await sendNext(ctx, user);
      return true;
    }
    // The result is always its own message, with the example; the next question follows separately.
    await ctx.reply(answerText(outcome.word, user, { correct: outcome.correct, chosen: outcome.chosen }), HTML);
    await sendNext(ctx, user, pending.card_id);
    return true;
  }

  const learn = async (ctx: Context) => sendNext(ctx, currentUser(ctx));
  const stats = async (ctx: Context) => {
    await ctx.reply(statsText(getStats(db, currentUser(ctx), Date.now())), HTML);
  };
  const settings = async (ctx: Context) => {
    const user = currentUser(ctx);
    await ctx.reply(settingsText(user), { ...HTML, reply_markup: settingsKeyboard(user) });
  };

  bot.command('start', async (ctx) => {
    currentUser(ctx);
    await ctx.reply(START_TEXT, { reply_markup: menuKeyboard() });
  });
  bot.command('learn', learn);
  bot.command('stats', stats);
  bot.command('settings', settings);
  bot.hears(BTN.learn, learn);
  bot.hears(BTN.stats, stats);
  bot.hears(BTN.settings, settings);

  // One more lesson on top of today's limit, as many times a day as the user likes.
  bot.hears(BTN.more, async (ctx) => {
    const user = currentUser(ctx);
    const now = Date.now();
    if (nextItem(db, user, now).kind === 'done' && remainingNewWords(db, user.id) > 0) {
      addExtraLesson(db, user, now, user.new_per_day);
    }
    await sendNext(ctx, user);
  });

  bot.hears(BTN.stop, async (ctx) => {
    const user = currentUser(ctx);
    clearPending(db, user.id);
    await ctx.reply('Хорошо, продолжим позже.', { reply_markup: menuKeyboard() });
  });

  bot.command('tz', async (ctx) => {
    const user = currentUser(ctx);
    const tz = ctx.match.trim();
    if (tz === '' || !isValidTimeZone(tz)) {
      await ctx.reply('Укажи часовой пояс в формате IANA, например: <code>/tz Europe/Moscow</code>', HTML);
      return;
    }
    updateUserSettings(db, user.id, { tz });
    await ctx.reply(`Часовой пояс: ${esc(tz)}`, HTML);
  });

  // Settings buttons
  bot.callbackQuery(/^s:(script|new|rem):(\w+)$/, async (ctx) => {
    const user = currentUser(ctx);
    const [, key, value] = ctx.match;
    if (key === 'script' && (value === 'lat' || value === 'cyr')) {
      updateUserSettings(db, user.id, { script: value });
    } else if (key === 'new' && NEW_PER_DAY_OPTIONS.includes(Number(value))) {
      updateUserSettings(db, user.id, { new_per_day: Number(value) });
    } else if (key === 'rem' && value === 'off') {
      updateUserSettings(db, user.id, { remind_at: null });
    } else if (key === 'rem' && value && REMIND_OPTIONS.includes(`${value.slice(0, 2)}:${value.slice(2)}`)) {
      updateUserSettings(db, user.id, { remind_at: `${value.slice(0, 2)}:${value.slice(2)}` });
    } else {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery({ text: 'Сохранено' });
    const updated = getUser(db, user.id)!;
    try {
      await ctx.editMessageText(settingsText(updated), { ...HTML, reply_markup: settingsKeyboard(updated) });
    } catch {
      // "message is not modified" when the same option is pressed twice
    }
  });

  // Buttons under messages from older versions of the bot.
  bot.on('callback_query', async (ctx) => {
    await ctx.answerCallbackQuery({ text: 'Эта кнопка устарела. Нажми «Учить».' });
  });

  bot.on('message:text', async (ctx) => {
    const user = currentUser(ctx);
    if (await handleAnswer(ctx, user, ctx.message.text)) return;
    if (getPending(db, user.id)) {
      await ctx.reply('Выбери один из вариантов на кнопках внизу.');
      return;
    }
    await ctx.reply('Нажми «Учить», чтобы начать.', { reply_markup: menuKeyboard() });
  });

  bot.catch((err) => {
    console.error(`error while handling update ${err.ctx.update.update_id}:`, err.error);
  });

  return bot;
}

export const COMMANDS = [
  { command: 'learn', description: 'Учить слова' },
  { command: 'stats', description: 'Прогресс' },
  { command: 'settings', description: 'Настройки' },
];
