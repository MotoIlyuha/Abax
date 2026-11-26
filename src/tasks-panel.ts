import { ICONS, PANEL_COLLAPSE_ICON } from './icons';
import { onSidePanel, registerPanelMode, sidePanelMode, sidePanelOpen, toggleSidePanel } from './side-panel';
import { createSpringSelect } from './spring-select';
import type { CatalogTask } from '../shared/task-catalog';

const TASK_BANK_DRAG = 'application/x-abax-bank-task';
let draggedTask: CatalogTask | null = null;

export function draggedBankTask(data: DataTransfer | null): CatalogTask | null {
  return draggedTask && data?.getData(TASK_BANK_DRAG) === draggedTask.id ? draggedTask : null;
}

/** Контейнер банка создаётся при первом открытии панели. */
export function tasksPanelBody(): HTMLElement | null {
  return document.getElementById('tasks-panel-body');
}

export function initTasksPanel(add: (task: CatalogTask) => void, available: () => boolean): void {
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
      const soon = { disabled: true, badge: 'Скоро', title: 'Банк заданий появится в ближайшем обновлении' };
      let bank: { setSubject(value: string): void; refresh(): void } | undefined;
      const subject = createSpringSelect({
        className: 'task-bank-subject', label: 'Предмет: Математика', align: 'end', value: 'math',
        options: [
          { value: 'math', label: 'Математика' },
          { value: 'informatics', label: 'Информатика', ...soon },
          { value: 'physics', label: 'Физика', ...soon },
          { value: 'russian', label: 'Русский', ...soon },
        ],
        onChange(value) { bank?.setSubject(value); },
      });
      let loading = false;
      return {
        actions: subject.el,
        show() {
          if (loading || !available()) return;
          if (bank) { bank.refresh(); return; }
          loading = true;
          body.textContent = 'Загрузка заданий…';
          void loadBank().then(({ mountTaskBank }) => {
            bank = mountTaskBank(body, subject, add, (task, data) => {
              draggedTask = data ? task : null;
              if (task && data) {
                data.effectAllowed = 'copy';
                data.setData(TASK_BANK_DRAG, task.id);
              }
            });
          }).catch(() => {
            body.textContent = 'Не удалось загрузить каталог заданий. Закройте панель и откройте снова.';
          }).finally(() => { loading = false; });
        },
        hide() { subject.close(true); draggedTask = null; },
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
