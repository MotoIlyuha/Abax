import type { Project, ProjectMeta } from './types';
import { state, openProject, setSelection } from './state';
import { setStorage, storage, type BoardsStorage } from './storage';
import { CLOSE_PROTOCOL_MISMATCH, wsTransport, type CollabTransport } from './collab-transport';

/** Версия протокола сообщений; должна совпадать с PROTO в electron/room.cjs. */
export const PROTO = 1;

/** Событие на document, когда соединение закрылось; detail — код и причина. */
export interface CollabClosedDetail { code: number; reason: string }

export interface CollabUser {
  userId: number;
  name: string;
  color: string;
  host: boolean;
  away: boolean;
  cursor: { x: number; y: number } | null;
  pageId: string | null;
  selection: string[];
  rights: { default: string; pages: Record<string, string> };
}

let transport: CollabTransport | null = null;
let myUserId = -1;
let users: CollabUser[] = [];
let myRights: { default: string; pages: Record<string, string> } = { default: 'view', pages: {} };
let connected = false;
let role: 'host' | 'guest' = 'guest';


export function collabActive(): boolean { return connected; }
export function myColor(): string { return users.find(u => u.userId === myUserId)?.color || '#e03131'; }
export function myName(): string { return users.find(u => u.userId === myUserId)?.name || ''; }
export function isHost(): boolean { return role === 'host'; }
const cursorThrottle: { last: number; timer: number; pending: { x: number; y: number } | null } = { last: 0, timer: 0, pending: null };
const projectThrottle: { timer: number } = { timer: 0 };

/** Право на активной странице: edit / view / hidden. */
export function pageRight(pageId: string): 'edit' | 'view' | 'hidden' {
  if (role === 'host') return 'edit';
  const r: string = myRights.pages[pageId] ?? myRights.default ?? 'view';
  return r === 'edit' || r === 'hidden' ? r : 'view';
}
export function readOnly(pageId?: string): boolean {
  if (!connected || role === 'host') return false;
  return pageRight(pageId ?? state.pageId) !== 'edit';
}

function send(obj: unknown): void {
  transport?.send(JSON.stringify(obj));
}

/** Подключение к комнате по WebSocket (локальная сеть): имя, роль и версия протокола — в параметрах URL. */
export function startCollab(wsUrl: string, asHost: boolean, name: string): Promise<void> {
  const url = new URL(wsUrl);
  url.searchParams.set('name', encodeURIComponent(name || ''));
  url.searchParams.set('proto', String(PROTO));
  if (asHost) url.searchParams.set('host', '1');
  return connectCollab(wsTransport(url.toString()), asHost);
}

/** Подключение через любой транспорт; промис выполняется, когда канал открыт. */
export function connectCollab(t: CollabTransport, asHost: boolean): Promise<void> {
  role = asHost ? 'host' : 'guest';
  transport = t;
  // события от прежнего, уже заменённого канала не должны трогать текущее состояние
  const current = () => transport === t;
  return new Promise(resolve => {
    t.onopen = () => { if (!current()) return; connected = true; resolve(); };
    t.onmessage = data => {
      if (!current()) return;
      let m: Record<string, unknown>;
      try { m = JSON.parse(data); } catch { return; }
      if (m.t === 'init') {
        // сервер другой версии: дальнейшие сообщения могут значить не то, что мы думаем
        if (typeof m.proto === 'number' && m.proto !== PROTO) {
          closeWith(CLOSE_PROTOCOL_MISMATCH, 'protocol mismatch');
          return;
        }
        myUserId = m.userId as number;
        myRights = (m.rights as typeof myRights) || myRights;
        if (Array.isArray(m.users)) users = m.users as CollabUser[];
        if (m.project) applyRemoteProject(m.project as Project);
        renderRemoteCursors();
      } else if (m.t === 'users') {
        users = m.users as CollabUser[];
        renderRemoteCursors();
      } else if (m.t === 'rights') {
        myRights = (m.rights as typeof myRights) || myRights;
        // перерисовываем UI — тулбар и список страниц зависят от прав
        setSelection([...state.selection]);
      } else if (m.t === 'project') {
        if ((m.by as number) !== myUserId) applyRemoteProject(m.project as Project);
      }
    };
    t.onclose = (code, reason) => {
      if (!current()) return;
      connected = false;
      renderRemoteCursors();
      notifyClosed(code, reason);
    };
  });
}

function notifyClosed(code: number, reason: string): void {
  document.dispatchEvent(new CustomEvent<CollabClosedDetail>('doska:collab-closed', { detail: { code, reason } }));
}

/** Закрыть канал по своей причине (например, несовпадение версий) и сообщить об этом как о закрытии сервером. */
function closeWith(code: number, reason: string): void {
  const t = transport;
  transport = null;
  connected = false;
  t?.close();
  renderRemoteCursors();
  notifyClosed(code, reason);
}

function applyRemoteProject(project: Project): void {
  const keepPageId = state.pageId;
  const keepCam = { ...state.camera };
  openProject(project, keepPageId ?? undefined);
  state.camera = keepCam;
  setSelection([...state.selection]);
  document.dispatchEvent(new CustomEvent('doska:collab-project'));
}

