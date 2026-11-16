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
// flat = true: освещение выравнивается (каждая точка делится на яркость фона вокруг неё), картинка становится
// чёрно-белой и контрастной. Без этого движок пропускает слова в тени у переплёта и синие слова на сером фоне.
function render(src, side, flat) {
  const k = side / Math.max(src.width, src.height);
  const c = document.createElement('canvas');
  c.width = Math.round(src.width * k); c.height = Math.round(src.height * k);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, c.width, c.height);
  if (flat) {
    const bg = document.createElement('canvas');
    bg.width = c.width; bg.height = c.height;
    const gb = bg.getContext('2d', { willReadFrequently: true });
    gb.filter = `blur(${Math.round(c.width / 40)}px)`;
    gb.drawImage(c, 0, 0);
    if (gb.filter && gb.filter !== 'none') { // если браузер не умеет размывать на холсте, остаётся исходная картинка
      const img = g.getImageData(0, 0, c.width, c.height), a = img.data;
      const b = gb.getImageData(0, 0, c.width, c.height).data;
      for (let i = 0; i < a.length; i += 4) {
        const ink = Math.min(a[i], a[i + 1], a[i + 2]);
        const back = Math.max(40, 0.3 * b[i] + 0.59 * b[i + 1] + 0.11 * b[i + 2]);
        const v = Math.max(0, Math.min(1, (ink / back - 0.35) / 0.57)) * 255;
        a[i] = a[i + 1] = a[i + 2] = v;
      }
      g.putImageData(img, 0, 0);
    }
  }
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
  if (w.c < 15 && !MARKER.test(t)) return false; // линии таблицы и тени движок «читает» как неуверенные слова
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
  const sure = ws.filter((w) => !(w.c < 40) && /\p{L}{2,}/u.test(w.t));
  const pairs = [];
  for (const a of sure) {
    let best = null, bestGap = Infinity;
    for (const b of sure) {
      const gap = b.x0 - a.x1;
      if (b === a || gap <= 0 || gap > 1.5 * h || Math.abs(b.yc - a.yc) > 0.7 * h) continue;
      if (gap < bestGap) { bestGap = gap; best = b; }
    }
    if (!best) continue;
    const dx = (best.x0 + best.x1) / 2 - (a.x0 + a.x1) / 2;
    if (dx > 1.5 * h) pairs.push({ y: (a.yc + best.yc) / 2, s: (best.yc - a.yc) / dx });
  }
  const clamp = (v) => Math.max(-0.09, Math.min(0.09, v));
  const coarse = pairs.length >= 12 ? clamp(median(pairs.map((p) => p.s))) : 0;
  const global = estimateSkew(ws, h, coarse - 0.035, coarse + 0.035);
  const STEP = 5 * h, cache = new Map();
  // Наклон в полосе страницы вокруг высоты k·STEP. Книжный лист изогнут, и наклон вверху и внизу страницы может
  // различаться очень сильно, поэтому грубая оценка тоже берётся местная — по парам слов этой полосы.
  const band = (k) => {
    if (!cache.has(k)) {
      const y = k * STEP;
      const near = ws.filter((w) => Math.abs(w.yc - y) < 3.5 * STEP);
      const local = pairs.filter((p) => Math.abs(p.y - y) < 3.5 * STEP).map((p) => p.s);
      const centre = local.length >= 8 ? clamp(median(local)) : global;
      cache.set(k, near.length >= 40 ? estimateSkew(near, h, centre - 0.03, centre + 0.03) : centre);
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

// Текст ячейки. Слово, найденное дважды в разных проходах (рамки перекрываются), берётся один раз — в том
// варианте, в котором движок увереннее. Куски одного слова, разорванного почти без промежутка, склеиваются.
function join(ws) {
  const kept = [];
  for (const w of ws) {
    const p = kept[kept.length - 1];
    const both = p ? Math.min(p.X1, w.X1) - Math.max(p.X0, w.X0) : 0;
    if (p && both > 0.5 * Math.min(p.X1 - p.X0, w.X1 - w.X0)) {
      if (quality(w) > quality(p)) kept[kept.length - 1] = w;
    } else kept.push(w);
  }
  let out = '';
  kept.forEach((w, i) => {
    const t = w.t.trim(), p = kept[i - 1];
    if (!p) { out = t; return; }
    if (t === p.t.trim()) return;
    const glue = w.X0 - p.X1 < 0.12 * Math.max(w.h, p.h) && /\p{Ll}$/u.test(p.t) && /^\p{Ll}/u.test(t);
    out += (glue ? '' : ' ') + t;
  });
  return out;
}
// Пометы, которые движок часто читает с потерей буквы, дефиса, плюса или точки.
const fixInfo = (s) => fixLatin(s)
  .replace(/^[^\p{L}-]*-?\s?ā,/u, '-a,')
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
    if (/^[SVWXZ][aceimnorsuvwxz]+[,.]?$/.test(w.t) && w.h < limit) w.t = w.t[0].toLowerCase() + w.t.slice(1);
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
  const tinted = ws.filter((w) => typeof w.b === 'number' && !(w.c < 45));
  const base = median(tinted.map((w) => w.b));
  // «Синий» уровень страницы — самые синие из уверенно прочитанных слов; порог ставится между ним и обычным текстом.
  const bluest = tinted.filter((w) => w.t.replace(/[^\p{L}]/gu, '').length >= 3).map((w) => w.b).sort((a, b) => b - a).slice(0, 6);
  const level = bluest.length >= 3 ? bluest.reduce((s, v) => s + v, 0) / bluest.length : base;
  const limit = base + Math.max(9, 0.45 * (level - base));
  for (const w of ws) w.blue = level - base >= 16 && typeof w.b === 'number' && w.b > limit && !(w.c < 45);
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
    .filter((x) => (x.latin || x.de) && (x.de || x.latin.replace(/[^\p{L}]/gu, '').length > 2))
    .filter((x) => x.latin.split(' ').length <= 5 && !/[()„“]/.test(x.latin)); // длинная «латынь» со скобками — это не словарная строка
}

// Плавная кривая d(y) по точкам: парабола, если точек достаточно, иначе прямая (метод наименьших квадратов).
function fitCurve(pts) {
  const my = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const span = Math.max(1, ...pts.map((p) => Math.abs(p.y - my)));
  const deg = pts.length >= 8 ? 2 : 1, n = deg + 1;
  const A = Array.from({ length: n }, () => new Array(n + 1).fill(0));
  for (const p of pts) {
    const u = (p.y - my) / span, pow = [1, u, u * u];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) A[i][j] += pow[i] * pow[j];
      A[i][n] += pow[i] * p.d;
    }
  }
  for (let i = 0; i < n; i++) { // исключение Гаусса
    let piv = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[piv][i])) piv = r;
    [A[i], A[piv]] = [A[piv], A[i]];
    if (Math.abs(A[i][i]) < 1e-9) { const m = pts.reduce((s, p) => s + p.d, 0) / pts.length; return () => m; }
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const f = A[r][i] / A[i][i];
      for (let c = i; c <= n; c++) A[r][c] -= f * A[i][c];
    }
  }
  const k = A.map((row, i) => row[n] / A[i][i]);
  return (y) => { const u = (y - my) / span; return k[0] + k[1] * u + (k[2] || 0) * u * u; };
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
  const isHead = (c) => short(c) && c.words[0].blue && c.words[0].t.replace(/[^\p{L}]/gu, '').length >= 3;
  for (const r of rows) for (const c of r.cells) c.y = r.y;
  const cols = cluster(rows.flatMap((r) => r.cells), (c) => c.x, tol)
    .map((g) => {
      const blues = g.items.filter(isHead);
      const y0 = Math.min(...blues.map((c) => c.y)), y1 = Math.max(...blues.map((c) => c.y));
      // near — сколько ячеек столбца лежит там же по высоте, где синие заголовки (остальное — другой текст страницы)
      const near = g.items.filter((c) => c.y >= y0 - 7 * h && c.y <= y1 + 7 * h).length;
      return { x: g.mean, n: g.items.length, near, blue: blues.length, y0, y1 };
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
    const cand = cols.filter((c) => c.blue >= need && (c.blue >= 0.4 * c.near || c.blue >= 5) && bestOf.get(c) >= need);
    latinCol = cand.sort((a, b) => b.blue - a.blue || a.x - b.x)[0] || null;
  } else if (top >= 3) {
    latinCol = cols.find((a) => a.n >= 3 && bestOf.get(a) >= 0.8 * top); // самый левый из подходящих
  }
  if (!latinCol) {
    if (debug) debug.tables.push({ fail: 'latin', cols: cols.map((c) => `${Math.round(c.x)}:${c.n}/${bestOf.get(c)}b${c.blue}`).join(' ') });
    return null;
  }
  // Перевод — самый правый столбец, у которого ячейка есть почти в каждой латинской строке (между ними может
  // стоять столбец помет). Сравнение по высоте с запасом: на изогнутой странице строки двух столбцов расходятся.
  const allCells = rows.flatMap((r) => r.cells);
  const heads = allCells.filter((c) => Math.abs(c.x - latinCol.x) <= tol && short(c) &&
    (!colour || (c.y >= latinCol.y0 - 7 * h && c.y <= latinCol.y1 + 7 * h)));
  const cover = (b) => {
    const cells = allCells.filter((c) => Math.abs(c.x - b.x) <= tol);
    return heads.filter((hd) => cells.some((c) => Math.abs(c.y - hd.y) <= 1.3 * h)).length;
  };
  // Среди таких столбцов могут быть и пометы (левее перевода), и колонка примечаний (правее). Пометы отличаются
  // содержанием: там латинские формы и сокращения, а не немецкие слова. Перевод — первый слева «немецкий» столбец.
  const GERMAN = /(^|[\s(])(der|die|das|sich|nicht|ein|eine|und|zu|von|mit|auf|er\/sie\/es)\b|[äöüß]|\p{Ll}{3,}(en|ern|eln|ung|ig|lich)\b/iu;
  const germanShare = (b) => {
    const cells = allCells.filter((c) => Math.abs(c.x - b.x) <= tol);
    return cells.filter((c) => GERMAN.test(c.words.map((w) => w.t).join(' '))).length / Math.max(1, cells.length);
  };
  const right = cols.filter((b) => b.x > latinCol.x + 5 * h).map((b) => ({ b, n: cover(b) }));
  const most = Math.max(0, ...right.map((r) => r.n));
  const partners = right.filter((r) => r.n >= 2 && r.n >= 0.5 * most);
  const pick = partners.find((r) => germanShare(r.b) >= 0.4) || partners[partners.length - 1];
  const germanCol = pick ? pick.b : null;
  if (!germanCol) return null;

  // 3. Где таблица по высоте: самая длинная цепочка строк-пар без больших разрывов (ниже могут идти упражнения).
  let ys = pairRows(latinCol, germanCol).map((r) => r.y).sort((a, b) => a - b);
  const step = median(ys.slice(1).map((y, i) => y - ys[i])) || 2.3 * h;
  // Таблица новых слов лежит там, где синие заголовки (серые повторяемые слова встречаются только между ними),
  // поэтому её границы берутся по латинскому столбцу в этих пределах, даже если перевод в строке не нашёлся.
  if (colour) ys = heads.map((c) => c.y).filter((y) => y >= latinCol.y0 - 2.5 * step && y <= latinCol.y1 + 2.5 * step).sort((a, b) => a - b);
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
  // В латинской части таблицы знаки долготы уточняются по картинке (в немецком столбце там умлауты, их не трогаем).
  for (const w of inTable) if (w.X0 < germanCol.x - 2.2 * tol && w.m && !w.barsDone) { w.t = applyMacrons(w.t, w.m); w.barsDone = true; }

  // 4. Левая часть (латынь и помета) и правая часть (перевод) собираются в строки по отдельности:
  //    на изогнутой странице строки двух столбцов не лежат на одной прямой.
  const edge = germanCol.x - 2.2 * tol;
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
  const slopeNear = (L, fromTable) => {
    const near = withSlope.filter((l) => Math.abs(l.ry - L.ry) < 4.5 * step).map((l) => l.slope);
    return fromTable && near.length >= 3 ? median(near) : field.at(L.ry);
  };
  //    У переплёта лист выгнут, и немецкий столбец может стоять на снимке почти на полстроки ниже или выше
  //    латинского. Поэтому начальный сдвиг перебирается: берётся тот, при котором сходится больше всего строк.
  //    Оба способа оценить наклон (по таблице и по тексту) иногда ошибаются, поэтому сопоставление делается
  //    дважды и берётся вариант, где сошлось больше строк, а при равенстве — где они легли ровнее.
  const latLines = leftLines.filter((l) => l.latin).sort((a, b) => a.ry - b.ry);
  const solve = (fromTable) => {
  for (const L of latLines) L.s = slopeNear(L, fromTable);
  const attempt = (e0) => {
    const used = new Set(), pairs = [];
    let e = e0, n = 0;
    for (const L of latLines) {
      let best = null, bestD = Infinity;
      for (const G of rightLines) {
        if (used.has(G)) continue;
        const d = Math.abs(G.ry - (L.ry + L.s * (G.rx - L.rx)) - e);
        if (d < bestD) { bestD = d; best = G; }
      }
      if (best && bestD < 0.9 * h) {
        used.add(best); pairs.push([L, best]); n++;
        e = 0.6 * e + 0.4 * (best.ry - (L.ry + L.s * (best.rx - L.rx)));
      } else pairs.push([L, null]);
    }
    // Строки перевода, оставшиеся без пары и не похожие на продолжение предыдущей, — признак сдвига на строку.
    let loose = 0;
    rightLines.forEach((G, i) => {
      if (used.has(G)) return;
      const prev = rightLines[i - 1];
      if (!prev || G.ry - prev.ry > 0.85 * step) loose++;
    });
    // Таблица начинается с первой строки в обоих столбцах: первая латинская строка с первой строкой перевода.
    const tops = pairs.length && pairs[0][1] === rightLines[0] ? 0.5 : 0;
    return { pairs, n, e0, score: n - loose + tops };
  };
  let chosen = attempt(0);
  for (let e0 = -1.5 * step; e0 <= 1.5 * step; e0 += h / 3) {
    const t = attempt(e0);
    if (t.score > chosen.score || (t.score === chosen.score && Math.abs(t.e0) < Math.abs(chosen.e0))) chosen = t;
  }
  // Уточнение: по найденным парам строится плавная кривая сдвига между столбцами по высоте (лист изогнут,
  // и сдвиг растёт постепенно), затем строки сопоставляются заново уже по этой кривой. Так пропуск одного
  // слова не сбивает сопоставление всех следующих строк.
  const pred = (L, G) => L.ry + L.s * (G.rx - L.rx);
  for (let round = 0; round < 3; round++) {
    let pts = chosen.pairs.filter((p) => p[1]).map(([L, G]) => ({ y: L.ry, d: G.ry - pred(L, G) }));
    if (pts.length < 4) break;
    let curve = fitCurve(pts);
    pts = pts.filter((p) => Math.abs(p.d - curve(p.y)) < 0.6 * h);
    if (pts.length >= 4) curve = fitCurve(pts);
    const pairs = [];
    let from = 0, n = 0;
    for (const L of latLines) {
      let best = -1, bestD = Infinity;
      for (let j = from; j < rightLines.length; j++) {
        const d = Math.abs(rightLines[j].ry - pred(L, rightLines[j]) - curve(L.ry));
        if (d < bestD) { bestD = d; best = j; }
      }
      if (best >= 0 && bestD < 0.42 * step) { pairs.push([L, rightLines[best]]); from = best + 1; n++; }
      else pairs.push([L, null]);
    }
    if (n < chosen.n) break; // кривая не помогла — остаётся прежний вариант
    const rough = pairs.filter((p) => p[1]).map(([L, G]) => Math.abs(G.ry - pred(L, G) - curve(L.ry)));
    chosen = { pairs, n, e0: chosen.e0, rough: rough.length ? rough.reduce((s, v) => s + v, 0) / rough.length : 99 };
  }
  return { ...chosen, rough: chosen.rough ?? 99 };
  };
  const variants = [solve(false), solve(true)];
  const chosen = variants[1].n > variants[0].n || (variants[1].n === variants[0].n && variants[1].rough < variants[0].rough) ? variants[1] : variants[0];
  const entries = [];
  for (const [L, G] of chosen.pairs) {
    const entry = { y: L.y, latin: L.latin, info: L.info, de: '' };
    if (G) { entry.de = G.text; G.entry = entry; G.matched = true; }
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
      const note = leftLines.find((l) => !l.latin && !l.used && Math.abs(l.y - G.y) < 1.2 * h);
      if (note) note.used = true;
      G.entry = { y: G.y, latin: '', info: note ? note.info : '', de: G.text };
      entries.push(G.entry);
    }
  });
  // Вторая и третья строка пометы («Gen. Pl. arcium», «Dem.-Pron.») дописываются к строке над ними.
  const entryOf = new Map(chosen.pairs.map(([L], i) => [L, entries[i]]));
  let above = null, aboveY = -Infinity;
  for (const l of [...leftLines].sort((a, b) => a.ry - b.ry)) {
    if (l.latin) { above = entryOf.get(l) || null; aboveY = l.ry; continue; }
    if (l.used || !above || l.ry - aboveY > 0.95 * step) continue;
    above.info = (above.info + ' ' + l.info).trim();
    aboveY = l.ry;
  }

  // 7. Заголовки, номера страниц и случайный мусор: строки без перевода за пределами таблицы.
  entries.sort((a, b) => a.y - b.y);
  const full = entries.filter((x) => x.latin && x.de);
  if (!full.length) return null;
  const from = full[0].y, to = full[full.length - 1].y;
  return { entries: entries.filter((x) => x.y >= from && x.y <= to), yTop, yBottom };
}

