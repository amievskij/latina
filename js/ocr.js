// Распознавание списка слов с фотографии (Tesseract.js, работает на устройстве, без сервера).
// Библиотека и языковые данные лежат в vendor/tesseract и загружаются только при первом использовании.

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
      return globalThis.Tesseract.createWorker(['lat', 'deu'], 1, {
        workerPath: BASE + 'worker.min.js',
        corePath: BASE.replace(/\/$/, ''),
        langPath: BASE + 'lang',
        workerBlobURL: false,
        logger: (m) => { if (onLog) onLog(m); },
      });
    })();
    workerPromise.catch(() => { workerPromise = null; });
  }
  return workerPromise;
}

// Уменьшает большие снимки и учитывает поворот камеры.
async function toBlob(file) {
  let src;
  try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    src = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('файл не похож на изображение'));
      img.src = URL.createObjectURL(file);
    });
  }
  const w = src.width, h = src.height;
  const k = Math.min(1, 2400 / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return new Promise((resolve) => c.toBlob(resolve, 'image/png'));
}

const JUNK = /^[|\[\]{}_~.·•*°'"`^<>\\/-]+$/;
const clean = (s) => s.replace(/\s+/g, ' ').replace(/^[\s|–—=:•·*-]+/, '').replace(/^\d+[.)]\s+/, '').replace(/[\s|–—=:]+$/, '').trim();

// Одна строка → { latin, de }. Столбцы делятся по самому широкому промежутку между словами,
// а если его нет — по тире, знаку равенства или двоеточию.
export function splitLine(line) {
  const ws = (line.words || []).filter((w) => w.text && w.text.trim() && !JUNK.test(w.text.trim()));
  if (!ws.length) return null;
  let at = -1, gap = 0;
  for (let i = 0; i < ws.length - 1; i++) {
    const g = ws[i + 1].x0 - ws[i].x1;
    if (g > gap) { gap = g; at = i; }
  }
  const text = (list) => list.map((w) => w.text.trim()).join(' ');
  let latin, de = '';
  if (at >= 0 && gap > (line.h || 20) * 1.1) {
    latin = text(ws.slice(0, at + 1));
    de = text(ws.slice(at + 1));
  } else {
    const all = text(ws);
    const m = all.match(/\s+[–—=:-]\s+|\t/);
    if (m) { latin = all.slice(0, m.index); de = all.slice(m.index + m[0].length); }
    else latin = all;
  }
  latin = clean(latin); de = clean(de);
  return latin || de ? { latin, de } : null;
}

export const linesToPairs = (lines) => lines.map(splitLine).filter(Boolean);

function extractLines(data) {
  const out = [];
  for (const b of data.blocks || []) {
    for (const p of b.paragraphs || []) {
      for (const l of p.lines || []) {
        out.push({
          h: l.bbox ? l.bbox.y1 - l.bbox.y0 : 20,
          y: l.bbox ? l.bbox.y0 : 0,
          words: (l.words || []).map((w) => ({ text: w.text, x0: w.bbox.x0, x1: w.bbox.x1 })),
        });
      }
    }
  }
  return out.sort((a, b) => a.y - b.y);
}

// Объединяет части одной строки, если движок разнёс столбцы по разным блокам.
function mergeRows(lines) {
  const rows = [];
  for (const l of lines) {
    const prev = rows[rows.length - 1];
    if (prev && Math.abs(prev.y - l.y) < Math.min(prev.h, l.h) * 0.6) {
      prev.words = [...prev.words, ...l.words].sort((a, b) => a.x0 - b.x0);
    } else rows.push({ ...l, words: [...l.words] });
  }
  return rows;
}

export async function recognizePhoto(file, logger) {
  const blob = await toBlob(file);
  const worker = await prepare(logger);
  const { data } = await worker.recognize(blob, {}, { blocks: true });
  return linesToPairs(mergeRows(extractLines(data)));
}
