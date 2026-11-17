// Склонение существительных (пять падежей, единственное и множественное число)
// и формы прилагательных a/o-склонения для согласования.

export const CASES = [
  ['nom', 'Nominativ', 'Nom.'],
  ['gen', 'Genitiv', 'Gen.'],
  ['dat', 'Dativ', 'Dat.'],
  ['acc', 'Akkusativ', 'Akk.'],
  ['abl', 'Ablativ', 'Abl.'],
];

const plain = (s) => (s || '').normalize('NFC').normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC').toLowerCase();
const first = (s) => (s || '').normalize('NFC').trim().split(/[\s,;(]/)[0];
// Отрезает окончание (сравнение без знаков долготы). null — если слово так не оканчивается.
function strip(word, endings) {
  const p = plain(word);
  for (const e of endings) if (p.endsWith(e) && p.length > e.length) return word.slice(0, word.length - e.length);
  return null;
}
const vowelGroups = (s) => (plain(s).match(/[aeiouy]+/g) || []).length;

const E = {
  a: { sg: ['a', 'ae', 'ae', 'am', 'ā'], pl: ['ae', 'ārum', 'īs', 'ās', 'īs'] },
  o: { sg: ['us', 'ī', 'ō', 'um', 'ō'], pl: ['ī', 'ōrum', 'īs', 'ōs', 'īs'] },
  on: { sg: ['um', 'ī', 'ō', 'um', 'ō'], pl: ['a', 'ōrum', 'īs', 'a', 'īs'] },
  u: { sg: ['us', 'ūs', 'uī', 'um', 'ū'], pl: ['ūs', 'uum', 'ibus', 'ūs', 'ibus'] },
};

// Слова с неправильными формами: для них таблица не строится.
const SKIP = new Set(['bos', 'deus', 'dea', 'filia', 'domus', 'iuppiter', 'vis', 'fames', 'se']);
// 3. склонение: родительный мн. ч. на -um, хотя по общему правилу ожидалось бы -ium.
const UM = new Set(['canis', 'iuvenis', 'senex', 'pater', 'mater', 'frater', 'parens', 'sedes', 'vates']);

function genPl3(lemma, gen, note) {
  const given = (note || '').match(/Gen\.\s*Pl\.\s*([^\s,;]+)/);
  if (given) return given[1];
  const stem = gen.slice(0, -2);
  const l = plain(lemma);
  if (UM.has(l)) return stem + 'um';
  // равносложные (hostis, hostis — vestis, vestis): -ium
  if (/(is|es)$/.test(l) && vowelGroups(lemma) === vowelGroups(gen)) return stem + 'ium';
  // односложные с двумя согласными в основе (urbs, urb-is; mors, mort-is): -ium
  if (vowelGroups(lemma) === 1 && /[^aeiouy][^aeiouy]$/.test(plain(stem))) return stem + 'ium';
  return stem + 'um';
}

const withoutGenPl = (note) => (note || '').replace(/Gen\.\s*Pl\.\s*\S+/g, '');

// Возвращает { sg: [5 форм] | null, pl: [5 форм], gender, decl } или null, если таблицу построить нельзя.
export function decline(w) {
  if (!w || w.pos !== 'noun') return null;
  const lemma = (w.latin || '').normalize('NFC').trim();
  if (!lemma || /\s/.test(lemma) || SKIP.has(plain(lemma))) return null;
  const g = w.gram || {};
  const gen = first(g.gen), gender = g.gender, decl = g.decl;
  if (!gen || !decl || decl === 'irr') return null;
  const pg = plain(gen);
  const neuter = gender === 'n';
  const pluralOnly = /\bPl\./.test(withoutGenPl(w.note)) || /rum$/.test(pg) || (decl === '3' && /um$/.test(pg));

  if (pluralOnly) {
    let pl = null;
    if (decl === '1') { const s = strip(gen, ['arum']); if (s) pl = [lemma, ...E.a.pl.slice(1).map((e) => s + e)]; }
    if (decl === '2') { const s = strip(gen, ['orum']); if (s) pl = [lemma, ...(neuter ? E.on : E.o).pl.slice(1).map((e) => s + e)]; }
    if (decl === '3') {
      const s = /ium$/.test(pg) ? gen.slice(0, -3) : gen.slice(0, -2);
      pl = [lemma, gen, s + 'ibus', neuter ? lemma : s + 'ēs', s + 'ibus'];
    }
    return pl ? { sg: null, pl, gender, decl } : null;
  }

  let sg = null, pl = null;
  if (decl === '1') {
    const s = strip(gen, ['ae']);
    if (!s) return null;
    sg = [lemma, ...E.a.sg.slice(1).map((e) => s + e)];
    pl = E.a.pl.map((e) => s + e);
  } else if (decl === '2') {
    const s = strip(gen, ['i']);
    if (!s || !gender) return null;
    const t = neuter ? E.on : E.o;
    sg = [lemma, ...t.sg.slice(1).map((e) => s + e)];
    pl = t.pl.map((e) => s + e);
  } else if (decl === '3') {
    const s = strip(gen, ['is']);
    if (!s || !gender) return null;
    const iNeut = neuter && /(e|al|ar)$/.test(plain(lemma)); // mare, animal: Abl. -ī, Pl. -ia
    sg = [lemma, s + 'is', s + 'ī', neuter ? lemma : s + 'em', s + (iNeut ? 'ī' : 'e')];
    const nomPl = s + (neuter ? (iNeut ? 'ia' : 'a') : 'ēs');
    pl = [nomPl, iNeut ? s + 'ium' : genPl3(lemma, gen, w.note), s + 'ibus', nomPl, s + 'ibus'];
  } else if (decl === '4') {
    const s = strip(lemma, ['us']);
    if (!s || neuter) return null;
    sg = E.u.sg.map((e) => s + e);
    pl = E.u.pl.map((e) => s + e);
  } else if (decl === '5') {
    const s = strip(lemma, ['es']);
    if (!s) return null;
    const ei = /[aeiou]$/.test(plain(s)) ? 'ēī' : 'eī';
    sg = [lemma, s + ei, s + ei, s + 'em', s + 'ē'];
    pl = [s + 'ēs', s + 'ērum', s + 'ēbus', s + 'ēs', s + 'ēbus'];
  }
  return sg ? { sg, pl, gender, decl } : null;
}

// Формы прилагательного a/o-склонения: { m: {sg, pl}, f: {sg, pl}, n: {sg, pl}, pluralOnly } или null.
export function adjForms(w) {
  if (!w || w.pos !== 'adj') return null;
  const g = w.gram || {};
  const m = first(g.m), f = first(g.f), n = first(g.n);
  if (!m || !f || !n) return null;
  const pluralOnly = /\bPl\./.test(w.note || '') || (/i$/.test(plain(m)) && /ae$/.test(plain(f)));
  if (pluralOnly) {
    const s = strip(f, ['ae']);
    if (!s || !/a$/.test(plain(n))) return null;
    return {
      pluralOnly,
      m: { sg: null, pl: E.o.pl.map((e) => s + e) },
      f: { sg: null, pl: E.a.pl.map((e) => s + e) },
      n: { sg: null, pl: E.on.pl.map((e) => s + e) },
    };
  }
  const s = strip(f, ['a']);
  if (!s || !/um$/.test(plain(n))) return null;
  return {
    pluralOnly,
    m: { sg: [m, ...E.o.sg.slice(1).map((e) => s + e)], pl: E.o.pl.map((e) => s + e) },
    f: { sg: E.a.sg.map((e) => s + e), pl: E.a.pl.map((e) => s + e) },
    n: { sg: E.on.sg.map((e) => s + e), pl: E.on.pl.map((e) => s + e) },
  };
}
