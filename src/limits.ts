import type { PageRight, PlanTier, ProjectPermissions } from './types';

/** Возможности тарифа. Бесконечность — без ограничений. */
export interface PlanLimits {
  maxProjects: number;
  maxPagesPerProject: number;
  /** Гостей в комнате без автора: на free всего 2 участника (автор + 1 гость). */
  maxP2PGuests: number;
  /** Сколько участников могут одновременно редактировать (автор считается). */
  maxEditors: number;
  canProtectClone: boolean;
  canProtectCopy: boolean;
  cloudSync24x7: boolean;
  tutorFeatures: boolean;
  /** Автор задаёт свой лимит гостей (ProjectPermissions.maxGuests). */
  canSetMaxGuests: boolean;
  /** Тумблер «Автопереход участников за мной». */
  canFollowHost: boolean;
  /** Именной адрес доски /j/<адрес> (SPEC_NIGHT6 §5.3). */
  canSetAlias: boolean;
}

/** Сколько записей именных адресов (активных, бывших и освобождённых) может быть у одного аккаунта. */
export const MAX_ALIASES_PER_OWNER = 20;

/** Верхняя граница своего лимита гостей. */
export const MAX_GUESTS_LIMIT = 50;

export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  free: {
    maxProjects: 3, maxPagesPerProject: 3, maxP2PGuests: 1, maxEditors: 4,
    canProtectClone: false, canProtectCopy: false, cloudSync24x7: false, tutorFeatures: false,
    canSetMaxGuests: false, canFollowHost: false, canSetAlias: false,
  },
  pro: {
    maxProjects: Infinity, maxPagesPerProject: Infinity, maxP2PGuests: Infinity, maxEditors: Infinity,
    canProtectClone: true, canProtectCopy: true, cloudSync24x7: true, tutorFeatures: false,
    canSetMaxGuests: true, canFollowHost: true, canSetAlias: true,
  },
  tutor: {
    maxProjects: Infinity, maxPagesPerProject: Infinity, maxP2PGuests: Infinity, maxEditors: Infinity,
    canProtectClone: true, canProtectCopy: true, cloudSync24x7: true, tutorFeatures: true,
    canSetMaxGuests: true, canFollowHost: true, canSetAlias: true,
  },
};

export const PLAN_TIERS: readonly PlanTier[] = ['free', 'pro', 'tutor'];

export function isPlanTier(v: unknown): v is PlanTier {
  return v === 'free' || v === 'pro' || v === 'tutor';
}

export const PAGE_RIGHTS: readonly PageRight[] = ['edit', 'view', 'hidden'];

export function isPageRight(v: unknown): v is PageRight {
  return v === 'edit' || v === 'view' || v === 'hidden';
}

/** Тариф проекта: нет поля или неизвестное значение — free. */
export function planOf(project: { ownerPlan?: unknown } | null | undefined): PlanTier {
  return isPlanTier(project?.ownerPlan) ? project.ownerPlan : 'free';
}

/** Можно ли создать ещё один проект (существующие сверх лимита не удаляются). */
export function canCreateProject(plan: PlanTier, currentProjectCount: number): boolean {
  return currentProjectCount < PLAN_LIMITS[plan].maxProjects;
}

export function canCreatePage(plan: PlanTier, currentPageCount: number): boolean {
  return currentPageCount < PLAN_LIMITS[plan].maxPagesPerProject;
}

/** Страниц в проекте больше, чем разрешено тарифом (остались с прежнего тарифа): удалённую заново не создать. */
export function isOverPageLimit(plan: PlanTier, pageCount: number): boolean {
  return pageCount > PLAN_LIMITS[plan].maxPagesPerProject;
}

/** Проектов больше, чем разрешено тарифом: удалённый заново не создать. */
export function isOverProjectLimit(plan: PlanTier, projectCount: number): boolean {
  return projectCount > PLAN_LIMITS[plan].maxProjects;
}

/** Можно ли подключиться ещё одному гостю; автор в currentGuestCount не входит. */
export function canGuestJoinRoom(plan: PlanTier, currentGuestCount: number): boolean {
  return currentGuestCount < PLAN_LIMITS[plan].maxP2PGuests;
}

/**
 * Права, допустимые на тарифе: у free защита от копирования и клонирования недоступна.
 * Права по страницам сохраняются, неизвестные значения отбрасываются.
 */
export function sanitizePermissionsForPlan(plan: PlanTier, perms: ProjectPermissions): ProjectPermissions {
  const lim = PLAN_LIMITS[plan];
  const out: ProjectPermissions = {};
  out.forbidClone = lim.canProtectClone ? perms.forbidClone === true : false;
  out.allowCopy = lim.canProtectCopy ? perms.allowCopy !== false : true;
  if (perms.pageRights) {
    const pageRights: Record<string, PageRight> = {};
    for (const [id, r] of Object.entries(perms.pageRights)) if (isPageRight(r)) pageRights[id] = r;
    out.pageRights = pageRights;
  }
  // свой лимит гостей — только Pro/Tutor и только 1..MAX_GUESTS_LIMIT; null/0 — без ограничений (поле не нужно)
  const mg = perms.maxGuests;
  if (lim.canSetMaxGuests && typeof mg === 'number' && Number.isInteger(mg) && mg >= 1 && mg <= MAX_GUESTS_LIMIT) out.maxGuests = mg;
  // защита элементов, просмотр по ссылке и «Позвать всех» — на всех тарифах (SPEC_NIGHT6 Решения 8, 15, 6)
  if (perms.protectElements === true) out.protectElements = true;
  if (perms.linkView === false) out.linkView = false;
  if (perms.summon === 'editors') out.summon = 'editors';
  return out;
}

/** Сколько гостей пускает комната: лимит тарифа и (Pro/Tutor) лимит автора, если он задан. Автор не считается. */
export function effectiveMaxGuests(plan: PlanTier, perms: ProjectPermissions | null | undefined): number {
  const own = sanitizePermissionsForPlan(plan, perms ?? {}).maxGuests;
  return Math.min(PLAN_LIMITS[plan].maxP2PGuests, own ?? Infinity);
}

/** Действующие права проекта с поправкой на тариф владельца. */
export function effectivePermissions(project: { ownerPlan?: unknown; permissions?: ProjectPermissions } | null | undefined): ProjectPermissions {
  return sanitizePermissionsForPlan(planOf(project), project?.permissions ?? {});
}
