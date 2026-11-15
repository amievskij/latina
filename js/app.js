import { norm, dayStr, addDays, daysBetween, fmtDay, uid, esc, shuffle, saveFile } from './util.js';
import * as db from './db.js';
import { GRADES, newSrs, schedule, isNew, isLearned, fmtInterval } from './srs.js';
import { POS, POS_KEYS, posLabel, posShort, posPlural, fieldsFor, gramFilled, gramPairs, subgroups } from './grammar.js';
import { TENSES, conjugate } from './verbs.js';
import { prepare as prepareOcr, recognizePhoto } from './ocr.js';
import { exportJSON, exportCSV, parseImport, mergeImport } from './io.js';

const VERSION = '1.1.0';
const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');

const S = {
  words: [],
  log: {},                 // { 'YYYY-MM-DD': число ответов }
  settings: { theme: 'auto', mode: 'la-de', dictView: 'list' },
  scan: { state: 'idle', msg: '', pct: 0, rows: [] },
  lastExport: null,
  dict: { q: '', sort: 'date', pos: '', tag: '', nogram: false, limit: 200 },
  session: null,
  lastLa: null,
  installEvt: null,
  importMsg: '',
};

const MODES = [['la-de', 'Lat → De'], ['de-la', 'De → Lat'], ['type', 'Ввод']];
const MODE_TITLE = { 'la-de': 'Латынь → немецкий', 'de-la': 'Немецкий → латынь', type: 'Введите немецкий перевод' };

// ---------- Вспомогательное ----------

const byId = (id) => S.words.find((w) => w.id === id);
const plural = (n, one, few, many) => {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
};
const wordsN = (n) => `${n} ${plural(n, 'слово', 'слова', 'слов')}`;
const dueCount = () => { const t = dayStr(); return S.words.filter((w) => w.srs.due <= t).length; };
const allTags = () => [...new Set(S.words.flatMap((w) => w.tags))].sort((a, b) => a.localeCompare(b));

const keyCache = new WeakMap();
function searchKey(w) {
  let k = keyCache.get(w);
  if (k == null) { k = norm([w.latin, w.de, w.ru].join(' | ')); keyCache.set(w, k); }
  return k;
}

function streak() {
  let d = dayStr(), n = 0;
  if (!S.log[d]) d = addDays(d, -1);
  while (S.log[d]) { n++; d = addDays(d, -1); }
  return n;
}

let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

function applyTheme() {
  const root = document.documentElement;
  if (S.settings.theme === 'auto') delete root.dataset.theme; else root.dataset.theme = S.settings.theme;
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
  if (bg) $('meta[name=theme-color]').setAttribute('content', bg);
}

const saveSettings = () => db.setMeta('settings', S.settings);

// ---------- Маршруты ----------

function route() {
  const [name, arg] = (location.hash.slice(2) || 'home').split('/');
  return { name, arg: arg ? decodeURIComponent(arg) : '' };
}

const views = { home: vHome, dict: vDict, word: vWord, add: vForm, edit: vForm, review: vReview, stats: vStats, settings: vSettings, scan: vScan };
const FULLSCREEN = ['add', 'edit', 'review', 'word', 'scan'];

function render() {
  const { name, arg } = route();
  const view = views[name] || vHome;
  if (name !== 'review') S.session = null;
  app.innerHTML = view(arg);
  document.body.classList.toggle('no-tabs', FULLSCREEN.includes(name));
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === name));
  if (name === 'dict') renderList();
  if (name === 'scan' && S.scan.state === 'idle') prepareOcr().catch(() => {});
  if (name === 'review') { const i = $('#ans'); if (i) i.focus(); }
  if (name !== 'review') window.scrollTo(0, 0);
}

// ---------- Главная ----------

function modeSwitch() {
  return `<div class="seg" role="group" aria-label="Режим повторения">${MODES.map(([k, l]) =>
    `<button type="button" class="${S.settings.mode === k ? 'on' : ''}" data-action="mode" data-mode="${k}">${l}</button>`).join('')}</div>`;
}

function vHome() {
  const total = S.words.length, due = dueCount(), st = streak();
  if (!total) {
    return `<header class="top"><h1 class="brand">Latīna</h1></header>
      <section class="card hero">
        <p class="hero-label">Словарь пока пуст.</p>
        <p class="muted">Добавляйте слова по мере изучения — приложение напомнит, когда их повторить.</p>
        <a class="btn primary big" href="#/add">＋ Добавить первое слово</a>
        <a class="btn big" href="#/scan">Добавить слова по фото</a>
      </section>`;
  }
  return `<header class="top"><h1 class="brand">Latīna</h1>
      <span class="pill">Серия: ${st} ${plural(st, 'день', 'дня', 'дней')}</span></header>
    <section class="card hero">
      <div class="hero-num">${due}</div>
      <div class="hero-label">${plural(due, 'слово', 'слова', 'слов')} к повторению сегодня</div>
      ${modeSwitch()}
      ${due
        ? `<button class="btn primary big" data-action="start">Начать повторение</button>`
        : `<p class="muted">На сегодня всё повторено.</p>
           <button class="btn big" data-action="practice">Тренировка вне расписания</button>`}
    </section>
    <div class="row2"><a class="btn big" href="#/add">＋ Добавить слово</a>
      <a class="btn big" href="#/scan">Слова по фото</a></div>
    <p class="muted center">В словаре ${wordsN(total)}${S.log[dayStr()] ? ` · сегодня ответов: ${S.log[dayStr()]}` : ''}</p>`;
}

