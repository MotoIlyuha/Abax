// Ночь №2: просмотр по ссылке, клонирование, патчи, задания, реакции и лимиты тарифов.
import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';

const snap = (page: Page) => page.evaluate(() => {
  const s = (window as any).__doska.state;
  return { linkMode: s.linkMode as string | null, pageId: s.pageId as string, projectId: s.project.id as string, pages: s.project.pages.length as number };
});

/** Открыть доску по ссылке просмотра: панели инструментов там нет, поэтому ждём только состояние. */
async function openLink(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForFunction(() => !!(window as any).__doska);
  await expect(page.locator('#link-banner')).toBeVisible();
}

test.describe('просмотр по ссылке', () => {
  test('ссылка на объекты наводит камеру и подсвечивает их', async ({ board, page }) => {
    await board.open();
    const el = await board.rect(400, 300, 500, 400);
    await board.saved();
    const s = await board.state();
    await openLink(page, `/?route=page&projectId=${s.project.id}&pageId=${s.pageId}&focus=${el.id}`);
    await expect.poll(async () => (await page.evaluate(() => (window as any).__doska.state.flashes.length))).toBe(1);
    const cam = await page.evaluate(() => (window as any).__doska.state.camera);
    expect(cam.zoom).toBeGreaterThan(2);
    // объект в центре окна
    const cx = cam.x + 1440 / (2 * cam.zoom);
    expect(Math.abs(cx - 450)).toBeLessThan(60);
  });

  test('просмотр проекта: правка запрещена, клонирование доступно, док страниц виден', async ({ board, page }) => {
    await board.open();
    await board.rect(400, 300, 500, 400);
    await board.saved();
    const s = await board.state();
    await openLink(page, `/?route=project&projectId=${s.project.id}`);
    expect((await snap(page)).linkMode).toBe('view-project');
    await expect(page.locator('#toolbar')).toBeHidden();
    await expect(page.locator('#btn-home')).toBeHidden();
    await expect(page.locator('#btn-pages')).toBeVisible();
    await expect(page.locator('#link-banner .lb-clone')).toBeVisible();

    // рисование, удаление и отмена ничего не меняют
    await board.drag([{ x: 600, y: 300 }, { x: 800, y: 400 }]);
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Delete');
    await page.keyboard.press('Control+z');
    expect(await board.count()).toBe(1);
    await page.waitForTimeout(800);
    // в хранилище осталась та же доска
    const stored = await page.evaluate((id) => JSON.parse(localStorage.getItem(`doska.p.${id}`)!).pages[0].elements.length, s.project.id);
    expect(stored).toBe(1);
  });

  test('ссылка на страницу: нет дока страниц и кнопки клонирования', async ({ board, page }) => {
    await board.open();
    await board.rect(400, 300, 500, 400);
    await board.saved();
    const s = await board.state();
    await openLink(page, `/?route=page&projectId=${s.project.id}&pageId=${s.pageId}`);
    expect((await snap(page)).linkMode).toBe('view-page');
    await expect(page.locator('#btn-pages')).toBeHidden();
    await expect(page.locator('#link-banner .lb-clone')).toHaveCount(0);
  });

  test('нет проекта на устройстве — плашка и пустая доска', async ({ page }) => {
    await openLink(page, '/?route=project&projectId=net-takogo');
    await expect(page.locator('#link-banner')).toContainText('Проект недоступен на этом устройстве');
    await expect(page.locator('#link-banner .lb-clone')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__doska.state.board.elements.length)).toBe(0);
  });

  test('«Клонировать проект» сохраняет копию, возвращает инструменты и чистит адрес', async ({ board, page }) => {
    await board.open();
    await board.rect(400, 300, 500, 400);
    await board.saved();
    const s = await board.state();
    await openLink(page, `/?route=project&projectId=${s.project.id}`);
    await page.locator('#link-banner .lb-clone').click();
    await expect(page.locator('#toolbar')).toBeVisible();
    await expect(page.locator('#link-banner')).toBeHidden();
    const after = await snap(page);
    expect(after.linkMode).toBeNull();
    expect(after.projectId).not.toBe(s.project.id);
    expect(page.url()).not.toContain('route=');
    expect(await board.count('shape')).toBe(1);
    await board.saved();
    const names = await page.evaluate(() => (window as any).__doska.state.projects.map((m: any) => m.name));
    expect(names).toContain('Проект 1 (копия)');
    // теперь это обычная доска: рисовать можно
    await board.rect(600, 300, 700, 400);
    expect(await board.count('shape')).toBe(2);
  });

  test('меню экспорта копирует ссылки; ссылка на объекты — из меню выделения', async ({ board, page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await board.open();
    const el = await board.rect(400, 300, 500, 400);
    await board.tool('v');
    await board.click({ x: 400, y: 350 });
    await expect(board.quickMenu.locator('.qm-link')).toBeVisible();
    await board.quickMenu.locator('.qm-link').click();
    const focusLink = await page.evaluate(() => navigator.clipboard.readText());
    expect(focusLink).toContain('route=page');
    expect(focusLink).toContain(`focus=${el.id}`);

    await page.locator('#btn-export').click();
    await page.locator('#export-menu [data-action="link-project"]').click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('route=project');
  });
});

