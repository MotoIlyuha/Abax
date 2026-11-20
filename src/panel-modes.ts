// Пять режимов правой боковой панели (SPEC_CHAT §5) в порядке переключателя: ЧКУ (пункты «Чат и уведомления» и
// «Комментарии»), «История изменений», «Справка», «Импорт», «Экспорт». Виды монтируются при первом показе (src/side-panel.ts).

import { openSidePanel, registerPanelMode, setPanelEntries, setPanelTabIcon, syncPanelSelect } from './side-panel';
import { COMMENTS_ENTRY, NOTIFY_MODE, mountNotifyPanel, notifyTab, setNotifyTab } from './notify-panel';
import { formatUnread, unreadCount } from './notify-center';
import { notifyTabIcon } from './icons';
import { setChatOpenHandler } from './collab-chat';
import { HISTORY_MODE, mountHistoryPanel } from './history-panel';
import { HELP_MODE, mountHelpPanel } from './help-panel';
import { EXPORT_MODE, IMPORT_MODE, mountExportPanel, mountImportPanel } from './transfer-panel';

export function registerPanelModes(): void {
  registerPanelMode({ ...NOTIFY_MODE, mount: mountNotifyPanel });
  // в переключателе у ЧКУ два пункта (SPEC_COMMENTS §6): «Чат и уведомления» → вкладка «Все», «Комментарии» → «Комментарии»
  setPanelEntries('notify', [
    {
      value: 'notify', label: NOTIFY_MODE.label, icon: NOTIFY_MODE.icon, badge: () => formatUnread(unreadCount()),
      active: () => notifyTab() !== 'comments',
      open: () => { setNotifyTab('all'); openSidePanel('notify'); },
    },
    {
      value: 'comments', label: COMMENTS_ENTRY.label, icon: COMMENTS_ENTRY.icon, badge: () => formatUnread(unreadCount('comment')),
      active: () => notifyTab() === 'comments',
      open: () => { setNotifyTab('comments'); openSidePanel('notify'); },
    },
  ]);
  document.addEventListener('doska:notify-tab', () => syncPanelSelect());
  setPanelTabIcon(notifyTabIcon(notifyTab())); // значок язычка по сохранённой вкладке
  registerPanelMode({ ...HISTORY_MODE, mount: mountHistoryPanel });
  registerPanelMode({ ...HELP_MODE, mount: mountHelpPanel });
  registerPanelMode({ ...IMPORT_MODE, mount: mountImportPanel });
  registerPanelMode({ ...EXPORT_MODE, mount: mountExportPanel });
  // «Открыть чат» (уведомление о сообщении, старые вызовы openChat) — панель ЧУ на вкладке «Чат»
  setChatOpenHandler(tab => { setNotifyTab(tab); openSidePanel('notify'); });
}
