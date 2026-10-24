// Иконки приложения из логотипа public/logo.svg. Логотип растеризует Chromium из Playwright.
// Запуск: npm run icons.
//   build/icon.png (512) и build/icon.ico (16–256, PNG внутри) — electron-builder: exe, установщик, ярлыки;
//   android/app/src/main/res — иконка лаунчера (обычная, круглая, адаптивная) и заставка при запуске.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
/** Заставка Android: размеры картинок шаблона Capacitor, фон — как у доски. */
const SPLASH_BG = '#f4f5f7';
const SPLASHES = {
  'drawable': [480, 320],
  'drawable-land-mdpi': [480, 320], 'drawable-land-hdpi': [800, 480], 'drawable-land-xhdpi': [1280, 720],
  'drawable-land-xxhdpi': [1600, 960], 'drawable-land-xxxhdpi': [1920, 1280],
  'drawable-port-mdpi': [320, 480], 'drawable-port-hdpi': [480, 800], 'drawable-port-xhdpi': [720, 1280],
  'drawable-port-xxhdpi': [960, 1600], 'drawable-port-xxxhdpi': [1280, 1920],
};

const logo = await readFile(new URL('../public/logo.svg', import.meta.url), 'utf8');
const tile = /<rect[^>]*\/>/.exec(logo)[0];
/** Круглая иконка: та же картинка на круге вместо скруглённой плитки, с той же заливкой и обводкой. */
const tileInset = Number(/ x="([^"]+)"/.exec(tile)[1]);
const tilePaint = tile.match(/(fill|stroke|stroke-width)="[^"]+"/g).join(' ');
const roundLogo = logo.replace(tile, `<circle cx="32" cy="32" r="${32 - tileInset}" ${tilePaint}/>`);
/**
 * Передний слой адаптивной иконки (108dp): только рисунок, плитку рисует система цветом фона.
 * Видимая часть иконки — около 72dp, она соответствует плитке 64×64, отсюда окно 96×96 вокруг центра.
 */
const foreground = logo.replace(tile, '').replace(/viewBox="[^"]*"/, 'viewBox="-16 -16 96 96"');

const browser = await chromium.launch();
const page = await browser.newPage();

/** PNG w×h: svg по центру размером size (по умолчанию во весь кадр), фон прозрачный или bg. */
async function render(svg, w, h = w, { size = Math.min(w, h), bg = 'transparent' } = {}) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(
    `<style>html,body{margin:0;width:${w}px;height:${h}px;background:${bg};display:flex;align-items:center;justify-content:center}`
    + `svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  return page.screenshot({ omitBackground: bg === 'transparent', clip: { x: 0, y: 0, width: w, height: h } });
}

/** ICO из PNG-кадров: заголовок, каталог по 16 байт на кадр, затем сами PNG. */
function ico(frames) {
  const head = Buffer.alloc(6 + 16 * frames.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(frames.length, 4);
  let offset = head.length;
  frames.forEach(({ size, png }, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(size >= 256 ? 0 : size, e);
    head.writeUInt8(size >= 256 ? 0 : size, e + 1);
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(png.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...frames.map(f => f.png)]);
}

async function write(url, data) {
  await mkdir(new URL('.', url), { recursive: true });
  await writeFile(url, data);
}

try {
  const build = new URL('../build/', import.meta.url);
  const frames = [];
  for (const size of ICO_SIZES) frames.push({ size, png: await render(logo, size) });
  await write(new URL('icon.ico', build), ico(frames));
  await write(new URL('icon.png', build), await render(logo, 512));

  const res = new URL('../android/app/src/main/res/', import.meta.url);
  for (const [d, k] of Object.entries(DENSITIES)) {
    await write(new URL(`mipmap-${d}/ic_launcher.png`, res), await render(logo, 48 * k));
    await write(new URL(`mipmap-${d}/ic_launcher_round.png`, res), await render(roundLogo, 48 * k));
    await write(new URL(`mipmap-${d}/ic_launcher_foreground.png`, res), await render(foreground, 108 * k));
  }
  for (const [dir, [w, h]] of Object.entries(SPLASHES)) {
    await write(new URL(`${dir}/splash.png`, res), await render(logo, w, h, { size: Math.round(Math.min(w, h) * 0.28), bg: SPLASH_BG }));
  }
  console.log('build/icon.ico, build/icon.png; Android: иконки лаунчера и заставки');
} finally {
  await browser.close();
}
