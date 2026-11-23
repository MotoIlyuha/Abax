import { beforeEach, expect, it, vi } from 'vitest';
import { TutorStore } from '../../src/tutor-store';
import { ApiError, type ApiClient } from '../../src/api-client';
import { emptyBook } from '../../src/tutor-local';

beforeEach(() => localStorage.clear());
it('работает без API, восстанавливает кабинет, финансовую операцию и страницу после перезагрузки', async () => {
  const fetchSpy = vi.spyOn(globalThis,'fetch');
  try {
    const local = new TutorStore(null);
    await local.init();
    const sid = (await local.act('student','',{name:'Вера'})).id!;
    const lid = (await local.act('lesson','',{ student_id:sid,start_at:Date.now() })).id!;
    await local.act('balance',sid,{ amount:5000 });
    const first = await local.act('start',lid);
    const again = new TutorStore(null);
    await again.init();
    expect((await again.act('start',lid)).pageId).toBe(first.pageId);
    await again.act('editLesson',lid,{status:'unpaid'});
    expect(again.book.students[0].balance).toBe(3000);
    expect(again.book.payments).toHaveLength(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally { fetchSpy.mockRestore(); }
});
it('повторяет офлайн-команду с тем же ключом и получает серверный снимок', async () => {
  const book = emptyBook();
  let connected = true;
  const request = vi.fn(async (_method:string,path:string,body?:Record<string,unknown>) => {
    if (!connected) throw new ApiError(0,'network');
    if (path.endsWith('snapshot')) return { ...book,accountId:'owner' };
    return { id:body?.id };
  });
  const api = { base:'https://example.test', me:async () => ({ user:{id:'owner'} }),request } as unknown as ApiClient;
  const store = new TutorStore(api);
  await store.init();
  connected = false;
  await store.act('student','',{name:'Саша'});
  expect(store.pending).toBe(1);
  connected = true;
  await store.refresh();
  const attempts = request.mock.calls.filter(c => c[1].endsWith('students'));
  expect(attempts).toHaveLength(2);
  expect(attempts[1][2]?.operationId).toBe(attempts[0][2]?.operationId);
  expect(store.pending).toBe(0);
});
