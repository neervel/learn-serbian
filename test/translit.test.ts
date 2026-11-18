import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cyrToLat, latToCyr } from '../src/translit.ts';

test('Cyrillic to Latin, including digraphs and capitals', () => {
  assert.equal(cyrToLat('кућа'), 'kuća');
  assert.equal(cyrToLat('Љубав и њива'), 'Ljubav i njiva');
  assert.equal(cyrToLat('ЏЕП'), 'DŽEP');
  assert.equal(cyrToLat('ђак, чај, шума, жена'), 'đak, čaj, šuma, žena');
});

test('Latin to Cyrillic, including digraphs and capitals', () => {
  assert.equal(latToCyr('kuća'), 'кућа');
  assert.equal(latToCyr('Ljubav i njiva'), 'Љубав и њива');
  assert.equal(latToCyr('džep'), 'џеп');
  assert.equal(latToCyr('Živim u Novom Sadu.'), 'Живим у Новом Саду.');
});

test('known words where n+j / d+ž are separate letters', () => {
  assert.equal(latToCyr('injekcija'), 'инјекција');
  assert.equal(latToCyr('Nadživeti'), 'Надживети');
});

test('round trip keeps ordinary words intact', () => {
  for (const w of ['porodica', 'prijatelj', 'doviđenja', 'muškarac', 'vratiti se', 'ljudi']) {
    assert.equal(cyrToLat(latToCyr(w)), w);
  }
});
