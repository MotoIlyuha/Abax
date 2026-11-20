// Названия в шапке: вне фокуса — 18 символов и «...» с подсказкой, в фокусе — полное, Enter и Esc.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { wireTopName } from '../../src/topbar-names';

const LONG = 'Геометрия и алгебра, 8 класс';

let input: HTMLInputElement;
beforeEach(() => {
  document.body.innerHTML = '';
  input = document.createElement('input');
  document.body.appendChild(input);
});

describe('название в шапке', () => {
  it('короткое — как есть и без подсказки; длинное — сокращено, полное — в подсказке', () => {
    const t = wireTopName(input, { max: 40, canEdit: () => true, commit: vi.fn() });
    t.set('Дроби');
    expect(input.value).toBe('Дроби');
    expect(input.hasAttribute('title')).toBe(false);
    t.set(LONG);
    expect(input.value).toBe('Геометрия и алгебр...');
    expect(input.getAttribute('title')).toBe(LONG);
    t.set('Дроби');
    expect(input.hasAttribute('title')).toBe(false);
    expect(input.hasAttribute('data-tip')).toBe(false);
  });

  it('в фокусе — полное название; правка сохраняется, после — снова сокращённое', () => {
    const commit = vi.fn();
    const t = wireTopName(input, { max: 40, canEdit: () => true, commit });
    t.set(LONG);
    input.focus();
    expect(input.value).toBe(LONG);
    expect(input.hasAttribute('title')).toBe(false);
    input.value = `${LONG} 2026`;
    input.dispatchEvent(new Event('change'));
    expect(commit).toHaveBeenCalledWith(`${LONG} 2026`);
    input.blur();
    expect(input.value).toBe('Геометрия и алгебр...');
  });

  it('Esc возвращает прежнее; без права — правка не сохраняется', () => {
    const commit = vi.fn();
    let can = true;
    const t = wireTopName(input, { max: 40, canEdit: () => can, commit });
    t.set('Дроби');
    input.focus();
    input.value = 'Что-то';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(input.value).toBe('Дроби');
    expect(commit).not.toHaveBeenCalled();
    can = false;
    input.focus();
    expect(input.readOnly).toBe(true);
    input.value = 'Чужое';
    input.dispatchEvent(new Event('change'));
    expect(commit).not.toHaveBeenCalled();
    expect(input.value).toBe('Дроби');
  });

  it('пока поле правят, название снаружи не перебивает ввод', () => {
    const t = wireTopName(input, { max: 40, canEdit: () => true, commit: vi.fn() });
    t.set('Дроби');
    input.focus();
    input.value = 'Набираю';
    t.set('Дроби');
    expect(input.value).toBe('Набираю');
  });
});
