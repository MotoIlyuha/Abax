// Правила доступа для хаба Electron — зеркало src/access.ts (Ночь №6, SPEC_NIGHT6 §2).
// Паритет с TypeScript-версией проверяет tests/server/room-pointer.test.ts.

const isPageRight = v => v === 'edit' || v === 'view' || v === 'hidden';
const isAccessRole = v => v === 'editor' || v === 'commenter' || v === 'reader';

/** 'edit' → редактор, 'view' → комментатор (старые ссылки), новые — как есть; null — не роль. */
function normalizeRole(raw) {
  if (raw === 'edit') return { role: 'editor', legacy: true };
  if (raw === 'view') return { role: 'commenter', legacy: true };
  if (isAccessRole(raw)) return { role: raw, legacy: false };
  return null;
}

const legacyRoleOf = role => (role === 'editor' ? 'edit' : 'view');

/** Итоговое право на странице (зеркало effectivePageAccess). */
function effectivePageAccess(a) {
  if (a.owner) return 'edit';
  if (a.personal) return a.personal;
  if (a.pageSetting === 'hidden') return 'hidden';
  if (a.legacy) return a.pageSetting || (a.role === 'editor' ? 'edit' : 'view');
  if (a.pageSetting === 'view') return 'view';
  return a.role === 'editor' ? 'edit' : 'view';
}

const OWNER_CAPS = { comment: true, chat: true, pointer: true, copy: true, summon: true };

function copyAllowedBy(perms, inviteAllowCopy) {
  return (!perms || perms.allowCopy !== false) && (!perms || perms.forbidClone !== true) && inviteAllowCopy !== false;
}

/** Возможности участника (зеркало participantCaps): редактор новой роли копирует всегда, старая ссылка edit — по правам доски. */
function participantCaps(a, perms) {
  if (a.owner) return { ...OWNER_CAPS };
  const talk = a.role !== 'reader';
  return {
    comment: talk,
    chat: talk,
    pointer: talk,
    copy: (a.role === 'editor' && a.legacy !== true) || copyAllowedBy(perms, a.inviteAllowCopy),
    summon: a.role === 'editor' && !!perms && perms.summon === 'editors',
  };
}

/**
 * Права проекта, действующие в хабе Electron. Тарифа автора хаб не знает: защита от копирования и
 * клонирования — только у проекта с ownerPlan pro/tutor (как sanitizePermissionsForPlan); прочее — как есть.
 */
function hubPermissions(project) {
  const raw = (project && project.permissions) || {};
  const paid = !!project && (project.ownerPlan === 'pro' || project.ownerPlan === 'tutor');
  return {
    allowCopy: paid ? raw.allowCopy !== false : true,
    forbidClone: paid ? raw.forbidClone === true : false,
    ...(raw.protectElements === true ? { protectElements: true } : {}),
    ...(raw.summon === 'editors' ? { summon: 'editors' } : {}),
  };
}

module.exports = { isPageRight, isAccessRole, normalizeRole, legacyRoleOf, effectivePageAccess, participantCaps, copyAllowedBy, hubPermissions, OWNER_CAPS };
