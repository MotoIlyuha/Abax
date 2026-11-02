import { test, expect } from './fixtures';

test('Alt-перетаскивание копирует группу и отменяется одним действием', async ({board, page}) => {
  const a=await board.rect(400,300,450,350);
  const b=await board.rect(500,300,550,350);
  await board.tool('v');
  await board.drag([{x:380,y:280},{x:560,y:370}]);
  await page.keyboard.press('Control+g');
  await page.keyboard.down('Alt');
  await board.drag([{x:420,y:320},{x:620,y:420}]);
  await page.keyboard.up('Alt');
  const els=await board.elements();
  expect(els).toHaveLength(4);
  expect(els.slice(0,2).map(e=>e.id)).toEqual([a.id,b.id]);
  expect(els[2].groupId).toBe(els[3].groupId);
  expect(els[2].groupId).not.toBe(els[0].groupId);
  expect(els[2].x).toBeCloseTo(600);
  expect((await board.state()).selection.sort()).toEqual([els[2].id,els[3].id].sort());
  await page.keyboard.press('Control+z');
  expect(await board.count()).toBe(2);
});
