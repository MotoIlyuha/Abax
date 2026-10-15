import type { Element, GridMode, ImageEl, NoteEl, TextEl, ToolId } from './types';
import {
  state, update, onChange, undo, redo, canUndo, canRedo, setTool, setGrid, setStyleColor,
  setStyleWidth, addElement, replaceElements, pushHistory, loadBoard, createBoard, boardMeta, uid,
} from './state';
import { storage, doskaApi } from './storage';
import { renderScene, contentBBox } from './renderer';
import { NOTE_W, NOTE_H, NOTE_PAD, NOTE_FONT, TEXT_SIZE } from './geom';
import * as pdfjsLib from 'pdfjs-dist';
// ?worker&inline: воркер инлайнится в бандл и работает из file:// (Electron)
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker&inline';

pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker();

const svg = (paths: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const ICONS = {
  sidebar: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M9 5v14"/>'),
  undo: svg('<path d="M4 10h9a5 5 0 0 1 0 10h-3"/><path d="M8 6l-4 4 4 4"/>'),
  redo: svg('<path d="M20 10h-9a5 5 0 0 0 0 10h3"/><path d="M16 6l4 4-4 4"/>'),
  fit: svg('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>'),
  export: svg('<path d="M12 3v12"/><path d="M8 11l4 4 4-4"/><path d="M4 19h16"/>'),
  pdf: svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h4"/>'),
  del: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
};

const TOOLS: { id: ToolId; code: string; title: string; icon: string }[] = [
  { id: 'select', code: 'V', title: 'Выделение и перемещение', icon: svg('<path d="M5 3l15 8-6.4 1.7L11 20z"/>') },
  { id: 'pen', code: 'P', title: 'Перо', icon: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>') },
  { id: 'highlighter', code: 'M', title: 'Маркер', icon: svg('<path d="M9 11l-6 6v3h3l6-6"/><path d="M17.5 2.5l4 4L11 17l-4-4z"/>') },
  { id: 'eraser', code: 'E', title: 'Ластик', icon: svg('<path d="M20 20H8.5L3.6 15.1a2 2 0 0 1 0-2.8l8.6-8.6a2 2 0 0 1 2.8 0l6 6a2 2 0 0 1 0 2.8L13.5 19"/><path d="M7 10.5l6.5 6.5"/>') },
  { id: 'text', code: 'T', title: 'Текст', icon: svg('<path d="M5 7V5h14v2"/><path d="M12 5v14"/><path d="M9 19h6"/>') },
  { id: 'note', code: 'N', title: 'Стикер', icon: svg('<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 9.5h8"/><path d="M8 13h5"/>') },
  { id: 'rect', code: 'R', title: 'Прямоугольник', icon: svg('<rect x="4" y="6" width="16" height="12" rx="1.5"/>') },
  { id: 'ellipse', code: 'O', title: 'Эллипс', icon: svg('<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>') },
  { id: 'line', code: 'L', title: 'Линия', icon: svg('<path d="M5 19L19 5"/>') },
  { id: 'arrow', code: 'A', title: 'Стрелка', icon: svg('<path d="M5 19L18 6"/><path d="M12 6h6v6"/>') },
  { id: 'pan', code: 'H', title: 'Панорама', icon: svg('<path d="M12 3v18M3 12h18"/><path d="M9.5 5.5L12 3l2.5 2.5M9.5 18.5L12 21l2.5-2.5M5.5 9.5L3 12l2.5 2.5M18.5 9.5L21 12l-2.5 2.5"/>') },
  { id: 'laser', code: 'I', title: 'Лазерная указка', icon: svg('<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/>') },
];

const PALETTE = ['#1f2329', '#e03131', '#1971c2', '#2f9e44', '#f08c00', '#9c36b5'];
const WIDTHS = [2, 4, 8];
const NOTE_COLOR = '#ffe066';

let canvas: HTMLCanvasElement;
let saveTimer = 0;
let lastBoardsKey = '';

// ----- Редактор текста/стикеров -----

interface Editing {
  el: TextEl | NoteEl | null;
  at: { x: number; y: number } | null;
  target: 'text' | 'note';
  ta: HTMLTextAreaElement;
}
let editing: Editing | null = null;

export function beginTextEdit(opts: { el?: TextEl | NoteEl; at?: { x: number; y: number }; target?: 'text' | 'note' }): void {
  closeEditor(true);
  const el = opts.el ?? null;
  const target: 'text' | 'note' = el ? (el.type === 'note' ? 'note' : 'text') : (opts.target ?? 'text');
  const ta = document.createElement('textarea');
  ta.rows = 1;
  ta.spellcheck = false;
  if (target === 'note') ta.className = 'note-edit';
  if (el) ta.value = el.text;
  document.getElementById('overlay')!.appendChild(ta);
  editing = { el, at: opts.at ?? null, target, ta };
  positionEditor();
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
  ta.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); closeEditor(false); }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); closeEditor(true); }
  });
  ta.addEventListener('input', () => positionEditor());
  ta.addEventListener('blur', () => closeEditor(true));
}

