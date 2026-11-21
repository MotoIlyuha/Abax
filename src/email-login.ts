// Вход по почте в окне первого входа: «пружинное» поле адреса → шесть клеток кода.
// Оба вида — по мотивам Springy Input и OTP Code с designbookmark.com/motion; пружины те же
// (--input-caret, --input-morph в style.css и константы клеток кода из образца).
//
// Поле адреса: настоящий <input> остаётся на месте (ввод, вставка, доступность), но его текст прозрачный.
// Зеркальный слой рисует по span на символ: новые буквы падают с отскоком, удалённые улетают вверх,
// свой курсор пружинит между позициями и вытягивается от скорости. Неверный адрес — буквы качаются
// волной и поле трясётся; верный — буквы улетают, поле сжимается в зелёную «пилюлю», затем появляются клетки кода.
// Клетки кода: скрытый input принимает цифры, клетки их показывают; полный код — клетки сливаются в одну
// полосу, после подтверждения она зеленеет. Ошибка — полоса снова делится, ряд трясётся, код стирается.
// Весь текст пользователя — через textContent; иконки — константы.

import { AuthError, authErrorText, startEmail, verifyEmail, type AuthMode } from './auth';
import { S, atRest, clamp, motionEnabled, register, snap, spring, step, tune, wake, type Spring } from './motion';
import { ICON_ARROW, ICON_CHECK, ICON_RING } from './icons';

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const N = 6;        // цифр в коде

/**
 * Код из вставленного текста: только 6 цифр. Сначала ищем отдельную группу из шести цифр
 * (можно с пробелами или дефисами внутри: «123 456», «123-456») — так дата или номер рядом не мешают;
 * иначе берём первые шесть цифр текста. Пустая строка — цифр нет.
 */
export function extractCode(text: string): string {
  const group = /(?<!\d)\d(?:[  \-–]?\d){5}(?!\d)/.exec(text);
  if (group) return group[0].replace(/\D/g, '');
  return text.replace(/\D/g, '').slice(0, N);
}
const GAP = 8;      // зазор между клетками кода

/** Ширина клетки кода при ширине блока w. */
const cellWidth = (w: number): number => Math.min(48, (w - GAP * (N - 1)) / N);
/** Ширина слитой полосы клеток: в неё же сжимается поле адреса — пилюля переходит в клетки без шва. */
const stripWidth = (w: number): number => cellWidth(w) * N;
const BOX_R = 12;   // скругление клетки кода — как у полей окна
const RESEND_SEC = 60;  // через сколько можно запросить код ещё раз
const STAGE_PAD = 14;   // отступы блока сверху и снизу на шаге кода

export type EmailStage = 'email' | 'code';

export interface EmailLoginOptions {
  mode: AuthMode;
  /** Код подтверждён — вошли (или почта привязана). */
  onDone(): void;
  /** Высота блока поменялась (окно подстраивает свою); now — меняется покадрово, подстроиться без перехода. */
  onResize(now?: boolean): void;
  /** Сменился этап: адрес ↔ код (окно перестраивает соседние способы входа). */
  onStage?(stage: EmailStage): void;
}

export interface EmailLogin { el: HTMLElement; focus(): void }

interface View { el: HTMLElement; focus(): void; dispose(): void }
interface Live { root: HTMLElement; frame(dt: number): void; render(): void; settled(): boolean }

// ----- общий цикл: один компонент в motion.ts на все живые виды -----
const live = new Set<Live>();
let ready = false;
let CARET: [number, number] = [700, 32];
let MORPH: [number, number] = [300, 20];
let SOFT: [number, number] = [260, 24];

function ensureLoop(): void {
  if (ready) return;
  ready = true;
  CARET = spring('--input-caret', CARET);
  MORPH = spring('--input-morph', MORPH);
  SOFT = spring('--spring-soft', SOFT);
  register({
    frame(dt) {
      for (const l of live) {
        if (!l.root.isConnected) { live.delete(l); continue; }
        l.frame(dt);
      }
    },
    render() { for (const l of live) l.render(); },
    settled() { for (const l of live) if (!l.settled()) return false; return true; },
  });
}

