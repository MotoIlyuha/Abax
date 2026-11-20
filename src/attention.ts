// «Привлечь внимание» (SPEC_COMMENTS §5): щелчок по реакции на объекте — частицы этой реакции разлетаются из объекта.
import { state } from './state';
import { elementAABB } from './geom';
import { burst } from './reaction-burst';
import { showReactions } from './annot-prefs';
import { canAnnotate } from './comments-ui';

/** Повторный щелчок по той же реакции раньше этого — без новых частиц (хаб всё равно режет частоту). */
export const ATTENTION_LOCAL_MS = 350;
const lastAt = new Map<string, number>();

/** Частицы emoji из объекта elId текущей страницы; false — объекта нет, он за экраном или реакции скрыты. */
export function burstFromElement(elId: string, emoji: string): boolean {
  if (!showReactions()) return false;
  const el = state.board.elements.find(e => e.id === elId);
  if (!el) return false;
  const a = elementAABB(el);
  const cam = state.camera;
  const x0 = (a.x0 - cam.x) * cam.zoom, x1 = (a.x1 - cam.x) * cam.zoom;
  const y0 = (a.y0 - cam.y) * cam.zoom, y1 = (a.y1 - cam.y) * cam.zoom;
  const wrap = document.getElementById('canvas-wrap');
  const w = wrap?.clientWidth || window.innerWidth;
  const h = wrap?.clientHeight || window.innerHeight;
  if (x1 < 0 || y1 < 0 || x0 > w || y0 > h) return false;
  return burst(emoji, { x: (x0 + x1) / 2, y: (y0 + y1) / 2, rx: (x1 - x0) / 2, ry: (y1 - y0) / 2 });
}

/** Щелчок по пилюле реакции: частицы у себя (и у остальных — через хаб). */
export function attractAttention(elId: string, emoji: string): void {
  if (!canAnnotate()) return;
  const key = `${state.pageId}:${elId}:${emoji}`;
  const now = performance.now();
  if (now - (lastAt.get(key) ?? -Infinity) < ATTENTION_LOCAL_MS) return;
  lastAt.set(key, now);
  burstFromElement(elId, emoji);
}
