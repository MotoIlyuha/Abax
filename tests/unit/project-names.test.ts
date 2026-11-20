// Названия проекта и страницы: сокращение для шапки, очистка ввода, имя по умолчанию, пояснение тарифа.
import { describe, expect, it } from 'vitest';
import { PROJECT_NAME_MAX, TOPBAR_NAME_SHOWN, cleanName, defaultProjectName, planNote, plural, shortName } from '../../src/project-names';

describe('названия проекта и страницы', () => {
  it('shortName: до 18 символов — как есть, длиннее — первые 18 и «...»', () => {
    expect(TOPBAR_NAME_SHOWN).toBe(18);
    expect(shortName('Алгебра 7Б')).toEqual({ text: 'Алгебра 7Б', cut: false });
    expect(shortName('123456789012345678')).toEqual({ text: '123456789012345678', cut: false });
    expect(shortName('1234567890123456789')).toEqual({ text: '123456789012345678...', cut: true });
    // пробел на месте обреза не остаётся перед многоточием
    expect(shortName('Геометрия и алгебра 8 класс').text).toBe('Геометрия и алгебр...');
    expect(shortName('Очень длинное слово тут').text).toBe('Очень длинное слов...');
    expect(shortName('Тема урока номер 1 2').text).toBe('Тема урока номер 1...');
    // эмодзи не рвутся пополам
    expect(shortName('😀'.repeat(20))).toEqual({ text: `${'😀'.repeat(18)}...`, cut: true });
  });

  it('cleanName: пробелы по краям, лимит символов, пустое — подсказка', () => {
    expect(cleanName('  Дроби  ', PROJECT_NAME_MAX)).toBe('Дроби');
    expect(cleanName('   ', PROJECT_NAME_MAX, 'Проект 2')).toBe('Проект 2');
    expect(cleanName('а'.repeat(60), PROJECT_NAME_MAX)).toBe('а'.repeat(PROJECT_NAME_MAX));
  });

  it('defaultProjectName: «Проект n» с первым свободным номером', () => {
    expect(defaultProjectName([])).toBe('Проект 1');
    expect(defaultProjectName(['Дроби'])).toBe('Проект 2');
    expect(defaultProjectName(['Проект 1', 'Проект 2'])).toBe('Проект 3');
    expect(defaultProjectName(['Проект 2', 'Проект 3'])).toBe('Проект 4');
  });

  it('planNote: бесплатный — лимиты, Pro и «Репетитор» — без ограничений, лимиты выключены — ничего', () => {
    expect(planNote('free', true)).toBe('На бесплатном тарифе можно создать только 3 проекта и только 3 страницы в каждом из них.');
    expect(planNote('pro', true)).toContain('Pro');
    expect(planNote('tutor', true)).toContain('Репетитор');
    expect(planNote('free', false)).toBeNull();
  });

  it('plural: 1 проект, 2 проекта, 5 проектов, 11 проектов, 21 проект', () => {
    const f = (n: number) => plural(n, 'проект', 'проекта', 'проектов');
    expect([1, 2, 5, 11, 12, 21, 22, 25].map(f)).toEqual(['проект', 'проекта', 'проектов', 'проектов', 'проектов', 'проект', 'проекта', 'проектов']);
  });
});
