import { PLAN_TITLES } from '../../src/billing';
import { isPlanTier } from '../../src/limits';
import {
  AUDIT_OPERATIONS, type AdminAlias, type AdminAudit, type AdminPage, type AdminPayment, type AdminPromo, type AdminSummary, type AdminUser,
} from '../../shared/admin';
import { api, errorText, RequestError } from './api';
import { alertBox, badge, button, el, field, input, link, pair, select, table } from './dom';

export const SECTIONS = {
  overview: 'Обзор', users: 'Пользователи', promos: 'Промокоды', payments: 'Платежи', aliases: 'Публичные адреса', audit: 'Журнал действий',
} as const;
export type Section = keyof typeof SECTIONS;

const dateFormat = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });
const rubles = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 2, minimumFractionDigits: 0 });
const number = new Intl.NumberFormat('ru-RU');
const date = (value: number | null): string => value === null || !Number.isFinite(new Date(value).getTime()) ? 'Нет данных' : dateFormat.format(value);
const plan = (value: string): string => isPlanTier(value) ? PLAN_TITLES[value] : value;
const userHref = (id: string): string => '#users/' + encodeURIComponent(id);

function planLabel(user: AdminUser): HTMLElement {
  return badge(plan(user.plan) + (user.trial ? ' (пробный)' : ''), user.plan === 'free' ? 'neutral' : 'active');
}

function planTerm(user: AdminUser): string {
  if (user.expired) return 'Истёк ' + date(user.expiresAt);
  if (user.expiresAt !== null) return 'До ' + date(user.expiresAt);
  return user.plan === 'free' ? 'Без срока' : 'Бессрочно';
}

const dialog = document.querySelector<HTMLDialogElement>('#action-dialog')!;
type Action = (data: FormData) => Promise<unknown>;
type ActionDone = (saved: boolean) => void;

export function closeAction(): void { if (dialog.open) dialog.close(); }

function confirmAction(title: string, context: string, confirmLabel: string, controls: HTMLElement[], action: Action, done: ActionDone): void {
  const heading = el('h2', { text: title });
  heading.id = 'dialog-title';
  const error = alertBox();
  const reason = el('textarea');
  Object.assign(reason, { name: 'reason', rows: 3, required: true, maxLength: 500 });
  const cancel = button('Отмена', () => dialog.close());
  const submit = button(confirmLabel, undefined, 'primary');
  const form = el('form', { className: 'form' }, heading, el('p', { className: 'muted', text: context }), ...controls,
    field('Причина', reason), el('small', { text: 'Причина попадёт в журнал. Не вводите секреты и личные данные.' }), error,
    el('div', { className: 'actions' }, cancel, submit));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const data = new FormData(form);
    if (!String(data.get('reason') ?? '').trim()) {
      error.textContent = 'Укажите причину.';
      error.hidden = false;
      reason.focus();
      return;
    }
    const controls = Array.from(form.elements) as (HTMLInputElement | HTMLButtonElement)[];
    const enabled = controls.filter(control => !control.disabled);
    enabled.forEach(control => { control.disabled = true; });
    dialog.setAttribute('aria-busy', 'true');
    error.hidden = true;
    try {
      await action(data);
      closeAction();
      done(true);
    } catch (failure) {
      if (failure instanceof RequestError && (failure.status === 401 || failure.code === 'admin-forbidden')) {
        closeAction();
        done(false);
        return;
      }
      error.textContent = errorText(failure);
      error.hidden = false;
      error.tabIndex = -1;
      error.focus();
    } finally {
      dialog.removeAttribute('aria-busy');
      enabled.forEach(control => { control.disabled = false; });
    }
  });
  dialog.oncancel = event => { if (dialog.hasAttribute('aria-busy')) event.preventDefault(); };
  dialog.replaceChildren(form);
  dialog.showModal();
}

function submitData(data: FormData) {
  return { confirmed: true, reason: String(data.get('reason') ?? '') };
}

