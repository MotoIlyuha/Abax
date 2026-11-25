import { expect, test } from './fixtures';
import { test as collaboration } from './host';

test('кнопка под меню и взаимоисключение панелей', async ({ board, page }) => {
  const button = page.locator('#btn-tasks');
  const menu = page.locator('#btn-home');
  const panel = page.locator('#side-panel');
  await expect(button).toBeVisible();
  const a = (await menu.boundingBox())!;
  const b = (await button.boundingBox())!;
  expect(Math.abs(a.x - b.x)).toBeLessThan(1);
  expect(b.y - (a.y + a.height)).toBeCloseTo(12, 0);
  expect(b.width).toBe(a.width);
  expect(b.height).toBe(a.height);
  const toolbarX = (await page.locator('#toolbar').boundingBox())!.x;
  await button.click();
  await expect(button).toHaveAttribute('aria-label', 'Свернуть панель');
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(panel.getByRole('button', { name: 'Предмет: Математика' })).toBeVisible();
  await expect.poll(async () => {
    const p = (await panel.boundingBox())!;
    const m = (await menu.boundingBox())!;
    const t = (await page.locator('#toolbar').boundingBox())!;
    return [Math.round(p.x), Math.round(m.x - a.x), Math.round(t.x - toolbarX)];
  }).toEqual([12, 372, 372]);
  await page.locator('#btn-notify').click();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect(panel.locator('#tasks-panel-body')).toBeHidden();
  await expect(panel.locator('.sp-mode')).toBeVisible();
  await button.click();
  await page.keyboard.press('Escape');
  await expect(button).toBeFocused();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  void board;
});

test.describe('узкий экран 390 × 844', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('панель закрывается касанием вне неё', async ({ page }) => {
    const button = page.locator('#btn-tasks');
    await button.tap();
    await expect(page.locator('#tasks-panel-body')).toBeVisible();
    await page.touchscreen.tap(10, 500);
    await expect(button).toHaveAttribute('aria-expanded', 'false');
  });
});

collaboration('у гостя нет кнопки заданий', async ({ host, join }) => {
  await host.page.locator('#btn-tasks').click();
  await host.page.getByRole('searchbox', { name: 'Поиск заданий' }).fill('#45B944');
  await host.page.getByRole('button', { name: '+ На доску' }).click();
  await host.page.locator('#btn-tasks').click();
  const guest = await join(await host.share(), 'Ученик');
  await expect(guest.page.locator('body')).toHaveClass(/collab-guest/);
  await expect(guest.page.locator('#btn-tasks')).toBeHidden();
  await expect.poll(async () => (await guest.board.elements()).find(el => el.type === 'task')).toMatchObject({
    type: 'task', title: 'ОГЭ № 19 · ФИПИ #45B944', answer: '',
  });
  const task = (await guest.board.elements()).find(el => el.type === 'task')!;
  expect(task.solutionMd).toBeUndefined();
});

test('верхняя панель помещается между открытой панелью и краем окна', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const button = page.locator('#btn-tasks');
  const notify = page.locator('#btn-notify');
  const menu = page.locator('#btn-home');
  const panel = page.locator('#side-panel');
  await button.click();
  const left = (await panel.boundingBox())!;
  const home = (await menu.boundingBox())!;
  const chat = (await notify.boundingBox())!;
  expect(home.x).toBeGreaterThanOrEqual(left.x + left.width);
  expect(chat.x + chat.width).toBeLessThanOrEqual(820);
  await expect(page.locator('.export-group')).toBeHidden();
  await notify.click();
  await expect(panel).not.toHaveClass(/sp-left/);
  const right = (await panel.boundingBox())!;
  const share = (await page.locator('#btn-share').boundingBox())!;
  expect(share.x + share.width).toBeLessThanOrEqual(right.x);
  await button.click();
  await expect(panel).toHaveClass(/sp-left/);
});

test('Поиск в строке номеров заданий', async ({ page }) => {
  await page.locator('#btn-tasks').click();
  const search = page.getByRole('searchbox', { name: 'Поиск заданий' });
  const reveal = page.getByRole('button', { name: 'Показать поле поиска' });
  const clear = page.getByRole('button', { name: 'Очистить ввод' });
  const numbers = page.getByRole('group', { name: 'Номер задания' });
  const strip = page.locator('.task-bank-strip');
  const cards = page.locator('.task-bank-card');
  await expect(search).toBeInViewport();
  const initialCount = await cards.count();
  await strip.hover();
  await page.mouse.wheel(0, 350);
  await expect.poll(() => search.evaluate(el =>
    el.getBoundingClientRect().right <= el.parentElement!.getBoundingClientRect().left)).toBe(true);
  await expect(reveal).toBeInViewport();
  await reveal.click();
  await expect(search).toBeInViewport();
  await expect(numbers).toBeVisible();
  await search.click();
  await expect(numbers).toHaveCount(0);
  await expect(clear).toBeVisible();
  await search.fill('#45B944');
  await expect(cards).toHaveCount(1);
  await clear.click();
  await expect(search).toHaveValue('');
  await expect(numbers).toBeVisible();
  await expect(clear).toBeHidden();
  await expect(cards).toHaveCount(initialCount);
});

