// Названия проекта и страницы: лимит длины, сокращение для шапки, имена по умолчанию и пояснение тарифа
// в окне «Создать проект» (чистая логика без DOM — проверяется юнит-тестами).

import { PLAN_LIMITS } from './limits';
import type { PlanTier } from './types';

/** Сколько символов можно ввести в название проекта. */
export const PROJECT_NAME_MAX = 40;
/** Сколько символов можно ввести в название страницы. */
export const PAGE_NAME_MAX = 40;
/** С какого остатка счётчик поля становится оранжевым. */
export const NAME_FIELD_NEAR = 8;
/** Сколько символов названия видно в шапке; длиннее — обрезается с «...». */
export const TOPBAR_NAME_SHOWN = 18;

/** Сокращение для шапки: первые TOPBAR_NAME_SHOWN символов и «...» (эмодзи и суррогатные пары не рвутся). */
export function shortName(name: string, shown = TOPBAR_NAME_SHOWN): { text: string; cut: boolean } {
  const chars = Array.from(name);
  if (chars.length <= shown) return { text: name, cut: false };
  return { text: `${chars.slice(0, shown).join('').trimEnd()}...`, cut: true };
}

/** Введённое название: пробелы по краям убраны, длина — не больше max символов; пусто — fallback. */
export function cleanName(value: string, max: number, fallback = ''): string {
  const v = Array.from(value.trim()).slice(0, max).join('').trim();
  return v || fallback;
}

/** Имя нового проекта по умолчанию: «Проект n», где n — первый номер, которого ещё нет среди названий. */
export function defaultProjectName(names: readonly string[]): string {
  const taken = new Set(names.map(n => n.trim()));
  let n = names.length + 1;
  while (taken.has(`Проект ${n}`)) n++;
  return `Проект ${n}`;
}

/** Склонение: 1 проект, 2 проекта, 5 проектов. */
export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/**
 * Пояснение тарифа в окне «Создать проект»: на бесплатном — сколько проектов и страниц можно создать,
 * на Pro и «Репетиторе» — что ограничений нет. Лимиты выключены (enforced = false) — молчим:
 * обещать ограничение, которого нет, нельзя.
 */
export function planNote(plan: PlanTier, enforced: boolean): string | null {
  if (!enforced) return null;
  const l = PLAN_LIMITS[plan];
  if (!Number.isFinite(l.maxProjects) && !Number.isFinite(l.maxPagesPerProject)) {
    return plan === 'tutor'
      ? 'На тарифе «Репетитор» проектов и страниц сколько угодно.'
      : 'На тарифе Pro проектов и страниц сколько угодно.';
  }
  const p = l.maxProjects, s = l.maxPagesPerProject;
  return `На бесплатном тарифе можно создать только ${p} ${plural(p, 'проект', 'проекта', 'проектов')} и только ${s} ${plural(s, 'страницу', 'страницы', 'страниц')} в каждом из них.`;
}
