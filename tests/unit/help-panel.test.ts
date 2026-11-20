// Режим «Справка» (src/help-panel.ts): советы, горячие клавиши из src/hotkeys.ts, поиск, версия и ссылка.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HELP_MODE, helpKeyGroups, helpTips, mountHelpPanel } from '../../src/help-panel';
import { FIXED_SHORTCUTS } from '../../src/hotkeys';
import { state } from '../../src/state';

const settings = { ...state.settings };

function mount() {
  const host = document.createElement('div');
  document.body.append(host);
  const view = mountHelpPanel(host);
  view.show?.();
  return { host, view, input: host.querySelector<HTMLInputElement>('.hlp-search-input')! };
}

function search(input: HTMLInputElement, q: string): void {
  input.value = q;
  input.dispatchEvent(new Event('input'));
}

const visible = (host: HTMLElement, sel: string) =>
  [...host.querySelectorAll<HTMLElement>(sel)].filter(e => !e.closest('[hidden]'));

beforeEach(() => {
  state.settings = { ...settings, newPageKey: 'Alt+KeyN', pageKeyMod: 'alt', wheelMode: 'zoom', keepImageAspect: true };
});
afterEach(() => {
  document.body.textContent = '';
  state.settings = { ...settings };
  vi.unstubAllGlobals();
});

describe('содержимое', () => {
  it('режим: «Справка» с иконкой', () => {
    expect(HELP_MODE).toMatchObject({ id: 'help', label: 'Справка' });
    expect(HELP_MODE.icon).toContain('<svg');
  });

  it('6–8 советов «Быстрого старта» по настройкам доски', () => {
    const tips = helpTips();
    expect(tips.length).toBeGreaterThanOrEqual(6);
    expect(tips.length).toBeLessThanOrEqual(8);
    const pages = tips.find(t => t.title === 'Страницы')!;
    expect(pages.text).toContain('Alt+1…9');
    expect(pages.text).toContain('Alt+N — новая страница');
    state.settings = { ...state.settings, newPageKey: null, pageKeyMod: 'ctrl', wheelMode: 'scroll' };
    const again = helpTips();
    expect(again.find(t => t.title === 'Страницы')!.text).not.toContain('новая страница');
    expect(again.find(t => t.title === 'Двигать и масштабировать')!.text).toMatch(/(Ctrl|Cmd) \+ колесо/);
  });

  it('группы клавиш: инструменты, страницы и все постоянные (скрытые настройкой — без них)', () => {
    const groups = helpKeyGroups();
    expect(groups.map(g => g.title)).toEqual(['Инструменты', 'Страницы', ...FIXED_SHORTCUTS.map(g => g.title)]);
    const resize = groups.find(g => g.title === 'Изменение размера')!;
    expect(resize.items.map(i => i.what)).not.toContain('Сохранить пропорции изображения');
    expect(groups.find(g => g.title === 'Страницы')!.items.map(i => i.what)).toEqual(['Перейти на страницу 1–9', 'Новая страница']);
  });

  it('вид: советы, клавиши — элементами <kbd>, версия и «Сообщить о проблеме»', () => {
    const { host } = mount();
    expect(host.querySelectorAll('.hlp-tip')).toHaveLength(helpTips().length);
    const undoRow = [...host.querySelectorAll('.hlp-key-row')].find(r => r.querySelector('.hlp-key-what')!.textContent === 'Отменить')!;
    expect([...undoRow.querySelectorAll('kbd')].map(k => k.textContent)).toEqual([expect.stringMatching(/^(Ctrl|Cmd)$/), 'Z']);
    expect(host.querySelector('.hlp-version')!.textContent).toBe('Abax');
    const link = host.querySelector<HTMLAnchorElement>('.hlp-report')!;
    expect(link.href).toMatch(/github\.com\/.+\/issues$/);
    expect(link.rel).toBe('noopener noreferrer');
    expect(link.target).toBe('_blank');
  });

  it('версия приложения — из __APP_VERSION__', () => {
    vi.stubGlobal('__APP_VERSION__', '9.8.7');
    const { host } = mount();
    expect(host.querySelector('.hlp-version')!.textContent).toBe('Abax, версия 9.8.7');
  });
});

describe('поиск', () => {
  it('фильтрует и советы, и клавиши; найденное подсвечено', () => {
    const { host, input } = mount();
    search(input, 'копир');
    expect(visible(host, '.hlp-tip')).toHaveLength(0);
    expect(host.querySelector<HTMLElement>('[data-section="tips"]')!.hidden).toBe(true);
    const rows = visible(host, '.hlp-key-row').map(r => r.querySelector('.hlp-key-what')!.textContent);
    expect(rows).toEqual(['Копировать', 'Копировать как изображение']);
    expect([...host.querySelectorAll('.hlp-key-row:not([hidden]) mark')].map(m => m.textContent)).toEqual(['Копир', 'Копир']);
    expect(host.querySelector<HTMLElement>('.hlp-empty')!.hidden).toBe(true);
  });

  it('совет находится по тексту; «ё» и «е» не различаются', () => {
    const { host, input } = mount();
    search(input, 'черновик');
    expect(visible(host, '.hlp-tip-title').map(t => t.textContent)).toContain('Черновик');
    search(input, 'стирает');
    expect(visible(host, '.hlp-tip-title').map(t => t.textContent)).toEqual(['Стирать правой кнопкой']);
    search(input, 'показать все');
    expect(visible(host, '.hlp-tip-title').map(t => t.textContent)).toEqual(['Двигать и масштабировать']);
    expect(visible(host, '.hlp-key-what').map(t => t.textContent)).toEqual(['Показать всё содержимое']);
    expect(visible(host, '.hlp-key-what mark').map(m => m.textContent)).toEqual(['Показать всё']);
    search(input, 'пропадает');
    expect(visible(host, '.hlp-tip-title').map(t => t.textContent)).toEqual(['Черновик']);
  });

  it('по клавише: «PageUp» находит слои; заголовок группы показывает её целиком', () => {
    const { host, input } = mount();
    search(input, 'pageup');
    expect(visible(host, '.hlp-key-what').map(w => w.textContent)).toEqual(['На слой выше', 'На передний план']);
    search(input, 'слои');
    expect(visible(host, '.hlp-key-row')).toHaveLength(4);
  });

  it('ничего не нашлось — подсказка; Esc очищает поиск', () => {
    const { host, input } = mount();
    search(input, 'абракадабра');
    expect(host.querySelector<HTMLElement>('.hlp-empty')!.hidden).toBe(false);
    expect(host.querySelector('.hlp-empty')!.textContent).toBe('Ничего не нашлось');
    expect(host.querySelector<HTMLElement>('[data-section="keys"]')!.hidden).toBe(true);
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    input.dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(true);
    expect(input.value).toBe('');
    expect(host.querySelector<HTMLElement>('.hlp-empty')!.hidden).toBe(true);
    expect(visible(host, '.hlp-tip').length).toBe(helpTips().length);
  });

  it('текст — только как текст: разметка в запросе не становится узлами', () => {
    const { host, input } = mount();
    search(input, '<img src=x>');
    expect(host.querySelector('img')).toBeNull();
  });

  it('фокус при открытии — в поле поиска', () => {
    const { view, input } = mount();
    view.focus?.();
    expect(document.activeElement).toBe(input);
  });
});
