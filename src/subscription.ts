// Подписка на клиенте: сведения с сервера (GET /api/billing), покупка, пробный период и промокоды.
// Без облака ничего не запрашивает. Ответ сервера после изменения содержит /api/me — он применяется через
// setAccount (тариф меняется, подписчики onPlanChange узнают об этом: бейджи, тариф в шапке).

import { ApiError, getApi, type MeResponse } from './api-client';
import type { BillingInfo, BillingPeriod, PaidPlan, PromoEffect } from './billing';
import { account, setAccount, signedIn } from './profile-sync';
import { userPlan } from './plan';

let billing: BillingInfo | null = null;
let revision = 0;
const listeners = new Set<(b: BillingInfo | null) => void>();

/** Последние сведения о подписке (null — облака нет или ещё не спрашивали). */
export function billingState(): BillingInfo | null {
  return billing;
}

/** Общая проверка для карточки Tutor и предложения у кнопки «Задания». */
export function tutorTrialOffered(): boolean {
  // Не показываем пробный период, пока тариф уже действует или сервер сообщил, что попытка использована.
  return userPlan() === 'free' && (billing?.trialAvailable ?? !signedIn());
}

export function onBillingChange(fn: (b: BillingInfo | null) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function setBilling(b: BillingInfo | null): void {
  revision++;
  billing = b;
  for (const fn of [...listeners]) {
    try { fn(b); } catch (e) { console.error(e); }
  }
}

/** Спросить сервер; без облака и без сети — null (прежние сведения остаются). */
export async function refreshBilling(): Promise<BillingInfo | null> {
  const api = getApi();
  if (!api) return null;
  const userId = account()?.user.id;
  const startedAt = revision;
  try {
    const b = await api.request<BillingInfo>('GET', '/api/billing');
    if (getApi() !== api || account()?.user.id !== userId || revision !== startedAt) return null;
    if (signedIn() && (account()?.plan !== b.plan || account()?.planExpiresAt !== b.planExpiresAt)) {
      const me = await api.me();
      if (getApi() !== api || account()?.user.id !== userId || revision !== startedAt) return null;
      setAccount(me);
    }
    setBilling(b);
    return b;
  } catch { return null; }
}

/** Для тестов. */
export function resetBillingForTests(): void {
  revision++;
  billing = null;
  listeners.clear();
}

export type BillingResult = { ok: true; effect?: PromoEffect; confirmationUrl?: string } | { ok: false; error: string };

/** Почему действие недоступно ещё до запроса: нет облака или нет входа. */
export function billingBlocker(): 'no-cloud' | 'login-required' | null {
  if (!getApi()) return 'no-cloud';
  if (!signedIn()) return 'login-required';
  return null;
}

async function post(path: string, body: unknown): Promise<BillingResult> {
  const blocker = billingBlocker();
  if (blocker) return { ok: false, error: blocker };
  try {
    const r = await getApi()!.request<{ billing: BillingInfo; me: MeResponse; effect?: PromoEffect; confirmationUrl?: string }>('POST', path, body);
    setAccount(r.me);
    setBilling(r.billing);
    return { ok: true, ...(r.effect ? { effect: r.effect } : {}), ...(r.confirmationUrl ? { confirmationUrl: r.confirmationUrl } : {}) };
  } catch (e) {
    return { ok: false, error: e instanceof ApiError ? (e.isNetwork ? 'network' : e.code) : 'network' };
  }
}

export const checkout = (plan: PaidPlan, period: BillingPeriod): Promise<BillingResult> => post('/api/billing/checkout', { plan, period });
export const startTrial = (): Promise<BillingResult> => post('/api/billing/trial', {});
export const redeemPromo = (code: string): Promise<BillingResult> => post('/api/billing/promo', { code });

// Внешняя оплата открывается в браузере; возвращение в окно проверяет подписку заново.
window.addEventListener('focus', () => {
  if (billing?.payments.some(p => p.status === 'pending')) void refreshBilling();
});

/** Текст ошибки для пользователя. */
export function billingErrorText(code: string): string {
  switch (code) {
    case 'no-cloud': return 'Подписка оформляется через облачный сервер, а он не подключён в этой сборке';
    case 'login-required': return 'Войдите в аккаунт, чтобы оформить подписку или ввести промокод';
    case 'payments-disabled': return 'Оплата пока недоступна: подключаем платёжную систему. Подписку можно получить по промокоду';
    case 'payment-provider-unavailable': return 'Платёжная система временно недоступна. Попробуйте ещё раз';
    case 'payment-mismatch': return 'Не удалось подтвердить платёж. Обратитесь в поддержку';
    case 'payment-review-required': return 'Статус предыдущего платежа уточняется. Обратитесь в поддержку';
    case 'payment-canceled': return 'Платёж отменён. Вы можете начать оплату заново';
    case 'trial-used': return 'Пробный период уже был на этом аккаунте';
    case 'plan-active': return 'Пробный период можно взять, только пока у вас бесплатный тариф';
    case 'bad-promo': return 'Промокод - это латинские буквы, цифры и дефис, от 3 до 32 символов';
    case 'promo-not-found': return 'Такого промокода нет или он больше не действует';
    case 'promo-used': return 'Этот промокод уже введён на вашем аккаунте';
    case 'rate-limited': return 'Слишком много попыток. Попробуйте через час';
    case 'network': return 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз';
    default: return 'Не получилось. Попробуйте ещё раз';
  }
}
