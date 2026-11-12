// Builds a frequency-ordered list of Serbian lemmas with basic grammar data.
// The output (data/raw/lemmas.tsv) is a working draft for writing
// content/words/*.json — it is not used by the bot itself.
//
// Inputs, downloaded into data/raw/ if missing:
//   sr_50k.txt       word-form frequencies from film subtitles (hermitdave/FrequencyWords)
//   kaikki-sh.jsonl  Wiktionary Serbo-Croatian entries (kaikki.org), ~390 MB
//
// Usage: node scripts/build-lemmas.ts [limit=1500]

import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const RAW = new URL('../data/raw/', import.meta.url);
const SOURCES = {
  'sr_50k.txt': 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/sr/sr_50k.txt',
  'kaikki-sh.jsonl': 'https://kaikki.org/dictionary/Serbo-Croatian/kaikki.org-dictionary-SerboCroatian.jsonl',
};

const LATIN_WORD = /^[a-zčćžšđ]+$/;
const KEEP = new Set('čćžšđ');
// Form tags that mark something other than an inflected form of the same word.
const NOT_INFLECTION = new Set([
  'Cyrillic', 'romanization', 'table-tags', 'inflection-template', 'class',
  'diminutive', 'augmentative', 'relational', 'noun-from-verb', 'comparative', 'superlative',
  'error-unrecognized-form', 'alternative', 'feminine-equivalent', 'masculine-equivalent',
]);

/** Lowercases and removes pitch-accent marks (kȕća -> kuća) while keeping č ć ž š đ. */
function plain(s: string): string {
  let out = '';
  for (const ch of s.normalize('NFC').toLowerCase()) {
    out += KEEP.has(ch) ? ch : ch.normalize('NFD').replace(/\p{M}/gu, '');
  }
  return out;
}

interface Lemma {
  word: string;
  pos: string;
  gender: string;
  aspect: string;
  pres1sg: string;
  gloss: string;
  count: number;
  forms: Map<string, number>;
}

async function download(name: keyof typeof SOURCES): Promise<void> {
  const target = new URL(name, RAW);
  if (existsSync(target)) return;
  console.log(`downloading ${name} ...`);
  const res = await fetch(SOURCES[name]);
  if (!res.ok || !res.body) throw new Error(`${SOURCES[name]}: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(target));
}

const limit = Number(process.argv[2] ?? 1500);
mkdirSync(RAW, { recursive: true });
await download('sr_50k.txt');
await download('kaikki-sh.jsonl');

const lemmas = new Map<string, Lemma>(); // key: word|pos
const lemmasByWord = new Map<string, Lemma[]>();
const formToLemma = new Map<string, Set<string>>(); // form -> lemma words

function link(form: string, lemmaWord: string): void {
  if (!LATIN_WORD.test(form) || form === lemmaWord) return;
  let set = formToLemma.get(form);
  if (!set) formToLemma.set(form, (set = new Set()));
  set.add(lemmaWord);
}

const lines = createInterface({ input: createReadStream(new URL('kaikki-sh.jsonl', RAW)), crlfDelay: Infinity });
for await (const line of lines) {
  if (line === '') continue;
  const entry = JSON.parse(line) as {
    word: string;
    pos: string;
    head_templates?: { name: string; args: Record<string, string> }[];
    senses?: { glosses?: string[]; form_of?: { word: string }[]; tags?: string[] }[];
    forms?: { form: string; tags?: string[] }[];
  };
  const word = plain(entry.word);
  if (!LATIN_WORD.test(word)) continue;
  const senses = entry.senses ?? [];

  const formOf = senses.flatMap((s) => s.form_of ?? []);
  for (const target of formOf) link(word, plain(target.word));
  // Entries that are only "form of X" are not lemmas themselves.
  if (senses.length > 0 && senses.every((s) => s.form_of && s.form_of.length > 0)) continue;

  const head = entry.head_templates?.[0];
  const arg2 = head?.args['2'] ?? '';
  const lemma: Lemma = {
    word,
    pos: entry.pos,
    gender: head?.name === 'sh-noun' ? arg2.replace(/-.*/, '') : '',
    aspect: head?.name === 'sh-verb' ? arg2 : '',
    pres1sg: '',
    gloss: senses.find((s) => !s.form_of && s.glosses?.[0])?.glosses?.[0] ?? '',
    count: 0,
    forms: new Map(),
  };
  for (const f of entry.forms ?? []) {
    const tags = f.tags ?? [];
    if (tags.some((t) => NOT_INFLECTION.has(t))) continue;
    const form = plain(f.form);
    link(form, word);
    if (!lemma.pres1sg && tags.includes('first-person') && tags.includes('present') && tags.includes('singular')) {
      lemma.pres1sg = form;
    }
  }
  const key = `${word}|${entry.pos}`;
  if (!lemmas.has(key)) {
    lemmas.set(key, lemma);
    lemmasByWord.set(word, [...(lemmasByWord.get(word) ?? []), lemma]);
  }
}
console.log(`${lemmas.size} lemmas, ${formToLemma.size} inflected forms`);

// Attribute every word form's frequency to a lemma. A form that is a lemma in
// its own right stays itself; otherwise it goes to the lemma(s) it inflects.
let unknown = 0;
const unknownTop: string[] = [];
for (const row of readFileSync(new URL('sr_50k.txt', RAW), 'utf8').split('\n')) {
  const [rawForm, rawCount] = row.split(' ');
  if (!rawForm || !rawCount) continue;
  const form = plain(rawForm);
  const count = Number(rawCount);
  const targets = lemmasByWord.has(form) ? [form] : [...(formToLemma.get(form) ?? [])];
  const owners = targets.flatMap((t) => lemmasByWord.get(t)?.slice(0, 1) ?? []);
  if (owners.length === 0) {
    unknown++;
    if (unknownTop.length < 300) unknownTop.push(`${form}\t${count}`);
    continue;
  }
  for (const lemma of owners) {
    lemma.count += count / owners.length;
    lemma.forms.set(form, count);
  }
}

const ranked = [...lemmas.values()]
  .filter((l) => l.count > 0)
  .sort((a, b) => b.count - a.count)
  .slice(0, limit);

const header = 'rank\tlemma\tpos\tgender\taspect\tpres1sg\tcount\tforms\tgloss_en';
const body = ranked.map((l, i) => {
  const forms = [...l.forms.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([f]) => f).join(',');
  return [i + 1, l.word, l.pos, l.gender, l.aspect, l.pres1sg, Math.round(l.count), forms, l.gloss.slice(0, 80)].join('\t');
});
writeFileSync(new URL('lemmas.tsv', RAW), [header, ...body].join('\n') + '\n');
writeFileSync(new URL('unknown-forms.tsv', RAW), unknownTop.join('\n') + '\n');
console.log(`wrote data/raw/lemmas.tsv (${ranked.length} lemmas); ${unknown} forms had no dictionary entry`);
