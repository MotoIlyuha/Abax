// Режимы боковой панели «Импорт» и «Экспорт» (SPEC_CHAT §8). Действия — те же функции, что у кнопок
// и меню шапки (их передаёт app.ts через src/panel-actions.ts); здесь — только вид и доступность строк.
// Импорт: зона перетаскивания (PDF, изображение, документ, проект .json) и кнопки-строки.
// Экспорт: PNG страницы или выделенного, копия картинкой, файл проекта, PDF (скоро), «Открыть в приложении».

import { ICONS, PANEL_ICONS, UPLOAD_ICON } from './icons';
import { createFileDrop } from './file-drop';
import { macKeys } from './hotkeys';
import { panelActions, type PanelActions } from './panel-actions';
import type { PanelModeDef, PanelView } from './panel-types';
import { el, panelScaffold, rowButton, rowDisabled, setRowDisabled } from './panel-view';
import { canCloneCurrentProject, canCopyCurrentBoard, onChange, state } from './state';

export const IMPORT_MODE: Omit<PanelModeDef, 'mount'> = { id: 'import', label: 'Импорт', icon: UPLOAD_ICON };
export const EXPORT_MODE: Omit<PanelModeDef, 'mount'> = { id: 'export', label: 'Экспорт', icon: ICONS.export };

/** Что принимает зона перетаскивания и выбор файла в ней. */
export const IMPORT_ACCEPT = 'application/pdf,.pdf,image/*,.json,application/json,.docx,.xlsx,.odt,.ods,.txt,.csv,.tsv,.md';

const IDLE_TITLE = 'Перетащите файл сюда';
const IDLE_TITLE_PROJECT = 'Перетащите файл проекта';
const IDLE_HINT = 'или нажмите, чтобы выбрать файл';

const NO_EDIT = 'Нет права на правку этой страницы';
const NO_PROJECT = 'Недоступно при просмотре по ссылке и в гостях на чужой доске';
const NO_COPY = 'Автор запретил копирование';
const NO_SAVE = 'Автор запретил сохранение проекта';
const NO_SELECTION = 'Сначала выделите объекты на доске';
const EMPTY_PAGE = 'Страница пуста — нечего экспортировать';
const NOT_READY = 'Доска ещё загружается';

/** Секция со строками: заголовок и колонка кнопок. */
function section(title: string, rows: HTMLElement[]): HTMLElement {
  const s = el('section', 'pv-section');
  const list = el('div', 'pv-rows');
  list.append(...rows);
  s.append(el('h3', 'pv-title', title), list);
  return s;
}

/** Щелчок по строке: недоступная — ничего; иначе действие с текущими действиями доски. */
function onRow(b: HTMLButtonElement, run: (a: PanelActions) => void): void {
  b.addEventListener('click', () => {
    const a = panelActions();
    if (!a || rowDisabled(b)) return;
    run(a);
  });
}

/** Файлы, которые тащат, — именно файлы (не текст и не элемент страницы). */
function dragsFiles(e: DragEvent): boolean {
  return [...(e.dataTransfer?.types ?? [])].includes('Files');
}

// ----- Импорт -----

export function mountImportPanel(host: HTMLElement): PanelView {
  const { root, body } = panelScaffold(host, 'import');
  const inner = el('div', 'pv-inner');

  // зона «File drop» (src/file-drop.ts): сам импорт — как раньше, зона лишь показывает приём файла
  const dropView = createFileDrop({
    idleTitle: IDLE_TITLE, idleHint: IDLE_HINT, overTitle: 'Отпустите, чтобы добавить', label: 'Импорт файла',
  });
  const drop = dropView.el;
  drop.dataset.row = 'drop';

  const rows = {
    pdf: rowButton({ id: 'pdf', icon: ICONS.pdf, title: 'Документ PDF', hint: 'Страницы — картинками; также Word, Excel, текст' }),
    image: rowButton({ id: 'image', icon: ICONS.image, title: 'Изображение', hint: 'PNG, JPEG, GIF, WebP, SVG' }),
    clipboard: rowButton({ id: 'clipboard', icon: PANEL_ICONS.clipboard, title: 'Из буфера обмена', hint: 'Картинка из другого приложения', keys: macKeys('Ctrl+V').split('+') }),
    project: rowButton({ id: 'project', icon: PANEL_ICONS.projectFile, title: 'Файл проекта (.json)', hint: 'Откроется отдельным проектом' }),
  };
  inner.append(drop, section('Добавить на доску', [rows.pdf, rows.image, rows.clipboard]), section('Проект', [rows.project]));
  body.append(inner);

  onRow(rows.pdf, a => a.importDocument());
  onRow(rows.image, a => a.insertImage());
  onRow(rows.clipboard, a => a.pasteFromClipboard());
  onRow(rows.project, a => a.openProjectFile());

  /** Файл — на доску (действие доски), а зона показывает приём; false от действия — файл отклонён (формат, право). */
  const take = (f: File, at?: { x: number; y: number }) => {
    const a = panelActions();
    if (!a) return;
    if (a.importFile(f) === false) dropView.reject();
    else dropView.accept(f, at);
  };

  /** Выбор любого поддерживаемого файла — как перетаскивание в зону. */
  const pick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = IMPORT_ACCEPT;
    input.onchange = () => {
      const f = input.files?.[0];
      if (f) take(f);
    };
    input.click();
  };
  drop.addEventListener('click', () => { if (!rowDisabled(drop) && panelActions()) pick(); });

  // перетаскивание — на весь вид: подсвечивается зона; счётчик — dragenter/dragleave приходят и от детей
  let depth = 0;
  const setOver = (on: boolean) => dropView.setOver(on);
  root.addEventListener('dragenter', e => {
    if (!dragsFiles(e)) return;
    e.preventDefault();
    depth++;
    setOver(!rowDisabled(drop));
  });
  root.addEventListener('dragover', e => {
    if (!dragsFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = rowDisabled(drop) ? 'none' : 'copy';
  });
  root.addEventListener('dragleave', e => {
    if (!dragsFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) setOver(false);
  });
  root.addEventListener('drop', e => {
    if (!dragsFiles(e)) return;
    e.preventDefault();
    // не дойти до холста под панелью: файл обрабатывается один раз
    e.stopPropagation();
    depth = 0;
    setOver(false);
    const f = e.dataTransfer?.files?.[0];
    if (f && !rowDisabled(drop)) take(f, { x: e.clientX, y: e.clientY });
  });

  let refreshed = false;
  const refresh = () => {
    const a = panelActions();
    const edit = !!a && a.canEdit();
    const project = !!a && a.canOpenProject();
    const editWhy = a ? NO_EDIT : NOT_READY;
    setRowDisabled(rows.pdf, !edit, editWhy);
    setRowDisabled(rows.image, !edit, editWhy);
    setRowDisabled(rows.clipboard, !edit, editWhy);
    setRowDisabled(rows.project, !project, a ? NO_PROJECT : NOT_READY);
    setRowDisabled(drop, !edit && !project, editWhy);
    // без права правки зона принимает только проект
    dropView.setIdleText(edit ? IDLE_TITLE : IDLE_TITLE_PROJECT, IDLE_HINT, !refreshed);
    refreshed = true;
  };

  let shown = false;
  onChange(() => { if (shown) refresh(); });
  refresh();

  return {
    show() { shown = true; refresh(); },
    hide() { shown = false; depth = 0; dropView.reset(); },
    focus() { (rowDisabled(drop) ? root : drop).focus(); },
  };
}

