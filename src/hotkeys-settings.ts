// Раздел «Горячие клавиши» окна «Все настройки»: переход на страницу по номеру,
// новая страница (с предупреждением, если в браузере сочетание занято), клавиши
// инструментов (назначаются в разделе «Панель инструментов») и постоянные сочетания доски.

import type { BoardSettings, PageKeyMod } from './types';
import type { SectionView } from './settings-dialog';
import { state } from './state';
import { isNativeApp } from './native';
import { TOOL_DEFS, toolbarConfig, svg } from './toolbar';
import {
  DEFAULT_NEW_PAGE_KEY, FIXED_SHORTCUTS, codeLabel, comboFromEvent, comboLabel, currentKeyEnv, macKeys, modLabel,
  newPageKeyProblem, newPageKeyWarning, pageKeyWarning,
} from './hotkeys';

export interface HotkeysOptions {
  /** Применить и сохранить изменение настроек. */
  save(patch: Partial<BoardSettings>): void;
  /** Открыть назначение клавиш инструментов. */
  editToolKeys(): void;
}

const HINT = 'Нажмите кнопку сочетания и затем новое сочетание';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Сочетание клавишами: [Ctrl] [Shift] [N] (на macOS — [Cmd] [Shift] [N]). */
function keycaps(combo: string): HTMLElement {
  const box = el('span', 'hk-keys');
  const parts = combo.split('+');
  const code = parts.pop()!;
  for (const p of [...parts, codeLabel(code)]) box.appendChild(el('kbd', '', macKeys(p)));
  return box;
}

/** Несколько сочетаний одного действия: [Ctrl] [Y] или [Ctrl] [Shift] [Z]. */
function keycapsAny(combos: string[]): HTMLElement {
  if (combos.length === 4 && combos.every(c => c.startsWith('Arrow'))) {
    const arrows = el('span', 'hk-arrows');
    arrows.setAttribute('aria-label', 'Стрелки вверх, влево, вниз и вправо');
    for (const code of ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']) {
      const key = el('kbd', code === 'ArrowUp' ? 'hk-arrow-up' : '', codeLabel(code));
      arrows.appendChild(key);
    }
    return arrows;
  }
  const box = el('span', 'hk-any');
  combos.forEach((c, i) => {
    if (i > 0) box.appendChild(el('span', 'hk-or', 'или'));
    box.appendChild(keycaps(c));
  });
  return box;
}

function warning(text: string): HTMLElement {
  const w = el('div', 'hk-warn', text);
  w.setAttribute('role', 'note');
  return w;
}

function mouseActionIcon(action: string): string | undefined {
  if (action.startsWith('tool:')) return TOOL_DEFS.find(def => def.id === action.slice(5))?.icon;
  const paths: Record<string, string> = {
    'key:Ctrl+KeyZ': '<path d="M4 10h9a5 5 0 0 1 0 10h-3"/><path d="M8 6l-4 4 4 4"/>',
    'key:Ctrl+KeyY': '<path d="M20 10h-9a5 5 0 0 0 0 10h3"/><path d="M16 6l4 4-4 4"/>',
    'page:previous': '<path d="M15 18l-6-6 6-6"/>',
    'page:next': '<path d="M9 18l6-6-6-6"/>',
    'key:Ctrl+KeyD': '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    'key:Ctrl+Shift+KeyC': '<rect x="3" y="3" width="14" height="14" rx="2"/><path d="m5 14 4-4 3 3 2-2 3 3M14 7h.01M7 21h12a2 2 0 0 0 2-2V7"/>',
    'key:Ctrl+KeyG': '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/><path d="M11 11l2 2"/>',
    'key:Delete': '<path d="M4 7h16M10 3h4M6 7l1 14h10l1-14M10 11v6M14 11v6"/>',
  };
  return paths[action] ? svg(paths[action]) : undefined;
}

