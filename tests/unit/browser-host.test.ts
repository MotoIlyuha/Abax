// Автор в браузере: память вкладки, соседние вкладки (BroadcastChannel) и настоящий ретранслятор (relay/server.cjs).
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import { createRoomHub, type RoomHub } from '../../src/room-host';
import { listenLocalGuests, localGuestTransport, localRoomCode, memoryChannel } from '../../src/local-transport';
import {
  cloudGuestUrl, createRelayHost, decodeFrame, encodeFrame, normalizeRelayUrl, type RelayHost,
} from '../../src/relay-host';
import { cloudTransport, parseCloudInvite, type CollabTransport } from '../../src/collab-transport';
import type { Project } from '../../src/types';

const require = createRequire(import.meta.url);
const { createRelay } = require('../../relay/server.cjs');

type Msg = Record<string, any>;
const demo = (): Project => ({
  id: 'proj', name: 'Демо', createdAt: 1, updatedAt: 2,
  pages: [{ id: 'pg1', name: 'Первая', grid: 'square', elements: [] }],
});
const rect = (id: string) => ({ id, type: 'shape', shape: 'rect', x: 0, y: 0, w: 10, h: 10, color: '#000000', width: 2 });

async function until<T>(fn: () => T | undefined | null | false, ms = 4000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('условие не выполнилось за отведённое время');
    await new Promise(r => setTimeout(r, 10));
  }
}

/** Клиент-заглушка поверх транспорта: копит входящие JSON-сообщения. */
function client(t: CollabTransport) {
  const inbox: Msg[] = [];
  let closed: { code: number; reason: string } | null = null;
  let opened = false;
  t.onopen = () => { opened = true; };
  t.onmessage = d => inbox.push(JSON.parse(d));
  t.onclose = (code, reason) => { closed = { code, reason }; };
  return {
    t, inbox,
    get closed() { return closed; },
    get opened() { return opened; },
    last: (type: string) => [...inbox].reverse().find(m => m.t === type),
    send: (m: unknown) => t.send(JSON.stringify(m)),
  };
}

describe('память вкладки', () => {
  it('клиент и хаб переписываются, init приходит клиенту', async () => {
    const hub = createRoomHub({ code: 'M', maxGuests: Infinity });
    const { client: ct, socket } = memoryChannel();
    const c = client(ct);
    hub.attach(socket, { isHost: true, name: 'Автор' });
    await until(() => c.opened && c.last('init'));
    expect(c.last('init')).toMatchObject({ name: 'Автор', patches: true });
    c.send({ t: 'project', project: demo() });
    await until(() => hub.room.project);
    expect(hub.room.project!.id).toBe('proj');
  });

  it('закрытие с любой стороны сообщается другой', async () => {
    const hub = createRoomHub({ code: 'M' });
    const a = memoryChannel();
    const ca = client(a.client);
    hub.attach(a.socket, { isHost: true });
    await until(() => ca.last('init'));
    a.socket.close(4410, 'room closed');
    await until(() => ca.closed);
    expect(ca.closed).toEqual({ code: 4410, reason: 'room closed' });
    expect(a.client.send('x')).toBe(false);

    const b = memoryChannel();
    client(b.client);
    hub.attach(b.socket, { isHost: true });
    b.client.close();
    await until(() => hub.room.clients.size === 0);
  });
});

