// Раздел «Горячие клавиши» окна «Все настройки»: переход на страницу по номеру,
// новая страница (с предупреждением, если в браузере сочетание занято), клавиши
// инструментов (назначаются в разделе «Панель инструментов») и постоянные сочетания доски.

import type { BoardSettings, PageKeyMod } from './types';
import type { SectionView } from './settings-dialog';
import { state } from './state';
import { TOOL_DEFS, toolbarConfig } from './toolbar';
import {
  DEFAULT_NEW_PAGE_KEY, FIXED_SHORTCUTS, codeLabel, comboFromEvent, comboLabel, currentKeyEnv, modLabel,
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

/** Сочетание клавишами: [Ctrl] [Shift] [N]. */
function keycaps(combo: string): HTMLElement {
  const box = el('span', 'hk-keys');
  const parts = combo.split('+');
  const code = parts.pop()!;
  for (const p of [...parts, codeLabel(code)]) box.appendChild(el('kbd', '', p));
  return box;
}

/** Несколько сочетаний одного действия: [Ctrl] [Y] или [Ctrl] [Shift] [Z]. */
function keycapsAny(combos: string[]): HTMLElement {
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

export function renderHotkeysSettings(host: HTMLElement, opts: HotkeysOptions): SectionView {
  const root = el('div', 'hk');
  host.appendChild(root);
  const env = currentKeyEnv();
  let capturing = false;
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
      setStatus(capturing ? 'Нажмите сочетание с Ctrl или Alt. Backspace — убрать сочетание, Esc — отмена' : HINT);
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
      if (!code) continue;
      const row = el('div', 'hk-row hk-tool');
      row.dataset.tool = def.id;
      const name = el('div', 'hk-what hk-tool-name');
      const icon = el('span', 'hk-icon');
      icon.innerHTML = def.icon;
      name.append(icon, el('span', '', def.title));
      row.append(name, keycaps(code));
      list.appendChild(row);
    }
    if (list.childElementCount === 0) list.appendChild(el('div', 'hk-sub', 'Ни у одного инструмента нет клавиши'));
    tools.appendChild(list);
    tools.appendChild(el('div', 'hk-sub hk-note', 'Клавиша без Ctrl и Alt; у остальных инструментов её можно назначить в «Панели инструментов».'));
    root.appendChild(tools);

    // ----- Постоянные сочетания -----
    for (const g of FIXED_SHORTCUTS) {
      const block = el('section', 'hk-block');
      block.appendChild(el('h3', 'hk-title', g.title));
      const grid = el('div', 'hk-grid');
      for (const item of g.items) {
        const row = el('div', 'hk-row');
        row.append(el('div', 'hk-what', item.what), keycapsAny(item.keys));
        grid.appendChild(row);
      }
      block.appendChild(grid);
      root.appendChild(block);
    }
    root.appendChild(el('div', 'hk-sub hk-note', 'На macOS вместо Ctrl можно нажимать Cmd.'));
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
