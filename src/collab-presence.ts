import { state, onChange, onDraft, update } from './state';
import type { PageRight } from './types';
import {
  PRESENCE_EVENT, canSummon, collabActive, collabAvatar, collabUsers, hostFollowEnabled, isHost, myCollabId, sendFollowHost, sendPageRights, sendProjectNow,
  sendRemove, sendSummon, type CollabGotoDetail, type CollabUser,
} from './collab';
import { DEFAULT_CURSOR_ID, cursorPreset, cursorSvg, isCursorId } from './cursors';
import { computeEdgePointer, type SafeInsets } from './edge-pointer';
import { pageAvatars } from './presence';
import { pushNotice } from './notify-center';
import { PLAN_LIMITS } from './limits';
import { limitsEnforced, userPlan } from './plan';
import { ACCESS_ICON, FOLLOW_ICON, ICON_ARROW, ICONS, PROFILE_ICON, SUMMON_ICON } from './icons';
import { STATUS_TEXT, type AvatarData, type AvatarStatus } from './avatar';
import { createAvatarGroup, type AvatarGroup, type AvatarGroupItem } from './avatar-group';
import { closeAvatarMenu, openAvatarMenu, type AvatarMenuEntry, type AvatarSubmenu } from './avatar-menu';
import { attachOverlayScroll } from './overlay-scroll';
import { createSpringSelect, type SelectOption, type SpringSelect } from './spring-select';
import { cursorShown, othersCursorsHidden, setOthersCursorsHidden, setUserCursorHidden, userCursorHidden } from './cursor-visibility';
import { myAvatar, myCursorId, onProfileChange, profileName } from './profile';
import { followWaiting, followingUid, initFollow, onFollowChange, startFollow, stopFollow } from './follow';

// Присутствие участников (SPEC_NIGHT5 §8): краевые курсоры у границы экрана, аватары в шапке и у страниц,
// пункты автора «Позвать всех к себе» и «Автопереход за мной» в меню аватара. Имена и цвета приходят от других
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
    // отклик на мой щелчок по участнику — тихое уведомление
    pushNotice({ title: u.host ? 'Автор сейчас на скрытой странице' : 'Участник сейчас на скрытой странице', icon: 'hidden', quiet: true });
    return;
  }
  const target = gotoTarget(u, reason);
  if (target) goTo(target);
}

// ----- Аватары у карточек страниц -----

/** Группы аватаров у карточек страниц (по контейнеру карточки). */
const pageGroups = new WeakMap<HTMLElement, AvatarGroup>();

/**
 * Аватары участников на странице (до 3 + «+N») — та же группа аватаров, что в шапке, поменьше; нажатие — то же
 * меню аватара. Обновляется, только если состав или вид изменились.
 */
export function fillPageAvatars(box: HTMLElement, pageId: string): void {
  const users = collabActive() ? collabUsers() : [];
  const { shown, more } = pageAvatars(users, pageId, myCollabId());
  const key = shown.map(u => `${u.userId}:${u.name}:${u.cursorId ?? ''}:${u.avatar ?? ''}:${u.away ? 1 : 0}:${cursorShown(u.userId) ? 1 : 0}`).join(',')
    + `+${more}|${state.project.pages.map(p => p.name).join('/')}`;
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  let g = pageGroups.get(box);
  if (!g) {
    const created = createAvatarGroup({ label: 'Участники на странице', size: 22, tight: 3, open: 8, itemClass: 'page-avatar' });
    g = created;
    pageGroups.set(box, created);
    box.textContent = '';
    box.appendChild(created.el);
  }
  const group = g;
  const items: AvatarGroupItem[] = shown.map(u => ({ key: `u${u.userId}`, data: avatarData(u), onActivate: (b: HTMLElement) => openMenuFor(u.userId, b, group) }));
  if (more > 0) {
    const rest = users.filter(u => u.userId !== myCollabId() && !u.hiddenPage && u.pageId === pageId).slice(shown.length);
    items.push({ key: 'more', more: { count: more, title: rest.map(u => String(u.name ?? '') || 'Участник').join(', ') } });
  }
  group.set(items);
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
    // мой аватар — из профиля: меняется сразу, не дожидаясь хаба
    avatar: self ? myAvatar() : collabAvatar(u),
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
        if (sendSummon(state.pageId)) pushNotice({ level: 'ok', title: 'Вы позвали всех на эту страницу', icon: 'summon', quiet: true });
      },
    });
  }
  // автопереход — только автор; на тарифе без него переключатель выключен (тариф проверяет и хаб)
  if (collabActive() && isHost()) {
    const locked = followLocked();
    out.push({
      kind: 'switch', id: 'follow-me', label: 'Автопереход за мной', icon: FOLLOW_ICON,
      checked: hostFollowEnabled() && !locked, disabled: locked, badge: locked ? 'Pro' : undefined,
      title: locked ? 'Автопереход участников за мной — доступно в подписке Pro' : 'Участники будут переходить за вами по страницам',
      onChange: setFollowMe,
    });
  }
  // чужие курсоры бывают только в совместной работе
  if (collabActive()) out.push({ kind: 'switch', id: 'hide-cursors', label: 'Скрыть курсоры других', icon: ICONS.eyeOff, checked: othersCursorsHidden(), onChange: setOthersCursorsHidden, title: 'Только у вас: другие участники ничего не заметят' });
  return out;
}

