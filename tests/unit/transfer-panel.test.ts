// Режимы «Импорт» и «Экспорт» (src/transfer-panel.ts): доступность строк, действия доски, перетаскивание файла.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXPORT_MODE, IMPORT_MODE, mountExportPanel, mountImportPanel } from '../../src/transfer-panel';
import { setPanelActions, type PanelActions } from '../../src/panel-actions';
import { blankProject, openProject, setCopyGuard, setSelection, state, update } from '../../src/state';
import type { ShapeEl } from '../../src/types';

const rect = (id: string): ShapeEl => ({ id, type: 'shape', shape: 'rect', x: 0, y: 0, w: 10, h: 10, color: '#000000', width: 2 });

function actions(o: Partial<PanelActions> = {}): PanelActions {
  return {
    canEdit: () => true, importDocument: vi.fn(), insertImage: vi.fn(), importFile: vi.fn(), canOpenProject: () => true,
    openProjectFile: vi.fn(), pasteFromClipboard: vi.fn(), exportPng: vi.fn(), copyImage: vi.fn(), downloadProject: vi.fn(),
    openInApp: null, ...o,
  };
}

function mount(fn: (host: HTMLElement) => ReturnType<typeof mountExportPanel>) {
  const host = document.createElement('div');
  document.body.append(host);
  const view = fn(host);
  view.show?.();
  const row = (id: string) => host.querySelector<HTMLButtonElement>(`[data-row="${id}"]`)!;
  return { host, view, row };
}

const tip = (b: HTMLElement) => b.title || b.dataset.tip || '';
const disabled = (b: HTMLElement) => b.getAttribute('aria-disabled') === 'true';

/** В jsdom нет DragEvent/DataTransfer: событие с полем dataTransfer. */
function dragEvent(type: string, files: File[]): Event {
  return Object.assign(new Event(type, { bubbles: true, cancelable: true }), { dataTransfer: { types: ['Files'], files, dropEffect: 'none' } });
}

beforeEach(() => {
  openProject(blankProject('Экспорт'));
  setCopyGuard(null);
});
afterEach(() => {
  document.body.textContent = '';
  setPanelActions(null);
  setCopyGuard(null);
});

describe('режимы', () => {
  it('подписи и иконки', () => {
    expect(IMPORT_MODE).toMatchObject({ id: 'import', label: 'Импорт' });
    expect(EXPORT_MODE).toMatchObject({ id: 'export', label: 'Экспорт' });
    expect(IMPORT_MODE.icon).toContain('<svg');
    expect(EXPORT_MODE.icon).toContain('<svg');
  });
});

describe('Экспорт', () => {
  it('без выделения — «PNG — выделенное» и «Копировать как изображение» недоступны с подсказкой', () => {
    const a = actions();
    setPanelActions(a);
    state.board.elements = [rect('a')];
    const { row } = mount(mountExportPanel);
    expect(disabled(row('png-page'))).toBe(false);
    for (const id of ['png-selection', 'copy-image']) {
      expect(disabled(row(id))).toBe(true);
      expect(tip(row(id))).toBe('Сначала выделите объекты на доске');
    }
    row('png-selection').click();
    row('copy-image').click();
    expect(a.exportPng).not.toHaveBeenCalled();
    expect(a.copyImage).not.toHaveBeenCalled();
    row('png-page').click();
    expect(a.exportPng).toHaveBeenCalledWith('page');
  });

  it('выделение появилось — строки становятся доступны и делают своё', () => {
    const a = actions();
    setPanelActions(a);
    state.board.elements = [rect('a'), rect('b')];
    const { row } = mount(mountExportPanel);
    setSelection(['b']);
    update();
    expect(disabled(row('png-selection'))).toBe(false);
    expect(tip(row('png-selection'))).toBe('');
    row('png-selection').click();
    expect(a.exportPng).toHaveBeenCalledWith('selection');
    row('copy-image').click();
    expect(a.copyImage).toHaveBeenCalledTimes(1);
  });

  it('пустая страница — PNG страницы недоступен', () => {
    setPanelActions(actions());
    const { row } = mount(mountExportPanel);
    expect(disabled(row('png-page'))).toBe(true);
    expect(tip(row('png-page'))).toBe('Страница пуста — нечего экспортировать');
  });

  it('автор запретил копирование — картинки недоступны', () => {
    setPanelActions(actions());
    state.board.elements = [rect('a')];
    setCopyGuard(() => false);
    const { row } = mount(mountExportPanel);
    setSelection(['a']);
    update();
    for (const id of ['png-page', 'png-selection', 'copy-image']) {
      expect(disabled(row(id))).toBe(true);
      expect(tip(row(id))).toBe('Автор запретил копирование');
    }
  });

  it('файл проекта — скачать; по ссылке на одну страницу — недоступен', () => {
    const a = actions();
    setPanelActions(a);
    const { row } = mount(mountExportPanel);
    row('project').click();
    expect(a.downloadProject).toHaveBeenCalledTimes(1);
    state.linkMode = 'view-page';
    update();
    try {
      expect(disabled(row('project'))).toBe(true);
      expect(tip(row('project'))).toBe('Автор запретил сохранение проекта');
    } finally {
      state.linkMode = null;
    }
  });

  it('PDF — «Скоро» и недоступен; «Открыть в приложении» — только когда пункт есть', () => {
    const open = vi.fn();
    setPanelActions(actions({ openInApp: open }));
    const { row, host } = mount(mountExportPanel);
    expect(disabled(row('pdf'))).toBe(true);
    expect(row('pdf').querySelector('.pv-badge')!.textContent).toBe('Скоро');
    expect(row('app').closest('section')!.hidden).toBe(false);
    row('app').click();
    expect(open).toHaveBeenCalledTimes(1);
    host.remove();
    setPanelActions(actions({ openInApp: null }));
    const again = mount(mountExportPanel);
    expect(again.row('app').closest('section')!.hidden).toBe(true);
  });

  it('действия доски не заданы — всё недоступно', () => {
    state.board.elements = [rect('a')];
    const { row } = mount(mountExportPanel);
    expect(disabled(row('png-page'))).toBe(true);
    expect(disabled(row('project'))).toBe(true);
  });
});

