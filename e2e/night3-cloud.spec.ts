// Ночь №3: облако. Два полностью изолированных браузерных контекста (свой localStorage, разные «устройства»)
// и настоящий сервер Abax в процессе теста (база в памяти, клиент раздаётся из dist/).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createAppServer, type AppServer } from '../server/app';
import { Board, skipOnboarding } from './fixtures';

let srv: AppServer;
let base = '';
let tmp = '';

test.beforeAll(async () => {
  tmp = mkdtempSync(path.join(tmpdir(), 'abax-e2e-'));
  srv = createAppServer({
    dbPath: ':memory:', assetsDir: path.join(tmp, 'assets'), jwtSecret: 'e2e-secret', enforceLimits: true,
    staticDir: path.join(__dirname, '..', 'dist'), roomSaveMs: 50,
  });
  base = (await srv.listen(0, '127.0.0.1')).url;
});
test.afterAll(async () => {
  await srv.close();
  rmSync(tmp, { recursive: true, force: true });
});

const errors: string[] = [];
test.afterEach(() => { expect(errors.splice(0), 'ошибки JS на страницах').toEqual([]); });

/** Отдельное «устройство»: свой контекст, пустой localStorage, облако — на тестовый сервер. */
async function device(browser: Browser): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU' });
  await ctx.route(/^https:\/\/(api\.)?github\.com\//, r => r.abort());
  await ctx.addInitScript(url => localStorage.setItem('doska.apiUrl', url), base);
  await skipOnboarding(ctx);
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  return ctx;
}

async function openAt(ctx: BrowserContext, url: string, ready: 'board' | 'link' | 'guest' = 'board'): Promise<Page> {
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url);
  await page.waitForFunction(() => !!(window as any).__doska);
  if (ready === 'board') await expect(page.locator('#toolbar .tool').first()).toBeVisible();
  if (ready === 'link') await expect(page.locator('#link-banner')).toBeVisible();
  if (ready === 'guest') await expect(page.locator('body')).toHaveClass(/collab-guest/);
  return page;
}

const stateOf = <T>(page: Page, fn: (s: any) => T): Promise<T> => page.evaluate(`(${fn.toString()})(window.__doska.state)`) as Promise<T>;

async function makePng(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 240; c.height = 120;
    const x = c.getContext('2d')!;
    x.fillStyle = '#3366ff';
    x.fillRect(0, 0, 240, 120);
    return c.toDataURL('image/png').split(',')[1];
  });
  return Buffer.from(b64, 'base64');
}

/** Задание через форму из меню логотипа. */
async function addTask(page: Page, statement: string, answer: string): Promise<void> {
  await page.locator('#btn-home').click();
  await page.locator('#main-menu [data-action="task"]').click();
  const dlg = page.locator('#task-dialog');
  await expect(dlg).toBeVisible();
  const f = (label: string) => dlg.locator('.td-field', { has: page.locator('.td-label', { hasText: new RegExp(`^${label}$`) }) }).locator('input, textarea, select');
  await f('Условие').fill(statement);
  await f('Правильный ответ').fill(answer);
  await dlg.locator('.td-save').click();
  await expect(dlg).toBeHidden();
}

async function addImage(page: Page): Promise<void> {
  const png = await makePng(page);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#btn-image').click()]);
  await chooser.setFiles({ name: 'graph.png', mimeType: 'image/png', buffer: png });
  await expect.poll(() => new Board(page).count('image')).toBe(1);
}

const projectRow = (id: string) => srv.db.prepare('SELECT rev, data_json FROM projects WHERE id = ?').get(id) as { rev: number; data_json: string } | undefined;
const sessionOf = (page: Page) => page.evaluate(() => localStorage.getItem('doska.session'));
const userIdOf = async (page: Page): Promise<string> => {
  await expect.poll(() => sessionOf(page)).toBeTruthy();
  return page.evaluate(async () => {
    const r = await fetch('/api/me', { headers: { Authorization: `Bearer ${localStorage.getItem('doska.session')}` } });
    return (await r.json()).user.id as string;
  });
};

