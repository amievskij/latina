// Проверка логики без браузера: node tools/test-logic.mjs
import assert from 'node:assert/strict';
import { norm, toCSV, parseCSV, addDays } from '../js/util.js';
import { newSrs, schedule, isLearned } from '../js/srs.js';
import { gramFilled } from '../js/grammar.js';
import { conjugate } from '../js/verbs.js';
import { splitLine } from '../js/ocr.js';
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

// Спряжение
const cj = (latin, gram) => conjugate({ latin, gram }).tenses;
let c = cj('amō', { inf: 'amāre', perf: 'amāvī' });
assert.deepEqual(c.praes, ['amō', 'amās', 'amat', 'amāmus', 'amātis', 'amant']);
assert.deepEqual(c.impf, ['amābam', 'amābās', 'amābat', 'amābāmus', 'amābātis', 'amābant']);
assert.deepEqual(c.fut1, ['amābō', 'amābis', 'amābit', 'amābimus', 'amābitis', 'amābunt']);
assert.deepEqual(c.perf, ['amāvī', 'amāvistī', 'amāvit', 'amāvimus', 'amāvistis', 'amāvērunt']);
assert.deepEqual(c.plqpf, ['amāveram', 'amāverās', 'amāverat', 'amāverāmus', 'amāverātis', 'amāverant']);
assert.deepEqual(c.fut2, ['amāverō', 'amāveris', 'amāverit', 'amāverimus', 'amāveritis', 'amāverint']);
c = cj('moneō', { inf: 'monēre', perf: 'monuī' });
assert.deepEqual(c.praes, ['moneō', 'monēs', 'monet', 'monēmus', 'monētis', 'monent']);
assert.deepEqual(c.fut1, ['monēbō', 'monēbis', 'monēbit', 'monēbimus', 'monēbitis', 'monēbunt']);
c = cj('regō', { inf: 'regere', perf: 'rēxī' });
assert.deepEqual(c.praes, ['regō', 'regis', 'regit', 'regimus', 'regitis', 'regunt']);
assert.equal(c.impf[0], 'regēbam');
assert.deepEqual(c.fut1, ['regam', 'regēs', 'reget', 'regēmus', 'regētis', 'regent']);
assert.equal(c.perf[5], 'rēxērunt');
c = cj('capiō', { inf: 'capere', perf: 'cēpī' });
assert.deepEqual(c.praes, ['capiō', 'capis', 'capit', 'capimus', 'capitis', 'capiunt']);
assert.equal(c.impf[0], 'capiēbam');
assert.deepEqual(c.fut1, ['capiam', 'capiēs', 'capiet', 'capiēmus', 'capiētis', 'capient']);
c = cj('audiō', { inf: 'audīre', perf: 'audīvī' });
assert.deepEqual(c.praes, ['audiō', 'audīs', 'audit', 'audīmus', 'audītis', 'audiunt']);
assert.equal(c.fut1[1], 'audiēs');
// без макронов; без инфинитива, но со спряжением; без данных
assert.equal(cj('moneo', { inf: 'monere' }).praes[1], 'monēs');
assert.equal(cj('amo', { conj: '1' }).impf[0], 'amābam');
assert.equal(cj('amo', {}).praes, null);
assert.equal(cj('amo', { inf: 'amare' }).perf, null);
// неправильные
assert.deepEqual(cj('sum', { inf: 'esse', perf: 'fuī', conj: 'irr' }).praes, ['sum', 'es', 'est', 'sumus', 'estis', 'sunt']);
assert.equal(cj('sum', { inf: 'esse', perf: 'fuī' }).perf[1], 'fuistī');
assert.equal(cj('absum', { inf: 'abesse' }).impf[0], 'aberam');
assert.equal(cj('possum', { inf: 'posse', perf: 'potuī' }).fut1[0], 'poterō');
assert.deepEqual(cj('eō', { inf: 'īre', perf: 'iī' }).praes, ['eō', 'īs', 'it', 'īmus', 'ītis', 'eunt']);
assert.equal(cj('redeō', { inf: 'redīre' }).fut1[0], 'redībō');
assert.equal(cj('ferō', { inf: 'ferre', perf: 'tulī' }).praes[1], 'fers');
assert.equal(cj('volō', { inf: 'velle', perf: 'voluī' }).praes[2], 'vult');
assert.equal(cj('volō', { inf: 'volāre' }).praes[2], 'volat');
assert.equal(cj('hortor', { inf: 'hortārī' }).praes, null);
assert.equal(cj('fīō', { inf: 'fierī', conj: 'irr' }).praes, null);

// Разбор строк с фото
const L = (h, ...ws) => ({ h, words: ws.map(([text, x0, x1]) => ({ text, x0, x1 })) });
assert.deepEqual(splitLine(L(30, ['amāre,', 10, 110], ['amō', 120, 180], ['lieben', 400, 500])), { latin: 'amāre, amō', de: 'lieben' });
assert.deepEqual(splitLine(L(30, ['rosa', 10, 80], ['–', 90, 100], ['die', 110, 150], ['Rose', 160, 220])), { latin: 'rosa', de: 'die Rose' });
assert.deepEqual(splitLine(L(30, ['3.', 0, 20], ['et', 30, 60], ['|', 200, 205], ['und', 300, 360])), { latin: 'et', de: 'und' });
assert.deepEqual(splitLine(L(30, ['Lektion', 10, 120])), { latin: 'Lektion', de: '' });
assert.equal(splitLine(L(30, ['|', 10, 12])), null);

console.log('Все проверки логики пройдены');
