// Окно «Создать проект»: слева — выбор смайла (иконка проекта), справа — поля «Название проекта» и
// «Название страницы» с видимым лимитом символов (src/letter-limit.ts), под ними — пояснение тарифа.
// Подсказка-placeholder поля — имя по умолчанию: «Создать» с пустым полем даёт проект с этим именем.
// Форма (createProjectForm) общая с шагом «Создайте свой первый проект!» окна первого входа (src/onboarding.ts).
// Весь текст пользователя — через textContent; значки — константы.

import { CLOSE_ICON, ICONS } from './icons';
import { createIconButton } from './icon-button';
import { closeIconPicker, iconPickerOpen } from './icon-picker';
import { createLetterLimit, type LetterLimit } from './letter-limit';
import { motionEnabled, reduceMotion } from './motion';
import { NAME_FIELD_NEAR, PAGE_NAME_MAX, PROJECT_NAME_MAX, cleanName } from './project-names';

export interface ProjectFormValues {
  name: string;
  page: string;
  icon: string | null;
}

export interface ProjectFormOptions {
  /** Подсказки полей — они же имена по умолчанию. */
  namePlaceholder: string;
  pagePlaceholder: string;
  /** Начальные значения полей и смайла. */
  name?: string;
  page?: string;
  icon?: string | null;
  /** Пояснение тарифа под полями; null — без него. */
  planNote: string | null;
  /** Выделенная плашка «что такое страницы» (окно первого входа). */
  pagesNote?: boolean;
  /** Куда класть падающие буквы лишнего ввода и под каким элементом их кучка. */
  pileHost(): HTMLElement;
  floorEl(): HTMLElement;
  /** Enter в поле — как кнопка «Создать». */
  onEnter(): void;
}

export interface ProjectForm {
  el: HTMLElement;
  /** Что ввели: пустые поля — подсказки. */
  values(): ProjectFormValues;
  focus(): void;
  destroy(): void;
}

export const PAGES_NOTE = 'Проект — это набор страниц. Каждая страница — отдельная бесконечная доска: например, тема урока, задание или черновик. Переключаться между страницами можно внизу экрана.';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Поле с подписью и лимитом символов. */
function limitedField(caption: string, cls: string, placeholder: string, limit: number, o: ProjectFormOptions): { label: HTMLElement; input: HTMLInputElement; limit: LetterLimit } {
  const label = el('label', 'ob-field pd-field');
  const input = el('input', `ob-limit-input ${cls}`);
  input.type = 'text';
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.placeholder = placeholder;
  // без maxLength: лишнее не блокируется, а отрезается и падает буквами (src/letter-limit.ts)
  const l = createLetterLimit({ input, limit, near: NAME_FIELD_NEAR, pileHost: o.pileHost, floorEl: o.floorEl });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); o.onEnter(); }
  });
  label.append(el('span', 'ob-caption', caption), l.el);
  return { label, input, limit: l };
}

export function createProjectForm(o: ProjectFormOptions): ProjectForm {
  const root = el('div', 'pd-form');
  let icon = o.icon ?? null;
  const iconBtn = createIconButton({
    className: 'project-icon pd-icon',
    value: icon,
    title: v => (v ? 'Сменить иконку проекта' : 'Выбрать смайл проекта'),
    picker: { overDialog: true, label: 'Иконка проекта' },
    onPick: v => { icon = v; },
  });
  iconBtn.el.setAttribute('aria-label', 'Иконка проекта');
  const fields = el('div', 'pd-fields');
  const name = limitedField('Название проекта', 'pd-name', o.namePlaceholder, PROJECT_NAME_MAX, o);
  const page = limitedField('Название страницы', 'pd-page', o.pagePlaceholder, PAGE_NAME_MAX, o);
  name.limit.set(o.name ?? '', false);
  page.limit.set(o.page ?? '', false);
  fields.append(name.label, page.label);
  const row = el('div', 'pd-row');
  row.append(iconBtn.el, fields);
  root.appendChild(row);
  if (o.pagesNote) {
    const note = el('div', 'pd-pages-note');
    note.setAttribute('role', 'note');
    const mark = el('span', 'pd-pages-mark');
    mark.innerHTML = ICONS.pages; // константа значка
    note.append(mark, el('span', 'pd-pages-text', PAGES_NOTE));
    root.appendChild(note);
  }
  if (o.planNote) root.appendChild(el('p', 'pd-plan', o.planNote));
  return {
    el: root,
    values: () => ({
      name: cleanName(name.input.value, PROJECT_NAME_MAX, o.namePlaceholder),
      page: cleanName(page.input.value, PAGE_NAME_MAX, o.pagePlaceholder),
      icon,
    }),
    focus: () => name.input.focus({ preventScroll: true }),
    destroy: () => { name.limit.destroy(); page.limit.destroy(); },
  };
}