describe('соседние вкладки (BroadcastChannel)', () => {
  const stops: Array<() => void> = [];
  afterEach(() => { for (const s of stops.splice(0)) s(); });

  it('код комнаты из адреса', () => {
    expect(localRoomCode('local:abc-1')).toBe('abc-1');
    expect(localRoomCode('ABC')).toBeNull();
    expect(localRoomCode('local:')).toBeNull();
    expect(localRoomCode('local:a b')).toBeNull();
    expect(localRoomCode(null)).toBeNull();
  });

  it('гость подключается, получает init, шлёт сообщения и уходит', async () => {
    const hub = createRoomHub({ code: 'L', maxGuests: Infinity });
    hub.room.project = demo();
    stops.push(listenLocalGuests('t1', (s, o) => hub.attach(s, o)));
    const g = client(localGuestTransport('t1', 'Маша'));
    stops.push(() => g.t.close());
    await until(() => g.opened && g.last('init'));
    expect(g.last('init')).toMatchObject({ name: 'Маша' });
    expect(g.last('init')!.project.id).toBe('proj');
    g.send({ t: 'selection', ids: ['a'], pageId: 'pg1' });
    await until(() => hub.users().some(u => u.name === 'Маша' && u.selection.includes('a')));
    g.t.close();
    await until(() => hub.users().every(u => u.name !== 'Маша'));
  });

  it('нет автора — через время закрытие «автор не в сети»', async () => {
    const g = client(localGuestTransport('nobody', 'Маша', 60));
    await until(() => g.closed);
    expect(g.closed!.code).toBe(4503);
  });

  it('остановка комнаты закрывает гостей', async () => {
    const hub = createRoomHub({ code: 'L', maxGuests: Infinity });
    const stop = listenLocalGuests('t2', (s, o) => hub.attach(s, o));
    const g = client(localGuestTransport('t2', 'Маша'));
    await until(() => g.opened);
    stop();
    await until(() => g.closed);
    expect(g.closed!.code).toBe(4410);
  });
});

describe('ретранслятор: кадры и адреса', () => {
  it('кадр данных туда и обратно', () => {
    const f = encodeFrame(0x01020304, new Uint8Array([9, 8, 7]), true);
    expect([...f]).toEqual([1, 1, 2, 3, 4, 9, 8, 7]);
    const d = decodeFrame(f.buffer as ArrayBuffer)!;
    expect(d).toMatchObject({ conn: 0x01020304, binary: true });
    expect([...d.payload]).toEqual([9, 8, 7]);
    expect(decodeFrame(new ArrayBuffer(2))).toBeNull();
    expect([...encodeFrame(5, 'ab', false)]).toEqual([0, 0, 0, 0, 5, 97, 98]);
  });

  it('адрес ретранслятора: wss всегда, ws — только для своей машины', () => {
    expect(normalizeRelayUrl(' wss://r.example.com/ ')).toBe('wss://r.example.com');
    expect(normalizeRelayUrl('wss://r.example.com/path/?x=1#y')).toBe('wss://r.example.com/path');
    expect(normalizeRelayUrl('ws://127.0.0.1:8080')).toBe('ws://127.0.0.1:8080');
    for (const bad of ['', 'мусор', 'ws://r.example.com', 'https://r.example.com', 'wss://u:p@r.example.com']) {
      expect(() => normalizeRelayUrl(bad)).toThrow();
    }
  });

  it('ссылка гостя разбирается гостевым клиентом', () => {
    const key = 'A'.repeat(43);
    const room = 'R'.repeat(22);
    const url = cloudGuestUrl('https://x.test/Abax', 'wss://r.example.com', room, key);
    expect(url.startsWith('https://x.test/Abax/#')).toBe(true);
    expect(parseCloudInvite(new URL(url).hash)).toMatchObject({ relayUrl: 'wss://r.example.com', room });
  });
});

