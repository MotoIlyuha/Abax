import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { claimMenu, closeMenu, drillMenu, menuMotion, menuShown, openMenu, releaseMenu, settleMenu } from '../../src/menu-motion';

/** jsdom не раскладывает страницу: подставляем прямоугольник, чтобы анимация «улучшенных» шла по-настоящему. */
function at(el: HTMLElement, x: number, y: number, w: number, h: number): HTMLElement {
  el.getBoundingClientRect = () => new DOMRect(x, y, w, h);
  return el;
}

function setMode(mode: 'off' | 'normal' | 'enhanced'): void {
  document.body.classList.toggle('no-motion', mode !== 'enhanced');
  document.body.classList.toggle('no-ui-anim', mode === 'off');
}

let button: HTMLElement;
let menu: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '<button id="b"></button><div id="m" class="popup-menu" hidden><button>Один</button><hr><button>Два</button></div>';
  button = at(document.getElementById('b')!, 10, 10, 32, 32);
  menu = at(document.getElementById('m')!, 10, 48, 240, 120);
  menu.style.left = '10px';
  menu.style.top = '48px';
  setMode('enhanced');
});
afterEach(() => {
  settleMenu(menu);
  document.body.innerHTML = '';
  document.body.className = '';
});

describe('одно открытое меню', () => {
  it('новое меню закрывает прежнее; закрытое само меню повторно не закрывается', () => {
    const a = vi.fn();
    const b = vi.fn();
    claimMenu('a', a);
    claimMenu('b', b);
    expect(a).toHaveBeenCalledTimes(1);
    releaseMenu('b');
    claimMenu('c', () => {});
    expect(b).not.toHaveBeenCalled();
    // то же меню заново — себя не закрывает
    claimMenu('c', () => { throw new Error('не должно вызываться'); });
    releaseMenu('c');
  });
});

describe('уровни анимации', () => {
  it('уровень: «выкл» и «обычные» по классам body, иначе «улучшенные»', () => {
    expect(menuMotion()).toBe('enhanced');
    setMode('normal');
    expect(menuMotion()).toBe('normal');
    setMode('off');
    expect(menuMotion()).toBe('off');
  });

  it('«выкл»: меню показывается и прячется сразу', () => {
    setMode('off');
    openMenu(menu, { from: button });
    expect(menu.hidden).toBe(false);
    expect(menuShown(menu)).toBe(true);
    expect(menu.classList.contains('mm-morph')).toBe(false);
    closeMenu(menu);
    expect(menu.hidden).toBe(true);
    expect(menuShown(menu)).toBe(false);
  });

  it('без раскладки (кнопка и меню нулевого размера) — тоже сразу', () => {
    at(menu, 0, 0, 0, 0);
    openMenu(menu, { from: button });
    expect(menu.hidden).toBe(false);
    expect(menu.style.width).toBe('');
    closeMenu(menu);
    expect(menu.hidden).toBe(true);
  });

  it('«обычные»: CSS выплывание, при закрытии — угасание и затем hidden', async () => {
    setMode('normal');
    openMenu(menu, { from: button });
    expect(menu.classList.contains('mm-in')).toBe(true);
    expect(menu.dataset.side).toBe('below');
    closeMenu(menu);
    expect(menuShown(menu)).toBe(false);
    expect(menu.classList.contains('mm-out')).toBe(true);
    expect(menu.hidden).toBe(false);
    await vi.waitFor(() => expect(menu.hidden).toBe(true), { timeout: 1000 });
    expect(menu.classList.contains('mm-out')).toBe(false);
  });

  it('«улучшенные»: контейнер растёт из кнопки, пункты появляются, кнопка пружинит; потом инлайн возвращается', async () => {
    const place = vi.fn();
    const settled = vi.fn();
    openMenu(menu, { from: button, place, onSettled: settled });
    expect(place).toHaveBeenCalledTimes(1);
    expect(menu.classList.contains('mm-morph')).toBe(true);
    // первый кадр — у кнопки, а не на месте меню
    expect(parseFloat(menu.style.width)).toBeLessThan(40);
    expect(parseFloat(menu.style.top)).toBeLessThan(48);
    const first = menu.querySelector<HTMLElement>('button')!;
    expect(Number(first.style.opacity)).toBe(0);
    await new Promise(r => requestAnimationFrame(() => r(null)));
    expect(button.style.scale).not.toBe('');
    await vi.waitFor(() => expect(menu.classList.contains('mm-morph')).toBe(false), { timeout: 3000 });
    // свои left/top меню вернулись, размер и прозрачность — снова по CSS
    expect(menu.style.left).toBe('10px');
    expect(menu.style.top).toBe('48px');
    expect(menu.style.width).toBe('');
    expect(menu.style.height).toBe('');
    expect(menu.style.opacity).toBe('');
    expect(first.style.opacity).toBe('');
    expect(first.style.translate).toBe('');
    expect(settled).toHaveBeenCalled();
    await vi.waitFor(() => expect(button.style.scale).toBe(''), { timeout: 3000 });
  });

  it('«улучшенные»: закрытие втягивает меню в кнопку; открытие на ходу разворачивает обратно', async () => {
    openMenu(menu, { from: button });
    await vi.waitFor(() => expect(menu.classList.contains('mm-morph')).toBe(false), { timeout: 3000 });
    closeMenu(menu);
    expect(menuShown(menu)).toBe(false);
    expect(menu.classList.contains('mm-closing')).toBe(true);
    expect(menu.hidden).toBe(false);
    // повторное закрытие не мешает, открытие — разворачивает
    closeMenu(menu);
    openMenu(menu, { from: button });
    expect(menuShown(menu)).toBe(true);
    expect(menu.classList.contains('mm-closing')).toBe(false);
    await vi.waitFor(() => expect(menu.classList.contains('mm-morph')).toBe(false), { timeout: 3000 });
    expect(menu.hidden).toBe(false);
    expect(menu.style.left).toBe('10px');
    closeMenu(menu);
    await vi.waitFor(() => expect(menu.hidden).toBe(true), { timeout: 3000 });
    expect(menu.style.left).toBe('10px');
    expect(menu.style.width).toBe('');
  });

  it('remove: закрытое окно удаляется из документа; settleMenu доводит закрытие сразу', () => {
    openMenu(menu, { from: button, remove: true });
    closeMenu(menu);
    expect(menu.isConnected).toBe(true);
    settleMenu(menu);
    expect(menu.isConnected).toBe(false);
  });
});

