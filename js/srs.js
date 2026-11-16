// Интервальное повторение по мотивам SM-2.
// Оценки: 0 — не помню, 1 — с трудом, 2 — помню, 3 — легко.

export const GRADES = ['Не помню', 'С трудом', 'Помню', 'Легко'];
export const LEARNED_DAYS = 21; // слово считается выученным при интервале от 21 дня

export function newSrs(day) {
  return { due: day, interval: 0, ease: 2.5, reps: 0, lapses: 0, last: null };
}

function addDaysLocal(str, n) {
  const [y, m, d] = str.split('-').map(Number);
  const x = new Date(y, m - 1, d + n);
  const p = (v) => String(v).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
}

export function schedule(s, grade, today) {
  let { interval, ease, reps, lapses } = s;
  const first = reps === 0 || interval < 1;
  if (grade === 0) {
    reps = 0;
    lapses += 1;
    interval = 0; // вернётся в этой же сессии и останется на сегодня
    ease = Math.max(1.3, ease - 0.2);
  } else if (grade === 1) {
    interval = first ? 1 : Math.max(interval + 1, Math.round(interval * 1.2));
    ease = Math.max(1.3, ease - 0.15);
    reps += 1;
  } else if (grade === 2) {
    interval = first ? 1 : Math.max(interval + 1, Math.round(interval * ease));
    reps += 1;
  } else {
    interval = first ? 4 : Math.max(interval + 2, Math.round(interval * ease * 1.3));
    ease = Math.min(3.0, ease + 0.15);
    reps += 1;
  }
  return { due: addDaysLocal(today, interval), interval, ease, reps, lapses, last: s.last, first: s.first || null };
}

export const isNew = (s) => s.reps === 0 && s.lapses === 0;
export const isLearned = (s) => s.interval >= LEARNED_DAYS;

export function fmtInterval(n) {
  if (n <= 0) return 'ещё раз';
  if (n < 30) return `${n} дн.`;
  if (n < 365) return `≈ ${Math.round(n / 30)} мес.`;
  return `≈ ${(n / 365).toFixed(1)} г.`;
}
