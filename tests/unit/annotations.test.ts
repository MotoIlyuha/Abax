import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_PILLS, PILL_H, PIN_R, hitAnnotation, layoutPills, layoutPins, pillWidth } from '../../src/annotations';
import { clientId, resetClientId } from '../../src/identity';
import type { CommentThread, Element, ShapeEl } from '../../src/types';

const rect = (id: string, x: number, y: number, extra: Partial<ShapeEl> = {}): ShapeEl =>
  ({ id, type: 'shape', shape: 'rect', x, y, w: 100, h: 50, color: '#000000', width: 2, ...extra });
const cam = { x: 0, y: 0, zoom: 1 };

describe('пилюли реакций', () => {
  it('стоят под нижней границей элемента слева направо; свои реакции отмечены', () => {
    const el = rect('a', 40, 30, { reactions: { '👍': ['u1', 'u2'], '🔥': ['me'] } });
    const pills = layoutPills([el, rect('b', 0, 0)], cam, 'me', 800, 600);
    expect(pills.map(p => [p.emoji, p.count, p.mine])).toEqual([['👍', 2, false], ['🔥', 1, true]]);
    expect(pills[0]).toMatchObject({ x: 40, y: 80 + 6, h: PILL_H, elId: 'a', w: pillWidth(2) });
    expect(pills[1].x).toBe(40 + pillWidth(2) + 4);
  });

  it('масштаб и камера учитываются; пилюли за экраном и пустые списки пропускаются', () => {
    const el = rect('a', 100, 100, { reactions: { '👍': ['u'] } });
    const p = layoutPills([el], { x: 50, y: 50, zoom: 2 }, 'me', 800, 600)[0];
    expect(p).toMatchObject({ x: 100, y: (150 - 50) * 2 + 6 });
    expect(layoutPills([el], { x: 5000, y: 0, zoom: 1 }, 'me', 800, 600)).toEqual([]);
    expect(layoutPills([rect('e', 0, 0, { reactions: { '👍': [] } })], cam, 'me', 800, 600)).toEqual([]);
  });

  it('больше шести разных реакций не показываются', () => {
    const reactions = Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(k => [k, ['u']]));
    expect(layoutPills([rect('a', 0, 0, { reactions })], cam, 'me', 800, 600)).toHaveLength(MAX_PILLS);
  });
});

describe('пины комментариев', () => {
  const t = (id: string, x: number, y: number, extra: Partial<CommentThread> = {}): CommentThread =>
    ({ id, x, y, messages: [{ id: 'm', authorId: 'u', authorName: 'А', text: 'т', createdAt: 1 }], ...extra });

  it('в точках ветки, с числом сообщений и признаком «решено»', () => {
    const pins = layoutPins([t('t1', 100, 50), t('t2', 10, 10, { resolved: true })], { x: 5, y: 5, zoom: 2 }, 800, 600);
    expect(pins).toEqual([
      { x: 190, y: 90, r: PIN_R, threadId: 't1', count: 1, resolved: false },
      { x: 10, y: 10, r: PIN_R, threadId: 't2', count: 1, resolved: true },
    ]);
    expect(layoutPins(undefined, cam, 800, 600)).toEqual([]);
    expect(layoutPins([t('far', 9000, 9000)], cam, 800, 600)).toEqual([]);
  });
});

describe('нажатия', () => {
  const el = rect('a', 40, 30, { reactions: { '👍': ['u1'] } });
  const pills = layoutPills([el], cam, 'me', 800, 600);
  const pins = layoutPins([{ id: 't', x: 60, y: 90, messages: [] }], cam, 800, 600);

  it('пилюля, пин и мимо; пин главнее пилюли', () => {
    expect(hitAnnotation(pills, [], 50, 90)).toMatchObject({ kind: 'pill', pill: { elId: 'a' } });
    expect(hitAnnotation(pills, [], 50, 200)).toBeNull();
    expect(hitAnnotation([], pins, 62, 92)).toMatchObject({ kind: 'pin', pin: { threadId: 't' } });
    // пин лежит поверх пилюли
    expect(hitAnnotation(pills, pins, 60, 90)).toMatchObject({ kind: 'pin' });
    expect(hitAnnotation(pills, pins, 5, 5)).toBeNull();
    void (null as unknown as Element);
  });
});

describe('идентификатор клиента', () => {
  beforeEach(() => { localStorage.clear(); resetClientId(); history.replaceState(null, '', '/'); });

  it('создаётся один раз и запоминается', () => {
    const a = clientId();
    expect(a.length).toBeGreaterThan(8);
    expect(localStorage.getItem('doska.clientId')).toBe(a);
    resetClientId();
    expect(clientId()).toBe(a);
  });

  it('у тестового окна гостя (?name=…) — с суффиксом, чтобы не слиться с автором', () => {
    const base = clientId();
    resetClientId();
    history.replaceState(null, '', '/?name=Маша');
    expect(clientId()).toBe(`${base}:Маша`);
    resetClientId();
    history.replaceState(null, '', `/?name=${'я'.repeat(50)}`);
    expect(clientId()).toBe(`${base}:${'я'.repeat(20)}`);
  });
});
