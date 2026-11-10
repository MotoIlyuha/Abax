// Автор через облачный ретранслятор: настоящий ретранслятор (relay/server.cjs), настоящий сервер
// совместной работы (electron/share.cjs) и подключение автора к облаку (electron/cloud-link.cjs).
// Гость — «голый» WebSocket к ретранслятору: так видно, что именно уходит по сети.
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const WebSocket = require('ws');
const { createRelay } = require('../../relay/server.cjs');
const { CLOSE } = require('../../relay/protocol.cjs');
const { createShareServer } = require('../../electron/share.cjs');
const { PROTO } = require('../../electron/room.cjs');
const { createCloudLink, normalizeRelayUrl, cloudGuestUrl, KICK } = require('../../electron/cloud-link.cjs');

type Msg = Record<string, any>;
interface Peer { ws: any; inbox: Msg[]; closed: Promise<{ code: number; reason: string }> }

const demo = () => ({
  id: 'demo', name: 'Демо', createdAt: 1, updatedAt: 2,
  pages: [
    { id: 'pg1', name: 'Первая', grid: 'square', elements: [] as unknown[] },
    { id: 'pg2', name: 'Вторая', grid: 'square', elements: [] as unknown[] },
  ],
});
const rect = (id: string) => ({ id, type: 'shape', shape: 'rect', x: 0, y: 0, w: 1, h: 1, color: '#000', width: 1 });

async function until<T>(fn: () => T | undefined | null | false, ms = 3000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('условие не выполнилось за отведённое время');
    await new Promise(r => setTimeout(r, 10));
  }
}

/** Сокеты автора к ретранслятору — чтобы оборвать соединение, как при пропавшей сети. */
const hostSockets: any[] = [];
class TrackedWebSocket extends WebSocket {
  constructor(...args: any[]) { super(...args); hostSockets.push(this); }
}
const dropHostConnection = () => hostSockets.at(-1).terminate();

let relay: any;
let share: any;
let link: any;
const peers: Peer[] = [];
let relayUrl: string;

function peer(url: string): Promise<Peer> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const inbox: Msg[] = [];
    const closed = new Promise<{ code: number; reason: string }>(r => ws.on('close', (code: number, reason: Buffer) => r({ code, reason: reason.toString() })));
    ws.on('message', (d: Buffer) => { try { inbox.push(JSON.parse(d.toString())); } catch { /* не JSON */ } });
    ws.on('open', () => { const p = { ws, inbox, closed }; peers.push(p); resolve(p); });
    ws.on('error', reject);
  });
}
const last = (p: Peer, t: string) => [...p.inbox].reverse().find(m => m.t === t);
const send = (p: Peer, m: unknown) => p.ws.send(JSON.stringify(m));

/** Ретранслятор, сервер с автором (по локальному WebSocket, как окно приложения) и облачное подключение. */
async function setup(opts: { relay?: Record<string, unknown>; link?: Record<string, unknown> } = {}) {
  relay = await createRelay({ port: 0, host: '127.0.0.1', statsIntervalMs: 0, log: () => {}, ...opts.relay });
  relayUrl = `ws://127.0.0.1:${relay.port}`;
  share = await createShareServer({ port: 0, code: 'ROOM42' });
  const host = await peer(`ws://127.0.0.1:${share.port}/ws?code=ROOM42&host=1&key=${encodeURIComponent(share.hostKey)}&name=${encodeURIComponent(encodeURIComponent('Учитель'))}`);
  await until(() => last(host, 'init'));
  send(host, { t: 'project', project: demo() });
  await until(() => share.room.project);
  const changes: string[] = [];
  link = createCloudLink({
    relayUrl, attach: share.attach, refresh: share.refresh, WebSocketImpl: TrackedWebSocket,
    onChange: () => changes.push(link?.status().state), backoffMs: [20, 40], ...opts.link,
  });
  await link.start();
  return { host, changes };
}

/** Гость через ретранслятор: подключается и представляется. */
async function cloudGuest(name = 'Маша', hello: unknown = { t: 'hello', proto: PROTO, name }): Promise<Peer> {
  const g = await peer(`${relayUrl}/g/${link.status().room}`);
  if (hello !== null) send(g, hello);
  return g;
}

afterEach(async () => {
  hostSockets.length = 0;
  link?.stop();
  link = null;
  for (const p of peers.splice(0)) p.ws.terminate();
  share?.close();
  share = null;
  await relay?.close();
  relay = null;
});

