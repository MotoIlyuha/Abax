// Подписка: цены, сроки, пробный период и промокоды. Чистый модуль без DOM — его используют и клиент
// (окно подписки, раздел настроек «Подписка»), и сервер (server/billing.ts): цены и сроки считаются одинаково.

import type { PlanTier } from './types';

/** Платные тарифы (в порядке «старшинства»). */
export type PaidPlan = 'pro' | 'tutor';
export const PAID_PLANS: readonly PaidPlan[] = ['pro', 'tutor'];

/** Срок оплаты. */
export type BillingPeriod = 'month' | 'quarter' | 'year';
export const BILLING_PERIODS: readonly BillingPeriod[] = ['month', 'quarter', 'year'];

/** Месяцев в сроке. */
export const PERIOD_MONTHS: Record<BillingPeriod, number> = { month: 1, quarter: 3, year: 12 };

/** Дней в сроке: месяц считается за 30 дней, год — 365. */
export const PERIOD_DAYS: Record<BillingPeriod, number> = { month: 30, quarter: 90, year: 365 };

/** Цена в рублях за весь срок. */
export const PRICES: Record<PaidPlan, Record<BillingPeriod, number>> = {
  pro: { month: 399, quarter: 999, year: 3499 },
  tutor: { month: 699, quarter: 1499, year: 6999 },
};

/** Пробный период: только Tutor, один раз на аккаунт. */
export const TRIAL_PLAN: PaidPlan = 'tutor';
export const TRIAL_DAYS = 14;

export const DAY_MS = 24 * 3600_000;

/** Название тарифа в интерфейсе. */
export const PLAN_TITLES: Record<PlanTier, string> = { free: 'Бесплатный', pro: 'Pro', tutor: 'Tutor' };

/** Подпись срока: «Месяц», «3 месяца», «Год». */
export const PERIOD_TITLES: Record<BillingPeriod, string> = { month: 'Месяц', quarter: '3 месяца', year: 'Год' };

/** «за месяц», «за 3 месяца», «за год». */
export const PERIOD_FOR: Record<BillingPeriod, string> = { month: 'за месяц', quarter: 'за 3 месяца', year: 'за год' };

export function isPaidPlan(v: unknown): v is PaidPlan {
  return v === 'pro' || v === 'tutor';
}

export function isBillingPeriod(v: unknown): v is BillingPeriod {
  return v === 'month' || v === 'quarter' || v === 'year';
}

/** Старшинство тарифа: free < pro < tutor. */
export function planRank(plan: PlanTier): number {
  return plan === 'tutor' ? 2 : plan === 'pro' ? 1 : 0;
}

/** Цена в месяц при оплате за срок (округлена до рубля). */
export function monthlyPrice(plan: PaidPlan, period: BillingPeriod): number {
  return Math.round(PRICES[plan][period] / PERIOD_MONTHS[period]);
}

/** Сколько рублей экономит срок против помесячной оплаты. */
export function savingsRub(plan: PaidPlan, period: BillingPeriod): number {
  return Math.max(0, PRICES[plan].month * PERIOD_MONTHS[period] - PRICES[plan][period]);
}

/** Скидка срока в процентах (0 — помесячно). */
export function savingsPct(plan: PaidPlan, period: BillingPeriod): number {
  const full = PRICES[plan].month * PERIOD_MONTHS[period];
  return full > 0 ? Math.round((savingsRub(plan, period) / full) * 100) : 0;
}

