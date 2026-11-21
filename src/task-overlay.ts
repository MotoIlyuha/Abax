import type { Element, TaskEl } from './types';
import { canCopyCurrentBoard, onChange, pushHistory, replaceElements, state } from './state';
import { myCollabCaps, sendTaskDraft, sendTaskSubmit, taskInputOnline } from './collab';
import { submitTaskAttempt, taskStatus, toggleTaskHardFlag, updateStudentDraft } from './task-element';
import { showToast } from './about';

// Живые контролы поверх карточек заданий: поле ответа, «Проверить», результат, код, решение.
// Карточку рисует холст (renderer.ts); здесь — DOM, который следует за камерой и масштабируется вместе с ней.

/** Ниже этого масштаба контролы не показываются: карточка слишком мелкая. */
export const OVERLAY_ZOOM_MIN = 0.5;
const ATTEMPTS_SHOWN = 5;

interface Panel {
  root: HTMLElement;
  input: HTMLInputElement;
  unit: HTMLElement;
  check: HTMLButtonElement;
  result: HTMLElement;
  more: HTMLButtonElement;
  details: HTMLElement;
  detailsKey: string;
  /** Автор открыл решение для себя. */
  showSolution: boolean;
}

const panels = new Map<string, Panel>();
/** Раскрыта ли панель под карточкой; нет записи — раскрыта, только если в задании есть код. */
const detailsState = new Map<string, boolean>();
const isOpen = (el: TaskEl): boolean => detailsState.get(el.id) ?? el.codeSnippet !== undefined;
let host: HTMLElement | null = null;
let editTask: (el: TaskEl) => void = () => {};

/** Учитель: автор своей доски или хост комнаты; не ученик в комнате и не зритель по ссылке. */
export function isTeacher(): boolean {
  return state.collabRole !== 'guest' && state.linkMode === null;
}

const tasksOnPage = (): TaskEl[] => state.board.elements.filter((e): e is TaskEl & Element => e.type === 'task') as TaskEl[];

/** Правка задания: свои действия учителя — в историю, ввод ученика — мимо неё. */
function change(id: string, fn: (el: TaskEl) => TaskEl, history: boolean): void {
  const prev = state.board.elements;
  const next = prev.map(e => (e.id === id && e.type === 'task' ? fn(e) as Element : e));
  if (next.every((e, i) => e === prev[i])) return;
  if (history) pushHistory(prev);
  replaceElements(next);
}

function make(el: HTMLElement | null, tag: string, cls: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  el?.appendChild(e);
  return e;
}

function find(id: string): TaskEl | undefined {
  return tasksOnPage().find(t => t.id === id);
}

function submit(id: string, p: Panel): void {
  const value = p.input.value.trim();
  if (value === '') return;
  const el = find(id);
  if (!el) return;
  p.input.value = '';
  // в комнате ответ проверяет хаб (у него настоящий ответ); у себя — сами
  if (sendTaskSubmit(state.pageId, id, value)) return;
  if (state.collabRole === 'guest') return;
  change(id, t => updateStudentDraft(submitTaskAttempt(t, value).updated, ''), false);
}

