// Части речи и грамматические поля карточки. Грамматические термины — на немецком.

// [ключ, название, сокращение, название группы]
export const POS = [
  ['noun', 'Substantiv', 'Subst.', 'Substantive'],
  ['verb', 'Verb', 'Verb', 'Verben'],
  ['adj', 'Adjektiv', 'Adj.', 'Adjektive'],
  ['prep', 'Präposition', 'Präp.', 'Präpositionen'],
  ['adv', 'Adverb', 'Adv.', 'Adverbien'],
  ['pron', 'Pronomen', 'Pron.', 'Pronomen'],
  ['conj', 'Konjunktion', 'Konj.', 'Konjunktionen'],
  ['num', 'Numerale', 'Num.', 'Numeralia'],
  ['part', 'Partikel', 'Part.', 'Partikeln'],
  ['interj', 'Interjektion', 'Interj.', 'Interjektionen'],
  ['phrase', 'Wendung', 'Wend.', 'Wendungen'],
];
export const POS_KEYS = POS.map((p) => p[0]);
const posCol = (k, i) => (POS.find((p) => p[0] === k) || [])[i] || '';
export const posLabel = (k) => posCol(k, 1);
export const posShort = (k) => posCol(k, 2);
export const posPlural = (k) => posCol(k, 3);

const STRUCT = {
  noun: [
    { k: 'gen', label: 'Genitiv Singular', short: 'Gen. Sg.', la: true, ph: 'z. B. rosae' },
    { k: 'gender', label: 'Genus', short: 'Genus', options: [['m', 'm — Maskulinum'], ['f', 'f — Femininum'], ['n', 'n — Neutrum']] },
    { k: 'decl', label: 'Deklination', short: 'Deklination', options: [['1', 'a-Deklination (1.)'], ['2', 'o-Deklination (2.)'], ['3', '3. Deklination'], ['4', 'u-Deklination (4.)'], ['5', 'e-Deklination (5.)'], ['irr', 'unregelmäßig / indeklinabel']] },
  ],
  verb: [
    { k: 'p1', label: '1. Person Singular Präsens', short: '1. Sg.', la: true, ph: 'z. B. amō' },
    { k: 'inf', label: 'Infinitiv', short: 'Infinitiv', la: true, ph: 'z. B. amāre (если не стоит в заголовке)' },
    { k: 'perf', label: 'Perfekt (1. Person Singular)', short: 'Perfekt', la: true, ph: 'z. B. amāvī' },
    { k: 'sup', label: 'Supinum / PPP', short: 'PPP', la: true, ph: 'z. B. amātum' },
    { k: 'conj', label: 'Konjugation', short: 'Konjugation', options: [['1', 'a-Konjugation (1.)'], ['2', 'e-Konjugation (2.)'], ['3', 'konsonantische Konjugation (3.)'], ['3io', 'gemischte Konjugation (3., -iō)'], ['4', 'i-Konjugation (4.)'], ['irr', 'unregelmäßig']] },
  ],
  adj: [
    { k: 'm', label: 'Maskulinum', short: 'm', la: true, ph: 'z. B. bonus' },
    { k: 'f', label: 'Femininum', short: 'f', la: true, ph: 'z. B. bona' },
    { k: 'n', label: 'Neutrum', short: 'n', la: true, ph: 'z. B. bonum' },
    { k: 'comp', label: 'Komparativ', short: 'Komparativ', la: true, ph: 'z. B. melior' },
    { k: 'superl', label: 'Superlativ', short: 'Superlativ', la: true, ph: 'z. B. optimus' },
  ],
  prep: [
    { k: 'case', label: 'Kasus', short: 'Kasus', options: [['acc', 'mit Akkusativ'], ['abl', 'mit Ablativ'], ['accabl', 'mit Akkusativ und Ablativ'], ['gen', 'mit Genitiv']] },
  ],
};
const FREE = [{ k: 'note', label: 'Grammatiknotiz', short: 'Grammatik', la: true, area: true, ph: 'Formen, Rektion, Besonderheiten' }];