test.describe('облако', () => {
  test('чужой проект по ссылке: с пустого устройства видна картинка, ответа в сети нет, клон - своя копия', async ({ browser }) => {
    // Автор (устройство А): картинка и задание с ответом 42
    const A = await device(browser);
    const a = await openAt(A, `${base}/`);
    const boardA = new Board(a);
    await addImage(a);
    await addTask(a, 'Сколько будет 6×7?', '42');
    await boardA.saved();
    const pid = await stateOf(a, s => s.project.id as string);
    // на сервер уходит с паузой: ждём версию, где уже есть и картинка, и задание
    await expect.poll(() => { const t = projectRow(pid)?.data_json ?? ''; return t.includes('"type":"task"') && t.includes('asset://'); }, { timeout: 15000 }).toBe(true);
    const stored = projectRow(pid)!.data_json;
    expect(stored).toContain('asset://');
    expect(stored).not.toContain('base64'); // картинка вынесена в хранилище, в проекте ссылка

    // публичная ссылка — из меню экспорта
    await a.locator('#btn-export').click();
    await a.locator('#export-menu [data-action="link-project"]').click();
    const link = await a.evaluate(() => navigator.clipboard.readText());
    expect(link).toContain(`${base}/?route=project&projectId=${pid}`);

    // Читатель (устройство Б): пустой localStorage, свой контекст
    const B = await device(browser);
    const bodies: string[] = [];
    B.on('response', async r => { if (/\/api\/projects\//.test(r.url()) && r.request().method() === 'GET') bodies.push(await r.text().catch(() => '')); });
    const b = await openAt(B, link, 'link');
    expect(await stateOf(b, s => s.linkMode)).toBe('view-project');
    await expect.poll(() => bodies.length).toBeGreaterThan(0);
    // в ответе сервера ответа задания нет
    for (const text of bodies) {
      expect(text).toContain('"type":"task"');
      expect(text).not.toContain('"answer":"42"');
      expect(text).toContain('"answer":""');
    }
    // картинка пришла и подставлена вместо ссылки
    const imgSrc = await stateOf(b, s => (s.board.elements.find((e: any) => e.type === 'image')?.src ?? '').slice(0, 22));
    expect(imgSrc).toBe('data:image/png;base64,');
    expect(await stateOf(b, s => s.board.elements.find((e: any) => e.type === 'task').answer)).toBe('');
    // только чтение
    await expect(b.locator('#toolbar')).toBeHidden();

    // клонирование: редактируемая копия на устройстве Б
    await b.locator('#link-banner .lb-clone').click();
    await expect(b.locator('#link-banner')).toBeHidden();
    expect(await stateOf(b, s => s.linkMode)).toBeNull();
    const cloneId = await stateOf(b, s => s.project.id as string);
    expect(cloneId).not.toBe(pid);
    expect(await stateOf(b, s => s.project.name as string)).toContain('(копия)');
    await expect(b.locator('#toolbar .tool').first()).toBeVisible();
    const boardB = new Board(b);
    await boardB.rect(500, 300, 640, 400);
    await boardB.saved();
    expect(await boardB.count('shape')).toBe(1);
    expect(await boardB.count('image')).toBe(1);
    expect(await stateOf(b, s => s.board.elements.find((e: any) => e.type === 'task')?.answer)).toBe('');
    expect(await b.evaluate(id => !!localStorage.getItem(`doska.p.${id}`), cloneId)).toBe(true);
    // и на сервере копия принадлежит Б, а не автору
    await expect.poll(() => (srv.db.prepare('SELECT owner_id FROM projects WHERE id = ?').get(cloneId) as { owner_id: string } | undefined)?.owner_id).toBe(await userIdOf(b));
    expect(await userIdOf(b)).not.toBe(await userIdOf(a));
    await A.close();
    await B.close();
  });

  test('приглашение: Pro-автор закрыл вкладку, ученик в комнате отвечает «42» - автор потом видит попытку', async ({ browser }) => {
    const A = await device(browser);
    const a = await openAt(A, `${base}/`);
    await addTask(a, 'Сколько будет 6×7?', '42');
    await new Board(a).saved();
    const pid = await stateOf(a, s => s.project.id as string);
    await expect.poll(() => (projectRow(pid)?.data_json ?? '').includes('"type":"task"'), { timeout: 15000 }).toBe(true);
    // Pro — выдаёт оператор (платежей ещё нет)
    const uid = await userIdOf(a);
    srv.db.prepare("UPDATE users SET plan = 'pro' WHERE id = ?").run(uid);

    // ссылка-приглашение — из окна «Совместная работа»
    // Ночь №6: общая ссылка включается выключателем в окне «Поделиться»
    await a.locator('#btn-share').click();
    const box = a.locator('#share-dialog .share-invite');
    await expect(box).toBeVisible();
    await box.locator('.share-switch').click();
    await expect(box.locator('.share-url')).toBeVisible();
    const inviteLink = await box.locator('.share-url').inputValue();
    expect(inviteLink).toMatch(/\?route=collab&token=[A-Za-z0-9_-]{24}$/);
    // автор сам подключился к своей облачной комнате
    await expect.poll(() => stateOf(a, s => s.collabRole)).toBe('host');
    // и закрывает вкладку: комната должна жить без него
    await a.close();
    await expect.poll(() => srv.rooms.connections(pid)).toBe(0);

    // Ученик (другое устройство) открывает приглашение
    const B = await device(browser);
    const b = await openAt(B, inviteLink, 'guest');
    const panel = b.locator('.task-panel');
    await expect(panel).toBeVisible();
    // ответа у ученика нет
    expect(await stateOf(b, s => s.board.elements.find((e: any) => e.type === 'task').answer)).toBe('');
    await panel.locator('.task-input').fill('41');
    await panel.locator('.task-check').click();
    await expect(panel.locator('.task-result')).toHaveText('Неверно (попыток: 1)');
    await panel.locator('.task-input').fill('42');
    await panel.locator('.task-check').click();
    await expect(panel.locator('.task-result')).toHaveText('Верно!');
    expect(await stateOf(b, s => s.board.elements.find((e: any) => e.type === 'task').answer)).toBe('');
    // попытки записаны на сервере, пока автора нет
    await expect.poll(() => (JSON.parse(projectRow(pid)!.data_json).pages[0].elements.find((e: any) => e.type === 'task').attempts ?? []).length, { timeout: 10000 }).toBe(2);

    // Автор возвращается в тот же контекст: видит засчитанную попытку
    const a2 = await openAt(A, `${base}/`);
    await expect.poll(() => stateOf(a2, s => (s.project.pages[0].elements.find((e: any) => e.type === 'task')?.attempts ?? []).map((t: any) => t.isCorrect)), { timeout: 10000 }).toEqual([false, true]);
    expect(await stateOf(a2, s => s.project.pages[0].elements.find((e: any) => e.type === 'task').answer)).toBe('42');
    await A.close();
    await B.close();
  });

  test('сервер сам держит лимиты бесплатного тарифа: четвёртый проект и четвёртая страница - отказ 403', async ({ browser }) => {
    const A = await device(browser);
    const a = await openAt(A, `${base}/`);
    await userIdOf(a);
    const put = (id: string, pages: number) => a.evaluate(async ([id, pages]) => {
      const project = { id, name: id, createdAt: 1, updatedAt: 1, pages: Array.from({ length: pages as number }, (_, i) => ({ id: `${id}-${i}`, name: `С${i}`, grid: 'square', elements: [] })) };
      const r = await fetch(`/api/projects/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('doska.session')}` }, body: JSON.stringify({ project }),
      });
      return { status: r.status, body: await r.json() };
    }, [id, pages] as const);
    // нетронутая стартовая доска в облако не уходит (SPEC_NIGHT5 §2.1) — все три места свободны
    expect((await put('lim-0', 1)).status).toBe(200);
    expect((await put('lim-1', 1)).status).toBe(200);
    expect((await put('lim-2', 1)).status).toBe(200);
    const fourth = await put('lim-3', 1);
    expect(fourth.status).toBe(403);
    expect(fourth.body.error).toBe('plan-limit-projects');
    // четвёртая страница
    const pages = await put('lim-1', 4);
    expect(pages.status).toBe(403);
    expect(pages.body.error).toBe('plan-limit-pages');
    expect((await put('lim-1', 3)).status).toBe(200);
    await A.close();
  });
});
