import { describe, expect, it } from 'vitest';
import { recognizeInkShape } from '../../src/ink-shape';

type Point = { x: number; y: number };
const point = ([x, y]: number[]): Point => ({ x, y });

function stroke(vertices: number[][]): Point[] {
  const points = vertices.map(point);
  return points.slice(0, -1).flatMap((a, i) => {
    const b = points[i + 1];
    return Array.from({ length: 12 }, (_, j) => ({
      x: a.x + (b.x - a.x) * j / 12,
      y: a.y + (b.y - a.y) * j / 12,
    }));
  }).concat(points.slice(-1));
}

function rotate(points: Point[], angle: number): Point[] {
  return points.map(({ x, y }) => ({
    x: 300 + x * Math.cos(angle) - y * Math.sin(angle),
    y: -200 + x * Math.sin(angle) + y * Math.cos(angle),
  }));
}

describe('распознавание фигур из штрихов пера', () => {
  it.each([
    { name: 'скруглённые углы', shape: 'triangle', path: [[428,54],[399,83],[371,104],[333,143],[309,166],[297,182],[295,192],[295,204],[314,208],[515,208],[503,177],[482,132],[461,97],[429,55]] },
    { name: 'перехлёст у вершины', shape: 'triangle', path: [[389,344],[397,365],[411,395],[429,422],[445,457],[450,479],[450,488],[319,488],[294,484],[305,464],[331,426],[363,390],[389,360],[404,338]] },
    { name: 'незамкнутый неровный овал', shape: 'ellipse', path: [[155,600],[143,600],[123,608],[102,624],[86,647],[76,672],[73,698],[77,715],[89,728],[113,735],[145,739],[171,739],[202,732],[233,722],[254,708],[267,687],[274,662],[274,644],[264,623],[247,608],[218,592],[189,582],[163,578],[137,578],[124,582],[112,589]] },
    { name: 'прямоугольник с хвостиком', shape: 'rect', path: [[369,601],[365,606],[362,628],[353,652],[344,685],[337,724],[335,746],[346,746],[376,740],[410,735],[609,734],[611,731],[604,713],[601,692],[601,637],[600,629],[589,625],[578,623],[368,623]] },
  ])('распознаёт контур со скриншота в обе стороны: $name', ({ shape, path }) => {
    const points = stroke(path);
    for (const trace of [points, [...points].reverse(), rotate(points, 0.4)]) {
      expect(recognizeInkShape(trace, 1)).toMatchObject({ type: 'shape', shape });
    }
  });
  it('сохраняет концы линии и допускает небольшое дрожание', () => {
    const points = [[210, 180], [190, 166], [164, 151], [140, 130]].map(point);
    expect(recognizeInkShape(points, 1)).toEqual({ type: 'shape', shape: 'line', x: 210, y: 180, w: -70, h: -50 });
  });

  it('подбирает центр, полуоси и поворот неровного эллипса', () => {
    const oval = Array.from({ length: 65 }, (_, i) => {
      const t = 2 * Math.PI * (i / 64) ** 1.4;
      const wobble = 1 + 0.035 * Math.sin(t * 3);
      return { x: 65 * Math.cos(t) * wobble, y: 32 * Math.sin(t) * wobble };
    });
    const shape = recognizeInkShape(rotate(oval, 0.7), 1);
    expect(shape).toMatchObject({ type: 'shape', shape: 'ellipse' });
    if (shape?.type !== 'shape') return;
    expect(Math.abs(shape.x + shape.w / 2 - 300)).toBeLessThan(3);
    expect(Math.abs(shape.y + shape.h / 2 + 200)).toBeLessThan(3);
    expect(Math.abs(shape.w - 130)).toBeLessThan(4);
    expect(Math.abs(shape.h - 64)).toBeLessThan(4);
    expect(Math.abs(shape.rot! - 0.7)).toBeLessThan(0.08);
  });

  it('выпрямляет повёрнутый прямоугольник, начатый посреди стороны', () => {
    const points = stroke([[0, -30], [56, -30], [54, 29], [-56, 30], [-55, -29], [-2, -30]]);
    const shape = recognizeInkShape(rotate(points, 0.5), 1);
    expect(shape).toMatchObject({ type: 'shape', shape: 'rect' });
    if (shape?.type !== 'shape') return;
    expect(Math.abs(shape.x + shape.w / 2 - 300)).toBeLessThan(3);
    expect(Math.abs(shape.y + shape.h / 2 + 200)).toBeLessThan(3);
    const [short, long] = [shape.w, shape.h].sort((a, b) => a - b);
    expect(Math.abs(short - 60)).toBeLessThan(4);
    expect(Math.abs(long - 112)).toBeLessThan(4);
  });

  it('сохраняет наклон и размер равнобедренного треугольника', () => {
    const points = stroke([[0, -45], [50, 45], [-50, 45], [0, -45]]);
    const shape = recognizeInkShape(rotate(points, -0.5), 1);
    expect(shape).toMatchObject({ type: 'shape', shape: 'triangle' });
    if (shape?.type !== 'shape') return;
    expect(shape.w).toBeCloseTo(100);
    expect(shape.h).toBeCloseTo(90);
    expect(shape.rot).toBeCloseTo(-0.5);
  });

  it.each([
    [[0, 0], [100, 0], [0, 55]],
    [[0, 0], [90, 0], [90, 85], [54, 43], [0, 85]],
    [[0, 0], [85, 0], [100, 15], [100, 80], [0, 80]],
    Array.from({ length: 8 }, (_, i) => [60 * Math.cos(i * Math.PI / 4), 60 * Math.sin(i * Math.PI / 4)]),
  ].map(vertices => ({ vertices })))('сохраняет вершины замкнутого многоугольника ($vertices.length)', ({ vertices }) => {
    const shape = recognizeInkShape(stroke([...vertices, vertices[0]]), 1);
    expect(shape).toEqual({ type: 'poly', closed: true, pts: vertices.map(([x, y]) => ({ x, y, p: 0.5 })) });
  });

  it.each([
    [[0, 0]],
    [[0, 0], [7, 7]],
    [[0, 0], [80, 0], [80, 60], [0, 60]],
    [[0, 0], [80, 30], [40, 0], [60, 42], [0, 0]],
    [[0, 0], [90, 70], [0, 70], [90, 0], [0, 0]],
    [[0, 0], [100, 1], [70, 0], [120, 0]],
  ].map(vertices => ({ vertices })))('оставляет точку, незамкнутый контур или росчерк без преобразования', ({ vertices }) => {
    expect(recognizeInkShape(stroke(vertices), 1)).toBeNull();
  });

  it('учитывает экранный размер при разных масштабах', () => {
    expect(recognizeInkShape([[0, 0], [10, 0]].map(point), 1)).toBeNull();
    expect(recognizeInkShape([[0, 0], [10, 0]].map(point), 3)).toMatchObject({ type: 'shape', shape: 'line', w: 10 });
  });
});
