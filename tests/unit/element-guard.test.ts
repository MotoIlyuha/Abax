// Защита чужих элементов (SPEC_NIGHT6 §4): чистые правила хаба и сервера.
import { describe, expect, it } from 'vitest';
import { guardElementPut, guardPageReplace, guardPatch, withBy, type GuardWho } from '../../src/element-guard';
import type { Element, Page } from '../../src/types';
import type { BoardPatch } from '../../src/delta';

const rect = (id: string, by?: string, x = 0): Element => ({ id, type: 'shape', shape: 'rect', x, y: 0, w: 10, h: 10, color: '#000', width: 1, ...(by ? { by } : {}) } as Element);
const task = (by?: string): Element => ({
  id: 't', type: 'task', x: 0, y: 0, w: 100, h: 50, taskId: 'k', examType: 'custom', topic: '', statementMd: 'Условие', answer: '4', ...(by ? { by } : {}),
} as unknown as Element);
const page = (elements: Element[], extra: Partial<Page> = {}): Page => ({ id: 'p', name: 'Задачи', grid: 'square', elements, ...extra });
const patch = (ops: BoardPatch['ops'], extra: Partial<BoardPatch> = {}): BoardPatch => ({ t: 'patch', pageId: 'p', rev: 1, ops, ...extra });

const owner: GuardWho = { privileged: true, principal: null, protect: true };
const anna: GuardWho = { privileged: false, principal: 'u:anna', protect: true };
const annaOpen: GuardWho = { ...anna, protect: false };

describe('guardElementPut', () => {
  it('новый элемент участника получает его автора; присланный by не принимается', () => {
    expect(guardElementPut(undefined, rect('n', 'u:teacher'), anna)).toMatchObject({ by: 'u:anna' });
    expect(guardElementPut(undefined, rect('n'), { ...anna, principal: null })).toBeNull(); // при защите без автора — нет
    expect(guardElementPut(undefined, rect('n', 'u:x'), { ...annaOpen, principal: null })).not.toHaveProperty('by'); // без защиты — элемент владельца
  });
  it('свой элемент правится, автор не меняется; чужой при защите — нет, без защиты — да', () => {
    expect(guardElementPut(rect('a', 'u:anna'), rect('a', 'u:boris', 5), anna)).toMatchObject({ x: 5, by: 'u:anna' });
    expect(guardElementPut(rect('a'), rect('a', undefined, 5), anna)).toBeNull(); // элемент владельца (нет by)
    expect(guardElementPut(rect('a', 'u:boris'), rect('a', 'u:boris', 5), anna)).toBeNull();
    const open = guardElementPut(rect('a'), rect('a', 'u:anna', 5), annaOpen)!;
    expect(open).toMatchObject({ x: 5 });
    expect(open).not.toHaveProperty('by');
  });
  it('задание: участник отвечает в чужой карточке, но не меняет условие', () => {
    const t = guardElementPut(task(), { ...task(), statementMd: 'Подмена', studentDraft: 'мой ответ' } as unknown as Element, anna) as unknown as { statementMd: string; studentDraft: string };
    expect(t.statementMd).toBe('Условие');
    expect(t.studentDraft).toBe('мой ответ');
    expect(t).not.toHaveProperty('by');
  });
  it('владелец правит всё; автор известного элемента остаётся, ввод ученика — у хаба', () => {
    expect(guardElementPut(rect('a', 'u:anna'), rect('a', undefined, 7), owner)).toMatchObject({ x: 7, by: 'u:anna' });
    const known = { ...task(), studentDraft: 'черновик' } as Element;
    expect(guardElementPut(known, { ...task(), statementMd: 'Новое' } as unknown as Element, owner)).toMatchObject({ statementMd: 'Новое', studentDraft: 'черновик' });
  });
  it('withBy: тот же объект, если автор не меняется', () => {
    const el = rect('a', 'u:x');
    expect(withBy(el, 'u:x')).toBe(el);
    expect(withBy(el, undefined)).not.toHaveProperty('by');
  });
});

