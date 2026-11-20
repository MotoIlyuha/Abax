// Аватар пользователя: буквы по умолчанию, смайл кнопкой в углу круга, фото — системный выбор файла и обрезка под круг.
import { expect, test, type Browser, type Page } from '@playwright/test';
import { continueOnboarding } from './fixtures';

const errors: string[] = [];
test.afterEach(() => { expect(errors.splice(0), 'ошибки JS на странице').toEqual([]); });

async function fresh(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU' });
  await ctx.route(/^https:\/\/(api\.)?github\.com\//, r => r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__doska);
  return page;
}

const profile = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('doska.profile') ?? 'null'));

/** Картинка 300×200 в PNG: левая половина оранжевая, правая — синяя. */
async function testImage(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 300; c.height = 200;
    const x = c.getContext('2d')!;
    x.fillStyle = '#e8590c'; x.fillRect(0, 0, 150, 200);
    x.fillStyle = '#1971c2'; x.fillRect(150, 0, 150, 200);
    return c.toDataURL('image/png').split(',')[1];
  });
  return Buffer.from(b64, 'base64');
}

test('знакомство: фото обрезается под круг, «Удалить фото» возвращает буквы; аватар — в шапке и в выборе курсора', async ({ browser }) => {
  const page = await fresh(browser);
  await page.locator('.ob-skip').click();
  await page.locator('.ob-name').fill('Бодрый Енот');
  const ed = page.locator('.ob-step2 .ae');
  await expect(ed.locator('.ua-circle')).toHaveText('БЕ');
  await expect(page.locator('.ob-step2 .cp-face .ua-circle')).toHaveText('БЕ');
  await expect(page.locator('.ob-step2 .cp-face')).toHaveAttribute('title', 'Это ваш аватар');
  const photoBtn = ed.locator('.ae-photo');
  await expect(photoBtn).toHaveText('Установить фото');

  // «Установить фото» — системное окно выбора файла, затем обрезка
  const chooser = page.waitForEvent('filechooser');
  await photoBtn.click();
  await (await chooser).setFiles({ name: 'me.png', mimeType: 'image/png', buffer: await testImage(page) });
  const crop = page.locator('.avatar-crop');
  await expect(crop).toBeVisible();
  await expect(crop.locator('.ac-title')).toHaveText('Фото профиля');
  // Esc закрывает обрезку, а не окно знакомства
  await page.keyboard.press('Escape');
  await expect(crop).toHaveCount(0);
  await expect(page.locator('#onboarding')).toBeVisible();
  await expect(photoBtn).toHaveText('Установить фото');

  const again = page.waitForEvent('filechooser');
  await photoBtn.click();
  await (await again).setFiles({ name: 'me.png', mimeType: 'image/png', buffer: await testImage(page) });
  await expect(crop).toBeVisible();
  // перетаскивание вправо до упора — в круг попадает оранжевая половина
  const stage = (await crop.locator('.ac-stage').boundingBox())!;
  await page.mouse.move(stage.x + 140, stage.y + 140);
  await page.mouse.down();
  await page.mouse.move(stage.x + 270, stage.y + 140, { steps: 5 });
  await page.mouse.up();
  await crop.locator('.ac-save').click();
  await expect(crop).toHaveCount(0);
  await expect(photoBtn).toHaveText('Удалить фото');
  await expect(ed.locator('.ua-circle img')).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
  await expect(page.locator('.ob-step2 .cp-face .ua-circle img')).toHaveCount(1);
  // в середине фото — оранжевое
  const center = await ed.locator('.ua-circle img').evaluate(async (img: HTMLImageElement) => {
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext('2d')!;
    x.drawImage(img, 0, 0);
    return Array.from(x.getImageData(c.width / 2, c.height / 2, 1, 1).data.slice(0, 3));
  });
  expect(center[0]).toBeGreaterThan(180);
  expect(center[2]).toBeLessThan(80);

  await continueOnboarding(page);
  await expect(page.locator('#onboarding')).toHaveCount(0);
  expect((await profile(page)).avatar).toMatch(/^data:image\/jpeg;base64,/);
  // мой аватар в шапке — с фото
  await expect(page.locator('#collab-presence .user-avatar.self .ua-circle img')).toHaveCount(1);

  // настройки профиля: «Удалить фото» — снова буквы, в шапке тоже
  await page.keyboard.press('Control+Comma');
  await page.locator('.sd-nav-item', { hasText: 'Профиль' }).click();
  const ps = page.locator('#settings-dialog .ps-identity .ae');
  await expect(ps.locator('.ae-photo')).toHaveText('Удалить фото');
  await ps.locator('.ae-photo').click();
  await expect(ps.locator('.ae-photo')).toHaveText('Установить фото');
  await expect(ps.locator('.ua-circle')).toHaveText('БЕ');
  expect((await profile(page)).avatar).toBeNull();
  await expect(page.locator('#collab-presence .user-avatar.self .ua-circle')).toHaveText('БЕ');
  await page.context().close();
});

test('настройки: смайл вместо букв через кнопку в углу круга; поиск в окне смайлов работает поверх настроек', async ({ browser }) => {
  const page = await fresh(browser);
  await page.locator('.ob-skip').click();
  await page.locator('.ob-name').fill('Аня');
  await continueOnboarding(page);
  await page.keyboard.press('Control+Comma');
  await page.locator('.sd-nav-item', { hasText: 'Профиль' }).click();
  const ps = page.locator('#settings-dialog .ps-identity .ae');
  await expect(ps.locator('.ua-circle')).toHaveText('А');
  await ps.locator('.ae-emoji').click();
  const picker = page.locator('#icon-picker');
  await expect(picker).toBeVisible();
  await expect(picker.locator('.ip-upload')).toHaveCount(0);
  // окно смайлов — поверх настроек, и клик по нему не закрывает настройки
  const z = await picker.evaluate(el => Number(getComputedStyle(el).zIndex));
  expect(z).toBeGreaterThan(900);
  await picker.locator('.ip-search').pressSequentially('лиса');
  await expect(picker.locator('.ip-results .ip-emoji').first()).toBeVisible();
  // Esc закрывает окно смайлов, настройки остаются
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await expect(page.locator('#settings-dialog')).toBeVisible();
  await ps.locator('.ae-emoji').click();
  await picker.locator('.ip-search').fill('лиса');
  await picker.locator('.ip-search').press('Enter');
  await expect(picker).toHaveCount(0);
  await expect(ps.locator('.ua-circle')).toHaveText('🦊');
  expect((await profile(page)).avatar).toBe('🦊');
  await expect(page.locator('#collab-presence .user-avatar.self .ua-circle')).toHaveText('🦊');
  await page.context().close();
});
