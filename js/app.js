import { norm, dayStr, addDays, daysBetween, fmtDay, uid, esc, shuffle, saveFile } from './util.js';
import * as db from './db.js';
import { GRADES, newSrs, schedule, isNew, isLearned, fmtInterval } from './srs.js';
import { POS, POS_KEYS, posLabel, posShort, posPlural, fieldsFor, gramFilled, gramPairs, subgroups, inferGrammar } from './grammar.js';
import { TENSES, conjugate } from './verbs.js';
import { prepare as prepareOcr, recognizePhoto } from './ocr.js';
import { exportJSON, exportCSV, parseImport, mergeImport } from './io.js';
import { UNITS, LESSONS, lessonById, checkForm } from './course.js';
import { decline, adjForms, CASES } from './nouns.js';
import { unlockBasis } from './basis.js';

const VERSION = '1.5.0';
const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');

const S = {
  words: [],
  log: {},                 // { 'YYYY-MM-DD': число ответов }
  settings: { theme: 'auto', mode: 'la-de', dictView: 'list', newPerDay: 20, remind: { on: false, time: '19:00' } },
  grammar: { done: {}, xp: 0, days: {} }, // курс грамматики: сколько раз пройден каждый урок, очки опыта
  lesson: null,
  learnSel: null,
  remindMsg: '',
  basisMsg: '',
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
// Что повторять сегодня: все слова, у которых подошёл срок, плюс новые (ещё не повторявшиеся) — но новых
// не больше дневной нормы, в порядке добавления (для базы из учебника — по урокам).
function dueToday() {
  const t = dayStr();
  const reviews = [], fresh = [];
  let started = 0;
  for (const w of S.words) {
    if (w.srs.first === t) started++;
    if (w.srs.due > t) continue;
    (isNew(w.srs) ? fresh : reviews).push(w);
  }
  fresh.sort((a, b) => a.createdAt - b.createdAt);
  const limit = S.settings.newPerDay;
  const room = limit ? Math.max(0, limit - started) : Infinity;
  return { reviews, fresh: fresh.slice(0, room), waiting: Math.max(0, fresh.length - room) };
}
const dueCount = () => { const d = dueToday(); return d.reviews.length + d.fresh.length; };
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

const views = {
  home: vHome, dict: vDict, word: vWord, add: vForm, edit: vForm, review: vReview, stats: vStats, settings: vSettings,
  scan: vScan, learn: vLearn, theory: vTheory, lesson: vLesson,
};
const FULLSCREEN = ['add', 'edit', 'review', 'word', 'scan', 'theory', 'lesson'];

function render() {
  const { name, arg } = route();
  const view = views[name] || vHome;
  if (name !== 'review') S.session = null;
  if (name !== 'lesson') S.lesson = null;
  if (name !== 'learn') S.learnSel = null;
  app.innerHTML = view(arg);
  document.body.classList.toggle('no-tabs', FULLSCREEN.includes(name));
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === name));
  if (name === 'dict') renderList();
  if (name === 'scan' && S.scan.state === 'idle') prepareOcr().catch(() => {});
  if (name === 'review') { const i = $('#ans'); if (i) i.focus(); }
  if (name === 'lesson') { const i = $('#lans'); if (i && !i.disabled) i.focus(); }
  if (name !== 'review' && !(name === 'learn' && S.learnSel)) window.scrollTo(0, 0);
  updateBadge();
}

