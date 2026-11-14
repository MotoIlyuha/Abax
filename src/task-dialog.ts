import type { TaskEl, TaskExamType, TaskSubject } from './types';
import { EXAM_LABELS, EXAM_TYPES, SUBJECTS, SUBJECT_LABELS } from './task-element';

// Форма задания: создание и правка карточки (предмет, экзамен, условие, ответ, единицы или код, решение).

export interface TaskFormValues {
  subject: TaskSubject;
  examType: TaskExamType;
  topic: string;
  statementMd: string;
  answer: string;
  answerUnit?: string;
  codeSnippet?: { lang: 'python' | 'cpp' | 'text'; code: string };
  solutionMd?: string;
}

const SUBJECT_TITLES: Record<TaskSubject, string> = { ...SUBJECT_LABELS, other: 'Другой предмет' };
const CODE_LANGS: { id: 'python' | 'cpp' | 'text'; title: string }[] = [
  { id: 'python', title: 'Python' }, { id: 'cpp', title: 'C++' }, { id: 'text', title: 'Текст' },
];

let open: { el: HTMLElement; close(): void } | null = null;

export function taskDialogOpen(): boolean {
  return open !== null;
}

function field(form: HTMLElement, label: string, control: HTMLElement, cls = ''): HTMLElement {
  const row = document.createElement('label');
  row.className = `td-field ${cls}`.trim();
  const t = document.createElement('span');
  t.className = 'td-label';
  t.textContent = label;
  row.append(t, control);
  form.appendChild(row);
  return row;
}

function input(value = '', placeholder = '', max = 200): HTMLInputElement {
  const i = document.createElement('input');
  i.type = 'text';
  i.value = value;
  i.placeholder = placeholder;
  i.maxLength = max;
  i.autocomplete = 'off';
  i.spellcheck = false;
  return i;
}

function area(value = '', rows = 3, placeholder = ''): HTMLTextAreaElement {
  const a = document.createElement('textarea');
  a.value = value;
  a.rows = rows;
  a.placeholder = placeholder;
  a.spellcheck = false;
  return a;
}

function select<T extends string>(items: { id: T; title: string }[], value: T): HTMLSelectElement {
  const s = document.createElement('select');
  for (const it of items) {
    const o = document.createElement('option');
    o.value = it.id;
    o.textContent = it.title;
    s.appendChild(o);
  }
  s.value = value;
  return s;
}

/** Окно формы; initial — правка существующего задания. onSave вызывается только с заполненными условием и ответом. */
export function openTaskDialog(initial: TaskEl | null, onSave: (v: TaskFormValues) => void): void {
  closeTaskDialog();
  const back = document.createElement('div');
  back.id = 'task-dialog';
  const win = document.createElement('div');
  win.className = 'td-window';
  win.setAttribute('role', 'dialog');
  win.setAttribute('aria-modal', 'true');
  win.setAttribute('aria-labelledby', 'td-title');
  const title = document.createElement('h2');
  title.id = 'td-title';
  title.textContent = initial ? 'Задание: правка' : 'Новое задание';
  const form = document.createElement('div');
  form.className = 'td-form';

  const subject = select(SUBJECTS.map(id => ({ id, title: SUBJECT_TITLES[id] })), initial?.subject ?? 'math');
  const exam = select(EXAM_TYPES.map(id => ({ id, title: EXAM_LABELS[id] })), initial?.examType ?? 'oge');
  const topic = input(initial?.topic ?? '', 'Например, «Проценты»', 80);
  const statement = area(initial?.statementMd ?? '', 5, 'Условие задачи');
  const answer = input(initial?.answer ?? '', 'Правильный ответ; несколько допустимых — через «|»', 200);
  const unit = input(initial?.answerUnit ?? '', 'м/с, кДж…', 20);
  const lang = select(CODE_LANGS, initial?.codeSnippet?.lang ?? 'python');
  const code = area(initial?.codeSnippet?.code ?? '', 6, 'Фрагмент кода');
  code.classList.add('td-mono');
  const solution = area(initial?.solutionMd ?? '', 3, 'Решение (ученик увидит его, только если вы откроете)');

  const pair = document.createElement('div');
  pair.className = 'td-pair';
  form.appendChild(pair);
  const addTo = (host: HTMLElement, label: string, control: HTMLElement, cls = '') => {
    const f = field(form, label, control, cls);
    host.appendChild(f);
    return f;
  };
  addTo(pair, 'Предмет', subject);
  addTo(pair, 'Экзамен', exam);
  addTo(form, 'Тема', topic);
  addTo(form, 'Условие', statement);
  const answerRow = document.createElement('div');
  answerRow.className = 'td-pair';
  form.appendChild(answerRow);
  addTo(answerRow, 'Правильный ответ', answer);
  const unitField = addTo(answerRow, 'Единицы измерения', unit, 'td-unit');
  const codeField = document.createElement('div');
  codeField.className = 'td-code';
  form.appendChild(codeField);
  addTo(codeField, 'Язык кода', lang);
  addTo(codeField, 'Код', code);
  addTo(form, 'Решение', solution);

  // единицы — у физики, код — у информатики; введённое при смене предмета не стирается
  const syncSubject = () => {
    unitField.hidden = subject.value !== 'physics' && unit.value === '';
    codeField.hidden = subject.value !== 'informatics' && code.value === '';
  };
  subject.addEventListener('change', syncSubject);
  syncSubject();

  const error = document.createElement('div');
  error.className = 'td-error';
  error.setAttribute('role', 'alert');
  error.hidden = true;
  const actions = document.createElement('div');
  actions.className = 'td-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'sd-btn';
  cancel.textContent = 'Отмена';
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'sd-btn td-save';
  save.textContent = initial ? 'Сохранить' : 'Добавить';
  actions.append(cancel, save);
  win.append(title, form, error, actions);
  back.appendChild(win);
  document.body.appendChild(back);
  const prevFocus = document.activeElement as HTMLElement | null;

  const close = () => {
    window.removeEventListener('keydown', onKey, true);
    back.remove();
    open = null;
    prevFocus?.focus?.();
  };
  const fail = (text: string, control: HTMLElement) => {
    error.textContent = text;
    error.hidden = false;
    control.focus();
  };
  const submit = () => {
    const statementMd = statement.value.trim();
    const answerText = answer.value.trim();
    if (statementMd === '') { fail('Напишите условие задания', statement); return; }
    if (answerText === '') { fail('Укажите правильный ответ', answer); return; }
    const values: TaskFormValues = {
      subject: subject.value as TaskSubject,
      examType: exam.value as TaskExamType,
      topic: topic.value.trim(),
      statementMd,
      answer: answerText,
    };
    if (unit.value.trim() !== '') values.answerUnit = unit.value.trim();
    if (code.value.trim() !== '') values.codeSnippet = { lang: lang.value as 'python' | 'cpp' | 'text', code: code.value.replace(/\s+$/, '') };
    if (solution.value.trim() !== '') values.solutionMd = solution.value.trim();
    close();
    onSave(values);
  };
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); }
    // Enter в однострочных полях — «Сохранить»; в многострочных — перенос строки
    else if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') { e.preventDefault(); submit(); }
    // остальные клавиши — форме, не доске
    else if (!e.ctrlKey && !e.metaKey && back.contains(e.target as Node)) e.stopPropagation();
  }
  window.addEventListener('keydown', onKey, true);
  cancel.addEventListener('click', close);
  save.addEventListener('click', submit);
  back.addEventListener('pointerdown', e => { if (e.target === back) close(); });
  open = { el: back, close };
  statement.focus();
}

export function closeTaskDialog(): void {
  open?.close();
}