const optionalNumber = (data: FormData, key: string): number | null => data.get(key) ? Number(data.get(key)) : null;

export function openPromo(done: ActionDone): void {
  const code = input('code', 'text', { required: true, maxLength: 64, autocomplete: 'off', spellcheck: false });
  confirmAction('Создать промокод', 'Код может состоять из латинских букв, цифр и дефиса.', 'Создать', [
    field('Код', code),
    el('div', { className: 'fields' },
      field('Тариф', select('plan', { pro: 'Pro', tutor: 'Tutor' }, 'pro')),
      field('Дней тарифа', input('days', 'number', { min: '1', required: true })),
      field('Лимит активаций', input('maxUses', 'number', { min: '1', placeholder: 'Без лимита' })),
      field('Дней действия кода', input('validDays', 'number', { min: '0', step: 'any', placeholder: 'Без срока' }))),
  ], data => api('admin/promos', { method: 'POST', body: {
    ...submitData(data), code: data.get('code'), plan: data.get('plan'), days: Number(data.get('days')),
    maxUses: optionalNumber(data, 'maxUses'), validDays: optionalNumber(data, 'validDays'),
  } }), done);
}

function openPlan(user: AdminUser, done: ActionDone): void {
  const duration = select('duration', { '': 'Выберите срок', permanent: 'Бессрочно', fixed: 'На срок' });
  duration.required = true;
  const days = input('days', 'number', { min: '0', step: 'any', required: true, disabled: true });
  const daysField = field('Дней с момента назначения', days);
  daysField.hidden = true;
  duration.addEventListener('change', () => {
    daysField.hidden = days.disabled = duration.value !== 'fixed';
  });
  confirmAction('Назначить тариф', user.displayName + '. Назначение заменит текущий тариф и его срок.', 'Назначить', [
    field('Тариф', select('plan', PLAN_TITLES, user.plan)), field('Срок', duration), daysField,
  ], data => api('admin/users/' + encodeURIComponent(user.id) + '/plan', { method: 'PATCH', body: {
    ...submitData(data), plan: data.get('plan'), days: optionalNumber(data, 'days'),
  } }), done);
}

export async function overview(signal: AbortSignal): Promise<HTMLElement> {
  const data = await api<AdminSummary>('admin/summary', { signal });
  const stats = [
    ['Пользователи', data.users, '#users'],
    ['Активные промокоды', data.promos, '#promos'],
    ['Незавершённые оплаты', data.pendingPayments, '#payments'],
    ['Заблокированные адреса', data.blockedAliases, '#aliases'],
  ] as const;
  const ledger = el('div', { className: 'ledger' });
  for (const [label, value, href] of stats) {
    const tile = link(label, href, 'stat');
    tile.append(el('strong', { text: number.format(value) }));
    ledger.append(tile);
  }
  return el('div', { className: 'overview' }, ledger, el('section', { className: 'journal-link' },
    el('h2', {}, link('Журнал действий', '#audit')), el('p', { className: 'muted', text: 'Ручные назначения тарифов, промокоды и модерация адресов.' })));
}

export async function userDetail(id: string, signal: AbortSignal, done: ActionDone): Promise<HTMLElement> {
  const user = await api<AdminUser>('admin/users/' + encodeURIComponent(id), { signal });
  const entries = [
    ['Идентификатор', user.id],
    ['Имя', user.displayName],
    ['Почта для входа', user.email ?? 'Нет'],
    ['Google', user.googleEmail ?? (user.google ? 'Подключён' : 'Нет')],
    ['Telegram', [user.telegramUsername ? '@' + user.telegramUsername : null, user.telegramId].filter(Boolean).join(' / ') || 'Нет'],
    ['Дата регистрации', date(user.createdAt)],
    ['Текущий тариф', planLabel(user)],
    ['Срок тарифа', planTerm(user)],
  ] as const;
  const details = el('dl', { className: 'details' }, ...entries.map(([key, value]) => el('div', {}, el('dt', { text: key }), el('dd', {}, value))));
  return el('section', { className: 'detail' }, el('h2', { text: user.displayName }),
    ...(user.expired ? [el('p', { className: 'muted', text: 'Ранее назначенный тариф: ' + plan(user.storedPlan) + '.' })] : []),
    details, button('Назначить тариф', () => openPlan(user, done), 'primary'));
}