describe('автор в браузере через настоящий ретранслятор', () => {
  let relay: any;
  let host: RelayHost | null = null;
  const transports: CollabTransport[] = [];

  afterEach(async () => {
    host?.stop();
    host = null;
    for (const t of transports.splice(0)) t.close();
    await relay?.close?.();
    relay = null;
  });

  async function setup(hubOpts: Record<string, unknown> = {}) {
    relay = await createRelay({ port: 0, host: '127.0.0.1', statsIntervalMs: 0, log: () => {} });
    const relayUrl = `ws://127.0.0.1:${relay.port}`;
    const hub: RoomHub = createRoomHub({ code: 'C', maxGuests: Infinity, ...hubOpts });
    const { client: ct, socket } = memoryChannel();
    const author = client(ct);
    hub.attach(socket, { isHost: true, name: 'Автор' });
    author.send({ t: 'project', project: demo() });
    host = createRelayHost({ relayUrl, attach: (s, o) => hub.attach(s, o), refresh: s => hub.refresh(s) });
    await host.start();
    const st = host.status();
    const invite = parseCloudInvite(new URL(cloudGuestUrl('https://x.test/', relayUrl, st.room!, st.key)).hash)!;
    const guest = (name: string) => {
      const t = cloudTransport(invite.relayUrl, invite.room, invite.key, name);
      transports.push(t);
      return client(t);
    };
    return { hub, author, guest, relayUrl };
  }

  it('гость подключается по ссылке: init с проектом, права view, правки идут только от редактора', async () => {
    const { hub, guest } = await setup();
    const g = guest('Ученик');
    await until(() => g.last('init'));
    expect(g.last('init')).toMatchObject({ name: 'Ученик', rights: { default: 'view' }, patches: true });
    expect(g.last('init')!.project.id).toBe('proj');
    expect(host!.status()).toMatchObject({ state: 'online', guests: 1 });

    // без права edit патч отклоняется
    g.send({ t: 'patch', pageId: 'pg1', rev: 0, ops: [{ op: 'put', el: rect('a') }] });
    await new Promise(r => setTimeout(r, 150));
    expect(hub.room.project!.pages[0].elements).toHaveLength(0);

    const uid = hub.users().find(u => u.name === 'Ученик')!.userId;
    hub.setRights(uid, { all: 'edit' });
    await until(() => g.last('rights')?.rights.default === 'edit');
    g.send({ t: 'patch', pageId: 'pg1', rev: 0, ops: [{ op: 'put', el: rect('a') }] });
    await until(() => hub.room.project!.pages[0].elements.length === 1);
  });

  it('автор шлёт патч — гость, объявивший caps, получает его расшифрованным', async () => {
    const { hub, guest } = await setup();
    const g = guest('Ученик');
    await until(() => g.last('init'));
    g.send({ t: 'caps', patches: true });
    await new Promise(r => setTimeout(r, 100));
    expect(hub.pushPatch({ t: 'patch', pageId: 'pg1', rev: 0, ops: [{ op: 'put', el: rect('b') as never }] })).toBe(true);
    const p = await until(() => g.last('patch'));
    expect(p.ops[0].el.id).toBe('b');
  });

  it('на free второй гость получает отказ с кодом 4402', async () => {
    const { guest } = await setup({ maxGuests: 1 });
    const first = guest('Первый');
    await until(() => first.last('init'));
    const second = guest('Второй');
    await until(() => second.closed);
    expect(second.closed!.code).toBe(4402);
    expect(second.last('denied')).toMatchObject({ reason: 'free-limit-reached' });
    expect(first.closed).toBeNull();
  });

  it('чужой ключ — гость отклонён, остановка закрывает комнату кодом 4410', async () => {
    const { guest, relayUrl } = await setup();
    const st = host!.status();
    const wrong = cloudTransport(relayUrl, st.room!, new Uint8Array(32).fill(7), 'Взломщик');
    transports.push(wrong);
    const w = client(wrong);
    await until(() => w.closed);
    expect(w.closed!.code).toBe(4403);

    const g = guest('Ученик');
    await until(() => g.last('init'));
    host!.stop();
    await until(() => g.closed);
    expect(g.closed!.code).toBe(4410);
    expect(host!.status().state).toBe('stopped');
  });

  it('недоступный ретранслятор: ошибка при запуске, без фоновых повторов', async () => {
    const h = createRelayHost({ relayUrl: 'ws://127.0.0.1:1', attach: () => null, refresh: () => false });
    await expect(h.start()).rejects.toThrow('Не удалось подключиться к ретранслятору');
    expect(h.status().state).toBe('failed');
  });
});
