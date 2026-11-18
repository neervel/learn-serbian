// Loads content/words/*.json into the database. Safe to run repeatedly:
// words are updated in place by id, learning progress is never touched.
// Words that disappeared from the content are hidden, not deleted.
//
// Usage: node scripts/import-words.ts   (DB_PATH overrides data/app.db)

import { dbPathFromEnv } from '../src/config.ts';
import { loadAllWords } from '../src/content.ts';
import { openDb, transaction } from '../src/db/db.ts';
import { countActiveWords, deactivateWordsExcept, upsertWord } from '../src/db/repo.ts';

const words = loadAllWords();
const db = openDb(dbPathFromEnv());
const before = countActiveWords(db);
const hidden = transaction(db, () => {
  for (const w of words) upsertWord(db, w);
  return deactivateWordsExcept(db, words.map((w) => w.id));
});
console.log(`imported ${words.length} words (was ${before}, now ${countActiveWords(db)}, hidden ${hidden})`);
db.close();
