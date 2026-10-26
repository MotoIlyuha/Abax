import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_ICON_COLORS, applyAppIcon, iconColors, initAppIcon, logoDataUrl, logoSrc, logoSvg, sameColors, saveIconColors,
} from '../../src/app-icon';
import { experimentsShown, setExperimentsShown } from '../../src/experimental';

beforeEach(() => {
  localStorage.clear();
  document.head.innerHTML = '<link rel="icon" type="image/svg+xml" href="logo.svg">';
  document.body.innerHTML = '<img class="app-logo" src="logo.svg"><img class="other" src="x.png">';
});

const favicon = () => document.querySelector<HTMLLinkElement>('link[rel="icon"]')!.getAttribute('href');
const logo = () => document.querySelector<HTMLImageElement>('img.app-logo')!.getAttribute('src');

describe('цвета иконки приложения', () => {
  it('логотип: круг и треугольник — основным цветом, точка — акцентом, фон — своим, рамка — светлый оттенок основного', () => {
    const svg = logoSvg({ main: '#7a2bd6', accent: '#00aa55', bg: '#112233' });
    expect(svg.match(/stroke="#7a2bd6"/g)).toHaveLength(2);
    expect(svg).toContain('fill="#00aa55"');
    expect(svg).toMatch(/<rect[^>]* fill="#112233"/);
    // рамка по умолчанию — почти как в public/logo.svg (#c2ccc1)
    const frame = /<rect[^>]* stroke="(#[0-9a-f]{6})"/.exec(logoSvg(DEFAULT_ICON_COLORS))![1];
    const [r, g, b] = [1, 3, 5].map(i => parseInt(frame.slice(i, i + 2), 16));
    expect(Math.abs(r - 0xc2) + Math.abs(g - 0xcc) + Math.abs(b - 0xc1)).toBeLessThan(12);
    expect(decodeURIComponent(logoDataUrl(DEFAULT_ICON_COLORS).split(',')[1])).toBe(logoSvg(DEFAULT_ICON_COLORS));
  });

  it('по умолчанию — исходные цвета и файл logo.svg; битые сохранённые — тоже по умолчанию', () => {
    expect(iconColors()).toEqual(DEFAULT_ICON_COLORS);
    expect(logoSrc()).toBe('logo.svg');
    localStorage.setItem('doska.iconColors', JSON.stringify({ main: 'red', accent: '#000000' }));
    expect(iconColors()).toEqual(DEFAULT_ICON_COLORS);
    // сохранённые до появления фона — на фоне по умолчанию; битый фон — тоже
    localStorage.setItem('doska.iconColors', JSON.stringify({ main: '#123456', accent: '#654321' }));
    expect(iconColors()).toEqual({ main: '#123456', accent: '#654321', bg: DEFAULT_ICON_COLORS.bg });
    localStorage.setItem('doska.iconColors', JSON.stringify({ main: '#123456', accent: '#654321', bg: 'blue' }));
    expect(iconColors().bg).toBe(DEFAULT_ICON_COLORS.bg);
    localStorage.setItem('doska.iconColors', '{oops');
    expect(iconColors()).toEqual(DEFAULT_ICON_COLORS);
  });

  it('сохранение меняет значок вкладки и логотипы; исходные цвета не хранятся; сброс — обратно', () => {
    saveIconColors({ main: '#7A2BD6', accent: '#00AA55', bg: '#FFEEDD' });
    expect(iconColors()).toEqual({ main: '#7a2bd6', accent: '#00aa55', bg: '#ffeedd' });
    expect(favicon()).toBe(logoDataUrl({ main: '#7a2bd6', accent: '#00aa55', bg: '#ffeedd' }));
    expect(logo()).toBe(favicon());
    expect(document.querySelector('img.other')!.getAttribute('src')).toBe('x.png');

    saveIconColors({ ...DEFAULT_ICON_COLORS });
    expect(localStorage.getItem('doska.iconColors')).toBeNull();
    expect(favicon()).toBe('logo.svg');

    saveIconColors({ main: '#111111', accent: '#222222', bg: '#333333' });
    saveIconColors(null);
    expect(localStorage.getItem('doska.iconColors')).toBeNull();
    expect(logo()).toBe('logo.svg');
  });

  it('запуск применяет только свои цвета', () => {
    document.querySelector('link[rel="icon"]')!.setAttribute('href', 'keep.svg');
    initAppIcon();
    expect(favicon()).toBe('keep.svg'); // своих нет — ничего не трогаем
    localStorage.setItem('doska.iconColors', JSON.stringify({ main: '#123456', accent: '#654321', bg: '#abcdef' }));
    initAppIcon();
    expect(favicon()).toBe(logoDataUrl({ main: '#123456', accent: '#654321', bg: '#abcdef' }));
    applyAppIcon(DEFAULT_ICON_COLORS);
    expect(favicon()).toBe('logo.svg');
  });

  it('sameColors не смотрит на регистр', () => {
    expect(sameColors({ main: '#ABCDEF', accent: '#000000', bg: '#FFFFFF' }, { main: '#abcdef', accent: '#000000', bg: '#ffffff' })).toBe(true);
    expect(sameColors({ main: '#abcdef', accent: '#000001', bg: '#ffffff' }, { main: '#abcdef', accent: '#000000', bg: '#ffffff' })).toBe(false);
    expect(sameColors({ main: '#abcdef', accent: '#000000', bg: '#fffffe' }, { main: '#abcdef', accent: '#000000', bg: '#ffffff' })).toBe(false);
  });
});

describe('скрытый раздел «Экспериментальные»', () => {
  it('по умолчанию спрятан; показ запоминается, скрытие — тоже', () => {
    expect(experimentsShown()).toBe(false);
    setExperimentsShown(true);
    expect(experimentsShown()).toBe(true);
    expect(localStorage.getItem('doska.experiments')).toBe('1');
    setExperimentsShown(false);
    expect(experimentsShown()).toBe(false);
    expect(localStorage.getItem('doska.experiments')).toBeNull();
  });
});
