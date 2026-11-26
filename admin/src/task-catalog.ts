import { SUBJECT_LABELS } from '../../src/task-element';
import { isTaskIllustration, MAX_TASK_ILLUSTRATIONS, MAX_TASK_ILLUSTRATION_BYTES, type TaskIllustration } from '../../src/task-illustration';
import { BANK_EXAMS, type CatalogPage, type CatalogSubject, type CatalogTask } from '../../shared/task-catalog';
import { api, errorText, RequestError } from './api';
import { alertBox, badge, button, el, field, input, link, pair, select, table } from './dom';
import { closeAction } from './views';

const ROOT = 'admin/task-catalog';
const dialog = document.querySelector<HTMLDialogElement>('#action-dialog')!;
type Saved = (success: boolean) => void;

function choices(name: string, items: readonly { id: string; name: string }[], value = '', blank = ''): HTMLSelectElement {
  const box = el('select');
  box.name = name;
  if (blank) box.add(new Option(blank, ''));
  for (const item of items) box.add(new Option(item.name, item.id));
  if (value) box.value = value;
  return box;
}

function textArea(name: string, value: string, maxLength: number, rows: number): HTMLTextAreaElement {
  return Object.assign(el('textarea'), { name, value, maxLength, rows });
}

function action(title: string, controls: HTMLElement[], label: string, save: (data: FormData) => Promise<unknown>, done: Saved): void {
  const heading = el('h2', { text: title });
  heading.id = 'dialog-title';
  const notice = alertBox();
  const submit = button(label, undefined, 'primary');
  const form = el('form', { className: 'form' }, heading, ...controls, notice,
    el('div', { className: 'actions' }, button('Отмена', closeAction), submit));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const data = new FormData(form);
    const enabled = Array.from(form.elements).filter((node): node is HTMLInputElement => 'disabled' in node && !node.disabled);
    enabled.forEach(node => { node.disabled = true; });
    dialog.setAttribute('aria-busy', 'true');
    notice.hidden = true;
    try {
      await save(data);
      closeAction();
      done(true);
    } catch (error) {
      if (error instanceof RequestError && (error.status === 401 || error.code === 'admin-forbidden')) {
        closeAction();
        done(false);
      } else {
        notice.textContent = error instanceof Error ? error.message : errorText(error);
        notice.hidden = false;
        notice.tabIndex = -1;
        notice.focus();
      }
    } finally {
      enabled.forEach(node => { node.disabled = false; });
      dialog.removeAttribute('aria-busy');
    }
  });
  dialog.oncancel = event => { if (dialog.hasAttribute('aria-busy')) event.preventDefault(); };
  dialog.replaceChildren(form);
  dialog.showModal();
}

function remove(path: string, name: string, done: Saved): void {
  action('Удалить «' + name + '»?', [], 'Удалить', () => api(path, { method: 'DELETE', body: {} }), done);
}

function editSubject(item: CatalogSubject | undefined, done: Saved): void {
  const name = input('name', 'text', { value: item?.name ?? '', required: true, maxLength: 240 });
  const control = select('boardSubject', { ...SUBJECT_LABELS, other: 'Другой предмет' }, item?.boardSubject ?? 'other');
  action(item ? 'Редактировать предмет' : 'Добавить предмет',
    [field('Название', name), field('Тип предмета на доске', control)], 'Сохранить',
    values => api(ROOT + '/subjects' + (item ? '/' + encodeURIComponent(item.id) : ''),
      { method: item ? 'PUT' : 'POST', body: Object.fromEntries(values) }), done);
}

async function readIllustration(file: File): Promise<TaskIllustration> {
  if (file.size > MAX_TASK_ILLUSTRATION_BYTES || !/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
    throw new Error('Выберите PNG, JPEG, WebP или GIF размером до 192 КБ.');
  }
  const src = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Не удалось прочитать файл.'));
    reader.readAsDataURL(file);
  });
  const image = new Image();
  image.src = src;
  await image.decode().catch(() => { throw new Error('Не удалось открыть рисунок.'); });
  const value = { src, width: image.naturalWidth, height: image.naturalHeight, alt: '' };
  if (!isTaskIllustration(value)) throw new Error('Размер рисунка должен быть не больше 2048 × 2048.');
  return value;
}

