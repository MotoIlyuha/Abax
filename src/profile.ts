// Профиль пользователя на этом устройстве: имя, выбранный курсор и признак пройденного знакомства.
// Источник для подписи в совместной работе, курсора над холстом и цвета выделения.
// Без DOM (только localStorage), поэтому его можно проверять юнит-тестами.

import { DEFAULT_CURSOR_ID, cursorPreset, isCursorId } from './cursors';
import { devModeEnabled, userPlan } from './plan';
import { normalizeName } from './room-host';

export const PROFILE_KEY = 'doska.profile';

export interface Profile {
  /** Имя (пустое — не задано: подставляются «Автор» / «Гость NN»). */
  name: string;
  /** Выбранный курсор (может быть Pro и без права — тогда действует классический). */
  cursorId: string;
  /** Окно первого входа пройдено. */
  onboarded: boolean;
  updatedAt: number;
}

const DEFAULT_PROFILE: Profile = { name: '', cursorId: DEFAULT_CURSOR_ID, onboarded: false, updatedAt: 0 };

let memory: Profile | null = null;
const listeners = new Set<(p: Profile) => void>();

function clean(raw: unknown): Profile {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_PROFILE };
  const r = raw as Record<string, unknown>;
  return {
    name: normalizeName(r.name),
    cursorId: isCursorId(r.cursorId) ? r.cursorId : DEFAULT_CURSOR_ID,
    onboarded: r.onboarded === true,
    updatedAt: typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt) ? r.updatedAt : 0,
  };
}

/** Текущий профиль (копия). */
export function getProfile(): Profile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (raw !== null) return clean(JSON.parse(raw));
  } catch { /* хранилище недоступно или запись испорчена */ }
  return memory ? { ...memory } : { ...DEFAULT_PROFILE };
}

/** Изменить профиль: имя нормализуется, неизвестный курсор игнорируется. */
export function setProfile(patch: Partial<Omit<Profile, 'updatedAt'>>): Profile {
  const cur = getProfile();
  const next: Profile = {
    name: patch.name !== undefined ? normalizeName(patch.name) : cur.name,
    cursorId: patch.cursorId !== undefined && isCursorId(patch.cursorId) ? patch.cursorId : cur.cursorId,
    onboarded: patch.onboarded ?? cur.onboarded,
    updatedAt: Date.now(),
  };
  memory = next;
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(next)); } catch { /* останется в памяти */ }
  for (const fn of [...listeners]) {
    try { fn({ ...next }); } catch (e) { console.error(e); }
  }
  return { ...next };
}

/** Подписка на изменения профиля; возвращает отписку. */
export function onProfileChange(fn: (p: Profile) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Оповестить подписчиков без изменения (например, сменился тариф — действующий курсор мог стать другим). */
export function notifyProfileChanged(): void {
  const p = getProfile();
  for (const fn of [...listeners]) {
    try { fn(p); } catch (e) { console.error(e); }
  }
}

export function profileName(): string {
  return getProfile().name;
}

/** Право на Pro-курсоры: тариф pro/tutor или режим разработки. */
export function cursorEntitled(): boolean {
  return userPlan() !== 'free' || devModeEnabled();
}

/** Курсор, который действует сейчас: выбранный, если на него есть право, иначе классический. */
export function myCursorId(): string {
  const id = getProfile().cursorId;
  return cursorPreset(id).tier === 'free' || cursorEntitled() ? id : DEFAULT_CURSOR_ID;
}

/** Цвет своего выделения (рамка, ручки, рамка выделения областью). */
export function mySelectionColor(): string {
  return cursorPreset(myCursorId()).selectionColor;
}

/** Для тестов: забыть профиль в памяти и подписчиков. */
export function resetProfileForTests(): void {
  memory = null;
  listeners.clear();
}
