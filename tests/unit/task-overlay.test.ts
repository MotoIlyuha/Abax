// Контролы поверх карточек заданий и форма задания (DOM без холста).
import { beforeEach, describe, expect, it } from 'vitest';
import { initTaskOverlay, isTeacher, sync } from '../../src/task-overlay';
import { openTaskDialog, closeTaskDialog, taskDialogOpen, type TaskFormValues } from '../../src/task-dialog';
import { createTaskElement } from '../../src/task-element';
import { addElement, blankProject, canUndo, insertCopies, openProject, selectedElements, setSelection, state, undo } from '../../src/state';
import type { TaskEl } from '../../src/types';

const task = (extra: Partial<TaskEl> = {}): TaskEl =>
  createTaskElement({ x: 100, y: 50, taskId: 't1', statementMd: 'Найдите 1/4 + 1/2', answer: '0,75', id: 'task', ...extra });
const panel = () => document.querySelector<HTMLElement>('.task-panel');
const input = () => document.querySelector<HTMLInputElement>('.task-input')!;
const click = (el: Element | null) => (el as HTMLElement).click();
const typeText = (i: HTMLInputElement, text: string) => { i.value = text; i.dispatchEvent(new Event('input', { bubbles: true })); };
const key = (i: HTMLElement, k: string) => i.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
const cur = () => state.board.elements[0] as unknown as TaskEl;

let host: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '<div id="canvas-wrap"><div id="task-overlay"></div></div>';
  host = document.getElementById('task-overlay')!;
  Object.defineProperty(host, 'clientWidth', { configurable: true, value: 1000 });
  Object.defineProperty(host, 'clientHeight', { configurable: true, value: 700 });
  openProject(blankProject('Тест'));
  state.collabRole = null;
  state.linkMode = null;
  state.camera = { x: 0, y: 0, zoom: 1 };
  state.view = 'board';
  initTaskOverlay(() => {});
});

describe('расстановка контролов', () => {
  it('панель встаёт на карточку и масштабируется с камерой', () => {
    addElement(task());
    sync();
    const p = panel()!;
    expect(p.style.transform).toBe('translate(100px, 50px) scale(1)');
    expect(p.style.width).toBe('360px');
    state.camera = { x: 50, y: 10, zoom: 2 };
    sync();
    expect(panel()!.style.transform).toBe('translate(100px, 80px) scale(2)');
  });

  it('мелкий масштаб, чужая страница и карточка за краем экрана — без панели', () => {
    addElement(task());
    state.camera = { x: 0, y: 0, zoom: 0.4 };
    sync();
    expect(panel()).toBeNull();
    state.camera = { x: 0, y: 0, zoom: 1 };
    sync();
    expect(panel()).not.toBeNull();
    state.camera = { x: 5000, y: 0, zoom: 1 };
    sync();
    expect(panel()).toBeNull();
    state.camera = { x: 0, y: 0, zoom: 1 };
    state.view = 'home';
    sync();
    expect(panel()).toBeNull();
  });

  it('панели убираются вместе с заданием и не плодятся', () => {
    addElement(task());
    sync(); sync();
    expect(document.querySelectorAll('.task-panel')).toHaveLength(1);
    setSelection(['task']);
    state.board.elements = [];
    sync();
    expect(panel()).toBeNull();
  });
});

