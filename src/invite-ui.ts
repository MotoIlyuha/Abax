import { buildBoardUrl } from './board-url';
import { ApiError, cloudEnabled, getApi } from './api-client';
import { connectOwnerRoom, leaveOwnerRoom } from './cloud-room';
import { cloudStorage } from './cloud-sync';
import { collabActive, isHost, sendProjectNow } from './collab';
import { linkBaseUrl } from './link-view';
import { doskaApi } from './storage';
import { isNativeApp } from './native';
import { onDraft, state, update } from './state';
import { getSyncedRev } from './sync-state';
import { showToast } from './about';
import { MAX_GUESTS_LIMIT, PLAN_LIMITS, isPageRight } from './limits';
import { limitsEnforced, userPlan } from './plan';
import type { PageRight, ProjectPermissions } from './types';

// Блок «Ссылка-приглашение» в окне «Совместная работа»: одна ссылка на проект, открывающая облачную комнату.
// Гость заходит по ней в любое время, на Pro и Tutor — даже когда автора нет в сети.
// Права (роль, копирование, страницы, лимит гостей) настраиваются и до создания ссылки (SPEC_NIGHT5 §7);
// ниже — приглашения по почте. Всё, что пришло от сервера или ввёл пользователь, — только через textContent.

interface InviteInfo { token: string; defaultRole: 'edit' | 'view'; allowCopy: boolean; pageRights: Record<string, string> }

export interface EmailInvite {
  id: string;
  projectId: string;
  email: string;
  role: 'edit' | 'view';
  status: 'pending' | 'accepted' | 'declined' | 'revoked';
  createdAt: number;
  updatedAt: number;
}

const TEXT_UNSYNCED = 'Проект ещё не сохранён в облаке. Подождите немного и откройте окно снова.';
const TEXT_OFFLINE = 'Нет связи с сервером.';

/** Статус приглашения по почте — по-русски. */
export const EMAIL_STATUS_TEXT: Record<EmailInvite['status'], string> = {
  pending: 'ожидает',
  accepted: 'принято',
  declined: 'отклонено',
  revoked: 'отозвано',
};

/** Понятный текст ошибки приглашения по почте по коду ответа сервера. */
export function emailInviteErrorText(e: unknown): string {
  if (!(e instanceof ApiError)) return 'Не удалось отправить приглашение';
  if (e.isNetwork) return TEXT_OFFLINE;
  switch (e.code) {
    case 'bad-email': return 'Проверьте адрес почты';
    case 'bad-role': return 'Выберите роль: редактор или читатель';
    case 'self-invite': return 'Это ваш собственный адрес';
    case 'mail-disabled': return 'Отправка писем на сервере не настроена';
    case 'mail-failed': return 'Письмо не ушло. Попробуйте ещё раз чуть позже';
    default: break;
  }
  if (e.status === 404) return TEXT_UNSYNCED;
  if (e.status === 429) return 'Слишком много приглашений. Попробуйте через час';
  return 'Не удалось отправить приглашение';
}

/** Варианты лимита гостей в списке (0 — без ограничений). */
export const MAX_GUESTS_OPTIONS: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 8, 10, 15, 20, 30, 40, MAX_GUESTS_LIMIT];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function select(cls: string, options: readonly (readonly [string, string])[], value: string): HTMLSelectElement {
  const sel = el('select', cls);
  for (const [v, t] of options) {
    const o = el('option', '', t);
    o.value = v;
    sel.appendChild(o);
  }
  sel.value = value;
  return sel;
}

/** Ссылка для гостя: адрес веб-клиента и токен (формат с параметрами — работает везде, где нет путей /j/…). */
export function inviteLink(token: string): string {
  return buildBoardUrl(linkBaseUrl(location, !!doskaApi || isNativeApp()), { mode: 'collab', token });
}

/** Тариф заблокировал возможность (лимиты включены и на тарифе её нет). */
function planLocks(feature: 'canSetMaxGuests' | 'canProtectCopy'): boolean {
  return limitsEnforced() && !PLAN_LIMITS[userPlan()][feature];
}

