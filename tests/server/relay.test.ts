// Облачный ретранслятор (relay/server.cjs) с настоящими WebSocket-клиентами из пакета ws.
// Автор говорит с ретранслятором кадрами из relay/protocol.cjs, гость — обычными сообщениями.
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const WebSocket = require('ws');
const { createRelay, ipKey } = require('../../relay/server.cjs');
const { RELAY_PROTO, CLOSE, ROOM_ID_RE, encodeFrame, decodeFrame } = require('../../relay/protocol.cjs');

type Msg = Record<string, any>;
interface Frame { conn: number; isBinary: boolean; text: string; bytes: Buffer }
interface Client {
  ws: any;
  /** Текстовые кадры как есть. */
  texts: string[];
  /** Текстовые кадры, которые разбираются как JSON-объект (управляющие сообщения, сообщения гостю). */
  control: Msg[];
  /** Бинарные кадры: у автора — разобранные кадры данных, у гостя — сырые байты. */
  frames: Frame[];
  bytes: Buffer[];
  closed: Promise<{ code: number; reason: string }>;
}

let relay: any;
const clients: Client[] = [];

async function until<T>(fn: () => T | undefined | null | false, ms = 3000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('условие не выполнилось за отведённое время');
    await new Promise(r => setTimeout(r, 10));
  }
}
const tick = (ms = 60) => new Promise(r => setTimeout(r, ms));

async function start(opts: Record<string, unknown> = {}) {
  relay = await createRelay({ port: 0, host: '127.0.0.1', statsIntervalMs: 0, log: () => {}, ...opts });
}

