// Ночь №6, ссылки (SPEC_NIGHT6 §5): чистая /j/<токен>, пауза и включение той же ссылки, сброс, именной адрес
// (вход, переименование — старый ведёт туда же, освобождение), просмотр по ссылке на доску выключается.
import { expect, test, type Browser } from '@playwright/test';
import { Board } from './fixtures';
import { createInvite, device, login, openAt, shareTab, stateOf, useNight5Server } from './night5-helpers';

const env = useNight5Server();

async function guestAt(browser: Browser, base: string, url: string, ready: 'guest' | 'none' = 'guest') {
  const G = await device(browser, base, { name: 'Гость' });
  const g = await openAt(G, url, env.errors, ready);
  return { G, g };
}

test.describe('ссылки', () => {
  test('/j/<токен> ведёт в комнату; пауза закрывает вход, включение — та же ссылка снова работает; сброс — старая мертва', async ({ browser }) => {
    const { base } = env.get();
    const teacher = await login(base, 'teacher-links@abax.example');
    const A = await device(browser, base, { session: teacher.token, name: 'Лемур' });
    const a = await openAt(A, `${base}/`, env.errors);
    await new Board(a).rect(400, 300, 520, 380);
    const link = await createInvite(a);
    expect(link).toBe(`${base}/j/${link.split('/j/')[1]}`);
    expect(link.split('/j/')[1]).toMatch(/^[A-Za-z0-9_-]{24}$/);

    const one = await guestAt(browser, base, link);
    await expect.poll(() => stateOf(one.g, s => s.board.elements.length), { timeout: 10000 }).toBe(1);

    // пауза: подключённого отключает, новый видит понятную причину
    const box = a.locator('#share-dialog .share-invite');
    await box.locator('.share-switch').click();
    await expect(box.locator('.share-switch')).toHaveAttribute('aria-checked', 'false');
    await expect(one.g.locator('#collab-notice')).toBeVisible({ timeout: 10000 });
    const two = await guestAt(browser, base, link, 'none');
    await expect(two.g.locator('#collab-notice')).toContainText('Автор закрыл доступ к доске по ссылке', { timeout: 10000 });
    // включение — тот же адрес
    await box.locator('.share-switch').click();
    await expect(box.locator('.share-switch')).toHaveAttribute('aria-checked', 'true');
    expect(await box.locator('.share-url').inputValue()).toBe(link);
    const three = await guestAt(browser, base, link);
    await expect.poll(() => stateOf(three.g, s => s.board.elements.length), { timeout: 10000 }).toBe(1);

    // сброс (на странице «Настройки доступа»): новый адрес, старый — «приглашение недействительно»
    await shareTab(a, 'settings');
    await a.locator('#share-dialog .share-reset').click();
    await a.locator('#share-dialog .share-confirm button', { hasText: 'Сбросить' }).click();
    await shareTab(a, 'share');
    await expect.poll(() => box.locator('.share-url').inputValue(), { timeout: 10000 }).not.toBe(link);
    const fresh = await box.locator('.share-url').inputValue();
    const four = await guestAt(browser, base, link, 'none');
    await expect(four.g.locator('#collab-notice')).toContainText('Приглашение недействительно', { timeout: 10000 });
    const five = await guestAt(browser, base, fresh);
    await expect.poll(() => stateOf(five.g, s => s.board.elements.length), { timeout: 10000 }).toBe(1);
    for (const c of [A, one.G, two.G, three.G, four.G, five.G]) await c.close();
  });

  test('именной адрес: вход, переименование — старый ведёт туда же, освобождение — «больше не используется»', async ({ browser }) => {
    const { base } = env.get();
    const teacher = await login(base, 'teacher-alias@abax.example');
    const A = await device(browser, base, { session: teacher.token, name: 'Лемур' });
    const a = await openAt(A, `${base}/`, env.errors);
    await new Board(a).rect(400, 300, 520, 380);
    await createInvite(a, 'reader');

    await shareTab(a, 'settings');
    const input = a.locator('#share-dialog .share-alias-input');
    await input.fill('Physics--');
    await expect(a.locator('#share-dialog .share-alias-problem')).toHaveText('Дефис — только между буквами и цифрами');
    await input.fill('physics-9a');
    await a.locator('#share-dialog .share-alias-save').click();
    await expect(a.locator('#share-dialog .share-alias-save')).toHaveText('Изменить', { timeout: 10000 });
    await shareTab(a, 'share');
    await expect(a.locator('#share-dialog .share-url')).toHaveValue(`${base}/j/physics-9a`);

    const one = await guestAt(browser, base, `${base}/j/physics-9a`);
    await expect.poll(() => stateOf(one.g, s => s.board.elements.length), { timeout: 10000 }).toBe(1);
    await expect(one.g.locator('body')).toHaveClass(/readonly-mode/); // роль общей ссылки — читатель

    // переименование: прежний адрес — бывший и ведёт туда же
    await shareTab(a, 'settings');
    await input.fill('fizika-9a');
    await a.locator('#share-dialog .share-alias-save').click();
    await expect(a.locator('#share-dialog .share-alias .share-person-name')).toHaveText('/j/physics-9a', { timeout: 10000 });
    const two = await guestAt(browser, base, `${base}/j/physics-9a`);
    await expect.poll(() => stateOf(two.g, s => s.board.elements.length), { timeout: 10000 }).toBe(1);

    // освобождение с подтверждением
    await a.locator('#share-dialog [data-key="release-physics-9a"]').click();
    await a.locator('#share-dialog .share-alias .share-confirm button', { hasText: 'Освободить' }).click();
    await expect(a.locator('#share-dialog .share-alias .share-person-name')).toHaveCount(0, { timeout: 10000 });
    const three = await guestAt(browser, base, `${base}/j/physics-9a`, 'none');
    await expect(three.g.locator('#collab-notice')).toContainText('Адрес больше не используется', { timeout: 10000 });
    for (const c of [A, one.G, two.G, three.G]) await c.close();
  });

  test('просмотр по ссылке на доску: открыт по умолчанию, выключенный — доска недоступна', async ({ browser }) => {
    const { base, srv } = env.get();
    const teacher = await login(base, 'teacher-view@abax.example');
    const A = await device(browser, base, { session: teacher.token, name: 'Лемур' });
    const a = await openAt(A, `${base}/`, env.errors);
    await new Board(a).rect(400, 300, 520, 380);
    const pid = await stateOf(a, s => s.project.id as string);
    await expect.poll(() => (srv.db.prepare('SELECT rev FROM projects WHERE id = ?').get(pid) as { rev: number } | undefined)?.rev ?? 0, { timeout: 15000 }).toBeGreaterThan(0);
    const url = `${base}/?route=project&projectId=${pid}`;
    const one = await guestAt(browser, base, url, 'none');
    await expect(one.g.locator('#link-banner .lb-title')).toHaveText('Режим просмотра', { timeout: 10000 });

    await shareTab(a, 'settings');
    await a.locator('#share-dialog input[data-field="linkView"]').uncheck();
    await expect.poll(() => (JSON.parse((srv.db.prepare('SELECT data_json FROM projects WHERE id = ?').get(pid) as { data_json: string }).data_json).permissions?.linkView), { timeout: 15000 }).toBe(false);
    const two = await guestAt(browser, base, url, 'none');
    await expect(two.g.locator('#link-banner .lb-title')).toHaveText('Проект недоступен на этом устройстве', { timeout: 10000 });
    expect(await stateOf(two.g, s => s.board.elements.length)).toBe(0);
    for (const c of [A, one.G, two.G]) await c.close();
  });
});