function editTask(subjects: CatalogSubject[], task: CatalogTask | undefined, query: URLSearchParams, done: Saved): void {
  const subject = choices('subjectId', subjects, task?.subjectId ?? query.get('subject') ?? '', 'Выберите предмет');
  subject.required = true;
  if (!subject.value && subjects.length === 1) subject.value = subjects[0].id;
  const exam = select('exam', BANK_EXAMS, task?.exam ?? query.get('exam') ?? 'oge');
  const number = input('number', 'number', { min: '1', max: '999', value: String(task ? task.number ?? '' : query.get('number') ?? '') });
  const topic = input('topic', 'text', { value: task?.topic ?? '', required: true, maxLength: 240 });
  const statement = textArea('statementMd', task?.statementMd ?? '', 20000, 6);
  statement.required = true;
  const answer = input('answer', 'text', { value: task?.answer ?? '', maxLength: 4000 });
  const solution = textArea('solutionMd', task?.solutionMd ?? '', 20000, 4);
  const code = input('code', 'text', { value: task?.code ?? '', maxLength: 80 });
  const sourceUrl = input('sourceUrl', 'url', { value: task?.sourceUrl ?? '', maxLength: 2048 });
  const published = input('published', 'checkbox', { checked: task?.published ?? false });
  answer.required = number.required = published.checked;
  published.addEventListener('change', () => { answer.required = number.required = published.checked; });

  const images = (task?.illustrations ?? []).map(image => ({ ...image }));
  const files = input('illustrations', 'file', { accept: 'image/png,image/jpeg,image/webp,image/gif', multiple: true });
  const previews = el('div', { className: 'catalog-illustrations' });
  const imageError = alertBox();
  let pending: Promise<void> = Promise.resolve();
  function preview(): void {
    previews.replaceChildren(...images.map((image, i) => {
      const thumbnail = Object.assign(el('img'), { src: image.src, alt: image.alt || 'Рисунок к заданию' });
      const caption = input('image-alt-' + i, 'text', { value: image.alt, maxLength: 240 });
      caption.addEventListener('input', () => { image.alt = caption.value; thumbnail.alt = caption.value || 'Рисунок к заданию'; });
      return el('div', {}, thumbnail, field('Описание рисунка', caption),
        button('Удалить рисунок', () => { images.splice(i, 1); preview(); }));
    }));
  }
  preview();
  files.addEventListener('change', () => {
    const selected = Array.from(files.files ?? []);
    files.value = '';
    imageError.hidden = true;
    pending = pending.then(async () => {
      if (images.length + selected.length > MAX_TASK_ILLUSTRATIONS) throw new Error('Можно добавить до четырёх рисунков.');
      images.push(...await Promise.all(selected.map(readIllustration)));
      preview();
    }).catch(error => {
      imageError.textContent = error instanceof Error ? error.message : errorText(error);
      imageError.hidden = false;
    });
  });

  action(task ? 'Редактировать задание' : 'Добавить задание', [
    el('div', { className: 'fields' }, field('Предмет', subject), field('Экзамен', exam), field('Номер', number)),
    field('Тема', topic), field('Условие', statement), previews, field('Добавить рисунки', files), imageError,
    field('Ответ', answer), field('Решение', solution),
    el('div', { className: 'fields' }, field('Код источника', code), field('Ссылка на источник', sourceUrl)),
    el('label', { className: 'catalog-publish' }, published, 'Опубликовать на доске'),
  ], 'Сохранить', async values => {
    await pending;
    await api(ROOT + '/tasks' + (task ? '/' + encodeURIComponent(task.id) : ''), {
      method: task ? 'PUT' : 'POST',
      body: { ...Object.fromEntries(values), number: number.value ? Number(number.value) : null,
        published: published.checked, illustrations: images },
    });
  }, done);
}

function importTasks(subjects: CatalogSubject[], query: URLSearchParams, done: Saved): void {
  const subject = choices('subjectId', subjects, query.get('subject') ?? '', 'Выберите предмет');
  subject.required = true;
  if (!subject.value && subjects.length === 1) subject.value = subjects[0].id;
  const file = input('file', 'file', { accept: '.json,application/json', required: true });
  action('Импорт заданий', [
    field('Предмет', subject), field('Выгрузка JSON', file),
    el('p', { className: 'muted', text: 'Задания появятся в выбранном предмете как черновики. Повторные записи пропускаются.' }),
  ], 'Импортировать', async values => {
    const upload = values.get('file');
    if (!(upload instanceof File) || upload.size > 7 * 1024 * 1024) throw new Error('Выберите файл JSON размером до 7 МБ.');
    let items: unknown;
    try { items = JSON.parse(await upload.text()); } catch { throw new Error('Не удалось прочитать JSON.'); }
    const result = await api<{ imported: number; skipped: number }>(ROOT + '/import', {
      method: 'POST', body: { subjectId: subject.value, items },
    });
    alert('Импортировано: ' + result.imported + '. Пропущено: ' + result.skipped + '.');
  }, done);
}

