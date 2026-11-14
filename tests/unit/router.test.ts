import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildBoardUrl, computeFocusCamera, focusElementsOnBoard, linkModeOf, pagesVisibleForRoute, parseBoardUrl,
  routeAllowsCloneButton, routeShowsPagesDock, type RouteMatch,
} from '../../src/router';
import { addElement, blankProject, openProject, state } from '../../src/state';
import { bytesToBase64url } from '../../src/room-crypto';
import type { ShapeEl } from '../../src/types';

const rect = (id: string, x: number, y: number, w: number, h: number): ShapeEl =>
  ({ id, type: 'shape', shape: 'rect', x, y, w, h, color: '#000000', width: 2 });

const BASE = 'https://abax.example/app/';

describe('parseBoardUrl', () => {
  it('обычный адрес — без маршрута', () => {
    expect(parseBoardUrl(BASE)).toEqual({ mode: 'none' });
    expect(parseBoardUrl('мусор без схемы')).toEqual({ mode: 'none' });
    expect(parseBoardUrl('file:///C:/Abax/index.html')).toEqual({ mode: 'none' });
  });

  it('1. просмотр проекта: путь и параметры', () => {
    const want: RouteMatch = { mode: 'view-project', projectId: 'abc' };
    expect(parseBoardUrl('https://abax.example/p/abc')).toEqual(want);
    expect(parseBoardUrl('https://abax.example/app/p/abc/')).toEqual(want); // сайт в подпапке
    expect(parseBoardUrl('file:///C:/Abax/index.html?route=project&projectId=abc')).toEqual(want);
  });

  it('2. просмотр страницы', () => {
    const want: RouteMatch = { mode: 'view-page', projectId: 'abc', pageId: 'pg1' };
    expect(parseBoardUrl('https://abax.example/p/abc/pg1')).toEqual(want);
    expect(parseBoardUrl('https://abax.example/?route=page&projectId=abc&pageId=pg1')).toEqual(want);
  });

  it('3. фокус на объектах', () => {
    const want: RouteMatch = { mode: 'view-page', projectId: 'abc', pageId: 'pg1', focusIds: ['e1', 'e2'] };
    expect(parseBoardUrl('https://abax.example/p/abc/pg1?focus=e1,e2')).toEqual(want);
    expect(parseBoardUrl('https://abax.example/?route=page&projectId=abc&pageId=pg1&focus=e1,,e2,e1')).toEqual(want);
    // пустой focus — ссылка на страницу
    expect(parseBoardUrl('https://abax.example/p/abc/pg1?focus=')).toEqual({ mode: 'view-page', projectId: 'abc', pageId: 'pg1' });
    // focus без страницы не имеет смысла
    expect(parseBoardUrl('https://abax.example/p/abc?focus=e1')).toEqual({ mode: 'view-project', projectId: 'abc' });
  });

  it('4. совместная работа: токен, комната и приглашение через интернет', () => {
    expect(parseBoardUrl('https://abax.example/j/tok123')).toEqual({ mode: 'collab', token: 'tok123' });
    expect(parseBoardUrl('https://abax.example/?route=collab&token=tok123')).toEqual({ mode: 'collab', token: 'tok123' });
    expect(parseBoardUrl('http://192.168.0.5:5173/?room=ABC123')).toEqual({ mode: 'collab', roomCode: 'ABC123' });
    const key = new Uint8Array(32).map((_, i) => i);
    const room = 'A'.repeat(22);
    const m = parseBoardUrl(`https://abax.example/#relay=wss://relay.example&r=${room}&k=${bytesToBase64url(key)}`);
    expect(m.mode).toBe('collab');
    if (m.mode === 'collab') {
      expect(m.invite?.room).toBe(room);
      expect([...m.invite!.key]).toEqual([...key]);
    }
  });

  it('испорченное приглашение и пустые id — не маршрут', () => {
    expect(parseBoardUrl('https://abax.example/#relay=wss://relay.example&r=short&k=zzz')).toEqual({ mode: 'none' });
    expect(parseBoardUrl('https://abax.example/p/')).toEqual({ mode: 'none' });
    expect(parseBoardUrl('https://abax.example/?route=project')).toEqual({ mode: 'none' });
    expect(parseBoardUrl(`https://abax.example/p/${'x'.repeat(200)}`)).toEqual({ mode: 'none' });
    expect(parseBoardUrl('https://abax.example/p/%E0%A4%A')).toEqual({ mode: 'none' });
  });

  it('id с пробелами и кириллицей раскодируются', () => {
    expect(parseBoardUrl('https://abax.example/p/%D0%BF%D1%80%D0%BE%D0%B5%D0%BA%D1%82')).toEqual({ mode: 'view-project', projectId: 'проект' });
  });
});

