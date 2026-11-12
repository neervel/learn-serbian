import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadAllWords, validateWords } from '../src/content.ts';
import { cyrToLat } from '../src/text/translit.ts';

test('content/words is valid', () => {
  const words = loadAllWords();
  assert.ok(words.length >= 200);
});

test('Cyrillic and Latin forms of every word agree', () => {
  for (const w of loadAllWords()) assert.equal(cyrToLat(w.cyr), w.lat, w.id);
});

test('validation catches broken entries', () => {
  const ok = { id: 'kuca', lat: 'kuća', cyr: 'кућа', ru: 'дом', pos: 'noun', gender: 'f' as const, rank: 1 };
  assert.deepEqual(validateWords([ok]), []);
  assert.equal(validateWords([ok, { ...ok }]).length, 2); // duplicate id and rank
  assert.equal(validateWords([{ ...ok, gender: undefined }]).length, 1);
  assert.equal(validateWords([{ ...ok, cyr: 'kuća' }]).length, 1);
  assert.equal(validateWords([{ ...ok, falseFriend: true }]).length, 1);
  assert.equal(validateWords([{ ...ok, id: 'Kuća' }]).length, 1);
});
