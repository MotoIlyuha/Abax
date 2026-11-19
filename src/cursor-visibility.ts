// Какие чужие курсоры показывать (меню аватаров: «Скрыть курсоры других», «Скрыть курсор»). Только у этого
// клиента и только на время сессии: другим участникам ничего не отправляется. Чистый модуль без DOM.

let allHidden = false;
const hidden = new Set<number>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) fn();
}

/** Курсор участника uid показывается на холсте и у края экрана. */
export function cursorShown(uid: number): boolean {
  return !allHidden && !hidden.has(uid);
}

/** Скрыты курсоры всех других участников. */
export function othersCursorsHidden(): boolean {
  return allHidden;
}

export function setOthersCursorsHidden(on: boolean): void {
  if (allHidden === on) return;
  allHidden = on;
  notify();
}

/** Курсор участника uid скрыт по отдельности (не считая «скрыть всех»). */
export function userCursorHidden(uid: number): boolean {
  return hidden.has(uid);
}

export function setUserCursorHidden(uid: number, on: boolean): void {
  if (hidden.has(uid) === on) return;
  if (on) hidden.add(uid);
  else hidden.delete(uid);
  notify();
}

/** Подписка на изменения; возвращает отписку. */
export function onCursorVisibility(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Комната закрылась: номера участников в новой комнате другие — скрытые по отдельности снова видны. «Скрыть всех» остаётся. */
export function resetCursorVisibility(): void {
  if (hidden.size === 0) return;
  hidden.clear();
  notify();
}
