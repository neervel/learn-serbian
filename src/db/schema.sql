CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY,
  tg_id       INTEGER NOT NULL UNIQUE,
  script      TEXT    NOT NULL DEFAULT 'lat' CHECK (script IN ('lat', 'cyr')),
  lesson_size INTEGER NOT NULL DEFAULT 20,            -- words per lesson
  remind_at   TEXT,                                   -- 'HH:MM' in user's tz, NULL = off
  tz          TEXT    NOT NULL DEFAULT 'Europe/Belgrade',
  last_reminded_on TEXT,                              -- 'YYYY-MM-DD' in user's tz
  created_at  INTEGER NOT NULL                        -- unix ms
);

CREATE TABLE IF NOT EXISTS words (
  id           TEXT PRIMARY KEY,
  lat          TEXT NOT NULL,
  cyr          TEXT NOT NULL,
  ru           TEXT NOT NULL,
  pos          TEXT NOT NULL,
  gender       TEXT,
  pres1sg      TEXT,
  aspect       TEXT,
  pair         TEXT,
  rank         INTEGER NOT NULL,
  tags         TEXT NOT NULL DEFAULT '[]',            -- JSON array
  false_friend INTEGER NOT NULL DEFAULT 0,
  note         TEXT,
  example_sr   TEXT,
  example_ru   TEXT,
  active       INTEGER NOT NULL DEFAULT 1             -- 0 = removed from content, hidden from new cards
);
CREATE INDEX IF NOT EXISTS words_rank ON words (rank);

CREATE TABLE IF NOT EXISTS cards (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users (id),
  word_id     TEXT    NOT NULL REFERENCES words (id),
  direction   TEXT    NOT NULL CHECK (direction IN ('sr-ru', 'ru-sr')),
  due         INTEGER NOT NULL,                       -- unix ms
  stability   REAL    NOT NULL DEFAULT 0,
  difficulty  REAL    NOT NULL DEFAULT 0,
  state       INTEGER NOT NULL DEFAULT 0,             -- ts-fsrs State: 0 New, 1 Learning, 2 Review, 3 Relearning
  reps        INTEGER NOT NULL DEFAULT 0,
  lapses      INTEGER NOT NULL DEFAULT 0,
  scheduled_days INTEGER NOT NULL DEFAULT 0,
  learning_steps INTEGER NOT NULL DEFAULT 0,
  last_review INTEGER,                                -- unix ms
  created_at  INTEGER NOT NULL,                       -- unix ms
  UNIQUE (user_id, word_id, direction)
);
CREATE INDEX IF NOT EXISTS cards_user_due ON cards (user_id, due);

CREATE TABLE IF NOT EXISTS reviews (
  id         INTEGER PRIMARY KEY,
  card_id    INTEGER NOT NULL REFERENCES cards (id),
  user_id    INTEGER NOT NULL REFERENCES users (id),
  ts         INTEGER NOT NULL,                        -- unix ms
  rating     INTEGER NOT NULL,                        -- ts-fsrs Rating: 1 Again, 2 Hard, 3 Good, 4 Easy
  exercise   TEXT    NOT NULL,                        -- 'choice' | 'reverse' | 'known'
  answer     TEXT,
  correct    INTEGER NOT NULL,
  elapsed_ms INTEGER
);
CREATE INDEX IF NOT EXISTS reviews_user_ts ON reviews (user_id, ts);

-- The question each user is currently looking at. Answers arrive as plain text
-- from the reply keyboard, so the bot has to remember what was asked.
CREATE TABLE IF NOT EXISTS pending_questions (
  user_id INTEGER PRIMARY KEY REFERENCES users (id),
  card_id INTEGER NOT NULL REFERENCES cards (id),
  reps    INTEGER NOT NULL,                           -- card's review count when asked
  direction TEXT  NOT NULL DEFAULT 'sr-ru',           -- 'sr-ru' | 'ru-sr': which way the question is asked
  options TEXT    NOT NULL,                           -- JSON array of word ids, in keyboard order
  sent_at INTEGER NOT NULL                            -- unix ms
);

-- Words of the lesson a user is taking, in the order they will be asked.
-- A word leaves the list once it is answered correctly.
CREATE TABLE IF NOT EXISTS lesson_items (
  user_id INTEGER NOT NULL REFERENCES users (id),
  pos     INTEGER NOT NULL,
  word_id TEXT    NOT NULL REFERENCES words (id),
  PRIMARY KEY (user_id, pos)
);
