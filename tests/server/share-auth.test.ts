import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createShareServer } = require('../../electron/share.cjs');

const CODE = 'ROOM42';
const project = {
  id: 'p1', name: 'Проект', createdAt: 1, updatedAt: 2,
  pages: [
    { id: 'pg1', name: 'Открытая', grid: 'square', elements: [] },
    { id: 'pg2', name: 'Скрытая', grid: 'square', elements: [] },
  ],
};

type Msg = Record<string, any>;
interface Client { ws: WebSocket; inbox: Msg[]; closed: Promise<{ code: number; reason: string }> }

let server: any;

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

function connect(query: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws${query}`);
    const inbox: Msg[] = [];
    const closed = new Promise<{ code: number; reason: string }>(r => {
      ws.addEventListener('close', ev => r({ code: ev.code, reason: ev.reason }));
    });
    ws.addEventListener('message', ev => inbox.push(JSON.parse(String(ev.data))));
    ws.addEventListener('open', () => resolve({ ws, inbox, closed }));
    ws.addEventListener('error', reject);
  });
}

async function waitFor<T>(fn: () => T | undefined, what: string): Promise<T> {
  for (let i = 0; i < 60; i++) {
    const v = fn();
    if (v !== undefined) return v;
    await wait(25);
  }
  throw new Error(`не дождались: ${what}`);
}

const waitInit = (c: Client) => waitFor(() => c.inbox.find(m => m.t === 'init'), 'init');

const hostQuery = (key: string = server.hostKey) => `?code=${CODE}&host=1&key=${encodeURIComponent(key)}`;
const guestQuery = `?code=${CODE}`;

async function connectHost(): Promise<Client> {
  const host = await connect(hostQuery());
  await waitInit(host);
  host.ws.send(JSON.stringify({ t: 'project', project }));
  await waitFor(() => server.room.project ?? undefined, 'проект хоста');
  return host;
}

beforeEach(async () => {
  server = await createShareServer({ port: 0, code: CODE });
});

afterEach(() => {
  server.close();
});

describe('share server: host auth', () => {
  it('генерирует hostKey, отличный от кода комнаты', () => {
    expect(typeof server.hostKey).toBe('string');
    expect(server.hostKey.length).toBeGreaterThanOrEqual(24);
    expect(server.hostKey).not.toContain(CODE);
  });

  it('host с правильным ключом получает uid 0', async () => {
    const host = await connectHost();
    expect(host.inbox.find(m => m.t === 'init')!.userId).toBe(0);
  });

  it('host=1 без ключа отклоняется и не получает uid 0', async () => {
    await connectHost();
    const fake = await connect(`?code=${CODE}&host=1`);
    const { code } = await fake.closed;
    expect(code).toBe(4401);
    expect(fake.inbox.some(m => m.t === 'init')).toBe(false);
  });

  it('host=1 с неверным ключом не получает скрытые страницы', async () => {
    await connectHost();
    // при старом поведении любой host=1 получал весь проект, включая скрытые страницы
    const fake = await connect(hostQuery('wrong-key'));
    expect((await fake.closed).code).toBe(4401);
    expect(fake.inbox.some(m => m.t === 'init' || m.t === 'project')).toBe(false);
  });

  it('host=1 с кодом комнаты вместо ключа отклоняется', async () => {
    const fake = await connect(hostQuery(CODE));
    expect((await fake.closed).code).toBe(4401);
  });

  it('поддельный host не может перезаписать проект', async () => {
    await connectHost();
    const fake = await connect(`?code=${CODE}&host=1&key=`);
    await fake.closed;
    expect(server.room.project.pages).toHaveLength(2);
    expect([...server.room.clients.values()].filter((c: Msg) => c.host)).toHaveLength(1);
  });

  it('второе host-подключение отклоняется, пока первое активно', async () => {
    const host = await connectHost();
    const second = await connect(hostQuery());
    expect((await second.closed).code).toBe(4409);
    expect(host.ws.readyState).toBe(WebSocket.OPEN);
    // после отключения первого автор может переподключиться
    host.ws.close();
    await host.closed;
    await waitFor(() => (server.room.clients.size === 0 ? true : undefined), 'отключение хоста');
    const again = await connect(hostQuery());
    expect((await waitInit(again)).userId).toBe(0);
  });
});

describe('share server: room code', () => {
  it('гость без кода комнаты отклоняется', async () => {
    const g = await connect('');
    expect((await g.closed).code).toBe(4403);
  });

  it('гость с неверным кодом отклоняется', async () => {
    const g = await connect('?code=NOPE00');
    expect((await g.closed).code).toBe(4403);
  });

  it('гость с верным кодом получает uid > 0 и view-права', async () => {
    await connectHost();
    const g = await connect(guestQuery);
    const init = await waitInit(g);
    expect(init.userId).toBeGreaterThan(0);
    expect(init.rights.default).toBe('view');
    expect(init.project.pages).toHaveLength(2);
  });

  it('гость не видит страницы, скрытые автором', async () => {
    const host = await connectHost();
    const g = await connect(guestQuery);
    const init = await waitInit(g);
    server.setRights(init.userId, { pages: { pg2: 'hidden' } });
    host.ws.send(JSON.stringify({ t: 'project', project }));
    const msg = await waitFor(() => g.inbox.find(m => m.t === 'project'), 'проект гостю');
    expect(msg.project.pages.map((p: Msg) => p.id)).toEqual(['pg1']);
  });

  it('гость не может задать первый проект до автора', async () => {
    const g = await connect(guestQuery);
    await waitInit(g);
    g.ws.send(JSON.stringify({ t: 'project', project }));
    await wait(100);
    expect(server.room.project).toBeNull();
  });

  it('гость с view-правами не может изменить страницу', async () => {
    await connectHost();
    const g = await connect(guestQuery);
    await waitInit(g);
    const hacked = structuredClone(project);
    hacked.pages[0].elements = [{ id: 'x' }] as never[];
    g.ws.send(JSON.stringify({ t: 'project', project: hacked }));
    await wait(100);
    expect(server.room.project.pages[0].elements).toHaveLength(0);
  });
});
