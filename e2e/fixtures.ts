import { test as base, expect, type Locator, type Page } from '@playwright/test';

export type El = Record<string, any>;
type Pt = { x: number; y: number };

/** Снимок состояния приложения через отладочный window.__doska (см. src/main.ts). */
export interface Snapshot {
  tool: string;
  selection: string[];
  camera: { x: number; y: number; zoom: number };
  style: { color: string; width: number; opacity?: number };
  noteColor: string;
  pageId: string;
  view: string;
  dirty: boolean;
  settings: Record<string, unknown>;
  project: { id: string; name: string; pages: { id: string; name: string; grid: string; count: number }[] };
  projects: { id: string; name: string; pageCount: number }[];
  grid: string;
  livePoly: number | null;
  fadeStrokes: number;
  laserPts: number;
  flashes: number;
}

/** Страница-доска: чтение состояния и рисование в координатах сцены. */
export class Board {
  readonly canvas: Locator;
  readonly quickMenu: Locator;

  constructor(readonly page: Page) {
    this.canvas = page.locator('#board');
    this.quickMenu = page.locator('#quick-menu');
  }

  async open(path = '/'): Promise<void> {
    await this.page.goto(path);
    await this.ready();
  }

  async ready(): Promise<void> {
    await this.page.waitForFunction(() => !!(window as any).__doska);
    await expect(this.page.locator('#toolbar .tool').first()).toBeVisible();
  }

  elements(): Promise<El[]> {
    // src картинок обрезаем: data URL бывают по мегабайту
    return this.page.evaluate(() => (window as any).__doska.state.board.elements.map((e: any) =>
      e.type === 'image' ? { ...e, src: e.src.slice(0, 32) } : e));
  }

  async count(type?: string): Promise<number> {
    const els = await this.elements();
    return type ? els.filter(e => e.type === type).length : els.length;
  }

  state(): Promise<Snapshot> {
    return this.page.evaluate(() => {
      const s = (window as any).__doska.state;
      return {
        tool: s.tool,
        selection: [...s.selection],
        camera: { ...s.camera },
        style: { ...s.style },
        noteColor: s.noteColor,
        pageId: s.pageId,
        view: s.view,
        dirty: s.dirty,
        settings: { ...s.settings },
        project: {
          id: s.project.id,
          name: s.project.name,
          pages: s.project.pages.map((p: any) => ({ id: p.id, name: p.name, grid: p.grid, count: p.elements.length })),
        },
        projects: s.projects.map((m: any) => ({ id: m.id, name: m.name, pageCount: m.pageCount })),
        grid: s.board.grid,
        livePoly: s.livePoly ? s.livePoly.pts.length : null,
        fadeStrokes: s.fadeStrokes.length,
        laserPts: s.laserPts.length,
        flashes: s.flashes.length,
      };
    });
  }

  /** Сцена → координаты окна с учётом камеры. */
  async screen(p: Pt): Promise<Pt> {
    const box = (await this.canvas.boundingBox())!;
    const cam = (await this.state()).camera;
    return { x: box.x + (p.x - cam.x) * cam.zoom, y: box.y + (p.y - cam.y) * cam.zoom };
  }

  async move(p: Pt, steps = 1): Promise<void> {
    const s = await this.screen(p);
    await this.page.mouse.move(s.x, s.y, { steps });
  }

  async click(p: Pt, opts: { button?: 'left' | 'right'; modifiers?: string[] } = {}): Promise<void> {
    const s = await this.screen(p);
    for (const m of opts.modifiers ?? []) await this.page.keyboard.down(m);
    await this.page.mouse.click(s.x, s.y, { button: opts.button });
    for (const m of opts.modifiers ?? []) await this.page.keyboard.up(m);
  }

  async dblclick(p: Pt): Promise<void> {
    const s = await this.screen(p);
    await this.page.mouse.dblclick(s.x, s.y);
  }

