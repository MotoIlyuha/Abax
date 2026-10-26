import { afterEach, describe, expect, it, vi } from 'vitest';
import { easeInOut, linkCameras, lockInput, newPageLink, zoomDuration, zoomPath } from '../../src/page-links';
import { pageLinkView } from '../../src/geom';
import type { Camera, Element, Page } from '../../src/types';

const rect = (id: string, x: number, y: number, w: number, h: number): Element =>
  ({ id, type: 'shape', shape: 'rect', x, y, w, h, color: '#000000', width: 2 });
const page = (elements: Element[] = []): Page => ({ id: 'p2', name: 'Страница 2', grid: 'square', elements });
const onScreen = (cam: Camera, x: number, y: number) => ({ x: (x - cam.x) * cam.zoom, y: (y - cam.y) * cam.zoom });

describe('область страницы в превью', () => {
  it('пустая — вокруг начала координат, не меньше минимума, с нужным соотношением сторон', () => {
    const v = pageLinkView([], 16 / 10);
    expect((v.x0 + v.x1) / 2).toBeCloseTo(0);
    expect((v.y0 + v.y1) / 2).toBeCloseTo(0);
    expect(v.x1 - v.x0).toBe(640);
    expect((v.x1 - v.x0) / (v.y1 - v.y0)).toBeCloseTo(1.6);
    // высокое превью — минимум по высоте
    const tall = pageLinkView([], 0.5);
    expect(tall.y1 - tall.y0).toBe(1280);
    expect(tall.x1 - tall.x0).toBe(640);
  });

  it('содержимое целиком, с полями, по центру; соотношение сторон — как у превью', () => {
    const els = [rect('a', 0, 0, 1000, 200), rect('b', 1500, 900, 100, 100)];
    for (const aspect of [0.5, 1, 16 / 9, 4]) {
      const v = pageLinkView(els, aspect);
      expect(v.x0).toBeLessThanOrEqual(-80);
      expect(v.y0).toBeLessThanOrEqual(-80);
      expect(v.x1).toBeGreaterThanOrEqual(1680);
      expect(v.y1).toBeGreaterThanOrEqual(1080);
      expect((v.x1 - v.x0) / (v.y1 - v.y0)).toBeCloseTo(aspect);
      expect((v.x0 + v.x1) / 2).toBeCloseTo(800);
      expect((v.y0 + v.y1) / 2).toBeCloseTo(500);
    }
    // непонятное соотношение сторон — не ломается
    expect(Number.isFinite(pageLinkView(els, NaN).x1)).toBe(true);
  });
});