describe('гость из интернета в комнате автора', () => {
  it('после hello получает init с проектом, именем и правами просмотра', async () => {
    const { host } = await setup();
    expect(link.status()).toMatchObject({ state: 'online', guests: 0 });
    const g = await cloudGuest('Маша');
    const init = await until(() => last(g, 'init'));
    expect(init).toMatchObject({ proto: PROTO, name: 'Маша', rights: { default: 'view' } });
    expect(init.project.pages.map((p: Msg) => p.id)).toEqual(['pg1', 'pg2']);
    // автор в окне приложения видит облачного гостя среди участников
    await until(() => last(host, 'users')?.users.some((u: Msg) => u.name === 'Маша'));
    expect(link.status().guests).toBe(1);
  });

  it('правки автора доходят до облачного гостя, права и скрытие страниц работают', async () => {
    const { host } = await setup();
    const g = await cloudGuest();
    const init = await until(() => last(g, 'init'));
    share.setRights(init.userId, { pages: { pg1: 'edit', pg2: 'hidden' } });
    await until(() => last(g, 'rights')?.rights.pages.pg1 === 'edit');
    const p = demo();
    p.pages[0].elements = [rect('from-host')];
    send(host, { t: 'project', project: p });
    const msg = await until(() => g.inbox.find(m => m.t === 'project' && m.project.pages[0]?.elements.length === 1));
    expect(msg.project.pages.map((pg: Msg) => pg.id)).toEqual(['pg1']); // скрытая страница не ушла
  });

  it('правки облачного гостя доходят до автора и до гостя из локальной сети', async () => {
    const { host } = await setup();
    const lan = await peer(`ws://127.0.0.1:${share.port}/ws?code=ROOM42&name=Lan`);
    await until(() => last(lan, 'init'));
    const g = await cloudGuest();
    const init = await until(() => last(g, 'init'));
    share.setRights(init.userId, { all: 'edit' });
    await until(() => last(g, 'rights')?.rights.default === 'edit');
    const p = demo();
    p.pages[1].elements = [rect('from-cloud')];
    send(g, { t: 'project', project: p });
    for (const who of [host, lan]) {
      await until(() => who.inbox.find(m => m.t === 'project' && m.by === init.userId && m.project.pages[1].elements[0]?.id === 'from-cloud'));
    }
    send(g, { t: 'cursor', x: 5, y: 6, pageId: 'pg1' });
    await until(() => last(lan, 'users')?.users.find((u: Msg) => u.userId === init.userId)?.cursor?.x === 5);
  });

  it('имя гостя очищается от управляющих символов и обрезается', async () => {
    await setup();
    const g = await cloudGuest('Ва‮ся\u0000' + 'я'.repeat(100));
    const init = await until(() => last(g, 'init'));
    expect(init.name.startsWith('Ва ся')).toBe(true);
    expect(Array.from(init.name).length).toBeLessThanOrEqual(40);
  });

  it('уход гостя убирает его из комнаты', async () => {
    const { host } = await setup();
    const g = await cloudGuest('Уходящий');
    await until(() => last(g, 'init'));
    g.ws.close();
    await until(() => !last(host, 'users')?.users.some((u: Msg) => u.name === 'Уходящий') && share.users().length === 1);
    expect(link.status().guests).toBe(0);
  });
});

describe('hello', () => {
  it('другая версия протокола комнаты — гость отключается с 4426', async () => {
    await setup();
    const g = await cloudGuest('x', { t: 'hello', proto: PROTO + 1, name: 'x' });
    expect(await g.closed).toEqual({ code: KICK.PROTOCOL_MISMATCH, reason: 'protocol mismatch' });
    expect(share.users()).toHaveLength(1);
  });

  it('первое сообщение не hello — 4400; молчание — 4400 по таймауту', async () => {
    await setup({ link: { helloTimeoutMs: 80 } });
    const a = await cloudGuest('a', { t: 'cursor', x: 1, y: 1 });
    const b = await cloudGuest('b', null);
    expect((await a.closed).code).toBe(KICK.HELLO_EXPECTED);
    expect((await b.closed).code).toBe(KICK.HELLO_EXPECTED);
    expect(share.users()).toHaveLength(1);
  });

  it('не JSON и двоичные данные вместо hello не роняют подключение автора', async () => {
    await setup({ link: { helloTimeoutMs: 80 } });
    const g = await peer(`${relayUrl}/g/${link.status().room}`);
    g.ws.send(Buffer.from([1, 2, 3])); // двоичное без шифрования не читается — ждём hello дальше
    g.ws.send('не json');
    expect((await g.closed).code).toBe(KICK.HELLO_EXPECTED);
    const ok = await cloudGuest();
    await until(() => last(ok, 'init'));
  });
});

