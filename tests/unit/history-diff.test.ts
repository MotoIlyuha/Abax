// Подписи шагов истории (src/history-diff.ts): склонения и все ветки describeChange.
import { describe, expect, it } from 'vitest';
import { describeChange, plural, pluralIndex } from '../../src/history-diff';
import type { Element, ImageEl, NoteEl, PolyEl, ShapeEl, SolidEl, StrokeEl, TaskEl, TextEl } from '../../src/types';

const rect = (id: string, o: Partial<ShapeEl> = {}): ShapeEl =>
  ({ id, type: 'shape', shape: 'rect', x: 0, y: 0, w: 10, h: 10, color: '#000000', width: 2, ...o });
const stroke = (id: string, o: Partial<StrokeEl> = {}): StrokeEl =>
  ({ id, type: 'stroke', tool: 'pen', color: '#000000', width: 2, pts: [{ x: 0, y: 0, p: 0.5 }, { x: 10, y: 5, p: 0.5 }], ...o });
const text = (id: string, o: Partial<TextEl> = {}): TextEl =>
  ({ id, type: 'text', x: 0, y: 0, text: 'Привет', size: 20, color: '#000000', ...o });
const note = (id: string): NoteEl => ({ id, type: 'note', x: 0, y: 0, w: 100, h: 100, text: '', color: '#ffe066' });
const image = (id: string, o: Partial<ImageEl> = {}): ImageEl => ({ id, type: 'image', x: 0, y: 0, w: 50, h: 40, src: 'data:image/png;base64,AA', ...o });
const poly = (id: string, closed: boolean): PolyEl => ({ id, type: 'poly', closed, color: '#000000', width: 2, pts: [{ x: 0, y: 0, p: 0.5 }, { x: 5, y: 5, p: 0.5 }] });
const solid = (id: string, kind: SolidEl['solid']): SolidEl => ({ id, type: 'solid', solid: kind, x: 0, y: 0, w: 10, d: 10, h: 10, color: '#000000', width: 2 });
const task = (id: string, o: Partial<TaskEl> = {}): TaskEl => ({
  id, type: 'task', x: 0, y: 0, w: 300, h: 200, taskId: 't', examType: 'oge', topic: 'Т', statementMd: 'Условие', answer: '1', ...o,
});
const many = <T extends Element>(n: number, make: (id: string) => T): T[] => Array.from({ length: n }, (_, i) => make(`e${i}`));

describe('склонение по числу', () => {
  it('1 / 2–4 / 5–20, 21, 22, 25, 111, 112', () => {
    const forms = ['объект', 'объекта', 'объектов'] as const;
    expect([1, 2, 4, 5, 11, 12, 14, 20, 21, 22, 25, 101, 111, 112, 0].map(n => plural(n, forms))).toEqual([
      'объект', 'объекта', 'объекта', 'объектов', 'объектов', 'объектов', 'объектов', 'объектов',
      'объект', 'объекта', 'объектов', 'объект', 'объектов', 'объектов', 'объектов',
    ]);
    expect(pluralIndex(-3)).toBe(1);
  });
});

describe('describeChange: добавление и удаление', () => {
  it('один элемент: глагол по роду существительного', () => {
    expect(describeChange([], [stroke('a')])).toBe('Добавлен рисунок');
    expect(describeChange([], [rect('a', { shape: 'line' })])).toBe('Добавлена линия');
    expect(describeChange([], [image('a')])).toBe('Добавлено изображение');
    expect(describeChange([text('a')], [])).toBe('Удалён текст');
    expect(describeChange([rect('a', { shape: 'arrow' })], [])).toBe('Удалена стрелка');
    expect(describeChange([task('a')], [])).toBe('Удалено задание');
  });

  it('названия всех типов: маркер, фигуры, ломаная, многоугольник, стикер, страница на холсте, тела, задание', () => {
    const one = (el: Element) => describeChange([], [el]);
    expect(one(stroke('a', { tool: 'highlighter' }))).toBe('Добавлен штрих маркера');
    expect(one(rect('a'))).toBe('Добавлен прямоугольник');
    expect(one(rect('a', { shape: 'ellipse' }))).toBe('Добавлен эллипс');
    expect(one(rect('a', { shape: 'triangle' }))).toBe('Добавлен треугольник');
    expect(one(poly('a', false))).toBe('Добавлена ломаная');
    expect(one(poly('a', true))).toBe('Добавлен многоугольник');
    expect(one(note('a'))).toBe('Добавлен стикер');
    expect(one(image('a', { page: 'p2', src: '' }))).toBe('Добавлена страница на холсте');
    expect(one(solid('a', 'cube'))).toBe('Добавлен куб');
    expect(one(solid('a', 'prism'))).toBe('Добавлена призма');
    expect(one(solid('a', 'truncPyramid'))).toBe('Добавлена усечённая пирамида');
    expect(one(task('a'))).toBe('Добавлено задание');
    expect(one({ id: 'x', type: 'future' } as unknown as Element)).toBe('Добавлен объект');
  });

  it('несколько одного типа — их название, разных — «объект»; согласование с числом', () => {
    expect(describeChange([], many(3, id => stroke(id)))).toBe('Добавлено 3 рисунка');
    expect(describeChange([], many(5, id => stroke(id)))).toBe('Добавлено 5 рисунков');
    expect(describeChange([], many(21, id => stroke(id)))).toBe('Добавлен 21 рисунок');
    expect(describeChange([], many(21, id => rect(id, { shape: 'line' })))).toBe('Добавлена 21 линия');
    expect(describeChange([], many(2, id => solid(id, 'truncPyramid')))).toBe('Добавлено 2 усечённые пирамиды');
    expect(describeChange([], [stroke('a'), rect('b'), text('c')])).toBe('Добавлено 3 объекта');
    expect(describeChange([stroke('a'), text('b')], [])).toBe('Удалено 2 объекта');
    expect(describeChange(many(11, id => text(id)), [])).toBe('Удалено 11 текстов');
  });
});

