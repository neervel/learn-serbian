export interface Config {
  botToken: string;
  /** Telegram user ids allowed to use the bot. Empty = everyone. */
  allowedUserIds: Set<number>;
  dbPath: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const botToken = env.BOT_TOKEN?.trim();
  if (!botToken) {
    throw new Error('BOT_TOKEN is not set. Copy .env.example to .env and put the token from @BotFather there.');
  }
  const allowedUserIds = new Set<number>();
  for (const part of (env.ALLOWED_USER_IDS ?? '').split(',')) {
    const trimmed = part.trim();
    if (trimmed === '') continue;
    const id = Number(trimmed);
    if (!Number.isSafeInteger(id)) throw new Error(`ALLOWED_USER_IDS: "${trimmed}" is not a numeric Telegram id`);
    allowedUserIds.add(id);
  }
  return { botToken, allowedUserIds, dbPath: env.DB_PATH?.trim() || 'data/app.db' };
}