/** Отправка позиции курсора (сцена) с троттлингом 40мс. */
export function noteCursor(x: number, y: number): void {
  if (!connected) return;
  cursorThrottle.pending = { x, y };
  const now = Date.now();
  if (now - cursorThrottle.last < 40) {
    if (!cursorThrottle.timer) {
      cursorThrottle.timer = window.setTimeout(() => {
        cursorThrottle.timer = 0;
        flushCursor();
      }, 40);
    }
    return;
  }
  flushCursor();
}
function flushCursor(): void {
  if (!cursorThrottle.pending) return;
  cursorThrottle.last = Date.now();
  send({ t: 'cursor', x: cursorThrottle.pending.x, y: cursorThrottle.pending.y, pageId: state.pageId });
  cursorThrottle.pending = null;
}

export function noteSelection(ids: string[]): void {
  if (!connected) return;
  send({ t: 'selection', ids, pageId: state.pageId });
}

/** Отправка проекта (дебаунс 250мс) — вызывается из storage.save сетевого режима. */
export function sendProject(project: Project): void {
  if (!connected) return;
  clearTimeout(projectThrottle.timer);
  projectThrottle.timer = window.setTimeout(() => send({ t: 'project', project }), 250);
}

/** Сетевое хранилище: save = отправка, load = из init-проекта. */
let netProject: Project | null = null;
document.addEventListener('doska:collab-project', () => { /* проект уже применён */ });
export function setNetProject(p: Project): void { netProject = p; }
export const netStorage = {
  async list(): Promise<ProjectMeta[]> {
    return netProject ? [{ id: netProject.id, name: netProject.name, createdAt: netProject.createdAt, updatedAt: netProject.updatedAt, pageCount: netProject.pages.length }] : [];
  },
  async load(id: string): Promise<Project | null> {
    return netProject && netProject.id === id ? netProject : null;
  },
  async save(project: Project): Promise<void> {
    netProject = project;
    sendProject(project);
  },
  async remove(): Promise<void> { /* в совместном режиме удаление недоступно */ },
};

/** Карточка с сообщением о совместной работе (справа под шапкой, как «Вышла новая версия»). */
export function showCollabNotice(title: string, text: string): void {
  document.getElementById('collab-notice')?.remove();
  const card = document.createElement('div');
  card.id = 'collab-notice';
  card.setAttribute('role', 'alert');
  const h = document.createElement('div');
  h.className = 'cn-title';
  h.textContent = title;
  const p = document.createElement('p');
  p.className = 'cn-text';
  p.textContent = text;
  card.append(h, p);
  document.body.appendChild(card);
}

/** Текст для гостя, если сервер закрыл соединение по известной причине; иначе null. */
export function closedNotice(code: number): { title: string; text: string } | null {
  if (code === CLOSE_PROTOCOL_MISMATCH) {
    return {
      title: 'Версии доски не совпадают',
      text: 'У автора установлена другая версия Abax. Попросите автора обновить приложение и прислать ссылку заново.',
    };
  }
  return null;
}

// ----- DOM-курсоры удалённых пользователей -----
let cursorsRoot: HTMLElement | null = null;

export function renderRemoteCursors(): void {
  const wrap = document.getElementById('canvas-wrap');
  if (!wrap) return;
  if (!cursorsRoot) {
    cursorsRoot = document.createElement('div');
    cursorsRoot.id = 'remote-cursors';
    wrap.appendChild(cursorsRoot);
  }
  const cam = state.camera;
  cursorsRoot.textContent = '';
  for (const u of users) {
    if (u.userId === myUserId || !u.cursor || u.pageId !== state.pageId) continue;
    const color = u.away ? '#9aa0ab' : u.color;
    const sx = (u.cursor.x - cam.x) * cam.zoom;
    const sy = (u.cursor.y - cam.y) * cam.zoom;
    const el = document.createElement('div');
    el.className = 'remote-cursor' + (u.away ? ' away' : '');
    el.style.left = `${sx}px`;
    el.style.top = `${sy}px`;
    el.innerHTML = `<i style="background:${color};border-color:${color}"></i><span style="background:${color}">${u.name}${u.away ? ' · Отошёл' : ''}</span>`;
    cursorsRoot.appendChild(el);
  }
}

/** Чужие выделения для отрисовки рамок (только активная страница). */
export function foreignSelections(): { color: string; ids: string[] }[] {
  if (!connected) return [];
  return users
    .filter(u => u.userId !== myUserId && u.pageId === state.pageId && u.selection.length > 0)
    .map(u => ({ color: u.away ? '#9aa0ab' : u.color, ids: u.selection }));
}

/** Локальное хранилище автора на время совместной работы (save дополнительно рассылает проект). */
let hostLocalStorage: BoardsStorage | null = null;

/** Подключение автора (host) к собственному серверу совместной работы. */
export async function startHostConnection(port: number, code: string, hostKey: string, name: string): Promise<void> {
  const q = new URLSearchParams({ code, key: hostKey });
  await startCollab(`ws://127.0.0.1:${port}/ws?${q}`, true, name);
  // правки автора уходят гостям тем же путём, что и автосохранение
  if (!hostLocalStorage) {
    const local = storage;
    hostLocalStorage = local;
    setStorage({ ...local, save: async project => { await local.save(project); sendProject(project); } });
  }
  sendProject(state.project);
}

export function stopCollab(): void {
  if (hostLocalStorage) { setStorage(hostLocalStorage); hostLocalStorage = null; }
  const t = transport;
  transport = null;
  t?.close();
  connected = false;
  users = [];
  renderRemoteCursors();
}

