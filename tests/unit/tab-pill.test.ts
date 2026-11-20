import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTabPill, type TabPill } from '../../src/tab-pill';

const TABS = [
  { value: 'all', label: 'Все', id: 't-all', controls: 'p-all' },
  { value: 'chat', label: 'Чат' },
  { value: 'notices', label: 'Уведомления' },
];
const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

describe('вкладки Tab pill', () => {
  let tp: TabPill;
  let onChange: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    document.body.className = 'no-motion no-ui-anim';
    onChange = vi.fn();
    tp = createTabPill({ tabs: TABS, value: 'chat', label: 'Разделы', onChange });
    document.body.append(tp.el);
  });
  afterEach(() => {
    tp.el.remove();
    document.body.className = '';
  });

  it('роли и aria: tablist, tab, aria-selected, aria-controls, переход фокуса', () => {
    expect(tp.el.getAttribute('role')).toBe('tablist');
    expect(tp.el.getAttribute('aria-label')).toBe('Разделы');
    const tabs = [...tp.el.querySelectorAll('[role="tab"]')] as HTMLButtonElement[];
    expect(tabs.map(t => t.textContent)).toEqual(['Все', 'Чат', 'Уведомления']);
    expect(tabs.map(t => t.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
    expect(tabs.map(t => t.tabIndex)).toEqual([-1, 0, -1]);
    expect(tabs[0].id).toBe('t-all');
    expect(tabs[0].getAttribute('aria-controls')).toBe('p-all');
    expect(tp.el.querySelector('.tp-pill')!.getAttribute('aria-hidden')).toBe('true');
    expect(tp.value).toBe('chat');
  });

  it('щелчок выбирает вкладку и сообщает; повторный — нет', () => {
    tp.tab('notices')!.click();
    expect(tp.value).toBe('notices');
    expect(onChange).toHaveBeenCalledWith('notices');
    tp.tab('notices')!.click();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(tp.tab('notices')!.getAttribute('aria-selected')).toBe('true');
  });

  it('стрелки по кругу, Home и End; фокус следует за выбором', () => {
    const chat = tp.tab('chat')!;
    chat.focus();
    key(chat, 'ArrowRight');
    expect(tp.value).toBe('notices');
    expect(document.activeElement).toBe(tp.tab('notices'));
    key(document.activeElement!, 'ArrowRight');
    expect(tp.value).toBe('all');
    key(document.activeElement!, 'ArrowLeft');
    expect(tp.value).toBe('notices');
    key(document.activeElement!, 'Home');
    expect(tp.value).toBe('all');
    key(document.activeElement!, 'End');
    expect(tp.value).toBe('notices');
    expect(onChange.mock.calls.map(c => c[0])).toEqual(['notices', 'all', 'notices', 'all', 'notices']);
  });

  it('setValue меняет вкладку без onChange', () => {
    tp.setValue('all');
    expect(tp.value).toBe('all');
    expect(onChange).not.toHaveBeenCalled();
    tp.setValue('нет такой');
    expect(tp.value).toBe('all');
  });

  it('счётчики: число, 99+, 0 — скрыт; подпись для чтения с экрана', () => {
    const count = () => tp.tab('chat')!.querySelector('.tp-count') as HTMLElement;
    const text = () => count().querySelector('.roll-line:not(.roll-leaving) .roll-text')?.textContent ?? '';
    expect(count().classList.contains('on')).toBe(false);
    expect(count().getAttribute('aria-hidden')).toBe('true');
    tp.setCount('chat', 3);
    expect(count().classList.contains('on')).toBe(true);
    expect(text()).toBe('3');
    expect(tp.tab('chat')!.getAttribute('aria-label')).toBe('Чат: непрочитанных — 3');
    tp.setCount('chat', 150);
    expect(text()).toBe('99+');
    tp.setCount('chat', 0);
    expect(count().classList.contains('on')).toBe(false);
    expect(tp.tab('chat')!.getAttribute('aria-label')).toBe('Чат');
  });

  it('«Выкл»: пилюля встаёт на вкладку сразу (по размерам вкладок)', () => {
    const tabs = [...tp.el.querySelectorAll<HTMLButtonElement>('.tp-tab')];
    tabs.forEach((b, i) => {
      Object.defineProperty(b, 'offsetLeft', { configurable: true, value: 4 + i * 100 });
      Object.defineProperty(b, 'offsetWidth', { configurable: true, value: 90 });
    });
    tp.setValue('notices');
    const pill = tp.el.querySelector<HTMLElement>('.tp-pill')!;
    expect(pill.style.left).toBe('204px');
    expect(pill.style.width).toBe('90px');
    expect(tp.edges).toEqual({ left: 204, right: 294 });
    // подпись под пилюлей — белая (tp-on)
    expect(tabs.map(b => b.classList.contains('tp-on'))).toEqual([false, false, true]);
    tp.setValue('all');
    expect(pill.style.left).toBe('4px');
    expect(tabs.map(b => b.classList.contains('tp-on'))).toEqual([true, false, false]);
  });

  it('«Обычные»: CSS-переход (класс tp-css)', () => {
    document.body.className = 'no-motion';
    const tabs = [...tp.el.querySelectorAll<HTMLButtonElement>('.tp-tab')];
    tabs.forEach((b, i) => {
      Object.defineProperty(b, 'offsetLeft', { configurable: true, value: i * 100 });
      Object.defineProperty(b, 'offsetWidth', { configurable: true, value: 90 });
    });
    tp.setValue('all'); // первое измерение — сразу
    tp.tab('notices')!.click();
    expect(tp.el.classList.contains('tp-css')).toBe(true);
    expect(tp.el.querySelector<HTMLElement>('.tp-pill')!.style.left).toBe('200px');
  });
});
