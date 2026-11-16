import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { initMorphPages, morphPagesOpen, morphPagesReset, morphPagesSync } from '../../src/morph-pages';

let dock: HTMLElement, tray: HTMLElement, list: HTMLElement, button: HTMLElement;
let active: HTMLElement;

beforeAll(() => {
  document.body.innerHTML = `
    <div id="pages-dock">
      <div id="pages-tray"><div id="pages-list">
        <div class="page-item" style="--i:0"></div><div class="page-item active" style="--i:1"></div><div class="page-add" style="--i:2"></div>
      </div></div>
      <button id="btn-pages"><span class="pages-chev"></span></button>
    </div>`;
  dock = document.getElementById('pages-dock')!;
  tray = document.getElementById('pages-tray')!;
  list = document.getElementById('pages-list')!;
  button = document.getElementById('btn-pages')!;
  active = list.querySelector<HTMLElement>('.active')!;
  initMorphPages({ dock, tray, list, button, atTop: () => false, active: () => active });
});
afterAll(() => { document.body.innerHTML = ''; document.body.className = ''; });

describe('Motion на панели страниц', () => {
  it('открытие: лоток держится видимым (mt-showing), пружины пишут инлайн и затем снимают его', async () => {
    dock.classList.add('open');
    morphPagesOpen(true);
    expect(dock.classList.contains('mt-showing')).toBe(true);
    await new Promise(r => requestAnimationFrame(() => r(null)));
    expect(tray.style.opacity).not.toBe('');
    await vi.waitFor(() => expect(tray.style.opacity).toBe(''), { timeout: 3000 });
    expect(tray.style.transform).toBe('');
    // успокоились: видимость лотка снова ведёт обычный CSS (.open)
    expect(dock.classList.contains('mt-showing')).toBe(false);
  });

  it('рамка выбранной страницы получает размер и видимость', () => {
    morphPagesSync(true);
    expect(list.style.getPropertyValue('--sel-o')).not.toBe('');
  });

  it('закрытие: mt-showing снимается, когда всё успокоилось', async () => {
    dock.classList.remove('open');
    morphPagesOpen(false);
    expect(dock.classList.contains('mt-showing')).toBe(true);
    await vi.waitFor(() => expect(dock.classList.contains('mt-showing')).toBe(false), { timeout: 3000 });
  });

  it('без Motion-анимаций (no-motion) ничего не делает, reset снимает инлайн', () => {
    document.body.classList.add('no-motion');
    morphPagesOpen(true);
    expect(dock.classList.contains('mt-showing')).toBe(false);
    tray.style.opacity = '0.5';
    morphPagesReset(false);
    expect(tray.style.opacity).toBe('');
    expect(list.style.getPropertyValue('--sel-o')).toBe('');
    document.body.classList.remove('no-motion');
  });
});