describe('обрыв связи с ретранслятором', () => {
  it('автор переподключается в ту же комнату; гость получает свежий init и ничего не теряет', async () => {
    const { host, changes } = await setup();
    const g = await cloudGuest();
    const first = await until(() => last(g, 'init'));
    const room = link.status().room;
    const inits = () => g.inbox.filter(m => m.t === 'init').length;

    dropHostConnection();
    await until(() => last(g, 'relay')?.event === 'host-away');
    // пока облачного соединения нет, автор правит доску — гость это пропустит
    const p = demo();
    p.pages[0].elements = [rect('while-away')];
    send(host, { t: 'project', project: p });

    await until(() => link.status().state === 'online' && inits() === 2);
    expect(link.status().room).toBe(room); // ссылка не изменилась
    const again = last(g, 'init')!;
    expect(again.userId).toBe(first.userId); // тот же участник, права сохранились
    expect(again.project.pages[0].elements[0].id).toBe('while-away');
    expect(changes).toContain('reconnecting');
    await until(() => g.inbox.some(m => m.event === 'host-back'));
  });

  it('ретранслятор перезапустился — открывается новая комната, прежние гости отключаются', async () => {
    await setup();
    const g = await cloudGuest('Старый');
    await until(() => last(g, 'init'));
    const oldRoom = link.status().room;
    const port = relay.port;
    await relay.close();
    relay = await createRelay({ port, host: '127.0.0.1', statsIntervalMs: 0, log: () => {} });
    await until(() => link.status().state === 'online' && link.status().room !== oldRoom, 5000);
    expect(link.status().guests).toBe(0);
    expect(share.users().some((u: Msg) => u.name === 'Старый')).toBe(false);
    const fresh = await cloudGuest('Новый');
    await until(() => last(fresh, 'init'));
  });

  it('мёртвое соединение без ping обрывается и восстанавливается', async () => {
    // ретранслятор не пингует (pingMs большой), автор считает тишину дольше deadMs обрывом
    await setup({ relay: { pingMs: 60_000 }, link: { deadMs: 120 } });
    const g = await cloudGuest();
    await until(() => last(g, 'init'));
    await until(() => last(g, 'relay')?.event === 'host-away', 3000);
    await until(() => g.inbox.filter(m => m.t === 'init').length === 2, 3000);
  });
});

describe('запуск и остановка', () => {
  it('stop закрывает комнату: гости получают 4410, сервер совместной работы продолжает работать', async () => {
    await setup();
    const g = await cloudGuest();
    await until(() => last(g, 'init'));
    link.stop();
    expect((await g.closed).code).toBe(CLOSE.ROOM_CLOSED);
    expect(link.status().state).toBe('stopped');
    expect(share.users()).toHaveLength(1); // автор на месте
    await until(() => relay.stats().rooms === 0);
  });

  it('ретранслятор недоступен — start отклоняется без фоновых повторов', async () => {
    share = await createShareServer({ port: 0, code: 'X' });
    link = createCloudLink({ relayUrl: 'ws://127.0.0.1:1', attach: share.attach, refresh: share.refresh });
    await expect(link.start()).rejects.toThrow('Не удалось подключиться к ретранслятору');
    expect(link.status()).toMatchObject({ state: 'failed', error: 'Не удалось подключиться к ретранслятору' });
  });

  it('ретранслятор перегружен — понятная ошибка', async () => {
    relay = await createRelay({ port: 0, host: '127.0.0.1', statsIntervalMs: 0, log: () => {}, maxRooms: 0 });
    share = await createShareServer({ port: 0, code: 'X' });
    link = createCloudLink({ relayUrl: `ws://127.0.0.1:${relay.port}`, attach: share.attach, refresh: share.refresh });
    await expect(link.start()).rejects.toThrow('Ретранслятор перегружен');
  });

  it('повторный start — ошибка', async () => {
    await setup();
    await expect(link.start()).rejects.toThrow('Уже запущено');
  });
});

describe('адреса', () => {
  it('normalizeRelayUrl: wss везде, ws только для своей машины; без хвостового «/»', () => {
    expect(normalizeRelayUrl('wss://relay.example.com/')).toBe('wss://relay.example.com');
    expect(normalizeRelayUrl(' wss://example.com/relay/?x=1#y ')).toBe('wss://example.com/relay');
    expect(normalizeRelayUrl('ws://localhost:8080')).toBe('ws://localhost:8080');
    expect(normalizeRelayUrl('ws://127.0.0.1:9')).toBe('ws://127.0.0.1:9');
    expect(() => normalizeRelayUrl('ws://relay.example.com')).toThrow('wss://');
    expect(() => normalizeRelayUrl('https://relay.example.com')).toThrow('wss://');
    expect(() => normalizeRelayUrl('wss://user:pass@relay.example.com')).toThrow('Неверный');
    expect(() => normalizeRelayUrl('')).toThrow('Неверный');
  });

  it('ссылка гостя: клиент доски и, в якоре, ретранслятор с комнатой', () => {
    const url = cloudGuestUrl('https://motoilyuha.github.io/Abax/v/2.5.0', 'wss://relay.example.com', 'AbC_dEf-123');
    expect(url).toBe('https://motoilyuha.github.io/Abax/v/2.5.0/#relay=wss%3A%2F%2Frelay.example.com&r=AbC_dEf-123');
    const hash = new URLSearchParams(new URL(url).hash.slice(1));
    expect(hash.get('relay')).toBe('wss://relay.example.com');
    expect(hash.get('r')).toBe('AbC_dEf-123');
  });
});
