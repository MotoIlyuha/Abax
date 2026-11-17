import { ApiError, getApi } from './api-client';
import { buildBoardUrl } from './board-url';
import { linkBaseUrl } from './link-view';
import { doskaApi } from './storage';
import { isNativeApp } from './native';
import { signedIn } from './profile-sync';
import { showToast } from './about';

// Входящие приглашения по почте (SPEC_NIGHT5 §7, §4.2): блок «Приглашения для вас» на домашнем экране и точка
// на кнопке профиля. Имена авторов и проектов приходят с сервера — только textContent.

export interface IncomingInvite {
  id: string;
  projectId: string;
  projectName: string;
  hostName: string;
  role: 'edit' | 'view';
  token: string;
  createdAt: number;
}

/** Не чаще одного запроса за это время (кроме принудительного). */
export const INCOMING_MIN_MS = 30_000;

let invites: IncomingInvite[] = [];
let lastFetch = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();
/** Куда уходит «Присоединиться» (подменяется в тестах). */
let go: (url: string) => void = url => location.assign(url);

export function incomingInvites(): readonly IncomingInvite[] {
  return invites;
}

export function onIncomingInvites(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function changed(): void {
  for (const fn of [...listeners]) fn();
  markProfileBadge();
}

/** Спросить сервер о приглашениях (вошедший пользователь, облако включено); не чаще раза в 30 с без force. */
export function refreshIncomingInvites(force = false, now = Date.now()): Promise<void> {
  const api = getApi();
  if (!api || !signedIn()) {
    if (invites.length > 0) { invites = []; changed(); }
    return Promise.resolve();
  }
  if (inflight) return inflight;
  if (!force && now - lastFetch < INCOMING_MIN_MS) return Promise.resolve();
  lastFetch = now;
  inflight = (async () => {
    try {
      const r = await api.request<{ invites: IncomingInvite[] }>('GET', '/api/me/invites');
      invites = Array.isArray(r.invites) ? r.invites.filter(i => i && typeof i.id === 'string' && typeof i.token === 'string') : [];
      changed();
    } catch { /* в следующий раз */ } finally { inflight = null; }
  })();
  return inflight;
}

/** Ссылка-приглашение, по которой «Присоединиться» открывает комнату. */
export function incomingInviteUrl(token: string): string {
  return buildBoardUrl(linkBaseUrl(location, !!doskaApi || isNativeApp()), { mode: 'collab', token });
}

export async function respondIncoming(inv: IncomingInvite, action: 'accept' | 'decline'): Promise<boolean> {
  const api = getApi();
  if (!api) return false;
  try {
    const r = await api.request<{ ok: boolean; token?: string }>('POST', `/api/me/invites/${encodeURIComponent(inv.id)}/respond`, { action });
    invites = invites.filter(i => i.id !== inv.id);
    changed();
    if (action === 'accept') go(incomingInviteUrl(typeof r.token === 'string' && r.token ? r.token : inv.token));
    return true;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      // приглашение уже отозвано или принято на другом устройстве
      invites = invites.filter(i => i.id !== inv.id);
      changed();
      showToast('Приглашение больше не действует');
    } else showToast('Не удалось ответить на приглашение');
    return false;
  }
}

/** Точка на кнопке профиля домашнего экрана: есть приглашения. */
function markProfileBadge(): void {
  for (const b of document.querySelectorAll<HTMLElement>('.home-profile')) b.classList.toggle('has-invites', invites.length > 0);
}

/** Блок «Приглашения для вас» (пустой список — null). */
export function incomingInvitesSection(): HTMLElement | null {
  if (invites.length === 0) return null;
  const section = document.createElement('section');
  section.className = 'home-section home-invites';
  const h = document.createElement('h2');
  h.className = 'home-section-title';
  h.textContent = 'Приглашения для вас';
  section.appendChild(h);
  const list = document.createElement('div');
  list.className = 'invite-cards';
  for (const inv of invites) {
    const card = document.createElement('div');
    card.className = 'invite-card';
    card.dataset.inviteId = inv.id;
    const text = document.createElement('div');
    text.className = 'invite-card-text';
    text.textContent = `${inv.hostName || 'Автор'} приглашает вас на доску «${inv.projectName || 'Без названия'}»`;
    const role = document.createElement('div');
    role.className = 'invite-card-role';
    role.textContent = inv.role === 'view' ? 'Только просмотр' : 'Можно редактировать';
    const actions = document.createElement('div');
    actions.className = 'invite-card-actions';
    const join = document.createElement('button');
    join.type = 'button';
    join.className = 'invite-join';
    join.textContent = 'Присоединиться';
    const decline = document.createElement('button');
    decline.type = 'button';
    decline.className = 'invite-decline';
    decline.textContent = 'Отклонить';
    const busy = (on: boolean) => { join.disabled = on; decline.disabled = on; };
    join.addEventListener('click', () => { busy(true); void respondIncoming(inv, 'accept').then(ok => { if (!ok) busy(false); }); });
    decline.addEventListener('click', () => { busy(true); void respondIncoming(inv, 'decline').then(ok => { if (!ok) busy(false); }); });
    actions.append(join, decline);
    card.append(text, role, actions);
    list.appendChild(card);
  }
  section.appendChild(list);
  return section;
}

export function resetIncomingForTests(nav?: (url: string) => void): void {
  invites = [];
  lastFetch = 0;
  inflight = null;
  listeners.clear();
  go = nav ?? (url => location.assign(url));
}
