// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createValueCounter } from '../../src/value-counter';

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

const fmt = (v: number): string => String(Math.round(v * 10) / 10).replace('.', ',');
const mount = (): HTMLElement => { const el = document.createElement('span'); document.body.append(el); return el; };

describe('число у ползунка', () => {
  afterEach(() => { document.body.replaceChildren(); document.body.className = ''; vi.unstubAllGlobals(); });

  it('«выкл»: текст ставится сразу', () => {
    document.body.classList.add('no-ui-anim', 'no-motion');
    const el = mount();
    const c = createValueCounter(el, fmt, 0.05, 4);
    expect(el.textContent).toBe('4');
    c.set(9.5);
    expect(el.textContent).toBe('9,5');
  });

  it('«обычные»: значение пробегает через промежуточные и приходит в цель', () => {
    document.body.classList.add('no-motion');
    const frames: ((t: number) => void)[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => { frames.push(cb); return frames.length; });
    const el = mount();
    const c = createValueCounter(el, fmt, 0.05, 1);
    c.set(12);
    const seen = runFrames(frames, () => el.textContent!);
    expect([...seen].filter(s => s !== '1' && s !== '12').length).toBeGreaterThan(3);
    expect(el.textContent).toBe('12');
  });

  it('«улучшенные»: цифры — колёсики, запятая и «%» стоят на месте, textContent — значение', () => {
    const frames: ((t: number) => void)[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => { frames.push(cb); return frames.length; });
    const el = mount();
    const c = createValueCounter(el, v => `${Math.round(v * 100)}%`, 0.005, 1);
    expect(el.textContent).toBe('100%');
    expect(el.querySelectorAll('.zoom-wheel')).toHaveLength(3);
    c.set(0.55);
    expect(el.textContent).toBe('55%');
    expect(el.querySelectorAll('.zoom-wheel')).toHaveLength(2);
    runFrames(frames, () => el.textContent!);
    expect(el.querySelector('.zoom-pct')?.getAttribute('data-d')).toBe('%');
  });

  it('пересобранная панель: отключённые строки не копятся в цикле', () => {
    const el = mount();
    createValueCounter(el, fmt, 0.05, 1);
    el.remove();
    const el2 = mount();
    expect(() => createValueCounter(el2, fmt, 0.05, 2)).not.toThrow();
    expect(el2.textContent).toBe('2');
  });
});
