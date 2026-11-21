import type { Page, Project } from './types';
import { buildBoardUrl, pagesVisibleForRoute, type RouteMatch } from './router';
import { cloneProjectForViewer } from './project-access';

// Просмотр доски по ссылке: какой проект и какие страницы показать, как собрать ссылку и как клонировать.
// Только данные — интерфейс в link-view-ui.ts.

/** Адрес веб-версии: от него строятся ссылки из приложения (у Electron адрес — file://). */
export const PUBLIC_WEB_URL = 'https://board.abaxboard.ru/';

export const NOTICE_NO_PROJECT = 'Проект недоступен на этом устройстве';
export const NOTICE_NO_PAGE = 'Страница не найдена';

/** База ссылок: в браузере — текущий адрес, в приложении и с file:// — адрес веб-версии. */
export function linkBaseUrl(loc: { protocol: string; origin: string; pathname: string }, inApp = false): string {
  if (inApp || loc.protocol === 'file:' || loc.origin === 'null') return PUBLIC_WEB_URL;
  return loc.origin + loc.pathname;
}

export type LinkKind = 'project' | 'page' | 'focus';

/** Ссылка на проект, страницу или объекты страницы; null — не хватает данных. */
export function boardLinkFor(base: string, kind: LinkKind, project: { id: string }, pageId: string, focusIds: readonly string[] = []): string | null {
  if (!project.id) return null;
  if (kind === 'project') return buildBoardUrl(base, { mode: 'view-project', projectId: project.id });
  if (!pageId) return null;
  if (kind === 'page') return buildBoardUrl(base, { mode: 'view-page', projectId: project.id, pageId });
  if (focusIds.length === 0) return null;
  return buildBoardUrl(base, { mode: 'view-page', projectId: project.id, pageId, focusIds: [...focusIds] });
}

export interface ViewResolution {
  /** Проект только с теми страницами, которые маршрут показывает. */
  project: Project;
  pageId: string;
  /** Сообщение зрителю (тост или плашка); null — всё нашлось. */
  notice: string | null;
  /** Проекта на этом устройстве нет. */
  missing: boolean;
}

/**
 * Что показать по ссылке просмотра. Скрытые автором страницы в проект зрителя не попадают.
 * Нет проекта — пустая доска; нет страницы — первая видимая и сообщение.
 */
export function resolveViewProject(route: RouteMatch, loaded: Project | null, blankPage: () => Page): ViewResolution {
  const viewRoute = route.mode === 'view-project' || route.mode === 'view-page' ? route : null;
  if (!viewRoute || !loaded) {
    const id = viewRoute?.projectId ?? '';
    const page = blankPage();
    const now = Date.now();
    return {
      project: { id, name: 'Проект', createdAt: now, updatedAt: now, pages: [page] },
      pageId: page.id, notice: NOTICE_NO_PROJECT, missing: true,
    };
  }
  let pages = pagesVisibleForRoute(route, loaded);
  let notice: string | null = null;
  if (viewRoute.mode === 'view-page' && pages.length === 0) {
    // нет такой страницы или она скрыта: показываем первую из видимых
    pages = pagesVisibleForRoute({ mode: 'view-project', projectId: loaded.id }, loaded).slice(0, 1);
    notice = NOTICE_NO_PAGE;
  }
  if (pages.length === 0) pages = [blankPage()];
  return { project: { ...loaded, pages }, pageId: pages[0].id, notice, missing: false };
}

export { cloneProjectForViewer };
