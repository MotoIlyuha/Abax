// Постановка объекта перетаскиванием с панели инструментов: фигуры, стереометрического
// тела или стикера. Размер задаётся в экранных пикселях и переводится в координаты
// сцены — брошенный объект всегда выглядит одинаково крупным при любом масштабе.

import type { Element, PolyEl, Pt, ShapeEl, SolidKind, ToolId } from './types';
import { NOTE_W, NOTE_H } from './geom';
import { fitSolid, SOLID_CLICK_SIZE } from './solid';
import { opacityField } from './state';

/** Минимальные экранные размеры новых фигур. */
const SHAPE_SIZE: Record<ShapeEl['shape'], [number, number]> = {
  rect: [180, 120],
  ellipse: [180, 120],
  triangle: [160, 140],
  line: [180, 110],
  arrow: [180, 110],
};

/** Ломаная без протягивания — знакомый зигзаг, как на иконке инструмента. */
const POLY_POINTS: Pt[] = [
  { x: -90, y: 40, p: 0.5 },
  { x: -45, y: -40, p: 0.5 },
  { x: 0, y: 40, p: 0.5 },
  { x: 45, y: -40, p: 0.5 },
  { x: 90, y: 40, p: 0.5 },
];

const SHAPE_TOOLS = new Set<ToolId>(['rect', 'ellipse', 'triangle', 'line', 'arrow', 'poly']);
const SOLID_TOOLS = new Set<ToolId>(['cube', 'box', 'prism', 'pyramid', 'truncPyramid', 'cylinder', 'cone', 'truncCone', 'sphere']);

/** Инструмент можно «выронить» на холст — на нём появляется соответствующий объект. */
export function canDropTool(tool: ToolId): boolean {
  return SHAPE_TOOLS.has(tool) || SOLID_TOOLS.has(tool) || tool === 'note';
}

export interface DropStyle {
  color: string;
  width: number;
  opacity?: number;
}

/**
 * Объект, который создаётся при броске инструмента в точку сцены at.
 * zoom — текущий масштаб холста (переводит экранные размеры в сцену).
 */
export function toolDropElement(
  tool: ToolId,
  id: string,
  at: { x: number; y: number },
  zoom: number,
  style: DropStyle,
  noteColor: string,
): Element | null {
  if (!canDropTool(tool)) return null;
  if (tool === 'note') {
    return {
      id, type: 'note',
      x: at.x - NOTE_W / 2, y: at.y - NOTE_H / 2, w: NOTE_W, h: NOTE_H,
      text: '', color: noteColor,
    };
  }
  if (SOLID_TOOLS.has(tool)) {
    const [sw, sh] = SOLID_CLICK_SIZE[tool as SolidKind];
    const w = sw / zoom;
    const h = sh / zoom;
    const solid = fitSolid(
      tool as SolidKind,
      at.x - w / 2, at.y - h / 2, at.x + w / 2, at.y + h / 2,
      { id, color: style.color, width: style.width },
    );
    return { ...solid, ...opacityField(style.opacity) };
  }
  if (tool === 'poly') {
    const pts = POLY_POINTS.map(p => ({ x: at.x + p.x / zoom, y: at.y + p.y / zoom, p: p.p }));
    const poly: PolyEl = {
      id, type: 'poly', closed: false, color: style.color, width: style.width * 1.1,
      ...opacityField(style.opacity), pts,
    };
    return poly;
  }
  const shape = tool as ShapeEl['shape'];
  const [sw, sh] = SHAPE_SIZE[shape];
  const w = sw / zoom;
  const h = sh / zoom;
  if (shape === 'line' || shape === 'arrow') {
    return {
      id, type: 'shape', shape,
      x: at.x - w / 2, y: at.y + h / 2, w, h: -h,
      color: style.color, width: style.width, ...opacityField(style.opacity),
    };
  }
  return {
    id, type: 'shape', shape,
    x: at.x - w / 2, y: at.y - h / 2, w, h,
    color: style.color, width: style.width, ...opacityField(style.opacity),
  };
}