describe('Импорт', () => {
  it('строки вызывают те же функции, что и шапка', () => {
    const a = actions();
    setPanelActions(a);
    const { row } = mount(mountImportPanel);
    row('pdf').click();
    row('image').click();
    row('clipboard').click();
    row('project').click();
    expect(a.importDocument).toHaveBeenCalledTimes(1);
    expect(a.insertImage).toHaveBeenCalledTimes(1);
    expect(a.pasteFromClipboard).toHaveBeenCalledTimes(1);
    expect(a.openProjectFile).toHaveBeenCalledTimes(1);
  });

  it('без права правки — доступен только файл проекта', () => {
    const a = actions({ canEdit: () => false });
    setPanelActions(a);
    const { row } = mount(mountImportPanel);
    for (const id of ['pdf', 'image', 'clipboard']) {
      expect(disabled(row(id))).toBe(true);
      expect(tip(row(id))).toBe('Нет права на правку этой страницы');
    }
    row('image').click();
    expect(a.insertImage).not.toHaveBeenCalled();
    expect(disabled(row('project'))).toBe(false);
    expect(disabled(row('drop'))).toBe(false);
    expect(row('drop').textContent).toContain('Перетащите файл проекта');
  });

  it('гость или просмотр по ссылке — файл проекта недоступен', () => {
    setPanelActions(actions({ canOpenProject: () => false }));
    const { row } = mount(mountImportPanel);
    expect(disabled(row('project'))).toBe(true);
    expect(tip(row('project'))).toContain('Недоступно');
  });

  it('перетаскивание: зона подсвечивается, файл уходит в importFile и не доходит до холста', () => {
    const a = actions();
    setPanelActions(a);
    const { row, host } = mount(mountImportPanel);
    const canvasDrop = vi.fn();
    document.body.addEventListener('drop', canvasDrop);
    const zone = row('drop');
    const file = new File(['%PDF'], 'урок.pdf', { type: 'application/pdf' });
    zone.dispatchEvent(dragEvent('dragenter', [file]));
    expect(zone.classList.contains('is-over')).toBe(true);
    expect(zone.textContent).toContain('Отпустите');
    const over = dragEvent('dragover', [file]);
    zone.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    const drop = dragEvent('drop', [file]);
    zone.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);
    expect(zone.classList.contains('is-over')).toBe(false);
    expect(a.importFile).toHaveBeenCalledWith(file);
    expect(canvasDrop).not.toHaveBeenCalled();
    document.body.removeEventListener('drop', canvasDrop);
    // уход курсора с файлом — подсветка гаснет
    host.querySelector('.pv')!.dispatchEvent(dragEvent('dragenter', [file]));
    host.querySelector('.pv')!.dispatchEvent(dragEvent('dragleave', [file]));
    expect(zone.classList.contains('is-over')).toBe(false);
  });

  it('importFile вернул false (формат не принят) — зона не показывает «Файл принят»; иначе показывает', () => {
    document.body.className = 'no-motion';
    const a = actions({ importFile: vi.fn(() => false) });
    setPanelActions(a);
    const { row, host } = mount(mountImportPanel);
    const file = new File(['x'], 'вирус.exe');
    host.querySelector('.pv')!.dispatchEvent(dragEvent('drop', [file]));
    expect(a.importFile).toHaveBeenCalledWith(file);
    expect(row('drop').textContent).not.toContain('Файл принят');
    const b = actions({ importFile: vi.fn(() => true) });
    setPanelActions(b);
    host.querySelector('.pv')!.dispatchEvent(dragEvent('drop', [new File(['x'], 'a.png', { type: 'image/png' })]));
    expect(row('drop').textContent).toContain('Файл принят');
    document.body.className = '';
  });

  it('перетаскивание не файла (текста) зона не принимает', () => {
    const a = actions();
    setPanelActions(a);
    const { row } = mount(mountImportPanel);
    const ev = Object.assign(new Event('drop', { bubbles: true, cancelable: true }), { dataTransfer: { types: ['text/plain'], files: [] } });
    row('drop').dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(a.importFile).not.toHaveBeenCalled();
  });

  it('щелчок по зоне — выбор файла с поддерживаемыми форматами', () => {
    setPanelActions(actions());
    const { row } = mount(mountImportPanel);
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      expect(this.type).toBe('file');
      expect(this.accept).toContain('.json');
      expect(this.accept).toContain('image/*');
      expect(this.accept).toContain('.pdf');
    });
    row('drop').click();
    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });
});
