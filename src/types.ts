export type Script = 'lat' | 'cyr';
export type Direction = 'sr-ru' | 'ru-sr';
/** 'known' only appears in reviews recorded by an earlier version of the bot. */
export type Exercise = 'choice' | 'typed' | 'known';

export interface User {
  id: number;
  tg_id: number;
  script: Script;
  new_per_day: number;
  remind_at: string | null;
  tz: string;
  last_reminded_on: string | null;
  created_at: number;
}

export interface Word {
  id: string;
  lat: string;
  cyr: string;
  ru: string;
  pos: string;
  gender: string | null;
  pres1sg: string | null;
  aspect: string | null;
  pair: string | null;
  rank: number;
  tags: string; // JSON array
  false_friend: number;
  note: string | null;
  example_sr: string | null;
  example_ru: string | null;
  active: number;
}

/** Spaced-repetition state of a card, as stored in the DB. */
export interface SrsState {
  due: number;
  stability: number;
  difficulty: number;
  state: number;
  reps: number;
  lapses: number;
  scheduled_days: number;
  learning_steps: number;
  last_review: number | null;
}

export interface Card extends SrsState {
  id: number;
  user_id: number;
  word_id: string;
  direction: Direction;
  created_at: number;
}

/** Shape of an entry in content/words/*.json. */
export interface WordEntry {
  id: string;
  lat: string;
  cyr: string;
  ru: string;
  pos: string;
  rank: number;
  gender?: 'm' | 'f' | 'n';
  pres1sg?: string;
  aspect?: 'impf' | 'pf' | 'both';
  pair?: string;
  tags?: string[];
  falseFriend?: boolean;
  note?: string;
  example?: { sr: string; ru: string };
}
