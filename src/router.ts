import type { Camera, Element, Page, Project } from './types';
import { aabbUnion, elementAABB } from './geom';
import { parseCloudInvite, type CloudInvite } from './collab-transport';
import { bytesToBase64url } from './room-crypto';
import { state, update } from './state';

// Ссылки на доску. Все виды понимаются в двух записях: путь (/p/…, /j/…) и параметры
// (?route=…) — вторая работает там, где путь недоступен: file:// в Electron, Capacitor, GitHub Pages.

/** Самый длинный допустимый идентификатор в ссылке (как MAX_ID в комнате). */
const MAX_ID = 128;
/** Камера при фокусе на элементах: пределы масштаба и отступ в пикселях экрана. */
export const FOCUS_ZOOM_MIN = 0.1;
export const FOCUS_ZOOM_MAX = 4;
export const FOCUS_PADDING = 80;
/** Сколько подсвечиваются элементы, на которые навели ссылкой, мс. */
export const FOCUS_FLASH_MS = 2000;

export type RouteMatch =
  /** Обычный запуск: ссылки на доску нет. */
  | { mode: 'none' }
  | { mode: 'view-project'; projectId: string }
  | { mode: 'view-page'; projectId: string; pageId: string; focusIds?: string[] }
  /**
   * Совместная работа: token — приглашение /j/:token, roomCode — ?room=КОД в локальной сети,
   * invite — #relay=…&r=…&k=… через интернет. Права по страницам в ссылке не передаются: их хранит автор.
   */
  | { mode: 'collab'; token?: string; roomCode?: string; invite?: CloudInvite };

export interface BuildOptions {
  /** 'query' — ?route=… (по умолчанию, работает везде); 'path' — /p/… и /j/… (нужен сервер с переписыванием путей). */
  style?: 'query' | 'path';
}

const NONE: RouteMatch = { mode: 'none' };

function validId(v: string | null | undefined): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_ID;
}

function decode(seg: string): string | null {
  try { return decodeURIComponent(seg); } catch { return null; }
}

/** Список id из `?focus=a,b`: без пустых и повторов. */
function parseFocus(raw: string | null): string[] | undefined {
  if (!raw) return undefined;
  const ids = [...new Set(raw.split(',').map(s => s.trim()).filter(validId))];
  return ids.length > 0 ? ids : undefined;
}

function pageRoute(projectId: string | null, pageId: string | null, focus: string | null): RouteMatch {
  if (!validId(projectId) || !validId(pageId)) return NONE;
  const focusIds = parseFocus(focus);
  return { mode: 'view-page', projectId, pageId, ...(focusIds ? { focusIds } : {}) };
}

/** Разбор адреса доски (абсолютного или относительного). Неразборчивое — { mode: 'none' }. */
export function parseBoardUrl(urlStr: string): RouteMatch {
  let u: URL;
  try { u = new URL(urlStr, 'http://abax.local/'); } catch { return NONE; }

  const invite = parseCloudInvite(u.hash);
  if (invite) return { mode: 'collab', invite };

  const room = u.searchParams.get('room');
  if (validId(room)) return { mode: 'collab', roomCode: room };

  const kind = u.searchParams.get('route');
  if (kind === 'project') {
    const id = u.searchParams.get('projectId');
    return validId(id) ? { mode: 'view-project', projectId: id } : NONE;
  }
  if (kind === 'page') return pageRoute(u.searchParams.get('projectId'), u.searchParams.get('pageId'), u.searchParams.get('focus'));
  if (kind === 'collab') {
    const token = u.searchParams.get('token');
    return validId(token) ? { mode: 'collab', token } : NONE;
  }

  // путь: всё до сегмента p или j — база (сайт может лежать в подпапке)
  const segs = u.pathname.split('/').filter(Boolean).map(decode);
  const i = segs.findIndex((s, k) => (s === 'p' || s === 'j') && segs[k + 1] != null);
  if (i < 0) return NONE;
  const [a, b] = [segs[i + 1], segs[i + 2]];
  if (segs[i] === 'j') return validId(a) ? { mode: 'collab', token: a } : NONE;
  if (!validId(a)) return NONE;
  if (b == null) return { mode: 'view-project', projectId: a };
  return pageRoute(a, b, u.searchParams.get('focus'));
}