// ---------- Словарь ----------

function filtered() {
  const d = S.dict, q = norm(d.q);
  const list = S.words.filter((w) =>
    (!q || searchKey(w).includes(q)) &&
    (!d.pos || (d.pos === 'none' ? !w.pos : w.pos === d.pos)) &&
    (!d.tag || w.tags.includes(d.tag)) &&
    (!d.nogram || !gramFilled(w)));
  if (d.sort === 'alpha') list.sort((a, b) => norm(a.latin).localeCompare(norm(b.latin)));
  else if (d.sort === 'dateAsc') list.sort((a, b) => a.createdAt - b.createdAt);
  else list.sort((a, b) => b.createdAt - a.createdAt);
  return list;
}

function vDict() {
  const d = S.dict, tags = allTags();
  if (d.tag && !tags.includes(d.tag)) d.tag = '';
  const opt = (v, l, cur) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`;
  return `<header class="top"><h2>Словарь</h2><span class="muted" id="cnt"></span></header>
    <input id="q" class="search" type="search" placeholder="Поиск: латынь, немецкий, русский" value="${esc(d.q)}"
      autocapitalize="none" autocorrect="off" autocomplete="off" spellcheck="false" aria-label="Поиск">
    <div class="seg">${[['list', 'Список'], ['groups', 'Группы']].map(([k, l]) =>
      `<button type="button" class="${S.settings.dictView === k ? 'on' : ''}" data-action="dictview" data-view="${k}">${l}</button>`).join('')}</div>
    <div class="filters">
      <select id="fsort" aria-label="Сортировка">
        ${opt('date', 'Сначала новые', d.sort)}${opt('dateAsc', 'Сначала старые', d.sort)}${opt('alpha', 'По алфавиту', d.sort)}
      </select>
      <select id="fpos" aria-label="Wortart">
        ${opt('', 'Alle Wortarten', d.pos)}${POS.map((p) => opt(p[0], p[1], d.pos)).join('')}${opt('none', 'Wortart не указана', d.pos)}
      </select>
      ${tags.length ? `<select id="ftag" aria-label="Тег">${opt('', 'Все теги', d.tag)}${tags.map((t) => opt(t, t, d.tag)).join('')}</select>` : ''}
      <button type="button" class="chip${d.nogram ? ' on' : ''}" data-action="nogram" aria-pressed="${d.nogram}">Грамматика не заполнена</button>
    </div>
    <div id="list"></div>
    <a class="fab" href="#/add" aria-label="Добавить слово">＋</a>`;
}

function renderList() {
  const box = $('#list');
  if (!box) return;
  const list = filtered(), d = S.dict;
  $('#cnt').textContent = list.length === S.words.length ? wordsN(list.length) : `${list.length} из ${S.words.length}`;
  if (!S.words.length) {
    box.innerHTML = `<p class="empty">Словарь пуст. Нажмите «＋», чтобы добавить первое слово.</p>`;
    return;
  }
  if (!list.length) { box.innerHTML = `<p class="empty">Ничего не найдено.</p>`; return; }
  if (S.settings.dictView === 'groups') { box.innerHTML = groupsHTML(list); return; }
  box.innerHTML = list.slice(0, d.limit).map(itemHTML).join('') +
    (list.length > d.limit ? `<button class="btn" data-action="more">Показать ещё (${list.length - d.limit})</button>` : '');
}

function itemHTML(w) {
  return `<a class="item" href="#/word/${encodeURIComponent(w.id)}">
      <div class="item-head"><span class="la">${esc(w.latin)}</span>
        ${w.pos ? `<span class="badge">${posShort(w.pos)}</span>` : ''}
        ${gramFilled(w) ? '' : `<span class="badge warn">без грамматики</span>`}</div>
      <div class="de">${esc(w.de)}</div>
      ${w.ru ? `<div class="ru">${esc(w.ru)}</div>` : ''}
    </a>`;
}

// Группы: по части речи; внутри глаголы — по спряжению, существительные — по склонению, предлоги — по падежу.
function groupsHTML(list) {
  return [...POS_KEYS, ''].map((pos) => {
    const ws = list.filter((w) => (w.pos || '') === pos);
    if (!ws.length) return '';
    const sg = subgroups(pos);
    const body = sg
      ? [...sg.options, ['', sg.none]].map(([k, label]) => {
          const sub = ws.filter((w) => ((w.gram && w.gram[sg.key]) || '') === k);
          return sub.length ? `<h4>${esc(label)} <span class="muted">· ${sub.length}</span></h4>` + sub.map(itemHTML).join('') : '';
        }).join('')
      : ws.map(itemHTML).join('');
    return `<details class="grp" open><summary><span>${pos ? posPlural(pos) : 'Wortart не указана'}</span>
      <span class="pill">${ws.length}</span></summary><div class="grp-body">${body}</div></details>`;
  }).join('');
}

function tensesHTML(w) {
  if (w.pos !== 'verb') return { cards: '', notes: [] };
  const { tenses, notes } = conjugate(w);
  const cards = TENSES.filter(([k]) => tenses[k]).map(([k, name]) => {
    const f = tenses[k];
    return `<div class="tense"><h4>${name}</h4><table class="la">
      <tr><th></th><th>Sg.</th><th>Pl.</th></tr>
      ${[0, 1, 2].map((i) => `<tr><th>${i + 1}.</th><td>${esc(f[i])}</td><td>${esc(f[i + 3])}</td></tr>`).join('')}
    </table></div>`;
  }).join('');
  return { cards, notes };
}

// ---------- Карточка слова ----------

function gramBlock(w) {
  const pairs = gramPairs(w);
  if (!pairs.length) return '';
  return `<dl class="gram-list">${pairs.map(([l, v, la]) =>
    `<div><dt>${esc(l)}</dt><dd${la ? ' class="la"' : ''}>${esc(v)}</dd></div>`).join('')}</dl>`;
}

function vWord(id) {
  const w = byId(id);
  if (!w) return `<header class="top"><button class="icon" data-action="back" aria-label="Назад">‹</button><h2>Слово не найдено</h2></header>`;
  const t = dayStr();
  const next = isNew(w.srs) ? 'новое слово, ещё не повторялось'
    : w.srs.due <= t ? 'пора повторить сегодня'
    : `следующее повторение ${fmtDay(w.srs.due)} (через ${daysBetween(t, w.srs.due)} дн.)`;
  const eid = encodeURIComponent(w.id);
  return `<header class="top"><button class="icon" data-action="back" aria-label="Назад">‹</button><h2>Карточка</h2></header>
    <section class="card">
      <div class="w-la la">${esc(w.latin)}</div>
      ${w.pos ? `<div class="muted">${posLabel(w.pos)}</div>` : ''}
      <div class="w-de">${esc(w.de)}</div>
      ${w.ru ? `<div class="w-ru">${esc(w.ru)}</div>` : ''}
    </section>
    <section class="card">
      <h3>Grammatik</h3>
      ${gramBlock(w) || `<p class="muted">${w.pos ? 'Формы пока не заполнены.' : 'Wortart и формы пока не указаны.'}</p>`}
      ${gramFilled(w) && fieldsFor(w.pos).every((f) => w.gram[f.k]) ? '' : `<a class="btn" href="#/edit/${eid}">Дописать грамматику</a>`}
    </section>
    ${w.pos === 'verb' ? ((tn) => `<section class="card"><h3>Formen · Indikativ Aktiv</h3>
      ${tn.cards ? `<div class="tenses">${tn.cards}</div>` : ''}
      ${tn.notes.map((n) => `<p class="hint">${esc(n)}</p>`).join('')}
      ${tn.cards ? `<p class="muted small">Формы построены автоматически по полям Infinitiv, Perfekt и Konjugation — сверяйте с учебником.</p>` : ''}
    </section>`)(tensesHTML(w)) : ''}
    ${w.example ? `<section class="card"><h3>Пример</h3><p class="la pre">${esc(w.example)}</p></section>` : ''}
    ${w.note ? `<section class="card"><h3>Заметка</h3><p class="pre">${esc(w.note)}</p></section>` : ''}
    ${w.tags.length ? `<div class="tags">${w.tags.map((x) => `<span class="badge">${esc(x)}</span>`).join('')}</div>` : ''}
    <p class="muted center">Добавлено ${fmtDay(dayStr(new Date(w.createdAt)))} · ${next}</p>
    <div class="bottombar">
      <button class="btn danger" data-action="del" data-id="${esc(w.id)}">Удалить</button>
      <a class="btn primary" href="#/edit/${eid}">Изменить</a>
    </div>`;
}

// ---------- Добавление и правка ----------

function gramHTML(pos, gram = {}) {
  const fs = fieldsFor(pos);
  if (!fs.length) return `<p class="hint">Грамматику можно дописать позже: укажите Wortart — и появятся нужные поля.</p>`;
  const la = 'data-la autocapitalize="none" autocorrect="off" autocomplete="off" spellcheck="false"';
  return `<fieldset class="gram"><legend>Grammatik <span class="muted">— по желанию</span></legend>
    ${fs.map((f) => {
      const v = gram[f.k] || '';
      if (f.options) {
        return `<label>${f.label}<select name="g.${f.k}"><option value="">— не указано —</option>
          ${f.options.map(([k, l]) => `<option value="${k}"${k === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>`;
      }
      if (f.area) return `<label>${f.label}<textarea name="g.${f.k}" rows="3" ${la} placeholder="${esc(f.ph)}">${esc(v)}</textarea></label>`;
      return `<label>${f.label}<input name="g.${f.k}" ${la} value="${esc(v)}" placeholder="${esc(f.ph)}"></label>`;
    }).join('')}</fieldset>`;
}

function vForm(id) {
  const editing = route().name === 'edit';
  const w = editing ? byId(id) : null;
  if (editing && !w) return `<header class="top"><button class="icon" data-action="back" aria-label="Назад">‹</button><h2>Слово не найдено</h2></header>`;
  const v = w || { latin: '', de: '', ru: '', pos: '', gram: {}, example: '', note: '', tags: [] };
  const tags = allTags();
  const la = 'data-la autocapitalize="none" autocorrect="off" autocomplete="off" spellcheck="false"';
  S.lastLa = null;
  return `<header class="top"><button class="icon" data-action="back" aria-label="Назад">‹</button>
      <h2>${editing ? 'Изменить слово' : 'Новое слово'}</h2>
      ${editing ? '' : '<a class="pill" href="#/scan">По фото</a>'}</header>
    <form id="f" novalidate data-id="${esc(w ? w.id : '')}">
      <label><span>Латинское слово <b class="req">*</b></span>
        <input name="latin" ${la} value="${esc(v.latin)}" placeholder="словарная форма, напр. amō"></label>
      <div class="macron" id="macron" aria-label="Гласные с макроном">
        ${['ā', 'ē', 'ī', 'ō', 'ū', 'ȳ'].map((c) => `<button type="button" data-action="mac">${c}</button>`).join('')}
        <button type="button" data-action="shift" aria-label="Заглавные" title="Заглавные">⇧</button>
      </div>
      <div id="dup"></div>
      <label><span>Немецкий перевод <b class="req">*</b></span>
        <input name="de" lang="de" autocomplete="off" value="${esc(v.de)}" placeholder="напр. lieben"></label>
      <label>Русский перевод
        <input name="ru" lang="ru" autocomplete="off" value="${esc(v.ru)}" placeholder="по желанию"></label>
      <label>Wortart (часть речи)
        <select name="pos"><option value="">— укажу позже —</option>
          ${POS.map((p) => `<option value="${p[0]}"${p[0] === v.pos ? ' selected' : ''}>${p[1]}</option>`).join('')}</select></label>
      <div id="gram">${gramHTML(v.pos, v.gram)}</div>
      <label>Пример употребления
        <textarea name="example" rows="2" ${la}>${esc(v.example)}</textarea></label>
      <label>Заметка
        <textarea name="note" rows="2">${esc(v.note)}</textarea></label>
      <label>Теги / темы
        <input name="tags" autocomplete="off" autocapitalize="none" value="${esc(v.tags.join(', '))}" placeholder="через запятую: Lektion 3, Familie"></label>
      ${tags.length ? `<div class="tags">${tags.map((t) => `<button type="button" class="chip" data-action="tag" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : ''}
      <div class="bottombar"><button class="btn primary big" type="submit">Сохранить</button></div>
    </form>`;
}

function readForm() {
  const o = { gram: {} };
  for (const [k, raw] of new FormData($('#f'))) {
    const v = String(raw).trim();
    if (k.startsWith('g.')) { if (v) o.gram[k.slice(2)] = v; } else o[k] = v;
  }
  return o;
}

const parseTags = (s) => [...new Set(s.split(',').map((t) => t.trim()).filter(Boolean))];

function findDup(latin, exceptId) {
  const n = norm(latin);
  return n ? S.words.filter((w) => w.id !== exceptId && norm(w.latin) === n) : [];
}

function showDup() {
  const f = $('#f'), box = $('#dup');
  if (!f || !box) return;
  const dups = findDup(f.elements.latin.value, f.dataset.id);
  box.innerHTML = dups.length
    ? `<div class="warnbox">Такое слово уже есть в словаре: ${dups.map((d) =>
        `<a href="#/word/${encodeURIComponent(d.id)}"><span class="la">${esc(d.latin)}</span> — ${esc(d.de)}</a>`).join('; ')}</div>`
    : '';
}

async function saveWord() {
  const f = $('#f'), o = readForm(), id = f.dataset.id;
  let bad = null;
  for (const name of ['de', 'latin']) {
    const el = f.elements[name];
    el.classList.toggle('invalid', !o[name]);
    if (!o[name]) bad = el;
  }
  if (bad) { bad.focus(); toast('Заполните латинское слово и немецкий перевод'); return; }
  const dups = findDup(o.latin, id);
  if (dups.length && !confirm(`В словаре уже есть «${dups[0].latin}» — ${dups[0].de}.\n\nВсё равно сохранить?`)) return;
  const gram = {};
  for (const fld of fieldsFor(o.pos)) if (o.gram[fld.k]) gram[fld.k] = o.gram[fld.k];
  const now = Date.now();
  const prev = id ? byId(id) : null;
  const w = {
    id: prev ? prev.id : uid(),
    latin: o.latin, de: o.de, ru: o.ru || '', pos: o.pos || '', gram,
    example: o.example || '', note: o.note || '', tags: parseTags(o.tags || ''),
    createdAt: prev ? prev.createdAt : now, updatedAt: now,
    srs: prev ? prev.srs : newSrs(dayStr()),
  };
  await db.putWord(w);
  if (prev) S.words[S.words.indexOf(prev)] = w; else S.words.push(w);
  if (prev) { toast('Сохранено'); history.back(); }
  else { toast(`Добавлено: ${w.latin}`); render(); const el = $('#f [name=latin]'); if (el) el.focus(); }
}

function insertChar(ch) {
  const el = S.lastLa && document.contains(S.lastLa) ? S.lastLa : $('#f [name=latin]');
  const a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? a;
  el.value = el.value.slice(0, a) + ch + el.value.slice(b);
  el.focus();
  el.setSelectionRange(a + ch.length, a + ch.length);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

// ---------- Слова по фото ----------

function scanStat() {
  const sc = S.scan;
  if (!sc.msg) return '';
  return `<p class="${sc.state === 'error' ? 'warnbox' : 'muted'}">${esc(sc.msg)}</p>
    ${sc.state === 'work' ? `<div class="progress"><i style="width:${Math.round((sc.pct || 0) * 100)}%"></i></div>` : ''}`;
}

const scanCount = () => S.scan.rows.filter((r) => r.on).length;

function vScan() {
  const sc = S.scan, busy = sc.state === 'work';
  const la = 'data-la autocapitalize="none" autocorrect="off" autocomplete="off" spellcheck="false"';
  return `<header class="top"><button class="icon" data-action="back" aria-label="Назад">‹</button><h2>Слова по фото</h2></header>
    <section class="card">
      <p class="muted">Сфотографируйте печатный список слов: латынь слева, немецкий справа. Снимайте ровно, при хорошем свете,
        чтобы в кадре был только список. Рукописный текст не распознаётся.</p>
      <label class="btn primary big${busy ? ' off' : ''}" for="photo">Сделать фото или выбрать из галереи</label>
      <input type="file" id="photo" accept="image/*" hidden${busy ? ' disabled' : ''}>
      <div id="scanstat">${scanStat()}</div>
    </section>
    ${sc.rows.length ? `
      <button class="btn" data-action="scanswap">Поменять столбцы местами</button>
      <label>Тег для всех слов с этого фото
        <input id="scantag" autocomplete="off" autocapitalize="none" placeholder="напр. Lektion 5"></label>
      <div id="scanrows">${sc.rows.map((r, i) => `
        <div class="scanrow" data-i="${i}">
          <input type="checkbox" data-k="on"${r.on ? ' checked' : ''} aria-label="Добавить это слово">
          <div class="pair">
            <input data-k="latin" ${la} value="${esc(r.latin)}" placeholder="латынь" aria-label="Латынь">
            <input data-k="de" lang="de" autocomplete="off" value="${esc(r.de)}" placeholder="немецкий" aria-label="Немецкий">
            ${r.dup ? '<span class="badge warn">уже есть в словаре</span>' : ''}
          </div>
        </div>`).join('')}</div>
      <div class="bottombar"><button class="btn primary big" id="scanadd" data-action="scanadd">Добавить выбранные (${scanCount()})</button></div>` : ''}`;
}

async function doScan(file) {
  const sc = S.scan;
  Object.assign(sc, { state: 'work', rows: [], msg: 'Готовлю распознавание…', pct: 0 });
  render();
  try {
    const pairs = await recognizePhoto(file, (m) => {
      if (m.status === 'recognizing text') { sc.msg = 'Распознаю текст…'; sc.pct = m.progress; }
      else { sc.msg = 'Загружаю модуль распознавания (долго только в первый раз)…'; sc.pct = m.progress || 0; }
      const box = $('#scanstat');
      if (box) box.innerHTML = scanStat();
    });
    sc.rows = pairs.map((p) => {
      const dup = findDup(p.latin).length > 0;
      return { latin: p.latin, de: p.de, dup, on: !!p.latin && !!p.de && !dup };
    });
    sc.state = 'done';
    sc.msg = pairs.length
      ? `Найдено строк: ${pairs.length}. Проверьте и поправьте их перед добавлением — распознавание ошибается, особенно в знаках долготы.`
      : 'Текст на фото не найден. Попробуйте снять ближе и ровнее.';
  } catch (e) {
    sc.state = 'error';
    sc.msg = 'Не удалось распознать фото: ' + (e && e.message ? e.message : e);
  }
  if (route().name === 'scan') render();
}

async function scanAdd() {
  const t = dayStr(), now = Date.now(), tags = parseTags(($('#scantag') || {}).value || '');
  const list = [];
  let skipped = 0;
  for (const r of S.scan.rows) {
    if (!r.on) continue;
    const latin = r.latin.trim(), de = r.de.trim();
    if (!latin || !de) { skipped++; continue; }
    list.push({ id: uid(), latin, de, ru: '', pos: '', gram: {}, example: '', note: '', tags: [...tags],
      createdAt: now + list.length, updatedAt: now, srs: newSrs(t) });
  }
  if (!list.length) { toast('Нет отмеченных строк, где заполнены и латынь, и немецкий'); return; }
  await db.putWords(list);
  S.words.push(...list);
  S.scan = { state: 'idle', msg: '', pct: 0, rows: [] };
  toast(`Добавлено: ${wordsN(list.length)}` + (skipped ? `, пропущено без перевода: ${skipped}` : ''), 4000);
  location.hash = '#/dict';
}

// ---------- Повторение ----------

function startSession(practice) {
  const t = dayStr();
  let ids = (practice ? S.words : S.words.filter((w) => w.srs.due <= t)).map((w) => w.id);
  shuffle(ids);
  if (practice) ids = ids.slice(0, 20);
  S.session = { queue: ids, pos: 0, total: ids.length, done: 0, mode: S.settings.mode, practice, revealed: false, typed: null };
}

function current() {
  const s = S.session;
  while (s.pos < s.queue.length) {
    const w = byId(s.queue[s.pos]);
    if (w) return w;
    s.pos++;
  }
  return null;
}

function deClean(s) {
  return norm(String(s).replace(/\([^)]*\)/g, ' ').replace(/[.!?…]/g, ' '))
    .replace(/^(der|die|das|ein|eine|einen|sich|etwas|etw|jemanden|jemandem|jdn|jdm|zu) /, '').trim();
}
function checkTyped(input, de) {
  const a = deClean(input);
  if (!a) return false;
  const variants = new Set([de, ...de.split(/[,;/]/)].map(deClean).filter(Boolean));
  return variants.has(a);
}

function answerHTML(w, mode) {
  const extra = `${w.ru ? `<div class="w-ru">${esc(w.ru)}</div>` : ''}
    ${gramBlock(w)}
    ${((c) => (c ? `<details class="more"><summary>Formen · Indikativ Aktiv</summary><div class="tenses">${c}</div></details>` : ''))(tensesHTML(w).cards)}
    ${w.example ? `<p class="la pre ex">${esc(w.example)}</p>` : ''}
    ${w.note ? `<p class="pre muted">${esc(w.note)}</p>` : ''}`;
  if (mode === 'de-la') return `<div class="w-la la">${esc(w.latin)}</div>${extra}`;
  return `<div class="w-de">${esc(w.de)}</div>${extra}`;
}

function vReview() {
  if (!S.session) startSession(false);
  const s = S.session, w = current();
  const head = `<header class="top"><a class="icon" href="#/home" aria-label="Закончить">✕</a>
    <div class="progress"><i style="width:${s.total ? Math.round((s.done / s.total) * 100) : 0}%"></i></div>
    <span class="muted">${s.done} / ${s.total}</span></header>`;
  if (!w) {
    return `${head}<section class="card hero">
      <div class="hero-label">${s.total ? 'Готово!' : 'На сегодня повторять нечего'}</div>
      ${s.total ? `<p class="muted">${s.practice ? 'Тренировка' : 'Повторение'}: ${wordsN(s.done)}.</p>` : ''}
      <a class="btn primary big" href="#/home">На главную</a></section>`;
  }
  const typing = s.mode === 'type';
  const prompt = s.mode === 'de-la'
    ? `<div class="w-de">${esc(w.de)}</div>`
    : `<div class="w-la la">${esc(w.latin)}</div>`;
  let verdict = '';
  if (typing && s.revealed && s.typed) {
    verdict = s.typed.ok
      ? `<div class="verdict ok">Верно</div>`
      : `<div class="verdict bad">Неверно${s.typed.text ? ` — ваш ответ: «${esc(s.typed.text)}»` : ''}</div>`;
  }
  const card = `<section class="card rv-card">
      <div class="muted small">${MODE_TITLE[s.mode]}${s.practice ? ' · тренировка' : ''}</div>
      ${prompt}
      ${s.revealed ? `<hr>${verdict}${answerHTML(w, s.mode)}` : ''}
    </section>`;
  let actions;
  if (!s.revealed) {
    actions = typing
      ? `<form id="typef" class="bottombar col">
           <input id="ans" lang="de" placeholder="Немецкий перевод" autocapitalize="none" autocorrect="off" autocomplete="off" spellcheck="false" aria-label="Ваш ответ">
           <button class="btn primary big" type="submit">Проверить</button></form>`
      : `<div class="bottombar"><button class="btn primary big" data-action="reveal">Показать ответ</button></div>`;
  } else {
    const t = dayStr();
    const hint = s.typed ? (s.typed.ok ? 2 : 0) : -1;
    actions = `<div class="bottombar grades">${GRADES.map((g, i) => `
      <button class="btn g${i}${hint === i ? ' hint' : ''}" data-action="grade" data-g="${i}">
        <span>${g}</span><small>${s.practice ? '' : fmtInterval(schedule(w.srs, i, t).interval)}</small></button>`).join('')}</div>`;
  }
  return head + card + actions;
}

async function grade(g) {
  const s = S.session, w = current();
  if (!s || !w || !s.revealed) return;
  if (!s.practice) {
    const t = dayStr();
    w.srs = schedule(w.srs, g, t);
    w.srs.last = Date.now();
    w.updatedAt = Date.now();
    S.log[t] = (S.log[t] || 0) + 1;
    await db.putWord(w);
    await db.setMeta('log', S.log);
  }
  if (g === 0) s.queue.push(w.id); else s.done++;
  s.pos++; s.revealed = false; s.typed = null;
  render();
}

// ---------- Статистика ----------

function vStats() {
  const t = dayStr(), total = S.words.length;
  const learned = S.words.filter((w) => isLearned(w.srs)).length;
  const fresh = S.words.filter((w) => isNew(w.srs)).length;
  const st = streak();
  const days = Array.from({ length: 14 }, (_, i) => addDays(t, i - 13));
  const max = Math.max(1, ...days.map((d) => S.log[d] || 0));
  const tile = (n, label) => `<div class="tile"><b>${n}</b><span>${label}</span></div>`;
  return `<header class="top"><h2>Статистика</h2></header>
    <div class="tiles">
      ${tile(total, 'всего слов')}
      ${tile(learned, 'выучено')}
      ${tile(total - learned - fresh, 'на повторении')}
      ${tile(fresh, 'новых')}
      ${tile(dueCount(), 'к повторению сегодня')}
      ${tile(st, `${plural(st, 'день', 'дня', 'дней')} подряд`)}
    </div>
    <section class="card">
      <h3>Ответы за 14 дней</h3>
      <div class="chart" role="img" aria-label="Число ответов по дням за последние 14 дней">
        ${days.map((d) => { const n = S.log[d] || 0; return `<div class="col" title="${fmtDay(d)}: ${n}">
          <span class="n">${n || ''}</span><i style="height:${Math.round((n / max) * 100)}%"></i><span class="d">${d.slice(8)}</span></div>`; }).join('')}
      </div>
    </section>
    <p class="muted center small">«Выучено» — слова с интервалом повторения от 21 дня.<br>«На повторении» — уже повторялись, но интервал пока короче.</p>`;
}

// ---------- Настройки и данные ----------

function vSettings() {
  const th = S.settings.theme;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const exp = S.lastExport
    ? `Последняя копия: ${fmtDay(dayStr(new Date(S.lastExport)))}`
    : 'Резервная копия ещё не создавалась';
  return `<header class="top"><h2>Настройки</h2></header>
    <section class="card">
      <h3>Тема</h3>
      <div class="seg">${[['auto', 'Как в системе'], ['light', 'Светлая'], ['dark', 'Тёмная']].map(([k, l]) =>
        `<button type="button" class="${th === k ? 'on' : ''}" data-action="theme" data-theme="${k}">${l}</button>`).join('')}</div>
    </section>
    <section class="card">
      <h3>Резервная копия и перенос</h3>
      <p class="muted">Словарь хранится только на этом устройстве. ${exp}.</p>
      <button class="btn big" data-action="export" data-kind="json">Экспорт в JSON <small>полная копия с прогрессом</small></button>
      <button class="btn big" data-action="export" data-kind="csv">Экспорт в CSV <small>таблица слов для Excel</small></button>
      <label class="btn big" for="imp">Импорт из файла <small>JSON или CSV, без дубликатов</small></label>
      <input type="file" id="imp" hidden accept=".json,.csv,application/json,text/csv,text/comma-separated-values">
      ${S.importMsg ? `<div class="warnbox ok">${esc(S.importMsg)}</div>` : ''}
    </section>
    <section class="card">
      <h3>Установка</h3>
      ${standalone ? `<p class="muted">Приложение установлено и работает без интернета.</p>`
        : S.installEvt ? `<button class="btn primary big" data-action="install">Установить приложение</button>`
        : `<p class="muted"><b>Android (Chrome):</b> меню ⋮ → «Добавить на главный экран» / «Установить приложение».<br>
           <b>iPhone (Safari):</b> кнопка «Поделиться» → «На экран „Домой“».</p>`}
    </section>
    <p class="muted center small">Latīna ${VERSION} · слов в словаре: ${S.words.length}</p>`;
}

async function doExport(kind) {
  if (!S.words.length) { toast('Словарь пуст — экспортировать нечего'); return; }
  const name = `latina-${dayStr()}.${kind}`;
  const ok = kind === 'json'
    ? await saveFile(name, exportJSON(S.words, S.log), 'application/json')
    : await saveFile(name, exportCSV(S.words), 'text/csv');
  if (!ok) return;
  S.lastExport = Date.now();
  await db.setMeta('lastExport', S.lastExport);
  toast(`Файл ${name} сохранён`);
  render();
}

async function doImport(file) {
  try {
    const { words, log, invalid } = parseImport(file.name, await file.text());
    const res = mergeImport(S.words, words);
    if (res.put.length) await db.putWords(res.put);
    if (log) {
      for (const [d, n] of Object.entries(log)) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(d) && Number(n) > (S.log[d] || 0)) S.log[d] = Number(n);
      }
      await db.setMeta('log', S.log);
    }
    S.words = await db.allWords();
    S.importMsg = `Импорт завершён. Добавлено: ${res.added}, обновлено: ${res.updated}, пропущено как дубликаты: ${res.skipped}` +
      (invalid ? `, без обязательных полей: ${invalid}` : '') + '.';
  } catch (e) {
    S.importMsg = 'Не удалось импортировать файл: ' +
      (e instanceof SyntaxError ? 'он повреждён или это не JSON/CSV из этого приложения.' : e.message) +
      ' Словарь не изменён.';
  }
  render();
}

// ---------- События ----------

const actions = {
  back() { if (history.length > 1) history.back(); else location.hash = '#/dict'; },
  mode(el) { S.settings.mode = el.dataset.mode; saveSettings(); render(); },
  theme(el) { S.settings.theme = el.dataset.theme; saveSettings(); applyTheme(); render(); },
  start() { startSession(false); location.hash = '#/review'; },
  practice() { startSession(true); location.hash = '#/review'; },
  nogram() { S.dict.nogram = !S.dict.nogram; S.dict.limit = 200; render(); },
  more() { S.dict.limit += 200; renderList(); },
  dictview(el) { S.settings.dictView = el.dataset.view; saveSettings(); render(); },
  scanswap() { for (const r of S.scan.rows) [r.latin, r.de] = [r.de, r.latin]; render(); },
  scanadd() { scanAdd(); },
  mac(el) { insertChar(el.textContent); },
  shift() {
    const bar = $('#macron'), up = bar.classList.toggle('up');
    bar.querySelectorAll('[data-action=mac]').forEach((b) => {
      b.textContent = up ? b.textContent.toUpperCase() : b.textContent.toLowerCase();
    });
  },
  tag(el) {
    const input = $('#f [name=tags]'), cur = parseTags(input.value);
    if (!cur.includes(el.dataset.tag)) cur.push(el.dataset.tag);
    input.value = cur.join(', ');
  },
  async del(el) {
    const w = byId(el.dataset.id);
    if (!w || !confirm(`Удалить слово «${w.latin}»? Отменить это действие нельзя.`)) return;
    await db.delWord(w.id);
    S.words = S.words.filter((x) => x !== w);
    toast('Слово удалено');
    actions.back();
  },
  reveal() { S.session.revealed = true; render(); },
  grade(el) { grade(Number(el.dataset.g)); },
  export(el) { doExport(el.dataset.kind); },
  async install() {
    if (!S.installEvt) return;
    S.installEvt.prompt();
    await S.installEvt.userChoice;
    S.installEvt = null;
    render();
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (el && actions[el.dataset.action]) actions[el.dataset.action](el, e);
});

// Кнопки макронов не должны отбирать фокус у поля ввода.
document.addEventListener('mousedown', (e) => { if (e.target.closest('#macron')) e.preventDefault(); });

document.addEventListener('focusin', (e) => {
  const el = e.target;
  if (el.matches && el.matches('#f [data-la]')) {
    S.lastLa = el;
    const bar = $('#macron'), label = el.closest('label');
    if (bar && label && label.nextElementSibling !== bar) label.after(bar);
  }
});

document.addEventListener('input', (e) => {
  const el = e.target;
  const srow = el.closest && el.closest('.scanrow');
  if (srow) {
    const r = S.scan.rows[Number(srow.dataset.i)];
    if (r) r[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value;
    const btn = $('#scanadd');
    if (btn) btn.textContent = `Добавить выбранные (${scanCount()})`;
    return;
  }
  if (el.id === 'q') { S.dict.q = el.value; S.dict.limit = 200; renderList(); }
  else if (el.name === 'latin') { el.classList.remove('invalid'); showDup(); }
  else if (el.name === 'de') el.classList.remove('invalid');
});

document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.id === 'fsort') { S.dict.sort = el.value; renderList(); }
  else if (el.id === 'fpos') { S.dict.pos = el.value; S.dict.limit = 200; renderList(); }
  else if (el.id === 'ftag') { S.dict.tag = el.value; S.dict.limit = 200; renderList(); }
  else if (el.name === 'pos' && el.form && el.form.id === 'f') {
    const bar = $('#macron');
    if (bar && $('#gram').contains(bar)) el.closest('label').before(bar); // не потерять панель при перерисовке
    $('#gram').innerHTML = gramHTML(el.value, readForm().gram);
  } else if (el.id === 'imp' && el.files[0]) doImport(el.files[0]);
  else if (el.id === 'photo' && el.files[0]) doScan(el.files[0]);
});

document.addEventListener('submit', (e) => {
  e.preventDefault();
  if (e.target.id === 'f') saveWord();
  else if (e.target.id === 'typef') {
    const s = S.session, w = current(), text = $('#ans').value.trim();
    s.typed = { text, ok: checkTyped(text, w.de) };
    s.revealed = true;
    render();
  }
});

document.addEventListener('keydown', (e) => {
  const s = S.session;
  if (!s || route().name !== 'review' || e.target.matches('input, textarea')) return;
  if (!s.revealed && s.mode !== 'type' && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); actions.reveal(); }
  else if (s.revealed && ['1', '2', '3', '4'].includes(e.key)) grade(Number(e.key) - 1);
});

window.addEventListener('hashchange', render);
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  S.installEvt = e;
  if (route().name === 'settings') render();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

// ---------- Запуск ----------

async function init() {
  try {
    S.words = await db.allWords();
    S.log = (await db.getMeta('log')) || {};
    Object.assign(S.settings, (await db.getMeta('settings')) || {});
    S.lastExport = (await db.getMeta('lastExport')) || null;
  } catch (e) {
    app.innerHTML = `<section class="card"><h3>Не удалось открыть хранилище</h3>
      <p class="muted">Возможно, браузер работает в приватном режиме. ${esc(e && e.message)}</p></section>`;
    return;
  }
  applyTheme();
  render();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('./sw.js').catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) toast('Приложение обновлено. Закройте и откройте его заново.', 6000);
    });
  }
}

init();
