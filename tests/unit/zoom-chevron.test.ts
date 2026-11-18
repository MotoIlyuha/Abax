// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initZoomChevron } from '../../src/zoom-chevron';

const flush = () => new Promise<void>(r => queueMicrotask(r));

function setup() {
  const frames: ((t: number) => void)[] = [];
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => { frames.push(cb); return frames.length; });
  const button = document.createElement('button');
  button.setAttribute('aria-expanded', 'false');
  const chevron = document.createElement('span');
  button.append(chevron);
  initZoomChevron(button, chevron);
  return { frames, button, chevron };
}

function run(frames: ((t: number) => void)[], chevron: HTMLElement): number[] {
  const angles: number[] = [];
  let t = performance.now();
  for (let i = 0; i < 600 && frames.length; i++) {
    t += 16;
    frames.shift()!(t);
    const m = /rotate\(([-\d.]+)deg\)/.exec(chevron.style.transform);
    if (m) angles.push(Number(m[1]));
  }
  return angles;
}

describe('стрелка у масштаба', () => {
  afterEach(() => { document.body.className = ''; vi.unstubAllGlobals(); });

  it('«улучшенные»: разворот на пружине с перелётом, в конце инлайн снят', async () => {
    const { frames, button, chevron } = setup();
    button.setAttribute('aria-expanded', 'true');
    await flush();
    const angles = run(frames, chevron);
    expect(angles.length).toBeGreaterThan(3);
    expect(Math.max(...angles)).toBeGreaterThan(180); // перелёт
    expect(chevron.style.transform).toBe('');          // дальше работает CSS по aria-expanded
  });

  it('«обычные» и «выкл»: JS не трогает стрелку, поворот делает CSS', async () => {
    for (const cls of [['no-motion'], ['no-motion', 'no-ui-anim']]) {
      document.body.className = cls.join(' ');
      const { frames, button, chevron } = setup();
      button.setAttribute('aria-expanded', 'true');
      await flush();
      expect(chevron.style.transform).toBe('');
      expect(frames).toHaveLength(0);
    }
  });
});
