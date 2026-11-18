import type { Project } from './types';
import { blankPage, canCloneCurrentProject, onDraft, openProject, projectMeta, setTool, state, uid } from './state';
import { doskaApi, storage } from './storage';
import { getApi } from './api-client';
import { cloneOnServer, loadCloudView, loadInvite, type InviteView } from './link-view-cloud';
import { setSyncedRev } from './sync-state';
import { showCollabNotice } from './collab';
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
/** Проект открыт по ссылке с сервера: клонировать его можно и там. */
let fromCloud = false;
/** Просмотр открыт по приглашению: токен нужен серверу, чтобы скрыть страницы, закрытые именно приглашением. */
let viaInvite: string | null = null;

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
  // сначала сервер (там свежая версия и чужие проекты), на ошибку или 404 — копия на этом устройстве
  let loaded: Project | null = null;
  fromCloud = false;
  viaInvite = null;
  const api = getApi();
  if (api) {
    let res = await loadCloudView(api, route.projectId, route.mode === 'view-page' ? route.pageId : undefined);
    // такой страницы нет или она скрыта: покажем первую из видимых и сообщим об этом (как без сервера)
    if (!res.ok && res.reason === 'page-not-found') res = await loadCloudView(api, route.projectId);
    if (res.ok) { loaded = res.value.project; fromCloud = true; }
  }
  if (!loaded) loaded = await storage.load(route.projectId).catch(() => null);
  const res = resolveViewProject(route, loaded, () => blankPage('Страница 1'));
  missing = res.missing;
  state.linkMode = mode;
  openProject(res.project, res.pageId, 'board');
  setTool('pan');
  applyBodyClasses();
  renderBanner();
  if (res.notice && !res.missing) showToast(res.notice);
}

export const NOTICE_INVITE_GONE = ['Приглашение недействительно', 'Ссылка отозвана или устарела. Попросите автора прислать новую.'] as const;
export const NOTICE_INVITE_OFFLINE = ['Нет связи с сервером', 'Не удалось открыть приглашение. Проверьте подключение и откройте ссылку ещё раз.'] as const;

/** Почему ссылка не открылась — по коду сервера (SPEC_NIGHT6 §5.4); неизвестный код — «приглашение недействительно». */
export function inviteFailureNotice(reason: string, code?: string): readonly [string, string] {
  if (reason !== 'not-found') return NOTICE_INVITE_OFFLINE;
  switch (code) {
    case 'link-paused': return ['Доступ по ссылке закрыт', 'Автор закрыл доступ к доске по ссылке. Когда он откроет его снова, эта же ссылка заработает.'];
    case 'alias-released': return ['Адрес больше не используется', 'Автор освободил этот адрес. Попросите у него новую ссылку.'];
    case 'alias-inactive': return ['Адрес временно неактивен', 'Именной адрес доски сейчас не работает. Попросите автора прислать обычную ссылку.'];
    case 'board-deleted': return ['Доска удалена', 'Автор удалил эту доску.'];
    default: return NOTICE_INVITE_GONE;
  }
}

/**
 * Открывает приглашение /j/:token. true — проект открыт (пока только для чтения; подключение к комнате — в collab-guest),
 * false — приглашение не открылось (причина показана) или это ссылка самого автора: тогда запускается его обычная доска.
 */
export async function enterInvite(token: string): Promise<boolean> {
  const api = getApi();
  if (!api) {
    showCollabNotice('Ссылка не поддерживается', 'Приглашения по коду пока не работают. Попросите автора прислать ссылку заново.');
    return false;
  }
  const res = await loadInvite(api, token);
  if (!res.ok) {
    const [title, text] = inviteFailureNotice(res.reason, res.code);
    showCollabNotice(title, text);
    return false;
  }
  if (res.value.isOwner) return false;
  openInviteView(res.value, token);
  return true;
}

/** Приглашение открывается как просмотр: проект с сервера, только чтение (если в комнату подключиться не удалось). */
export function openInviteView(inv: InviteView, token: string): void {
  fromCloud = true;
  viaInvite = token;
  missing = false;
  state.linkMode = 'view-project';
  openProject(inv.project, inv.project.pages[0]?.id, 'board');
  setTool('pan');
  applyBodyClasses();
  renderBanner();
}

/** Выйти из режима просмотра (после клонирования). */
export function exitLinkView(): void {
  state.linkMode = null;
  missing = false;
  fromCloud = false;
  viaInvite = null;
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
  let clone: Project | null = null;
  let syncedRev: number | null = null;
  const api = getApi();
  if (api && fromCloud) {
    const r = await cloneOnServer(api, state.project.id, viaInvite ?? undefined);
    if (r.ok) { clone = r.project; syncedRev = r.rev; }
    else if (r.reason === 'clone-forbidden') { showToast('Автор запретил клонирование'); return; }
    else if (r.reason === 'plan-limit-projects') { showToast(LIMIT_PROJECTS_TEXT); return; }
    // сервер недоступен или проекта на нём нет — копия делается здесь, из того, что открыто
  }
  clone ??= cloneProjectForViewer(state.project, { plan: userPlan(), id: uid() });
  await storage.save(clone);
  if (syncedRev !== null) setSyncedRev(clone.id, syncedRev);
  state.projects = [projectMeta(clone), ...state.projects.filter(m => m.id !== clone.id)];
  exitLinkView();
  openProject(clone, undefined, 'board');
  try { localStorage.setItem('doska.last', JSON.stringify({ pid: clone.id, pageId: clone.pages[0].id })); } catch { /* не запомним */ }
  cleanAddress();
  hooks.fit();
  showToast('Проект сохранён на этом устройстве');
}
