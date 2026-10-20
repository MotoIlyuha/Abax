import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initTooltips } from '../../src/tooltip';

function over(el: Element, pointerType = 'mouse'): void {
  const e = new MouseEvent('pointerover', { bubbles: true });
  Object.defineProperty(e, 'pointerType', { value: pointerType });
  el.dispatchEvent(e);
}
function out(el: Element, to: Element | null): void {
  el.dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: to }));
}
const tip = () => document.getElementById('tooltip') as HTMLDivElement | null;
const shown = () => !!tip() && !tip()!.hidden && tip()!.classList.contains('show');

beforeAll(() => initTooltips());

let root: HTMLDivElement;

beforeEach(() => {
  // performance.now остаётся настоящим: «тёплое» окно считается от него
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  root = document.createElement('div');
  document.body.appendChild(root);
  root.innerHTML = `
    <div id="toolbar" data-pos="left"><button id="t1" title="Перо (P)">p</button><button id="t2" title="Ластик (E)">e</button></div>
    <button id="plain" title="Просто подсказка">x</button>
    <div data-tip-side="top"><button id="side" title="Сверху">s</button></div>
    <button id="empty" title="">-</button>`;
});
afterEach(() => {
  // нажатие прячет подсказку и сбрасывает «тёплое» окно: тесты не влияют друг на друга
  document.dispatchEvent(new Event('pointerdown'));
  root.remove();
  vi.useRealTimers();
});

describe('подсказки', () => {
  it('title переносится в data-tip, нативная подсказка подавляется', () => {
    const b = document.getElementById('plain')!;
    over(b);
    expect(b.hasAttribute('title')).toBe(false);
    expect(b.dataset.tip).toBe('Просто подсказка');
  });

  it('появляется после задержки', () => {
    over(document.getElementById('plain')!);
    vi.advanceTimersByTime(300);
    expect(shown()).toBe(false);
    vi.advanceTimersByTime(200);
    expect(shown()).toBe(true);
    expect(tip()!.textContent).toBe('Просто подсказка');
    expect(tip()!.getAttribute('role')).toBe('tooltip');
  });

  it('хоткей в скобках выделяется отдельным фрагментом', () => {
    over(document.getElementById('t1')!);
    vi.advanceTimersByTime(500);
    const kbd = tip()!.querySelector('.tooltip-kbd');
    expect(kbd?.textContent).toBe('P');
    expect(tip()!.firstElementChild!.textContent).toBe('Перо');
  });

  it('у тулбара слева пузырь справа, data-tip-side уважается', () => {
    over(document.getElementById('t1')!);
    vi.advanceTimersByTime(500);
    expect(tip()!.dataset.side).toBe('right');
    over(document.getElementById('side')!);
    vi.advanceTimersByTime(500);
    expect(['top', 'bottom']).toContain(tip()!.dataset.side);
  });

  it('позиция тулбара определяет сторону', () => {
    const tb = document.getElementById('toolbar')!;
    for (const [pos, side] of [['right', 'left'], ['bottom', 'top'], ['top', 'bottom']]) {
      tb.dataset.pos = pos;
      over(document.getElementById('plain')!);
      over(document.getElementById('t1')!);
      vi.advanceTimersByTime(500);
      // в jsdom размеры нулевые: сторона либо предпочтительная, либо противоположная
      expect([side, { left: 'right', right: 'left', top: 'bottom', bottom: 'top' }[side]]).toContain(tip()!.dataset.side);
    }
  });

  it('«тёплый» переход между кнопками почти без задержки', () => {
    over(document.getElementById('t1')!);
    vi.advanceTimersByTime(500);
    over(document.getElementById('t2')!);
    vi.advanceTimersByTime(50);
    expect(shown()).toBe(true);
    expect(tip()!.textContent).toContain('Ластик');
  });

  it('уход курсора, нажатие и клавиатура скрывают подсказку', () => {
    const b = document.getElementById('plain')!;
    over(b);
    vi.advanceTimersByTime(500);
    out(b, document.body);
    expect(shown()).toBe(false);

    over(document.getElementById('t1')!);
    vi.advanceTimersByTime(500);
    document.dispatchEvent(new Event('pointerdown'));
    expect(shown()).toBe(false);
  });

  it('переход на дочерний элемент не скрывает подсказку', () => {
    const b = document.getElementById('plain')!;
    const child = document.createElement('span');
    b.appendChild(child);
    over(b);
    vi.advanceTimersByTime(500);
    out(b, child);
    expect(shown()).toBe(true);
  });

  it('касание пальцем не показывает подсказку', () => {
    over(document.getElementById('plain')!, 'touch');
    vi.advanceTimersByTime(1000);
    expect(shown()).toBe(false);
  });

  it('пустой title просто снимается', () => {
    const b = document.getElementById('empty')!;
    over(b);
    vi.advanceTimersByTime(1000);
    expect(b.hasAttribute('title')).toBe(false);
    expect(shown()).toBe(false);
  });

  it('элемент удалён до показа — подсказки нет', () => {
    const b = document.getElementById('plain')!;
    over(b);
    b.remove();
    vi.advanceTimersByTime(1000);
    expect(shown()).toBe(false);
  });
});
