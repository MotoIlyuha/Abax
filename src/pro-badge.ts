// Единый бейдж «Pro» на недоступных по тарифу кнопках и настройках: новая страница (четвёртая), новый проект
// (четвёртый), «История изменений» в боковой панели, автопереход участников, права и гости в «Поделиться»,
// именной адрес. Один вид везде (класс .pro-badge), нажатие на бейдж открывает окно подписки (requestUpgrade).
//
// После оплаты бейджи не исчезают все разом: возможность, которая была закрыта, помечается «ждёт разлома»
// (хранится на устройстве), и бейдж дрожит и раскалывается только тогда, когда пользователь его увидит
// (IntersectionObserver: например, открыл «Настройки доступа»). Вернулся бесплатный тариф — бейджи снова на месте.
//
// Три режима анимаций доски:
// - «Улучшенные» — дрожание на пружине, трещина и две половинки, разлетающиеся с осколками;
// - «Обычные» (body.no-motion) — короткое CSS-дрожание и растворение;
// - «Выкл» (body.no-ui-anim) и «уменьшить движение» — бейдж пропадает сразу.

import { PLAN_LIMITS, type PlanLimits } from './limits';
import { S, clamp, motionEnabled, reduceMotion, register, snap, step, tune, uiAnimOff, wake, type Spring } from './motion';
import { limitsEnforced, onPlanChange, userPlan } from './plan';

export type ProFeature = 'pages' | 'projects' | 'history' | 'follow' | 'copy' | 'clone' | 'guests' | 'alias';
export const PRO_FEATURES: readonly ProFeature[] = ['pages', 'projects', 'history', 'follow', 'copy', 'clone', 'guests', 'alias'];

const CAN: Record<ProFeature, (l: PlanLimits) => boolean> = {
  pages: l => l.maxPagesPerProject === Infinity,
  projects: l => l.maxProjects === Infinity,
  history: l => l.historyPanel,
  follow: l => l.canFollowHost,
  copy: l => l.canProtectCopy,
  clone: l => l.canProtectClone,
  guests: l => l.canSetMaxGuests,
  alias: l => l.canSetAlias,
};

/** Возможность закрыта тарифом: лимиты действуют, и на текущем тарифе её нет. */
export function featureLocked(f: ProFeature): boolean {
  return limitsEnforced() && !CAN[f](PLAN_LIMITS[userPlan()]);
}

// ----- Окно подписки -----

let upgradeHandler: ((f: ProFeature | null) => void) | null = null;

/** Кто открывает окно подписки (src/app.ts). */
export function setUpgradeHandler(fn: ((f: ProFeature | null) => void) | null): void {
  upgradeHandler = fn;
}

/** Открыть окно подписки (из-за недоступной возможности f или просто так). */
export function requestUpgrade(f: ProFeature | null = null): void {
  upgradeHandler?.(f);
}

// ----- Что ждёт разлома -----

export const PENDING_KEY = 'doska.proBadgePending';
export const LOCKED_KEY = 'doska.proBadgeLocked';

function readSet(key: string): Set<ProFeature> | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    const v = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(v) ? v.filter((x): x is ProFeature => PRO_FEATURES.includes(x as ProFeature)) : []);
  } catch { return null; }
}

function writeSet(key: string, s: Set<ProFeature>): void {
  try { localStorage.setItem(key, JSON.stringify([...s])); } catch { /* хранилище недоступно: до перезагрузки */ }
}

let pending: Set<ProFeature> = new Set();
let started = false;

const lockedNow = (): Set<ProFeature> => new Set(PRO_FEATURES.filter(featureLocked));

/**
 * Сверить закрытые возможности с прошлым снимком: открывшиеся ждут разлома, закрывшиеся — больше нет.
 * Первый запуск (снимка ещё нет) только запоминает, что закрыто: бейджам, которых не было, ломаться нечего.
 */
export function syncProLocks(): void {
  const prev = readSet(LOCKED_KEY);
  const now = lockedNow();
  pending = readSet(PENDING_KEY) ?? new Set();
  if (prev) {
    for (const f of prev) if (!now.has(f)) pending.add(f);
  }
  for (const f of now) pending.delete(f);
  writeSet(LOCKED_KEY, now);
  writeSet(PENDING_KEY, pending);
  refreshProBadges();
}

