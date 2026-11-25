import { BANK_EXAMS, bankNumbers, filterBankTasks, type BankExam, type BankTask } from './fipi-bank';
import { reduceMotion } from './motion';
import { createTabPill } from './tab-pill';

function make<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(cls: string, text: string): HTMLButtonElement {
  const node = make('button', cls, text);
  node.type = 'button';
  return node;
}

/** Формулы из банка остаются текстом. Дроби и индексы получают отдельные безопасные узлы. */
function formulaText(host: HTMLElement, text: string): void {
  const tokens = /\(([^()\n]+)\)\/\(([^()\n]+)\)|(\d+)\/(\d+)|([_^])\(([^()\n]+)\)/g;
  let from = 0;
  for (const token of text.matchAll(tokens)) {
    const [value, numLong, denLong, num, den, marker, index] = token;
    host.append(text.slice(from, token.index));
    from = token.index + value.length;
    if (marker) {
      host.append(make(marker === '^' ? 'sup' : 'sub', '', index));
    } else {
      const fraction = make('span', 'task-bank-fraction');
      fraction.append(make('span', '', numLong ?? num), make('span', '', denLong ?? den));
      fraction.setAttribute('role', 'math');
      fraction.setAttribute('aria-label', (numLong ?? num) + ' делить на ' + (denLong ?? den));
      host.append(fraction);
    }
  }
  host.append(text.slice(from));
}

function statement(text: string): HTMLElement {
  const root = make('div', 'task-bank-statement');
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split('\n');
    if (lines.length > 1 && lines.every(line => line.includes(' | '))) {
      const table = make('table', '');
      for (const [i, line] of lines.entries()) {
        const row = table.insertRow();
        for (const value of line.split(' | ')) {
          const cell = make(i === 0 ? 'th' : 'td', '');
          if (i === 0) cell.scope = 'col';
          formulaText(cell, value);
          row.append(cell);
        }
      }
      const container = make('div', 'task-bank-table');
      container.append(table);
      root.append(container);
    } else {
      const paragraph = make('p', '');
      formulaText(paragraph, block);
      root.append(paragraph);
    }
  }
  return root;
}

type DragTask = (task: BankTask | null, data?: DataTransfer | null) => void;

function card(task: BankTask, add: (task: BankTask) => void, drag: DragTask): HTMLElement {
  const el = make('article', 'task-bank-card');
  el.dataset.taskId = task.id;
  el.draggable = true;
  el.addEventListener('dragstart', e => drag(task, e.dataTransfer));
  el.addEventListener('dragend', () => drag(null));

  const head = make('header', 'task-bank-card-head');
  const label = BANK_EXAMS[task.exam];
  head.append(
    make('span', 'task-bank-number', label + ' · № ' + task.number),
    make('span', 'task-bank-source', task.code ? 'ФИПИ #' + task.code : 'Тренировка'),
  );
  const foot = make('footer', 'task-bank-card-foot');
  const answer = make('details', 'task-bank-answer');
  answer.append(make('summary', '', 'Ответ'));
  const answerValue = make('span', 'task-bank-answer-text');
  formulaText(answerValue, task.answer.split('|')[0]);
  answer.append(answerValue);
  const insert = button('task-bank-add', '+ На доску');
  insert.addEventListener('click', () => add(task));
  foot.append(answer, insert);
  el.append(head, make('h3', 'task-bank-topic', task.topic), statement(task.statementMd), foot);
  return el;
}

export function mountTaskBank(host: HTMLElement, add: (task: BankTask) => void, drag: DragTask): void {
  let exam: BankExam = 'oge';
  let number: number | null = null;
  const filters = make('div', 'task-bank-filters');
  const numbers = make('div', 'task-bank-numbers');
  numbers.setAttribute('role', 'group');
  numbers.setAttribute('aria-label', 'Номер задания');
  numbers.addEventListener('wheel', e => {
    if (e.ctrlKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
    const remaining = e.deltaY > 0 ? numbers.scrollWidth - numbers.clientWidth - numbers.scrollLeft : numbers.scrollLeft;
    if (remaining < 1) return;
    e.preventDefault();
    const factor = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? numbers.clientWidth : 1;
    numbers.scrollBy({ left: e.deltaY * factor, behavior: reduceMotion() || document.body.classList.contains('no-motion') ? 'instant' : 'smooth' });
  }, { passive: false });
  const search = make('input', 'task-bank-search');
  search.type = 'search';
  search.placeholder = 'Поиск по условию, теме или коду';
  search.setAttribute('aria-label', 'Поиск заданий');
  search.autocomplete = 'off';
  const results = make('div', 'task-bank-results');
  results.setAttribute('role', 'region');
  results.setAttribute('aria-label', 'Список заданий');
  results.tabIndex = 0;

  const renderResults = (): void => {
    const tasks = filterBankTasks({ subject: 'math', exam, number, query: search.value });
    const children = tasks.length ? tasks.map(task => card(task, add, drag)) : [make('p', 'task-bank-empty', 'Подходящих заданий нет')];
    results.replaceChildren(...children);
    results.scrollTop = 0;
  };
  const renderNumbers = (): void => {
    numbers.replaceChildren(...[null, ...bankNumbers(exam)].map(value => {
      const pill = button('task-bank-pill', value === null ? 'Все' : '№ ' + value);
      pill.setAttribute('aria-pressed', String(value === number));
      pill.addEventListener('click', () => {
        number = value;
        numbers.querySelector('[aria-pressed="true"]')?.setAttribute('aria-pressed', 'false');
        pill.setAttribute('aria-pressed', 'true');
        renderResults();
      });
      return pill;
    }));
    numbers.scrollLeft = 0;
  };
  const exams = createTabPill({
    tabs: Object.entries(BANK_EXAMS).map(([value, label]) => ({ value, label })),
    value: exam,
    label: 'Тип экзамена',
    className: 'task-bank-exams',
    onChange(value) {
      exam = value as BankExam;
      number = null;
      renderNumbers();
      renderResults();
    },
  });
  search.addEventListener('input', renderResults);
  filters.append(exams.el, numbers, search);
  host.replaceChildren(filters, results);
  renderNumbers();
  renderResults();
}
