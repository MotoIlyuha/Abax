// Горячие клавиши с модификаторами: переход на страницу по номеру, новая страница
// и сочетания самой доски. Сочетание хранится строкой «Ctrl+Shift+KeyN»: модификаторы
// в постоянном порядке и KeyboardEvent.code — работает при любой раскладке.
// Cmd на macOS считается за Ctrl, как и во всех горячих клавишах доски, и в подписях
// на macOS вместо «Ctrl» пишем «Cmd» (см. macKeys).

import type { BoardSettings, PageKeyMod } from './types';

export const DEFAULT_NEW_PAGE_KEY = 'Alt+KeyN';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

/** «Ctrl» в подписи сочетания → «Cmd» на macOS. Только для текста: сами сочетания хранятся с Ctrl. */
export function macKeys(text: string, mac = IS_MAC): string {
  return mac ? text.replace(/\bCtrl\b/g, 'Cmd') : text;
}

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'AltGraph', 'OS']);

/** Сочетание нажатой клавиши; null — нажат только модификатор. */
export function comboFromEvent(e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): string | null {
  if (MODIFIER_KEYS.has(e.key) || !e.code) return null;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(e.code);
  return parts.join('+');
}

const CODE_LABELS: Record<string, string> = {
  Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Backquote: '`', Minus: '−', Equal: '=', Space: 'Пробел', Enter: 'Enter',
  Escape: 'Esc', Backspace: 'Backspace', Delete: 'Delete', Tab: 'Tab', Home: 'Home', End: 'End',
  PageUp: 'PageUp', PageDown: 'PageDown', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
};

/** «KeyN» → «N», «Digit3» → «3», «Comma» → «,». */
export function codeLabel(code: string): string {
  if (/^(Key|Digit)/.test(code)) return code.replace(/^(Key|Digit)/, '');
  if (/^Numpad\d$/.test(code)) return `Num ${code.slice(6)}`;
  return CODE_LABELS[code] ?? code;
}

/** «Ctrl+Shift+KeyN» → «Ctrl+Shift+N» (на macOS — «Cmd+Shift+N»). */
export function comboLabel(combo: string): string {
  const parts = combo.split('+');
  const code = parts.pop()!;
  return macKeys([...parts, codeLabel(code)].join('+'));
}

/** Модификатор перехода по страницам так, как он записан в сочетании. */
function modPart(mod: PageKeyMod): 'Alt' | 'Ctrl' {
  return mod === 'alt' ? 'Alt' : 'Ctrl';
}

/** Подпись модификатора для интерфейса. */
export function modLabel(mod: PageKeyMod): string {
  return macKeys(modPart(mod));
}

/** Номер страницы (1–9) из сочетания «модификатор + цифра»; иначе null. */
export function pageNumberFromEvent(e: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>, mod: PageKeyMod): number | null {
  const ctrl = e.ctrlKey || e.metaKey;
  const ok = mod === 'ctrl' ? ctrl && !e.altKey : e.altKey && !ctrl;
  if (!ok || e.shiftKey) return null;
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
  return m ? Number(m[1]) : null;
}

/**
 * Постоянные сочетания доски — для справки в настройках и проверки конфликтов.
 * Одиночный модификатор («Shift», «Ctrl», «Alt») — клавиша, которую держат во время действия.
 */
export interface FixedShortcut {
  keys: string[];
  what: string;
  /** Настройка доски, с которой сочетание не нужно: пока она включена, в справке его нет. */
  hiddenBy?: keyof BoardSettings;
}
export interface ShortcutGroup { title: string; items: FixedShortcut[]; note?: string }

export const FIXED_SHORTCUTS: ShortcutGroup[] = [
  {
    title: 'Правка',
    items: [
      { keys: ['Ctrl+KeyZ'], what: 'Отменить' },
      { keys: ['Ctrl+KeyY', 'Ctrl+Shift+KeyZ'], what: 'Повторить' },
      { keys: ['Ctrl+KeyA'], what: 'Выделить всё' },
      { keys: ['Ctrl+KeyC'], what: 'Копировать' },
      { keys: ['Ctrl+KeyX'], what: 'Вырезать' },
      { keys: ['Ctrl+KeyV'], what: 'Вставить' },
      { keys: ['Ctrl+KeyD'], what: 'Дублировать' },
      { keys: ['Delete', 'Backspace'], what: 'Удалить выделенное' },
      { keys: ['Ctrl+KeyG'], what: 'Сгруппировать' },
      { keys: ['Ctrl+Shift+KeyG'], what: 'Разгруппировать' },
    ],
  },
  {
    title: 'Доска',
    items: [
      { keys: ['Ctrl+KeyS'], what: 'Сохранить' },
      { keys: ['Ctrl+KeyE'], what: 'Экспорт в PNG' },
      { keys: ['Ctrl+Comma'], what: 'Все настройки' },
      { keys: ['KeyB'], what: 'Показать или скрыть список страниц' },
      { keys: ['Digit0'], what: 'Показать всё содержимое' },
      { keys: ['Equal', 'Minus'], what: 'Крупнее / мельче' },
      { keys: ['Space'], what: 'Двигать доску, пока клавиша нажата' },
      { keys: ['Enter'], what: 'Закончить ломаную' },
      { keys: ['Escape'], what: 'Прервать ломаную, закрыть панель' },
    ],
  },
  {
    title: 'Изменение размера',
    note: 'Клавишу держат, пока тянут ручку выделенного элемента.',
    items: [
      { keys: ['Shift', 'Ctrl'], what: 'Сохранить пропорции фигуры или стикера' },
      { keys: ['Shift', 'Ctrl'], what: 'Сохранить пропорции изображения', hiddenBy: 'keepImageAspect' },
      { keys: ['Alt'], what: 'Менять размер от центра' },
    ],
  },
  {
    title: 'Текст и стикеры',
    items: [
      { keys: ['Enter'], what: 'Готово' },
      { keys: ['Shift+Enter'], what: 'Новая строка' },
      { keys: ['Escape'], what: 'Отменить ввод' },
    ],
  },
];