/** «Motion анимации» выключены — пружины встают на цель сразу, паузы нулевые. */
const instant = (): boolean => !motionEnabled();
const adv = (s: Spring, dt: number): void => { if (instant()) snap(s); else step(s, dt); };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Таймеры вида: снимаются разом при смене вида. */
function timers() {
  const list = new Set<number>();
  return {
    later(sec: number, fn: () => void): void {
      const id = window.setTimeout(() => { list.delete(id); fn(); }, instant() ? 0 : sec * 1000);
      list.add(id);
    },
    clear(): void { list.forEach(id => clearTimeout(id)); list.clear(); },
  };
}

let seq = 0;

/**
 * Перестроить раскладку с пружинами (FLIP): запоминаем, где элементы стояли, применяем change,
 * и каждый элемент едет со старого места и старой ширины на новые по --spring-soft.
 */
const flips = new Map<HTMLElement, Live>();
export function springLayout(els: HTMLElement[], change: () => void): void {
  ensureLoop();
  const before = els.map(e => e.getBoundingClientRect());
  for (const e of els) {
    const prev = flips.get(e);
    if (prev) { live.delete(prev); flips.delete(e); }
    e.style.transform = '';
    e.style.width = '';
  }
  change();
  if (instant()) return;
  const items = els.flatMap((e, i) => {
    const a = before[i];
    const b = e.getBoundingClientRect();
    if (!a.width || !b.width) return [];   // скрытый до или после — двигать нечего
    const it = { e, base: b.width, x: S(a.left - b.left, ...SOFT), y: S(a.top - b.top, ...SOFT), w: S(a.width - b.width, ...SOFT) };
    it.x.t = it.y.t = it.w.t = 0;
    return [it];
  });
  if (!items.length) return;
  const me: Live = {
    root: items[0].e,
    frame(dt) { for (const it of items) { adv(it.x, dt); adv(it.y, dt); adv(it.w, dt); } },
    render() {
      const done = me.settled();
      for (const it of items) {
        it.e.style.transform = done ? '' : `translate(${it.x.x.toFixed(2)}px, ${it.y.x.toFixed(2)}px)`;
        it.e.style.width = done || Math.abs(it.w.x) < 0.5 ? '' : `${(it.base + it.w.x).toFixed(2)}px`;
      }
      if (done) { live.delete(me); for (const it of items) flips.delete(it.e); }
    },
    settled: () => items.every(it => atRest(it.x, 0.1) && atRest(it.y, 0.1) && atRest(it.w, 0.1)),
  };
  for (const it of items) flips.set(it.e, me);
  live.add(me);
  wake();
}

export function createEmailLogin(o: EmailLoginOptions): EmailLogin {
  ensureLoop();
  const host = el('div', 'em');
  let view: View | null = null;
  // этап кода: блок плавно получает отступы сверху и снизу
  const P = S(0, ...SOFT);
  let stage: EmailStage = 'email';
  const setStage = (s: EmailStage) => {
    if (s === stage) return;
    stage = s;
    P.t = s === 'code' ? 1 : 0;
    o.onStage?.(s);
    wake();
  };
  live.add({
    root: host,
    frame(dt) { adv(P, dt); },
    render() {
      const pad = STAGE_PAD * clamp(P.x, 0, 1.2);
      host.style.padding = pad > 0.05 ? `${pad.toFixed(2)}px 0` : '';
      if (!atRest(P, 0.002)) o.onResize(true);
    },
    settled: () => atRest(P, 0.002),
  });

  function show(v: View): void {
    view?.dispose();
    host.textContent = '';
    host.appendChild(v.el);
    view = v;
    o.onResize();
    v.focus();
  }
  const toEmail = (value: string, fromPill: boolean) =>
    show(springyView(value, fromPill, (addr, dev) => toCode(addr, dev), o.onResize));
  const toCode = (addr: string, dev?: string) =>
    show(codeView(addr, dev, o.mode, () => toEmail(addr, true), o.onDone, o.onResize, setStage));

  toEmail('', false);
  return { el: host, focus: () => view?.focus() };
}

