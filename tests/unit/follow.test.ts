import { describe, expect, it } from 'vitest';
import { FOLLOW_ANIM_MS, followStep } from '../../src/follow';
import type { CollabUser } from '../../src/collab';

const user = (extra: Partial<CollabUser> = {}): CollabUser => ({
  userId: 2, name: 'Капибара', color: '#e03131', host: false, away: false, cursor: null, pageId: 'p1', selection: [],
  rights: { default: 'view', pages: {} }, ...extra,
});
const pages = ['p1', 'p2'];

describe('«Следить за участником»: следующий шаг', () => {
  it('участник ушёл - слежение заканчивается', () => {
    expect(followStep(undefined, pages, '')).toEqual({ kind: 'gone' });
  });

  it('скрытая от меня страница, черновик или незнакомая страница - ждём на месте', () => {
    expect(followStep(user({ hiddenPage: true, pageId: null }), pages, 'p1|0|0|1').kind).toBe('wait');
    expect(followStep(user({ pageId: null }), pages, '').kind).toBe('wait');
    expect(followStep(user({ pageId: 'чужая' }), pages, '').kind).toBe('wait');
  });

  it('первый шаг - обычный перелёт к центру экрана участника с его масштабом', () => {
    const step = followStep(user({ view: { pageId: 'p1', vx: 10, vy: 20, vz: 2 } }), pages, '');
    expect(step).toEqual({ kind: 'go', key: 'p1|10|20|2', detail: { pageId: 'p1', x: 10, y: 20, zoom: 2, reason: 'follow' } });
  });

  it('вид не изменился - не двигаемся; сдвинулся на той же странице - короткое подтягивание', () => {
    const u = user({ view: { pageId: 'p1', vx: 10, vy: 20, vz: 2 } });
    expect(followStep(u, pages, 'p1|10|20|2')).toEqual({ kind: 'same' });
    const step = followStep(user({ view: { pageId: 'p1', vx: 30, vy: 20, vz: 2 } }), pages, 'p1|10|20|2');
    expect(step).toMatchObject({ kind: 'go', detail: { x: 30, ms: FOLLOW_ANIM_MS } });
  });

  it('смена страницы: вид ещё со старой страницы - только переход на страницу', () => {
    const step = followStep(user({ pageId: 'p2', view: { pageId: 'p1', vx: 1, vy: 1, vz: 1 } }), pages, 'p1|1|1|1');
    expect(step).toEqual({ kind: 'go', key: 'p2|', detail: { pageId: 'p2', reason: 'follow' } });
    // следом приходит вид с новой страницы — перелёт к нему (страница та же, поэтому коротко)
    expect(followStep(user({ pageId: 'p2', view: { pageId: 'p2', vx: 5, vy: 5, vz: 1 } }), pages, 'p2|'))
      .toMatchObject({ kind: 'go', detail: { pageId: 'p2', x: 5, ms: FOLLOW_ANIM_MS } });
  });

  it('вернулся со скрытой страницы - снова идём за ним', () => {
    expect(followStep(user({ pageId: 'p2' }), pages, 'p1|0|0|1')).toMatchObject({ kind: 'go', detail: { pageId: 'p2' } });
  });
});
