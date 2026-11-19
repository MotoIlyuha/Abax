// Роли и возможности в хабах Ночи №6 (SPEC_NIGHT6 §3): одинаковые сценарии для src/room-host.ts и electron/room.cjs.
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoomHub as createTsHub } from '../../src/room-host';

const require = createRequire(import.meta.url);
const { createRoomHub: createCjsHub } = require('../../electron/room.cjs');

type Msg = Record<string, any>;

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

interface HubKind {
  name: string;
  /** Хаб без ограничений тарифа (pro у TS, обычный у Electron). */
  make(opts?: Msg): any;
  /** Хаб бесплатного тарифа, если он у этого хаба есть. */
  free?: (opts?: Msg) => any;
}

const kinds: HubKind[] = [
  { name: 'src/room-host.ts', make: (o = {}) => createTsHub({ code: 'R', plan: 'pro', ...o }), free: (o = {}) => createTsHub({ code: 'R', plan: 'free', ...o }) },
  { name: 'electron/room.cjs', make: (o = {}) => createCjsHub({ code: 'R', ...o }) },
];

function room(hub: any, project: Msg = demo()) {
  const host = new FakeSock();
  hub.attach(host, { isHost: true, name: 'Учитель' });
  host.recv({ t: 'project', project });
  const join = (name = 'Гость', opts: Msg = {}) => {
    const s = new FakeSock();
    const uid = hub.attach(s, { name, ...opts });
    return { s, uid: uid as number | null };
  };
  return { hub, host, join };
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(1_000_000); });
afterEach(() => { vi.useRealTimers(); });

const task = { id: 't1', type: 'task', x: 0, y: 0, w: 100, h: 50, taskId: 'tk', examType: 'custom', topic: '', statementMd: 'Сколько?', answer: '4' };

