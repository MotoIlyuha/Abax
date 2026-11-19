// Режим боковой панели «История изменений» (SPEC_CHAT §8): «Отменить» / «Повторить» и лента шагов
// истории этой страницы за текущий сеанс — сделанное, текущее состояние и отменённое (бледнее).
// Щелчок по записи — переход к ней повторными undo()/redo() (src/state.ts: jumpToHistory).
// Новые записи — сверху. Подписи — src/history-diff.ts, только через textContent.

import { ICONS, PANEL_ICONS } from './icons';
import { macKeys } from './hotkeys';
import { panelActions } from './panel-actions';
import type { PanelModeDef, PanelView } from './panel-types';
import { el, iconEl, panelScaffold, setTip } from './panel-view';
import { canRedo, canUndo, historyTimeline, jumpToHistory, onChange, redo, undo, type HistoryRecord } from './state';

export const HISTORY_MODE: Omit<PanelModeDef, 'mount'> = { id: 'history', label: 'История изменений', icon: PANEL_ICONS.history };

const EMPTY_TEXT = 'Изменений пока нет. Здесь появится всё, что вы сделаете на этой странице';
const NO_EDIT_TEXT = 'Нет права на правку этой страницы';
/** Как часто обновлять «только что» → «14:02», пока лента на экране. */
const CLOCK_MS = 20_000;

const pad = (n: number) => String(n).padStart(2, '0');

/** Время записи: «только что» (меньше минуты), «14:02» сегодня, «18 нояб., 14:02» — раньше. */
export function formatHistoryTime(ts: number, now = Date.now()): string {
  if (now - ts < 60_000) return 'только что';
  const d = new Date(ts);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const today = new Date(now);
  if (d.toDateString() === today.toDateString()) return hm;
  return `${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}, ${hm}`;
}

/** Можно ли сейчас отменять и переходить по истории (читатель в совместной работе — нет). */
function editable(): boolean {
  return panelActions()?.canEdit() ?? true;
}

export function mountHistoryPanel(host: HTMLElement): PanelView {
  const { root, box, body, scroll } = panelScaffold(host, 'history');

  // ----- «Отменить» / «Повторить» и подпись над лентой -----
  const head = el('div', 'hist-head');
  const actions = el('div', 'hist-actions');
  const historyButton = (act: 'undo' | 'redo', label: string, icon: string): HTMLButtonElement => {
    const b = el('button', 'hist-btn');
    b.type = 'button';
    b.dataset.act = act;
    b.append(iconEl('hist-btn-icon', icon), el('span', '', label));
    return b;
  };
  const undoBtn = historyButton('undo', 'Отменить', ICONS.undo);
  const redoBtn = historyButton('redo', 'Повторить', ICONS.redo);
  undoBtn.title = macKeys('Отменить (Ctrl+Z)');
  redoBtn.title = macKeys('Повторить (Ctrl+Y)');
  actions.append(undoBtn, redoBtn);
  head.append(actions, el('div', 'hist-caption', 'Эта страница · текущий сеанс'));
  root.insertBefore(head, box);

  // ----- Лента -----
  const list = el('ol', 'hist-list');
  list.setAttribute('aria-label', 'Шаги истории, новые сверху');
  const empty = el('div', 'hist-empty');
  empty.append(iconEl('hist-empty-icon', PANEL_ICONS.history), el('p', 'hist-empty-text', EMPTY_TEXT));
  body.append(list, empty);

  let shown = false;
  let frame = 0;
  let clock = 0;
  let lastKey = '';

  undoBtn.addEventListener('click', () => { if (editable()) undo(); });
  redoBtn.addEventListener('click', () => { if (editable()) redo(); });
  list.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.hist-entry');
    if (!b || !list.contains(b) || b.getAttribute('aria-disabled') === 'true') return;
    const index = Number(b.dataset.index);
    if (b.dataset.state === 'current' || !editable()) return;
    jumpToHistory(index);
  });

  /** Строка записи: точка ленты, подпись и время. Узлы переиспользуются — фокус клавиатуры не теряется. */
  const entry = (li: HTMLLIElement): HTMLButtonElement => {
    let b = li.firstElementChild as HTMLButtonElement | null;
    if (!b) {
      b = el('button', 'hist-entry');
      b.type = 'button';
      b.append(el('span', 'hist-dot'), el('span', 'hist-label'), el('time', 'hist-time'));
      b.firstElementChild!.setAttribute('aria-hidden', 'true');
      li.append(b);
    }
    return b;
  };

  const render = () => {
    frame = 0;
    if (!shown) return;
    const can = editable();
    undoBtn.disabled = !can || !canUndo();
    redoBtn.disabled = !can || !canRedo();
    const records: HistoryRecord[] = historyTimeline();
    const now = Date.now();
    const times = records.map(r => formatHistoryTime(r.ts, now));
    const key = `${can}|${records.map((r, i) => `${r.state}\u0001${r.label}\u0001${times[i]}`).join('\u0002')}`;
    if (key === lastKey) return;
    lastKey = key;
    const none = records.length <= 1;
    empty.hidden = !none;
    list.hidden = none;
    const n = none ? 0 : records.length;
    while (list.children.length > n) list.lastElementChild!.remove();
    while (list.children.length < n) list.append(el('li', 'hist-item'));
    let currentBtn: HTMLButtonElement | null = null;
    // новые сверху: позиция p — запись n − 1 − p
    for (let p = 0; p < n; p++) {
      const i = n - 1 - p;
      const r = records[i];
      const li = list.children[p] as HTMLLIElement;
      const b = entry(li);
      li.dataset.state = r.state;
      b.dataset.state = r.state;
      b.dataset.index = String(i);
      b.querySelector('.hist-label')!.textContent = r.label;
      const time = b.querySelector('time')!;
      time.textContent = times[i];
      time.dateTime = new Date(r.ts).toISOString();
      if (r.state === 'current') {
        b.setAttribute('aria-current', 'step');
        currentBtn = b;
      } else {
        b.removeAttribute('aria-current');
      }
      const blocked = !can && r.state !== 'current';
      if (blocked) b.setAttribute('aria-disabled', 'true');
      else b.removeAttribute('aria-disabled');
      setTip(b, blocked ? NO_EDIT_TEXT : '');
      b.setAttribute('aria-label', `${r.label}, ${times[i]}${r.state === 'current' ? ' — текущее состояние' : r.state === 'undone' ? ' — отменено' : ''}`);
    }
    scroll.sync();
    // текущее состояние не уезжает из виду (отмена с клавиатуры при открытой ленте)
    (currentBtn as HTMLButtonElement | null)?.scrollIntoView?.({ block: 'nearest' });
  };

  const schedule = () => {
    if (!shown || frame) return;
    frame = requestAnimationFrame(render);
  };
  onChange(schedule);

  return {
    show() {
      shown = true;
      lastKey = '';
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      render();
      window.clearInterval(clock);
      clock = window.setInterval(render, CLOCK_MS);
    },
    hide() {
      shown = false;
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      window.clearInterval(clock);
    },
    focus() {
      const current = list.querySelector<HTMLButtonElement>('.hist-entry[aria-current="step"]');
      (current && !list.hidden ? current : undoBtn.disabled ? root : undoBtn).focus();
    },
  };
}