describe('guardPatch', () => {
  const known = page([rect('t1'), rect('a1', 'u:anna'), rect('b1', 'u:boris')]);
  it('удаление чужого и правка чужого отклоняются, своё проходит', () => {
    const r = guardPatch(known, patch([{ op: 'del', id: 't1' }, { op: 'del', id: 'a1' }, { op: 'put', el: rect('b1', 'u:boris', 9) }, { op: 'put', el: rect('n') }]), anna);
    expect(r.refused.ids).toEqual(['t1', 'b1']);
    expect(r.patch.ops).toEqual([{ op: 'del', id: 'a1' }, { op: 'put', el: rect('n', 'u:anna') }]);
  });
  it('порядок: свой элемент можно поднять, взаимный порядок чужих — нельзя', () => {
    expect(guardPatch(known, patch([{ op: 'order', ids: ['t1', 'b1', 'a1'] }]), anna).refused.order).toBe(false);
    expect(guardPatch(known, patch([{ op: 'order', ids: ['b1', 't1', 'a1'] }]), anna).refused.order).toBe(true);
  });
  it('настройки страницы при защите отклоняются; без защиты и у владельца — проходят', () => {
    const r = guardPatch(known, patch([], { grid: 'none', backgroundColor: '#fff' }), anna);
    expect(r.refused.page).toBe(true);
    expect(r.patch).not.toHaveProperty('grid');
    expect(guardPatch(known, patch([], { grid: 'none' }), annaOpen).patch.grid).toBe('none');
    expect(guardPatch(known, patch([], { grid: 'none' }), owner).patch.grid).toBe('none');
  });
  it('без защиты чужое правится и удаляется, как раньше', () => {
    const r = guardPatch(known, patch([{ op: 'del', id: 't1' }, { op: 'put', el: rect('b1', undefined, 3) }]), annaOpen);
    expect(r.refused.ids).toEqual([]);
    expect(r.patch.ops[1]).toEqual({ op: 'put', el: rect('b1', 'u:boris', 3) });
  });
});

describe('guardPageReplace', () => {
  const known = page([rect('t1'), rect('a1', 'u:anna'), rect('t2'), rect('b1', 'u:boris')]);
  it('с защитой: чужие остаются как у хаба, удалённые возвращаются на место, свои меняются', () => {
    const incoming = page([rect('a1', 'u:anna', 4), rect('t2', undefined, 99), rect('n')], { name: 'Подмена', grid: 'none' });
    const r = guardPageReplace(known, incoming, anna);
    expect(r.refused).toBe(true);
    expect(r.page.name).toBe('Задачи');
    expect(r.page.grid).toBe('square');
    // удалённый чужой встаёт сразу за своим прежним соседом снизу
    expect(r.page.elements.map(e => e.id)).toEqual(['t1', 'a1', 't2', 'b1', 'n']);
    expect(r.page.elements.find(e => e.id === 't2')).toEqual(rect('t2'));
    expect(r.page.elements.find(e => e.id === 'a1')).toMatchObject({ x: 4, by: 'u:anna' });
    expect(r.page.elements.find(e => e.id === 'n')).toMatchObject({ by: 'u:anna' });
  });
  it('с защитой: взаимный порядок чужих восстанавливается', () => {
    const incoming = page([rect('b1', 'u:boris'), rect('t2'), rect('a1', 'u:anna'), rect('t1')]);
    const r = guardPageReplace(known, incoming, anna);
    const foreign = r.page.elements.filter(e => e.by !== 'u:anna').map(e => e.id);
    expect(foreign).toEqual(['t1', 't2', 'b1']);
    expect(r.refused).toBe(true);
  });
  it('без защиты — страница участника (кроме заданий и авторов)', () => {
    const incoming = page([rect('b1', undefined, 2)], { name: 'Новое имя' });
    const r = guardPageReplace(known, incoming, annaOpen);
    expect(r.page.name).toBe('Новое имя');
    expect(r.page.elements).toEqual([rect('b1', 'u:boris', 2)]);
  });
  it('честная правка своего элемента при защите ничего не отклоняет', () => {
    const incoming = page(known.elements.map(e => (e.id === 'a1' ? rect('a1', 'u:anna', 8) : e)));
    expect(guardPageReplace(known, incoming, anna).refused).toBe(false);
  });
});
