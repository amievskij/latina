// Распознавание списка слов с фотографии (Tesseract.js, работает на устройстве, без сервера).
// Библиотека и языковые данные лежат в vendor/tesseract и загружаются только при первом использовании.
//
// Страница учебника — это таблица: латынь | помета (Adv., Konj., familiam f.) | перевод,
// а рядом заголовки, рамки и колонка с примечаниями. Поэтому слова распознаются по отдельности,
// а столбцы и строки таблицы восстанавливаются по их расположению (parseTable).

const BASE = new URL('../vendor/tesseract/', import.meta.url).href;
let workerPromise = null;
let onLog = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (globalThis.Tesseract) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('не удалось загрузить модуль распознавания (нужен интернет при первом запуске)'));
    document.head.appendChild(s);
  });
}

// Загружает движок и языки (латынь + немецкий). Повторные вызовы возвращают тот же движок.
export function prepare(logger) {
  onLog = logger || null;
  if (!workerPromise) {
    workerPromise = (async () => {
      await loadScript(BASE + 'tesseract.min.js');
      const worker = await globalThis.Tesseract.createWorker(['lat', 'deu'], 1, {
        workerPath: BASE + 'worker.min.js',
        corePath: BASE.replace(/\/$/, ''),
        langPath: BASE + 'lang',
        workerBlobURL: false,
        logger: (m) => { if (onLog) onLog(m); },
      });
      await worker.setParameters({ tessedit_pageseg_mode: '11' }); // «разрозненный текст»: каждое слово отдельно
      return worker;
    })();
    workerPromise.catch(() => { workerPromise = null; });
  }
  return workerPromise;
}

async function loadBitmap(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('файл не похож на изображение'));
      img.src = URL.createObjectURL(file);
    });
  }
}

// Снимок, растянутый или сжатый так, чтобы длинная сторона была равна side.
function render(src, side) {
  const k = side / Math.max(src.width, src.height);
  const c = document.createElement('canvas');
  c.width = Math.round(src.width * k); c.height = Math.round(src.height * k);
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, c.width, c.height);
  return new Promise((resolve) => c.toBlob((blob) => resolve({ blob, k }), 'image/png'));
}

function wordsOf(data, k) {
  const out = [];
  for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) {
    for (const w of l.words || []) {
      out.push({ t: w.text, c: w.confidence, x0: w.bbox.x0 / k, x1: w.bbox.x1 / k, y0: w.bbox.y0 / k, y1: w.bbox.y1 / k });
    }
  }
  return out;
}

// Объединяет два прохода: слово из второго добавляется, если на его месте в первом пусто,
// а при совпадении места остаётся вариант, в котором движок увереннее.
const MARKER = /^(adv|konj|präp|subj|[mfn])\.?$/i;
// Насколько вариант похож на настоящее слово: уверенность движка, с поправкой на известные пометы и «шум» из заглавных.
const quality = (w) => w.c + (MARKER.test(w.t.trim()) ? 50 : 0) - (/^[A-ZÄÖÜ]{2,}$/.test(w.t.trim()) ? 25 : 0);

const overlaps = (o, w) => Math.min(o.x1, w.x1) - Math.max(o.x0, w.x0) > 0.3 * Math.min(o.x1 - o.x0, w.x1 - w.x0) &&
  Math.min(o.y1, w.y1) - Math.max(o.y0, w.y0) > 0.3 * Math.min(o.y1 - o.y0, w.y1 - w.y0);

export function mergeWords(a, b) {
  const out = [], usedB = new Set();
  for (const o of a) {
    const hits = [];
    b.forEach((w, i) => { if (overlaps(o, w)) hits.push(i); });
    if (hits.length >= 2) {
      // В первом проходе несколько слов слиплись в одно — берём отдельные слова из второго.
      for (const i of hits) if (!usedB.has(i)) { out.push({ ...b[i] }); usedB.add(i); }
    } else if (hits.length === 1) {
      const w = b[hits[0]];
      const glued = a.filter((o2) => overlaps(o2, w)).length >= 2; // слиплись во втором проходе
      out.push(!glued && !usedB.has(hits[0]) && quality(w) > quality(o) + 5 ? { ...w } : { ...o });
      usedB.add(hits[0]);
    } else out.push({ ...o });
  }
  b.forEach((w, i) => { if (!usedB.has(i) && !a.some((o) => overlaps(o, w))) out.push({ ...w }); });
  return out;
}

