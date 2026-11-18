import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

const SCHEMA = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

/** Opens (and creates if needed) the database. Pass ':memory:' for tests. */
export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/** Brings a database created by an older version up to the current schema. */
function migrate(db: Db): void {
  const userColumns = db.prepare('PRAGMA table_info(users)').all() as unknown as { name: string }[];
  // The per-day limit on new words became the size of a lesson.
  if (userColumns.some((c) => c.name === 'new_per_day')) {
    db.exec('ALTER TABLE users RENAME COLUMN new_per_day TO lesson_size');
  }
  db.exec('DROP TABLE IF EXISTS extra_new');
}

export function transaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
