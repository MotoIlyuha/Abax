import { test, expect } from './fixtures';

test('кадрирование сохраняет исходник и позволяет восстановить скрытую область', async ({ board, page }) => {
  await page.evaluate(() => {
    const d = (window as any).__doska;
    d.state.board.elements.push({id:'crop-test', type:'image', x:300, y:200, w:200, h:100, src:'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="100"%3E%3Crect width="200" height="100" fill="red"/%3E%3C/svg%3E'});
    d.requestRender();
  });
  await board.tool('v');
  await board.click({x:400,y:250});
  await page.locator('.qm-crop').click();
  const h = page.locator('.crop-handle[data-dx="-1"][data-dy="0"]');
  const pos = (await h.boundingBox())!;
  await page.mouse.move(pos.x+6,pos.y+6); await page.mouse.down(); await page.mouse.move(pos.x+56,pos.y+6); await page.mouse.up();
  await board.click({x:700,y:500});
  const e = (await board.elements())[0];
  expect(e.x).toBeCloseTo(350); expect(e.w).toBeCloseTo(150); expect(e.crop.x).toBeCloseTo(.25);
  await page.locator('.qm-crop').click();
  await expect(page.locator('.crop-overlay')).toBeVisible();
  const restored = (await page.locator('.crop-handle[data-dx="-1"][data-dy="0"]').boundingBox())!;
  await page.mouse.move(restored.x+6,restored.y+6); await page.mouse.down(); await page.mouse.move(restored.x-44,restored.y+6); await page.mouse.up();
  await board.click({x:700,y:500});
  const result = (await board.elements())[0];
  expect(result.w).toBeCloseTo(200); expect(result.crop.x).toBeCloseTo(0);
  await page.keyboard.press('Control+z');
  expect((await board.elements())[0].crop.x).toBeCloseTo(.25);
});

test('предустановка и колесо меняют область, сохраняя рамку при масштабировании', async ({ board, page }) => {
  await page.evaluate(() => {
    const d=(window as any).__doska;
    d.state.board.elements.push({id:'crop-test',type:'image',x:300,y:200,w:200,h:100,src:'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="100"%3E%3C/svg%3E'});
    d.requestRender();
  });
  await board.tool('v'); await board.click({x:400,y:250}); await page.locator('.qm-crop').click();
  await page.getByRole('button',{name:'1:1',exact:true}).click();
  const before=await page.locator('.crop-frame').boundingBox();
  await page.locator('.crop-frame').hover(); await page.mouse.wheel(0,-400);
  const after=await page.locator('.crop-frame').boundingBox();
  expect(after?.width).toBeCloseTo(before!.width); expect(after?.height).toBeCloseTo(before!.height);
  await board.click({x:700,y:500});
  const image=(await board.elements())[0];
  expect(image.w).toBeCloseTo(image.h); expect(image.crop.w).toBeLessThan(.5);
});