/** Чем занято сочетание в самой доске; null — свободно. */
function appUse(combo: string): string | null {
  for (const g of FIXED_SHORTCUTS) {
    if (g.title === 'Текст и стикеры') continue; // действуют только в редакторе текста
    for (const s of g.items) if (s.keys.includes(combo)) return s.what.toLowerCase();
  }
  return null;
}

/** Почему сочетание нельзя назначить новой странице; null — можно. */
export function newPageKeyProblem(combo: string, pageMod: PageKeyMod): string | null {
  const parts = combo.split('+');
  const code = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  if (!mods.includes('Ctrl') && !mods.includes('Alt')) {
    return macKeys('Нужно сочетание с Ctrl или Alt: одиночные клавиши — у инструментов');
  }
  if (!/^(Key[A-Z]|Digit[0-9])$/.test(code)) return macKeys('Подойдёт Ctrl или Alt с буквой или цифрой');
  if (mods.length === 1 && /^Digit[1-9]$/.test(code) && mods[0] === modPart(pageMod)) {
    return `${comboLabel(combo)} занято: переход на страницу ${code.slice(5)}`;
  }
  const use = appUse(combo);
  if (use) return `${comboLabel(combo)} занято: ${use}`;
  return null;
}

// ----- Сочетания, которые занимает браузер -----

/** Окружение для проверки: в приложении для компьютера браузерных сочетаний нет. */
export interface KeyEnv { browser: boolean; linux: boolean }

export function currentKeyEnv(): KeyEnv {
  const w = typeof window !== 'undefined' ? window : undefined;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  return { browser: !!w && !('doskaAPI' in w), linux: /Linux/i.test(ua) && !/Android/i.test(ua) };
}

/** Сочетания браузеров (Chrome, Edge, Firefox) — страница их часто не получает. */
const BROWSER_COMBOS: Record<string, string> = {
  'Ctrl+KeyN': 'новое окно',
  'Ctrl+Shift+KeyN': 'окно инкогнито',
  'Ctrl+KeyT': 'новая вкладка',
  'Ctrl+Shift+KeyT': 'вернуть закрытую вкладку',
  'Ctrl+KeyW': 'закрыть вкладку',
  'Ctrl+Shift+KeyW': 'закрыть окно',
  'Ctrl+KeyQ': 'выйти из браузера',
  'Ctrl+Shift+KeyQ': 'выйти из браузера',
  'Ctrl+KeyL': 'адресная строка',
  'Ctrl+KeyK': 'поиск в адресной строке',
  'Ctrl+KeyH': 'история',
  'Ctrl+KeyJ': 'загрузки',
  'Ctrl+KeyP': 'печать',
  'Ctrl+KeyR': 'перезагрузка страницы',
  'Ctrl+Shift+KeyR': 'перезагрузка страницы',
  'Ctrl+KeyF': 'поиск на странице',
  'Ctrl+KeyU': 'исходный код страницы',
  'Ctrl+KeyO': 'открыть файл',
  'Ctrl+Shift+KeyI': 'инструменты разработчика',
  'Ctrl+Shift+KeyJ': 'инструменты разработчика',
  'Ctrl+Shift+KeyC': 'инструменты разработчика',
  'Ctrl+Shift+KeyB': 'панель закладок',
  'Ctrl+Shift+KeyO': 'закладки',
  'Ctrl+Shift+KeyP': 'приватное окно',
  'Ctrl+Shift+KeyH': 'история',
  'Ctrl+Shift+KeyM': 'профили',
  'Alt+KeyF': 'меню браузера',
  'Alt+KeyE': 'меню браузера',
  'Alt+KeyD': 'адресная строка',
  'Alt+KeyV': 'меню браузера',
  'Alt+KeyS': 'меню браузера',
  'Alt+KeyB': 'меню браузера',
  'Alt+KeyT': 'меню браузера',
  'Alt+KeyH': 'меню браузера',
};

/** Чем сочетание занято в браузере; null — свободно или мы не в браузере. */
export function browserUse(combo: string, env: KeyEnv): string | null {
  if (!env.browser) return null;
  if (BROWSER_COMBOS[combo]) return BROWSER_COMBOS[combo];
  if (/^Ctrl\+Digit[1-9]$/.test(combo)) return 'переключение вкладок';
  if (env.linux && /^Alt\+Digit[1-9]$/.test(combo)) return 'переключение вкладок';
  return null;
}

/** Предупреждение для сочетания новой страницы; null — в этом окружении работает. */
export function newPageKeyWarning(combo: string | null, env: KeyEnv): string | null {
  const use = combo ? browserUse(combo, env) : null;
  if (!combo || !use) return null;
  return `В браузере ${comboLabel(combo)} — ${use}: сочетание может не сработать. `
    + 'В приложении для компьютера работает.';
}

/** Предупреждение для перехода по страницам «модификатор + цифра»; null — работает. */
export function pageKeyWarning(mod: PageKeyMod, env: KeyEnv): string | null {
  if (!browserUse(`${modPart(mod)}+Digit1`, env)) return null;
  const where = mod === 'alt' ? 'В браузере на Linux' : 'В браузере';
  return `${where} ${modLabel(mod)}+1…9 переключают вкладки: переход по страницам может не сработать. `
    + 'В приложении для компьютера работает.';
}
