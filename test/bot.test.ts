// Drives the real handlers with fake Telegram updates; outgoing API calls are
// captured instead of being sent.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBot } from '../src/bot/handlers.ts';
import type { Db } from '../src/db/db.ts';
import { makeDb } from './helpers.ts';

interface Call {
  method: string;
  payload: Record<string, any>;
}

/** `random` picks the direction of questions about familiar words: 0.9 never asks from Russian, 0 always does. */
function setup(db: Db, allowed: number[] = [], random = () => 0.9) {
  const bot = createBot({ botToken: '1:test', allowedUserIds: new Set(allowed), dbPath: ':memory:' }, db, random);
  bot.botInfo = {
    id: 1, is_bot: true, first_name: 'Test', username: 'test_bot', can_join_groups: false,
    can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false,
    has_main_web_app: false,
  } as typeof bot.botInfo;
  const calls: Call[] = [];
  let messageId = 100;
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, any> });
    const result = method === 'sendMessage' || method === 'editMessageText'
      ? { message_id: ++messageId, date: 0, chat: { id: 7, type: 'private' } }
      : true;
    return { ok: true, result } as any;
  });
  const from = { id: 7, is_bot: false, first_name: 'U' };
  const chat = { id: 7, type: 'private' as const, first_name: 'U' };
  let updateId = 0;
  const date = () => Math.floor(Date.now() / 1000);
  return {
    calls,
    async command(text: string, userId = 7) {
      calls.length = 0;
      await bot.handleUpdate({
        update_id: ++updateId,
        message: {
          message_id: ++messageId, date: date(), chat: { ...chat, id: userId }, from: { ...from, id: userId }, text,
          entities: text.startsWith('/') ? [{ type: 'bot_command', offset: 0, length: text.split(' ')[0]!.length }] : [],
        },
      } as any);
    },
    async press(data: string) {
      calls.length = 0;
      await bot.handleUpdate({
        update_id: ++updateId,
        callback_query: {
          id: String(updateId), from, chat_instance: 'x', data,
          message: { message_id: 50, date: date(), chat, text: 'q' },
        },
      } as any);
    },
    /** A tap on a bottom-keyboard button arrives as a plain text message. */
    async say(text: string) {
      await this.command(text);
    },
    sent: () => calls.filter((c) => c.method === 'sendMessage'),
    /** Labels of the bottom keyboard attached to the last sent message. */
    keys: () =>
      ((calls.filter((c) => c.method === 'sendMessage').at(-1)?.payload.reply_markup?.keyboard ?? []) as { text: string }[][])
        .flat()
        .map((k) => k.text),
    buttons: () =>
      (calls.filter((c) => c.method === 'sendMessage').at(-1)?.payload.reply_markup?.inline_keyboard ?? []).flat() as {
        text: string;
        callback_data: string;
      }[],
  };
}

/** The test user (Telegram id 7) with a given lesson size. */
const addUser = (db: Db, lessonSize: number) =>
  db.prepare('INSERT INTO users (tg_id, lesson_size, created_at) VALUES (7, ?, 0)').run(lessonSize);
