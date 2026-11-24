import { afterEach, describe, expect, it } from 'vitest';
import { closeSidePanel, openSidePanel, registerPanelMode, resetSidePanelForTests, sidePanelMode, sidePanelOpen } from '../../src/side-panel';
import { initTasksPanel, tasksPanelBody } from '../../src/tasks-panel';

describe('Панель заданий', () => {
  afterEach(() => { resetSidePanelForTests(); document.body.replaceChildren(); document.body.className = ''; });

  it('открывается, переключается с другой панелью и закрывается кнопкой и Escape', () => {
    document.body.className = 'no-motion no-ui-anim';
    document.body.innerHTML = `
      <div id="topbar"><button id="btn-notify"></button></div>
      <button id="btn-tasks"><span class="tasks-button-book"></span><span class="tasks-button-collapse"></span></button>
    `;
    registerPanelMode({ id: 'notify', label: 'Уведомления', icon: '', mount: () => ({}) });
    initTasksPanel(() => {}, () => true);
    const button = document.getElementById('btn-tasks') as HTMLButtonElement;
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-label')).toBe('Задания');
    button.click();
    expect(sidePanelMode()).toBe('tasks');
    expect(sidePanelOpen()).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.getAttribute('aria-label')).toBe('Свернуть панель');
    expect(document.documentElement.style.getPropertyValue('--left-panel-shift')).toBe('372px');
    expect(document.documentElement.style.getPropertyValue('--side-panel-shift')).toBe('0px');
    expect(tasksPanelBody()).not.toBeNull();
    openSidePanel('notify');
    expect(sidePanelMode()).toBe('notify');
    expect(document.documentElement.style.getPropertyValue('--left-panel-shift')).toBe('0px');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    button.click();
    expect(sidePanelMode()).toBe('tasks');
    button.click();
    expect(sidePanelOpen()).toBe(false);
    button.click();
    const input = document.createElement('input');
    tasksPanelBody()!.append(input);
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(sidePanelOpen()).toBe(true);
    button.focus();
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(sidePanelOpen()).toBe(false);
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-label')).toBe('Задания');
    closeSidePanel();
  });
});
