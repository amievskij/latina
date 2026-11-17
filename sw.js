// Service worker: кладёт всё приложение в кэш, чтобы оно работало без интернета.
// Словарь лежит в IndexedDB и этим файлом не затрагивается.
// При каждом обновлении приложения увеличивайте номер версии ниже.
// Модуль распознавания фото (vendor/tesseract, ~15 МБ) попадает в кэш при первом использовании.
const CACHE = 'latina-v8';
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/app.js',
  './js/basis.js',
  './js/course.js',
  './js/db.js',
  './js/grammar.js',
  './js/io.js',
  './js/nouns.js',
  './js/ocr.js',
  './js/srs.js',
  './js/util.js',
  './js/verbs.js',
  './data/lehrbuch.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('latina-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok && res.type === 'basic') cache.put(req, res.clone());
        return res;
      } catch (err) {
        if (req.mode === 'navigate') return cache.match('./index.html');
        throw err;
      }
    })
  );
});

// ---------- Напоминания ----------
// Android (Chrome, установленное приложение) периодически будит service worker. Он смотрит в словарь:
// если время напоминания прошло, сегодня ещё не было повторения и есть слова к повторению — показывает уведомление.
// Как часто будить, решает сам телефон; на iPhone такой возможности нет (там помогает напоминание в календаре).

const pad = (n) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

function openDb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('latina');
    r.onupgradeneeded = () => r.transaction.abort(); // базы ещё нет — ничего не создаём
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
const req = (store, fn, mode = 'readonly') => (db) => new Promise((resolve, reject) => {
  const r = fn(db.transaction(store, mode).objectStore(store));
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

async function remind() {
  const db = await openDb();
  try {
    const getMeta = (k) => req('meta', (s) => s.get(k))(db);
    const settings = (await getMeta('settings')) || {};
    const r = settings.remind || {};
    const t = today();
    const [hh, mm] = (r.time || '19:00').split(':').map(Number);
    const now = new Date();
    const due = await countDue(db, settings, t);
    if (self.navigator.setAppBadge) { try { due ? await self.navigator.setAppBadge(due) : await self.navigator.clearAppBadge(); } catch { /* значок не поддерживается */ } }
    if (!r.on || now.getHours() * 60 + now.getMinutes() < hh * 60 + mm) return;
    const log = (await getMeta('log')) || {};
    if (log[t] || !due || (await getMeta('notified')) === t) return;
    await self.registration.showNotification('Latīna', {
      body: `Пора повторить слова: ${due}. Пара минут — и серия дней продолжится.`,
      tag: 'latina-daily', icon: './icons/icon-192.png', badge: './icons/icon-192.png', data: { url: './#/home' },
    });
    await req('meta', (s) => s.put(t, 'notified'), 'readwrite')(db);
  } finally {
    db.close();
  }
}

// То же правило, что на главном экране: слова со сроком + новые в пределах дневной нормы.
async function countDue(db, settings, t) {
  const words = await req('words', (s) => s.getAll())(db);
  let reviews = 0, fresh = 0, started = 0;
  for (const w of words) {
    const s = w.srs || {};
    if (s.first === t) started++;
    if (!s.due || s.due > t) continue;
    if (!s.reps && !s.lapses) fresh++; else reviews++;
  }
  const limit = settings.newPerDay ?? 20;
  return reviews + (limit ? Math.min(fresh, Math.max(0, limit - started)) : fresh);
}

self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'latina-reminder') e.waitUntil(remind().catch(() => {}));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (all.length) { await all[0].focus(); return; }
    await self.clients.openWindow((e.notification.data && e.notification.data.url) || './');
  })());
});
