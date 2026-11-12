import { cyrToLat } from '../text/translit.ts';

export type CheckResult = 'exact' | 'close' | 'wrong';

function normalize(s: string): string {
  return cyrToLat(s.normalize('NFC').trim().toLowerCase()).replace(/\s+/g, ' ');
}

/** š -> s, č/ć -> c, ž -> z, đ -> dj (also accepts plain "d" via the caller's second pass). */
function stripDiacritics(s: string, dj: string): string {
  return s
    .replace(/š/g, 's')
    .replace(/[čć]/g, 'c')
    .replace(/ž/g, 'z')
    .replace(/đ/g, dj);
}

/**
 * Checks a typed Serbian answer. Accepts either script. An answer that only
 * differs in diacritics (typed on a keyboard without š/č/ć/ž/đ) is 'close'.
 */
export function checkTyped(answer: string, expected: string): CheckResult {
  const a = normalize(answer);
  const e = normalize(expected);
  if (a === '') return 'wrong';
  if (a === e) return 'exact';
  const plainA = [stripDiacritics(a, 'dj'), stripDiacritics(a, 'd')];
  const plainE = [stripDiacritics(e, 'dj'), stripDiacritics(e, 'd')];
  return plainA.some((x) => plainE.includes(x)) ? 'close' : 'wrong';
}