export const ALL_GRAM_KEYS = [...new Set([...Object.values(STRUCT).flat(), ...FREE].map((f) => f.k))];

export function fieldsFor(pos) {
  if (!pos) return [];
  return STRUCT[pos] || FREE;
}

// «Грамматика заполнена»: часть речи указана и (для сущ./гл./прил./предл.) заполнено хотя бы одно поле.
export function gramFilled(w) {
  if (!w.pos) return false;
  if (!STRUCT[w.pos]) return true;
  return STRUCT[w.pos].some((f) => w.gram && w.gram[f.k]);
}

// Пары [подпись, значение] для показа в карточке и после ответа.
export function gramPairs(w) {
  const out = [];
  for (const f of fieldsFor(w.pos)) {
    const v = w.gram && w.gram[f.k];
    if (!v) continue;
    const text = f.options ? (f.options.find((o) => o[0] === v) || [v, v])[1] : v;
    out.push([f.short, text, !!f.la]);
  }
  return out;
}

// ---------- Разбор помет из учебника ----------

const plain = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const INF_END = /(are|ere|ire|sse|lle|rre)$/;
export const looksLikeInfinitive = (s) => INF_END.test(plain((s || '').trim().split(/[\s,]/)[0]));

// Склонение по именительному и родительному падежу.
export function inferDecl(nom, gen) {
  const g = plain((gen || '').trim().split(/\s+/).pop());
  if (!g) return '';
  if (/(ae|arum)$/.test(g)) return '1';
  if (/orum$/.test(g)) return '2';
  if (/ei$/.test(g) && /es$/.test(plain(nom))) return '5';
  if (/i$/.test(g)) return '2';
  if (/is$/.test(g) || /um$/.test(g)) return '3';
  if (/us$/.test(g)) return '4';
  return '';
}

// Спряжение по инфинитиву и 1-му лицу.
export function inferConj(inf, p1) {
  const i = plain(inf), p = plain(p1);
  if (!i) return '';
  if (/(sse|lle|rre)$/.test(i) || (/ire$/.test(i) && /eo$/.test(p)) || i === 'ire') return 'irr';
  if (/are$/.test(i)) return '1';
  if (/ire$/.test(i)) return '4';
  if (/ere$/.test(i)) {
    if (/ēre$/.test(inf.trim().toLowerCase().normalize('NFC')) || /eo$/.test(p)) return '2';
    return /io$/.test(p) ? '3io' : '3';
  }
  return '';
}

const CASES = { akk: 'acc', abl: 'abl', gen: 'gen' };

