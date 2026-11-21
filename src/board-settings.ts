import { ICONS } from './icons';
import { closeMenu, openMenu } from './menu-motion';
import { reduceMotion } from './motion';
import { animatePageLayers } from './page-transition';
import type { SectionView } from './settings-dialog';
import { createTabPill } from './tab-pill';
import type { AnimationMode, BoardSettings, PageTransition, WheelMode } from './types';

type Choice<T> = { mode: T; name: string; hint: string };

export const PAGE_TRANSITIONS: Choice<PageTransition>[] = [
  { mode: 'none', name: 'Нет', hint: 'Страница сменяется мгновенно' },
  { mode: 'slide', name: 'Слайд', hint: 'Страницы сдвигаются в сторону, как слайды' },
  { mode: 'fade', name: 'Затухание', hint: 'Прежняя страница плавно растворяется' },
  { mode: 'zoom', name: 'Приближение', hint: 'Новая страница выплывает из глубины' },
];

const WHEEL_MODES: Choice<WheelMode>[] = [
  { mode: 'scroll', name: 'Прокрутка', hint: 'Колёсико прокручивает, Shift - по горизонтали, Ctrl - масштаб' },
  { mode: 'zoom', name: 'Масштаб', hint: 'Колёсико масштабирует, Shift - прокрутка по горизонтали, Ctrl+Shift - по вертикали. Настройка также действует на тачпад' },
];

const ANIMATION_MODES: Choice<AnimationMode>[] = [
  { mode: 'off', name: 'Выкл', hint: 'Меню и панели появляются сразу' },
  { mode: 'normal', name: 'Обычные', hint: 'Меню плавно появляется рядом с кнопкой' },
  { mode: 'enhanced', name: 'Улучшенные', hint: 'Меню вырастает из кнопки, пункты появляются по очереди' },
];

export function boardSettingsLabel(text: string): HTMLElement {
  const label = document.createElement('div');
  label.className = 'ctx-label';
  label.textContent = text;
  return label;
}

function layer(className: string): HTMLElement {
  const el = document.createElement('span');
  el.className = className;
  return el;
}

type Demo = { el: HTMLElement; play(): () => void };
const PREVIEW: { timing?: { duration: number; easing: string }; interval: number; resumeAfter?: number } = {
  timing: { duration: 900, easing: 'cubic-bezier(0.42, 0, 0.25, 1)' },
  interval: 2000,
  resumeAfter: 1800,
};

function wheelDemo(mode: WheelMode): Demo {
  const el = layer('board-demo board-demo-wheel');
  const canvas = layer('board-demo-wheel-canvas');
  const mouse = layer('board-demo-mouse');
  el.append(canvas, mouse);
  return {
    el,
    play() {
      const end = mode === 'zoom' ? 'scale(1.7)' : 'translateY(-28px)';
      const animations = reduceMotion() ? [] : [
        canvas.animate([{ transform: 'none' }, { transform: end }], {
          duration: 460, easing: 'ease-out', ...PREVIEW.timing, fill: 'forwards',
        }),
        mouse.animate([{ opacity: 1 }, { opacity: 0.45 }, { opacity: 1 }], PREVIEW.timing
          ? { duration: 500, easing: PREVIEW.timing.easing } : { duration: 220 }),
      ];
      // После предпросмотра холст остаётся в получившемся положении.
      canvas.style.transform = end;
      return () => { animations.forEach(a => a.cancel()); canvas.style.transform = ''; };
    },
  };
}

function pageDemo(mode: PageTransition): Demo {
  const el = layer('board-demo board-demo-page');
  el.dataset.transition = mode;
  const before = layer('board-demo-page-before');
  const after = layer('board-demo-page-after');
  el.append(before, after);
  let showAfter = true;
  return {
    el,
    play() {
      el.classList.add('is-playing');
      if (mode === 'none') {
        before.hidden = showAfter;
        after.hidden = !showAfter;
        showAfter = !showAfter;
        return () => {
          el.classList.remove('is-playing');
          before.hidden = false;
          after.hidden = false;
        };
      }
      const animations = reduceMotion() ? [] : animatePageLayers(mode, before, after, 1, PREVIEW.timing);
      if (animations.length === 0) before.hidden = true;
      else void Promise.all(animations.map(a => a.finished)).then(() => {
        before.hidden = true;
        animations.forEach(a => a.cancel());
      }, () => {});
      return () => {
        animations.forEach(a => a.cancel());
        el.classList.remove('is-playing');
        before.hidden = false;
      };
    },
  };
}