// Знаки долготы по картинке. Макрон — короткая горизонтальная чёрточка над гласной, отделённая от буквы
// просветом. Для каждого столбца точек слова ищется: тонкий штрих сверху, под ним просвет, под ним тело буквы.
// Несколько таких столбцов подряд на одной высоте — чёрточка (точка над i намного уже).
// Возвращает положения чёрточек вдоль слова, от 0 до 1.
function macronBars(data, W, H, x0, x1, y0, y1, ink, paper) {
  const hw = y1 - y0, top = Math.max(0, Math.round(y0 - 0.35 * hw));
  if (x1 - x0 < 4 || hw < 6 || paper - ink < 40) return [];
  const limit = paper - 0.42 * (paper - ink); // темнее этого — чернила (тонкий штрих на снимке светлее буквы)
  const dark = (x, y) => { const i = (y * W + x) * 4; return 0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2] < limit; };
  const cols = [];
  const bodies = [];
  for (let x = x0; x < x1; x++) {
    let y = top;
    while (y < y1 && !dark(x, y)) y++;
    if (y >= y1) { cols.push(null); continue; }
    const s = y;
    while (y < y1 && dark(x, y)) y++;
    const thick = y - s;
    let gap = 0;
    while (y < y1 && !dark(x, y)) { y++; gap++; }
    let body = 0;
    while (y < y1 && dark(x, y)) { y++; body++; }
    if (body > 0) bodies.push(y1 - (y - body));
    cols.push({ s, thick, gap, body });
  }
  bodies.sort((a, b) => a - b);
  const xh = bodies.length ? bodies[Math.floor(bodies.length / 2)] : hw * 0.6; // примерная высота строчной буквы
  const thin = Math.max(2, 0.3 * xh);
  // Линия верха строчных букв: на этой высоте начинается тело буквы в большинстве столбцов слова.
  const tops = new Map();
  for (const c of cols) {
    if (!c) continue;
    c.bodyTop = c.thick > thin || !c.body ? c.s : c.s + c.thick + c.gap;
    tops.set(c.bodyTop, (tops.get(c.bodyTop) || 0) + 1);
  }
  let xTop = 0, most = 0;
  for (const [y, n] of tops) {
    const near = n + (tops.get(y - 1) || 0) + (tops.get(y + 1) || 0);
    if (near > most) { most = near; xTop = y; }
  }
  // Чёрточка: тонкий штрих целиком выше этой линии, под ним просвет, а тело буквы начинается на самой линии
  // (у верхней дуги «e», «a», «o» штрих лежит на линии, а не над ней; точка над i намного уже).
  const isBar = (c) => c && c.body >= 2 && c.thick <= thin && c.gap >= 1 &&
    c.s + c.thick <= xTop - 1 && Math.abs(c.bodyTop - xTop) <= Math.max(1.5, 0.2 * xh) && xTop - c.s <= 0.75 * xh;
  const minWidth = Math.max(3, 0.4 * xh);
  const bars = [];
  let start = -1;
  for (let i = 0; i <= cols.length; i++) {
    const ok = isBar(cols[i]) && (start < 0 || Math.abs(cols[i].s - cols[start].s) <= 1);
    if (ok && start < 0) start = i;
    if (!ok && start >= 0) {
      const width = i - start;
      if (width >= minWidth && width <= 1.2 * xh) bars.push((start + width / 2) / cols.length);
      start = isBar(cols[i]) ? i : -1;
    }
  }
  return bars;
}