/** Возможность ждёт, пока пользователь увидит, как её бейдж раскалывается. */
export function breakPending(f: ProFeature): boolean {
  return pending.has(f);
}

/** Следить за тарифом (один раз при запуске приложения). */
export function startProBadges(): void {
  if (started) return;
  started = true;
  syncProLocks();
  onPlanChange(() => syncProLocks());
}

/** Для тестов. */
export function resetProBadgesForTests(): void {
  pending = new Set();
  started = false;
  observer?.disconnect();
  observer = null;
  for (const b of breaking) b.done();
  breaking.clear();
}

// ----- Бейдж -----

export interface ProBadgeOptions {
  /** Дополнительный класс (место бейджа). */
  className?: string;
  /** Подсказка; по умолчанию — «Доступно в подписке Pro». */
  title?: string;
  /** Нужен ли бейдж здесь сейчас, кроме тарифа (например, страниц уже три). По умолчанию — да. */
  needed?: boolean;
}

const BADGE_TITLE = 'Доступно в подписке Pro - нажмите, чтобы посмотреть тарифы';

/** Бейдж «Pro» возможности f; видимость ведёт сам (refreshProBadges), место — needed. */
export function proBadge(f: ProFeature, o: ProBadgeOptions = {}): HTMLElement {
  const b = document.createElement('span');
  b.className = `pro-badge${o.className ? ` ${o.className}` : ''}`;
  b.dataset.pro = f;
  b.textContent = 'Pro';
  b.title = o.title ?? BADGE_TITLE;
  b.setAttribute('aria-label', 'Pro');
  if (o.needed === false) b.dataset.needed = '0';
  // нажатие на закрытый бейдж — окно подписки (а не действие кнопки, на которой он стоит)
  b.addEventListener('click', e => {
    if (!b.classList.contains('is-locked')) return;
    e.preventDefault();
    e.stopPropagation();
    requestUpgrade(f);
  });
  b.addEventListener('pointerdown', e => { if (b.classList.contains('is-locked')) e.stopPropagation(); });
  syncBadge(b);
  return b;
}

/** Нужен ли бейдж на своём месте (кроме тарифа): например, «новая страница» — только когда страниц уже три. */
export function setProBadgeNeeded(b: HTMLElement, needed: boolean): void {
  const v = needed ? '1' : '0';
  if (b.dataset.needed === v || (needed && b.dataset.needed === undefined)) { syncBadge(b); return; }
  b.dataset.needed = v;
  syncBadge(b);
}

/** Обновить все бейджи на странице (или внутри root): после смены тарифа, открытия окна и т. п. */
export function refreshProBadges(root: ParentNode = document): void {
  for (const b of root.querySelectorAll<HTMLElement>('.pro-badge[data-pro]')) syncBadge(b);
}

function syncBadge(b: HTMLElement): void {
  const f = b.dataset.pro as ProFeature;
  if (breakingOf(b)) return;
  const needed = b.dataset.needed !== '0';
  const locked = featureLocked(f);
  const waiting = !locked && needed && pending.has(f);
  b.classList.toggle('is-locked', locked);
  b.classList.toggle('is-waiting', waiting);
  b.hidden = !needed || (!locked && !waiting);
  if (waiting) watch(b); else observer?.unobserve(b);
}

// ----- Увидел — раскололся -----

let observer: IntersectionObserver | null = null;
/** Бейдж в кадре: ждём чуть-чуть (меню доезжает), потом ломаем. */
const SEEN_DELAY_MS = 320;

function watch(b: HTMLElement): void {
  if (typeof IntersectionObserver === 'undefined') {
    // без наблюдателя (старый браузер, тесты) — «увидел», если бейдж в документе
    if (b.isConnected) queueMicrotask(() => seen(b));
    return;
  }
  observer ??= new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting || e.intersectionRatio < 0.6) continue;
      const el = e.target as HTMLElement;
      window.setTimeout(() => { if (visibleNow(el)) seen(el); }, SEEN_DELAY_MS);
    }
  }, { threshold: [0, 0.6, 1] });
  observer.observe(b);
}

