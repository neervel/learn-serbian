import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addDays, isValidTimeZone, localDate, localTime, startOfLocalDay } from '../src/time.ts';

const ts = Date.UTC(2026, 2, 10, 23, 30, 0); // 00:30 next day in Belgrade (UTC+1)

test('local date and time depend on the time zone', () => {
  assert.equal(localDate(ts, 'Europe/Belgrade'), '2026-03-11');
  assert.equal(localTime(ts, 'Europe/Belgrade'), '00:30');
  assert.equal(localDate(ts, 'UTC'), '2026-03-10');
  assert.equal(localTime(ts, 'UTC'), '23:30');
});

test('start of local day', () => {
  assert.equal(startOfLocalDay(ts, 'Europe/Belgrade'), Date.UTC(2026, 2, 10, 23, 0, 0));
  assert.equal(startOfLocalDay(ts, 'UTC'), Date.UTC(2026, 2, 10, 0, 0, 0));
});

test('addDays crosses month and year boundaries', () => {
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2025-12-31', 1), '2026-01-01');
});

test('time zone validation', () => {
  assert.equal(isValidTimeZone('Europe/Moscow'), true);
  assert.equal(isValidTimeZone('Mars/Olympus'), false);
});
