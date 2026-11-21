// Безопасный Undo в комнате (D6, SPEC_NIGHT6 §4.6): чужие элементы не откатываются и не воскресают.
import { describe, expect, it } from 'vitest';
import { preserveForeign } from '../../src/state';
import type { Element } from '../../src/types';

const el = (id: string, by?: string, x = 0): Element => ({ id, type: 'shape', shape: 'rect', x, y: 0, w: 1, h: 1, color: '#000', width: 1, ...(by ? { by } : {}) } as Element);
const mine = (e: Element) => e.by === 'c:me';
const ids = (els: Element[]) => els.map(e => e.id);

describe('preserveForeign', () => {
  it('своё откатывается, чужое остаётся как сейчас', () => {
    const prev = [el('t', undefined, 0), el('m', 'c:me', 0)];
    const before = [el('t', undefined, 50), el('m', 'c:me', 9)];
    const out = preserveForeign(prev, before, mine);
    expect(out.find(e => e.id === 't')).toBe(before[0]);
    expect(out.find(e => e.id === 'm')).toBe(prev[1]);
  });
  it('удалённый автором чужой элемент не воскресает; созданный после снимка чужой - остаётся', () => {
    const prev = [el('t'), el('m', 'c:me')];
    const before = [el('m', 'c:me'), el('n', 'c:other')];
    expect(ids(preserveForeign(prev, before, mine))).toEqual(['m', 'n']);
  });
  it('своё удаление откатывается; своё новое пропадает', () => {
    const prev = [el('t'), el('m', 'c:me')];
    const before = [el('t'), el('x', 'c:me')];
    expect(ids(preserveForeign(prev, before, mine))).toEqual(['t', 'm']);
  });
  it('взаимный порядок чужих - как сейчас', () => {
    const prev = [el('a'), el('m', 'c:me'), el('b', 'c:o')];
    const before = [el('b', 'c:o'), el('m', 'c:me'), el('a')];
    const out = preserveForeign(prev, before, mine);
    expect(ids(out.filter(e => !mine(e)))).toEqual(['b', 'a']);
    expect(out).toHaveLength(3);
  });
  it('без чужих - тот же снимок по содержимому', () => {
    const prev = [el('m', 'c:me'), el('k', 'c:me')];
    expect(preserveForeign(prev, [], mine)).toEqual(prev);
  });
});
