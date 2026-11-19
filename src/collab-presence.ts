import { state, onChange, onDraft, update } from './state';
import type { PageRight } from './types';
import {
  PRESENCE_EVENT, canSummon, collabActive, collabUsers, hostFollowEnabled, isHost, myCollabId, sendFollowHost, sendProjectNow, sendRemove,
  sendSummon, type CollabGotoDetail, type CollabUser,
} from './collab';
import { DEFAULT_CURSOR_ID, cursorPreset, cursorSvg, isCursorId } from './cursors';
import { computeEdgePointer, type SafeInsets } from './edge-pointer';
import { getParticipantInitials, pageAvatars } from './presence';
import { showPill } from './activity-pills';
import { PLAN_LIMITS } from './limits';
import { limitsEnforced, userPlan } from './plan';
import { FOLLOW_ICON, ICON_ARROW, ICONS, PROFILE_ICON, SUMMON_ICON } from './icons';
import { STATUS_TEXT, type AvatarData, type AvatarStatus } from './avatar';
import { createAvatarGroup, type AvatarGroup, type AvatarGroupItem } from './avatar-group';
import { closeAvatarMenu, openAvatarMenu, type AvatarMenuEntry } from './avatar-menu';
import { cursorShown, othersCursorsHidden, setOthersCursorsHidden, setUserCursorHidden, userCursorHidden } from './cursor-visibility';
import { myCursorId, profileName } from './profile';

// Присутствие участников (SPEC_NIGHT5 §8): краевые курсоры у границы экрана, аватары в шапке и у страниц,
// кнопки автора «Позвать всех сюда» и «Автопереход участников за мной». Имена и цвета приходят от других
// участников — только textContent, setAttribute и свойства style; SVG курсора — константы каталога.

/** Отступ краевого курсора от интерфейса (шапка, панель инструментов, док страниц), px. */
export const EDGE_PAD = 8;
/** Сколько чужих аватаров в шапке (кроме моего), дальше — «+N». */
const STRIP_MAX = 5;
/** Остриё стрелки каталога смотрит вверх-влево (по диагонали): поворот, при котором оно смотрит вдоль луча. */
const ARROW_ANGLE = -3 * Math.PI / 4;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

const validCursor = (u: CollabUser): string => (u.cursorId && isCursorId(u.cursorId) ? u.cursorId : DEFAULT_CURSOR_ID);

