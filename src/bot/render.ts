import type { Stats } from '../stats.ts';
import { latToCyr } from '../translit.ts';
import type { User, Word } from '../types.ts';

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** The Serbian word in the user's script. */
export function sr(word: Word, user: User): string {
  return user.script === 'cyr' ? word.cyr : word.lat;
}

/** Any Latin-script Serbian text (examples, verb forms) in the user's script. */
function srText(lat: string, user: User): string {
  return user.script === 'cyr' ? latToCyr(lat) : lat;
}

const POS: Record<string, string> = {
  noun: 'сущ.',
  verb: 'глаг.',
  adj: 'прил.',
  adv: 'нареч.',
  pron: 'мест.',
  prep: 'предлог',
  conj: 'союз',
  num: 'числ.',
  part: 'частица',
  intj: 'межд.',
  phrase: 'фраза',
};
const GENDER: Record<string, string> = { m: 'м. р.', f: 'ж. р.', n: 'ср. р.' };
const ASPECT: Record<string, string> = { impf: 'несов.', pf: 'сов.', both: 'сов. и несов.' };

function grammarLine(word: Word, user: User): string {
  const bits: string[] = [];
  const pos = POS[word.pos];
  if (pos) bits.push(pos);
  if (word.gender && GENDER[word.gender]) bits.push(GENDER[word.gender]!);
  if (word.aspect && ASPECT[word.aspect]) bits.push(ASPECT[word.aspect]!);
  if (word.pres1sg) bits.push(`я: ${srText(word.pres1sg, user)}`);
  if (word.pair) bits.push(`пара: ${srText(word.pair, user)}`);
  return bits.join(', ');
}

function details(word: Word, user: User): string {
  const lines: string[] = [];
  const grammar = grammarLine(word, user);
  if (grammar) lines.push(`<i>${esc(grammar)}</i>`);
  if (word.example_sr) {
    lines.push('');
    lines.push(esc(srText(word.example_sr, user)));
    if (word.example_ru) lines.push(`<i>${esc(word.example_ru)}</i>`);
  }
  // Notes that only warn about a false friend ("not the Russian X") are not shown.
  if (word.note && !word.false_friend) {
    lines.push('');
    lines.push(`💡 ${esc(word.note)}`);
  }
  return lines.join('\n');
}

export function questionText(word: Word, user: User, isNew: boolean): string {
  const head = isNew ? '🆕 Новое слово\n\n' : '';
  const ask = isNew ? 'Как думаешь, что это значит?' : 'Выбери перевод:';
  return `${head}<b>${esc(sr(word, user))}</b>\n\n${ask}`;
}

/** Result of an answer: always the full card, with grammar and an example. */
export function answerText(word: Word, user: User, result: { correct: boolean; chosen: Word | undefined }): string {
  const head = `${result.correct ? '✅' : '❌'} <b>${esc(sr(word, user))}</b> — ${esc(word.ru)}`;
  const wrong =
    !result.correct && result.chosen
      ? `\nТвой ответ: ${esc(result.chosen.ru)} (это ${esc(sr(result.chosen, user))})`
      : '';
  return `${head}${wrong}\n${details(word, user)}`.trimEnd();
}

/** Card of a word the user marked as already known. */
export function knownText(word: Word, user: User): string {
  return `👌 <b>${esc(sr(word, user))}</b> — ${esc(word.ru)}\nОтмечено как выученное.\n${details(word, user)}`.trimEnd();
}

const NOTHING_LEFT = 'Повторять пока нечего, а новые слова в словаре закончились.';

/** End of a lesson; `moreLabel` is the button that starts the next one, if there is anything for it. */
export function lessonDoneText(moreLabel: string | null): string {
  return `🎉 Урок закончен!\n\n${moreLabel ? `Хочешь ещё? Нажми «${moreLabel}».` : NOTHING_LEFT}`;
}

/** Reply to "learn" when a lesson cannot be put together. */
export function nothingToLearnText(noWords: boolean): string {
  return noWords ? 'В словаре пока нет слов. Загрузи их командой <code>npm run import-words</code>.' : NOTHING_LEFT;
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function words(n: number): string {
  return `${n} ${plural(n, 'слово', 'слова', 'слов')}`;
}

export function statsText(s: Stats): string {
  const accuracy =
    s.accuracy7d === null ? 'нет ответов' : `${Math.round(s.accuracy7d * 100)}% (${s.answers7d} отв.)`;
  return [
    '<b>Прогресс</b>',
    `Выучено: ${s.learned}`,
    `В изучении: ${s.learning}`,
    '',
    `Точность за 7 дней: ${accuracy}`,
    `Серия: ${s.streakDays} ${plural(s.streakDays, 'день', 'дня', 'дней')} подряд`,
  ].join('\n');
}

export function settingsText(user: User): string {
  return [
    '<b>Настройки</b>',
    `Алфавит: ${user.script === 'cyr' ? 'ћирилица' : 'latinica'}`,
    `Слов в уроке: ${user.lesson_size}`,
    `Напоминание: ${user.remind_at ?? 'выключено'}`,
    `Часовой пояс: ${esc(user.tz)}`,
    '',
    'Сменить часовой пояс: <code>/tz Europe/Moscow</code>',
  ].join('\n');
}

export function reminderText(due: number, fresh: number): string {
  const parts: string[] = [];
  if (due > 0) parts.push(`${words(due)} на повтор`);
  if (fresh > 0) parts.push(`${fresh} ${plural(fresh, 'новое', 'новых', 'новых')}`);
  return `⏰ Время сербского: ${parts.join(' и ')}.`;
}

export const START_TEXT = [
  'Zdravo! Это бот для изучения сербских слов.',
  '',
  'В каждом уроке — повторение старых слов и немного новых. Новое слово сначала попробуй угадать — многие похожи на русские. Не угадал — бот покажет перевод и пример и спросит ещё раз позже. Чем лучше помнишь слово, тем реже оно появляется.',
  '',
  'Кнопки управления — внизу, под полем ввода.',
  '',
  'Напоминание придёт в 19:00 по Белграду — это меняется в настройках.',
].join('\n');