function users(items: AdminUser[], query: URLSearchParams): HTMLElement {
  const suffix = query.size ? '?' + String(query) : '';
  return table(SECTIONS.users, ['Имя и идентификатор', 'Данные входа', 'Тариф', 'Срок'], items.map(user => [
    pair(link(user.displayName, userHref(user.id) + suffix), user.id),
    pair(user.email ?? user.googleEmail ?? (user.google ? 'Google' : user.telegramId ? 'Telegram' : 'Гостевой вход'),
      user.telegramUsername ? '@' + user.telegramUsername : user.telegramId),
    planLabel(user), user.expired ? pair(planTerm(user), plan(user.storedPlan)) : planTerm(user),
  ]));
}

function promos(items: AdminPromo[], done: ActionDone): HTMLElement {
  const labels = { active: 'Активен', disabled: 'Отключён', expired: 'Истёк', exhausted: 'Лимит исчерпан', invalid: 'Некорректен' };
  return table(SECTIONS.promos, ['Код', 'Статус', 'Выдаёт', 'Действует до', 'Активации', 'Действие'], items.map(promo => {
    const disable = () => confirmAction('Отключить промокод', promo.code + '. Уже выданные тарифы сохранятся.', 'Отключить', [],
      data => api('admin/promos/disable', { method: 'PATCH', body: { ...submitData(data), code: promo.code } }), done);
    const action = button('Отключить', disable);
    action.setAttribute('aria-label', 'Отключить промокод ' + promo.code);
    return [
      pair(el('strong', { text: promo.code }), promo.reference),
      badge(labels[promo.status], promo.status === 'active' ? 'active' : 'neutral'),
      pair(plan(promo.plan), promo.days + ' дн.'), promo.expiresAt === null ? 'Бессрочно' : date(promo.expiresAt),
      number.format(promo.uses) + ' / ' + (promo.maxUses === null ? 'без лимита' : number.format(promo.maxUses)),
      promo.disabledAt === null ? action : pair('Отключён', date(promo.disabledAt)),
    ];
  }));
}

function paymentStatus(payment: AdminPayment): HTMLElement {
  if (payment.status === 'paid' && payment.provider === 'yookassa') return badge('Оплата подтверждена', 'active');
  if (payment.status === 'paid' && payment.provider === 'dev') return badge('Тестовая оплата');
  if (payment.status === 'paid') return badge('Оплачен (архив)');
  if (payment.status === 'pending') return badge('Ожидает подтверждения', 'warning');
  if (payment.status === 'canceled') return badge('Отменён');
  if (payment.status === 'trial') return badge('Пробный период');
  return badge('Неизвестный статус');
}

function payments(items: AdminPayment[]): HTMLElement {
  return table(SECTIONS.payments, ['Платёж', 'Пользователь', 'Сумма', 'Статус', 'Создан', 'Решение зафиксировано'], items.map(payment => [
    pair(payment.provider === 'yookassa' ? 'ЮKassa' : payment.provider === 'dev' ? 'Тестовый' : payment.provider === 'trial' ? 'Пробный' : payment.provider,
      [payment.id, payment.providerId].filter(Boolean).join(' / ')),
    pair(link(payment.userName, userHref(payment.userId)), payment.email ?? payment.userId),
    pair(rubles.format(payment.amount), plan(payment.plan)), paymentStatus(payment), date(payment.createdAt), date(payment.resolvedAt),
  ]));
}

