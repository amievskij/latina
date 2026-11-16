// Экспорт и импорт словаря (JSON — полная копия с прогрессом, CSV — таблица слов).

import { norm, dayStr, uid, toCSV, parseCSV } from './util.js';
import { newSrs } from './srs.js';
import { POS, POS_KEYS, ALL_GRAM_KEYS } from './grammar.js';

const CSV_COLS = ['latin', 'de', 'ru', 'pos', 'gen', 'gender', 'decl', 'p1', 'inf', 'perf', 'sup', 'conj',
  'm', 'f', 'n', 'comp', 'superl', 'case', 'gram_note', 'example', 'note', 'tags', 'created', 'id'];
const GRAM_COL = (k) => (k === 'note' ? 'gram_note' : k);

const ALIASES = {
  latin: ['latin', 'latein', 'lateinisch', 'latina', 'lat', 'латынь', 'латинский'],
  de: ['de', 'deutsch', 'german', 'немецкий'],
  ru: ['ru', 'russisch', 'russian', 'русский'],
};

const str = (v) => (v == null ? '' : String(v).trim());

// Приводит запись из файла к формату карточки. null — если нет обязательных полей.
export function sanitize(r) {
  const latin = str(r.latin), de = str(r.de);
  if (!latin || !de) return null;
  let pos = str(r.pos).toLowerCase();
  if (!POS_KEYS.includes(pos)) {
    const byLabel = POS.find((p) => p[1].toLowerCase() === pos || p[2] === pos);
    pos = byLabel ? byLabel[0] : '';
  }
  const gram = {};
  if (r.gram && typeof r.gram === 'object') {
    for (const k of ALL_GRAM_KEYS) if (str(r.gram[k])) gram[k] = str(r.gram[k]);
  }
  const rawTags = Array.isArray(r.tags) ? r.tags : str(r.tags).split(/[,;]/);
  const tags = [...new Set(rawTags.map(str).filter(Boolean))];
  const now = Date.now();
  const createdAt = Number(r.createdAt) || now;
  const s = r.srs && typeof r.srs === 'object' ? r.srs : {};
  const base = newSrs(dayStr());
  const srs = {
    due: /^\d{4}-\d{2}-\d{2}$/.test(s.due) ? s.due : base.due,
    interval: Math.max(0, Math.round(Number(s.interval) || 0)),
    ease: Math.min(3, Math.max(1.3, Number(s.ease) || 2.5)),
    reps: Math.max(0, Math.round(Number(s.reps) || 0)),
    lapses: Math.max(0, Math.round(Number(s.lapses) || 0)),
    last: Number(s.last) || null,
    first: /^\d{4}-\d{2}-\d{2}$/.test(s.first) ? s.first : null,
  };
  return {
    id: str(r.id) || uid(), latin, de, ru: str(r.ru), pos, gram,
    example: str(r.example), note: str(r.note), tags,
    createdAt, updatedAt: Number(r.updatedAt) || createdAt, srs,
  };
}

export function exportJSON(words, log) {
  return JSON.stringify({ app: 'latina', version: 1, exportedAt: new Date().toISOString(), words, log }, null, 2);
}

export function exportCSV(words) {
  const rows = [CSV_COLS];
  for (const w of words) {
    const flat = {
      latin: w.latin, de: w.de, ru: w.ru, pos: w.pos, example: w.example, note: w.note,
      tags: w.tags.join(', '), created: new Date(w.createdAt).toISOString(), id: w.id,
    };
    for (const k of ALL_GRAM_KEYS) flat[GRAM_COL(k)] = (w.gram && w.gram[k]) || '';
    rows.push(CSV_COLS.map((c) => flat[c] ?? ''));
  }
  return '﻿' + toCSV(rows, ';');
}

// Разбор файла. Возвращает { words, log, invalid }.
export function parseImport(fileName, text) {
  const trimmed = text.replace(/^﻿/, '').trim();
  let raw = [], log = null;
  if (/\.json$/i.test(fileName) || trimmed[0] === '{' || trimmed[0] === '[') {
    const data = JSON.parse(trimmed);
    raw = Array.isArray(data) ? data : data.words;
    if (!Array.isArray(raw)) throw new Error('В файле нет списка слов');
    if (data.log && typeof data.log === 'object') log = data.log;
  } else {
    const rows = parseCSV(trimmed);
    if (rows.length < 2) throw new Error('В файле нет строк со словами');
    const head = rows[0].map((h) => {
      const n = h.trim().toLowerCase();
      for (const [key, list] of Object.entries(ALIASES)) if (list.includes(n)) return key;
      return n;
    });
    if (!head.includes('latin') || !head.includes('de')) {
      throw new Error('В CSV нужны столбцы «latin» и «de»');
    }
    raw = rows.slice(1).map((r) => {
      const o = { gram: {} };
      head.forEach((h, i) => {
        const v = r[i] ?? '';
        const gk = h === 'gram_note' ? 'note' : h;
        if (h !== 'note' && ALL_GRAM_KEYS.includes(gk)) o.gram[gk] = v;
        else if (h === 'created') o.createdAt = Date.parse(v) || undefined;
        else o[h] = v;
      });
      return o;
    });
  }
  const words = [];
  let invalid = 0;
  for (const r of raw) {
    const w = r && typeof r === 'object' ? sanitize(r) : null;
    if (w) words.push(w); else invalid++;
  }
  return { words, log, invalid };
}

const dupKey = (w) => norm(w.latin) + '|' + norm(w.de);

// Слияние без дубликатов.
// Совпал id: берётся более свежая версия. Совпали латынь+немецкий: в существующую карточку
// дописываются только пустые поля. Иначе слово добавляется.
export function mergeImport(existing, incoming) {
  const byId = new Map(existing.map((w) => [w.id, w]));
  const byKey = new Map(existing.map((w) => [dupKey(w), w]));
  const put = new Map();
  let added = 0, updated = 0, skipped = 0;
  for (const w of incoming) {
    const same = byId.get(w.id);
    if (same) {
      if (w.updatedAt > same.updatedAt) {
        put.set(w.id, w); byId.set(w.id, w); byKey.set(dupKey(w), w); updated++;
      } else skipped++;
      continue;
    }
    const twin = byKey.get(dupKey(w));
    if (twin) {
      const m = { ...twin, gram: { ...twin.gram }, tags: [...twin.tags] };
      let changed = false;
      for (const k of ['ru', 'example', 'note']) if (!m[k] && w[k]) { m[k] = w[k]; changed = true; }
      if (!m.pos && w.pos) { m.pos = w.pos; changed = true; }
      if (m.pos === w.pos) {
        for (const k of Object.keys(w.gram)) if (!m.gram[k]) { m.gram[k] = w.gram[k]; changed = true; }
      }
      for (const t of w.tags) if (!m.tags.includes(t)) { m.tags.push(t); changed = true; }
      if (changed) {
        m.updatedAt = Date.now();
        put.set(m.id, m); byId.set(m.id, m); byKey.set(dupKey(m), m); updated++;
      } else skipped++;
      continue;
    }
    put.set(w.id, w); byId.set(w.id, w); byKey.set(dupKey(w), w); added++;
  }
  return { put: [...put.values()], added, updated, skipped };
}