/** Автор в браузере: комната во вкладке (кнопка «Поделиться»), гости — из соседних вкладок по `?room=local:КОД`. */
async function startBrowserRoom(page: Page, code: string): Promise<void> {
  await page.locator('#btn-share').click();
  await page.locator('#share-dialog button', { hasText: 'Включить совместную работу' }).click();
  await expect(page.locator('#share-dialog button', { hasText: 'Выключить совместную работу' })).toBeVisible();
  await page.evaluate((c) => (window as any).__doska.startLocalRoom(c), code);
}

async function joinLocal(context: import('@playwright/test').BrowserContext, code: string, name: string): Promise<Page> {
  const guest = await context.newPage();
  await guest.goto(`/?room=local:${code}&name=${encodeURIComponent(name)}`);
  await guest.waitForFunction(() => !!(window as any).__doska);
  return guest;
}

test.describe('браузерный хост и патчи', () => {
  test('гость из соседней вкладки видит правки автора, а с правом edit — рисует сам; всё идёт патчами', async ({ board, page, context }) => {
    await board.open();
    await board.rect(400, 300, 500, 400);
    await startBrowserRoom(page, 'abc1');
    const guest = await joinLocal(context, 'abc1', 'Маша');
    await expect(guest.locator('body')).toHaveClass(/collab-guest/);
    await expect.poll(() => guest.evaluate(() => (window as any).__doska.state.board.elements.length)).toBe(1);

    // новая фигура автора доходит патчем: у гостя не открывается проект заново (камера и отмена целы)
    await guest.evaluate(() => { (window as any).__guestProject = (window as any).__doska.state.project; });
    await board.rect(600, 300, 700, 400);
    await expect.poll(() => guest.evaluate(() => (window as any).__doska.state.board.elements.length)).toBe(2);
    expect(await guest.evaluate(() => (window as any).__doska.state.project === (window as any).__guestProject)).toBe(true);

    // автор открывает гостю правку страницы
    await expect(page.locator('#share-dialog .share-user')).toHaveCount(1);
    await page.locator('#share-dialog .share-user select').first().selectOption('edit');
    await expect.poll(() => guest.evaluate(() => document.body.classList.contains('readonly-mode'))).toBe(false);
    const gb = new (board.constructor as any)(guest);
    await gb.rect(300, 500, 380, 560);
    await expect.poll(() => board.count('shape')).toBe(3);
    await guest.close();
  });

  test('на бесплатном тарифе второй гость получает отказ', async ({ board, page, context }) => {
    await page.addInitScript(() => localStorage.setItem('doska.enforceLimits', '1'));
    await board.open();
    await startBrowserRoom(page, 'free1');
    const first = await joinLocal(context, 'free1', 'Первый');
    await expect(first.locator('body')).toHaveClass(/collab-guest/);
    await expect.poll(() => first.evaluate(() => (window as any).__doska.state.project.pages.length)).toBeGreaterThan(0);
    const second = await joinLocal(context, 'free1', 'Второй');
    await expect(second.locator('#collab-notice')).toContainText('Бесплатная комната занята');
    await first.close();
    await second.close();
  });
});

/** Задание через форму из меню логотипа. */
async function addTask(page: Page, v: { statement: string; answer: string; unit?: string; solution?: string; code?: string; subject?: string }): Promise<void> {
  await page.locator('#btn-home').click();
  await page.locator('#main-menu [data-action="task"]').click();
  const dlg = page.locator('#task-dialog');
  await expect(dlg).toBeVisible();
  const f = (label: string) => dlg.locator('.td-field', { has: page.locator('.td-label', { hasText: new RegExp(`^${label}$`) }) }).locator('input, textarea, select');
  if (v.subject) await f('Предмет').selectOption(v.subject);
  await f('Условие').fill(v.statement);
  await f('Правильный ответ').fill(v.answer);
  if (v.unit) await f('Единицы измерения').fill(v.unit);
  if (v.code) await f('Код').fill(v.code);
  if (v.solution) await f('Решение').fill(v.solution);
  await dlg.locator('.td-save').click();
  await expect(dlg).toBeHidden();
}

