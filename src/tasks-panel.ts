import { CLOSE_ICON, ICONS, PANEL_COLLAPSE_ICON } from './icons';
import { onPlanChange, userPlan } from './plan';
import { openPlansDialog } from './plans-dialog';
import { closeSidePanel, onSidePanel, registerPanelMode, setSidePanelPref, sidePanelMode, sidePanelOpen, sidePanelPref, toggleSidePanel } from './side-panel';
import { onBillingChange, refreshBilling, tutorTrialOffered } from './subscription';
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

export function tasksButtonHidden(): boolean {
  return sidePanelPref().hideTasksButton === true;
}

/** Настройка хранится вместе с предпочтениями боковой панели и доступна меню и настройкам. */
export function setTasksButtonHidden(hidden: boolean): void {
  // Закрываем панель до скрытия кнопки, чтобы не оставлять её без доступного переключателя.
  if (hidden && sidePanelOpen() && sidePanelMode() === 'tasks') closeSidePanel(true);
  setSidePanelPref({ hideTasksButton: hidden });
  document.body.classList.toggle('hide-tasks-button', hidden);
}

export function initTasksPanel(add: (task: CatalogTask) => void, available: () => boolean): void {
  // У автора каталог загружается вместе с доской, чтобы открываться после потери связи.
  const loadBank = () => import('./task-bank-view');
  // Каталог и добавление карточек доступны только автору доски с тарифом Tutor.
  const canOpenBank = () => available() && userPlan() === 'tutor';
  if (canOpenBank()) void loadBank().catch(() => undefined);
  const button = document.querySelector<HTMLButtonElement>('#btn-tasks')!;
  const badge = button.querySelector<HTMLElement>('.tutor-badge')!;
  const offer = document.querySelector<HTMLDialogElement>('#tasks-offer')!;
  const trial = offer.querySelector<HTMLElement>('.tasks-offer-trial')!;
  const syncTrial = () => { trial.hidden = !tutorTrialOffered(); };
  document.body.classList.toggle('hide-tasks-button', tasksButtonHidden());
  offer.querySelector('.ob-close')!.innerHTML = CLOSE_ICON;
  offer.addEventListener('keydown', e => e.stopPropagation());
  offer.addEventListener('click', e => { if (e.target === offer) offer.close(); });
  offer.querySelector('[data-action="hide"]')!.addEventListener('click', () => {
    offer.close();
    setTasksButtonHidden(true);
    document.getElementById('btn-home')?.focus();
  });
  offer.querySelector('[data-action="subscribe"]')!.addEventListener('click', () => {
    offer.close();
    openPlansDialog(null, 'tutor');
  });
  onBillingChange(() => { if (offer.open) syncTrial(); });
  // В эти контейнеры попадают только постоянные иконки.
  button.querySelector('.tasks-button-book')!.innerHTML = ICONS.bookOpen;
  button.querySelector('.tasks-button-collapse')!.innerHTML = PANEL_COLLAPSE_ICON;
  registerPanelMode({
    id: 'tasks', label: 'Задания', icon: ICONS.bookOpen, side: 'left', trigger: button,
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
          if (loading || !canOpenBank()) return;
          if (bank) { bank.refresh(); return; }
          loading = true;
          body.textContent = 'Загрузка заданий…';
          void loadBank().then(({ mountTaskBank }) => {
            if (!canOpenBank()) return;
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
    const tutor = userPlan() === 'tutor';
    badge.hidden = tutor;
    button.setAttribute('aria-controls', tutor ? 'side-panel' : offer.id);
    if (tutor) button.removeAttribute('aria-haspopup');
    else button.setAttribute('aria-haspopup', 'dialog');
    const label = open ? 'Свернуть панель' : 'Задания';
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-label', label);
    button.title = label;
    if (button.hasAttribute('data-tip')) button.setAttribute('data-tip', label);
  };
  onSidePanel(sync);
  onPlanChange(() => {
    // При потере Tutor закрываем уже открытую панель, а предложение прячем после оформления тарифа.
    if (!canOpenBank() && sidePanelOpen() && sidePanelMode() === 'tasks') closeSidePanel(true);
    if (offer.open && userPlan() === 'tutor') offer.close();
    else if (offer.open) syncTrial();
    sync();
  });
  sync();
  button.addEventListener('click', () => {
    if (!available()) return;
    if (userPlan() === 'tutor') toggleSidePanel('tasks');
    else {
      // Актуализируем право на пробный период при открытии окна, в том числе для уже вошедших пользователей.
      syncTrial();
      offer.showModal();
      void refreshBilling();
    }
  });
}