describe('buildBoardUrl', () => {
  const routes: RouteMatch[] = [
    { mode: 'view-project', projectId: 'abc' },
    { mode: 'view-page', projectId: 'abc', pageId: 'pg 1' },
    { mode: 'view-page', projectId: 'abc', pageId: 'pg1', focusIds: ['e1', 'e2'] },
    { mode: 'collab', token: 'tok' },
    { mode: 'collab', roomCode: 'ROOM1' },
  ];

  it('по умолчанию — параметры, и разбор возвращает тот же маршрут', () => {
    for (const r of routes) {
      const url = buildBoardUrl(BASE, r);
      expect(url).toContain('?');
      expect(parseBoardUrl(url)).toEqual(r);
    }
    expect(buildBoardUrl('file:///C:/Abax/index.html', routes[0])).toBe('file:///C:/Abax/index.html?route=project&projectId=abc');
  });

  it('в виде путей — /p/… и /j/…', () => {
    expect(buildBoardUrl('https://abax.example/', routes[0], { style: 'path' })).toBe('https://abax.example/p/abc');
    expect(buildBoardUrl('https://abax.example/app/index.html', routes[2], { style: 'path' }))
      .toBe('https://abax.example/app/p/abc/pg1?focus=e1%2Ce2');
    expect(buildBoardUrl(BASE, routes[3], { style: 'path' })).toBe('https://abax.example/app/j/tok');
    for (const r of routes.slice(0, 4)) expect(parseBoardUrl(buildBoardUrl(BASE, r, { style: 'path' }))).toEqual(r);
  });

  it('приглашение через интернет остаётся в якоре, а прежние параметры отбрасываются', () => {
    const invite = { relayUrl: 'wss://relay.example', room: 'B'.repeat(22), key: new Uint8Array(32).fill(7), name: null };
    const url = buildBoardUrl(`${BASE}?route=project&projectId=x#старый`, { mode: 'collab', invite });
    expect(url.startsWith(`${BASE}#relay=`)).toBe(true);
    expect(url).not.toContain('route=');
    const back = parseBoardUrl(url);
    expect(back.mode === 'collab' && back.invite?.relayUrl).toBe('wss://relay.example');
  });

  it('без маршрута — только база', () => {
    expect(buildBoardUrl(`${BASE}?route=project&projectId=x`, { mode: 'none' })).toBe(BASE);
  });
});

