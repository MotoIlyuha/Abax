import { describe, expect, it, vi } from 'vitest';
import {
  PLAN_LIMITS, MAX_GUESTS_LIMIT, effectiveMaxGuests, isOverPageLimit, isOverProjectLimit, canCreatePage, canCreateProject, canGuestJoinRoom, effectivePermissions, planOf, sanitizePermissionsForPlan,
} from '../../src/limits';
import { parseProject, serializeProject } from '../../src/file';
import type { Project } from '../../src/types';

const rect = { id: 'r', type: 'shape', shape: 'rect', x: 0, y: 0, w: 1, h: 1, color: '#000', width: 1 };
const proj = (extra: Record<string, unknown> = {}) => ({
  id: 'p', name: 'П', createdAt: 1, updatedAt: 2,
  pages: [{ id: 'g', name: 'Стр', grid: 'square', elements: [rect] }], ...extra,
});

describe('лимиты тарифов', () => {
  it('free: 3 проекта и 3 страницы', () => {
    expect(canCreateProject('free', 2)).toBe(true);
    expect(canCreateProject('free', 3)).toBe(false);
    expect(canCreateProject('free', 10)).toBe(false); // уже сверх лимита — только запрет нового
    expect(canCreatePage('free', 2)).toBe(true);
    expect(canCreatePage('free', 3)).toBe(false);
  });

  it('free: один гость в комнате (автор не считается)', () => {
    expect(canGuestJoinRoom('free', 0)).toBe(true);
    expect(canGuestJoinRoom('free', 1)).toBe(false);
  });

  it('pro и tutor без ограничений', () => {
    for (const plan of ['pro', 'tutor'] as const) {
      expect(canCreateProject(plan, 1e6)).toBe(true);
      expect(canCreatePage(plan, 1e6)).toBe(true);
      expect(canGuestJoinRoom(plan, 1e6)).toBe(true);
      expect(PLAN_LIMITS[plan].maxEditors).toBe(Infinity);
      expect(PLAN_LIMITS[plan].cloudSync24x7).toBe(true);
    }
    expect(PLAN_LIMITS.pro.tutorFeatures).toBe(false);
    expect(PLAN_LIMITS.tutor.tutorFeatures).toBe(true);
    expect(PLAN_LIMITS.free.tutorFeatures).toBe(false);
  });

  it('free: защита от копирования и клонирования сбрасывается', () => {
    const p = sanitizePermissionsForPlan('free', { forbidClone: true, allowCopy: false, pageRights: { a: 'hidden' } });
    expect(p).toEqual({ forbidClone: false, allowCopy: true, pageRights: { a: 'hidden' } });
  });

  it('pro: защита сохраняется, неизвестные права по страницам отбрасываются', () => {
    const p = sanitizePermissionsForPlan('pro', { forbidClone: true, allowCopy: false, pageRights: { a: 'edit', b: 'зря' as never } });
    expect(p).toEqual({ forbidClone: true, allowCopy: false, pageRights: { a: 'edit' } });
    expect(sanitizePermissionsForPlan('tutor', {})).toEqual({ forbidClone: false, allowCopy: true });
  });

  it('проект без тарифа — free, права вычисляются с поправкой на тариф', () => {
    expect(planOf({})).toBe('free');
    expect(planOf({ ownerPlan: 'мусор' })).toBe('free');
    expect(effectivePermissions({ permissions: { allowCopy: false } }).allowCopy).toBe(true);
    expect(effectivePermissions({ ownerPlan: 'pro', permissions: { allowCopy: false } }).allowCopy).toBe(false);
  });
});

