// Вложения чата (SPEC_CHAT §7): паритет правил src/room-chat.ts с зеркалом electron/room-chat-att.cjs
// и одинаковые сценарии протокола для хабов src/room-host.ts и electron/room.cjs.
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoomHub as createTsHub } from '../../src/room-host';
import * as ts from '../../src/room-chat';

const require = createRequire(import.meta.url);
const cjs = require('../../electron/room-chat-att.cjs');
const { createRoomHub: createCjsHub, normalizeChatText: cjsNormalizeChatText } = require('../../electron/room.cjs');

type Msg = Record<string, any>;

const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
const png = 'data:image/png;base64,iVBORw0KGgo=';
const shape = (id: string, extra: Msg = {}) => ({ id, type: 'shape', kind: 'rect', x: 0, y: 0, w: 10, h: 10, stroke: '#000', ...extra });
const task = { id: 't1', type: 'task', x: 0, y: 0, w: 100, h: 50, taskId: 'tk', examType: 'custom', topic: '', statementMd: 'Сколько?', answer: '4' };
const image = (extra: Msg = {}) => ({ kind: 'image', src: jpeg, w: 640, h: 480, ...extra });
const board = (extra: Msg = {}) => ({
  kind: 'board', pageId: 'pg2', pageName: 'Вторая', ids: ['a', 'b'], count: 2, preview: png, w: 320, h: 200,
  elements: [shape('a', { by: 'c:x' }), shape('b')], ...extra,
});
/** Картинка почти на весь предел: 15 таких укладываются в бюджет буфера, 16 — уже нет. */
const bigJpeg = `data:image/jpeg;base64,${'A'.repeat(ts.CHAT_IMAGE_MAX - 1000)}`;

const ATT_SAMPLES: unknown[] = [
  undefined, null, 5, 'image', [], [image()], {},
  image(), image({ src: png }), image({ src: 'data:image/webp;base64,UklGR' }), image({ junk: 1, by: 'u:1' }),
  image({ src: 'data:image/svg+xml;base64,PHN2Zz4=' }), image({ src: 'data:image/jpeg;base64,<script>' }),
  image({ src: 'https://example.com/a.png' }), image({ src: `data:image/jpeg;base64,${'A'.repeat(ts.CHAT_IMAGE_MAX)}` }),
  image({ src: bigJpeg }), image({ w: 0 }), image({ w: 4096, h: 4096 }), image({ w: 4097 }), image({ h: 1.5 }), image({ w: '10' }), image({ h: undefined }),
  board(), board({ elements: undefined }), board({ elements: [] }), board({ junk: true }), board({ pageName: 'я'.repeat(200) }),
  board({ pageName: '😀'.repeat(130) }), board({ pageName: 5 }), board({ pageId: '' }), board({ pageId: 'p'.repeat(129) }), board({ pageId: 'p'.repeat(128) }),
  board({ ids: [] }), board({ ids: ['a', 5] }), board({ ids: ['a', ''] }), board({ ids: Array.from({ length: 201 }, (_, i) => `e${i}`) }),
  board({ ids: 'a' }), board({ count: 0 }), board({ count: 200 }), board({ count: 201 }), board({ count: 2.5 }),
  board({ preview: jpeg.replace('jpeg', 'gif') }), board({ preview: `data:image/png;base64,${'A'.repeat(ts.CHAT_PREVIEW_MAX)}` }),
  board({ w: 0 }), board({ h: 5000 }), board({ elements: [task] }), board({ elements: [shape('a'), task] }), board({ elements: [{ id: 'x' }] }),
  board({ elements: [{ id: 'x', type: 5 }] }), board({ elements: [null] }), board({ elements: [[shape('a')]] }), board({ elements: null }),
  board({ elements: {} }), board({ elements: Array.from({ length: 201 }, (_, i) => shape(`e${i}`)) }),
  board({ elements: Array.from({ length: 200 }, (_, i) => shape(`e${i}`)) }),
  board({ elements: [shape('a', { text: 'я'.repeat(ts.CHAT_BOARD_JSON_MAX) })] }),
  { kind: 'gone', was: 'image' }, { kind: 'hidden' }, { kind: 'video', src: jpeg, w: 1, h: 1 },
];

const msg = (id: string, att?: unknown): ts.ChatMessage => ({ id, by: 1, name: 'А', text: '', ts: 1, ...(att ? { att: att as ts.ChatAttachment } : {}) });

