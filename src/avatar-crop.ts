// Окно обрезки фото под круг для аватара: фото двигают мышью или пальцем, масштаб — ползунком, колёсиком
// или клавишами «+» / «−»; в круг попадает то, что видно в нём. Результат — квадрат AVATAR_PHOTO_PX в JPEG
// (круг аватару дают стили), не длиннее MAX_AVATAR_PHOTO. Фото не покидает устройство до сохранения профиля.

import { AVATAR_PHOTO_PX, MAX_AVATAR_PHOTO } from './avatar-value';

/** Сторона области и диаметр круга, px CSS. */
const STAGE = 280;
const CIRCLE = 236;
/** Во сколько раз можно увеличить фото сверх «круг заполнен». */
const MAX_ZOOM = 5;

/** Геометрия обрезки (чистые функции — проверяются юнит-тестами). */
export interface CropView {
  /** Масштаб: px области на px фото. */
  scale: number;
  /** Центр фото в координатах области. */
  cx: number;
  cy: number;
}

/** Масштаб, при котором фото w×h целиком закрывает круг diameter. */
export function coverScale(w: number, h: number, diameter = CIRCLE): number {
  return diameter / Math.max(1, Math.min(w, h));
}

/** Сдвиг и масштаб в допустимых пределах: круг всегда закрыт фото. */
export function clampView(v: CropView, w: number, h: number, stage = STAGE, diameter = CIRCLE): CropView {
  const min = coverScale(w, h, diameter);
  const scale = Math.min(min * MAX_ZOOM, Math.max(min, v.scale));
  const m = (stage - diameter) / 2;
  const hw = (w * scale) / 2, hh = (h * scale) / 2;
  // левый край фото не правее круга, правый — не левее
  const cx = Math.min(m + hw, Math.max(m + diameter - hw, v.cx));
  const cy = Math.min(m + hh, Math.max(m + diameter - hh, v.cy));
  return { scale, cx, cy };
}

/** Масштаб с сохранением точки (px, py) области на месте (колёсико, щипок). */
export function zoomAt(v: CropView, scale: number, px: number, py: number): CropView {
  const k = scale / v.scale;
  return { scale, cx: px + (v.cx - px) * k, cy: py + (v.cy - py) * k };
}

/** Какой квадрат фото (в его пикселях) виден в круге. */
export function cropSource(v: CropView, w: number, h: number, stage = STAGE, diameter = CIRCLE): { sx: number; sy: number; side: number } {
  const m = (stage - diameter) / 2;
  const left = v.cx - (w * v.scale) / 2, top = v.cy - (h * v.scale) / 2;
  return { sx: (m - left) / v.scale, sy: (m - top) / v.scale, side: diameter / v.scale };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

let openNow: (() => void) | null = null;

export function avatarCropOpen(): boolean {
  return openNow !== null;
}

/** Закрыть окно обрезки без сохранения (раздел или окно под ним закрывается). */
export function closeAvatarCrop(): void {
  openNow?.();
}

/** Загрузить файл картинки; null — не картинка или не читается. */
async function loadImage(file: File): Promise<HTMLImageElement | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img.naturalWidth && img.naturalHeight ? img : null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Видимое в круге → JPEG-квадрат; качество снижается, пока не уложится в MAX_AVATAR_PHOTO. */
function exportPhoto(img: HTMLImageElement, v: CropView): string | null {
  const src = cropSource(v, img.naturalWidth, img.naturalHeight);
  const cv = document.createElement('canvas');
  cv.width = cv.height = AVATAR_PHOTO_PX;
  const ctx = cv.getContext('2d');
  if (!ctx) return null;
  // прозрачное (PNG) — на белом: в JPEG прозрачности нет
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, AVATAR_PHOTO_PX, AVATAR_PHOTO_PX);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, src.sx, src.sy, src.side, src.side, 0, 0, AVATAR_PHOTO_PX, AVATAR_PHOTO_PX);
  for (const q of [0.86, 0.72, 0.55, 0.4]) {
    const url = cv.toDataURL('image/jpeg', q);
    if (url.startsWith('data:image/jpeg') && url.length <= MAX_AVATAR_PHOTO) return url;
  }
  return null;
}

