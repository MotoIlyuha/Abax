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
  test('уведомления: автор видит, как гость вошёл и вышел', async ({ browser }) => {
    const { A, a, G } = await room(browser);
    const stack = a.locator('#notify-stack');
    await expect(stack.locator('.ns-card', { hasText: 'Капибара присоединился к доске' })).toBeVisible({ timeout: 10000 });
    // у карточки входа — аватар участника с его курсором
    await expect(stack.locator('.ns-card', { hasText: 'Капибара присоединился' }).locator('.ua-cursor svg')).toHaveCount(1);
    await G.close();
    await expect(stack.locator('.ns-card', { hasText: 'Капибара покинул доску' })).toBeVisible({ timeout: 10000 });
    // стопка уходит в кнопку «Чат и уведомления» и не закрывает доску; события — в счётчике
    await expect(stack).toBeHidden({ timeout: 10000 });
    await expect(a.locator('#btn-notify')).toHaveAttribute('aria-label', 'Чат и уведомления: непрочитанных — 2');
    await A.close();
  });

  test('чат: сообщение доходит, непрочитанные на кнопке, ссылки https безопасны, разметка остаётся текстом', async ({ browser }) => {
    const { A, a, G, g } = await room(browser);
    // кнопка «Чат и уведомления» есть у обоих; при совместной работе щелчок открывает чат
    await expect(a.locator('#btn-notify')).toBeVisible();
    await expect(g.locator('#btn-notify')).toBeVisible();

    await g.locator('#btn-notify').click();
    const gPanel = g.locator('#chat-panel');
    await expect(gPanel).toBeVisible();
    const input = gPanel.locator('.chat-input');
    await input.fill('Смотрите https://abax.example/doc?x=1, <b>жирный</b> <img src=x onerror=alert(1)>');
    await input.press('Enter');
    await expect(gPanel.locator('.chat-msg.mine')).toHaveCount(1);
    await expect(input).toHaveValue('');

    // у автора панель закрыта: превью в стопке, затем стопка уходит в кнопку ЧУ и счётчик досчитывает
    await expect(a.locator('#notify-stack .ns-card', { hasText: 'Смотрите https://abax.example' })).toBeVisible({ timeout: 10000 });
    await expect(a.locator('#notify-stack')).toBeHidden({ timeout: 10000 });
    await expect(a.locator('#btn-notify')).toHaveAttribute('aria-label', /непрочитанных/);
    await a.locator('#btn-notify').click();
    const aPanel = a.locator('#chat-panel');
    await expect(aPanel).toBeVisible();
    await expect(a.locator('#btn-notify')).toHaveAttribute('aria-label', 'Чат и уведомления');
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
    await g2.locator('#btn-notify').click();
    await expect(g2.locator('#chat-panel .chat-msg')).toHaveCount(2);
    await A.close();
    await G2.close();
  });
});