/**
 * Личное право участника на страницу — те же варианты, что «Страницы» в «Поделиться» → «Настройки доступа»,
 * но только для одного участника. «По роли» снимает личное право: действует его роль и настройка страницы.
 */
const PERSONAL_PAGE_OPTIONS: readonly SelectOption[] = [
  { value: '', label: 'По роли', title: 'Как для всех: по роли участника и настройке страницы' },
  { value: 'view', label: 'Только просмотр', title: 'Участник смотрит, но не меняет страницу' },
  { value: 'hidden', label: 'Скрыта', title: 'Участник не видит страницу' },
];

/** Подменю «Настройки доступа»: страницы доски и личное право участника u на каждой. */
export function accessSubmenu(u: CollabUser): AvatarSubmenu {
  const name = String(u.name ?? '') || 'Участник';
  const personal = u.access?.personal ?? {};
  const box = el('div', 'avatar-access');
  const list = el('div', 'avatar-access-list');
  box.append(list);
  const selects: SpringSelect[] = [];
  for (const pg of state.project.pages) {
    const pageName = pg.name || 'Без названия';
    const row = el('div', 'avatar-access-row');
    row.dataset.pageId = pg.id;
    const label = el('span', 'avatar-access-name', pageName);
    label.title = pageName;
    const cur = personal[pg.id] ?? '';
    // «Редактирование» могло прийти из таблицы участников P2P в «Поделиться» — показываем как есть
    const options = cur === 'edit'
      ? [PERSONAL_PAGE_OPTIONS[0], { value: 'edit', label: 'Редактирование', title: 'Участник меняет страницу' }, ...PERSONAL_PAGE_OPTIONS.slice(1)]
      : PERSONAL_PAGE_OPTIONS;
    const sel = createSpringSelect({
      className: 'avatar-access-select', label: `${name}: доступ к странице «${pageName}»`, options, value: cur, align: 'end',
      onChange: v => {
        if (v === 'edit') return;
        const right = v === 'view' || v === 'hidden' ? v : null;
        if (!sendPageRights(u.userId, { [pg.id]: right })) pushNotice({ level: 'warn', title: 'Нет связи с доской — доступ не изменён', icon: 'offline', quiet: true });
      },
    });
    sel.el.dataset.key = `access-${pg.id}`;
    selects.push(sel);
    row.append(label, sel.el);
    list.append(row);
  }
  // длинный список страниц прокручивается внутри меню — своей тонкой полосой
  attachOverlayScroll(list, { axis: 'y', host: box, edges: 'shadow' });
  return { el: box, close: () => { for (const s of selects) s.close(true); } };
}

