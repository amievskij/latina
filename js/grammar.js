// Части речи и грамматические поля карточки.

export const POS = [
  ['noun', 'Существительное', 'сущ.'],
  ['verb', 'Глагол', 'гл.'],
  ['adj', 'Прилагательное', 'прил.'],
  ['prep', 'Предлог', 'предл.'],
  ['adv', 'Наречие', 'нар.'],
  ['pron', 'Местоимение', 'мест.'],
  ['conj', 'Союз', 'союз'],
  ['num', 'Числительное', 'числ.'],
  ['part', 'Частица', 'част.'],
  ['interj', 'Междометие', 'межд.'],
  ['phrase', 'Выражение', 'выр.'],
];
export const POS_KEYS = POS.map((p) => p[0]);
export const posLabel = (k) => (POS.find((p) => p[0] === k) || [])[1] || '';
export const posShort = (k) => (POS.find((p) => p[0] === k) || [])[2] || '';

const STRUCT = {
  noun: [
    { k: 'gen', label: 'Родительный падеж (Gen. Sg.)', short: 'Gen.', la: true, ph: 'напр. rosae' },
    { k: 'gender', label: 'Род', short: 'Род', options: [['m', 'm — мужской'], ['f', 'f — женский'], ['n', 'n — средний']] },
    { k: 'decl', label: 'Склонение', short: 'Склонение', options: [['1', '1-е (a)'], ['2', '2-е (o)'], ['3', '3-е'], ['4', '4-е (u)'], ['5', '5-е (e)'], ['irr', 'неправильное / несклоняемое']] },
  ],
  verb: [
    { k: 'inf', label: 'Инфинитив', short: 'Inf.', la: true, ph: 'напр. amāre' },
    { k: 'perf', label: 'Перфект (1 л. ед. ч.)', short: 'Perf.', la: true, ph: 'напр. amāvī' },
    { k: 'sup', label: 'Супин / PPP', short: 'Sup.', la: true, ph: 'напр. amātum' },
    { k: 'conj', label: 'Спряжение', short: 'Спряжение', options: [['1', '1-е (ā)'], ['2', '2-е (ē)'], ['3', '3-е (согласное)'], ['3io', '3-е смешанное (-iō)'], ['4', '4-е (ī)'], ['irr', 'неправильный']] },
  ],
  adj: [
    { k: 'm', label: 'Мужской род', short: 'm', la: true, ph: 'напр. bonus' },
    { k: 'f', label: 'Женский род', short: 'f', la: true, ph: 'напр. bona' },
    { k: 'n', label: 'Средний род', short: 'n', la: true, ph: 'напр. bonum' },
    { k: 'comp', label: 'Сравнительная степень', short: 'Komp.', la: true, ph: 'напр. melior' },
    { k: 'superl', label: 'Превосходная степень', short: 'Superl.', la: true, ph: 'напр. optimus' },
  ],
  prep: [
    { k: 'case', label: 'С каким падежом', short: 'Падеж', options: [['acc', 'Akkusativ'], ['abl', 'Ablativ'], ['accabl', 'Akkusativ и Ablativ'], ['gen', 'Genitiv']] },
  ],
};
const FREE = [{ k: 'note', label: 'Грамматическая заметка', short: 'Грамматика', la: true, area: true, ph: 'формы, управление, особенности' }];

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