// ---------- Разбор таблицы ----------

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const hasLetter = (s) => /\p{L}/u.test(s);
const keep = (w) => {
  const t = (w.t || '').trim();
  if (!t) return false;
  if (!hasLetter(t)) return t === '+' || /^[?!]$/.test(t);
  if (/^(.)\1{3,}$/.test(t)) return false;
  return !(t.length === 1 && w.c < 60);
};

// Группировка по одной координате: соседние значения ближе tol попадают в одну группу.
function cluster(items, value, tol) {
  const sorted = [...items].sort((a, b) => value(a) - value(b));
  const groups = [];
  for (const it of sorted) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(value(it) - g.mean) <= tol) { g.items.push(it); g.mean += (value(it) - g.mean) / g.items.length; }
    else groups.push({ mean: value(it), items: [it] });
  }
  return groups;
}

// Наклон страницы: подбирается так, чтобы строки стали как можно ровнее.
function estimateSkew(ws, h, from = -0.1, to = 0.1) {
  let best = 0, bestScore = -1;
  for (let s = from; s <= to + 0.0001; s += 0.002) {
    const bins = new Map();
    for (const w of ws) { const k = Math.round((w.yc - s * w.x0) / (h * 0.5)); bins.set(k, (bins.get(k) || 0) + 1); }
    let score = 0;
    for (const n of bins.values()) score += n * n;
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return best;
}

// Местный наклон строк. Книжная страница изогнута, поэтому наклон у верха и низа разный:
// он измеряется по парам соседних слов одной строки и усредняется в окрестности нужной высоты.
function slopeField(ws, h) {
  // Грубая оценка по парам соседних слов одной строки. Она нужна, чтобы точный подбор ниже не «перескочил»
  // на соседнюю строку: при наклоне, равном шагу строк, делённому на расстояние между столбцами, строки тоже совпадают.
  const flat = (w) => !/[gjpqyQ,;()]/.test(w.t);
  const pairs = [];
  for (const a of ws) {
    if (!flat(a)) continue;
    let best = null, bestGap = Infinity;
    for (const b of ws) {
      const gap = b.x0 - a.x1;
      if (b === a || gap <= 0 || gap > 1.5 * h || !flat(b) || Math.abs(b.y1 - a.y1) > 0.6 * h) continue;
      if (gap < bestGap) { bestGap = gap; best = b; }
    }
    if (!best) continue;
    const dx = (best.x0 + best.x1) / 2 - (a.x0 + a.x1) / 2;
    if (dx > 1.5 * h) pairs.push((best.y1 - a.y1) / dx);
  }
  const coarse = pairs.length >= 12 ? Math.max(-0.08, Math.min(0.08, median(pairs))) : 0;
  const global = estimateSkew(ws, h, coarse - 0.035, coarse + 0.035);
  const STEP = 5 * h, cache = new Map();
  // Наклон в полосе страницы вокруг высоты k·STEP: подбирается только по словам этой полосы.
  const band = (k) => {
    if (!cache.has(k)) {
      const near = ws.filter((w) => Math.abs(w.yc - k * STEP) < 3.5 * STEP);
      // Местный наклон ищется рядом с общим: в полосе мало слов, и далёкие значения — это случайные совпадения.
      cache.set(k, near.length >= 40 ? estimateSkew(near, h, global - 0.03, global + 0.03) : global);
    }
    return cache.get(k);
  };
  const at = (y) => { // плавный переход между соседними полосами
    const f = y / STEP, k = Math.floor(f), t = f - k;
    return band(k) * (1 - t) + band(k + 1) * t;
  };
  // Насколько столбец «уезжает» вбок к высоте y (поворот страницы сдвигает и столбцы).
  const maxY = Math.max(...ws.map((w) => w.y1));
  const shift = [0];
  for (let i = 1; i * h <= maxY + h; i++) shift.push(shift[i - 1] + at(i * h) * h);
  const side = (y) => shift[Math.max(0, Math.min(shift.length - 1, Math.round(y / h)))];
  return { at, side };
}

// Текст ячейки; одно и то же слово, найденное дважды, не повторяется.
const join = (ws) => ws.map((w) => w.t.trim()).filter((t, i, a) => i === 0 || t !== a[i - 1]).join(' ');
// Пометы, которые движок часто читает с потерей буквы, дефиса, плюса или точки.
const fixInfo = (s) => fixLatin(s)
  .replace(/Pr[āaūäe]p\b\.?/g, 'Präp.')
  .replace(/^Präp\.\s*\+?\s*(Akk|Abl|Gen)\w*\.?/i, (m, c) => `Präp. + ${c[0].toUpperCase()}${c.slice(1, 3).toLowerCase()}.`)
  .replace(/^[^\p{L}-]*-?\s?(ae|a|tra|ra),\s*-?\s?(trum|rum|um|a)\b/u, '-$1, -$2')
  .replace(/\bP[LlI1]\b\.?/g, 'Pl.')
  .replace(/\b([mfn])(?=,|\s|$)(?!\.)/g, '$1.')
  .replace(/(Pers|Poss|Dem)-+\s?Pron/g, '$1.-Pron')
  .replace(/^Kon[j]?\.?$/i, 'Konj.').replace(/^Adv\.?$/i, 'Adv.').replace(/^Subj\.?$/i, 'Subj.')
  .replace(/^Inf\.$/, '+ Inf.');

// Движок путает заглавные и строчные там, где они одинаковой формы (S/s, C/c, V/v…). Если слово начинается
// с такой заглавной, а по высоте оно как слово из одних строчных без выносных элементов, первая буква — строчная.
function fixCase(ws) {
  const low = ws.filter((w) => /^[aceimnorsuvwxz]{3,}$/.test(w.t)).map((w) => w.h);
  const tall = ws.filter((w) => /^[a-z]*[bdfhklt][a-z]*$/.test(w.t) && w.t.length > 2).map((w) => w.h);
  if (low.length < 5 || tall.length < 5) return;
  const limit = (median(low) + median(tall)) / 2;
  for (const w of ws) {
    if (/^[SCVWXZO][aceimnorsuvwxz]+[,.]?$/.test(w.t) && w.h < limit) w.t = w.t[0].toLowerCase() + w.t.slice(1);
  }
}
// Слова до первого широкого промежутка (дальше начинается другой столбец).
function run(ws, maxGap) {
  const out = [ws[0]];
  for (let i = 1; i < ws.length; i++) {
    if (ws[i].X0 - ws[i - 1].X1 > maxGap) break;
    out.push(ws[i]);
  }
  return out;
}

const MACRON = { ä: 'ā', à: 'ā', á: 'ā', â: 'ā', ã: 'ā', ë: 'ē', è: 'ē', é: 'ē', ê: 'ē', ï: 'ī', ì: 'ī', í: 'ī', î: 'ī', ö: 'ō', ò: 'ō', ó: 'ō', ô: 'ō', õ: 'ō', ü: 'ū', ù: 'ū', ú: 'ū', û: 'ū' };
const UMLAUT = { à: 'ä', á: 'ä', â: 'ä', ò: 'ö', ó: 'ö', ô: 'ö', ù: 'ü', ú: 'ü', û: 'ü' };
const mapChars = (s, table) => s.replace(/[^\x00-\x7f]/g, (ch) => table[ch] || (table[ch.toLowerCase()] ? table[ch.toLowerCase()].toUpperCase() : ch));
const tidy = (s) => s.replace(/,(?=\p{L})/gu, ', ').replace(/\s+/g, ' ').replace(/^[\s|–—=:•·*_~-]+/, '').replace(/[\s|–—=•·*_~]+$/, '').trim();
// Движок читает знак долготы как умлаут или ударение: в латыни возвращаем макрон, в немецком — умлаут.
export const fixLatin = (s) => tidy(mapChars(s, MACRON));
export const fixGerman = (s) => tidy(mapChars(s, UMLAUT));

// Запасной вариант для простого списка без чётких столбцов: делим строку по самому широкому промежутку.
export function splitLine(line) {
  const ws = (line.words || []).filter((w) => w.text && w.text.trim() && hasLetter(w.text));
  if (!ws.length) return null;
  let at = -1, gap = 0;
  for (let i = 0; i < ws.length - 1; i++) {
    const g = ws[i + 1].x0 - ws[i].x1;
    if (g > gap) { gap = g; at = i; }
  }
  const text = (list) => list.map((w) => w.text.trim()).join(' ');
  let latin, de = '';
  if (at >= 0 && gap > (line.h || 20) * 1.1) { latin = text(ws.slice(0, at + 1)); de = text(ws.slice(at + 1)); }
  else {
    const all = (line.words || []).map((w) => w.text.trim()).join(' ');
    const m = all.match(/\s+[–—=:-]\s+|\t/);
    if (m) { latin = all.slice(0, m.index); de = all.slice(m.index + m[0].length); }
    else latin = text(ws);
  }
  latin = tidy(latin.replace(/^\d+[.)]\s+/, '')); de = tidy(de);
  return latin || de ? { latin, info: '', de } : null;
}

