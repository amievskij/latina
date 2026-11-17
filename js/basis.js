// Слова из учебника лежат в приложении в зашифрованном виде (data/lehrbuch.json): файл публикуется
// вместе с приложением, но прочитать его можно только с кодовым словом. Так содержание учебника
// не становится общедоступным, а загрузка на телефон занимает одно нажатие.

const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const normCode = (s) => (s || '').normalize('NFC').trim().toLowerCase().replace(/[\s_]+/g, '-');

export async function unlockBasis(code) {
  if (!globalThis.crypto || !crypto.subtle) throw new Error('Загрузка работает только по адресу приложения (https).');
  if (!normCode(code)) throw new Error('Введите кодовое слово.');
  let pack;
  try {
    const res = await fetch(new URL('../data/lehrbuch.json', import.meta.url));
    if (!res.ok) throw new Error(String(res.status));
    pack = await res.json();
  } catch {
    throw new Error('Не удалось получить файл со словами. Откройте приложение один раз с интернетом.');
  }
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(normCode(code)), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: b64(pack.salt), iterations: pack.iter, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
  );
  try {
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(pack.iv) }, key, b64(pack.data)));
  } catch {
    throw new Error('Неверное кодовое слово.');
  }
}