// ----- Экспорт -----

export function mountExportPanel(host: HTMLElement): PanelView {
  const { root, body } = panelScaffold(host, 'export');
  const inner = el('div', 'pv-inner');

  const rows = {
    pngPage: rowButton({ id: 'png-page', icon: ICONS.image, title: 'PNG — вся страница', hint: 'Всё содержимое одной картинкой' }),
    pngSelection: rowButton({ id: 'png-selection', icon: PANEL_ICONS.selection, title: 'PNG — выделенное', hint: 'Только выделенные объекты' }),
    copy: rowButton({ id: 'copy-image', icon: ICONS.copyImage, title: 'Копировать как изображение', hint: 'Выделенное — в буфер обмена' }),
    project: rowButton({ id: 'project', icon: PANEL_ICONS.projectFile, title: 'Файл проекта (.json)', hint: 'Все страницы проекта' }),
    pdf: rowButton({ id: 'pdf', icon: ICONS.pdf, title: 'PDF', hint: 'Документ со страницами доски', badge: 'Скоро' }),
    app: rowButton({ id: 'app', icon: ICONS.openApp, title: 'Открыть в приложении', hint: 'Доска откроется в Abax для компьютера' }),
  };
  const appSection = section('Приложение', [rows.app]);
  inner.append(
    section('Изображение', [rows.pngPage, rows.pngSelection, rows.copy]),
    section('Файл', [rows.project, rows.pdf]),
    appSection,
  );
  body.append(inner);

  onRow(rows.pngPage, a => a.exportPng('page'));
  onRow(rows.pngSelection, a => a.exportPng('selection'));
  onRow(rows.copy, a => a.copyImage());
  onRow(rows.project, a => a.downloadProject());
  onRow(rows.app, a => a.openInApp?.());
  setRowDisabled(rows.pdf, true, 'Экспорт в PDF пока недоступен');

  const refresh = () => {
    const a = panelActions();
    const copy = canCopyCurrentBoard();
    const selected = state.selection.size > 0 && state.board.elements.some(e => state.selection.has(e.id));
    const empty = state.board.elements.length === 0;
    const imageWhy = (needSelection: boolean): string => {
      if (!a) return NOT_READY;
      if (!copy) return NO_COPY;
      if (needSelection && !selected) return NO_SELECTION;
      if (!needSelection && empty) return EMPTY_PAGE;
      return '';
    };
    for (const [row, needSelection] of [[rows.pngPage, false], [rows.pngSelection, true], [rows.copy, true]] as const) {
      const why = imageWhy(needSelection);
      setRowDisabled(row, !!why, why);
    }
    const save = canCloneCurrentProject();
    setRowDisabled(rows.project, !a || !save, a ? NO_SAVE : NOT_READY);
    appSection.hidden = !a?.openInApp;
  };

  let shown = false;
  onChange(() => { if (shown) refresh(); });
  refresh();

  return {
    show() { shown = true; refresh(); },
    hide() { shown = false; },
    focus() {
      const first = inner.querySelector<HTMLElement>('.pv-row:not([aria-disabled="true"])');
      (first ?? root).focus();
    },
  };
}

