// Вложение сообщения до отправки (SPEC_CHAT §7, «Клиент»): черновик вложения (одно на сообщение), его чип над полем
// ввода и кнопки поля — «Прикрепить изображение» (скрепка, выбор файла), «Прикрепить выделенное» (рамка выделения).
// Картинку также можно вставить в поле из буфера или перетащить на панель ЧУ. Выделенное — превью renderScene
// до BOARD_PREVIEW_SIDE px на белом фоне страницы и копии элементов без заданий и без поля by; копии больше
// CHAT_BOARD_JSON_MAX не отправляются (только просмотр). Без права копирования объекты не прикрепляются — хаб всё равно
// отклонит такое сообщение. Данные картинок — только как img.src после проверки формы data URL.

import type { Element } from './types';
import {
  CHAT_BOARD_IDS_MAX, CHAT_BOARD_JSON_MAX, CHAT_PAGE_NAME_MAX, CHAT_PREVIEW_MAX, isChatImageUrl,
  type ChatBoardAtt, type ChatImageAtt,
} from './room-chat';
import { canCopyCurrentBoard, onChange, onDraft, selectedElements, state } from './state';
import { contentBBox, imagesLoaded, renderScene } from './renderer';
import { ChatImageError, IMAGE_UNREADABLE, prepareChatImage, type ChatImage } from './chat-image';
import { objectsLabel } from './format';
import { NOTICE_ICONS } from './icons';
import type { ChatComposer } from './chat-composer';

/** Длинная сторона превью выделенного, px. */
export const BOARD_PREVIEW_SIDE = 480;

export const ATTACH_IMAGE_TITLE = 'Прикрепить изображение';
export const ATTACH_SELECTION_TITLE = 'Прикрепить выделенное';
export const SELECT_FIRST = 'Выделите объекты на доске';
export const COPY_DENIED = 'Автор запретил копирование';
export const DRAFT_PAGE = 'Объекты черновика не видны участникам';
export const TOO_MANY = `Не больше ${CHAT_BOARD_IDS_MAX} объектов в одном сообщении`;
export const VIEW_ONLY_NOTE = 'только просмотр';
export const TASKS_NOTE = 'задания не копируются';

/** Скрепка — константа кода. */
const CLIP_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 11.5l-8.3 8.3a5 5 0 0 1-7-7l8.6-8.6a3.4 3.4 0 0 1 4.8 4.8l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9"/></svg>';

/** Черновик вложения: само вложение и подпись чипа. */
export interface ChatDraft {
  att: ChatImageAtt | ChatBoardAtt;
  label: string;
  /** Пояснение под подписью: «только просмотр», «задания не копируются». */
  note?: string;
}

let draft: ChatDraft | null = null;
const subs = new Set<(d: ChatDraft | null) => void>();

export function chatDraft(): ChatDraft | null {
  return draft;
}

/** Заменить черновик вложения (null — убрать): одно вложение на сообщение. */
export function setChatDraft(next: ChatDraft | null): void {
  draft = next;
  for (const fn of [...subs]) fn(next);
}

export function onChatDraft(fn: (d: ChatDraft | null) => void): () => void {
  subs.add(fn);
  return () => { subs.delete(fn); };
}

// ----- Картинка -----

export function imageDraft(img: ChatImage): ChatDraft {
  return { att: { kind: 'image', src: img.src, w: img.w, h: img.h }, label: `Изображение · ${img.w}×${img.h}` };
}

/** Файл картинки → черновик; null — готово, строка — текст ошибки для подсказки под полем. */
export async function attachImageFile(file: Blob, prepare = prepareChatImage): Promise<string | null> {
  try {
    setChatDraft(imageDraft(await prepare(file)));
    return null;
  } catch (e) {
    return e instanceof ChatImageError ? e.message : IMAGE_UNREADABLE;
  }
}

// ----- Выделенное -----

/** Почему выделенное нельзя прикрепить (подсказка недоступной кнопки); null — можно. */
export function selectionAttachBlock(): string | null {
  const n = state.selection.size;
  if (n === 0 || state.view !== 'board') return SELECT_FIRST;
  if (!canCopyCurrentBoard()) return COPY_DENIED;
  if (onDraft()) return DRAFT_PAGE;
  if (n > CHAT_BOARD_IDS_MAX) return TOO_MANY;
  return null;
}

