// Анимация перехода на другую страницу. Сам холст не двигается: анимируются снимки
// кадров «до» и «после» в слое над ним, поэтому ввод и координаты указателя
// во время перехода не сбиваются. Работает и для холста окна демонстрации.

import type { PageTransition } from './types';

const DURATION: Record<Exclude<PageTransition, 'none'>, number> = { slide: 380, fade: 260, zoom: 320 };
const EASE = 'cubic-bezier(0.22, 0.8, 0.24, 1)';

/** Копия текущего кадра холста (в документе этого холста). */
function snapshot(src: HTMLCanvasElement): HTMLCanvasElement | null {
  if (src.width === 0 || src.height === 0) return null;
  const c = src.ownerDocument.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(src, 0, 0);
  c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
  return c;
}

/**
 * Снимает кадры «до» с холстов. Возвращённая функция проигрывает переход —
 * её вызывают после смены страницы и перерисовки; dir 1 — вперёд по списку, -1 — назад.
 */
export function capturePageTransition(mode: PageTransition, canvases: HTMLCanvasElement[]): ((dir: 1 | -1) => void) | null {
  if (mode === 'none') return null;
  const shots: [HTMLCanvasElement, HTMLCanvasElement][] = [];
  for (const c of canvases) {
    const before = snapshot(c);
    if (before) shots.push([c, before]);
  }
  if (shots.length === 0) return null;
  return dir => { for (const [c, before] of shots) play(mode, c, before, dir); };
}

function play(mode: Exclude<PageTransition, 'none'>, canvas: HTMLCanvasElement, before: HTMLCanvasElement, dir: 1 | -1): void {
  const parent = canvas.parentElement;
  if (!parent || typeof before.animate !== 'function') return;
  // предыдущий переход ещё идёт — новый начинается с того, что уже на холсте
  for (const old of parent.querySelectorAll(':scope > .page-transition')) old.remove();
  const layer = canvas.ownerDocument.createElement('div');
  layer.className = 'page-transition';
  // сразу над холстом: интерфейс поверх него остаётся поверх и перехода
  layer.style.cssText = `position:absolute;left:${canvas.offsetLeft}px;top:${canvas.offsetTop}px;`
    + `width:${canvas.clientWidth}px;height:${canvas.clientHeight}px;overflow:hidden;pointer-events:none;z-index:0;`
    + (mode === 'fade' ? '' : 'background:#fff;');
  const ms = DURATION[mode];
  const timing: KeyframeAnimationOptions = { duration: ms, easing: EASE, fill: 'both' };
  const anims: Animation[] = [];
  if (mode === 'fade') {
    // новая страница уже на холсте — старая растворяется поверх неё
    layer.append(before);
    anims.push(before.animate([{ opacity: 1 }, { opacity: 0 }], { ...timing, easing: 'ease-out' }));
  } else {
    const after = snapshot(canvas);
    if (!after) return;
    layer.append(before, after);
    if (mode === 'slide') {
      anims.push(
        before.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${-dir * 100}%)` }], timing),
        after.animate([{ transform: `translateX(${dir * 100}%)` }, { transform: 'translateX(0)' }], timing),
      );
    } else {
      // вперёд — старая страница «пролетает» мимо, новая выходит из глубины; назад — наоборот
      const near = 'scale(1.08)';
      const far = 'scale(0.92)';
      anims.push(
        before.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: dir > 0 ? near : far, opacity: 0 }], timing),
        after.animate([{ transform: dir > 0 ? far : near, opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], timing),
      );
    }
  }
  canvas.after(layer);
  const done = () => layer.remove();
  void Promise.all(anims.map(a => a.finished)).then(done, done);
  // в свёрнутом окне анимации могут не доиграть — слой всё равно убираем
  window.setTimeout(done, ms + 200);
}