describe('новое превью страницы', () => {
  it('по центру точки отпускания, 320 px экрана, соотношение сторон холста, с рамкой', () => {
    const el = newPageLink('l1', page(), { x: 100, y: 50 }, { x: 0, y: 0, zoom: 2 }, 1600, 1000);
    expect(el).toMatchObject({ id: 'l1', type: 'image', src: '', page: 'p2', w: 160, h: 100, x: 20, y: 0 });
    expect(el.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(el.width).toBe(1);
    expect(el.radius).toBe(6);
  });
});

describe('камеры перехода', () => {
  const W = 1200, H = 800;
  const target = page([rect('a', 0, 0, 400, 300), rect('b', 600, 500, 50, 50)]);

  it('превью вписано в экран; страница на экране там же, где была в превью', () => {
    const el = newPageLink('l', target, { x: -500, y: 300 }, { x: 0, y: 0, zoom: 1 }, 1000, 1000);
    const { fill, target: cam } = linkCameras(el, target, W, H);
    // вписано: по одной стороне ровно экран, по другой — не больше
    const tl = onScreen(fill, el.x, el.y);
    const br = onScreen(fill, el.x + el.w, el.y + el.h);
    expect(Math.max(br.x - tl.x - W, br.y - tl.y - H)).toBeCloseTo(0);
    expect(br.x - tl.x).toBeLessThanOrEqual(W + 1e-6);
    expect((tl.x + br.x) / 2).toBeCloseTo(W / 2);
    expect((tl.y + br.y) / 2).toBeCloseTo(H / 2);
    // любая точка страницы: в превью (на холсте) и на открытой странице — одно место экрана
    const view = pageLinkView(target.elements, el.w / el.h);
    const s = el.w / (view.x1 - view.x0);
    for (const [px, py] of [[0, 0], [400, 300], [625, 525], [view.x0, view.y0], [view.x1, view.y1]]) {
      const inPreview = onScreen(fill, el.x + (px - view.x0) * s, el.y + (py - view.y0) * s);
      const onPage = onScreen(cam, px, py);
      expect(onPage.x).toBeCloseTo(inPreview.x, 6);
      expect(onPage.y).toBeCloseTo(inPreview.y, 6);
    }
  });
});

describe('путь камеры', () => {
  const a: Camera = { x: -300, y: -100, zoom: 0.8 };
  const b: Camera = { x: 250, y: 120, zoom: 3.2 };

  it('начало и конец — ровно камеры a и b; масштаб — по логарифму', () => {
    expect(zoomPath(a, b, 0)).toEqual(a);
    expect(zoomPath(a, b, 1)).toEqual(b);
    expect(zoomPath(a, b, -1)).toEqual(a);
    expect(zoomPath(a, b, 2)).toEqual(b);
    expect(zoomPath(a, b, 0.5).zoom).toBeCloseTo(Math.sqrt(a.zoom * b.zoom));
  });

  it('точка, общая для a и b на экране, весь путь стоит на месте', () => {
    const px = (b.x * b.zoom - a.x * a.zoom) / (b.zoom - a.zoom);
    const py = (b.y * b.zoom - a.y * a.zoom) / (b.zoom - a.zoom);
    const at0 = onScreen(a, px, py);
    for (const t of [0.1, 0.33, 0.5, 0.9]) {
      const p = onScreen(zoomPath(a, b, t), px, py);
      expect(p.x).toBeCloseTo(at0.x, 6);
      expect(p.y).toBeCloseTo(at0.y, 6);
    }
  });

  it('масштаб почти тот же — просто сдвиг', () => {
    const c = { x: 100, y: 50, zoom: 0.8 };
    expect(zoomPath(a, c, 0.5)).toEqual({ x: -100, y: -25, zoom: 0.8 });
  });

  it('длительность растёт с приближением, в пределах 0.42–0.9 с; плавный разгон и торможение', () => {
    expect(zoomDuration(a, a)).toBe(420);
    expect(zoomDuration(a, { ...a, zoom: a.zoom * 4 })).toBe(680);
    expect(zoomDuration(a, { ...a, zoom: a.zoom * 1e6 })).toBe(900);
    expect(zoomDuration(a, { ...a, zoom: a.zoom / 4 })).toBe(680);
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5);
    let prev = 0;
    for (let t = 0.05; t <= 1; t += 0.05) {
      expect(easeInOut(t)).toBeGreaterThanOrEqual(prev);
      prev = easeInOut(t);
    }
  });
});

describe('блокировка ввода на время перехода', () => {
  afterEach(() => document.body.replaceChildren());

  it('щит поверх окна; клавиши, указатель и колёсико не доходят; после снятия — снова доходят', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    const seen = vi.fn();
    for (const t of ['keydown', 'pointerdown', 'wheel', 'click']) document.addEventListener(t, seen);
    const unlock = lockInput();
    expect(document.activeElement).not.toBe(input); // фокус снят: ввод в поля не уходит
    expect(document.getElementById('input-lock')).not.toBeNull();
    expect(document.body.classList.contains('input-locked')).toBe(true);
    const key = new KeyboardEvent('keydown', { key: 'r', bubbles: true, cancelable: true });
    document.body.dispatchEvent(key);
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));
    document.body.dispatchEvent(new Event('wheel', { bubbles: true, cancelable: true }));
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(seen).not.toHaveBeenCalled();
    expect(key.defaultPrevented).toBe(true);
    unlock();
    expect(document.getElementById('input-lock')).toBeNull();
    expect(document.body.classList.contains('input-locked')).toBe(false);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
    expect(seen).toHaveBeenCalledTimes(1);
    for (const t of ['keydown', 'pointerdown', 'wheel', 'click']) document.removeEventListener(t, seen);
  });
});
