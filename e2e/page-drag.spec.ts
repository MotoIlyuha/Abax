import { test, expect } from './fixtures';

for (const copy of [false,true]) test(`перетаскивание на другую страницу: ${copy ? 'копия' : 'перенос'}`, async ({board,page}) => {
  await board.rect(400,300,500,380);
  await board.addPage();
  await page.locator('.page-item').first().click();
  await expect.poll(async () => (await board.elements()).length).toBe(1);
  await board.tool('v');
  const source=(await board.state()).pageId;
  const start=await board.screen({x:450,y:340});
  const target=(await page.locator('.page-item').nth(1).boundingBox())!;
  if(copy) await page.keyboard.down('Alt');
  await page.mouse.move(start.x,start.y); await page.mouse.down();
  await page.mouse.move(start.x+20,start.y+20);
  await page.mouse.move(target.x+target.width/2,target.y+target.height/2,{steps:5});
  await expect.poll(async () => (await board.state()).pageId).not.toBe(source);
  await page.mouse.move(650,400); await page.mouse.up();
  if(copy) await page.keyboard.up('Alt');
  await expect.poll(async () => (await board.elements()).length).toBe(1);
  await page.locator('.page-item').first().click();
  await expect.poll(async () => (await board.state()).pageId).toBe(source);
  expect(await board.count()).toBe(copy ? 1 : 0);
});

test('во время переноса исходные объекты скрыты только на холсте и возвращаются при отмене', async ({board,page}) => {
  const item=await board.rect(400,300,500,380);
  await board.addPage(); await page.locator('.page-item').first().click();
  await expect.poll(async () => (await board.elements()).length).toBe(1);
  await board.tool('v');
  const start=await board.screen({x:450,y:340});
  const tray=(await page.locator('#pages-tray').boundingBox())!;
  await page.mouse.move(start.x,start.y); await page.mouse.down();
  await page.mouse.move(start.x+20,start.y+20);
  await page.mouse.move(tray.x+tray.width-5,tray.y+5);
  await expect.poll(() => page.evaluate(() => Array.from((window as any).__doska.state.dragHidden?.ids ?? []))).toEqual([item.id]);
  expect(await board.count()).toBe(1);
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => (window as any).__doska.state.dragHidden)).toBeNull();
  expect(await board.count()).toBe(1);
  await page.mouse.up();
});

test('перенос через страницу на холсте с переходом по наведению', async ({board,page}) => {
  await board.rect(300,250,400,320);
  await board.addPage();
  const destination=(await board.state()).pageId;
  await page.locator('.page-item').first().click();
  const source=(await board.state()).pageId;
  await page.evaluate(dest => {
    const d=(window as any).__doska;
    d.state.settings.pageLinks=true;
    d.state.board.elements.push({id:'page-link-test',type:'image',src:'',page:dest,x:600,y:200,w:250,h:180});
    d.requestRender();
  },destination);
  await board.tool('v');
  const start=await board.screen({x:350,y:285}), target=await board.screen({x:700,y:290});
  await page.mouse.move(start.x,start.y); await page.mouse.down();
  await page.mouse.move(start.x+20,start.y+10);
  await page.mouse.move(target.x,target.y,{steps:5});
  await expect.poll(async () => (await board.state()).pageId, {timeout:7000}).toBe(destination);
  await page.mouse.up();
  await expect.poll(async () => (await board.elements()).filter(e=>!e.page).length).toBe(1);
  await page.locator('.page-item').first().click();
  await expect.poll(async () => (await board.state()).pageId).toBe(source);
  expect((await board.elements()).filter(e=>!e.page)).toHaveLength(0);
});
