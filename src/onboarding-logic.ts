// Чистая логика окна первого входа: поле имени и выбор курсора (без DOM — проверяется юнит-тестами).

import { DEFAULT_CURSOR_ID, cursorPreset } from './cursors';
import { normalizeName } from './room-host';

/** Сколько символов можно ввести в поле имени (и имена-подсказки не длиннее). */
export const NAME_LIMIT = 32;
/** С какого остатка счётчик становится оранжевым. */
export const NAME_NEAR = 5;

/** Делит текст по лимиту в символах (эмодзи и прочие суррогатные пары не рвутся): что остаётся и что не влезло. */
export function splitAtLimit(value: string, limit: number): { kept: string; extra: string } {
  const chars = Array.from(value);
  if (chars.length <= limit) return { kept: value, extra: '' };
  return { kept: chars.slice(0, limit).join(''), extra: chars.slice(limit).join('') };
}

/** Состояние счётчика по остатку: обычное, близко к лимиту, лимит. */
export function limitState(left: number, near: number): 'ok' | 'near' | 'full' {
  return left <= 0 ? 'full' : left <= near ? 'near' : 'ok';
}

/**
 * Tab в поле имени: поле пустое и нажат Tab без Shift — вернуть подсказку (её подставят в поле,
 * каретку — в конец, переход фокуса отменяется); иначе null — штатная навигация.
 */
export function tabFill(value: string, placeholder: string, shift: boolean): string | null {
  if (shift || value.trim() !== '') return null;
  const p = normalizeName(placeholder);
  return p || null;
}

/** Имя при «Продолжить»: введённое (нормализованное), пустое — подсказка. */
export function resolveName(value: string, placeholder: string): string {
  return normalizeName(value) || normalizeName(placeholder);
}

/** Состояние выбора курсора: что показывает превью и что сохранится по «Продолжить». */
export interface CursorChoice {
  /** Курсор в превью (может быть Pro без права — «примерка»). */
  preview: string;
  /** Последний курсор, который можно закрепить. */
  saved: string;
}

export function initialChoice(current: string, entitled: boolean): CursorChoice {
  const ok = cursorPreset(current).tier === 'free' || entitled;
  const id = cursorPreset(current).id;
  return { preview: id, saved: ok ? id : DEFAULT_CURSOR_ID };
}

/** Клик по курсору в сетке. */
export function pickCursor(choice: CursorChoice, id: string, entitled: boolean): CursorChoice {
  const p = cursorPreset(id);
  if (p.tier === 'free' || entitled) return { preview: p.id, saved: p.id };
  return { preview: p.id, saved: choice.saved };
}

/** Превью показывает Pro-курсор, который нельзя закрепить (нужна плашка «Доступно в подписке Pro»). */
export function previewLocked(choice: CursorChoice): boolean {
  return choice.preview !== choice.saved;
}

/** «Вернуться к бесплатному курсору». */
export function revertChoice(choice: CursorChoice): CursorChoice {
  return { preview: choice.saved, saved: choice.saved };
}
