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
    { k: 'inf', label: 'Infinitiv', short: 'Infinitiv', la: true, ph: 'z. B. amāre' },
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

// Подгруппы внутри части речи: глаголы — по спряжению, существительные — по склонению, предлоги — по падежу.
const SUBGROUP = { noun: 'decl', verb: 'conj', prep: 'case' };
export function subgroups(pos) {
  const key = SUBGROUP[pos];
  if (!key) return null;
  const field = STRUCT[pos].find((f) => f.k === key);
  return { key, options: field.options, none: `${field.label} не указано` };
}