test('банк: предметы, экзамены, номера, поиск и добавление на доску', async ({ board, page }) => {
  await page.locator('#btn-tasks').click();
  const subject = page.getByRole('button', { name: 'Предмет: Математика' });
  await expect(subject).toBeVisible();
  await subject.click();
  const subjects = page.getByRole('listbox', { name: 'Предмет: Математика' });
  await expect(subjects.getByRole('option', { name: 'Математика' })).toHaveAttribute('aria-selected', 'true');
  for (const name of ['Информатика', 'Физика', 'Русский']) {
    await expect(subjects.getByRole('option', { name: name + ' Скоро' })).toBeDisabled();
  }
  await subject.press('End');
  const active = await subject.getAttribute('aria-activedescendant');
  await expect(subjects.getByRole('option', { name: 'Математика' })).toHaveAttribute('id', active!);
  await subject.press('Escape');
  await expect(subject).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#side-panel')).toBeVisible();

  const exams = page.getByRole('tablist', { name: 'Тип экзамена' });
  await expect(exams.getByRole('tab', { name: 'ОГЭ' })).toHaveAttribute('aria-selected', 'true');
  const numbers = page.getByRole('group', { name: 'Номер задания' });
  const cards = page.locator('.task-bank-card');
  await exams.getByRole('tab', { name: 'ЕГЭ | База', exact: true }).click();
  await expect(numbers.getByRole('button', { name: '№ 21', exact: true })).toBeVisible();
  await expect(cards.filter({ hasText: 'ЕГЭ | Профиль' })).toHaveCount(0);
  for (const [exam, last, count] of [['ВПР', 17, 2], ['ЕГЭ | Профиль', 19, 2], ['ОГЭ', 25, 2]] as const) {
    await exams.getByRole('tab', { name: exam }).click();
    await expect(numbers.getByRole('button', { name: 'Все' })).toHaveAttribute('aria-pressed', 'true');
    const pill = numbers.getByRole('button', { name: '№ ' + last, exact: true });
    await pill.click();
    await expect(pill).toHaveAttribute('aria-pressed', 'true');
    await expect(cards).toHaveCount(count);
    await expect(cards.first()).toContainText(exam + ' · № ' + last);
  }

  await numbers.getByRole('button', { name: 'Все' }).click();
  const search = page.getByRole('searchbox', { name: 'Поиск заданий' });
  await search.focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('#btn-tasks')).toHaveAttribute('aria-expanded', 'true');
  await search.fill('#45b944');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('ФИПИ #45B944');
  const add = cards.first().getByRole('button', { name: '+ На доску' });
  await add.click();
  await add.click();
  const tasks = (await board.elements()).filter(el => el.type === 'task');
  expect(tasks).toHaveLength(2);
  expect(tasks[0]).toMatchObject({
    title: 'ОГЭ № 19 · ФИПИ #45B944', answer: '1', solutionVisibleToStudent: false,
  });
  expect(tasks[0].solutionMd).toBeTruthy();
  expect(tasks[1].x).toBeGreaterThan(tasks[0].x);
  expect(tasks[1].y).toBeGreaterThan(tasks[0].y);
  await expect(page.locator('#task-overlay .task-input')).toHaveCount(2);
});

test('кнопка заданий скрыта в демонстрации и по ссылкам просмотра', async ({ board, page }) => {
  const [present] = await Promise.all([page.waitForEvent('popup'), page.locator('#btn-present').dispatchEvent('click')]);
  await expect(present.locator('canvas')).toBeVisible();
  await expect(present.locator('#btn-tasks')).toHaveCount(0);
  await present.close();
  const state = await board.state();
  const project = encodeURIComponent(state.project.id);
  const pageId = encodeURIComponent(state.pageId);
  for (const [mode, url] of [
    ['view-project', '/?route=project&projectId=' + project],
    ['view-page', '/?route=page&projectId=' + project + '&pageId=' + pageId],
  ] as const) {
    await page.goto(url);
    await expect.poll(() => page.evaluate(() => (window as any).__doska?.state.linkMode)).toBe(mode);
    await expect(page.locator('#btn-tasks')).toBeHidden();
  }
});
