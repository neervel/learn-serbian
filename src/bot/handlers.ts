import { Bot, InlineKeyboard, Keyboard, type Context } from 'grammy';
import type { Config } from '../config.ts';
import type { Db } from '../db/db.ts';
import {
  countActiveWords,
  getCard,
  getOrCreateUser,
  getPending,
  getUser,
  getWord,
  markReminded,
  resetProgress,
  setPending,
  updateUserSettings,
  type PendingQuestion,
  type UserSettings,
} from '../db/repo.ts';
import { buildOptions } from '../choice.ts';
import {
  answerChoice,
  clearLesson,
  DONT_KNOW,
  markKnown,
  nextInLesson,
  pickDirection,
  planLesson,
  startLesson,
} from '../lesson.ts';
import { getStats } from '../stats.ts';
import { isValidTimeZone, localDate } from '../time.ts';
import type { User, Word } from '../types.ts';
import {
  answerText,
  esc,
  knownText,
  lessonDoneText,
  optionLabel,
  nothingToLearnText,
  questionText,
  settingsText,
  START_TEXT,
  statsText,
} from './render.ts';

const HTML = { parse_mode: 'HTML' } as const;

// Labels of the buttons under the message field.
export const BTN = {
  learn: '📚 Учить',
  stats: '📊 Прогресс',
  settings: '⚙️ Настройки',
  more: '➕ Ещё урок',
  dontKnow: '🤷 Не знаю',
  known: '👌 Уже знаю',
  stop: '⏹ Хватит',
} as const;

/** Options longer than this get a row each, otherwise Telegram cuts them off. */
const TWO_COLUMN_MAX_LENGTH = 14;

/** The keyboard shown between sessions; `withMore` adds the "one more lesson" button. */
export function menuKeyboard(withMore = false): Keyboard {
  const kb = new Keyboard().text(withMore ? BTN.more : BTN.learn).row();
  return kb.text(BTN.stats).text(BTN.settings).resized().persistent();
}

/** `isNew` adds the "already know it" button, which only makes sense on a word's first appearance. */
function questionKeyboard(labels: string[], isNew: boolean): Keyboard {
  const kb = new Keyboard();
  const perRow = labels.every((label) => label.length <= TWO_COLUMN_MAX_LENGTH) ? 2 : 1;
  labels.forEach((label, i) => {
    if (i > 0 && i % perRow === 0) kb.row();
    kb.text(label);
  });
  kb.row().text(BTN.dontKnow);
  if (isNew) kb.text(BTN.known);
  return kb.text(BTN.stop).resized().persistent().placeholder('Выбери перевод');
}

interface SettingOption {
  label: string;
  /** Callback data of the button. */
  data: string;
  patch: UserSettings;
}

/** Rows of the settings keyboard. */
const SETTING_ROWS: SettingOption[][] = [
  [
    { label: 'Latinica', data: 's:script:lat', patch: { script: 'lat' } },
    { label: 'Ћирилица', data: 's:script:cyr', patch: { script: 'cyr' } },
  ],
  [10, 15, 20, 30].map((n) => ({ label: String(n), data: `s:size:${n}`, patch: { lesson_size: n } })),
  [
    { label: 'выкл', data: 's:rem:off', patch: { remind_at: null } },
    ...['09:00', '13:00', '19:00', '21:00'].map((t) => ({ label: t, data: `s:rem:${t}`, patch: { remind_at: t } })),
  ],
];

function settingsKeyboard(user: User): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const row of SETTING_ROWS) {
    for (const o of row) {
      const selected = Object.entries(o.patch).every(([key, value]) => user[key as keyof User] === value);
      kb.text(selected ? `• ${o.label}` : o.label, o.data);
    }
    kb.row();
  }
  return kb.text('🗑 Сбросить прогресс', 'reset:ask');
}

const RESET_CONFIRM_TEXT =
  '<b>Сбросить прогресс?</b>\n\nУдалятся все слова в изучении и выученные, история ответов и серия. Настройки останутся. Отменить это нельзя.';
const resetConfirmKeyboard = () => new InlineKeyboard().text('Да, сбросить', 'reset:yes').text('Отмена', 'reset:no');