describe('переход внутри меню', () => {
  function pages(): { root: HTMLElement; sub: HTMLElement; row: HTMLElement; head: HTMLElement } {
    const root = document.createElement('div');
    root.innerHTML = '<button>Полный экран</button><button data-view="grid">Тип сетки</button>';
    const sub = document.createElement('div');
    sub.innerHTML = '<button class="view-back"><span class="view-icon"><span class="vb-arrow"></span><span class="vb-ghost"></span></span>Тип сетки</button><button>Точки</button>';
    menu.replaceChildren(root);
    return { root, sub, row: at(root.children[1] as HTMLElement, 16, 90, 220, 34), head: at(sub.children[0] as HTMLElement, 16, 54, 220, 34) };
  }

  it('«выкл»: страница меняется сразу', () => {
    setMode('off');
    const { root, sub, row, head } = pages();
    openMenu(menu, { from: button });
    drillMenu(menu, root, sub, { dir: 'in', row, head, bottom: true });
    expect(menu.firstElementChild).toBe(sub);
    expect(root.isConnected).toBe(false);
  });

  it('«улучшенные»: заголовок едет с места пункта, в конце уходящая страница удаляется, инлайн снимается', async () => {
    const { root, sub, row, head } = pages();
    setMode('off');
    openMenu(menu, { from: button });
    setMode('enhanced');
    const settled = vi.fn();
    drillMenu(menu, root, sub, { dir: 'in', row, head, bottom: true, onSettled: settled });
    expect(root.classList.contains('mm-leaving')).toBe(true);
    expect(sub.isConnected).toBe(true);
    expect(row.style.opacity).toBe('0');
    expect(head.style.translate).not.toBe('');
    expect(Number(head.querySelector<HTMLElement>('.vb-arrow')!.style.opacity)).toBe(0);
    await vi.waitFor(() => expect(settled).toHaveBeenCalled(), { timeout: 3000 });
    expect(root.isConnected).toBe(false);
    expect(head.style.translate).toBe('');
    expect(menu.style.height).toBe('');
    expect(menu.classList.contains('mm-drill')).toBe(false);
  });

  it('«обычные»: новая страница проявляется, высота — CSS-переходом', async () => {
    const { root, sub, row, head } = pages();
    setMode('normal');
    openMenu(menu, { from: button });
    const settled = vi.fn();
    drillMenu(menu, root, sub, { dir: 'in', row, head, bottom: true, onSettled: settled });
    expect(root.isConnected).toBe(false);
    expect(sub.classList.contains('mm-fade')).toBe(true);
    await vi.waitFor(() => expect(settled).toHaveBeenCalled(), { timeout: 1000 });
    expect(sub.classList.contains('mm-fade')).toBe(false);
    expect(menu.style.transition).toBe('');
  });

  it('закрытие меню посреди перехода доводит переход до конца', () => {
    const { root, sub, row, head } = pages();
    setMode('off');
    openMenu(menu, { from: button });
    setMode('enhanced');
    drillMenu(menu, root, sub, { dir: 'in', row, head, bottom: true });
    closeMenu(menu, true);
    expect(root.isConnected).toBe(false);
    expect(head.style.translate).toBe('');
    expect(menu.hidden).toBe(true);
  });
});