describe.each(kinds)('$name', kind => {
  describe('роль и возможности в init и rights', () => {
    it('гость по умолчанию — комментатор старой ссылки (как раньше: комментирует, пишет в чат, указка)', () => {
      const { host, join } = room(kind.make());
      const g = join();
      const init = g.s.last('init')!;
      expect(init.role).toBe('commenter');
      expect(init.caps).toEqual({ comment: true, chat: true, pointer: true, copy: true, summon: false });
      expect(init.rights.default).toBe('view');
      expect(host.last('init')!.role).toBe('owner');
      expect(host.last('init')!.caps).toEqual({ comment: true, chat: true, pointer: true, copy: true, summon: true });
    });

    it('читатель: не пишет в чат, не комментирует, без реакций, указки и ответа в задании — но чат читает', () => {
      const { hub, host, join } = room(kind.make(), demo({ pages: [{ id: 'pg1', name: 'П', grid: 'none', elements: [task, { id: 'r', type: 'shape', shape: 'rect', x: 0, y: 0, w: 5, h: 5, color: '#000', width: 1 }] }] }));
      const g = join('Пётр');
      expect(hub.setRights(g.uid, { role: 'reader' }).ok).toBe(true);
      const rights = g.s.last('rights')!;
      expect(rights.role).toBe('reader');
      expect(rights.caps).toMatchObject({ comment: false, chat: false, pointer: false });
      const before = host.sent.length;
      g.s.recv({ t: 'chat', text: 'можно?' });
      g.s.recv({ t: 'comment', op: 'create', pageId: 'pg1', x: 1, y: 1, text: 'вопрос' });
      g.s.recv({ t: 'react', pageId: 'pg1', elId: 'r', emoji: '👍' });
      g.s.recv({ t: 'pointer', k: 'laser', pageId: 'pg1', color: '#ff2d2d', pts: [{ x: 1, y: 1 }] });
      g.s.recv({ t: 'task-submit', pageId: 'pg1', elId: 't1', value: '4' });
      g.s.recv({ t: 'task-draft', pageId: 'pg1', elId: 't1', draft: '4' });
      expect(host.sent.slice(before).filter(m => ['chat', 'comments', 'pointer', 'patch'].includes(m.t))).toEqual([]);
      host.recv({ t: 'chat', text: 'урок начался' });
      expect(g.s.last('chat')).toMatchObject({ text: 'урок начался' });
    });

    it('комментатор отвечает в задании и комментирует на странице только для просмотра', () => {
      const { hub, host, join } = room(kind.make(), demo({ pages: [{ id: 'pg1', name: 'П', grid: 'none', elements: [task] }] }));
      host.recv({ t: 'caps', patches: true });
      const g = join();
      hub.setRights(g.uid, { role: 'commenter' });
      expect(g.s.last('rights')!.rights.pages.pg1).toBe('view');
      g.s.recv({ t: 'task-submit', pageId: 'pg1', elId: 't1', value: '4' });
      expect(host.last('patch')!.ops[0].el.attempts).toHaveLength(1);
      g.s.recv({ t: 'comment', op: 'create', pageId: 'pg1', x: 1, y: 1, text: 'вопрос' });
      expect(host.last('comments')!.comments).toHaveLength(1);
    });

    it('редактор новой роли — edit на страницах без права; patch принимается', () => {
      const { hub, host, join } = room(kind.make());
      host.recv({ t: 'caps', patches: true });
      const g = join();
      hub.setRights(g.uid, { role: 'editor' });
      expect(g.s.last('rights')).toMatchObject({ role: 'editor', rights: { default: 'edit', pages: { pg1: 'edit', pg2: 'edit' } } });
      g.s.recv({ t: 'patch', pageId: 'pg1', rev: 1, ops: [{ op: 'put', el: { id: 's', type: 'shape', shape: 'rect', x: 0, y: 0, w: 5, h: 5, color: '#000', width: 1 } }] });
      expect(host.last('patch')!.ops[0].el.id).toBe('s');
    });
  });

  describe('итоговое право: старая ссылка и новые роли', () => {
    it('edit страницы повышает старую роль, но не новую', () => {
      const { hub, host, join } = room(kind.make());
      const old = join('Старый');
      const reader = join('Читатель');
      hub.setRights(reader.uid, { role: 'reader' });
      host.recv({ t: 'project', project: demo({ permissions: { pageRights: { pg1: 'edit' } } }) });
      expect(hub.room.userPageRight(old.uid, 'pg1')).toBe('edit');
      expect(hub.room.userPageRight(reader.uid, 'pg1')).toBe('view');
      expect(old.s.last('rights')!.rights.pages.pg1).toBe('edit');
    });

    it('личное право участника переживает живую смену права страницы (Решение 4)', () => {
      const { hub, host, join } = room(kind.make());
      const a = join('Аня');
      const b = join('Боря');
      hub.setRights(a.uid, { pages: { pg1: 'edit' } });
      host.recv({ t: 'project', project: demo({ permissions: { pageRights: { pg1: 'hidden' } } }) });
      expect(hub.room.userPageRight(a.uid, 'pg1')).toBe('edit');
      expect(hub.room.userPageRight(b.uid, 'pg1')).toBe('hidden');
      expect(b.s.last('project')!.project.pages.map((p: Msg) => p.id)).toEqual(['pg2']);
      expect(a.s.last('project')!.project.pages.map((p: Msg) => p.id)).toEqual(['pg1', 'pg2']);
      // снять личное право — действует право страницы
      hub.setRights(a.uid, { pages: { pg1: null } });
      expect(hub.room.userPageRight(a.uid, 'pg1')).toBe('hidden');
    });

    it('права, не изменившиеся при смене permissions, гостю повторно не шлются', () => {
      const { host, join } = room(kind.make());
      const g = join();
      const n = g.s.all('rights').length;
      host.recv({ t: 'project', project: demo({ permissions: { pageRights: { pg2: 'view' } } }) });
      expect(g.s.all('rights').length).toBe(n); // комментатор и так смотрит pg2
      host.recv({ t: 'project', project: demo({ permissions: { pageRights: { pg2: 'hidden' } } }) });
      expect(g.s.all('rights').length).toBe(n + 1);
      expect(g.s.last('rights')!.rights.pages.pg2).toBe('hidden');
    });
  });

  describe('копирование на участника', () => {
    const paid = (perms: Msg) => demo({ ownerPlan: 'pro', permissions: perms });
    it('доска запрещает: комментатор и старый редактор — нет, новый редактор — да', () => {
      const { hub, join } = room(kind.make(), paid({ allowCopy: false }));
      const c = join('К');
      const oldEd = join('С');
      const ed = join('Р');
      hub.setRights(oldEd.uid, { default: 'edit' });
      hub.setRights(ed.uid, { role: 'editor' });
      expect(c.s.last('init')!.allowCopy).toBe(false);
      expect(oldEd.s.last('rights')!.allowCopy).toBe(false);
      expect(ed.s.last('rights')).toMatchObject({ allowCopy: true, caps: { copy: true } });
    });
    it('автор разрешил копирование — гостям сразу уходят новые права', () => {
      const { host, join } = room(kind.make(), paid({ allowCopy: false }));
      const g = join();
      host.recv({ t: 'project', project: paid({ allowCopy: true }) });
      expect(g.s.last('rights')).toMatchObject({ allowCopy: true, caps: { copy: true } });
    });
  });

  describe('«Позвать всех» по настройке доски', () => {
    it('редактор зовёт только при summon: editors; комментатор — никогда', () => {
      const { hub, host, join } = room(kind.make());
      const ed = join('Ред');
      const other = join('Другой');
      hub.setRights(ed.uid, { role: 'editor' });
      ed.s.recv({ t: 'summon', pageId: 'pg2', vx: 1, vy: 2, vz: 1 });
      expect(other.s.last('summon')).toBeUndefined();
      host.recv({ t: 'project', project: demo({ permissions: { summon: 'editors' } }) });
      expect(ed.s.last('rights')!.caps.summon).toBe(true);
      ed.s.recv({ t: 'summon', pageId: 'pg2', vx: 1, vy: 2, vz: 1 });
      expect(other.s.last('summon')).toMatchObject({ pageId: 'pg2', by: ed.uid });
      const n = ed.s.all('summon').length;
      other.s.recv({ t: 'summon', pageId: 'pg1', vx: 1, vy: 2, vz: 1 });
      expect(ed.s.all('summon').length).toBe(n);
    });
  });

  describe('сведения о доступе в users — только автору', () => {
    it('автор видит роль и источник, гость — нет', () => {
      const { hub, host, join } = room(kind.make());
      const g = join();
      hub.setRights(g.uid, { role: 'reader' });
      const forHost = host.last('users')!.users.find((u: Msg) => u.userId === g.uid);
      expect(forHost.access).toMatchObject({ role: 'reader', source: 'p2p' });
      const other = join('Второй');
      for (const u of other.s.last('users')!.users) expect(u.access).toBeUndefined();
      for (const u of other.s.last('init')!.users) expect(u.access).toBeUndefined();
    });
  });

  describe('setRights: старые патчи', () => {
    it('default/all/pages работают как раньше; hidden на всё скрывает страницы', () => {
      const { hub, join } = room(kind.make());
      const g = join();
      hub.setRights(g.uid, { default: 'edit' });
      expect(hub.room.userPageRight(g.uid, 'pg1')).toBe('edit');
      hub.setRights(g.uid, { all: 'hidden' });
      expect(hub.room.userPageRight(g.uid, 'pg1')).toBe('hidden');
      expect(g.s.last('project')!.project.pages).toHaveLength(0);
      hub.setRights(g.uid, { all: 'view' });
      expect(hub.room.userPageRight(g.uid, 'pg2')).toBe('view');
    });
  });
});

