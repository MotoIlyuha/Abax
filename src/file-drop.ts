// Зона «File drop» (по мотивам designbookmark.com/motion, file-drop/drop.js) для режима «Импорт» боковой панели.
// Файл над зоной: заливка поднимается, значок подпрыгивает. После отпускания «чип» с именем файла
// проглатывается кругом, круг «глотает», вокруг значка бежит кольцо с процентами, в конце круг заливается
// зелёным, галочка прорисовывается, а две строки текста перекатываются.
//
// Отличия от образца: нет демо-цикла (чип «из угла» сам не прилетает — зона стоит спокойно, цикл засыпает);
// чип вылетает из точки, где отпустили файл; сам импорт делает вызывающий код сразу (кольцо — только
// обратная связь, оно ничего не ждёт), а отклонённый файл («не тот формат», нет права) — лёгкое «покачивание».
// Пружины — те же жёсткость/затухание, что в drop.js.
//
// Три режима анимаций доски: «Улучшенные» — пружины; «Обычные» (body.no-motion) — пружины встают на цель
// сразу, а переходы дают CSS (src/style.css); «Выкл» (body.no-ui-anim) — сразу, без переходов.
// Весь текст — через textContent; через innerHTML вставляются только SVG-константы.

import { ICONS, ICON_CHECK, UPLOAD_ICON } from './icons';
import { S, atRest, clamp, motionEnabled, register, snap, step, wake, type Spring } from './motion';

export interface FileDropOptions {
  /** Заголовок в покое и подпись под ним. */
  idleTitle: string;
  idleHint: string;
  /** Заголовок, пока над зоной файл. */
  overTitle: string;
  /** Название для скринридера (к нему добавляется текущий текст зоны). */
  label: string;
}

export interface FileDrop {
  /** Сама зона: кнопка (её щелчок и доступность обрабатывает вызывающий код). */
  readonly el: HTMLButtonElement;
  /** Тексты покоя; instant — без перекатывания (первое заполнение). */
  setIdleText(title: string, hint: string, instant?: boolean): void;
  /** Файл над зоной (подсветка, подпрыгивание значка). */
  setOver(on: boolean): void;
  /** Файл принят: проглатывание, кольцо, галочка. at — где отпустили (координаты окна), иначе чип появляется над кругом. */
  accept(file: { name: string; size: number }, at?: { x: number; y: number }): void;
  /** Файл отклонён: зона вздрагивает, текст не меняется. */
  reject(): void;
  /** Сразу в покой (панель закрыта или режим сменился). */
  reset(): void;
}

const CIRC = 2 * Math.PI * 33;
/** Сколько бежит кольцо и сколько держится «готово» (секунды симуляции). */
const RING_SECONDS = 1.4;
const DONE_SECONDS = 2.6;
const FILE_ICON = ICONS.pdf;
const RING = '<svg viewBox="0 0 72 72" fill="none" stroke-width="3" stroke-linecap="round" aria-hidden="true"><circle class="xfer-drop-trk" cx="36" cy="36" r="33"/><circle class="xfer-drop-arc" cx="36" cy="36" r="33"/></svg>';

type Phase = 'idle' | 'upload' | 'done';

interface Line { el: HTMLElement; cur: HTMLElement; old: HTMLElement | null; o: Spring }
interface Inst { root: HTMLElement; frame(dt: number): void; render(): void; settled(): boolean }

/** Живые зоны: цикл пружин спит, пока все стоят. Отключённые от DOM снимаются сами. */
const insts = new Set<Inst>();
let registered = false;

function ensureLoop(): void {
  if (registered) return;
  registered = true;
  register({
    frame(dt) { for (const i of insts) i.frame(dt); },
    render() { for (const i of insts) i.render(); },
    settled() {
      for (const i of [...insts]) if (!i.root.isConnected) insts.delete(i);
      for (const i of insts) if (!i.settled()) return false;
      return true;
    },
  });
}

const fmtSize = (b: number): string => (b >= 1e6 ? `${(b / 1e6).toFixed(1).replace('.', ',')} МБ` : `${Math.max(1, Math.round(b / 1e3))} КБ`);
const shortName = (n: string): string => (n.length > 20 ? `${n.slice(0, 10)}…${n.slice(-8)}` : n);
/** Быстрый старт, «зависание» в середине, потом бег к концу (как у настоящей загрузки). */
const pace = (x: number): number => (x < 0.35 ? x * 1.4 : x < 0.6 ? 0.49 + (x - 0.35) * 0.4 : 0.59 + (x - 0.6) * 1.025);

function span(className: string, text?: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = className;
  if (text !== undefined) s.textContent = text;
  return s;
}