/** Пункты меню чужого аватара: перейти, скрыть курсор, позвать к себе, следить, доступ, исключить. */
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
      run: () => { if (sendSummon(state.pageId, u.userId)) pushNotice({ level: 'ok', title: `Вы позвали к себе: ${name}`, icon: 'summon', quiet: true }); },
    });
  }
  const following = followingUid() === u.userId;
  out.push({
    kind: 'action', id: 'follow', label: following ? 'Перестать следить' : 'Следить за участником', icon: FOLLOW_ICON,
    title: following ? undefined : 'Ваш экран будет повторять страницу и камеру участника. Чтобы выйти — сдвиньте холст. Участник ничего не заметит',
    run: () => { if (following) stopFollow(); else startFollow(u.userId); },
  });
  if (isHost() && !u.host) {
    out.push({ kind: 'sep' });
    out.push({
      kind: 'submenu', id: 'access', label: 'Настройки доступа', icon: ACCESS_ICON,
      title: 'Права на страницы только для этого участника — сохраняются за ним и после перезахода',
      // свежая запись участника: после смены права и возврата в подменю видно новое значение
      content: () => accessSubmenu(collabUsers().find(x => x.userId === u.userId) ?? u),
    });
    out.push({
      kind: 'action', id: 'remove', label: 'Исключить', icon: ICONS.del, danger: true, confirm: 'Нажмите ещё раз, чтобы исключить',
      title: 'Отключить участника от доски сейчас. Ссылка или приглашение продолжают действовать — их отзывают в окне «Поделиться»',
      run: () => { if (sendRemove(u.userId)) pushNotice({ title: `${name} больше не участвует в совместной работе`, icon: 'remove', quiet: true }); },
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

/** Меню аватара uid; from — группа, из которой его открыли (держится раскрытой, пока меню открыто). */
function openMenuFor(uid: number, anchor: HTMLElement, from: AvatarGroup | null = group): void {
  if (menuFor === uid && anchor.getAttribute('aria-expanded') === 'true') { closeAvatarMenu(); return; }
  const self = uid === myCollabId();
  const u = self ? meUser() : collabUsers().find(x => x.userId === uid);
  if (!u) return;
  // прежнее меню (в том числе из другой группы) закрывается до того, как это станет текущим
  closeAvatarMenu(true);
  from?.hold(true);
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
      from?.hold(false);
    },
  });
}

/** Состав группы: я первым (ключ 'me' — мой аватар не пересоздаётся при входе в комнату), затем другие (до STRIP_MAX) и «+N». */
export function groupItems(users: readonly CollabUser[], me: CollabUser): AvatarGroupItem[] {
  const others = users.filter(u => u.userId !== me.userId);
  const shown = others.slice(0, STRIP_MAX);
  const items: AvatarGroupItem[] = [
    { key: 'me', data: avatarData(me, true), onActivate: b => openMenuFor(me.userId, b) },
    ...shown.map(u => ({ key: `u${u.userId}`, data: avatarData(u), onActivate: (b: HTMLElement) => openMenuFor(u.userId, b) })),
  ];
  const rest = others.slice(STRIP_MAX);
  if (rest.length > 0) items.push({ key: 'more', more: { count: rest.length, title: rest.map(u => String(u.name ?? '') || 'Участник').join(', ') } });
  return items;
}

/** Короткая подпись аватара для ключей перерисовки (фото — длина и хвост, а не вся строка). */
function avatarSig(a: string | null): string {
  return a ? `${a.length}:${a.slice(-24)}` : '';
}

