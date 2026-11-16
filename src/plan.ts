import type { PlanTier } from './types';
import { isPlanTier } from './limits';

// Тариф пользователя и включение лимитов. Источник истины — сервер (GET /api/me): его ответ
// запоминается здесь (applyServerPlan). Локальный переопределитель тарифа (doska.plan) работает
// только в режиме разработки; без сервера пользователь — на тарифе free.
// Лимиты по умолчанию выключены (текущие пользователи не должны упереться в них без оплаты);
// их включают тесты, переключатель в «Экспериментальных» или сервер (ABAX_ENFORCE_LIMITS).

export const PLAN_KEY = 'doska.plan';
export const ENFORCE_LIMITS_KEY = 'doska.enforceLimits';
export const DEV_MODE_KEY = 'doska.devMode';
export const SERVER_PLAN_KEY = 'doska.serverPlan';

/** Режим разработки: сборка dev-сервера Vite или явный флаг doska.devMode = 1. */
export function devModeEnabled(): boolean {
  try {
    if (import.meta.env.DEV) return true;
  } catch { /* нет import.meta.env */ }
  try { return localStorage.getItem(DEV_MODE_KEY) === '1'; } catch { return false; }
}

/** Что сервер сообщил о пользователе. */
export interface ServerPlanInfo { plan: PlanTier; limitsEnforced: boolean }

let memoryServerInfo: ServerPlanInfo | null = null;

/** Запомнить тариф и признак действующих лимитов, полученные с сервера. */
export function applyServerPlan(info: ServerPlanInfo): void {
  const clean: ServerPlanInfo = { plan: isPlanTier(info.plan) ? info.plan : 'free', limitsEnforced: info.limitsEnforced === true };
  memoryServerInfo = clean;
  try { localStorage.setItem(SERVER_PLAN_KEY, JSON.stringify(clean)); } catch { /* хранилище недоступно: останется в памяти */ }
}

/** Забыть серверный тариф (выход из аккаунта). */
export function clearServerPlan(): void {
  memoryServerInfo = null;
  try { localStorage.removeItem(SERVER_PLAN_KEY); } catch { /* хранилище недоступно */ }
}

function serverInfo(): ServerPlanInfo | null {
  try {
    const raw = localStorage.getItem(SERVER_PLAN_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<ServerPlanInfo>;
    return isPlanTier(v.plan) ? { plan: v.plan, limitsEnforced: v.limitsEnforced === true } : null;
  } catch {
    // хранилище недоступно или испорчено — только то, что запомнено в этой сессии
    return memoryServerInfo;
  }
}

/**
 * Тариф пользователя: переопределение разработчика (только в dev-режиме), затем тариф с сервера, затем free.
 */
export function userPlan(): PlanTier {
  if (devModeEnabled()) {
    try {
      const v = localStorage.getItem(PLAN_KEY);
      if (isPlanTier(v)) return v;
    } catch { /* хранилище недоступно */ }
  }
  return serverInfo()?.plan ?? 'free';
}

/** Переопределить тариф на этом устройстве (действует только в dev-режиме). */
export function setUserPlan(plan: PlanTier): void {
  try { localStorage.setItem(PLAN_KEY, plan); } catch { /* хранилище недоступно */ }
}

/** Лимиты тарифа действуют (иначе доска ведёт себя как раньше — без ограничений). */
export function limitsEnforced(): boolean {
  try {
    if (localStorage.getItem(ENFORCE_LIMITS_KEY) === '1') return true;
  } catch { /* хранилище недоступно */ }
  return serverInfo()?.limitsEnforced === true;
}

export function setLimitsEnforced(on: boolean): void {
  try {
    if (on) localStorage.setItem(ENFORCE_LIMITS_KEY, '1');
    else localStorage.removeItem(ENFORCE_LIMITS_KEY);
  } catch { /* хранилище недоступно */ }
}