export function createFileDrop(o: FileDropOptions): FileDrop {
  const root = document.createElement('button');
  root.type = 'button';
  root.className = 'xfer-drop';

  const core = span('xfer-drop-core');
  const g = document.createElement('i');
  g.className = 'xfer-drop-g';
  const ring = span('xfer-drop-ring');
  ring.innerHTML = RING; // константа из кода
  const arc = ring.querySelector<SVGCircleElement>('.xfer-drop-arc')!;
  arc.style.strokeDasharray = CIRC.toFixed(2);
  const up = span('xfer-drop-up');
  up.setAttribute('aria-hidden', 'true');
  up.innerHTML = UPLOAD_ICON; // константа каталога иконок
  const pct = span('xfer-drop-pct', '0');
  pct.setAttribute('aria-hidden', 'true');
  const ok = span('xfer-drop-ok');
  ok.innerHTML = ICON_CHECK; // константа каталога иконок
  const tick = ok.querySelector<SVGPathElement>('path')!;
  core.append(g, ring, up, pct, ok);

  const line = (cls: string, text: string): Line => {
    const el = span(cls);
    const cur = span('', text);
    el.append(cur);
    return { el, cur, old: null, o: S(1, 360, 30) };
  };
  const T = line('xfer-drop-title', o.idleTitle);
  const U = line('xfer-drop-hint', o.idleHint);

  const chip = span('xfer-drop-chip');
  chip.setAttribute('aria-hidden', 'true');
  const chipIcon = span('xfer-drop-chip-icon');
  chipIcon.innerHTML = FILE_ICON; // константа каталога иконок
  const chipName = span('');
  chip.append(chipIcon, chipName);

  root.append(core, T.el, U.el, chip);

  // пружины — как в drop.js
  const FX = S(0, 520, 36), FY = S(0, 520, 36), FS = S(1, 520, 34), FO = S(0, 500, 40); // чип
  const ZS = S(1, 380, 16), ZH = S(0, 300, 26), CS = S(1, 420, 14); // зона, подсветка, круг
  const UP = S(1, 420, 30), PO = S(0, 420, 30), RO = S(0, 300, 30), G = S(0, 260, 21), K = S(0, 200, 26);
  const springs = [FX, FY, FS, FO, ZS, ZH, CS, UP, PO, RO, G, K, T.o, U.o];

  let phase: Phase = 'idle';
  let p = 0, tUp = 0, total = 0, name = '';
  let over = false, clock = 0, resetAt = 0, chipFadeAt = -1;
  let idleT = o.idleTitle, idleS = o.idleHint;

  /** Строка меняет текст: старая уходит вверх, новая поднимается. Без пружин — сразу. */
  function say(l: Line, text: string, instant = false): void {
    if (l.cur.textContent === text) return;
    if (l.old) { l.old.remove(); l.old = null; }
    if (instant || !motionEnabled() || !root.isConnected) { l.cur.textContent = text; l.o.x = 1; l.o.v = 0; return; }
    l.old = l.cur;
    l.cur = span('', text);
    l.el.append(l.cur);
    l.o.x = 0; l.o.v = 0; l.o.t = 1;
  }

  function sync(instant = false): void {
    let t = idleT, s = idleS;
    if (phase === 'upload') { t = `Принимаю «${name}»`; s = fmtSize(total); }
    else if (phase === 'done') { t = 'Файл принят'; s = `${name} · ${fmtSize(total)}`; }
    else if (over) t = o.overTitle;
    say(T, t, instant);
    say(U, s, instant);
    root.setAttribute('aria-label', `${o.label}. ${t}. ${s}`);
  }

  function finish(): void {
    phase = 'done'; p = 1;
    resetAt = clock + DONE_SECONDS;
    PO.t = 0; RO.t = 0; G.t = 1; K.t = 1; CS.x = 0.84;
    sync();
  }

  function toIdle(instant: boolean): void {
    phase = 'idle'; p = 0; tUp = 0; chipFadeAt = -1;
    G.t = 0; K.t = 0; UP.t = 1; PO.t = 0; RO.t = 0; FO.t = 0;
    sync(instant);
    if (instant) { for (const s of springs) snap(s); FO.x = 0; render(); }
  }

  /** Текущее состояние → DOM. */
  function render(): void {
    const h = clamp(ZH.x, 0, 1);
    const live = motionEnabled();
    root.style.setProperty('--h', h.toFixed(3));
    root.style.transform = `scale(${(ZS.x * (1 + 0.015 * ZH.x)).toFixed(4)})`;
    core.style.transform = `translateY(${(-5 * ZH.x).toFixed(2)}px) scale(${CS.x.toFixed(4)})`;
    const bob = live ? -3.5 * h * (0.5 + 0.5 * Math.sin(clock * 7)) : 0;
    up.style.opacity = clamp(UP.x, 0, 1).toFixed(3);
    up.style.transform = `translateY(${(bob + (1 - UP.x) * -12).toFixed(2)}px) scale(${(0.6 + 0.4 * UP.x).toFixed(3)})`;
    pct.style.opacity = clamp(PO.x, 0, 1).toFixed(3);
    pct.style.transform = `scale(${(0.7 + 0.3 * PO.x).toFixed(3)})`;
    ring.style.opacity = clamp(RO.x, 0, 1).toFixed(3);
    arc.style.strokeDashoffset = (CIRC * (1 - p)).toFixed(2);
    g.style.transform = `scale(${Math.max(0, G.x).toFixed(4)})`;
    ok.style.opacity = clamp(K.x * 4, 0, 1).toFixed(3);
    tick.style.strokeDashoffset = (24 * (1 - clamp(K.x, 0, 1))).toFixed(2);
    if (phase === 'upload') {
      const n = String(Math.round(p * 100));
      if (pct.textContent !== n) pct.textContent = n;
    }
    for (const l of [T, U]) {
      const k = clamp(l.o.x, 0, 1);
      // новая строка ждёт, пока старая уйдёт
      l.cur.style.opacity = clamp((k - 0.35) / 0.65, 0, 1).toFixed(3);
      l.cur.style.transform = `translateY(${((1 - l.o.x) * 16).toFixed(2)}px)`;
      if (l.old) {
        if (k > 0.985) { l.old.remove(); l.old = null; }
        else { l.old.style.opacity = clamp(1 - k * 1.8, 0, 1).toFixed(3); l.old.style.transform = `translateY(${(-l.o.x * 16).toFixed(2)}px)`; }
      }
    }
    chip.style.opacity = clamp(FO.x, 0, 1).toFixed(3);
    chip.style.transform = `translate(${FX.x.toFixed(2)}px,${FY.x.toFixed(2)}px) translate(-50%,-50%) rotate(${clamp(FX.v * 0.04, -16, 16).toFixed(2)}deg) scale(${Math.max(0, FS.x).toFixed(4)})`;
  }

  const inst: Inst = {
    root,
    frame(dt) {
      clock += dt;
      if (phase === 'upload') {
        tUp += dt;
        p = clamp(pace(tUp / RING_SECONDS), 0, 1);
        if (tUp >= RING_SECONDS) finish();
      } else if (phase === 'done' && clock >= resetAt) toIdle(false);
      if (chipFadeAt >= 0 && clock >= chipFadeAt) { FO.t = 0; chipFadeAt = -1; }
      ZH.t = over && phase === 'idle' ? 1 : 0;
      if (motionEnabled()) for (const s of springs) step(s, dt);
      else for (const s of springs) snap(s); // «Обычные» и «Выкл»: сразу в цель, плавность — у CSS
    },
    render,
    settled() {
      if (phase !== 'idle' || chipFadeAt >= 0) return false;
      if (over && motionEnabled()) return false; // значок подпрыгивает, пока файл над зоной
      return springs.every(s => atRest(s, 0.002)) && !T.old && !U.old;
    },
  };
  insts.add(inst);
  ensureLoop();

  root.addEventListener('pointerdown', () => { if (motionEnabled()) { ZS.x = 0.975; wake(); } });
  sync(true);
  render();

  return {
    el: root,
    setIdleText(title, hint, instant = false) {
      idleT = title; idleS = hint;
      sync(instant);
      wake();
    },
    setOver(on) {
      if (over === on) return;
      over = on;
      root.classList.toggle('is-over', on);
      sync();
      wake();
    },
    accept(file, at) {
      insts.add(inst); // на случай, если зону уже снимали с цикла как отключённую
      name = shortName(file.name); total = file.size;
      phase = 'upload'; p = 0; tUp = 0;
      over = false; root.classList.remove('is-over');
      UP.t = 0; PO.t = 1; RO.t = 1; G.t = 0; K.t = 0;
      pct.textContent = '0';
      if (motionEnabled()) {
        CS.x = 1.2; ZS.x = 0.965;
        // чип вылетает из точки, где отпустили файл (в пределах зоны), и проглатывается кругом
        chipName.textContent = name;
        const z = root.getBoundingClientRect();
        const cx = core.offsetLeft + core.offsetWidth / 2, cy = core.offsetTop + core.offsetHeight / 2;
        chip.style.left = `${cx.toFixed(1)}px`;
        chip.style.top = `${cy.toFixed(1)}px`;
        const sx = at && Number.isFinite(at.x) ? clamp(at.x - z.left, 24, Math.max(24, z.width - 24)) : cx;
        const sy = at && Number.isFinite(at.y) ? clamp(at.y - z.top, 24, Math.max(24, z.height - 24)) : cy - 56;
        FX.x = sx - cx; FY.x = sy - cy; FX.v = 0; FY.v = 0; FX.t = 0; FY.t = 0;
        FS.x = 1; FS.t = 0; FS.v = 0; FO.x = 1; FO.t = 1; FO.v = 0;
        chipFadeAt = clock + 0.16;
        sync();
      } else {
        // без пружин кольцо не нужно: сразу «готово»
        finish();
      }
      wake();
    },
    reject() {
      if (motionEnabled()) ZS.x = 0.955;
      wake();
    },
    reset() {
      over = false;
      root.classList.remove('is-over');
      toIdle(true);
    },
  };
}
