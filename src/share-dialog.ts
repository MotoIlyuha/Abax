import { proBadge, refreshProBadges, requestUpgrade, type ProFeature } from './pro-badge';
import { connectOwnerRoom } from './cloud-room';
import { collabActive, collabUsers, PRESENCE_EVENT, type CollabUser } from './collab';
import { getParticipantInitials } from './presence';
import { profileName } from './profile';
import { state } from './state';
import { isPageRight } from './limits';
import { claimMenu, closeMenu, menuMotion, openMenu, releaseMenu, settleMenu } from './menu-motion';
import { ALIAS_MAX, aliasProblem, isAliasShaped, roleLabel, type AccessRole, type StoredRole } from './access';
import {
  MAX_GUESTS_OPTIONS, ROLE_OPTIONS, TEXT_OFFLINE, TEXT_UNSYNCED, aliasErrorText, aliasSuggestionsOf, checkAlias, cloudShareAvailable, cloudSynced, emailInviteErrorText,
  emailInviteStatusText, fetchAlias, fetchEmailInvites, fetchLink, linkUrlOf, planLocks, releaseAlias, resetLink, revokeEmailInvite, saveAlias, saveLink,
  sendEmailInvite, setMaxGuestsInProject, setPageRightInProject, setPermissionField, storedRoleLabel,
  type EmailInvite, type LinkInfo,
} from './invite-ui';
import { ApiError } from './api-client';
import { ICONS } from './icons';
import { createSpringSelect, type SelectOption, type SpringSelect } from './spring-select';
import { createToggleSwitch, setToggleChecked } from './toggle-switch';
import { createNumberStepper } from './number-stepper';
import { createSegmented } from './segmented';
import { attachOverlayScroll, type OverlayScroll } from './overlay-scroll';
import { createSpoiler } from './spoiler';
import { clamp, reduceMotion, uiAnimOff } from './motion';
import { createRoll } from './roll-text';
import { flyInvite, shakeField } from './invite-motion';
import { morphLeave } from './morph-tooltip';
import type { PageRight } from './types';

// Окно «Поделиться» (SPEC_NIGHT6 §6; редизайн — ветка design/share-dialog).
// Две вкладки прямо в шапке (Smooth tab, src/segmented.ts): «Поделиться» и «Настройки доступа»; панели едут
// от той же пружины, что и «пилюля» вкладок, высота окна — между высотами панелей; на сенсорном экране — свайп.
// «Поделиться» — только частое: общая ссылка (выключатель, роль, «Копировать»), приглашение по почте и список
// «Есть доступ» (роль и «Отозвать приглашение» — в выпадающем списке строки); «Без облака» — спойлер внизу.
// Полосы прокрутки панелей — тонкие, поверх содержимого (src/overlay-scroll.ts).
// Пояснения — в подсказках (title), а не текстом в окне. Списка «Сейчас на доске» в окне нет: кто на доске,
// показывает отдельный виджет. Узлы формы создаются один раз: фоновое обновление списков не сбивает ввод и фокус.
// Движение — по трём режимам анимаций доски (компоненты spring-select, toggle-switch, number-stepper, segmented,
// roll-text, invite-motion, spoiler). Только createElement/textContent; SVG — константы кода.

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

/** Действие «Отозвать приглашение» в выпадающем списке роли строки. */
const REVOKE = '__revoke';
const OWNER_COLOR = { bg: '#e03131', fg: '#fff' };
const SENT_MS = 1500;
/** Пауза после ввода адреса до проверки на сервере. */
const ALIAS_CHECK_MS = 300;

/** Что умеет роль — подсказки пунктов выбора роли. */
const ROLE_TIPS: Record<AccessRole, string> = {
  editor: 'Рисует и меняет доску',
  commenter: 'Смотрит, комментирует и пишет в чат',
  reader: 'Только смотрит',
};
const PAGE_RIGHT_OPTIONS: readonly SelectOption[] = [
  { value: '', label: 'По роли', title: 'Как разрешает роль участника' },
  { value: 'view', label: 'Только просмотр', title: 'Страницу меняете только вы' },
  { value: 'hidden', label: 'Скрыта', title: 'Страницу видите только вы' },
];

const CHECK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const RESET_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 12a8.5 8.5 0 0 1 14.6-5.9L20.5 8.5"/><path d="M20.5 3.5v5h-5"/><path d="M20.5 12a8.5 8.5 0 0 1-14.6 5.9L3.5 15.5"/><path d="M3.5 20.5v-5h5"/></svg>';
const CLOSE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>';

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
/** Иконка-константа из кода. */
function icon(cls: string, svg: string): HTMLSpanElement {
  const s = el('span', cls);
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = svg; // константа из кода
  return s;
}
/** Подсказка элемента (tooltip.ts переносит title в data-tip — сравниваем с обоими). */
function tip(e: HTMLElement, text: string): void {
  if ((e.dataset.tip ?? e.getAttribute('title') ?? '') === text) return;
  e.removeAttribute('data-tip');
  if (text) e.title = text; else e.removeAttribute('title');
}
/** Список ролей для выбора; старая роль edit/view — отдельной строкой, пока выбрана. */
function roleOptions(current?: StoredRole): SelectOption[] {
  const out: SelectOption[] = ROLE_OPTIONS.map(r => ({ value: r, label: roleLabel(r), title: ROLE_TIPS[r] }));
  if (current === 'edit' || current === 'view') out.push({ value: current, label: storedRoleLabel(current) });
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
    if (p.hidden || p.hasAttribute('inert')) return false;
    const d = p.parentElement;
    if (d instanceof HTMLDetailsElement && !d.open && p.tagName !== 'SUMMARY') return false;
  }
  return true;
}
const FOCUSABLE = 'button, input, select, textarea, summary, a[href], [tabindex]';

