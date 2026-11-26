export interface TaskIllustration {
  src: string;
  width: number;
  height: number;
  alt: string;
}

export const MAX_TASK_ILLUSTRATIONS = 4;
export const MAX_TASK_ILLUSTRATION_BYTES = 192 * 1024;
export const TASK_ILLUSTRATION_DATA = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/;

export function isTaskIllustration(value: unknown): value is TaskIllustration {
  if (!value || typeof value !== 'object') return false;
  const { src, width, height, alt } = value as TaskIllustration;
  return typeof src === 'string' && src.length <= MAX_TASK_ILLUSTRATION_BYTES * 4 / 3 + 32
    && TASK_ILLUSTRATION_DATA.test(src)
    && [width, height].every(n => Number.isInteger(n) && n > 0 && n <= 2048)
    && typeof alt === 'string' && alt.length <= 240;
}

export function isTaskIllustrations(value: unknown): value is TaskIllustration[] {
  return Array.isArray(value) && value.length <= MAX_TASK_ILLUSTRATIONS && value.every(isTaskIllustration);
}
