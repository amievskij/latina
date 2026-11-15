// Хранилище IndexedDB. Обновление приложения базу не трогает:
// при повышении версии хранилища только добавляются, никогда не удаляются.

const DB_NAME = 'latina';
const DB_VERSION = 1;
let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('words')) db.createObjectStore('words', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    let result;
    const r = fn(t.objectStore(store));
    if (r && 'onsuccess' in r) r.onsuccess = () => { result = r.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const allWords = () => tx('words', 'readonly', (s) => s.getAll());
export const putWord = (w) => tx('words', 'readwrite', (s) => s.put(w));
export const putWords = (list) => tx('words', 'readwrite', (s) => { list.forEach((w) => s.put(w)); });
export const delWord = (id) => tx('words', 'readwrite', (s) => s.delete(id));
export const getMeta = (key) => tx('meta', 'readonly', (s) => s.get(key));
export const setMeta = (key, value) => tx('meta', 'readwrite', (s) => s.put(value, key));