function renderStrip(): void {
  const strip = document.getElementById('collab-presence');
  if (!strip) return;
  const me = myCollabId();
  const users = collabActive() ? collabUsers() : [];
  const others = users.filter(u => u.userId !== me);
  const self = meUser();
  // мой аватар виден всегда, даже если на доске больше никого нет
  // фото: в ключе — версия (photo:N) и, пока фото не пришло, признак его отсутствия
  const key = users.map(u => `${u.userId}:${u.name}:${u.cursorId ?? ''}:${u.avatar ?? ''}${collabAvatar(u) ? '' : '-'}:${u.away ? 1 : 0}:${u.hiddenPage ? 'h' : u.pageId ?? ''}:${cursorShown(u.userId) ? 1 : 0}`).join(',')
    + `|${me}|${self.name}:${self.cursorId ?? ''}:${avatarSig(myAvatar())}|${state.project.pages.map(p => p.name).join('/')}`;
  if (strip.dataset.key === key && group) return;
  strip.dataset.key = key;
  if (!group) {
    // по высоте — как кнопка «Поделиться» (48 px): круг 42 px и курсор, выступающий вниз на 6 px
    group = createAvatarGroup({ label: 'Участники', size: 42, tight: 4, open: 14 });
    strip.textContent = '';
    strip.appendChild(group.el);
  }
  // участник ушёл — его меню закрывается
  if (menuFor !== null && menuFor !== me && !others.some(u => u.userId === menuFor)) closeAvatarMenu();
  strip.hidden = false;
  group.set(groupItems(users, self));
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
  for (const sel of ['#topbar', '#bottombar', '#toolbar', '#btn-pages', '#pages-dock.open #pages-tray', '#notify-stack']) {
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

/** Плашка «страница скрыта — участники остались» у автора с включённым автопереходом. */
function refreshHostControls(force = false): void {
  const host = collabActive() && isHost();
  const hidden = host && !onDraft() && pageHidden(state.pageId);
  const key = `${host}|${hostFollowEnabled()}|${hidden}|${state.pageId}`;
  if (!force && key === hostKey) return;
  hostKey = key;
  const badge = document.getElementById('follow-hidden-badge');
  if (badge) badge.hidden = !(hidden && hostFollowEnabled());
  if (!host) closeSummonPopover();
}

// ----- «Следим за …»: плашка сверху посередине, пока включено слежение -----

let followBannerKey = '';

/** Плашка слежения: имя участника — цветом его бейджа; на скрытой от меня странице — пометка. */
function renderFollowBanner(): void {
  const banner = document.getElementById('follow-banner');
  if (!banner) return;
  const uid = followingUid();
  const u = uid === null ? undefined : collabUsers().find(x => x.userId === uid);
  const key = u ? `${u.userId}|${u.name}|${u.cursorId ?? ''}|${u.color}|${followWaiting() ? 1 : 0}` : '';
  if (key === followBannerKey) return;
  followBannerKey = key;
  document.body.classList.toggle('following', !!u);
  banner.hidden = !u;
  banner.textContent = '';
  if (!u) return;
  const { bg, fg } = avatarColors(u);
  const name = el('span', 'follow-name', String(u.name ?? '') || 'Участник');
  name.style.background = bg;
  name.style.color = fg;
  banner.append('Следим за ', name);
  if (followWaiting()) banner.append(el('span', 'follow-wait', ' · на скрытой странице'));
  banner.title = 'Чтобы перестать следить, сдвиньте холст';
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
  if (onDraft()) { pushNotice({ title: 'Черновик виден только вам — позвать на него нельзя', icon: 'draft', quiet: true }); return; }
  const pageId = state.pageId;
  if (!pageHidden(pageId)) {
    if (sendSummon(pageId)) pushNotice({ level: 'ok', title: 'Вы позвали всех на эту страницу', icon: 'summon', quiet: true });
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
    if (sendSummon(pageId)) pushNotice({ level: 'ok', title: 'Страница открыта, участники переходят на неё', icon: 'summon', quiet: true });
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
    // левее стопки уведомлений справа, чтобы она не закрывала выбор
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

/** Переключатель «Автопереход за мной» в меню аватара. */
function setFollowMe(next: boolean): void {
  if (!collabActive() || !isHost()) return;
  // отклики на мой переключатель — тихие
  if (followLocked()) { pushNotice({ title: 'Автопереход участников — доступно в подписке Pro', icon: 'follow', quiet: true }); return; }
  sendFollowHost(next);
  pushNotice({ title: next ? 'Участники следуют за вами по страницам' : 'Автопереход участников выключен', icon: 'follow', quiet: true });
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
  // мой аватар без комнаты строится по профилю: имя и курсор меняются в настройках
  onProfileChange(() => renderStrip());
  renderStrip();
  document.addEventListener(PRESENCE_EVENT, () => {
    renderEdgePointers();
    renderStrip();
    refreshHostControls();
    onPageAvatars?.();
  });
  // смена страницы или прав без сообщений комнаты (например, автор открыл скрытую страницу)
  onChange(() => refreshHostControls());
  initFollow();
  onFollowChange(renderFollowBanner);
  document.addEventListener(PRESENCE_EVENT, renderFollowBanner);
  window.addEventListener('resize', () => renderEdgePointers());
  refreshHostControls(true);
}
