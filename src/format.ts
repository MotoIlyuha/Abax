// Подписи на домашней странице: даты по-человечески и числа со словами.

/** Начало суток (по местному времени) для отметки ts. */
function dayStart(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** «сегодня», «вчера», «12 окт.»; в другие годы — с годом. now — для тестов. */
export function dayLabel(ts: number, now = Date.now()): string {
  const days = Math.round((dayStart(now) - dayStart(ts)) / 86_400_000);
  if (days === 0) return 'сегодня';
  if (days === 1) return 'вчера';
  const sameYear = new Date(ts).getFullYear() === new Date(now).getFullYear();
  return new Date(ts).toLocaleDateString('ru-RU', sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Слово под число: plural(3, ['страница', 'страницы', 'страниц']) → «страницы». */
export function plural(n: number, forms: [string, string, string]): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
  return forms[2];
}

/** «1 страница», «3 страницы», «12 страниц». */
export function pagesLabel(n: number): string {
  return `${n} ${plural(n, ['страница', 'страницы', 'страниц'])}`;
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