function positionEditor(): void {
  const e = editing;
  if (!e) return;
  const cam = state.camera;
  const z = cam.zoom;
  const ta = e.ta;
  if (e.el && e.el.type === 'note') {
    const n = e.el as NoteEl;
    ta.style.left = `${(n.x + NOTE_PAD - cam.x) * z}px`;
    ta.style.top = `${(n.y + NOTE_PAD - cam.y) * z}px`;
    ta.style.width = `${(n.w - NOTE_PAD * 2) * z}px`;
    ta.style.fontSize = `${NOTE_FONT * z}px`;
  } else {
    const x = e.el ? e.el.x : e.at!.x;
    const y = e.el ? e.el.y : e.at!.y;
    const size = e.el && e.el.type === 'text' ? (e.el as TextEl).size : TEXT_SIZE;
    ta.style.left = `${(x - cam.x) * z}px`;
    ta.style.top = `${(y - cam.y) * z}px`;
    ta.style.fontSize = `${size * z}px`;
    // автоширина по содержимому
    ta.style.width = '10px';
    ta.style.width = `${Math.max(60, ta.scrollWidth + 12)}px`;
  }
  ta.style.height = 'auto';
  ta.style.height = `${ta.scrollHeight + 2}px`;
}

export function closeEditor(commit: boolean): void {
  const e = editing;
  if (!e) return;
  editing = null;
  const text = e.ta.value.replace(/[ \t]+$/gm, '').replace(/\s+$/, '');
  e.ta.remove();
  if (!commit || text === '') {
    if (commit && e.el) {
      // очистили текст существующего элемента — удаляем его
      pushHistory(state.board.elements);
      replaceElements(state.board.elements.filter(x => x.id !== e.el!.id));
    } else {
      update();
    }
    return;
  }
  if (e.el) {
    pushHistory(state.board.elements);
    const el = e.el;
    replaceElements(state.board.elements.map(x => (x.id === el.id ? ({ ...el, text } as Element) : x)));
  } else if (e.target === 'text') {
    addElement({ id: uid(), type: 'text', x: e.at!.x, y: e.at!.y, text, size: TEXT_SIZE, color: state.style.color });
  } else {
    addElement({ id: uid(), type: 'note', x: e.at!.x - NOTE_W / 2, y: e.at!.y - NOTE_H / 2, w: NOTE_W, h: NOTE_H, text, color: NOTE_COLOR });
  }
}

// ----- Экспорт PNG -----

export async function exportPng(): Promise<void> {
  const els = state.selection.size
    ? state.board.elements.filter(e => state.selection.has(e.id))
    : state.board.elements;
  if (els.length === 0) {
    alert('Доска пуста — нечего экспортировать');
    return;
  }
  const bb = contentBBox(els);
  const pad = 32;
  const bw = bb.w + pad * 2;
  const bh = bb.h + pad * 2;
  const scale = Math.min(2, 8000 / Math.max(bw, bh));
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(bw * scale);
  cv.height = Math.ceil(bh * scale);
  const c = cv.getContext('2d');
  if (!c) return;
  renderScene(c, els, { x: bb.x0 - pad, y: bb.y0 - pad, zoom: 1 }, bw, bh, scale, 'none');
  const dataUrl = cv.toDataURL('image/png');
  const name = `${state.board.name.trim() || 'doska'}.png`;
  if (doskaApi) {
    await doskaApi.exportPng(dataUrl, name);
  } else {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = name;
    a.click();
  }
}