const count = (db: Db, table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
const MENU = ['📚 Учить', '📊 Прогресс', '⚙️ Настройки'];
const MENU_MORE = ['➕ Ещё урок', '📊 Прогресс', '⚙️ Настройки'];
const CONTROLS = ['🤷 Не знаю', '⏹ Хватит'];
const CONTROLS_NEW = ['🤷 Не знаю', '👌 Уже знаю', '⏹ Хватит'];

test('/start registers the user and shows the menu keyboard', async () => {
  const db = makeDb(5);
  const t = setup(db);
  await t.command('/start');
  assert.equal(t.sent().length, 1);
  assert.deepEqual(t.keys(), MENU);
  assert.equal(count(db, 'users'), 1);
});

test('a new word is asked first; options are on the bottom keyboard, translation comes after', async () => {
  const db = makeDb(8);
  const t = setup(db);
  await t.say('📚 Учить');
  const first = t.sent()[0]!.payload.text as string;
  assert.match(first, /Новое слово/);
  assert.match(first, /rec1/);
  assert.doesNotMatch(first, /слово1/, 'translation must not be in the question text');
  const keys = t.keys();
  assert.equal(keys.length, 7); // 4 options + controls
  assert.ok(keys.includes('слово1'));
  assert.deepEqual(keys.slice(4), CONTROLS_NEW);
  assert.equal(t.sent()[0]!.payload.reply_markup.resize_keyboard, true);

  await t.say('🤷 Не знаю');
  assert.equal(t.sent().length, 2, 'the card, then the next question');
  assert.match(t.sent()[0]!.payload.text, /❌.*rec1.*слово1/s);
  assert.equal(t.sent()[0]!.payload.reply_markup, undefined);
  assert.match(t.sent()[1]!.payload.text, /rec2/, 'moves on to another word instead of repeating at once');
  assert.equal(count(db, 'reviews'), 1);
});

test('guessing a new word shows its card and does not ask it again in the same lesson', async () => {
  const db = makeDb(8);
  const t = setup(db);
  addUser(db, 1);
  await t.command('/learn');
  await t.say('слово1');
  assert.equal(t.sent().length, 2, 'the card, then the end of the lesson');
  assert.match(t.sent()[0]!.payload.text, /✅.*rec1.*слово1/s);
  assert.equal(t.sent()[0]!.payload.reply_markup, undefined);
  assert.match(t.sent()[1]!.payload.text, /Урок закончен/);
});

test('every answer gets its own message with the example, separate from the next question', async () => {
  const db = makeDb(8);
  db.prepare("UPDATE words SET example_sr = 'Primer ' || lat, example_ru = 'Пример ' || ru").run();
  const t = setup(db);
  addUser(db, 2);
  await t.command('/learn');
  await t.say('🤷 Не знаю');
  await t.say('слово2');
  assert.equal(t.sent().length, 2, 'result and next question are separate messages');
  assert.match(t.sent()[0]!.payload.text, /^✅ <b>rec2<\/b> — слово2\n/);
  assert.match(t.sent()[0]!.payload.text, /Primer rec2\n<i>Пример слово2<\/i>/);
  assert.doesNotMatch(t.sent()[0]!.payload.text, /Выбери перевод/);
  // The missed word comes back at the end of the lesson, as a familiar card now.
  assert.match(t.sent()[1]!.payload.text, /^<b>rec1<\/b>\n\nВыбери перевод/);
  await t.say('слово1');
  assert.equal(t.sent().length, 2);
  assert.match(t.sent()[1]!.payload.text, /^🎉 Урок закончен/);
  assert.deepEqual(t.keys(), MENU_MORE, 'menu is back when the session is over');
});

test('"Уже знаю" marks a new word as learned and moves on; it is not offered for familiar words', async () => {
  const db = makeDb(8);
  db.prepare("UPDATE words SET example_sr = 'Primer ' || lat, example_ru = 'Пример ' || ru").run();
  const t = setup(db);
  addUser(db, 2);
  await t.command('/learn');
  await t.say('👌 Уже знаю');
  assert.equal(t.sent().length, 2, 'the card, then the next question');
  assert.match(t.sent()[0]!.payload.text, /^👌 <b>rec1<\/b> — слово1\nОтмечено как выученное/);
  assert.match(t.sent()[0]!.payload.text, /Primer rec1/);
  assert.match(t.sent()[1]!.payload.text, /rec2/);
  const card = db.prepare("SELECT state, scheduled_days, reps FROM cards WHERE word_id = 'w1'").get();
  assert.deepEqual({ ...card }, { state: 2, scheduled_days: 60, reps: 1 });
  await t.say('📊 Прогресс');
  assert.match(t.sent()[0]!.payload.text, /Выучено: 1\n/);
  assert.match(t.sent()[0]!.payload.text, /нет ответов/, 'does not count as an answer in the accuracy');

  // rec2 is missed and comes back as a familiar word: no "Уже знаю" for it.
  await t.say('🤷 Не знаю');
  assert.match(t.sent().at(-1)!.payload.text, /Урок закончен/);
  await t.say('➕ Ещё урок');
  assert.match(t.sent()[0]!.payload.text, /^<b>rec2<\/b>/);
  assert.deepEqual(t.keys().slice(4), CONTROLS);
  await t.say('👌 Уже знаю');
  assert.match(t.sent()[0]!.payload.text, /Выбери один из вариантов/);
  assert.equal(count(db, 'reviews'), 2);
});

function addReview(db: Db, cardId: number, correct: boolean): void {
  db.prepare(
    `INSERT INTO reviews (card_id, user_id, ts, rating, exercise, correct)
     VALUES (?, (SELECT id FROM users WHERE tg_id = 7), 0, ?, 'choice', ?)`,
  ).run(cardId, correct ? 3 : 1, correct ? 1 : 0);
}

/** Gives the test user a card for `wordId` that is due and has been answered correctly `reps` times. */
function addDueCard(db: Db, wordId: string, reps: number, due = 0): void {
  const { lastInsertRowid: cardId } = db.prepare(
    `INSERT INTO cards (user_id, word_id, direction, due, state, reps, stability, difficulty, scheduled_days, last_review, created_at)
     VALUES ((SELECT id FROM users WHERE tg_id = 7), ?, 'sr-ru', ?, 2, ?, 3, 5, 3, 0, 0)`,
  ).run(wordId, due, reps);
  for (let i = 0; i < reps; i++) addReview(db, Number(cardId), true);
}

test('a word answered correctly twice can be asked from Russian to Serbian', async () => {
  const db = makeDb(8);
  const t = setup(db, [], () => 0);
  addUser(db, 3);
  addDueCard(db, 'w1', 2);
  addDueCard(db, 'w2', 1);
  addDueCard(db, 'w3', 2);
  // The rest of the dictionary is not due for a long time, so the lesson is these three words.
  for (const id of ['w4', 'w5', 'w6', 'w7', 'w8']) addDueCard(db, id, 1, Date.now() + 1e10);
  await t.command('/learn');
  assert.equal(t.sent()[0]!.payload.text, '<b>слово1</b>\n\nКак это по-сербски?');
  assert.ok(t.keys().includes('rec1'));
  assert.ok(!t.keys().includes('слово1'), 'options are Serbian words');
  assert.deepEqual(t.keys().slice(4), CONTROLS);

  await t.say('rec1');
  assert.match(t.sent()[0]!.payload.text, /^✅ <b>rec1<\/b> — слово1/);
  assert.equal(count(db, "reviews WHERE exercise = 'reverse'"), 1);
  // w2 has only one correct answer so far: still asked the usual way, whatever the coin says.
  assert.match(t.sent()[1]!.payload.text, /^<b>rec2<\/b>\n\nВыбери перевод/);
  await t.say('слово2');

  assert.match(t.sent()[1]!.payload.text, /слово3.*Как это по-сербски/s);
  const wrong = t.keys().find((k) => k.startsWith('rec') && k !== 'rec3')!;
  await t.say(wrong);
  const n = wrong.slice(3);
  assert.match(t.sent()[0]!.payload.text, new RegExp(`^❌ <b>rec3</b> — слово3\\nТвой ответ: rec${n} \\(это слово${n}\\)`));
});

/** A lesson of w1, w2, w3, w4, each already answered correctly twice; nothing else is due. */
function familiarWords(db: Db): void {
  addUser(db, 4);
  for (const id of ['w1', 'w2', 'w3', 'w4']) addDueCard(db, id, 2);
  for (const id of ['w5', 'w6', 'w7', 'w8']) addDueCard(db, id, 1, Date.now() + 1e10);
}

test('the keyboard follows the direction of each question', async () => {
  const db = makeDb(8);
  const coin = [0, 0.9, 0.9, 0];
  const t = setup(db, [], () => coin.shift() ?? 0.9);
  familiarWords(db);
  await t.command('/learn');
  assert.ok(t.keys().includes('rec1'), 'from Russian: Serbian options');
  await t.say('rec1');
  assert.match(t.sent()[1]!.payload.text, /<b>rec2<\/b>/);
  assert.ok(t.keys().includes('слово2') && !t.keys().some((k) => k.startsWith('rec')), 'from Serbian: Russian options');
  await t.say('слово2');
  assert.ok(t.keys().includes('слово3'));
  await t.say('слово3');
  assert.ok(t.keys().includes('rec4') && !t.keys().some((k) => k.startsWith('слово')));
});

test('a tap on a button left over from the previous question brings the right buttons back', async () => {
  const db = makeDb(8);
  const coin = [0, 0.9];
  const t = setup(db, [], () => coin.shift() ?? 0.9);
  familiarWords(db);
  await t.command('/learn');
  const stale = t.keys().find((k) => k.startsWith('rec') && k !== 'rec1')!;
  await t.say('rec1');
  const current = t.keys();
  await t.say(stale);
  assert.equal(t.sent().length, 1);
  assert.match(t.sent()[0]!.payload.text, /<b>rec2<\/b>/);
  assert.deepEqual(t.keys(), current);
  assert.equal(count(db, 'reviews WHERE ts > 0'), 1, 'the stale tap is not counted as an answer');
});

test('questions from Russian use the alphabet from the settings', async () => {
  const db = makeDb(8);
  const t = setup(db, [], () => 0);
  addUser(db, 1);
  db.prepare("UPDATE users SET script = 'cyr'").run();
  addDueCard(db, 'w1', 2);
  await t.command('/learn');
  assert.ok(t.keys().includes('реч1'));
  await t.say('реч1');
  assert.match(t.sent()[0]!.payload.text, /^✅ <b>реч1<\/b> — слово1/);
});

test('false-friend warnings are not shown, ordinary notes are', async () => {
  const db = makeDb(8);
  db.prepare("UPDATE words SET note = 'Не «рец»', false_friend = 1 WHERE id = 'w1'").run();
  db.prepare("UPDATE words SET note = 'Только множественное число.' WHERE id = 'w2'").run();
  const t = setup(db);
  await t.command('/learn');
  await t.say('слово1');
  assert.doesNotMatch(t.sent()[0]!.payload.text, /Ложный друг|Не «рец»/);
  await t.say('слово2');
  assert.match(t.sent()[0]!.payload.text, /💡 Только множественное число\./);
});

test('"Ещё урок" starts another lesson right away, any number of times', async () => {
  const db = makeDb(8);
  const t = setup(db);
  addUser(db, 2);
  const finishLesson = async () => {
    for (let i = 0; i < 40; i++) {
      const p = db.prepare('SELECT w.ru FROM pending_questions q JOIN cards c ON c.id = q.card_id JOIN words w ON w.id = c.word_id').get() as { ru: string } | undefined;
      if (!p) return;
      await t.say(p.ru);
    }
  };
  await t.say('📚 Учить');
  await finishLesson();
  assert.equal(count(db, 'cards'), 2);
  assert.match(t.sent().at(-1)!.payload.text, /Ещё урок/);

  await t.say('➕ Ещё урок');
  assert.match(t.sent()[0]!.payload.text, /Новое слово/);
  await finishLesson();
  assert.equal(count(db, 'cards'), 4);
  await t.say('➕ Ещё урок');
  await finishLesson();
  assert.equal(count(db, 'cards'), 6);

  // Dictionary has 8 words: the last lesson takes the remaining 2, then the offer disappears.
  await t.say('➕ Ещё урок');
  await finishLesson();
  assert.equal(count(db, 'cards'), 8);
  assert.match(t.sent().at(-1)!.payload.text, /закончились/);
  assert.deepEqual(t.keys(), MENU);
  await t.say('📚 Учить');
  assert.match(t.sent()[0]!.payload.text, /Повторять пока нечего/);
  assert.equal(t.sent().length, 1);
});

test('text that is not an option does not count as an answer', async () => {
  const db = makeDb(8);
  const t = setup(db);
  await t.say('привет');
  assert.deepEqual(t.keys(), MENU);
  await t.command('/learn');
  const asked = t.keys();
  await t.say('что-то не то');
  assert.match(t.sent()[0]!.payload.text, /^Выбери один из вариантов.*rec1/s);
  assert.deepEqual(t.keys(), asked, 'the question comes again with the same buttons');
  assert.equal(count(db, 'reviews'), 0);
  await t.say('слово1');
  assert.equal(count(db, 'reviews'), 1);
});

test('"Хватит" ends the session and brings the menu back', async () => {
  const db = makeDb(8);
  const t = setup(db);
  await t.command('/learn');
  await t.say('⏹ Хватит');
  assert.deepEqual(t.keys(), MENU);
  await t.say('слово1'); // no longer an answer
  assert.equal(count(db, 'reviews'), 0);
  await t.say('📚 Учить');
  assert.match(t.sent()[0]!.payload.text, /rec1/, 'the unanswered word is asked again');
});

test('long translations get one button per row, short ones two', async () => {
  const short = makeDb(8);
  const t1 = setup(short);
  await t1.command('/learn');
  assert.deepEqual((t1.sent()[0]!.payload.reply_markup.keyboard as unknown[][]).map((r) => r.length), [2, 2, 3]);

  const long = makeDb(8);
  long.prepare("UPDATE words SET ru = ru || ' — очень длинный перевод'").run();
  const t2 = setup(long);
  await t2.command('/learn');
  assert.deepEqual((t2.sent()[0]!.payload.reply_markup.keyboard as unknown[][]).map((r) => r.length), [1, 1, 1, 1, 3]);
});

test('/stats and /settings work from commands and from menu buttons', async () => {
  const db = makeDb(5);
  const t = setup(db);
  await t.say('📊 Прогресс');
  assert.match(t.sent()[0]!.payload.text, /Выучено: 0\nВ изучении: 0/);
  await t.say('⚙️ Настройки');
  assert.ok(t.buttons().some((b) => b.callback_data === 's:script:cyr'));
  await t.press('s:script:cyr');
  await t.press('s:size:30');
  await t.press('s:rem:off');
  const user = db.prepare('SELECT script, lesson_size, remind_at FROM users').get();
  assert.deepEqual({ ...user }, { script: 'cyr', lesson_size: 30, remind_at: null });
  await t.command('/learn');
  assert.match(t.sent()[0]!.payload.text, /реч1/);
  await t.command('/tz Europe/Moscow');
  await t.command('/tz Nowhere/Land');
  assert.equal((db.prepare('SELECT tz FROM users').get() as { tz: string }).tz, 'Europe/Moscow');
});

test('progress can be reset from the settings, after a confirmation', async () => {
  const db = makeDb(8);
  const t = setup(db);
  addUser(db, 2);
  db.prepare("UPDATE users SET script = 'cyr'").run();
  await t.command('/learn');
  await t.say('слово1');
  assert.equal(count(db, 'cards'), 2); // one answered, one being asked
  await t.say('⚙️ Настройки');
  assert.ok(t.buttons().some((b) => b.callback_data === 'reset:ask'));

  await t.press('reset:ask');
  const confirm = t.calls.find((c) => c.method === 'editMessageText')!;
  assert.match(confirm.payload.text, /Сбросить прогресс\?/);
  assert.equal(count(db, 'cards'), 2, 'nothing is deleted before the confirmation');
  await t.press('reset:no');
  assert.match(t.calls.find((c) => c.method === 'editMessageText')!.payload.text, /Настройки/);
  assert.equal(count(db, 'cards'), 2);

  await t.press('reset:yes');
  for (const table of ['cards', 'reviews', 'pending_questions', 'lesson_items']) assert.equal(count(db, table), 0, table);
  assert.equal((db.prepare('SELECT script, lesson_size FROM users').get() as { script: string }).script, 'cyr');
  assert.match(t.sent()[0]!.payload.text, /Прогресс сброшен/);
  assert.deepEqual(t.keys(), MENU);
  await t.say('📚 Учить');
  assert.match(t.sent()[0]!.payload.text, /Новое слово/);
  assert.match(t.sent()[0]!.payload.text, /реч1/);
});

test('reset only touches the user who asked', async () => {
  const db = makeDb(8);
  const t = setup(db);
  await t.command('/learn', 8);
  await t.command('слово1', 8);
  await t.command('/start');
  await t.press('reset:yes');
  assert.equal(count(db, 'cards'), 2);
  assert.equal(count(db, 'reviews'), 1);
});

test('buttons from older messages get a hint instead of silence', async () => {
  const db = makeDb(5);
  const t = setup(db);
  for (const data of ['a:1:0:w1', 's:new:20']) {
    await t.press(data);
    assert.match(t.calls.find((c) => c.method === 'answerCallbackQuery')!.payload.text, /устарела/);
  }
  assert.equal(count(db, 'reviews'), 0);
});

test('whitelist rejects other users', async () => {
  const db = makeDb(5);
  const t = setup(db, [42]);
  await t.command('/start');
  assert.match(t.sent()[0]!.payload.text, /закрытый/);
  assert.equal(count(db, 'users'), 0);
});
