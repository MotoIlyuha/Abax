// Слой плашек объектов (SPEC_COMMENTS §1–4): пилюли реакций, «+n», кнопки у выделенного, счётчик комментариев.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { annotRowOf, closeReactionsMenu, HOLD_MS, reactionsMenuOpen, resetAnnotLayer, syncAnnotLayer } from '../../src/annot-layer';
import { setAnnotView } from '../../src/annot-prefs';
import { closeThread } from '../../src/comments-ui';
import { closeIconPicker } from '../../src/icon-picker';
import { createCommentThread } from '../../src/comments';
import { clientId, resetClientId } from '../../src/identity';
import { resetNotePeople, fallbackColor } from '../../src/note-people';
import { addElement, blankProject, openProject, setSelection, state } from '../../src/state';
import { cursorPreset } from '../../src/cursors';
import { myCursorId } from '../../src/profile';
import type { ShapeEl } from '../../src/types';

const rect = (id: string, x = 100, y = 100, extra: Partial<ShapeEl> = {}): ShapeEl =>
  ({ id, type: 'shape', shape: 'rect', x, y, w: 300, h: 50, color: '#000000', width: 2, ...extra });
const row = (id: string) => annotRowOf(id);
const pills = (id: string) => [...(row(id)?.querySelectorAll<HTMLButtonElement>('.an-pill') ?? [])];
const reactions = (id: string) => state.board.elements.find(e => e.id === id)!.reactions;

beforeEach(() => {
  document.body.innerHTML = '<div id="canvas-wrap"><canvas id="board"></canvas><div id="task-overlay"></div><div id="ctx-layer"></div></div>';
  localStorage.clear();
  resetClientId();
  resetNotePeople();
  resetAnnotLayer();
  closeThread();
  openProject(blankProject('Тест'));
  state.linkMode = null;
  state.view = 'board';
  state.camera = { x: 0, y: 0, zoom: 1 };
});
afterEach(() => { vi.useRealTimers(); });

describe('пилюли реакций', () => {
  it('яркий фон по плашке первого поставившего; своя — мой цвет, чужая без имени — цвет палитры', () => {
    addElement(rect('a', 100, 100, { reactions: { '👍': [clientId(), 'чужой'], '🔥': ['чужой'] } }));
    syncAnnotLayer();
    const [mine, other] = pills('a');
    expect(mine.textContent).toContain('👍');
    expect(mine.querySelector('.an-num')!.textContent).toBe('2');
    expect(mine.classList.contains('mine')).toBe(true);
    expect(mine.style.getPropertyValue('--an-bg')).toBe(cursorPreset(myCursorId()).badgeBg);
    expect(other.classList.contains('mine')).toBe(false);
    expect(other.querySelector('.an-x')).toBeNull();
    expect(other.style.getPropertyValue('--an-bg')).toBe(fallbackColor('чужой'));
    // подсказка — кто поставил
    expect(mine.title).toMatch(/^Вы, Участник\./);
    // строка — под правым нижним углом рамки
    expect(row('a')!.style.transform).toBe('translate(404.0px, 162.0px) translateX(-100%)');
  });

  it('× и удержание снимают свою реакцию; Delete на фокусе — тоже', () => {
    vi.useFakeTimers();
    addElement(rect('a', 100, 100, { reactions: { '👍': [clientId()], '🔥': [clientId()], '❤️': [clientId()] } }));
    syncAnnotLayer();
    (pills('a')[0].querySelector('.an-x') as HTMLElement).click();
    expect(Object.keys(reactions('a')!)).toEqual(['🔥', '❤️']);
    syncAnnotLayer();
    const fire = pills('a')[0];
    fire.dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true }));
    expect(fire.classList.contains('holding')).toBe(true);
    vi.advanceTimersByTime(HOLD_MS);
    expect(Object.keys(reactions('a')!)).toEqual(['❤️']);
    // щелчок после удержания не «привлекает внимание» и ничего не снимает
    fire.click();
    expect(Object.keys(reactions('a')!)).toEqual(['❤️']);
    syncAnnotLayer();
    pills('a')[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(reactions('a')).toBeUndefined();
    syncAnnotLayer();
    expect(row('a')).toBeNull();
  });

  it('короткое нажатие не снимает; щелчок по чужой — не снимает', () => {
    vi.useFakeTimers();
    addElement(rect('a', 100, 100, { reactions: { '👍': [clientId()], '🔥': ['чужой'] } }));
    syncAnnotLayer();
    const p = pills('a')[0];
    p.dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true }));
    vi.advanceTimersByTime(HOLD_MS - 100);
    p.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    vi.advanceTimersByTime(500);
    p.click();
    pills('a')[1].click();
    expect(reactions('a')).toEqual({ '👍': [clientId()], '🔥': ['чужой'] });
  });

  it('узкий объект: одна пилюля и «+n»; меню «+n» — все реакции и кто их поставил, × у своих', () => {
    addElement(rect('a', 100, 100, { w: 20, reactions: { '👍': ['x1'], '🔥': [clientId(), 'x2'], '❤️': ['x3'] } }));
    syncAnnotLayer();
    expect(pills('a')).toHaveLength(1);
    const more = row('a')!.querySelector<HTMLButtonElement>('.an-more')!;
    expect(more.textContent).toBe('+2');
    more.click();
    expect(reactionsMenuOpen()).toBe(true);
    const menu = document.getElementById('reactions-menu')!;
    expect([...menu.querySelectorAll('.arm-emoji')].map(b => b.textContent)).toEqual(['👍', '🔥', '❤️']);
    expect([...menu.querySelectorAll('.arm-row')][1].querySelectorAll('.arm-chip')).toHaveLength(2);
    expect(menu.querySelectorAll('.arm-remove')).toHaveLength(1);
    (menu.querySelector('.arm-remove') as HTMLElement).click();
    expect(reactions('a')!['🔥']).toEqual(['x2']);
    closeReactionsMenu(true);
    expect(reactionsMenuOpen()).toBe(false);
  });

  it('имена не превращаются в разметку', () => {
    state.board.comments = createCommentThread(state.board, { x: 0, y: 0, authorId: 'x1', authorName: '<img src=x onerror=1>', text: 'т' }).comments;
    addElement(rect('a', 100, 100, { w: 20, reactions: { '👍': ['x1'], '🔥': ['x2'] } }));
    syncAnnotLayer();
    row('a')!.querySelector<HTMLButtonElement>('.an-more')!.click();
    const chip = document.querySelector('#reactions-menu .arm-chip')!;
    expect(chip.textContent).toBe('<img src=x onerror=1>');
    expect(document.querySelector('#reactions-menu img')).toBeNull();
    closeReactionsMenu(true);
  });
});

