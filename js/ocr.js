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

export function mergeWords(a, b) {
  const out = a.map((w) => ({ ...w }));
  for (const w of b) {
    const hit = out.find((o) => Math.min(o.x1, w.x1) - Math.max(o.x0, w.x0) > 0.3 * Math.min(o.x1 - o.x0, w.x1 - w.x0) &&
      Math.min(o.y1, w.y1) - Math.max(o.y0, w.y0) > 0.3 * Math.min(o.y1 - o.y0, w.y1 - w.y0));
    if (!hit) out.push({ ...w });
    else if (quality(w) > quality(hit) + 5) Object.assign(hit, w);
  }
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
function estimateSkew(ws, h) {
  let best = 0, bestScore = -1;
  for (let s = -0.08; s <= 0.0801; s += 0.002) {
    const bins = new Map();
    for (const w of ws) { const k = Math.round((w.yc - s * w.x0) / (h * 0.5)); bins.set(k, (bins.get(k) || 0) + 1); }
    let score = 0;
    for (const n of bins.values()) score += n * n;
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return best;
}

// Текст ячейки; одно и то же слово, найденное дважды, не повторяется.
const join = (ws) => ws.map((w) => w.t.trim()).filter((t, i, a) => i === 0 || t !== a[i - 1]).join(' ');
// Пометы, которые движок часто читает с потерей буквы или точки.
const fixInfo = (s) => fixLatin(s).replace(/^Kon[j]?\.?$/i, 'Konj.').replace(/^Adv\.?$/i, 'Adv.');
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
const tidy = (s) => s.replace(/\s+/g, ' ').replace(/^[\s|–—=:•·*_~-]+/, '').replace(/[\s|–—=•·*_~]+$/, '').trim();
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
export function parseTable(words, pageW) {
  const ws = words.filter(keep).map((w) => ({ ...w, yc: (w.y0 + w.y1) / 2, h: w.y1 - w.y0 }));
  if (ws.length < 2) return [];
  const h = median(ws.map((w) => w.h)) || 20;
  const s = estimateSkew(ws, h);
  for (const w of ws) { w.X0 = w.x0 + s * w.yc; w.X1 = w.x1 + s * w.yc; w.Y = w.yc - s * w.x0; }
  const byX = (a, b) => a.X0 - b.X0;
  const tol = Math.max(h, 0.012 * (pageW || 1000));

  // 1. Где начинаются столбцы: считаем, на каких отступах чаще всего начинается «ячейка».
  const rows = cluster(ws, (w) => w.Y, 0.8 * h).map((g) => g.items.sort(byX));
  const starts = [];
  for (const row of rows) row.forEach((w, i) => { if (i === 0 || w.X0 - row[i - 1].X1 > 2 * h) starts.push(w.X0); });
  const cols = cluster(starts, (x) => x, tol).map((g) => ({ x: g.mean, n: g.items.length }));
  const maxN = Math.max(...cols.map((c) => c.n));
  const latinCol = cols.find((c) => c.n >= Math.max(3, 0.3 * maxN));
  const right = latinCol ? cols.filter((c) => c.x > latinCol.x + 4 * h) : [];
  const germanCol = right.sort((a, b) => b.n - a.n)[0];
  if (!latinCol || !germanCol || germanCol.n < 3) {
    return rows.map((r) => splitLine({ h, words: r.map((w) => ({ text: w.t, x0: w.X0, x1: w.X1 })) })).filter(Boolean)
      .map((p) => ({ latin: fixLatin(p.latin), info: '', de: fixGerman(p.de) }));
  }

  // 2. Левая часть (латынь и помета) и правая часть (перевод) собираются в строки по отдельности:
  //    на изогнутой странице строки двух столбцов не лежат на одной прямой.
  const edge = germanCol.x - tol;
  const leftLines = cluster(ws.filter((w) => w.X0 >= latinCol.x - tol && w.X0 < edge), (w) => w.Y, 0.7 * h)
    .map((g) => {
      const line = g.items.sort(byX);
      const first = line[0];
      if (Math.abs(first.X0 - latinCol.x) <= tol) {
        const la = run(line, 2 * h);
        return { y: median(la.map((w) => w.Y)), latin: join(la), info: join(line.slice(la.length)) };
      }
      if (first.X0 > latinCol.x + 2 * h) return { y: median(line.map((w) => w.Y)), latin: '', info: join(line) };
      return null;
    }).filter(Boolean);
  const rightLines = cluster(ws.filter((w) => w.X0 >= edge), (w) => w.Y, 0.6 * h)
    .map((g) => {
      const line = g.items.sort(byX);
      if (Math.abs(line[0].X0 - germanCol.x) > 2 * tol) return null;
      const cell = run(line, 2.5 * h); // дальше — колонка с примечаниями
      return { y: median(cell.map((w) => w.Y)), text: join(cell) };
    }).filter(Boolean).sort((a, b) => a.y - b.y);

  // 3. Каждому латинскому слову — ближайшая по высоте строка перевода. Поправка e следит за изгибом страницы.
  const entries = [];
  let e = 0;
  for (const L of leftLines.filter((l) => l.latin).sort((a, b) => a.y - b.y)) {
    let best = null, bestD = Infinity;
    for (const G of rightLines) {
      if (G.entry) continue;
      const d = Math.abs(G.y - L.y - e);
      if (d < bestD) { bestD = d; best = G; }
    }
    const entry = { y: L.y, latin: L.latin, info: L.info, de: '' };
    if (best && bestD < 0.9 * h) {
      entry.de = best.text; best.entry = entry; best.matched = true;
      e = 0.6 * e + 0.4 * (best.y - L.y);
    }
    entries.push(entry);
  }

  // 4. Оставшиеся строки перевода: продолжение предыдущей ячейки или слово, латинскую часть которого движок не увидел.
  const pitches = [];
  for (let i = 1; i < rightLines.length; i++) {
    if (rightLines[i].matched && rightLines[i - 1].matched) pitches.push(rightLines[i].y - rightLines[i - 1].y);
  }
  pitches.sort((a, b) => a - b);
  const pitch = pitches.length >= 3 ? pitches[Math.floor(pitches.length * 0.3)] : 2.3 * h;
  rightLines.forEach((G, i) => {
    if (G.entry) return;
    const prev = rightLines[i - 1];
    const gap = prev ? G.y - prev.y : Infinity;
    const looksLikeMore = prev && (/,$/.test(prev.text.trim()) || /^\(/.test(G.text.trim()));
    if (prev && prev.entry && (gap < 0.8 * pitch || (gap < 0.95 * pitch && looksLikeMore))) {
      prev.entry.de += ' ' + G.text;
      G.entry = prev.entry;
    } else {
      const note = leftLines.find((l) => !l.latin && Math.abs(l.y - (G.y - e)) < 0.9 * h);
      G.entry = { y: G.y - e, latin: '', info: note ? note.info : '', de: G.text };
      entries.push(G.entry);
    }
  });

  // 5. Заголовки, номера страниц и случайный мусор: строки без перевода за пределами таблицы или из одной-двух букв.
  entries.sort((a, b) => a.y - b.y);
  const full = entries.filter((x) => x.latin && x.de);
  if (!full.length) return [];
  const top = full[0].y, bottom = full[full.length - 1].y;
  return entries
    .filter((x) => x.y >= top && x.y <= bottom)
    .map((x) => ({ latin: fixLatin(x.latin), info: fixInfo(x.info), de: fixGerman(x.de) }))
    .filter((x) => (x.latin || x.de) && (x.de || x.latin.replace(/[^\p{L}]/gu, '').length > 2));
}

// Помета из учебника → часть речи, род и заметка.
export function guessGrammar(info, de) {
  const t = (info || '').trim();
  if (/^adv\.?$/i.test(t)) return { pos: 'adv', gram: {}, note: '' };
  if (/^(kon[j]?|subj)\.?$/i.test(t)) return { pos: 'conj', gram: {}, note: '' };
  if (/^pr[äa]p\.?/i.test(t)) return { pos: 'prep', gram: {}, note: t };
  const g = t.match(/(?:^|\s)([mfn])\.?$/);
  if (g) return { pos: 'noun', gram: { gender: g[1] }, note: t };
  if (/^er\/sie\/es\b/i.test((de || '').trim())) return { pos: 'verb', gram: {}, note: t };
  return { pos: '', gram: {}, note: t };
}

// Два прохода с разным увеличением: каждый пропускает отдельные слова, вместе находят почти все.
export async function recognizePhoto(file, onProgress) {
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
  return parseTable(words, src.width);
}