describe('computeFocusCamera', () => {
  it('группа разных размеров: масштаб по меньшей стороне и центр по общей рамке', () => {
    // общая рамка 0…700 × 0…400, холст 1000×800, отступ 80 → доступно 840×640 → zoom = min(1.2, 1.6)
    const cam = computeFocusCamera([rect('a', 0, 0, 400, 200), rect('b', 600, 300, 100, 100)], 1000, 800)!;
    expect(cam.zoom).toBeCloseTo(1.2);
    expect(cam.x).toBeCloseTo(350 - 1000 / 2.4);
    expect(cam.y).toBeCloseTo(200 - 800 / 2.4);
    // центр рамки приходится на центр экрана
    expect((350 - cam.x) * cam.zoom).toBeCloseTo(500);
    expect((200 - cam.y) * cam.zoom).toBeCloseTo(400);
  });

  it('высокая группа ограничена по высоте', () => {
    const cam = computeFocusCamera([rect('a', 0, 0, 100, 1000)], 1000, 800)!;
    expect(cam.zoom).toBeCloseTo(0.64);
  });

  it('масштаб ограничен пределами 0.1…4', () => {
    expect(computeFocusCamera([rect('a', 0, 0, 10, 10)], 1000, 800)!.zoom).toBe(4);
    expect(computeFocusCamera([rect('a', 0, 0, 100000, 100000)], 1000, 800)!.zoom).toBe(0.1);
  });

  it('вырожденная рамка и пустой набор', () => {
    expect(computeFocusCamera([rect('a', 50, 50, 0, 0)], 1000, 800)!.zoom).toBe(4);
    expect(computeFocusCamera([], 1000, 800)).toBeNull();
    expect(computeFocusCamera([rect('a', 0, 0, 1, 1)], 0, 800)).toBeNull();
  });

  it('холст меньше двух отступов — считаем без отступа', () => {
    const cam = computeFocusCamera([rect('a', 0, 0, 100, 100)], 100, 100)!;
    expect(cam.zoom).toBeCloseTo(1);
  });

  it('отступ задаётся параметром', () => {
    const cam = computeFocusCamera([rect('a', 0, 0, 100, 100)], 300, 300, 50)!;
    expect(cam.zoom).toBeCloseTo(2);
  });
});

describe('focusElementsOnBoard', () => {
  beforeEach(() => {
    openProject(blankProject('Тест'));
    state.camera = { x: 0, y: 0, zoom: 1 };
    state.flashes = [];
    addElement(rect('a', 0, 0, 400, 200));
    addElement(rect('b', 600, 300, 100, 100));
    addElement(rect('c', 5000, 5000, 10, 10));
  });

  it('наводит камеру на найденные и подсвечивает их на 2 секунды', () => {
    expect(focusElementsOnBoard(['a', 'b', 'нет-такого'], 1000, 800)).toBe(true);
    expect(state.camera.zoom).toBeCloseTo(1.2);
    expect(state.flashes).toHaveLength(1);
    expect(state.flashes[0].ids).toEqual(['a', 'b']);
    expect(state.flashes[0].ms).toBe(2000);
  });

  it('ни одного элемента — камера на месте', () => {
    expect(focusElementsOnBoard(['нет'], 1000, 800)).toBe(false);
    expect(state.camera).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(state.flashes).toEqual([]);
  });
});

describe('режимы ссылок', () => {
  const project = () => {
    const p = blankProject('П');
    p.pages = [{ id: 'a', name: 'A', grid: 'square', elements: [] }, { id: 'b', name: 'B', grid: 'square', elements: [] }, { id: 'c', name: 'C', grid: 'square', elements: [] }];
    p.permissions = { pageRights: { b: 'hidden' } };
    return p;
  };

  it('проект: все не скрытые страницы; страница — только она', () => {
    expect(pagesVisibleForRoute({ mode: 'view-project', projectId: 'p' }, project()).map(p => p.id)).toEqual(['a', 'c']);
    expect(pagesVisibleForRoute({ mode: 'view-page', projectId: 'p', pageId: 'c' }, project()).map(p => p.id)).toEqual(['c']);
    // скрытую страницу по прямой ссылке не показываем
    expect(pagesVisibleForRoute({ mode: 'view-page', projectId: 'p', pageId: 'b' }, project())).toEqual([]);
    expect(pagesVisibleForRoute({ mode: 'none' }, project())).toHaveLength(3);
  });

  it('кнопка клонирования и док страниц', () => {
    expect(routeAllowsCloneButton({ mode: 'view-project', projectId: 'p' })).toBe(true);
    expect(routeAllowsCloneButton({ mode: 'view-page', projectId: 'p', pageId: 'a' })).toBe(false);
    expect(routeShowsPagesDock({ mode: 'view-page', projectId: 'p', pageId: 'a' })).toBe(false);
    expect(routeShowsPagesDock({ mode: 'view-project', projectId: 'p' })).toBe(true);
    expect(linkModeOf({ mode: 'view-page', projectId: 'p', pageId: 'a' })).toBe('view-page');
    expect(linkModeOf({ mode: 'collab', token: 't' })).toBeNull();
  });
});
