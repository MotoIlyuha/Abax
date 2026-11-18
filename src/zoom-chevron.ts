// Стрелка-галочка рядом с процентом масштаба: смотрит вверх, пока меню закрыто (меню раскрывается вверх),
// и разворачивается вниз, когда оно открыто. Три уровня анимации:
//  • «Выкл» — разворот сразу;
//  • «Обычные» — плавный CSS-переход (style.css);
//  • «Улучшенные» — разворот на пружине с небольшим перелётом (пружина «нажатия» --spring-pop).
// Пока пружина идёт, поворот пишется инлайном; когда она успокоилась, инлайн снимается, и работает CSS
// по атрибуту aria-expanded кнопки.

import { S, atRest, motionEnabled, reduceMotion, register, snap, spring, step, tune, uiAnimOff, wake, type Spring } from './motion';

const POP: readonly [number, number] = [520, 16];

/** Подключает стрелку к кнопке: открытое состояние читается из aria-expanded. */
export function initZoomChevron(button: HTMLElement, chevron: HTMLElement): void {
  const open = (): boolean => button.getAttribute('aria-expanded') === 'true';
  const R: Spring = S(open() ? 1 : 0);
  const [k, c] = spring('--spring-pop', POP);
  tune(R, k, c);
  let inline = false;

  const clearInline = () => {
    if (!inline) return;
    chevron.style.transform = '';
    inline = false;
  };
  const springs = () => motionEnabled() && !uiAnimOff() && !reduceMotion();

  register({
    frame(dt) {
      if (!springs()) { snap(R); return; }
      step(R, dt);
    },
    render() {
      if (!inline) return;
      if (atRest(R, 0.002)) { snap(R); clearInline(); return; }
      chevron.style.transform = `rotate(${R.x * 180}deg)`;
    },
    settled() { return atRest(R, 0.002); },
  });

  const sync = () => {
    R.t = open() ? 1 : 0;
    if (!springs()) { snap(R); clearInline(); return; }
    inline = true;
    chevron.style.transform = `rotate(${R.x * 180}deg)`;
    wake();
  };
  new MutationObserver(sync).observe(button, { attributes: true, attributeFilter: ['aria-expanded'] });
}
