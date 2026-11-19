// Кнопка установки смайла (как «Добавить иконку проекта»): на кнопке — выбранный эмодзи, своя картинка или,
// пока ничего нет, приглашение его поставить; клик — окно выбора смайла (src/icon-picker.ts).
// Общая для иконки проекта (шапка, карточки и строки домашней) и аватара пользователя (src/avatar-editor.ts).
// Эмодзи — только textContent, картинка — свойство src (data:image, проверяет вызывающий); значок — константа.

import { ICONS } from './icons';
import { openIconPicker, type IconPickerOptions } from './icon-picker';

/** Нарисовать на кнопке значение: эмодзи, картинку (data:image/…) или (пусто) значок приглашения. */
export function paintIcon(host: HTMLElement, icon: string | null | undefined): void {
  host.textContent = '';
  host.classList.toggle('empty', !icon);
  if (!icon) {
    host.innerHTML = ICONS.addIcon; // константа значка
  } else if (icon.startsWith('data:image/')) {
    const img = document.createElement('img');
    img.src = icon;
    img.alt = '';
    host.appendChild(img);
  } else {
    const glyph = document.createElement('span');
    glyph.textContent = icon;
    host.appendChild(glyph);
  }
}

export interface IconButtonOptions {
  /** Готовая кнопка из разметки (index.html); нет — создаётся новая. */
  el?: HTMLButtonElement;
  /** Классы новой кнопки (например, 'project-icon badge'). */
  className?: string;
  /** Текущее значение: эмодзи, картинка или null. */
  value: string | null;
  /** На кнопке — выбранное значение (иконка проекта); false — всегда значок приглашения (смайл уже виден рядом). */
  showValue?: boolean;
  /** Подсказка кнопки по значению. */
  title(value: string | null): string;
  /** Параметры окна выбора. */
  picker?: IconPickerOptions;
  /** Можно ли открыть окно сейчас (например, не в режиме просмотра по ссылке). */
  enabled?(): boolean;
  /** Клик не уходит дальше кнопки (кнопка лежит на кликабельной карточке). */
  stopPropagation?: boolean;
  /** Выбран эмодзи или картинка; null — убрать. */
  onPick(value: string | null): void;
}

export interface IconButton {
  el: HTMLButtonElement;
  /** Значение сменилось снаружи — перерисовать кнопку. */
  set(value: string | null): void;
  value(): string | null;
}

export function createIconButton(o: IconButtonOptions): IconButton {
  const b = o.el ?? document.createElement('button');
  if (!o.el) {
    b.type = 'button';
    if (o.className) b.className = o.className;
  }
  let value = o.value;
  const paint = () => {
    paintIcon(b, o.showValue === false ? null : value);
    b.title = o.title(value);
  };
  paint();
  b.addEventListener('click', e => {
    if (o.stopPropagation) e.stopPropagation();
    if (o.enabled && !o.enabled()) return;
    openIconPicker(b, value, v => { value = v; paint(); o.onPick(v); }, o.picker);
  });
  return {
    el: b,
    set(v) { if (v === value && b.firstChild) return; value = v; paint(); },
    value: () => value,
  };
}
