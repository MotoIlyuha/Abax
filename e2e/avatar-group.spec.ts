// Группа аватаров в шапке: стопка раскрывается наведением, меню своего и чужого аватара — скрыть курсор,
// позвать одного к себе, личные настройки доступа к страницам, исключить участника
// (облачная комната настоящего сервера Abax).
import { expect, test, type Page } from '@playwright/test';
import { Board } from './fixtures';
import { createInvite, device, openAt, stateOf, useNight5Server } from './night5-helpers';

const env = useNight5Server();
const shots = process.env.AVATAR_SHOTS ?? '';

const pageIdOf = (p: Page) => stateOf(p, s => s.pageId as string);
const shot = async (p: Page, name: string): Promise<void> => {
  if (shots) await p.locator('#topbar').screenshot({ path: `${shots}/${name}.png` });
};

async function closeShare(page: Page): Promise<void> {
  if (await page.locator('#share-dialog').count() > 0) await page.locator('#btn-share').click();
  await expect(page.locator('#share-dialog')).toHaveCount(0);
}

test('группа аватаров: раскрытие, меню, скрыть курсор, позвать одного, доступ участника, исключить', async ({ browser }) => {
  const { base } = env.get();
  const A = await device(browser, base, { name: 'Лемур' });
  const a = await openAt(A, `${base}/`, env.errors);
  // один на доске — свой аватар всё равно виден, слева от «Поделиться»
  const strip = a.locator('#collab-presence');
  await expect(strip.locator('.user-avatar.self')).toHaveCount(1);
  const shareBox = (await a.locator('#btn-share').boundingBox())!;
  const stripBox = (await strip.boundingBox())!;
  expect(stripBox.x + stripBox.width).toBeLessThanOrEqual(shareBox.x);
  // инициалы — на базовой линии текста «Поделиться» (когда появление аватара закончилось)
  await a.waitForTimeout(800);
  const baselines = await a.evaluate(() => {
    const base = (host: Element): number => {
      const probe = document.createElement('span');
      probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
      const wrap = document.createElement('span');
      wrap.append(...Array.from(host.childNodes), probe);
      host.append(wrap);
      const y = probe.getBoundingClientRect().top;
      host.append(...Array.from(wrap.childNodes).filter(n => n !== probe));
      wrap.remove();
      return y;
    };
    return [base(document.querySelector('#btn-share .share-text')!), base(document.querySelector('#collab-presence .ua-circle')!)];
  });
  expect(Math.abs(baselines[0] - baselines[1])).toBeLessThan(0.75);
  await shot(a, 'alone');
  const boardA = new Board(a);
  await boardA.rect(400, 300, 520, 380);
  await boardA.addPage();
  // после добавления автор на второй странице — возвращаемся на первую, куда придут гости
  await boardA.openPages();
  await a.locator('#pages-list .page-item').nth(0).click();
  const link = await createInvite(a);
  await closeShare(a);
  const pages = await stateOf(a, s => s.project.pages.map((p: any) => p.id as string)) as string[];

  const G1 = await device(browser, base, { name: 'Капибара' });
  const g1 = await openAt(G1, link, env.errors, 'guest');
  const G2 = await device(browser, base, { name: 'Енот Полоскун' });
  const g2 = await openAt(G2, link, env.errors, 'guest');
  await expect.poll(() => pageIdOf(g1)).toBe(pages[0]);
  await expect.poll(() => pageIdOf(a)).toBe(pages[0]);

  const group = a.locator('#collab-presence .avatar-group');
  await expect(group.locator('.user-avatar')).toHaveCount(3, { timeout: 10000 });
  await expect(group.locator('.user-avatar.self')).toHaveCount(1);
  await expect(group).toHaveAttribute('data-open', '0');
  // свёрнутая стопка: аватары не перекрываются
  const boxes = await group.locator('.user-avatar').evaluateAll(els => els.map(e => e.getBoundingClientRect()).map(r => ({ l: r.left, r: r.right })));
  for (let i = 1; i < boxes.length; i++) expect(boxes[i].l).toBeGreaterThanOrEqual(boxes[i - 1].r);
  await shot(a, 'collapsed');

  // наведение раскрывает
  await group.hover();
  await expect(group).toHaveAttribute('data-open', '1');
  await a.waitForTimeout(400);
  await shot(a, 'expanded');

  // свой аватар: меню с профилем, «Позвать всех к себе», «Скрыть курсоры других»
  await group.locator('.user-avatar.self').click();
  const menu = a.locator('#avatar-menu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('[data-action="profile"]')).toBeVisible();
  await expect(menu.locator('[data-action="summon-all"]')).toBeVisible();
  await expect(menu.locator('[data-action="hide-cursors"]')).toBeVisible();
  await a.waitForTimeout(300);
  if (shots) await a.screenshot({ path: `${shots}/self-menu.png`, clip: { x: 900, y: 0, width: 540, height: 360 } });
  await a.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  // курсор Капибары виден у автора; «Скрыть курсор» в меню её аватара — пропадает только он
  const b1 = (await g1.locator('#board').boundingBox())!;
  await g1.mouse.move(b1.x + 500, b1.y + 400);
  await g1.mouse.move(b1.x + 520, b1.y + 410, { steps: 3 });
  const capyCursor = a.locator('.remote-cursor span', { hasText: 'Капибара' });
  await expect(capyCursor).toBeVisible({ timeout: 10000 });
  await group.hover();
  const capy = group.locator('.user-avatar[aria-label^="Капибара"]');
  await capy.click();
  await expect(menu).toBeVisible();
  await expect(menu.locator('.avatar-menu-name')).toHaveText('Капибара');
  await expect(menu.locator('[data-action="follow"]')).toBeEnabled();
  await expect(menu.locator('[data-action="follow"]')).toContainText('Следить за участником');
  if (shots) { await a.waitForTimeout(300); await a.screenshot({ path: `${shots}/other-menu.png`, clip: { x: 900, y: 0, width: 540, height: 420 } }); }
  await menu.locator('[data-action="hide-cursor"]').click();
  await expect(capyCursor).toHaveCount(0);
  await expect(capy).toHaveClass(/cursor-off/);

  // «Позвать к себе»: автор на второй странице зовёт только Капибару
  await a.keyboard.press('Escape');
  await boardA.openPages();
  await a.locator('#pages-list .page-item').nth(1).click();
  await expect.poll(() => pageIdOf(a)).toBe(pages[1]);
  await group.hover();
  await capy.click();
  await menu.locator('[data-action="summon"]').click();
  await expect.poll(() => pageIdOf(g1), { timeout: 10000 }).toBe(pages[1]);
  await expect(g1.locator('#activity-pills .activity-pill', { hasText: 'позвал вас на страницу' })).toBeVisible();
  expect(await pageIdOf(g2)).toBe(pages[0]);

  // у карточки страницы в доке — те же аватары: Капибара на второй, Енот на первой; нажатие — то же меню
  await boardA.openPages();
  const card = a.locator('#pages-list .page-item').nth(1);
  const cardAvatar = card.locator('.page-avatars .user-avatar.page-avatar');
  await expect(cardAvatar).toHaveCount(1, { timeout: 10000 });
  await expect(cardAvatar).toHaveAttribute('aria-label', /^Капибара/);
  await expect(cardAvatar.locator('.ua-cursor svg')).toHaveCount(1);
  await expect(a.locator('#pages-list .page-item').nth(0).locator('.page-avatars .user-avatar')).toHaveCount(1);
  if (shots) { const d = (await a.locator('#pages-tray').boundingBox())!; await a.screenshot({ path: `${shots}/pages-dock.png`, clip: { x: d.x - 10, y: d.y - 10, width: d.width + 20, height: d.height + 20 } }); }
  await cardAvatar.click();
  await expect(menu.locator('.avatar-menu-name')).toHaveText('Капибара');
  await a.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  // «Настройки доступа» в меню Енота: подменю в этом же меню, страницы — как в «Поделиться»; правится только Енот
  const guestPages = (p: Page) => stateOf(p, s => s.project.pages.length as number);
  const menuShot = async (name: string, below = 0): Promise<void> => {
    if (!shots) return;
    await a.waitForTimeout(450);
    const m = (await menu.boundingBox())!;
    await a.screenshot({ path: `${shots}/${name}.png`, clip: { x: m.x - 24, y: 0, width: m.width + 48, height: m.y + m.height + 24 + below } });
  };
  await group.hover();
  await group.locator('.user-avatar[aria-label^="Енот"]').click();
  const accessItem = menu.locator('[data-action="access"]');
  await expect(accessItem).toBeVisible();
  // «Настройки доступа» — сразу над «Исключить»
  expect(await menu.locator('.avatar-menu-page > *').evaluateAll(els => els.map(e => (e as HTMLElement).dataset.action ?? e.tagName))).toEqual(
    ['goto', 'hide-cursor', 'summon', 'follow', 'HR', 'access', 'remove'],
  );
  await expect(menu.locator('[data-action="remove"]')).toContainText('Исключить');
  await menuShot('other-menu-host');
  await accessItem.click();
  const rows = menu.locator('.avatar-access-row');
  await expect(rows).toHaveCount(2);
  await expect(menu.locator('[data-action="back"]')).toContainText('Настройки доступа');
  await expect(menu.locator('[data-action="remove"]')).toHaveCount(0);
  await expect(rows.nth(0).locator('.avatar-access-select')).toContainText('По роли');
  await menuShot('access-submenu');
  await rows.nth(1).locator('.avatar-access-select').click();
  const listbox = a.locator('.ss-menu');
  await expect(listbox).toBeVisible();
  await expect(listbox.locator('.ss-opt')).toHaveText(['По роли', 'Только просмотр', 'Скрыта']);
  await menuShot('access-select', 150);
  await listbox.locator('.ss-opt', { hasText: 'Скрыта' }).click();
  // нажатие в выпадающем списке меню не закрыло; Еноту страница пропала, Капибаре — нет
  await expect(menu).toBeVisible();
  await expect.poll(() => guestPages(g2), { timeout: 10000 }).toBe(1);
  expect(await guestPages(g1)).toBe(2);
  await expect(rows.nth(1).locator('.avatar-access-select')).toContainText('Скрыта');
  await menuShot('access-hidden');
  // назад — Esc возвращает в меню, ещё раз — закрывает; при новом открытии видно сохранённое право
  await a.keyboard.press('Escape');
  await expect(accessItem).toBeVisible();
  await a.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  // перезаход: Енот перезагрузил вкладку — право сохранилось за ним, страница по-прежнему скрыта
  await g2.reload();
  await expect(group.locator('.user-avatar[aria-label^="Енот"]')).toHaveCount(1, { timeout: 15000 });
  await g2.waitForFunction(() => !!(window as any).__doska);
  await expect(g2.locator('body')).toHaveClass(/collab-guest/, { timeout: 15000 });
  await expect.poll(() => guestPages(g2), { timeout: 15000 }).toBe(1);
  await group.hover();
  await group.locator('.user-avatar[aria-label^="Енот"]').click();
  await accessItem.click();
  await expect(rows.nth(1).locator('.avatar-access-select')).toContainText('Скрыта');
  await menuShot('access-after-rejoin');
  await rows.nth(1).locator('.avatar-access-select').click();
  await listbox.locator('.ss-opt', { hasText: 'По роли' }).click();
  await expect.poll(() => guestPages(g2), { timeout: 10000 }).toBe(2);
  await menu.locator('[data-action="back"]').click();
  await expect(accessItem).toBeVisible();

  // «Исключить»: с подтверждением; гость видит причину, у автора аватар исчезает
  const remove = menu.locator('[data-action="remove"]');
  await remove.click();
  await expect(remove).toContainText('Нажмите ещё раз, чтобы исключить');
  await remove.click();
  await expect(g2.locator('#collab-notice')).toContainText('Вас отключили от доски', { timeout: 10000 });
  await expect(group.locator('.user-avatar')).toHaveCount(2, { timeout: 10000 });

  await A.close();
  await G1.close();
  await G2.close();
});
