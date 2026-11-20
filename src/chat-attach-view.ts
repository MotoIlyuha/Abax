// Вложение сообщения чата в ленте (SPEC_CHAT §7, получатель):
//  • картинка — в пузыре (скруглённая, до IMAGE_BOX×IMAGE_BOX по пропорциям, ленивое декодирование, alt); щелчок —
//    просмотр поверх доски (src/chat-lightbox.ts) с «Вставить на доску» (только если можно править страницу);
//  • объекты доски — карточка: превью на белом с волосяной рамкой, «N объектов · «Страница»», «Показать» (перейти на
//    страницу, кадр по объектам, что ещё есть, и вспышка; нет ни одного — «Объекты уже удалены») и «Вставить копию»
//    (есть копии и можно править текущую страницу: каждый элемент — через sanitizeElement, задания и негодные
//    отброшены, insertCopies в центр видимой области → pushHistory; патч проверяет хаб как обычно);
//  • gone — «Вложение больше недоступно», hidden — «Объекты со страницы, которая вам недоступна».
// Действия доски (право правки, вставка картинки, переход на страницу) передаёт app.ts (setChatAttachActions) —
// без циклических зависимостей. Название страницы приходит от участника — только textContent; картинки — только
// img.src после проверки формы data URL (isChatImageUrl); SVG — константы каталога иконок.

import type { Element } from './types';
import { NOTICE_ICONS } from './icons';
import { isChatImageUrl, type ChatBoardAtt, type ChatMessage } from './room-chat';
import { objectsLabel } from './format';
import { sanitizeElement } from './file';
import { aabbUnion, elementAABB } from './geom';
import { insertCopies, state, update } from './state';
import { animateCameraTo, viewportSize } from './camera-anim';
import { computeFocusCamera } from './router';
import { FOCUS_FLASH_MS } from './board-url';
import { pushNotice } from './notify-center';
import { openChatLightbox } from './chat-lightbox';

export { objectsLabel };

/** Наибольшая сторона картинки в ленте, px. */
export const IMAGE_BOX = 240;
/** Рамка превью объектов в карточке. */
export const BOARD_BOX = { w: 240, h: 160 };

export const GONE_TEXT = 'Вложение больше недоступно';
export const HIDDEN_TEXT = 'Объекты со страницы, которая вам недоступна';
export const OBJECTS_GONE = 'Объекты уже удалены';
export const COPY_VIEW_ONLY = 'Только просмотр: копии объектов не приложены';
export const COPY_NO_EDIT = 'Нет права править эту страницу';
export const BAD_IMAGE_TEXT = 'Не удалось показать вложение';

export interface ChatAttachActions {
  /** Можно менять содержимое текущей страницы. */
  canEdit(): boolean;
  /** Вставить картинку в центр видимой области (тот же путь, что вставка изображения; pushHistory внутри). */
  insertImage(src: string): void;
  /** Перейти на страницу; true — теперь открыта она (false — страницы нет или переход невозможен). */
  goToPage(pageId: string): Promise<boolean>;
}

let actions: ChatAttachActions | null = null;
export function setChatAttachActions(a: ChatAttachActions | null): void {
  actions = a;
}

/** Подпись вложения одной строкой. */
export function attachmentLabel(m: Pick<ChatMessage, 'att'>): string {
  const a = m.att;
  if (!a) return '';
  if (a.kind === 'image') return 'Изображение';
  if (a.kind === 'board') return `${objectsLabel(a.count)} · «${a.pageName}»`;
  if (a.kind === 'gone') return GONE_TEXT;
  return HIDDEN_TEXT;
}

