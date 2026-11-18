// Ночь №6, защита чужих элементов (SPEC_NIGHT6 §4): ученица-редактор правит и стирает своё, но не трогает
// условие учителя; её Undo не откатывает правку учителя; после переподключения свои элементы снова её.
import { expect, test } from '@playwright/test';
import { Board } from './fixtures';
import { createInvite, device, login, openAt, shareTab, stateOf, useNight5Server } from './night5-helpers';

const env = useNight5Server();

test.describe('защита чужих элементов', () => {
  test('своё — правится и стирается, учителя — нет (подсказка); Undo не трогает учителя; переподключение — своё снова своё', async ({ browser }) => {
    const { base, srv } = env.get();
    const teacher = await login(base, 'teacher-protect@abax.example');
    const A = await device(browser, base, { session: teacher.token, name: 'Лемур' });
    const a = await openAt(A, `${base}/`, env.errors);
    const boardA = new Board(a);
    await boardA.rect(400, 300, 520, 380);
    const link = await createInvite(a, 'editor');
    await shareTab(a, 'settings');
    await a.locator('#share-dialog input[data-field="protectElements"]').check();
    const pid = await stateOf(a, st => st.project.id as string);
    await expect.poll(() => srv.rooms.projectOf(pid)?.permissions?.protectElements, { timeout: 10000 }).toBe(true);
    await a.locator('#btn-share').click();
    const roomEls = () => srv.rooms.projectOf(pid)!.pages[0].elements as any[];
    const teacherId = roomEls()[0].id as string;

    const S = await device(browser, base, { name: 'Аня' });
    const s = await openAt(S, link, env.errors, 'guest');
    const boardS = new Board(s);
    await expect(s.locator('#toolbar')).toBeVisible({ timeout: 10000 });
    await expect.poll(() => stateOf(s, st => st.board.elements.length), { timeout: 10000 }).toBe(1);
    // своя фигура: автора ставит хаб — вошедшая с сессией устройства ученица
    await boardS.rect(100, 100, 160, 160);
    await expect.poll(() => roomEls().length, { timeout: 10000 }).toBe(2);
    const mine = roomEls().find(e => e.id !== teacherId)!;
    expect(mine.by).toMatch(/^u:/);
    // автора своей фигуры ученица получает от хаба
    await expect.poll(() => s.evaluate(id => (window as any).__doska.state.board.elements.find((e: any) => e.id === id)?.by, mine.id), { timeout: 10000 }).toBe(mine.by);

    // элемент учителя: не выделяется, подсказка при наведении, Delete его не стирает
    await boardS.tool('v');
    await boardS.move({ x: 460, y: 340 });
    await expect(s.locator('#board')).toHaveAttribute('title', 'Элемент преподавателя');
    await boardS.click({ x: 460, y: 340 });
    expect(await stateOf(s, st => st.selection.size)).toBe(0);
    await s.keyboard.press('Delete');
    await s.waitForTimeout(300);
    expect(roomEls().some(e => e.id === teacherId)).toBe(true);
    // рамкой, задевающей обе фигуры, выделяется только своё
    await boardS.drag([{ x: 460, y: 130 }, { x: 130, y: 340 }]);
    expect(await stateOf(s, st => [...st.selection])).toEqual([mine.id]);
    // своё стирается
    await s.keyboard.press('Delete');
    await expect.poll(() => roomEls().some(e => e.id === mine.id), { timeout: 10000 }).toBe(false);

    // учитель сдвигает свою фигуру; Undo ученицы возвращает её фигуру и не откатывает учителя
    await boardA.tool('v');
    await boardA.drag([{ x: 460, y: 340 }, { x: 560, y: 340 }]);
    // итоговое положение — с доски учителя после отпускания мыши (промежуточные патчи переноса не в счёт)
    const movedX = await a.evaluate(id => (window as any).__doska.state.board.elements.find((e: any) => e.id === id).x as number, teacherId);
    expect(movedX).toBeGreaterThan(450);
    await expect.poll(() => roomEls().find(e => e.id === teacherId)?.x, { timeout: 10000 }).toBe(movedX);
    await expect.poll(() => stateOf(s, st => st.board.elements.find((e: any) => e.type === 'shape')?.x ?? 0), { timeout: 10000 }).toBe(movedX);
    await s.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await s.keyboard.press('Control+z');
    await expect.poll(() => roomEls().some(e => e.id === mine.id), { timeout: 10000 }).toBe(true);
    await s.waitForTimeout(300);
    expect(roomEls().find(e => e.id === teacherId)!.x).toBe(movedX);

    // переподключение (та же вкладка, та же сессия устройства): своя фигура — снова своя
    await s.goto(link);
    await expect(s.locator('body')).toHaveClass(/collab-guest/, { timeout: 15000 });
    await expect.poll(() => stateOf(s, st => st.board.elements.length), { timeout: 10000 }).toBe(2);
    await boardS.tool('v');
    await boardS.click({ x: 130, y: 130 });
    await expect.poll(() => stateOf(s, st => [...st.selection])).toEqual([mine.id]);
    await boardS.click({ x: movedX + 60, y: 340 });
    await expect.poll(() => stateOf(s, st => st.selection.size)).toBe(0);
    await A.close();
    await S.close();
  });

  test('без защиты — как раньше: редактор стирает фигуру учителя', async ({ browser }) => {
    const { base, srv } = env.get();
    const teacher = await login(base, 'teacher-open@abax.example');
    const A = await device(browser, base, { session: teacher.token, name: 'Лемур' });
    const a = await openAt(A, `${base}/`, env.errors);
    await new Board(a).rect(400, 300, 520, 380);
    const link = await createInvite(a, 'editor');
    const pid = await stateOf(a, st => st.project.id as string);
    const S = await device(browser, base, { name: 'Аня' });
    const s = await openAt(S, link, env.errors, 'guest');
    const boardS = new Board(s);
    await expect(s.locator('#toolbar')).toBeVisible({ timeout: 10000 });
    await expect.poll(() => stateOf(s, st => st.board.elements.length), { timeout: 10000 }).toBe(1);
    await boardS.tool('v');
    await boardS.click({ x: 460, y: 340 });
    expect(await stateOf(s, st => st.selection.size)).toBe(1);
    await s.keyboard.press('Delete');
    await expect.poll(() => srv.rooms.projectOf(pid)!.pages[0].elements.length, { timeout: 10000 }).toBe(0);
    await A.close();
    await S.close();
  });
});