function buildPanel(id: string): Panel {
  const root = make(null, 'div', 'task-panel');
  root.dataset.id = id;
  const foot = make(root, 'div', 'task-foot');
  const input = make(foot, 'input', 'task-input') as HTMLInputElement;
  input.type = 'text';
  input.placeholder = 'Ответ...';
  input.maxLength = 200;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('aria-label', 'Ответ');
  const unit = make(foot, 'span', 'task-unit');
  const check = make(foot, 'button', 'task-check', 'Проверить') as HTMLButtonElement;
  check.type = 'button';
  const result = make(foot, 'span', 'task-result');
  const more = make(foot, 'button', 'task-more', '▾') as HTMLButtonElement;
  more.type = 'button';
  more.title = 'Подробнее';
  const details = make(root, 'div', 'task-details');
  details.hidden = true;
  const p: Panel = { root, input, unit, check, result, more, details, detailsKey: '', showSolution: false };

  input.addEventListener('input', () => {
    if (!sendTaskDraft(state.pageId, id, input.value) && state.collabRole !== 'guest') {
      change(id, t => updateStudentDraft(t, input.value), false);
    }
  });
  input.addEventListener('keydown', e => {
    e.stopPropagation(); // Enter и буквы — не горячие клавиши доски
    if (e.key === 'Enter') { e.preventDefault(); submit(id, p); }
    if (e.key === 'Escape') input.blur();
  });
  check.addEventListener('click', () => submit(id, p));
  more.addEventListener('click', () => {
    const el = find(id);
    if (el) detailsState.set(id, !isOpen(el));
    sync();
  });
  // нажатия на контролы не должны попадать на холст под ними
  for (const type of ['pointerdown', 'dblclick', 'contextmenu'] as const) root.addEventListener(type, e => e.stopPropagation());
  return p;
}

function attemptTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function copyCode(code: string): void {
  if (!canCopyCurrentBoard()) { showToast('Автор запретил копирование'); return; }
  navigator.clipboard.writeText(code).then(() => showToast('Код скопирован'), () => showToast('Не удалось скопировать код'));
}

/** Содержимое раскрывающейся панели; пересобирается, только если изменилось то, что в ней показано. */
function renderDetails(p: Panel, el: TaskEl, teacher: boolean): void {
  const key = JSON.stringify([
    teacher, el.codeSnippet ?? null, el.solutionMd ?? null, el.solutionVisibleToStudent ?? false, el.markedHard ?? false,
    p.showSolution, teacher ? el.studentDraft ?? '' : '', teacher ? (el.attempts ?? []).slice(-ATTEMPTS_SHOWN) : (el.attempts ?? []).length,
  ]);
  if (key === p.detailsKey) return;
  p.detailsKey = key;
  const d = p.details;
  d.textContent = '';
  if (el.codeSnippet) {
    const box = make(d, 'div', 'task-code');
    const head = make(box, 'div', 'task-code-head');
    make(head, 'span', 'task-code-lang', el.codeSnippet.lang === 'cpp' ? 'C++' : el.codeSnippet.lang === 'python' ? 'Python' : 'Текст');
    const copy = make(head, 'button', 'task-code-copy', 'Скопировать код') as HTMLButtonElement;
    copy.type = 'button';
    const code = el.codeSnippet.code;
    copy.addEventListener('click', () => copyCode(code));
    make(box, 'pre', 'task-code-body', code);
  }
  const solution = el.solutionMd;
  if (solution && (teacher ? p.showSolution : true)) {
    const box = make(d, 'div', 'task-solution');
    make(box, 'div', 'task-solution-title', 'Решение');
    make(box, 'div', 'task-solution-text', solution);
  }
  if (teacher) {
    const live = make(d, 'div', 'task-live');
    make(live, 'span', 'task-live-label', 'Ученик вводит: ');
    make(live, 'span', 'task-live-value', el.studentDraft || '-');
    const attempts = (el.attempts ?? []).slice(-ATTEMPTS_SHOWN).reverse();
    if (attempts.length > 0) {
      const list = make(d, 'ul', 'task-attempts');
      for (const a of attempts) {
        const li = make(list, 'li', a.isCorrect ? 'ok' : 'bad');
        li.textContent = `${a.isCorrect ? '✓' : '✗'} ${a.value} · ${attemptTime(a.timestamp)}`;
      }
    }
    const row = make(d, 'div', 'task-actions');
    const toggle = (label: string, on: boolean, fn: () => void, cls: string) => {
      const b = make(row, 'button', `task-toggle ${cls}${on ? ' on' : ''}`, label) as HTMLButtonElement;
      b.type = 'button';
      b.setAttribute('aria-pressed', String(on));
      b.addEventListener('click', fn);
    };
    if (solution) {
      toggle(p.showSolution ? 'Скрыть решение у себя' : 'Показать решение у себя', p.showSolution, () => {
        p.showSolution = !p.showSolution;
        sync();
      }, 'task-peek');
    }
    toggle(el.solutionVisibleToStudent ? 'Решение видно ученику' : 'Показать решение ученику', !!el.solutionVisibleToStudent, () => {
      change(el.id, t => {
        if (t.solutionVisibleToStudent) { const { solutionVisibleToStudent: _s, ...rest } = t; return rest; }
        return { ...t, solutionVisibleToStudent: true };
      }, true);
    }, 'task-solution-toggle');
    toggle('Сложное', !!el.markedHard, () => change(el.id, toggleTaskHardFlag, true), 'task-hard');
    const edit = make(row, 'button', 'task-toggle task-edit', 'Редактировать') as HTMLButtonElement;
    edit.type = 'button';
    edit.addEventListener('click', () => { const t = find(el.id); if (t) editTask(t); });
  }
}

