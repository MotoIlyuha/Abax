const MESSAGES: Record<string, string> = {
  unauthorized: 'Сессия истекла. Войдите снова.',
  'admin-disabled': 'Доступ к панели закрыт. Администраторы ещё не настроены.',
  'admin-forbidden': 'У этой учётной записи нет доступа к панели.',
  'admin-origin': 'Запрос отклонён. Откройте панель по её основному адресу.',
  'bad-email': 'Проверьте адрес почты.',
  'email-disabled': 'Вход по почте пока не настроен.',
  'mail-failed': 'Не удалось отправить письмо. Повторите попытку.',
  'bad-code': 'Код не подошёл. Сверьте его с письмом.',
  'code-expired': 'Код истёк. Запросите новый.',
  'too-many-attempts': 'Попытки закончились. Запросите новый код.',
  'rate-limited': 'Слишком много запросов. Попробуйте позже.',
  'bad-plan': 'Проверьте тариф и срок.',
  'bad-promo': 'Проверьте код, срок и лимит активаций.',
  'promo-exists': 'Промокод с таким кодом уже существует.',
  'bad-reason': 'Укажите причину длиной до 500 символов.',
  'confirmation-required': 'Подтвердите действие.',
  'no-change': 'Состояние уже изменилось. Обновите список.',
  'not-found': 'Запись не найдена.',
  'bad-search': 'Поисковый запрос слишком длинный.',
  'bad-page': 'Неверный номер страницы.',
  'bad-operation': 'Неизвестный вид операции.',
};

export class RequestError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(MESSAGES[code] ?? 'Не удалось выполнить запрос. Повторите попытку.');
  }
}

export function errorText(error: unknown): string {
  return error instanceof RequestError ? error.message : 'Не удалось связаться с сервером. Повторите попытку.';
}

export async function api<T>(path: string, options?: { method?: string; body?: object; signal?: AbortSignal }): Promise<T> {
  const response = await fetch('/api/' + path, {
    credentials: 'same-origin',
    method: options?.method ?? 'GET',
    signal: options?.signal,
    ...(options?.body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options.body) } : {}),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { error?: string } | null;
    throw new RequestError(response.status, data?.error ?? '');
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}
