// Вход по почте: разбор кода из вставленного текста.
import { describe, expect, it } from 'vitest';
import { extractCode } from '../../src/email-login';

describe('extractCode - код из буфера обмена', () => {
  it('оставляет только 6 цифр', () => {
    expect(extractCode('123456')).toBe('123456');
    expect(extractCode('  123456\n')).toBe('123456');
    expect(extractCode('Код для входа в Abax: 482916')).toBe('482916');
  });
  it('группа с пробелами или дефисами', () => {
    expect(extractCode('Ваш код: 482 916. Он действует 10 минут')).toBe('482916');
    expect(extractCode('482-916')).toBe('482916');
  });
  it('дата и прочие числа рядом не мешают', () => {
    expect(extractCode('17.11.2026: код 482916, действует 10 минут')).toBe('482916');
  });
  it('нет отдельной группы - первые шесть цифр', () => {
    expect(extractCode('12345678')).toBe('123456');
    expect(extractCode('1a2b3c4d5e6f7')).toBe('123456');
    expect(extractCode('12 34')).toBe('1234');
  });
  it('без цифр - пусто', () => {
    expect(extractCode('Привет')).toBe('');
    expect(extractCode('')).toBe('');
  });
});