describe('src/room-host.ts: доступ из параметров подключения (облако)', () => {
  it('роль, личные права, запрет копирования ссылки и источник; setAccess заменяет доступ', () => {
    const hub = createTsHub({ code: 'R', plan: 'pro' });
    const { host, join } = room(hub, demo({ ownerPlan: 'pro' }));
    const g = join('Аня', { access: { role: 'view', personal: { pg2: 'hidden' }, inviteAllowCopy: false, source: 'email', inviteId: 'inv1', principal: 'u:anna' } });
    const init = g.s.last('init')!;
    expect(init).toMatchObject({ role: 'commenter', allowCopy: false, rights: { pages: { pg1: 'view', pg2: 'hidden' } } });
    expect(host.last('users')!.users.find((u: Msg) => u.userId === g.uid).access).toEqual({ role: 'commenter', source: 'email', inviteId: 'inv1', personal: { pg2: 'hidden' } });
    expect(hub.setAccess(g.uid!, { role: 'editor', personal: {}, source: 'email', inviteId: 'inv1' })).toBe(true);
    expect(g.s.last('rights')).toMatchObject({ role: 'editor', allowCopy: true, rights: { pages: { pg1: 'edit', pg2: 'edit' } } });
    expect(hub.room.access.get(g.uid!)!.principal).toBe('u:anna'); // автор элементов при смене доступа не меняется
    expect(hub.setAccess(0, { role: 'reader' })).toBe(false);
  });
  it('неизвестная роль в access — старые права или по умолчанию', () => {
    const hub = createTsHub({ code: 'R', plan: 'pro' });
    const { join } = room(hub);
    const g = join('X', { access: { role: 'admin' }, rights: { default: 'edit', pages: {} } });
    expect(g.s.last('init')!.role).toBe('editor');
  });
});

