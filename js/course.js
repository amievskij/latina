// Курс грамматики: разделы, уроки, теория и генераторы упражнений.
// Упражнения строятся из слов словаря пользователя; если подходящих слов мало — из встроенных примеров.

import { conjugate, TENSES } from './verbs.js';
import { decline, adjForms, CASES } from './nouns.js';
import { norm, esc, shuffle } from './util.js';

const PERS = ['1. Person Singular', '2. Person Singular', '3. Person Singular', '1. Person Plural', '2. Person Plural', '3. Person Plural'];
const PERS_SHORT = ['1. Sg.', '2. Sg.', '3. Sg.', '1. Pl.', '2. Pl.', '3. Pl.'];
const PRON = ['ich', 'du', 'er / sie / es', 'wir', 'ihr', 'sie (Pl.)'];
const TENSE = Object.fromEntries(TENSES);
const CONJ = { '1': 'a-Konjugation', '2': 'e-Konjugation', '3': 'konsonantische Konjugation', '3io': 'gemischte Konjugation', '4': 'i-Konjugation' };
const NUMS = [['sg', 'Singular', 'Sg.'], ['pl', 'Plural', 'Pl.']];
const GENUS = { m: 'Maskulinum', f: 'Femininum', n: 'Neutrum' };

const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];
const la = (s) => `<span class="la">${esc(s)}</span>`;
const word = (w) => `${la(w.latin)}${w.de ? ` <span class="muted">— ${esc(w.de)}</span>` : ''}`;

// Варианты ответа: правильный + до n−1 других (без повторов).
function options(correct, pool, n = 4) {
  const others = shuffle([...new Set(pool)].filter((x) => x && x !== correct));
  return shuffle([correct, ...others.slice(0, n - 1)]);
}

