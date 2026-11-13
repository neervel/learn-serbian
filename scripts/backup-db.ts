// Writes a consistent copy of the database to data/backups/app-YYYY-MM-DD.db
// (safe while the bot is running) and keeps the most recent 14 copies.
//
// Usage: node scripts/backup-db.ts   (DB_PATH overrides data/app.db)

import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const KEEP = 14;
const dbPath = process.env.DB_PATH?.trim() || 'data/app.db';
const dir = join(dirname(dbPath), 'backups');
const target = join(dir, `app-${new Date().toISOString().slice(0, 10)}.db`);

if (!existsSync(dbPath)) {
  console.error(`${dbPath} does not exist, nothing to back up`);
  process.exit(1);
}
mkdirSync(dir, { recursive: true });
rmSync(target, { force: true }); // VACUUM INTO refuses to overwrite
const db = new DatabaseSync(dbPath);
db.prepare('VACUUM INTO ?').run(target);
db.close();

const copies = readdirSync(dir).filter((f) => /^app-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
for (const old of copies.slice(0, -KEEP)) rmSync(join(dir, old));
console.log(`${new Date().toISOString()} backup written: ${target} (${Math.min(copies.length, KEEP)} kept)`);
