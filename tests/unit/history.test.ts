// Лента «История изменений»: время записей и переходы в src/state.ts, вид src/history-panel.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addElement, addPage, blankProject, canRedo, canUndo, historyTimeline, jumpToHistory, openProject, pushHistory, redo,
  replaceElements, state, switchPage, undo,
} from '../../src/state';
import { formatHistoryTime, HISTORY_MODE, mountHistoryPanel } from '../../src/history-panel';
import { setPanelActions, type PanelActions } from '../../src/panel-actions';
import type { ShapeEl } from '../../src/types';

const rect = (id: string, o: Partial<ShapeEl> = {}): ShapeEl =>
  ({ id, type: 'shape', shape: 'rect', x: 0, y: 0, w: 10, h: 10, color: '#000000', width: 2, ...o });
const ids = () => state.board.elements.map(e => e.id);
const frame = () => new Promise(r => requestAnimationFrame(() => r(null)));

function actions(o: Partial<PanelActions> = {}): PanelActions {
  return {
    canEdit: () => true, importDocument: vi.fn(), insertImage: vi.fn(), importFile: vi.fn(), canOpenProject: () => true,
    openProjectFile: vi.fn(), pasteFromClipboard: vi.fn(), exportPng: vi.fn(), copyImage: vi.fn(), downloadProject: vi.fn(),
    openInApp: null, ...o,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 19, 14, 0, 0));
  openProject(blankProject('История'));
  setPanelActions(null);
});
afterEach(() => {
  vi.useRealTimers();
  document.body.textContent = '';
  setPanelActions(null);
});

describe('historyTimeline', () => {
  it('после открытия — одна запись «Начало сеанса», она же текущая', () => {
    expect(historyTimeline()).toEqual([{ label: 'Начало сеанса', ts: Date.now(), state: 'current' }]);
  });

  it('сделанное, текущее и отменённое; подписи — между соседними снимками', () => {
    addElement(rect('a'));
    addElement(rect('b', { shape: 'ellipse' }));
    pushHistory(state.board.elements);
    replaceElements(state.board.elements.map(e => (e.id === 'a' ? { ...e, x: 50 } : e)));
    expect(historyTimeline().map(r => [r.label, r.state])).toEqual([
      ['Начало сеанса', 'done'],
      ['Добавлен прямоугольник', 'done'],
      ['Добавлен эллипс', 'done'],
      ['Перемещён прямоугольник', 'current'],
    ]);
    undo();
    undo();
    expect(historyTimeline().map(r => [r.label, r.state])).toEqual([
      ['Начало сеанса', 'done'],
      ['Добавлен прямоугольник', 'current'],
      ['Добавлен эллипс', 'undone'],
      ['Перемещён прямоугольник', 'undone'],
    ]);
  });

  it('время записи — когда сделана правка; переезжает со стека на стек при отмене и повторе', () => {
    const t0 = Date.now();
    vi.setSystemTime(t0 + 60_000);
    addElement(rect('a'));
    vi.setSystemTime(t0 + 120_000);
    addElement(rect('b'));
    vi.setSystemTime(t0 + 600_000);
    undo();
    expect(historyTimeline().map(r => r.ts)).toEqual([t0, t0 + 60_000, t0 + 120_000]);
    redo();
    expect(historyTimeline().map(r => r.ts)).toEqual([t0, t0 + 60_000, t0 + 120_000]);
  });

  it('новая правка после отмены отбрасывает отменённое', () => {
    addElement(rect('a'));
    addElement(rect('b'));
    undo();
    addElement(rect('c', { shape: 'triangle' }));
    expect(historyTimeline().map(r => r.label)).toEqual(['Начало сеанса', 'Добавлен прямоугольник', 'Добавлен треугольник']);
    expect(canRedo()).toBe(false);
  });

  it('другая страница и новая страница начинают историю заново', () => {
    addElement(rect('a'));
    const first = state.pageId;
    addPage();
    expect(historyTimeline()).toEqual([expect.objectContaining({ label: 'Создана страница', state: 'current' })]);
    addElement(rect('b'));
    switchPage(first);
    expect(historyTimeline().map(r => r.label)).toEqual(['Открыта страница']);
    expect(canUndo()).toBe(false);
  });

  it('при переполнении (200 правок) начало — «Самое раннее сохранённое состояние»', () => {
    for (let i = 0; i < 205; i++) addElement(rect(`r${i}`));
    const tl = historyTimeline();
    expect(tl).toHaveLength(201);
    expect(tl[0].label).toBe('Самое раннее сохранённое состояние');
    expect(tl[200]).toMatchObject({ label: 'Добавлен прямоугольник', state: 'current' });
  });
});