// Второй столбец учебника → часть речи, грамматические поля и заметка.
// Примеры помет: «Adv.», «Präp. + Abl.», «-a, -um», «misera, miserum», «arcis f. Gen. Pl. arcium»,
// «timeō, timuī», «familiam f.» (в первых уроках там стоит Akkusativ).
export function inferGrammar(latin, info, de) {
  const la = (latin || '').trim(), t = (info || '').replace(/\s+/g, ' ').trim();
  const out = (pos, gram = {}, note = '') => ({ pos, gram, note });
  if (/^adv\.?$/i.test(t)) return out('adv');
  if (/^(konj|subj)\.?/i.test(t)) return out('conj', {}, /^(konj|subj)\.?$/i.test(t) ? '' : t);
  const prep = t.match(/^pr[äa]p\.?\s*\+?\s*(akk|abl|gen)?/i);
  if (prep) {
    const plainMark = /^pr[äa]p\.?\s*\+\s*(akk|abl|gen)\.?$/i.test(t); // падеж уже записан в поле, заметка не нужна
    return out('prep', prep[1] ? { case: CASES[prep[1].toLowerCase()] } : {}, plainMark ? '' : t);
  }

  // Прилагательные: «-a, -um», «-ae, -a Pl.», «-tra, -trum», «misera, miserum», «pulcher m., pulchra f., pulchrum n.»
  const suf = t.match(/^-(\p{L}+),\s*-(\p{L}+)\s*(.*)$/u);
  if (suf) {
    const p = plain(la);
    const stem = /^tr/.test(suf[1]) && /ter$/.test(p) ? la.slice(0, -3) : /us$/.test(p) ? la.slice(0, -2) : /i$/.test(p) ? la.slice(0, -1) : la;
    const forms = `${la}, ${stem}${suf[1]}, ${stem}${suf[2]}`;
    if (/pron\./i.test(suf[3])) return out('pron', {}, `${forms} — ${suf[3]}`);
    return out('adj', { m: la, f: stem + suf[1], n: stem + suf[2] }, suf[3]);
  }
  const three = t.match(/^(\S+) m\.( Pl\.)?, (\S+) f\.( Pl\.)?, (\S+) n\.( Pl\.)?$/);
  if (three) return out('adj', { m: three[1], f: three[3], n: three[5] }, three[2] ? 'Pl.' : '');
  if (/pron\./i.test(t)) {
    const hasForms = /^\p{Ll}+,?\s/u.test(t) && !/^(nicht|refl)/.test(t);
    return out('pron', {}, hasForms ? `${la}, ${t}` : t);
  }
  const two = t.match(/^(\p{L}+a), (\p{L}+um)$/u);
  if (two && !looksLikeInfinitive(la)) return out('adj', { m: la, f: two[1], n: two[2] });

  // Существительные: «arcis f. Gen. Pl. arcium», «thermārum f. Pl.», «familiam f.»
  const noun = t.match(/^(.+?) ([mfn])\.(\/[mfn]\.)?( Pl\.)?\s*(.*)$/);
  if (noun) {
    const form = noun[1], pl = !!noun[4], f = plain(form);
    const extra = [noun[3] ? `${noun[2]}.${noun[3]}` : '', pl ? 'Pl.' : '', noun[5]].filter(Boolean).join(' ');
    const isGen = pl ? /um$/.test(f) : !/m$/.test(f);
    if (isGen) return out('noun', { gen: form, gender: noun[2], decl: inferDecl(la, form) }, extra);
    const decl = /(am|as)$/.test(f) ? '1' : /(em|es)$/.test(f) ? '3' : /(um|os)$/.test(f) ? '2' : '';
    return out('noun', decl ? { gender: noun[2], decl } : { gender: noun[2] }, [`Akk. ${form}`, extra].filter(Boolean).join(', '));
  }

  // Глаголы: «amō», «timeō, timuī», «fugiō, fūgī + Akk.», «sum, es, est, …», «amat» (3-е лицо в первых уроках)
  if (looksLikeInfinitive(la) && !/\s/.test(la)) {
    const rection = (t.match(/\(?\+\s*\p{L}+\.?\)?/u) || [''])[0];
    const forms = t.replace(rection, '').split(',').map((x) => x.trim()).filter(Boolean);
    const gram = {};
    const first = plain(forms[0] || '');
    if (/(o|sum)$/.test(first)) gram.p1 = forms[0];
    const second = forms[1] || '';
    if (gram.p1 && /i$/.test(plain(second)) && forms.length === 2) gram.perf = second;
    const conj = inferConj(la, gram.p1 || '');
    if (conj) gram.conj = conj;
    const simple = gram.p1 && (forms.length === 1 || (forms.length === 2 && gram.perf));
    return out('verb', gram, simple ? rection : t);
  }
  if (/^3\. ?P\. ?Sg\.?$/i.test(t) || /^er\/sie\/es\b/i.test((de || '').trim())) return out('verb', {}, t);
  return out('', {}, t);
}

// Подгруппы внутри части речи: глаголы — по спряжению, существительные — по склонению, предлоги — по падежу.
const SUBGROUP = { noun: 'decl', verb: 'conj', prep: 'case' };
export function subgroups(pos) {
  const key = SUBGROUP[pos];
  if (!key) return null;
  const field = STRUCT[pos].find((f) => f.k === key);
  return { key, options: field.options, none: `${field.label} не указано` };
}