/**
 * Права проекта поменялись в окне приглашения: проект сохраняется (облако или комната автора), а подключённые гости
 * получают новые права сразу (Live Rights Push: хаб пересчитывает права по permissions.pageRights).
 */
export function setProjectPermissions(next: ProjectPermissions): void {
  state.project.permissions = next;
  update(true);
  if (collabActive() && isHost()) sendProjectNow(state.project);
}

/** Право страницы в матрице: '' — как у роли ссылки. */
export function setPageRightInProject(pageId: string, right: PageRight | ''): void {
  const perms = state.project.permissions ?? {};
  const pageRights: Record<string, PageRight> = { ...(perms.pageRights ?? {}) };
  if (right === '') delete pageRights[pageId];
  else pageRights[pageId] = right;
  setProjectPermissions({ ...perms, pageRights });
}

/** Лимит гостей автора (0 — без ограничений). */
export function setMaxGuestsInProject(max: number): void {
  const perms = { ...(state.project.permissions ?? {}) };
  if (max >= 1 && max <= MAX_GUESTS_LIMIT && Number.isInteger(max)) perms.maxGuests = max;
  else delete perms.maxGuests;
  setProjectPermissions(perms);
}

/** Пустой блок, если облака нет или проект нельзя делиться (черновик, чужая доска). */
export function createInviteBox(): HTMLElement {
  const box = el('div', 'share-invite');
  let invite: InviteInfo | null = null;
  let message = '';
  let busy = false;
  let loadedFor = '';
  // роль и копирование до создания ссылки — состояние формы; после — берутся из приглашения
  let formRole: 'edit' | 'view' = 'edit';
  let formAllowCopy = true;
  // приглашения по почте
  let emails: EmailInvite[] = [];
  let emailMessage = '';
  let emailBusy = false;
  let emailDraft = '';
  let emailRole: 'edit' | 'view' = 'edit';

  const available = () => cloudEnabled() && !onDraft() && !state.linkMode && state.collabRole !== 'guest';
  const synced = () => getSyncedRev(state.project.id) !== null;

  async function load(): Promise<void> {
    const api = getApi();
    if (!api || !available()) { invite = null; render(); return; }
    const id = state.project.id;
    loadedFor = id;
    emails = [];
    try {
      const r = await api.request<{ invite: InviteInfo | null }>('GET', `/api/invites?projectId=${encodeURIComponent(id)}`);
      if (state.project.id === id) {
        invite = r.invite;
        message = '';
        if (invite) { formRole = invite.defaultRole; formAllowCopy = invite.allowCopy; }
      }
    } catch (e) {
      invite = null;
      message = e instanceof ApiError && e.status === 404 ? TEXT_UNSYNCED : e instanceof ApiError && e.isNetwork ? TEXT_OFFLINE : '';
    }
    render();
    void loadEmails();
  }

  async function loadEmails(): Promise<void> {
    const api = getApi();
    if (!api || !available() || !synced()) return;
    const id = state.project.id;
    try {
      const r = await api.request<{ invites: EmailInvite[] }>('GET', `/api/projects/${encodeURIComponent(id)}/email-invites`);
      if (state.project.id === id) { emails = Array.isArray(r.invites) ? r.invites : []; render(); }
    } catch { /* список подтянется при следующем открытии */ }
  }

  /** Создать или обновить приглашение; проект сначала уходит на сервер (вместе с правами страниц и лимитом гостей). */
  async function save(): Promise<void> {
    const api = getApi();
    const cloud = cloudStorage();
    if (!api || !cloud || busy) return;
    busy = true;
    message = '';
    render();
    try {
      await cloud.flush();
      if (getSyncedRev(state.project.id) === null) { message = TEXT_UNSYNCED; return; }
      const body: Record<string, unknown> = { projectId: state.project.id, defaultRole: formRole };
      if (!planLocks('canProtectCopy')) body.allowCopy = formAllowCopy;
      const r = await api.request<InviteInfo>('POST', '/api/invites', body);
      invite = r;
      formRole = r.defaultRole;
      formAllowCopy = r.allowCopy;
      void connectOwnerRoom();
      void loadEmails();
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

  async function sendEmail(): Promise<void> {
    const api = getApi();
    const cloud = cloudStorage();
    const email = emailDraft.trim();
    if (!api || emailBusy) return;
    if (!email) { emailMessage = 'Введите адрес почты'; render(); return; }
    emailBusy = true;
    emailMessage = '';
    render();
    try {
      await cloud?.flush();
      if (!synced()) { emailMessage = TEXT_UNSYNCED; return; }
      const r = await api.request<{ invite: EmailInvite; created: boolean; mailed: boolean }>(
        'POST', `/api/projects/${encodeURIComponent(state.project.id)}/email-invites`, { email, role: emailRole },
      );
      emails = [r.invite, ...emails.filter(x => x.id !== r.invite.id)];
      emailDraft = '';
      showToast(r.mailed ? `Приглашение отправлено: ${r.invite.email}` : `Приглашение обновлено: ${r.invite.email}`);
    } catch (e) {
      emailMessage = emailInviteErrorText(e);
    } finally { emailBusy = false; render(); }
  }

  async function revokeEmail(inv: EmailInvite): Promise<void> {
    const api = getApi();
    if (!api || emailBusy) return;
    emailBusy = true;
    render();
    try {
      await api.request('DELETE', `/api/projects/${encodeURIComponent(inv.projectId)}/email-invites/${encodeURIComponent(inv.id)}`);
      emails = emails.filter(x => x.id !== inv.id);
    } catch (e) {
      emailMessage = e instanceof ApiError && e.isNetwork ? TEXT_OFFLINE : 'Не удалось отозвать приглашение';
    } finally { emailBusy = false; render(); }
  }

  /** Роль, копирование, права страниц и лимит гостей: видны и до создания ссылки. */
  function renderRights(): HTMLElement {
    const wrap = el('div', 'share-rights');
    const roleRow = el('label', 'share-invite-role');
    roleRow.appendChild(el('span', '', 'Гости: '));
    const roleSel = select('share-invite-select', [['edit', 'редактируют'], ['view', 'смотрят']], formRole);
    roleSel.dataset.field = 'role';
    roleSel.disabled = busy;
    roleSel.addEventListener('change', () => {
      formRole = roleSel.value === 'view' ? 'view' : 'edit';
      if (invite) void save(); else render();
    });
    roleRow.appendChild(roleSel);
    wrap.appendChild(roleRow);

    const copyLocked = planLocks('canProtectCopy');
    const copyRow = el('label', 'share-invite-check');
    const copy = el('input', 'share-invite-copy');
    copy.type = 'checkbox';
    copy.dataset.field = 'allowCopy';
    copy.checked = copyLocked ? true : formAllowCopy;
    copy.disabled = busy || copyLocked;
    copy.addEventListener('change', () => {
      formAllowCopy = copy.checked;
      if (invite) void save(); else render();
    });
    copyRow.append(copy, el('span', '', 'Разрешить копирование'));
    if (copyLocked) copyRow.appendChild(el('span', 'share-pro-tag', 'Pro'));
    wrap.appendChild(copyRow);

    // матрица прав по страницам: «как у роли» — права нет в проекте, действует роль ссылки
    const pages = el('div', 'share-page-rights');
    pages.appendChild(el('div', 'share-cloud-title', 'Страницы для гостей'));
    const rights = state.project.permissions?.pageRights ?? {};
    for (const pg of state.project.pages) {
      const row = el('label', 'share-page-right');
      row.dataset.pageId = pg.id;
      row.appendChild(el('span', 'share-page-name', pg.name || 'Без названия'));
      const cur = rights[pg.id];
      const sel = select('share-invite-select', [['', 'как у роли'], ['edit', 'редактирование'], ['view', 'просмотр'], ['hidden', 'скрыта']], isPageRight(cur) ? cur : '');
      sel.addEventListener('change', () => {
        const v = sel.value;
        setPageRightInProject(pg.id, isPageRight(v) ? v : '');
        render();
      });
      row.appendChild(sel);
      pages.appendChild(row);
    }
    wrap.appendChild(pages);

    const maxLocked = planLocks('canSetMaxGuests');
    const maxRow = el('label', 'share-invite-role share-max-guests');
    maxRow.appendChild(el('span', '', 'Максимум гостей: '));
    const curMax = state.project.permissions?.maxGuests ?? 0;
    const opts = [...new Set([...MAX_GUESTS_OPTIONS, curMax && curMax <= MAX_GUESTS_LIMIT ? curMax : 0])].sort((a, b) => a - b);
    const maxSel = select('share-invite-select', opts.map(n => [String(n), n === 0 ? 'без ограничений' : String(n)] as const), maxLocked ? '1' : String(curMax || 0));
    maxSel.dataset.field = 'maxGuests';
    maxSel.disabled = maxLocked;
    maxSel.addEventListener('change', () => { setMaxGuestsInProject(Number(maxSel.value)); render(); });
    maxRow.appendChild(maxSel);
    if (maxLocked) {
      maxRow.appendChild(el('span', 'share-pro-tag', 'Pro'));
      maxRow.title = 'На бесплатном тарифе — один гость. Свой лимит гостей доступен в подписке Pro';
    }
    wrap.appendChild(maxRow);
    return wrap;
  }

  function renderEmails(): HTMLElement {
    const wrap = el('div', 'share-email');
    wrap.appendChild(el('div', 'share-cloud-title', 'Пригласить по почте'));
    const form = el('div', 'share-email-form');
    const input = el('input', 'share-email-input');
    input.type = 'email';
    input.placeholder = 'student@example.com';
    input.setAttribute('aria-label', 'Почта приглашённого');
    input.value = emailDraft;
    input.disabled = emailBusy;
    input.addEventListener('input', () => { emailDraft = input.value; });
    input.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); void sendEmail(); } });
    const role = select('share-invite-select share-email-role', [['edit', 'редактор'], ['view', 'читатель']], emailRole);
    role.disabled = emailBusy;
    role.addEventListener('change', () => { emailRole = role.value === 'view' ? 'view' : 'edit'; });
    const send = el('button', 'ctx-custom-btn share-email-send', emailBusy ? 'Отправляем…' : 'Пригласить');
    send.disabled = emailBusy;
    send.addEventListener('click', () => { void sendEmail(); });
    form.append(input, role, send);
    wrap.appendChild(form);
    if (emailMessage) wrap.appendChild(el('div', 'share-cloud-error', emailMessage));
    if (emails.length > 0) {
      const list = el('div', 'share-email-list');
      for (const inv of emails) {
        const row = el('div', 'share-email-item');
        row.dataset.inviteId = inv.id;
        row.appendChild(el('span', 'share-email-addr', inv.email));
        row.appendChild(el('span', 'share-email-meta', `${inv.role === 'view' ? 'читатель' : 'редактор'} · ${EMAIL_STATUS_TEXT[inv.status] ?? inv.status}`));
        const off = el('button', 'share-email-revoke', 'Отозвать');
        off.type = 'button';
        off.disabled = emailBusy;
        off.addEventListener('click', () => { void revokeEmail(inv); });
        row.appendChild(off);
        list.appendChild(row);
      }
      wrap.appendChild(list);
    }
    return wrap;
  }

  function render(): void {
    // поле адреса в фокусе: перерисовка окна не должна сбивать ввод
    const focused = box.contains(document.activeElement) && document.activeElement instanceof HTMLInputElement && document.activeElement.type === 'email';
    box.textContent = '';
    box.hidden = !available();
    if (box.hidden) return;
    box.appendChild(el('div', 'share-cloud-title', 'Ссылка-приглашение'));
    box.appendChild(renderRights());
    if (invite) {
      const token = invite.token;
      const link = el('div', 'share-link', inviteLink(token));
      link.title = 'Клик — скопировать ссылку';
      link.addEventListener('click', () => {
        void navigator.clipboard.writeText(inviteLink(token)).then(() => showToast('Ссылка скопирована'), () => showToast('Не удалось скопировать ссылку'));
      });
      box.appendChild(link);
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
    if (synced()) box.appendChild(renderEmails());
    if (focused) {
      const input = box.querySelector<HTMLInputElement>('.share-email-input');
      if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    }
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
