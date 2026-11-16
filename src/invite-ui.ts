import { buildBoardUrl } from './board-url';
import { ApiError, cloudEnabled, getApi } from './api-client';
import { connectOwnerRoom, leaveOwnerRoom } from './cloud-room';
import { cloudStorage } from './cloud-sync';
import { linkBaseUrl } from './link-view';
import { doskaApi } from './storage';
import { isNativeApp } from './native';
import { onDraft, state } from './state';
import { getSyncedRev } from './sync-state';
import { showToast } from './about';

// Блок «Ссылка-приглашение» в окне «Совместная работа»: одна ссылка на проект, открывающая облачную комнату.
// Гость заходит по ней в любое время, на Pro и Tutor — даже когда автора нет в сети.

interface InviteInfo { token: string; defaultRole: 'edit' | 'view'; allowCopy: boolean; pageRights: Record<string, string> }

const TEXT_UNSYNCED = 'Проект ещё не сохранён в облаке. Подождите немного и откройте окно снова.';
const TEXT_OFFLINE = 'Нет связи с сервером.';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Ссылка для гостя: адрес веб-клиента и токен (формат с параметрами — работает везде, где нет путей /j/…). */
export function inviteLink(token: string): string {
  return buildBoardUrl(linkBaseUrl(location, !!doskaApi || isNativeApp()), { mode: 'collab', token });
}

/** Пустой блок, если облака нет или проект нельзя делиться (черновик, чужая доска). */
export function createInviteBox(): HTMLElement {
  const box = el('div', 'share-invite');
  let invite: InviteInfo | null = null;
  let message = '';
  let busy = false;
  let loadedFor = '';

  const available = () => cloudEnabled() && !onDraft() && !state.linkMode && state.collabRole !== 'guest';

  async function load(): Promise<void> {
    const api = getApi();
    if (!api || !available()) { invite = null; render(); return; }
    const id = state.project.id;
    loadedFor = id;
    try {
      const r = await api.request<{ invite: InviteInfo | null }>('GET', `/api/invites?projectId=${encodeURIComponent(id)}`);
      if (state.project.id === id) { invite = r.invite; message = ''; }
    } catch (e) {
      invite = null;
      message = e instanceof ApiError && e.status === 404 ? TEXT_UNSYNCED : e instanceof ApiError && e.isNetwork ? TEXT_OFFLINE : '';
    }
    render();
  }

  /** Создать или обновить приглашение; проект сначала уходит на сервер. */
  async function save(role?: 'edit' | 'view'): Promise<void> {
    const api = getApi();
    const cloud = cloudStorage();
    if (!api || !cloud || busy) return;
    busy = true;
    message = '';
    render();
    try {
      await cloud.flush();
      if (getSyncedRev(state.project.id) === null) { message = TEXT_UNSYNCED; return; }
      const r = await api.request<InviteInfo>('POST', '/api/invites', { projectId: state.project.id, ...(role ? { defaultRole: role } : {}) });
      invite = r;
      void connectOwnerRoom();
    } catch (e) {
      message = e instanceof ApiError && e.isNetwork ? TEXT_OFFLINE : 'Не удалось создать ссылку';
    } finally { busy = false; render(); }
  }

  async function revoke(): Promise<void> {
    const api = getApi();
    if (!api || !invite || busy) return;
    busy = true;
    render();
    try {
      await api.request('DELETE', `/api/invites/${encodeURIComponent(invite.token)}`);
      invite = null;
      leaveOwnerRoom();
    } catch { message = TEXT_OFFLINE; } finally { busy = false; render(); }
  }

  function render(): void {
    box.textContent = '';
    box.hidden = !available();
    if (box.hidden) return;
    box.appendChild(el('div', 'share-cloud-title', 'Ссылка-приглашение'));
    if (invite) {
      const link = el('div', 'share-link', inviteLink(invite.token));
      link.title = 'Клик — скопировать ссылку';
      link.addEventListener('click', () => {
        void navigator.clipboard.writeText(inviteLink(invite!.token)).then(() => showToast('Ссылка скопирована'), () => showToast('Не удалось скопировать ссылку'));
      });
      box.appendChild(link);
      const row = el('label', 'share-invite-role');
      row.appendChild(el('span', '', 'Гости: '));
      const sel = el('select', 'share-invite-select');
      for (const [v, t] of [['edit', 'редактируют'], ['view', 'смотрят']] as const) {
        const o = el('option', '', t);
        o.value = v;
        sel.appendChild(o);
      }
      sel.value = invite.defaultRole;
      sel.disabled = busy;
      sel.addEventListener('change', () => { void save(sel.value === 'view' ? 'view' : 'edit'); });
      row.appendChild(sel);
      box.appendChild(row);
      const off = el('button', 'ctx-custom-btn danger', 'Отозвать ссылку');
      off.disabled = busy;
      off.addEventListener('click', () => { void revoke(); });
      box.appendChild(off);
    } else {
      const create = el('button', 'ctx-custom-btn', busy ? 'Создаём…' : 'Создать ссылку-приглашение');
      create.disabled = busy;
      create.addEventListener('click', () => { void save(); });
      box.appendChild(create);
    }
    if (message) box.appendChild(el('div', 'share-cloud-error', message));
  }

  render();
  void load();
  // окно перерисовывается каждые две секунды, а блок хранит своё состояние: заново спрашиваем сервер только при смене проекта
  box.addEventListener('abax:refresh', () => { if (loadedFor !== state.project.id) void load(); else render(); });
  return box;
}

/** Попросить блок обновиться (окно перерисовалось). */
export function refreshInviteBox(box: HTMLElement): void {
  box.dispatchEvent(new Event('abax:refresh'));
}
