import type { ToolId } from './types';

// «Залипающий» инструмент: двойной щелчок по кнопке группы инструментов включает режим массового
// добавления — после каждой фигуры, тела или ломаной инструмент остаётся включённым (и новый
// объект не выделяется). Режим живёт только в памяти и снимается выбором любого другого инструмента:
// state.setTool вызывает clearStickyTool при смене инструмента.

let sticky: ToolId | null = null;

/** Инструмент, включённый в режиме массового добавления, или null. */
export function stickyTool(): ToolId | null {
  return sticky;
}

export function setStickyTool(tool: ToolId): void {
  sticky = tool;
}

export function clearStickyTool(): void {
  sticky = null;
}
