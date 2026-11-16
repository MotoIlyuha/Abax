import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { splitTipText } from '../../src/morph-tooltip';
import { initTooltips } from '../../src/tooltip';

function over(el: Element): void {
  const e = new MouseEvent('pointerover', { bubbles: true });
  Object.defineProperty(e, 'pointerType', { value: 'mouse' });
  el.dispatchEvent(e);
}
function out(el: Element, to: Element | null): void {
  el.dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: to }));
}
const layer = () => document.getElementById('morph-tip') as HTMLDivElement | null;
const state = () => layer()?.dataset.state;
const curLabel = () => layer()?.querySelector('.mt-lab.cur') as HTMLElement | null;

beforeAll(() => initTooltips());

let root: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  root = document.createElement('div');
  document.body.appendChild(root);
  root.innerHTML = `
    <div id="toolbar" data-pos="left">
      <button id="t1" class="tool" title="Перо (P)"><svg></svg></button>
      <button id="t2" class="tool" title="Ластик (E)"><svg></svg></button>
      <button id="t3" class="tool" title="Куб"><svg></svg></button>
    </div>
    <button id="plain" title="Просто подсказка">x</button>`;
});
afterEach(() => {
  document.dispatchEvent(new Event('pointerdown'));
  vi.advanceTimersByTime(1000);
  document.dispatchEvent(new Event('keydown'));
  root.remove();
  vi.useRealTimers();
});

describe('подсказка панели инструментов', () => {
  it('splitTipText отделяет хоткей в скобках', () => {
    expect(splitTipText('Перо (P)')).toEqual({ label: 'Перо', key: 'P' });
    expect(splitTipText('Отменить (Ctrl+Z)')).toEqual({ label: 'Отменить', key: 'Ctrl+Z' });
    expect(splitTipText('Куб')).toEqual({ label: 'Куб', key: null });
  });

  it('первая подсказка появляется после короткой паузы, надпись и хоткей раздельно', () => {
    over(document.getElementById('t1')!);
    vi.advanceTimersByTime(60);
    expect(state()).not.toBe('shown');
    vi.advanceTimersByTime(100);
    expect(state()).toBe('shown');
    expect(curLabel()!.firstElementChild!.textContent).toBe('Перо');
    expect(curLabel()!.querySelector('.mt-kbd')!.textContent).toBe('P');
    expect(layer()!.querySelector('[role="tooltip"]')).not.toBeNull();
  });

  it('обычный пузырь для кнопок панели не создаётся, title снят', () => {
    const b = document.getElementById('t1')!;
    over(b);
    vi.advanceTimersByTime(500);
    expect(document.getElementById('tooltip')?.classList.contains('show') ?? false).toBe(false);
    expect(b.hasAttribute('title')).toBe(false);
  });

  it('при переходе к соседней кнопке подсказка не гаснет: меняется только надпись, без паузы', () => {
    over(document.getElementById('t1')!);
    vi.advanceTimersByTime(200);
    over(document.getElementById('t2')!);
    expect(state()).toBe('shown');
    expect(curLabel()!.firstElementChild!.textContent).toBe('Ластик');
    // старая надпись остаётся в слое — она уезжает, а не удаляется
    expect(layer()!.querySelectorAll('.mt-lab').length).toBe(2);
  });

  it('щель между кнопками не прячет подсказку, уход с панели — прячет после паузы', () => {
    const t1 = document.getElementById('t1')!;
    over(t1);
    vi.advanceTimersByTime(200);
    out(t1, document.getElementById('toolbar'));
    vi.advanceTimersByTime(500);
    expect(state()).toBe('shown');
    out(t1, document.body);
    expect(state()).toBe('shown');
    vi.advanceTimersByTime(200);
    expect(state()).toBe('hidden');
  });

  it('быстрый пролёт курсора не показывает подсказку', () => {
    const t1 = document.getElementById('t1')!;
    over(t1);
    vi.advanceTimersByTime(50);
    out(t1, document.body);
    vi.advanceTimersByTime(500);
    expect(state()).not.toBe('shown');
  });

  it('нажатие и клавиатура убирают подсказку сразу', () => {
    over(document.getElementById('t3')!);
    vi.advanceTimersByTime(200);
    document.dispatchEvent(new Event('pointerdown'));
    expect(state()).toBe('hidden');
  });

  it('сторона зависит от положения панели', () => {
    const tb = document.getElementById('toolbar')!;
    for (const [pos, sides] of [['left', ['right', 'left']], ['right', ['left', 'right']], ['bottom', ['top', 'bottom']], ['top', ['bottom', 'top']]] as const) {
      tb.dataset.pos = pos;
      // уход и новая подсказка: сторона пересчитывается
      document.dispatchEvent(new Event('keydown'));
      over(document.getElementById('plain')!);
      vi.advanceTimersByTime(1000);
      over(document.getElementById('t1')!);
      vi.advanceTimersByTime(300);
      // в jsdom размеры нулевые: сторона либо предпочтительная, либо противоположная
      expect(sides).toContain(layer()!.querySelector<HTMLElement>('.mt-tip')!.dataset.side);
    }
  });

  it('подсветка кнопки создаётся внутри панели, под кнопками', () => {
    over(document.getElementById('t2')!);
    const hl = document.querySelector('#toolbar > .mt-hl');
    expect(hl).not.toBeNull();
    expect(document.querySelector('#toolbar')!.firstElementChild).toBe(hl);
  });
});