/**
 * Копии элементов для вложения: без заданий (ответы не утекают) и без поля by (автора ставит хаб).
 * elements нет — копировать нечего (одни задания) или JSON больше CHAT_BOARD_JSON_MAX (только просмотр).
 */
export function boardCopies(els: readonly Element[]): { elements?: unknown[]; tasks: number } {
  const tasks = els.filter(e => e.type === 'task').length;
  const copies = els.filter(e => e.type !== 'task').map(e => {
    const { by: _by, ...rest } = structuredClone(e) as Element & { by?: unknown };
    return rest;
  });
  if (copies.length === 0 || JSON.stringify(copies).length > CHAT_BOARD_JSON_MAX) return { tasks };
  return { elements: copies, tasks };
}

/** Название страницы для подписи: имя или «Страница N». */
export function pageTitle(pageId: string): string {
  const i = state.project.pages.findIndex(p => p.id === pageId);
  const name = i >= 0 ? state.project.pages[i].name.trim() : '';
  return Array.from(name || `Страница ${i + 1}`).slice(0, CHAT_PAGE_NAME_MAX).join('');
}

/** Подпись и пояснение чипа объектов. */
export function boardDraftLabel(att: Pick<ChatBoardAtt, 'count' | 'pageName' | 'elements'>, tasks: number): { label: string; note?: string } {
  const notes: string[] = [];
  if (!att.elements) notes.push(VIEW_ONLY_NOTE);
  if (tasks > 0) notes.push(TASKS_NOTE);
  return { label: `${objectsLabel(att.count)} · «${att.pageName}»`, ...(notes.length ? { note: notes.join(' · ') } : {}) };
}

/** Превью элементов на белом фоне: PNG, а если он больше лимита — JPEG пониже качеством. */
async function renderPreview(els: Element[]): Promise<{ src: string; w: number; h: number } | null> {
  const bb = contentBBox(els);
  const pad = 12;
  const w = Math.max(1, bb.w + pad * 2);
  const h = Math.max(1, bb.h + pad * 2);
  const k = Math.min(2, BOARD_PREVIEW_SIDE / Math.max(w, h));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(w * k));
  cv.height = Math.max(1, Math.round(h * k));
  const ctx = cv.getContext('2d');
  if (!ctx) return null;
  await imagesLoaded(els);
  renderScene(ctx, els, { x: bb.x0 - pad, y: bb.y0 - pad, zoom: 1 }, w, h, k, 'none');
  for (const [type, q] of [['image/png', undefined], ['image/jpeg', 0.85], ['image/jpeg', 0.65], ['image/jpeg', 0.45]] as const) {
    const src = cv.toDataURL(type, q);
    if (src.length <= CHAT_PREVIEW_MAX && isChatImageUrl(src)) return { src, w: cv.width, h: cv.height };
  }
  return null;
}

/** Выделенное → черновик вложения; строка — почему нельзя. */
export async function attachSelection(): Promise<string | null> {
  const block = selectionAttachBlock();
  if (block) return block;
  const els = selectedElements();
  const pageId = state.pageId;
  const preview = await renderPreview(els).catch(() => null);
  if (!preview) return 'Не удалось подготовить превью';
  const { elements, tasks } = boardCopies(els);
  const att: ChatBoardAtt = {
    kind: 'board', pageId, pageName: pageTitle(pageId), ids: els.map(e => e.id), count: els.length,
    preview: preview.src, w: preview.w, h: preview.h, ...(elements ? { elements } : {}),
  };
  setChatDraft({ att, ...boardDraftLabel(att, tasks) });
  return null;
}

// ----- Чип и кнопки поля ввода -----

/** Чип вложения над полем: миниатюра, подпись, пояснение, «×». */
export function createAttachmentChip(d: ChatDraft, onRemove: () => void): HTMLElement {
  const chip = document.createElement('div');
  chip.className = `cchip cchip-${d.att.kind}`;
  const thumb = document.createElement('span');
  thumb.className = 'cchip-thumb';
  const src = d.att.kind === 'image' ? d.att.src : d.att.preview;
  if (isChatImageUrl(src)) {
    const img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    img.src = src;
    thumb.append(img);
  }
  const text = document.createElement('span');
  text.className = 'cchip-text';
  const label = document.createElement('span');
  label.className = 'cchip-label';
  label.textContent = d.label;
  label.title = d.label;
  text.append(label);
  if (d.note) {
    const note = document.createElement('span');
    note.className = 'cchip-note';
    note.textContent = d.note;
    text.append(note);
  }
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'cchip-remove';
  x.title = 'Убрать вложение';
  x.setAttribute('aria-label', 'Убрать вложение');
  x.textContent = '×';
  x.addEventListener('click', onRemove);
  chip.append(thumb, text, x);
  return chip;
}

