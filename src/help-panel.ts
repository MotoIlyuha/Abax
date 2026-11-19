// Режим боковой панели «Справка» (SPEC_CHAT §8): поиск, «Быстрый старт» (короткие советы) и
// «Горячие клавиши» (src/hotkeys.ts, клавиши инструментов — src/toolbar.ts), внизу — версия приложения
// и «Сообщить о проблеме». Поиск фильтрует и советы, и клавиши. Весь текст — через textContent.

import { CHAT_ICON, ICONS, PANEL_ICONS, TOOL_ICONS } from './icons';
import { DRAFT_KEY, FIXED_SHORTCUTS, comboLabel, macKeys, modLabel } from './hotkeys';
import { keycaps, keycapsAny } from './hotkeys-settings';
import type { PanelModeDef, PanelView } from './panel-types';
import { el, iconEl, panelScaffold } from './panel-view';
import { state } from './state';
import { TOOL_DEFS, toolbarConfig } from './toolbar';
import { REPO_URL } from './updates';

export const HELP_MODE: Omit<PanelModeDef, 'mount'> = { id: 'help', label: 'Справка', icon: ICONS.help };

export interface HelpTip { icon: string; title: string; text: string }
export interface HelpKey { what: string; keys: HTMLElement; search: string }
export interface HelpKeyGroup { title: string; items: HelpKey[]; note?: string }

/** Советы «Быстрого старта» — по текущим настройкам (модификатор страниц, клавиша новой страницы, колесо). */
export function helpTips(): HelpTip[] {
  const s = state.settings;
  const mod = modLabel(s.pageKeyMod);
  const newPage = s.newPageKey ? `, ${comboLabel(s.newPageKey)} — новая страница` : '';
  return [
    {
      icon: TOOL_ICONS.pen,
      title: 'Инструменты',
      text: 'Перо, маркер, текст, стикеры и фигуры — на панели инструментов. Клавиша каждого — в подсказке кнопки.',
    },
    {
      icon: TOOL_ICONS.pan,
      title: 'Двигать и масштабировать',
      text: `Удерживайте Пробел и тяните — доска поедет следом. ${s.wheelMode === 'zoom' ? 'Колесо мыши' : macKeys('Ctrl + колесо мыши')} — масштаб, 0 — показать всё.`,
    },
    {
      icon: ICONS.image,
      title: 'Картинки',
      text: macKeys('Ctrl+V вставляет картинку из буфера обмена. Файл можно и перетащить на холст.'),
    },
    {
      icon: ICONS.pages,
      title: 'Страницы',
      text: `Список страниц — кнопка внизу или клавиша B. ${mod}+1…9 — переход на страницу${newPage}.`,
    },
    {
      icon: ICONS.draft,
      title: 'Черновик',
      text: `${comboLabel(DRAFT_KEY)} — страница, которую видите только вы. При выходе из доски она пропадает.`,
    },
    {
      icon: TOOL_ICONS.eraser,
      title: 'Стирать правой кнопкой',
      text: 'С пером или маркером правая кнопка мыши стирает штрихи — ластик выбирать не нужно.',
    },
    {
      icon: ICONS.share,
      title: 'Поделиться',
      text: 'Пригласите учеников по ссылке и решите, кто что может на каждой странице.',
    },
    {
      icon: CHAT_ICON,
      title: 'Чат и уведомления',
      text: 'Кнопка справа в шапке: сообщения участников и события доски.',
    },
  ];
}

/** Клавиши подряд: [Alt] [1…9]. */
function kbdRow(labels: string[]): HTMLElement {
  const box = el('span', 'hk-keys');
  for (const l of labels) box.append(el('kbd', '', l));
  return box;
}

/** Горячие клавиши: инструменты, страницы и постоянные сочетания доски (скрытые настройкой — без них). */
export function helpKeyGroups(): HelpKeyGroup[] {
  const s = state.settings;
  const groups: HelpKeyGroup[] = [];
  const keys = toolbarConfig().keys;
  const tools: HelpKey[] = [];
  for (const def of TOOL_DEFS) {
    const code = keys[def.id];
    if (code) tools.push({ what: def.title, keys: keycaps(code), search: comboLabel(code) });
  }
  if (tools.length) groups.push({ title: 'Инструменты', items: tools, note: 'Клавиши инструментов меняются в «Настройках» → «Панель инструментов».' });
  const mod = modLabel(s.pageKeyMod);
  const pages: HelpKey[] = [{ what: 'Перейти на страницу 1–9', keys: kbdRow([mod, '1…9']), search: `${mod}+1…9` }];
  if (s.newPageKey) pages.push({ what: 'Новая страница', keys: keycaps(s.newPageKey), search: comboLabel(s.newPageKey) });
  groups.push({ title: 'Страницы', items: pages });
  for (const g of FIXED_SHORTCUTS) {
    const items = g.items
      .filter(item => !(item.hiddenBy && s[item.hiddenBy]))
      .map(item => ({ what: item.what, keys: keycapsAny(item.keys), search: item.keys.map(comboLabel).join(' ') }));
    if (items.length) groups.push({ title: g.title, items, ...(g.note ? { note: macKeys(g.note) } : {}) });
  }
  return groups;
}

/** Для поиска: строчные, «ё» = «е». */
const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е');