function connect(path: string, wsOpts: Record<string, unknown> = {}): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${relay.port}${path}`, wsOpts);
    const c: Client = { ws, texts: [], control: [], frames: [], bytes: [], closed: null as never };
    c.closed = new Promise(r => ws.on('close', (code: number, reason: Buffer) => r({ code, reason: reason.toString() })));
    ws.on('message', (data: Buffer, isBinary: boolean) => {
      if (!isBinary) {
        const text = data.toString();
        c.texts.push(text);
        try { const m = JSON.parse(text); if (m && typeof m === 'object') c.control.push(m); } catch { /* не JSON */ }
        return;
      }
      c.bytes.push(data);
      const f = decodeFrame(data);
      if (f) c.frames.push({ conn: f.conn, isBinary: f.isBinary, text: f.payload.toString(), bytes: f.payload });
    });
    ws.on('open', () => { clients.push(c); resolve(c); });
    ws.on('error', reject);
    ws.on('unexpected-response', (_req: unknown, res: { statusCode: number }) => reject(new Error(`HTTP ${res.statusCode}`)));
  });
}
const sendJson = (c: Client, m: unknown) => c.ws.send(JSON.stringify(m));
const lastControl = (c: Client, t: string) => [...c.control].reverse().find(m => m.t === t);

/** Автор открывает комнату; возвращает соединение и ответ opened. */
async function openRoom(): Promise<{ host: Client; opened: Msg }> {
  const host = await connect('/host');
  sendJson(host, { t: 'open', proto: RELAY_PROTO });
  const opened = await until(() => lastControl(host, 'opened'));
  return { host, opened };
}
/** Гость подключается и автор получает join; возвращает гостя и его conn. */
async function join(host: Client, room: string): Promise<{ guest: Client; conn: number }> {
  const before = host.control.filter(m => m.t === 'join').length;
  const guest = await connect(`/g/${room}`);
  const j = await until(() => host.control.filter(m => m.t === 'join')[before]);
  return { guest, conn: j.conn };
}

afterEach(async () => {
  for (const c of clients.splice(0)) c.ws.terminate();
  await relay?.close();
  relay = null;
});

describe('комната и пересылка', () => {
  it('автор открывает комнату: идентификатор и токен', async () => {
    await start();
    const { opened } = await openRoom();
    expect(opened).toMatchObject({ resumed: false, guests: [] });
    expect(opened.room).toMatch(ROOM_ID_RE);
    expect(opened.token.length).toBeGreaterThanOrEqual(40);
    expect(relay.stats()).toEqual({ rooms: 1, guests: 0, hostsAway: 0 });
  });

  it('текст и двоичные данные проходят в обе стороны без изменений', async () => {
    await start();
    const { host, opened } = await openRoom();
    const { guest, conn } = await join(host, opened.room);

    guest.ws.send('{"t":"cursor","x":1}');
    guest.ws.send(Buffer.from([0, 1, 2, 255]));
    await until(() => host.frames.length === 2);
    expect(host.frames[0]).toMatchObject({ conn, isBinary: false, text: '{"t":"cursor","x":1}' });
    expect(host.frames[1].isBinary).toBe(true);
    expect([...host.frames[1].bytes]).toEqual([0, 1, 2, 255]);

    host.ws.send(encodeFrame(conn, 'привет', false));
    host.ws.send(encodeFrame(conn, Buffer.from([9, 8, 7]), true));
    await until(() => guest.texts.length === 1 && guest.bytes.length === 1);
    expect(guest.texts).toEqual(['привет']);
    expect([...guest.bytes[0]]).toEqual([9, 8, 7]);
  });

  it('текстовый кадр от автора приходит гостю текстом', async () => {
    await start();
    const { host, opened } = await openRoom();
    const { guest, conn } = await join(host, opened.room);
    host.ws.send(encodeFrame(conn, JSON.stringify({ t: 'init', userId: 3 }), false));
    expect(await until(() => lastControl(guest, 'init'))).toEqual({ t: 'init', userId: 3 });
  });

  it('данные идут только своему гостю; кадр неизвестному conn и короткий кадр отбрасываются', async () => {
    await start();
    const { host, opened } = await openRoom();
    const a = await join(host, opened.room);
    const b = await join(host, opened.room);
    expect(a.conn).not.toBe(b.conn);
    host.ws.send(encodeFrame(9999, '{"t":"x"}', false));
    host.ws.send(Buffer.from([0, 0]));
    host.ws.send(encodeFrame(b.conn, '{"t":"only-b"}', false));
    await until(() => lastControl(b.guest, 'only-b'));
    await tick();
    expect(a.guest.control).toEqual([]);
    expect(relay.stats().guests).toBe(2);
  });

  it('уход гостя — leave автору', async () => {
    await start();
    const { host, opened } = await openRoom();
    const { guest, conn } = await join(host, opened.room);
    guest.ws.close();
    expect(await until(() => lastControl(host, 'leave'))).toEqual({ t: 'leave', conn });
    expect(relay.stats().guests).toBe(0);
  });

  it('kick отключает гостя с кодом автора; чужой диапазон кодов заменяется на 4000', async () => {
    await start();
    const { host, opened } = await openRoom();
    const a = await join(host, opened.room);
    const b = await join(host, opened.room);
    sendJson(host, { t: 'kick', conn: a.conn, code: 4426, reason: 'protocol mismatch' });
    sendJson(host, { t: 'kick', conn: b.conn, code: 1000, reason: 'x'.repeat(200) });
    expect(await a.guest.closed).toEqual({ code: 4426, reason: 'protocol mismatch' });
    expect(await b.guest.closed).toEqual({ code: 4000, reason: '' });
  });

  it('неизвестная и испорченная комната — 4404', async () => {
    await start();
    await openRoom();
    const g1 = await connect('/g/AAAAAAAAAAAAAAAAAAAAAA');
    const g2 = await connect('/g/short');
    const g3 = await connect(`/g/${encodeURIComponent('A'.repeat(21) + '/')}`);
    for (const g of [g1, g2, g3]) expect((await g.closed).code).toBe(CLOSE.ROOM_NOT_FOUND);
  });

  it('в комнате не больше maxGuests гостей', async () => {
    await start({ maxGuests: 2 });
    const { host, opened } = await openRoom();
    await join(host, opened.room);
    await join(host, opened.room);
    const third = await connect(`/g/${opened.room}`);
    expect((await third.closed).code).toBe(CLOSE.ROOM_FULL);
  });

  it('ретранслятор не разбирает и не меняет управляющие сообщения неизвестного вида', async () => {
    await start();
    const { host, opened } = await openRoom();
    const { guest, conn } = await join(host, opened.room);
    sendJson(host, { t: 'future-feature', x: 1 });
    sendJson(host, 'строка');
    host.ws.send('не json');
    host.ws.send(encodeFrame(conn, '{"t":"still-works"}', false));
    await until(() => lastControl(guest, 'still-works'));
  });
});

describe('начало сессии автора', () => {
  it('первое сообщение не open — 4400', async () => {
    await start();
    const h = await connect('/host');
    sendJson(h, { t: 'kick', conn: 1 });
    expect((await h.closed).code).toBe(CLOSE.BAD_REQUEST);
  });

  it('двоичный кадр вместо open — 4400', async () => {
    await start();
    const h = await connect('/host');
    h.ws.send(Buffer.from('{"t":"open","proto":1}'));
    expect((await h.closed).code).toBe(CLOSE.BAD_REQUEST);
  });

  it('другая версия протокола — 4426', async () => {
    await start();
    const h = await connect('/host');
    sendJson(h, { t: 'open', proto: RELAY_PROTO + 1 });
    expect(await h.closed).toEqual({ code: CLOSE.PROTOCOL_MISMATCH, reason: 'protocol mismatch' });
  });

  it('молчание после подключения — закрытие по таймауту', async () => {
    await start({ openTimeoutMs: 50 });
    const h = await connect('/host');
    expect((await h.closed).code).toBe(CLOSE.BAD_REQUEST);
  });
});

describe('обрыв и возвращение автора', () => {
  it('явное закрытие комнаты: гости получают 4410, комнаты больше нет', async () => {
    await start();
    const { host, opened } = await openRoom();
    const { guest } = await join(host, opened.room);
    sendJson(host, { t: 'close' });
    expect(await guest.closed).toEqual({ code: CLOSE.ROOM_CLOSED, reason: 'room closed' });
    expect((await host.closed).code).toBe(1000);
    const late = await connect(`/g/${opened.room}`);
    expect((await late.closed).code).toBe(CLOSE.ROOM_NOT_FOUND);
  });

  it('закрытие соединения автора с кодом 1000 тоже закрывает комнату', async () => {
    await start();
    const { host, opened } = await openRoom();
    const { guest } = await join(host, opened.room);
    host.ws.close(1000);
    expect((await guest.closed).code).toBe(CLOSE.ROOM_CLOSED);
    expect(relay.stats().rooms).toBe(0);
  });

  it('обрыв: гости ждут, новые получают 4503; автор возвращается по токену', async () => {
    await start();
    const { host, opened } = await openRoom();
    const a = await join(host, opened.room);
    host.ws.terminate();
    expect(await until(() => lastControl(a.guest, 'relay'))).toEqual({ t: 'relay', event: 'host-away' });
    expect(relay.stats()).toMatchObject({ rooms: 1, hostsAway: 1 });

    const late = await connect(`/g/${opened.room}`);
    expect((await late.closed).code).toBe(CLOSE.HOST_OFFLINE);
    a.guest.ws.send('{"t":"lost"}'); // автора нет — сообщение не копится

    const back = await connect('/host');
    sendJson(back, { t: 'open', proto: RELAY_PROTO, room: opened.room, token: opened.token });
    const resumed = await until(() => lastControl(back, 'opened'));
    expect(resumed).toEqual({ t: 'opened', room: opened.room, token: opened.token, resumed: true, guests: [a.conn] });
    expect(await until(() => a.guest.control.find(m => m.event === 'host-back'))).toBeTruthy();

    a.guest.ws.send('{"t":"after"}');
    await until(() => back.frames.find(f => f.text === '{"t":"after"}'));
    expect(back.frames.some(f => f.text === '{"t":"lost"}')).toBe(false);
    back.ws.send(encodeFrame(a.conn, '{"t":"hi"}', false));
    await until(() => lastControl(a.guest, 'hi'));
  });

  it('гость, ушедший пока автора не было, не попадает в список при возвращении', async () => {
    await start();
    const { host, opened } = await openRoom();
    const a = await join(host, opened.room);
    const b = await join(host, opened.room);
    host.ws.terminate();
    await until(() => lastControl(a.guest, 'relay'));
    a.guest.ws.close();
    await until(() => relay.stats().guests === 1);
    const back = await connect('/host');
    sendJson(back, { t: 'open', proto: RELAY_PROTO, room: opened.room, token: opened.token });
    expect((await until(() => lastControl(back, 'opened'))).guests).toEqual([b.conn]);
  });

  it('автор не вернулся вовремя: гости получают 4410, комната удалена', async () => {
    await start({ hostGraceMs: 80 });
    const { host, opened } = await openRoom();
    const { guest } = await join(host, opened.room);
    host.ws.terminate();
    expect(await guest.closed).toEqual({ code: CLOSE.ROOM_CLOSED, reason: 'host did not return' });
    const back = await connect('/host');
    sendJson(back, { t: 'open', proto: RELAY_PROTO, room: opened.room, token: opened.token });
    expect((await back.closed).code).toBe(CLOSE.ROOM_NOT_FOUND);
  });

  it('неверный токен — 4401, комната продолжает ждать автора', async () => {
    await start();
    const { host, opened } = await openRoom();
    host.ws.terminate();
    await until(() => relay.stats().hostsAway === 1);
    for (const token of ['чужой', undefined, 42, opened.room]) {
      const fake = await connect('/host');
      sendJson(fake, { t: 'open', proto: RELAY_PROTO, room: opened.room, token });
      expect((await fake.closed).code).toBe(CLOSE.BAD_TOKEN);
    }
    const bad = await connect('/host');
    sendJson(bad, { t: 'open', proto: RELAY_PROTO, room: 'не-комната', token: opened.token });
    expect((await bad.closed).code).toBe(CLOSE.ROOM_NOT_FOUND);
    expect(relay.stats()).toMatchObject({ rooms: 1, hostsAway: 1 });
  });

  it('возвращение при живом старом соединении: старое закрывается 4409, гости не замечают', async () => {
    await start();
    const { host, opened } = await openRoom();
    const { guest, conn } = await join(host, opened.room);
    const fresh = await connect('/host');
    sendJson(fresh, { t: 'open', proto: RELAY_PROTO, room: opened.room, token: opened.token });
    expect((await host.closed).code).toBe(CLOSE.REPLACED);
    await until(() => lastControl(fresh, 'opened'));
    expect(guest.control.some(m => m.t === 'relay')).toBe(false);
    guest.ws.send('{"t":"to-fresh"}');
    await until(() => fresh.frames.find(f => f.conn === conn && f.text === '{"t":"to-fresh"}'));
    expect(relay.stats().hostsAway).toBe(0);
  });
});

describe('лимиты', () => {
  it('слишком большое сообщение гостя закрывает соединение (1009)', async () => {
    await start({ maxMessage: 1024 });
    const { host, opened } = await openRoom();
    const { guest } = await join(host, opened.room);
    guest.ws.send('x'.repeat(2048));
    expect((await guest.closed).code).toBe(1009);
  });

  it('кадр автора может быть длиннее на заголовок', async () => {
    await start({ maxMessage: 1024 });
    const { host, opened } = await openRoom();
    const { guest, conn } = await join(host, opened.room);
    host.ws.send(encodeFrame(conn, Buffer.alloc(1024, 7), true));
    await until(() => guest.bytes.length === 1);
    expect(guest.bytes[0].length).toBe(1024);
  });

  it('новых комнат с одного адреса — не больше roomsPerMinute', async () => {
    await start({ roomsPerMinute: 2 });
    await openRoom();
    await openRoom();
    const h = await connect('/host');
    sendJson(h, { t: 'open', proto: RELAY_PROTO });
    expect(await h.closed).toEqual({ code: CLOSE.RATE_LIMITED, reason: 'too many rooms' });
  });

  it('возвращение в свою комнату не тратит лимит новых комнат', async () => {
    await start({ roomsPerMinute: 1 });
    const { host, opened } = await openRoom();
    host.ws.terminate();
    await until(() => relay.stats().hostsAway === 1);
    const back = await connect('/host');
    sendJson(back, { t: 'open', proto: RELAY_PROTO, room: opened.room, token: opened.token });
    expect((await until(() => lastControl(back, 'opened'))).resumed).toBe(true);
  });

  it('комнат на ретрансляторе не больше maxRooms', async () => {
    await start({ maxRooms: 1 });
    await openRoom();
    const h = await connect('/host');
    sendJson(h, { t: 'open', proto: RELAY_PROTO });
    expect((await h.closed).code).toBe(CLOSE.SERVER_FULL);
  });

  it('подключений гостей с одного адреса — не больше joinsPerMinute', async () => {
    await start({ joinsPerMinute: 2 });
    const { host, opened } = await openRoom();
    await join(host, opened.room);
    await join(host, opened.room);
    const g = await connect(`/g/${opened.room}`);
    expect(await g.closed).toEqual({ code: CLOSE.RATE_LIMITED, reason: 'too many joins' });
  });

  it('одновременных соединений с одного адреса — не больше maxConnPerIp; закрытые освобождают место', async () => {
    await start({ maxConnPerIp: 2 });
    const { host, opened } = await openRoom();
    const { guest } = await join(host, opened.room);
    const extra = await connect(`/g/${opened.room}`);
    expect(await extra.closed).toEqual({ code: CLOSE.RATE_LIMITED, reason: 'too many connections' });
    guest.ws.close();
    await until(() => relay.stats().guests === 0);
    await join(host, opened.room);
  });

  it('поток сообщений гостя сверх guestMsgsPerSec отбрасывается, гость остаётся', async () => {
    await start({ guestMsgsPerSec: 10 });
    const { host, opened } = await openRoom();
    const { guest } = await join(host, opened.room);
    for (let i = 0; i < 100; i++) guest.ws.send(String(i));
    await tick(150);
    // запас — 2 × лимит, плюс то, что успело накопиться за время отправки
    expect(host.frames.length).toBeGreaterThanOrEqual(20);
    expect(host.frames.length).toBeLessThan(30);
    expect(guest.ws.readyState).toBe(WebSocket.OPEN);
  });

  it('X-Forwarded-For учитывается только при trustProxy, берётся крайний правый адрес', async () => {
    await start({ joinsPerMinute: 1, trustProxy: true });
    const { opened } = await openRoom();
    const asIp = (xff: string) => connect(`/g/${opened.room}`, { headers: { 'x-forwarded-for': xff } });
    await asIp('1.1.1.1');
    // клиент подставил чужой адрес слева, прокси дописал настоящий справа — лимит по настоящему
    const spoof = await asIp('2.2.2.2, 1.1.1.1');
    expect((await spoof.closed).code).toBe(CLOSE.RATE_LIMITED);
    const other = await asIp('3.3.3.3');
    await until(() => relay.stats().guests === 2);
    expect(other.ws.readyState).toBe(WebSocket.OPEN);
  });

  it('без trustProxy заголовок X-Forwarded-For игнорируется', async () => {
    await start({ joinsPerMinute: 1 });
    const { host, opened } = await openRoom();
    await join(host, opened.room);
    const g = await connect(`/g/${opened.room}`, { headers: { 'x-forwarded-for': '9.9.9.9' } });
    expect((await g.closed).code).toBe(CLOSE.RATE_LIMITED);
  });

  it('allowedOrigins: гость с чужим Origin не подключается, автор — без проверки', async () => {
    await start({ allowedOrigins: ['https://example.github.io'] });
    const { host, opened } = await openRoom(); // у автора (Electron, Node) заголовка Origin нет
    await expect(connect(`/g/${opened.room}`, { origin: 'https://evil.example' })).rejects.toThrow('HTTP 403');
    await expect(connect(`/g/${opened.room}`)).rejects.toThrow('HTTP 403');
    const ok = await connect(`/g/${opened.room}`, { origin: 'https://example.github.io' });
    await until(() => lastControl(host, 'join'));
    expect(ok.ws.readyState).toBe(WebSocket.OPEN);
  });

  it('гость, который не забирает данные, отключается (4408), комната живёт', async () => {
    await start({ maxBuffer: 64 * 1024, closeTimeoutMs: 100 });
    const { host, opened } = await openRoom();
    const slow = await join(host, opened.room);
    const fast = await join(host, opened.room);
    slow.guest.ws._socket.pause(); // перестаём читать из сокета — очередь на ретрансляторе растёт
    const chunk = Buffer.alloc(1024 * 1024, 1);
    for (let i = 0; i < 40; i++) host.ws.send(encodeFrame(slow.conn, chunk, true));
    expect(await until(() => lastControl(host, 'leave'), 5000)).toEqual({ t: 'leave', conn: slow.conn });
    host.ws.send(encodeFrame(fast.conn, '{"t":"alive"}', false));
    await until(() => lastControl(fast.guest, 'alive'));
    expect(relay.stats()).toMatchObject({ rooms: 1, guests: 1 });
  });

  it('соединение без ответов на ping обрывается', async () => {
    await start({ pingMs: 40 });
    const { host, opened } = await openRoom();
    const mute = await connect(`/g/${opened.room}`, { autoPong: false });
    expect((await mute.closed).code).toBe(1006);
    expect(host.ws.readyState).toBe(WebSocket.OPEN); // отвечающий автор жив
    await until(() => lastControl(host, 'leave'));
  });
});

describe('HTTP и завершение', () => {
  it('/health отвечает ok, прочие пути — 404, неизвестный путь для WebSocket — 404', async () => {
    await start();
    const base = `http://127.0.0.1:${relay.port}`;
    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);
    expect(await health.text()).toBe('ok');
    expect((await fetch(`${base}/`)).status).toBe(404);
    await expect(connect('/other')).rejects.toThrow('HTTP 404');
  });

  it('close отключает всех с кодом 1001', async () => {
    await start();
    const { host, opened } = await openRoom();
    const { guest } = await join(host, opened.room);
    await relay.close();
    relay = null;
    expect((await guest.closed).code).toBe(1001);
    expect((await host.closed).code).toBe(1001);
  });
});

describe('вспомогательное', () => {
  it('ipKey: IPv4 целиком, IPv4 из IPv6 — как IPv4, IPv6 — по сети /64', () => {
    expect(ipKey('203.0.113.7')).toBe('203.0.113.7');
    expect(ipKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(ipKey('2001:db8:1:2:aaaa::1')).toBe('2001:db8:1:2::/64');
    expect(ipKey('2001:0db8:0001:0002:bbbb:cccc:dddd:eeee')).toBe('2001:db8:1:2::/64');
    expect(ipKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(ipKey('::1')).toBe('0:0:0:0::/64');
  });

  it('кадр данных: заголовок 5 байт, флаг двоичности, conn big-endian', () => {
    const f = encodeFrame(0x01020304, 'ab', false);
    expect([...f]).toEqual([0, 1, 2, 3, 4, 97, 98]);
    expect(decodeFrame(encodeFrame(7, Buffer.from([1]), true))).toMatchObject({ conn: 7, isBinary: true });
    expect(decodeFrame(Buffer.from([1, 2]))).toBeNull();
  });
});
