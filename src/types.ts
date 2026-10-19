export type ToolId =
  | 'select' | 'pen' | 'highlighter' | 'eraser' | 'pan'
  | 'text' | 'note' | 'rect' | 'ellipse' | 'triangle' | 'line' | 'arrow' | 'poly' | 'laser';

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

export type Element = StrokeEl | ShapeEl | PolyEl | TextEl | NoteEl | ImageEl;

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
}

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  pageCount: number;
}

export type GridMode = 'none' | 'dots' | 'square' | 'coord';

/** Точка лазерной указки в координатах сцены с меткой времени. */
export interface LaserPt { x: number; y: number; t: number }

/** Ручка редактирования выделенного элемента. */
export type Handle =
  | { kind: 'end'; i: 0 | 1 }
  | { kind: 'node'; i: number }
  | { kind: 'insert'; i: number }
  | { kind: 'resize'; dx: -1 | 0 | 1; dy: -1 | 0 | 1 }
  | { kind: 'rotate' };

export interface HandlePos { h: Handle; x: number; y: number }

/** Позиция панели инструментов. */
export type ToolbarPos = 'left' | 'right' | 'top' | 'bottom';

/** Поведение колёсика мыши: прокрутка холста или масштаб (как в Figma). */
export type WheelMode = 'scroll' | 'zoom';

export interface BoardSettings {
  toolbarPos: ToolbarPos;
  /** Подписи делений на координатной плоскости. */
  coordLabels: boolean;
  /** Привязка перемещения/размеров к видимому шагу сетки. */
  snapToGrid: boolean;
  /** Колёсико без модификаторов: прокрутка или масштаб. */
  wheelMode: WheelMode;
}
