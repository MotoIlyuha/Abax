import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NEW_PAGE_KEY, FIXED_SHORTCUTS, browserUse, codeLabel, comboFromEvent, comboLabel, macKeys, newPageKeyProblem,
  newPageKeyWarning, pageKeyWarning, pageNumberFromEvent,
} from '../../src/hotkeys';

const key = (code: string, mods: { ctrl?: boolean; meta?: boolean; alt?: boolean; shift?: boolean } = {}, k = 'x') => ({
  key: k, code, ctrlKey: !!mods.ctrl, metaKey: !!mods.meta, altKey: !!mods.alt, shiftKey: !!mods.shift,
});

const BROWSER = { browser: true, linux: false };
const LINUX = { browser: true, linux: true };
const APP = { browser: false, linux: true };

describe('сочетания клавиш', () => {
  it('сочетание из события: модификаторы в постоянном порядке, Cmd — это Ctrl', () => {
    expect(comboFromEvent(key('KeyN', { ctrl: true }))).toBe('Ctrl+KeyN');
    expect(comboFromEvent(key('KeyN', { meta: true }))).toBe('Ctrl+KeyN');
    expect(comboFromEvent(key('KeyP', { shift: true, alt: true }))).toBe('Alt+Shift+KeyP');
    expect(comboFromEvent(key('KeyZ', { ctrl: true, shift: true }))).toBe('Ctrl+Shift+KeyZ');
    expect(comboFromEvent(key('ShiftLeft', { shift: true }, 'Shift'))).toBeNull();
    expect(comboFromEvent(key('ControlLeft', { ctrl: true }, 'Control'))).toBeNull();
  });

  it('подписи', () => {
    expect(comboLabel('Ctrl+Shift+KeyN')).toBe('Ctrl+Shift+N');
    expect(comboLabel('Alt+Digit3')).toBe('Alt+3');
    expect(codeLabel('Comma')).toBe(',');
    expect(codeLabel('Space')).toBe('Пробел');
    expect(codeLabel('Numpad4')).toBe('Num 4');
  });

  it('на macOS в подписях Cmd вместо Ctrl', () => {
    expect(macKeys('Ctrl+Shift+Z', true)).toBe('Cmd+Shift+Z');
    expect(macKeys('Отменить (Ctrl+Z) или Ctrl+Y', true)).toBe('Отменить (Cmd+Z) или Cmd+Y');
    expect(macKeys('Нужно сочетание с Ctrl или Alt', true)).toBe('Нужно сочетание с Cmd или Alt');
    expect(macKeys('Alt+N', true)).toBe('Alt+N');
    expect(macKeys('Ctrl+Shift+Z', false)).toBe('Ctrl+Shift+Z');
  });

  it('номер страницы: только выбранный модификатор, цифры 1–9 и цифровой блок', () => {
    expect(pageNumberFromEvent(key('Digit3', { ctrl: true }), 'ctrl')).toBe(3);
    expect(pageNumberFromEvent(key('Digit3', { meta: true }), 'ctrl')).toBe(3);
    expect(pageNumberFromEvent(key('Numpad5', { ctrl: true }), 'ctrl')).toBe(5);
    expect(pageNumberFromEvent(key('Digit3', { alt: true }), 'ctrl')).toBeNull();
    expect(pageNumberFromEvent(key('Digit3', { alt: true }), 'alt')).toBe(3);
    expect(pageNumberFromEvent(key('Digit3', { ctrl: true }), 'alt')).toBeNull();
    expect(pageNumberFromEvent(key('Digit3', { ctrl: true, shift: true }), 'ctrl')).toBeNull();
    expect(pageNumberFromEvent(key('Digit3', { ctrl: true, alt: true }), 'ctrl')).toBeNull();
    expect(pageNumberFromEvent(key('Digit0', { ctrl: true }), 'ctrl')).toBeNull();
    expect(pageNumberFromEvent(key('Digit3'), 'ctrl')).toBeNull();
  });

  it('сочетание новой страницы: нужен Ctrl или Alt и свободная буква или цифра', () => {
    expect(DEFAULT_NEW_PAGE_KEY).toBe('Alt+KeyN');
    expect(newPageKeyProblem(DEFAULT_NEW_PAGE_KEY, 'alt')).toBeNull();
    expect(newPageKeyProblem(DEFAULT_NEW_PAGE_KEY, 'ctrl')).toBeNull();
    expect(newPageKeyProblem('Alt+Shift+KeyP', 'ctrl')).toBeNull();
    expect(newPageKeyProblem('KeyN', 'ctrl')).toMatch(/Ctrl или Alt/);
    expect(newPageKeyProblem('Shift+KeyN', 'ctrl')).toMatch(/Ctrl или Alt/);
    expect(newPageKeyProblem('Ctrl+F1', 'ctrl')).toMatch(/буквой или цифрой/);
    expect(newPageKeyProblem('Ctrl+KeyZ', 'ctrl')).toBe('Ctrl+Z занято: отменить');
    expect(newPageKeyProblem('Ctrl+Shift+KeyZ', 'ctrl')).toBe('Ctrl+Shift+Z занято: повторить');
    expect(newPageKeyProblem('Ctrl+KeyA', 'ctrl')).toBe('Ctrl+A занято: выделить всё');
    // цифра с модификатором перехода — это переход на страницу
    expect(newPageKeyProblem('Ctrl+Digit2', 'ctrl')).toBe('Ctrl+2 занято: переход на страницу 2');
    expect(newPageKeyProblem('Ctrl+Digit2', 'alt')).toBeNull();
    expect(newPageKeyProblem('Alt+Digit2', 'alt')).toMatch(/переход на страницу 2/);
    expect(newPageKeyProblem('Ctrl+Shift+Digit2', 'ctrl')).toBeNull();
  });

  it('у каждого постоянного сочетания есть описание и клавиши', () => {
    for (const g of FIXED_SHORTCUTS) {
      expect(g.items.length).toBeGreaterThan(0);
      for (const s of g.items) {
        expect(s.what).not.toBe('');
        expect(s.keys.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('сочетания, занятые браузером', () => {
  it('в приложении для компьютера браузерных сочетаний нет', () => {
    expect(browserUse('Ctrl+KeyN', APP)).toBeNull();
    expect(newPageKeyWarning('Ctrl+KeyN', APP)).toBeNull();
    expect(pageKeyWarning('ctrl', APP)).toBeNull();
  });

  it('в браузере: окна, вкладки, меню', () => {
    expect(browserUse('Ctrl+KeyN', BROWSER)).toBe('новое окно');
    expect(browserUse('Ctrl+KeyT', BROWSER)).toBe('новая вкладка');
    expect(browserUse('Ctrl+KeyW', BROWSER)).toBe('закрыть вкладку');
    expect(browserUse('Alt+KeyF', BROWSER)).toBe('меню браузера');
    expect(browserUse('Ctrl+Digit4', BROWSER)).toBe('переключение вкладок');
    expect(browserUse('Alt+Shift+KeyP', BROWSER)).toBeNull();
  });

  it('Alt + цифра переключает вкладки только на Linux', () => {
    expect(browserUse('Alt+Digit1', BROWSER)).toBeNull();
    expect(browserUse('Alt+Digit1', LINUX)).toBe('переключение вкладок');
    expect(pageKeyWarning('alt', BROWSER)).toBeNull();
    expect(pageKeyWarning('alt', LINUX)).toMatch(/на Linux Alt\+1…9/);
    expect(pageKeyWarning('ctrl', BROWSER)).toMatch(/Ctrl\+1…9 переключают вкладки/);
  });

  it('предупреждение для новой страницы называет сочетание и чем оно занято', () => {
    expect(newPageKeyWarning('Ctrl+KeyN', BROWSER)).toMatch(/^В браузере Ctrl\+N — новое окно/);
    expect(newPageKeyWarning('Alt+Shift+KeyP', BROWSER)).toBeNull();
    expect(newPageKeyWarning(null, BROWSER)).toBeNull();
  });
});