export interface ProjectDialogOptions {
  title?: string;
  submitLabel?: string;
  namePlaceholder: string;
  pagePlaceholder: string;
  planNote: string | null;
  /** «Создать»: окно закрывается до вызова. */
  onSubmit(values: ProjectFormValues): void;
}

let current: { root: HTMLElement; close(): void } | null = null;

export function projectDialogOpen(): boolean {
  return current !== null;
}

/** Закрыть окно без создания (для тестов и смены вида). */
export function closeProjectDialog(): void {
  current?.close();
}

export function openProjectDialog(o: ProjectDialogOptions): void {
  if (current) return;
  const root = el('div');
  root.id = 'project-dialog';
  if (reduceMotion() || !motionEnabled()) root.classList.add('pd-instant');
  const win = el('div', 'pd-window');
  win.setAttribute('role', 'dialog');
  win.setAttribute('aria-modal', 'true');
  const title = el('h2', 'ob-title pd-title', o.title ?? 'Создать проект');
  title.id = 'project-dialog-title';
  win.setAttribute('aria-labelledby', title.id);
  const closeBtn = el('button', 'ob-close');
  closeBtn.type = 'button';
  closeBtn.title = 'Закрыть';
  closeBtn.setAttribute('aria-label', 'Закрыть');
  closeBtn.innerHTML = CLOSE_ICON;
  const form = createProjectForm({
    namePlaceholder: o.namePlaceholder, pagePlaceholder: o.pagePlaceholder, planNote: o.planNote,
    pileHost: () => root, floorEl: () => win, onEnter: submit,
  });
  const actions = el('div', 'pd-actions');
  const cancel = el('button', 'ob-btn pd-cancel', 'Отмена');
  cancel.type = 'button';
  const create = el('button', 'ob-btn ob-primary pd-create', o.submitLabel ?? 'Создать');
  create.type = 'button';
  actions.append(cancel, create);
  win.append(closeBtn, title, form.el, actions);
  root.appendChild(win);

  function submit(): void {
    const v = form.values();
    close();
    o.onSubmit(v);
  }

  function close(): void {
    if (current?.root !== root) return;
    current = null;
    closeIconPicker(true);
    form.destroy();
    window.removeEventListener('keydown', onOutsideKey, true);
    root.remove();
  }

  function trapFocus(e: KeyboardEvent): void {
    const items = [...win.querySelectorAll<HTMLElement>('button, input')].filter(x => !(x as HTMLButtonElement).disabled);
    const first = items[0], last = items[items.length - 1];
    const cur = document.activeElement;
    if (!win.contains(cur)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && cur === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && cur === last) { e.preventDefault(); first.focus(); }
  }

  /** Esc, пришедший при открытом окне смайлов, закрывает только его (окно закроется раньше, чем Esc дойдёт сюда). */
  let escForPicker = false;

  // Клавиши окна: Esc — отмена, Tab — по кругу; к доске ничего не уходит
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') { e.preventDefault(); if (!escForPicker) close(); }
    else if (e.key === 'Tab') trapFocus(e);
    e.stopPropagation();
  }

  /** Клавиша не из окна: окно выбора смайла разбирает свои клавиши само, остальное доске не отдаём. */
  function onOutsideKey(e: KeyboardEvent): void {
    escForPicker = e.key === 'Escape' && iconPickerOpen();
    if (e.target instanceof Node && root.contains(e.target)) return;
    if (iconPickerOpen() || (e.target instanceof Element && e.target.closest('[data-own-keys]'))) return;
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab') { e.preventDefault(); form.focus(); }
  }

  closeBtn.addEventListener('click', close);
  cancel.addEventListener('click', close);
  create.addEventListener('click', submit);
  // клик по затемнению — отмена (но не конец выделения текста, начатого в поле)
  let downOnScrim = false;
  root.addEventListener('pointerdown', e => { downOnScrim = e.target === root; });
  root.addEventListener('click', e => { if (e.target === root && downOnScrim) close(); });
  root.addEventListener('keydown', onKey);
  window.addEventListener('keydown', onOutsideKey, true);
  document.body.appendChild(root);
  current = { root, close };
  form.focus();
}

/** Шаг «Создайте свой первый проект!» окна первого входа: что показать и куда отдать введённое. */
export interface FirstProjectStep {
  namePlaceholder: string;
  pagePlaceholder: string;
  icon: string | null;
  planNote: string | null;
  /** «Создать»: проект не создаётся — переименовывается стартовый. */
  apply(values: ProjectFormValues): void;
}