describe('сериализация прав проекта (file.ts)', () => {
  it('ownerPlan и permissions переживают круг сохранения', () => {
    const p = parseProject(proj({ ownerPlan: 'pro', permissions: { forbidClone: true, allowCopy: false, pageRights: { g: 'view' } } }))!;
    expect(p.ownerPlan).toBe('pro');
    expect(p.permissions).toEqual({ forbidClone: true, allowCopy: false, pageRights: { g: 'view' } });
    const back = parseProject(JSON.parse(serializeProject(p)))!;
    expect(back).toEqual(p);
  });

  it('старый файл без новых полей читается как есть', () => {
    const p = parseProject(proj())!;
    expect(p).not.toHaveProperty('ownerPlan');
    expect(p).not.toHaveProperty('permissions');
    expect(p.pages[0].elements).toEqual([rect]);
  });

  it('испорченные поля отбрасываются, проект остаётся', () => {
    const p = parseProject(proj({ ownerPlan: 'vip', permissions: 5, pinned: 'да' }))!;
    expect(p).not.toHaveProperty('ownerPlan');
    expect(p).not.toHaveProperty('permissions');
    expect(p).not.toHaveProperty('pinned');
    const q = parseProject(proj({ permissions: { forbidClone: 'x', pageRights: { g: 'edit', h: 'all' } } }))!;
    expect(q.permissions).toEqual({ pageRights: { g: 'edit' } });
  });

  it('битые элементы выбрасываются, неизвестные поля сохраняются', () => {
    const warn = console.warn;
    console.warn = () => undefined;
    try {
      const p = parseProject(proj({
        pages: [{ id: 'g', elements: [rect, { id: 'x', type: 'нечто' }, { id: 'y', type: 'shape' }, { ...rect, id: 'z', future: 7, opacity: 'x' }] }],
      }))!;
      expect(p.pages[0].elements.map(e => e.id)).toEqual(['r', 'z']);
      expect(p.pages[0].elements[1]).toMatchObject({ future: 7 });
      expect(p.pages[0].elements[1]).not.toHaveProperty('opacity');
      expect(p.pages[0].grid).toBe('square');
    } finally {
      console.warn = warn;
    }
  });

  it('без id или страниц — не проект', () => {
    expect(parseProject(null)).toBeNull();
    expect(parseProject({ pages: [] })).toBeNull();
    expect(parseProject({ id: 'a', name: 'x' })).toBeNull();
    expect(parseProject({ id: 'a', pages: [] })!.pages).toHaveLength(1);
  });

  it('штрих без точек отбрасывается, у точек появляется давление', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const stroke = { id: 's', type: 'stroke', tool: 'pen', color: '#000', width: 2, pts: [{ x: 1, y: 2 }] };
    const p: Project = parseProject(proj({ pages: [{ id: 'g', elements: [stroke, { ...stroke, id: 's2', pts: [] }] }] }))!;
    expect(p.pages[0].elements).toHaveLength(1);
    expect((p.pages[0].elements[0] as { pts: { p: number }[] }).pts[0].p).toBe(0.5);
  });
});

describe('превышение лимита после смены тарифа', () => {
  it('страницы: на free больше 3 — сверх лимита, ровно 3 — нет', () => {
    expect(isOverPageLimit('free', 4)).toBe(true);
    expect(isOverPageLimit('free', 3)).toBe(false);
  });
  it('проекты: на free больше 3 — сверх лимита, ровно 3 — нет', () => {
    expect(isOverProjectLimit('free', 4)).toBe(true);
    expect(isOverProjectLimit('free', 3)).toBe(false);
  });
  it('платные тарифы без ограничений', () => {
    expect(isOverPageLimit('pro', 100)).toBe(false);
    expect(isOverProjectLimit('tutor', 100)).toBe(false);
  });
});

describe('свой лимит гостей (SPEC_NIGHT5 §3.3)', () => {
  it('флаги тарифов', () => {
    expect(PLAN_LIMITS.free.canSetMaxGuests).toBe(false);
    expect(PLAN_LIMITS.free.canFollowHost).toBe(false);
    for (const plan of ['pro', 'tutor'] as const) {
      expect(PLAN_LIMITS[plan].canSetMaxGuests).toBe(true);
      expect(PLAN_LIMITS[plan].canFollowHost).toBe(true);
    }
  });

  it('free: поле отбрасывается, действует лимит тарифа (1 гость)', () => {
    expect(sanitizePermissionsForPlan('free', { maxGuests: 10 }).maxGuests).toBeUndefined();
    expect(effectiveMaxGuests('free', { maxGuests: 10 })).toBe(1);
    expect(effectiveMaxGuests('free', undefined)).toBe(1);
  });

  it('pro: 1..50 сохраняется; 0, null, дробь и больше 50 — без ограничений', () => {
    expect(sanitizePermissionsForPlan('pro', { maxGuests: 3 }).maxGuests).toBe(3);
    expect(effectiveMaxGuests('pro', { maxGuests: 3 })).toBe(3);
    expect(effectiveMaxGuests('tutor', { maxGuests: MAX_GUESTS_LIMIT })).toBe(MAX_GUESTS_LIMIT);
    for (const v of [0, null, 2.5, MAX_GUESTS_LIMIT + 1, -1]) {
      expect(sanitizePermissionsForPlan('pro', { maxGuests: v }).maxGuests).toBeUndefined();
      expect(effectiveMaxGuests('pro', { maxGuests: v })).toBe(Infinity);
    }
  });

  it('поле переживает сохранение и загрузку проекта', () => {
    const p = parseProject(proj({ permissions: { maxGuests: 7, allowCopy: false } }))!;
    expect(p.permissions).toEqual({ maxGuests: 7, allowCopy: false });
    const back = parseProject(JSON.parse(serializeProject(p)))!;
    expect(back.permissions?.maxGuests).toBe(7);
    expect(parseProject(proj({ permissions: { maxGuests: null } }))!.permissions).toEqual({ maxGuests: null });
    // мусор отбрасывается
    for (const bad of ['5', 2.5, -1, 51, {}]) expect(parseProject(proj({ permissions: { maxGuests: bad } }))!.permissions).toEqual({});
  });
});
