// Модель доступа Ночи №6 (SPEC_NIGHT6 §2): роли, итоговое право, возможности, токены и адреса, автор элемента.
import { describe, expect, it } from 'vitest';
import {
  aliasProblem, effectivePageAccess, isAliasShaped, isPrincipal, isStoredRole, isTokenShaped, legacyRoleOf, normalizeRole,
  participantCaps, roleLabel, RESERVED_ALIASES,
} from '../../src/access';
import { invitePageRight } from '../../src/project-access';
import { parseProject, sanitizeElement } from '../../src/file';
import { elementAABB, hitTest } from '../../src/geom';
import { MAX_ALIASES_PER_OWNER, PLAN_LIMITS, sanitizePermissionsForPlan } from '../../src/limits';
import type { Element } from '../../src/types';

describe('роли', () => {
  it('старые синонимы: edit → редактор, view → комментатор; новые — как есть; мусор — null', () => {
    expect(normalizeRole('edit')).toEqual({ role: 'editor', legacy: true });
    expect(normalizeRole('view')).toEqual({ role: 'commenter', legacy: true });
    expect(normalizeRole('reader')).toEqual({ role: 'reader', legacy: false });
    expect(normalizeRole('commenter')).toEqual({ role: 'commenter', legacy: false });
    expect(normalizeRole('editor')).toEqual({ role: 'editor', legacy: false });
    expect(normalizeRole('owner')).toBeNull();
    expect(normalizeRole(undefined)).toBeNull();
    expect(isStoredRole('view') && isStoredRole('reader') && !isStoredRole('host')).toBe(true);
  });
  it('старый синоним для прежних клиентов и подписи', () => {
    expect(legacyRoleOf('editor')).toBe('edit');
    expect(legacyRoleOf('commenter')).toBe('view');
    expect(legacyRoleOf('reader')).toBe('view');
    expect(roleLabel('commenter', true)).toBe('Комментатор (старая ссылка)');
    expect(roleLabel('reader')).toBe('Читатель');
  });
});

describe('effectivePageAccess — таблица SPEC_NIGHT6 §2.2', () => {
  const base = { owner: false, legacy: false } as const;
  it.each([
    ['читатель (новая роль) + страница edit', { ...base, role: 'reader', pageSetting: 'edit' }, 'view'],
    ['старая ссылка view + страница edit', { owner: false, legacy: true, role: 'commenter', pageSetting: 'edit' }, 'edit'],
    ['редактор + страница hidden', { ...base, role: 'editor', pageSetting: 'hidden' }, 'hidden'],
    ['редактор + страница view', { ...base, role: 'editor', pageSetting: 'view' }, 'view'],
    ['личное view поверх страницы hidden', { ...base, role: 'reader', pageSetting: 'hidden', personal: 'view' }, 'view'],
    ['владелец + страница hidden', { owner: true, legacy: false, role: 'reader', pageSetting: 'hidden' }, 'edit'],
    ['редактор без права страницы', { ...base, role: 'editor' }, 'edit'],
    ['комментатор без права страницы', { ...base, role: 'commenter' }, 'view'],
    ['старая edit + страница view', { owner: false, legacy: true, role: 'editor', pageSetting: 'view' }, 'view'],
    ['старая edit без права страницы', { owner: false, legacy: true, role: 'editor' }, 'edit'],
  ] as const)('%s', (_name, input, want) => {
    expect(effectivePageAccess(input)).toBe(want);
  });

  it('invitePageRight: старые записи приглашения работают как в Ночах №3–5', () => {
    const project = { permissions: { pageRights: { a: 'edit', b: 'hidden' } as const } };
    // своё право в приглашении → право проекта → роль
    expect(invitePageRight(project, { defaultRole: 'view', pageRights: { a: 'view' } }, 'a')).toBe('view');
    expect(invitePageRight(project, { defaultRole: 'view', pageRights: {} }, 'a')).toBe('edit');
    expect(invitePageRight(project, { defaultRole: 'edit', pageRights: {} }, 'b')).toBe('hidden');
    expect(invitePageRight(project, { defaultRole: 'view', pageRights: {} }, 'c')).toBe('view');
    // новая роль: edit страницы не повышает
    expect(invitePageRight(project, { defaultRole: 'reader', pageRights: {} }, 'a')).toBe('view');
    expect(invitePageRight(project, { defaultRole: 'editor', pageRights: {} }, 'c')).toBe('edit');
  });
});

describe('participantCaps', () => {
  it('владелец — всё', () => {
    expect(participantCaps({ owner: true, role: 'reader' }, { allowCopy: false })).toEqual({ comment: true, chat: true, pointer: true, copy: true, summon: true });
  });
  it('читатель — ни комментариев, ни чата, ни указки; копирование — по доске', () => {
    expect(participantCaps({ owner: false, role: 'reader' }, {})).toEqual({ comment: false, chat: false, pointer: false, copy: true, summon: false });
    expect(participantCaps({ owner: false, role: 'reader' }, { allowCopy: false }).copy).toBe(false);
  });
  it('комментатор говорит, копирует по доске и по ссылке', () => {
    const c = participantCaps({ owner: false, role: 'commenter' }, {});
    expect(c).toEqual({ comment: true, chat: true, pointer: true, copy: true, summon: false });
    expect(participantCaps({ owner: false, role: 'commenter', inviteAllowCopy: false }, {}).copy).toBe(false);
    expect(participantCaps({ owner: false, role: 'commenter' }, { forbidClone: true }).copy).toBe(false);
  });
  it('редактор копирует всегда, зовёт всех только по настройке доски', () => {
    expect(participantCaps({ owner: false, role: 'editor', inviteAllowCopy: false }, { allowCopy: false }).copy).toBe(true);
    expect(participantCaps({ owner: false, role: 'editor' }, {}).summon).toBe(false);
    expect(participantCaps({ owner: false, role: 'editor' }, { summon: 'editors' }).summon).toBe(true);
    expect(participantCaps({ owner: false, role: 'commenter' }, { summon: 'editors' }).summon).toBe(false);
  });
});