// Слова с координатами → строки словаря [{ latin, info, de }].
// На странице может быть несколько таблиц (основная и, например, «Übungen»): они извлекаются по очереди.
export function parseTable(words, pageW, debug) {
  const ws = words.filter(keep).map((w) => ({ ...w, yc: (w.y0 + w.y1) / 2, h: w.y1 - w.y0 }));
  if (ws.length < 2) return [];
  const h = median(ws.map((w) => w.h)) || 20;
  fixCase(ws);
  const field = slopeField(ws, h);
  for (const w of ws) {
    const s = field.at(w.yc), dx = field.side(w.yc);
    w.X0 = w.x0 + dx; w.X1 = w.x1 + dx; w.Y = w.yc - s * w.x0;
  }
  // Цвет чернил: новые слова в учебнике напечатаны синим, остальной текст — чёрным. Оттенок сравнивается
  // с обычным текстом той же страницы, поэтому тёплое или холодное освещение не мешает.
  const base = median(ws.filter((w) => typeof w.b === 'number').map((w) => w.b));
  for (const w of ws) w.blue = typeof w.b === 'number' && w.b > base + 13 && !(w.c < 45);
  const colour = ws.filter((w) => w.blue).length >= 3;
  if (colour) {
    // Синие заголовки стоят в одном столбце. По ним точно видно, как столбцы «уезжают» вбок сверху вниз.
    const tol0 = Math.max(h, 0.012 * (pageW || 1000));
    const heads = ws.filter((w) => w.blue && w.t.replace(/[^\p{L}]/gu, '').length >= 2 &&
      !ws.some((o) => o !== w && Math.abs(o.Y - w.Y) < 0.6 * h && o.x1 <= w.x0 + 2 && w.x0 - o.x1 < 2 * h));
    const group = cluster(heads, (w) => w.X0, 2.5 * tol0).sort((a, b) => b.items.length - a.items.length)[0];
    if (group && group.items.length >= 4) {
      const pts = group.items, my = pts.reduce((s, w) => s + w.yc, 0) / pts.length, mx = pts.reduce((s, w) => s + w.x0, 0) / pts.length;
      const den = pts.reduce((s, w) => s + (w.yc - my) ** 2, 0);
      const drift = den > 0 ? pts.reduce((s, w) => s + (w.yc - my) * (w.x0 - mx), 0) / den : 0;
      if (Math.abs(drift) < 0.15) for (const w of ws) { w.X0 = w.x0 - drift * w.yc; w.X1 = w.x1 - drift * w.yc; }
    }
  }
  const ctx = { h, tol: Math.max(h, 0.012 * (pageW || 1000)), colour, field };
  if (debug) Object.assign(debug, { h, colour, base, tables: [],
    slopes: [0.1, 0.3, 0.5, 0.7, 0.9].map((f) => +field.at(f * Math.max(...ws.map((w) => w.y1))).toFixed(3)) });

  const found = [];
  let rest = ws;
  for (let i = 0; i < 4 && rest.length > 3; i++) {
    const t = extractTable(rest, { ...ctx, first: i === 0 }, debug);
    if (!t) break;
    found.push(...t.entries);
    rest = rest.filter((w) => w.Y < t.yTop || w.Y > t.yBottom);
    if (!colour) break; // без цвета вторую таблицу от текста упражнений не отличить
  }
  if (!found.length && !colour) {
    // Простой список без чётких столбцов: делим каждую строку по самому широкому промежутку.
    return cluster(ws, (w) => w.Y, 0.8 * h)
      .map((g) => splitLine({ h, words: g.items.sort((a, b) => a.X0 - b.X0).map((w) => ({ text: w.t, x0: w.X0, x1: w.X1 })) }))
      .filter(Boolean).map((p) => ({ latin: fixLatin(p.latin), info: '', de: fixGerman(p.de) }));
  }
  return found.sort((a, b) => a.y - b.y)
    .map((x) => ({ latin: fixLatin(x.latin), info: fixInfo(x.info), de: fixGerman(x.de) }))
    .filter((x) => (x.latin || x.de) && (x.de || x.latin.replace(/[^\p{L}]/gu, '').length > 2));
}

