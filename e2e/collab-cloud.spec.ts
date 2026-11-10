// Совместная работа через интернет: автор, настоящий ретранслятор (relay/server.cjs) и гости в
// отдельных браузерах. Клиент гостя — эта же сборка на vite preview, как будто это GitHub Pages.
import { expect, test } from './host';

test.describe('совместная работа через интернет', () => {
  test('гость по ссылке через ретранслятор видит доску, с правом правки рисует', async ({ host, join }) => {
    await host.board.rect(400, 300, 500, 400);
    await host.share();
    const url = await host.shareCloud();
    await expect(host.dialog.locator('.share-cloud-status')).toHaveText('Ссылка откроется на любом устройстве с интернетом.');

    const guest = await join(url, 'Из облака');
    await expect.poll(() => guest.board.count('shape')).toBe(1);
    await expect(guest.page.locator('body')).toHaveClass(/collab-guest/);
    await expect(guest.page.locator('body')).toHaveClass(/readonly-mode/);

    // гость из интернета — обычный участник: автор видит его и выдаёт права
    await expect(host.userRow('Из облака')).toBeVisible({ timeout: 5000 });
    await host.setRight('Из облака', 0, 'edit');
    await expect(guest.page.locator('body')).not.toHaveClass(/readonly-mode/);
    await guest.board.drag([{ x: 300, y: 300 }, { x: 500, y: 350 }, { x: 600, y: 300 }]);
    await expect.poll(() => host.board.count('stroke'), { timeout: 5000 }).toBe(1);

    // курсор гостя с именем — у автора
    await guest.page.mouse.move(700, 450);
    await expect(host.page.locator('.remote-cursor span', { hasText: 'Из облака' })).toBeVisible();
    await host.dialog.screenshot({ path: test.info().outputPath('share-dialog-cloud.png') });
  });

  test('гости из локальной сети и из интернета — в одной комнате', async ({ host, join }) => {
    const lanUrl = await host.share();
    const cloudUrl = await host.shareCloud();
    const lan = await join(lanUrl, 'Рядом');
    const far = await join(cloudUrl, 'Далеко');
    await expect(host.userRow('Рядом')).toBeVisible({ timeout: 5000 });
    await expect(host.userRow('Далеко')).toBeVisible({ timeout: 5000 });
    await host.board.rect(200, 200, 300, 260);
    await expect.poll(() => lan.board.count('shape')).toBe(1);
    await expect.poll(() => far.board.count('shape')).toBe(1);
    // гость из интернета видит курсор гостя из локальной сети
    await lan.page.mouse.move(640, 420);
    await expect(far.page.locator('.remote-cursor span', { hasText: 'Рядом' })).toBeVisible();
  });

  test('автор закрывает доступ через интернет — гость видит сообщение, локальная сеть работает', async ({ host, join }) => {
    const lanUrl = await host.share();
    const url = await host.shareCloud();
    const far = await join(url, 'Далеко');
    const lan = await join(lanUrl, 'Рядом');
    await expect(host.userRow('Далеко')).toBeVisible({ timeout: 5000 });

    await host.dialog.locator('button', { hasText: 'Закрыть доступ через интернет' }).click();
    await expect(far.page.locator('#collab-notice')).toContainText('Совместная работа завершена');
    await expect(host.dialog.locator('button', { hasText: 'Пригласить через интернет' })).toBeVisible();
    await expect(host.userRow('Далеко')).toHaveCount(0, { timeout: 5000 });
    await host.board.rect(200, 200, 300, 260);
    await expect.poll(() => lan.board.count('shape')).toBe(1);
  });

  test('связь автора с сервером прервалась — гость ждёт, доска обновляется после возвращения', async ({ host, join }) => {
    await host.share();
    const url = await host.shareCloud();
    const guest = await join(url, 'Ждущий');
    await expect(host.userRow('Ждущий')).toBeVisible({ timeout: 5000 });

    host.dropCloudConnection();
    await expect(guest.page.locator('#collab-notice')).toContainText('Автор переподключается…');
    // пока связи нет, автор рисует — гость получит это после возвращения
    await host.board.rect(200, 200, 300, 260);
    await expect(guest.page.locator('#collab-notice')).toHaveCount(0, { timeout: 5000 });
    await expect.poll(() => guest.board.count('shape'), { timeout: 5000 }).toBe(1);
    // ссылка не изменилась
    await expect(host.dialog.locator('.share-link-cloud')).toHaveText(url);
  });

  test('ссылка на закрытую или несуществующую доску — понятное сообщение', async ({ host, join }) => {
    await host.share();
    await host.shareCloud();
    const relay = await host.relayUrl();
    const guest = await join(`${new URL('/', host.page.url()).href}#relay=${encodeURIComponent(relay)}&r=${'A'.repeat(22)}`, 'Опоздавший');
    await expect(guest.page.locator('#collab-notice')).toContainText('Доска не найдена');
    await expect(guest.page.locator('#startup')).toBeHidden();
  });

  test('адрес ретранслятора не задан — поле для адреса, после ввода ссылка готова', async ({ host }) => {
    host.defaultRelay = '';
    await host.share();
    await host.dialog.locator('button', { hasText: 'Пригласить через интернет' }).click();
    await expect(host.dialog.locator('.share-cloud-error')).toHaveText('Не указан адрес ретранслятора');
    const input = host.dialog.locator('.share-relay-input');
    await expect(input).toBeVisible();

    // неверный адрес — объяснение, поле остаётся
    await input.fill('ws://relay.example.com');
    await host.dialog.locator('button', { hasText: 'Подключиться снова' }).click();
    await expect(host.dialog.locator('.share-cloud-error')).toHaveText('Адрес ретранслятора должен начинаться с wss://');

    // поле не сбрасывается периодической перерисовкой диалога, пока в нём фокус
    const relay = await host.relayUrl();
    await input.fill(relay);
    await host.page.waitForTimeout(2300);
    await expect(input).toHaveValue(relay);
    await input.press('Enter');
    await expect(host.dialog.locator('.share-link-cloud')).toHaveText(/#relay=/);
    expect(await host.page.evaluate(() => localStorage.getItem('doska.relayUrl'))).toBe(relay);
  });
});