/** Значение для атрибутного селектора `[data-key="…"]`: экранируются кавычки и обратная косая (CSS.escape в jsdom нет). */
function attrValue(s: string): string {
  return s.replace(/["\\]/g, '\\$&').replace(/\n/g, '\\a ');
}

// ----- Окно -----

let current: { close(): void } | null = null;

/** Окно открыто. */
export function shareDialogOpen(): boolean { return current !== null; }

/** Закрыть окно (фокус возвращается на кнопку «Поделиться»). */
export function closeShareDialog(): void { current?.close(); }

/** Открыть окно «Поделиться»; повторный вызов закрывает его (кнопка в шапке — переключатель). */
export async function openShareDialog(deps: ShareDialogDeps): Promise<void> {
  if (current) { current.close(); return; }
  // прошлое окно ещё втягивается в кнопку — убираем его, чтобы id не повторялся
  for (const old of document.querySelectorAll<HTMLElement>('#share-dialog')) settleMenu(old);
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const dlg = el('div');
  dlg.id = 'share-dialog';
  dlg.className = 'popup-menu';
  dlg.setAttribute('role', 'dialog');
  dlg.setAttribute('aria-modal', 'true');
  dlg.setAttribute('aria-labelledby', 'share-dialog-title');
  document.body.appendChild(dlg);

  // ----- Состояние окна -----
  let link: LinkInfo | null = null;
  let linkMessage = '';
  let linkBusy = false;
  /** Выключатель уже переведён, сервер ещё отвечает: показываем выбранное, а не прежнее. */
  let pendingEnabled: boolean | null = null;
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
  let sentTimer = 0;
  let copyTimer = 0;
  /** Ошибка последнего действия без облака (например, лимит редакторов) — видна в окне, а не системным alert. */
  let p2pMessage = '';

  // ----- Шапка: вкладки (Smooth tab) и «закрыть» -----
  const head = el('div', 'share-head');
  const title = el('h2', 'share-title share-live', `Поделиться: «${state.project.name || 'Без названия'}»`);
  title.id = 'share-dialog-title';
  const closeX = btn('share-close', '', () => close(), 'Закрыть');
  closeX.append(icon('share-close-icon', CLOSE_ICON));

  const live = el('div', 'share-live');
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  const say = (text: string) => { live.textContent = ''; live.textContent = text; };

  /** Панель вкладки: рамка (под полосу прокрутки), прокручиваемая панель и содержимое. */
  const makePanel = (id: string, tabId: string): { box: HTMLElement; panel: HTMLElement; inner: HTMLElement } => {
    const box = el('div', 'share-panel-box');
    const panel = el('div', 'share-panel');
    panel.id = id;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tabId);
    const inner = el('div', 'share-page-inner');
    panel.append(inner);
    box.append(panel);
    return { box, panel, inner };
  };
  const main = makePanel('share-panel-share', 'share-tab-share');
  const settings = makePanel('share-panel-settings', 'share-tab-settings');
  settings.panel.dataset.tipSide = 'left'; // подсказки строк — сбоку от окна (и без анимаций)
  const panels = [main, settings];
  const view = el('div', 'share-view');
  const track = el('div', 'share-track');
  track.append(main.box, settings.box);
  view.append(track);
  const scrolls: OverlayScroll[] = panels.map(p => attachOverlayScroll(p.panel, { axis: 'y', host: p.box }));

  /** Соседняя панель видна вполовину прозрачной, пока въезжает (как в образце). */
  const NEIGHBOUR_OPACITY = 0.35;
  const narrow = () => !!window.matchMedia?.('(max-width: 520px)').matches;
  let tabMoving = false;
  /** Панели и высота окна в дробном положении p (0 — «Поделиться», 1 — «Настройки доступа»). */
  const paintTabs = (p: number, how: 'spring' | 'css' | 'jump') => {
    tabMoving = how === 'spring';
    view.classList.toggle('tabs-css', how === 'css');
    view.classList.remove('tabs-follow');
    track.style.transform = `translate3d(${(-p * 50).toFixed(3)}%, 0, 0)`;
    panels.forEach((x, i) => {
      x.box.style.opacity = String(1 - Math.min(Math.abs(p - i), 1) * (1 - NEIGHBOUR_OPACITY));
    });
    if (narrow()) { view.style.removeProperty('height'); return; }
    const h0 = main.box.offsetHeight;
    const h1 = settings.box.offsetHeight;
    view.style.height = `${(h0 + (h1 - h0) * clamp(p, 0, 1)).toFixed(2)}px`;
  };
  const tabs = createSegmented({
    tabs: true, className: 'share-tabs', label: 'Разделы окна «Поделиться»', value: 'share',
    options: [
      { value: 'share', label: 'Поделиться', id: 'share-tab-share', controls: 'share-panel-share' },
      { value: 'settings', label: 'Настройки доступа', id: 'share-tab-settings', controls: 'share-panel-settings' },
    ],
    onPaint: paintTabs,
    onChange: v => selectTab(v as 'share' | 'settings'),
  });
  head.append(tabs.el, closeX);
  dlg.append(head, title, view, live);

  function selectTab(t: 'share' | 'settings'): void {
    if (t === 'settings') renderSettings();
    tabs.setValue(t);
    panels.forEach((x, i) => {
      const on = (i === 0) === (t === 'share');
      if (on) x.panel.removeAttribute('inert'); else x.panel.setAttribute('inert', '');
    });
    scrolls.forEach(sc => sc.sync());
  }

  /** Содержимое панели изменилось (появилась ссылка, добавилось приглашение): окно плавно подстраивает высоту. */
  const fit = () => {
    if (tabMoving || narrow()) return;
    const h = (tabs.value === 'share' ? main : settings).box.offsetHeight;
    const was = view.offsetHeight;
    if (Math.abs(was - h) < 1 && view.style.height) return;
    // крупный скачок (появилась ссылка, строка приглашения) — плавно; мелкие шаги (спойлер едет сам) — сразу
    const animate = !!view.style.height && Math.abs(h - was) >= 24 && !uiAnimOff() && !reduceMotion();
    view.classList.toggle('tabs-follow', animate);
    view.style.height = `${h}px`;
  };
  const fitObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
  for (const x of panels) fitObserver?.observe(x.inner);

  // свайп по панелям (палец или перо): панели и «пилюля» идут за пальцем, отпустили — пружина доводит
  const SWIPE_VELOCITY = 0.11; // px/мс
  const AXIS_LOCK = 6;
  let swipe: { id: number; x0: number; y0: number; p0: number; axis: 'x' | 'y' | null; w: number; samples: { x: number; t: number }[] } | null = null;
  let eatClick = false;
  view.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' || uiAnimOff()) return;
    swipe = { id: e.pointerId, x0: e.clientX, y0: e.clientY, p0: tabs.progress, axis: null, w: view.clientWidth || 1, samples: [{ x: e.clientX, t: e.timeStamp }] };
  });
  view.addEventListener('pointermove', e => {
    const d = swipe;
    if (!d || d.id !== e.pointerId) return;
    if (!d.axis) {
      const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < AXIS_LOCK) return;
      // вертикаль выигрывает ничью: чаще всего хотят прокрутить
      d.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (d.axis === 'y') { swipe = null; return; }
      d.p0 = tabs.progress; d.x0 = e.clientX; d.samples = [{ x: e.clientX, t: e.timeStamp }];
      try { view.setPointerCapture(e.pointerId); } catch { /* не страшно */ }
    }
    d.samples.push({ x: e.clientX, t: e.timeStamp });
    while (d.samples.length > 2 && e.timeStamp - d.samples[0].t > 100) d.samples.shift();
    const raw = d.p0 - (e.clientX - d.x0) / d.w;
    // за крайней вкладкой панель идёт на треть хода
    tabs.drag(raw < 0 ? raw * 0.35 : raw > 1 ? 1 + (raw - 1) * 0.35 : raw);
  });
  const endSwipe = (e: PointerEvent, cancelled: boolean) => {
    const d = swipe;
    if (!d || d.id !== e.pointerId) return;
    swipe = null;
    if (d.axis !== 'x') return;
    if (!cancelled) { eatClick = true; window.setTimeout(() => { eatClick = false; }, 0); }
    const first = d.samples[0];
    const vx = (e.clientX - first.x) / Math.max(e.timeStamp - first.t, 1);
    const p = tabs.progress;
    let next = Math.round(p);
    if (!cancelled && Math.abs(vx) > SWIPE_VELOCITY) next = vx < 0 ? Math.floor(p) + 1 : Math.ceil(p) - 1;
    next = clamp(next, 0, 1);
    panels.forEach((x, i) => { if (i === next) x.panel.removeAttribute('inert'); else x.panel.setAttribute('inert', ''); });
    if (next === 1) renderSettings();
    tabs.release(next, (-vx * 1000) / d.w);
  };
  // контейнер вкладок не прокручивается никогда (браузер мог бы сдвинуть его, показывая элемент в фокусе)
  view.addEventListener('scroll', () => { view.scrollLeft = 0; view.scrollTop = 0; });
  view.addEventListener('pointerup', e => endSwipe(e, false));
  view.addEventListener('pointercancel', e => endSwipe(e, true));
  view.addEventListener('click', e => { if (eatClick) { eatClick = false; e.preventDefault(); e.stopPropagation(); } }, true);

  // ----- Главная: облачная часть -----
  const cloudBox = el('div', 'share-invite');

  // общая ссылка: выключатель с ролью, адрес и «Копировать»
  const linkBox = el('section', 'share-link-box share-card');
  const linkRole = createSpringSelect({
    className: 'share-chip share-link-role', label: 'Роль по общей ссылке', options: roleOptions(), value: 'editor',
    // до создания ссылки роль — лишь выбор формы: ссылку создаёт выключатель (с этой ролью)
    onChange: v => { if (link) void changeLink({ defaultRole: v as StoredRole }); },
  });
  const linkRow = createToggleSwitch({ className: 'share-link-row share-toggle', label: 'Общая ссылка', icon: ICONS.link, checked: false, onChange: on => { void changeLink({ enabled: on }); } });
  const linkSwitch = linkRow.querySelector<HTMLInputElement>('.switch-input')!;
  linkSwitch.classList.add('share-switch');
  linkSwitch.setAttribute('aria-label', 'Общая ссылка');
  linkSwitch.setAttribute('aria-checked', 'false');
  linkRow.insertBefore(linkRole.el, linkSwitch);
  const urlRow = el('div', 'share-url-row');
  urlRow.hidden = true;
  const urlInput = el('input', 'share-url');
  urlInput.readOnly = true;
  urlInput.setAttribute('aria-label', 'Общая ссылка');
  urlInput.addEventListener('focus', () => urlInput.select());
  const copyRoll = createRoll('share-copy-label', 18);
  copyRoll.set('Копировать', { instant: true });
  const copyBtn = btn('share-copy share-btn-soft', '', () => { void copyLink(); }, 'Скопировать общую ссылку');
  copyBtn.append(copyRoll.el);
  // «Сбросить ссылку…» — рядом с самой ссылкой; подтверждение встаёт на место строки адреса, одной линией
  const resetBtn = btn('share-reset share-icon-btn', '', () => {
    confirmReset = true;
    renderReset();
    resetConfirm.querySelector<HTMLElement>('[data-key="reset-no"]')?.focus();
  }, 'Сбросить ссылку');
  resetBtn.append(icon('share-reset-icon', RESET_ICON));
  resetBtn.title = 'Сбросить ссылку: выдать новую, прежняя перестанет работать';
  resetBtn.dataset.key = 'reset';
  urlRow.append(urlInput, resetBtn, copyBtn);
  const resetConfirm = el('div', 'share-confirm share-reset-confirm');
  resetConfirm.setAttribute('role', 'alert');
  resetConfirm.hidden = true;
  const resetYes = btn('share-btn-soft danger', 'Сбросить', () => { void doReset(); });
  resetYes.dataset.key = 'reset-yes';
  const resetNo = btn('share-btn-soft', 'Отмена', () => { confirmReset = false; renderReset(); resetBtn.focus(); });
  resetNo.dataset.key = 'reset-no';
  resetConfirm.append(el('span', 'share-confirm-text', 'Старая ссылка перестанет работать'), resetYes, resetNo);
  const linkMsg = el('div', 'share-cloud-error');
  linkMsg.setAttribute('role', 'alert');
  linkBox.append(linkRow, urlRow, resetConfirm);

  // приглашение по почте: поле с ролью и «Пригласить»; форма создаётся один раз
  const emailBox = el('section', 'share-email');
  const emailForm = el('div', 'share-email-form');
  const emailField = el('div', 'share-email-field');
  const emailInput = el('input', 'share-email-input');
  emailInput.type = 'email';
  emailInput.placeholder = 'Пригласить по почте';
  emailInput.setAttribute('aria-label', 'Почта приглашённого');
  emailInput.autocomplete = 'off';
  emailInput.spellcheck = false;
  const emailRoleSel = createSpringSelect({
    className: 'share-chip share-email-role', label: 'Роль приглашённого', options: roleOptions(), value: emailRole,
    title: 'В письме — личная ссылка. Её можно переслать, поэтому не выдавайте роль выше нужной',
    onChange: v => { emailRole = v as StoredRole; },
  });
  emailField.append(emailInput, emailRoleSel.el);
  const sendRoll = createRoll('share-send-label', 18);
  sendRoll.set('Пригласить', { instant: true });
  const emailSend = btn('share-email-send share-btn-primary', '', () => { void sendEmail(); });
  emailSend.append(sendRoll.el);
  emailInput.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); void sendEmail(); } });
  emailInput.addEventListener('input', () => { emailField.classList.remove('is-bad'); if (emailMessage) { emailMessage = ''; renderEmails(); } });
  emailForm.append(emailField, emailSend);
  const emailMsg = el('div', 'share-cloud-error');
  emailMsg.setAttribute('role', 'alert');
  emailBox.append(emailForm);

  // у кого есть доступ: владелец и приглашения по почте
  const accessBox = el('section', 'share-access');
  accessBox.appendChild(el('h3', 'share-cloud-title', 'Есть доступ'));
  const accessList = el('ul', 'share-people');
  const revokedBox = el('div', 'share-revoked');
  accessBox.append(accessList, revokedBox);
  const ownerRow = el('li', 'share-person share-owner');
  ownerRow.dataset.key = 'owner';
  const emailSelects = new Map<string, { sel: SpringSelect; key: string }>();

  cloudBox.append(linkBox, emailBox, accessBox);

  // ----- Подключение без облака: на «Поделиться» первым (облака нет) или спойлером внизу -----
  const p2pBox = el('div', 'share-p2p');
  /** Выпадающие списки P2P пересоздаются вместе с блоком: перед этим открытые закрываются. */
  let p2pSelects: SpringSelect[] = [];
  const p2pHolder = el('div', 'share-p2p-holder');
  const otherWays = createSpoiler({
    className: 'share-other', summary: 'Без облака', content: p2pHolder,
    title: 'Совместная работа без сервера Abax: по локальной сети или через ретранслятор',
    onToggle: open => { if (open) renderP2P(); },
  });

  // ----- Поведение -----

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
    if (linkBusy) { renderLink(); return; }
    linkBusy = true;
    pendingEnabled = body.enabled ?? null;
    linkMessage = '';
    renderLink();
    try {
      const role = body.defaultRole ?? (link?.role as StoredRole | undefined) ?? (linkRole.value as StoredRole);
      link = await saveLink(state.project.id, { defaultRole: role, ...(body.enabled !== undefined ? { enabled: body.enabled } : {}) });
      if (link.enabled) void connectOwnerRoom();
      say(body.enabled === false ? 'Общая ссылка выключена' : body.enabled === true ? 'Общая ссылка включена' : `Роль по ссылке: ${storedRoleLabel(link.role)}`);
    } catch (e) {
      linkMessage = e instanceof ApiError && e.status === 404 ? TEXT_UNSYNCED : e instanceof ApiError && e.isNetwork ? TEXT_OFFLINE : 'Не удалось изменить ссылку';
    } finally { linkBusy = false; pendingEnabled = null; renderCloud(); }
  }

  async function copyLink(): Promise<void> {
    if (!link?.enabled) return;
    try {
      await navigator.clipboard.writeText(linkUrlOf(link));
      say('Ссылка скопирована');
      copyBtn.classList.add('is-done');
      copyRoll.set('Скопировано', { icon: CHECK_ICON });
      clearTimeout(copyTimer);
      copyTimer = window.setTimeout(() => { copyBtn.classList.remove('is-done'); copyRoll.set('Копировать'); }, SENT_MS);
    } catch { say('Не удалось скопировать ссылку'); }
  }

  async function doReset(): Promise<void> {
    if (!link || linkBusy) return;
    linkBusy = true;
    confirmReset = false;
    try {
      link = await resetLink(link.token);
      say('Ссылка сброшена: прежняя больше не работает');
    } catch { linkMessage = 'Не удалось сбросить ссылку'; } finally { linkBusy = false; renderCloud(); renderSettings(); }
  }

  async function sendEmail(): Promise<void> {
    const email = emailInput.value.trim();
    if (emailBusy) return;
    if (!email) { shakeField(emailField); say('Введите адрес почты'); emailInput.focus(); return; }
    emailBusy = true;
    emailMessage = '';
    renderEmails();
    try {
      const r = await sendEmailInvite(state.project.id, email, emailRole);
      const isNew = !emails.some(x => x.id === r.invite.id);
      emails = [r.invite, ...emails.filter(x => x.id !== r.invite.id)];
      emailInput.value = '';
      const text = r.mailed ? `Приглашение отправлено: ${r.invite.email}` : `Приглашение обновлено: ${r.invite.email}`;
      say(text);
      // кнопка вкатывает «Готово» на зелёном, адрес улетает в новую строку списка
      emailSend.classList.add('is-sent');
      sendRoll.set('Готово', { icon: CHECK_ICON });
      clearTimeout(sentTimer);
      sentTimer = window.setTimeout(() => { emailSend.classList.remove('is-sent'); sendRoll.set('Пригласить'); }, SENT_MS);
      emailBusy = false;
      renderEmails();
      const row = accessList.querySelector<HTMLElement>(`[data-invite-id="${attrValue(r.invite.id)}"]`);
      if (row && isNew) arrive(row, email);
    } catch (e) {
      emailMessage = emailInviteErrorText(e);
      shakeField(emailField);
    } finally { emailBusy = false; renderEmails(); }
  }

  /** Новая строка приглашения: «Улучшенные» — адрес прилетает из поля; «Обычные» — строка проявляется. */
  function arrive(row: HTMLElement, text: string): void {
    const mode = menuMotion();
    if (mode === 'off') return;
    if (mode === 'normal') {
      row.classList.add('inv-appear');
      row.addEventListener('animationend', () => row.classList.remove('inv-appear'), { once: true });
      return;
    }
    const av = row.querySelector<HTMLElement>('.share-avatar');
    if (!av) return;
    row.scrollIntoView?.({ block: 'nearest' });
    row.classList.add('inv-pending');
    flyInvite(emailField, text, av, dlg, () => row.classList.remove('inv-pending'));
  }

  async function changeEmailRole(inv: EmailInvite, role: StoredRole): Promise<void> {
    if (emailBusy) return;
    emailBusy = true;
    renderEmails();
    try {
      const r = await sendEmailInvite(state.project.id, inv.email, role);
      emails = emails.map(x => (x.id === r.invite.id ? r.invite : x));
      say(`Роль ${inv.email}: ${storedRoleLabel(r.invite.role)}`);
    } catch (e) { emailMessage = emailInviteErrorText(e); } finally { emailBusy = false; renderEmails(); }
  }

  async function revokeEmail(inv: EmailInvite): Promise<void> {
    if (emailBusy) return;
    emailBusy = true;
    renderEmails();
    try {
      await revokeEmailInvite(inv);
      emails = emails.filter(x => x.id !== inv.id);
      // отзывается только этот способ входа: при включённой общей ссылке человек всё ещё может войти по ней
      revokedHint = !!link?.enabled;
      say(`Приглашение ${inv.email} отозвано`);
    } catch (e) {
      emailMessage = e instanceof ApiError && e.isNetwork ? TEXT_OFFLINE : 'Не удалось отозвать приглашение';
    } finally { emailBusy = false; renderEmails(); }
  }

  // ----- Отрисовка частей главной -----

  function renderEmails(): void {
    emailInput.disabled = emailBusy;
    emailRoleSel.setDisabled(emailBusy);
    emailSend.disabled = emailBusy;
    if (emailBusy) sendRoll.set('Отправка…');
    else if (!emailSend.classList.contains('is-sent')) sendRoll.set('Пригласить');
    // блок ошибки — только когда есть что сказать (пустой мешал бы искать ошибки окна)
    emailMsg.textContent = emailMessage;
    if (emailMessage && !emailMsg.isConnected) emailBox.appendChild(emailMsg);
    else if (!emailMessage) emailMsg.remove();
    emailBox.hidden = !cloudSynced();
    renderAccess();
  }

  function personRow(row: HTMLElement, color: { bg: string; fg: string }, initials: string, name: string, meta: string): HTMLElement {
    if (!row.querySelector('.share-avatar')) {
      const av = el('span', 'share-avatar');
      av.setAttribute('aria-hidden', 'true');
      const text = el('span', 'share-person-text');
      text.append(el('span', 'share-person-name'), el('span', 'share-person-meta'));
      row.prepend(av, text);
    }
    const av = row.querySelector<HTMLElement>('.share-avatar')!;
    av.textContent = initials;
    av.style.background = color.bg;
    av.style.color = color.fg;
    row.querySelector('.share-person-name')!.textContent = name;
    const m = row.querySelector<HTMLElement>('.share-person-meta')!;
    m.textContent = meta;
    m.hidden = !meta;
    return row;
  }

  function renderAccess(): void {
    const me = profileName() || 'Вы';
    personRow(ownerRow, OWNER_COLOR, getParticipantInitials(me), me, '');
    if (!ownerRow.querySelector('.share-person-role')) ownerRow.append(el('span', 'share-person-role', 'Владелец'));

    type Row = { key: string; inv?: EmailInvite };
    const rows: Row[] = [{ key: 'owner' }, ...emails.map(inv => ({ key: `e${inv.id}`, inv }))];
    const alive = new Set<string>();
    reconcile(accessList, rows, r => r.key, (r, prev) => {
      if (r.key === 'owner') return ownerRow;
      const inv = r.inv!;
      alive.add(inv.id);
      const row = prev ?? el('li', 'share-person share-email-item');
      row.dataset.inviteId = inv.id;
      let entry = emailSelects.get(inv.id);
      if (!entry) {
        const sel = createSpringSelect({
          className: 'share-chip share-email-row-role', label: `Роль ${inv.email}`, options: [], value: inv.role,
          onChange: v => {
            const now = emails.find(x => x.id === inv.id) ?? inv;
            if (v === REVOKE) void revokeEmail(now);
            else void changeEmailRole(now, v as StoredRole);
          },
        });
        entry = { sel, key: '' };
        emailSelects.set(inv.id, entry);
        row.append(sel.el);
      }
      personRow(row, { bg: 'var(--accent-soft)', fg: 'var(--accent)' }, (inv.email.trim()[0] ?? '?').toUpperCase(), inv.email, emailInviteStatusText(inv));
      row.querySelector('.share-person-name')!.classList.add('share-email-addr');
      row.querySelector('.share-person-meta')!.classList.add('share-email-meta');
      const opts: SelectOption[] = [...roleOptions(inv.role), { value: REVOKE, label: 'Отозвать приглашение', danger: true, action: true, title: 'Отзывается только эта ссылка из письма' }];
      const key = JSON.stringify([inv.role, inv.email]);
      if (entry.key !== key) { entry.sel.setOptions(opts, inv.role); entry.key = key; }
      entry.sel.setDisabled(emailBusy);
      return row;
    });
    for (const [id, entry] of emailSelects) if (!alive.has(id)) { entry.sel.close(true); emailSelects.delete(id); }

    revokedBox.textContent = '';
    if (revokedHint && link?.enabled) {
      revokedBox.appendChild(el('span', '', 'Приглашение отозвано. Если у человека есть общая ссылка, он сможет войти по ней. '));
      revokedBox.appendChild(btn('share-inline-btn', 'Выключить общую ссылку', () => { revokedHint = false; void changeLink({ enabled: false }); }));
    }
  }

  function renderLink(): void {
    const on = !!link?.enabled;
    const shown = linkBusy && pendingEnabled !== null ? pendingEnabled : on;
    setToggleChecked(linkSwitch, shown);
    linkSwitch.setAttribute('aria-checked', String(shown));
    linkSwitch.disabled = linkBusy;
    linkRow.classList.toggle('busy', linkBusy);
    const opts = roleOptions(link?.role);
    if (linkRole.el.dataset.opts !== JSON.stringify(opts.map(x => x.value))) {
      linkRole.setOptions(opts, link?.role ?? linkRole.value);
      linkRole.el.dataset.opts = JSON.stringify(opts.map(x => x.value));
    } else if (link) linkRole.setValue(link.role);
    linkRole.setDisabled(linkBusy);
    tip(linkRow, !link ? 'Включите — по ссылке войдёт любой, у кого она есть'
      : on ? 'По ссылке войдёт любой, у кого она есть'
        : 'Ссылка выключена: по ней никто не войдёт. Включите снова — заработает тот же адрес');
    renderReset();
    if (link) {
      const url = linkUrlOf(link);
      if (urlInput.value !== url) urlInput.value = url;
    }
    copyBtn.disabled = !on;
    linkMsg.textContent = linkMessage;
    if (linkMessage && !linkMsg.isConnected) linkBox.appendChild(linkMsg);
    else if (!linkMessage) linkMsg.remove();
  }

  function renderCloud(): void {
    renderLink();
    renderEmails();
    // вкладка «Настройки доступа» всегда в окне (её видно при свайпе): ссылка там тоже должна быть свежей
    renderSettings();
    watchPresence();
  }

  /** Кто-то вошёл или вышел — у приглашений по почте мог появиться «заходил(а)»: список перезапрашивается. */
  function watchPresence(): void {
    const users: (CollabUser | ShareUser)[] = collabActive() ? [...collabUsers()] : status.active ? status.users ?? [] : [];
    const who = users.filter(u => !u.host).map(g => g.userId).sort((x, y) => x - y).join(',');
    if (who === presentKey) return;
    presentKey = who;
    if (cloudShareAvailable() && cloudSynced() && loadedFor === state.project.id) {
      clearTimeout(emailsTimer);
      emailsTimer = window.setTimeout(() => {
        const id = state.project.id;
        void fetchEmailInvites(id).then(list => { if (state.project.id === id && current) { emails = list; renderEmails(); } }, () => {});
      }, 600);
    }
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

  function copyButton(cls: string, url: string, hint: string): HTMLButtonElement {
    // ссылка — кнопка: клавиатура и скринридер; клик копирует, текст на миг меняется
    const b = btn(cls, url, () => {
      void navigator.clipboard.writeText(url);
      b.textContent = 'Ссылка скопирована';
      say('Ссылка скопирована');
      setTimeout(() => { b.textContent = url; }, 1200);
    }, `Скопировать ссылку ${url}`);
    b.title = hint;
    return b;
  }

  function renderRelay(box: HTMLElement): void {
    if (!deps.api.shareCloudStart) return;
    const wrap = el('div', 'share-cloud');
    const cloud = status.cloud;
    const running = !!cloud && (cloud.state === 'online' || cloud.state === 'reconnecting' || cloud.state === 'connecting');
    if (running) {
      wrap.appendChild(el('h3', 'share-cloud-title', 'Через интернет'));
      if (cloud!.url) {
        const b = copyButton('share-link share-link-cloud', cloud!.url, 'Ссылка откроется на любом устройстве с интернетом. Клик — скопировать');
        b.dataset.key = 'relay-link';
        wrap.appendChild(b);
      }
      if (cloud!.state === 'reconnecting') wrap.appendChild(el('div', 'share-cloud-status warn', 'Связь с сервером прервалась — переподключаемся. Гости подождут.'));
      const stop = btn('share-btn-soft danger', 'Закрыть доступ через интернет', async () => {
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
    const start = btn('share-btn-soft', cloudUi.starting ? 'Подключение…' : error ? 'Подключиться снова' : 'Пригласить через интернет', () => {
      const relay = input ? input.value.trim() : savedRelayUrl();
      void startCloudShare(relay);
    });
    start.title = 'Гости из любой сети подключатся через сервер-ретранслятор';
    start.dataset.key = 'relay-start';
    start.disabled = cloudUi.starting;
    input?.addEventListener('keydown', ev => { if (ev.key === 'Enter') start.click(); });
    wrap.appendChild(start);
    box.appendChild(wrap);
  }

  function renderParticipants(box: HTMLElement): void {
    const users = (status.users || []).filter(u => !u.host);
    if (users.length === 0) return;
    const sec = el('section', 'share-p2p-people');
    sec.appendChild(el('h3', 'share-cloud-title', 'Участники'));
    if (p2pMessage) {
      const err = el('div', 'share-cloud-error share-p2p-error', p2pMessage);
      err.setAttribute('role', 'alert');
      sec.appendChild(err);
    }
    const table = el('div', 'share-table');
    for (const u of users) {
      const row = el('div', 'share-user');
      const head2 = el('div', 'share-user-head');
      const dot = el('i');
      dot.style.background = u.away ? '#9aa0ab' : u.color;
      const name = el('span', 'share-user-name', u.name + (u.away ? ' · Отошёл' : ''));
      // роль участника (Ночь №6)
      const role = u.access && u.access.role !== 'owner' ? u.access.role : 'commenter';
      const roleSel = createSpringSelect({
        className: 'share-chip share-user-role', label: `Роль участника ${u.name}`, value: role,
        options: ROLE_OPTIONS.map(r => ({ value: r, label: roleLabel(r), title: ROLE_TIPS[r] })),
        onChange: async v => {
          const r = await deps.api.shareSetRights(u.userId, { role: v });
          p2pMessage = r.ok ? '' : r.error || 'Не удалось изменить роль';
          if (!r.ok) say(p2pMessage);
          await refreshStatus(true);
        },
      });
      roleSel.el.dataset.key = `u${u.userId}-role`;
      p2pSelects.push(roleSel);
      head2.append(dot, name, roleSel.el);
      row.appendChild(head2);
      // личные права по страницам: «как у роли» снимает личное право
      for (const pg of state.project.pages) {
        const cur = u.rights?.pages?.[pg.id] || u.rights?.default || 'view';
        const line = el('div', 'share-user-page');
        line.append(el('span', 'share-user-page-name', pg.name || 'Без названия'));
        const sel = createSpringSelect({
          className: 'share-chip share-user-right', label: `${u.name}, страница «${pg.name}»`, value: cur,
          options: [
            { value: 'view', label: 'Просмотр' }, { value: 'edit', label: 'Редактирование' }, { value: 'hidden', label: 'Скрыть' },
            { value: '', label: 'Как у роли' },
          ],
          onChange: async v => {
            const r = await deps.api.shareSetRights(u.userId, { pages: { [pg.id]: v === '' ? null : v } });
            p2pMessage = r.ok ? '' : r.error || 'Не удалось изменить права';
            if (!r.ok) say(p2pMessage);
            await refreshStatus(true);
          },
        });
        sel.el.dataset.key = `u${u.userId}-${pg.id}`;
        p2pSelects.push(sel);
        line.append(sel.el);
        row.appendChild(line);
      }
      table.appendChild(row);
    }
    sec.appendChild(table);
    box.appendChild(sec);
  }

  function renderP2P(): void {
    const focusKey = p2pBox.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.key : undefined;
    for (const s of p2pSelects) s.close(true);
    p2pSelects = [];
    p2pBox.textContent = '';
    if (!status.active) {
      if (p2pMessage) p2pBox.appendChild(el('div', 'share-cloud-error', p2pMessage));
      const start = btn('share-btn-primary share-p2p-start', 'Включить совместную работу', async () => {
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
      start.title = 'Гости подключаются прямо к этому устройству — без сервера Abax';
      start.dataset.key = 'p2p-start';
      p2pBox.appendChild(start);
    } else {
      // ссылка в локальной сети и тестовое окно есть только у приложения; во вкладке гостей зовут через интернет
      if (status.url) {
        const urls = status.urls ?? [];
        const chosen = urls[lanChoice]?.url ?? status.url;
        const lan = el('section', 'share-lan');
        const sub = el('div', 'share-lan-head');
        sub.append(el('h3', 'share-cloud-title', status.localOnly ? 'Только на этом компьютере' : 'В этой сети'));
        if (!status.localOnly && urls.length > 1) {
          const other = createSpringSelect({
            className: 'share-chip share-lan-choice', label: 'Другой адрес этого компьютера', value: String(lanChoice),
            options: urls.map((u, i) => ({ value: String(i), label: `${u.iface} ${u.address}`, title: u.kind === 'virtual' ? 'Виртуальный адаптер' : undefined })),
            onChange: v => { lanChoice = Number(v) || 0; renderP2P(); },
          });
          other.el.dataset.key = 'lan-choice';
          p2pSelects.push(other);
          sub.append(other.el);
        }
        lan.append(sub);
        const where = urls[lanChoice] ? `${urls[lanChoice].iface} ${urls[lanChoice].address}. ` : '';
        const b = copyButton('share-link', chosen, `${where}Откройте ссылку на другом устройстве или в тестовом окне. Клик — скопировать`);
        b.dataset.key = 'lan-link';
        lan.appendChild(b);
        if (status.localOnly) {
          lan.appendChild(el('div', 'share-cloud-status warn', 'Нет подключения к сети: адрес 127.0.0.1 работает только на этом компьютере. Подключитесь к Wi-Fi или позовите гостей через интернет.'));
        }
        p2pBox.appendChild(lan);
      }
      renderRelay(p2pBox);
      renderParticipants(p2pBox);
      const actions = el('div', 'share-p2p-actions');
      if (status.url) {
        const testBtn = btn('share-btn-soft', 'Тестовое окно гостя', () => { void deps.api.shareOpenTestWindow(); });
        testBtn.title = 'Открыть окно гостя на этом компьютере — посмотреть доску его глазами';
        testBtn.dataset.key = 'test';
        actions.appendChild(testBtn);
      }
      const stopBtn = btn('share-btn-soft danger', 'Выключить совместную работу', async () => {
        await deps.api.shareStop();
        deps.stopCollab();
        Object.assign(cloudUi, { starting: false, error: null, askRelay: false });
        await refreshStatus(true);
      });
      stopBtn.dataset.key = 'p2p-stop';
      actions.appendChild(stopBtn);
      p2pBox.appendChild(actions);
    }
    if (focusKey) p2pBox.querySelector<HTMLElement>(`[data-key="${attrValue(focusKey)}"]`)?.focus();
  }

  /** Размещение блоков: без облака путь без сервера — на вкладке «Поделиться» первым и развёрнут; с облаком — в спойлере внизу. */
  function layout(): void {
    const cloud = cloudShareAvailable();
    cloudBox.hidden = !cloud;
    if (cloud) {
      if (p2pBox.parentElement !== p2pHolder) p2pHolder.append(p2pBox);
      if (cloudBox.parentElement !== main.inner) main.inner.prepend(cloudBox);
      if (otherWays.parentElement !== main.inner) main.inner.append(otherWays);
      // идёт совместная работа без облака — спойлер раскрыт
      if (status.active && !otherWays.open) otherWays.open = true;
    } else {
      if (p2pBox.parentElement !== main.inner) main.inner.prepend(p2pBox);
      if (cloudBox.parentElement !== main.inner) main.inner.append(cloudBox);
      otherWays.remove();
    }
  }

  async function refreshStatus(force = false): Promise<void> {
    try { status = await deps.api.shareStatus(); } catch { status = { active: false }; }
    const key = JSON.stringify([status, cloudUi.starting, cloudUi.error, cloudUi.askRelay, lanChoice, p2pMessage, state.project.pages.map(p => [p.id, p.name])]);
    // пока в блоке открыт выпадающий список, блок не пересоздаётся (меню не пропадёт из-под руки):
    // statusKey не обновлён — перерисует следующее обновление
    if ((force || key !== statusKey) && !p2pSelects.some(s => s.open)) { statusKey = key; renderP2P(); }
    layout();
    watchPresence();
  }

  // ----- Страница «Настройки доступа»: узлы создаются один раз, renderSettings() только сверяет значения -----

  /** Состояние редактора именного адреса между перерисовками. */
  const aliasUi = {
    loadedFor: '', alias: null as string | null, former: [] as string[], draft: '', message: '', busy: false, confirmRelease: '',
    /** Свободные похожие адреса, если введённый занят. */
    suggestions: [] as string[],
  };
  /** Проверка адреса на лету: пауза после ввода и номер запроса (ответ на устаревший ввод не показывается). */
  let aliasCheckTimer = 0;
  let aliasCheckSeq = 0;
  /** Пока владелец печатает: свободен ли адрес, а если занят или короток — свободные похожие (без «Сохранить»). */
  function scheduleAliasCheck(): void {
    clearTimeout(aliasCheckTimer);
    const seq = ++aliasCheckSeq;
    const v = aliasUi.draft.trim();
    if (!isAliasShaped(v) || ownAlias(v) || planLocks('canSetAlias')) return;
    const id = state.project.id;
    aliasCheckTimer = window.setTimeout(() => {
      void checkAlias(id, v).then(r => {
        if (seq !== aliasCheckSeq || state.project.id !== id || aliasUi.draft.trim() !== v) return;
        aliasUi.suggestions = r.suggestions;
        if (r.status === 'taken') aliasUi.message = 'Этот адрес уже занят';
        else if (r.status === 'blocked') aliasUi.message = 'Этот адрес заблокирован';
        renderAliasMessage();
      }, () => { /* без сети — проверит «Сохранить» */ });
    }, ALIAS_CHECK_MS);
  }
  /** Свой адрес (текущий или бывший) можно вернуть, даже если он короче нынешнего минимума. */
  const ownAlias = (v: string) => v === aliasUi.alias || aliasUi.former.includes(v);

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
    // ответ проверки на лету, пришедший после нажатия, уже не нужен
    aliasCheckSeq++;
    clearTimeout(aliasCheckTimer);
    const draft = aliasUi.draft.trim();
    const problem = ownAlias(draft) ? null : aliasProblem(draft);
    if (problem) {
      // та же подсказка уже видна под полем (проверка на лету) — второй строкой её не повторяем; пустое поле — подсказываем
      aliasUi.message = aliasProblemEl.textContent ? '' : problem;
      aliasProblemEl.classList.add('is-error');
      shakeField(aliasField);
      renderSettings();
      return;
    }
    aliasUi.busy = true;
    aliasUi.message = '';
    aliasUi.suggestions = [];
    renderSettings();
    try {
      const r = await saveAlias(state.project.id, draft);
      aliasUi.alias = r.alias;
      aliasUi.former = r.former;
      if (link) link = { ...link, alias: r.alias, prettyUrl: r.prettyUrl ?? link.prettyUrl };
      say(`Именной адрес: ${r.alias}`);
    } catch (e) {
      aliasUi.message = aliasErrorText(e);
      aliasUi.suggestions = aliasSuggestionsOf(e);
      shakeField(aliasField);
    } finally { aliasUi.busy = false; renderSettings(); renderLink(); }
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

  const section = (cls: string, heading: string): HTMLElement => {
    const s = el('section', `share-section ${cls}`);
    s.appendChild(el('h3', 'share-cloud-title', heading));
    return s;
  };
  // единый бейдж Pro (src/pro-badge.ts): видимость ведёт сам; строка, закрытая тарифом, по нажатию открывает подписку
  const proTag = (f: ProFeature) => proBadge(f, { className: 'share-pro-tag' });
  const lockedClick = (row: HTMLElement, f: ProFeature, locked: () => boolean) => {
    row.addEventListener('click', ev => {
      if (!locked()) return;
      ev.preventDefault();
      requestUpgrade(f);
    });
  };

  // страницы: «По роли» / «Только просмотр» / «Скрыта»; старое «редактирование для всех» — пока стоит
  const pagesSec = section('share-page-rights', 'Страницы');
  // длинный список страниц прокручивается внутри своей карточки — со своей тонкой полосой прокрутки
  const pagesCard = el('div', 'share-card share-pages-card');
  const pagesList = el('div', 'share-rows share-pages-list');
  pagesCard.append(pagesList);
  pagesSec.append(pagesCard);
  const pagesScroll = attachOverlayScroll(pagesList, { axis: 'y', host: pagesCard, edges: 'shadow' });
  const pageSelects = new Map<string, { sel: SpringSelect; opts: string }>();

  // права участников: переключатели с короткой подписью, пояснение — в подсказке
  const permSec = section('share-perms', 'Права участников');
  const permCard = el('div', 'share-card share-rows');
  permSec.append(permCard);
  const toggleRow = (field: string, label: string, hint: string, onChange: (on: boolean) => void): { row: HTMLLabelElement; input: HTMLInputElement } => {
    const row = createToggleSwitch({ className: 'share-toggle share-setting', label, checked: false, onChange: on => { onChange(on); renderSettings(); }, title: hint });
    const input = row.querySelector<HTMLInputElement>('.switch-input')!;
    input.dataset.field = field;
    input.dataset.key = field;
    return { row, input };
  };
  const protectT = toggleRow('protectElements', 'Защита чужих элементов', 'Участники не могут сдвигать, менять и стирать чужие элементы — только свои',
    on => setPermissionField('protectElements', on ? true : undefined));
  const copyT = toggleRow('allowCopy', 'Копирование и экспорт', 'Читатели и комментаторы могут копировать и экспортировать. Видимое на экране всё равно можно сфотографировать',
    on => {
      setPermissionField('allowCopy', on ? undefined : false);
      // старые ссылки с запретом копирования не должны молча его потерять — ссылка получает тот же флаг
      if (link) void saveLink(state.project.id, { defaultRole: link.role, allowCopy: on }).then(r => { link = r; }, () => {});
    });
  const cloneT = toggleRow('allowClone', 'Копия доски себе', 'Участники могут сделать себе копию доски',
    on => setPermissionField('forbidClone', on ? undefined : true));
  const linkViewT = toggleRow('linkView', 'Просмотр по ссылке на доску', 'Ссылка на доску или страницу открывает её только для чтения — без приглашения',
    on => setPermissionField('linkView', on ? undefined : false));
  for (const [t, f] of [[copyT, 'copy'], [cloneT, 'clone']] as const) {
    t.row.insertBefore(proTag(f), t.input);
    lockedClick(t.row, f, () => t.row.classList.contains('locked'));
  }
  permCard.append(protectT.row, copyT.row, cloneT.row, linkViewT.row);

  // гости: кто зовёт всех к себе (сегменты), максимум гостей (счётчик)
  const guestsSec = section('share-guests', 'Гости');
  const guestsCard = el('div', 'share-card share-rows');
  guestsSec.append(guestsCard);
  const summonRow = el('div', 'share-setting share-summon');
  const summonLabel = el('span', 'share-setting-label', 'Позвать всех к себе');
  tip(summonRow, 'Кто может перенести всех участников к себе на экран');
  const summon = createSegmented({
    className: 'share-summon-seg', label: 'Кто может позвать всех к себе', value: 'owner',
    options: [{ value: 'owner', label: 'Только я' }, { value: 'editors', label: 'И редакторы', title: 'Я и редакторы' }],
    onChange: v => { setPermissionField('summon', v === 'editors' ? 'editors' : undefined); renderSettings(); },
  });
  for (const b of summon.el.querySelectorAll<HTMLElement>('[role="radio"]')) b.dataset.key = `summon-${b.dataset.value}`;
  summonRow.append(summonLabel, summon.el);
  const maxRow = el('div', 'share-setting share-max-guests');
  const maxLabel = el('span', 'share-setting-label', 'Максимум гостей');
  const maxOrder = [...MAX_GUESTS_OPTIONS.filter(n => n > 0), 0];
  const maxStepper = createNumberStepper({
    className: 'share-max-stepper', label: 'Максимум гостей', values: maxOrder, value: 0,
    format: n => (n === 0 ? '∞' : String(n)), spoken: n => (n === 0 ? 'без ограничений' : String(n)),
    onChange: n => { setMaxGuestsInProject(n); renderSettings(); },
  });
  maxStepper.el.dataset.field = 'maxGuests';
  maxStepper.el.dataset.key = 'maxGuests';
  maxRow.append(maxLabel, proTag('guests'), maxStepper.el);
  lockedClick(maxRow, 'guests', () => maxRow.classList.contains('locked'));
  guestsCard.append(summonRow, maxRow);

  // ссылка: именной адрес, бывшие адреса, сброс
  const aliasSec = section('share-alias', 'Ссылка');
  const aliasCard = el('div', 'share-card share-rows');
  const aliasLabelRow = el('div', 'share-setting share-alias-head');
  const aliasLabel = el('span', 'share-setting-label', 'Именной адрес');
  aliasLabelRow.append(aliasLabel, proTag('alias'));
  lockedClick(aliasCard, 'alias', () => aliasCard.classList.contains('locked'));
  const aliasRow = el('div', 'share-alias-row');
  const aliasField = el('div', 'share-alias-field');
  const aliasPrefix = el('span', 'share-alias-prefix', '/j/');
  const aliasInput = el('input', 'share-alias-input');
  aliasInput.type = 'text';
  aliasInput.placeholder = 'physics-9a-2026';
  aliasInput.maxLength = ALIAS_MAX;
  aliasInput.spellcheck = false;
  aliasInput.autocomplete = 'off';
  aliasInput.dataset.key = 'alias-input';
  aliasInput.setAttribute('aria-label', 'Именной адрес доски');
  aliasField.append(aliasPrefix, aliasInput);
  const aliasSave = btn('share-alias-save share-btn-soft', 'Сохранить', () => { void submitAlias(); });
  aliasSave.dataset.key = 'alias-save';
  aliasRow.append(aliasField, aliasSave);
  const aliasProblemEl = el('div', 'share-hint share-alias-problem');
  aliasProblemEl.setAttribute('aria-live', 'polite');
  const aliasErr = el('div', 'share-cloud-error');
  aliasErr.setAttribute('role', 'alert');
  const showProblem = () => {
    const v = aliasInput.value.trim();
    aliasProblemEl.textContent = v && !ownAlias(v) ? aliasProblem(v) ?? '' : '';
  };
  // свободные похожие адреса под ошибкой «занят»: нажатие подставляет адрес в поле, сохраняет — «Сохранить»
  const aliasSuggest = el('div', 'share-alias-suggest');
  const aliasSuggestList = el('div', 'share-alias-suggest-list');
  aliasSuggest.append(el('span', 'share-alias-suggest-label', 'Свободны:'), aliasSuggestList);
  function pickSuggestion(v: string): void {
    aliasUi.draft = v;
    aliasInput.value = v;
    aliasUi.message = '';
    aliasUi.suggestions = [];
    aliasCheckSeq++;
    clearTimeout(aliasCheckTimer);
    aliasField.classList.remove('is-bad');
    aliasProblemEl.classList.remove('is-error');
    showProblem();
    renderAliasMessage();
    aliasInput.focus();
  }
  aliasInput.addEventListener('input', () => {
    aliasUi.draft = aliasInput.value.toLowerCase();
    if (aliasInput.value !== aliasUi.draft) aliasInput.value = aliasUi.draft;
    aliasUi.message = '';
    aliasUi.suggestions = [];
    aliasField.classList.remove('is-bad');
    aliasProblemEl.classList.remove('is-error');
    showProblem();
    renderAliasMessage();
    scheduleAliasCheck();
  });
  aliasInput.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); void submitAlias(); } });
  const formerHead = el('div', 'share-cloud-title share-former-title', 'Бывшие адреса');
  tip(formerHead, 'Ведут на эту же доску');
  const formerList = el('ul', 'share-people share-former');
  aliasCard.append(aliasLabelRow, aliasRow, aliasProblemEl, formerHead, formerList);
  aliasSec.append(aliasCard);

  settings.inner.append(pagesSec, permSec, guestsSec, aliasSec);

  function renderAliasMessage(): void {
    // ошибка сервера с тем же текстом, что подсказка под полем, — не повторяется
    if (aliasUi.message && aliasUi.message === aliasProblemEl.textContent) { aliasUi.message = ''; aliasProblemEl.classList.add('is-error'); }
    aliasErr.textContent = aliasUi.message;
    if (aliasUi.message && !aliasErr.isConnected) aliasProblemEl.after(aliasErr);
    else if (!aliasUi.message) aliasErr.remove();
    reconcile(aliasSuggestList, aliasUi.suggestions, v => v, (v, prev) => {
      if (prev) return prev;
      const b = btn('share-alias-chip', v, () => pickSuggestion(v));
      tip(b, `Подставить /j/${v}`);
      return b;
    });
    if (aliasUi.suggestions.length && !aliasSuggest.isConnected) (aliasErr.isConnected ? aliasErr : aliasProblemEl).after(aliasSuggest);
    else if (!aliasUi.suggestions.length) aliasSuggest.remove();
  }

  function renderPages(): void {
    const perms = state.project.permissions ?? {};
    const legacyLink = link?.role === 'edit' || link?.role === 'view';
    type Item = { key: string; pg?: typeof state.project.pages[number]; warn?: boolean };
    const items: Item[] = [];
    for (const pg of state.project.pages) {
      items.push({ key: `p${pg.id}`, pg });
      if (perms.pageRights?.[pg.id] === 'edit') items.push({ key: `w${pg.id}`, pg, warn: true });
    }
    const alive = new Set<string>();
    reconcile(pagesList, items, x => x.key, (x, prev) => {
      const pg = x.pg!;
      const cur = perms.pageRights?.[pg.id];
      if (x.warn) {
        const warn = prev ?? el('div', 'share-warn');
        warn.textContent = '';
        warn.appendChild(el('span', '', legacyLink
          ? `«${pg.name}»: по старой настройке гости старой ссылки могут её редактировать. Для новых ролей действует роль. `
          : `«${pg.name}»: старая настройка «редактирование для всех» больше не повышает роль — действует роль. `));
        const ok = btn('share-inline-btn', 'Понятно', () => { setPageRightInProject(pg.id, ''); renderSettings(); }, `Понятно: страница «${pg.name}» — по роли`);
        ok.dataset.key = `page-ok-${pg.id}`;
        warn.appendChild(ok);
        return warn;
      }
      alive.add(pg.id);
      const row = prev ?? el('div', 'share-page-right share-setting');
      row.dataset.pageId = pg.id;
      let entry = pageSelects.get(pg.id);
      if (!entry) {
        const sel = createSpringSelect({
          className: 'share-chip share-page-select', label: `Доступ к странице «${pg.name}»`, options: PAGE_RIGHT_OPTIONS, value: '',
          onChange: v => { setPageRightInProject(pg.id, isPageRight(v) ? v as PageRight : ''); renderSettings(); },
        });
        sel.el.dataset.key = `page-${pg.id}`;
        entry = { sel, opts: '' };
        pageSelects.set(pg.id, entry);
        row.append(el('span', 'share-page-name share-setting-label'), sel.el);
      }
      row.querySelector('.share-page-name')!.textContent = pg.name || 'Без названия';
      const options = cur === 'edit' ? [PAGE_RIGHT_OPTIONS[0], { value: 'edit', label: 'Редактирование для всех (старая настройка)' }, ...PAGE_RIGHT_OPTIONS.slice(1)] : [...PAGE_RIGHT_OPTIONS];
      const value = isPageRight(cur) ? cur : '';
      const opts = JSON.stringify(options.map(o => o.value));
      if (entry.opts !== opts) { entry.sel.setOptions(options, value); entry.opts = opts; }
      else entry.sel.setValue(value);
      return row;
    });
    for (const [id, entry] of pageSelects) if (!alive.has(id)) { entry.sel.close(true); pageSelects.delete(id); }
  }

  function renderFormer(): void {
    reconcile(formerList, aliasUi.former, f => `f${f}`, (f, prev) => {
      const li = prev ?? el('li', 'share-person');
      li.textContent = '';
      li.appendChild(el('span', 'share-person-name', `/j/${f}`));
      if (aliasUi.confirmRelease === f) {
        const c = el('span', 'share-confirm');
        const text = el('span', 'share-confirm-text', 'Адрес больше никому не достанется');
        text.title = 'Адрес перестанет вести на доску и больше никому не достанется';
        c.appendChild(text);
        const yes = btn('share-btn-soft danger', 'Освободить', () => { void doRelease(f); });
        yes.dataset.key = `release-yes-${f}`;
        const no = btn('share-btn-soft', 'Отмена', () => { aliasUi.confirmRelease = ''; renderSettings(); });
        no.dataset.key = `release-no-${f}`;
        c.append(yes, no);
        li.appendChild(c);
      } else {
        const rel = btn('share-inline-btn', 'Освободить', () => {
          aliasUi.confirmRelease = f;
          renderSettings();
          formerList.querySelector<HTMLElement>(`[data-key="release-no-${attrValue(f)}"]`)?.focus();
        }, `Освободить адрес ${f}`);
        rel.dataset.key = `release-${f}`;
        li.appendChild(rel);
      }
      return li;
    });
    formerHead.hidden = aliasUi.former.length === 0;
    formerList.hidden = aliasUi.former.length === 0;
  }

  /** Строка адреса или подтверждение сброса на её месте. */
  function renderReset(): void {
    const on = !!link?.enabled;
    const confirming = confirmReset && !!link;
    urlRow.hidden = !on || confirming;
    resetConfirm.hidden = !confirming;
    resetBtn.disabled = linkBusy;
    resetYes.disabled = linkBusy;
  }

  function renderSettings(): void {
    const perms = state.project.permissions ?? {};
    renderPages();
    setToggleChecked(protectT.input, perms.protectElements === true);
    const copyLocked = planLocks('canProtectCopy');
    setToggleChecked(copyT.input, copyLocked ? true : perms.allowCopy !== false);
    copyT.input.disabled = copyLocked;
    copyT.row.classList.toggle('locked', copyLocked);
    const cloneLocked = planLocks('canProtectClone');
    setToggleChecked(cloneT.input, cloneLocked ? true : perms.forbidClone !== true);
    cloneT.input.disabled = cloneLocked;
    cloneT.row.classList.toggle('locked', cloneLocked);
    setToggleChecked(linkViewT.input, perms.linkView !== false);
    summon.setValue(perms.summon === 'editors' ? 'editors' : 'owner');
    const maxLocked = planLocks('canSetMaxGuests');
    const curMax = perms.maxGuests ?? 0;
    maxStepper.setValue(maxLocked ? 1 : (maxOrder.includes(curMax) ? curMax : 0));
    maxStepper.setDisabled(maxLocked);
    maxRow.classList.toggle('locked', maxLocked);
    tip(maxRow, maxLocked ? 'На бесплатном тарифе — один гость. Свой лимит гостей доступен в подписке Pro' : 'Сколько гостей может быть на доске одновременно');
    // ссылка — только для доски в облаке
    const cloud = cloudShareAvailable() && cloudSynced();
    aliasSec.hidden = !cloud;
    if (cloud) {
      const locked = planLocks('canSetAlias');
      aliasCard.classList.toggle('locked', locked);
      tip(aliasLabel, `Короткий адрес вроде /j/physics-9a-2026 ведёт на общую ссылку доски и даёт те же права. Это не секрет: его может набрать любой.${link?.enabled ? '' : ' Работает, пока включена общая ссылка.'}`);
      if (document.activeElement !== aliasInput && aliasInput.value !== aliasUi.draft) aliasInput.value = aliasUi.draft;
      aliasInput.disabled = locked || aliasUi.busy;
      aliasSave.disabled = locked || aliasUi.busy;
      aliasSave.textContent = aliasUi.alias ? 'Изменить' : 'Сохранить';
      showProblem();
      renderAliasMessage();
      renderFormer();
      if (aliasUi.loadedFor !== state.project.id) void loadAlias();
    }
    refreshProBadges();
  }

  // ----- Открытие, клавиатура, закрытие -----

  function onKey(ev: KeyboardEvent): void {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      if (confirmReset) { confirmReset = false; renderReset(); return; }
      if (aliasUi.confirmRelease) { aliasUi.confirmRelease = ''; renderSettings(); return; }
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

  const onPresence = () => watchPresence();
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
    clearTimeout(sentTimer);
    clearTimeout(copyTimer);
    clearTimeout(aliasCheckTimer);
    document.removeEventListener(PRESENCE_EVENT, onPresence);
    for (const s of [linkRole, emailRoleSel, ...p2pSelects, ...[...emailSelects.values()].map(x => x.sel), ...[...pageSelects.values()].map(x => x.sel)]) s.close(true);
    fitObserver?.disconnect();
    for (const sc of [...scrolls, pagesScroll]) sc.destroy();
    releaseMenu('share');
    morphLeave(true); // подсказка и подсветка строки не остаются висеть после закрытия окна
    closeMenu(dlg);
    const back2 = opener && opener.isConnected ? opener : document.getElementById('btn-share');
    back2?.focus();
  }
  current = { close };

  layout();
  renderCloud();
  renderSettings();
  selectTab('share');
  fit();
  // до первого await кадр не рисуется: окно сразу появляется с анимацией, а не на своём месте
  claimMenu('share', () => close());
  const shareButton = document.getElementById('btn-share');
  const visible = shareButton && shareButton.offsetParent !== null ? shareButton : null;
  openMenu(dlg, {
    from: visible ?? dlg,
    remove: true,
    items: () => [head, ...[...main.inner.children].filter((c): c is HTMLElement => c instanceof HTMLElement && !c.hidden)],
    onSettled: () => fit(),
    // под кнопкой «Поделиться», по её правому краю
    place: () => {
      // на узком экране окно во весь экран (style.css)
      if (!visible || window.matchMedia?.('(max-width: 520px)').matches) return;
      const r = visible.getBoundingClientRect();
      dlg.style.top = `${r.bottom + 6}px`;
      dlg.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
    },
  });
  await refreshStatus(true);
  // фокус — в поле приглашения, а без него — на первую кнопку страницы (на сенсорном экране клавиатуру не открываем)
  const coarse = !!window.matchMedia?.('(pointer: coarse)').matches;
  const firstField = !coarse && tabbable(emailInput, dlg) && !cloudBox.hidden ? emailInput
    : [...main.inner.querySelectorAll<HTMLElement>(FOCUSABLE)].find(e => tabbable(e, dlg) && e.tagName !== 'INPUT');
  (firstField ?? closeX).focus({ preventScroll: true });
  void loadCloud();
}