describe('ответ у автора и зрителя без сети', () => {
  it('ввод сохраняется черновиком мимо истории; Enter проверяет, верный ответ — «Верно!»', () => {
    addElement(task());
    undo();
    addElement(task());
    sync();
    // ответ сам в историю не пишется
    const before = canUndo();
    typeText(input(), '0,7');
    expect(cur().studentDraft).toBe('0,7');
    expect(canUndo()).toBe(before);
    typeText(input(), '0.5');
    key(input(), 'Enter');
    expect(cur().attempts!.map(a => a.isCorrect)).toEqual([false]);
    expect(cur().studentDraft).toBeUndefined();
    sync();
    expect(document.querySelector('.task-result')!.textContent).toBe('Неверно (попыток: 1)');
    typeText(input(), ' 0.750 ');
    click(document.querySelector('.task-check'));
    sync();
    expect(cur().attempts!.map(a => a.isCorrect)).toEqual([false, true]);
    expect(document.querySelector('.task-result')!.textContent).toBe('Верно!');
    expect(document.querySelector('.task-result')!.classList.contains('ok')).toBe(true);
    expect(input().value).toBe('');
  });

  it('пустой ответ не проверяется; единицы показываются бейджем', () => {
    addElement(task({ answerUnit: 'м/с', answer: '5' }));
    sync();
    expect(document.querySelector<HTMLElement>('.task-unit')!.textContent).toBe('м/с');
    key(input(), 'Enter');
    expect(cur().attempts).toBeUndefined();
    typeText(input(), '5 м/с');
    key(input(), 'Enter');
    expect(cur().attempts![0].isCorrect).toBe(true);
  });

  it('значение поля не затирается входящим черновиком, пока поле в фокусе', () => {
    addElement(task());
    sync();
    document.body.appendChild(input().closest('.task-panel')!); // в документе, чтобы фокус сработал
    input().focus();
    input().value = 'мой';
    state.board.elements = state.board.elements.map(e => ({ ...e, studentDraft: 'чужой' }) as never);
    sync();
    expect(input().value).toBe('мой');
    input().blur();
    sync();
    expect(input().value).toBe('чужой');
  });

  it('текст из сети попадает только как текст, не как разметка', () => {
    addElement(task({ studentDraft: '<img src=x onerror=1>', answerUnit: '<b>x</b>' }));
    sync();
    click(document.querySelector('.task-more'));
    expect(document.querySelector('.task-details img, .task-unit b, .task-details b')).toBeNull();
    expect(document.querySelector('.task-live-value')!.textContent).toBe('<img src=x onerror=1>');
  });
});

describe('учитель и ученик', () => {
  it('учитель: ввод ученика, попытки, переключатели «Решение ученику» и «Сложное» с историей', () => {
    addElement(task({ solutionMd: 'Сложить дроби', studentDraft: '0,7', attempts: [{ value: '1', timestamp: 1, isCorrect: false }] }));
    sync();
    expect(isTeacher()).toBe(true);
    click(document.querySelector('.task-more'));
    expect(document.querySelector('.task-live-value')!.textContent).toBe('0,7');
    expect(document.querySelector('.task-attempts li')!.textContent).toContain('✗ 1');
    // решение у учителя скрыто, пока он не нажмёт «Показать решение у себя»
    expect(document.querySelector('.task-solution')).toBeNull();
    click(document.querySelector('.task-peek'));
    expect(document.querySelector('.task-solution-text')!.textContent).toBe('Сложить дроби');
    click(document.querySelector('.task-hard'));
    expect(cur().markedHard).toBe(true);
    click(document.querySelector('.task-solution-toggle'));
    expect(cur().solutionVisibleToStudent).toBe(true);
    expect(document.querySelector('.task-solution-toggle')!.textContent).toBe('Решение видно ученику');
    undo();
    expect(cur().solutionVisibleToStudent).toBeUndefined();
    expect(cur().markedHard).toBe(true);
    click(document.querySelector('.task-hard'));
    expect(cur().markedHard).toBeUndefined();
  });

  it('ученик: без блока учителя; решение — только если хаб его прислал; поле недоступно без связи', () => {
    state.collabRole = 'guest';
    addElement(task({ answer: '', solutionMd: 'Решение от автора' }));
    sync();
    expect(isTeacher()).toBe(false);
    expect(input().disabled).toBe(true);
    click(document.querySelector('.task-more'));
    expect(document.querySelector('.task-live')).toBeNull();
    expect(document.querySelector('.task-actions')).toBeNull();
    expect(document.querySelector('.task-solution-text')!.textContent).toBe('Решение от автора');
    // без связи ответ не принимается и не пишется в доску
    typeText(input(), 'х');
    expect(cur().studentDraft).toBeUndefined();
  });

  it('код: открыт сразу, копируется; при запрете копирования — тост', () => {
    addElement(task({ subject: 'informatics', codeSnippet: { lang: 'python', code: 'print(1)' } }));
    sync();
    expect(document.querySelector('.task-code-body')!.textContent).toBe('print(1)');
    expect(document.querySelector('.task-code-lang')!.textContent).toBe('Python');
    let copied = '';
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (t: string) => { copied = t; return Promise.resolve(); } } });
    click(document.querySelector('.task-code-copy'));
    expect(copied).toBe('print(1)');
    // зритель по ссылке на проекте Pro, где автор запретил копирование
    state.project.ownerPlan = 'pro';
    state.project.permissions = { allowCopy: false };
    state.linkMode = 'view-project';
    sync();
    copied = '';
    click(document.querySelector('.task-code-copy'));
    expect(copied).toBe('');
    expect(document.getElementById('toast')!.textContent).toBe('Автор запретил копирование');
    expect(document.querySelector('.task-actions')).toBeNull(); // зритель не учитель
  });
});