describe('describeChange: изменённые элементы', () => {
  it('перемещение: только x/y или точки, сдвинутые целиком', () => {
    const a = rect('a'), b = text('b');
    expect(describeChange([a, b], [{ ...a, x: 5, y: 7 }, b])).toBe('Перемещён прямоугольник');
    const s = stroke('s');
    const moved = { ...s, pts: s.pts.map(p => ({ ...p, x: p.x + 3, y: p.y - 2 })) };
    expect(describeChange([s], [moved])).toBe('Перемещён рисунок');
    expect(describeChange([a, s], [{ ...a, x: 1 }, { ...moved, baseId: 'img' }])).toBe('Перемещено 2 объекта');
    const four = many(4, id => rect(id));
    expect(describeChange(four, four.map(e => ({ ...e, x: e.x + 10 })))).toBe('Перемещено 4 прямоугольника');
  });

  it('размер: w/h или точки, сдвинутые неравномерно; основа с привязанными штрихами', () => {
    const a = rect('a');
    expect(describeChange([a], [{ ...a, w: 40, h: 30 }])).toBe('Изменён размер');
    const s = stroke('s');
    expect(describeChange([s], [{ ...s, pts: [s.pts[0], { x: 30, y: 15, p: 0.5 }] }])).toBe('Изменён размер');
    const img = image('i');
    expect(describeChange([img, s], [{ ...img, w: 100 }, { ...s, pts: s.pts.map(p => ({ ...p, x: p.x + 1 })) }]))
      .toBe('Изменён размер: 2 объекта');
  });

  it('текст, стиль, поворот, обрезка', () => {
    const t = text('t');
    expect(describeChange([t], [{ ...t, text: 'Пока', w: 120 }])).toBe('Изменён текст');
    expect(describeChange([t], [{ ...t, color: '#ff0000' }])).toBe('Изменён стиль');
    expect(describeChange([t], [{ ...t, runs: [{ n: 2, bold: true }] }])).toBe('Изменён стиль');
    const shapes = many(3, id => rect(id));
    expect(describeChange(shapes, shapes.map(e => ({ ...e, color: '#00ff00', width: 4 })))).toBe('Изменён стиль: 3 прямоугольника');
    const notes = [note('n1'), note('n2')];
    expect(describeChange(notes, notes.map(e => ({ ...e, text: 'х' })))).toBe('Изменён текст: 2 стикера');
    const a = rect('a');
    expect(describeChange([a], [{ ...a, rot: 0.5 }])).toBe('Повёрнут прямоугольник');
    const img = image('i');
    expect(describeChange([img], [{ ...img, crop: { x: 0.1, y: 0, w: 0.8, h: 1 }, w: 40 }])).toBe('Обрезано изображение');
  });

  it('группировка, закрепление слоя и порядок', () => {
    const [a, b] = [rect('a'), stroke('b')];
    expect(describeChange([a, b], [{ ...a, groupId: 'g' }, { ...b, groupId: 'g' }])).toBe('Сгруппировано 2 объекта');
    const ga = { ...a, groupId: 'g' }, gb = { ...b, groupId: 'g' };
    expect(describeChange([ga, gb], [a, b])).toBe('Разгруппировано 2 объекта');
    expect(describeChange([a, b], [b, a])).toBe('Изменён порядок');
    expect(describeChange([a, b], [b, { ...a, layerPin: 'top' }])).toBe('Изменён порядок');
  });

  it('прочие правки — «Изменён/Изменено …» по типу', () => {
    const t = task('t');
    expect(describeChange([t], [{ ...t, answer: '2', topic: 'Другая' }])).toBe('Изменено задание');
    const a = rect('a'), s = stroke('s');
    expect(describeChange([a, s], [{ ...a, color: '#ff0000' }, { ...s, pts: s.pts.map(p => ({ ...p, x: p.x + 1 })) }]))
      .toBe('Изменено 2 объекта');
    const p = solid('p', 'prism');
    expect(describeChange([p], [{ ...p, n: 5 }])).toBe('Изменена призма');
  });
});

describe('describeChange: без изменений и смешанное', () => {
  it('тот же массив, те же элементы в том же порядке — «Без изменений»', () => {
    const list = [rect('a'), text('b')];
    expect(describeChange(list, list)).toBe('Без изменений');
    expect(describeChange(list, [...list])).toBe('Без изменений');
    expect(describeChange([], [])).toBe('Без изменений');
  });

  it('ластик для пера: штрих заменён кусками — «Частично стёрт»', () => {
    expect(describeChange([stroke('s')], [stroke('s1'), stroke('s2')])).toBe('Частично стёрт рисунок');
    expect(describeChange([stroke('a'), stroke('b')], [stroke('c')])).toBe('Частично стёрто 2 рисунка');
  });

  it('добавлено, удалено и изменено вместе — части через запятую', () => {
    const a = rect('a');
    expect(describeChange([a, text('t')], [{ ...a, x: 9 }, stroke('s')])).toBe('Добавлен рисунок, удалён текст, перемещён прямоугольник');
    expect(describeChange([text('t')], [rect('r')])).toBe('Добавлен прямоугольник, удалён текст');
  });
});
