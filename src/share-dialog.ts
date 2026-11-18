import { showToast } from './about';
import { connectOwnerRoom } from './cloud-room';
import { collabActive, collabUsers, PRESENCE_EVENT, type CollabUser } from './collab';
import { getParticipantInitials } from './presence';
import { cursorPreset } from './cursors';
import { profileName } from './profile';
import { state } from './state';
import { isPageRight } from './limits';
import { ALIAS_MAX, aliasProblem, roleLabel, type AccessRole, type StoredRole } from './access';
import {
  MAX_GUESTS_OPTIONS, ROLE_OPTIONS, TEXT_OFFLINE, TEXT_UNSYNCED, aliasErrorText, cloudShareAvailable, cloudSynced, emailInviteErrorText,
  emailInviteStatusText, fetchAlias, fetchEmailInvites, fetchLink, linkUrlOf, planLocks, releaseAlias, resetLink, revokeEmailInvite, saveAlias, saveLink,
  sendEmailInvite, setMaxGuestsInProject, setPageRightInProject, setPermissionField, storedRoleLabel,
  type EmailInvite, type LinkInfo,
} from './invite-ui';
import { ApiError } from './api-client';
import type { PageRight } from './types';

// Окно «Поделиться» (SPEC_NIGHT6 §6): вкладки «Поделиться» и «Настройки доступа», три разных списка
// («Сейчас на доске», «У кого есть доступ», статус приглашения), общая ссылка, подключение без облака.
// Узлы формы создаются один раз: фоновое обновление списков не сбивает ввод и фокус. Только createElement/textContent.

// ----- Совместная работа без облака: интерфейс транспорта (приложение Electron или вкладка браузера) -----

export interface ShareUser {
  userId: number; name: string; color: string; host?: boolean; away?: boolean;
  rights?: { default?: string; pages?: Record<string, string> };
  cursorId?: string;
  access?: CollabUser['access'];
}
/** Комната на облачном ретрансляторе: гости из интернета. */
export interface ShareCloudStatus {
  state: 'connecting' | 'online' | 'reconnecting' | 'failed' | 'stopped';
  /** Ссылка для гостей; null — комнаты пока нет. */
  url: string | null;
  error: string | null;
  guests: number;
  relayUrl: string;
}
/** Адрес комнаты в локальной сети (D4): интерфейс, адрес, вид. */
export interface ShareLanUrl { iface: string; address: string; kind: string; url: string }
export interface ShareStatus {
  active: boolean; url?: string; urls?: ShareLanUrl[]; localOnly?: boolean; code?: string; port?: number; maxEditors?: number;
  users?: ShareUser[]; cloud?: ShareCloudStatus | null;
}
export interface ShareApi {
  /** connected — автор уже подключён к комнате (браузерный хост): в окне приложения подключаться должен сам диалог. */
  shareStart(): Promise<{ ok: boolean; port?: number; code?: string; hostKey?: string; connected?: boolean; error?: string }>;
  shareStop(): Promise<{ ok: boolean }>;
  shareStatus(): Promise<ShareStatus>;
  shareSetRights(uid: number, patch: { pages?: Record<string, string | null>; default?: string; all?: string; role?: string }): Promise<{ ok: boolean; error?: string }>;
  shareOpenTestWindow(): Promise<{ ok: boolean }>;
  /** Только в Electron; без relayUrl — ретранслятор по умолчанию. */
  shareCloudStart?(opts?: { relayUrl?: string }): Promise<{ ok: boolean; error?: string; cloud?: ShareCloudStatus | null }>;
  shareCloudStop?(): Promise<{ ok: boolean }>;
}

export interface ShareDialogDeps {
  api: ShareApi;
  /** Сохранить несохранённое перед запуском комнаты. */
  saveNow(): Promise<void>;
  /** Подключить автора к своему серверу совместной работы (Electron). */
  startHost(port: number, code: string, hostKey: string): Promise<void>;
  stopCollab(): void;
}

/** Свой адрес ретранслятора (сервер не по умолчанию); хранится только у автора. */
const RELAY_KEY = 'doska.relayUrl';
function savedRelayUrl(): string {
  try { return localStorage.getItem(RELAY_KEY) || ''; } catch { return ''; }
}
/** Ошибки, при которых стоит предложить ввести адрес ретранслятора. */
const RELAY_ADDRESS_ERRORS = /адрес ретранслятора|подключиться к ретранслятору/i;

// ----- Мелкие строители разметки -----

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function btn(cls: string, text: string, onClick: () => void, label?: string): HTMLButtonElement {
  const b = el('button', cls, text);
  b.type = 'button';
  if (label) b.setAttribute('aria-label', label);
  b.addEventListener('click', onClick);
  return b;
}
function selectEl(cls: string, options: readonly (readonly [string, string])[], value: string, label: string): HTMLSelectElement {
  const sel = el('select', cls);
  sel.setAttribute('aria-label', label);
  setOptions(sel, options, value);
  return sel;
}
function setOptions(sel: HTMLSelectElement, options: readonly (readonly [string, string])[], value: string): void {
  const key = JSON.stringify(options);
  if (sel.dataset.opts !== key) {
    sel.textContent = '';
    for (const [v, t] of options) {
      const o = el('option', '', t);
      o.value = v;
      sel.appendChild(o);
    }
    sel.dataset.opts = key;
  }
  if (document.activeElement !== sel) sel.value = value;
}
/** Список ролей для выбора; старая роль edit/view — отдельной строкой, пока выбрана. */
function roleOptions(current?: StoredRole): (readonly [string, string])[] {
  const out: (readonly [string, string])[] = ROLE_OPTIONS.map(r => [r, roleLabel(r)] as const);
  if (current === 'edit' || current === 'view') out.push([current, storedRoleLabel(current)]);
  return out;
}

/**
 * Обновить список по ключам: существующие узлы обновляются на месте и не переставляются без нужды
 * (иначе кнопка в фокусе потеряла бы его), лишние удаляются.
 */
function reconcile<T>(list: HTMLElement, items: readonly T[], keyOf: (x: T) => string, render: (x: T, prev: HTMLElement | null) => HTMLElement): void {
  const prev = new Map<string, HTMLElement>();
  for (const c of [...list.children] as HTMLElement[]) if (c.dataset.key) prev.set(c.dataset.key, c);
  const keep = new Set<string>();
  items.forEach((item, i) => {
    const key = keyOf(item);
    keep.add(key);
    const node = render(item, prev.get(key) ?? null);
    node.dataset.key = key;
    const at = list.children[i];
    if (at !== node) list.insertBefore(node, at ?? null);
  });
  for (const [key, node] of prev) if (!keep.has(key)) node.remove();
}

/** Видим ли элемент для перехода по Tab (без раскладки — подходит и для тестов). */
function tabbable(e: HTMLElement, root: HTMLElement): boolean {
  if ((e as HTMLButtonElement).disabled || e.tabIndex < 0) return false;
  for (let p: HTMLElement | null = e; p && p !== root; p = p.parentElement) {
    if (p.hidden) return false;
    const d = p.parentElement;
    if (d instanceof HTMLDetailsElement && !d.open && p.tagName !== 'SUMMARY') return false;
  }
  return true;
}
const FOCUSABLE = 'button, input, select, textarea, summary, a[href], [tabindex]';