/** Цвета аватара участника: плашка его курсора; у старой версии без курсора — цвет хаба. */
export function avatarColors(u: Pick<CollabUser, 'cursorId' | 'color'>): { bg: string; fg: string } {
  if (u.cursorId && isCursorId(u.cursorId)) {
    const p = cursorPreset(u.cursorId);
    return { bg: p.badgeBg, fg: p.badgeText };
  }
  return { bg: /^#[0-9a-fA-F]{6}$/.test(u.color) ? u.color : '#868e96', fg: '#ffffff' };
}

function pageName(pageId: string | null): string | null {
  if (!pageId) return null;
  return state.project.pages.find(p => p.id === pageId)?.name ?? null;
}

/** Подпись участника для подсказки: имя, где он, «Отошёл». */
export function participantTitle(u: CollabUser): string {
  const parts = [String(u.name ?? '') || 'Участник'];
  if (u.host) parts[0] += ' (автор)';
  if (u.hiddenPage) parts.push('На скрытой странице');
  else {
    const name = pageName(u.pageId);
    if (name) parts.push(`страница «${name}»`);
  }
  if (u.away) parts.push('Отошёл');
  return parts.join(' · ');
}

/** Куда переходить к участнику: страница и точка (курсор с моим зумом, иначе центр его экрана с его зумом). */
export function gotoTarget(u: CollabUser, reason: CollabGotoDetail['reason']): CollabGotoDetail | null {
  if (u.hiddenPage || !u.pageId) return null;
  if (u.cursor) return { pageId: u.pageId, x: u.cursor.x, y: u.cursor.y, reason };
  if (u.view && u.view.pageId === u.pageId) return { pageId: u.pageId, x: u.view.vx, y: u.view.vy, zoom: u.view.vz, reason };
  return { pageId: u.pageId, reason };
}

function goTo(detail: CollabGotoDetail): void {
  document.dispatchEvent(new CustomEvent<CollabGotoDetail>('doska:collab-goto', { detail }));
}

/** Клик по участнику: к нему; на скрытой странице — только пилюля. */
export function goToParticipant(u: CollabUser, reason: CollabGotoDetail['reason']): void {
  if (u.hiddenPage) {
    showPill({ kind: 'info', text: u.host ? 'Автор сейчас на скрытой странице' : 'Участник сейчас на скрытой странице' });
    return;
  }
  const target = gotoTarget(u, reason);
  if (target) goTo(target);
}

/** Круглый аватар участника (1–2 буквы). */
export function makeAvatar(u: CollabUser, cls: string): HTMLButtonElement {
  const b = el('button', cls, getParticipantInitials(u.name));
  b.type = 'button';
  const { bg, fg } = avatarColors(u);
  b.style.background = u.away ? '#9aa0ab' : bg;
  b.style.color = u.away ? '#ffffff' : fg;
  const title = participantTitle(u);
  b.title = title;
  b.setAttribute('aria-label', title);
  if (u.hiddenPage) b.classList.add('on-hidden');
  if (u.away) b.classList.add('away');
  b.dataset.userId = String(u.userId);
  b.addEventListener('click', e => {
    e.stopPropagation();
    goToParticipant(u, 'avatar');
  });
  // перетаскивание карточки страницы не должно начинаться с аватара
  b.addEventListener('pointerdown', e => e.stopPropagation());
  return b;
}

// ----- Аватары у карточек страниц -----

/** Аватары участников на странице (до 3 + «+N»); перестраивается, только если состав изменился. */
export function fillPageAvatars(box: HTMLElement, pageId: string): void {
  const users = collabActive() ? collabUsers() : [];
  const { shown, more } = pageAvatars(users, pageId, myCollabId());
  const key = shown.map(u => `${u.userId}:${u.name}:${u.cursorId ?? ''}:${u.away ? 1 : 0}`).join(',') + `+${more}`;
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.textContent = '';
  for (const u of shown) box.appendChild(makeAvatar(u, 'page-avatar'));
  if (more > 0) box.appendChild(el('span', 'page-avatar more', `+${more}`));
  box.hidden = shown.length === 0;
}

// ----- Группа аватаров в шапке -----

let group: AvatarGroup | null = null;
/** Открыть настройки профиля (передаёт приложение). */
let openProfile: () => void = () => {};
/** Чьё меню открыто: номер участника. */
let menuFor: number | null = null;

export function avatarStatus(u: Pick<CollabUser, 'away' | 'hiddenPage'>): AvatarStatus {
  if (u.hiddenPage) return 'hidden-page';
  return u.away ? 'away' : 'online';
}

/** Данные аватара участника (или мой: self). */
export function avatarData(u: CollabUser, self = false): AvatarData {
  const { bg, fg } = avatarColors(u);
  return {
    name: String(u.name ?? ''),
    bg, fg,
    cursorId: u.cursorId ?? null,
    status: avatarStatus(u),
    self,
    cursorHidden: !self && !cursorShown(u.userId),
    title: self ? `Вы — ${String(u.name ?? '') || 'Участник'}${u.away ? ' · Отошёл' : ''}` : participantTitle(u),
  };
}

/** Я в комнате: запись хаба обо мне, а до неё — профиль. */
function meUser(): CollabUser {
  const me = myCollabId();
  const u = collabUsers().find(x => x.userId === me);
  if (u) return u;
  return { userId: me, name: profileName(), color: '#868e96', host: isHost(), away: false, cursor: null, pageId: state.pageId, selection: [], rights: { default: 'edit', pages: {} }, cursorId: myCursorId() };
}

/** Страница, на которой я сейчас, скрыта от участника u (по правам, что пришли автору). */
function myPageHiddenFor(u: CollabUser): boolean {
  const r = u.rights;
  if (!r) return false;
  return (r.pages?.[state.pageId] ?? r.default) === 'hidden';
}

/** Пункты меню моего аватара: профиль, позвать всех, скрыть курсоры других. */
export function selfMenuEntries(anchor: HTMLElement): AvatarMenuEntry[] {
  const out: AvatarMenuEntry[] = [
    { kind: 'action', id: 'profile', label: 'Настройки профиля', icon: PROFILE_ICON, run: () => openProfile() },
  ];
  if (canSummon()) {
    out.push({
      kind: 'action', id: 'summon-all', label: 'Позвать всех к себе', icon: SUMMON_ICON,
      disabled: onDraft(), title: onDraft() ? 'Черновик виден только вам — позвать на него нельзя' : 'Участники перейдут на вашу страницу и к центру вашего экрана',
      run: () => {
        if (isHost()) { summonHere(anchor); return; }
        if (sendSummon(state.pageId)) showPill({ kind: 'ok', text: 'Вы позвали всех на эту страницу' });
      },
    });
  }
  out.push({ kind: 'switch', id: 'hide-cursors', label: 'Скрыть курсоры других', icon: ICONS.eyeOff, checked: othersCursorsHidden(), onChange: setOthersCursorsHidden, title: 'Только у вас: другие участники ничего не заметят' });
  return out;
}

/** Пункты меню чужого аватара: перейти, скрыть курсор, позвать к себе, следить (позже), убрать. */
export function participantMenuEntries(u: CollabUser): AvatarMenuEntry[] {
  const name = String(u.name ?? '') || 'Участник';
  const out: AvatarMenuEntry[] = [
    {
      kind: 'action', id: 'goto', label: 'Перейти к участнику', icon: ICON_ARROW,
      disabled: !!u.hiddenPage || !u.pageId, title: u.hiddenPage ? 'Участник сейчас на скрытой странице' : undefined,
      run: () => goToParticipant(u, 'avatar'),
    },
    {
      kind: 'switch', id: 'hide-cursor', label: 'Скрыть курсор', icon: ICONS.eyeOff,
      checked: othersCursorsHidden() || userCursorHidden(u.userId), disabled: othersCursorsHidden(),
      title: othersCursorsHidden() ? 'Скрыты курсоры всех участников — их можно вернуть в меню своего аватара' : 'Только у вас: участник ничего не заметит',
      onChange: on => setUserCursorHidden(u.userId, on),
    },
  ];
  if (canSummon() && !u.host) {
    const reason = onDraft() ? 'Черновик виден только вам — позвать на него нельзя'
      : myPageHiddenFor(u) ? 'Эта страница скрыта от участника' : '';
    out.push({
      kind: 'action', id: 'summon', label: 'Позвать к себе', icon: SUMMON_ICON, disabled: !!reason,
      title: reason || 'Участник перейдёт на вашу страницу и к центру вашего экрана',
      run: () => { if (sendSummon(state.pageId, u.userId)) showPill({ kind: 'ok', text: `Вы позвали к себе: ${name}` }); },
    });
  }
  out.push({ kind: 'action', id: 'follow', label: 'Следить за участником', icon: FOLLOW_ICON, disabled: true, badge: 'Скоро', title: 'Скоро: ваш экран будет следовать за участником', run: () => {} });
  if (isHost() && !u.host) {
    out.push({ kind: 'sep' });
    out.push({
      kind: 'action', id: 'remove', label: 'Убрать из совместной работы', icon: ICONS.del, danger: true, confirm: 'Нажмите ещё раз, чтобы убрать',
      title: 'Отключить участника от доски сейчас. Ссылка или приглашение продолжают действовать — их отзывают в окне «Поделиться»',
      run: () => { if (sendRemove(u.userId)) showPill({ kind: 'info', text: `${name} больше не участвует в совместной работе` }); },
    });
  }
  return out;
}

function menuSub(u: CollabUser, self: boolean): string {
  const status = STATUS_TEXT[avatarStatus(u)];
  if (self) return status ? `Это вы · ${status}` : 'Это вы';
  const where = u.hiddenPage ? '' : pageName(u.pageId);
  return [u.host ? 'Автор' : '', where ? `страница «${where}»` : '', status].filter(Boolean).join(' · ');
}

function openMenuFor(uid: number, anchor: HTMLElement): void {
  if (menuFor === uid) { closeAvatarMenu(); return; }
  const self = uid === myCollabId();
  const u = self ? meUser() : collabUsers().find(x => x.userId === uid);
  if (!u) return;
  group?.hold(true);
  menuFor = uid;
  openAvatarMenu({
    anchor,
    face: avatarData(u, self),
    name: String(u.name ?? '') || 'Участник',
    sub: menuSub(u, self),
    entries: self ? selfMenuEntries(anchor) : participantMenuEntries(u),
    onClose: () => {
      if (menuFor !== uid) return;
      menuFor = null;
      group?.hold(false);
    },
  });
}

/** Состав группы: я первым, затем другие (до STRIP_MAX) и «+N». */
export function groupItems(users: readonly CollabUser[], me: CollabUser): AvatarGroupItem[] {
  const others = users.filter(u => u.userId !== me.userId);
  const shown = others.slice(0, STRIP_MAX);
  const items: AvatarGroupItem[] = [
    { key: `u${me.userId}`, data: avatarData(me, true), onActivate: b => openMenuFor(me.userId, b) },
    ...shown.map(u => ({ key: `u${u.userId}`, data: avatarData(u), onActivate: (b: HTMLElement) => openMenuFor(u.userId, b) })),
  ];
  const rest = others.slice(STRIP_MAX);
  if (rest.length > 0) items.push({ key: 'more', more: { count: rest.length, title: rest.map(u => String(u.name ?? '') || 'Участник').join(', ') } });
  return items;
}

function renderStrip(): void {
  const strip = document.getElementById('collab-presence');
  if (!strip) return;
  const me = myCollabId();
  const users = collabActive() ? collabUsers() : [];
  const others = users.filter(u => u.userId !== me);
  // группа видна, когда на доске есть кто-то кроме меня
  const visible = others.length > 0;
  const key = visible
    ? users.map(u => `${u.userId}:${u.name}:${u.cursorId ?? ''}:${u.away ? 1 : 0}:${u.hiddenPage ? 'h' : u.pageId ?? ''}:${cursorShown(u.userId) ? 1 : 0}`).join(',')
      + `|${me}|${state.project.pages.map(p => p.name).join('/')}`
    : '';
  if (strip.dataset.key === key && (!visible || group)) return;
  strip.dataset.key = key;
  if (!visible) {
    if (menuFor !== null) closeAvatarMenu(true);
    strip.hidden = true;
    group?.set([]);
    return;
  }
  if (!group) {
    group = createAvatarGroup({ label: 'Участники' });
    strip.textContent = '';
    strip.appendChild(group.el);
  }
  // участник ушёл — его меню закрывается
  if (menuFor !== null && menuFor !== me && !others.some(u => u.userId === menuFor)) closeAvatarMenu();
  strip.hidden = false;
  group.set(groupItems(users, meUser()));
}

// ----- Краевые курсоры -----

let edgeRoot: HTMLElement | null = null;
const edgeNodes = new Map<number, { el: HTMLButtonElement; arrow: HTMLElement; label: HTMLElement; cursorId: string | null; user: CollabUser }>();

/** Отступы безопасной области: интерфейс, лежащий поверх холста у его краёв, плюс EDGE_PAD. */
export function safeInsets(wrap: DOMRect, obstacles: readonly DOMRect[], pad = EDGE_PAD): SafeInsets {
  const ins = { top: 0, right: 0, bottom: 0, left: 0 };
  for (const r of obstacles) {
    if (r.width <= 0 || r.height <= 0) continue;
    if (r.right <= wrap.left || r.left >= wrap.right || r.bottom <= wrap.top || r.top >= wrap.bottom) continue;
    const d = { left: r.left - wrap.left, right: wrap.right - r.right, top: r.top - wrap.top, bottom: wrap.bottom - r.bottom };
    // полоса поперёк холста (шапка, док) прижата к верху или низу, столбец (панель инструментов) — к боку
    const edge: keyof typeof d = r.width >= r.height ? (d.top <= d.bottom ? 'top' : 'bottom') : (d.left <= d.right ? 'left' : 'right');
    if (edge === 'left') ins.left = Math.max(ins.left, r.right - wrap.left);
    else if (edge === 'right') ins.right = Math.max(ins.right, wrap.right - r.left);
    else if (edge === 'top') ins.top = Math.max(ins.top, r.bottom - wrap.top);
    else ins.bottom = Math.max(ins.bottom, wrap.bottom - r.top);
  }
  return { top: ins.top + pad, right: ins.right + pad, bottom: ins.bottom + pad, left: ins.left + pad };
}

function obstacleRects(): DOMRect[] {
  const out: DOMRect[] = [];
  for (const sel of ['#topbar', '#bottombar', '#toolbar', '#btn-pages', '#pages-dock.open #pages-tray', '#activity-pills']) {
    const n = document.querySelector<HTMLElement>(sel);
    if (n && !n.hidden) out.push(n.getBoundingClientRect());
  }
  return out;
}

function removeEdge(uid: number): void {
  edgeNodes.get(uid)?.el.remove();
  edgeNodes.delete(uid);
}

/** Точка участника на моей странице (мировые координаты): курсор, иначе центр его экрана. */
export function participantPoint(u: CollabUser, pageId: string): { x: number; y: number } | null {
  if (u.hiddenPage || u.away || u.pageId !== pageId) return null;
  if (u.cursor) return u.cursor;
  if (u.view && u.view.pageId === pageId) return { x: u.view.vx, y: u.view.vy };
  return null;
}

export function renderEdgePointers(): void {
  const wrap = document.getElementById('canvas-wrap');
  if (!wrap) return;
  if (!edgeRoot || !edgeRoot.isConnected) {
    edgeRoot = document.getElementById('edge-pointers') ?? el('div', '');
    edgeRoot.id = 'edge-pointers';
    edgeRoot.textContent = '';
    edgeNodes.clear();
    wrap.appendChild(edgeRoot);
  }
  const seen = new Set<number>();
  const active = collabActive() && state.view === 'board' && !onDraft();
  if (active) {
    const rect = wrap.getBoundingClientRect();
    const w = wrap.clientWidth || rect.width;
    const h = wrap.clientHeight || rect.height;
    const insets = safeInsets(rect, obstacleRects());
    const cam = state.camera;
    const me = myCollabId();
    for (const u of collabUsers()) {
      if (u.userId === me || !cursorShown(u.userId)) continue;
      const pt = participantPoint(u, state.pageId);
      if (!pt) continue;
      const p = computeEdgePointer((pt.x - cam.x) * cam.zoom, (pt.y - cam.y) * cam.zoom, w, h, insets);
      if (!p) continue;
      seen.add(u.userId);
      let n = edgeNodes.get(u.userId);
      if (!n) {
        const b = el('button', 'collab-edge-pointer');
        b.type = 'button';
        const arrow = el('i', 'ep-arrow');
        const label = el('span', 'ep-label');
        b.append(arrow, label);
        const node = { el: b, arrow, label, cursorId: null as string | null, user: u };
        b.addEventListener('click', () => goToParticipant(node.user, 'pointer'));
        edgeRoot.appendChild(b);
        n = node;
        edgeNodes.set(u.userId, n);
      }
      n.user = u;
      const id = validCursor(u);
      if (n.cursorId !== id) {
        n.arrow.innerHTML = cursorSvg(id, { size: 20 }); // разметка каталога курсоров — только константы
        n.cursorId = id;
      }
      n.el.style.left = `${p.x}px`;
      n.el.style.top = `${p.y}px`;
      n.arrow.style.transform = `rotate(${p.angle - ARROW_ANGLE}rad)`;
      // имя — внутрь экрана от стрелки, горизонтально
      n.label.style.left = `${14 - Math.cos(p.angle) * 34}px`;
      n.label.style.top = `${14 - Math.sin(p.angle) * 26}px`;
      const { bg, fg } = avatarColors(u);
      n.label.style.background = bg;
      n.label.style.color = fg;
      n.label.textContent = String(u.name ?? '');
      const title = `Перейти к участнику: ${String(u.name ?? '')}`;
      n.el.title = title;
      n.el.setAttribute('aria-label', title);
      n.el.dataset.userId = String(u.userId);
    }
  }
  for (const uid of [...edgeNodes.keys()]) if (!seen.has(uid)) removeEdge(uid);
}

// ----- Кнопки автора -----

/** Тумблер автоперехода заблокирован тарифом (Free при включённых лимитах). */
export function followLocked(): boolean {
  return limitsEnforced() && !PLAN_LIMITS[userPlan()].canFollowHost;
}

const pageHidden = (pageId: string): boolean => state.project.permissions?.pageRights?.[pageId] === 'hidden';

let hostKey = '';

function refreshHostControls(force = false): void {
  const host = collabActive() && isHost();
  const hidden = host && !onDraft() && pageHidden(state.pageId);
  const key = `${host}|${hostFollowEnabled()}|${followLocked()}|${hidden}|${state.pageId}`;
  if (!force && key === hostKey) return;
  hostKey = key;
  const summon = document.getElementById('btn-summon');
  const follow = document.getElementById('btn-follow');
  if (summon) summon.hidden = !host;
  if (follow) {
    follow.hidden = !host;
    const locked = followLocked();
    follow.classList.toggle('locked', locked);
    follow.setAttribute('aria-pressed', String(hostFollowEnabled() && !locked));
    follow.classList.toggle('active', hostFollowEnabled() && !locked);
    follow.title = locked ? 'Автопереход участников за мной — доступно в подписке Pro' : hostFollowEnabled() ? 'Автопереход участников за мной: включён' : 'Автопереход участников за мной';
  }
  const badge = document.getElementById('follow-hidden-badge');
  if (badge) badge.hidden = !(hidden && hostFollowEnabled());
  if (!host) closeSummonPopover();
}

let popover: HTMLElement | null = null;

function closeSummonPopover(): void {
  popover?.remove();
  popover = null;
}

/** Право страницы в правах проекта (автор): участники получают его сразу (живые права хаба). */
export function setProjectPageRight(pageId: string, right: PageRight): void {
  const perms = state.project.permissions ?? {};
  state.project.permissions = { ...perms, pageRights: { ...(perms.pageRights ?? {}), [pageId]: right } };
  update(true);
  sendProjectNow(state.project);
}

/** «Позвать всех сюда»: скрытая страница — сначала спросить, открыть ли её. */
export function summonHere(anchor?: HTMLElement | null): void {
  if (!collabActive() || !isHost()) return;
  if (onDraft()) { showPill({ kind: 'info', text: 'Черновик виден только вам — позвать на него нельзя' }); return; }
  const pageId = state.pageId;
  if (!pageHidden(pageId)) {
    if (sendSummon(pageId)) showPill({ kind: 'ok', text: 'Вы позвали всех на эту страницу' });
    return;
  }
  closeSummonPopover();
  const box = el('div', 'summon-popover');
  box.id = 'summon-popover';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Страница скрыта от участников');
  box.appendChild(el('div', 'summon-popover-text', 'Эта страница скрыта от участников. Открыть её и позвать всех?'));
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') choose(null); };
  const choose = (right: PageRight | null) => {
    document.removeEventListener('keydown', onKey);
    closeSummonPopover();
    if (!right || state.pageId !== pageId) return;
    setProjectPageRight(pageId, right);
    refreshHostControls(true);
    if (sendSummon(pageId)) showPill({ kind: 'ok', text: 'Страница открыта, участники переходят на неё' });
  };
  const edit = el('button', 'summon-choice', 'Открыть для редактирования и позвать');
  edit.addEventListener('click', () => choose('edit'));
  const view = el('button', 'summon-choice', 'Открыть для просмотра и позвать');
  view.addEventListener('click', () => choose('view'));
  const cancel = el('button', 'summon-choice cancel', 'Отмена');
  cancel.addEventListener('click', () => choose(null));
  box.append(edit, view, cancel);
  document.body.appendChild(box);
  popover = box;
  const r = anchor?.getBoundingClientRect();
  if (r) {
    box.style.top = `${Math.round(r.bottom + 8)}px`;
    // левее колонки пилюль справа, чтобы уведомления не закрывали выбор
    box.style.left = `${Math.round(Math.max(8, Math.min(r.left - 140, window.innerWidth - 600)))}px`;
  }
  edit.focus();
  document.addEventListener('keydown', onKey);
  setTimeout(() => {
    const away = (e: PointerEvent) => {
      if (!popover || popover !== box) { document.removeEventListener('pointerdown', away, true); return; }
      if (e.target instanceof Node && (box.contains(e.target) || anchor?.contains(e.target))) return;
      document.removeEventListener('pointerdown', away, true);
      closeSummonPopover();
    };
    document.addEventListener('pointerdown', away, true);
  }, 0);
}

function toggleFollow(): void {
  if (!collabActive() || !isHost()) return;
  if (followLocked()) { showPill({ kind: 'info', text: 'Автопереход участников — доступно в подписке Pro' }); return; }
  const next = !hostFollowEnabled();
  sendFollowHost(next);
  showPill({ kind: 'info', text: next ? 'Участники следуют за вами по страницам' : 'Автопереход участников выключен' });
  refreshHostControls(true);
}

// ----- Подключение -----

let inited = false;

/**
 * Обновить всё присутствие (краевые курсоры, группа аватаров в шапке, кнопки автора); onPageAvatars — аватары у карточек
 * страниц, opts.openProfile — пункт «Настройки профиля» в меню моего аватара.
 */
export function initCollabPresence(onPageAvatars?: () => void, opts: { openProfile?: () => void } = {}): void {
  if (inited) return;
  inited = true;
  if (opts.openProfile) openProfile = opts.openProfile;
  const summon = document.getElementById('btn-summon');
  if (summon) {
    summon.innerHTML = SUMMON_ICON; // константа модуля
    summon.addEventListener('click', () => summonHere(summon));
  }
  const follow = document.getElementById('btn-follow');
  if (follow) {
    follow.innerHTML = FOLLOW_ICON; // константа модуля
    follow.addEventListener('click', toggleFollow);
  }
  document.addEventListener(PRESENCE_EVENT, () => {
    renderEdgePointers();
    renderStrip();
    refreshHostControls();
    onPageAvatars?.();
  });
  // смена страницы или прав без сообщений комнаты (например, автор открыл скрытую страницу)
  onChange(() => refreshHostControls());
  window.addEventListener('resize', () => renderEdgePointers());
  refreshHostControls(true);
}
