// Картинка для чата (SPEC_CHAT §7): файл или Blob → data URL не длиннее CHAT_IMAGE_MAX. Уменьшаем до
// CHAT_IMAGE_SIDE по длинной стороне; без прозрачности — JPEG 0.82, с прозрачностью — WebP (если браузер умеет
// его кодировать), иначе PNG. Не влезло в лимит — ступенчато ниже качество, затем меньше размер.
// Подбор шагов (chatImageSteps) — чистая функция для тестов; кодирование — canvas.

import { CHAT_IMAGE_MAX } from './room-chat';

/** Длинная сторона картинки в чате, px. */
export const CHAT_IMAGE_SIDE = 1280;
/** Качество JPEG/WebP по умолчанию и ступени понижения. */
export const CHAT_IMAGE_QUALITIES: readonly number[] = [0.82, 0.7, 0.56];
/** Доли размера при повторных попытках. */
export const CHAT_IMAGE_SCALES: readonly number[] = [1, 0.75, 0.55, 0.4];

export const IMAGE_TOO_BIG = 'Картинка слишком большая';
export const IMAGE_UNREADABLE = 'Не удалось прочитать картинку';

export type ChatImageType = 'image/jpeg' | 'image/webp' | 'image/png';

export interface ChatImageStep { w: number; h: number; type: ChatImageType; quality?: number }

export interface ChatImage { src: string; w: number; h: number }

/** Ошибка подготовки картинки: message — текст для пользователя. */
export class ChatImageError extends Error {}

/** Размер, вписанный в max по длинной стороне (меньшие — без изменений), целые ≥ 1. */
export function fitSide(w: number, h: number, max: number): { w: number; h: number } {
  const k = Math.min(1, max / Math.max(w, h, 1));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/**
 * Попытки кодирования по порядку: для каждой доли размера — все ступени качества (PNG — без качества).
 * Повторяющиеся размеры (маленькая картинка) не дублируются.
 */
export function chatImageSteps(w: number, h: number, alpha: boolean, webp: boolean): ChatImageStep[] {
  const type: ChatImageType = !alpha ? 'image/jpeg' : webp ? 'image/webp' : 'image/png';
  const base = fitSide(w, h, CHAT_IMAGE_SIDE);
  const out: ChatImageStep[] = [];
  const seen = new Set<string>();
  for (const k of CHAT_IMAGE_SCALES) {
    const size = fitSide(base.w * k, base.h * k, Math.max(base.w, base.h));
    const key = `${size.w}x${size.h}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (type === 'image/png') out.push({ ...size, type });
    else for (const quality of CHAT_IMAGE_QUALITIES) out.push({ ...size, type, quality });
  }
  return out;
}

let webpKnown: boolean | null = null;
/** Умеет ли canvas кодировать WebP (Safari до 17 — нет). */
function canEncodeWebp(): boolean {
  if (webpKnown === null) {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      webpKnown = c.toDataURL('image/webp').startsWith('data:image/webp');
    } catch { webpKnown = false; }
  }
  return webpKnown;
}

type Source = { draw: CanvasImageSource; w: number; h: number; close(): void };

async function decode(blob: Blob): Promise<Source> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(blob);
      return { draw: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close() };
    } catch { /* старый браузер или SVG — пробуем через <img> */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return { draw: img, w: img.naturalWidth, h: img.naturalHeight, close: () => undefined };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Есть ли в картинке полупрозрачные пиксели (рисуем уменьшенную копию — быстро и достаточно). */
function hasAlpha(src: Source): boolean {
  const s = fitSide(src.w, src.h, 256);
  const c = document.createElement('canvas');
  c.width = s.w; c.height = s.h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  ctx.drawImage(src.draw, 0, 0, s.w, s.h);
  const data = ctx.getImageData(0, 0, s.w, s.h).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
}

/** Файл → картинка для чата; ошибка — ChatImageError с текстом для пользователя. */
export async function prepareChatImage(blob: Blob): Promise<ChatImage> {
  if (blob.type && !blob.type.startsWith('image/')) throw new ChatImageError(IMAGE_UNREADABLE);
  let src: Source;
  try {
    src = await decode(blob);
  } catch {
    throw new ChatImageError(IMAGE_UNREADABLE);
  }
  try {
    if (!(src.w > 0) || !(src.h > 0)) throw new ChatImageError(IMAGE_UNREADABLE);
    const alpha = blob.type !== 'image/jpeg' && hasAlpha(src);
    const c = document.createElement('canvas');
    for (const st of chatImageSteps(src.w, src.h, alpha, alpha && canEncodeWebp())) {
      c.width = st.w; c.height = st.h;
      const ctx = c.getContext('2d');
      if (!ctx) throw new ChatImageError(IMAGE_UNREADABLE);
      ctx.clearRect(0, 0, st.w, st.h);
      // JPEG без прозрачности: прозрачные края (GIF) — белые, а не чёрные
      if (st.type === 'image/jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, st.w, st.h); }
      ctx.drawImage(src.draw, 0, 0, st.w, st.h);
      const url = c.toDataURL(st.type, st.quality);
      if (!url.startsWith(`data:${st.type};base64,`)) continue;
      if (url.length <= CHAT_IMAGE_MAX) return { src: url, w: st.w, h: st.h };
    }
    throw new ChatImageError(IMAGE_TOO_BIG);
  } finally {
    src.close();
  }
}
