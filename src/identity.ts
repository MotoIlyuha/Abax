// Постоянный идентификатор этого клиента (реакции и комментарии подписываются им).

const KEY = 'doska.clientId';
let cached: string | null = null;

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Идентификатор на этом устройстве. Тестовое окно гостя в приложении делит хранилище с автором, поэтому у него
 * (имя в адресе, ?name=…) к идентификатору добавляется имя — иначе реакции гостя и автора слились бы в одну.
 */
export function clientId(): string {
  if (cached) return cached;
  let base = '';
  try { base = localStorage.getItem(KEY) ?? ''; } catch { /* хранилище недоступно */ }
  if (!base) {
    base = newId();
    try { localStorage.setItem(KEY, base); } catch { /* будет новый при каждом запуске */ }
  }
  let suffix = '';
  try {
    const name = new URLSearchParams(location.search).get('name');
    if (name) suffix = `:${Array.from(name).slice(0, 20).join('')}`;
  } catch { /* нет адреса */ }
  cached = base + suffix;
  return cached;
}

/** Для тестов: забыть запомненное значение. */
export function resetClientId(): void {
  cached = null;
}
