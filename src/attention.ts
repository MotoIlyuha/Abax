// «Привлечь внимание» (SPEC_COMMENTS §5): щелчок по реакции на объекте — частицы этой реакции разлетаются из объекта
// у меня и (через хаб, пакет attention) у всех участников, кому страница видна. У получателя на той же странице —
// частицы из объекта и, если курсор отправителя сейчас краевой (за экраном), маленькие реакции из него внутрь экрана;
// у всех — уведомление с эмодзи и «Перейти». Имена участников — только textContent (через центр уведомлений).

import { state } from './state';
import { elementAABB } from './geom';
import { burst } from './reaction-burst';
import { showReactions } from './annot-prefs';
import { canAnnotate } from './comments-ui';
import { ATTENTION_EVENT, collabAvatar, collabUsers, sendAttention, type CollabAttentionDetail } from './collab';
import { edgePointerOf } from './collab-presence';
import { pushNotice } from './notify-center';
import { elementLabel } from './discussion';
import { DEFAULT_CURSOR_ID } from './cursors';
import { showBoardObjects } from './chat-attach-view';

/** Повторный щелчок по той же реакции раньше этого — без новых частиц (хаб всё равно режет частоту). */
export const ATTENTION_LOCAL_MS = 350;
/** Уведомления от одного участника к одному объекту чаще этого не копятся (частицы — каждый раз). */
export const ATTENTION_NOTICE_MS = 6000;
const lastAt = new Map<string, number>();
const noticedAt = new Map<string, number>();

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

/** Маленькие реакции из краевого курсора участника uid — внутрь экрана (от края); false — курсор не краевой. */
export function burstFromEdge(uid: number, emoji: string): boolean {
  if (!showReactions()) return false;
  const p = edgePointerOf(uid);
  if (!p) return false;
  // стрелка смотрит на участника за краем — частицы летят в обратную сторону
  return burst(emoji, { x: p.x, y: p.y, angle: p.angle + Math.PI, spread: Math.PI * 0.7, small: true });
}

/** Щелчок по пилюле реакции: частицы у себя и у остальных — через хаб. */
export function attractAttention(elId: string, emoji: string): void {
  if (!canAnnotate()) return;
  const key = `${state.pageId}:${elId}:${emoji}`;
  const now = performance.now();
  if (now - (lastAt.get(key) ?? -Infinity) < ATTENTION_LOCAL_MS) return;
  lastAt.set(key, now);
  burstFromElement(elId, emoji);
  sendAttention(state.pageId, elId, emoji);
}

/** Пакет attention от хаба: частицы (на моей странице) и уведомление. */
export function receiveAttention(d: CollabAttentionDetail): void {
  const page = state.project.pages.find(p => p.id === d.pageId);
  if (!page) return;
  if (d.pageId === state.pageId) {
    burstFromElement(d.elId, d.emoji);
    burstFromEdge(d.by, d.emoji);
  }
  const key = `${d.by}:${d.pageId}:${d.elId}`;
  const now = Date.now();
  if (now - (noticedAt.get(key) ?? -Infinity) < ATTENTION_NOTICE_MS) return;
  noticedAt.set(key, now);
  const who = collabUsers().find(u => u.userId === d.by);
  const name = who ? (who.host ? String(who.name ?? '') || 'Автор' : String(who.name ?? '') || 'Участник') : 'Участник';
  const el = (d.pageId === state.pageId ? state.board.elements : page.elements).find(e => e.id === d.elId);
  const where = d.pageId === state.pageId ? '' : ` на странице «${page.name}»`;
  pushNotice({
    title: name,
    body: `привлекает внимание · ${elementLabel(el)}${where}`,
    emoji: d.emoji,
    ...(who ? { user: { userId: who.userId, name, cursorId: who.cursorId ?? DEFAULT_CURSOR_ID, avatar: collabAvatar(who) } } : {}),
    action: { label: 'Перейти', run: () => { void showBoardObjects({ pageId: d.pageId, ids: [d.elId] }); } },
  });
}

let inited = false;

/** Подписка на пакеты attention от комнаты. */
export function initAttention(): void {
  if (inited) return;
  inited = true;
  document.addEventListener(ATTENTION_EVENT, e => receiveAttention((e as CustomEvent<CollabAttentionDetail>).detail));
}
