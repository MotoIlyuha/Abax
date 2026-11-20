// Ночь №2: просмотр по ссылке, клонирование, патчи, задания, реакции и лимиты тарифов.
import { expect, pickOption, test } from './fixtures';
import type { Page } from '@playwright/test';
import { createRequire } from 'node:module';

const { createRelay } = createRequire(__filename)('../relay/server.cjs');

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
    await pickOption(page, page.locator('#share-dialog .share-user .share-user-right').first(), 'edit');
    await expect.poll(() => guest.evaluate(() => document.body.classList.contains('readonly-mode'))).toBe(false);
    const gb = new (board.constructor as any)(guest);
    await gb.rect(300, 500, 380, 560);
    await expect.poll(() => board.count('shape')).toBe(3);
    await guest.close();
  });

  test('указка автора — лазер, исчезающий маркер и подсветка — видна гостю', async ({ board, page, context }) => {
    await board.open();
    await board.rect(400, 300, 500, 400);
    await startBrowserRoom(page, 'ptr1');
    const guest = await joinLocal(context, 'ptr1', 'Маша');
    await expect.poll(() => guest.evaluate(() => (window as any).__doska.state.board.elements.length)).toBe(1);
    const seen = () => guest.evaluate(() => {
      const s = (window as any).__doska.state;
      return { lasers: s.remoteLasers.size as number, fades: s.fadeStrokes.length as number, flashes: s.flashes.length as number };
    });

    // лазер: цвет и след доходят, только пока кнопка зажата
    await board.groupTool('pointer', 'laser');
    await board.move({ x: 300, y: 300 });
    await board.move({ x: 700, y: 500 }, 10);
    expect((await seen()).lasers).toBe(0);
    await board.drag([{ x: 300, y: 300 }, { x: 700, y: 500 }], { steps: 10 });
    await expect.poll(async () => (await seen()).lasers).toBe(1);

    await board.groupTool('pointer', 'fadePen');
    await board.drag([{ x: 300, y: 600 }, { x: 700, y: 650 }]);
    await expect.poll(async () => (await seen()).fades).toBeGreaterThan(0);

    await board.groupTool('pointer', 'flash');
    await board.click({ x: 450, y: 350 });
    await expect.poll(async () => (await seen()).flashes).toBe(1);
    // доска гостя от указки не меняется
    expect(await guest.evaluate(() => (window as any).__doska.state.board.elements.length)).toBe(1);
    await guest.close();
  });

  test('через интернет из браузера: без адреса — «Не указан», после ввода — ссылка, гость видит доску', async ({ board, page, browser }) => {
    const relay = await createRelay({ port: 0, host: '127.0.0.1', statsIntervalMs: 0, log: () => {} });
    try {
      await board.open();
      await board.rect(400, 300, 500, 400);
      await startBrowserRoom(page, 'cloud1');
      const dlg = page.locator('#share-dialog');
      await dlg.locator('button', { hasText: 'Пригласить через интернет' }).click();
      await expect(dlg.locator('.share-cloud-error')).toHaveText('Не указан адрес ретранслятора');
      const input = dlg.locator('.share-relay-input');
      await expect(input).toBeVisible();

      const relayUrl = `ws://127.0.0.1:${relay.port}`;
      await input.fill(relayUrl);
      await input.press('Enter');
      const link = dlg.locator('.share-link-cloud');
      await expect(link).toHaveText(/#relay=/);
      expect(await page.evaluate(() => localStorage.getItem('doska.relayUrl'))).toBe(relayUrl);

      const ctx = await browser.newContext();
      const guest = await ctx.newPage();
      await guest.goto(`${await link.innerText()}&name=${encodeURIComponent('Из облака')}`);
      await expect(guest.locator('body')).toHaveClass(/collab-guest/);
      await expect.poll(() => guest.evaluate(() => (window as any).__doska?.state.board.elements.length ?? 0)).toBe(1);
      await ctx.close();
    } finally {
      await relay.close();
    }
  });

  test('на бесплатном тарифе второй гость получает отказ', async ({ board, page, context }) => {
    await page.addInitScript(() => localStorage.setItem('doska.enforceLimits', '1'));
    await board.open();
    await startBrowserRoom(page, 'free1');
    const first = await joinLocal(context, 'free1', 'Первый');
    await expect(first.locator('body')).toHaveClass(/collab-guest/);
    await expect.poll(() => first.evaluate(() => (window as any).__doska.state.project.pages.length)).toBeGreaterThan(0);
    const second = await joinLocal(context, 'free1', 'Второй');
    // Ночь №5 (SPEC_NIGHT5 §7): вместо уведомления — окно «Комната заполнена» с пояснением про тариф автора
    const full = second.locator('#room-full-modal');
    await expect(full).toBeVisible();
    await expect(full.locator('h2')).toHaveText('В комнате сейчас максимум участников (1 из 1)');
    await expect(full).toContainText('Это лимит бесплатного тарифа автора доски');
    // без облака (комната браузера) просмотра «только для чтения» нет
    await expect(full.locator('.room-full-readonly')).toHaveCount(0);
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

test.describe('реакции и комментарии', () => {
  /** Поставить реакцию выделенному объекту из ленты недавних у кнопки «Поставить реакцию». */
  async function reactRecent(page: Page, emoji: string): Promise<void> {
    const row = page.locator('#annot-layer .an-row.selected');
    await row.locator('.an-react').hover();
    await row.locator('.an-recent-btn', { hasText: emoji }).click();
    // лента недавних после выбора уезжает обратно и не закрывает пилюли
    await expect(row.locator('.an-recent')).toHaveCSS('pointer-events', 'none');
  }

  test('реакция кнопкой под выделенным: пилюля справа под фигурой, × снимает, Undo её не трогает', async ({ board, page }) => {
    await board.open();
    const a = await board.rect(400, 300, 500, 400);
    await board.tool('v');
    await board.click({ x: 450, y: 350 });
    // в быстром меню реакций и «Комментировать» больше нет — они под объектом
    await expect(board.quickMenu.locator('.qm-react, .qm-comment')).toHaveCount(0);
    const row = page.locator(`#annot-layer .an-row[data-el="${a.id}"]`);
    await expect(row.locator('.an-react')).toBeVisible();
    await expect(row.locator('.an-comment')).toBeVisible();
    await reactRecent(page, '👍');
    const reacted = async () => (await board.elements()).find(e => e.id === a.id)!.reactions;
    await expect.poll(reacted).toEqual({ '👍': [expect.any(String)] });
    // пилюля — в строке под правым нижним углом, слева от кнопок; × при наведении снимает реакцию
    const pill = row.locator('.an-pill.mine');
    await expect(pill).toHaveText(/👍\s*1/);
    const pb = (await pill.boundingBox())!;
    const cb = (await board.canvas.boundingBox())!;
    expect(pb.y - cb.y).toBeGreaterThan(400);
    await pill.hover();
    await pill.locator('.an-x').click();
    await expect.poll(reacted).toBeUndefined();

    await reactRecent(page, '🔥');
    await reactRecent(page, '👍'); // можно несколько разных
    await expect.poll(reacted).toEqual({ '🔥': [expect.any(String)], '👍': [expect.any(String)] });
    // новая фигура, затем Ctrl+Z: фигура пропала, реакции остались
    await board.rect(600, 300, 700, 400);
    expect(await board.count('shape')).toBe(2);
    await page.keyboard.press('Control+z');
    expect(await board.count('shape')).toBe(1);
    expect(Object.keys((await reacted())!)).toEqual(['🔥', '👍']);
  });

  test('обсуждение объекта: панель как чат, ответ, «Решено», счётчик у невыделенного, едет за фигурой', async ({ board, page }) => {
    await board.open();
    const a = await board.rect(400, 300, 500, 400);
    await board.tool('v');
    await board.click({ x: 450, y: 350 });
    const row = page.locator(`#annot-layer .an-row[data-el="${a.id}"]`);
    await row.locator('.an-comment').click();
    const pop = page.locator('.comment-pop');
    await expect(pop).toBeVisible();
    await expect(pop.locator('.cp-title')).toHaveText('Новый комментарий');
    const input = pop.locator('.composer-input');
    await input.fill('Проверьте построение');
    await input.press('Enter');
    const comments = () => page.evaluate(() => (window as any).__doska.state.board.comments);
    await expect.poll(async () => (await comments())?.length).toBe(1);
    const thread = (await comments())[0];
    expect(thread).toMatchObject({ x: 500, y: 300, targetElementId: a.id });
    expect(thread.messages[0].text).toBe('Проверьте построение');
    // панель остаётся: сообщение справа, заголовок со счётчиком
    await expect(pop.locator('.cp-title')).toHaveText('Комментарии · 1');
    await expect(pop.locator('.cp-msg.mine .cp-text')).toHaveText('Проверьте построение');
    await input.fill('Исправил');
    await input.press('Enter');
    await expect(pop.locator('.cp-msg')).toHaveCount(2);
    await pop.locator('.cp-resolve').click();
    await expect.poll(async () => (await comments())[0].resolved).toBe(true);
    await expect(pop.locator('.cp-banner')).toContainText('Обсуждение решено');
    await page.keyboard.press('Escape');
    await expect(pop).toBeHidden();
    // снято выделение — на месте кнопки только счётчик; щелчок по нему открывает обсуждение
    await board.click({ x: 800, y: 600 });
    const counter = row.locator('.an-comment.an-counter');
    await expect(counter).toHaveText('2');
    await expect(row.locator('.an-react')).toHaveCount(0);
    await counter.click();
    await expect(pop).toBeVisible();
    await page.keyboard.press('Escape');
    // обсуждение едет за фигурой
    await board.tool('v');
    await board.drag([{ x: 450, y: 350 }, { x: 550, y: 450 }]);
    await expect.poll(async () => (await comments())[0].x).toBe(600);
  });

  test('участник в комнате: реакция цвета своей плашки, комментарий; автору — пуши «Перейти» и «Посмотреть»', async ({ board, page, context }) => {
    await board.open();
    const a = await board.rect(400, 300, 500, 400);
    await startBrowserRoom(page, 'react1');
    const guest = await joinLocal(context, 'react1', 'Маша');
    const gb = new (board.constructor as any)(guest);
    await expect.poll(() => guest.evaluate(() => (window as any).__doska.state.board.elements.length)).toBe(1);
    await expect.poll(() => guest.evaluate(() => (window as any).__doska.state.tool)).toBe('select');
    await gb.click({ x: 450, y: 350 });
    await expect.poll(async () => (await gb.state()).selection).toEqual([a.id]);
    await reactRecent(guest, '❤️');
    await expect.poll(async () => (await board.elements())[0].reactions?.['❤️']?.length).toBe(1);
    // у автора — пилюля цвета плашки Маши (хаб сообщил её noteId) и пуш о реакции
    const pill = page.locator(`#annot-layer .an-row[data-el="${a.id}"] .an-pill`);
    await expect(pill).toHaveAttribute('title', /^Маша\./);
    const card = page.locator('#notify-stack .ns-card', { hasText: 'реакция ❤️' });
    await expect(card).toBeVisible();
    await expect(card.locator('.ns-action')).toHaveText(['Перейти', 'Посмотреть']);
    // читатель двигать и стирать не может
    await gb.drag([{ x: 450, y: 350 }, { x: 600, y: 500 }]);
    await guest.keyboard.press('Delete');
    expect((await board.elements())[0].x).toBe(a.x);
    expect(await gb.count()).toBe(1);
    // комментарий участника — автору пуш; «Посмотреть» открывает ЧКУ на вкладке «Комментарии»
    await guest.locator(`#annot-layer .an-row[data-el="${a.id}"] .an-comment`).click();
    const input = guest.locator('.comment-pop .composer-input');
    await input.fill('Не понял шаг');
    await input.press('Enter');
    await expect.poll(() => page.evaluate(() => (window as any).__doska.state.board.comments?.[0]?.messages[0]?.authorName)).toBe('Маша');
    const push = page.locator('#notify-stack .ns-card', { hasText: 'Не понял шаг' });
    await expect(push).toBeVisible();
    await push.hover();
    await push.locator('.ns-action', { hasText: 'Посмотреть' }).click();
    await expect(page.locator('#side-panel')).toBeVisible();
    await expect(page.locator('#np-tab-comments')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#side-panel .sp-mode')).toContainText('Комментарии');
    await expect(page.locator('#side-panel .cm-card .cm-text')).toHaveText('Не понял шаг');
    await guest.close();
  });

  test('автор запретил копирование: читатель не выделяет, но щелчком по реакции привлекает внимание', async ({ board, page, context }) => {
    await board.open();
    const a = await board.rect(400, 300, 500, 400);
    await board.tool('v');
    await board.click({ x: 450, y: 350 });
    await reactRecent(page, '👍');
    await board.click({ x: 800, y: 600 });
    // Pro-проект с запретом копирования
    await page.evaluate(() => { const s = (window as any).__doska.state; s.project.ownerPlan = 'pro'; s.project.permissions = { allowCopy: false }; });
    await startBrowserRoom(page, 'react2');
    const guest = await joinLocal(context, 'react2', 'Маша');
    const gb = new (board.constructor as any)(guest);
    await expect.poll(() => guest.evaluate(() => (window as any).__doska.state.board.elements[0]?.reactions?.['👍']?.length)).toBe(1);
    await expect.poll(() => guest.evaluate(() => (window as any).__doska.state.tool)).toBe('pan');
    await gb.tool('v');
    await gb.click({ x: 450, y: 350 });
    expect((await gb.state()).selection).toEqual([]);
    // щелчок по пилюле — «Привлечь внимание»: частицы у Маши, у автора — частицы и пуш; реакции не меняются
    await guest.locator(`#annot-layer .an-row[data-el="${a.id}"] .an-pill`).click();
    await expect(guest.locator('#burst-layer .burst-p').first()).toBeAttached();
    await expect(page.locator('#notify-stack .ns-card', { hasText: 'привлекает внимание' })).toBeVisible();
    await expect(page.locator('#notify-stack .ns-card .ns-action', { hasText: 'Перейти' })).toBeVisible();
    expect((await board.elements())[0].reactions['👍']).toHaveLength(1);
    await guest.close();
  });
});

test.describe('лимиты тарифов', () => {
  const enforce = (page: Page, plan?: string) => page.addInitScript((p) => {
    localStorage.setItem('doska.enforceLimits', '1');
    // выбор тарифа вручную — только в режиме разработки: в релизе тариф приходит с сервера
    localStorage.setItem('doska.devMode', '1');
    if (p) localStorage.setItem('doska.plan', p);
  }, plan);

  test('четвёртая страница не создаётся: уведомление, страниц по-прежнему три; черновики можно', async ({ board, page }) => {
    await enforce(page);
    await board.open();
    await board.addPage();
    await board.addPage();
    expect((await board.state()).project.pages).toHaveLength(3);
    await page.locator('#pages-list .page-add').click();
    await expect(page.locator('#toast')).toHaveText('На бесплатном тарифе доступно до 3 страниц в проекте');
    expect((await board.state()).project.pages).toHaveLength(3);
    // черновик (Alt + клик по плитке) в лимит не входит
    await page.keyboard.down('Alt');
    await page.locator('#pages-list .page-add').click();
    await page.keyboard.up('Alt');
    await expect.poll(() => page.evaluate(() => (window as any).__doska.state.drafts.length)).toBe(1);
    expect((await board.state()).project.pages).toHaveLength(3);
  });

  test('на Pro страниц сколько угодно', async ({ board, page }) => {
    await enforce(page, 'pro');
    await board.open();
    await page.evaluate(() => { (window as any).__doska.state.project.ownerPlan = 'pro'; });
    for (let i = 0; i < 4; i++) await board.addPage();
    expect((await board.state()).project.pages).toHaveLength(5);
  });

  test('четвёртый проект не создаётся: уведомление', async ({ board, page }) => {
    await enforce(page);
    await board.open();
    for (let i = 0; i < 2; i++) {
      await board.home();
      await page.locator('#home .new-project').click();
      await expect.poll(async () => (await board.state()).projects.length).toBe(i + 2);
    }
    await board.home();
    await page.locator('#home .new-project').click();
    await expect(page.locator('#toast')).toHaveText('На бесплатном тарифе доступно до 3 проектов');
    expect((await board.state()).projects).toHaveLength(3);
  });

  test('клонирование по ссылке тоже упирается в лимит проектов', async ({ board, page }) => {
    await board.open();
    await board.rect(400, 300, 500, 400);
    await board.saved();
    const s = await board.state();
    await page.addInitScript(() => localStorage.setItem('doska.enforceLimits', '1'));
    // ещё два проекта — вместе с первым три
    await page.evaluate(() => {
      const now = Date.now();
      for (const i of [1, 2]) {
        const p = { id: `extra${i}`, name: `Доп ${i}`, createdAt: now, updatedAt: now, pages: [{ id: `pg${i}`, name: 'С', grid: 'square', elements: [] }] };
        localStorage.setItem(`doska.p.extra${i}`, JSON.stringify(p));
      }
      const idx = JSON.parse(localStorage.getItem('doska.projects') || '[]');
      for (const i of [1, 2]) idx.push({ id: `extra${i}`, name: `Доп ${i}`, createdAt: now, updatedAt: now, pageCount: 1 });
      localStorage.setItem('doska.projects', JSON.stringify(idx));
    });
    await openLink(page, `/?route=project&projectId=${s.project.id}`);
    await page.locator('#link-banner .lb-clone').click();
    await expect(page.locator('#toast')).toHaveText('На бесплатном тарифе доступно до 3 проектов');
    expect((await snap(page)).linkMode).toBe('view-project');
  });

  test('переключатель лимитов и тарифа есть в «Экспериментальных»', async ({ board, page }) => {
    await board.open();
    await page.evaluate(() => { localStorage.setItem('doska.experiments', '1'); localStorage.setItem('doska.devMode', '1'); });
    await page.keyboard.press('Control+Comma');
    const nav = page.locator('.sd-nav-item[data-section="experimental"]');
    await nav.click();
    const box = page.locator('.sd-experimental');
    await expect(box.locator('.ctx-check', { hasText: 'Действуют лимиты тарифа' })).toBeVisible();
    await box.locator('.ctx-check', { hasText: 'Действуют лимиты тарифа' }).locator('input').check();
    await box.locator('.sd-exp-plan-select').selectOption('pro');
    expect(await page.evaluate(() => [localStorage.getItem('doska.enforceLimits'), localStorage.getItem('doska.plan')])).toEqual(['1', 'pro']);
  });
});
