// Переключатель на пружинах: три режима анимаций и связь с настройкой.
import { afterEach, describe, expect, it } from 'vitest';
import { createToggleSwitch } from '../../src/toggle-switch';

const frame = () => new Promise(r => requestAnimationFrame(() => r(null)));

function make(checked = false) {
  const changes: boolean[] = [];
  const row = createToggleSwitch({ className: 'grid-switch view-switch', label: 'Привязка к сетке', icon: '<svg></svg>', checked, onChange: v => changes.push(v) });
  document.body.append(row);
  const input = row.querySelector<HTMLInputElement>('input')!;
  const knob = row.querySelector<HTMLElement>('.switch-knob')!;
  const track = row.querySelector<HTMLElement>('.switch-track')!;
  return { row, input, knob, track, changes };
}

afterEach(() => {
  document.body.replaceChildren();
  document.body.className = '';
});

describe('переключатель', () => {
  it('разметка: подпись, иконка, role="switch", начальное состояние', () => {
    const { row, input } = make(true);
    expect(row.tagName).toBe('LABEL');
    expect(row.classList.contains('spring-switch')).toBe(true);
    expect(row.querySelector('.switch-text')!.textContent).toBe('Привязка к сетке');
    expect(row.querySelector('.view-icon svg')).not.toBeNull();
    expect(input.getAttribute('role')).toBe('switch');
    expect(input.checked).toBe(true);
  });

  it('«Улучшенные»: щелчок сообщает значение и запускает пружины (ручка вытягивается)', async () => {
    const { input, knob, track, changes } = make();
    input.click();
    expect(changes).toEqual([true]);
    // под нагрузкой полного прогона кадры приходят неровно: смотрим несколько кадров и запоминаем пик
    let maxWidth = 0, moved = false, mixed = false;
    for (let i = 0; i < 30 && !(moved && mixed && maxWidth > 16); i++) {
      await frame();
      if (/translateX/.test(knob.style.transform)) moved = true;
      if (track.style.background.includes('color-mix')) mixed = true;
      maxWidth = Math.max(maxWidth, parseFloat(knob.style.width) || 0);
    }
    expect(moved).toBe(true);
    expect(mixed).toBe(true);
    expect(maxWidth).toBeGreaterThan(16);
  });

  it('«Обычные»: без пружин — инлайн-стилей нет, двигает CSS', async () => {
    document.body.className = 'no-motion';
    const { input, knob, track, changes } = make();
    input.click();
    await frame();
    expect(changes).toEqual([true]);
    expect(knob.getAttribute('style') ?? '').toBe('');
    expect(track.getAttribute('style') ?? '').toBe('');
  });

  it('«Выкл»: значение меняется сразу, без движения', async () => {
    document.body.className = 'no-motion no-ui-anim';
    const { input, knob, changes } = make(true);
    input.click();
    await frame();
    expect(changes).toEqual([false]);
    expect(input.checked).toBe(false);
    expect(knob.getAttribute('style') ?? '').toBe('');
  });
});