describe('кнопки у выделенного и счётчик комментариев', () => {
  it('выделен один — «Поставить реакцию» и «Комментировать»; несколько — кнопок нет', () => {
    addElement(rect('a'));
    addElement(rect('b', 100, 400));
    syncAnnotLayer();
    expect(row('a')).toBeNull();
    setSelection(['a']);
    syncAnnotLayer();
    expect(row('a')!.querySelector('.an-react')).not.toBeNull();
    const c = row('a')!.querySelector<HTMLButtonElement>('.an-comment')!;
    expect(c.hidden).toBe(false);
    expect(c.classList.contains('an-counter')).toBe(false);
    expect(c.title).toBe('Комментировать');
    setSelection(['a', 'b']);
    syncAnnotLayer();
    expect(row('a')).toBeNull();
  });

  it('лента недавних: щелчок ставит реакцию; кнопка «Поставить реакцию» открывает окно смайлов', () => {
    addElement(rect('a'));
    setSelection(['a']);
    syncAnnotLayer();
    const recent = [...row('a')!.querySelectorAll<HTMLButtonElement>('.an-recent-btn')];
    expect(recent.map(b => b.textContent)).toEqual(['👍', '❤️', '🔥', '😂', '👏']);
    recent[2].click();
    expect(reactions('a')).toEqual({ '🔥': [clientId()] });
    syncAnnotLayer();
    // недавние: свежая — ближе всего к кнопке (первая в ленте)
    expect(row('a')!.querySelector('.an-recent-btn')!.textContent).toBe('🔥');
    row('a')!.querySelector<HTMLButtonElement>('.an-react')!.click();
    expect(document.getElementById('icon-picker')).not.toBeNull();
    closeIconPicker(true);
  });

  it('невыделенный объект с комментариями — счётчик на месте кнопки; решено — приглушён', () => {
    addElement(rect('a'));
    let page = createCommentThread(state.board, { x: 0, y: 0, targetElementId: 'a', authorId: 'u', authorName: 'А', text: '1' });
    state.board.comments = page.comments;
    syncAnnotLayer();
    const c = row('a')!.querySelector<HTMLButtonElement>('.an-comment')!;
    expect(c.classList.contains('an-counter')).toBe(true);
    expect(c.querySelector('.an-cnum')!.textContent).toBe('1');
    page = { ...state.board, comments: state.board.comments!.map(t => ({ ...t, resolved: true as const })) };
    state.board.comments = page.comments;
    syncAnnotLayer();
    expect(c.classList.contains('resolved')).toBe(true);
    expect(row('a')!.querySelector('.an-react')).toBeNull();
  });

  it('«Показывать реакции/комментарии» выключены — плашек нет, кнопки у выделенного остаются', () => {
    addElement(rect('a', 100, 100, { reactions: { '👍': ['u'] } }));
    state.board.comments = createCommentThread(state.board, { x: 0, y: 0, targetElementId: 'a', authorId: 'u', authorName: 'А', text: '1' }).comments;
    setAnnotView({ reactions: false, comments: false });
    syncAnnotLayer();
    expect(row('a')).toBeNull();
    setSelection(['a']);
    syncAnnotLayer();
    expect(pills('a')).toHaveLength(0);
    expect(row('a')!.querySelector('.an-react')).not.toBeNull();
    setAnnotView({ reactions: true, comments: true });
  });

  it('по ссылке просмотра слоя нет', () => {
    addElement(rect('a', 100, 100, { reactions: { '👍': ['u'] } }));
    state.linkMode = 'view-project';
    syncAnnotLayer();
    expect(row('a')).toBeNull();
  });
});
