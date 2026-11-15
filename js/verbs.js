// Автоматическое спряжение глагола: Indikativ Aktiv, шесть времён.
// Строится из словарной формы, инфинитива, перфекта и спряжения.

export const TENSES = [
  ['praes', 'Präsens'],
  ['impf', 'Imperfekt'],
  ['fut1', 'Futur I'],
  ['perf', 'Perfekt'],
  ['plqpf', 'Plusquamperfekt'],
  ['fut2', 'Futur II'],
];

const BAM = ['bam', 'bās', 'bat', 'bāmus', 'bātis', 'bant'];
const BO = ['bō', 'bis', 'bit', 'bimus', 'bitis', 'bunt'];
const AM = ['am', 'ēs', 'et', 'ēmus', 'ētis', 'ent'];
const pre = (p, list) => list.map((e) => p + e);

const PRESENT = {
  '1': { praes: ['ō', 'ās', 'at', 'āmus', 'ātis', 'ant'], impf: pre('ā', BAM), fut1: pre('ā', BO) },
  '2': { praes: ['eō', 'ēs', 'et', 'ēmus', 'ētis', 'ent'], impf: pre('ē', BAM), fut1: pre('ē', BO) },
  '3': { praes: ['ō', 'is', 'it', 'imus', 'itis', 'unt'], impf: pre('ē', BAM), fut1: AM },
  '3io': { praes: ['iō', 'is', 'it', 'imus', 'itis', 'iunt'], impf: pre('iē', BAM), fut1: pre('i', AM) },
  '4': { praes: ['iō', 'īs', 'it', 'īmus', 'ītis', 'iunt'], impf: pre('iē', BAM), fut1: pre('i', AM) },
};
const PERFECT = {
  perf: ['ī', 'istī', 'it', 'imus', 'istis', 'ērunt'],
  plqpf: ['eram', 'erās', 'erat', 'erāmus', 'erātis', 'erant'],
  fut2: ['erō', 'eris', 'erit', 'erimus', 'eritis', 'erint'],
};

const SUM = {
  praes: ['sum', 'es', 'est', 'sumus', 'estis', 'sunt'],
  impf: ['eram', 'erās', 'erat', 'erāmus', 'erātis', 'erant'],
  fut1: ['erō', 'eris', 'erit', 'erimus', 'eritis', 'erunt'],
};
const EO = {
  praes: ['eō', 'īs', 'it', 'īmus', 'ītis', 'eunt'],
  impf: pre('ī', BAM),
  fut1: pre('ī', BO),
};
const FERO = {
  praes: ['ferō', 'fers', 'fert', 'ferimus', 'fertis', 'ferunt'],
  impf: pre('ferē', BAM),
  fut1: pre('fer', AM),
};
const FIXED = {
  possum: {
    praes: ['possum', 'potes', 'potest', 'possumus', 'potestis', 'possunt'],
    impf: pre('pot', SUM.impf), fut1: pre('pot', SUM.fut1),
  },
  volo: {
    praes: ['volō', 'vīs', 'vult', 'volumus', 'vultis', 'volunt'],
    impf: pre('volē', BAM), fut1: pre('vol', AM),
  },
  nolo: {
    praes: ['nōlō', 'nōn vīs', 'nōn vult', 'nōlumus', 'nōn vultis', 'nōlunt'],
    impf: pre('nōlē', BAM), fut1: pre('nōl', AM),
  },
  malo: {
    praes: ['mālō', 'māvīs', 'māvult', 'mālumus', 'māvultis', 'mālunt'],
    impf: pre('mālē', BAM), fut1: pre('māl', AM),
  },
};

// Первая форма из поля («amō, amāre» → «amō»), в нижнем регистре, в составных символах.
const first = (s) => (s || '').normalize('NFC').trim().split(/[\s,;(]/)[0].toLowerCase();
// Без знаков долготы; длина строки сохраняется.
const plain = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC');

function irregular(lemma, inf) {
  const l = plain(lemma), i = plain(inf);
  if (l === 'possum') return FIXED.possum;
  if (l === 'volo' && i === 'velle') return FIXED.volo;
  if (l === 'nolo') return FIXED.nolo;
  if (l === 'malo') return FIXED.malo;
  const withPrefix = (tail, table) => {
    const p = lemma.slice(0, lemma.length - tail);
    return { praes: pre(p, table.praes), impf: pre(p, table.impf), fut1: pre(p, table.fut1) };
  };
  if (l.endsWith('sum') && (!i || i.endsWith('esse')) && l !== 'prosum') return withPrefix(3, SUM);
  if (l.endsWith('eo') && i.endsWith('ire')) return withPrefix(2, EO);
  if (l.endsWith('fero') && (!i || i.endsWith('ferre'))) return withPrefix(4, FERO);
  return null;
}

function inferConj(lemma, inf) {
  const l = plain(lemma), i = plain(inf);
  if (i.endsWith('are')) return '1';
  if (i.endsWith('ire')) return '4';
  if (i.endsWith('ere')) {
    if (l.endsWith('eo')) return '2';
    if (l.endsWith('io')) return '3io';
    return inf.endsWith('ēre') ? '2' : '3';
  }
  return '';
}

// Возвращает { tenses: { praes: [6 форм] | null, … }, notes: [строки] }.
export function conjugate(w) {
  const g = w.gram || {};
  const lemma = first(w.latin), inf = first(g.inf), perf = first(g.perf);
  const tenses = {}, notes = [];
  for (const [k] of TENSES) tenses[k] = null;

  const deponent = plain(lemma).endsWith('or') || (inf && plain(inf).endsWith('i'));
  if (deponent) {
    notes.push('Deponentien (глаголы на -or) пока не спрягаются автоматически.');
    return { tenses, notes };
  }

  // Präsensstamm: Präsens, Imperfekt, Futur I
  const irr = irregular(lemma, inf);
  if (irr) Object.assign(tenses, irr);
  else if (g.conj === 'irr') notes.push('Неправильный глагол: Präsens, Imperfekt и Futur I смотрите в учебнике.');
  else {
    const conj = PRESENT[g.conj] ? g.conj : inferConj(lemma, inf);
    let base = '';
    if (conj && inf && /re$/.test(plain(inf)) && inf.length > 3) base = inf.slice(0, -3);
    else if (conj && lemma) {
      const cut = { '1': 'o', '3': 'o', '2': 'eo', '3io': 'io', '4': 'io' }[conj];
      if (plain(lemma).endsWith(cut)) base = lemma.slice(0, lemma.length - cut.length);
    }
    if (conj && base) {
      for (const k of ['praes', 'impf', 'fut1']) tenses[k] = pre(base, PRESENT[conj][k]);
    } else {
      notes.push('Для Präsens, Imperfekt и Futur I укажите Infinitiv или Konjugation.');
    }
  }

  // Perfektstamm: Perfekt, Plusquamperfekt, Futur II
  if (perf && plain(perf).endsWith('i') && perf.length > 1) {
    const stem = perf.slice(0, -1);
    for (const k of ['perf', 'plqpf', 'fut2']) tenses[k] = pre(stem, PERFECT[k]);
  } else {
    notes.push('Для Perfekt, Plusquamperfekt и Futur II укажите форму Perfekt (напр. amāvī).');
  }
  return { tenses, notes };
}
