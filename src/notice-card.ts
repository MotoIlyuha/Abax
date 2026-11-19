// Карточка уведомления (SPEC_CHAT §4, §6): общая для стопки (src/notify-stack.ts) и вкладки «Уведомления»
// режима ЧУ (src/notify-panel.ts). Слева — аватар участника (с его курсором и значком события) или цветной квадрат
// с иконкой события, справа — заголовок, время, текст и необязательная кнопка действия.
// Имена и тексты приходят от других участников — только textContent; SVG — константы каталога иконок.

import { createUserAvatar } from './avatar';
import { DEFAULT_CURSOR_ID, cursorPreset, isCursorId } from './cursors';
import { NOTICE_ICONS } from './icons';
import { noticeTimeLabel, type Notice } from './notify-center';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/** Значок события: только ключи каталога (неизвестный — колокольчик). */
export function noticeIconSvg(n: Pick<Notice, 'icon'>): string {
  const key = n.icon && Object.prototype.hasOwnProperty.call(NOTICE_ICONS, n.icon) ? n.icon : 'bell';
  return NOTICE_ICONS[key];
}

/** Аватар участника (с его курсором и значком события) или цветной квадрат с иконкой события. */
export function noticeMedia(n: Notice): HTMLElement {
  const box = el('span', 'ns-media');
  box.setAttribute('aria-hidden', 'true');
  if (n.user) {
    const id = n.user.cursorId && isCursorId(n.user.cursorId) ? n.user.cursorId : DEFAULT_CURSOR_ID;
    const preset = cursorPreset(id);
    const av = createUserAvatar({
      name: String(n.user.name ?? '') || n.title, bg: preset.badgeBg, fg: preset.badgeText, cursorId: id,
      avatar: n.user.avatar ?? null, status: 'online',
    }, 'ns-avatar');
    av.tabIndex = -1;
    av.removeAttribute('title');
    av.removeAttribute('aria-label');
    box.append(av);
    if (n.icon) {
      const ev = el('span', 'ns-ev');
      ev.innerHTML = noticeIconSvg(n); // константа каталога иконок
      box.append(ev);
    }
  } else {
    box.classList.add('ns-square');
    box.innerHTML = noticeIconSvg(n); // константа каталога иконок
  }
  return box;
}

/** Время карточки: «сейчас», «2 мин», «14:02»; полное — в подсказке. */
export function paintNoticeTime(time: HTMLTimeElement, ts: number): void {
  const label = noticeTimeLabel(ts);
  if (time.textContent !== label) time.textContent = label;
  if (!time.dateTime) {
    const d = new Date(ts);
    time.dateTime = d.toISOString();
    time.title = d.toLocaleString('ru-RU');
  }
}

/**
 * Содержимое карточки: медиа слева, справа сетка — заголовок и время, под ними текст и кнопка действия.
 * beforeAction — что сделать перед действием уведомления (стопка убирает карточку, панель помечает прочитанным).
 */
export function noticeContent(n: Notice, beforeAction?: () => void): { content: HTMLElement; time: HTMLTimeElement } {
  const content = el('div', 'ns-content');
  const title = el('div', 'ns-title', n.title || 'Участник');
  const body = (n.body ?? '').trim();
  if (!body) title.classList.add('ns-wrap');
  const time = el('time', 'ns-time');
  const main = el('div', 'ns-main');
  content.append(noticeMedia(n), main);
  main.append(title);
  // пробел в начале текста не виден (схлопывается), но textContent карточки читается одной фразой:
  // «Капибара присоединился к доске»
  if (body) main.append(el('div', 'ns-body', ` ${body}`));
  main.append(time);
  if (n.action) {
    const act = el('button', 'ns-action', n.action.label);
    act.type = 'button';
    const run = n.action.run;
    act.addEventListener('click', ev => { ev.stopPropagation(); beforeAction?.(); run(); });
    main.append(act);
  }
  return { content, time };
}
