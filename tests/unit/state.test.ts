import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addElement, addPage, applyStyleToSelection, beginStroke, blankPage, blankProject, bringForward, canRedo, canUndo,
  commitPoly, deletePage, deleteSelected, endStroke, expandSelectionWithGroups, extendStroke, groupSelected,
  moveItem, movePage, onChange, openProject, projectMeta, pushHistory, redo, renamePage, replaceElements, sendBackward, setGrid,
  presetKind, selectAll, selectPreset, setNoteColor, setSelection, setSettings, setSolidSides, setStyleColor, setStyleWidth, setTool, setView, state,
  switchPage, uid, undo, ungroupSelected, update, clampOpacity, opacityField, parseZoomPercent, removeImageFrames, setStyleOpacity,
  zoomAtPoint, ZOOM_MAX, ZOOM_MIN,
} from '../../src/state';
import type { Element, ImageEl, ShapeEl, SolidEl, TextEl } from '../../src/types';

const rect = (id: string, o: Partial<ShapeEl> = {}): ShapeEl =>
  ({ id, type: 'shape', shape: 'rect', x: 0, y: 0, w: 10, h: 10, color: '#000000', width: 2, ...o });
const ids = () => state.board.elements.map(e => e.id);

beforeEach(() => {
  const p = blankProject('Тест');
  openProject(p);
  state.camera = { x: 0, y: 0, zoom: 1 };
  setTool('pen');
  // пресеты живут между тестами: сеттеры стиля пишут в текущий
  state.presets.pen = { list: [{ color: '#1f2329', width: 4 }, { color: '#bd0a0a', width: 4 }, { color: '#305bab', width: 4 }], active: 0 };
  state.presets.highlighter = { list: [{ color: '#ffdc4a', width: 4 }, { color: '#2dc75c', width: 4 }, { color: '#ff6464', width: 4 }], active: 0 };
  state.presets.other = { list: [{ color: '#1f2329', width: 4 }], active: 0 };
  state.style = { color: '#1f2329', width: 4 };
});

