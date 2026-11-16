// Автор в браузере: keepalive-пинг ретранслятору (поддерживает соединение за прокси и находит полуоткрытое).
import { afterEach, describe, expect, it } from 'vitest';
import { createRelayHost, type RelayHost } from '../../src/relay-host';

type Handler = ((ev?: any) => void) | null;

/** Заглушка WebSocket: открывается сразу, копирует отправленное, ответы ретранслятора подаёт тест. */
class FakeWS {
  static all: FakeWS[] = [];
  readyState = 0;
  binaryType = '';
  sent: any[] = [];
  onopen: Handler = null;
  onmessage: Handler = null;
  onclose: Handler = null;
  constructor(readonly url: string) {
    FakeWS.all.push(this);
    queueMicrotask(() => { this.readyState = 1; this.onopen?.(); });
  }
  send(data: any): void { this.sent.push(data); }
  close(): void { this.readyState = 3; }
  recv(obj: unknown): void { this.onmessage?.({ data: JSON.stringify(obj) }); }
  pings(): number { return this.sent.filter(d => typeof d === 'string' && JSON.parse(d).t === 'ping').length; }
}

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until<T>(fn: () => T | undefined | null | false, ms = 3000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('условие не выполнилось за отведённое время');
    await wait(5);
  }
}

let host: RelayHost | null = null;
afterEach(() => { host?.stop(); host = null; FakeWS.all = []; });

async function startHost(pingMs = 20): Promise<FakeWS> {
  host = createRelayHost({
    relayUrl: 'ws://127.0.0.1:1', attach: () => null, refresh: () => false,
    WebSocketImpl: FakeWS as unknown as typeof WebSocket, pingMs, backoffMs: [10],
  });
  const started = host.start();
  const ws = await until(() => FakeWS.all[0]?.readyState === 1 && FakeWS.all[0]);
  ws.recv({ t: 'opened', room: 'R'.repeat(22), token: 'T', resumed: false, guests: [] });
  await started;
  return ws;
}

describe('keepalive автора', () => {
  it('раз в pingMs шлёт {t:"ping"}', async () => {
    const ws = await startHost();
    await until(() => ws.pings() >= 3);
    expect(JSON.parse(ws.sent[0])).toMatchObject({ t: 'open' });
    expect(ws.sent.filter(d => typeof d === 'string' && JSON.parse(d).t === 'ping').length).toBeGreaterThanOrEqual(3);
  });

  it('ретранслятор перестал отвечать на pong — соединение закрыто и открыто заново', async () => {
    const ws = await startHost();
    await until(() => ws.pings() >= 1);
    ws.recv({ t: 'pong' }); // ретранслятор отвечать умеет
    await until(() => FakeWS.all.length >= 2, 2000);
    expect(ws.readyState).toBe(3);
    expect(FakeWS.all[1].url).toContain('/host');
  });

  it('старый ретранслятор не отвечает на ping вовсе — соединение не трогаем', async () => {
    const ws = await startHost();
    await until(() => ws.pings() >= 8);
    expect(FakeWS.all).toHaveLength(1);
    expect(ws.readyState).toBe(1);
  });

  it('любое сообщение ретранслятора считается признаком жизни', async () => {
    const ws = await startHost();
    ws.recv({ t: 'pong' });
    const keep = setInterval(() => ws.recv({ t: 'leave', conn: 99 }), 10);
    try {
      await until(() => ws.pings() >= 8);
      expect(FakeWS.all).toHaveLength(1);
    } finally { clearInterval(keep); }
  });

  it('stop() останавливает таймер: пингов больше нет', async () => {
    const ws = await startHost();
    await until(() => ws.pings() >= 1);
    host!.stop();
    const n = ws.pings();
    await wait(100);
    expect(ws.pings()).toBe(n);
  });
});
