import { COMMANDS, createBot, menuKeyboard } from './bot/handlers.ts';
import { startReminders } from './bot/reminders.ts';
import { loadConfig } from './config.ts';
import { openDb } from './db/db.ts';
import { countActiveWords } from './db/repo.ts';

const config = loadConfig();
const db = openDb(config.dbPath);

const wordCount = countActiveWords(db);
if (wordCount === 0) {
  console.warn('The dictionary is empty. Run "npm run import-words" first.');
}

const bot = createBot(config, db);
await bot.api.setMyCommands(COMMANDS);
const stopReminders = startReminders(bot, db, menuKeyboard());

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`${signal} received, stopping`);
  stopReminders();
  await bot.stop();
  db.close();
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

await bot.start({
  onStart: (me) => console.log(`@${me.username} is running, ${wordCount} words in the dictionary`),
});
