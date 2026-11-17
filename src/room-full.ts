import { CLOSE_FREE_LIMIT, CLOSE_ROOM_FULL } from './collab-transport';
import type { CollabClosedDetail } from './collab';

// Окно «В комнате сейчас максимум участников» (SPEC_NIGHT5 §7): хаб отказал гостю по лимиту тарифа автора (4402)
// или по лимиту, который автор задал сам (4430). Тексты — только textContent.

export const ROOM_FULL_PLAN_TEXT = 'Это лимит бесплатного тарифа автора доски. Попробуйте зайти чуть позже, когда освободится место.';
export const ROOM_FULL_HOST_TEXT = 'Автор доски ограничил число участников. Попробуйте зайти чуть позже, когда освободится место.';

/** Это закрытие из-за того, что мест в комнате нет. */
export function isRoomFullClose(code: number): boolean {
  return code === CLOSE_FREE_LIMIT || code === CLOSE_ROOM_FULL;
}

export interface RoomFullInfo {
  /** Лимит гостей (если хаб его сообщил). */
  maxGuests?: number;
  /** Лимит бесплатного тарифа автора (иначе — лимит, заданный автором). */
  planLimited: boolean;
}

/** Что показать по закрытию соединения; null — это не «комната заполнена». */
export function roomFullInfo(detail: Pick<CollabClosedDetail, 'code' | 'denied'>): RoomFullInfo | null {
  if (!isRoomFullClose(detail.code)) return null;
  const d = detail.denied;
  const max = typeof d?.maxGuests === 'number' && Number.isFinite(d.maxGuests) && d.maxGuests > 0 ? d.maxGuests : undefined;
  return { ...(max !== undefined ? { maxGuests: max } : {}), planLimited: d?.planLimited ?? detail.code === CLOSE_FREE_LIMIT };
}

export function roomFullTitle(maxGuests?: number): string {
  return maxGuests ? `В комнате сейчас максимум участников (${maxGuests} из ${maxGuests})` : 'В комнате сейчас максимум участников';
}

export interface RoomFullOptions extends RoomFullInfo {
  /** «Попробовать снова»: подключиться заново. */
  onRetry: () => void;
  /** «Открыть только для чтения»; нет — кнопки нет (не облако или видимых страниц нет). */
  onReadOnly?: (() => void) | null;
}

export function hideRoomFullModal(): void {
  document.getElementById('room-full-modal')?.remove();
}

export function showRoomFullModal(opts: RoomFullOptions): HTMLElement {
  hideRoomFullModal();
  const wrap = document.createElement('div');
  wrap.id = 'room-full-modal';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.setAttribute('aria-labelledby', 'room-full-title');
  const card = document.createElement('div');
  card.className = 'room-full-card';
  const h = document.createElement('h2');
  h.id = 'room-full-title';
  h.textContent = roomFullTitle(opts.maxGuests);
  const p = document.createElement('p');
  p.className = 'room-full-text';
  p.textContent = opts.planLimited ? ROOM_FULL_PLAN_TEXT : ROOM_FULL_HOST_TEXT;
  const actions = document.createElement('div');
  actions.className = 'room-full-actions';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'room-full-retry primary';
  retry.textContent = 'Попробовать снова';
  retry.addEventListener('click', () => { hideRoomFullModal(); opts.onRetry(); });
  actions.appendChild(retry);
  if (opts.onReadOnly) {
    const ro = document.createElement('button');
    ro.type = 'button';
    ro.className = 'room-full-readonly';
    ro.textContent = 'Открыть только для чтения';
    const run = opts.onReadOnly;
    ro.addEventListener('click', () => { hideRoomFullModal(); run(); });
    actions.appendChild(ro);
  }
  card.append(h, p, actions);
  wrap.appendChild(card);
  wrap.addEventListener('keydown', ev => {
    if (ev.key === 'Escape' && opts.onReadOnly) { hideRoomFullModal(); opts.onReadOnly(); }
  });
  document.body.appendChild(wrap);
  retry.focus();
  return wrap;
}