/**
 * Открыть окно обрезки для выбранного файла. Результат — фото (data:image/jpeg) или null: отменили,
 * файл не читается (тогда — сообщение).
 */
export async function openAvatarCrop(file: File): Promise<string | null> {
  closeAvatarCrop();
  const loaded = await loadImage(file);
  if (!loaded) { alert('Не удалось прочитать изображение'); return null; }
  const img: HTMLImageElement = loaded;
  const w = img.naturalWidth, h = img.naturalHeight;
  const min = coverScale(w, h);
  let view: CropView = clampView({ scale: min, cx: STAGE / 2, cy: STAGE / 2 }, w, h);

  const root = el('div', 'avatar-crop');
  root.dataset.ownKeys = '';
  const win = el('div', 'ac-window');
  win.setAttribute('role', 'dialog');
  win.setAttribute('aria-modal', 'true');
  win.setAttribute('aria-labelledby', 'ac-title');
  const title = el('h3', 'ac-title', 'Фото профиля');
  title.id = 'ac-title';
  const stage = el('div', 'ac-stage');
  stage.tabIndex = 0;
  stage.title = 'Перетащите фото, чтобы выбрать, что попадёт в круг';
  stage.setAttribute('aria-label', 'Положение фото: стрелки - сдвиг, плюс и минус - масштаб');
  const canvas = el('canvas', 'ac-canvas');
  canvas.setAttribute('aria-hidden', 'true');
  stage.appendChild(canvas);

  const zoomRow = el('div', 'ac-zoom');
  const minus = el('button', 'ac-zoom-btn', '−');
  const plus = el('button', 'ac-zoom-btn', '+');
  minus.type = plus.type = 'button';
  minus.title = 'Уменьшить';
  plus.title = 'Увеличить';
  const range = el('input', 'ac-range');
  range.type = 'range';
  range.min = '0';
  range.max = '1000';
  range.step = '1';
  range.setAttribute('aria-label', 'Масштаб');
  zoomRow.append(minus, range, plus);

  const actions = el('div', 'ac-actions');
  const cancel = el('button', 'ob-btn ac-cancel', 'Отмена');
  const save = el('button', 'ob-btn ob-primary ac-save', 'Сохранить');
  cancel.type = save.type = 'button';
  actions.append(cancel, save);
  win.append(title, stage, zoomRow, actions);
  root.appendChild(win);

  // ползунок — по логарифму масштаба: одинаковый шаг ощущается одинаково и вблизи, и издалека
  const toRange = (s: number) => String(Math.round((Math.log(s / min) / Math.log(MAX_ZOOM)) * 1000));
  const fromRange = (v: number) => min * MAX_ZOOM ** (v / 1000);

  function draw(): void {
    const dpr = window.devicePixelRatio || 1;
    const side = Math.round(STAGE * dpr);
    if (canvas.width !== side) { canvas.width = side; canvas.height = side; }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, STAGE, STAGE);
    const dw = w * view.scale, dh = h * view.scale;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, view.cx - dw / 2, view.cy - dh / 2, dw, dh);
    // затемнение вокруг круга и его рамка
    ctx.beginPath();
    ctx.rect(0, 0, STAGE, STAGE);
    ctx.arc(STAGE / 2, STAGE / 2, CIRCLE / 2, 0, Math.PI * 2, true);
    ctx.fillStyle = 'rgba(15, 18, 24, 0.58)';
    ctx.fill('evenodd');
    ctx.beginPath();
    ctx.arc(STAGE / 2, STAGE / 2, CIRCLE / 2, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 2;
    ctx.stroke();
    range.value = toRange(view.scale);
  }

  const setView = (next: CropView) => { view = clampView(next, w, h); draw(); };
  const zoomTo = (scale: number, px = STAGE / 2, py = STAGE / 2) => {
    const s = Math.min(min * MAX_ZOOM, Math.max(min, scale));
    setView(zoomAt(view, s, px, py));
  };

  // перетаскивание; двумя пальцами — масштаб щипком
  const pts = new Map<number, { x: number; y: number }>();
  let pinch: { d: number; scale: number } | null = null;
  const local = (e: MouseEvent) => {
    const r = stage.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * STAGE) / (r.width || STAGE), y: ((e.clientY - r.top) * STAGE) / (r.height || STAGE) };
  };
  const spread = () => {
    const [a, b] = [...pts.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };
  stage.addEventListener('pointerdown', e => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    stage.focus({ preventScroll: true });
    stage.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, local(e));
    stage.classList.add('dragging');
    if (pts.size === 2) pinch = { d: spread().d, scale: view.scale };
  });
  stage.addEventListener('pointermove', e => {
    const prev = pts.get(e.pointerId);
    if (!prev) return;
    const p = local(e);
    pts.set(e.pointerId, p);
    if (pts.size >= 2 && pinch) {
      const s = spread();
      if (pinch.d > 0) zoomTo(pinch.scale * (s.d / pinch.d), s.x, s.y);
      return;
    }
    setView({ ...view, cx: view.cx + p.x - prev.x, cy: view.cy + p.y - prev.y });
  });
  const up = (e: PointerEvent) => {
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (pts.size === 0) stage.classList.remove('dragging');
  };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);
  stage.addEventListener('wheel', e => {
    e.preventDefault();
    const p = local(e);
    zoomTo(view.scale * Math.exp(-e.deltaY * 0.0015), p.x, p.y);
  }, { passive: false });
  range.addEventListener('input', () => zoomTo(fromRange(Number(range.value))));
  minus.addEventListener('click', () => zoomTo(view.scale / 1.2));
  plus.addEventListener('click', () => zoomTo(view.scale * 1.2));

  return new Promise<string | null>(resolve => {
    let done = false;
    const prevFocus = document.activeElement;
    function finish(result: string | null): void {
      if (done) return;
      done = true;
      openNow = null;
      root.remove();
      if (prevFocus instanceof HTMLElement && prevFocus.isConnected) prevFocus.focus({ preventScroll: true });
      resolve(result);
    }
    openNow = () => finish(null);
    cancel.addEventListener('click', () => finish(null));
    save.addEventListener('click', () => {
      const photo = exportPhoto(img, view);
      if (!photo) { alert('Не удалось сохранить фото'); return; }
      finish(photo);
    });
    // клик по затемнению мимо окна — отмена
    root.addEventListener('pointerdown', e => { if (e.target === root) finish(null); });
    // клавиши — окну: модальные окна под ним (data-own-keys) и доска их не получают
    root.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); finish(null); return; }
      if (e.key === 'Enter' && (e.target === stage || e.target === range)) { e.preventDefault(); save.click(); return; }
      if (e.target === stage) {
        const step = e.shiftKey ? 20 : 6;
        const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
        const mv = moves[e.key];
        if (mv) { e.preventDefault(); setView({ ...view, cx: view.cx + mv[0], cy: view.cy + mv[1] }); return; }
        if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomTo(view.scale * 1.2); return; }
        if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomTo(view.scale / 1.2); return; }
      }
      if (e.key === 'Tab') {
        // фокус не уходит из окна
        const items: HTMLElement[] = [stage, minus, range, plus, cancel, save];
        const i = items.indexOf(document.activeElement as HTMLElement);
        const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i < 0 || i === items.length - 1 ? 0 : i + 1);
        e.preventDefault();
        items[next].focus();
      }
    });
    document.body.appendChild(root);
    draw();
    save.focus({ preventScroll: true });
  });
}
