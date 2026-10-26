import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { test as hostTest } from './host';

const API = 'https://api.github.com/repos/MotoIlyuha/Abax/releases/latest';
const CURRENT: string = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version;
const [MAJOR] = CURRENT.split('.').map(Number);
/** Версии новее текущей. */
const NEXT = `${MAJOR + 1}.0.0`;
const AFTER_NEXT = `${MAJOR + 1}.1.0`;
/** Проверка при запуске идёт через 2 с; ждём с запасом. */
const SHOWN = { timeout: 10_000 };

const BODY = [
  'Короткое **вступление** о версии.',
  '',
  '## Что скачать',
  '',
  '| Платформа | Файл |',
  '|---|---|',
  '| Android | `Abax.apk` |',
  '',
  '## Новое',
  '',
  '- **Обновления** — приложение само предлагает новую версию.',
  '- Вторая строка с `кодом`, [ссылкой](https://example.com) и <b>разметкой</b>.',
  '',
  '## Контрольные суммы SHA-256',
  '',
  '```',
  'abc123  Abax.Setup.exe',
  '```',
].join('\n');

function release(version: string) {
  const dl = (name: string) => ({ name, browser_download_url: `https://github.com/MotoIlyuha/Abax/releases/download/v${version}/${name}` });
  return {
    tag_name: `v${version}`,
    name: `Abax ${version}`,
    html_url: `https://github.com/MotoIlyuha/Abax/releases/tag/v${version}`,
    published_at: new Date().toISOString(),
    body: BODY,
    assets: [dl(`Abax-${version}-web.zip`), dl(`Abax-${version}.apk`), dl(`Abax.${version}.exe`), dl(`Abax.Setup.${version}.exe`)],
  };
}

/** Ответ GitHub на «последний релиз» (null — сеть недоступна); возвращает счётчик запросов. */
async function serveRelease(page: Page, version: string | null, status = 200): Promise<() => number> {
  let n = 0;
  await page.unroute(API);
  await page.route(API, route => {
    n++;
    if (version === null) return route.abort();
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(status === 200 ? release(version) : { message: 'error' }) });
  });
  return () => n;
}

/** Память проверки: checkedAt — сутки назад и больше (пора проверять снова). */
async function dayPassed(page: Page): Promise<void> {
  await page.evaluate(() => {
    const v = JSON.parse(localStorage.getItem('doska.updates') || '{}');
    v.checkedAt = Date.now() - 25 * 60 * 60 * 1000;
    localStorage.setItem('doska.updates', JSON.stringify(v));
  });
}

/**
 * Проверка при запуске, начатая ещё при открытии доски фикстурой, прошла («нет сети»):
 * дальше GitHub спрашивают только перезагрузки и кнопки теста.
 */
async function startupDone(page: Page): Promise<void> {
  const requests = await serveRelease(page, null);
  await expect.poll(requests, SHOWN).toBe(1);
}

async function reload(page: Page): Promise<void> {
  await page.reload();
  await page.waitForFunction(() => !!(window as any).__doska);
}

async function openAbout(page: Page): Promise<void> {
  await page.keyboard.press('Control+Comma');
  await page.locator('.sd-nav-item[data-section="about"]').click();
  await expect(page.locator('#sd-title')).toHaveText('О проекте');
}