function visibleNow(b: HTMLElement): boolean {
  if (!b.isConnected || b.hidden || document.visibilityState === 'hidden') return false;
  const r = b.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  // бейдж не под затемнением модального окна: в точке его центра — он сам (или его содержимое)
  const hit = document.elementFromPoint?.(r.left + r.width / 2, r.top + r.height / 2);
  return !hit || hit === b || b.contains(hit) || hit.closest('.pro-shard-layer') !== null;
}

/** Пользователь увидел ждущий бейдж: ломаем его и всех видимых сейчас соседей той же возможности. */
function seen(b: HTMLElement): void {
  const f = b.dataset.pro as ProFeature;
  if (!pending.has(f) || featureLocked(f) || !b.classList.contains('is-waiting')) return;
  const mates = [...document.querySelectorAll<HTMLElement>(`.pro-badge.is-waiting[data-pro="${f}"]`)].filter(x => x === b || visibleNow(x));
  pending.delete(f);
  writeSet(PENDING_KEY, pending);
  for (const m of mates) breakBadge(m);
  // остальные бейджи этой возможности (не на экране) просто прячутся
  refreshProBadges();
}

// ----- Анимация разлома -----

interface Piece { el: HTMLElement; x: number; y: number; vx: number; vy: number; r: number; vr: number; life: number }

interface Breaking {
  badge: HTMLElement;
  /** Дрожание: смещение и наклон. */
  sx: Spring;
  sr: Spring;
  /** Ширина бейджа схлопывается после разлома (соседи съезжают). */
  w: Spring;
  t: number;
  kicks: number;
  split: boolean;
  width: number;
  layer: HTMLElement | null;
  pieces: Piece[];
  done(): void;
}

const breaking = new Set<Breaking>();
let loopOn = false;

const breakingOf = (b: HTMLElement): boolean => [...breaking].some(x => x.badge === b);

const SHAKE: readonly [number, number] = [900, 9];
const SHAKE_ROT: readonly [number, number] = [700, 8];
/** Секунды: удары дрожания (по одному на метку), затем трещина и разлом. */
const KICKS = [0, 0.07, 0.14, 0.21, 0.28];
const T_CRACK = 0.36;
const T_SPLIT = 0.46;
const GRAVITY = 1400;

function ensureLoop(): void {
  if (loopOn) return;
  loopOn = true;
  register({
    frame(dt) {
      for (const k of breaking) {
        k.t += dt;
        while (k.kicks < KICKS.length && k.t >= KICKS[k.kicks]) {
          const dir = k.kicks % 2 === 0 ? 1 : -1;
          k.sx.v += dir * (160 - k.kicks * 14);
          k.sr.v += -dir * (90 - k.kicks * 8);
          k.kicks++;
        }
        step(k.sx, dt);
        step(k.sr, dt);
        step(k.w, dt);
        for (const p of k.pieces) {
          p.vy += GRAVITY * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.r += p.vr * dt;
          p.life -= dt;
        }
      }
    },
    render() {
      for (const k of [...breaking]) paintBreak(k);
    },
    settled: () => breaking.size === 0,
  });
}

function crackSvg(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 100 100');
  s.setAttribute('preserveAspectRatio', 'none');
  s.setAttribute('class', 'pro-crack');
  s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', 'M56 -4 L44 34 L60 60 L46 104');
  s.appendChild(p);
  return s;
}

/** Две половинки по ломаной трещине и несколько осколков. */
const HALVES = [
  'polygon(0 0, 56% 0, 44% 34%, 60% 60%, 46% 100%, 0 100%)',
  'polygon(56% 0, 100% 0, 100% 100%, 46% 100%, 60% 60%, 44% 34%)',
];