function aliases(items: AdminAlias[], done: ActionDone): HTMLElement {
  const labels: Record<string, string> = { active: 'Активный', former: 'Бывший', released: 'Освобождён' };
  return table(SECTIONS.aliases, ['Адрес', 'Состояние', 'Владелец', 'ID доски', 'Действие'], items.map(row => {
    const blocked = row.blockedAt !== null;
    const actionText = blocked ? 'Разблокировать' : 'Заблокировать';
    const state = labels[row.state] ?? row.state;
    const action = button(actionText, () => confirmAction(actionText + ' адрес',
      row.alias + (blocked ? '. Вернётся прежнее состояние адреса.' : '. Вход по этому адресу будет закрыт.'), actionText, [],
      data => api('admin/aliases/' + encodeURIComponent(row.alias), { method: 'PATCH', body: { ...submitData(data), blocked: !blocked } }), done));
    action.setAttribute('aria-label', actionText + ' адрес ' + row.alias);
    return [
      el('strong', { text: row.alias }),
      blocked ? pair(badge('Заблокирован', 'warning'), [state, row.blockedReason].filter(Boolean).join(' / ')) : badge(state),
      pair(row.ownerId && row.ownerName ? link(row.ownerName, userHref(row.ownerId)) : row.ownerId ?? 'Нет',
        row.ownerEmail ?? (row.ownerName ? row.ownerId : null)),
      row.projectId ?? 'Нет', action,
    ];
  }));
}

function changeSummary(row: AdminAudit): string {
  const c = row.change;
  const state = (value: unknown) => {
    const data = value as { plan?: string; expiresAt?: number | null; trial?: boolean } | null;
    if (!data || typeof data.plan !== 'string') return 'Нет данных';
    return plan(data.plan) + (typeof data.expiresAt === 'number' ? ' до ' + date(data.expiresAt) : ' без срока') + (data.trial ? ' (пробный)' : '');
  };
  switch (row.operation) {
    case 'plan.set': return state(c.before) + ' → ' + state(c.after);
    case 'promo.create': return plan(String(c.plan)) + ' на ' + String(c.days) + ' дн., лимит ' + (c.maxUses ?? 'не задан')
      + (typeof c.expiresAt === 'number' ? ', код до ' + date(c.expiresAt) : ', код без срока');
    case 'promo.disable': return 'Активаций на момент отключения: ' + String(c.uses);
    case 'alias.block': return 'Заблокирован ' + date(typeof c.after === 'number' ? c.after : null);
    case 'alias.unblock': return 'Снята блокировка от ' + date(typeof c.before === 'number' ? c.before : null);
  }
}

function audit(items: AdminAudit[]): HTMLElement {
  return table(SECTIONS.audit, ['Время', 'Администратор', 'Операция', 'Объект', 'Причина', 'Изменение'], items.map(row => [
    date(row.createdAt), pair(row.adminName ?? row.adminId, row.adminName ? row.adminId : null),
    AUDIT_OPERATIONS[row.operation], row.objectId, row.reason, changeSummary(row),
  ]));
}

export async function list(section: Exclude<Section, 'overview'>, query: URLSearchParams, signal: AbortSignal, done: ActionDone) {
  const path = 'admin/' + section + '?' + query.toString();
  async function render<T>(view: (items: T[]) => HTMLElement) {
    const { items, page, hasMore } = await api<AdminPage<T>>(path, { signal });
    return {
      content: items.length ? view(items) : el('p', { className: 'empty', text: query.get('q') || query.get('operation') ? 'По заданным условиям ничего не найдено.' : 'Записей пока нет.' }),
      page, hasMore,
    };
  }
  switch (section) {
    case 'users': return render<AdminUser>(items => users(items, query));
    case 'promos': return render<AdminPromo>(items => promos(items, done));
    case 'payments': return render(payments);
    case 'aliases': return render<AdminAlias>(items => aliases(items, done));
    case 'audit': return render(audit);
  }
}