test.describe('задания', () => {
  test('автор добавляет задание формой; ответ проверяется, результат и решение видны', async ({ board, page }) => {
    await board.open();
    await addTask(page, { statement: 'Скорость 5 м за 1 с. Найдите v.', answer: '5', unit: 'м/с', solution: 'v = s/t', subject: 'physics' });
    expect(await board.count('task')).toBe(1);
    const panel = page.locator('.task-panel');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.task-unit')).toHaveText('м/с');
    await panel.locator('.task-input').fill('4');
    await panel.locator('.task-input').press('Enter');
    await expect(panel.locator('.task-result')).toHaveText('Неверно (попыток: 1)');
    await panel.locator('.task-input').fill('5 м/с');
    await panel.locator('.task-check').click();
    await expect(panel.locator('.task-result')).toHaveText('Верно!');
    // решение у автора — по кнопке
    await panel.locator('.task-more').click();
    await expect(panel.locator('.task-solution')).toHaveCount(0);
    await panel.locator('.task-peek').click();
    await expect(panel.locator('.task-solution-text')).toHaveText('v = s/t');
    await panel.locator('.task-hard').click();
    expect((await board.elements())[0].markedHard).toBe(true);
    // ввод карточки не мешает отмене: Ctrl+Z убирает «Сложное», а не ответы
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Control+z');
    const el = (await board.elements())[0];
    expect(el.markedHard).toBeUndefined();
    expect(el.attempts).toHaveLength(2);
  });

  test('кнопка «Задание» на панели открывает форму и не остаётся инструментом', async ({ board, page }) => {
    await board.open();
    await page.locator('#toolbar [data-tool="task"]').click();
    await expect(page.locator('#task-dialog')).toBeVisible();
    await page.locator('#task-dialog .td-actions button', { hasText: 'Отмена' }).click();
    expect((await board.state()).tool).not.toBe('task');
    expect(await board.count('task')).toBe(0);
  });

  test('двойной клик открывает правку; условие меняется, ввод остаётся, шаг — в историю', async ({ board, page }) => {
    await board.open();
    await addTask(page, { statement: 'Старое условие', answer: '1' });
    await page.locator('.task-input').fill('2');
    await page.locator('.task-input').press('Enter');
    const el = (await board.elements())[0];
    await board.tool('v');
    await board.dblclick({ x: el.x + 180, y: el.y + 60 });
    const dlg = page.locator('#task-dialog');
    await expect(dlg).toBeVisible();
    await dlg.locator('.td-field', { has: page.locator('.td-label', { hasText: /^Условие$/ }) }).locator('textarea').fill('Новое условие');
    await dlg.locator('.td-save').click();
    const after = (await board.elements())[0];
    expect(after.statementMd).toBe('Новое условие');
    expect(after.attempts).toHaveLength(1);
    expect(after.x).toBe(el.x);
    await page.keyboard.press('Control+z');
    expect((await board.elements())[0].statementMd).toBe('Старое условие');
  });

  test('учитель в комнате и ученик: ответ скрыт, ввод виден вживую, проверяет хаб', async ({ board, page, context }) => {
    await board.open();
    await addTask(page, { statement: 'Сколько будет 2 + 3?', answer: '5', solution: 'Сложить', code: 'print(2 + 3)', subject: 'informatics' });
    await startBrowserRoom(page, 'task1');
    const student = await joinLocal(context, 'task1', 'Маша');
    await expect.poll(() => student.evaluate(() => (window as any).__doska.state.board.elements.length)).toBe(1);
    // ученик не получил ответ и решение
    const mine = await student.evaluate(() => { const e = (window as any).__doska.state.board.elements[0]; return { answer: e.answer, solutionMd: e.solutionMd }; });
    expect(mine).toEqual({ answer: '', solutionMd: undefined });
    const sp = student.locator('.task-panel');
    await expect(sp).toBeVisible();
    await expect(sp.locator('.task-code-body')).toHaveText('print(2 + 3)');
    await expect(sp.locator('.task-actions')).toHaveCount(0);

    // у учителя виден ввод ученика вживую
    const tp = page.locator('.task-panel');
    // у задания с кодом панель под карточкой раскрыта сразу
    await sp.locator('.task-input').pressSequentially('4');
    await expect(tp.locator('.task-live-value')).toHaveText('4');
    await sp.locator('.task-input').press('Enter');
    await expect(sp.locator('.task-result')).toHaveText('Неверно (попыток: 1)');
    await sp.locator('.task-input').fill('5');
    await sp.locator('.task-check').click();
    await expect(sp.locator('.task-result')).toHaveText('Верно!');
    await expect(tp.locator('.task-attempts li')).toHaveCount(2);
    await expect(tp.locator('.task-live-value')).toHaveText('—');
    expect((await board.elements())[0].attempts.map((a: any) => a.isCorrect)).toEqual([false, true]);
    // ответ так и не дошёл до ученика
    expect(await student.evaluate(() => (window as any).__doska.state.board.elements[0].answer)).toBe('');

    // автор открывает решение — ученик его видит
    await tp.locator('.task-solution-toggle').click();
    await expect(sp.locator('.task-solution-text')).toHaveText('Сложить');
    await student.close();
  });
});