// Таблица форм для пояснения после ответа; hi — подсвеченная строка.
function table(head, rows, hi = -1) {
  return `<table class="para"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r, i) =>
    `<tr${i === hi ? ' class="hi"' : ''}>${r.map((c, j) => `<td${j ? ' class="la"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

// ---------- Встроенные примеры (обычные слова, на случай если в словаре их мало) ----------

const V = (latin, de, p1, perf, conj) => ({ latin, de, pos: 'verb', gram: { p1, perf, conj }, builtin: true });
const N = (latin, de, gen, gender, decl) => ({ latin, de, pos: 'noun', gram: { gen, gender, decl }, builtin: true });
const A = (latin, de, f, n) => ({ latin, de, pos: 'adj', gram: { m: latin, f, n }, builtin: true });
const P = (latin, de, c) => ({ latin, de, pos: 'prep', gram: { case: c }, builtin: true });

export const BUILTIN = [
  V('amāre', 'lieben', 'amō', 'amāvī', '1'), V('laudāre', 'loben', 'laudō', 'laudāvī', '1'), V('vocāre', 'rufen', 'vocō', 'vocāvī', '1'),
  V('portāre', 'tragen', 'portō', 'portāvī', '1'), V('monēre', 'mahnen', 'moneō', 'monuī', '2'), V('habēre', 'haben', 'habeō', 'habuī', '2'),
  V('vidēre', 'sehen', 'videō', 'vīdī', '2'), V('tacēre', 'schweigen', 'taceō', 'tacuī', '2'), V('regere', 'lenken', 'regō', 'rēxī', '3'),
  V('dūcere', 'führen', 'dūcō', 'dūxī', '3'), V('mittere', 'schicken', 'mittō', 'mīsī', '3'), V('scrībere', 'schreiben', 'scrībō', 'scrīpsī', '3'),
  V('capere', 'fangen', 'capiō', 'cēpī', '3io'), V('facere', 'machen', 'faciō', 'fēcī', '3io'), V('fugere', 'fliehen', 'fugiō', 'fūgī', '3io'),
  V('audīre', 'hören', 'audiō', 'audīvī', '4'), V('venīre', 'kommen', 'veniō', 'vēnī', '4'), V('dormīre', 'schlafen', 'dormiō', 'dormīvī', '4'),
  N('puella', 'das Mädchen', 'puellae', 'f', '1'), N('via', 'der Weg', 'viae', 'f', '1'), N('rosa', 'die Rose', 'rosae', 'f', '1'),
  N('agricola', 'der Bauer', 'agricolae', 'm', '1'), N('servus', 'der Sklave', 'servī', 'm', '2'), N('dominus', 'der Herr', 'dominī', 'm', '2'),
  N('puer', 'der Junge', 'puerī', 'm', '2'), N('ager', 'der Acker', 'agrī', 'm', '2'), N('templum', 'der Tempel', 'templī', 'n', '2'),
  N('dōnum', 'das Geschenk', 'dōnī', 'n', '2'), N('bellum', 'der Krieg', 'bellī', 'n', '2'), N('rēx', 'der König', 'rēgis', 'm', '3'),
  N('mīles', 'der Soldat', 'mīlitis', 'm', '3'), N('vōx', 'die Stimme', 'vōcis', 'f', '3'), N('soror', 'die Schwester', 'sorōris', 'f', '3'),
  N('nōmen', 'der Name', 'nōminis', 'n', '3'), N('tempus', 'die Zeit', 'temporis', 'n', '3'),
  A('bonus', 'gut', 'bona', 'bonum'), A('magnus', 'groß', 'magna', 'magnum'), A('parvus', 'klein', 'parva', 'parvum'),
  A('pulcher', 'schön', 'pulchra', 'pulchrum'), A('novus', 'neu', 'nova', 'novum'), A('miser', 'arm', 'misera', 'miserum'),
  P('ad', 'zu (… hin)', 'acc'), P('per', 'durch', 'acc'), P('ante', 'vor', 'acc'), P('post', 'nach', 'acc'), P('prope', 'nahe bei', 'acc'),
  P('cum', 'mit', 'abl'), P('sine', 'ohne', 'abl'), P('dē', 'über, von', 'abl'), P('prō', 'für', 'abl'), P('ē, ex', 'aus', 'abl'),
];
const IRR = {
  esse: V('esse', 'sein', 'sum', 'fuī', 'irr'),
  posse: V('posse', 'können', 'possum', 'potuī', 'irr'),
  ire: V('īre', 'gehen', 'eō', 'iī', 'irr'),
};

// ---------- Отбор слов ----------

const cache = new WeakMap();
const tensesOf = (w) => { if (!cache.has(w)) cache.set(w, conjugate(w).tenses); return cache.get(w); };
const conjOf = (w) => (w.gram && w.gram.conj) || '';
const regularVerb = (conjs, tense = 'praes') => (w) => w.pos === 'verb' && conjs.includes(conjOf(w)) && !!tensesOf(w)[tense];
const nounOf = (decls, gender) => (w) => {
  const d = w.pos === 'noun' && !/^\p{Lu}/u.test(w.latin) ? decline(w) : null;
  return !!d && !!d.sg && decls.includes(d.decl) && (!gender || gender(d.gender));
};
const adjOk = (w) => { const a = adjForms(w); return !!a && !a.pluralOnly; };
const prepOk = (w) => w.pos === 'prep' && ['acc', 'abl'].includes(w.gram && w.gram.case);

// Слова пользователя, а если их меньше min — дополненные встроенными.
function poolOf(words, pred, min = 4) {
  const own = words.filter(pred);
  if (own.length >= min) return own;
  const have = new Set(own.map((w) => norm(w.latin)));
  return [...own, ...BUILTIN.filter((w) => pred(w) && !have.has(norm(w.latin)))];
}

// ---------- Упражнения: глаголы ----------

const verbTable = (w, t, hi) => table(['', TENSE[t]], tensesOf(w)[t].map((f, i) => [PERS_SHORT[i], esc(f)]), hi);

const VERB = {
  pick(w, tenses) {
    const t = pick(tenses), f = tensesOf(w)[t], p = rnd(6);
    const pool = tenses.flatMap((x) => tensesOf(w)[x]);
    return {
      kind: 'choice', title: 'Выбери правильную форму', laOpts: true,
      prompt: `${word(w)}<div class="ask">${PERS[p]} · ${TENSE[t]}</div>`,
      options: options(f[p], pool), answer: f[p], explain: verbTable(w, t, p),
    };
  },
  identify(w, tenses) {
    const t = pick(tenses), p = rnd(6), form = tensesOf(w)[t][p];
    const label = (x, q) => (tenses.length > 1 ? `${PERS_SHORT[q]} ${TENSE[x]}` : PERS[q]);
    const all = tenses.flatMap((x) => [0, 1, 2, 3, 4, 5].map((q) => ({ x, q, f: tensesOf(w)[x][q] })));
    const wrong = all.filter((o) => o.f !== form).map((o) => label(o.x, o.q));
    return {
      kind: 'choice', title: 'Какая это форма?',
      prompt: `<div class="big la">${esc(form)}</div><div class="muted">от ${la(w.latin)}</div>`,
      options: options(label(t, p), wrong), answer: label(t, p), explain: verbTable(w, t, p),
    };
  },
  person(w, tenses) {
    const t = pick(tenses), p = rnd(6), form = tensesOf(w)[t][p];
    return {
      kind: 'choice', title: 'Кто это делает?',
      prompt: `<div class="big la">${esc(form)}</div><div class="muted">${la(w.latin)} · ${TENSE[t]}</div>`,
      options: options(PRON[p], PRON), answer: PRON[p], explain: verbTable(w, t, p),
    };
  },
  type(w, tenses) {
    const t = pick(tenses), p = rnd(6), f = tensesOf(w)[t][p];
    return {
      kind: 'type', title: 'Напиши форму',
      prompt: `${word(w)}<div class="ask">${PERS[p]} · ${TENSE[t]} <span class="muted">(${PRON[p]})</span></div>`,
      answer: f, explain: verbTable(w, t, p),
    };
  },
  match(w, tenses) {
    const t = pick(tenses), f = tensesOf(w)[t];
    const ps = shuffle([0, 1, 2, 3, 4, 5]).filter((p, i, a) => a.findIndex((q) => f[q] === f[p]) === i).slice(0, 4);
    return {
      kind: 'match', title: `Сопоставь: ${w.latin}, ${TENSE[t]}`,
      pairs: ps.map((p) => [f[p], PRON[p]]), explain: verbTable(w, t),
    };
  },
  conj(w) {
    const c = conjOf(w), p1 = tensesOf(w).praes[0];
    return {
      kind: 'choice', title: 'К какому спряжению относится глагол?',
      prompt: `<div class="big la">${esc(w.latin)}, ${esc(p1)}</div>${w.de ? `<div class="muted">${esc(w.de)}</div>` : ''}`,
      options: options(CONJ[c], Object.values(CONJ)), answer: CONJ[c],
      explain: `<p>${la(w.latin)}, ${la(p1)} → <b>${CONJ[c]}</b>. ${RULE[c]}</p>`,
    };
  },
  tense(w, tenses) {
    const avail = tenses.filter((t) => tensesOf(w)[t]);
    const t = pick(avail), p = rnd(6), form = tensesOf(w)[t][p];
    const same = avail.filter((x) => tensesOf(w)[x].includes(form));
    const wrong = avail.filter((x) => !same.includes(x)).map((x) => TENSE[x]);
    return {
      kind: 'choice', title: 'Какое это время?',
      prompt: `<div class="big la">${esc(form)}</div><div class="muted">от ${la(w.latin)}</div>`,
      options: options(TENSE[t], wrong), answer: TENSE[t], explain: verbTable(w, t, p),
    };
  },
};
const RULE = {
  '1': 'Инфинитив на -āre.',
  '2': 'Инфинитив на -ēre (долгое e), 1. Sg. на -eō.',
  '3': 'Инфинитив на -ere (краткое e), 1. Sg. на -ō.',
  '3io': 'Инфинитив на -ere (краткое e), но 1. Sg. на -iō.',
  '4': 'Инфинитив на -īre, 1. Sg. на -iō.',
};

// ---------- Упражнения: существительные ----------

const nounHead = (w, d) => `${la(w.latin)}, ${la(w.gram.gen)} <span class="muted">${d.gender}. — ${esc(w.de || '')}</span>`;
const nounTable = (d, num, ci) => table(['', 'Singular', 'Plural'],
  CASES.map(([, name], i) => [name, esc(d.sg ? d.sg[i] : '—'), esc(d.pl[i])]), num && ci >= 0 ? ci : -1);
const cells = (d) => NUMS.flatMap(([n, name, short]) => (d[n] ? CASES.map(([, cn, cs], ci) => ({ n, ci, f: d[n][ci], label: `${cn} ${name}`, short: `${cs} ${short}` })) : []));

const NOUN = {
  pick(w) {
    const d = decline(w), all = cells(d), c = pick(all);
    return {
      kind: 'choice', title: 'Выбери правильную форму', laOpts: true,
      prompt: `${nounHead(w, d)}<div class="ask">${c.label}</div>`,
      options: options(c.f, all.map((x) => x.f)), answer: c.f, explain: nounTable(d, c.n, c.ci),
    };
  },
  identify(w) {
    const d = decline(w), all = cells(d), c = pick(all);
    const wrong = all.filter((x) => x.f !== c.f).map((x) => x.label);
    const same = all.filter((x) => x.f === c.f).map((x) => x.label);
    return {
      kind: 'choice', title: 'Какой это падеж и число?',
      prompt: `<div class="big la">${esc(c.f)}</div><div class="muted">от ${la(w.latin)}, ${la(w.gram.gen)}</div>`,
      options: options(c.label, wrong), answer: c.label,
      explain: (same.length > 1 ? `<p>Эта форма может быть: ${same.join(', ')}.</p>` : '') + nounTable(d, c.n, c.ci),
    };
  },
  type(w) {
    const d = decline(w), c = pick(cells(d));
    return {
      kind: 'type', title: 'Напиши форму',
      prompt: `${nounHead(w, d)}<div class="ask">${c.label}</div>`, answer: c.f, explain: nounTable(d, c.n, c.ci),
    };
  },
  match(w) {
    const d = decline(w), all = cells(d);
    const unique = all.filter((x) => all.filter((y) => y.f === x.f).length === 1);
    if (unique.length < 4) return NOUN.pick(w); // у Neutra мало несовпадающих форм
    const four = shuffle(unique).slice(0, 4);
    return {
      kind: 'match', title: `Сопоставь: ${w.latin}`, pairs: four.map((x) => [x.f, x.short]), explain: nounTable(d),
    };
  },
};

// ---------- Упражнения: согласование и предлоги ----------

const KNG = {
  choice(adj, noun) {
    const a = adjForms(adj), d = decline(noun), c = pick(cells(d)), g = d.gender;
    const right = a[g][c.n][c.ci];
    const pool = ['m', 'f', 'n'].map((x) => a[x][c.n][c.ci]).concat(CASES.map((_, i) => a[g][c.n][i]));
    return {
      kind: 'choice', title: 'Согласуй прилагательное', laOpts: true,
      prompt: `${la(adj.latin)} <span class="muted">(${esc(adj.de || '')})</span> + <span class="big la">${esc(c.f)}</span>
        <div class="ask">${la(noun.latin)} — ${GENUS[g]}; форма: ${c.label}</div>`,
      options: options(right, pool), answer: right,
      explain: `<p>${la(noun.latin)} — ${GENUS[g]}, ${c.label} → ${la(adj.latin)} в той же форме: <b class="la">${esc(right)}</b>.
        Совпадают Kasus, Numerus и Genus — окончания могут быть разными.</p>`,
    };
  },
  type(adj, noun) {
    const a = adjForms(adj), d = decline(noun), c = pick(cells(d)), g = d.gender;
    const right = a[g][c.n][c.ci];
    return {
      kind: 'type', title: 'Напиши прилагательное в нужной форме',
      prompt: `<span class="big la">${esc(c.f)}</span> + ${la(adj.latin)}<div class="ask">${la(noun.latin)} — ${GENUS[g]}; ${c.label}</div>`,
      answer: right, explain: `<p>${GENUS[g]}, ${c.label}: <b class="la">${esc(right)} ${esc(c.f)}</b></p>`,
    };
  },
};
const CASE_DE = { acc: 'mit Akkusativ', abl: 'mit Ablativ' };
const PREP = {
  kind(p) {
    return {
      kind: 'choice', title: 'С каким падежом употребляется предлог?',
      prompt: `<div class="big la">${esc(p.latin)}</div><div class="muted">${esc(p.de || '')}</div>`,
      options: options(CASE_DE[p.gram.case], ['mit Akkusativ', 'mit Ablativ', 'mit Dativ']), answer: CASE_DE[p.gram.case],
      explain: `<p>${la(p.latin)} — ${CASE_DE[p.gram.case]}.</p>`,
    };
  },
  phrase(p, noun) {
    const d = decline(noun), ci = p.gram.case === 'acc' ? 3 : 4, n = d.sg && Math.random() < 0.6 ? 'sg' : 'pl';
    const right = d[n][ci], first = p.latin.split(',').pop().trim();
    return {
      kind: 'choice', title: 'Дополни выражение', laOpts: true,
      prompt: `<div class="big"><span class="la">${esc(first)}</span> ___</div>
        <div class="ask">${la(noun.latin)} (${n === 'sg' ? 'Singular' : 'Plural'}) <span class="muted">· ${esc(p.de || '')}</span></div>`,
      options: options(right, cells(d).filter((x) => x.n === n).map((x) => x.f)), answer: right,
      explain: `<p>${la(first)} ${CASE_DE[p.gram.case]} → <b class="la">${esc(first)} ${esc(right)}</b></p>`,
    };
  },
};

// ---------- Построение урока ----------

// plan — список шагов; step(i) возвращает упражнение или null (тогда пробуем ещё раз).
function build(plan, step) {
  const out = [];
  for (const kind of plan) {
    for (let k = 0; k < 8; k++) {
      let ex = null;
      try { ex = step(kind); } catch { ex = null; }
      if (ex && (ex.kind !== 'choice' || ex.options.length >= 2)) { out.push(ex); break; }
    }
  }
  return out;
}

const PLAN_VERB = ['match', 'pick', 'person', 'pick', 'type', 'identify', 'pick', 'type', 'person', 'type'];
const PLAN_NOUN = ['match', 'pick', 'identify', 'pick', 'type', 'identify', 'pick', 'type', 'match', 'type'];

const verbLesson = (conjs, tenses, plan = PLAN_VERB) => (words) => {
  const pool = poolOf(words, (w) => tenses.every((t) => regularVerb(conjs, t)(w)));
  return build(plan, (k) => VERB[k](pick(pool), tenses));
};
const irrLesson = (key, tenses) => () => build(PLAN_VERB, (k) => VERB[k](IRR[key], tenses));
const nounLesson = (decls, gender) => (words) => {
  const pool = poolOf(words, nounOf(decls, gender));
  return build(PLAN_NOUN, (k) => NOUN[k](pick(pool)));
};

// ---------- Теория ----------

const T = (rows) => table(['', 'Окончание', 'Пример'], rows);
const EX = (verb, t) => tensesOf(verb)[t];
function persTable(verb, t, ends) {
  const f = EX(verb, t);
  return T(PERS_SHORT.map((p, i) => [p, esc(ends[i]), esc(f[i])]));
}
const CASE_Q = '<p class="muted small">Вопросы падежей: Nominativ — wer? was? · Genitiv — wessen? · Dativ — wem? · Akkusativ — wen? was? · Ablativ — womit? wodurch? wo? wann?</p>';
function declTheory(w) {
  const d = decline(w);
  return table(['', 'Singular', 'Plural'], CASES.map(([, n], i) => [n, esc(d.sg[i]), esc(d.pl[i])]));
}
const B = Object.fromEntries(BUILTIN.map((w) => [w.latin, w]));

// ---------- Курс ----------

export const UNITS = [
  {
    id: 'u1', title: 'Präsens: настоящее время', color: '#58a700',
    lessons: [
      { id: 'esse', title: 'esse — «быть»', sub: 'sum, es, est …', make: irrLesson('esse', ['praes']),
        theory: () => `<p>${la('esse')} — «быть, находиться». Самый частый глагол латыни, и он неправильный: его формы учат наизусть.</p>
          ${table(['', 'Latein', 'Deutsch'], [['1. Sg.', 'sum', 'ich bin'], ['2. Sg.', 'es', 'du bist'], ['3. Sg.', 'est', 'er/sie/es ist'], ['1. Pl.', 'sumus', 'wir sind'], ['2. Pl.', 'estis', 'ihr seid'], ['3. Pl.', 'sunt', 'sie sind']])}
          <p>Местоимения (ich, du…) в латыни обычно не пишут: лицо видно по окончанию. ${la('Puella est.')} — «Девочка есть / находится».</p>` },
      { id: 'a-konj', title: 'a-Konjugation', sub: 'amāre: amō, amās …', make: verbLesson(['1'], ['praes']),
        theory: () => `<p>Инфинитив оканчивается на <b>-āre</b>: ${la('amāre')}. Основа — ${la('amā-')}. К основе прибавляются <b>личные окончания</b>:</p>
          ${persTable(B['amāre'], 'praes', ['-ō', '-s', '-t', '-mus', '-tis', '-nt'])}
          <p>В 1. Sg. гласная основы сливается с окончанием: ${la('amō')}. Перед -t и -nt гласная краткая: ${la('amat, amant')}.</p>` },
      { id: 'e-konj', title: 'e-Konjugation', sub: 'monēre: moneō, monēs …', make: verbLesson(['2'], ['praes']),
        theory: () => `<p>Инфинитив на <b>-ēre</b> (долгое e): ${la('monēre')}. Основа — ${la('monē-')}, окончания те же:</p>
          ${persTable(B['monēre'], 'praes', ['-ō', '-s', '-t', '-mus', '-tis', '-nt'])}
          <p>В отличие от a-Konjugation, в 1. Sg. гласная основы остаётся: ${la('moneō')}.</p>` },
      { id: 'k-konj', title: 'konsonantische и gemischte', sub: 'regere, capere', make: verbLesson(['3', '3io'], ['praes']),
        theory: () => `<p>Инфинитив на <b>-ere</b> с кратким e: ${la('regere')}. Основа оканчивается на согласный (${la('reg-')}), поэтому между основой и окончанием вставляется <b>i</b> (в 3. Pl. — <b>u</b>):</p>
          ${persTable(B['regere'], 'praes', ['-ō', '-is', '-it', '-imus', '-itis', '-unt'])}
          <p><b>gemischte Konjugation</b>: инфинитив тоже на -ere, но в 1. Sg. и 3. Pl. появляется i: ${la('capiō … capiunt')}.</p>
          ${persTable(B['capere'], 'praes', ['-iō', '-is', '-it', '-imus', '-itis', '-iunt'])}` },
      { id: 'i-konj', title: 'i-Konjugation', sub: 'audīre: audiō, audīs …', make: verbLesson(['4'], ['praes']),
        theory: () => `<p>Инфинитив на <b>-īre</b>: ${la('audīre')}. Основа — ${la('audī-')}:</p>
          ${persTable(B['audīre'], 'praes', ['-iō', '-s', '-t', '-mus', '-tis', '-unt'])}
          <p>Не путай с gemischte Konjugation: ${la('audīs, audīmus')} — с долгим ī, ${la('capis, capimus')} — с кратким i.</p>` },
      { id: 'konj', title: 'Определи спряжение', sub: 'по инфинитиву и 1. Sg.', make: (words) => {
          const pool = poolOf(words, regularVerb(['1', '2', '3', '3io', '4']), 8);
          return build(['conj', 'conj', 'pick', 'conj', 'conj', 'identify', 'conj', 'conj', 'pick', 'conj'], (k) => VERB[k](pick(pool), ['praes']));
        },
        theory: () => `<p>Спряжение видно по двум формам, которые даются в словаре: инфинитиву и 1. Person Singular.</p>
          ${table(['Infinitiv', '1. Sg.', 'Konjugation'], [['-āre', '-ō', 'a-Konjugation'], ['-ēre', '-eō', 'e-Konjugation'], ['-ere', '-ō', 'konsonantische'], ['-ere', '-iō', 'gemischte'], ['-īre', '-iō', 'i-Konjugation']])}
          <p>Поэтому глаголы всегда учат парами: ${la('vidēre, videō')} · ${la('capere, capiō')}.</p>` },
    ],
  },
  {
    id: 'u2', title: 'Существительные: падежи', color: '#1cb0f6',
    lessons: [
      { id: 'a-dekl', title: 'a-Deklination', sub: 'puella, puellae', make: nounLesson(['1']),
        theory: () => `<p>Существительные на <b>-a</b>, Genitiv на <b>-ae</b>. Почти все — Femininum; мужского рода только слова, обозначающие мужчин: ${la('agricola')} (Bauer).</p>
          ${declTheory(B['puella'])}${CASE_Q}
          <p>${la('puellae')} может быть Gen. Sg., Dat. Sg. или Nom. Pl. — решает смысл предложения. Ablativ Sg. — с долгим ${la('ā')}.</p>` },
      { id: 'o-dekl', title: 'o-Deklination: -us, -er', sub: 'servus, puer, ager', make: nounLesson(['2'], (g) => g !== 'n'),
        theory: () => `<p>Maskulina на <b>-us</b> или <b>-er</b>, Genitiv на <b>-ī</b>.</p>${declTheory(B['servus'])}
          <p>У слов на -er основа видна в Genitiv: ${la('puer, puerī')} (e остаётся), ${la('ager, agrī')} (e выпадает).</p>${declTheory(B['ager'])}` },
      { id: 'o-dekl-n', title: 'o-Deklination: Neutrum', sub: 'templum, templī', make: nounLesson(['2'], (g) => g === 'n'),
        theory: () => `<p>Neutra на <b>-um</b>, Genitiv на <b>-ī</b>.</p>${declTheory(B['templum'])}
          <p><b>Правило среднего рода</b> (для всех склонений): Nominativ и Akkusativ совпадают, а во множественном числе оканчиваются на <b>-a</b>.</p>` },
      { id: 'dekl-3', title: '3. Deklination', sub: 'rēx, rēgis', make: nounLesson(['3']),
        theory: () => `<p>Nominativ бывает любым, поэтому слово учат вместе с Genitiv на <b>-is</b>: основа видна только там (${la('rēx, rēg-is')}; ${la('mīles, mīlit-is')}).</p>
          ${declTheory(B['rēx'])}<p>Neutra (правило среднего рода):</p>${declTheory(B['nōmen'])}
          <p>Genitiv Plural — на -um или -ium (${la('urbium, hostium')}); в учебнике это указано: «Gen. Pl. …».</p>` },
      { id: 'kasus', title: 'Определи падеж', sub: 'все склонения вперемешку', make: (words) => {
          const pool = poolOf(words, nounOf(['1', '2', '3']), 10);
          return build(['identify', 'pick', 'identify', 'identify', 'type', 'identify', 'pick', 'identify', 'type', 'identify'], (k) => NOUN[k](pick(pool)));
        },
        theory: () => `<p>Сводная таблица окончаний:</p>
          ${table(['', 'a', 'o (m)', 'o (n)', '3. Dekl.'], [
            ['Nom. Sg.', '-a', '-us / -er', '-um', '—'], ['Gen. Sg.', '-ae', '-ī', '-ī', '-is'], ['Dat. Sg.', '-ae', '-ō', '-ō', '-ī'],
            ['Akk. Sg.', '-am', '-um', '-um', '-em / = Nom.'], ['Abl. Sg.', '-ā', '-ō', '-ō', '-e'],
            ['Nom. Pl.', '-ae', '-ī', '-a', '-ēs / -a'], ['Gen. Pl.', '-ārum', '-ōrum', '-ōrum', '-(i)um'], ['Dat. Pl.', '-īs', '-īs', '-īs', '-ibus'],
            ['Akk. Pl.', '-ās', '-ōs', '-a', '-ēs / -a'], ['Abl. Pl.', '-īs', '-īs', '-īs', '-ibus']])}` },
    ],
  },
  {
    id: 'u3', title: 'Согласование и предлоги', color: '#ce82ff',
    lessons: [
      { id: 'kng', title: 'KNG-Kongruenz', sub: 'puella bona, mīles bonus', make: (words) => {
          const adjs = poolOf(words, adjOk, 3), nouns = poolOf(words, nounOf(['1', '2', '3']), 8);
          return build(['c', 'c', 'c', 't', 'c', 'c', 't', 'c', 'c', 't'], (k) => (k === 'c' ? KNG.choice : KNG.type)(pick(adjs), pick(nouns)));
        },
        theory: () => `<p>Прилагательное принимает тот же <b>K</b>asus, <b>N</b>umerus и <b>G</b>enus, что и существительное. Окончания при этом <b>не обязаны совпадать</b>:</p>
          ${table(['', 'Maskulinum', 'Femininum', 'Neutrum'], [['Nom. Sg.', 'magnus', 'magna', 'magnum'], ['Gen. Sg.', 'magnī', 'magnae', 'magnī'], ['Akk. Sg.', 'magnum', 'magnam', 'magnum'], ['Nom. Pl.', 'magnī', 'magnae', 'magna']])}
          <p>${la('agricola bonus')} — agricola мужского рода, хотя оканчивается на -a. ${la('mīles bonus, rēx magnus, nōmen magnum')} — 3. Deklination с прилагательным на -us/-a/-um.</p>` },
      { id: 'praep', title: 'Предлоги и падежи', sub: 'ad + Akk., cum + Abl.', make: (words) => {
          const preps = poolOf(words, prepOk, 6), kinds = preps.filter((p) => norm(p.latin) !== 'in');
          const nouns = poolOf(words, nounOf(['1', '2', '3']), 8);
          return build(['k', 'p', 'k', 'p', 'k', 'p', 'p', 'k', 'p', 'k'], (k) => (k === 'k' ? PREP.kind(pick(kinds.length ? kinds : preps)) : PREP.phrase(pick(preps), pick(nouns))));
        },
        theory: () => `<p>Каждый предлог требует определённого падежа:</p>
          ${table(['mit Akkusativ', 'mit Ablativ'], [['ad — zu', 'cum — mit'], ['ante — vor', 'ē, ex — aus'], ['per — durch', 'ā, ab — von'], ['post — nach', 'dē — über, von'], ['prope — nahe bei', 'sine — ohne'], ['inter — zwischen', 'prō — für']])}
          <p>${la('in')} бывает с обоими: <b>in + Akk.</b> — куда? (${la('in villam')} — in das Landhaus), <b>in + Abl.</b> — где? (${la('in villā')} — im Landhaus).</p>` },
    ],
  },
  {
    id: 'u4', title: 'Прошедшее и будущее', color: '#ff9600',
    lessons: [
      { id: 'impf', title: 'Imperfekt', sub: 'amābam, amābās …', make: verbLesson(['1', '2', '3', '3io', '4'], ['impf']),
        theory: () => `<p>Признак Imperfekt — <b>-ba-</b> между основой и окончанием. В 1. Sg. окончание <b>-m</b>:</p>
          ${table(['', 'a', 'e', 'kons.', 'i / gem.'], PERS_SHORT.map((p, i) => [p, ...['amāre', 'monēre', 'regere', 'audīre'].map((v) => esc(EX(B[v], 'impf')[i]))]))}
          <p>У konsonantische и i-Konjugation перед -ba- стоит ${la('-ē-')} / ${la('-iē-')}: ${la('regēbam, audiēbam, capiēbam')}. У esse — ${la('eram, erās, erat …')}</p>` },
      { id: 'fut1', title: 'Futur I', sub: 'amābō / regam', make: verbLesson(['1', '2', '3', '3io', '4'], ['fut1']),
        theory: () => `<p>Futur образуется по-разному в двух группах спряжений:</p>
          ${table(['', 'a / e: -b-', 'kons. / i / gem.: -a-/-e-'], PERS_SHORT.map((p, i) => [p, esc(EX(B['amāre'], 'fut1')[i]), esc(EX(B['regere'], 'fut1')[i])]))}
          <p>Осторожно: ${la('regēs')} — это Futur, а ${la('monēs')} — Präsens e-Konjugation. Поэтому важно знать спряжение глагола.</p>` },
      { id: 'perf', title: 'Perfekt', sub: 'amāvī, amāvistī …', make: verbLesson(['1', '2', '3', '3io', '4'], ['perf']),
        theory: () => `<p>Perfekt строится от <b>основы перфекта</b>: это 1. Sg. Perfekt без -ī (${la('amāv-ī')} → ${la('amāv-')}). Окончания одинаковы для всех глаголов:</p>
          ${persTable(B['amāre'], 'perf', ['-ī', '-istī', '-it', '-imus', '-istis', '-ērunt'])}
          <p>Основу перфекта учат вместе с глаголом: ${la('amāvī')} (-v-), ${la('monuī')} (-u-), ${la('rēxī')} (-s-: reg + s), ${la('vēnī')} (удлинение), ${la('dedī')} (удвоение).</p>` },
      { id: 'plqpf', title: 'Plusquamperfekt и Futur II', sub: 'amāveram, amāverō', make: verbLesson(['1', '2', '3', '3io', '4'], ['plqpf', 'fut2']),
        theory: () => `<p>Обе формы — от основы перфекта. Окончания похожи на формы ${la('esse')}:</p>
          ${table(['', 'Plusquamperfekt', 'Futur II'], PERS_SHORT.map((p, i) => [p, esc(EX(B['amāre'], 'plqpf')[i]), esc(EX(B['amāre'], 'fut2')[i])]))}
          <p>Plusquamperfekt = основа + ${la('eram, erās …')}; Futur II = основа + ${la('erō, eris …')}, но в 3. Pl. ${la('-erint')}.</p>` },
      { id: 'tempus', title: 'Определи время', sub: 'все шесть времён', make: (words) => {
          const all = ['praes', 'impf', 'fut1', 'perf', 'plqpf', 'fut2'];
          const pool = poolOf(words, (w) => all.every((t) => regularVerb(['1', '2', '3', '3io', '4'], t)(w)), 8);
          return build(['tense', 'tense', 'pick', 'tense', 'tense', 'identify', 'tense', 'tense', 'pick', 'tense'], (k) => VERB[k](pick(pool), all));
        },
        theory: () => `<p>Признаки времён:</p>
          ${table(['Tempus', 'Признак', 'Пример'], [['Präsens', 'личные окончания', 'amat, regit'], ['Imperfekt', '-ba-', 'amābat, regēbat'], ['Futur I', '-bi- / -e-', 'amābit, reget'], ['Perfekt', 'основа перфекта + -it', 'amāvit, rēxit'], ['Plusquamperfekt', 'основа перфекта + -era-', 'amāverat'], ['Futur II', 'основа перфекта + -eri-', 'amāverit']])}` },
    ],
  },
  {
    id: 'u5', title: 'Неправильные глаголы', color: '#ff4b4b',
    lessons: [
      { id: 'posse', title: 'posse — «мочь»', sub: 'possum, potes …', make: irrLesson('posse', ['praes', 'impf', 'fut1']),
        theory: () => `<p>${la('posse')} = ${la('pot-')} + ${la('esse')}. Перед s — ${la('pos-')}, перед e — ${la('pot-')}:</p>
          ${table(['', 'Präsens', 'Imperfekt', 'Futur I'], PERS_SHORT.map((p, i) => [p, ...['praes', 'impf', 'fut1'].map((t) => esc(EX(IRR.posse, t)[i]))]))}` },
      { id: 'ire', title: 'īre — «идти»', sub: 'eō, īs, it …', make: irrLesson('ire', ['praes', 'impf', 'fut1']),
        theory: () => `<p>Основа ${la('ī-')}; перед гласной она становится ${la('e-')}: ${la('eō, eunt')}. Так же спрягаются ${la('abīre, adīre, exīre, perīre, subīre')}.</p>
          ${table(['', 'Präsens', 'Imperfekt', 'Futur I'], PERS_SHORT.map((p, i) => [p, ...['praes', 'impf', 'fut1'].map((t) => esc(EX(IRR.ire, t)[i]))]))}` },
    ],
  },
];

export const LESSONS = UNITS.flatMap((u) => u.lessons.map((l) => ({ ...l, unit: u })));
export const lessonById = (id) => LESSONS.find((l) => l.id === id);

// Проверка введённого ответа: 'exact' — точно, 'macron' — верно без учёта знаков долготы, false — неверно.
export function checkForm(input, answer) {
  const a = (input || '').normalize('NFC').trim().toLowerCase(), b = (answer || '').normalize('NFC').trim().toLowerCase();
  if (!a) return false;
  if (a === b) return 'exact';
  return norm(a) === norm(b) ? 'macron' : false;
}
