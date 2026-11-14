import type { Project } from './types';
import { blankPage, canCloneCurrentProject, onDraft, openProject, projectMeta, setTool, state, uid } from './state';
import { doskaApi, storage } from './storage';
import { isNativeApp } from './native';
import { canCreateProject } from './limits';
import { limitsEnforced, userPlan } from './plan';
import { focusElementsOnBoard, linkModeOf, type RouteMatch } from './router';
import {
  NOTICE_NO_PROJECT, boardLinkFor, cloneProjectForViewer, linkBaseUrl, resolveViewProject, type LinkKind,
} from './link-view';
import { showToast } from './about';

// Интерфейс просмотра по ссылке: плашка с «Клонировать проект», режим «только чтение», копирование ссылок.

export const LIMIT_PROJECTS_TEXT = 'На бесплатном тарифе доступно до 3 проектов';

let hooks: { fit(): void } = { fit() { /* до initApp камеры нет */ } };
let missing = false;

/** app.ts сообщает, как вписать доску в окно (камера зависит от размера холста). */
export function registerLinkViewHooks(h: { fit(): void }): void {
  hooks = h;
}

export function viewingByLink(): boolean {
  return state.linkMode !== null;
}

function banner(): HTMLElement {
  let b = document.getElementById('link-banner');
  if (!b) {
    b = document.createElement('div');
    b.id = 'link-banner';
    b.setAttribute('role', 'status');
    document.getElementById('canvas-wrap')!.appendChild(b);
  }
  return b;
}

function renderBanner(): void {
  const b = banner();
  b.textContent = '';
  if (!state.linkMode) { b.hidden = true; return; }
  b.hidden = false;
  const title = document.createElement('span');
  title.className = 'lb-title';
  title.textContent = missing ? NOTICE_NO_PROJECT : 'Режим просмотра';
  b.appendChild(title);
  if (!missing) {
    const name = document.createElement('span');
    name.className = 'lb-name';
    name.textContent = state.project.name;
    b.appendChild(name);
  }
  // клонировать можно только проект целиком и только если автор не запретил
  if (state.linkMode === 'view-project' && !missing && canCloneCurrentProject()) {
    const btn = document.createElement('button');
    btn.className = 'lb-clone';
    btn.type = 'button';
    btn.textContent = 'Клонировать проект';
    btn.addEventListener('click', () => { void cloneViewedProject(); });
    b.appendChild(btn);
  }
}

function applyBodyClasses(): void {
  document.body.classList.toggle('link-view', state.linkMode !== null);
  document.body.classList.toggle('link-view-page', state.linkMode === 'view-page');
}

/** Открывает доску в режиме просмотра по ссылке. Ничего не сохраняет и не трогает камеру в localStorage. */
export async function enterLinkView(route: RouteMatch): Promise<void> {
  const mode = linkModeOf(route);
  if (!mode || (route.mode !== 'view-project' && route.mode !== 'view-page')) return;
  const loaded = await storage.load(route.projectId).catch(() => null);
  const res = resolveViewProject(route, loaded, () => blankPage('Страница 1'));
  missing = res.missing;
  state.linkMode = mode;
  openProject(res.project, res.pageId, 'board');
  setTool('pan');
  applyBodyClasses();
  renderBanner();
  if (res.notice && !res.missing) showToast(res.notice);
}

/** Выйти из режима просмотра (после клонирования). */
export function exitLinkView(): void {
  state.linkMode = null;
  missing = false;
  applyBodyClasses();
  renderBanner();
}

/** Камера по ссылке: объекты из focus или вся страница. Ждёт, пока у холста появится размер. */
export function startLinkViewCamera(route: RouteMatch): void {
  const canvas = document.getElementById('board') as HTMLCanvasElement | null;
  if (!canvas) return;
  const focusIds = route.mode === 'view-page' ? route.focusIds : undefined;
  let tries = 0;
  const step = () => {
    const r = canvas.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) {
      if (++tries < 60) requestAnimationFrame(step);
      return;
    }
    if (focusIds && focusIds.length > 0 && focusElementsOnBoard(focusIds, r.width, r.height)) return;
    hooks.fit();
  };
  requestAnimationFrame(() => requestAnimationFrame(step));
}

function baseUrl(): string {
  return linkBaseUrl(location, !!doskaApi || isNativeApp());
}

/** Можно ли сейчас делать ссылки: настоящая страница своего проекта, не чужая доска. */
export function canMakeLinks(): boolean {
  return !onDraft() && state.collabRole !== 'guest' && state.linkMode === null;
}

export function currentBoardLink(kind: LinkKind): string | null {
  if (!canMakeLinks()) return null;
  return boardLinkFor(baseUrl(), kind, state.project, state.pageId, [...state.selection]);
}

/** Копирует ссылку на проект, страницу или выделенные объекты в буфер обмена. */
export async function copyBoardLink(kind: LinkKind): Promise<void> {
  const url = currentBoardLink(kind);
  if (!url) { showToast('Здесь ссылку сделать нельзя'); return; }
  try {
    await navigator.clipboard.writeText(url);
    showToast('Ссылка скопирована');
  } catch {
    showToast('Не удалось скопировать ссылку');
  }
}

/** Убирает из адреса параметры просмотра. */
function cleanAddress(): void {
  try { history.replaceState(null, '', location.pathname); } catch { /* адрес менять нельзя — не страшно */ }
}

/** «Клонировать проект»: копия зрителя сохраняется у него и открывается как обычный проект. */
export async function cloneViewedProject(): Promise<void> {
  if (state.linkMode !== 'view-project' || missing) return;
  if (!canCloneCurrentProject()) { showToast('Автор запретил клонирование'); return; }
  if (limitsEnforced() && !canCreateProject(userPlan(), state.projects.length)) { showToast(LIMIT_PROJECTS_TEXT); return; }
  const clone: Project = cloneProjectForViewer(state.project, { plan: userPlan(), id: uid() });
  await storage.save(clone);
  state.projects = [projectMeta(clone), ...state.projects.filter(m => m.id !== clone.id)];
  exitLinkView();
  openProject(clone, undefined, 'board');
  try { localStorage.setItem('doska.last', JSON.stringify({ pid: clone.id, pageId: clone.pages[0].id })); } catch { /* не запомним */ }
  cleanAddress();
  hooks.fit();
  showToast('Проект сохранён на этом устройстве');
}
