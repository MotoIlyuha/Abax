import type { PlanTier } from './types';
import { isPlanTier } from './limits';

// Тариф пользователя и включение лимитов. Аккаунтов пока нет: тариф хранится на устройстве.
// В релизе лимиты выключены (текущие пользователи не должны упереться в них без оплаты);
// их включают тесты и переключатель в «Экспериментальных».

export const PLAN_KEY = 'doska.plan';
export const ENFORCE_LIMITS_KEY = 'doska.enforceLimits';

export function userPlan(): PlanTier {
  try {
    const v = localStorage.getItem(PLAN_KEY);
    return isPlanTier(v) ? v : 'free';
  } catch { return 'free'; }
}

export function setUserPlan(plan: PlanTier): void {
  try { localStorage.setItem(PLAN_KEY, plan); } catch { /* хранилище недоступно */ }
}

/** Лимиты тарифа действуют (иначе доска ведёт себя как раньше — без ограничений). */
export function limitsEnforced(): boolean {
  try { return localStorage.getItem(ENFORCE_LIMITS_KEY) === '1'; } catch { return false; }
}

export function setLimitsEnforced(on: boolean): void {
  try {
    if (on) localStorage.setItem(ENFORCE_LIMITS_KEY, '1');
    else localStorage.removeItem(ENFORCE_LIMITS_KEY);
  } catch { /* хранилище недоступно */ }
}
