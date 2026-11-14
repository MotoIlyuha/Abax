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
}

export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  free: {
    maxProjects: 3, maxPagesPerProject: 3, maxP2PGuests: 1, maxEditors: 4,
    canProtectClone: false, canProtectCopy: false, cloudSync24x7: false, tutorFeatures: false,
  },
  pro: {
    maxProjects: Infinity, maxPagesPerProject: Infinity, maxP2PGuests: Infinity, maxEditors: Infinity,
    canProtectClone: true, canProtectCopy: true, cloudSync24x7: true, tutorFeatures: false,
  },
  tutor: {
    maxProjects: Infinity, maxPagesPerProject: Infinity, maxP2PGuests: Infinity, maxEditors: Infinity,
    canProtectClone: true, canProtectCopy: true, cloudSync24x7: true, tutorFeatures: true,
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
  return out;
}

/** Действующие права проекта с поправкой на тариф владельца. */
export function effectivePermissions(project: { ownerPlan?: unknown; permissions?: ProjectPermissions } | null | undefined): ProjectPermissions {
  return sanitizePermissionsForPlan(planOf(project), project?.permissions ?? {});
}
