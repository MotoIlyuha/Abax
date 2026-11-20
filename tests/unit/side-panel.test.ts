// Правая боковая панель (SPEC_CHAT §5) в режиме «Выкл»: открытие и закрытие, режимы и их ленивое монтирование,
// запоминание режима, кнопка ЧУ и кнопка закрытия, Esc, F1, счётчик ЧУ в переключателе режимов.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SIDE_PANEL_KEY, SIDE_PANEL_SHIFT, closeSidePanel, onSidePanel, openSidePanel, registerPanelMode, resetSidePanelForTests,
  setPanelEntries, setSidePanelPref, sidePanelElements, sidePanelMode, sidePanelOpen, sidePanelPref, syncPanelSelect, toggleSidePanel,
} from '../../src/side-panel';
import { initNotifyButton } from '../../src/notify-button';
import { claimMenu, releaseMenu } from '../../src/menu-motion';
import { clearNotices, markRead, pushNotice } from '../../src/notify-center';
import type { PanelMode, PanelView } from '../../src/panel-types';

const btn = () => document.getElementById('btn-notify') as HTMLButtonElement;
const panel = () => document.getElementById('side-panel') as HTMLElement;
const closeBtn = () => document.getElementById('side-panel-close') as HTMLButtonElement;
const trigger = () => panel().querySelector<HTMLButtonElement>('.sp-mode')!;
const key = (el: Element, k: string, init: KeyboardEventInit = {}) =>
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));

type Spy = { mount: ReturnType<typeof vi.fn>; view: Required<Pick<PanelView, 'show' | 'hide'>> & PanelView };
let spies: Record<string, Spy>;

function register(id: PanelMode, label: string, extra: Partial<PanelView> = {}): void {
  const view = { show: vi.fn(), hide: vi.fn(), ...extra };
  const mount = vi.fn((host: HTMLElement) => {
    const b = document.createElement('button');
    b.className = `view-${id}`;
    b.textContent = label;
    host.append(b);
    return view;
  });
  spies[id] = { mount, view };
  registerPanelMode({ id, label, icon: `<svg class="ic-${id}"></svg>`, mount });
}

