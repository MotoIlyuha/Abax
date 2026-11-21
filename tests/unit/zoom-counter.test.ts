// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setZoomCounter } from '../../src/zoom-counter';

/** Прогоняет кадры requestAnimationFrame и собирает то, что читает probe. */
function runFrames(frames: ((t: number) => void)[], probe: () => string): Set<string> {
  const seen = new Set<string>();
  let t = performance.now();
  for (let i = 0; i < 600 && frames.length; i++) {
    t += 16;
    frames.shift()!(t);
    seen.add(probe());
  }
  return seen;
}

const wheelDigits = (el: HTMLElement): string =>
  [...el.querySelectorAll<HTMLElement>('.zoom-wheel')].map(w => {
    const m = /translateY\((-?[\d.]+)%\)/.exec(w.querySelector<HTMLElement>('.zoom-strip')!.style.transform);
    return String(Math.round((-Number(m![1]) * 11) / 100) % 10);
  }).join('');

describe('счётчик масштаба', () => {
  afterEach(() => { document.body.className = ''; vi.unstubAllGlobals(); });

  it('«выкл»: текст ставится сразу', () => {
    document.body.classList.add('no-ui-anim', 'no-motion');
    const el = document.createElement('button');
    setZoomCounter(el, 100);
    setZoomCounter(el, 250);
    expect(el.textContent).toBe('250%');
  });

  it('«обычные»: число пробегает через промежуточные значения и приходит в цель', () => {
    document.body.classList.add('no-motion');
    const frames: ((t: number) => void)[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => { frames.push(cb); return frames.length; });
    const el = document.createElement('button');
    setZoomCounter(el, 100);
    expect(el.textContent).toBe('100%');
    setZoomCounter(el, 400);
    const seen = runFrames(frames, () => el.textContent!);
    expect([...seen].filter(s => s !== '100%' && s !== '400%').length).toBeGreaterThan(3);
    expect(el.textContent).toBe('400%');
  });

  it('«улучшенные»: цифры - колёсики, прокручиваются через промежуточные цифры', () => {
    const frames: ((t: number) => void)[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => { frames.push(cb); return frames.length; });
    const el = document.createElement('button');
    setZoomCounter(el, 100);
    expect(el.querySelectorAll('.zoom-wheel')).toHaveLength(3);
    expect(wheelDigits(el)).toBe('100');
    expect(el.textContent).toBe('100%');
    setZoomCounter(el, 470);
    const seen = runFrames(frames, () => wheelDigits(el));
    // средняя колонка 0→7 идёт кратчайшим путём назад через 9, 8
    expect([...seen].some(s => s[1] === '9' || s[1] === '8')).toBe(true);
    expect(wheelDigits(el)).toBe('470');
    expect(el.textContent).toBe('470%');
  });

  it('«улучшенные»: число цифр меняется - колёсики добавляются и убираются', () => {
    const el = document.createElement('button');
    setZoomCounter(el, 100);
    setZoomCounter(el, 50);
    expect(el.querySelectorAll('.zoom-wheel')).toHaveLength(2);
    setZoomCounter(el, 120);
    expect(el.querySelectorAll('.zoom-wheel')).toHaveLength(3);
  });

  it('смена режима: разметка пересобирается', () => {
    const el = document.createElement('button');
    setZoomCounter(el, 100);
    expect(el.querySelector('.zoom-wheel')).not.toBeNull();
    document.body.classList.add('no-motion');
    setZoomCounter(el, 100);
    expect(el.querySelector('.zoom-wheel')).toBeNull();
    expect(el.textContent).toBe('100%');
  });
});
