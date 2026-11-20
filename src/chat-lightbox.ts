// Просмотр картинки из чата поверх доски (SPEC_CHAT §7): затемнение, картинка по центру, под ней — «Вставить на доску»
// (только если можно править страницу) и «Закрыть». Esc и щелчок мимо картинки и кнопок закрывают.
// Анимация открытия: «Улучшенные» — пружина масштаба от миниатюры в ленте, «Обычные» — CSS-затухание 180 мс,
// «Выкл» — сразу. src — только проверенный data URL картинки (isChatImageUrl), иначе просмотр не открывается.

import { isChatImageUrl } from './room-chat';
import { S, register, step, tune, wake, type Spring } from './motion';
import { menuMotion } from './menu-motion';

export interface ChatLightboxOptions {
  src: string;
  w: number;
  h: number;
  alt?: string;
  /** Миниатюра, от которой «вырастает» картинка («Улучшенные»). */
  from?: HTMLElement | null;
  /** Можно ли вставить картинку на текущую страницу (право правки). */
  canInsert(): boolean;
  insert(): void;
}

export const INSERT_DENIED = 'Нет права править эту страницу';

let current: { close(instant?: boolean): void } | null = null;

/** Открыт ли просмотр. */
export function chatLightboxOpen(): boolean {
  return current !== null;
}

export function closeChatLightbox(instant = false): void {
  current?.close(instant);
}

// пружина «Улучшенных»: p — от 0 (миниатюра) к 1 (на месте)
const P: Spring = S(1);
let target: { img: HTMLElement; dx: number; dy: number; k: number } | null = null;
let loop = false;

function springFrom(img: HTMLElement, from: DOMRect): void {
  const to = img.getBoundingClientRect();
  if (!(to.width > 0) || !(from.width > 0)) return;
  target = {
    img,
    dx: from.left + from.width / 2 - (to.left + to.width / 2),
    dy: from.top + from.height / 2 - (to.top + to.height / 2),
    k: from.width / to.width,
  };
  tune(P, 360, 26);
  P.x = 0; P.v = 0; P.t = 1;
  if (!loop) {
    loop = true;
    register({
      frame(dt) { if (target) step(P, dt); },
      render() {
        if (!target) return;
        const t = target;
        if (!t.img.isConnected || (Math.abs(P.x - 1) < 0.001 && Math.abs(P.v) < 0.01)) {
          t.img.style.removeProperty('transform');
          target = null;
          return;
        }
        const q = 1 - P.x;
        const k = 1 + (t.k - 1) * q;
        t.img.style.transform = `translate(${(t.dx * q).toFixed(2)}px, ${(t.dy * q).toFixed(2)}px) scale(${k.toFixed(4)})`;
      },
      settled: () => target === null,
    });
  }
  wake();
}

export function openChatLightbox(o: ChatLightboxOptions): HTMLElement | null {
  if (!isChatImageUrl(o.src)) return null;
  current?.close(true);
  const mode = menuMotion();
  const restore = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const root = document.createElement('div');
  root.className = 'chat-lightbox';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Просмотр изображения');
  const stage = document.createElement('div');
  stage.className = 'clb-stage';
  const img = document.createElement('img');
  img.className = 'clb-img';
  img.alt = o.alt ?? 'Изображение';
  img.decoding = 'async';
  img.width = o.w;
  img.height = o.h;
  img.src = o.src;
  const bar = document.createElement('div');
  bar.className = 'clb-bar';
  const insert = document.createElement('button');
  insert.type = 'button';
  insert.className = 'clb-btn clb-insert';
  insert.textContent = 'Вставить на доску';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'clb-btn clb-close';
  close.textContent = 'Закрыть';
  bar.append(insert, close);
  stage.append(img, bar);
  root.append(stage);

  const syncInsert = () => {
    const ok = o.canInsert();
    insert.setAttribute('aria-disabled', String(!ok));
    insert.classList.toggle('off', !ok);
    insert.title = ok ? 'Вставить картинку в центр видимой области доски' : INSERT_DENIED;
  };
  syncInsert();

  let closed = false;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); api.close(); }
  };
  const api = {
    close(instant = false) {
      if (closed) return;
      closed = true;
      if (current === api) current = null;
      document.removeEventListener('keydown', onKey, true);
      if (instant || mode === 'off') root.remove();
      else {
        root.classList.remove('clb-in');
        root.classList.add('clb-out');
        window.setTimeout(() => root.remove(), 180);
      }
      if (restore?.isConnected) restore.focus({ preventScroll: true });
    },
  };
  current = api;

  insert.addEventListener('click', () => {
    syncInsert();
    if (!o.canInsert()) return;
    o.insert();
    api.close();
  });
  close.addEventListener('click', () => api.close());
  root.addEventListener('click', e => {
    if (e.target === root || e.target === stage) api.close();
  });
  document.addEventListener('keydown', onKey, true);

  document.body.append(root);
  if (mode === 'off') root.classList.add('clb-static');
  else {
    // затемнение — CSS-затухание в обоих режимах; «Улучшенные» добавляют пружину картинки от миниатюры
    void root.offsetWidth;
    root.classList.add('clb-in');
    const from = mode === 'enhanced' ? o.from?.getBoundingClientRect() : undefined;
    if (from) springFrom(img, from);
    else img.classList.add('clb-fade');
  }
  close.focus({ preventScroll: true });
  return root;
}
