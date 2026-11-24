import { ICONS, PANEL_COLLAPSE_ICON } from './icons';
import { onSidePanel, registerPanelMode, sidePanelMode, sidePanelOpen, toggleSidePanel } from './side-panel';
import type { BankTask } from './fipi-bank';

const TASK_BANK_DRAG = 'application/x-abax-bank-task';
let draggedTask: BankTask | null = null;

export function draggedBankTask(data: DataTransfer | null): BankTask | null {
  return draggedTask && data?.getData(TASK_BANK_DRAG) === draggedTask.id ? draggedTask : null;
}

/** Контейнер банка создаётся при первом открытии панели. */
export function tasksPanelBody(): HTMLElement | null {
  return document.getElementById('tasks-panel-body');
}

export function initTasksPanel(add: (task: BankTask) => void, available: () => boolean): void {
  // У автора каталог загружается вместе с доской, чтобы открываться после потери связи.
  const loadBank = () => import('./task-bank-view');
  if (available()) void loadBank().catch(() => undefined);
  const button = document.querySelector<HTMLButtonElement>('#btn-tasks')!;
  // В эти контейнеры попадают только постоянные иконки.
  button.querySelector('.tasks-button-book')!.innerHTML = ICONS.bookOpen;
  button.querySelector('.tasks-button-collapse')!.innerHTML = PANEL_COLLAPSE_ICON;
  registerPanelMode({
    id: 'tasks', label: 'Задания', icon: ICONS.bookOpen, side: 'left', badge: 'Tutor', trigger: button,
    mount(host) {
      const body = document.createElement('div');
      body.id = 'tasks-panel-body';
      host.append(body);
      let loading = false;
      let loaded = false;
      return {
        show() {
          if (loaded || loading || !available()) return;
          loading = true;
          body.textContent = 'Загрузка заданий…';
          void loadBank().then(({ mountTaskBank }) => {
            mountTaskBank(body, add, (task, data) => {
              draggedTask = data ? task : null;
              if (task && data) {
                data.effectAllowed = 'copy';
                data.setData(TASK_BANK_DRAG, task.id);
              }
            });
            loaded = true;
          }).catch(() => {
            body.textContent = 'Не удалось загрузить каталог заданий. Закройте панель и откройте снова.';
          }).finally(() => { loading = false; });
        },
        hide() { draggedTask = null; },
      };
    },
  });
  const sync = (): void => {
    const open = sidePanelOpen() && sidePanelMode() === 'tasks';
    const label = open ? 'Свернуть панель' : 'Задания';
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-label', label);
    button.title = label;
    if (button.hasAttribute('data-tip')) button.setAttribute('data-tip', label);
  };
  onSidePanel(sync);
  sync();
  button.addEventListener('click', () => {
    if (available()) toggleSidePanel('tasks');
  });
}
