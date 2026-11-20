// Действия доски для режимов боковой панели («История», «Импорт», «Экспорт»). Их передаёт app.ts
// (setPanelActions при запуске): модули режимов не импортируют app.ts — без циклических зависимостей,
// и в unit-тестах вместо них подставляются заглушки.

export interface PanelActions {
  /** Можно менять содержимое текущей страницы (в совместной работе — право правки). */
  canEdit(): boolean;
  /** «Импорт документа» — тот же выбор файла, что у кнопки импорта в шапке (PDF, Word, Excel, текст). */
  importDocument(): void;
  /** «Вставить изображение» — выбор картинки, как у кнопки в шапке. */
  insertImage(): void;
  /** Файл, перетащенный в зону импорта: так же, как перетаскивание на холст. false — файл не принят (формат, нет права): зона не показывает «готово». */
  importFile(file: File): boolean | void;
  /** Можно открыть проект из файла (не просмотр по ссылке и не гость чужой доски). */
  canOpenProject(): boolean;
  /** Выбор файла проекта (.json): откроется копией, как новый проект. */
  openProjectFile(): void;
  /** Картинка из системного буфера обмена — тот же путь, что вставка Ctrl+V. */
  pasteFromClipboard(): void;
  /** PNG: вся страница или только выделенное. */
  exportPng(scope: 'page' | 'selection'): void;
  /** Выделенное — картинкой в буфер обмена. */
  copyImage(): void;
  /** Скачать проект файлом .json (как «Скачать проект как файл» в меню экспорта). */
  downloadProject(): void;
  /** «Открыть в приложении»; null — пункта нет (уже в приложении). */
  openInApp: (() => void) | null;
}

let current: PanelActions | null = null;

export function setPanelActions(actions: PanelActions | null): void {
  current = actions;
}

/** Действия доски; null — ещё не заданы (кнопки режимов недоступны). */
export function panelActions(): PanelActions | null {
  return current;
}