describe('боковая панель («Выкл»)', () => {
  beforeEach(() => {
    document.body.className = 'no-motion no-ui-anim';
    document.body.innerHTML = '<div id="topbar"><div class="topbar-left"><button id="btn-notify"></button></div></div>';
    localStorage.clear();
    spies = {};
    register('notify', 'Чат и уведомления');
    register('history', 'История изменений');
    register('help', 'Справка');
    initNotifyButton();
  });
  afterEach(() => {
    resetSidePanelForTests();
    clearNotices();
    localStorage.clear();
    document.body.className = '';
  });

  it('закрытие панели закрывает открытое меню (например «Поделиться»): его место сдвигала панель', () => {
    openSidePanel();
    const menuClose = vi.fn();
    claimMenu('share', menuClose);
    closeSidePanel();
    expect(menuClose).toHaveBeenCalledTimes(1);
    expect(sidePanelOpen()).toBe(false);
    releaseMenu('share');
  });

  it('разметка: complementary с подписью, кнопка закрытия снаружи; закрытая панель скрыта', () => {
    const { panel: p, close } = sidePanelElements();
    expect(p.id).toBe('side-panel');
    expect(p.getAttribute('role')).toBe('complementary');
    expect(p.getAttribute('aria-label')).toBe('Боковая панель');
    expect(p.hidden).toBe(true);
    expect(close.id).toBe('side-panel-close');
    expect(p.contains(close)).toBe(false);
    expect(close.hidden).toBe(true);
    expect(close.querySelectorAll('svg')).toHaveLength(2);
  });

  it('открытие и закрытие: сдвиг шапки, события, режим по умолчанию — ЧУ', () => {
    const seen: string[] = [];
    onSidePanel(s => seen.push(`${s.open}:${s.mode}`));
    openSidePanel();
    expect(sidePanelOpen()).toBe(true);
    expect(sidePanelMode()).toBe('notify');
    expect(panel().hidden).toBe(false);
    expect(closeBtn().hidden).toBe(false);
    expect(document.body.classList.contains('side-panel-open')).toBe(true);
    expect(document.documentElement.style.getPropertyValue('--side-panel-shift')).toBe(`${SIDE_PANEL_SHIFT}px`);
    expect(document.documentElement.style.getPropertyValue('--side-panel-tuck')).toBe('60px');
    closeSidePanel();
    expect(sidePanelOpen()).toBe(false);
    expect(panel().hidden).toBe(true);
    expect(closeBtn().hidden).toBe(true);
    expect(document.documentElement.style.getPropertyValue('--side-panel-shift')).toBe('0px');
    expect(seen).toEqual(['true:notify', 'false:notify']);
  });

  it('режимы монтируются при первом показе; смена режима — hide старого и show нового; действия — в шапку', () => {
    const actions = document.createElement('button');
    actions.className = 'hist-act';
    spies.history.view.actions = actions;
    expect(spies.notify.mount).not.toHaveBeenCalled();
    openSidePanel('notify');
    expect(spies.notify.mount).toHaveBeenCalledOnce();
    expect(spies.notify.view.show).toHaveBeenCalledOnce();
    expect(spies.history.mount).not.toHaveBeenCalled();
    openSidePanel('history');
    expect(spies.notify.view.hide).toHaveBeenCalledOnce();
    expect(spies.history.mount).toHaveBeenCalledOnce();
    expect(spies.history.view.show).toHaveBeenCalledOnce();
    expect(panel().querySelector('.sp-actions .hist-act')).toBe(actions);
    expect(panel().querySelector<HTMLElement>('.sp-view[data-mode="notify"]')!.hidden).toBe(true);
    expect(panel().querySelector<HTMLElement>('.sp-view[data-mode="history"]')!.hidden).toBe(false);
    openSidePanel('notify');
    expect(spies.notify.mount).toHaveBeenCalledOnce(); // второй раз не монтируется
    expect(spies.notify.view.show).toHaveBeenCalledTimes(2);
    expect(panel().querySelector('.sp-actions .hist-act')).toBeNull();
    closeSidePanel();
    expect(spies.notify.view.hide).toHaveBeenCalledTimes(2);
  });

  it('последний режим запоминается в localStorage и открывается снова; другие поля настроек сохраняются', () => {
    setSidePanelPref({ tab: 'chat' });
    openSidePanel('help');
    expect(JSON.parse(localStorage.getItem(SIDE_PANEL_KEY)!)).toEqual({ tab: 'chat', mode: 'help' });
    closeSidePanel();
    openSidePanel();
    expect(sidePanelMode()).toBe('help');
    localStorage.setItem(SIDE_PANEL_KEY, '{битый');
    expect(sidePanelPref()).toEqual({});
  });

  it('кнопка ЧУ скрыта в режиме ЧУ («влилась» в кнопку закрытия) и видна в других; aria-expanded — только ЧУ', () => {
    btn().click();
    expect(sidePanelMode()).toBe('notify');
    expect(btn().classList.contains('sp-merged')).toBe(true);
    expect(btn().getAttribute('aria-expanded')).toBe('true');
    openSidePanel('history');
    expect(btn().classList.contains('sp-merged')).toBe(false);
    expect(btn().getAttribute('aria-expanded')).toBe('false');
    expect(document.documentElement.style.getPropertyValue('--side-panel-tuck')).toBe('0px');
    btn().click(); // в другом режиме — переключение на ЧУ
    expect(sidePanelOpen()).toBe(true);
    expect(sidePanelMode()).toBe('notify');
    expect(btn().classList.contains('sp-merged')).toBe(true);
    closeBtn().click();
    expect(sidePanelOpen()).toBe(false);
    expect(btn().classList.contains('sp-merged')).toBe(false);
  });

  it('toggleSidePanel: тот же режим закрывает, другой — переключает', () => {
    toggleSidePanel('help');
    expect(sidePanelMode()).toBe('help');
    toggleSidePanel('history');
    expect(sidePanelOpen()).toBe(true);
    expect(sidePanelMode()).toBe('history');
    toggleSidePanel('history');
    expect(sidePanelOpen()).toBe(false);
  });

  it('фокус: при открытии — в вид (focus() вида или первый фокусируемый), при закрытии — на кнопку ЧУ', () => {
    openSidePanel('history');
    expect(document.activeElement?.className).toBe('view-history');
    const focus = vi.fn(() => (panel().querySelector('.view-help') as HTMLElement).focus());
    spies.help.view.focus = focus;
    openSidePanel('help');
    expect(focus).toHaveBeenCalled();
    closeSidePanel();
    expect(document.activeElement).toBe(btn());
  });

  it('Esc в панели закрывает её; открытый выпадающий список закрывается первым; клавиши не уходят доске', () => {
    openSidePanel('history');
    const board = vi.fn();
    window.addEventListener('keydown', board);
    key(panel().querySelector('.view-history')!, 'v');
    expect(board).not.toHaveBeenCalled();
    trigger().click();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    key(trigger(), 'Escape');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(sidePanelOpen()).toBe(true);
    key(trigger(), 'Escape');
    expect(sidePanelOpen()).toBe(false);
    window.removeEventListener('keydown', board);
  });

  it('переключатель режимов: иконки пунктов, иконка выбранного на кнопке; выбор пункта меняет режим', () => {
    openSidePanel('notify');
    expect(trigger().querySelector('.roll-icon .ic-notify')).not.toBeNull();
    trigger().click();
    const menu = document.querySelector<HTMLElement>('.ss-menu')!;
    expect([...menu.querySelectorAll('.ss-opt-icon svg')].map(s => s.getAttribute('class'))).toEqual(['ic-notify', 'ic-history', 'ic-help']);
    menu.querySelector<HTMLElement>('[data-value="help"]')!.click();
    expect(sidePanelMode()).toBe('help');
    expect(trigger().querySelector('.roll-icon .ic-help')).not.toBeNull();
  });

  it('пункты режима: «Чат и уведомления» и «Комментарии» открывают один режим; выбранный — по активному пункту', () => {
    let tab = 'all';
    const opened: string[] = [];
    setPanelEntries('notify', [
      { value: 'notify', label: 'Чат и уведомления', icon: '<svg class="ic-n"></svg>', active: () => tab !== 'comments', open: () => { tab = 'all'; opened.push('all'); openSidePanel('notify'); } },
      { value: 'comments', label: 'Комментарии', icon: '<svg class="ic-c"></svg>', badge: () => '5', active: () => tab === 'comments', open: () => { tab = 'comments'; opened.push('comments'); openSidePanel('notify'); } },
    ]);
    openSidePanel('history');
    trigger().click();
    const menu = document.querySelector<HTMLElement>('.ss-menu')!;
    expect([...menu.querySelectorAll('[role="option"]')].map(o => o.getAttribute('data-value'))).toEqual(['notify', 'comments', 'history', 'help']);
    expect(menu.querySelector('[data-value="comments"] .ss-opt-badge')!.textContent).toBe('5');
    menu.querySelector<HTMLElement>('[data-value="comments"]')!.click();
    expect(opened).toEqual(['comments']);
    expect(sidePanelMode()).toBe('notify');
    expect(sidePanelElements().select.value).toBe('comments');
    // вкладку сменили внутри режима — переключатель следует за ней
    tab = 'chat';
    syncPanelSelect();
    expect(sidePanelElements().select.value).toBe('notify');
  });

  it('счётчик ЧУ: в строке переключателя и на кнопке, когда выбран другой режим; обновляется по центру уведомлений', () => {
    openSidePanel('history');
    const badge = () => trigger().querySelector<HTMLElement>('.ss-badge')!;
    expect(badge().classList.contains('on')).toBe(false);
    pushNotice({ title: 'а' });
    pushNotice({ kind: 'chat', title: 'Лемур', body: 'привет' });
    expect(badge().classList.contains('on')).toBe(true);
    expect(badge().textContent).toBe('2');
    trigger().click();
    const row = document.querySelector<HTMLElement>('.ss-menu [data-value="notify"] .ss-opt-badge')!;
    expect(row.hidden).toBe(false);
    expect(row.textContent).toBe('2');
    pushNotice({ title: 'б' });
    expect(row.textContent).toBe('3'); // на месте, без пересоздания меню
    expect(document.querySelector('.ss-menu [data-value="history"] .ss-opt-badge')!.hasAttribute('hidden')).toBe(true);
    markRead();
    expect(row.hidden).toBe(true);
    expect(badge().classList.contains('on')).toBe(false);
  });

  it('счётчик на кнопке переключателя не показывается, когда выбран сам ЧУ', () => {
    pushNotice({ title: 'а' });
    openSidePanel('notify');
    expect(trigger().querySelector('.ss-badge')!.classList.contains('on')).toBe(false);
  });
});

describe('F1 и кнопка «Помощь»', () => {
  beforeEach(() => {
    document.body.className = 'no-motion no-ui-anim';
    document.body.innerHTML = '<button id="btn-help"></button>';
    spies = {};
    register('notify', 'Чат и уведомления');
    register('help', 'Справка');
  });
  afterEach(() => {
    resetSidePanelForTests();
    localStorage.clear();
    document.body.className = '';
  });

  it('F1 открывает и закрывает «Справку» — так же, как toggleSidePanel(«help») из app.ts', () => {
    // разводка из app.ts (wireHelpButton): F1 → toggleSidePanel('help'); F1 в панели не гасится
    const onF1 = (e: KeyboardEvent) => { if (e.code === 'F1') toggleSidePanel('help'); };
    document.addEventListener('keydown', onF1);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', code: 'F1', bubbles: true }));
    expect(sidePanelOpen()).toBe(true);
    expect(sidePanelMode()).toBe('help');
    key(panel().querySelector('.view-help')!, 'F1', { code: 'F1' });
    expect(sidePanelOpen()).toBe(false);
    document.removeEventListener('keydown', onF1);
  });
});