function toolButton(cls: string, icon: string, title: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `composer-tool ${cls}`;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.innerHTML = icon; // константа кода
  return b;
}

/** Первая картинка-файл из буфера обмена или перетаскивания. */
export function imageFileFrom(data: DataTransfer | null | undefined): File | null {
  if (!data) return null;
  for (const it of Array.from(data.items ?? [])) {
    if (it.kind === 'file' && it.type.startsWith('image/')) {
      const f = it.getAsFile();
      if (f) return f;
    }
  }
  for (const f of Array.from(data.files ?? [])) if (f.type.startsWith('image/')) return f;
  return null;
}

/** Перетаскивают файлы (а не текст или элементы интерфейса). */
function draggingFiles(e: DragEvent): boolean {
  return !!e.dataTransfer && Array.from(e.dataTransfer.types ?? []).includes('Files');
}

export interface ComposerAttachTools {
  /** Зона перетаскивания картинки (панель ЧУ): подсветка классом np-drop. */
  dropZone(zone: HTMLElement, accept: () => boolean): void;
  dispose(): void;
}

/**
 * Кнопки вложений в слот .composer-tools, вставка картинки в поле (paste), чип черновика над полем.
 * Состояние «Прикрепить выделенное» обновляется по изменениям доски (onChange).
 */
export function attachComposerTools(composer: ChatComposer): ComposerAttachTools {
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = 'image/*';
  file.hidden = true;
  file.className = 'composer-file';
  file.tabIndex = -1;
  file.setAttribute('aria-hidden', 'true');
  const clip = toolButton('composer-attach-image', CLIP_ICON, ATTACH_IMAGE_TITLE);
  const sel = toolButton('composer-attach-selection', NOTICE_ICONS.board, ATTACH_SELECTION_TITLE);
  composer.tools.append(clip, sel, file);

  const fail = (msg: string | null) => { if (msg) composer.setHint(msg); else composer.focus(); };
  const takeFile = (f: Blob) => {
    composer.setHint('');
    void attachImageFile(f).then(fail);
  };

  clip.addEventListener('click', () => file.click());
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    file.value = '';
    if (f) takeFile(f);
  });

  const syncSel = () => {
    const block = selectionAttachBlock();
    // недоступная кнопка остаётся видимой и с подсказкой: aria-disabled, а не disabled (у disabled нет title)
    sel.setAttribute('aria-disabled', String(!!block));
    sel.classList.toggle('off', !!block);
    sel.title = block ?? ATTACH_SELECTION_TITLE;
  };
  sel.addEventListener('click', () => {
    if (selectionAttachBlock()) return;
    composer.setHint('');
    void attachSelection().then(fail);
  });

  composer.input.addEventListener('paste', e => {
    const f = imageFileFrom(e.clipboardData);
    if (!f) return;
    e.preventDefault();
    takeFile(f);
  });

  const renderChip = (d: ChatDraft | null) => {
    composer.setAttachmentChip(d ? createAttachmentChip(d, () => { setChatDraft(null); composer.focus(); }) : null);
  };

  const unsubs = [onChange(syncSel), onChatDraft(renderChip)];
  syncSel();
  renderChip(draft);

  return {
    dropZone(zone, accept) {
      let depth = 0;
      const off = () => { depth = 0; zone.classList.remove('np-drop'); };
      zone.addEventListener('dragenter', e => {
        if (!draggingFiles(e) || !accept()) return;
        e.preventDefault();
        depth++;
        zone.classList.add('np-drop');
      });
      zone.addEventListener('dragover', e => {
        if (!draggingFiles(e) || !accept()) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        zone.classList.add('np-drop');
      });
      zone.addEventListener('dragleave', () => { if (--depth <= 0) off(); });
      zone.addEventListener('drop', e => {
        const on = zone.classList.contains('np-drop');
        off();
        if (!on || !accept()) return;
        e.preventDefault();
        e.stopPropagation();
        const f = imageFileFrom(e.dataTransfer);
        if (f) takeFile(f);
        else composer.setHint(IMAGE_UNREADABLE);
      });
    },
    dispose() { for (const u of unsubs) u(); },
  };
}
