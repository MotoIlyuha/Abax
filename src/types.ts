export type ToolId =
  | 'select' | 'pen' | 'highlighter' | 'eraser' | 'pan'
  | 'text' | 'note' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'laser';

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
}

export interface ShapeEl {
  id: string;
  type: 'shape';
  shape: 'rect' | 'ellipse' | 'line' | 'arrow';
  /** x,y — якорь; w,h — смещения (для линии/стрелки могут быть отрицательными). */
  x: number; y: number; w: number; h: number;
  color: string;
  width: number;
}

export interface TextEl {
  id: string;
  type: 'text';
  /** x,y — левый верхний угол текстового блока. */
  x: number; y: number;
  text: string;
  size: number;
  color: string;
}

export interface NoteEl {
  id: string;
  type: 'note';
  x: number; y: number; w: number; h: number;
  text: string;
  color: string;
}

/** Импортированная страница PDF или картинка — фон для аннотирования. */
export interface ImageEl {
  id: string;
  type: 'image';
  x: number; y: number; w: number; h: number;
  /** data:image/jpeg;base64,... */
  src: string;
}

export type Element = StrokeEl | ShapeEl | TextEl | NoteEl | ImageEl;

/** Экран = (сцена - камера) * zoom. */
export interface Camera { x: number; y: number; zoom: number }

export interface BoardMeta { id: string; name: string; createdAt: number; updatedAt: number }

export interface Board extends BoardMeta { elements: Element[] }

export type GridMode = 'none' | 'dots' | 'square' | 'coord';

/** Точка лазерной указки в координатах сцены с меткой времени. */
export interface LaserPt { x: number; y: number; t: number }