// ----- Импорт PDF -----

function pickPdfViaInput(): Promise<string | null> {
  const { promise, resolve } = Promise.withResolvers<string | null>();
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'application/pdf';
  inp.onchange = () => {
    const f = inp.files?.[0];
    if (!f) { resolve(null); return; }
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => resolve(null);
    fr.readAsDataURL(f);
  };
  inp.click();
  return promise;
}

const PDF_PAGE_W = 900; // юниты сцены
const PDF_PAGE_GAP = 48;
const PDF_MAX_PAGES = 30;

/** Импортирует PDF: каждая страница — картинка-фон на доске. */
export async function importPdf(): Promise<void> {
  const dataUrl = doskaApi?.pickPdf ? await doskaApi.pickPdf() : await pickPdfViaInput();
  if (dataUrl) await importPdfFromDataUrl(dataUrl);
}

/** Рендерит страницы PDF в картинки и добавляет их на доску. */
export async function importPdfFromDataUrl(dataUrl: string): Promise<void> {
  try {
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const bin = atob(base64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const pdf = await pdfjsLib.getDocument({ data: u8 }).promise;
    const x = state.camera.x + 40;
    let y = state.camera.y + 40;
    const imgs: ImageEl[] = [];
    const pages = Math.min(pdf.numPages, PDF_MAX_PAGES);
    for (let p = 1; p <= pages; p++) {
      const page = await pdf.getPage(p);
      const vp0 = page.getViewport({ scale: 1 });
      const scale = PDF_PAGE_W / vp0.width;
      const vp = page.getViewport({ scale: scale * 2 }); // 2x для чёткости
      const cv = document.createElement('canvas');
      cv.width = Math.ceil(vp.width);
      cv.height = Math.ceil(vp.height);
      const c2 = cv.getContext('2d')!;
      c2.fillStyle = '#ffffff';
      c2.fillRect(0, 0, cv.width, cv.height);
      await page.render({ canvasContext: c2, viewport: vp }).promise;
      const h = vp0.height * scale;
      imgs.push({ id: uid(), type: 'image', src: cv.toDataURL('image/jpeg', 0.9), x, y, w: PDF_PAGE_W, h });
      y += h + PDF_PAGE_GAP;
    }
    pushHistory(state.board.elements);
    replaceElements([...state.board.elements, ...imgs]);
    fitContent();
  } catch (err) {
    alert('Не удалось открыть PDF: ' + (err instanceof Error ? err.message : String(err)));
  }
}

// ----- Камера -----

export function fitContent(): void {
  const r = canvas.getBoundingClientRect();
  const els = state.board.elements;
  if (els.length === 0) {
    state.camera = { x: -r.width / 2, y: -r.height / 2, zoom: 1 };
    update();
    return;
  }
  const bb = contentBBox(els);
  const zoom = Math.max(0.05, Math.min(1.5, Math.min(r.width / (bb.w + 160), r.height / (bb.h + 160))));
  state.camera = {
    zoom,
    x: bb.x0 + bb.w / 2 - r.width / (2 * zoom),
    y: bb.y0 + bb.h / 2 - r.height / (2 * zoom),
  };
  update();
}

// ----- Сохранение и доски -----

export async function saveNow(): Promise<void> {
  clearTimeout(saveTimer);
  if (!state.dirty) return;
  state.dirty = false;
  await storage.save({ ...state.board });
  const meta = boardMeta(state.board);
  state.boards = [meta, ...state.boards.filter(m => m.id !== meta.id)];
  localStorage.setItem('doska.last', meta.id);
  renderBoards();
}

function scheduleSave(): void {
  if (!state.dirty) return;
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => { void saveNow(); }, 600);
}

