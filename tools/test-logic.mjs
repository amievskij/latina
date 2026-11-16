// Проверка логики без браузера: node tools/test-logic.mjs
import assert from 'node:assert/strict';
import { norm, toCSV, parseCSV, addDays } from '../js/util.js';
import { newSrs, schedule, isLearned } from '../js/srs.js';
import { gramFilled } from '../js/grammar.js';
import { conjugate } from '../js/verbs.js';
import { splitLine, parseTable, mergeWords } from '../js/ocr.js';
import { inferGrammar } from '../js/grammar.js';
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
assert.deepEqual(splitLine(L(30, ['amāre,', 10, 110], ['amō', 120, 180], ['lieben', 400, 500])), { latin: 'amāre, amō', info: '', de: 'lieben' });
assert.deepEqual(splitLine(L(30, ['rosa', 10, 80], ['–', 90, 100], ['die', 110, 150], ['Rose', 160, 220])), { latin: 'rosa', info: '', de: 'die Rose' });
assert.deepEqual(splitLine(L(30, ['3.', 0, 20], ['et', 30, 60], ['|', 200, 205], ['und', 300, 360])), { latin: 'et', info: '', de: 'und' });
assert.equal(splitLine(L(30, ['|', 10, 12])), null);

// Таблица из трёх столбцов с колонкой примечаний, заголовком, наклоном и переводом в две строки
const W = (t, x, y, c = 90) => ({ t, c, x0: x, x1: x + t.length * 9, y0: y - 7 + x * 0.02, y1: y + 7 + x * 0.02 });
const page = [
  W('Lektion', 60, 40), W('1', 130, 40), W('Wohnen', 170, 40), W('im', 250, 40), W('alten', 280, 40), W('Rom', 340, 40),
  W('nam', 60, 100), W('Konj.', 190, 100), W('denn', 380, 100),
  W('subitö', 60, 130), W('Adv.', 190, 130), W('plótzlich', 380, 130),
  W('familia', 60, 160), W('familiam', 190, 160), W('f.', 270, 160), W('die', 380, 160), W('Hausgemeinschaft,', 410, 160),
  W('familiam', 620, 160), W('ist', 700, 160), W('der', 730, 160), W('Akkusativ', 760, 160),
  W('die', 380, 181), W('Familie', 410, 181), W('von', 620, 181), W('familia.', 650, 181),
  W('audit', 60, 215), W('er/sie/es', 380, 215), W('hört', 465, 215), W('(zu)', 505, 215), W('D', 620, 215), W('das', 635, 215), W('Audio', 670, 215),
  W('Kon.', 190, 245), W('aber,', 380, 245), W('sondern', 430, 245),
  W('tenet', 60, 275), W('er/sie/es', 380, 275), W('hält', 465, 275),
  W('(hier:', 380, 296), W('im', 440, 296), W('Maul)', 465, 296),
  W('150', 60, 400),
];
assert.deepEqual(parseTable(page, 1000), [
  { latin: 'nam', info: 'Konj.', de: 'denn' },
  { latin: 'subitō', info: 'Adv.', de: 'plötzlich' },
  { latin: 'familia', info: 'familiam f.', de: 'die Hausgemeinschaft, die Familie' },
  { latin: 'audit', info: '', de: 'er/sie/es hört (zu)' },
  { latin: '', info: 'Konj.', de: 'aber, sondern' },
  { latin: 'tenet', info: '', de: 'er/sie/es hält (hier: im Maul)' },
]);
const ig = inferGrammar;
assert.deepEqual(ig('hodiē', 'Adv.', 'heute'), { pos: 'adv', gram: {}, note: '' });
assert.deepEqual(ig('nam', 'Konj.', 'denn'), { pos: 'conj', gram: {}, note: '' });
assert.deepEqual(ig('cum', 'Präp. + Abl.', 'mit'), { pos: 'prep', gram: { case: 'abl' }, note: '' });
// дневная норма: дата первого знакомства сохраняется при повторениях
assert.equal(schedule({ ...newSrs(day), first: '2026-11-01' }, 2, day).first, '2026-11-01');
assert.deepEqual(ig('familia', 'familiam f.', 'die Familie'), { pos: 'noun', gram: { gender: 'f', decl: '1' }, note: 'Akk. familiam' });
assert.deepEqual(ig('arx', 'arcis f. Gen. Pl. arcium', 'die Festung'), { pos: 'noun', gram: { gen: 'arcis', gender: 'f', decl: '3' }, note: 'Gen. Pl. arcium' });
assert.deepEqual(ig('thermae', 'thermārum f. Pl.', 'die Thermen'), { pos: 'noun', gram: { gen: 'thermārum', gender: 'f', decl: '1' }, note: 'Pl.' });
assert.deepEqual(ig('deus', 'deī m.', 'der Gott').gram.decl, '2');
assert.deepEqual(ig('bonus', '-a, -um', 'gut'), { pos: 'adj', gram: { m: 'bonus', f: 'bona', n: 'bonum' }, note: '' });
assert.deepEqual(ig('paucī', '-ae, -a Pl.', 'wenige').gram, { m: 'paucī', f: 'paucae', n: 'pauca' });
assert.deepEqual(ig('noster', '-tra, -trum', 'unser').gram.f, 'nostra');
assert.deepEqual(ig('miser', 'misera, miserum', 'arm').gram, { m: 'miser', f: 'misera', n: 'miserum' });
assert.deepEqual(ig('timēre', 'timeō, timuī', 'fürchten'), { pos: 'verb', gram: { p1: 'timeō', perf: 'timuī', conj: '2' }, note: '' });
assert.deepEqual(ig('capere', 'capiō', 'fangen').gram, { p1: 'capiō', conj: '3io' });
assert.deepEqual(ig('regere', 'regō, rēxī', 'lenken').gram.conj, '3');
assert.deepEqual(ig('audīre', 'audiō, audīvī', 'hören').gram.conj, '4');
assert.deepEqual(ig('abīre', 'abeō', 'weggehen').gram.conj, 'irr');
assert.deepEqual(ig('fugere', 'fugiō, fūgī + Akk.', 'fliehen'), { pos: 'verb', gram: { p1: 'fugiō', perf: 'fūgī', conj: '3io' }, note: '+ Akk.' });
assert.equal(ig('exspectat', '', 'er/sie/es erwartet').pos, 'verb');
assert.deepEqual(ig('ecce!', '+ Nom./Akk.', 'sieh da!'), { pos: '', gram: {}, note: '+ Nom./Akk.' });
// заголовок-инфинитив, как в учебнике
assert.deepEqual(cj('timēre', { p1: 'timeō', perf: 'timuī', conj: '2' }).praes, ['timeō', 'timēs', 'timet', 'timēmus', 'timētis', 'timent']);
assert.equal(cj('capere', { p1: 'capiō', perf: 'cēpī' }).fut1[0], 'capiam');
assert.equal(cj('esse', { p1: 'sum', perf: 'fuī', conj: 'irr' }).impf[0], 'eram');
assert.equal(cj('adīre', { p1: 'adeō', perf: 'adiī', conj: 'irr' }).praes[5], 'adeunt');
assert.equal(mergeWords([W('nam', 60, 100, 80)], [W('nam', 61, 100, 70), W('sed', 60, 200, 90)]).length, 2);

console.log('Все проверки логики пройдены');
