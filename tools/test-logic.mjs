// Проверка логики без браузера: node tools/test-logic.mjs
import assert from 'node:assert/strict';
import { norm, toCSV, parseCSV, addDays } from '../js/util.js';
import { newSrs, schedule, isLearned } from '../js/srs.js';
import { gramFilled } from '../js/grammar.js';
import { sanitize, exportJSON, exportCSV, parseImport, mergeImport } from '../js/io.js';

// Поиск без диакритики
assert.ok(norm('amō').includes(norm('amo')));
assert.ok(norm('Mädchen').includes(norm('madchen')));
assert.ok(norm('Straße').includes(norm('ss')));
assert.equal(norm('  RĒX  '), 'rex');

// Интервалы
const day = '2026-11-15';
let s = newSrs(day);
const seq = [];
for (let i = 0; i < 6; i++) { s = schedule(s, 2, day); seq.push(s.interval); }
assert.deepEqual(seq.slice(0, 3), [1, 3, 8]);
assert.ok(seq.every((v, i) => i === 0 || v > seq[i - 1]), 'интервал растёт');
assert.ok(isLearned(s));
const lapse = schedule(s, 0, day);
assert.equal(lapse.interval, 0);
assert.equal(lapse.due, day);
assert.equal(schedule(newSrs(day), 3, day).due, addDays(day, 4));
assert.ok(schedule(s, 1, day).interval < schedule(s, 2, day).interval);
assert.ok(schedule(s, 2, day).interval < schedule(s, 3, day).interval);

// Грамматика
assert.equal(gramFilled({ pos: '', gram: {} }), false);
assert.equal(gramFilled({ pos: 'noun', gram: {} }), false);
assert.equal(gramFilled({ pos: 'noun', gram: { gen: 'rosae' } }), true);
assert.equal(gramFilled({ pos: 'conj', gram: {} }), true);

// CSV туда и обратно
const rows = [['a;b', 'c "d"', 'строка\nвторая'], ['1', '', 'ß']];
assert.deepEqual(parseCSV(toCSV(rows)), rows);

// Экспорт → импорт без дубликатов
const words = [
  sanitize({ latin: 'rosa', de: 'die Rose', ru: 'роза', pos: 'noun', gram: { gen: 'rosae', gender: 'f', decl: '1' }, tags: ['Lektion 1'] }),
  sanitize({ latin: 'amō', de: 'lieben; gern haben', pos: 'verb', gram: { inf: 'amāre' }, note: 'заметка; с "кавычками"' }),
  sanitize({ latin: 'et', de: 'und' }),
];
assert.equal(sanitize({ latin: 'x' }), null);

const fromJson = parseImport('a.json', exportJSON(words, { [day]: 3 }));
assert.equal(fromJson.words.length, 3);
assert.deepEqual(fromJson.words[0], words[0]);
let m = mergeImport(words, fromJson.words);
assert.deepEqual([m.added, m.updated, m.skipped], [0, 0, 3]);

const fromCsv = parseImport('a.csv', exportCSV(words));
assert.equal(fromCsv.words.length, 3);
assert.equal(fromCsv.words[0].gram.gen, 'rosae');
assert.equal(fromCsv.words[1].note, 'заметка; с "кавычками"');
assert.deepEqual(fromCsv.words[0].tags, ['Lektion 1']);
m = mergeImport(words, fromCsv.words);
assert.deepEqual([m.added, m.updated, m.skipped], [0, 0, 3]);

// Импорт в пустой словарь и чужой CSV с запятыми и немецкими заголовками
m = mergeImport([], fromJson.words);
assert.equal(m.added, 3);
const foreign = parseImport('x.csv', 'Latein,Deutsch,Russisch\nrosa,Die Rose,\nrēx,der König,царь\nrex,der Konig,\n,leer,');
assert.equal(foreign.invalid, 1);
m = mergeImport(words, foreign.words);
assert.deepEqual([m.added, m.updated, m.skipped], [1, 0, 2], 'rosa — дубликат, rēx добавлен один раз');

// Совпадение латынь+немецкий без id: дописываются только пустые поля
m = mergeImport(words, [sanitize({ latin: 'ET', de: 'Und', ru: 'и', pos: 'conj' })]);
assert.deepEqual([m.added, m.updated], [0, 1]);
assert.equal(m.put[0].ru, 'и');
assert.equal(m.put[0].id, words[2].id);

console.log('Все проверки логики пройдены');