describe('копия задания', () => {
  it('новое задание: свой taskId, без попыток, ввода и пометки «сложное»', () => {
    addElement(task({ markedHard: true, studentDraft: 'x', attempts: [{ value: '1', timestamp: 1, isCorrect: true }] }));
    setSelection(['task']);
    const copies = insertCopies(selectedElements(), 20, 20);
    const c = copies[0] as unknown as TaskEl;
    expect(c.id).not.toBe('task');
    expect(c.taskId).not.toBe('t1');
    expect(c).not.toHaveProperty('attempts');
    expect(c).not.toHaveProperty('studentDraft');
    expect(c).not.toHaveProperty('markedHard');
    expect(c).toMatchObject({ answer: '0,75', statementMd: 'Найдите 1/4 + 1/2', x: 120, y: 70 });
    expect(cur().attempts).toHaveLength(1); // оригинал не тронут
  });
});

describe('форма задания', () => {
  const fill = (sel: string, value: string) => {
    const e = document.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(sel)!;
    e.value = value;
    e.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const field = (label: string) => [...document.querySelectorAll('.td-field')].find(f => f.querySelector('.td-label')!.textContent === label)!;
  const control = (label: string) => field(label).querySelector('input, textarea, select') as HTMLInputElement;

  it('без условия и ответа не сохраняется, с ними — отдаёт значения; Esc закрывает', () => {
    let got: TaskFormValues | null = null;
    openTaskDialog(null, v => { got = v; });
    expect(taskDialogOpen()).toBe(true);
    click(document.querySelector('.td-save'));
    expect(document.querySelector('.td-error')!.textContent).toBe('Напишите условие задания');
    control('Условие').value = '  Найдите x  ';
    click(document.querySelector('.td-save'));
    expect(document.querySelector('.td-error')!.textContent).toBe('Укажите правильный ответ');
    control('Правильный ответ').value = ' 5 ';
    control('Предмет').value = 'physics';
    control('Предмет').dispatchEvent(new Event('change'));
    expect(field('Единицы измерения').hasAttribute('hidden')).toBe(false);
    control('Единицы измерения').value = 'м/с';
    control('Тема').value = 'Кинематика';
    control('Решение').value = 'v = s/t';
    click(document.querySelector('.td-save'));
    expect(got).toEqual({
      subject: 'physics', examType: 'oge', topic: 'Кинематика', statementMd: 'Найдите x', answer: '5',
      answerUnit: 'м/с', solutionMd: 'v = s/t',
    });
    expect(taskDialogOpen()).toBe(false);

    openTaskDialog(null, () => { throw new Error('не должно сохраниться'); });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(taskDialogOpen()).toBe(false);
    void fill;
  });

  it('правка подставляет значения задания; код у информатики; поля единиц нет у математики', () => {
    const el = task({ subject: 'informatics', examType: 'ege_prof', topic: 'Циклы', codeSnippet: { lang: 'cpp', code: 'int main() {}' }, solutionMd: 'решение' });
    let got: TaskFormValues | null = null;
    openTaskDialog(el, v => { got = v; });
    expect(document.querySelector('.td-window h2')!.textContent).toBe('Задание: правка');
    expect(control('Условие').value).toBe('Найдите 1/4 + 1/2');
    expect(control('Экзамен').value).toBe('ege_prof');
    expect(control('Код').value).toBe('int main() {}');
    expect(control('Язык кода').value).toBe('cpp');
    expect(document.querySelector('.td-code')!.hasAttribute('hidden')).toBe(false);
    expect(field('Единицы измерения').hasAttribute('hidden')).toBe(true);
    click(document.querySelector('.td-save'));
    expect(got).toMatchObject({ subject: 'informatics', codeSnippet: { lang: 'cpp', code: 'int main() {}' }, solutionMd: 'решение' });
    expect(got).not.toHaveProperty('answerUnit');
    closeTaskDialog();
  });

  it('Enter в однострочном поле сохраняет, в условии — переносит строку', () => {
    let got: TaskFormValues | null = null;
    openTaskDialog(null, v => { got = v; });
    control('Условие').value = 'У';
    control('Правильный ответ').value = '1';
    key(control('Условие'), 'Enter');
    expect(got).toBeNull();
    key(control('Правильный ответ'), 'Enter');
    expect(got).not.toBeNull();
  });
});