  /** Протягивание по точкам сцены (модификаторы зажимаются на всё время). */
  async drag(points: Pt[], opts: { modifiers?: string[]; steps?: number } = {}): Promise<void> {
    // экранные координаты считаем заранее: во время протягивания камера может меняться
    const screens: Pt[] = [];
    for (const p of points) screens.push(await this.screen(p));
    for (const m of opts.modifiers ?? []) await this.page.keyboard.down(m);
    await this.page.mouse.move(screens[0].x, screens[0].y);
    await this.page.mouse.down();
    for (const s of screens.slice(1)) await this.page.mouse.move(s.x, s.y, { steps: opts.steps ?? 6 });
    await this.page.mouse.up();
    for (const m of opts.modifiers ?? []) await this.page.keyboard.up(m);
  }

  /**
   * Инструмент горячей клавишей (фокус уводим с полей ввода). У выделенной фигуры стоит текстовый
   * курсор и буква ушла бы в её надпись — сперва Esc снимает выделение, как сделал бы пользователь.
   */
  async tool(key: string): Promise<void> {
    await this.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    if (await this.page.locator('.shape-caret').count() > 0) await this.page.keyboard.press('Escape');
    await this.page.keyboard.press(key);
  }

  /** Инструмент из группы тулбара: Фигуры / Стереометрия / Указка. */
  async groupTool(group: 'shapes' | 'solids' | 'pointer', id: string): Promise<void> {
    await this.page.locator(`#btn-${group}`).click();
    await this.page.locator(`#ctx-layer .ctx-panel [data-shape="${id}"]`).click();
    await expect.poll(async () => (await this.state()).tool).toBe(id);
  }

  /** Фон страницы — через выпадающий список в шапке. */
  async grid(mode: string): Promise<void> {
    await this.page.locator('#grid-mode').click();
    await this.page.locator(`#grid-menu [data-grid="${mode}"]`).click();
    await expect(this.page.locator('#grid-menu')).toBeHidden();
  }

  async rect(x0: number, y0: number, x1: number, y1: number): Promise<El> {
    await this.tool('r');
    await this.drag([{ x: x0, y: y0 }, { x: x1, y: y1 }]);
    const els = await this.elements();
    return els[els.length - 1];
  }

  /** Показать список страниц под плавающей кнопкой (клавишей B: кнопка при одной странице добавляет вторую). */
  async openPages(): Promise<void> {
    if (await this.page.locator('#pages-dock.open').count() === 0) await this.tool('b');
    await expect(this.page.locator('#pages-tray')).toBeVisible();
  }

  /** Новая страница — плитка «+» в конце списка страниц. */
  async addPage(): Promise<void> {
    await this.openPages();
    const before = (await this.state()).project.pages.length;
    await this.page.locator('#pages-list .page-add').click();
    await expect.poll(async () => (await this.state()).project.pages.length).toBe(before + 1);
  }

  /** Дождаться конца CSS-переходов и анимаций (подъём кнопки, появление карточек, смена страницы). */
  async settled(): Promise<void> {
    // бесконечные (мигающий курсор в выделенной фигуре) не ждём
    await this.page.waitForFunction(() => document.getAnimations()
      .every(a => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity));
  }

  /** Дождаться автосохранения в localStorage. */
  async saved(): Promise<void> {
    await expect.poll(async () => (await this.state()).dirty).toBe(false);
  }
}

/** Кнопка по подсказке: title переносится в data-tip при первом наведении. */
export function byTip(scope: Page | Locator, tip: string): Locator {
  return scope.locator(`[title="${tip}"], [data-tip="${tip}"]`);
}

export const test = base.extend<{ board: Board }>({
  // auto: страница открыта в каждом тесте, даже если он работает только с page
  board: [async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(String(e)));
    const board = new Board(page);
    await board.open();
    await use(board);
    expect(errors, 'ошибки JS на странице').toEqual([]);
  }, { auto: true }],
});

export { expect };