// Находит одну таблицу среди слов ws и возвращает её строки и границы по высоте (или null).
function extractTable(ws, { h, tol, colour, first, field }, debug) {
  const byX = (a, b) => a.X0 - b.X0;

  // 1. Строки (приблизительно) и «ячейки» в них: ячейка — слова без широких промежутков.
  const rows = cluster(ws, (w) => w.Y, 0.8 * h).map((g) => {
    const line = g.items.sort(byX), cells = [];
    for (const w of line) {
      const last = cells[cells.length - 1];
      if (last && w.X0 - last.words[last.words.length - 1].X1 <= 2 * h) last.words.push(w);
      else cells.push({ x: w.X0, words: [w] });
    }
    return { y: g.mean, line, cells };
  });
  const short = (c) => c.words.length <= 4;
  // Синяя ячейка — заголовок словарной строки. Синие номера и буквы заданий («1», «a») не считаются.
  const isHead = (c) => short(c) && c.words[0].blue && c.words[0].t.replace(/[^\p{L}]/gu, '').length >= 2;
  for (const r of rows) for (const c of r.cells) c.y = r.y;
  const cols = cluster(rows.flatMap((r) => r.cells), (c) => c.x, tol)
    .map((g) => {
      const heads = g.items.filter(isHead);
      return { x: g.mean, n: g.items.length, blue: heads.length, y0: Math.min(...heads.map((c) => c.y)), y1: Math.max(...heads.map((c) => c.y)) };
    })
    .filter((c) => c.n >= 2);

  // 2. Какие столбцы — латынь и перевод. Столбцы таблицы «сочетаются» построчно: в строке, где есть короткая
  //    латинская ячейка, есть и ячейка перевода. У колонки примечаний, заголовков и упражнений такого нет.
  const pairRows = (a, b) => rows.filter((r) =>
    r.cells.some((c) => Math.abs(c.x - a.x) <= tol && short(c)) && r.cells.some((c) => Math.abs(c.x - b.x) <= tol));
  const bestOf = new Map();
  let top = 0;
  for (const a of cols) {
    let best = 0;
    for (const b of cols) if (b.x > a.x + 5 * h) best = Math.max(best, pairRows(a, b).length);
    bestOf.set(a, best);
    top = Math.max(top, best);
  }
  let latinCol = null;
  if (colour) {
    // Латинский столбец — тот, где слова синие.
    const need = first ? 2 : 3; // вторая и следующие таблицы — только если признаки увереннее
    const cand = cols.filter((c) => c.blue >= need && (c.blue >= 0.4 * c.n || c.blue >= 5) && bestOf.get(c) >= need);
    latinCol = cand.sort((a, b) => b.blue - a.blue || a.x - b.x)[0] || null;
  } else if (top >= 3) {
    latinCol = cols.find((a) => a.n >= 3 && bestOf.get(a) >= 0.8 * top); // самый левый из подходящих
  }
  if (!latinCol) return null;
  // Перевод — самый правый столбец, у которого ячейка есть почти в каждой латинской строке (между ними может
  // стоять столбец помет). Сравнение по высоте с запасом: на изогнутой странице строки двух столбцов расходятся.
  const allCells = rows.flatMap((r) => r.cells);
  const heads = allCells.filter((c) => Math.abs(c.x - latinCol.x) <= tol && short(c));
  const cover = (b) => {
    const cells = allCells.filter((c) => Math.abs(c.x - b.x) <= tol);
    return heads.filter((hd) => cells.some((c) => Math.abs(c.y - hd.y) <= 1.3 * h)).length;
  };
  const right = cols.filter((b) => b.x > latinCol.x + 5 * h).map((b) => ({ b, n: cover(b) }));
  const most = Math.max(0, ...right.map((r) => r.n));
  const partners = right.filter((r) => r.n >= 2 && r.n >= 0.75 * most);
  const germanCol = partners.length ? partners[partners.length - 1].b : null;
  if (!germanCol) return null;

  // 3. Где таблица по высоте: самая длинная цепочка строк-пар без больших разрывов (ниже могут идти упражнения).
  let ys = pairRows(latinCol, germanCol).map((r) => r.y).sort((a, b) => a - b);
  const step = median(ys.slice(1).map((y, i) => y - ys[i])) || 2.3 * h;
  // Таблица новых слов лежит там, где синие заголовки (серые повторяемые слова встречаются только между ними).
  if (colour) ys = ys.filter((y) => y >= latinCol.y0 - 2.5 * step && y <= latinCol.y1 + 2.5 * step);
  if (!ys.length) return null;
  let runStart = 0, bestRun = [0, 0];
  for (let i = 1; i <= ys.length; i++) {
    if (i === ys.length || ys[i] - ys[i - 1] > 6 * step) {
      if (i - runStart > bestRun[1] - bestRun[0]) bestRun = [runStart, i];
      runStart = i;
    }
  }
  const yTop = ys[bestRun[0]] - 1.5 * h, yBottom = ys[bestRun[1] - 1] + 3 * step;
  if (debug) debug.tables.push({ latin: Math.round(latinCol.x), german: Math.round(germanCol.x), pairs: ys.length, yTop: Math.round(yTop), yBottom: Math.round(yBottom),
    cols: cols.map((c) => `${Math.round(c.x)}:${c.n}/${bestOf.get(c)}b${c.blue}`).join(' ') });
  const inTable = ws.filter((w) => w.Y >= yTop && w.Y <= yBottom);

  // 4. Левая часть (латынь и помета) и правая часть (перевод) собираются в строки по отдельности:
  //    на изогнутой странице строки двух столбцов не лежат на одной прямой.
  const edge = germanCol.x - tol;
  const rawY = (list) => median(list.map((w) => w.yc));
  const leftLines = cluster(inTable.filter((w) => w.X0 >= latinCol.x - 3 * tol && w.X0 < edge), (w) => w.Y, 0.7 * h)
    .map((g) => {
      const line = g.items.sort(byX);
      const head = line[0];
      // Всё, что начинается левее столбца помет, — латинская ячейка (допуск с запасом: столбец на фото не идеально прямой).
      if (head.X0 < latinCol.x + 2 * h) {
        const la = run(line, 2 * h), rest = line.slice(la.length);
        // Наклон этой строки, измеренный по ней самой: от латинского слова до пометы.
        const slope = rest.length && rest[0].x0 - head.x0 > 4 * h ? (rest[0].yc - head.yc) / (rest[0].x0 - head.x0) : null;
        return { y: median(la.map((w) => w.Y)), ry: rawY(la), rx: head.x0, slope, latin: join(la), info: join(rest) };
      }
      return { y: median(line.map((w) => w.Y)), ry: rawY(line), rx: line[0].x0, slope: null, latin: '', info: join(line) };
    });
  const rightLines = cluster(inTable.filter((w) => w.X0 >= edge), (w) => w.Y, 0.6 * h)
    .map((g) => {
      const line = g.items.sort(byX);
      if (Math.abs(line[0].X0 - germanCol.x) > 3 * tol) return null;
      const cell = run(line, 2.5 * h); // дальше — колонка с примечаниями
      return { y: median(cell.map((w) => w.Y)), ry: rawY(cell), rx: line[0].x0, text: join(cell) };
    }).filter(Boolean).sort((a, b) => a.ry - b.ry);

  // 5. Каждому латинскому слову — строка перевода на той же строке таблицы. Где должна быть эта строка по высоте,
  //    считается от латинского слова с местным наклоном: по соседним строкам таблицы (слово → помета), а если
  //    помет рядом нет — по общему наклону текста. Поправка e дополнительно следит за изгибом страницы.
  const withSlope = leftLines.filter((l) => l.slope !== null && Math.abs(l.slope) < 0.15);
  const slopeNear = (L) => {
    const near = withSlope.filter((l) => Math.abs(l.ry - L.ry) < 4.5 * step).map((l) => l.slope);
    return near.length >= 3 ? median(near) : field.at(L.ry);
  };
  const entries = [];
  let e = 0;
  for (const L of leftLines.filter((l) => l.latin).sort((a, b) => a.ry - b.ry)) {
    const s = slopeNear(L);
    let best = null, bestD = Infinity;
    for (const G of rightLines) {
      if (G.entry) continue;
      const d = Math.abs(G.ry - (L.ry + s * (G.rx - L.rx)) - e);
      if (d < bestD) { bestD = d; best = G; }
    }
    const entry = { y: L.y, latin: L.latin, info: L.info, de: '' };
    if (best && bestD < 0.9 * h) {
      entry.de = best.text; best.entry = entry; best.matched = true;
      e = 0.6 * e + 0.4 * (best.ry - (L.ry + s * (best.rx - L.rx)));
    }
    entries.push(entry);
  }

  // 6. Оставшиеся строки перевода: продолжение предыдущей ячейки или слово, латинскую часть которого движок не увидел.
  const pitches = [];
  for (let i = 1; i < rightLines.length; i++) {
    if (rightLines[i].matched && rightLines[i - 1].matched) pitches.push(rightLines[i].ry - rightLines[i - 1].ry);
  }
  pitches.sort((a, b) => a - b);
  const pitch = pitches.length >= 3 ? pitches[Math.floor(pitches.length * 0.3)] : 2.3 * h;
  rightLines.forEach((G, i) => {
    if (G.entry) return;
    const prev = rightLines[i - 1];
    const gap = prev ? G.ry - prev.ry : Infinity;
    const looksLikeMore = prev && (/[,;-]$/.test(prev.text.trim()) || /^\(/.test(G.text.trim()));
    if (prev && prev.entry && (gap < 0.8 * pitch || (gap < 0.95 * pitch && looksLikeMore))) {
      prev.entry.de += ' ' + G.text;
      G.entry = prev.entry;
    } else {
      const note = leftLines.find((l) => !l.latin && Math.abs(l.y - G.y) < 1.2 * h);
      G.entry = { y: G.y, latin: '', info: note ? note.info : '', de: G.text };
      entries.push(G.entry);
    }
  });

  // 7. Заголовки, номера страниц и случайный мусор: строки без перевода за пределами таблицы.
  entries.sort((a, b) => a.y - b.y);
  const full = entries.filter((x) => x.latin && x.de);
  if (!full.length) return null;
  const from = full[0].y, to = full[full.length - 1].y;
  return { entries: entries.filter((x) => x.y >= from && x.y <= to), yTop, yBottom };
}

// Цвет чернил каждого слова: насколько синий канал выше красного у самых тёмных точек слова.
export function annotate(src, words) {
  const k = Math.min(1, 2600 / Math.max(src.width, src.height));
  const c = document.createElement('canvas');
  c.width = Math.round(src.width * k); c.height = Math.round(src.height * k);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(src, 0, 0, c.width, c.height);
  const data = g.getImageData(0, 0, c.width, c.height).data;
  for (const w of words) {
    const x0 = Math.max(0, Math.floor(w.x0 * k)), x1 = Math.min(c.width, Math.ceil(w.x1 * k));
    const y0 = Math.max(0, Math.floor(w.y0 * k)), y1 = Math.min(c.height, Math.ceil(w.y1 * k));
    const px = [];
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * c.width + x) * 4;
        px.push([0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2], data[i], data[i + 2]]);
      }
    }
    if (px.length < 8) continue;
    px.sort((a, b) => a[0] - b[0]);
    const n = Math.max(4, Math.floor(px.length * 0.12));
    let r = 0, b = 0;
    for (let i = 0; i < n; i++) { r += px[i][1]; b += px[i][2]; }
    w.b = Math.round((b - r) / n);
  }
  return words;
}

// Два прохода с разным увеличением: каждый пропускает отдельные слова, вместе находят почти все.
export async function recognizePhoto(file, onProgress) {
  const { words, width } = await recognizeWords(file, onProgress);
  return parseTable(words, width);
}

// Только распознавание: слова с координатами (в пикселях исходного снимка) и ширина снимка.
export async function recognizeWords(file, onProgress) {
  const src = await loadBitmap(file);
  const sides = [3200, 2560];
  let words = [];
  for (let i = 0; i < sides.length; i++) {
    const { blob, k } = await render(src, sides[i]);
    const worker = await prepare((m) => {
      if (!onProgress) return;
      if (m.status === 'recognizing text') onProgress({ loading: false, progress: (i + m.progress) / sides.length });
      else onProgress({ loading: true, progress: m.progress || 0 });
    });
    const { data } = await worker.recognize(blob, {}, { blocks: true });
    const found = wordsOf(data, k);
    words = i === 0 ? found : mergeWords(words, found);
  }
  annotate(src, words);
  return { words, width: src.width };
}
