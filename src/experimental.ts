// Раздел «Экспериментальные» окна всех настроек. Спрятан: появляется, если в «О проекте»
// нажать и задержать логотип, и дальше остаётся, пока его не скроют кнопкой внизу раздела.

import { buildCustomColorPicker } from './color-picker';
import { isPlanTier } from './limits';
import { devModeEnabled, limitsEnforced, setLimitsEnforced, setUserPlan, userPlan } from './plan';
import {
  DEFAULT_ICON_COLORS, iconColors, logoDataUrl, logoSrc, sameColors, saveIconColors, type IconColors,
} from './app-icon';

const KEY = 'doska.experiments';
const RECURSION_KEY = 'doska.recursionDiscovered';
let recursionSeen = false;
export function recursionDiscovered(): boolean {
  try { return recursionSeen || localStorage.getItem(RECURSION_KEY) === '1'; } catch { return recursionSeen; }
}
export function setRecursionDiscovered(value: boolean): void {
  recursionSeen = value;
  try { if (value) localStorage.setItem(RECURSION_KEY, '1'); else localStorage.removeItem(RECURSION_KEY); } catch { /* доступно до перезапуска */ }
}


export function experimentsShown(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function setExperimentsShown(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch { /* не запомнится — до перезапуска */ }
}

/** Логотип перед заголовком раздела — с сохранёнными цветами (пока выбирают — с выбранными). */
export function experimentalHeadIcon(): string {
  return `<img class="app-logo sd-exp-logo" src="${logoSrc()}" alt="" draggable="false">`;
}

export interface ExperimentalDeps {
  /** Флажок настройки доски: меняет и сразу сохраняет. */
  check(key: 'thumbViewport' | 'pageLinks' | 'recursionEnabled', text: string, hint: string): HTMLElement;
  /** Снова спрятать раздел. */
  hide(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function renderExperimental(host: HTMLElement, deps: ExperimentalDeps): void {
  const box = el('div', 'sd-experimental');
  box.appendChild(el('p', 'sd-exp-intro', 'Возможности в разработке: они могут меняться и работать не везде.'));

  // ----- цвета иконки приложения -----
  box.appendChild(el('div', 'ctx-label', 'Цвета иконки приложения'));
  let saved = iconColors();
  let draft: IconColors = { ...saved };
  /** Открытый пикер: какой цвет правят. */
  let editing: keyof IconColors | null = null;
  // крупный образец: показывает, как будет выглядеть иконка
  const preview = el('img', 'app-logo sd-exp-preview');
  preview.alt = '';
  preview.draggable = false;
  box.appendChild(preview);
  const rows = el('div', 'sd-exp-colors');
  const picker = el('div', 'sd-exp-picker');
  picker.hidden = true;
  const swatches = new Map<keyof IconColors, HTMLButtonElement>();
  const FIELDS: [keyof IconColors, string][] = [['main', 'Круг и треугольник'], ['accent', 'Точка в центре'], ['bg', 'Фон']];
  for (const [key, title] of FIELDS) {
    const row = el('div', 'sd-exp-color');
    row.dataset.color = key;
    const name = el('span', 'sd-exp-color-name', title);
    const sw = el('button', 'sd-exp-swatch');
    sw.title = 'Выбрать цвет';
    sw.addEventListener('click', () => {
      editing = editing === key ? null : key;
      picker.hidden = editing === null;
      if (editing) buildCustomColorPicker(picker, draft[editing], hex => {
        draft = { ...draft, [key]: hex };
        sync();
      });
      // пикер — под строкой своего цвета
      if (editing) row.after(picker);
      sync();
    });
    swatches.set(key, sw);
    row.append(name, sw);
    rows.appendChild(row);
  }
  rows.appendChild(picker);
  const actions = el('div', 'sd-exp-actions');
  const save = el('button', 'sd-btn sd-exp-save', 'Сохранить');
  save.addEventListener('click', () => {
    saveIconColors(draft);
    saved = iconColors();
    sync();
  });
  const reset = el('button', 'sd-btn sd-exp-reset', 'Сбросить');
  reset.title = 'Вернуть исходные цвета';
  reset.addEventListener('click', () => {
    saveIconColors(null);
    saved = iconColors();
    draft = { ...saved };
    editing = null;
    picker.hidden = true;
    sync();
  });
  actions.append(save, reset);
  const note = el('p', 'sd-exp-note',
    'Меняет значок вкладки и иконку окна приложения. Ярлык на рабочем столе и значок на Android остаются прежними.');

  const sync = () => {
    for (const [key, sw] of swatches) {
      sw.style.setProperty('--swatch', draft[key]);
      sw.textContent = draft[key];
      sw.classList.toggle('active', editing === key);
    }
    // заголовок раздела показывает, как будет выглядеть иконка
    const shown = sameColors(draft, saved) ? logoSrc(saved) : logoDataUrl(draft);
    const head = document.querySelector<HTMLImageElement>('.sd-head-icon img');
    if (head) head.src = shown;
    preview.src = shown;
    save.disabled = sameColors(draft, saved);
    reset.disabled = sameColors(draft, DEFAULT_ICON_COLORS) && sameColors(saved, DEFAULT_ICON_COLORS);
  };
  box.append(rows, actions, note);
  sync();

  // ----- страницы -----
  box.appendChild(el('div', 'ctx-label', 'Страницы'));
  box.appendChild(deps.check('thumbViewport', 'Показывать на превью видимую область',
    'Пунктирная рамка цветом вашего курсора показывает, какую часть страницы вы сейчас видите'));
  box.appendChild(deps.check('pageLinks', 'Страницы на холсте',
    'Перетащите страницу из списка страниц на холст — появится её превью. Его можно двигать, менять размер и рамку, '
    + 'а клик по нему плавно приближает и открывает эту страницу'));

  if (recursionDiscovered()) box.appendChild(deps.check('recursionEnabled', 'Включить рекурсию!',
    'Показывать вложенные копии страницы вместо пасхалки'));

  // ----- тариф -----
  box.appendChild(el('div', 'ctx-label', 'Тариф'));
  const lim = el('label', 'ctx-check');
  lim.title = 'Бесплатный тариф: 3 проекта, 3 страницы в проекте и один гость в комнате';
  const limBox = el('input', '');
  limBox.type = 'checkbox';
  limBox.checked = limitsEnforced();
  limBox.addEventListener('change', () => setLimitsEnforced(limBox.checked));
  lim.append(limBox, el('span', '', 'Действуют лимиты тарифа'));
  box.appendChild(lim);
  // выбор тарифа вручную — только для разработки: в релизе тариф приходит с сервера
  if (devModeEnabled()) {
    const planRow = el('label', 'sd-exp-plan');
    planRow.append(el('span', 'sd-exp-plan-name', 'Мой тариф: '));
    const planSel = el('select', 'sd-exp-plan-select');
    for (const [id, title] of [['free', 'Free'], ['pro', 'Pro'], ['tutor', 'Tutor']] as const) {
      const o = el('option', '', title);
      o.value = id;
      planSel.appendChild(o);
    }
    planSel.value = userPlan();
    planSel.addEventListener('change', () => { if (isPlanTier(planSel.value)) setUserPlan(planSel.value); });
    planRow.appendChild(planSel);
    box.appendChild(planRow);

    const wipe = el('button', 'sd-btn sd-exp-hide', 'Очистить кэш');
    wipe.title = 'Только для разработки: стирает локальные данные (профиль, проекты, настройки), кэш и перезагружает страницу — всё начнётся с онбординга';
    wipe.addEventListener('click', () => { void wipeLocalData(); });
    box.appendChild(wipe);
  }

  const hide = el('button', 'sd-btn sd-exp-hide', 'Скрыть раздел');
  hide.title = 'Раздел снова появится, если задержать логотип в «О проекте»';
  hide.addEventListener('click', () => deps.hide());
  box.appendChild(hide);
  host.appendChild(box);
}

/** Dev: стереть всё локальное хранилище и перезагрузить страницу — приложение начнётся с онбординга. */
async function wipeLocalData(): Promise<void> {
  try { localStorage.clear(); } catch { /* хранилище недоступно */ }
  try { sessionStorage.clear(); } catch { /* хранилище недоступно */ }
  try {
    if ('caches' in window) for (const k of await caches.keys()) await caches.delete(k);
  } catch { /* кэш недоступен */ }
  try {
    if (navigator.serviceWorker) for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  } catch { /* воркеров нет */ }
  try {
    const dbs = await indexedDB.databases?.();
    for (const d of dbs ?? []) if (d.name) indexedDB.deleteDatabase(d.name);
  } catch { /* IndexedDB недоступна */ }
  location.reload();
}
