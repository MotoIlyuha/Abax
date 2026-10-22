import type { Element } from './types';
import { aabbIntersects, aabbUnion, elementAABB, type AABB } from './geom';
import { deleteSelected, insertCopies, selectedElements, state, uid } from './state';

/** Тип данных Доски в системном буфере обмена: копирование между окнами и проектами. */
export const CLIP_MIME = 'application/x-doska-elements';
/** Сдвиг копии от оригинала в пикселях экрана (вставка и Ctrl+D). */
export const COPY_STEP_PX = 24;

interface Clip {
  /** Метка копирования: по ней системный буфер узнаётся как «наш» и продолжает лесенку вставок. */
  key: string;
  pageId: string;
  elements: Element[];
  /** Сколько раз уже вставлено. */
  pastes: number;
  /** Вырезано: оригинала больше нет, первая вставка — на его место. */
  cut: boolean;
}

let clip: Clip | null = null;

/** Копирует выделенное в буфер Доски и в системный (data); cut — затем удаляет. false — нечего копировать. */
export function copySelection(data?: DataTransfer | null, cut = false): boolean {
  const els = selectedElements();
  if (els.length === 0) return false;
  clip = { key: uid(), pageId: state.pageId, elements: structuredClone(els), pastes: 0, cut };
  data?.setData(CLIP_MIME, JSON.stringify({ key: clip.key, pageId: clip.pageId, elements: clip.elements }));
  if (cut) deleteSelected();
  return true;
}

/** Элементы Доски из системного буфера; скопированные в другом окне становятся текущим буфером. */
function readSystem(data?: DataTransfer | null): Clip | null {
  const raw = data?.getData(CLIP_MIME);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as { key?: string; pageId?: string; elements?: Element[] };
    if (clip && p.key === clip.key) return clip;
    if (!Array.isArray(p.elements) || p.elements.length === 0) return null;
    if (!p.elements.every(e => e && typeof e.type === 'string')) return null;
    clip = { key: p.key || uid(), pageId: p.pageId || '', elements: p.elements, pastes: 0, cut: false };
    return clip;
  } catch {
    return null;
  }
}

/** Вставляет элементы из системного буфера; false — там нет элементов Доски. */
export function pasteFromSystem(data: DataTransfer | null | undefined, view: AABB): boolean {
  const c = readSystem(data);
  if (!c) return false;
  pasteClip(c, view);
  return true;
}

/** Вставляет последнее скопированное в этом окне (системный буфер недоступен или в нём не наше). */
export function pasteFromMemory(view: AABB): boolean {
  if (!clip) return false;
  pasteClip(clip, view);
  return true;
}

/**
 * Копия ложится лесенкой со сдвигом от оригинала; на другой странице и после вырезания
 * первая вставка — на то же место. Если оригинал за пределами экрана — вставляем по центру видимой области.
 */
function pasteClip(c: Clip, view: AABB): void {
  const n = c.pastes + (c.pageId === state.pageId && !c.cut ? 1 : 0);
  c.pastes++;
  const step = (COPY_STEP_PX / state.camera.zoom) * n;
  const bb = c.elements.map(elementAABB).reduce(aabbUnion);
  let dx = step;
  let dy = step;
  if (!aabbIntersects(bb, view)) {
    dx += (view.x0 + view.x1) / 2 - (bb.x0 + bb.x1) / 2;
    dy += (view.y0 + view.y1) / 2 - (bb.y0 + bb.y1) / 2;
  }
  insertCopies(c.elements, dx, dy);
}
