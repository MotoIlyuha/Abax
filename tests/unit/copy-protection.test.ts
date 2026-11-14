import { beforeEach, describe, expect, it } from 'vitest';
import { CLIP_MIME, copySelection, cutSelection, duplicateSelection, pasteFromMemory } from '../../src/clipboard';
import {
  addElement, blankProject, canCloneCurrentProject, canCopyCurrentBoard, duplicateSelected, openProject, setSelection, state,
} from '../../src/state';
import type { Project, ProjectPermissions, PlanTier, ShapeEl } from '../../src/types';

const rect = (id: string): ShapeEl =>
  ({ id, type: 'shape', shape: 'rect', x: 0, y: 0, w: 10, h: 10, color: '#000000', width: 2 });

function fakeData(): DataTransfer & { store: Record<string, string> } {
  const store: Record<string, string> = {};
  return { store, setData: (t: string, v: string) => { store[t] = v; }, getData: (t: string) => store[t] ?? '' } as never;
}

/** Открывает проект автора с одним выделенным элементом. */
function openWith(plan: PlanTier | undefined, permissions?: ProjectPermissions): void {
  const p: Project = { ...blankProject('Тест'), ...(plan ? { ownerPlan: plan } : {}), ...(permissions ? { permissions } : {}) };
  openProject(p);
  state.camera = { x: 0, y: 0, zoom: 1 };
  state.collabRole = null;
  state.linkMode = null;
  addElement(rect('a'));
  setSelection(['a']);
}

beforeEach(() => openWith('pro'));

describe('защита от копирования', () => {
  it('автор и хост копируют всегда, даже при запретах', () => {
    openWith('pro', { allowCopy: false, forbidClone: true });
    expect(canCopyCurrentBoard()).toBe(true);
    state.collabRole = 'host';
    expect(canCopyCurrentBoard()).toBe(true);
    const data = fakeData();
    expect(copySelection(data)).toBe(true);
    expect(data.store[CLIP_MIME]).toBeTruthy();
    expect(duplicateSelection()).toBe(true);
    expect(state.board.elements).toHaveLength(2);
  });

  it('гость при allowCopy: false не копирует, не вырезает и не дублирует', () => {
    openWith('pro', { allowCopy: false });
    state.collabRole = 'guest';
    const before = state.board.elements;
    const data = fakeData();
    expect(canCopyCurrentBoard()).toBe(false);
    expect(copySelection(data)).toBe(false);
    expect(cutSelection(data)).toBe(false);
    expect(duplicateSelection()).toBe(false);
    expect(duplicateSelected(5, 5)).toBe(false);
    expect(data.store).toEqual({});
    expect(state.board.elements).toBe(before); // вырезание ничего не удалило
  });

  it('forbidClone: true запрещает копирование элементов зрителю по ссылке', () => {
    openWith('tutor', { forbidClone: true });
    state.linkMode = 'view-project';
    expect(canCopyCurrentBoard()).toBe(false);
    expect(copySelection(fakeData())).toBe(false);
  });

  it('гостю разрешено, пока автор не запретил', () => {
    openWith('pro', {});
    state.collabRole = 'guest';
    expect(canCopyCurrentBoard()).toBe(true);
    expect(copySelection(fakeData())).toBe(true);
    expect(duplicateSelection()).toBe(true);
  });

  it('на free запреты не действуют, даже если записаны в проект', () => {
    openWith('free', { allowCopy: false, forbidClone: true });
    state.collabRole = 'guest';
    expect(canCopyCurrentBoard()).toBe(true);
    expect(canCloneCurrentProject()).toBe(true);
    openWith(undefined, { allowCopy: false });
    state.collabRole = 'guest';
    expect(canCopyCurrentBoard()).toBe(true);
  });

  it('неудавшееся копирование не стирает прежний буфер', () => {
    expect(copySelection(fakeData())).toBe(true);
    openWith('pro', { allowCopy: false });
    state.collabRole = 'guest';
    expect(copySelection(fakeData())).toBe(false);
    // прежний буфер остаётся (запрет защищает доску, а не память окна)
    state.collabRole = null;
    expect(pasteFromMemory({ x0: -100, y0: -100, x1: 100, y1: 100 })).toBe(true);
  });
});

describe('защита от клонирования', () => {
  it('автор клонирует всегда', () => {
    openWith('pro', { forbidClone: true });
    expect(canCloneCurrentProject()).toBe(true);
  });

  it('зритель проекта: запрещено при forbidClone', () => {
    openWith('pro', { forbidClone: true });
    state.linkMode = 'view-project';
    expect(canCloneCurrentProject()).toBe(false);
    openWith('pro', { forbidClone: false });
    state.linkMode = 'view-project';
    expect(canCloneCurrentProject()).toBe(true);
  });

  it('ссылка на одну страницу никогда не даёт клонировать', () => {
    openWith('pro', {});
    state.linkMode = 'view-page';
    expect(canCloneCurrentProject()).toBe(false);
  });

  it('гость совместной работы подчиняется forbidClone', () => {
    openWith('pro', { forbidClone: true });
    state.collabRole = 'guest';
    expect(canCloneCurrentProject()).toBe(false);
  });
});