async function switchBoard(id: string): Promise<void> {
  if (id === state.board.id) return;
  await saveNow();
  const b = await storage.load(id);
  if (!b) return;
  loadBoard(b, state.boards);
  localStorage.setItem('doska.last', id);
  refresh();
  fitContent();
}

async function newBoard(): Promise<void> {
  await saveNow();
  const b = createBoard(`Доска ${state.boards.length + 1}`);
  await storage.save(b);
  state.boards = [boardMeta(b), ...state.boards];
  loadBoard(b, state.boards);
  refresh();
  fitContent();
}

async function deleteBoard(id: string): Promise<void> {
  const meta = state.boards.find(m => m.id === id);
  if (!meta || !confirm(`Удалить доску «${meta.name}»? Действие необратимо.`)) return;
  await storage.remove(id);
  state.boards = state.boards.filter(m => m.id !== id);
  if (state.board.id === id) {
    if (state.boards.length > 0) {
      await switchBoard(state.boards[0].id);
    } else {
      const b = createBoard('Доска 1');
      await storage.save(b);
      state.boards = [boardMeta(b)];
      loadBoard(b, state.boards);
      fitContent();
    }
  }
  renderBoards();
}

async function renameBoard(id: string, name: string): Promise<void> {
  if (id === state.board.id) {
    state.board.name = name;
    update(true);
    await saveNow();
  } else {
    const b = await storage.load(id);
    if (b) {
      b.name = name;
      await storage.save(b);
      state.boards = state.boards.map(m => (m.id === id ? { ...m, name } : m));
      renderBoards();
    }
  }
}

function startRename(item: HTMLElement, id: string, oldName: string): void {
  const nameEl = item.querySelector('.name')!;
  const input = document.createElement('input');
  input.value = oldName;
  input.spellcheck = false;
  nameEl.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const commit = () => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    if (v && v !== oldName) void renameBoard(id, v);
    else renderBoards();
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') { done = true; renderBoards(); }
  });
}

// ----- DOM -----

function buildToolbar(): void {
  const tb = document.getElementById('toolbar')!;
  const tools = document.createElement('div');
  tools.style.display = 'flex';
  tools.style.flexDirection = 'column';
  tools.style.gap = '2px';
  for (const t of TOOLS) {
    const b = document.createElement('button');
    b.className = 'tool';
    b.dataset.tool = t.id;
    b.title = `${t.title} (${t.code})`;
    b.innerHTML = t.icon;
    b.addEventListener('click', () => setTool(t.id));
    tools.appendChild(b);
  }
  tb.appendChild(tools);
  tb.appendChild(makeVsep());

  const swatches = document.createElement('div');
  swatches.className = 'swatches';
  for (const c of PALETTE) {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.dataset.c = c;
    b.style.background = c;
    b.title = c;
    b.addEventListener('click', () => setStyleColor(c));
    swatches.appendChild(b);
  }
  const custom = document.createElement('button');
  custom.className = 'swatch custom';
  custom.title = 'Свой цвет';
  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.style.display = 'none';
  custom.addEventListener('click', () => colorInput.click());
  colorInput.addEventListener('input', () => setStyleColor(colorInput.value));
  swatches.appendChild(custom);
  swatches.appendChild(colorInput);
  tb.appendChild(swatches);
  tb.appendChild(makeVsep());

  const widths = document.createElement('div');
  widths.className = 'widths';
  for (const w of WIDTHS) {
    const b = document.createElement('button');
    b.className = 'width-opt';
    b.dataset.w = String(w);
    b.title = `Толщина ${w}`;
    b.innerHTML = '<i></i>';
    b.addEventListener('click', () => setStyleWidth(w));
    widths.appendChild(b);
  }
  tb.appendChild(widths);
}

function makeVsep(): HTMLElement {
  const s = document.createElement('div');
  s.className = 'vsep';
  return s;
}