describe('uid', () => {
  it('уникален', () => {
    expect(new Set(Array.from({ length: 100 }, uid)).size).toBe(100);
  });

  it('работает и без crypto.randomUUID', () => {
    vi.stubGlobal('crypto', {});
    try {
      expect(uid()).toMatch(/^id-/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('проекты и страницы', () => {
  it('blankProject — одна пустая страница с клеткой', () => {
    const p = blankProject('X');
    expect(p.name).toBe('X');
    expect(p.pages).toHaveLength(1);
    expect(p.pages[0]).toMatchObject({ name: 'Страница 1', grid: 'square', elements: [] });
    expect(blankPage('Y').name).toBe('Y');
  });

  it('projectMeta', () => {
    const p = blankProject('X');
    expect(projectMeta(p)).toEqual({ id: p.id, name: 'X', createdAt: p.createdAt, updatedAt: p.updatedAt, pageCount: 1 });
    // избранное попадает в метаданные, только когда проект закреплён
    expect(projectMeta({ ...p, pinned: true }).pinned).toBe(true);
    expect('pinned' in projectMeta({ ...p, pinned: undefined })).toBe(false);
  });

  it('moveItem переставляет копию списка', () => {
    const src = ['a', 'b', 'c', 'd'];
    expect(moveItem(src, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(src, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveItem(src, 1, 1)).toEqual(src);
    expect(moveItem(src, -1, 2)).toEqual(src);
    expect(moveItem(src, 0, 4)).toEqual(src);
    expect(src).toEqual(['a', 'b', 'c', 'd']); // исходный не тронут
  });

  it('movePage переставляет страницы, активная остаётся активной', () => {
    const first = state.board;
    const second = addPage();
    const third = addPage();
    switchPage(first.id);
    state.dirty = false;
    const calls = vi.fn();
    const off = onChange(calls);
    movePage(0, 2);
    off();
    expect(state.project.pages.map(p => p.id)).toEqual([second.id, third.id, first.id]);
    expect(state.pageId).toBe(first.id);
    expect(state.board).toBe(first);
    expect(state.dirty).toBe(true);
    expect(calls).toHaveBeenCalledTimes(1);
    // на месте или за пределами списка — ничего не меняется и не помечается
    state.dirty = false;
    const before = state.project;
    movePage(1, 1);
    movePage(0, 9);
    expect(state.project).toBe(before);
    expect(state.dirty).toBe(false);
  });

  it('openProject открывает нужную страницу и сбрасывает историю', () => {
    addElement(rect('a'));
    expect(canUndo()).toBe(true);
    const p = blankProject('Другой');
    p.pages.push({ id: 'second', name: 'Вторая', grid: 'dots', elements: [] });
    openProject(p, 'second');
    expect(state.pageId).toBe('second');
    expect(state.board.name).toBe('Вторая');
    expect(canUndo()).toBe(false);
    expect(state.dirty).toBe(false);
    openProject(p, 'нет такой');
    expect(state.pageId).toBe(p.pages[0].id);
  });

  it('addPage / switchPage / renamePage / deletePage', () => {
    const first = state.pageId;
    const page = addPage();
    expect(state.project.pages).toHaveLength(2);
    expect(page.name).toBe('Страница 2');
    expect(state.pageId).toBe(page.id);
    expect(state.dirty).toBe(true);

    switchPage(first);
    expect(state.pageId).toBe(first);
    switchPage('нет такой');
    expect(state.pageId).toBe(first);

    renamePage(page.id, 'Домашка');
    expect(state.project.pages[1].name).toBe('Домашка');

    deletePage(first);
    expect(state.project.pages.map(p => p.name)).toEqual(['Домашка']);
    expect(state.pageId).toBe(page.id);

    deletePage(page.id);
    expect(state.project.pages).toHaveLength(1);
    expect(state.project.pages[0].name).toBe('Страница 1');
  });

  it('после переименования активной страницы правки попадают в проект', () => {
    renamePage(state.pageId, 'Новое имя');
    expect(state.board.name).toBe('Новое имя');
    addElement(rect('a'));
    expect(state.project.pages[0].elements.map(e => e.id)).toEqual(['a']);
    // неактивная страница переименовывается, активная остаётся прежней
    const other = addPage();
    const firstId = state.project.pages[0].id;
    renamePage(firstId, 'Первая');
    expect(state.board).toBe(other);
  });

  it('setView', () => {
    setView('home');
    expect(state.view).toBe('home');
    setView('board');
    expect(state.view).toBe('board');
  });
});

describe('подписка и dirty', () => {
  it('onChange уведомляет и отписывается', () => {
    const fn = vi.fn();
    const off = onChange(fn);
    update();
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    update();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('update(true) помечает проект изменённым', () => {
    state.dirty = false;
    const before = state.project.updatedAt;
    vi.spyOn(Date, 'now').mockReturnValue(before + 1000);
    update(true);
    vi.restoreAllMocks();
    expect(state.dirty).toBe(true);
    expect(state.project.updatedAt).toBe(before + 1000);
  });
});

describe('история', () => {
  it('undo/redo элементов', () => {
    addElement(rect('a'));
    addElement(rect('b'));
    expect(ids()).toEqual(['a', 'b']);
    undo();
    expect(ids()).toEqual(['a']);
    expect(canRedo()).toBe(true);
    redo();
    expect(ids()).toEqual(['a', 'b']);
    undo(); undo();
    expect(ids()).toEqual([]);
    undo(); // пустой стек — без ошибок
    expect(canUndo()).toBe(false);
    redo(); redo(); redo();
    expect(ids()).toEqual(['a', 'b']);
  });

  it('новое действие очищает redo', () => {
    addElement(rect('a'));
    undo();
    addElement(rect('b'));
    expect(canRedo()).toBe(false);
  });

  it('undo снимает выделение', () => {
    addElement(rect('a'));
    setSelection(['a']);
    undo();
    expect(state.selection.size).toBe(0);
  });

  it('глубина истории ограничена 200 шагами', () => {
    for (let i = 0; i < 210; i++) pushHistory([]);
    let n = 0;
    while (canUndo()) { undo(); n++; }
    expect(n).toBe(200);
  });

  it('replaceElements не пишет в историю', () => {
    replaceElements([rect('x')]);
    expect(canUndo()).toBe(false);
  });
});

describe('выделение и стиль', () => {
  it('setSelection подхватывает общий цвет и толщину', () => {
    replaceElements([rect('a', { color: '#ff0000', width: 6 }), rect('b', { color: '#ff0000', width: 6 })]);
    setSelection(['a', 'b']);
    expect(state.style).toEqual({ color: '#ff0000', width: 6 });
  });

  it('разные цвета не меняют текущий', () => {
    replaceElements([rect('a', { color: '#ff0000' }), rect('b', { color: '#00ff00' })]);
    setSelection(['a', 'b']);
    expect(state.style.color).toBe('#1f2329');
  });

  it('стикер без цвета пера — стиль не трогаем', () => {
    replaceElements([{ id: 'n', type: 'note', x: 0, y: 0, w: 10, h: 10, text: 'x', color: '#ffe066' }]);
    setSelection(['n']);
    expect(state.style.color).toBe('#1f2329');
  });

  it('текст подхватывает цвет, но не толщину', () => {
    replaceElements([{ id: 't', type: 'text', x: 0, y: 0, text: 'x', size: 20, color: '#abcdef' }]);
    setSelection(['t']);
    expect(state.style).toEqual({ color: '#abcdef', width: 4 });
  });

  it('applyStyleToSelection красит линии, текст и рамку картинок, но не стикеры', () => {
    replaceElements([
      rect('a'),
      { id: 't', type: 'text', x: 0, y: 0, text: 'x', size: 20, color: '#000000' },
      { id: 'n', type: 'note', x: 0, y: 0, w: 10, h: 10, text: 'x', color: '#ffe066' },
      { id: 'i', type: 'image', x: 0, y: 0, w: 10, h: 10, src: 'data:' },
    ]);
    setSelection(['a', 't', 'n', 'i']);
    applyStyleToSelection({ color: '#ff0000', width: 9, bold: true, italic: true });
    const [a, t, n, i] = state.board.elements;
    expect(a).toMatchObject({ color: '#ff0000', width: 9 });
    expect(t).toMatchObject({ color: '#ff0000', bold: true, italic: true });
    expect((t as TextEl & { width?: number }).width).toBeUndefined();
    expect(n).toMatchObject({ color: '#ffe066' });
    expect(i).toMatchObject({ color: '#ff0000', width: 9 });
    expect(canUndo()).toBe(true);
  });

  it('у картинки цвет, толщина и прозрачность — рамка; недостающее берётся из текущего стиля', () => {
    const img: ImageEl = { id: 'i', type: 'image', x: 0, y: 0, w: 10, h: 10, src: 'data:' };
    replaceElements([img]);
    setSelection(['i']);
    state.style = { color: '#305bab', width: 3 };
    applyStyleToSelection({ opacity: 0.5 });
    expect(state.board.elements[0]).toMatchObject({ color: '#305bab', width: 3, opacity: 0.5 });
    applyStyleToSelection({ width: 6 });
    expect(state.board.elements[0]).toMatchObject({ color: '#305bab', width: 6, opacity: 0.5 });
    removeImageFrames();
    expect(state.board.elements[0]).toEqual(img);
    undo();
    expect(state.board.elements[0]).toMatchObject({ color: '#305bab', width: 6 });
  });

  it('removeImageFrames без рамок — без записи в историю', () => {
    replaceElements([{ id: 'i', type: 'image', x: 0, y: 0, w: 10, h: 10, src: 'data:' }, rect('a')]);
    setSelection(['i', 'a']);
    removeImageFrames();
    expect(canUndo()).toBe(false);
  });

  it('прозрачность: 1 не хранится, у стикеров её нет', () => {
    replaceElements([rect('a'), { id: 'n', type: 'note', x: 0, y: 0, w: 10, h: 10, text: 'x', color: '#ffe066' }]);
    setSelection(['a', 'n']);
    applyStyleToSelection({ opacity: 0.4 });
    expect(state.board.elements[0]).toMatchObject({ opacity: 0.4 });
    expect(state.board.elements[1]).not.toHaveProperty('opacity');
    applyStyleToSelection({ opacity: 1 });
    expect(state.board.elements[0]).not.toHaveProperty('opacity');
  });

  it('скругление — только у прямоугольников и картинок; 0 не хранится', () => {
    replaceElements([
      rect('a'), rect('e', { shape: 'ellipse' }), { id: 'i', type: 'image', x: 0, y: 0, w: 10, h: 10, src: 'data:' },
    ]);
    setSelection(['a', 'e', 'i']);
    applyStyleToSelection({ radius: 12 });
    const [a, e, i] = state.board.elements;
    expect(a).toMatchObject({ radius: 12 });
    expect(e).not.toHaveProperty('radius');
    expect(i).toMatchObject({ radius: 12 });
    expect(i).not.toHaveProperty('color'); // скругление рамку не добавляет
    applyStyleToSelection({ radius: 0 });
    expect(state.board.elements[0]).not.toHaveProperty('radius');
  });

  it('applyStyleToSelection: ничего не подошло — без записи в историю; history=false — продолжение жеста', () => {
    replaceElements([rect('e', { shape: 'ellipse' })]);
    setSelection(['e']);
    applyStyleToSelection({ radius: 10 });
    expect(canUndo()).toBe(false);
    applyStyleToSelection({ opacity: 0.8 });
    applyStyleToSelection({ opacity: 0.6 }, false);
    applyStyleToSelection({ opacity: 0.5 }, false);
    expect(state.board.elements[0]).toMatchObject({ opacity: 0.5 });
    undo();
    expect(state.board.elements[0]).not.toHaveProperty('opacity');
    expect(canUndo()).toBe(false);
  });

  it('setSelection подхватывает общую прозрачность и рамку картинки', () => {
    replaceElements([
      rect('a', { color: '#ff0000', width: 6, opacity: 0.5 }),
      { id: 'i', type: 'image', x: 0, y: 0, w: 10, h: 10, src: 'data:', color: '#ff0000', width: 6, opacity: 0.5 },
      { id: 'j', type: 'image', x: 0, y: 0, w: 10, h: 10, src: 'data:' },
    ]);
    setSelection(['a', 'i', 'j']);
    expect(state.style).toEqual({ color: '#ff0000', width: 6, opacity: 0.5 });
    replaceElements([rect('b', { opacity: undefined })]);
    setSelection(['b']);
    expect(state.style).not.toHaveProperty('opacity');
  });

  it('setStyleOpacity пишет в текущий пресет; непрозрачность 1 убирает поле', () => {
    setStyleOpacity(0.3);
    expect(state.style.opacity).toBe(0.3);
    expect(state.presets.pen.list[0].opacity).toBe(0.3);
    setStyleOpacity(1);
    expect(state.style).toEqual({ color: '#1f2329', width: 4 });
    expect(state.presets.pen.list[0]).toEqual({ color: '#1f2329', width: 4 });
  });

  it('clampOpacity и opacityField', () => {
    expect(clampOpacity(0.5)).toBe(0.5);
    expect(clampOpacity(0)).toBe(0.1);
    expect(clampOpacity(2)).toBe(1);
    expect(clampOpacity('x')).toBe(1);
    expect(clampOpacity(undefined)).toBe(1);
    expect(opacityField(0.5)).toEqual({ opacity: 0.5 });
    expect(opacityField(1)).toEqual({});
    expect(opacityField(undefined)).toEqual({});
  });

  it('applyStyleToSelection без подходящих элементов — без записи в историю', () => {
    replaceElements([{ id: 'n', type: 'note', x: 0, y: 0, w: 10, h: 10, text: 'x', color: '#ffe066' }]);
    setSelection(['n']);
    applyStyleToSelection({ color: '#ff0000' });
    expect(canUndo()).toBe(false);
    setSelection([]);
    applyStyleToSelection({ color: '#ff0000' });
    expect(canUndo()).toBe(false);
  });

  it('applyStyleToSelection: частичный патч текста', () => {
    replaceElements([{ id: 't', type: 'text', x: 0, y: 0, text: 'x', size: 20, color: '#000000' }]);
    setSelection(['t']);
    applyStyleToSelection({ italic: true });
    expect(state.board.elements[0]).toMatchObject({ color: '#000000', italic: true });
    expect(state.board.elements[0]).not.toHaveProperty('bold');
  });

  it('сеттеры стиля и настроек', () => {
    setStyleColor('#111111');
    setStyleWidth(7);
    setNoteColor('#a9def9');
    setSettings({ snapToGrid: true });
    expect(state.style).toEqual({ color: '#111111', width: 7 });
    expect(state.noteColor).toBe('#a9def9');
    expect(state.settings).toMatchObject({ snapToGrid: true, toolbarPos: 'left' });
  });

  it('пресеты: у пера и маркера свои, у остальных инструментов общий', () => {
    expect(presetKind('pen')).toBe('pen');
    expect(presetKind('highlighter')).toBe('highlighter');
    expect(presetKind('rect')).toBe('other');
    expect(presetKind('select')).toBe('other');
    selectPreset(1);
    expect(state.style).toEqual({ color: '#bd0a0a', width: 4 });
    setStyleWidth(6); // пишет в текущий пресет
    expect(state.presets.pen.list[1]).toEqual({ color: '#bd0a0a', width: 6 });
    selectPreset(5); // нет такого — без изменений
    expect(state.presets.pen.active).toBe(1);
    setTool('highlighter');
    expect(state.style).toEqual({ color: '#ffdc4a', width: 4 });
    setTool('rect');
    expect(state.style).toEqual({ color: '#1f2329', width: 4 });
    setStyleColor('#2dc75c');
    setTool('ellipse'); // тот же набор — стиль не перезагружается
    expect(state.style.color).toBe('#2dc75c');
    setTool('pen');
    expect(state.style).toEqual({ color: '#bd0a0a', width: 6 });
    setTool('select');
    expect(state.style.color).toBe('#2dc75c');
  });

  it('setGrid меняет фон страницы и помечает dirty', () => {
    state.dirty = false;
    setGrid('coord');
    expect(state.board.grid).toBe('coord');
    expect(state.project.pages[0].grid).toBe('coord');
    expect(state.dirty).toBe(true);
  });

  it('deleteSelected', () => {
    replaceElements([rect('a'), rect('b')]);
    deleteSelected(); // пустое выделение — ничего
    expect(ids()).toEqual(['a', 'b']);
    setSelection(['a']);
    deleteSelected();
    expect(ids()).toEqual(['b']);
    expect(state.selection.size).toBe(0);
    undo();
    expect(ids()).toEqual(['a', 'b']);
  });
});

describe('инструменты и живые объекты', () => {
  it('setTool сбрасывает живые объекты', () => {
    beginStroke('pen', { x: 0, y: 0, p: 0.5 });
    state.livePoly = { pts: [], cursor: null };
    setTool('rect');
    expect(state.tool).toBe('rect');
    expect(state.liveStroke).toBeNull();
    expect(state.livePoly).toBeNull();
    const fn = vi.fn();
    const off = onChange(fn);
    setTool('rect'); // тот же инструмент — без уведомления
    off();
    expect(fn).not.toHaveBeenCalled();
  });

  it('штрих пера: сглаживание и слияние близких точек', () => {
    beginStroke('pen', { x: 0, y: 0, p: 0.5 });
    extendStroke({ x: 10, y: 0, p: 0.5 });
    expect(state.liveStroke!.pts[1]).toEqual({ x: 6, y: 0, p: 0.5 });
    extendStroke({ x: 6.1, y: 0, p: 1 }); // ближе 0.4px — давление усредняется
    expect(state.liveStroke!.pts).toHaveLength(2);
    expect(state.liveStroke!.pts[1].p).toBe(0.75);
    endStroke();
    expect(state.liveStroke).toBeNull();
    expect(state.board.elements[0]).toMatchObject({ type: 'stroke', tool: 'pen', width: 4, color: '#1f2329' });
  });

  it('маркер шире пера', () => {
    beginStroke('highlighter', { x: 0, y: 0, p: 0.5 });
    endStroke();
    expect(state.board.elements[0]).toMatchObject({ tool: 'highlighter', width: 4 * 3.2 });
  });

  it('extendStroke/endStroke без начатого штриха — без эффекта', () => {
    extendStroke({ x: 1, y: 1, p: 0.5 });
    endStroke();
    expect(state.board.elements).toHaveLength(0);
  });

  it('commitPoly: открытая и замкнутая ломаные, дубли в конце убираются', () => {
    const p = (x: number, y: number) => ({ x, y, p: 0.5 });
    state.livePoly = { pts: [p(0, 0), p(10, 0), p(10, 0.5)], cursor: null };
    commitPoly(false);
    expect(state.board.elements[0]).toMatchObject({ type: 'poly', closed: false, width: 4 * 1.1 });
    expect((state.board.elements[0] as { pts: unknown[] }).pts).toHaveLength(2);

    state.livePoly = { pts: [p(0, 0), p(10, 0), p(10, 10)], cursor: null };
    commitPoly(true);
    expect(state.board.elements[1]).toMatchObject({ closed: true });

    state.livePoly = { pts: [p(0, 0), p(10, 0)], cursor: null };
    commitPoly(true); // мало точек для контура
    expect(state.board.elements).toHaveLength(2);
    commitPoly(false); // нет живой ломаной
    expect(state.board.elements).toHaveLength(2);
  });

  it('готовая ломаная сразу выделена, включено выделение', () => {
    setTool('poly');
    setStyleOpacity(0.5);
    const p = (x: number, y: number) => ({ x, y, p: 0.5 });
    state.livePoly = { pts: [p(0, 0), p(10, 0)], cursor: null };
    commitPoly(false);
    const [poly] = state.board.elements;
    expect(poly).toMatchObject({ opacity: 0.5 });
    expect(state.tool).toBe('select');
    expect([...state.selection]).toEqual([poly.id]);
  });

  it('штрих наследует прозрачность стиля', () => {
    setStyleOpacity(0.25);
    beginStroke('pen', { x: 0, y: 0, p: 0.5 });
    endStroke();
    expect(state.board.elements[0]).toMatchObject({ opacity: 0.25 });
  });

  it('setSolidSides меняет только призмы и пирамиды и ограничивает n', () => {
    const solid = (id: string, kind: SolidEl['solid']): SolidEl =>
      ({ id, type: 'solid', solid: kind, x: 0, y: 0, w: 10, d: 10, h: 10, color: '#000000', width: 2 });
    replaceElements([solid('p', 'prism'), solid('c', 'cube')]);
    setSelection(['p', 'c']);
    setSolidSides(20);
    expect((state.board.elements[0] as SolidEl).n).toBe(8);
    expect((state.board.elements[1] as SolidEl).n).toBeUndefined();
    const fn = vi.fn();
    const off = onChange(fn);
    setSolidSides(8.2); // то же значение — без записи и уведомлений
    off();
    expect(fn).not.toHaveBeenCalled();
    undo();
    expect((state.board.elements[0] as SolidEl).n).toBeUndefined();
    setSolidSides(8);
    undo();
    expect(canUndo()).toBe(false);
  });
});

describe('масштаб', () => {
  it('zoomAtPoint держит точку экрана на месте и ограничивает масштаб', () => {
    state.camera = { x: 100, y: 50, zoom: 1 };
    zoomAtPoint(2, 200, 100);
    // точка сцены под (200, 100) была (300, 150) — там же и осталась
    expect(state.camera).toEqual({ zoom: 2, x: 200, y: 100 });
    zoomAtPoint(1000, 0, 0);
    expect(state.camera.zoom).toBe(ZOOM_MAX);
    zoomAtPoint(0, 0, 0);
    expect(state.camera.zoom).toBe(ZOOM_MIN);
  });

  it('parseZoomPercent: число, проценты, запятая; ошибки — понятным текстом', () => {
    expect(parseZoomPercent('150')).toEqual({ zoom: 1.5 });
    expect(parseZoomPercent(' 80 % ')).toEqual({ zoom: 0.8 });
    expect(parseZoomPercent('87,5')).toEqual({ zoom: 0.875 });
    expect(parseZoomPercent('5')).toEqual({ zoom: 0.05 });
    expect(parseZoomPercent('3200%')).toEqual({ zoom: 32 });
    expect(parseZoomPercent('abc')).toEqual({ error: 'Введите число, например 150' });
    expect(parseZoomPercent('')).toEqual({ error: 'Введите число, например 150' });
    expect(parseZoomPercent('-20')).toHaveProperty('error');
    expect(parseZoomPercent('1e3')).toHaveProperty('error');
    expect(parseZoomPercent('4')).toEqual({ error: 'Масштаб — от 5 до 3200%' });
    expect(parseZoomPercent('3201')).toEqual({ error: 'Масштаб — от 5 до 3200%' });
  });
});

describe('selectAll', () => {
  it('выделяет все элементы страницы и включает выделение', () => {
    replaceElements([rect('a'), rect('b'), rect('c')]);
    setTool('pen');
    selectAll();
    expect([...state.selection]).toEqual(['a', 'b', 'c']);
    expect(state.tool).toBe('select');
  });

  it('на пустой странице ничего не меняет', () => {
    setTool('pen');
    selectAll();
    expect(state.selection.size).toBe(0);
    expect(state.tool).toBe('pen');
  });
});

describe('слои и группы', () => {
  beforeEach(() => replaceElements([rect('a'), rect('b'), rect('c'), rect('d')]));

  it('bringForward / sendBackward', () => {
    setSelection(['a']);
    bringForward();
    expect(ids()).toEqual(['b', 'a', 'c', 'd']);
    setSelection(['d']);
    sendBackward();
    expect(ids()).toEqual(['b', 'a', 'd', 'c']);
    setSelection(['b', 'a']);
    sendBackward(); // уже внизу — порядок не меняется
    expect(ids()).toEqual(['b', 'a', 'd', 'c']);
  });

  it('groupSelected / ungroupSelected', () => {
    setSelection(['a']);
    groupSelected(); // одного мало
    expect(state.board.elements.some(e => e.groupId)).toBe(false);
    setSelection(['a', 'c']);
    groupSelected();
    const gid = state.board.elements[0].groupId;
    expect(gid).toBeTruthy();
    expect(state.board.elements[2].groupId).toBe(gid);
    expect(expandSelectionWithGroups(new Set(['a']))).toEqual(['a', 'c']);
    expect(expandSelectionWithGroups(new Set(['b']))).toEqual(['b']);
    ungroupSelected();
    expect(state.board.elements.every((e: Element) => !('groupId' in e))).toBe(true);
    const fn = vi.fn();
    const off = onChange(fn);
    ungroupSelected(); // групп нет — без записи и уведомлений
    off();
    expect(fn).not.toHaveBeenCalled();
  });
});
