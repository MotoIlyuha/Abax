// Ночь №4: окно первого входа на чистом устройстве (сборка без облачного сервера).
import { expect, test, type Browser, type Page } from '@playwright/test';
import { Board, continueOnboarding } from './fixtures';

const errors: string[] = [];
test.afterEach(() => { expect(errors.splice(0), 'ошибки JS на странице').toEqual([]); });

/** Новое «устройство» без профиля: окно первого входа должно появиться. */
async function fresh(browser: Browser, opts: { reducedMotion?: 'reduce' } = {}): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU', ...opts });
  await ctx.route(/^https:\/\/(api\.)?github\.com\//, r => r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__doska);
  return page;
}

const step = (page: Page) => page.locator('#onboarding');
const profile = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('doska.profile') ?? 'null'));

test.describe('окно первого входа', () => {
  test('шаг 1: способы входа, «Продолжить без входа» с пояснением; без облака - сообщение в окне', async ({ browser }) => {
    const page = await fresh(browser);
    await expect(step(page)).toBeVisible();
    await expect(step(page)).toHaveAttribute('data-step', '1');
    await expect(page.locator('.ob-step1 .ob-provider')).toHaveText(['Почта', 'Telegram', 'Google']);
    await expect(page.locator('.ob-skip')).toHaveText('Продолжить без входа');
    await expect(page.locator('.ob-note')).toContainText('Без входа доски хранятся только в этом браузере');
    await page.locator('.ob-step1 [data-provider="telegram"]').click();
    await expect(page.locator('.ob-step1 .ob-msg')).toContainText('Облачный сервер не подключён в этой сборке');
    await expect(page.locator('.ob-step1 .ob-provider')).toHaveCount(3);
    await page.context().close();
  });

  test('«слайд» на шаг 2 и обратно; Tab подставляет имя-подсказку; «Продолжить» сохраняет профиль', async ({ browser }) => {
    const page = await fresh(browser);
    const track = page.locator('.ob-track');
    await page.locator('.ob-skip').click();
    await expect(step(page)).toHaveAttribute('data-step', '2');
    await expect(track).toHaveCSS('transform', /matrix\(1, 0, 0, 1, -\d+/);
    await page.locator('.ob-back').click();
    await expect(step(page)).toHaveAttribute('data-step', '1');
    await expect(track).toHaveCSS('transform', /matrix\(1, 0, 0, 1, 0, 0\)|none/);
    await page.locator('.ob-skip').click();

    const name = page.locator('.ob-name');
    await expect(name).toBeFocused();
    await expect(name).toHaveValue('');
    const placeholder = (await name.getAttribute('placeholder'))!;
    expect(placeholder.length).toBeGreaterThan(1);
    await page.keyboard.press('Tab');
    await expect(name).toHaveValue(placeholder);
    await expect(name).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(name).not.toBeFocused();
    await expect(page.locator('.cp-badge')).toHaveText(placeholder);

    await page.locator('.ob-step2 [data-cursor="mint"]').click();
    await page.locator('.ob-continue').click();
    // шаг 3: «Создайте свой первый проект!» — стартовый проект переименовывается, новый не создаётся
    await expect(step(page)).toHaveAttribute('data-step', '3');
    await expect(page.locator('.ob-step3 .ob-title')).toHaveText('Создайте свой первый проект!');
    await expect(page.locator('.ob-step3 .pd-pages-note')).toBeVisible();
    const projectName = page.locator('.ob-step3 .pd-name');
    await expect(projectName).toBeFocused();
    await expect(projectName).toHaveAttribute('placeholder', 'Проект 1');
    await projectName.fill('Геометрия и алгебра, 8 класс');
    await page.locator('.ob-step3 .pd-page').fill('Дроби');
    await page.locator('.ob-step3 .ob-create').click();
    await expect(step(page)).toHaveCount(0);
    await expect(page.locator('#project-name')).toHaveValue('Геометрия и алгебр...');
    await expect(page.locator('#page-name')).toHaveValue('Дроби');
    const st = await page.evaluate(() => {
      const s = (window as unknown as { __doska: { state: { project: { name: string }; projects: unknown[] } } }).__doska.state;
      return { name: s.project.name, count: s.projects.length };
    });
    expect(st).toEqual({ name: 'Геометрия и алгебра, 8 класс', count: 1 });
    expect(await profile(page)).toMatchObject({ name: placeholder, cursorId: 'mint', onboarded: true });
    // курсор и кнопка «Выделение» — выбранные
    await expect(page.locator('#toolbar .tool[data-tool="select"] svg.cursor-icon path').first()).toHaveAttribute('fill', '#96f2d7');
    await page.reload();
    await new Board(page).ready();
    await expect(step(page)).toHaveCount(0);
    await page.context().close();
  });

  test('пустое имя + «Продолжить» - имя из подсказки; Pro-курсор - примерка без блокировки', async ({ browser }) => {
    const page = await fresh(browser);
    await page.locator('.ob-skip').click();
    const placeholder = (await page.locator('.ob-name').getAttribute('placeholder'))!;
    await page.locator('.ob-step2 [data-cursor="coral"]').click();
    await page.locator('.ob-step2 [data-cursor="aurora"]').click();
    await expect(page.locator('.cp-lock')).toBeVisible();
    await expect(page.locator('.cp-lock')).toContainText('Доступно в подписке Pro');
    await expect(page.locator('.ob-continue')).toBeEnabled();
    await page.locator('.cp-lock-back').click();
    await expect(page.locator('.cp-lock')).toBeHidden();
    await expect(page.locator('.ob-step2 [data-cursor="coral"]')).toHaveClass(/active/);
    await page.locator('.ob-step2 [data-cursor="flame"]').click();
    await continueOnboarding(page);
    expect(await profile(page)).toMatchObject({ name: placeholder, cursorId: 'coral' });
    await page.context().close();
  });

  test('холст выбора курсора: мышь снимает показное выделение, рамка и клик выделяют, пустое место снимает', async ({ browser }) => {
    const page = await fresh(browser);
    await page.locator('.ob-skip').click();
    await page.mouse.move(5, 5);
    const pv = page.locator('.ob-step2 .cp-preview');
    await expect(pv).toHaveAttribute('data-selected', 'true');
    // шаг 2 въезжает «слайдом»: координаты холста берём, когда он встал на место
    let prev = -1;
    await expect.poll(async () => {
      const x = (await pv.boundingBox())!.x;
      const still = x === prev;
      prev = x;
      return still;
    }).toBe(true);
    const b = (await pv.boundingBox())!;
    const rail = (await page.locator('.ob-step2 .cp-rail').boundingBox())!;
    const x0 = rail.x + rail.width + 8;
    await page.mouse.move(b.x + b.width - 20, b.y + 20, { steps: 4 });
    await expect(pv).toHaveAttribute('data-selected', 'false');
    // рамка через весь холст правее списка задевает фигуру
    await page.mouse.move(x0, b.y + 8);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width - 8, b.y + b.height - 8, { steps: 6 });
    await page.mouse.up();
    await expect(pv).toHaveAttribute('data-selected', 'true');
    // клик в пустой угол снимает выделение
    await page.mouse.click(b.x + b.width - 8, b.y + 8);
    await expect(pv).toHaveAttribute('data-selected', 'false');
    // полоса прокрутки списка видна, только пока мышь над списком
    await expect(page.locator('.ob-step2 .cp-thumb')).toHaveCSS('opacity', '0');
    await page.mouse.move(rail.x + rail.width / 2, rail.y + rail.height / 2, { steps: 4 });
    await expect(page.locator('.ob-step2 .cp-thumb')).toHaveCSS('opacity', '1');
    // мышь ушла — фигура снова выделена напоказ
    await page.mouse.move(5, 5, { steps: 4 });
    await expect(pv).toHaveAttribute('data-selected', 'true');
    await page.context().close();
  });

  test('пока окно открыто, горячие клавиши доски не срабатывают; Esc закрывает', async ({ browser }) => {
    const page = await fresh(browser);
    await expect(step(page)).toBeVisible();
    // фокус на самом окне (без рамки на кнопке), Tab — к кнопкам окна
    await expect(page.locator('.ob-window')).toBeFocused();
    // по умолчанию — перо; V («Выделение») при открытом окне не срабатывает
    expect(await page.evaluate(() => (window as any).__doska.state.tool)).toBe('pen');
    await page.keyboard.press('v');
    expect(await page.evaluate(() => (window as any).__doska.state.tool)).toBe('pen');
    await page.keyboard.press('Escape');
    await expect(step(page)).toHaveCount(0);
    expect(await profile(page)).toMatchObject({ onboarded: true, cursorId: 'default' });
    expect((await profile(page)).name.length).toBeGreaterThan(1);
    await page.keyboard.press('v');
    expect(await page.evaluate(() => (window as any).__doska.state.tool)).toBe('select');
    await page.context().close();
  });

  test('с «уменьшением движения» шаги переключаются без анимации', async ({ browser }) => {
    const page = await fresh(browser, { reducedMotion: 'reduce' });
    await expect(step(page)).toHaveClass(/ob-instant/);
    await page.locator('.ob-skip').click();
    await expect(page.locator('.ob-track')).toHaveCSS('transition-duration', '0s');
    await page.context().close();
  });

  test('гость по ссылке совместной работы окна не видит', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(String(e)));
    // ссылка на комнату, которой нет: гость получает уведомление, а не окно знакомства
    await page.goto('/?room=local:NOPE0000&name=Гость');
    await page.waitForFunction(() => !!(window as any).__doska);
    await page.waitForTimeout(300);
    await expect(step(page)).toHaveCount(0);
    await ctx.close();
  });
});