describe('electron/room-chat-att.cjs совпадает с src/room-chat.ts', () => {
  it('константы', () => {
    for (const k of ['CHAT_IMAGE_MAX', 'CHAT_PREVIEW_MAX', 'CHAT_SIDE_MAX', 'CHAT_BOARD_IDS_MAX', 'CHAT_BOARD_JSON_MAX', 'CHAT_ATT_BUDGET', 'CHAT_ATT_ID_MAX', 'CHAT_PAGE_NAME_MAX'] as const) {
      expect(cjs[k], k).toBe(ts[k]);
    }
    expect([ts.CHAT_IMAGE_MAX, ts.CHAT_PREVIEW_MAX, ts.CHAT_SIDE_MAX, ts.CHAT_BOARD_IDS_MAX, ts.CHAT_BOARD_JSON_MAX, ts.CHAT_ATT_BUDGET])
      .toEqual([400_000, 200_000, 4096, 200, 300_000, 6_000_000]);
  });

  it('проверка вложения с правом копирования и без него', () => {
    for (const raw of ATT_SAMPLES) {
      for (const copy of [true, false]) {
        const label = `${JSON.stringify(raw)?.slice(0, 80)} copy=${copy}`;
        expect(cjs.cleanChatAttachment(raw, { copy }), label).toEqual(ts.cleanChatAttachment(raw, { copy }));
      }
    }
  });

  it('текст сообщения с вложением и без', () => {
    for (const v of ['  а  ', '', '   ', 'я'.repeat(500), 'я'.repeat(501), 5, null, undefined, {}]) {
      for (const allowEmpty of [false, true]) {
        expect(cjsNormalizeChatText(v, allowEmpty), `${String(v).slice(0, 20)} ${allowEmpty}`).toBe(ts.normalizeChatText(v, allowEmpty));
      }
    }
  });

  it('размер, бюджет и снимок на получателя', () => {
    const atts = [image(), image({ src: bigJpeg }), ts.cleanChatAttachment(board(), { copy: true }), { kind: 'gone', was: 'board' }, { kind: 'hidden' }, undefined];
    for (const a of atts) expect(cjs.chatAttachmentSize(a)).toBe(ts.chatAttachmentSize(a as ts.ChatAttachment | undefined));
    const list = [msg('t'), ...Array.from({ length: 17 }, (_, i) => msg(`m${i}`, i === 3 ? board() : image({ src: bigJpeg })))];
    const a = ts.trimChatAttachments(list);
    expect(cjs.trimChatAttachments(list)).toEqual(a);
    // 16 больших картинок и маленькие объекты: вытесняется только самая старая картинка
    expect(a.slice(0, 5).map(m => m.att?.kind)).toEqual([undefined, 'gone', 'image', 'image', 'board']);
    expect(a[1].att).toEqual({ kind: 'gone', was: 'image' });
    expect(a.slice(2)).toEqual(list.slice(2));
    expect(list[1].att!.kind).toBe('image'); // исходный список не меняется
    // самые старые уходят первыми, даже маленькие объекты
    const boardFirst = [msg('b', ts.cleanChatAttachment(board(), { copy: true })), ...list.slice(1)];
    expect(cjs.trimChatAttachments(boardFirst)).toEqual(ts.trimChatAttachments(boardFirst));
    expect(ts.trimChatAttachments(boardFirst).slice(0, 3).map(m => m.att)).toEqual([{ kind: 'gone', was: 'board' }, { kind: 'gone', was: 'image' }, list[2].att]);
    const short = list.slice(0, 5);
    expect(cjs.trimChatAttachments(short)).toBe(short);
    expect(ts.trimChatAttachments(short)).toBe(short);
    for (const m of [msg('a'), msg('b', image()), msg('c', board()), msg('d', { kind: 'gone', was: 'board' })]) {
      for (const see of [true, false]) {
        expect(cjs.chatMessageFor(m, () => see)).toEqual(ts.chatMessageFor(m, () => see));
      }
    }
    expect(cjs.chatMessageFor(msg('c', board()), () => false).att).toEqual({ kind: 'hidden' });
  });
});

class FakeSock {
  readyState = 1;
  sent: Msg[] = [];
  closed: { code?: number; reason?: string } | null = null;
  private h: { message: ((raw: any) => void)[]; close: (() => void)[] } = { message: [], close: [] };
  send(text: string) { this.sent.push(JSON.parse(text)); }
  close(code?: number, reason?: string) {
    if (this.readyState !== 1) return;
    this.readyState = 3;
    this.closed = { code, reason };
    this.h.close.forEach(fn => fn());
  }
  on(ev: 'message' | 'close', fn: any) { this.h[ev].push(fn); }
  recv(m: unknown) { this.h.message.forEach(fn => fn(JSON.stringify(m))); }
  last(t: string) { return [...this.sent].reverse().find(m => m.t === t); }
  all(t: string) { return this.sent.filter(m => m.t === t); }
}