/** «3 499 ₽»: разряды через неразрывный пробел. */
export function formatRub(n: number): string {
  return `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ₽`;
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** «14 дней», «1 день». */
export function daysText(n: number): string {
  return `${n} ${plural(n, 'день', 'дня', 'дней')}`;
}

/**
 * Новый срок тарифа после покупки, промокода или пробного периода.
 * Тот же тариф — дни прибавляются к оставшимся; тариф старше текущего — начинается сейчас;
 * младше действующего (Pro при действующем Tutor) — дни прибавляются к действующему, старший тариф не теряется.
 * expiresAt null у действующего платного тарифа — бессрочный (выдан вручную): он таким и остаётся.
 */
export function extendPlan(
  current: { plan: PlanTier; expiresAt: number | null },
  grant: { plan: PaidPlan; days: number },
  now: number,
): { plan: PaidPlan; expiresAt: number | null } {
  const active = current.plan !== 'free' && (current.expiresAt === null || current.expiresAt > now);
  const add = grant.days * DAY_MS;
  if (!active) return { plan: grant.plan, expiresAt: now + add };
  const cur = current.plan as PaidPlan;
  if (planRank(grant.plan) > planRank(cur)) return { plan: grant.plan, expiresAt: now + add };
  return { plan: cur, expiresAt: current.expiresAt === null ? null : current.expiresAt + add };
}

// ----- Промокоды -----

/** Что даёт промокод: тариф на столько-то дней. */
export interface PromoEffect { plan: PaidPlan; days: number }

export const PROMO_CODE_MAX = 32;

/** Промокод в каноническом виде: заглавные буквы, цифры и дефис; иначе null. */
export function normalizePromoCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toUpperCase().replace(/\s+/g, '');
  return /^[A-Z0-9][A-Z0-9-]{2,31}$/.test(s) && s.length <= PROMO_CODE_MAX ? s : null;
}

export function isPromoEffect(v: unknown): v is PromoEffect {
  const e = v as Partial<PromoEffect> | null;
  return !!e && typeof e === 'object' && isPaidPlan(e.plan) && Number.isInteger(e.days) && (e.days as number) >= 1 && (e.days as number) <= 3660;
}

/** «Pro на 30 дней». */
export function promoEffectText(e: PromoEffect): string {
  return `${PLAN_TITLES[e.plan]} на ${daysText(e.days)}`;
}

/**
 * Тестовые промокоды: работают только на dev-сервере (ABAX_DEV_AUTH) и только у тестового аккаунта
 * (dev-вход Telegram/Google или почта в зоне abax.test). В продакшене их нет.
 */
export const DEV_PROMO_CODES: Readonly<Record<string, PromoEffect>> = {
  'ABAX-PRO-30': { plan: 'pro', days: 30 },
  'ABAX-TUTOR-7': { plan: 'tutor', days: 7 },
};

// ----- Ответ сервера /api/billing -----

export interface PaymentInfo {
  id: string;
  plan: PaidPlan;
  /** Срок оплаты; у пробного периода — null. */
  period: BillingPeriod | null;
  days: number;
  amount: number;
  /** paid — оплачен; trial — пробный период (0 ₽). */
  status: 'paid' | 'trial';
  createdAt: number;
}

export interface PromoRedemptionInfo {
  code: string;
  effect: PromoEffect;
  redeemedAt: number;
}

export interface BillingInfo {
  plan: PlanTier;
  planExpiresAt: number | null;
  /** Действующий тариф — пробный период. */
  trial: boolean;
  /** Пробный период ещё можно взять. */
  trialAvailable: boolean;
  /** Оплата подключена (на dev-сервере — тестовая, без денег). */
  paymentsEnabled: boolean;
  payments: PaymentInfo[];
  promos: PromoRedemptionInfo[];
}

/** Сколько осталось до конца срока: дни и часы (вверх до часа). */
export function timeLeft(expiresAt: number, now: number): { days: number; hours: number } {
  const ms = Math.max(0, expiresAt - now);
  const totalHours = Math.ceil(ms / 3600_000);
  return { days: Math.floor(totalHours / 24), hours: totalHours % 24 };
}

/** «13 дней 5 часов», «5 часов», «меньше часа». */
export function timeLeftText(expiresAt: number, now: number): string {
  const { days, hours } = timeLeft(expiresAt, now);
  if (days === 0 && hours === 0) return 'меньше часа';
  const parts: string[] = [];
  if (days) parts.push(daysText(days));
  if (hours) parts.push(`${hours} ${plural(hours, 'час', 'часа', 'часов')}`);
  return parts.join(' ');
}

const pad = (n: number) => String(n).padStart(2, '0');

/** «20.12.2026 в 14:05» по местному времени. */
export function dateTimeText(t: number): string {
  const d = new Date(t);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} в ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** «20.12.2026». */
export function dateText(t: number): string {
  const d = new Date(t);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}