function wireTopbar(): void {
  document.getElementById('btn-sidebar')!.innerHTML = ICONS.sidebar;
  document.getElementById('btn-new-board')!.addEventListener('click', () => { void newBoard(); });
  document.getElementById('btn-undo')!.innerHTML = ICONS.undo;
  document.getElementById('btn-redo')!.innerHTML = ICONS.redo;
  document.getElementById('btn-fit')!.innerHTML = ICONS.fit;
  document.getElementById('btn-export')!.innerHTML = ICONS.export;
  document.getElementById('btn-import')!.innerHTML = ICONS.pdf;

  document.getElementById('btn-sidebar')!.addEventListener('click', toggleSidebar);
  document.getElementById('btn-undo')!.addEventListener('click', () => undo());
  document.getElementById('btn-redo')!.addEventListener('click', () => redo());
  document.getElementById('btn-fit')!.addEventListener('click', fitContent);
  document.getElementById('btn-export')!.addEventListener('click', () => { void exportPng(); });
  document.getElementById('btn-import')!.addEventListener('click', () => { void importPdf(); });

  const nameInput = document.getElementById('board-name') as HTMLInputElement;
  nameInput.addEventListener('change', () => {
    const v = nameInput.value.trim();
    if (v && v !== state.board.name) {
      state.board.name = v;
      update(true);
      void saveNow();
    }
  });

  const gridSelect = document.getElementById('grid-mode') as HTMLSelectElement;
  gridSelect.addEventListener('change', () => setGrid(gridSelect.value as GridMode));
}

export function toggleSidebar(): void {
  document.getElementById('sidebar')!.classList.toggle('hidden');
}

function renderBoards(): void {
  const list = document.getElementById('boards-list')!;
  list.textContent = '';
  for (const m of state.boards) {
    const item = document.createElement('div');
    item.className = `board-item${m.id === state.board.id ? ' active' : ''}`;
    item.dataset.id = m.id;
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = m.name;
    name.title = 'Двойной клик — переименовать';
    const date = document.createElement('span');
    date.className = 'date';
    date.textContent = new Date(m.updatedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const del = document.createElement('button');
    del.className = 'del';
    del.title = 'Удалить доску';
    del.innerHTML = ICONS.del;
    item.append(name, date, del);
    item.addEventListener('click', e => {
      if ((e.target as HTMLElement).closest('.del')) return;
      void switchBoard(m.id);
    });
    del.addEventListener('click', e => {
      e.stopPropagation();
      void deleteBoard(m.id);
    });
    name.addEventListener('dblclick', () => startRename(item, m.id, m.name));
    list.appendChild(item);
  }
}

function refresh(): void {
  const tb = document.getElementById('toolbar')!;
  for (const b of tb.querySelectorAll<HTMLButtonElement>('.tool')) {
    b.classList.toggle('active', b.dataset.tool === state.tool);
  }
  const customActive = !PALETTE.includes(state.style.color);
  for (const b of tb.querySelectorAll<HTMLButtonElement>('.swatch')) {
    const isCustom = b.classList.contains('custom');
    b.classList.toggle('active', isCustom ? customActive : b.dataset.c === state.style.color);
  }
  for (const b of tb.querySelectorAll<HTMLButtonElement>('.width-opt')) {
    b.classList.toggle('active', Number(b.dataset.w) === state.style.width);
  }
  (document.getElementById('btn-undo') as HTMLButtonElement).disabled = !canUndo();
  (document.getElementById('btn-redo') as HTMLButtonElement).disabled = !canRedo();
  document.getElementById('zoom-label')!.textContent = `${Math.round(state.camera.zoom * 100)}%`;
  const gridSelect = document.getElementById('grid-mode') as HTMLSelectElement;
  if (gridSelect.value !== state.grid) gridSelect.value = state.grid;
  const nameInput = document.getElementById('board-name') as HTMLInputElement;
  if (document.activeElement !== nameInput && nameInput.value !== state.board.name) {
    nameInput.value = state.board.name;
  }
  const key = `${state.board.id}|${state.boards.map(m => `${m.id}:${m.updatedAt}:${m.name}`).join('|')}`;
  if (key !== lastBoardsKey) {
    lastBoardsKey = key;
    renderBoards();
  }
}

export function initApp(c: HTMLCanvasElement): void {
  canvas = c;
  buildToolbar();
  wireTopbar();
  refresh();
  onChange(() => {
    refresh();
    scheduleSave();
    if (editing) positionEditor();
  });
}
