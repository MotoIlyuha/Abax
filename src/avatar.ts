// Аватар пользователя: круг с инициалами, у правого нижнего края — его курсор из каталога, у правого верхнего —
// значок статуса («Отошёл», «На скрытой странице»). Имя и цвета приходят от других участников — только
// textContent, setAttribute и свойства style; SVG курсора и значков — константы кода.

import { DEFAULT_CURSOR_ID, cursorSvg, isCursorId } from './cursors';
import { getParticipantInitials } from './presence';
import { svg } from './icons';

export type AvatarStatus = 'online' | 'away' | 'hidden-page';

export interface AvatarData {
  name: string;
  /** Цвета круга (плашка курсора). */
  bg: string;
  fg: string;
  /** Курсор каталога; неизвестный — стандартный. */
  cursorId?: string | null;
  status: AvatarStatus;
  /** Мой аватар. */
  self?: boolean;
  /** Курсор этого участника я скрыл: на аватаре он бледный и перечёркнут. */
  cursorHidden?: boolean;
  /** Подсказка и подпись для чтения с экрана; по умолчанию — имя. */
  title?: string;
}

/** Подпись статуса (для меню и подсказок); у «в сети» — пусто. */
export const STATUS_TEXT: Record<AvatarStatus, string> = {
  online: '',
  away: 'Отошёл',
  'hidden-page': 'На скрытой странице',
};

const STATUS_ICON: Record<Exclude<AvatarStatus, 'online'>, string> = {
  // полумесяц — «отошёл»
  away: svg('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" fill="currentColor" stroke="none"/>'),
  // перечёркнутый глаз — «на скрытой странице»
  'hidden-page': svg('<path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z"/><path d="M4 4l16 16"/>'),
};

/** Цвет круга, когда участник отошёл: серый, как у его курсора на холсте. */
const AWAY_BG = '#9aa0ab';

interface Parts { circle: HTMLElement; cursor: HTMLElement; status: HTMLElement }
const parts = new WeakMap<HTMLElement, Parts & { cursorId: string; statusId: AvatarStatus | null }>();

function span(cls: string): HTMLSpanElement {
  const n = document.createElement('span');
  n.className = cls;
  return n;
}

/** Аватар-кнопка; cls — дополнительные классы (например, 'presence-avatar'). */
export function createUserAvatar(d: AvatarData, cls = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  const circle = span('ua-circle');
  const cursor = span('ua-cursor');
  cursor.setAttribute('aria-hidden', 'true');
  const status = span('ua-status');
  status.setAttribute('aria-hidden', 'true');
  b.append(circle, cursor, status);
  parts.set(b, { circle, cursor, status, cursorId: '', statusId: null });
  b.dataset.extraClass = cls;
  updateUserAvatar(b, d);
  return b;
}

/** Обновить аватар на месте (узлы не пересоздаются: наведение и фокус не сбрасываются). */
export function updateUserAvatar(b: HTMLElement, d: AvatarData): void {
  const p = parts.get(b);
  if (!p) return;
  const extra = b.dataset.extraClass ?? '';
  const cls = ['user-avatar', extra, d.self ? 'self' : '', d.status === 'away' ? 'away' : '', d.status === 'hidden-page' ? 'on-hidden' : '', d.cursorHidden ? 'cursor-off' : '']
    .filter(Boolean).join(' ');
  // классы анимации группы (ag-*) живут своей жизнью
  const keep = [...b.classList].filter(c => c.startsWith('ag-'));
  b.className = [cls, ...keep].join(' ');
  p.circle.textContent = getParticipantInitials(d.name);
  p.circle.style.background = d.status === 'away' ? AWAY_BG : d.bg;
  p.circle.style.color = d.status === 'away' ? '#ffffff' : d.fg;
  const id = d.cursorId && isCursorId(d.cursorId) ? d.cursorId : DEFAULT_CURSOR_ID;
  if (p.cursorId !== id) {
    p.cursor.innerHTML = cursorSvg(id, { size: 14 }); // разметка каталога курсоров — только константы
    p.cursorId = id;
  }
  if (p.statusId !== d.status) {
    p.statusId = d.status;
    p.status.hidden = d.status === 'online';
    p.status.innerHTML = d.status === 'online' ? '' : STATUS_ICON[d.status]; // константы модуля
    p.status.dataset.status = d.status;
  }
  const title = d.title ?? (String(d.name ?? '') || 'Участник');
  b.title = title;
  b.setAttribute('aria-label', title);
}
