// Ночь №5, блок 2: живая комната — пилюли входа и выхода участников и встроенный чат между двумя «устройствами»
// (облачная комната настоящего сервера Abax).
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { Board } from './fixtures';
import { createInvite, device, openAt, useNight5Server } from './night5-helpers';

const env = useNight5Server();

/** Автор с нарисованной доской и созданной ссылкой-приглашением; гость в комнате. */
async function room(browser: Browser): Promise<{ A: BrowserContext; a: Page; G: BrowserContext; g: Page; link: string }> {
  const { base } = env.get();
  const A = await device(browser, base, { name: 'Лемур' });
  const a = await openAt(A, `${base}/`, env.errors);
  await new Board(a).rect(400, 300, 520, 380);
  const link = await createInvite(a);
  await expect.poll(() => a.evaluate(() => (window as any).__doska.state.collabRole), { timeout: 15000 }).toBe('host');
  await a.locator('#share-dialog').press('Escape');
  const G = await device(browser, base, { name: 'Капибара' });
  const g = await openAt(G, link, env.errors, 'guest');
  return { A, a, G, g, link };
}

test.describe('живая комната', () => {
  test('пилюли: автор видит, как гость вошёл и вышел', async ({ browser }) => {
    const { A, a, G } = await room(browser);
    const pills = a.locator('#activity-pills');
    await expect(pills.locator('.activity-pill', { hasText: 'Капибара присоединился к доске' })).toBeVisible({ timeout: 10000 });
    // у пилюли входа — мини-курсор участника
    await expect(pills.locator('.activity-pill', { hasText: 'Капибара присоединился' }).locator('svg')).toHaveCount(1);
    await G.close();
    await expect(pills.locator('.activity-pill', { hasText: 'Капибара покинул доску' })).toBeVisible({ timeout: 10000 });
    // пилюли не перехватывают клики по доске
    expect(await pills.evaluate(e => getComputedStyle(e).pointerEvents)).toBe('none');
    await A.close();
  });

  test('чат: сообщение доходит, непрочитанные на кнопке, ссылки https безопасны, разметка остаётся текстом', async ({ browser }) => {
    const { A, a, G, g } = await room(browser);
    // кнопка чата есть у обоих только во время совместной работы
    await expect(a.locator('#btn-chat')).toBeVisible();
    await expect(g.locator('#btn-chat')).toBeVisible();

    await g.locator('#btn-chat').click();
    const gPanel = g.locator('#chat-panel');
    await expect(gPanel).toBeVisible();
    const input = gPanel.locator('.chat-input');
    await input.fill('Смотрите https://abax.example/doc?x=1, <b>жирный</b> <img src=x onerror=alert(1)>');
    await input.press('Enter');
    await expect(gPanel.locator('.chat-msg.mine')).toHaveCount(1);
    await expect(input).toHaveValue('');

    // у автора панель закрыта: бейдж непрочитанных и превью пилюлей
    await expect(a.locator('#btn-chat .chat-badge')).toHaveText('1', { timeout: 10000 });
    await expect(a.locator('#activity-pills .activity-pill', { hasText: 'Смотрите https://abax.example' })).toBeVisible();
    await a.locator('#btn-chat').click();
    const aPanel = a.locator('#chat-panel');
    await expect(aPanel).toBeVisible();
    await expect(a.locator('#btn-chat .chat-badge')).toBeHidden();
    const msg = aPanel.locator('.chat-msg').last();
    await expect(msg.locator('.chat-name')).toHaveText('Капибара');
    const link = msg.locator('.chat-text a');
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAttribute('href', 'https://abax.example/doc?x=1');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(link).toHaveAttribute('target', '_blank');
    // HTML из сообщения — просто текст
    await expect(msg.locator('.chat-text')).toContainText('<b>жирный</b> <img src=x onerror=alert(1)>');
    await expect(msg.locator('.chat-text b, .chat-text img')).toHaveCount(0);

    // ответ автора доходит до гостя; Shift+Enter — перенос строки, а не отправка
    const aInput = aPanel.locator('.chat-input');
    await aInput.fill('Привет');
    await aInput.press('Shift+Enter');
    await aInput.press('Enter');
    await expect(gPanel.locator('.chat-msg').last().locator('.chat-text')).toHaveText('Привет', { timeout: 10000 });
    await expect(gPanel.locator('.chat-msg')).toHaveCount(2);

    // история переживает переподключение: новый гость видит оба сообщения
    await G.close();
    const { base } = env.get();
    const G2 = await device(browser, base, { name: 'Вомбат' });
    const g2 = await openAt(G2, g.url(), env.errors, 'guest');
    await g2.locator('#btn-chat').click();
    await expect(g2.locator('#chat-panel .chat-msg')).toHaveCount(2);
    await A.close();
    await G2.close();
  });
});