// Число слов к повторению на значке приложения (где телефон это поддерживает).
function updateBadge() {
  try {
    if (!('setAppBadge' in navigator)) return;
    const n = dueCount();
    (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
  } catch { /* значок не поддерживается */ }
}

// ---------- Главная ----------

function modeSwitch() {
  return `<div class="seg" role="group" aria-label="Режим повторения">${MODES.map(([k, l]) =>
    `<button type="button" class="${S.settings.mode === k ? 'on' : ''}" data-action="mode" data-mode="${k}">${l}</button>`).join('')}</div>`;
}

function vHome() {
  const today = dueToday();
  const total = S.words.length, due = today.reviews.length + today.fresh.length, st = streak();
  if (!total) {
    return `<header class="top"><h1 class="brand">Latīna</h1></header>
      <section class="card hero">
        <p class="hero-label">Словарь пока пуст.</p>
        <p class="muted">Добавляйте слова по мере изучения — приложение напомнит, когда их повторить.</p>
        <a class="btn primary big" href="#/settings">Загрузить слова из учебника</a>
        <a class="btn big" href="#/add">＋ Добавить слово</a>
        <a class="btn big" href="#/scan">Добавить слова по фото</a>
      </section>
      <a class="btn big" href="#/learn">Уроки грамматики</a>`;
  }
  return `<header class="top"><h1 class="brand">Latīna</h1>
      <span class="pill">Серия: ${st} ${plural(st, 'день', 'дня', 'дней')}</span></header>
    <section class="card hero">
      <div class="hero-num">${due}</div>
      <div class="hero-label">${plural(due, 'слово', 'слова', 'слов')} к повторению сегодня</div>
      ${today.fresh.length || today.waiting ? `<p class="muted small">из них новых: ${today.fresh.length}${today.waiting ? ` · ещё ${today.waiting} новых ждут своей очереди` : ''}</p>` : ''}
      ${modeSwitch()}
      ${due
        ? `<button class="btn primary big" data-action="start">Начать повторение</button>`
        : `<p class="muted">На сегодня всё повторено.</p>
           <button class="btn big" data-action="practice">Тренировка вне расписания</button>`}
    </section>
    ${nextLessonCard()}
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
    ${w.pos === 'noun' ? declHTML(w) : ''}
    ${w.pos === 'adj' ? adjHTML(w) : ''}
    ${w.example ? `<section class="card"><h3>Пример</h3><p class="la pre">${esc(w.example)}</p></section>` : ''}
    ${w.note ? `<section class="card"><h3>Заметка</h3><p class="pre">${esc(w.note)}</p></section>` : ''}
    ${w.tags.length ? `<div class="tags">${w.tags.map((x) => `<span class="badge">${esc(x)}</span>`).join('')}</div>` : ''}
    <p class="muted center">Добавлено ${fmtDay(dayStr(new Date(w.createdAt)))} · ${next}</p>
    <div class="bottombar">
      <button class="btn danger" data-action="del" data-id="${esc(w.id)}">Удалить</button>
      <a class="btn primary" href="#/edit/${eid}">Изменить</a>
    </div>`;
}

// Таблица падежей существительного (у имён собственных — только единственное число).
function declHTML(w) {
  const d = decline(w);
  if (!d) return '';
  const name = /^\p{Lu}/u.test(w.latin) && d.sg;
  const head = d.sg && !name ? ['Singular', 'Plural'] : [d.sg ? 'Singular' : 'Plural'];
  const rows = CASES.map(([, n], i) => `<tr><th>${n}</th>${(d.sg && !name ? [d.sg[i], d.pl[i]] : [d.sg ? d.sg[i] : d.pl[i]])
    .map((f) => `<td class="la">${esc(f)}</td>`).join('')}</tr>`).join('');
  return `<section class="card"><h3>Formen · Deklination</h3>
    <table class="para"><thead><tr><th></th>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>
    <p class="muted small">Формы построены автоматически по Genitiv, Genus и склонению — сверяйте с учебником.</p></section>`;
}

function adjHTML(w) {
  const a = adjForms(w);
  if (!a) return '';
  const nums = a.pluralOnly ? ['pl'] : ['sg', 'pl'];
  const rows = nums.flatMap((n) => CASES.map(([, , s], i) => `<tr><th>${s} ${n === 'sg' ? 'Sg.' : 'Pl.'}</th>${['m', 'f', 'n']
    .map((g) => `<td class="la">${esc(a[g][n][i])}</td>`).join('')}</tr>`)).join('');
  return `<section class="card"><h3>Formen · m / f / n</h3>
    <table class="para"><thead><tr><th></th><th>m</th><th>f</th><th>n</th></tr></thead><tbody>${rows}</tbody></table></section>`;
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
  const active = document.activeElement;
  if (active && active.matches && active.matches('[data-la]')) S.lastLa = active;
  const el = S.lastLa && document.contains(S.lastLa) ? S.lastLa : $('#f [name=latin]');
  if (!el) { toast('Сначала нажмите на поле с латинским словом'); return; }
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
      <p class="muted">Сфотографируйте страницу со списком слов: латынь слева, немецкий правее. Снимайте сверху, ровно и при хорошем
        свете. Заголовки и колонку с примечаниями приложение отбросит само. Рукописный текст не распознаётся.</p>
      <label class="btn primary big${busy ? ' off' : ''}" for="photo">Сделать фото или выбрать из галереи</label>
      <input type="file" id="photo" accept="image/*" hidden${busy ? ' disabled' : ''}>
      <div id="scanstat">${scanStat()}</div>
    </section>
    ${sc.rows.length ? `
      <button class="btn" data-action="scanswap">Поменять столбцы местами</button>
      <label>Тег для всех слов с этого фото
        <input id="scantag" autocomplete="off" autocapitalize="none" placeholder="напр. Lektion 5"></label>
      <div class="macron sticky" id="macron" aria-label="Гласные с макроном">
        ${['ā', 'ē', 'ī', 'ō', 'ū', 'ȳ'].map((c) => `<button type="button" data-action="mac">${c}</button>`).join('')}
        <button type="button" data-action="shift" aria-label="Заглавные" title="Заглавные">⇧</button>
      </div>
      <div id="scanrows">${sc.rows.map((r, i) => `
        <div class="scanrow" data-i="${i}">
          <input type="checkbox" data-k="on"${r.on ? ' checked' : ''} aria-label="Добавить это слово">
          <div class="pair">
            <input data-k="latin" ${la} value="${esc(r.latin)}" placeholder="латынь" aria-label="Латынь">
            <input data-k="de" lang="de" autocomplete="off" value="${esc(r.de)}" placeholder="немецкий" aria-label="Немецкий">
            <input data-k="info" class="info" ${la} value="${esc(r.info)}" placeholder="помета из учебника: Adv., Konj., familiam f." aria-label="Грамматическая помета">
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
      sc.msg = m.loading ? 'Загружаю модуль распознавания (долго только в первый раз)…' : 'Распознаю текст — это может занять до минуты…';
      sc.pct = m.progress;
      const box = $('#scanstat');
      if (box) box.innerHTML = scanStat();
    });
    sc.rows = pairs.map((p) => {
      const dup = findDup(p.latin).length > 0;
      return { latin: p.latin, info: p.info || '', de: p.de, dup, on: !!p.latin && !!p.de && !dup };
    });
    sc.state = 'done';
    const gaps = sc.rows.filter((r) => !r.latin || !r.de).length;
    sc.msg = pairs.length
      ? `Найдено строк: ${pairs.length}. Проверьте их перед добавлением: знаки долготы распознаются не всегда.` +
        (gaps ? ` Строк, где не хватает латыни или перевода: ${gaps} — допишите их или оставьте без галочки.` : '')
      : 'Список слов на фото не найден. Снимите страницу целиком, ровно и при хорошем свете.';
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
    const g = inferGrammar(latin, r.info, de);
    list.push({ id: uid(), latin, de, ru: '', pos: g.pos, gram: g.gram, example: '', note: g.note, tags: [...tags],
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
  let ids;
  if (practice) ids = shuffle(S.words.map((w) => w.id));
  else {
    // Сначала повторение уже знакомых слов вперемешку, затем новые — по порядку.
    const d = dueToday();
    ids = [...shuffle(d.reviews.map((w) => w.id)), ...d.fresh.map((w) => w.id)];
  }
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
    const first = w.srs.first || t; // день первого знакомства со словом — для дневной нормы новых слов
    w.srs = schedule(w.srs, g, t);
    w.srs.last = Date.now();
    w.srs.first = first;
    w.updatedAt = Date.now();
    S.log[t] = (S.log[t] || 0) + 1;
    await db.putWord(w);
    await db.setMeta('log', S.log);
  }
  if (g === 0) s.queue.push(w.id); else s.done++;
  s.pos++; s.revealed = false; s.typed = null;
  render();
}

// ---------- Грамматика: путь уроков ----------

const lessonIdx = (id) => LESSONS.findIndex((l) => l.id === id);
const lessonLevel = (id) => Math.min(3, S.grammar.done[id] || 0);
const lessonOpen = (i) => i <= 0 || (S.grammar.done[LESSONS[i - 1].id] || 0) > 0;
const nextLesson = () => LESSONS.find((l, i) => lessonOpen(i) && !S.grammar.done[l.id]) || null;
const OFFSETS = [0, 46, 70, 46, 0, -46, -70, -46];
const LOCK = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';

function nextLessonCard() {
  const l = nextLesson();
  if (!l) return '';
  return `<a class="card next-lesson" href="#/learn" style="--u:${l.unit.color}">
    <span class="nl-dot">▶</span><span><small>Грамматика · следующий урок</small><b>${esc(l.title)}</b></span></a>`;
}

function vLearn() {
  const g = S.grammar, t = dayStr();
  const done = LESSONS.filter((l) => g.done[l.id]).length;
  const next = nextLesson();
  let k = 0;
  const units = UNITS.map((u, ui) => `<section class="unit" style="--u:${u.color}">
      <div class="unit-head"><small>Раздел ${ui + 1}</small><b>${esc(u.title)}</b></div>
      <div class="path">${u.lessons.map((l) => {
        const i = lessonIdx(l.id), open = lessonOpen(i), lvl = lessonLevel(l.id);
        const state = !open ? 'locked' : next && next.id === l.id ? 'current' : lvl ? 'done' : 'open';
        const icon = state === 'locked' ? LOCK : lvl ? `<span class="stars">${'★'.repeat(lvl)}</span>` : '▶';
        return `<div class="node-wrap" style="--off:${OFFSETS[k++ % OFFSETS.length]}px">
          ${state === 'current' ? '<span class="node-tip">Начать</span>' : ''}
          <button class="node ${state}${S.learnSel === l.id ? ' sel' : ''}" data-action="lessonmenu" data-id="${l.id}">${icon}</button>
          <span class="node-label">${esc(l.title)}</span></div>`;
      }).join('')}</div></section>`).join('');
  const sel = S.learnSel && lessonById(S.learnSel);
  return `<header class="top"><h2>Грамматика</h2><span class="pill xp">⚡ ${g.xp} XP</span></header>
    <p class="muted small">Сегодня ${g.days[t] || 0} XP · пройдено уроков: ${done} из ${LESSONS.length}.
      Упражнения строятся из слов вашего словаря.</p>
    ${units}
    ${sel ? lessonSheet(sel) : ''}`;
}

function lessonSheet(l) {
  const i = lessonIdx(l.id), open = lessonOpen(i), lvl = lessonLevel(l.id);
  return `<div class="sheet-bg" data-action="lessonclose"></div>
    <div class="sheet" style="--u:${l.unit.color}" role="dialog" aria-label="${esc(l.title)}">
      <small>${esc(l.unit.title)}</small>
      <h3>${esc(l.title)}</h3>
      <p class="muted">${esc(l.sub)}</p>
      ${open ? `<p class="small muted">${lvl ? `Уровень ${lvl} из 3 ${'★'.repeat(lvl)}` : 'Урок ещё не пройден'}${lvl >= 3 ? ' — урок освоен, можно повторять' : ''}</p>
        <button class="btn primary big" data-action="lessonstart" data-id="${l.id}">${lvl ? 'Повторить урок' : 'Начать урок'} · +10 XP</button>
        <a class="btn" href="#/theory/${l.id}">Теория</a>`
      : `<p class="muted">Откроется после урока «${esc(LESSONS[i - 1].title)}».</p>
        <a class="btn" href="#/theory/${l.id}">Посмотреть теорию</a>`}
    </div>`;
}

function vTheory(id) {
  const l = lessonById(id);
  if (!l) return `<header class="top"><button class="icon" data-action="back" aria-label="Назад">‹</button><h2>Урок не найден</h2></header>`;
  const open = lessonOpen(lessonIdx(id));
  return `<header class="top"><button class="icon" data-action="back" aria-label="Назад">‹</button><h2>${esc(l.title)}</h2></header>
    <section class="card theory" style="--u:${l.unit.color}">${l.theory()}</section>
    ${open ? `<div class="bottombar"><button class="btn primary big" data-action="lessonstart" data-id="${l.id}">Начать урок</button></div>` : ''}`;
}

// ---------- Грамматика: прохождение урока ----------

function newLesson(l) {
  const queue = l.make(S.words);
  return { id: l.id, queue, pos: 0, total: queue.length, solved: 0, mistakes: 0, answer: null, result: null,
    selL: null, matched: [], flash: null, saved: false, xp: 0 };
}

function vLesson(id) {
  const l = lessonById(id);
  if (!l) return `<header class="top"><a class="icon" href="#/learn">✕</a><h2>Урок не найден</h2></header>`;
  if (!S.lesson || S.lesson.id !== id) S.lesson = newLesson(l);
  const L = S.lesson, ex = L.queue[L.pos];
  if (!ex) return lessonDone(l);
  const pct = Math.round((L.solved / Math.max(1, L.total)) * 100);
  return `<header class="top lesson-top"><a class="icon" href="#/learn" aria-label="Закрыть урок">✕</a>
      <div class="progress fat" style="--u:${l.unit.color}"><i style="width:${pct}%"></i></div></header>
    <section class="ex">
      <h3 class="ex-title">${esc(ex.title)}</h3>
      ${ex.prompt ? `<div class="ex-prompt">${ex.prompt}</div>` : ''}
      ${exBody(ex, L)}
    </section>
    ${lessonFooter(ex, L)}`;
}

function exBody(ex, L) {
  const locked = !!L.result;
  if (ex.kind === 'choice') {
    return `<div class="opts">${ex.options.map((o, i) => {
      let cls = 'opt' + (ex.laOpts ? ' la' : '');
      if (L.answer === o) cls += ' on';
      if (locked && o === ex.answer) cls += ' right';
      else if (locked && L.answer === o) cls += ' wrong';
      return `<button class="${cls}" data-action="lpick" data-i="${i}"${locked ? ' disabled' : ''}>${esc(o)}</button>`;
    }).join('')}</div>`;
  }
  if (ex.kind === 'type') {
    return `<form id="lessonf" autocomplete="off">
        <input id="lans" class="la${locked ? (L.result === 'bad' ? ' invalid' : ' good') : ''}" data-la value="${esc(L.answer || '')}"
          placeholder="Латинская форма" autocapitalize="none" autocorrect="off" spellcheck="false"${locked ? ' disabled' : ''}>
      </form>
      ${locked ? '' : `<div class="macron" id="macron">${['ā', 'ē', 'ī', 'ō', 'ū'].map((c) => `<button type="button" data-action="mac">${c}</button>`).join('')}</div>
      <p class="muted small center">Знаки долготы можно не ставить — ответ засчитается, но приложение покажет, где они нужны.</p>`}`;
  }
  // match: левый столбец — формы, правый — описания в перемешанном порядке
  if (!ex.order) ex.order = shuffle(ex.pairs.map((_, i) => i));
  const btn = (side, i, text) => {
    const done = L.matched.includes(i), sel = side === 'l' && L.selL === i;
    const bad = L.flash && L.flash[side === 'l' ? 0 : 1] === i;
    return `<button class="opt${side === 'l' ? ' la' : ''}${done ? ' gone' : ''}${sel ? ' on' : ''}${bad ? ' wrong' : ''}"
      data-action="lmatch" data-side="${side}" data-i="${i}"${done ? ' disabled' : ''}>${esc(text)}</button>`;
  };
  return `<div class="match">
    <div>${ex.pairs.map((p, i) => btn('l', i, p[0])).join('')}</div>
    <div>${ex.order.map((i) => btn('r', i, ex.pairs[i][1])).join('')}</div></div>`;
}

function lessonFooter(ex, L) {
  if (!L.result) {
    if (ex.kind === 'match') return '';
    const ready = ex.kind === 'choice' ? L.answer != null : !!(L.answer || '').trim();
    return `<div class="bottombar"><button id="lcheck" class="btn primary big" data-action="lcheck"${ready ? '' : ' disabled'}>Проверить</button></div>`;
  }
  const ok = L.result !== 'bad';
  const head = L.result === 'bad' ? 'Неверно'
    : L.result === 'macron' ? 'Верно! Обрати внимание на долготу' : pick(['Отлично!', 'Верно!', 'Так держать!', 'Optime!', 'Bene!']);
  const right = ex.kind === 'match' ? '' : `<p>${ok && L.result !== 'macron' ? 'Ответ' : 'Правильно'}: <b class="la">${esc(ex.answer)}</b></p>`;
  const explain = ex.explain ? (ok ? `<details><summary>Показать таблицу</summary>${ex.explain}</details>` : ex.explain) : '';
  return `<div class="feedback ${ok ? 'ok' : 'bad'}">
      <b class="fb-head">${head}</b>${right}${explain}
      <button class="btn big" data-action="lnext">${L.pos + 1 >= L.queue.length ? 'Завершить' : 'Дальше'}</button>
    </div>`;
}

const pick = (a) => a[Math.floor(Math.random() * a.length)];

function lessonDone(l) {
  const L = S.lesson;
  if (!L.saved) saveLesson(L);
  const acc = Math.round((L.total / Math.max(1, L.total + L.mistakes)) * 100);
  const lvl = lessonLevel(l.id);
  const next = nextLesson();
  return `<section class="done-screen" style="--u:${l.unit.color}">
      <div class="done-badge">${'★'.repeat(Math.max(1, lvl))}</div>
      <h2>Урок пройден!</h2>
      <p class="muted">${esc(l.title)} · уровень ${lvl} из 3</p>
      <div class="tiles">
        <div class="tile"><b>+${L.xp}</b><span>XP${L.mistakes ? '' : ' (без ошибок +5)'}</span></div>
        <div class="tile"><b>${acc}%</b><span>точность</span></div>
      </div>
      ${next && next.id !== l.id ? `<p class="muted">Следующий урок: <b>${esc(next.title)}</b></p>` : ''}
    </section>
    <div class="bottombar">
      ${next && next.id !== l.id ? `<button class="btn primary big" data-action="lessonstart" data-id="${next.id}">Следующий урок</button>` : ''}
      <a class="btn big" href="#/learn">К урокам</a>
    </div>`;
}

async function saveLesson(L) {
  L.saved = true;
  const g = S.grammar, t = dayStr();
  L.xp = 10 + (L.mistakes ? 0 : 5);
  g.done[L.id] = (g.done[L.id] || 0) + 1;
  g.xp += L.xp;
  g.days[t] = (g.days[t] || 0) + L.xp;
  S.log[t] = (S.log[t] || 0) + L.total; // урок грамматики тоже продлевает серию дней
  await db.setMeta('grammar', g);
  await db.setMeta('log', S.log);
}

function lessonCheck() {
  const L = S.lesson, ex = L && L.queue[L.pos];
  if (!ex || L.result) return;
  if (ex.kind === 'choice') {
    if (L.answer == null) return;
    L.result = L.answer === ex.answer ? 'ok' : 'bad';
  } else if (ex.kind === 'type') {
    const r = checkForm(L.answer, ex.answer);
    if (!(L.answer || '').trim()) return;
    L.result = r === 'exact' ? 'ok' : r === 'macron' ? 'macron' : 'bad';
  }
  if (L.result === 'bad') {
    L.mistakes++;
    L.queue.push({ ...ex, options: ex.options && shuffle([...ex.options]), order: null }); // ошибка — вопрос вернётся в конце
  } else L.solved++;
  render();
}

function lessonMatch(side, i) {
  const L = S.lesson, ex = L.queue[L.pos];
  if (L.matched.includes(i)) return;
  L.flash = null;
  if (side === 'l') { L.selL = i; render(); return; }
  if (L.selL == null) return;
  if (L.selL === i) {
    L.matched.push(i);
    L.selL = null;
    if (L.matched.length === ex.pairs.length) { L.result = ex.miss ? 'okmiss' : 'ok'; L.solved++; }
  } else {
    L.flash = [L.selL, i];
    ex.miss = true;
    L.selL = null;
    setTimeout(() => { if (S.lesson === L) { L.flash = null; render(); } }, 700);
  }
  render();
}

function lessonNext() {
  const L = S.lesson;
  if (!L) return;
  L.pos++;
  Object.assign(L, { answer: null, result: null, selL: null, matched: [], flash: null });
  render();
  window.scrollTo(0, 0);
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
      ${tile(LESSONS.filter((l) => S.grammar.done[l.id]).length + ' / ' + LESSONS.length, 'уроков грамматики')}
      ${tile(S.grammar.xp, 'XP за уроки')}
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
    ${basisHTML()}
    ${remindHTML()}
    <section class="card">
      <h3>Тема</h3>
      <div class="seg">${[['auto', 'Как в системе'], ['light', 'Светлая'], ['dark', 'Тёмная']].map(([k, l]) =>
        `<button type="button" class="${th === k ? 'on' : ''}" data-action="theme" data-theme="${k}">${l}</button>`).join('')}</div>
    </section>
    <section class="card">
      <h3>Новых слов в день</h3>
      <div class="seg">${[[10, '10'], [20, '20'], [40, '40'], [0, 'Без нормы']].map(([k, l]) =>
        `<button type="button" class="${(S.settings.newPerDay || 0) === k ? 'on' : ''}" data-action="newperday" data-n="${k}">${l}</button>`).join('')}</div>
      <p class="muted small">Столько ещё не повторявшихся слов приложение даёт за день, по порядку добавления. Слова, у которых подошёл срок повторения, показываются все.</p>
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

// ---------- Слова из учебника ----------

function basisHTML() {
  const n = S.words.filter((w) => String(w.id).startsWith('basis-')).length;
  return `<section class="card" id="basis">
      <h3>Слова из учебника</h3>
      <p class="muted">${n ? `В словаре слов из учебника: ${n}.` : 'Уроки 1–14 и «Salve»: 430 слов с грамматикой и тегами по урокам.'}
        Повторная загрузка не создаёт дубликатов и не сбрасывает прогресс.</p>
      <form id="basisf" class="inline-form">
        <input id="basiscode" placeholder="Кодовое слово" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" aria-label="Кодовое слово">
        <button class="btn primary">Загрузить</button>
      </form>
      ${S.basisMsg ? `<div class="warnbox ok">${esc(S.basisMsg)}</div>` : ''}
    </section>`;
}

async function loadBasis(code) {
  S.basisMsg = 'Загружаю…';
  render();
  try {
    const { words } = parseImport('lehrbuch.json', await unlockBasis(code));
    const res = mergeImport(S.words, words);
    if (res.put.length) await db.putWords(res.put);
    S.words = await db.allWords();
    S.basisMsg = res.added
      ? `Готово: добавлено ${wordsN(res.added)}${res.skipped + res.updated ? `, уже были в словаре: ${res.skipped + res.updated}` : ''}. Новые слова будут приходить на повторение по ${S.settings.newPerDay || 'все'} в день, по порядку уроков.`
      : 'Все слова из учебника уже есть в словаре.';
  } catch (e) {
    S.basisMsg = e.message;
  }
  render();
}

// ---------- Напоминания ----------

const canPush = () => 'serviceWorker' in navigator && 'Notification' in window &&
  typeof ServiceWorkerRegistration !== 'undefined' && 'periodicSync' in ServiceWorkerRegistration.prototype;

function remindHTML() {
  const r = S.settings.remind;
  return `<section class="card">
      <h3>Напоминания</h3>
      <label>Время напоминания<input type="time" id="remtime" value="${esc(r.time)}"></label>
      <button class="btn big" data-action="remcal">Напоминание в календаре <small>каждый день в это время — надёжно на Android и iPhone</small></button>
      ${canPush()
        ? `<button class="btn big${r.on ? ' on-state' : ''}" data-action="rempush">${r.on ? 'Уведомления включены — выключить' : 'Включить уведомления'}
            <small>придут, только если сегодня ещё не было повторения</small></button>`
        : '<p class="muted small">Уведомления от самого приложения этот браузер не поддерживает (на iPhone их нет у приложений без сервера). Календарь работает везде.</p>'}
      ${S.remindMsg ? `<div class="warnbox ok">${esc(S.remindMsg)}</div>` : ''}
    </section>`;
}

function icsText(time) {
  const [h, m] = time.split(':').map(Number);
  const start = new Date();
  start.setHours(h, m, 0, 0);
  if (start < new Date()) start.setDate(start.getDate() + 1);
  const p = (n) => String(n).padStart(2, '0');
  const local = (d) => `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}00`;
  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}T${p(now.getUTCHours())}${p(now.getUTCMinutes())}00Z`;
  const url = location.origin + location.pathname;
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Latina//RU', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
    `UID:latina-daily-${Date.now()}@latina`, `DTSTAMP:${stamp}`, `DTSTART:${local(start)}`, 'DURATION:PT15M', 'RRULE:FREQ=DAILY',
    'SUMMARY:Latīna: повторить слова', `DESCRIPTION:Повторение слов и урок грамматики.\\n${url}`, `URL:${url}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Latīna: повторить слова', 'TRIGGER:PT0M', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}

async function remindCalendar() {
  const text = icsText(S.settings.remind.time);
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios) {
    // На iPhone календарь открывается из файла .ics, открытого в Safari.
    const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar' }));
    if (!window.open(url, '_blank')) await saveFile('latina-napominanie.ics', text, 'text/calendar');
    S.remindMsg = 'Откроется календарь: нажмите «Добавить все», и напоминание будет приходить каждый день.';
  } else {
    await saveFile('latina-napominanie.ics', text, 'text/calendar');
    S.remindMsg = 'Файл latina-napominanie.ics сохранён. Откройте его (из уведомления о загрузке или из «Файлов») и выберите календарь — напоминание будет повторяться каждый день.';
  }
  render();
}

async function remindPush() {
  const r = S.settings.remind;
  try {
    const reg = await navigator.serviceWorker.ready;
    if (r.on) {
      await reg.periodicSync.unregister('latina-reminder').catch(() => {});
      r.on = false;
      S.remindMsg = 'Уведомления выключены.';
    } else {
      if ((await Notification.requestPermission()) !== 'granted') throw new Error('Без разрешения на уведомления напоминать не получится. Его можно дать в настройках телефона для этого приложения.');
      await reg.periodicSync.register('latina-reminder', { minInterval: 3 * 60 * 60 * 1000 });
      r.on = true;
      S.remindMsg = `Уведомления включены. Android проверяет словарь в фоне несколько раз в день (как часто — решает сам телефон) и после ${r.time} напомнит, если сегодня ещё не было повторения. Для точного времени добавьте напоминание в календарь.`;
    }
    await saveSettings();
  } catch (e) {
    S.remindMsg = e && e.message && /разрешени/.test(e.message) ? e.message
      : 'Телефон не разрешил фоновую проверку: так бывает, если приложение не установлено на главный экран. Используйте напоминание в календаре.';
  }
  render();
}

async function doExport(kind) {
  if (!S.words.length) { toast('Словарь пуст — экспортировать нечего'); return; }
  const name = `latina-${dayStr()}.${kind}`;
  const ok = kind === 'json'
    ? await saveFile(name, exportJSON(S.words, S.log, { grammar: S.grammar }), 'application/json')
    : await saveFile(name, exportCSV(S.words), 'text/csv');
  if (!ok) return;
  S.lastExport = Date.now();
  await db.setMeta('lastExport', S.lastExport);
  toast(`Файл ${name} сохранён`);
  render();
}

async function doImport(file) {
  try {
    const { words, log, grammar, invalid } = parseImport(file.name, await file.text());
    if (grammar && typeof grammar === 'object') { // прогресс уроков из копии: берётся больший
      const g = S.grammar;
      for (const [id, n] of Object.entries(grammar.done || {})) g.done[id] = Math.max(g.done[id] || 0, Number(n) || 0);
      for (const [d, n] of Object.entries(grammar.days || {})) g.days[d] = Math.max(g.days[d] || 0, Number(n) || 0);
      g.xp = Math.max(g.xp, Number(grammar.xp) || 0);
      await db.setMeta('grammar', g);
    }
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
  newperday(el) { S.settings.newPerDay = Number(el.dataset.n); saveSettings(); render(); },
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
  lessonmenu(el) { S.learnSel = S.learnSel === el.dataset.id ? null : el.dataset.id; render(); },
  lessonclose() { S.learnSel = null; render(); },
  lessonstart(el) {
    const l = lessonById(el.dataset.id);
    if (!l) return;
    S.lesson = newLesson(l);
    if (location.hash === `#/lesson/${l.id}`) render(); else location.hash = `#/lesson/${l.id}`;
  },
  lpick(el) {
    const L = S.lesson, ex = L && L.queue[L.pos];
    if (!ex || L.result) return;
    L.answer = ex.options[Number(el.dataset.i)];
    render();
  },
  lmatch(el) { lessonMatch(el.dataset.side, Number(el.dataset.i)); },
  lcheck() { lessonCheck(); },
  lnext() { lessonNext(); },
  remcal() { remindCalendar(); },
  rempush() { remindPush(); },
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
  if (el.matches && el.matches('#scanrows [data-la], #lessonf [data-la]')) { S.lastLa = el; return; }
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
  if (el.id === 'lans' && S.lesson) {
    S.lesson.answer = el.value;
    const b = $('#lcheck');
    if (b) b.disabled = !el.value.trim();
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
  } else if (el.id === 'remtime' && el.value) { S.settings.remind.time = el.value; saveSettings(); }
  else if (el.id === 'imp' && el.files[0]) doImport(el.files[0]);
  else if (el.id === 'photo' && el.files[0]) doScan(el.files[0]);
});

document.addEventListener('submit', (e) => {
  e.preventDefault();
  if (e.target.id === 'f') saveWord();
  else if (e.target.id === 'lessonf') {
    if (S.lesson && S.lesson.result) lessonNext(); else lessonCheck();
  } else if (e.target.id === 'basisf') loadBasis($('#basiscode').value);
  else if (e.target.id === 'typef') {
    const s = S.session, w = current(), text = $('#ans').value.trim();
    s.typed = { text, ok: checkTyped(text, w.de) };
    s.revealed = true;
    render();
  }
});

document.addEventListener('keydown', (e) => {
  // В уроке Enter нажимает «Проверить» / «Дальше» (для поля ввода это делает форма).
  if (S.lesson && route().name === 'lesson' && e.key === 'Enter' && !e.target.matches('input, textarea')) {
    const b = $('[data-action=lnext]') || $('#lcheck');
    if (b && !b.disabled) { e.preventDefault(); b.click(); }
    return;
  }
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
    const saved = (await db.getMeta('settings')) || {};
    Object.assign(S.settings, saved, { remind: { ...S.settings.remind, ...(saved.remind || {}) } });
    S.lastExport = (await db.getMeta('lastExport')) || null;
    const g = (await db.getMeta('grammar')) || {};
    S.grammar = { done: g.done || {}, xp: g.xp || 0, days: g.days || {} };
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