export async function taskCatalog(query: URLSearchParams, signal: AbortSignal, done: Saved): Promise<HTMLElement> {
  const [subjects, result] = await Promise.all([
    api<CatalogSubject[]>(ROOT, { signal }), api<CatalogPage>(ROOT + '/tasks?' + query, { signal }),
  ]);
  const subject = choices('subject', subjects, query.get('subject') ?? '', 'Все предметы');
  const term = input('q', 'search', { value: query.get('q') ?? '', maxLength: 200 });
  const exam = select('exam', { '': 'Все экзамены', ...BANK_EXAMS }, query.get('exam') ?? '');
  const number = input('number', 'number', { min: '1', max: '999', value: query.get('number') ?? '' });
  const published = select('published', { '': 'Все статусы', '1': 'Опубликовано', '0': 'Черновик' }, query.get('published') ?? '');
  const filters = el('form', { className: 'filters' }, field('Поиск по теме, условию или коду', term), field('Предмет', subject),
    field('Экзамен', exam), field('Номер', number), field('Статус', published), button('Найти'), link('Сбросить', '#tasks', 'reset'));
  filters.addEventListener('submit', event => {
    event.preventDefault();
    const next = new URLSearchParams();
    for (const [key, value] of new FormData(filters)) if (String(value).trim()) next.set(key, String(value).trim());
    location.hash = '#tasks?' + next;
  });

  const addTask = button('Добавить задание', () => editTask(subjects, undefined, query, done), 'primary');
  const loadTasks = button('Импорт JSON', () => importTasks(subjects, query, done));
  addTask.disabled = loadTasks.disabled = !subjects.length;
  const manage = el('details', { className: 'catalog-taxonomy' }, el('summary', { text: 'Предметы' }),
    button('Добавить предмет', () => editSubject(undefined, done)));
  if (subjects.length) manage.append(table('Предметы', ['Название', 'Действия'], subjects.map(item => [
    item.name, el('div', { className: 'actions' }, button('Изменить', () => editSubject(item, done)),
      button('Удалить', () => remove(ROOT + '/subjects/' + encodeURIComponent(item.id), item.name, done))),
  ])));
  const notice = alertBox();
  const rows = result.items.map(task => {
    const path = ROOT + '/tasks/' + encodeURIComponent(task.id);
    const edit = button('Изменить', () => {
      edit.disabled = true;
      notice.hidden = true;
      void api<CatalogTask>(path, { signal }).then(full => {
        if (!signal.aborted) editTask(subjects, full, query, done);
      }).catch(failure => {
        if (signal.aborted) return;
        notice.textContent = errorText(failure);
        notice.hidden = false;
      }).finally(() => { edit.disabled = false; });
    });
    return [
      pair(task.topic, task.code || null), task.subjectName,
      BANK_EXAMS[task.exam] + (task.number === null ? '' : ' № ' + task.number),
      String(task.imageCount), badge(task.published ? 'Опубликовано' : 'Черновик', task.published ? 'active' : 'neutral'),
      el('div', { className: 'actions' }, edit, button('Удалить', () => remove(path, task.topic, done))),
    ];
  });
  const pagination = el('nav', { className: 'pagination' }, el('span', { text: 'Страница ' + result.page }));
  pagination.setAttribute('aria-label', 'Страницы заданий');
  for (const [show, target, label] of [[result.page > 1, result.page - 1, 'Назад'], [result.hasMore, result.page + 1, 'Далее']] as const) {
    if (!show) continue;
    const params = new URLSearchParams(query);
    params.set('page', String(target));
    pagination.append(link(label, '#tasks?' + params, 'page-link'));
  }
  return el('div', { className: 'catalog-admin' }, el('div', { className: 'actions' }, addTask, loadTasks), manage, filters, notice,
    rows.length ? table('Задания', ['Тема', 'Предмет', 'Экзамен', 'Рисунки', 'Статус', 'Действия'], rows)
      : el('p', { className: 'empty', text: 'Заданий по этим фильтрам нет.' }), pagination);
}
