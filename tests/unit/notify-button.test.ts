import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initNotifyButton, notifyLabel, notifyShownCount, setNotifyPending } from '../../src/notify-button';
import { clearNotices, pushNotice, setDoNotDisturb } from '../../src/notify-center';
import { openSidePanel, registerPanelMode, resetSidePanelForTests, sidePanelMode, sidePanelOpen } from '../../src/side-panel';

const btn = () => document.getElementById('btn-notify') as HTMLButtonElement;
const badge = () => btn().querySelector('.nb-badge') as HTMLElement;
const badgeText = () => badge().querySelector('.roll-line:not(.roll-leaving) .roll-text')?.textContent ?? '';

describe('кнопка «Чат и уведомления»', () => {
  beforeEach(() => {
    // «Выкл»: всё меняется сразу
    document.body.className = 'no-motion no-ui-anim';
    document.body.innerHTML = '<div id="topbar"><div class="topbar-left"><button id="btn-notify"></button></div></div>';
    initNotifyButton();
  });
  afterEach(() => {
    resetSidePanelForTests();
    setNotifyPending(new Set());
    clearNotices();
    setDoNotDisturb(false);
    localStorage.clear();
    document.body.className = '';
  });

  it('иконка - константа каталога, подпись без непрочитанных', () => {
    expect(btn().querySelector('svg')).not.toBeNull();
    expect(btn().getAttribute('aria-label')).toBe('Чат, комментарии и уведомления');
    expect(btn().title).toBe('Чат, комментарии и уведомления');
    expect(btn().getAttribute('aria-expanded')).toBe('false');
    expect(badge().classList.contains('on')).toBe(false);
    expect(badge().getAttribute('aria-hidden')).toBe('true');
  });

  it('счётчик - непрочитанные чата и системные; тихие не считаются', () => {
    pushNotice({ title: 'Капибара', body: 'присоединился к доске' });
    pushNotice({ kind: 'chat', title: 'Лемур', body: 'привет' });
    pushNotice({ title: 'Вы позвали всех на эту страницу', quiet: true });
    expect(badge().classList.contains('on')).toBe(true);
    expect(badgeText()).toBe('2');
    expect(notifyShownCount()).toBe(2);
    expect(btn().getAttribute('aria-label')).toBe('Чат, комментарии и уведомления: непрочитанных - 2');
    expect(btn().title).toBe('Чат, комментарии и уведомления: непрочитанных - 2');
  });

  it('99+ и исчезновение при нуле', () => {
    for (let i = 0; i < 120; i++) pushNotice({ title: `№${i}` });
    expect(badgeText()).toBe('99+');
    expect(btn().getAttribute('aria-label')).toBe('Чат, комментарии и уведомления: непрочитанных - 99+');
    clearNotices();
    expect(badge().classList.contains('on')).toBe(false);
    expect(btn().getAttribute('aria-label')).toBe('Чат, комментарии и уведомления');
  });

  it('«не беспокоить»: серый счётчик, полумесяц и подсказка', () => {
    pushNotice({ title: 'событие' });
    setDoNotDisturb(true);
    expect(btn().classList.contains('dnd')).toBe(true);
    expect(btn().querySelector('.nb-moon svg')).not.toBeNull();
    expect(btn().title).toBe('Чат, комментарии и уведомления: непрочитанных - 1 · Не беспокоить включено');
    setDoNotDisturb(false);
    expect(btn().classList.contains('dnd')).toBe(false);
    expect(notifyLabel(0, true)).toBe('Чат, комментарии и уведомления · Не беспокоить включено');
  });

  it('то, что ещё летит в кнопку из стопки, не считается, пока не долетит', () => {
    const a = pushNotice({ title: 'а' });
    pushNotice({ title: 'б' });
    setNotifyPending(new Set([a.id]));
    expect(badgeText()).toBe('1');
    setNotifyPending(new Set());
    expect(badgeText()).toBe('2');
  });

  it('щелчок - боковая панель в режиме ЧУ (aria-expanded), повторный - закрывает; в другом режиме - переключает на ЧУ', () => {
    registerPanelMode({ id: 'notify', label: 'Чат и уведомления', icon: '<svg></svg>', mount: () => ({}) });
    registerPanelMode({ id: 'help', label: 'Справка', icon: '<svg></svg>', mount: () => ({}) });
    btn().click();
    expect(sidePanelOpen()).toBe(true);
    expect(sidePanelMode()).toBe('notify');
    expect(btn().getAttribute('aria-expanded')).toBe('true');
    btn().click();
    expect(sidePanelOpen()).toBe(false);
    expect(btn().getAttribute('aria-expanded')).toBe('false');
    openSidePanel('help');
    expect(btn().getAttribute('aria-expanded')).toBe('false');
    btn().click();
    expect(sidePanelMode()).toBe('notify');
    expect(sidePanelOpen()).toBe(true);
  });

  it('повторная настройка той же кнопки не дублирует счётчик', () => {
    initNotifyButton();
    expect(btn().querySelectorAll('.nb-badge')).toHaveLength(1);
  });
});
