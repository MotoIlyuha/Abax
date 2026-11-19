// Режим «Чат и уведомления» правой боковой панели (SPEC_CHAT §6).
// ЗАГЛУШКА КОНТРАКТА: каркас панели (src/side-panel.ts) монтирует этот вид, полное содержимое
// (Tab pill «Все / Чат / Уведомления», лента, поле ввода) приходит отдельным шагом с теми же экспортами.

import { NOTIFY_ICON } from './icons';
import { markRead, notices, onNotices } from './notify-center';
import type { PanelModeDef, PanelView } from './panel-types';

export const NOTIFY_MODE: Omit<PanelModeDef, 'mount'> = { id: 'notify', label: 'Чат и уведомления', icon: NOTIFY_ICON };

/** Вкладки режима ЧУ. */
export type NotifyTab = 'all' | 'chat' | 'notices';

let tab: NotifyTab = 'all';
let shown = false;

/** Текущая вкладка (запоминается и до монтирования вида). */
export function notifyTab(): NotifyTab {
  return tab;
}

/** Переключить вкладку; показанный вид сразу помечает прочитанным то, что на ней видно. */
export function setNotifyTab(next: NotifyTab): void {
  tab = next;
  if (shown) markShown();
}

/** Прокрутить ленту к сообщению чата и подсветить его. */
export function revealChatMessage(_id: string): void {
  setNotifyTab('chat');
}

function markShown(): void {
  if (tab === 'all') markRead();
  else markRead(tab === 'chat' ? 'chat' : 'system');
}

export function mountNotifyPanel(host: HTMLElement): PanelView {
  const list = document.createElement('div');
  list.className = 'notify-panel-stub';
  host.appendChild(list);
  const render = () => {
    list.textContent = '';
    for (const n of [...notices()].reverse()) {
      const row = document.createElement('div');
      row.textContent = n.body ? `${n.title}: ${n.body}` : n.title;
      list.appendChild(row);
    }
  };
  onNotices(() => { if (shown) { render(); markShown(); } });
  return {
    show() { shown = true; render(); markShown(); },
    hide() { shown = false; },
  };
}
