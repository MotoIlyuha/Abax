/** Стереометрические тела (id инструмента совпадает с видом тела). */
export type SolidKind =
  | 'cube' | 'box' | 'prism' | 'pyramid' | 'truncPyramid'
  | 'cylinder' | 'cone' | 'truncCone' | 'sphere';

export type ToolId =
  | 'select' | 'pen' | 'highlighter' | 'eraser' | 'pan'
  | 'text' | 'note' | 'rect' | 'ellipse' | 'triangle' | 'line' | 'arrow' | 'poly'
  | PointerKind
  | SolidKind;

/** Инструменты группы «Указка»: ничего не оставляют на доске. */
export type PointerKind = 'laser' | 'fadePen' | 'flash';

/** Точка в координатах сцены; p — давление 0..1 (мышь даёт 0.5). */
export interface Pt { x: number; y: number; p: number }

export interface StrokeEl {
  id: string;
  type: 'stroke';
  tool: 'pen' | 'highlighter';
  color: string;
  /** Базовая толщина в юнитах сцены (умножается на давление при рендере). */
  width: number;
  pts: Pt[];
  /** Идентификатор группы, если элемент сгруппирован. */
  groupId?: string;
}

export interface ShapeEl {
  id: string;
  type: 'shape';
  shape: 'rect' | 'ellipse' | 'triangle' | 'line' | 'arrow';
  /** x,y — якорь; w,h — смещения (для линии/стрелки могут быть отрицательными). */
  x: number; y: number; w: number; h: number;
  color: string;
  width: number;
  /** Поворот вокруг центра в радианах (только rect/ellipse/triangle). */
  rot?: number;
  groupId?: string;
}

/** Ломаная: открытая или замкнутая (контур). */
export interface PolyEl {
  id: string;
  type: 'poly';
  closed: boolean;
  color: string;
  width: number;
  pts: Pt[];
  groupId?: string;
}

export interface TextEl {
  id: string;
  type: 'text';
  /** x,y — левый верхний угол текстового блока. */
  x: number; y: number;
  text: string;
  size: number;
  color: string;
  bold?: boolean;
  italic?: boolean;
  groupId?: string;
}
export interface NoteEl {
  id: string;
  type: 'note';
  x: number; y: number; w: number; h: number;
  text: string;
  color: string;
  groupId?: string;
}

/** Импортированная страница PDF или картинка — фон для аннотирования. */
export interface ImageEl {
  id: string;
  type: 'image';
  x: number; y: number; w: number; h: number;
  /** data:image/jpeg;base64,... или data:image/png;base64,... */
  src: string;
  /** Поворот вокруг центра в радианах. */
  rot?: number;
  groupId?: string;
}

/**
 * Стереометрическое тело — каркасная модель: невидимые рёбра рисуются пунктиром.
 * Многогранники — в кабинетной проекции (глубина под 45° с сокращением 0.5),
 * тела вращения — с основаниями-эллипсами, как в школьных учебниках.
 */
export interface SolidEl {
  id: string;
  type: 'solid';
  solid: SolidKind;
  /**
   * Якорь в сцене: у многогранников — передний левый нижний угол (3D-начало координат),
   * у тел вращения — центр нижнего основания, у шара — центр.
   */
  x: number; y: number;
  /** Ширина (у тел вращения — диаметр основания). */
  w: number;
  /** Глубина: у многогранников — истинная (рисуется с сокращением), у тел вращения — высота эллипса основания. */
  d: number;
  /** Высота тела. */
  h: number;
  /** Число сторон основания призмы/пирамиды. */
  n?: number;
  /** Отношение верхнего основания к нижнему (усечённые пирамида и конус), 0..1. */
  t?: number;
  color: string;
  width: number;
  groupId?: string;
}

export type Element = StrokeEl | ShapeEl | PolyEl | TextEl | NoteEl | ImageEl | SolidEl;

/** Экран = (сцена - камера) * zoom. */
export interface Camera { x: number; y: number; zoom: number }

/** Страница — один холст: свой фон и набор элементов. */
export interface Page {
  id: string;
  name: string;
  grid: GridMode;
  elements: Element[];
}

/** Проект — набор страниц. */
export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  pages: Page[];
  /** Закреплён в избранном на домашней странице. */
  pinned?: boolean;
}

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  pageCount: number;
  pinned?: boolean;
}

export type GridMode = 'none' | 'dots' | 'square' | 'coord';

/**
 * Точка лазерной указки в экранных координатах с меткой времени.
 * Экранных, а не сцены: при масштабировании след не раздувается вместе с доской.
 */
export interface LaserPt { x: number; y: number; t: number }

/** Росчерк исчезающего маркера; endT — когда оторвали перо (с этого момента гаснет). */
export interface FadeStroke { color: string; width: number; pts: Pt[]; endT: number | null }

/** Кратковременная подсветка контура элементов; t — момент начала. */
export interface Flash { ids: string[]; t: number }

/** Ручка редактирования выделенного элемента. */
export type Handle =
  | { kind: 'end'; i: 0 | 1 }
  | { kind: 'node'; i: number }
  | { kind: 'insert'; i: number }
  | { kind: 'resize'; dx: -1 | 0 | 1; dy: -1 | 0 | 1 }
  | { kind: 'rotate' }
  /** Параметр тела: a — ребро куба (меняет w, d, h разом). */
  | { kind: 'param'; key: 'w' | 'd' | 'h' | 't' | 'a' };

/** from — начало направляющей (высота, радиус), которую рисуем к ручке. */
export interface HandlePos { h: Handle; x: number; y: number; from?: { x: number; y: number } }

/** Позиция панели инструментов. */
export type ToolbarPos = 'left' | 'right' | 'top' | 'bottom';

/** Поведение колёсика мыши: прокрутка холста или масштаб (как в Figma). */
export type WheelMode = 'scroll' | 'zoom';

/** Анимация перехода на другую страницу. */
export type PageTransition = 'none' | 'slide' | 'fade' | 'zoom';

/** Модификатор перехода на страницу по номеру: Ctrl+1…9 или Alt+1…9. */
export type PageKeyMod = 'ctrl' | 'alt';

export interface BoardSettings {
  toolbarPos: ToolbarPos;
  /** Подписи делений на координатной плоскости. */
  coordLabels: boolean;
  /** Привязка перемещения/размеров к видимому шагу сетки. */
  snapToGrid: boolean;
  /** Колёсико без модификаторов: прокрутка или масштаб. */
  wheelMode: WheelMode;
  pageTransition: PageTransition;
  pageKeyMod: PageKeyMod;
  /** Сочетание «новая страница» («Ctrl+KeyN», см. hotkeys.ts); null — без сочетания. */
  newPageKey: string | null;
  /** Плавное появление меню и панелей (кроме плавающего меню выделения). */
  uiAnimations: boolean;
  /** Скрыть кнопки «Отменить» и «Повторить» в шапке (Ctrl+Z / Ctrl+Y работают). */
  hideUndoRedo: boolean;
}
