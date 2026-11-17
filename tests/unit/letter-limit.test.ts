// Поле имени с лимитом символов: обрезка, счётчик, имена-подсказки не длиннее лимита.
import { afterEach, describe, expect, it } from 'vitest';
import { FUNNY_NAMES, nextFunnyName, randomFunnyName } from '../../src/funny-names';
import { createLetterLimit } from '../../src/letter-limit';
import { NAME_LIMIT, NAME_NEAR, limitState, splitAtLimit } from '../../src/onboarding-logic';

describe('лимит символов: чистая логика', () => {
  it('лимит имени — 32 символа', () => {
    expect(NAME_LIMIT).toBe(32);
  });

  it('splitAtLimit: в пределах лимита ничего не отрезает', () => {
    expect(splitAtLimit('Енот', 32)).toEqual({ kept: 'Енот', extra: '' });
    expect(splitAtLimit('a'.repeat(32), 32)).toEqual({ kept: 'a'.repeat(32), extra: '' });
  });

  it('splitAtLimit: лишнее с конца уходит в extra', () => {
    expect(splitAtLimit('a'.repeat(30) + 'Привет', 32)).toEqual({ kept: 'a'.repeat(30) + 'Пр', extra: 'ивет' });
  });

  it('splitAtLimit: эмодзи не рвутся пополам', () => {
    const r = splitAtLimit('ab😀😀', 3);
    expect(r).toEqual({ kept: 'ab😀', extra: '😀' });
  });

  it('limitState: обычное, близко к лимиту, лимит', () => {
    expect(limitState(10, NAME_NEAR)).toBe('ok');
    expect(limitState(NAME_NEAR, NAME_NEAR)).toBe('near');
    expect(limitState(1, NAME_NEAR)).toBe('near');
    expect(limitState(0, NAME_NEAR)).toBe('full');
  });

  it('имена-подсказки не длиннее лимита', () => {
    for (const n of FUNNY_NAMES) expect(Array.from(n).length, n).toBeLessThanOrEqual(NAME_LIMIT);
    for (let i = 0; i < 50; i++) {
      expect(Array.from(randomFunnyName()).length).toBeLessThanOrEqual(NAME_LIMIT);
      expect(Array.from(nextFunnyName('Енот')).length).toBeLessThanOrEqual(NAME_LIMIT);
    }
  });
});

describe('поле с лимитом символов', () => {
  afterEach(() => { document.body.textContent = ''; });

  function make() {
    const input = document.createElement('input');
    const host = document.createElement('div');
    const floor = document.createElement('div');
    document.body.append(host, floor);
    const f = createLetterLimit({ input, limit: 5, near: 2, pileHost: () => host, floorEl: () => floor });
    host.appendChild(f.el);
    return { input, f, count: () => f.el.querySelector('.ob-limit-count')!.textContent };
  }

  it('счётчик показывает остаток, цвет меняется у лимита', () => {
    const { input, f, count } = make();
    expect(count()).toBe('5');
    input.value = 'абв';
    input.dispatchEvent(new Event('input'));
    expect(count()).toBe('2');
    expect(f.el.classList.contains('is-near')).toBe(true);
    input.value = 'абвгд';
    input.dispatchEvent(new Event('input'));
    expect(count()).toBe('0');
    expect(f.el.classList.contains('is-full')).toBe(true);
    f.destroy();
  });

  it('ввод сверх лимита отрезается с конца', () => {
    const { input, f, count } = make();
    input.value = 'абвгдеёж';
    input.dispatchEvent(new Event('input'));
    expect(input.value).toBe('абвгд');
    expect(count()).toBe('0');
    f.destroy();
  });

  it('set: значение из кода обрезается молча', () => {
    const { input, f, count } = make();
    f.set('Мечтательный');
    expect(input.value).toBe('Мечта');
    expect(count()).toBe('0');
    f.set('');
    expect(count()).toBe('5');
    f.destroy();
  });

  it('destroy убирает слой с буквами', () => {
    const { input, f } = make();
    input.value = 'абвгдеёж';
    input.dispatchEvent(new Event('input'));
    f.destroy();
    expect(document.querySelector('.ob-pile')).toBeNull();
  });
});