export function renderHotkeysSettings(host: HTMLElement, opts: HotkeysOptions): SectionView {
  const root = el('div', 'hk');
  host.appendChild(root);
  const env = currentKeyEnv();
  let capturing = false;
  let mouseTarget: '1' | '3' | '4' | null = null;
  /** Идёт перерисовка: Chromium шлёт blur кнопке, которую убирают из документа, — это не уход фокуса. */
  let redrawing = false;
  let status = HINT;
  let statusError = false;

  function setStatus(text: string, error = false): void {
    status = text;
    statusError = error;
    const s = root.querySelector<HTMLElement>('.hk-status');
    if (s) {
      s.textContent = text;
      s.classList.toggle('error', error);
    }
  }

  function draw(): void {
    redrawing = true;
    try {
      build();
    } finally {
      redrawing = false;
    }
  }

  function build(): void {
    root.textContent = '';
    const s = state.settings;

    // ----- Страницы -----
    const pages = el('section', 'hk-block');
    pages.appendChild(el('h3', 'hk-title', 'Страницы'));

    const go = el('div', 'hk-row');
    const goText = el('div', 'hk-what');
    goText.append(el('div', '', 'Перейти на страницу по номеру'), el('div', 'hk-sub', 'Номер — порядок в списке страниц, от 1 до 9'));
    const mods = el('div', 'ctx-toolbar-pos hk-mods');
    for (const mod of ['ctrl', 'alt'] as PageKeyMod[]) {
      const b = el('button', s.pageKeyMod === mod ? 'active' : '', `${modLabel(mod)} + 1…9`);
      b.dataset.mod = mod;
      b.addEventListener('click', () => {
        if (state.settings.pageKeyMod === mod) return;
        const patch: Partial<BoardSettings> = { pageKeyMod: mod };
        // сочетание новой страницы, совпавшее с переходом, снимаем — иначе оно бы не сработало
        const k = state.settings.newPageKey;
        if (k && newPageKeyProblem(k, mod)) {
          patch.newPageKey = null;
          setStatus(`${comboLabel(k)} теперь переход на страницу — сочетание новой страницы снято`, true);
        }
        opts.save(patch);
        draw();
      });
      mods.appendChild(b);
    }
    go.append(goText, mods);
    pages.appendChild(go);
    const goWarn = pageKeyWarning(s.pageKeyMod, env);
    if (goWarn) pages.appendChild(warning(goWarn));

    const add = el('div', 'hk-row');
    const addText = el('div', 'hk-what');
    addText.append(el('div', '', 'Новая страница'), el('div', 'hk-sub', 'Добавляется в текущий проект'));
    const ctl = el('div', 'hk-ctl');
    const cap = el('button', 'hk-capture' + (capturing ? ' capturing' : ''));
    cap.setAttribute('aria-label', 'Сочетание «Новая страница»');
    if (capturing) cap.textContent = 'Нажмите сочетание…';
    else if (s.newPageKey) cap.appendChild(keycaps(s.newPageKey));
    else cap.textContent = '—';
    cap.title = capturing ? 'Esc — отмена' : 'Нажмите, чтобы сменить сочетание';
    cap.addEventListener('click', () => {
      capturing = !capturing;
      setStatus(capturing ? macKeys('Нажмите сочетание с Ctrl или Alt. Backspace — убрать сочетание, Esc — отмена') : HINT);
      draw();
      root.querySelector<HTMLElement>('.hk-capture')?.focus();
    });
    cap.addEventListener('blur', () => {
      if (!capturing || redrawing) return;
      capturing = false;
      setStatus(HINT);
      draw();
    });
    ctl.appendChild(cap);
    if (s.newPageKey !== DEFAULT_NEW_PAGE_KEY) {
      const reset = el('button', 'hk-reset', 'По умолчанию');
      reset.title = `Вернуть ${comboLabel(DEFAULT_NEW_PAGE_KEY)}`;
      reset.addEventListener('click', () => {
        const problem = newPageKeyProblem(DEFAULT_NEW_PAGE_KEY, state.settings.pageKeyMod);
        if (problem) { setStatus(problem, true); return; }
        setStatus(`Новая страница — ${comboLabel(DEFAULT_NEW_PAGE_KEY)}`);
        opts.save({ newPageKey: DEFAULT_NEW_PAGE_KEY });
        draw();
      });
      ctl.appendChild(reset);
    }
    add.append(addText, ctl);
    pages.appendChild(add);
    const addWarn = newPageKeyWarning(s.newPageKey, env);
    if (addWarn) pages.appendChild(warning(addWarn));
    const st = el('div', 'hk-status' + (statusError ? ' error' : ''), status);
    st.setAttribute('role', 'status');
    pages.appendChild(st);
    root.appendChild(pages);

    function effectiveBindings(): BoardSettings['mouseBindings'] {
      const bindings = { ...state.settings.mouseBindings };
      if (state.settings.mouseMode === 'pages') {
        bindings['3'] = { action: 'page:previous', label: 'Предыдущая страница' };
        bindings['4'] = { action: 'page:next', label: 'Следующая страница' };
      } else if (state.settings.mouseMode === 'history') {
        bindings['3'] = { action: 'key:Ctrl+KeyZ', label: 'Отменить' };
        bindings['4'] = { action: 'key:Ctrl+KeyY', label: 'Повторить' };
      }
      return bindings;
    }

    function saveBinding(id: '1' | '3' | '4', value: { action: string; label: string } | null): void {
      const bindings = effectiveBindings();
      bindings[id] = value;
      opts.save({ mouseBindings: bindings, ...(id === '1' ? {} : { mouseMode: 'custom' as const }) });
      mouseTarget = null;
      draw();
    }

    if (!isNativeApp()) {
      const block = el('section', 'hk-block hk-mouse');
      block.appendChild(el('h3', 'hk-title', 'Кнопки мыши'));
      const bindings = effectiveBindings();
      for (const [id, label] of [['1', 'Нажатие колёсика'], ['3', 'Кнопка «Назад»'], ['4', 'Кнопка «Вперёд»']] as const) {
        const row = el('div', 'hk-mouse-row');
        const description = el('div', 'hk-mouse-description');
        description.appendChild(el('div', '', label));
        if (id === '1') description.appendChild(el('div', 'hk-sub', 'Назначение действия может нарушить навигацию по холсту колёсиком.'));
        const controls = el('div', 'hk-mouse-controls');
        const button = el('button', 'sd-btn hk-mouse-select');
        const binding = bindings[id];
        const icon = binding && mouseActionIcon(binding.action);
        if (icon) { const visual = el('span', 'hk-icon'); visual.setAttribute('aria-hidden', 'true'); visual.innerHTML = icon; button.appendChild(visual); }
        button.appendChild(el('span', '', binding?.label ?? 'Выбрать действие'));
        button.setAttribute('aria-label', `${label}: ${bindings[id]?.label ?? 'выбрать действие'}`);
        button.setAttribute('aria-pressed', String(mouseTarget === id));
        button.addEventListener('click', () => {
          mouseTarget = mouseTarget === id ? null : id;
          draw();
          if (!mouseTarget) return;
          const scroller = root.closest<HTMLElement>('.sd-content');
          if (!scroller) return;
          const start = scroller.scrollTop, distance = 100;
          if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { scroller.scrollTop = start + distance; return; }
          const begin = performance.now();
          const step = (now: number) => {
            const t = Math.min(1, (now - begin) / 700);
            scroller.scrollTop = start + distance * (1 - Math.pow(1 - t, 3));
            if (t < 1 && mouseTarget) requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        });
        controls.appendChild(button);
        if (bindings[id]) {
          const clear = el('button', 'sd-btn', 'Очистить');
          clear.setAttribute('aria-label', `Очистить: ${label}`);
          clear.addEventListener('click', () => saveBinding(id, null));
          controls.appendChild(clear);
        }
        row.append(description, controls);
        block.appendChild(row);
        if (id === '1') {
          const presets = el('div', 'hk-mouse-presets');
          for (const [mode, text] of [['pages', 'Переключать страницы'], ['history', 'Отмена / Повтор']] as const) {
            const preset = el('button', 'sd-btn', text);
            preset.setAttribute('aria-pressed', String(s.mouseMode === mode));
            preset.addEventListener('click', () => { mouseTarget = null; opts.save({ mouseMode: mode }); draw(); });
            presets.appendChild(preset);
          }
          block.appendChild(presets);
        }
      }
      if (mouseTarget) {
        const hint = el('div', 'hk-mouse-hint', 'Выберите действие в списке ниже');
        hint.setAttribute('role', 'status');
        block.appendChild(hint);
      }
      root.appendChild(block);
    }

    function bindRow(row: HTMLElement, action: string, label: string): void {
      if (!mouseTarget) return;
      row.classList.add('hk-bindable');
      row.setAttribute('role', 'button'); row.tabIndex = 0;
      const choose = () => { if (mouseTarget) saveBinding(mouseTarget, { action, label }); };
      row.addEventListener('click', choose);
      row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } });
    }

    bindRow(add, 'page:new', 'Новая страница');

    // ----- Инструменты -----
    const tools = el('section', 'hk-block');
    const head = el('div', 'hk-head');
    head.appendChild(el('h3', 'hk-title', 'Инструменты'));
    const edit = el('button', 'sd-btn hk-edit', 'Изменить');
    edit.title = 'Назначить клавиши инструментам — в разделе «Панель инструментов»';
    edit.addEventListener('click', () => opts.editToolKeys());
    head.appendChild(edit);
    tools.appendChild(head);
    const keys = toolbarConfig().keys;
    const list = el('div', 'hk-grid');
    for (const def of TOOL_DEFS) {
      const code = keys[def.id];
      if (!code && !mouseTarget) continue;
      const row = el('div', 'hk-row hk-tool');
      row.dataset.tool = def.id;
      const name = el('div', 'hk-what hk-tool-name');
      const icon = el('span', 'hk-icon');
      icon.innerHTML = def.icon;
      name.append(icon, el('span', '', def.title));
      row.appendChild(name);
      if (code) row.appendChild(keycaps(code));
      bindRow(row, `tool:${def.id}`, def.title);
      list.appendChild(row);
    }
    if (list.childElementCount === 0) list.appendChild(el('div', 'hk-sub', 'Ни у одного инструмента нет клавиши'));
    tools.appendChild(list);
    tools.appendChild(el('div', 'hk-sub hk-note', macKeys('Клавиша без Ctrl и Alt; у остальных инструментов её можно назначить в «Панели инструментов».')));
    root.appendChild(tools);

    // ----- Постоянные сочетания -----
    for (const g of FIXED_SHORTCUTS) {
      // ставшие ненужными из-за настройки доски (картинки и так пропорциональны) не показываем
      const items = g.items.filter(item => !(item.hiddenBy && s[item.hiddenBy]));
      if (items.length === 0) continue;
      const block = el('section', 'hk-block');
      block.appendChild(el('h3', 'hk-title', g.title));
      const grid = el('div', 'hk-grid');
      for (const item of items) {
        const row = el('div', 'hk-row');
        row.append(el('div', 'hk-what', item.what), keycapsAny(item.keys));
        if (!['Изменение размера', 'Текст и стикеры'].includes(g.title) && !['Ctrl+KeyC', 'Ctrl+KeyX', 'Ctrl+KeyV', 'Space', 'ArrowLeft'].includes(item.keys[0])) bindRow(row, `key:${item.keys[0]}`, item.what);
        grid.appendChild(row);
      }
      block.appendChild(grid);
      if (g.note) block.appendChild(el('div', 'hk-sub hk-note', macKeys(g.note)));
      root.appendChild(block);
    }
  }

  function capture(e: KeyboardEvent): boolean {
    if (e.repeat) return true;
    if (e.key === 'Tab') { capturing = false; setStatus(HINT); draw(); return false; }
    if (e.key === 'Escape') { capturing = false; setStatus(HINT); draw(); refocus(); return true; }
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
    if (plain && (e.code === 'Backspace' || e.code === 'Delete')) {
      capturing = false;
      setStatus('У новой страницы больше нет сочетания');
      opts.save({ newPageKey: null });
      draw();
      refocus();
      return true;
    }
    const combo = comboFromEvent(e);
    if (!combo) return true; // пока нажат только модификатор
    const problem = newPageKeyProblem(combo, state.settings.pageKeyMod);
    if (problem) { setStatus(problem, true); return true; }
    capturing = false;
    setStatus(`Новая страница — ${comboLabel(combo)}`);
    opts.save({ newPageKey: combo });
    draw();
    refocus();
    return true;
  }

  function refocus(): void {
    root.querySelector<HTMLElement>('.hk-capture')?.focus();
  }

  draw();

  return {
    onKey(e) {
      return capturing ? capture(e) : false;
    },
    dispose() {
      capturing = false;
    },
  };
}
