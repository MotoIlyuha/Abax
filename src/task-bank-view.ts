import { bankNumbers, filterBankTasks } from './fipi-bank';
import { BANK_EXAMS, catalogSourceLabel, type CatalogExam, type CatalogPage, type CatalogTask, type CatalogSubject } from '../shared/task-catalog';
import { createApiClient, getApi, type ApiClient } from './api-client';
import type { SpringSelect } from './spring-select';
import { attachOverlayScroll } from './overlay-scroll';
import { CLOSE_ICON_BOLD, svg } from './icons';
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

type DragTask = (task: CatalogTask | null, data?: DataTransfer | null) => void;


function card(task: CatalogTask, add: (task: CatalogTask) => void, drag: DragTask, api: ApiClient | null): HTMLElement {
  const el = make('article', 'task-bank-card');
  el.dataset.taskId = task.id;
  let ready = task;
  el.draggable = !task.imageCount;
  el.addEventListener('dragstart', e => {
    if (!el.draggable) { e.preventDefault(); return; }
    drag(ready, e.dataTransfer);
  });
  el.addEventListener('dragend', () => drag(null));

  const head = make('header', 'task-bank-card-head');
  const label = BANK_EXAMS[task.exam];
  head.append(
    make('span', 'task-bank-number', label + (task.number === null ? '' : ' · № ' + task.number)),
    make('span', 'task-bank-source', catalogSourceLabel(task)),
  );
  const foot = make('footer', 'task-bank-card-foot');
  const answer = make('details', 'task-bank-answer');
  answer.append(make('summary', '', 'Ответ'));
  const answerValue = make('span', 'task-bank-answer-text');
  formulaText(answerValue, task.answer.split('|')[0]);
  answer.append(answerValue);
  const insert = button('task-bank-add', '+ На доску');
  insert.addEventListener('click', () => add(ready));
  foot.append(answer, insert);
  const prompt = statement(task.statementMd);
  el.append(head, make('h3', 'task-bank-topic', task.topic), prompt, foot);
  if (task.imageCount) {
    insert.disabled = true;
    const load = button('task-bank-pill', 'Загрузить рисунки');
    async function illustrations(): Promise<void> {
      load.disabled = true;
      load.textContent = 'Загрузка рисунков…';
      try {
        if (!api) throw new Error();
        ready = await api.request<CatalogTask>('GET', '/api/task-catalog/tasks/' + encodeURIComponent(task.id), undefined, { anonymous: true });
        for (const { src, alt, width, height } of ready.illustrations ?? []) {
          const image = make('img', 'task-bank-image');
          Object.assign(image, { src, alt: alt || 'Рисунок к заданию', width, height });
          prompt.append(image);
        }
        load.remove();
        insert.disabled = false;
        el.draggable = true;
      } catch {
        load.textContent = 'Повторить загрузку рисунков';
        load.disabled = false;
      }
    }
    load.addEventListener('click', () => { void illustrations(); });
    prompt.append(load);
    void illustrations();
  }
  return el;
}