/** Текст с подсветкой найденного (<mark>); только textContent. */
function fillMarked(target: HTMLElement, text: string, query: string): void {
  target.textContent = '';
  const hay = norm(text);
  if (!query || hay.length !== text.length) { target.textContent = text; return; }
  let from = 0;
  for (let at = hay.indexOf(query); at !== -1; at = hay.indexOf(query, from)) {
    if (at > from) target.append(text.slice(from, at));
    target.append(el('mark', 'hlp-mark', text.slice(at, at + query.length)));
    from = at + query.length;
  }
  if (from < text.length) target.append(text.slice(from));
}

/** Версия приложения из package.json (Vite: define); в тестах её нет. */
function appVersion(): string {
  return typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '';
}

export function mountHelpPanel(host: HTMLElement): PanelView {
  const { root, box, body, scroll } = panelScaffold(host, 'help');

  // ----- Поиск -----
  const search = el('div', 'hlp-search');
  const field = el('label', 'hlp-search-field');
  const input = el('input', 'hlp-search-input');
  input.type = 'search';
  input.placeholder = 'Поиск по справке';
  input.setAttribute('aria-label', 'Поиск по справке');
  input.autocomplete = 'off';
  input.spellcheck = false;
  field.append(iconEl('hlp-search-icon', PANEL_ICONS.search), input);
  search.append(field);
  root.insertBefore(search, box);

  // ----- Содержимое -----
  const tipsSection = el('section', 'hlp-section');
  tipsSection.dataset.section = 'tips';
  const tipsList = el('ul', 'hlp-tips');
  tipsSection.append(el('h3', 'pv-title', 'Быстрый старт'), tipsList);
  const keysSection = el('section', 'hlp-section');
  keysSection.dataset.section = 'keys';
  const keysBody = el('div', 'hlp-key-groups');
  keysSection.append(el('h3', 'pv-title', 'Горячие клавиши'), keysBody);
  const nothing = el('p', 'hlp-empty', 'Ничего не нашлось');
  nothing.hidden = true;
  const foot = el('footer', 'hlp-foot');
  const version = appVersion();
  foot.append(el('span', 'hlp-version', version ? `Abax, версия ${version}` : 'Abax'));
  const report = el('a', 'hlp-report', 'Сообщить о проблеме');
  report.href = `${REPO_URL}/issues`;
  report.target = '_blank';
  report.rel = 'noopener noreferrer';
  foot.append(report);
  body.append(tipsSection, keysSection, nothing, foot);

  interface TipNode { li: HTMLElement; title: HTMLElement; text: HTMLElement; tip: HelpTip }
  interface KeyNode { row: HTMLElement; what: HTMLElement; item: HelpKey }
  interface GroupNode { block: HTMLElement; title: HTMLElement; group: HelpKeyGroup; rows: KeyNode[] }
  let tips: TipNode[] = [];
  let groups: GroupNode[] = [];

  /** Советы и клавиши — заново при каждом показе: настройки и клавиши могли поменяться. */
  const build = () => {
    tipsList.textContent = '';
    tips = helpTips().map(tip => {
      const li = el('li', 'hlp-tip');
      const text = el('div', 'hlp-tip-body');
      const title = el('div', 'hlp-tip-title');
      const p = el('div', 'hlp-tip-text');
      text.append(title, p);
      li.append(iconEl('hlp-tip-icon', tip.icon), text);
      tipsList.append(li);
      return { li, title, text: p, tip };
    });
    keysBody.textContent = '';
    groups = helpKeyGroups().map(group => {
      const block = el('div', 'hlp-group');
      const title = el('h4', 'hlp-group-title');
      const grid = el('div', 'hlp-keys');
      block.append(title, grid);
      const rows = group.items.map(item => {
        const row = el('div', 'hlp-key-row');
        const what = el('span', 'hlp-key-what');
        row.append(what, item.keys);
        grid.append(row);
        return { row, what, item };
      });
      if (group.note) block.append(el('p', 'hlp-note', group.note));
      keysBody.append(block);
      return { block, title, group, rows };
    });
  };

  /** Фильтр поиска: совпадение в заголовке группы показывает её целиком. */
  const filter = () => {
    const q = norm(input.value.trim());
    let tipCount = 0;
    for (const t of tips) {
      const hit = !q || norm(`${t.tip.title} ${t.tip.text}`).includes(q);
      t.li.hidden = !hit;
      if (hit) tipCount++;
      fillMarked(t.title, t.tip.title, q);
      fillMarked(t.text, t.tip.text, q);
    }
    tipsSection.hidden = tipCount === 0;
    let keyCount = 0;
    for (const g of groups) {
      const groupHit = !!q && norm(g.group.title).includes(q);
      let n = 0;
      for (const r of g.rows) {
        const hit = !q || groupHit || norm(`${r.item.what} ${r.item.search}`).includes(q);
        r.row.hidden = !hit;
        if (hit) n++;
        fillMarked(r.what, r.item.what, q);
      }
      g.block.hidden = n === 0;
      const note = g.block.querySelector<HTMLElement>('.hlp-note');
      if (note) note.hidden = !!q && !groupHit;
      fillMarked(g.title, g.group.title, q);
      keyCount += n;
    }
    keysSection.hidden = keyCount === 0;
    nothing.hidden = tipCount + keyCount > 0;
    scroll.sync();
  };

  input.addEventListener('input', filter);
  input.addEventListener('keydown', e => {
    // Esc с текстом в поиске — сначала очистить поиск (панель закрывается следующим Esc)
    if (e.key === 'Escape' && input.value) {
      e.preventDefault();
      e.stopPropagation();
      input.value = '';
      filter();
    }
  });

  build();
  filter();

  return {
    show() {
      build();
      filter();
    },
    focus() {
      input.focus();
    },
  };
}