test.describe('обновления', () => {
  test('новая версия: карточка при запуске, что нового; «Позже» — до следующей проверки', async ({ page }) => {
    await startupDone(page);
    const requests = await serveRelease(page, NEXT);
    await reload(page);
    const card = page.locator('#update-card');
    await expect(card).toBeVisible(SHOWN);
    await expect(card.locator('.uc-title')).toHaveText(`Вышла Abax ${NEXT}`);
    await expect(card.locator('.uc-sub')).toHaveText(`У вас ${CURRENT} · выпущена сегодня`);
    await expect(card.locator('.uc-summary')).toHaveText('Короткое вступление о версии.');
    await expect(card.locator('.uc-summary strong')).toHaveText('вступление');
    // что нового — свёрнуто; разделы «Что скачать» и контрольные суммы не показываем
    const notes = card.locator('.uc-notes');
    await expect(notes.locator('summary')).toHaveText('Что нового (2)');
    await expect(notes.locator('li').first()).toBeHidden();
    await notes.locator('summary').click();
    await expect(notes.locator('li')).toHaveText([
      'Обновления — приложение само предлагает новую версию.',
      'Вторая строка с кодом, ссылкой и <b>разметкой</b>.',
    ]);
    await expect(notes.locator('li').first().locator('strong')).toHaveText('Обновления');
    await expect(notes.locator('li b')).toHaveCount(0); // HTML из описания — только текстом
    await expect(card).not.toContainText('abc123');
    // в браузере файла под платформу нет — ведём на страницу релиза
    const open = card.locator('.uc-download');
    await expect(open).toHaveText('Открыть релиз');
    await expect(open).toHaveAttribute('href', `https://github.com/MotoIlyuha/Abax/releases/tag/v${NEXT}`);
    await expect(open).toHaveAttribute('target', '_blank');

    await card.locator('.uc-later').click();
    await expect(card).toHaveCount(0);
    expect(requests()).toBe(1);
    // при следующем запуске в тот же день GitHub не спрашиваем
    await reload(page);
    await page.waitForTimeout(3000);
    await expect(card).toHaveCount(0);
    expect(requests()).toBe(1);
    // через сутки — снова
    await dayPassed(page);
    await reload(page);
    await expect(card).toBeVisible(SHOWN);
    expect(requests()).toBe(2);
    await card.locator('.uc-close').click();
    await expect(card).toHaveCount(0);
  });

  test('та же версия или нет сети — карточки нет', async ({ page }) => {
    await startupDone(page);
    let requests = await serveRelease(page, CURRENT);
    await reload(page);
    await expect.poll(requests, SHOWN).toBe(1);
    await page.waitForTimeout(500);
    await expect(page.locator('#update-card')).toHaveCount(0);

    // нет сети: молча, и проверка не засчитана — при следующем запуске попробуем снова
    await page.evaluate(() => localStorage.removeItem('doska.updates'));
    requests = await serveRelease(page, null);
    await reload(page);
    await expect.poll(requests, SHOWN).toBe(1);
    await page.waitForTimeout(500);
    await expect(page.locator('#update-card')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('doska.updates'))).toBeNull();
  });

  test('«Пропустить версию»: о ней не напоминаем, о следующей — да', async ({ page }) => {
    await startupDone(page);
    await serveRelease(page, NEXT);
    await reload(page);
    const card = page.locator('#update-card');
    await expect(card).toBeVisible(SHOWN);
    await card.locator('.uc-skip').click();
    await expect(card).toHaveCount(0);

    const requests = await serveRelease(page, NEXT);
    await dayPassed(page);
    await reload(page);
    await expect.poll(requests, SHOWN).toBe(1);
    await page.waitForTimeout(500);
    await expect(card).toHaveCount(0);

    await serveRelease(page, AFTER_NEXT);
    await dayPassed(page);
    await reload(page);
    await expect(card).toBeVisible(SHOWN);
    await expect(card.locator('.uc-title')).toHaveText(`Вышла Abax ${AFTER_NEXT}`);
  });

  test('«О проекте»: проверка вручную и выключатель автопроверки', async ({ page }) => {
    await startupDone(page);
    await openAbout(page);
    const box = page.locator('#settings-dialog .sd-updates');
    const status = box.locator('.sd-updates-status');
    const check = box.locator('.sd-updates-check');
    await expect(status).toHaveText('Ещё не проверяли');

    await serveRelease(page, CURRENT);
    await check.click();
    await expect(status).toHaveText('У вас последняя версия');
    await expect(box.locator('.sd-updates-found')).toBeHidden();

    await serveRelease(page, CURRENT, 403);
    await check.click();
    await expect(status).toHaveText('Не удалось связаться с GitHub — проверьте интернет и попробуйте ещё раз');
    await expect(status).toHaveClass(/error/);

    // вручную показываем и пропущенную версию
    await page.evaluate(v => localStorage.setItem('doska.updates', JSON.stringify({ auto: true, skip: v })), NEXT);
    await serveRelease(page, NEXT);
    await check.click();
    await expect(status).toHaveText(`Вышла версия ${NEXT}`);
    await expect(status).not.toHaveClass(/error/);
    const found = box.locator('.sd-updates-found a');
    await expect(found).toHaveText(['Открыть релиз', 'Что нового']);
    await expect(found.nth(1)).toHaveAttribute('href', `https://github.com/MotoIlyuha/Abax/releases/tag/v${NEXT}`);

    // автопроверку выключили — при запуске GitHub не спрашиваем
    const auto = box.locator('.sd-updates-auto');
    await expect(auto).toBeChecked();
    await auto.uncheck();
    const requests = await serveRelease(page, NEXT);
    await dayPassed(page);
    await reload(page);
    await page.waitForTimeout(3000);
    expect(requests()).toBe(0);
    await expect(page.locator('#update-card')).toHaveCount(0);
    await openAbout(page);
    await expect(box.locator('.sd-updates-auto')).not.toBeChecked();
    await expect(status).toHaveText(/^Проверяли /);
  });
});

hostTest.describe('обновления в приложении для Windows', () => {
  hostTest('установленной версии — установщик, переносной — переносной exe', async ({ host, page }) => {
    await startupDone(page);
    await serveRelease(page, NEXT);
    await reload(page);
    const card = page.locator('#update-card');
    const download = card.locator('.uc-download');
    await expect(card).toBeVisible(SHOWN);
    await expect(download).toHaveText('Скачать');
    await expect(download).toHaveAttribute('href', `https://github.com/MotoIlyuha/Abax/releases/download/v${NEXT}/Abax.Setup.${NEXT}.exe`);
    // ссылка уходит в браузер (в Electron — системный); в карточке — что делать с файлом
    const popup = page.waitForEvent('popup');
    await download.click();
    await (await popup).close();
    await expect(card.locator('.uc-hint')).toHaveText('Запустите скачанный установщик — он обновит Abax. Проекты и настройки сохранятся.');
    await expect(card).toBeVisible();

    host.appInfo = { platform: 'win32', portable: true };
    await dayPassed(page);
    await reload(page);
    await expect(card).toBeVisible(SHOWN);
    await expect(download).toHaveAttribute('href', `https://github.com/MotoIlyuha/Abax/releases/download/v${NEXT}/Abax.${NEXT}.exe`);
    // подсказка — имя файла (title уходит в data-tip при наведении)
    expect(await download.evaluate(a => (a as HTMLElement).title || (a as HTMLElement).dataset.tip)).toBe(`Abax.${NEXT}.exe`);
  });
});