describe.each(kinds)('$name: защита чужих элементов (SPEC_NIGHT6 §4)', kind => {
  const rectEl = (id: string, x = 0) => ({ id, type: 'shape', shape: 'rect', x, y: 0, w: 5, h: 5, color: '#000', width: 1 });
  const lesson = (protect: boolean) => demo({
    permissions: protect ? { protectElements: true } : {},
    pages: [{ id: 'pg1', name: 'Задачи', grid: 'square', elements: [rectEl('teacher'), task] }, { id: 'pg2', name: 'Вторая', grid: 'square', elements: [] }],
  });
  function setup(protect = true) {
    const r = room(kind.make(), lesson(protect));
    r.host.recv({ t: 'caps', patches: true });
    const g = r.join('Аня');
    r.hub.setRights(g.uid, { role: 'editor' });
    g.s.recv({ t: 'caps', patches: true });
    const by = g.s.last('init')!.principal as string;
    const els = () => r.hub.room.project.pages[0].elements;
    return { ...r, g, by, els };
  }
  const p = (ops: unknown[], extra: Msg = {}) => ({ t: 'patch', pageId: 'pg1', rev: 1, ops, ...extra });

  it('хаб выдаёт гостю автора элементов; свой новый элемент — его, чужой автор не принимается', () => {
    const { g, by, els } = setup();
    expect(by).toMatch(/^c:[0-9a-f]{12}$/);
    g.s.recv(p([{ op: 'put', el: { ...rectEl('mine'), by: 'c:someone' } }]));
    expect(els().find((e: Msg) => e.id === 'mine').by).toBe(by);
    // хаб поставил другого автора — отправителю уходит его элемент с автором хаба
    const fix = g.s.last('patch')!;
    expect(fix.by).toBe(-1);
    expect(fix.ops.find((o: Msg) => o.op === 'put').el).toMatchObject({ id: 'mine', by });
  });

  it('свой штрих правится и стирается; элемент учителя — нет, отправителю — исправление', () => {
    const { host, g, by, els } = setup();
    g.s.recv(p([{ op: 'put', el: { ...rectEl('mine'), by } }]));
    g.s.recv(p([{ op: 'put', el: { ...rectEl('mine', 7), by } }]));
    expect(els().find((e: Msg) => e.id === 'mine').x).toBe(7);
    const hostPatches = host.all('patch').length;
    g.s.recv(p([{ op: 'del', id: 'teacher' }]));
    g.s.recv(p([{ op: 'put', el: rectEl('teacher', 50) }]));
    expect(els().find((e: Msg) => e.id === 'teacher')).toEqual(rectEl('teacher'));
    expect(host.all('patch').length).toBe(hostPatches); // отклонённое никому не рассылается
    const fix = g.s.last('patch')!;
    expect(fix).toMatchObject({ by: -1, pageId: 'pg1' });
    expect(fix.ops).toContainEqual({ op: 'put', el: rectEl('teacher') });
    g.s.recv(p([{ op: 'del', id: 'mine' }]));
    expect(els().some((e: Msg) => e.id === 'mine')).toBe(false);
  });

  it('ответ в чужом задании принимается, условие и положение — нет', () => {
    const { g, els } = setup();
    g.s.recv(p([{ op: 'put', el: { ...task, statementMd: 'Подмена', x: 300, studentDraft: 'черновик' } }]));
    const t = els().find((e: Msg) => e.id === 't1');
    expect(t).toMatchObject({ statementMd: 'Сколько?', x: 0, studentDraft: 'черновик' });
  });

  it('порядок чужих и настройки страницы не меняются; свои слои — да', () => {
    const { g, by, els, hub } = setup();
    g.s.recv(p([{ op: 'put', el: { ...rectEl('mine'), by } }]));
    g.s.recv(p([{ op: 'order', ids: ['mine', 'teacher', 't1'] }]));
    expect(els().map((e: Msg) => e.id)).toEqual(['mine', 'teacher', 't1']);
    g.s.recv(p([{ op: 'order', ids: ['t1', 'teacher', 'mine'] }]));
    expect(els().map((e: Msg) => e.id)).toEqual(['mine', 'teacher', 't1']);
    g.s.recv(p([], { grid: 'none', backgroundColor: '#ff0000' }));
    expect(hub.room.project.pages[0].grid).toBe('square');
    expect(g.s.last('patch')).toMatchObject({ grid: 'square', backgroundColor: null, by: -1 });
  });

  it('полный проект от гостя: чужое остаётся, удалённое возвращается, страниц не добавить; отправителю — проект хаба', () => {
    const { g, by, els, hub } = setup();
    const n = g.s.all('project').length;
    g.s.recv({ t: 'project', project: demo({
      pages: [
        { id: 'pg1', name: 'Подмена', grid: 'none', elements: [{ ...rectEl('mine'), by }] },
        { id: 'pg2', name: 'Вторая', grid: 'square', elements: [] },
        { id: 'pg3', name: 'Новая', grid: 'square', elements: [] },
      ],
    }) });
    expect(els().map((e: Msg) => e.id)).toEqual(['teacher', 't1', 'mine']);
    expect(hub.room.project.pages[0].name).toBe('Задачи');
    expect(hub.room.project.pages.map((x: Msg) => x.id)).toEqual(['pg1', 'pg2']);
    expect(g.s.all('project').length).toBe(n + 1);
  });

  it('без защиты — как раньше: гость правит и стирает элемент учителя', () => {
    const { g, els } = setup(false);
    g.s.recv(p([{ op: 'put', el: rectEl('teacher', 9) }]));
    expect(els().find((e: Msg) => e.id === 'teacher').x).toBe(9);
    g.s.recv(p([{ op: 'del', id: 'teacher' }]));
    expect(els().some((e: Msg) => e.id === 'teacher')).toBe(false);
  });

  it('автор правит всё и не меняет автора элемента гостя', () => {
    const { host, g, by, els } = setup();
    g.s.recv(p([{ op: 'put', el: { ...rectEl('mine'), by } }]));
    host.recv(p([{ op: 'put', el: rectEl('mine', 3) }]));
    expect(els().find((e: Msg) => e.id === 'mine')).toMatchObject({ x: 3, by });
    host.recv(p([{ op: 'del', id: 'teacher' }]));
    expect(els().some((e: Msg) => e.id === 'teacher')).toBe(false);
  });

  it('секрет возобновления: переподключившийся гость снова автор своих элементов; чужой и после правки — нет', () => {
    const { hub, g, by, els } = setup();
    const secret = g.s.last('init')!.resume as string;
    expect(typeof secret).toBe('string');
    g.s.recv(p([{ op: 'put', el: { ...rectEl('mine'), by } }]));
    g.s.close();
    const s2 = new FakeSock();
    const uid2 = hub.attach(s2, { name: 'Аня' });
    hub.setRights(uid2, { role: 'editor' });
    s2.recv({ t: 'caps', patches: true });
    expect(s2.last('init')!.principal).not.toBe(by);
    s2.recv({ t: 'resume', secret });
    expect(s2.last('resume')).toEqual({ t: 'resume', ok: true, principal: by });
    s2.recv(p([{ op: 'put', el: { ...rectEl('mine', 4), by } }]));
    expect(els().find((e: Msg) => e.id === 'mine')).toMatchObject({ x: 4, by });
    // чужой секрет не подходит; после правки секрет не принимается
    const s3 = new FakeSock();
    hub.attach(s3, { name: 'Боря' });
    s3.recv({ t: 'resume', secret: 'нет такого' });
    expect(s3.last('resume')).toEqual({ t: 'resume', ok: false });
    s3.recv(p([]));
    s3.recv({ t: 'resume', secret });
    expect(s3.last('resume')).toEqual({ t: 'resume', ok: false });
  });
});
