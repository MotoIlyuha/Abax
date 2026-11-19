import { describe, expect, it } from 'vitest';
import { avatarColors, goToParticipant, gotoTarget, participantPoint, participantTitle, safeInsets, EDGE_PAD } from '../../src/collab-presence';
import { cursorPreset } from '../../src/cursors';
import type { CollabUser } from '../../src/collab';
import { state } from '../../src/state';

const user = (extra: Partial<CollabUser> = {}): CollabUser => ({
  userId: 2, name: 'Капибара', color: '#e03131', host: false, away: false, cursor: null, pageId: 'p1', selection: [],
  rights: { default: 'view', pages: {} }, ...extra,
});
const rect = (left: number, top: number, width: number, height: number) => ({
  left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}),
}) as DOMRect;

describe('безопасная область краевых курсоров', () => {
  const wrap = rect(0, 0, 1000, 800);
  it('шапка сверху, панель слева, док снизу', () => {
    const ins = safeInsets(wrap, [rect(0, 0, 1000, 48), rect(8, 100, 52, 400), rect(400, 740, 200, 52)]);
    expect(ins).toEqual({ top: 48 + EDGE_PAD, left: 60 + EDGE_PAD, bottom: 60 + EDGE_PAD, right: EDGE_PAD });
  });
  it('скрытые (нулевые) и вне холста — не мешают', () => {
    expect(safeInsets(wrap, [rect(0, 0, 0, 0), rect(2000, 0, 50, 50)])).toEqual({ top: EDGE_PAD, left: EDGE_PAD, bottom: EDGE_PAD, right: EDGE_PAD });
  });
  it('панель справа', () => {
    expect(safeInsets(wrap, [rect(940, 100, 52, 400)], 0).right).toBe(60);
  });
});

describe('куда переходить к участнику', () => {
  it('курсор — с моим зумом; без курсора — центр его экрана с его зумом', () => {
    expect(gotoTarget(user({ cursor: { x: 5, y: 6 }, view: { pageId: 'p1', vx: 1, vy: 2, vz: 3 } }), 'pointer')).toEqual({ pageId: 'p1', x: 5, y: 6, reason: 'pointer' });
    expect(gotoTarget(user({ view: { pageId: 'p1', vx: 1, vy: 2, vz: 3 } }), 'avatar')).toEqual({ pageId: 'p1', x: 1, y: 2, zoom: 3, reason: 'avatar' });
    expect(gotoTarget(user(), 'avatar')).toEqual({ pageId: 'p1', reason: 'avatar' });
  });
  it('скрытая страница или неизвестно где — некуда', () => {
    expect(gotoTarget(user({ hiddenPage: true, pageId: null }), 'avatar')).toBeNull();
    expect(gotoTarget(user({ pageId: null }), 'avatar')).toBeNull();
  });
  it('точка краевого курсора: только на моей странице, не отошёл, не скрыт', () => {
    expect(participantPoint(user({ cursor: { x: 1, y: 1 } }), 'p1')).toEqual({ x: 1, y: 1 });
    expect(participantPoint(user({ view: { pageId: 'p1', vx: 7, vy: 8, vz: 1 } }), 'p1')).toEqual({ x: 7, y: 8 });
    expect(participantPoint(user({ cursor: { x: 1, y: 1 } }), 'p2')).toBeNull();
    expect(participantPoint(user({ cursor: { x: 1, y: 1 }, away: true }), 'p1')).toBeNull();
    expect(participantPoint(user({ cursor: { x: 1, y: 1 }, hiddenPage: true }), 'p1')).toBeNull();
  });
});

describe('аватар участника', () => {
  it('цвета плашки курсора; старая версия — цвет хаба', () => {
    const p = cursorPreset('mint');
    expect(avatarColors({ cursorId: 'mint', color: '#000000' })).toEqual({ bg: p.badgeBg, fg: p.badgeText });
    expect(avatarColors({ color: '#123456' })).toEqual({ bg: '#123456', fg: '#ffffff' });
    expect(avatarColors({ color: 'red;background:url(x)' }).bg).toBe('#868e96');
  });

  it('подсказка: имя, страница, скрытая страница, «Отошёл»', () => {
    state.project = { id: 'x', name: 'П', createdAt: 0, updatedAt: 0, pages: [{ id: 'p1', name: 'Алгебра', grid: 'square', elements: [] }] };
    expect(participantTitle(user())).toBe('Капибара · страница «Алгебра»');
    expect(participantTitle(user({ host: true, hiddenPage: true, pageId: null }))).toBe('Капибара (автор) · На скрытой странице');
    expect(participantTitle(user({ away: true, pageId: null }))).toBe('Капибара · Отошёл');
  });

  it('переход к участнику; на скрытой странице — пилюля', () => {
    document.body.innerHTML = '<div id="activity-pills"></div>';
    const got: unknown[] = [];
    const on = (e: Event) => got.push((e as CustomEvent).detail);
    document.addEventListener('doska:collab-goto', on);
    goToParticipant(user({ view: { pageId: 'p1', vx: 1, vy: 2, vz: 2 } }), 'avatar');
    expect(got).toEqual([{ pageId: 'p1', x: 1, y: 2, zoom: 2, reason: 'avatar' }]);
    goToParticipant(user({ host: true, hiddenPage: true, pageId: null }), 'avatar');
    expect(got).toHaveLength(1);
    expect([...document.querySelectorAll('#activity-pills .ap-text')].map(n => n.textContent)).toContain('Автор сейчас на скрытой странице');
    document.removeEventListener('doska:collab-goto', on);
  });
});