// ----- поле адреса (Springy Input) -----
function springyView(value: string, fromPill: boolean, sent: (addr: string, dev?: string) => void, resize: () => void): View {
  const id = `em-email-${++seq}`;
  const wrap = el('div', 'em-springy');
  const field = el('form', 'em-field');
  field.noValidate = true;
  const label = el('label', 'em-label', 'Адрес почты');
  label.htmlFor = id;
  const box = el('div', 'em-box');
  const layerOut = el('div', 'em-layer');
  const layer = el('div', 'em-layer-in');
  layerOut.appendChild(layer);
  const input = el('input', 'em-input');
  input.id = id;
  input.type = 'email';
  input.name = 'email';
  input.inputMode = 'email';
  input.autocomplete = 'email';
  input.spellcheck = false;
  const caret = el('span', 'em-caret');
  box.append(layerOut, input, caret);
  const go = el('button', 'em-go idle');
  go.type = 'submit';
  go.setAttribute('aria-label', 'Получить код');
  go.innerHTML = ICON_ARROW;
  const doneEl = el('div', 'em-done');
  doneEl.setAttribute('aria-hidden', 'true');
  doneEl.innerHTML = ICON_CHECK;
  doneEl.appendChild(el('span', '', 'Код отправлен'));
  field.append(label, box, go, doneEl);
  const help = el('p', 'em-help');
  help.id = `${id}-help`;
  help.setAttribute('aria-live', 'polite');
  input.setAttribute('aria-describedby', help.id);
  wrap.append(field, help);

  const C = S(0, ...CARET);           // x курсора
  const LB = S(0, 420, 26);           // подпись: 0 — в поле, 1 — наверху
  const W = S(0, ...MORPH);           // ширина поля (0 — естественная)
  const shake = S(0, 700, 10);
  const T = timers();
  let spans: HTMLSpanElement[] = [];
  let prev = '';
  let scroll = 0;
  let want = 0;
  let lastMove = 0;
  let focused = false;
  let busy = false;

  const setHelp = (text: string, err = false) => {
    if (help.textContent === text && help.classList.contains('err') === err) return;
    help.textContent = text;
    help.classList.toggle('err', err);
    resize();
  };

  function sync(): void {
    const next = input.value;
    if (next === prev) return;
    let a = 0;
    while (a < prev.length && a < next.length && prev[a] === next[a]) a++;
    let b = 0;
    while (b < prev.length - a && b < next.length - a && prev[prev.length - 1 - b] === next[next.length - 1 - b]) b++;
    // удалённые символы улетают с того места, где стояли
    for (const s of spans.splice(a, prev.length - a - b)) {
      const left = s.offsetLeft;
      s.classList.remove('in', 'nope');
      s.style.left = `${left}px`;
      s.classList.add('out');
      setTimeout(() => s.remove(), 360);
    }
    // вставленные падают одна за другой (вставка из буфера — волной)
    const ref = spans[a] ?? null;
    const fresh = [...next.slice(a, next.length - b)].map((ch, i) => {
      const s = el('span', 'em-ch in', ch === ' ' ? ' ' : ch);
      s.style.setProperty('--d', `${Math.min(i, 30) * 18}ms`);
      layer.insertBefore(s, ref);
      return s;
    });
    spans.splice(a, 0, ...fresh);
    prev = next;
    lastMove = performance.now();
    field.classList.remove('err');
    setHelp('');
    go.classList.toggle('idle', !next);
    wake();
  }

  function caretTarget(): number {
    // у type="email" нет selectionEnd — курсор стоит в конце
    const i = input.selectionEnd ?? spans.length;
    if (!spans.length) return 0;
    if (i < spans.length) return spans[i].offsetLeft;
    const l = spans[spans.length - 1];
    return l.offsetLeft + l.offsetWidth;
  }

  function wave(cls: 'nope' | 'fly', gap: number): void {
    spans.forEach((s, i) => {
      s.classList.remove('in', 'nope');
      void s.offsetWidth;
      s.style.setProperty('--d', `${i * gap}ms`);
      s.classList.add(cls);
    });
  }

  function reject(text: string): void {
    wave('nope', 14);
    field.classList.add('err');
    setHelp(text, true);
    shake.v += 420;
    input.focus();
    wake();
  }

  async function submit(): Promise<void> {
    if (busy) return;
    const addr = input.value.trim();
    if (!EMAIL_RE.test(addr)) { reject(addr ? 'Похоже, в адресе опечатка - проверьте его' : 'Сначала введите адрес почты'); return; }
    busy = true;
    go.classList.add('wait');
    let r: { devCode?: string };
    try {
      r = await startEmail(addr);
    } catch (e) {
      busy = false;
      go.classList.remove('wait');
      reject(authErrorText(e instanceof AuthError ? e.code : 'auth-failed'));
      return;
    } finally { go.classList.remove('wait'); }
    // буквы улетают, поле сжимается в зелёную пилюлю, затем — клетки кода
    wave('fly', 16);
    const lift = 0.25 + spans.length * 0.016;
    T.later(lift, () => {
      W.x = field.offsetWidth;
      W.v = 0;
      tune(W, ...MORPH);
      W.t = stripWidth(wrap.clientWidth);
      field.classList.add('ok');
      field.setAttribute('aria-label', 'Код отправлен');
      input.blur();
      wake();
    });
    T.later(lift + 1.0, () => sent(addr, r.devCode));
    wake();
  }

  input.addEventListener('input', sync);
  input.addEventListener('focus', () => { focused = true; field.classList.add('focus'); wake(); });
  input.addEventListener('blur', () => { focused = false; field.classList.remove('focus'); wake(); });
  for (const ev of ['keydown', 'keyup', 'click', 'select']) input.addEventListener(ev, () => { lastMove = performance.now(); wake(); });
  field.addEventListener('submit', e => { e.preventDefault(); void submit(); });

  if (fromPill) {
    // вернулись от кода: клетки слились в полосу — она раскрывается обратно в поле, адрес падает волной
    busy = true;
    T.later(0, () => {
      const strip = stripWidth(wrap.clientWidth);
      field.style.width = `${strip}px`;
      W.x = strip;
      W.v = 0;
      tune(W, MORPH[0] * 0.8, MORPH[1]);
      W.t = wrap.clientWidth || strip;
      busy = false;
      input.value = value;
      sync();
      input.focus();
      wake();
      // и скорость тоже, иначе поле останется на волос шире
      T.later(0.6, () => { W.x = W.t = 0; W.v = 0; wake(); });
    });
  }

  const me: Live = {
    root: wrap,
    frame(dt) {
      C.t = caretTarget();
      LB.t = focused || input.value ? 1 : 0;
      adv(C, dt); adv(LB, dt); adv(W, dt); adv(shake, dt);
    },
    render() {
      // курсор всегда в поле зрения, если текст шире поля
      const width = layerOut.clientWidth;
      want = Math.max(0, C.t - width + 6);
      scroll += (want - scroll) * 0.25;
      if (Math.abs(want - scroll) < 0.3 || instant()) scroll = want;
      layer.style.transform = `translateX(${-scroll}px)`;
      input.scrollLeft = scroll;

      const speed = Math.abs(C.v);
      const stretch = Math.min(speed / 80, 7);
      caret.style.width = `${2 + stretch}px`;
      // растяжка тянется позади направления движения
      caret.style.transform = `translateX(${C.x - scroll - (C.v > 0 ? stretch : 0)}px)`;
      const idle = performance.now() - lastMove > 550 && speed < 5;
      caret.style.opacity = focused && !busy ? '1' : '0';
      caret.classList.toggle('blink', focused && idle);

      const f = LB.x;
      label.style.transform = `translateY(${-11 * f}px) scale(${1 - 0.25 * f})`;
      if (W.x > 1) field.style.width = `${W.x}px`;
      else if (!field.classList.contains('ok')) field.style.width = '';
      field.style.transform = shake.x ? `translateX(${shake.x}px)` : '';
    },
    settled() {
      return atRest(C, 0.05) && atRest(LB) && atRest(W, 0.05) && atRest(shake, 0.05)
        && Math.abs(want - scroll) < 0.3 && (!focused || busy || caret.classList.contains('blink'));
    },
  };
  live.add(me);
  wake();

  return {
    el: wrap,
    focus: () => input.focus({ preventScroll: true }),
    dispose: () => { T.clear(); live.delete(me); },
  };
}

