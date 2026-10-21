// Совместная работа целиком: автор и гости в разных браузерах, сервер — настоящий electron/share.cjs.
import { expect, MAX_EDITORS, test, type Guest } from './host';

async function guestProjectName(g: Guest): Promise<string> {
  return g.page.evaluate(() => (window as any).__doska.state.project.name);
}

test.describe('совместная работа', () => {
  test('гость по ссылке видит доску автора, но без прав не может её менять', async ({ host, join }) => {
    await host.board.rect(400, 300, 500, 400);
    const url = await host.share();
    await expect(host.dialog.locator('.ctx-label')).toHaveText('Откройте ссылку на другом устройстве или в тестовом окне');

    const guest = await join(url, 'Ученик');
    await expect.poll(() => guestProjectName(guest)).toBe('Проект 1');
    expect(await guest.board.count('shape')).toBe(1);
    await expect(guest.page.locator('body')).toHaveClass(/collab-guest/);
    await expect(guest.page.locator('body')).toHaveClass(/readonly-mode/);
    await expect(guest.page.locator('#toolbar')).toBeHidden();
    for (const id of ['btn-home', 'btn-import', 'btn-image', 'btn-share']) {
      await expect(guest.page.locator(`#${id}`)).toBeHidden();
    }
    // страницы гость листает, но не добавляет и не удаляет
    await expect(guest.page.locator('#btn-pages')).toHaveText('Страницы 1');
    await guest.page.locator('#btn-pages').click();
    await expect(guest.page.locator('#pages-tray')).toBeVisible();
    await expect(guest.page.locator('#pages-list .page-item')).toHaveCount(1);
    await expect(guest.page.locator('#pages-list .page-add')).toHaveCount(0);
    await guest.page.locator('#pages-list .page-item').hover();
    await expect(guest.page.locator('#pages-list .page-del')).toBeHidden();

    // попытка рисовать без права edit ничего не меняет ни у гостя, ни у автора
    await guest.board.drag([{ x: 300, y: 300 }, { x: 600, y: 400 }]);
    await guest.page.keyboard.press('Delete');
    expect(await guest.board.count()).toBe(1);
    expect(host.server!.room.project.pages[0].elements).toHaveLength(1);

    // автор видит участника в диалоге (список обновляется сам)
    await expect(host.userRow('Ученик')).toBeVisible({ timeout: 5000 });
    await expect(host.dialog.locator('.ctx-label').first()).toHaveText('Участники (1) — права по страницам:');
    await expect(host.userRow('Ученик').locator('select')).toHaveValue('view');
  });

  test('автор выдаёт право правки — гость рисует, автор видит', async ({ host, join }) => {
    const url = await host.share();
    const guest = await join(url, 'Ученик');
    await expect(host.userRow('Ученик')).toBeVisible({ timeout: 5000 });
    await host.setRight('Ученик', 0, 'edit');
    await expect(guest.page.locator('body')).not.toHaveClass(/readonly-mode/);
    await expect(guest.page.locator('#toolbar')).toBeVisible();

    await guest.board.drag([{ x: 300, y: 300 }, { x: 500, y: 350 }, { x: 600, y: 300 }]);
    expect(await guest.board.count('stroke')).toBe(1);
    await expect.poll(() => host.board.count('stroke'), { timeout: 5000 }).toBe(1);
    const [hs] = await host.board.elements();
    const [gs] = await guest.board.elements();
    expect(hs.id).toBe(gs.id);

    // отмена у гостя тоже доходит до автора
    await guest.page.keyboard.press('Control+z');
    await expect.poll(() => host.board.count(), { timeout: 5000 }).toBe(0);
  });

  test('правки автора сразу приходят гостям', async ({ host, join }) => {
    const url = await host.share();
    const guest = await join(url, 'Ученик');
    await expect.poll(() => guestProjectName(guest)).toBe('Проект 1');

    await host.board.rect(400, 300, 520, 380);
    await expect.poll(() => guest.board.count('shape'), { timeout: 5000 }).toBe(1);
    await host.board.tool('t');
    await host.board.click({ x: 400, y: 500 });
    await host.page.keyboard.type('x² + y² = r²');
    await host.page.keyboard.press('Enter');
    await expect.poll(async () => (await guest.board.elements()).find(e => e.type === 'text')?.text, { timeout: 5000 })
      .toBe('x² + y² = r²');

    // новая страница и её название
    await host.board.addPage();
    await host.page.locator('#page-name').fill('Задачи');
    await host.page.locator('#page-name').press('Enter');
    await expect(guest.page.locator('#pages-list .page-name')).toHaveText(['Страница 1', 'Задачи'], { timeout: 5000 });
    // у гостя своя активная страница
    expect(await guest.page.evaluate(() => (window as any).__doska.state.board.name)).toBe('Страница 1');
  });

  test('курсоры участников с именами', async ({ host, join }) => {
    const url = await host.share();
    const guest = await join(url, 'Ученик');
    await expect.poll(() => guestProjectName(guest)).toBe('Проект 1');

    await guest.board.move({ x: 300, y: 300 });
    await guest.board.move({ x: 350, y: 320 }, 5);
    const cursor = host.page.locator('#remote-cursors .remote-cursor', { hasText: 'Ученик' });
    // сам контейнер метки нулевого размера — видна подпись
    await expect(cursor.locator('span')).toBeVisible();
    // метка стоит там же, где курсор гостя в координатах сцены
    const cam = (await host.board.state()).camera;
    // последняя позиция доходит после троттлинга
    await expect.poll(() => cursor.evaluate(e => parseFloat((e as HTMLElement).style.left))).toBeCloseTo((350 - cam.x) * cam.zoom, 0);

    await host.board.move({ x: 600, y: 400 });
    await host.board.move({ x: 620, y: 420 }, 3);
    await expect(guest.page.locator('#remote-cursors .remote-cursor span', { hasText: 'Автор' })).toBeVisible();

    // гость на другой странице — его курсор у автора не показывается
    await host.board.addPage();
    await expect(guest.page.locator('#pages-list .page-item')).toHaveCount(2, { timeout: 5000 });
    await guest.board.openPages();
    await guest.page.locator('#pages-list .page-item').nth(1).click();
    await guest.board.move({ x: 300, y: 300 });
    await guest.board.move({ x: 320, y: 300 }, 3);
    await host.page.locator('#pages-list .page-item').first().click();
    await host.board.move({ x: 500, y: 300 }, 3);
    await expect(cursor).toHaveCount(0);
  });

  test('бездействующий участник помечается «Отошёл»', async ({ host, join }) => {
    const url = await host.share();
    const guest = await join(url, 'Ученик');
    await guest.board.move({ x: 300, y: 300 });
    await guest.board.move({ x: 310, y: 300 }, 2);
    await expect(host.userRow('Ученик')).toContainText('Ученик · Отошёл', { timeout: 8000 });
    // метка курсора тоже серая, как только сервер разошлёт состояние
    await host.board.move({ x: 500, y: 500 }, 3);
    await expect(host.page.locator('#remote-cursors .remote-cursor.away')).toContainText('Отошёл');
    // гость вернулся
    await guest.board.move({ x: 400, y: 400 }, 3);
    await expect(host.userRow('Ученик')).not.toContainText('Отошёл', { timeout: 5000 });
  });

  test('выделение гостя видно остальным', async ({ host, join }) => {
    await host.board.rect(400, 300, 500, 400);
    const url = await host.share();
    const guest = await join(url, 'Ученик');
    await expect(host.userRow('Ученик')).toBeVisible({ timeout: 5000 });
    await host.setRight('Ученик', 0, 'edit');
    await expect(guest.page.locator('#toolbar')).toBeVisible();
    const [rect] = await guest.board.elements();
    await guest.board.tool('v');
    await guest.board.click({ x: 450, y: 350 });
    await expect.poll(() => host.server!.users().find(u => u.name === 'Ученик')?.selection, { timeout: 5000 }).toEqual([rect.id]);
    await guest.board.click({ x: 900, y: 600 });
    await expect.poll(() => host.server!.users().find(u => u.name === 'Ученик')?.selection, { timeout: 5000 }).toEqual([]);
  });

  test('права по страницам: правка одной, просмотр и скрытие других', async ({ host, join }) => {
    await host.board.addPage();
    await host.board.addPage();
    await expect(host.page.locator('#pages-list .page-item')).toHaveCount(3);
    const url = await host.share();
    const guest = await join(url, 'Ученик');
    await expect(guest.page.locator('#pages-list .page-item')).toHaveCount(3);
    await expect(host.userRow('Ученик')).toBeVisible({ timeout: 5000 });

    await host.setRight('Ученик', 1, 'edit');
    await host.setRight('Ученик', 2, 'hidden');
    // скрытая страница пропадает у гостя сразу
    await expect(guest.page.locator('#pages-list .page-name')).toHaveText(['Страница 1', 'Страница 2'], { timeout: 5000 });

    // на первой странице — только просмотр
    await guest.board.openPages();
    await guest.page.locator('#pages-list .page-item').first().click();
    await expect(guest.page.locator('body')).toHaveClass(/readonly-mode/);
    // на второй — правка
    await guest.page.locator('#pages-list .page-item').nth(1).click();
    await expect(guest.page.locator('body')).not.toHaveClass(/readonly-mode/);
    await guest.board.drag([{ x: 300, y: 300 }, { x: 500, y: 300 }]);
    await expect.poll(() => host.server!.room.project.pages[1].elements.length, { timeout: 5000 }).toBe(1);

    // подделанная правка просматриваемой страницы отбрасывается сервером
    await guest.page.evaluate(() => {
      const d = (window as any).__doska;
      d.state.project.pages[0].elements = [{ id: 'hack', type: 'shape', shape: 'rect', x: 0, y: 0, w: 5, h: 5, color: '#000', width: 1 }];
      d.state.dirty = true;
      d.requestRender();
    });
    await guest.board.drag([{ x: 300, y: 340 }, { x: 500, y: 340 }]); // любая правка запускает отправку
    await expect.poll(() => host.server!.room.project.pages[1].elements.length, { timeout: 5000 }).toBe(2);
    expect(host.server!.room.project.pages[0].elements).toEqual([]);
    expect(host.server!.room.project.pages).toHaveLength(3); // скрытая страница у автора цела

    // вернуть скрытую страницу
    await host.setRight('Ученик', 2, 'view');
    await expect(guest.page.locator('#pages-list .page-item')).toHaveCount(3, { timeout: 5000 });
  });

  test(`не больше ${MAX_EDITORS} редакторов одновременно`, async ({ host, join }) => {
    const url = await host.share();
    const guest = await join(url, 'Ученик');
    await expect(host.userRow('Ученик')).toBeVisible({ timeout: 5000 });
    // ещё трое участников без браузера: автор + 3 редактора = лимит
    const port = host.server!.port;
    const sockets: WebSocket[] = [];
    for (let i = 0; i < MAX_EDITORS - 1; i++) {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?code=${host.server!.code}&name=${encodeURIComponent(`Бот ${i}`)}`);
      sockets.push(ws);
      const init = await new Promise<any>(r => { ws.onmessage = ev => r(JSON.parse(String(ev.data))); });
      expect(host.server!.setRights(init.userId, { all: 'edit' }).ok).toBe(true);
    }
    await expect(host.dialog.locator('.share-user')).toHaveCount(MAX_EDITORS, { timeout: 5000 });

    const alert = new Promise<string>(resolve => host.page.once('dialog', d => { resolve(d.message()); void d.dismiss(); }));
    await host.setRight('Ученик', 0, 'edit');
    expect(await alert).toBe(`Максимум ${MAX_EDITORS} одновременных редакторов`);
    await expect(guest.page.locator('body')).toHaveClass(/readonly-mode/);

    // освободилось место — право выдаётся
    sockets[0].close();
    await expect(host.dialog.locator('.share-user')).toHaveCount(MAX_EDITORS - 1, { timeout: 5000 });
    await host.setRight('Ученик', 0, 'edit');
    await expect(guest.page.locator('body')).not.toHaveClass(/readonly-mode/);
    for (const s of sockets) s.close();
  });

  test('два гостя видят друг друга и правки друг друга', async ({ host, join }) => {
    const url = await host.share();
    const anna = await join(url, 'Аня');
    const boris = await join(url, 'Борис');
    await expect(host.dialog.locator('.share-user')).toHaveCount(2, { timeout: 5000 });
    await host.setRight('Аня', 0, 'edit');
    await host.setRight('Борис', 0, 'edit');
    await expect(anna.page.locator('#toolbar')).toBeVisible();
    await expect(boris.page.locator('#toolbar')).toBeVisible();

    await anna.board.move({ x: 300, y: 300 });
    await anna.board.move({ x: 320, y: 310 }, 3);
    await expect(boris.page.locator('.remote-cursor span', { hasText: 'Аня' })).toBeVisible();

    await anna.board.tool('r');
    await anna.board.drag([{ x: 300, y: 300 }, { x: 400, y: 400 }]);
    await expect.poll(() => boris.board.count('shape'), { timeout: 5000 }).toBe(1);
    await expect.poll(() => host.board.count('shape'), { timeout: 5000 }).toBe(1);
    // у участников разные цвета
    const colors = host.server!.users().map(u => u.color);
    expect(new Set(colors).size).toBe(colors.length);
  });

  test('ссылка копируется, тестовое окно, выключение', async ({ host, join, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const url = await host.share();
    await host.dialog.locator('.share-link').click();
    await expect(host.dialog.locator('.share-link')).toHaveText('Ссылка скопирована');
    expect(await host.page.evaluate(() => navigator.clipboard.readText())).toBe(url);
    await expect(host.dialog.locator('.share-link')).toHaveText(url);

    await host.dialog.locator('button', { hasText: '+ Тестовое окно гостя' }).click();
    await expect.poll(() => host.testWindows).toBe(1);

    const guest = await join(url, 'Ученик');
    await expect(host.userRow('Ученик')).toBeVisible({ timeout: 5000 });

    await host.dialog.locator('button', { hasText: 'Выключить' }).click();
    await expect(host.dialog.locator('button', { hasText: 'Включить совместную работу' })).toBeVisible();
    expect(host.server).toBeNull();
    // правки автора больше никуда не уходят и не ломают работу
    await host.dialog.locator('button', { hasText: 'Закрыть' }).click();
    await expect(host.dialog).toHaveCount(0);
    await host.board.rect(400, 300, 500, 400);
    await host.board.saved();
    expect(await guest.board.count()).toBe(0);
    // диалог закрывается повторным нажатием кнопки
    await host.page.locator('#btn-share').click();
    await expect(host.dialog).toBeVisible();
    await host.page.locator('#btn-share').click();
    await expect(host.dialog).toHaveCount(0);
  });

  test('проект автора сохраняется локально и во время совместной работы', async ({ host }) => {
    await host.share();
    await host.board.rect(400, 300, 500, 400);
    await host.board.saved();
    const saved = [...host.store.values()][0];
    expect(saved.pages[0].elements).toHaveLength(1);
    expect(host.server!.room.project.pages[0].elements).toHaveLength(1);
  });
});
