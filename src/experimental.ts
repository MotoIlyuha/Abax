// Раздел «Экспериментальные» окна всех настроек. Спрятан: появляется, если в «О проекте»
// нажать и задержать логотип, и дальше остаётся, пока его не скроют кнопкой внизу раздела.

import { buildCustomColorPicker } from './color-picker';
import {
  DEFAULT_ICON_COLORS, iconColors, logoDataUrl, logoSrc, sameColors, saveIconColors, type IconColors,
} from './app-icon';

const KEY = 'doska.experiments';

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
  check(key: 'thumbViewport' | 'pageLinks', text: string, hint: string): HTMLElement;
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
  const rows = el('div', 'sd-exp-colors');
  const picker = el('div', 'sd-exp-picker');
  picker.hidden = true;
  const swatches = new Map<keyof IconColors, HTMLButtonElement>();
  const FIELDS: [keyof IconColors, string][] = [['main', 'Круг и треугольник'], ['accent', 'Точка в центре']];
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
    const head = document.querySelector<HTMLImageElement>('.sd-head-icon img');
    if (head) head.src = sameColors(draft, saved) ? logoSrc(saved) : logoDataUrl(draft);
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

  const hide = el('button', 'sd-btn sd-exp-hide', 'Скрыть раздел');
  hide.title = 'Раздел снова появится, если задержать логотип в «О проекте»';
  hide.addEventListener('click', () => deps.hide());
  box.appendChild(hide);
  host.appendChild(box);
}