function update(p: Panel, el: TaskEl): void {
  const teacher = isTeacher();
  const online = taskInputOnline();
  // ответ без сети возможен у автора и у зрителя по ссылке; ученик в комнате отвечает через хаб; читатель — не отвечает
  const reader = state.collabRole === 'guest' && myCollabCaps()?.comment === false;
  const canAnswer = !reader && (state.collabRole !== 'guest' || online);
  p.input.disabled = !canAnswer;
  p.check.disabled = !canAnswer;
  p.input.title = reader ? 'Читатели не отвечают на задания' : canAnswer ? '' : 'Ответ сейчас недоступен: нет связи с автором';
  if (document.activeElement !== p.input) {
    const draft = el.studentDraft ?? '';
    if (p.input.value !== draft) p.input.value = draft;
  }
  p.unit.textContent = el.answerUnit ?? '';
  p.unit.hidden = !el.answerUnit;
  const attempts = el.attempts ?? [];
  const last = attempts[attempts.length - 1];
  p.result.className = `task-result${last ? (last.isCorrect ? ' ok' : ' bad') : ''}`;
  p.result.textContent = !last ? '' : taskStatus(el) === 'solved' && last.isCorrect ? 'Верно!' : `Неверно (попыток: ${attempts.length})`;
  p.result.hidden = !last;
  const open = isOpen(el);
  p.details.hidden = !open;
  p.more.classList.toggle('open', open);
  p.more.setAttribute('aria-expanded', String(open));
  if (open) renderDetails(p, el, teacher);
}

/** Расставляет контролы по видимым карточкам; остальные убирает. */
export function sync(): void {
  if (!host) return;
  const cam = state.camera;
  const z = cam.zoom;
  const w = host.clientWidth;
  const h = host.clientHeight;
  const show = state.view === 'board' && z >= OVERLAY_ZOOM_MIN && !state.layerPreview;
  const seen = new Set<string>();
  if (show) {
    for (const el of tasksOnPage()) {
      const sx = (el.x - cam.x) * z;
      const sy = (el.y - cam.y) * z;
      if (sx > w || sy > h || sx + el.w * z < 0 || sy + el.h * z < 0) continue;
      seen.add(el.id);
      let p = panels.get(el.id);
      if (!p) {
        p = buildPanel(el.id);
        panels.set(el.id, p);
        host.appendChild(p.root);
      }
      p.root.style.width = `${el.w}px`;
      p.root.style.height = `${el.h}px`;
      p.root.style.transform = `translate(${sx}px, ${sy}px) scale(${z})`;
      update(p, el);
    }
  }
  for (const [id, p] of panels) {
    if (seen.has(id)) continue;
    p.root.remove();
    panels.delete(id);
  }
}

/** Подключает оверлей: edit — как открыть форму правки задания. */
export function initTaskOverlay(edit: (el: TaskEl) => void): void {
  host = document.getElementById('task-overlay');
  editTask = edit;
  panels.clear();
  detailsState.clear();
  onChange(sync);
  window.addEventListener('resize', sync);
  sync();
}

