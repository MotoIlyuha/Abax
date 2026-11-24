import { ICONS, PANEL_COLLAPSE_ICON } from './icons';
import { onSidePanel, registerPanelMode, sidePanelMode, sidePanelOpen, toggleSidePanel } from './side-panel';

/** Контейнер для банка заданий создаётся при первом открытии панели. */
export function tasksPanelBody(): HTMLElement | null {
  return document.getElementById('tasks-panel-body');
}

export function initTasksPanel(): void {
  const button = document.querySelector<HTMLButtonElement>('#btn-tasks')!;
  // В эти контейнеры попадают только постоянные иконки.
  button.querySelector('.tasks-button-book')!.innerHTML = ICONS.bookOpen;
  button.querySelector('.tasks-button-collapse')!.innerHTML = PANEL_COLLAPSE_ICON;
  registerPanelMode({
    id: 'tasks', label: 'Задания', icon: ICONS.bookOpen, side: 'left', badge: 'Tutor', trigger: button,
    mount(host) {
      const body = document.createElement('div');
      body.id = 'tasks-panel-body';
      const placeholder = document.createElement('div');
      placeholder.className = 'tasks-placeholder';
      const icon = document.createElement('span');
      icon.innerHTML = ICONS.bookOpen;
      const text = document.createElement('p');
      text.textContent = 'Здесь появится банк заданий ОГЭ/ЕГЭ';
      placeholder.append(icon, text);
      body.append(placeholder);
      host.append(body);
      return {};
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
  button.addEventListener('click', () => toggleSidePanel('tasks'));
}