/** `random` decides the direction of questions; tests pass their own. */
export function createBot(config: Config, db: Db, random: () => number = Math.random): Bot {
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

  /** Sends the next question of the lesson, or the end-of-lesson message. */
  async function sendNext(ctx: Context, user: User): Promise<void> {
    const now = Date.now();
    const item = nextInLesson(db, user, now);
    if (!item) {
      clearLesson(db, user.id);
      const next = planLesson(db, user, now);
      const canDoMore = next.reviews.length + next.fresh.length > 0;
      await ctx.reply(lessonDoneText(canDoMore ? BTN.more : null), { ...HTML, reply_markup: menuKeyboard(canDoMore) });
      return;
    }
    // A new word is asked like any other card: the translation is only
    // revealed after the user has tried to answer.
    const { card } = item;
    const options = buildOptions(db, item.word);
    const direction = pickDirection(db, card, random);
    setPending(db, {
      user_id: user.id,
      card_id: card.id,
      reps: card.reps,
      direction,
      options: options.map((o) => o.id),
      sent_at: now,
    });
    await ctx.reply(questionText(item.word, user, card.reps === 0, direction), {
      ...HTML,
      reply_markup: questionKeyboard(options.map((o) => optionLabel(o, user, direction)), card.reps === 0),
    });
  }

  /**
   * Sends the current question once more, with its buttons. Telegram apps
   * sometimes keep showing the buttons of an earlier question; a tap on one
   * of those lands here and brings the right ones back.
   */
  async function repeatQuestion(ctx: Context, user: User, pending: PendingQuestion): Promise<void> {
    const word = getWord(db, getCard(db, pending.card_id)?.word_id ?? '');
    const options = pending.options.map((id) => getWord(db, id)).filter((w) => w !== undefined);
    if (!word || options.length === 0) return sendNext(ctx, user);
    const isNew = pending.reps === 0;
    const question = questionText(word, user, isNew, pending.direction);
    await ctx.reply(`Выбери один из вариантов на кнопках внизу.\n\n${question}`, {
      ...HTML,
      reply_markup: questionKeyboard(options.map((o) => optionLabel(o, user, pending.direction)), isNew),
    });
  }

  /** Handles a tap on an answer button. Returns false if the text is not an answer to the current question. */
  async function handleAnswer(ctx: Context, user: User, text: string): Promise<boolean> {
    const pending = getPending(db, user.id);
    if (!pending) return false;
    if (text === BTN.known) {
      const result = markKnown(db, user, pending.card_id, Date.now());
      // On a word that is not new the button is not offered; typed by hand, it is not an answer.
      if (result.status === 'stale') return false;
      await ctx.reply(knownText(result.word, user), HTML);
      await sendNext(ctx, user);
      return true;
    }
    const { direction } = pending;
    const labelOf = (id: string) => {
      const word = getWord(db, id);
      return word && optionLabel(word, user, direction);
    };
    const chosenId = text === BTN.dontKnow ? DONT_KNOW : pending.options.find((id) => labelOf(id) === text);
    if (chosenId === undefined) return false;

    const now = Date.now();
    const elapsed = now - pending.sent_at;
    const outcome = answerChoice(db, user, pending.card_id, pending.reps, chosenId, now, elapsed, direction);
    if (outcome.status === 'stale') {
      await sendNext(ctx, user);
      return true;
    }
    // The result is always its own message, with the example; the next question follows separately.
    await ctx.reply(answerText(outcome.word, user, { ...outcome, direction }), HTML);
    await sendNext(ctx, user);
    return true;
  }

  /** Starts a new lesson; an unfinished one is dropped. */
  const learn = async (ctx: Context) => {
    const user = currentUser(ctx);
    if (startLesson(db, user, Date.now()) === 0) {
      await ctx.reply(nothingToLearnText(countActiveWords(db) === 0), { ...HTML, reply_markup: menuKeyboard() });
      return;
    }
    await sendNext(ctx, user);
  };
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
  bot.hears([BTN.learn, BTN.more], learn);
  bot.hears(BTN.stats, stats);
  bot.hears(BTN.settings, settings);

  bot.hears(BTN.stop, async (ctx) => {
    const user = currentUser(ctx);
    clearLesson(db, user.id);
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
  bot.callbackQuery(/^s:/, async (ctx, next) => {
    const option = SETTING_ROWS.flat().find((o) => o.data === ctx.callbackQuery.data);
    if (!option) return next();
    const user = currentUser(ctx);
    updateUserSettings(db, user.id, option.patch);
    await ctx.answerCallbackQuery({ text: 'Сохранено' });
    const updated = getUser(db, user.id)!;
    try {
      await ctx.editMessageText(settingsText(updated), { ...HTML, reply_markup: settingsKeyboard(updated) });
    } catch {
      // "message is not modified" when the same option is pressed twice
    }
  });

  // "Reset progress": asks first, in place of the settings message.
  bot.callbackQuery(/^reset:(ask|yes|no)$/, async (ctx) => {
    const user = currentUser(ctx);
    const step = ctx.match[1];
    if (step === 'ask') {
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(RESET_CONFIRM_TEXT, { ...HTML, reply_markup: resetConfirmKeyboard() });
      return;
    }
    if (step === 'yes') resetProgress(db, user.id);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(settingsText(user), { ...HTML, reply_markup: settingsKeyboard(user) });
    if (step === 'yes') {
      console.log(`user ${user.id} reset their progress`);
      // A new message, to replace the answer buttons of a lesson that no longer exists.
      await ctx.reply('Прогресс сброшен. Нажми «Учить», чтобы начать заново.', { reply_markup: menuKeyboard() });
    }
  });

  // Buttons under messages from older versions of the bot.
  bot.on('callback_query', async (ctx) => {
    await ctx.answerCallbackQuery({ text: 'Эта кнопка устарела. Нажми «Учить».' });
  });

  bot.on('message:text', async (ctx) => {
    const user = currentUser(ctx);
    if (await handleAnswer(ctx, user, ctx.message.text)) return;
    const pending = getPending(db, user.id);
    if (pending) {
      await repeatQuestion(ctx, user, pending);
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
