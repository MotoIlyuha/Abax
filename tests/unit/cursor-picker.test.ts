import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCursorPicker, lookAngle, magnetOffset, MAGNET_R, scrollThumb, wrapAngle } from '../../src/cursor-picker';
import { CURSOR_PRESETS } from '../../src/cursors';

describe('выбор курсора: геометрия', () => {
  it('wrapAngle приводит угол в (-π, π]', () => {
    expect(wrapAngle(0)).toBeCloseTo(0);
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-Math.PI / 2 - 2 * Math.PI)).toBeCloseTo(-Math.PI / 2);
  });

  it('lookAngle: мышь влево-вверх - без поворота, вправо-вниз - разворот на 180°', () => {
    expect(lookAngle(10, 10, 0, 0)).toBeCloseTo(0);
    expect(Math.abs(lookAngle(10, 10, 20, 20))).toBeCloseTo(Math.PI);
    // вправо-вверх — поворот по часовой на 90°
    expect(lookAngle(10, 10, 20, 0)).toBeCloseTo(Math.PI / 2);
    expect(lookAngle(5, 5, 5, 5)).toBe(0);
  });

  it('magnetOffset: тянет к мыши, вне радиуса - ноль, не больше предела', () => {
    expect(magnetOffset(MAGNET_R + 1, 0)).toEqual({ x: 0, y: 0 });
    expect(magnetOffset(0, 0)).toEqual({ x: 0, y: 0 });
    const near = magnetOffset(10, 0);
    expect(near.x).toBeGreaterThan(0);
    expect(near.y).toBe(0);
    const mid = magnetOffset(30, -20);
    expect(Math.hypot(mid.x, mid.y)).toBeLessThanOrEqual(11 + 1e-9);
    expect(mid.x).toBeGreaterThan(0);
    expect(mid.y).toBeLessThan(0);
    // к краю радиуса притяжение гаснет
    expect(magnetOffset(MAGNET_R - 2, 0).x).toBeLessThan(magnetOffset(MAGNET_R * 0.5, 0).x);
  });

  it('scrollThumb: без переполнения - ничего; кнопки только когда есть куда листать', () => {
    expect(scrollThumb(200, 200, 0, 188).over).toBe(false);
    const top = scrollThumb(600, 200, 0, 188);
    expect(top).toMatchObject({ over: true, up: false, down: true, offset: 0 });
    expect(top.size).toBeCloseTo(188 / 3);
    const mid = scrollThumb(600, 200, 200, 188);
    expect(mid).toMatchObject({ up: true, down: true });
    const end = scrollThumb(600, 200, 400, 188);
    expect(end).toMatchObject({ up: true, down: false });
    expect(end.offset + end.size).toBeCloseTo(188);
    // очень длинный список — ползунок не меньше минимума
    expect(scrollThumb(100000, 200, 0, 188).size).toBe(24);
  });
});

describe('выбор курсора: разметка', () => {
  const pickers: { dispose(): void; el: HTMLElement }[] = [];
  afterEach(() => { for (const p of pickers.splice(0)) { p.dispose(); p.el.remove(); } });

  it('все курсоры - карточки списка на холсте, Pro с бейджем, выбор - рамкой', () => {
    const onChange = vi.fn();
    const p = createCursorPicker({ choice: { preview: 'mint', saved: 'mint' }, entitled: false, name: 'Аня', onChange });
    pickers.push(p);
    document.body.appendChild(p.el);
    const items = p.el.querySelectorAll<HTMLButtonElement>('.cp-preview .cp-scroller .cp-item');
    expect(items).toHaveLength(CURSOR_PRESETS.length);
    expect(p.el.querySelectorAll('.cp-preview canvas')).toHaveLength(2);
    expect(p.el.querySelector('[data-cursor="mint"]')!.classList.contains('active')).toBe(true);
    expect(p.el.querySelector('[data-cursor="neon"] .cp-pro')!.textContent).toBe('Pro');
    expect(p.el.querySelector('[data-cursor="mint"] .cp-pro')).toBeNull();
    expect(p.el.querySelector('.cp-badge')!.textContent).toBe('Аня');
    p.el.querySelector<HTMLButtonElement>('[data-cursor="coral"]')!.click();
    expect(onChange).toHaveBeenLastCalledWith({ preview: 'coral', saved: 'coral' });
    expect(p.el.querySelector('[data-cursor="coral"]')!.getAttribute('aria-checked')).toBe('true');
    expect(p.el.querySelector<HTMLElement>('.cp-preview')!.style.getPropertyValue('--cp-sel')).toBe('#e03131');
  });

  it('с подпиской бейдж Pro тоже виден; стрелки листают выбор', () => {
    const p = createCursorPicker({ choice: { preview: 'default', saved: 'default' }, entitled: true, name: 'Я', onChange: () => {} });
    pickers.push(p);
    document.body.appendChild(p.el);
    expect(p.el.querySelectorAll('.cp-pro')).toHaveLength(CURSOR_PRESETS.filter(c => c.tier === 'pro').length);
    p.el.querySelector('.cp-scroller')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(p.choice().preview).toBe('graphite');
    p.el.querySelector('.cp-scroller')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    p.el.querySelector('.cp-scroller')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(p.choice().preview).toBe(CURSOR_PRESETS[CURSOR_PRESETS.length - 1].id);
  });
});