/** Адрес для маршрута на основе baseUrl (его параметры и якорь отбрасываются). */
export function buildBoardUrl(baseUrl: string, route: RouteMatch, opts: BuildOptions = {}): string {
  const u = new URL(baseUrl, 'http://abax.local/');
  u.search = '';
  u.hash = '';
  const rel = !/^[a-z][a-z0-9+.-]*:/i.test(baseUrl);
  const finish = () => (rel ? u.pathname + u.search + u.hash : u.toString());
  if (route.mode === 'none') return finish();

  if (route.mode === 'collab' && route.invite) {
    const inv = route.invite;
    const p = new URLSearchParams({ relay: inv.relayUrl, r: inv.room, k: bytesToBase64url(inv.key) });
    if (inv.name) p.set('name', inv.name);
    u.hash = p.toString();
    return finish();
  }
  if (route.mode === 'collab' && route.roomCode) {
    u.searchParams.set('room', route.roomCode);
    return finish();
  }

  if (opts.style === 'path') {
    // «…/index.html» → «…/»: путь доски строится от каталога
    u.pathname = u.pathname.replace(/\/[^/]*\.[^/]*$/, '/').replace(/\/?$/, '/');
    const enc = encodeURIComponent;
    if (route.mode === 'collab') u.pathname += `j/${enc(route.token ?? '')}`;
    else if (route.mode === 'view-project') u.pathname += `p/${enc(route.projectId)}`;
    else {
      u.pathname += `p/${enc(route.projectId)}/${enc(route.pageId)}`;
      if (route.focusIds?.length) u.searchParams.set('focus', route.focusIds.join(','));
    }
    return finish();
  }

  if (route.mode === 'collab') {
    u.searchParams.set('route', 'collab');
    u.searchParams.set('token', route.token ?? '');
  } else if (route.mode === 'view-project') {
    u.searchParams.set('route', 'project');
    u.searchParams.set('projectId', route.projectId);
  } else {
    u.searchParams.set('route', 'page');
    u.searchParams.set('projectId', route.projectId);
    u.searchParams.set('pageId', route.pageId);
    if (route.focusIds?.length) u.searchParams.set('focus', route.focusIds.join(','));
  }
  return finish();
}

/**
 * Камера, в которой элементы els целиком видны на холсте viewportW×viewportH с отступом padding (px экрана),
 * масштаб — в пределах 0.1…4. null — нечего показывать или холст нулевой.
 */
export function computeFocusCamera(els: readonly Element[], viewportW: number, viewportH: number, padding = FOCUS_PADDING): Camera | null {
  if (els.length === 0 || !(viewportW > 0) || !(viewportH > 0)) return null;
  const bb = els.map(elementAABB).reduce(aabbUnion);
  const bw = bb.x1 - bb.x0, bh = bb.y1 - bb.y0;
  // холст меньше двух отступов: отступ только мешал бы
  const pad = Math.max(0, padding);
  const px = viewportW > pad * 2 ? pad : 0;
  const py = viewportH > pad * 2 ? pad : 0;
  const fits: number[] = [];
  if (bw > 0) fits.push((viewportW - px * 2) / bw);
  if (bh > 0) fits.push((viewportH - py * 2) / bh);
  const zoom = Math.min(FOCUS_ZOOM_MAX, Math.max(FOCUS_ZOOM_MIN, fits.length > 0 ? Math.min(...fits) : FOCUS_ZOOM_MAX));
  const cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2;
  return { zoom, x: cx - viewportW / (2 * zoom), y: cy - viewportH / (2 * zoom) };
}

/**
 * Наводит камеру на элементы активной страницы и подсвечивает их контур на 2 секунды.
 * Отсутствующие id пропускаются. false — ни одного элемента не нашлось, камера не тронута.
 */
export function focusElementsOnBoard(ids: readonly string[], viewportW: number, viewportH: number): boolean {
  const want = new Set(ids);
  const found = state.board.elements.filter(el => want.has(el.id));
  const camera = computeFocusCamera(found, viewportW, viewportH);
  if (!camera) return false;
  state.camera = camera;
  state.flashes.push({ ids: found.map(el => el.id), t: performance.now(), ms: FOCUS_FLASH_MS });
  update();
  return true;
}

/** Режим просмотра доски, соответствующий маршруту (для state.linkMode). */
export function linkModeOf(route: RouteMatch): 'view-project' | 'view-page' | null {
  return route.mode === 'view-project' || route.mode === 'view-page' ? route.mode : null;
}

/**
 * Страницы, которые маршрут показывает: ссылка на страницу — только её (и только если она не скрыта),
 * ссылка на проект — все, не скрытые автором. Остальные маршруты ничего не фильтруют.
 */
export function pagesVisibleForRoute(route: RouteMatch, project: Project): Page[] {
  const hidden = (p: Page) => project.permissions?.pageRights?.[p.id] === 'hidden';
  if (route.mode === 'view-page') return project.pages.filter(p => p.id === route.pageId && !hidden(p));
  if (route.mode === 'view-project') return project.pages.filter(p => !hidden(p));
  return project.pages;
}

/** Кнопка «Клонировать проект» показывается только на ссылке просмотра проекта. */
export function routeAllowsCloneButton(route: RouteMatch): boolean {
  return route.mode === 'view-project';
}

/** Док переключения страниц нужен везде, кроме ссылки на одну страницу. */
export function routeShowsPagesDock(route: RouteMatch): boolean {
  return route.mode !== 'view-page';
}