describe('токены и именные адреса', () => {
  it('токен — ровно 24 символа base64url', () => {
    expect(isTokenShaped('AbCdEfGhIjKlMnOpQrStUv_-')).toBe(true);
    expect(isTokenShaped('AbCdEfGhIjKlMnOpQrStUv_')).toBe(false);
    expect(isTokenShaped('AbCdEfGhIjKlMnOpQrStUv_-x')).toBe(false);
    expect(isTokenShaped('AbCdEfGhIjKlMnOpQrStUv!-')).toBe(false);
  });
  it('адрес: 3–23 символа, с буквы, дефис только внутри, не из резерва', () => {
    for (const ok of ['physics-9a', 'abc', 'a1b', 'x'.repeat(23), 'fizika-9-a']) expect(isAliasShaped(ok)).toBe(true);
    for (const bad of ['ab', 'x'.repeat(24), '9a-physics', 'phys--ics', 'physics-', '-physics', 'Physics', 'физика', 'api', 'admin']) {
      expect(isAliasShaped(bad)).toBe(false);
    }
    expect(RESERVED_ALIASES.has('j')).toBe(true);
  });
  it('адрес и токен не пересекаются: строка 24 символов из строчных букв — только токен', () => {
    const s = 'abcdefghijklmnopqrstuvwx';
    expect(isTokenShaped(s)).toBe(true);
    expect(isAliasShaped(s)).toBe(false);
  });
  it('подсказки к адресу', () => {
    expect(aliasProblem('ab')).toMatch(/короче/);
    expect(aliasProblem('Ab-c')).toMatch(/строчные/);
    expect(aliasProblem('1abc')).toMatch(/буквы/);
    expect(aliasProblem('ab--c')).toMatch(/Дефис/);
    expect(aliasProblem('admin')).toMatch(/системой/);
    expect(aliasProblem('physics-9a')).toBeNull();
  });
  it('тариф: именной адрес — Pro/Tutor; лимит записей на аккаунт', () => {
    expect(PLAN_LIMITS.free.canSetAlias).toBe(false);
    expect(PLAN_LIMITS.pro.canSetAlias && PLAN_LIMITS.tutor.canSetAlias).toBe(true);
    expect(MAX_ALIASES_PER_OWNER).toBe(20);
  });
});

describe('новые поля прав и автор элемента', () => {
  const rect = { id: 'r', type: 'shape', shape: 'rect', x: 0, y: 0, w: 10, h: 10, color: '#000', width: 1 };
  it('protectElements, linkView, summon переживают сохранение и загрузку; мусор отбрасывается', () => {
    const p = parseProject({
      id: 'p', name: 'П', createdAt: 1, updatedAt: 1, pages: [{ id: 'g', name: 'С', grid: 'none', elements: [] }],
      permissions: { protectElements: true, linkView: false, summon: 'editors' },
    })!;
    expect(p.permissions).toMatchObject({ protectElements: true, linkView: false, summon: 'editors' });
    const again = parseProject(JSON.parse(JSON.stringify(p)))!;
    expect(again.permissions).toMatchObject({ protectElements: true, linkView: false, summon: 'editors' });
    const bad = parseProject({ ...p, permissions: { protectElements: 'да', linkView: 1, summon: 'all' } })!;
    expect(bad.permissions).toEqual({});
  });
  it('на всех тарифах защита, просмотр по ссылке и «Позвать всех» сохраняются', () => {
    for (const plan of ['free', 'pro', 'tutor'] as const) {
      expect(sanitizePermissionsForPlan(plan, { protectElements: true, linkView: false, summon: 'editors' }))
        .toMatchObject({ protectElements: true, linkView: false, summon: 'editors' });
    }
    expect(sanitizePermissionsForPlan('free', {})).not.toHaveProperty('protectElements');
  });
  it('by: верное значение сохраняется, неверное отбрасывается (элемент — владельца)', () => {
    expect(sanitizeElement({ ...rect, by: 'u:1f2e-3d' })).toMatchObject({ by: 'u:1f2e-3d' });
    expect(sanitizeElement({ ...rect, by: 'c:ab12' })).toMatchObject({ by: 'c:ab12' });
    for (const bad of ['x:1', 'u:', 'u:<b>', 42, 'u:' + 'a'.repeat(79)]) expect(sanitizeElement({ ...rect, by: bad })).not.toHaveProperty('by');
    expect(isPrincipal('u:abc') && !isPrincipal('abc')).toBe(true);
  });
  it('by не влияет на рамку и попадание', () => {
    const a = sanitizeElement(rect) as Element;
    const b = sanitizeElement({ ...rect, by: 'u:someone' }) as Element;
    expect(elementAABB(b)).toEqual(elementAABB(a));
    expect(hitTest(b, 5, 0, 2)).toBe(hitTest(a, 5, 0, 2));
    expect(hitTest(b, 50, 50, 2)).toBe(hitTest(a, 50, 50, 2));
  });
});
