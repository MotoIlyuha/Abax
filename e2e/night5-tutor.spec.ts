import { test, expect, type Page } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { resolve } from 'node:path';
import { makeApp, closeApps, BOT_TOKEN, call, taskEl } from '../tests/server/helpers';
import { skipOnboarding } from './fixtures';

test.afterEach(closeApps);
const button = (p: Page, name: string) => p.getByRole('button', { name, exact: true });
async function addStudent(p: Page, name: string, price: string, color: string, schedule = false) {
  await button(p, 'Ученики').click();
  await button(p, 'Добавить ученика').click();
  await p.getByLabel('Имя ученика', { exact: true }).fill(name);
  await p.getByLabel('Цена занятия, ₽').fill(price);
  await button(p, color).click();
  if (schedule) {
    await p.getByText('Регулярный график', { exact: true }).click();
    await button(p, 'Добавить слот').click();
    const today = new Date();
    await p.getByLabel('День недели').selectOption(String(today.getDay()));
  }
  await button(p, 'Сохранить').click();
  await expect(p.getByRole('dialog')).toHaveCount(0);
}
for (const width of [390, 1440]) {
  test('Кабинет и календарь при ширине ' + width, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await skipOnboarding(page.context());
    await page.goto('/?route=tutor');
    await expect(page.getByRole('heading', { name: 'Календарь' })).toBeVisible();
    await addStudent(page, 'Лена', '2100', 'Сиреневый', true);
    await addStudent(page, 'Саша', '3200', 'Зелёный');
    await button(page, 'Календарь').click();
    for (const mode of ['День', 'Неделя', 'Месяц', 'Список']) {
      await button(page, mode).click();
      await expect(page.locator('.tu-lesson').first()).toContainText('Лена');
      expect(await page.locator('.tu-main').evaluate((n) => n.scrollWidth - n.clientWidth)).toBeLessThanOrEqual(1);
    }
    await page.locator('.tu-lesson').first().click();
    await button(page, 'Начать занятие').click();
    await expect(page.locator('#page-name')).toHaveValue(/Занятие #1/);
    await page.getByRole('link', { name: '← В кабинет Tutor' }).click();
    await button(page, 'Список').click();
    await page.locator('[data-status=current]').first().click();
    await button(page, 'Завершить занятие').click();
    await button(page, 'Доход').click();
    await expect(page.locator('.tu-kpi-feature')).toContainText('0 ₽');
    await button(page, 'Список должников').click();
    await button(page, 'Оплачено').click();
    for (const period of ['День', 'Неделя', 'Месяц']) {
      await button(page, period).click();
      await expect(page.locator('rect[data-series=fact]').first()).toHaveAttribute('fill', '#9463a9');
      await expect(page.locator('[data-chart=income-share] circle[data-student]')).toHaveCount(1);
    }
    expect(await page.locator('.tu-main').evaluate((n) => n.scrollWidth - n.clientWidth)).toBeLessThanOrEqual(1);
  });
}
test('Telegram Mini App входит в облачный кабинет, читает сложное задание и различает шесть статусов', async ({
  page,
}) => {
  const a = await makeApp({ staticDir: resolve('dist'), enforceLimits: false });
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  a.clock.t = +day;
  const date = String(Math.floor(a.clock.t / 1000)),
    user = JSON.stringify({ id: 394008, first_name: 'Ольга' });
  const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const hash = createHmac('sha256', secret)
    .update('auth_date=' + date + '\nuser=' + user)
    .digest('hex');
  const initData = new URLSearchParams({ user, auth_date: date, hash }).toString();
  await page.addInitScript(
    ({ base, initData }) => {
      localStorage.setItem('doska.apiUrl', base);
      Object.assign(window, {
        Telegram: {
          WebApp: {
            initData,
            colorScheme: 'dark',
            safeAreaInset: { top: 7 },
            BackButton: { show() {}, hide() {}, onClick() {} },
          },
        },
      });
    },
    { base: a.base, initData },
  );
  await skipOnboarding(page.context());
  await page.goto(a.base + '/tutor');
  await expect(button(page, 'Календарь')).toBeVisible();
  await expect(page.locator('#tutor-root')).toHaveAttribute('data-scheme', 'dark');
  await addStudent(page, 'Оля', '2000', 'Синий');
  const token = await page.evaluate(() => localStorage.getItem('doska.session')!);
  expect((await call(a, 'GET', '/api/me', undefined, { token })).body.user.telegram).toBe(true);
  const s = (await call(a, 'GET', '/api/tutor/students', undefined, { token })).body[0];
  const path = '/api/tutor/lessons';
  const at = new Date();
  at.setHours(10, 0, 0, 0);
  const make = async (i: number) =>
    (await call(a, 'POST', path, { student_id: s.id, start_at: +at + i * 60000 }, { token })).body.id;
  for (const [i, st] of ['current', 'unpaid', 'paid', 'cancelled'].entries()) {
    const id = await make(i);
    await call(a, 'PATCH', path + '/' + id, { status: st }, { token });
  }
  const moved = await make(5);
  await call(a, 'POST', path + '/' + moved + '/reschedule', { start_at: +at + 7 * 60000 }, { token });
  const board = (await call(a, 'POST', '/api/tutor/students/' + s.id + '/board', {}, { token })).body.projectId;
  const view = (await call(a, 'GET', '/api/projects/' + board, undefined, { token })).body;
  view.project.pages[0].elements = [taskEl({ markedHard: true })];
  await call(a, 'PUT', '/api/projects/' + board, { project: view.project, expectedRev: view.rev }, { token });
  await page.reload();
  await button(page, 'Список').click();
  for (const st of ['scheduled', 'current', 'unpaid', 'paid', 'rescheduled', 'cancelled'])
    await expect(page.locator('.tu-lesson[data-status=' + st + ']')).toBeVisible();
  await button(page, 'Ученики').click();
  await page.locator('.tu-student').click();
  await button(page, 'Прогресс').click();
  await expect(page.locator('.tu-review')).toContainText('Сколько будет');
  await button(page, 'Добавить в следующий урок').click();
  await expect(page.locator('.tu-feedback')).toContainText('добавлено');
});

test('домен кабинета и основная доска используют общую сессию', async ({ page, context }) => {
  const a = await makeApp({ staticDir: resolve('dist'), secureCookies: true, cookieDomain: '.abaxboard.ru' });
  await skipOnboarding(context);
  await context.route(/^https:\/\/(?:tutor\.)?abaxboard\.ru\//, async (route) => {
    const u = new URL(route.request().url());
    const response = await route.fetch({ url: a.base + u.pathname + u.search, maxRedirects: 0 });
    await route.fulfill({ response });
  });
  await context.addInitScript(() => {
    if (location.hostname === 'abaxboard.ru') localStorage.setItem('doska.apiUrl', location.origin);
  });
  await page.goto('https://tutor.abaxboard.ru/');
  await expect(page.getByRole('heading', { name: 'Календарь' })).toBeVisible();
  const cookie = (await context.cookies()).find((c) => c.name === 'abax_session');
  expect(cookie?.domain).toBe('.abaxboard.ru');
  const tutorId = (await call(a, 'GET', '/api/me', undefined, { token: cookie!.value })).body.user.id;
  await page.goto('https://abaxboard.ru/');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('doska.session'))).toBeTruthy();
  const boardToken = await page.evaluate(() => localStorage.getItem('doska.session')!);
  expect((await call(a, 'GET', '/api/me', undefined, { token: boardToken })).body.user.id).toBe(tutorId);
});
