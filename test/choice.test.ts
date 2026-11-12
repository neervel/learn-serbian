import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getWord, upsertWord } from '../src/db/repo.ts';
import { buildOptions } from '../src/quiz/choice.ts';
import { makeDb, word } from './helpers.ts';

test('four distinct options that include the answer', () => {
  const db = makeDb(20);
  const answer = getWord(db, 'w7')!;
  for (let i = 0; i < 20; i++) {
    const options = buildOptions(db, answer);
    assert.equal(options.length, 4);
    assert.ok(options.some((o) => o.id === 'w7'));
    assert.equal(new Set(options.map((o) => o.ru)).size, 4);
  }
});

test('distractors never share the translation of the answer', () => {
  const db = makeDb(6);
  upsertWord(db, word(7, { ru: 'слово3' })); // synonym of w3
  const answer = getWord(db, 'w3')!;
  for (let i = 0; i < 30; i++) {
    assert.ok(!buildOptions(db, answer).some((o) => o.id === 'w7'));
  }
});

test('prefers the same part of speech, falls back to others', () => {
  const db = makeDb(0);
  for (let n = 1; n <= 4; n++) upsertWord(db, word(n, { pos: 'verb', gender: undefined }));
  for (let n = 5; n <= 12; n++) upsertWord(db, word(n));
  const verb = buildOptions(db, getWord(db, 'w1')!);
  assert.deepEqual(verb.map((o) => o.pos).sort(), ['verb', 'verb', 'verb', 'verb']);

  const lonely = makeDb(0);
  upsertWord(lonely, word(1, { pos: 'verb', gender: undefined }));
  for (let n = 2; n <= 6; n++) upsertWord(lonely, word(n));
  assert.equal(buildOptions(lonely, getWord(lonely, 'w1')!).length, 4);
});

test('tiny dictionary gives fewer options instead of failing', () => {
  const db = makeDb(2);
  assert.equal(buildOptions(db, getWord(db, 'w1')!).length, 2);
});
