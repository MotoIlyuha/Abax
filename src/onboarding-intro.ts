// Заставка окна первого входа: сначала крупно по центру только логотип и «Добро пожаловать в Abax»,
// через пару секунд они на пружине встают на свои места, карточка вырастает до размера окна,
// затем проявляются кнопка закрытия и остальные элементы шага 1.
//
// Раскладка окна с самого начала финальная: прячутся только прочие элементы (прозрачность), а логотип
// и заголовок сдвинуты и увеличены трансформацией. Фон и тень окна на время заставки рисует отдельная
// карточка (.ob-card) — её прямоугольник едет от рамки вокруг крупного заголовка к рамке окна.
// Пружина --intro-reveal (почти критическая — плавно и без перелёта); один прогресс p ведёт всё синхронно.

import { S, atRest, motionEnabled, reduceMotion, register, snap, spring, step, wake, type Spring } from './motion';

/** Сколько секунд держится заставка. */
export const INTRO_HOLD = 1.8;
const SCALE = 1.6;       // во сколько раз крупнее логотип и заголовок на заставке
const PAD_X = 40;        // поля карточки заставки по бокам от крупных логотипа и заголовка
const PAD_Y = 72;        // и сверху/снизу — карточка заметно выше надписи
const REVEAL_AT = 0.5;   // с какого прогресса проявляются остальные элементы

interface Box { x: number; y: number; w: number; h: number }
interface Intro { root: HTMLElement; p: Spring; frame(dt: number): void; render(): void; settled(): boolean }

const intros = new Set<Intro>();
let ready = false;
// почти критическое затухание: окно раскрывается плавно, без перелёта и подрагивания в конце
let REVEAL: [number, number] = [150, 24];

function ensureLoop(): void {
  if (ready) return;
  ready = true;
  REVEAL = spring('--intro-reveal', REVEAL);
  register({
    frame(dt) {
      for (const it of intros) {
        if (!it.root.isConnected) { intros.delete(it); continue; }
        it.frame(dt);
      }
    },
    render() { for (const it of intros) it.render(); },
    settled() { for (const it of intros) if (!it.settled()) return false; return true; },
  });
}

/** Заставка уместна: анимации включены и пользователь не просил уменьшить движение. */
export function introEnabled(): boolean {
  return motionEnabled() && !reduceMotion();
}

const rect = (e: Element): Box => {
  const r = e.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
};

/** Рамка самого текста (заголовок — блок во всю ширину окна, а нужна ширина надписи). */
function textRect(e: Element): Box {
  const range = document.createRange();
  range.selectNodeContents(e);
  const r = range.getBoundingClientRect?.();
  return r && r.width ? { x: r.left, y: r.top, w: r.width, h: r.height } : rect(e);
}
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export interface IntroParts {
  root: HTMLElement;     // #onboarding — полноэкранная подложка, координаты = координаты окна браузера
  win: HTMLElement;      // .ob-window
  logo: HTMLElement;
  title: HTMLElement;
  /** Что проявляется после заставки, по порядку. */
  rest: HTMLElement[];
  /** Заставка закончилась (элементы видны и доступны). */
  onReveal(): void;
}

/**
 * Запустить заставку. Окно уже в документе и разложено. Возвращает «пропустить»:
 * щелчок по заставке сразу переходит к раскрытию.
 */
export function playIntro(parts: IntroParts): () => void {
  ensureLoop();
  const { root, win, logo, title, rest } = parts;
  rest.forEach((e, i) => e.style.setProperty('--ob-i', String(i)));
  root.classList.add('ob-intro', 'ob-intro-card');

  // финальные места; заставка — та же группа «логотип + заголовок», увеличенная и по центру экрана
  const L = rect(logo);
  const T = rect(title);
  const TT = textRect(title);
  const W = rect(win);
  const top = Math.min(L.y, T.y);
  const bottom = Math.max(L.y + L.h, T.y + T.h);
  const groupW = Math.max(L.w, TT.w);
  // крупно, но надпись помещается и в окно (лента шагов обрезает), и в экран
  const k = Math.max(1, Math.min(SCALE, (Math.min(W.w, window.innerWidth - 32) - 2 * PAD_X) / (groupW || 1)));
  const gc = { x: W.x + W.w / 2, y: (top + bottom) / 2 };          // центр группы в окне
  const sc = { x: window.innerWidth / 2, y: window.innerHeight / 2 }; // центр группы на заставке
  const off = (b: Box) => ({
    // центр элемента на заставке = центр заставки + (смещение от центра группы) × k
    dx: sc.x + (b.x + b.w / 2 - gc.x) * k - (b.x + b.w / 2),
    dy: sc.y + (b.y + b.h / 2 - gc.y) * k - (b.y + b.h / 2),
  });
  const oL = off(L);
  const oT = off(T);
  const sw = groupW * k + 2 * PAD_X;
  const sh = (bottom - top) * k + 2 * PAD_Y;
  const from: Box = { x: sc.x - sw / 2, y: sc.y - sh / 2, w: sw, h: sh };

  const card = document.createElement('div');
  card.className = 'ob-card';
  root.insertBefore(card, win);

  const p = S(0, ...REVEAL);
  let revealed = false;
  let started = false;
  let timer = 0;

  function reveal(): void {
    if (revealed) return;
    revealed = true;
    root.classList.add('ob-revealed');
    parts.onReveal();
  }
  function start(): void {
    if (started) return;
    started = true;
    clearTimeout(timer);
    p.t = 1;
    wake();
  }

  const it: Intro = {
    root: card,
    p,
    frame(dt) {
      if (!motionEnabled()) snap(p); else step(p, dt);
      if (started && p.x >= REVEAL_AT) reveal();
    },
    render() {
      const t = p.x;
      const s = lerp(k, 1, t);
      logo.style.transform = `translate(${lerp(oL.dx, 0, t).toFixed(2)}px, ${lerp(oL.dy, 0, t).toFixed(2)}px) scale(${s.toFixed(4)})`;
      title.style.transform = `translate(${lerp(oT.dx, 0, t).toFixed(2)}px, ${lerp(oT.dy, 0, t).toFixed(2)}px) scale(${s.toFixed(4)})`;
      card.style.left = `${lerp(from.x, W.x, t).toFixed(2)}px`;
      card.style.top = `${lerp(from.y, W.y, t).toFixed(2)}px`;
      card.style.width = `${lerp(from.w, W.w, t).toFixed(2)}px`;
      card.style.height = `${lerp(from.h, W.h, t).toFixed(2)}px`;
      if (started && atRest(p, 0.002)) finish();
    },
    settled: () => !started || atRest(p, 0.002),
  };

  function finish(): void {
    intros.delete(it);
    logo.style.transform = '';
    title.style.transform = '';
    // без этого снятие класса заново запустило бы CSS-появление окна (ui-pop) — то самое моргание в конце
    win.style.animation = 'none';
    card.remove();
    root.classList.remove('ob-intro-card');
    reveal();
    // переходы проявления (с задержками по очереди) доигрывают, затем правила заставки снимаются
    window.setTimeout(() => root.classList.remove('ob-intro'), 1400);
  }

  intros.add(it);
  // Первый кадр должен быть готов до показа окна, а не после следующего кадра анимации.
  it.render();
  wake();
  timer = window.setTimeout(start, INTRO_HOLD * 1000);
  card.addEventListener('pointerdown', start);
  win.addEventListener('pointerdown', start);
  return start;
}
