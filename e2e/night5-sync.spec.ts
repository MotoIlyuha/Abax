// Ночь №5, блок 1: облако без швов — стартовая доска не уходит в облако и заменяется облачным проектом на втором
// устройстве, индикатор синхронизации в шапке, копия при настоящем офлайн-конфликте.
import { expect, test } from '@playwright/test';
import { Board } from './fixtures';
import { device, login, openAt, serverProjects, stateOf, useNight5Server, userIdOf } from './night5-helpers';

const env = useNight5Server();

test.describe('облако без швов', () => {
  test('второе устройство: пустая стартовая доска не уходит в облако и заменяется облачным проектом, правки идут вживую', async ({ browser }) => {
    const { srv, base } = env.get();
    const acc = await login(base, 'sync-two@abax.example');

    // Ноутбук: рисует на стартовой доске — она становится настоящим проектом и уходит в облако
    const A = await device(browser, base, { session: acc.token });
    const a = await openAt(A, `${base}/`, env.errors);
    const boardA = new Board(a);
    await boardA.rect(400, 300, 520, 380);
    await boardA.saved();
    const pid = await stateOf(a, s => s.project.id as string);
    await expect.poll(() => serverProjects(srv, acc.id).map(p => p.id), { timeout: 15000 }).toEqual([pid]);
    await expect.poll(() => serverProjects(srv, acc.id)[0]?.data_json.includes('"type":"shape"'), { timeout: 15000 }).toBe(true);

    // Планшет: тот же аккаунт, пустое устройство
    const acc2 = await login(base, 'sync-two@abax.example');
    expect(acc2.id).toBe(acc.id);
    const B = await device(browser, base, { session: acc2.token });
    const b = await openAt(B, `${base}/`, env.errors);
    // стартовая доска тихо заменилась проектом ноутбука
    await expect.poll(() => stateOf(b, s => s.project.id as string), { timeout: 15000 }).toBe(pid);
    await expect.poll(() => new Board(b).count('shape'), { timeout: 10000 }).toBe(1);
    expect(await stateOf(b, s => s.projects.map((m: any) => m.id))).toEqual([pid]);
    // и на сервер она не попала
    expect(serverProjects(srv, acc.id).map(p => p.id)).toEqual([pid]);

    // оба устройства автора в одной облачной комнате: правка планшета доходит до ноутбука
    await expect.poll(() => srv.rooms.connections(pid), { timeout: 15000 }).toBe(2);
    await new Board(b).rect(700, 300, 820, 380);
    await expect.poll(() => boardA.count('shape'), { timeout: 10000 }).toBe(2);
    await A.close();
    await B.close();
  });

  test('индикатор: «Сохранено в облаке», без сети — офлайн, клик после возвращения сети — снова в облаке', async ({ browser }) => {
    const { base } = env.get();
    const C = await device(browser, base);
    const page = await openAt(C, `${base}/`, env.errors);
    const ind = page.locator('#sync-indicator');
    // нетронутая стартовая доска — индикатора нет
    await expect(ind).toBeHidden();
    const board = new Board(page);
    await board.rect(400, 300, 520, 380);
    const uid = await userIdOf(page);
    const pid = await stateOf(page, s => s.project.id as string);
    await expect.poll(() => serverProjects(env.get().srv, uid).some(p => p.id === pid), { timeout: 15000 }).toBe(true);
    await expect(ind).toHaveAttribute('data-status', 'synced', { timeout: 15000 });
    await expect(ind).toHaveAttribute('aria-label', 'Сохранено в облаке');

    // сеть до проектов пропала
    await page.route('**/api/projects/**', r => r.abort('internetdisconnected'));
    await board.rect(600, 300, 720, 380);
    await expect(ind).toHaveAttribute('data-status', 'offline', { timeout: 15000 });
    await expect(ind).toHaveAttribute('aria-label', 'Сохранено на устройстве (офлайн)');

    // вернулась: клик по индикатору отправляет сразу, не дожидаясь паузы повтора
    await page.unroute('**/api/projects/**');
    await ind.click();
    await expect(ind).toHaveAttribute('data-status', 'synced', { timeout: 10000 });
    await expect.poll(() => serverProjects(env.get().srv, uid).find(p => p.id === pid)?.data_json.match(/"type":"shape"/g)?.length, { timeout: 10000 }).toBe(2);
    await C.close();
  });

  test('офлайн-конфликт: проект ушёл вперёд с другого устройства — правки этого сохраняются копией', async ({ browser }) => {
    const { srv, base } = env.get();
    const D = await device(browser, base);
    const page = await openAt(D, `${base}/`, env.errors);
    const board = new Board(page);
    await board.rect(400, 300, 520, 380);
    const ind = page.locator('#sync-indicator');
    await expect(ind).toHaveAttribute('data-status', 'synced', { timeout: 15000 });
    const pid = await stateOf(page, s => s.project.id as string);
    const uid = await userIdOf(page);
    await expect.poll(() => serverProjects(srv, uid).find(p => p.id === pid)?.data_json.includes('"type":"shape"'), { timeout: 15000 }).toBe(true);
    await expect(ind).toHaveAttribute('data-status', 'synced', { timeout: 15000 });
    const before = serverProjects(srv, uid).find(p => p.id === pid)!;

    // «другое устройство» успело переименовать проект и поменять фигуру на сервере
    const remote = JSON.parse(before.data_json);
    remote.name = 'С планшета';
    remote.pages[0].elements[0].x += 300;
    srv.db.prepare('UPDATE projects SET title = ?, data_json = ?, rev = ? WHERE id = ?').run('С планшета', JSON.stringify(remote), before.rev + 1, pid);

    // а это устройство, не зная об этом, рисует ещё
    await board.rect(600, 500, 720, 580);
    const toast = page.locator('#notify-stack .ns-card', { hasText: 'Проект обновился с другого устройства' });
    await expect(toast).toBeVisible({ timeout: 15000 });
    // основной проект — серверная версия, своя фигура ушла в копию
    await expect.poll(() => stateOf(page, s => s.project.name as string)).toBe('С планшета');
    expect(await board.count('shape')).toBe(1);
    const copy = await stateOf(page, s => s.projects.find((m: any) => m.name.endsWith('(копия с устройства)')));
    expect(copy).toBeTruthy();

    await toast.locator('button', { hasText: 'Открыть копию' }).click();
    await expect.poll(() => stateOf(page, s => s.project.name as string)).toMatch(/\(копия с устройства\)$/);
    expect(await board.count('shape')).toBe(2);
    // копия — отдельный проект и уходит в облако, основной на сервере не перезаписан
    const copyId = await stateOf(page, s => s.project.id as string);
    expect(copyId).not.toBe(pid);
    await expect.poll(() => serverProjects(srv, uid).some(p => p.id === copyId), { timeout: 15000 }).toBe(true);
    expect(serverProjects(srv, uid).find(p => p.id === pid)!.title).toBe('С планшета');
    await D.close();
  });
});