// ----- Окно -----

let current: { close(): void } | null = null;

/** Окно открыто. */
export function shareDialogOpen(): boolean { return current !== null; }

/** Закрыть окно (фокус возвращается на кнопку «Поделиться»). */
export function closeShareDialog(): void { current?.close(); }

/** Открыть окно «Поделиться»; повторный вызов закрывает его (кнопка в шапке — переключатель). */
export async function openShareDialog(deps: ShareDialogDeps): Promise<void> {
  if (current) { current.close(); return; }
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const dlg = el('div');
  dlg.id = 'share-dialog';
  dlg.setAttribute('role', 'dialog');
  dlg.setAttribute('aria-modal', 'true');
  dlg.setAttribute('aria-labelledby', 'share-dialog-title');
  document.body.appendChild(dlg);

  // ----- Состояние окна -----
  let link: LinkInfo | null = null;
  let linkMessage = '';
  let linkBusy = false;
  let confirmReset = false;
  let emails: EmailInvite[] = [];
  let emailMessage = '';
  let emailBusy = false;
  let emailRole: StoredRole = 'editor';
  let revokedHint = false;
  let loadedFor = '';
  let status: ShareStatus = { active: false };
  let statusKey = '';
  const cloudUi = { starting: false, error: null as string | null, askRelay: false, relayDraft: savedRelayUrl() };
  let lanChoice = 0;
  /** Кто сейчас на доске (для перезапроса приглашений при входе и выходе). */
  let presentKey = '';
  let emailsTimer = 0;
  /** Ошибка последнего действия без облака (например, лимит редакторов) — видна в окне, а не системным alert. */
  let p2pMessage = '';

  // ----- Каркас -----
  const head = el('div', 'share-head');
  const title = el('h2', 'share-title');
  title.id = 'share-dialog-title';
  const closeX = btn('share-close', '×', () => close(), 'Закрыть');
  head.append(title, closeX);

  const tabs = el('div', 'share-tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Разделы окна «Поделиться»');
  const tabShare = btn('share-tab', 'Поделиться', () => selectTab('share'));
  const tabSettings = btn('share-tab', 'Настройки доступа', () => selectTab('settings'));
  tabShare.id = 'share-tab-share';
  tabSettings.id = 'share-tab-settings';
  const panelShare = el('div', 'share-panel');
  const panelSettings = el('div', 'share-panel');
  panelShare.id = 'share-panel-share';
  panelSettings.id = 'share-panel-settings';
  for (const [t, p] of [[tabShare, panelShare], [tabSettings, panelSettings]] as const) {
    t.setAttribute('role', 'tab');
    t.setAttribute('aria-controls', p.id);
    p.setAttribute('role', 'tabpanel');
    p.setAttribute('aria-labelledby', t.id);
  }
  tabs.append(tabShare, tabSettings);
  tabs.addEventListener('keydown', ev => {
    const order = [tabShare, tabSettings];
    const i = order.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    let next = -1;
    if (ev.key === 'ArrowRight') next = (i + 1) % order.length;
    else if (ev.key === 'ArrowLeft') next = (i - 1 + order.length) % order.length;
    else if (ev.key === 'Home') next = 0;
    else if (ev.key === 'End') next = order.length - 1;
    if (next < 0) return;
    ev.preventDefault();
    selectTab(next === 0 ? 'share' : 'settings');
    order[next].focus();
  });

  const live = el('div', 'share-live');
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  const say = (text: string) => { live.textContent = ''; live.textContent = text; };

  const foot = el('div', 'share-foot');
  foot.appendChild(btn('ctx-custom-btn share-done', 'Готово', () => close()));
  dlg.append(head, tabs, panelShare, panelSettings, live, foot);

  // ----- Вкладка «Поделиться»: облачная часть -----
  const cloudBox = el('div', 'share-invite');

  // приглашение по почте: форма создаётся один раз
  const emailBox = el('section', 'share-email');
  emailBox.appendChild(el('h3', 'share-cloud-title', 'Пригласить по почте'));
  const emailForm = el('div', 'share-email-form');
  const emailInput = el('input', 'share-email-input');
  emailInput.type = 'email';
  emailInput.placeholder = 'student@example.com';
  emailInput.setAttribute('aria-label', 'Почта приглашённого');
  emailInput.autocomplete = 'off';
  const emailRoleSel = selectEl('share-invite-select share-email-role', roleOptions(), emailRole, 'Роль приглашённого');
  emailRoleSel.addEventListener('change', () => { emailRole = emailRoleSel.value as StoredRole; });
  const emailSend = btn('ctx-custom-btn share-email-send', 'Пригласить', () => { void sendEmail(); });
  emailInput.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); void sendEmail(); } });
  emailForm.append(emailInput, emailRoleSel, emailSend);
  const emailHint = el('div', 'share-hint', 'В письме личная ссылка. Её можно переслать — не выдавайте роль выше нужной.');
  const emailMsg = el('div', 'share-cloud-error');
  emailMsg.setAttribute('role', 'alert');
  emailBox.append(emailForm, emailHint);

  // сейчас на доске
  const presentBox = el('section', 'share-present');
  const presentTitle = el('h3', 'share-cloud-title');
  const presentList = el('ul', 'share-people');
  const presentEmpty = el('div', 'share-hint', 'Сейчас на доске никого, кроме вас.');
  presentBox.append(presentTitle, presentList, presentEmpty);

  // у кого есть доступ
  const accessBox = el('section', 'share-access');
  accessBox.appendChild(el('h3', 'share-cloud-title', 'У кого есть доступ'));
  const accessList = el('ul', 'share-people');
  const revokedBox = el('div', 'share-revoked');
  accessBox.append(accessList, revokedBox);
  const ownerRow = el('li', 'share-person share-owner');
  ownerRow.dataset.key = 'owner';
  const linkRow = el('li', 'share-person share-link-row');
  linkRow.dataset.key = 'link';
  const linkRoleSel = selectEl('share-invite-select share-link-role', roleOptions(), 'editor', 'Роль по общей ссылке');
  linkRoleSel.dataset.field = 'role';
  // до создания ссылки роль — лишь выбор формы: ссылку создаёт выключатель (с этой ролью)
  linkRoleSel.addEventListener('change', () => { if (link) void changeLink({ defaultRole: linkRoleSel.value as StoredRole }); });
  const linkSwitch = btn('share-switch', '', () => { void toggleLink(); });
  linkSwitch.setAttribute('role', 'switch');
  linkSwitch.setAttribute('aria-label', 'Общая ссылка');

  // общая ссылка
  const linkBox = el('section', 'share-link-box');

  cloudBox.append(emailBox, presentBox, accessBox, linkBox);

  // ----- Подключение без облака -----
  const p2pBox = el('div', 'share-p2p');
  const otherWays = el('details', 'share-other');
  const otherSummary = el('summary', '', 'Другие способы подключения (без облака)');
  otherWays.appendChild(otherSummary);

  // ----- Вкладка «Настройки доступа» -----
  const settingsBox = el('div', 'share-settings');
  panelSettings.appendChild(settingsBox);

  // ----- Поведение -----

  function selectTab(t: 'share' | 'settings'): void {
    tabShare.setAttribute('aria-selected', String(t === 'share'));
    tabSettings.setAttribute('aria-selected', String(t === 'settings'));
    tabShare.tabIndex = t === 'share' ? 0 : -1;
    tabSettings.tabIndex = t === 'settings' ? 0 : -1;
    panelShare.hidden = t !== 'share';
    panelSettings.hidden = t !== 'settings';
    if (t === 'settings') renderSettings();
  }

  const projectName = () => state.project.name || 'Без названия';

  async function loadCloud(): Promise<void> {
    if (!cloudShareAvailable()) return;
    const id = state.project.id;
    loadedFor = id;
    link = null;
    emails = [];
    linkMessage = '';
    try {
      const r = await fetchLink(id);
      if (state.project.id === id) link = r;
    } catch (e) {
      linkMessage = e instanceof ApiError && e.status === 404 ? TEXT_UNSYNCED : e instanceof ApiError && e.isNetwork ? TEXT_OFFLINE : '';
    }
    if (cloudSynced()) {
      try {
        const list = await fetchEmailInvites(id);
        if (state.project.id === id) emails = list;
      } catch { /* список подтянется при следующем открытии */ }
    }
    renderCloud();
  }

  async function changeLink(body: { defaultRole?: StoredRole; enabled?: boolean }): Promise<void> {
    if (linkBusy) return;
    linkBusy = true;
    linkMessage = '';
    renderLink();
    try {
      const role = body.defaultRole ?? (link?.role as StoredRole | undefined) ?? (linkRoleSel.value as StoredRole);
      link = await saveLink(state.project.id, { defaultRole: role, ...(body.enabled !== undefined ? { enabled: body.enabled } : {}) });
      if (link.enabled) void connectOwnerRoom();
      say(body.enabled === false ? 'Общая ссылка выключена' : body.enabled === true ? 'Общая ссылка включена' : `Роль по ссылке: ${storedRoleLabel(link.role)}`);
    } catch (e) {
      linkMessage = e instanceof ApiError && e.status === 404 ? TEXT_UNSYNCED : e instanceof ApiError && e.isNetwork ? TEXT_OFFLINE : 'Не удалось изменить ссылку';
    } finally { linkBusy = false; renderCloud(); }
  }

  function toggleLink(): Promise<void> {
    // нет ссылки — включение создаёт её с выбранной ролью; есть — пауза или включение того же адреса
    return changeLink({ enabled: !(link && link.enabled) });
  }

  async function doReset(): Promise<void> {
    if (!link || linkBusy) return;
    linkBusy = true;
    confirmReset = false;
    try {
      link = await resetLink(link.token);
      say('Ссылка сброшена: прежняя больше не работает');
    } catch { linkMessage = 'Не удалось сбросить ссылку'; } finally { linkBusy = false; renderCloud(); }
  }

  async function sendEmail(): Promise<void> {
    const email = emailInput.value.trim();
    if (emailBusy) return;
    if (!email) { emailMessage = 'Введите адрес почты'; renderEmails(); emailInput.focus(); return; }
    emailBusy = true;
    emailMessage = '';
    renderEmails();
    try {
      const r = await sendEmailInvite(state.project.id, email, emailRole);
      emails = [r.invite, ...emails.filter(x => x.id !== r.invite.id)];
      emailInput.value = '';
      const text = r.mailed ? `Приглашение отправлено: ${r.invite.email}` : `Приглашение обновлено: ${r.invite.email}`;
      showToast(text);
      say(text);
    } catch (e) {
      emailMessage = emailInviteErrorText(e);
    } finally { emailBusy = false; renderEmails(); }
  }

  async function changeEmailRole(inv: EmailInvite, role: StoredRole): Promise<void> {
    if (emailBusy) return;
    emailBusy = true;
    try {
      const r = await sendEmailInvite(state.project.id, inv.email, role);
      emails = emails.map(x => (x.id === r.invite.id ? r.invite : x));
      say(`Роль ${inv.email}: ${storedRoleLabel(r.invite.role)}`);
    } catch (e) { emailMessage = emailInviteErrorText(e); } finally { emailBusy = false; renderEmails(); }
  }

  async function revokeEmail(inv: EmailInvite): Promise<void> {
    if (emailBusy) return;
    emailBusy = true;
    try {
      await revokeEmailInvite(inv);
      emails = emails.filter(x => x.id !== inv.id);
      // отзывается только этот способ входа: при включённой общей ссылке человек всё ещё может войти по ней
      revokedHint = !!link?.enabled;
      say(`Приглашение ${inv.email} отозвано`);
    } catch (e) {
      emailMessage = e instanceof ApiError && e.isNetwork ? TEXT_OFFLINE : 'Не удалось отозвать приглашение';
    } finally { emailBusy = false; renderEmails(); renderAccess(); }
  }

  // ----- Отрисовка частей -----

  function renderEmails(): void {
    emailInput.disabled = emailBusy;
    emailRoleSel.disabled = emailBusy;
    emailSend.disabled = emailBusy;
    emailSend.textContent = emailBusy ? 'Отправляем…' : 'Пригласить';
    // блок ошибки — только когда есть что сказать (пустой мешал бы искать ошибки окна)
    emailMsg.textContent = emailMessage;
    if (emailMessage && !emailMsg.isConnected) emailBox.appendChild(emailMsg);
    else if (!emailMessage) emailMsg.remove();
    emailBox.hidden = !cloudSynced();
    renderAccess();
  }

  function sourceText(u: CollabUser | ShareUser): string {
    const a = u.access;
    if (!a) return '';
    if (a.source === 'link') return 'по общей ссылке';
    if (a.source === 'alias') return 'по именному адресу';
    if (a.source === 'email') {
      const inv = a.inviteId ? emails.find(x => x.id === a.inviteId) : undefined;
      return inv ? `по приглашению ${inv.email}` : 'по приглашению на почту';
    }
    if (a.source === 'p2p') return 'по ссылке без облака';
    return '';
  }

  function personRow(prev: HTMLElement | null, color: { bg: string; fg: string }, initials: string, name: string, meta: string): HTMLElement {
    const row = prev ?? el('li', 'share-person');
    if (!row.querySelector('.share-avatar')) {
      const av = el('span', 'share-avatar');
      av.setAttribute('aria-hidden', 'true');
      const text = el('span', 'share-person-text');
      text.append(el('span', 'share-person-name'), el('span', 'share-person-meta'));
      row.append(av, text);
    }
    const av = row.querySelector<HTMLElement>('.share-avatar')!;
    av.textContent = initials;
    av.style.background = color.bg;
    av.style.color = color.fg;
    row.querySelector('.share-person-name')!.textContent = name;
    row.querySelector('.share-person-meta')!.textContent = meta;
    return row;
  }

  function renderPresent(): void {
    const users: (CollabUser | ShareUser)[] = collabActive() ? [...collabUsers()] : status.active ? status.users ?? [] : [];
    const hosts = users.filter(u => u.host);
    const guests = users.filter(u => !u.host);
    presentTitle.textContent = `Сейчас на доске · ${guests.length + (hosts.length > 0 ? 1 : 0)}`;
    const items: { key: string; u: CollabUser | ShareUser | null }[] = [];
    if (hosts.length > 0) items.push({ key: 'owner', u: null });
    for (const g of guests) items.push({ key: `u${g.userId}`, u: g });
    reconcile(presentList, items, x => x.key, (x, prev) => {
      if (!x.u) {
        const me = profileName() || 'Вы';
        const devices = hosts.length > 1 ? ` · ${hosts.length} ${hosts.length < 5 ? 'устройства' : 'устройств'}` : '';
        return personRow(prev, { bg: '#e03131', fg: '#fff' }, getParticipantInitials(me), me, `вы · владелец${devices}`);
      }
      const u = x.u;
      const preset = cursorPreset(u.cursorId);
      const role = u.access && u.access.role !== 'owner' ? roleLabel(u.access.role as AccessRole) : '';
      const page = 'pageId' in u && u.pageId ? state.project.pages.find(p => p.id === u.pageId)?.name : undefined;
      const where = 'hiddenPage' in u && u.hiddenPage ? 'на скрытой странице' : page ? `«${page}»` : '';
      const meta = [role, sourceText(u), where, u.away ? 'отошёл' : ''].filter(Boolean).join(' · ');
      return personRow(prev, { bg: preset.badgeBg, fg: preset.badgeText }, getParticipantInitials(u.name), u.name, meta);
    });
    presentEmpty.hidden = guests.length > 0;
    // кто-то вошёл или вышел — у приглашений по почте мог появиться «заходил(а)»: список перезапрашивается
    const who = guests.map(g => g.userId).sort((x, y) => x - y).join(',');
    if (who !== presentKey) {
      presentKey = who;
      if (cloudShareAvailable() && cloudSynced() && loadedFor === state.project.id) {
        clearTimeout(emailsTimer);
        emailsTimer = window.setTimeout(() => {
          const id = state.project.id;
          void fetchEmailInvites(id).then(list => { if (state.project.id === id && current) { emails = list; renderEmails(); } }, () => {});
        }, 600);
      }
    }
  }

  function renderAccess(): void {
    const me = profileName() || 'Вы';
    personRow(ownerRow, { bg: '#e03131', fg: '#fff' }, getParticipantInitials(me), me, 'Владелец');
    // строка общей ссылки: роль и выключатель
    if (!linkRow.firstChild) {
      const icon = el('span', 'share-avatar share-avatar-link', '🔗');
      icon.setAttribute('aria-hidden', 'true');
      const text = el('span', 'share-person-text');
      text.append(el('span', 'share-person-name', 'Все, у кого есть ссылка'), el('span', 'share-person-meta'));
      const ctl = el('span', 'share-person-ctl');
      ctl.append(linkRoleSel, linkSwitch);
      linkRow.append(icon, text, ctl);
    }
    const on = !!link?.enabled;
    linkRow.querySelector('.share-person-meta')!.textContent = !link ? 'ссылка не создана' : on ? 'ссылка включена' : 'ссылка выключена';
    setOptions(linkRoleSel, roleOptions(link?.role), link?.role ?? linkRoleSel.value ?? 'editor');
    linkRoleSel.disabled = linkBusy;
    linkSwitch.setAttribute('aria-checked', String(on));
    linkSwitch.textContent = on ? 'Вкл' : 'Выкл';
    linkSwitch.disabled = linkBusy;
    linkSwitch.classList.toggle('on', on);

    type Row = { key: string; inv?: EmailInvite };
    const rows: Row[] = [{ key: 'owner' }, { key: 'link' }, ...emails.map(inv => ({ key: `e${inv.id}`, inv }))];
    reconcile(accessList, rows, r => r.key, (r, prev) => {
      if (r.key === 'owner') return ownerRow;
      if (r.key === 'link') return linkRow;
      const inv = r.inv!;
      const row = prev ?? el('li', 'share-person share-email-item');
      row.dataset.inviteId = inv.id;
      if (!prev) {
        const icon = el('span', 'share-avatar share-avatar-mail', '✉');
        icon.setAttribute('aria-hidden', 'true');
        const text = el('span', 'share-person-text');
        text.append(el('span', 'share-person-name share-email-addr'), el('span', 'share-person-meta share-email-meta'));
        const ctl = el('span', 'share-person-ctl');
        const roleSel = selectEl('share-invite-select share-email-row-role', roleOptions(inv.role), inv.role, `Роль ${inv.email}`);
        roleSel.addEventListener('change', () => { void changeEmailRole(inv, roleSel.value as StoredRole); });
        const off = btn('share-email-revoke', 'Отозвать', () => { void revokeEmail(inv); }, `Отозвать приглашение ${inv.email}`);
        ctl.append(roleSel, off);
        row.append(icon, text, ctl);
      }
      row.querySelector('.share-email-addr')!.textContent = inv.email;
      row.querySelector('.share-email-meta')!.textContent = `${storedRoleLabel(inv.role)} · ${emailInviteStatusText(inv)}`;
      setOptions(row.querySelector<HTMLSelectElement>('.share-email-row-role')!, roleOptions(inv.role), inv.role);
      for (const c of row.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('button, select')) c.disabled = emailBusy;
      return row;
    });

    revokedBox.textContent = '';
    if (revokedHint && link?.enabled) {
      revokedBox.appendChild(el('span', '', 'Приглашение отозвано. Если у человека есть общая ссылка, он сможет войти по ней. '));
      revokedBox.appendChild(btn('share-inline-btn', 'Выключить общую ссылку', () => { revokedHint = false; void changeLink({ enabled: false }); }));
    }
  }

  function renderLink(): void {
    const focusKey = (document.activeElement as HTMLElement | null)?.closest('.share-link-box') ? (document.activeElement as HTMLElement).dataset.key : undefined;
    linkBox.textContent = '';
    linkBox.appendChild(el('h3', 'share-cloud-title', 'Общая ссылка'));
    if (!link) {
      linkBox.appendChild(el('div', 'share-hint', 'Включите общую ссылку в списке выше — по ней войдёт любой, у кого она есть.'));
    } else {
      const url = linkUrlOf(link);
      const rowEl = el('div', 'share-url-row');
      const input = el('input', 'share-url');
      input.readOnly = true;
      input.value = url;
      input.setAttribute('aria-label', 'Общая ссылка');
      input.dataset.key = 'url';
      input.addEventListener('focus', () => input.select());
      const copy = btn('ctx-custom-btn share-copy', 'Копировать', () => {
        void navigator.clipboard.writeText(url).then(() => { say('Ссылка скопирована'); showToast('Ссылка скопирована'); }, () => say('Не удалось скопировать ссылку'));
      }, 'Скопировать общую ссылку');
      copy.dataset.key = 'copy';
      copy.disabled = !link.enabled;
      rowEl.append(input, copy);
      linkBox.appendChild(rowEl);
      if (!link.enabled) linkBox.appendChild(el('div', 'share-hint', 'Ссылка выключена: по ней сейчас никто не войдёт. Включите её снова — заработает тот же адрес.'));
      if (!link.enabled) {
        const lv = el('label', 'share-invite-check');
        const cb = el('input');
        cb.type = 'checkbox';
        cb.dataset.key = 'linkview';
        cb.checked = state.project.permissions?.linkView === false;
        cb.addEventListener('change', () => { setPermissionField('linkView', cb.checked ? false : undefined); say(cb.checked ? 'Просмотр по ссылке на доску закрыт' : 'Просмотр по ссылке на доску открыт'); });
        lv.append(cb, el('span', '', 'И закрыть просмотр по ссылке на доску'));
        linkBox.appendChild(lv);
      }
      if (link.alias) {
        const al = el('div', 'share-alias-line');
        al.append(el('span', '', `Именной адрес: ${link.alias}`));
        const edit = btn('share-inline-btn', 'Изменить', () => { selectTab('settings'); tabSettings.focus(); });
        edit.dataset.key = 'alias';
        al.appendChild(edit);
        linkBox.appendChild(al);
      }
      if (confirmReset) {
        const c = el('div', 'share-confirm');
        c.setAttribute('role', 'alert');
        c.appendChild(el('span', '', 'Старая ссылка перестанет работать. '));
        const yes = btn('ctx-custom-btn danger', 'Сбросить', () => { void doReset(); });
        yes.dataset.key = 'reset-yes';
        const no = btn('ctx-custom-btn', 'Отмена', () => { confirmReset = false; renderLink(); });
        no.dataset.key = 'reset-no';
        c.append(yes, no);
        linkBox.appendChild(c);
      } else {
        const reset = btn('share-inline-btn share-reset', 'Сбросить ссылку…', () => { confirmReset = true; renderLink(); linkBox.querySelector<HTMLButtonElement>('[data-key="reset-no"]')?.focus(); });
        reset.dataset.key = 'reset';
        reset.disabled = linkBusy;
        linkBox.appendChild(reset);
      }
    }
    if (linkMessage) linkBox.appendChild(el('div', 'share-cloud-error', linkMessage));
    if (focusKey) linkBox.querySelector<HTMLElement>(`[data-key="${focusKey}"]`)?.focus();
  }

  function renderCloud(): void {
    renderEmails();
    renderPresent();
    renderLink();
  }

  // ----- Без облака -----

  async function startCloudShare(relayUrl: string): Promise<void> {
    cloudUi.starting = true;
    cloudUi.error = null;
    await refreshStatus(true);
    const r = await deps.api.shareCloudStart!(relayUrl ? { relayUrl } : undefined);
    cloudUi.starting = false;
    if (r.ok) {
      cloudUi.askRelay = false;
      if (relayUrl) try { localStorage.setItem(RELAY_KEY, relayUrl); } catch { /* не запомним — введут снова */ }
    } else {
      cloudUi.error = r.error || 'Не удалось подключиться к ретранслятору';
      if (RELAY_ADDRESS_ERRORS.test(cloudUi.error)) cloudUi.askRelay = true;
    }
    await refreshStatus(true);
  }

  function copyButton(cls: string, url: string): HTMLButtonElement {
    // ссылка — кнопка: клавиатура и скринридер; клик копирует, текст на миг меняется
    const b = btn(cls, url, () => {
      void navigator.clipboard.writeText(url);
      b.textContent = 'Ссылка скопирована';
      say('Ссылка скопирована');
      setTimeout(() => { b.textContent = url; }, 1200);
    }, `Скопировать ссылку ${url}`);
    b.title = 'Клик — скопировать ссылку';
    return b;
  }

  function renderRelay(box: HTMLElement): void {
    if (!deps.api.shareCloudStart) return;
    const wrap = el('div', 'share-cloud');
    wrap.appendChild(el('h3', 'share-cloud-title', 'Через интернет'));
    const cloud = status.cloud;
    const running = !!cloud && (cloud.state === 'online' || cloud.state === 'reconnecting' || cloud.state === 'connecting');
    if (running) {
      if (cloud!.url) {
        const b = copyButton('share-link share-link-cloud', cloud!.url);
        b.dataset.key = 'relay-link';
        wrap.appendChild(b);
      }
      const note = el('div', 'share-cloud-status');
      if (cloud!.state === 'reconnecting') {
        note.classList.add('warn');
        note.textContent = 'Связь с сервером прервалась — переподключаемся. Гости подождут.';
      } else note.textContent = 'Ссылка откроется на любом устройстве с интернетом.';
      wrap.appendChild(note);
      const stop = btn('ctx-custom-btn danger', 'Закрыть доступ через интернет', async () => {
        await deps.api.shareCloudStop?.();
        cloudUi.error = null;
        await refreshStatus(true);
      });
      stop.dataset.key = 'relay-stop';
      wrap.appendChild(stop);
      box.appendChild(wrap);
      return;
    }
    const error = cloudUi.error || (cloud?.state === 'failed' ? cloud.error : null);
    if (error) wrap.appendChild(el('div', 'share-cloud-error', error));
    let input: HTMLInputElement | null = null;
    if (cloudUi.askRelay) {
      input = el('input', 'share-relay-input');
      input.type = 'url';
      input.placeholder = 'wss://relay.example.com';
      input.value = cloudUi.relayDraft;
      input.setAttribute('aria-label', 'Адрес сервера-ретранслятора');
      input.dataset.key = 'relay-input';
      input.addEventListener('input', () => { cloudUi.relayDraft = input!.value; });
      wrap.appendChild(input);
    }
    const start = btn('ctx-custom-btn', cloudUi.starting ? 'Подключение…' : error ? 'Подключиться снова' : 'Пригласить через интернет', () => {
      const relay = input ? input.value.trim() : savedRelayUrl();
      void startCloudShare(relay);
    });
    start.dataset.key = 'relay-start';
    start.disabled = cloudUi.starting;
    input?.addEventListener('keydown', ev => { if (ev.key === 'Enter') start.click(); });
    wrap.appendChild(start);
    box.appendChild(wrap);
  }

  function renderParticipants(box: HTMLElement): void {
    const users = (status.users || []).filter(u => !u.host);
    if (users.length === 0) {
      box.appendChild(el('div', 'ctx-label', 'Откройте ссылку на другом устройстве или в тестовом окне'));
      return;
    }
    box.appendChild(el('div', 'ctx-label', `Участники (${users.length}) — права по страницам:`));
    if (p2pMessage) {
      const err = el('div', 'share-cloud-error share-p2p-error', p2pMessage);
      err.setAttribute('role', 'alert');
      box.appendChild(err);
    }
    const table = el('div', 'share-table');
    for (const u of users) {
      const row = el('div', 'share-user');
      const head2 = el('div', 'share-user-head');
      const dot = el('i');
      dot.style.background = u.away ? '#9aa0ab' : u.color;
      head2.append(dot, el('span', '', u.name + (u.away ? ' · Отошёл' : '')));
      row.appendChild(head2);
      for (const pg of state.project.pages) {
        const cur = u.rights?.pages?.[pg.id] || u.rights?.default || 'view';
        const options = (['view', 'edit', 'hidden'] as const).map(v => [v, `${pg.name}: ${v === 'view' ? 'Просмотр' : v === 'edit' ? 'Редактирование' : 'Скрыть'}`] as const);
        const sel = selectEl('', [...options, ['', `${pg.name}: как у роли`]], cur, `${u.name}, страница «${pg.name}»`);
        sel.dataset.key = `u${u.userId}-${pg.id}`;
        sel.addEventListener('change', async () => {
          // «как у роли» снимает личное право участника на страницу
          const r = await deps.api.shareSetRights(u.userId, { pages: { [pg.id]: sel.value === '' ? null : sel.value } });
          p2pMessage = r.ok ? '' : r.error || 'Не удалось изменить права';
          if (!r.ok) say(p2pMessage);
          await refreshStatus(true);
        });
        row.appendChild(sel);
      }
      // роль участника (Ночь №6): после прав страниц, чтобы их порядок в строке не менялся
      const role = u.access && u.access.role !== 'owner' ? u.access.role : 'commenter';
      const roleSel = selectEl('share-user-role', ROLE_OPTIONS.map(r => [r, `Роль: ${roleLabel(r)}`] as const), role, `Роль участника ${u.name}`);
      roleSel.dataset.key = `u${u.userId}-role`;
      roleSel.addEventListener('change', async () => {
        const r = await deps.api.shareSetRights(u.userId, { role: roleSel.value });
        p2pMessage = r.ok ? '' : r.error || 'Не удалось изменить роль';
        if (!r.ok) say(p2pMessage);
        await refreshStatus(true);
      });
      row.appendChild(roleSel);
      table.appendChild(row);
    }
    box.appendChild(table);
  }

  function renderP2P(): void {
    const focusKey = p2pBox.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.key : undefined;
    p2pBox.textContent = '';
    p2pBox.appendChild(el('h3', 'share-cloud-title', 'Подключение без облака'));
    if (!status.active) {
      if (p2pMessage) p2pBox.appendChild(el('div', 'share-cloud-error', p2pMessage));
      const start = btn('ctx-custom-btn', 'Включить совместную работу', async () => {
        await deps.saveNow();
        const r = await deps.api.shareStart();
        if (!r.ok || (!r.connected && (!r.port || !r.code || !r.hostKey))) {
          p2pMessage = r.error || 'Не удалось запустить сервер совместной работы';
          say(p2pMessage);
          await refreshStatus(true);
          return;
        }
        p2pMessage = '';
        if (!r.connected) await deps.startHost(r.port!, r.code!, r.hostKey!);
        await refreshStatus(true);
      });
      start.dataset.key = 'p2p-start';
      p2pBox.appendChild(start);
    } else {
      // ссылка в локальной сети и тестовое окно есть только у приложения; во вкладке гостей зовут через интернет
      if (status.url) {
        const urls = status.urls ?? [];
        const chosen = urls[lanChoice]?.url ?? status.url;
        const sub = el('div', 'share-cloud-title', status.localOnly ? 'Только на этом компьютере' : `В этой сети${urls[lanChoice] ? ` (${urls[lanChoice].iface} ${urls[lanChoice].address})` : ''}:`);
        p2pBox.appendChild(sub);
        const b = copyButton('share-link', chosen);
        b.dataset.key = 'lan-link';
        p2pBox.appendChild(b);
        if (status.localOnly) {
          p2pBox.appendChild(el('div', 'share-cloud-status warn', 'Нет подключения к сети: адрес 127.0.0.1 работает только на этом компьютере. Подключитесь к Wi-Fi или позовите гостей через интернет.'));
        } else if (urls.length > 1) {
          const other = selectEl('share-invite-select share-lan-choice', urls.map((u, i) => [String(i), `${u.iface} ${u.address}${u.kind === 'virtual' ? ' (виртуальный адаптер)' : ''}`] as const), String(lanChoice), 'Другой адрес этого компьютера');
          other.dataset.key = 'lan-choice';
          other.addEventListener('change', () => { lanChoice = Number(other.value) || 0; renderP2P(); });
          const lbl = el('label', 'share-invite-role');
          lbl.append(el('span', '', 'Другой адрес: '), other);
          p2pBox.appendChild(lbl);
        }
        const testBtn = btn('ctx-custom-btn', '+ Тестовое окно гостя', () => { void deps.api.shareOpenTestWindow(); });
        testBtn.dataset.key = 'test';
        p2pBox.appendChild(testBtn);
      }
      renderRelay(p2pBox);
      const stopBtn = btn('ctx-custom-btn danger', 'Выключить совместную работу', async () => {
        await deps.api.shareStop();
        deps.stopCollab();
        Object.assign(cloudUi, { starting: false, error: null, askRelay: false });
        await refreshStatus(true);
      });
      stopBtn.dataset.key = 'p2p-stop';
      p2pBox.appendChild(stopBtn);
      renderParticipants(p2pBox);
    }
    if (focusKey) p2pBox.querySelector<HTMLElement>(`[data-key="${CSS.escape(focusKey)}"]`)?.focus();
  }

  /** Размещение блоков: без облака путь без сервера — первым и развёрнут; с облаком — свёрнут, но не скрыт. */
  function layout(): void {
    const cloud = cloudShareAvailable();
    cloudBox.hidden = !cloud;
    if (!cloudBox.parentElement) panelShare.appendChild(cloudBox);
    if (cloud) {
      if (p2pBox.parentElement !== otherWays) otherWays.appendChild(p2pBox);
      if (otherWays.parentElement !== panelShare) panelShare.appendChild(otherWays);
      if (status.active) otherWays.open = true;
    } else {
      if (p2pBox.parentElement !== panelShare) panelShare.insertBefore(p2pBox, panelShare.firstChild);
      otherWays.remove();
    }
  }

  async function refreshStatus(force = false): Promise<void> {
    try { status = await deps.api.shareStatus(); } catch { status = { active: false }; }
    const key = JSON.stringify([status, cloudUi.starting, cloudUi.error, cloudUi.askRelay, lanChoice, p2pMessage, state.project.pages.map(p => [p.id, p.name])]);
    if (force || key !== statusKey) { statusKey = key; renderP2P(); }
    layout();
    renderPresent();
  }

  // ----- Вкладка «Настройки доступа» -----

  /** Состояние редактора именного адреса между перерисовками. */
  const aliasUi = { loadedFor: '', alias: null as string | null, former: [] as string[], draft: '', message: '', busy: false, confirmRelease: '' };

  async function loadAlias(): Promise<void> {
    if (!cloudShareAvailable() || !cloudSynced()) return;
    const id = state.project.id;
    aliasUi.loadedFor = id;
    try {
      const r = await fetchAlias(id);
      if (state.project.id !== id) return;
      aliasUi.alias = r.alias;
      aliasUi.former = r.former;
      if (!aliasUi.draft) aliasUi.draft = r.alias ?? '';
    } catch { /* без сети — покажем при следующем открытии */ }
    renderSettings();
  }

  async function submitAlias(): Promise<void> {
    const draft = aliasUi.draft.trim();
    const problem = aliasProblem(draft);
    if (problem) { aliasUi.message = problem; renderSettings(); return; }
    aliasUi.busy = true;
    aliasUi.message = '';
    renderSettings();
    try {
      const r = await saveAlias(state.project.id, draft);
      aliasUi.alias = r.alias;
      aliasUi.former = r.former;
      if (link) link = { ...link, alias: r.alias, prettyUrl: r.prettyUrl ?? link.prettyUrl };
      say(`Именной адрес: ${r.alias}`);
    } catch (e) { aliasUi.message = aliasErrorText(e); } finally { aliasUi.busy = false; renderSettings(); renderLink(); }
  }

  async function doRelease(alias: string): Promise<void> {
    aliasUi.confirmRelease = '';
    aliasUi.busy = true;
    try {
      await releaseAlias(state.project.id, alias);
      aliasUi.former = aliasUi.former.filter(a => a !== alias);
      if (aliasUi.alias === alias) { aliasUi.alias = null; if (link) link = { ...link, alias: null }; }
      say(`Адрес ${alias} освобождён`);
    } catch (e) { aliasUi.message = aliasErrorText(e); } finally { aliasUi.busy = false; renderSettings(); renderLink(); }
  }

  /** Галочка настройки; locked — недоступна на тарифе (метка Pro). */
  function check(field: string, text: string, checked: boolean, onChange: (on: boolean) => void, locked = false): HTMLElement {
    const row = el('label', 'share-invite-check');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.dataset.field = field;
    cb.dataset.key = field;
    cb.checked = checked;
    cb.disabled = locked;
    cb.addEventListener('change', () => { onChange(cb.checked); renderSettings(); });
    row.append(cb, el('span', '', text));
    if (locked) row.appendChild(el('span', 'share-pro-tag', 'Pro'));
    return row;
  }

  function renderAliasEditor(box: HTMLElement): void {
    const sec = el('section', 'share-alias');
    sec.appendChild(el('h3', 'share-cloud-title', 'Именной адрес'));
    const locked = planLocks('canSetAlias');
    sec.appendChild(el('div', 'share-hint', 'Короткий адрес вроде /j/physics-9a ведёт на общую ссылку доски и даёт те же права. Это не секрет: его может набрать любой.'));
    const row = el('div', 'share-alias-row');
    const prefix = el('span', 'share-alias-prefix', '/j/');
    const input = el('input', 'share-alias-input');
    input.type = 'text';
    input.value = aliasUi.draft;
    input.placeholder = 'physics-9a';
    input.maxLength = ALIAS_MAX;
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.dataset.key = 'alias-input';
    input.setAttribute('aria-label', 'Именной адрес доски');
    input.disabled = locked || aliasUi.busy;
    const save = btn('ctx-custom-btn share-alias-save', aliasUi.alias ? 'Изменить' : 'Сохранить', () => { void submitAlias(); });
    save.dataset.key = 'alias-save';
    save.disabled = locked || aliasUi.busy;
    const problemEl = el('div', 'share-hint share-alias-problem');
    problemEl.setAttribute('aria-live', 'polite');
    const showProblem = () => {
      const v = input.value.trim();
      problemEl.textContent = v ? aliasProblem(v) ?? '' : '';
    };
    input.addEventListener('input', () => { aliasUi.draft = input.value.toLowerCase(); if (input.value !== aliasUi.draft) input.value = aliasUi.draft; aliasUi.message = ''; showProblem(); });
    input.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); void submitAlias(); } });
    row.append(prefix, input, save);
    if (locked) row.appendChild(el('span', 'share-pro-tag', 'Pro'));
    sec.appendChild(row);
    showProblem();
    sec.appendChild(problemEl);
    if (aliasUi.message) {
      const err = el('div', 'share-cloud-error', aliasUi.message);
      err.setAttribute('role', 'alert');
      sec.appendChild(err);
    }
    if (aliasUi.former.length > 0) {
      sec.appendChild(el('div', 'share-cloud-title', 'Бывшие адреса — ведут на эту же доску'));
      const list = el('ul', 'share-people');
      for (const f of aliasUi.former) {
        const li = el('li', 'share-person');
        li.appendChild(el('span', 'share-person-name', `/j/${f}`));
        if (aliasUi.confirmRelease === f) {
          const c = el('span', 'share-confirm');
          c.appendChild(el('span', '', 'Адрес перестанет вести на доску и больше никому не достанется. '));
          const yes = btn('ctx-custom-btn danger', 'Освободить', () => { void doRelease(f); });
          yes.dataset.key = `release-yes-${f}`;
          const no = btn('ctx-custom-btn', 'Отмена', () => { aliasUi.confirmRelease = ''; renderSettings(); });
          no.dataset.key = `release-no-${f}`;
          c.append(yes, no);
          li.appendChild(c);
        } else {
          const rel = btn('share-inline-btn', 'Освободить', () => { aliasUi.confirmRelease = f; renderSettings(); settingsBox.querySelector<HTMLElement>(`[data-key="release-no-${CSS.escape(f)}"]`)?.focus(); }, `Освободить адрес ${f}`);
          rel.dataset.key = `release-${f}`;
          li.appendChild(rel);
        }
        list.appendChild(li);
      }
      sec.appendChild(list);
    }
    if (!link?.enabled) sec.appendChild(el('div', 'share-hint', 'Адрес работает, пока включена общая ссылка.'));
    box.appendChild(sec);
  }

  function renderSettings(): void {
    const focusKey = settingsBox.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.key : undefined;
    settingsBox.textContent = '';
    const perms = state.project.permissions ?? {};
    const legacyLink = link?.role === 'edit' || link?.role === 'view';

    // права страниц: «По роли» / «Только просмотр» / «Скрыта»; старое «редактирование для всех» — пока стоит
    const pages = el('section', 'share-page-rights');
    pages.appendChild(el('h3', 'share-cloud-title', 'Страницы'));
    for (const pg of state.project.pages) {
      const row = el('label', 'share-page-right');
      row.dataset.pageId = pg.id;
      row.appendChild(el('span', 'share-page-name', pg.name || 'Без названия'));
      const cur = perms.pageRights?.[pg.id];
      const options: (readonly [string, string])[] = [['', 'По роли'], ['view', 'Только просмотр'], ['hidden', 'Скрыта']];
      if (cur === 'edit') options.splice(1, 0, ['edit', 'Редактирование для всех (старая настройка)']);
      const sel = selectEl('share-invite-select', options, isPageRight(cur) ? cur : '', `Доступ к странице «${pg.name}»`);
      sel.dataset.key = `page-${pg.id}`;
      sel.addEventListener('change', () => {
        const v = sel.value;
        setPageRightInProject(pg.id, isPageRight(v) ? v as PageRight : '');
        renderSettings();
      });
      row.appendChild(sel);
      pages.appendChild(row);
      if (cur === 'edit') {
        const warn = el('div', 'share-warn');
        warn.appendChild(el('span', '', legacyLink
          ? `«${pg.name}»: по старой настройке гости старой ссылки могут её редактировать. Для новых ролей действует роль. `
          : `«${pg.name}»: старая настройка «редактирование для всех» больше не повышает роль — действует роль. `));
        const ok = btn('share-inline-btn', 'Понятно', () => { setPageRightInProject(pg.id, ''); renderSettings(); }, `Понятно: страница «${pg.name}» — по роли`);
        ok.dataset.key = `page-ok-${pg.id}`;
        warn.appendChild(ok);
        pages.appendChild(warn);
      }
    }
    settingsBox.appendChild(pages);

    // защита чужих элементов
    const protect = el('section', 'share-protect');
    protect.appendChild(el('h3', 'share-cloud-title', 'Защита'));
    protect.appendChild(check('protectElements', 'Участники не могут сдвигать, менять и стирать чужие элементы (свои — могут)',
      perms.protectElements === true, on => setPermissionField('protectElements', on ? true : undefined)));
    settingsBox.appendChild(protect);

    // копирование и копия доски
    const copy = el('section', 'share-copy-settings');
    copy.appendChild(el('h3', 'share-cloud-title', 'Копирование'));
    const copyLocked = planLocks('canProtectCopy');
    copy.appendChild(check('allowCopy', 'Читатели и комментаторы могут копировать и экспортировать (видимое на экране всё равно можно сфотографировать)',
      copyLocked ? true : perms.allowCopy !== false, on => {
        setPermissionField('allowCopy', on ? undefined : false);
        // старые ссылки с запретом копирования не должны молча его потерять — ссылка получает тот же флаг
        if (link) void saveLink(state.project.id, { defaultRole: link.role, allowCopy: on }).then(r => { link = r; }, () => {});
      }, copyLocked));
    const cloneLocked = planLocks('canProtectClone');
    copy.appendChild(check('allowClone', 'Можно сделать копию доски себе', cloneLocked ? true : perms.forbidClone !== true,
      on => setPermissionField('forbidClone', on ? undefined : true), cloneLocked));
    settingsBox.appendChild(copy);

    // ссылки
    const links = el('section', 'share-links-settings');
    links.appendChild(el('h3', 'share-cloud-title', 'Ссылки'));
    links.appendChild(check('linkView', 'Просмотр по ссылке на доску и страницу (без приглашения, только чтение)', perms.linkView !== false,
      on => setPermissionField('linkView', on ? undefined : false)));
    settingsBox.appendChild(links);
    if (cloudShareAvailable() && cloudSynced()) renderAliasEditor(settingsBox);

    // участники
    const people = el('section', 'share-settings-people');
    people.appendChild(el('h3', 'share-cloud-title', 'Участники'));
    const group = el('div', 'share-radio-group');
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', 'Кто может позвать всех к себе');
    group.appendChild(el('span', 'share-radio-title', 'Кто может позвать всех к себе:'));
    for (const [v, t] of [['owner', 'Только я'], ['editors', 'Я и редакторы']] as const) {
      const lbl = el('label', 'share-radio');
      const r = el('input');
      r.type = 'radio';
      r.name = 'share-summon';
      r.value = v;
      r.dataset.key = `summon-${v}`;
      r.checked = (perms.summon ?? 'owner') === v;
      r.addEventListener('change', () => { if (r.checked) { setPermissionField('summon', v === 'editors' ? 'editors' : undefined); renderSettings(); } });
      lbl.append(r, el('span', '', t));
      group.appendChild(lbl);
    }
    people.appendChild(group);
    const maxLocked = planLocks('canSetMaxGuests');
    const maxRow = el('label', 'share-invite-role share-max-guests');
    maxRow.appendChild(el('span', '', 'Максимум гостей: '));
    const curMax = perms.maxGuests ?? 0;
    const opts = [...new Set([...MAX_GUESTS_OPTIONS, curMax && curMax <= 50 ? curMax : 0])].sort((a, b) => a - b);
    const maxSel = selectEl('share-invite-select', opts.map(n => [String(n), n === 0 ? 'без ограничений' : String(n)] as const), maxLocked ? '1' : String(curMax || 0), 'Максимум гостей');
    maxSel.dataset.field = 'maxGuests';
    maxSel.dataset.key = 'maxGuests';
    maxSel.disabled = maxLocked;
    maxSel.addEventListener('change', () => { setMaxGuestsInProject(Number(maxSel.value)); renderSettings(); });
    maxRow.appendChild(maxSel);
    if (maxLocked) {
      maxRow.appendChild(el('span', 'share-pro-tag', 'Pro'));
      maxRow.title = 'На бесплатном тарифе — один гость. Свой лимит гостей доступен в подписке Pro';
    }
    people.appendChild(maxRow);
    settingsBox.appendChild(people);
    if (focusKey) settingsBox.querySelector<HTMLElement>(`[data-key="${CSS.escape(focusKey)}"]`)?.focus();
    if (cloudShareAvailable() && cloudSynced() && aliasUi.loadedFor !== state.project.id) void loadAlias();
  }

  // ----- Открытие, клавиатура, закрытие -----

  function onKey(ev: KeyboardEvent): void {
    if (ev.key === 'Escape') {
      if (confirmReset) { confirmReset = false; renderLink(); ev.stopPropagation(); return; }
      ev.preventDefault();
      ev.stopPropagation();
      close();
      return;
    }
    if (ev.key !== 'Tab') return;
    // фокус не уходит за пределы окна
    const list = [...dlg.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(e => tabbable(e, dlg));
    if (list.length === 0) return;
    const first = list[0];
    const lastEl = list[list.length - 1];
    if (ev.shiftKey && (document.activeElement === first || !dlg.contains(document.activeElement))) { ev.preventDefault(); lastEl.focus(); }
    else if (!ev.shiftKey && document.activeElement === lastEl) { ev.preventDefault(); first.focus(); }
  }
  dlg.addEventListener('keydown', onKey);

  const onPresence = () => renderPresent();
  document.addEventListener(PRESENCE_EVENT, onPresence);
  const timer = window.setInterval(() => {
    if (!dlg.isConnected) { close(); return; }
    if (cloudShareAvailable() && loadedFor !== state.project.id) void loadCloud();
    void refreshStatus();
    renderAccess();
  }, 2000);

  function close(): void {
    if (!current) return;
    current = null;
    clearInterval(timer);
    clearTimeout(emailsTimer);
    document.removeEventListener(PRESENCE_EVENT, onPresence);
    dlg.remove();
    const back = opener && opener.isConnected ? opener : document.getElementById('btn-share');
    back?.focus();
  }
  current = { close };

  title.textContent = `Поделиться: «${projectName()}»`;
  selectTab('share');
  layout();
  renderCloud();
  await refreshStatus(true);
  tabShare.focus();
  void loadCloud();
}
