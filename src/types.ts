export type ToolId =
  | 'select' | 'pen' | 'highlighter' | 'eraser' | 'pan'
  | 'text' | 'note' | 'rect' | 'ellipse' | 'line' | 'arrow';

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

export type Element = StrokeEl | ShapeEl | TextEl | NoteEl;

/** Экран = (сцена - камера) * zoom. */
export interface Camera { x: number; y: number; zoom: number }

export interface BoardMeta { id: string; name: string; createdAt: number; updatedAt: number }

export interface Board extends BoardMeta { elements: Element[] }

export type GridMode = 'none' | 'dots' | 'square';
