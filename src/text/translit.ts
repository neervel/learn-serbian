// Serbian Latin <-> Cyrillic.
// Cyrillic -> Latin is unambiguous. Latin -> Cyrillic is ambiguous for the
// digraphs lj / nj / dž at morpheme boundaries (injekcija, nadživeti), so the
// content files store both forms and this direction is only used to generate a
// draft that gets proofread.

const CYR_TO_LAT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', ђ: 'đ', е: 'e', ж: 'ž', з: 'z', и: 'i',
  ј: 'j', к: 'k', л: 'l', љ: 'lj', м: 'm', н: 'n', њ: 'nj', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', ћ: 'ć', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'č', џ: 'dž', ш: 'š',
};

const LAT_DIGRAPHS: Record<string, string> = { lj: 'љ', nj: 'њ', dž: 'џ' };

const LAT_TO_CYR: Record<string, string> = Object.fromEntries(
  Object.entries(CYR_TO_LAT)
    .filter(([, lat]) => lat.length === 1)
    .map(([cyr, lat]) => [lat, cyr]),
);

// Words where a digraph-looking pair is actually two separate letters.
// Keys are lowercase Latin; values are the correct Cyrillic.
const LAT_TO_CYR_EXCEPTIONS: Record<string, string> = {
  injekcija: 'инјекција',
  konjunkcija: 'конјункција',
  konjugacija: 'конјугација',
  nadživeti: 'надживети',
  odžaliti: 'оджалити',
  tanjug: 'танјуг',
  vanjezički: 'ванјезички',
};

function isUpper(ch: string): boolean {
  return ch !== ch.toLowerCase() && ch === ch.toUpperCase();
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function cyrToLat(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    const lat = CYR_TO_LAT[ch.toLowerCase()];
    if (lat === undefined) {
      out += ch;
    } else if (!isUpper(ch)) {
      out += lat;
    } else {
      // Љубав -> Ljubav, but ЉУБАВ -> LJUBAV
      const next = text.charAt(i + 1);
      const allCaps = lat.length > 1 && next !== '' && isUpper(next);
      out += allCaps ? lat.toUpperCase() : capitalize(lat);
    }
  }
  return out;
}

function latWordToCyr(word: string): string {
  const exception = LAT_TO_CYR_EXCEPTIONS[word.toLowerCase()];
  if (exception !== undefined) {
    return isUpper(word.charAt(0)) ? capitalize(exception) : exception;
  }
  let out = '';
  for (let i = 0; i < word.length; i++) {
    const ch = word.charAt(i);
    const pair = word.slice(i, i + 2);
    const digraph = LAT_DIGRAPHS[pair.toLowerCase()];
    if (digraph !== undefined) {
      out += isUpper(ch) ? digraph.toUpperCase() : digraph;
      i++;
      continue;
    }
    const cyr = LAT_TO_CYR[ch.toLowerCase()];
    if (cyr === undefined) out += ch;
    else out += isUpper(ch) ? cyr.toUpperCase() : cyr;
  }
  return out;
}

export function latToCyr(text: string): string {
  return text.replace(/[\p{L}]+/gu, latWordToCyr);
}
