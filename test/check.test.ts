import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkTyped } from '../src/quiz/check.ts';

test('exact answers, in either script, ignoring case and spaces', () => {
  assert.equal(checkTyped('kuća', 'kuća'), 'exact');
  assert.equal(checkTyped('  Kuća ', 'kuća'), 'exact');
  assert.equal(checkTyped('кућа', 'kuća'), 'exact');
  assert.equal(checkTyped('vratiti  se', 'vratiti se'), 'exact');
});

test('missing diacritics are close, not exact', () => {
  assert.equal(checkTyped('kuca', 'kuća'), 'close');
  assert.equal(checkTyped('zasto', 'zašto'), 'close');
  assert.equal(checkTyped('dovidjenja', 'doviđenja'), 'close');
  assert.equal(checkTyped('dovidenja', 'doviđenja'), 'close');
});

test('wrong and empty answers', () => {
  assert.equal(checkTyped('kula', 'kuća'), 'wrong');
  assert.equal(checkTyped('', 'kuća'), 'wrong');
  assert.equal(checkTyped('   ', 'kuća'), 'wrong');
});