function appendChoices<T extends string>(
  host: HTMLElement, title: string, choices: readonly Choice<T>[], current: T,
  demoFor: (mode: T) => Demo, select: (mode: T) => void, className: string,
  onHover: (hovering: boolean) => void, interact: () => void,
): { stop(): void; resume(delay?: number): void } {
  const group = document.createElement('div');
  group.className = `board-setting-group ${className}`.trim();
  const row = document.createElement('div');
  row.className = 'board-setting-options';
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', title);
  let timer = 0;
  let next = 0;
  let reset = () => {};
  let hovered: HTMLButtonElement | null = null;
  const stop = () => {
    window.clearTimeout(timer);
    reset();
    reset = () => {};
  };
  const cards = choices.map(({ mode, name, hint }, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.title = hint;
    const demo = demoFor(mode);
    demo.el.setAttribute('aria-hidden', 'true');
    button.append(demo.el, name);
    const mark = (checked: boolean) => {
      button.classList.toggle('active', checked);
      button.setAttribute('aria-pressed', String(checked));
    };
    mark(current === mode);
    button.addEventListener('pointerenter', event => {
      if (event.pointerType === 'touch' || reduceMotion()) return;
      onHover(true);
      hovered = button;
      playHovered(index);
    });
    button.addEventListener('pointerleave', () => {
      if (hovered !== button) return;
      hovered = null;
      stop();
      onHover(false);
    });
    button.addEventListener('click', () => {
      interact();
      select(mode);
      for (const card of cards) card.mark(card.button === button);
      if (hovered === button) playHovered(index);
      else play(index);
    });
    row.append(button);
    return { button, mark, demo };
  });

  function play(index: number): void {
    stop();
    const { button, demo } = cards[index];
    const resetDemo = demo.play();
    button.classList.add('is-previewing');
    reset = () => {
      resetDemo();
      button.classList.remove('is-previewing');
    };
  }

  function playHovered(index: number): void {
    play(index);
    if (!reduceMotion()) timer = window.setTimeout(() => playHovered(index), PREVIEW.interval);
  }

  function playAutomatic(): void {
    // У скрытой на сенсорном экране строки колёсика предпросмотр не запускается.
    if (!row.offsetWidth || reduceMotion()) { stop(); return; }
    play(next);
    timer = window.setTimeout(() => {
      next = (next + 1) % cards.length;
      playAutomatic();
    }, PREVIEW.interval);
  }

  group.append(boardSettingsLabel(title), row);
  host.append(group);
  return {
    stop,
    resume(delay = 0) {
      stop();
      if (!reduceMotion()) timer = window.setTimeout(playAutomatic, delay);
    },
  };
}

function animationExample(): { el: HTMLElement; play(): void; dispose(): void } {
  const el = document.createElement('div');
  el.className = 'board-animation-demo';
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'board-animation-trigger';
  trigger.title = 'Проиграть пример появления меню';
  trigger.setAttribute('aria-label', trigger.title);
  trigger.innerHTML = ICONS.menu;
  const menu = document.createElement('div');
  menu.className = 'popup-menu board-animation-menu';
  menu.setAttribute('aria-hidden', 'true');
  for (const [label, icon] of [['Импорт', ICONS.pdf], ['Экспорт', ICONS.export]]) {
    const item = layer('board-animation-menu-item');
    item.innerHTML = icon;
    item.append(label);
    menu.append(item);
  }
  const play = () => {
    closeMenu(menu, true);
    openMenu(menu, { from: trigger });
  };
  trigger.addEventListener('click', play);
  el.append(trigger, menu);
  return { el, play, dispose: () => closeMenu(menu, true) };
}

type MotionSettings = Pick<BoardSettings, 'wheelMode' | 'pageTransition' | 'animationMode'>;

export function renderBoardMotionSettings(
  host: HTMLElement, settings: MotionSettings, save: (patch: Partial<MotionSettings>) => void,
): SectionView {
  const listeners = new AbortController();
  let idleTimer = 0;
  let hovering = false;
  let paused = false;
  function interact(): void {
    if (!paused) {
      paused = true;
      previews.forEach(preview => preview.stop());
    }
    window.clearTimeout(idleTimer);
    if (!hovering && PREVIEW.resumeAfter !== undefined) idleTimer = window.setTimeout(() => {
      paused = false;
      previews.forEach(preview => preview.resume());
    }, PREVIEW.resumeAfter);
  }
  const onHover = (active: boolean) => {
    hovering = active;
    interact();
  };
  const previews = [
    appendChoices(host, 'Колёсико мыши', WHEEL_MODES, settings.wheelMode,
      wheelDemo, mode => save({ wheelMode: mode }), 'board-wheel-setting', onHover, interact),
    appendChoices(host, 'Анимация перехода на другую страницу', PAGE_TRANSITIONS, settings.pageTransition,
      pageDemo, mode => save({ pageTransition: mode }), 'board-page-setting', onHover, interact),
  ];
  previews.forEach(preview => preview.resume(300));
  const interactionEvents = ['pointerdown', 'focusin'];
  if (PREVIEW.resumeAfter !== undefined) interactionEvents.push('wheel', 'keydown');
  for (const event of interactionEvents) {
    host.addEventListener(event, interact, { signal: listeners.signal, passive: true });
  }

  const group = document.createElement('div');
  group.className = 'board-setting-group';
  const row = document.createElement('div');
  row.className = 'np-tabs-row';
  const example = animationExample();
  const tabs = createTabPill({
    tabs: ANIMATION_MODES.map(({ mode, name, hint }) => ({ value: mode, label: name, title: hint })),
    label: 'Анимации',
    value: settings.animationMode,
    className: 'np-tabs',
    onChange: value => {
      const mode = ANIMATION_MODES.find(option => option.mode === value)!.mode;
      save({ animationMode: mode });
      example.play();
    },
  });
  row.append(tabs.el);
  group.append(boardSettingsLabel('Анимации'), row, example.el);
  host.append(group);
  return {
    onKey(event) {
      if (PREVIEW.resumeAfter !== undefined && event.target instanceof Node && host.contains(event.target)) interact();
      return tabs.onKey(event);
    },
    dispose() {
      listeners.abort();
      window.clearTimeout(idleTimer);
      previews.forEach(preview => preview.stop());
      example.dispose();
      tabs.dispose();
    },
  };
}