const NARROW = /[iljtf.,;:!'’()\-\/ī]/, WIDE = /[mwMW]/;
const LONG = { a: 'ā', e: 'ē', i: 'ī', o: 'ō', u: 'ū', y: 'ȳ', A: 'Ā', E: 'Ē', I: 'Ī', O: 'Ō', U: 'Ū' };
// Ставит макроны в слове по положениям чёрточек: чёрточка относится к ближайшей гласной под ней.
export function applyMacrons(text, bars) {
  if (!bars || !bars.length) return text;
  const chars = [...mapChars(text, MACRON)];
  const widths = chars.map((ch) => (NARROW.test(ch) ? 0.55 : WIDE.test(ch) ? 1.5 : 1));
  const total = widths.reduce((s, v) => s + v, 0);
  let acc = 0;
  const mid = widths.map((w) => { const m = (acc + w / 2) / total; acc += w; return m; });
  for (const bar of bars) {
    let best = -1, bestD = Infinity;
    chars.forEach((ch, i) => {
      if (!/[aeiouyAEIOUāēīōūȳ]/.test(ch)) return;
      const d = Math.abs(mid[i] - bar);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best >= 0 && bestD <= 1.1 / chars.length + 0.02 && LONG[chars[best]]) chars[best] = LONG[chars[best]];
  }
  return chars.join('');
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
    let r = 0, b = 0, ink = 0, paper = 0;
    for (let i = 0; i < n; i++) { r += px[i][1]; b += px[i][2]; ink += px[i][0]; paper += px[px.length - 1 - i][0]; }
    // Цвет имеет смысл только у тёмного текста на светлой бумаге (не у белых букв на тёмном фоне за краем страницы).
    if (paper / n > 110 && (paper - ink) / n > 45) w.b = Math.round((b - r) / n);
    else delete w.b;
    w.m = macronBars(data, c.width, c.height, x0, x1, y0, y1, ink / n, paper / n);
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
  // Три прохода: каждый пропускает отдельные слова, вместе находят почти все.
  const passes = [[2560, true], [3200, true], [3200, false]];
  const sides = passes;
  let words = [];
  for (let i = 0; i < passes.length; i++) {
    const { blob, k } = await render(src, passes[i][0], passes[i][1]);
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
