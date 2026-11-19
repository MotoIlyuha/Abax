// Пять режимов правой боковой панели (SPEC_CHAT §5) в порядке переключателя: «Чат и уведомления»,
// «История изменений», «Справка», «Импорт», «Экспорт». Виды монтируются при первом показе (src/side-panel.ts).

import { openSidePanel, registerPanelMode } from './side-panel';
import { NOTIFY_MODE, mountNotifyPanel, setNotifyTab } from './notify-panel';
import { setChatOpenHandler } from './collab-chat';
import { HISTORY_MODE, mountHistoryPanel } from './history-panel';
import { HELP_MODE, mountHelpPanel } from './help-panel';
import { EXPORT_MODE, IMPORT_MODE, mountExportPanel, mountImportPanel } from './transfer-panel';

export function registerPanelModes(): void {
  registerPanelMode({ ...NOTIFY_MODE, mount: mountNotifyPanel });
  registerPanelMode({ ...HISTORY_MODE, mount: mountHistoryPanel });
  registerPanelMode({ ...HELP_MODE, mount: mountHelpPanel });
  registerPanelMode({ ...IMPORT_MODE, mount: mountImportPanel });
  registerPanelMode({ ...EXPORT_MODE, mount: mountExportPanel });
  // «Открыть чат» (уведомление о сообщении, старые вызовы openChat) — панель ЧУ на вкладке «Чат»
  setChatOpenHandler(tab => { setNotifyTab(tab); openSidePanel('notify'); });
}
