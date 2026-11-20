// Поля названий проекта и страницы в шапке. Вне фокуса — первые TOPBAR_NAME_SHOWN символов и «...»,
// полное название — в подсказке (только у обрезанного); в фокусе — полное название для правки.
// Enter — сохранить, Esc — вернуть как было.

import { cleanName, shortName } from './project-names';

export interface TopNameOptions {
  /** Сколько символов можно ввести. */
  max: number;
  /** Можно ли сейчас переименовывать (гость, просмотр по ссылке — нельзя). */
  canEdit(): boolean;
  /** Новое название (уже без пробелов по краям, не пустое и не равное прежнему). */
  commit(name: string): void;
}

export interface TopName {
  /** Название сменилось снаружи (другая страница, другой проект, переименование в списке). */
  set(full: string): void;
}

/** Подсказка с полным названием: есть — только у обрезанного (data-tip — от src/tooltip.ts). */
function setTip(input: HTMLElement, full: string | null): void {
  if (full) {
    if (input.dataset.tip !== full) input.setAttribute('title', full);
  } else {
    input.removeAttribute('title');
    input.removeAttribute('data-tip');
  }
}

export function wireTopName(input: HTMLInputElement, o: TopNameOptions): TopName {
  let full = '';
  input.maxLength = o.max;
  const focused = () => document.activeElement === input;
  const show = () => {
    if (focused()) return;
    const s = shortName(full);
    if (input.value !== s.text) input.value = s.text;
    setTip(input, s.cut ? full : null);
  };
  input.addEventListener('focus', () => {
    input.readOnly = !o.canEdit();
    setTip(input, null);
    if (input.value !== full) {
      input.value = full;
      input.setSelectionRange(full.length, full.length);
    }
  });
  input.addEventListener('blur', show);
  input.addEventListener('change', () => {
    const v = cleanName(input.value, o.max);
    if (o.canEdit() && v && v !== full) {
      full = v;
      o.commit(v);
    }
    if (focused()) input.value = full;
    else show();
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      input.value = full;
      input.blur();
    }
  });
  return {
    set(next) {
      if (next === full && (focused() || input.value === shortName(full).text)) return;
      full = next;
      // поле правят — текст не трогаем (как раньше у названия страницы)
      show();
    },
  };
}