function splitBadge(k: Breaking): void {
  const b = k.badge;
  const r = b.getBoundingClientRect();
  const layer = document.createElement('div');
  layer.className = 'pro-shard-layer';
  layer.setAttribute('aria-hidden', 'true');
  document.body.appendChild(layer);
  k.layer = layer;
  const cs = getComputedStyle(b);
  const make = (clip: string | null, cls: string): HTMLElement => {
    const e = document.createElement('span');
    e.className = cls;
    e.style.left = `${r.left}px`;
    e.style.top = `${r.top}px`;
    e.style.width = `${r.width}px`;
    e.style.height = `${r.height}px`;
    e.style.borderRadius = cs.borderRadius;
    if (clip) {
      e.textContent = 'Pro';
      e.style.clipPath = clip;
      e.style.fontSize = cs.fontSize;
      e.style.lineHeight = `${r.height}px`;
    }
    layer.appendChild(e);
    return e;
  };
  const left = make(HALVES[0], 'pro-badge pro-half');
  const right = make(HALVES[1], 'pro-badge pro-half');
  k.pieces.push(
    { el: left, x: 0, y: 0, vx: -70 - Math.random() * 30, vy: -260 - Math.random() * 60, r: 0, vr: -260 - Math.random() * 120, life: 0.9 },
    { el: right, x: 0, y: 0, vx: 80 + Math.random() * 30, vy: -220 - Math.random() * 60, r: 0, vr: 300 + Math.random() * 120, life: 0.9 },
  );
  for (let i = 0; i < 6; i++) {
    const s = make(null, 'pro-shard');
    const size = 2 + Math.random() * 3;
    s.style.width = s.style.height = `${size}px`;
    s.style.left = `${r.left + r.width * (0.42 + Math.random() * 0.2)}px`;
    s.style.top = `${r.top + r.height * Math.random()}px`;
    const a = Math.random() * Math.PI * 2;
    const v = 120 + Math.random() * 160;
    k.pieces.push({ el: s, x: 0, y: 0, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 180, r: 0, vr: (Math.random() - 0.5) * 900, life: 0.55 + Math.random() * 0.25 });
  }
  // сам бейдж невидим и схлопывается: соседи съезжают на его место
  b.classList.add('is-split');
  k.width = r.width + (parseFloat(cs.marginLeft) || 0) + (parseFloat(cs.marginRight) || 0);
  k.w.x = 1;
  k.w.t = 0;
}

function paintBreak(k: Breaking): void {
  const b = k.badge;
  if (!k.split) {
    b.style.transform = `translateX(${k.sx.x.toFixed(2)}px) rotate(${k.sr.x.toFixed(2)}deg)`;
    if (k.t >= T_CRACK) b.classList.add('is-cracked');
    if (k.t >= T_SPLIT) {
      k.split = true;
      b.style.transform = '';
      if (b.isConnected) splitBadge(k);
    }
    return;
  }
  const w = clamp(k.w.x, 0, 1);
  b.style.width = `${(k.width * w).toFixed(2)}px`;
  b.style.marginLeft = b.style.marginRight = '0px';
  b.style.paddingLeft = b.style.paddingRight = '0px';
  for (const p of k.pieces) {
    p.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) rotate(${p.r.toFixed(1)}deg)`;
    p.el.style.opacity = clamp(p.life * 2.2, 0, 1).toFixed(3);
  }
  if (k.pieces.every(p => p.life <= 0) && w < 0.01) k.done();
}

/** Расколоть бейдж (он уже не нужен: возможность открыта). */
export function breakBadge(b: HTMLElement): void {
  observer?.unobserve(b);
  const finish = () => {
    b.classList.remove('is-waiting', 'is-breaking', 'is-cracked', 'is-split', 'pro-badge-css-break');
    for (const p of ['transform', 'width', 'margin-left', 'margin-right', 'padding-left', 'padding-right']) b.style.removeProperty(p);
    b.querySelector('.pro-crack')?.remove();
    b.hidden = true;
  };
  if (uiAnimOff() || reduceMotion()) { finish(); return; }
  if (!motionEnabled()) {
    // «Обычные»: CSS-дрожание и растворение
    b.classList.add('pro-badge-css-break');
    const done = () => finish();
    b.addEventListener('animationend', e => { if (e.animationName === 'pro-css-vanish') done(); });
    window.setTimeout(done, 900);
    return;
  }
  ensureLoop();
  const k: Breaking = {
    badge: b, sx: S(0), sr: S(0), w: S(1), t: 0, kicks: 0, split: false, width: 0, layer: null, pieces: [],
    done: () => {
      breaking.delete(k);
      k.layer?.remove();
      finish();
    },
  };
  tune(k.sx, ...SHAKE);
  tune(k.sr, ...SHAKE_ROT);
  tune(k.w, 260, 24); // --spring-soft
  snap(k.w);
  b.classList.add('is-breaking');
  b.appendChild(crackSvg());
  breaking.add(k);
  wake();
}