describe('jumpToHistory', () => {
  it('назад и вперёд повторными undo/redo; за пределами — к краю; дробный индекс — ничего', () => {
    addElement(rect('a'));
    addElement(rect('b'));
    addElement(rect('c'));
    jumpToHistory(1);
    expect(ids()).toEqual(['a']);
    expect(historyTimeline()[1].state).toBe('current');
    jumpToHistory(3);
    expect(ids()).toEqual(['a', 'b', 'c']);
    jumpToHistory(-5);
    expect(ids()).toEqual([]);
    jumpToHistory(99);
    expect(ids()).toEqual(['a', 'b', 'c']);
    jumpToHistory(1.5);
    expect(ids()).toEqual(['a', 'b', 'c']);
  });
});

describe('formatHistoryTime', () => {
  it('«только что», время сегодня, дата и время раньше', () => {
    const now = new Date(2026, 10, 19, 14, 5, 0).getTime();
    expect(formatHistoryTime(now - 30_000, now)).toBe('только что');
    expect(formatHistoryTime(new Date(2026, 10, 19, 9, 7).getTime(), now)).toBe('09:07');
    expect(formatHistoryTime(new Date(2026, 10, 18, 23, 59).getTime(), now)).toMatch(/18.*23:59$/);
  });
});

describe('вид «История изменений»', () => {
  const mount = () => {
    const host = document.createElement('div');
    document.body.append(host);
    const view = mountHistoryPanel(host);
    view.show?.();
    return { host, view };
  };
  const entries = (host: HTMLElement) => [...host.querySelectorAll<HTMLButtonElement>('.hist-entry')];

  it('режим: подпись и иконка', () => {
    expect(HISTORY_MODE).toMatchObject({ id: 'history', label: 'История изменений' });
    expect(HISTORY_MODE.icon).toContain('<svg');
  });

  it('пусто — подсказка; кнопки недоступны', () => {
    const { host } = mount();
    expect(host.querySelector<HTMLElement>('.hist-empty')!.hidden).toBe(false);
    expect(host.querySelector('.hist-empty')!.textContent).toContain('Изменений пока нет');
    expect(host.querySelector<HTMLElement>('.hist-list')!.hidden).toBe(true);
    expect(host.querySelector('.hist-caption')!.textContent).toBe('Эта страница · текущий сеанс');
    expect(host.querySelector<HTMLButtonElement>('[data-act="undo"]')!.disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('[data-act="redo"]')!.disabled).toBe(true);
  });

  it('лента новыми сверху, текущее отмечено; щелчок по записи переходит к ней', async () => {
    const { host } = mount();
    addElement(rect('a'));
    addElement(rect('b', { shape: 'line' }));
    await frame();
    let list = entries(host);
    expect(list.map(b => b.querySelector('.hist-label')!.textContent)).toEqual(['Добавлена линия', 'Добавлен прямоугольник', 'Начало сеанса']);
    expect(list[0].getAttribute('aria-current')).toBe('step');
    expect(list.map(b => b.dataset.state)).toEqual(['current', 'done', 'done']);
    expect(list[0].querySelector('time')!.textContent).toBe('только что');
    list[2].click();
    expect(ids()).toEqual([]);
    await frame();
    list = entries(host);
    expect(list.map(b => b.dataset.state)).toEqual(['undone', 'undone', 'current']);
    list[0].click();
    expect(ids()).toEqual(['a', 'b']);
  });

  it('«Отменить» и «Повторить» — как кнопки шапки', async () => {
    const { host } = mount();
    addElement(rect('a'));
    await frame();
    const undoBtn = host.querySelector<HTMLButtonElement>('[data-act="undo"]')!;
    const redoBtn = host.querySelector<HTMLButtonElement>('[data-act="redo"]')!;
    expect(undoBtn.disabled).toBe(false);
    undoBtn.click();
    expect(ids()).toEqual([]);
    await frame();
    expect(redoBtn.disabled).toBe(false);
    redoBtn.click();
    expect(ids()).toEqual(['a']);
  });

  it('без права правки — записи и кнопки недоступны, щелчок ничего не делает', async () => {
    setPanelActions(actions({ canEdit: () => false }));
    const { host } = mount();
    addElement(rect('a'));
    await frame();
    const list = entries(host);
    expect(list[1].getAttribute('aria-disabled')).toBe('true');
    expect(list[1].title || list[1].dataset.tip).toBe('Нет права на правку этой страницы');
    list[1].click();
    expect(ids()).toEqual(['a']);
    expect(host.querySelector<HTMLButtonElement>('[data-act="undo"]')!.disabled).toBe(true);
  });

  it('скрытый вид не перерисовывается; показ — сразу актуален', async () => {
    const { host, view } = mount();
    view.hide?.();
    addElement(rect('a'));
    await frame();
    expect(entries(host)).toHaveLength(0);
    view.show?.();
    expect(entries(host)).toHaveLength(2);
    view.focus?.();
    expect(document.activeElement).toBe(entries(host)[0]);
  });
});
