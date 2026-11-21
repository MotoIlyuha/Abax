// Окно «Создать проект»: поля с подсказками-именами по умолчанию, смайл слева, текст тарифа, клавиши.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeProjectDialog, openProjectDialog, projectDialogOpen } from '../../src/project-dialog';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function key(target: HTMLElement, k: string): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
}

const open = (onSubmit = vi.fn(), planNote: string | null = 'На бесплатном тарифе…') => {
  openProjectDialog({ namePlaceholder: 'Проект 4', pagePlaceholder: 'Страница 1', planNote, onSubmit });
  return onSubmit;
};

beforeEach(() => { document.body.innerHTML = ''; });
afterEach(() => { closeProjectDialog(); });

describe('окно «Создать проект»', () => {
  it('заголовок, смайл слева от поля названия, подсказки, текст тарифа; фокус - в названии', () => {
    open();
    expect(projectDialogOpen()).toBe(true);
    expect($('.pd-title').textContent).toBe('Создать проект');
    const row = $('.pd-name-row');
    expect(row.firstElementChild!.classList.contains('pd-icon')).toBe(true);
    expect(row.contains($('.pd-name'))).toBe(true);
    // подпись связана с полем, а не с кнопкой смайла
    expect($<HTMLLabelElement>('.pd-field .ob-caption').htmlFor).toBe($('.pd-name').id);
    expect($<HTMLInputElement>('.pd-name').placeholder).toBe('Проект 4');
    expect($<HTMLInputElement>('.pd-page').placeholder).toBe('Страница 1');
    expect($('.pd-plan').textContent).toBe('На бесплатном тарифе…');
    expect(document.activeElement).toBe($('.pd-name'));
    // плашка о страницах — только в окне первого входа
    expect(document.querySelector('.pd-pages-note')).toBeNull();
  });

  it('«Создать» с пустыми полями - имена из подсказок; окно закрыто', () => {
    const submit = open();
    $('.pd-create').click();
    expect(submit).toHaveBeenCalledWith({ name: 'Проект 4', page: 'Страница 1', icon: null });
    expect(projectDialogOpen()).toBe(false);
    expect(document.getElementById('project-dialog')).toBeNull();
  });

  it('введённое обрезается по лимиту символов; Enter - «Создать»', () => {
    const submit = open();
    type($<HTMLInputElement>('.pd-name'), '  Дроби  ');
    type($<HTMLInputElement>('.pd-page'), 'я'.repeat(100));
    key($('.pd-page'), 'Enter');
    expect(submit).toHaveBeenCalledOnce();
    const v = submit.mock.calls[0][0] as { name: string; page: string };
    expect(v.name).toBe('Дроби');
    expect(Array.from(v.page).length).toBeLessThanOrEqual(40);
  });

  it('Esc, «Отмена» и крестик закрывают без создания; клавиши не уходят к доске', () => {
    const board = vi.fn();
    window.addEventListener('keydown', board);
    const submit = open();
    key($('.pd-name'), 'Delete');
    expect(board).not.toHaveBeenCalled();
    key($('.pd-name'), 'Escape');
    expect(projectDialogOpen()).toBe(false);
    open(submit);
    $('.pd-cancel').click();
    expect(projectDialogOpen()).toBe(false);
    open(submit);
    $('#project-dialog .ob-close').click();
    expect(projectDialogOpen()).toBe(false);
    expect(submit).not.toHaveBeenCalled();
    window.removeEventListener('keydown', board);
  });

  it('без пояснения тарифа - абзаца нет', () => {
    open(vi.fn(), null);
    expect(document.querySelector('.pd-plan')).toBeNull();
  });
});
