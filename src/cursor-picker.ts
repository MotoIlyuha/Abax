// Выбор курсора: сетка пресетов (6 бесплатных + Pro) и превью — как выглядят курсор, рамка выделения и бейдж.
// Общий для окна первого входа и раздела настроек «Профиль». Разметка курсоров — из каталога (только константы),
// имя пользователя — только textContent.

import { CURSOR_PRESETS, cursorPreset, cursorSvg } from './cursors';
import { pickCursor, previewLocked, revertChoice, type CursorChoice } from './onboarding-logic';

export interface CursorPickerOptions {
  choice: CursorChoice;
  /** Есть право на Pro-курсоры. */
  entitled: boolean;
  /** Имя в бейдже превью. */
  name: string;
  onChange(choice: CursorChoice): void;
}

export interface CursorPicker {
  el: HTMLElement;
  /** Обновить имя в бейдже превью. */
  setName(name: string): void;
  choice(): CursorChoice;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function createCursorPicker(o: CursorPickerOptions): CursorPicker {
  let choice = o.choice;
  let name = o.name;
  const root = el('div', 'cp');

  // ----- превью -----
  const preview = el('div', 'cp-preview');
  preview.setAttribute('aria-hidden', 'true');
  const sample = el('div', 'cp-sample');
  const frame = el('div', 'cp-frame');
  for (const pos of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
    const h = el('i', `cp-handle cp-${pos}`);
    frame.appendChild(h);
  }
  const marquee = el('div', 'cp-marquee');
  const pointer = el('div', 'cp-pointer');
  const arrow = el('i', 'cp-arrow');
  const badge = el('span', 'cp-badge');
  pointer.append(arrow, badge);
  preview.append(sample, frame, marquee, pointer);

  const lock = el('div', 'cp-lock');
  lock.setAttribute('role', 'status');
  const lockText = el('span', 'cp-lock-text', 'Доступно в подписке Pro');
  const back = el('button', 'cp-lock-back', 'Вернуться к бесплатному курсору');
  back.type = 'button';
  back.addEventListener('click', () => set(revertChoice(choice)));
  lock.append(lockText, back);

  // ----- сетка -----
  const grid = el('div', 'cp-grid');
  grid.setAttribute('role', 'radiogroup');
  grid.setAttribute('aria-label', 'Курсор');
  const tiles = new Map<string, HTMLButtonElement>();
  for (const p of CURSOR_PRESETS) {
    const b = el('button', 'cp-tile');
    b.type = 'button';
    b.dataset.cursor = p.id;
    b.setAttribute('role', 'radio');
    b.title = p.tier === 'pro' ? `${p.name} (Pro)` : p.name;
    const icon = el('span', 'cp-tile-icon');
    icon.innerHTML = cursorSvg(p.id, { size: 28 });
    const label = el('span', 'cp-tile-name', p.name);
    b.append(icon, label);
    if (p.tier === 'pro' && !o.entitled) b.appendChild(el('span', 'cp-pro', 'PRO'));
    b.addEventListener('click', () => set(pickCursor(choice, p.id, o.entitled)));
    tiles.set(p.id, b);
    grid.appendChild(b);
  }

  root.append(preview, lock, grid);

  function paint(): void {
    const p = cursorPreset(choice.preview);
    preview.style.setProperty('--cp-sel', p.selectionColor);
    preview.dataset.effect = p.effect;
    arrow.innerHTML = cursorSvg(p.id, { size: 32 });
    badge.textContent = name;
    badge.style.background = p.badgeBg;
    badge.style.color = p.badgeText;
    const locked = previewLocked(choice);
    lock.hidden = !locked;
    root.classList.toggle('locked', locked);
    for (const [id, b] of tiles) {
      const on = id === choice.preview;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    }
  }

  function set(next: CursorChoice): void {
    choice = next;
    paint();
    o.onChange(choice);
  }

  // стрелки по сетке — как у группы переключателей
  grid.addEventListener('keydown', e => {
    const ids = CURSOR_PRESETS.map(p => p.id);
    const i = ids.indexOf(choice.preview);
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const id = ids[(i + step + ids.length) % ids.length];
    set(pickCursor(choice, id, o.entitled));
    tiles.get(id)?.focus();
  });

  paint();
  return {
    el: root,
    setName(n: string) { name = n; badge.textContent = n; },
    choice: () => choice,
  };
}
