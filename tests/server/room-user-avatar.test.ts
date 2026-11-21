// Аватар участника (смайл или фото) в комнате: снимок участников несёт только смайл или версию фото,
// само фото — в init.photos и сообщении { t: 'avatar' }. Одинаковые сценарии для src/room-host.ts и electron/room.cjs.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { createRoomHub as createTsHub } from '../../src/room-host';

const require = createRequire(import.meta.url);
const { createRoomHub: createCjsHub } = require('../../electron/room.cjs');

type Msg = Record<string, any>;

class FakeSock {
  readyState = 1;
  sent: Msg[] = [];
  private h: { message: ((raw: any) => void)[]; close: (() => void)[] } = { message: [], close: [] };
  send(text: string) { this.sent.push(JSON.parse(text)); }
  close() { if (this.readyState !== 1) return; this.readyState = 3; this.h.close.forEach(fn => fn()); }
  on(ev: 'message' | 'close', fn: any) { this.h[ev].push(fn); }
  recv(m: unknown) { this.h.message.forEach(fn => fn(JSON.stringify(m))); }
  last(t: string) { return [...this.sent].reverse().find(m => m.t === t); }
  all(t: string) { return this.sent.filter(m => m.t === t); }
  me(uid: number) { return this.last('users')?.users.find((u: Msg) => u.userId === uid); }
}

const project = {
  id: 'demo', name: 'Демо', createdAt: 1, updatedAt: 2,
  pages: [{ id: 'pg1', name: 'Первая', grid: 'square', elements: [] as unknown[] }],
};

const kinds = [
  { name: 'src/room-host.ts', make: () => createTsHub({ code: 'R', plan: 'pro' }) },
  { name: 'electron/room.cjs', make: () => createCjsHub({ code: 'R' }) },
];

const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
const PHOTO2 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAg==';

function room(hub: any) {
  const host = new FakeSock();
  hub.attach(host, { isHost: true, name: 'Учитель' });
  host.recv({ t: 'project', project });
  const join = (name = 'Гость') => {
    const s = new FakeSock();
    const uid = hub.attach(s, { name }) as number;
    return { s, uid };
  };
  return { host, join };
}

describe.each(kinds)('$name', kind => {
  it('пока участник не сообщил об аватаре, поля нет; буквы - null', () => {
    const { host, join } = room(kind.make());
    const a = join('Аня');
    expect(host.me(a.uid)).not.toHaveProperty('avatar');
    a.s.recv({ t: 'profile', cursorId: 'default', avatar: null });
    expect(host.me(a.uid).avatar).toBeNull();
  });

  it('смайл идёт в снимке участников', () => {
    const { host, join } = room(kind.make());
    const a = join('Аня');
    a.s.recv({ t: 'profile', avatar: '🦊' });
    expect(host.me(a.uid).avatar).toBe('🦊');
    expect(a.s.me(a.uid).avatar).toBe('🦊');
  });

  it('фото - отдельным сообщением до снимка; в снимке только версия', () => {
    const { host, join } = room(kind.make());
    const a = join('Аня');
    const b = join('Боря');
    const before = host.sent.length;
    a.s.recv({ t: 'profile', avatar: PHOTO });
    const tail = host.sent.slice(before);
    const iAvatar = tail.findIndex(m => m.t === 'avatar');
    const iUsers = tail.findIndex(m => m.t === 'users');
    expect(iAvatar).toBeGreaterThanOrEqual(0);
    expect(iAvatar).toBeLessThan(iUsers);
    expect(tail[iAvatar]).toEqual({ t: 'avatar', userId: a.uid, photo: PHOTO });
    expect(b.s.last('avatar')).toEqual({ t: 'avatar', userId: a.uid, photo: PHOTO });
    expect(host.me(a.uid).avatar).toBe('photo:1');
    // снимки участников (их шлют на каждое движение курсора) фото не содержат
    a.s.recv({ t: 'cursor', x: 1, y: 2, pageId: 'pg1' });
    expect(JSON.stringify(host.last('users'))).not.toContain('base64');
    // новое фото — новая версия
    a.s.recv({ t: 'profile', avatar: PHOTO2 });
    expect(host.me(a.uid).avatar).toBe('photo:2');
  });

  it('новый участник получает фото остальных в init.photos', () => {
    const { join } = room(kind.make());
    const a = join('Аня');
    a.s.recv({ t: 'profile', avatar: PHOTO });
    const c = join('Вова');
    const init = c.s.last('init')!;
    expect(init.photos).toEqual({ [a.uid]: PHOTO });
    expect(init.users.find((u: Msg) => u.userId === a.uid).avatar).toBe('photo:1');
  });

  it('то же значение - без рассылки; неподходящее - не принимается', () => {
    const { host, join } = room(kind.make());
    const a = join('Аня');
    a.s.recv({ t: 'profile', avatar: '🦊' });
    const n = host.all('users').length;
    a.s.recv({ t: 'profile', avatar: '🦊' });
    expect(host.all('users').length).toBe(n);
    for (const bad of ['лиса', '<img src=x>', 'data:image/svg+xml;base64,PHN2Zz4=', 42, { a: 1 }]) a.s.recv({ t: 'profile', avatar: bad });
    expect(host.me(a.uid).avatar).toBe('🦊');
    expect(host.all('users').length).toBe(n);
    // имя без аватара — аватар прежний
    a.s.recv({ t: 'profile', name: 'Анна' });
    expect(host.me(a.uid)).toMatchObject({ name: 'Анна', avatar: '🦊' });
    // null — снова буквы
    a.s.recv({ t: 'profile', avatar: null });
    expect(host.me(a.uid).avatar).toBeNull();
  });
});
