// Общие вспомогательные функции (без доступа к DOM, кроме saveFile).

// Нормализация для поиска и сравнения: без регистра, макронов, умлаутов; ß = ss.
export function norm(s) {
  return (s == null ? '' : String(s))
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/æ/g, 'ae')
    .replace(/œ/g, 'oe')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const p2 = (n) => String(n).padStart(2, '0');

// Локальная дата в виде YYYY-MM-DD (строки сравниваются как даты).
export function dayStr(d = new Date()) {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

export function addDays(str, n) {
  const [y, m, d] = str.split('-').map(Number);
  return dayStr(new Date(y, m - 1, d + n));
}

export function daysBetween(a, b) {
  const t = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((t(b) - t(a)) / 86400000);
}

export function fmtDay(str) {
  const [y, m, d] = str.split('-');
  return `${d}.${m}.${y}`;
}

export function uid() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'w-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => (s == null ? '' : String(s)).replace(/[&<>"']/g, (c) => ESC[c]);

export function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- CSV ----------

export function toCSV(rows, delim = ';') {
  const cell = (v) => {
    const s = v == null ? '' : String(v);
    return /["\r\n]/.test(s) || s.includes(delim) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return rows.map((r) => r.map(cell).join(delim)).join('\r\n');
}

export function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  let delim = ';', best = -1;
  for (const d of [';', ',', '\t']) {
    const n = firstLine.split(d).length;
    if (n > best) { best = n; delim = d; }
  }
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; } else q = false;
      } else cur += c;
    } else if (c === '"' && cur === '') q = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      rows.push(row); row = [];
    } else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

// ---------- Сохранение файла ----------

// На iPhone/iPad в установленном приложении обычная загрузка ненадёжна — используем «Поделиться».
export async function saveFile(name, text, mime) {
  const blob = new Blob([text], { type: mime });
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios && navigator.canShare) {
    const file = new File([blob], name, { type: mime });
    if (navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return true; }
      catch (e) { if (e.name === 'AbortError') return false; }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return true;
}
