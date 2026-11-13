import { describe, expect, it } from 'vitest';
import { canDropTool, toolDropElement } from '../../src/tool-drop';
import type { NoteEl, ShapeEl, SolidEl } from '../../src/types';

const style = { color: '#123456', width: 3 };
const at = { x: 200, y: 150 };

describe('перетаскивание инструментов на холст', () => {
  it('бросать можно фигуры, тела и стикер; рисующие инструменты — нет', () => {
    for (const id of ['rect', 'ellipse', 'triangle', 'line', 'arrow', 'poly', 'cube', 'box', 'prism', 'pyramid', 'truncPyramid', 'cylinder', 'cone', 'truncCone', 'sphere', 'note'] as const) {
      expect(canDropTool(id)).toBe(true);
    }
    for (const id of ['select', 'pen', 'highlighter', 'eraser', 'text', 'spread', 'laser'] as const) {
      expect(canDropTool(id)).toBe(false);
    }
  });

  it('стикер встаёт центром в точку броска со своим цветом', () => {
    const el = toolDropElement('note', 'n1', at, 1, style, '#ffe066') as NoteEl;
    expect(el).toMatchObject({ id: 'n1', type: 'note', color: '#ffe066', text: '' });
    expect(el.x).toBeLessThan(at.x);
    expect(el.y).toBeLessThan(at.y);
    expect(el.x + el.w / 2).toBeCloseTo(at.x);
    expect(el.y + el.h / 2).toBeCloseTo(at.y);
  });

  it('фигура центрируется и масштабируется вместе с зумом', () => {
    const a = toolDropElement('rect', 'r1', at, 1, style, '#ffe066') as ShapeEl;
    const b = toolDropElement('rect', 'r2', at, 2, style, '#ffe066') as ShapeEl;
    expect(a).toMatchObject({ type: 'shape', shape: 'rect', color: '#123456', width: 3 });
    expect(a.x + a.w / 2).toBeCloseTo(at.x);
    expect(a.y + a.h / 2).toBeCloseTo(at.y);
    expect(b.w).toBeCloseTo(a.w / 2);
    expect(b.h).toBeCloseTo(a.h / 2);
  });

  it('линия идёт снизу слева вверх направо', () => {
    const line = toolDropElement('arrow', 'a1', at, 1, style, '#ffe066') as ShapeEl;
    expect(line).toMatchObject({ shape: 'arrow' });
    expect(line.w).toBeGreaterThan(0);
    expect(line.h).toBeLessThan(0);
  });

  it('ломаная — зигзаг из иконки инструмента', () => {
    const el = toolDropElement('poly', 'p1', at, 1, style, '#ffe066');
    expect(el).toMatchObject({ type: 'poly', closed: false, color: '#123456' });
    if (el?.type !== 'poly') throw new Error('ожидалась ломаная');
    expect(el.pts).toHaveLength(5);
    expect(el.pts[2]).toMatchObject({ x: at.x, y: at.y + 40 });
  });

  it('стереометрическое тело получает вид, размеры и прозрачность', () => {
    const el = toolDropElement('sphere', 's1', at, 1, { ...style, opacity: 0.5 }, '#ffe066') as SolidEl;
    expect(el).toMatchObject({ type: 'solid', solid: 'sphere', color: '#123456', width: 3, opacity: 0.5 });
    expect(el.w).toBeGreaterThan(0);
    expect(el.h).toBeGreaterThan(0);
  });

  it('непригодный инструмент не создаёт объект', () => {
    expect(toolDropElement('pen', 'x', at, 1, style, '#ffe066')).toBeNull();
  });
});