// ----- клетки кода (OTP Code) -----
function codeView(addr: string, devCode: string | undefined, mode: AuthMode, back: () => void, done: () => void,
  resize: (now?: boolean) => void, setStage: (s: EmailStage) => void): View {
  const wrap = el('div', 'em-otp');
  wrap.classList.add('intro');
  // подпись над клетками раскрывается по высоте, сдвигая полосу вниз
  const hintWrap = el('div', 'em-hint-wrap');
  const hint = el('p', 'em-hint', 'Код отправлен на ');
  hint.append(el('b', '', addr), document.createTextNode('. Он действует 10 минут'));
  hintWrap.appendChild(hint);
  const boxes = el('div', 'em-boxes');
  const inp = el('input', 'em-code');
  inp.inputMode = 'numeric';
  inp.autocomplete = 'one-time-code';
  inp.maxLength = N;
  inp.setAttribute('aria-label', 'Код из письма, 6 цифр');
  const bx = [...Array(N)].map(() => {
    const e = el('div', 'em-bx');
    const d = el('i');
    const car = el('span', 'em-car');
    e.append(d, car);
    boxes.appendChild(e);
    return { el: e, d, car, y: S(0, 520, 16), o: S(0, 400, 28), a: S(0, 300, 26) };
  });
  const ok = el('div', 'em-ok');
  ok.innerHTML = ICON_CHECK;
  const okText = el('span', '', 'Код отправлен');
  ok.appendChild(okText);
  boxes.append(inp, ok);
  const help = el('p', 'em-help');
  help.setAttribute('aria-live', 'polite');
  const dev = el('div', 'ob-dev-hint em-dev');
  const showDev = (c?: string) => { dev.hidden = !c; dev.textContent = c ? `Режим разработки: код ${c}` : ''; };
  showDev(devCode);
  const actions = el('div', 'em-actions');
  const change = el('button', 'em-link em-change', '← Изменить почту');
  change.type = 'button';
  const resend = el('button', 'em-link em-resend');
  resend.type = 'button';
  resend.appendChild(el('span', '', 'Отправить код ещё раз'));
  // кольцо обратного отсчёта: пока оно не догорело, кнопка недоступна
  const ring = el('span', 'em-ring');
  ring.setAttribute('aria-hidden', 'true');
  ring.innerHTML = ICON_RING;
  resend.appendChild(ring);
  actions.append(change, resend);
  wrap.append(hintWrap, boxes, help, dev, actions);

  // начинаем слитой зелёной полосой «Код отправлен» — той самой пилюлей поля адреса
  const M = S(1, 260, 24);   // клетки сливаются в полосу
  const G = S(1, 220, 28);   // полоса зеленеет
  const shake = S(0, 700, 10);
  const E = S(0, 60, 15.5);  // рамки ошибки: вспыхивают сразу и плавно гаснут без перелёта
  const H = S(0, ...SOFT);   // подпись над клетками: 0 — свёрнута, 1 — раскрыта
  const T = timers();
  let cooldown = 0;

  /** Запустить отсчёт до повторной отправки: кнопка недоступна, кольцо догорает за RESEND_SEC. */
  function startCooldown(): void {
    clearTimeout(cooldown);
    resend.disabled = true;
    resend.classList.add('cooling');
    ring.style.setProperty('--em-ring-sec', `${RESEND_SEC}s`);
    // перезапуск CSS-анимации кольца
    ring.classList.remove('run');
    void ring.offsetWidth;
    ring.classList.add('run');
    cooldown = window.setTimeout(() => {
      resend.disabled = false;
      resend.classList.remove('cooling');
      ring.classList.remove('run');
    }, RESEND_SEC * 1000);
  }
  startCooldown();
  let val = '';
  let checking = false;
  let finished = false;
  let focused = false;

  const setHelp = (text: string, kind: 'err' | 'info' | '' = '') => {
    help.textContent = text;
    help.classList.toggle('err', kind === 'err');
    help.classList.toggle('info', kind === 'info');
    resize();
  };

  function set(v: string): void {
    v = v.replace(/\D/g, '').slice(0, N);
    for (let i = 0; i < N; i++) {
      const c = v[i] ?? '';
      const b = bx[i];
      // новая цифра падает сверху с отскоком
      if (c && (b.d.textContent !== c || b.o.t === 0)) { b.d.textContent = c; b.y.x = -14; b.y.v = 0; b.o.x = 0; b.o.t = 1; }
      // стёртая проседает вниз и гаснет; сам символ остаётся до следующей цифры, чтобы было что гасить
      if (!c && b.o.t !== 0) { b.o.t = 0; b.y.v = 90; }
    }
    val = v;
    inp.value = v;
    if (v.length === N && !checking) void check();
    wake();
  }

  async function check(): Promise<void> {
    checking = true;
    T.later(0.25, () => { M.t = 1; wake(); });
    try {
      await verifyEmail(addr, val, mode);
    } catch (e) {
      T.clear();
      M.t = 0;
      shake.v -= 420;
      // все шесть клеток ненадолго обводятся цветом ошибки
      E.x = E.t = 1;
      E.v = 0;
      T.later(0.7, () => { E.t = 0; wake(); });
      setHelp(authErrorText(e instanceof AuthError ? e.code : 'auth-failed'), 'err');
      wake();
      // цифры стираются по одной, начиная с последней
      for (let k = 0; k < N; k++) T.later(0.35 + k * 0.07, () => set(val.slice(0, -1)));
      T.later(0.35 + N * 0.07, () => { checking = false; inp.focus(); wake(); });
      return;
    }
    finished = true;
    M.t = 1;
    okText.textContent = mode === 'link' ? 'Почта привязана' : 'Вход выполнен';
    T.later(0.3, () => { G.t = 1; wake(); });
    T.later(1.1, done);
    inp.blur();
    wake();
  }

  inp.addEventListener('input', () => {
    if (checking) { inp.value = val; return; }
    if (help.classList.contains('err')) setHelp('');
    set(inp.value);
  });
  inp.addEventListener('focus', () => { focused = true; wake(); });
  inp.addEventListener('blur', () => { focused = false; wake(); });

  // ----- вставка из буфера обмена -----
  /** Вставить код из текста буфера: только 6 цифр, цифры падают в клетки волной. */
  function applyPasted(text: string): void {
    if (checking || finished) return;
    const code = extractCode(text);
    if (!code) { setHelp('В буфере обмена нет кода из письма', 'err'); return; }
    if (help.textContent) setHelp('');
    // вставка заменяет набранное целиком
    set('');
    for (let k = 1; k <= code.length; k++) T.later(k * 0.04, () => { if (!checking) set(code.slice(0, k)); });
    inp.focus({ preventScroll: true });
  }
  // Ctrl+V / «Вставить»: maxLength обрезал бы «Код: 123456» до «Код: 1» ещё до события input — разбираем сами
  inp.addEventListener('paste', e => {
    e.preventDefault();
    applyPasted(e.clipboardData?.getData('text') ?? '');
  });
  let clipAt = 0;
  /** ПКМ или долгий тап: прочитать буфер обмена (браузер может спросить разрешение). */
  async function pasteFromClipboard(): Promise<void> {
    if (checking || finished || performance.now() - clipAt < 800) return;
    clipAt = performance.now();
    try {
      applyPasted(await navigator.clipboard.readText());
    } catch {
      setHelp('Нет доступа к буферу обмена - вставьте код сочетанием Ctrl+V', 'err');
    }
  }
  const canReadClipboard = () => typeof navigator.clipboard?.readText === 'function';
  // ПКМ на клетках (и долгий тап на Android — он тоже приходит как contextmenu) вместо меню вставляет код
  inp.addEventListener('contextmenu', e => {
    if (!canReadClipboard()) return;   // нет API — пусть откроется обычное меню с «Вставить»
    e.preventDefault();
    void pasteFromClipboard();
  });
  // долгий тап там, где contextmenu не приходит (iOS): держим палец 0,5 с без сдвига
  let pressTimer = 0;
  let pressAt = { x: 0, y: 0 };
  const cancelPress = () => { clearTimeout(pressTimer); pressTimer = 0; };
  inp.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' || !canReadClipboard()) return;
    pressAt = { x: e.clientX, y: e.clientY };
    cancelPress();
    pressTimer = window.setTimeout(() => { pressTimer = 0; void pasteFromClipboard(); }, 500);
  });
  inp.addEventListener('pointermove', e => {
    if (pressTimer && Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y) > 10) cancelPress();
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave'] as const) inp.addEventListener(ev, cancelPress);

  // «Изменить почту»: клетки сливаются в полосу, и она раскрывается в поле адреса
  change.addEventListener('click', () => {
    if (finished || checking) return;
    checking = true;
    T.clear();
    H.t = 0;
    setStage('email');
    G.t = 0;
    M.t = 1;
    inp.blur();
    wake();
    T.later(0.35, back);
  });
  // зелень сходит, затем полоса делится на клетки (обратный порядок слияния)
  // вместе с этим подпись раскрывается над полосой, а блок получает отступы
  T.later(0.15, () => { G.t = 0; H.t = 1; setStage('code'); wake(); });
  T.later(0.35, () => { M.t = 0; wake(); });
  resend.addEventListener('click', async () => {
    if (checking || finished || resend.classList.contains('cooling')) return;
    resend.disabled = true;
    try {
      const r = await startEmail(addr);
      showDev(r.devCode);
      set('');
      setHelp('Новый код отправлен', 'info');
      startCooldown();
      inp.focus();
    } catch (e) {
      setHelp(authErrorText(e instanceof AuthError ? e.code : 'auth-failed'), 'err');
      resend.disabled = false;
    }
  });

  const springs = [M, G, shake, E, H, ...bx.flatMap(b => [b.y, b.o, b.a])];
  const me: Live = {
    root: wrap,
    frame(dt) {
      const at = Math.min(val.length, N - 1);
      // активная клетка подсвечивается, только когда полоса уже разделилась на клетки
      const split = M.t === 0 && G.t === 0;
      bx.forEach((b, i) => { b.a.t = focused && !checking && split && i === at ? 1 : 0; });
      for (const s of springs) adv(s, dt);
    },
    render() {
      const W = boxes.parentElement?.clientWidth ?? 320;
      const gap0 = GAP;
      const bw = cellWidth(W);
      const m = clamp(clamp(M.x, 0, 1.1), 0, 1);
      const gap = gap0 * (1 - m);
      const total = bw * N + gap * (N - 1);
      const left0 = (W - total) / 2;
      const g = clamp(G.x, 0, 1);
      bx.forEach((b, i) => {
        b.el.style.left = `${(left0 + i * (bw + gap)).toFixed(2)}px`;
        b.el.style.width = `${(bw + (i < N - 1 ? gap0 * m + 1 : 0)).toFixed(2)}px`;
        // внутренние углы прямеют при слиянии, внешние остаются круглыми
        const r = BOX_R * (1 - m);
        b.el.style.borderRadius = i === 0 ? `${BOX_R}px ${r}px ${r}px ${BOX_R}px`
          : i === N - 1 ? `${r}px ${BOX_R}px ${BOX_R}px ${r}px` : `${r}px`;
        const a = clamp(b.a.x, 0, 1);
        b.el.style.background = g > 0.01 ? `color-mix(in srgb, var(--success) ${(g * 100).toFixed(1)}%, var(--surface-sunken))`
          : a > 0.01 ? `color-mix(in srgb, var(--accent-soft) ${(a * 100).toFixed(1)}%, var(--surface-sunken))` : '';
        // рамка клетки: активная — акцентная; при слиянии рамки гаснут, чтобы полоса была цельной;
        // после неверного кода поверх всего — цвет ошибки, он плавно сходит
        const e = clamp(E.x, 0, 1);
        b.el.style.boxShadow = `inset 0 0 0 ${a > 0.01 || e > 0.01 ? 1.5 : 1}px color-mix(in srgb, var(--danger) ${(e * 100).toFixed(1)}%, `
          + `color-mix(in srgb, var(--accent) ${(a * 100).toFixed(1)}%, `
          + `color-mix(in srgb, transparent ${(Math.max(m, g) * 100).toFixed(1)}%, var(--border-input))))`;
        b.d.style.opacity = (clamp(b.o.x, 0, 1) * (1 - g)).toFixed(3);
        b.d.style.transform = `translateY(${b.y.x.toFixed(2)}px)`;
        b.car.style.display = a > 0.5 && !val[i] ? '' : 'none';
      });
      boxes.style.width = `${W}px`;
      boxes.style.transform = shake.x ? `translateX(${shake.x.toFixed(2)}px)` : '';
      ok.style.opacity = clamp(G.x * 1.6 - 0.5, 0, 1).toFixed(3);
      ok.style.transform = `translateY(${((1 - g) * 8).toFixed(2)}px)`;
      const h = clamp(H.x, 0, 1.2);
      hintWrap.style.height = h > 0.999 && atRest(H) ? '' : `${(hint.offsetHeight * h).toFixed(2)}px`;
      hintWrap.style.opacity = clamp(h, 0, 1).toFixed(3);
      if (!atRest(H, 0.002)) resize(true);
    },
    settled: () => springs.every(s => atRest(s, 0.01)),
  };
  live.add(me);
  wake();

  return {
    el: wrap,
    focus: () => inp.focus({ preventScroll: true }),
    dispose: () => { T.clear(); clearTimeout(cooldown); live.delete(me); },
  };
}