export function mountTaskBank(host: HTMLElement, subject: SpringSelect, add: (task: CatalogTask) => void, drag: DragTask) {
  let exam: CatalogExam = 'oge';
  let number: number | null = null;
  let subjectId = 'math';
  let page = 1;
  let generation = 0;
  let searchTimer = 0;
  let subjects: CatalogSubject[] | null = null;
  let hasMore = false;
  let fetching = false;
  const filters = make('div', 'task-bank-filters');
  const numbers = make('div', 'task-bank-numbers');
  numbers.setAttribute('role', 'group');
  numbers.setAttribute('aria-label', 'Номер задания');
  const row = make('div', 'task-bank-search-row');
  const reveal = button('task-bank-search-button', '');
  reveal.setAttribute('aria-label', 'Показать поле поиска');
  reveal.innerHTML = svg('<circle cx="10" cy="10" r="6.5"/><path d="m15 15 5 5"/>');
  const scroller = make('div', 'task-bank-strip');
  const clear = button('task-bank-search-button', '');
  clear.innerHTML = CLOSE_ICON_BOLD;
  clear.setAttribute('aria-label', 'Очистить ввод');
  clear.hidden = true;
  const search = make('input', 'task-bank-search');
  search.type = 'search';
  search.placeholder = 'Поиск';
  search.title = 'Поиск по условию, теме или коду';
  search.setAttribute('aria-label', 'Поиск заданий');
  search.autocomplete = 'off';
  const results = make('div', 'task-bank-results');
  results.setAttribute('role', 'region');
  results.setAttribute('aria-label', 'Список заданий');
  results.tabIndex = 0;

  let shownNumbers: number[] = [];
  const renderNumbers = (values: number[]): void => {
    if (numbers.childElementCount && values.join() === shownNumbers.join()) {
      numbers.querySelectorAll('button').forEach((pill, i) => pill.setAttribute('aria-pressed', String((values[i - 1] ?? null) === number)));
      return;
    }
    shownNumbers = values;
    numbers.replaceChildren(...[null, ...values].map(value => {
      const pill = button('task-bank-pill', value === null ? 'Все' : '№ ' + value);
      pill.setAttribute('aria-pressed', String(value === number));
      pill.addEventListener('click', () => {
        number = value;
        numbers.querySelector('[aria-pressed="true"]')?.setAttribute('aria-pressed', 'false');
        pill.setAttribute('aria-pressed', 'true');
        page = 1;
        renderResults();
      });
      return pill;
    }));
    scroller.scrollLeft = 0;
    scroll.sync();
  };
  const cloud = getApi() ?? (import.meta.env.DEV ? createApiClient({ base: location.origin }) : null);
  function show(items: CatalogTask[], append = false): void {
    const cards = items.map(task => card(task, add, drag, cloud));
    if (append) { results.append(...cards); return; }
    results.replaceChildren(...(cards.length ? cards : [make('p', 'task-bank-empty', 'Подходящих заданий нет')]));
    results.scrollTop = 0;
  }
  function failed(retry: () => void): void {
    const again = button('task-bank-pill', 'Повторить');
    again.addEventListener('click', retry);
    results.replaceChildren(make('p', 'task-bank-empty', 'Не удалось загрузить каталог заданий.'), again);
  }
  function renderResults(append = false): void {
    window.clearTimeout(searchTimer);
    const current = ++generation;
    if (!cloud) {
      const tasks = filterBankTasks({ subject: 'math', exam, number, query: search.value });
      renderNumbers(bankNumbers(exam));
      show(tasks.map(task => ({
        ...task, code: task.code ?? '', subjectId: 'math',
        subjectName: 'Математика', boardSubject: 'math', sourceUrl: '', published: true, imageCount: 0,
      })), false);
      return;
    }
    if (!subjects) return;
    if (!append) page = 1;
    fetching = true;
    hasMore = false;
    const query = new URLSearchParams({ subject: subjectId, exam, page: String(page), q: search.value.trim() });
    if (number !== null) query.set('number', String(number));
    if (!append) results.replaceChildren(make('p', 'task-bank-empty', 'Загрузка заданий…'));
    void cloud.request<CatalogPage>('GET', '/api/task-catalog/tasks?' + query, undefined, { anonymous: true })
      .then(data => {
        if (current !== generation) return;
        const defaults = subjectId === 'math' ? bankNumbers(exam) : [];
        renderNumbers([...new Set([...defaults, ...data.numbers])].sort((a, b) => a - b));
        hasMore = data.hasMore;
        show(data.items, append);
      }).catch(() => {
        if (current !== generation) return;
        if (!append) { failed(() => renderResults()); return; }
        const again = button('task-bank-pill', 'Повторить загрузку заданий');
        again.addEventListener('click', () => { again.remove(); renderResults(true); });
        results.append(again);
      }).finally(() => { if (current === generation) fetching = false; });
  }
  function setSubject(value: string): void {
    subjectId = value;
    const name = subjects?.find(item => item.id === value)?.name;
    if (name) subject.el.setAttribute('aria-label', 'Предмет: ' + name);
    page = 1;
    number = null;
    renderResults();
  }
  let loading = false;
  function refresh(): void {
    if (!cloud) { if (!generation) renderResults(); return; }
    if (loading) return;
    loading = true;
    void cloud.request<CatalogSubject[]>('GET', '/api/task-catalog', undefined, { anonymous: true }).then(data => {
      subjects = data;
      if (!data.some(item => item.id === subjectId)) {
        subjectId = data[0]?.id ?? '';
        number = null;
      }
      const options = data.map(item => ({ value: item.id, label: item.name }));
      const upcoming = [
        { value: 'informatics', label: 'Информатика' },
        { value: 'physics', label: 'Физика' },
        { value: 'russian', label: 'Русский' },
      ].filter(item => !options.some(option => option.label === item.label))
        .map(item => ({ ...item, disabled: true, badge: 'Скоро', title: 'Банк заданий появится в ближайшем обновлении' }));
      subject.setOptions([...options, ...upcoming], subjectId);
      subject.setDisabled(!data.length);
      subject.el.setAttribute('aria-label', data.length
        ? 'Предмет: ' + data.find(item => item.id === subjectId)?.name : 'Предметы');
      renderResults();
    }).catch(() => failed(refresh)).finally(() => { loading = false; });
  }
  const exams = createTabPill({
    tabs: Object.entries(BANK_EXAMS).map(([value, label]) => ({ value, label })),
    value: exam,
    label: 'Тип экзамена',
    className: 'task-bank-exams',
    onChange(value) {
      exam = value as CatalogExam;
      number = null;
      page = 1;
      renderResults();
    },
  });
  search.maxLength = 200;
  search.addEventListener('input', () => {
    page = 1;
    if (!cloud) { renderResults(); return; }
    generation++;
    hasMore = false;
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(renderResults, 180);
  });
  results.addEventListener('scroll', () => {
    if (!hasMore || fetching || results.scrollHeight - results.scrollTop - results.clientHeight > 240) return;
    page++;
    renderResults(true);
  });
  scroller.append(search, numbers);
  row.append(reveal, scroller, clear);
  const scroll = attachOverlayScroll(scroller, { axis: 'x', wheel: true });
  const setEditing = (editing: boolean): void => {
    row.classList.toggle('editing', editing);
    numbers.inert = editing;
    numbers.setAttribute('aria-hidden', String(editing));
    clear.hidden = !editing;
    scroller.scrollLeft = 0;
    scroll.sync();
  };
  reveal.addEventListener('click', () => {
    scroller.scrollLeft = 0;
    if (row.classList.contains('editing')) search.focus();
  });
  search.addEventListener('focus', () => setEditing(true));
  row.addEventListener('focusout', event => {
    if (row.classList.contains('editing') && !search.value && !row.contains(event.relatedTarget as Node | null)) {
      setEditing(false);
    }
  });
  const resetSearch = (): void => {
    search.value = '';
    page = 1;
    renderResults();
    reveal.focus();
    setEditing(false);
  };
  clear.addEventListener('click', resetSearch);
  row.addEventListener('keydown', event => {
    if (event.key === 'Escape' && row.classList.contains('editing')) {
      event.preventDefault();
      event.stopPropagation();
      resetSearch();
    }
  });
  filters.append(exams.el, row);
  host.replaceChildren(filters, results);
  if (cloud) {
    renderNumbers(bankNumbers(exam));
    results.append(make('p', 'task-bank-empty', 'Загрузка заданий…'));
  }
  refresh();
  return { setSubject, refresh };
}
