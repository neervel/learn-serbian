// Time helpers in the user's time zone. All timestamps are unix ms.

export const DAY_MS = 24 * 60 * 60 * 1000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
}

function parts(ts: number, tz: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of formatter(tz).formatToParts(new Date(ts))) out[p.type] = p.value;
  return out;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** 'YYYY-MM-DD' in the given time zone. */
export function localDate(ts: number, tz: string): string {
  const p = parts(ts, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

/** 'HH:MM' in the given time zone. */
export function localTime(ts: number, tz: string): string {
  const p = parts(ts, tz);
  return `${p.hour}:${p.minute}`;
}

/**
 * Timestamp of the most recent local midnight. On the two DST-switch days a
 * year this is off by an hour, which is fine for "has the user studied today".
 */
export function startOfLocalDay(ts: number, tz: string): number {
  const p = parts(ts, tz);
  const sinceMidnight =
    (Number(p.hour) * 3600 + Number(p.minute) * 60 + Number(p.second)) * 1000 + (ts % 1000);
  return ts - sinceMidnight;
}

/** 'YYYY-MM-DD' shifted by whole days (calendar arithmetic, tz-independent). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