const demo = (extra: Msg = {}) => ({
  id: 'demo', name: 'Демо', createdAt: 1, updatedAt: 2,
  pages: [
    { id: 'pg1', name: 'Первая', grid: 'square', elements: [] as unknown[] },
    { id: 'pg2', name: 'Вторая', grid: 'square', elements: [] as unknown[] },
  ],
  ...extra,
});
const paid = (perms: Msg) => demo({ ownerPlan: 'pro', permissions: perms });

const kinds = [
  { name: 'src/room-host.ts', make: (o: Msg = {}) => createTsHub({ code: 'R', plan: 'pro', ...o }) as any },
  { name: 'electron/room.cjs', make: (o: Msg = {}) => createCjsHub({ code: 'R', ...o }) },
];

function room(hub: any, project: Msg = demo()) {
  const host = new FakeSock();
  hub.attach(host, { isHost: true, name: 'Учитель' });
  host.recv({ t: 'project', project });
  const join = (name = 'Гость', opts: Msg = {}) => {
    const s = new FakeSock();
    const uid = hub.attach(s, { name, ...opts });
    return { s, uid: uid as number };
  };
  return { hub, host, join };
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(1_000_000); });
afterEach(() => { vi.useRealTimers(); });

describe.each(kinds)('вложения чата: $name', kind => {
  it('картинка доходит всем, текст может быть пустым, лишние поля отбрасываются', () => {
    const { host, join } = room(kind.make());
    const g = join('Маша');
    g.s.recv({ t: 'chat', text: '', att: image({ junk: 1 }) });
    for (const s of [host, g.s]) {
      expect(s.last('chat')).toMatchObject({ by: g.uid, name: 'Маша', text: '', att: { kind: 'image', src: jpeg, w: 640, h: 480 } });
      expect(s.last('chat')!.att).toEqual({ kind: 'image', src: jpeg, w: 640, h: 480 });
    }
    host.recv({ t: 'chat', text: '  подпись  ', att: image({ src: png, w: 1, h: 1 }) });
    expect(g.s.last('chat')).toMatchObject({ by: 0, text: 'подпись', att: { kind: 'image', src: png } });
  });

  it('неверное вложение отклоняет всё сообщение, даже с текстом', () => {
    const { host, join } = room(kind.make());
    const g = join();
    for (const att of [image({ src: 'data:image/svg+xml;base64,PHN2Zz4=' }), image({ w: 5000 }), { kind: 'gone', was: 'image' }, { kind: 'hidden' }, 'x', [image()]]) {
      g.s.recv({ t: 'chat', text: 'текст', att });
    }
    expect(host.all('chat')).toHaveLength(0);
  });

  it('пустой текст без вложения — отказ; старые сообщения без вложений — как раньше', () => {
    const { host, join } = room(kind.make());
    const g = join();
    for (const m of [{ text: '' }, { text: '   ' }, {}, { text: '', att: null }, { text: undefined, att: undefined }]) g.s.recv({ t: 'chat', ...m });
    expect(host.all('chat')).toHaveLength(0);
    g.s.recv({ t: 'chat', text: 'привет' });
    expect(host.last('chat')).toMatchObject({ text: 'привет' });
    expect('att' in host.last('chat')!).toBe(false);
    expect('att' in join().s.last('init')!.chat[0]).toBe(false);
  });

  it('объекты доски: копии без by, только известные поля; слишком большие копии — только просмотр', () => {
    const { host, join } = room(kind.make());
    const g = join();
    host.recv({ t: 'chat', text: '', att: board({ junk: 1, pageName: 'я'.repeat(200) }) });
    const att = g.s.last('chat')!.att;
    expect(Object.keys(att).sort()).toEqual(['count', 'elements', 'h', 'ids', 'kind', 'pageId', 'pageName', 'preview', 'w']);
    expect(att.pageName).toHaveLength(ts.CHAT_PAGE_NAME_MAX);
    expect(att.elements).toEqual([shape('a'), shape('b')]);
    vi.setSystemTime(1_001_000);
    host.recv({ t: 'chat', text: 'много', att: board({ elements: [shape('a', { text: 'я'.repeat(ts.CHAT_BOARD_JSON_MAX) })] }) });
    expect(g.s.last('chat')).toMatchObject({ text: 'много', att: { kind: 'board', pageId: 'pg2', count: 2 } });
    expect(g.s.last('chat')!.att.elements).toBeUndefined();
  });

  it('задание среди объектов — сообщение отклоняется, даже от автора', () => {
    const { host, join } = room(kind.make());
    const g = join();
    host.recv({ t: 'chat', text: 'ответы', att: board({ elements: [shape('a'), task] }) });
    g.s.recv({ t: 'chat', text: 'ответы', att: board({ pageId: 'pg1', elements: [task] }) });
    expect(host.all('chat')).toHaveLength(0);
    expect(g.s.all('chat')).toHaveLength(0);
  });

  it('объекты доски без права копирования отклоняются целиком; картинку тот же участник отправляет', () => {
    const { hub, host, join } = room(kind.make(), paid({ allowCopy: false }));
    const c = join('Комментатор');
    const ed = join('Редактор');
    hub.setRights(ed.uid, { role: 'editor' });
    c.s.recv({ t: 'chat', text: 'смотри', att: board({ pageId: 'pg1' }) });
    c.s.recv({ t: 'chat', text: 'смотри', att: board({ pageId: 'pg1', elements: undefined }) });
    expect(host.all('chat')).toHaveLength(0);
    c.s.recv({ t: 'chat', text: '', att: image() });
    expect(host.last('chat')!.att.kind).toBe('image');
    ed.s.recv({ t: 'chat', text: '', att: board({ pageId: 'pg1' }) });
    expect(host.last('chat')!.att).toMatchObject({ kind: 'board', pageId: 'pg1', elements: [shape('a'), shape('b')] });
  });

  it('объекты со скрытой страницы: гостю — hidden, автору и тем, кому видна, — полностью; в init — так же', () => {
    const { hub, host, join } = room(kind.make());
    const a = join('Аня');
    const b = join('Боря');
    hub.setRights(a.uid, { pages: { pg2: 'hidden' } });
    host.recv({ t: 'chat', text: 'со второй', att: board() });
    expect(a.s.last('chat')).toMatchObject({ text: 'со второй', att: { kind: 'hidden' } });
    expect(a.s.last('chat')!.att).toEqual({ kind: 'hidden' });
    for (const s of [host, b.s]) expect(s.last('chat')!.att).toMatchObject({ kind: 'board', pageId: 'pg2', pageName: 'Вторая', preview: png });
    // картинки и объекты с видимой страницы скрытие не трогает
    vi.setSystemTime(1_001_000);
    host.recv({ t: 'chat', text: '', att: board({ pageId: 'pg1', pageName: 'Первая' }) });
    expect(a.s.last('chat')!.att).toMatchObject({ kind: 'board', pageId: 'pg1' });
    // гость не отправляет объекты со страницы, которую не видит
    a.s.recv({ t: 'chat', text: 'чужое', att: board() });
    expect(host.last('chat')!.text).not.toBe('чужое');
    // история в init — на получателя
    const late = room(kind.make({ multiHost: true }), paid({ pageRights: { pg2: 'hidden' } }));
    late.host.recv({ t: 'chat', text: 'со второй', att: board() });
    late.host.recv({ t: 'chat', text: '', att: image() });
    const g = late.join('Поздний');
    expect(g.s.last('init')!.chat.map((m: Msg) => m.att)).toEqual([{ kind: 'hidden' }, image()]);
    late.hub.setRights(g.uid, { pages: { pg2: 'view' } });
    expect(late.join('Ещё').s.last('init')!.chat[0].att).toMatchObject({ kind: 'hidden' });
    // автор видит всё и в повторном init
    const host2 = new FakeSock();
    late.hub.attach(host2, { isHost: true, name: 'Учитель' });
    expect(host2.last('init')!.chat[0].att).toMatchObject({ kind: 'board', pageId: 'pg2', elements: [shape('a'), shape('b')] });
  });

  it('бюджет: у самых старых вложений — gone, текст остаётся; новым участникам — так же', () => {
    const { hub, host, join } = room(kind.make());
    const g = join();
    host.recv({ t: 'chat', text: 'без вложения' });
    for (let i = 0; i < 16; i++) {
      vi.setSystemTime(1_000_000 + (i + 1) * 1000);
      host.recv({ t: 'chat', text: `к${i}`, att: image({ src: bigJpeg }) });
    }
    expect(g.s.last('chat')).toMatchObject({ text: 'к15', att: { kind: 'image', src: bigJpeg } });
    const chat = join('Поздний').s.last('init')!.chat;
    expect(chat).toHaveLength(17);
    expect(chat[0]).toMatchObject({ text: 'без вложения' });
    expect('att' in chat[0]).toBe(false);
    expect(chat[1]).toMatchObject({ text: 'к0', att: { kind: 'gone', was: 'image' } });
    expect(chat.slice(2).every((m: Msg) => m.att.kind === 'image')).toBe(true);
    const size = hub.room.chat.reduce((n: number, m: Msg) => n + (m.att?.kind === 'image' ? JSON.stringify(m.att).length : 0), 0);
    expect(size).toBeLessThanOrEqual(ts.CHAT_ATT_BUDGET);
  });
});