/** Размер, вписанный в box по пропорциям (не больше исходного). */
export function fitBox(w: number, h: number, bw: number, bh: number): { w: number; h: number } {
  const k = Math.min(1, bw / Math.max(1, w), bh / Math.max(1, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

// ----- Копии объектов -----

/** Элементы для «Вставить копию»: каждый через sanitizeElement; задания и негодные отброшены, поля by нет. */
export function boardCopyElements(att: Pick<ChatBoardAtt, 'elements'>): Element[] {
  const out: Element[] = [];
  for (const raw of att.elements ?? []) {
    const el = sanitizeElement(raw);
    if (!el || el.type === 'task') continue;
    const { by: _by, ...rest } = el as Element & { by?: unknown };
    out.push(rest as Element);
  }
  return out;
}

/** Почему «Вставить копию» недоступна; null — можно. */
export function copyBlock(att: Pick<ChatBoardAtt, 'elements'>): string | null {
  if (boardCopyElements(att).length === 0) return COPY_VIEW_ONLY;
  if (!actions?.canEdit()) return COPY_NO_EDIT;
  return null;
}

/** Вставить копии в центр видимой области текущей страницы; false — нельзя или нечего. */
export function insertBoardCopy(att: Pick<ChatBoardAtt, 'elements'>): boolean {
  if (copyBlock(att)) return false;
  const els = boardCopyElements(att);
  const bb = els.map(elementAABB).reduce(aabbUnion);
  const { w, h } = viewportSize();
  const cam = state.camera;
  const cx = cam.x + w / (2 * cam.zoom);
  const cy = cam.y + h / (2 * cam.zoom);
  insertCopies(els, cx - (bb.x0 + bb.x1) / 2, cy - (bb.y0 + bb.y1) / 2);
  return true;
}

/** Перейти на страницу проекта (с переходом и проверкой прав, как в приложении); true — уже на ней. */
export async function goToBoardPage(pageId: string): Promise<boolean> {
  return state.pageId === pageId || (await actions?.goToPage(pageId)) === true;
}

/** «Показать»: страница, кадр по объектам, что ещё есть, и вспышка; false — объектов уже нет. */
export async function showBoardObjects(att: Pick<ChatBoardAtt, 'pageId' | 'ids'>): Promise<boolean> {
  const onPage = state.pageId === att.pageId || (await actions?.goToPage(att.pageId)) === true;
  const want = new Set(att.ids);
  const found = onPage && state.pageId === att.pageId ? state.board.elements.filter(e => want.has(e.id)) : [];
  const { w, h } = viewportSize();
  const cam = computeFocusCamera(found, w, h);
  if (!cam) {
    pushNotice({ title: OBJECTS_GONE, icon: 'board', quiet: true });
    return false;
  }
  animateCameraTo(cam.x + w / (2 * cam.zoom), cam.y + h / (2 * cam.zoom), cam.zoom);
  state.flashes.push({ ids: found.map(e => e.id), t: performance.now(), ms: FOCUS_FLASH_MS });
  update();
  return true;
}

// ----- Отрисовка -----

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/** Плашка без превью: gone, hidden или негодные данные картинки. */
function plaque(kind: string, icon: string, text: string): HTMLElement {
  const box = el('div', `cf-att cf-att-${kind}`);
  const i = el('span', 'cf-att-icon');
  i.setAttribute('aria-hidden', 'true');
  i.innerHTML = icon; // константа каталога иконок
  box.append(i, el('span', 'cf-att-text', text));
  return box;
}

function imageNode(a: { src: string; w: number; h: number }): HTMLElement {
  if (!isChatImageUrl(a.src)) return plaque('gone', NOTICE_ICONS.image, BAD_IMAGE_TEXT);
  const size = fitBox(a.w, a.h, IMAGE_BOX, IMAGE_BOX);
  const btn = el('button', 'cf-att-image');
  btn.type = 'button';
  btn.title = 'Открыть изображение';
  btn.setAttribute('aria-label', `Открыть изображение ${a.w}×${a.h}`);
  btn.style.width = `${size.w}px`;
  btn.style.height = `${size.h}px`;
  const img = el('img', 'cf-att-img');
  img.alt = `Изображение ${a.w}×${a.h}`;
  img.loading = 'lazy';
  img.decoding = 'async';
  img.width = size.w;
  img.height = size.h;
  img.src = a.src;
  btn.append(img);
  btn.addEventListener('click', () => {
    openChatLightbox({
      src: a.src, w: a.w, h: a.h, alt: img.alt, from: img,
      canInsert: () => actions?.canEdit() === true,
      insert: () => actions?.insertImage(a.src),
    });
  });
  return btn;
}

function boardNode(a: ChatBoardAtt): HTMLElement {
  const card = el('div', 'cf-att-board');
  const frame = el('div', 'cf-att-preview');
  const size = fitBox(a.w, a.h, BOARD_BOX.w, BOARD_BOX.h);
  if (isChatImageUrl(a.preview)) {
    const img = el('img', 'cf-att-img');
    img.alt = `Превью: ${objectsLabel(a.count)}`;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.width = size.w;
    img.height = size.h;
    img.src = a.preview;
    frame.append(img);
  } else {
    const i = el('span', 'cf-att-icon');
    i.setAttribute('aria-hidden', 'true');
    i.innerHTML = NOTICE_ICONS.board; // константа каталога иконок
    frame.append(i);
  }
  const label = el('div', 'cf-att-label', attachmentLabel({ att: a }));
  label.title = label.textContent ?? '';
  const row = el('div', 'cf-att-actions');
  const show = el('button', 'cf-att-btn cf-att-show', 'Показать');
  show.type = 'button';
  show.title = 'Перейти к объектам на доске';
  const copy = el('button', 'cf-att-btn cf-att-copy', 'Вставить копию');
  copy.type = 'button';
  row.append(show, copy);
  card.append(frame, label, row);

  const sync = () => {
    const block = copyBlock(a);
    copy.setAttribute('aria-disabled', String(!!block));
    copy.classList.toggle('off', !!block);
    copy.title = block ?? 'Вставить копию объектов в центр видимой области';
  };
  sync();
  card.addEventListener('pointerenter', sync);
  card.addEventListener('focusin', sync);
  show.addEventListener('click', () => { void showBoardObjects(a); });
  copy.addEventListener('click', () => { sync(); insertBoardCopy(a); });
  return card;
}

/** Вложение сообщения или null, если вложения нет. */
export function renderAttachment(m: Pick<ChatMessage, 'att'>): HTMLElement | null {
  const a = m.att;
  if (!a) return null;
  if (a.kind === 'image') return imageNode(a);
  if (a.kind === 'board') return boardNode(a);
  if (a.kind === 'gone') return plaque('gone', a.was === 'image' ? NOTICE_ICONS.image : NOTICE_ICONS.board, GONE_TEXT);
  return plaque('hidden', NOTICE_ICONS.hidden, HIDDEN_TEXT);
}
