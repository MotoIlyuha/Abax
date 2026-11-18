// Переключатель «Toggle switch» (по мотивам designbookmark.com/motion, toggle-switch).
// У каждого переключателя две пружины: положение ручки и её растяжение. При щелчке
// ручка вытягивается в сторону движения, приезжает с небольшим отскоком и снова
// становится круглой, а дорожка заливается акцентным цветом.
//
// Три режима анимаций доски:
// - «Улучшенные» — пружины (ручку и дорожку двигает JS);
// - «Обычные» (body.no-motion) — короткие CSS-переходы, как у остальных переключателей;
// - «Выкл» (body.no-ui-anim) — состояние меняется сразу, без движения.
// В покое инлайн-стили снимаются, и вид задаёт CSS по :checked.

import { S, atRest, clamp, motionEnabled, reduceMotion, register, snap, spring, step, tune, uiAnimOff, wake, type Spring } from './motion';

/** Запасные значения пружин — ровно как в switch.js образца. */
const POS_FALLBACK = [320, 18] as const;
const STRETCH_FALLBACK = [300, 20] as const;
/** Ход ручки и её растяжение в пикселях: дорожка 34×20, ручка 16 (как у образца 52×32 → 26, в масштабе). */
const TRAVEL = 14;
const KNOB = 16;
const GROW = 6;
/** Толчок растяжения при щелчке (как s.w.v = 60 в образце). */
const KICK = 60;

interface Item { input: HTMLInputElement; track: HTMLElement; knob: HTMLElement; p: Spring; w: Spring }

/** Только переключатели, которые сейчас движутся: в покое и после удаления из DOM их тут нет. */
const items = new Set<Item>();
let registered = false;

function ensureLoop(): void {
  if (registered) return;
  registered = true;
  register({
    frame(dt) {
      for (const it of items) {
        if (!it.input.isConnected) { items.delete(it); snap(it.p); snap(it.w); continue; }
        step(it.p, dt);
        step(it.w, dt);
      }
    },
    render() {
      for (const it of items) {
        if (atRest(it.p, 0.002) && atRest(it.w, 0.002)) { snap(it.p); snap(it.w); clear(it); continue; }
        // ручка растёт, пока едет; передний край ведёт
        const grow = clamp(it.w.x, 0, 1) * GROW;
        const x = it.p.x * TRAVEL;
        const p = clamp(it.p.x, 0, 1);
        it.knob.style.width = `${(KNOB + grow).toFixed(2)}px`;
        it.knob.style.transform = `translateX(${(it.input.checked ? x - grow * p : x).toFixed(2)}px)`;
        it.track.style.background = `color-mix(in srgb, var(--accent) ${(p * 100).toFixed(1)}%, var(--border-control))`;
      }
    },
    settled: () => items.size === 0,
  });
}

/** Снимает инлайн-стили: дальше вид задаёт CSS. */
function clear(it: Item): void {
  items.delete(it);
  it.knob.style.removeProperty('width');
  it.knob.style.removeProperty('transform');
  it.track.style.removeProperty('background');
}

function animate(it: Item): void {
  const target = it.input.checked ? 1 : 0;
  it.p.t = target;
  if (!motionEnabled() || uiAnimOff()) {
    // «Обычные» и «Выкл»: пружины встают на место, двигает CSS (или никто)
    snap(it.p); it.w.t = 0; snap(it.w); clear(it);
    return;
  }
  tune(it.p, ...spring('--spring-switch', POS_FALLBACK));
  tune(it.w, ...spring('--spring-switch-stretch', STRETCH_FALLBACK));
  it.w.t = 0;
  if (!reduceMotion()) it.w.v = KICK;
  items.add(it);
  ensureLoop();
  wake();
}

export interface ToggleSwitchOptions {
  /** Подпись строки. */
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Классы строки (например, 'grid-switch' или 'view-switch'). */
  className: string;
  /** SVG иконки слева (только константы кода, не пользовательские данные). */
  icon?: string;
  title?: string;
}

/** Строка «подпись + переключатель»; весь label кликабелен, ввод — настоящий checkbox с role="switch". */
export function createToggleSwitch(o: ToggleSwitchOptions): HTMLLabelElement {
  const row = document.createElement('label');
  row.className = `${o.className} spring-switch`;
  if (o.title) row.title = o.title;
  if (o.icon) {
    const icon = document.createElement('span');
    icon.className = 'view-icon';
    icon.innerHTML = o.icon; // константа из кода
    row.append(icon);
  }
  const text = document.createElement('span');
  text.className = 'switch-text';
  text.textContent = o.label;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('role', 'switch');
  input.className = 'switch-input';
  input.checked = o.checked;
  const track = document.createElement('span');
  track.className = 'switch-track';
  const knob = document.createElement('span');
  knob.className = 'switch-knob';
  track.append(knob);
  row.append(text, input, track);
  const start = o.checked ? 1 : 0;
  const it: Item = { input, track, knob, p: S(start, ...POS_FALLBACK), w: S(0, ...STRETCH_FALLBACK) };
  input.addEventListener('change', () => {
    animate(it);
    o.onChange(input.checked);
  });
  return row;
}
