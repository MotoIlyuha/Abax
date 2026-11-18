import type { Element, Page, PageRight, PlanTier, Project } from './types';
import { projectTaskForRole } from './task-element';
import { effectivePageAccess, normalizeRole, type StoredRole } from './access';

// Чистая логика доступа к проекту: что видит гость и зритель, как делается копия. Без DOM и состояния —
// общая для клиента (link-view.ts) и сервера (server/projects.ts, комнаты).

/** Страницы, скрытые автором проекта от всех, кроме него. */
export function hiddenPageIds(project: Pick<Project, 'permissions'>): Set<string> {
  const out = new Set<string>();
  for (const [id, r] of Object.entries(project.permissions?.pageRights ?? {})) if (r === 'hidden') out.add(id);
  return out;
}

/** Проект без указанных страниц; нетронутый — тот же объект. */
export function withoutPages(project: Project, hidden: ReadonlySet<string>): Project {
  if (!project.pages.some(p => hidden.has(p.id))) return project;
  return { ...project, pages: project.pages.filter(p => !hidden.has(p.id)) };
}

/** Страницы так, как их видит ученик: у заданий нет ответа и закрытого решения. Нетронутые страницы — те же объекты. */
export function maskPagesForGuest(pages: Page[]): Page[] {
  return pages.map(pg => (pg.elements.some(e => e.type === 'task')
    ? { ...pg, elements: pg.elements.map(el => (el.type === 'task' ? projectTaskForRole(el, 'guest') as Element : el)) }
    : pg));
}

/** Элемент без чужого ввода: у задания нет попыток, черновика и пометки «сложное» (ответ остаётся как есть). */
function withoutStudentData(el: Element): Element {
  if (el.type !== 'task') return el;
  if (el.attempts === undefined && el.studentDraft === undefined && el.markedHard === undefined) return el;
  const { attempts: _a, studentDraft: _d, markedHard: _h, ...rest } = el;
  return rest as Element;
}

/** Страницы без комментариев и без ввода учеников (для зрителя и для копии). */
export function stripStudentData(pages: Page[]): Page[] {
  return pages.map(pg => {
    const { comments: _c, ...rest } = pg;
    return { ...rest, elements: pg.elements.map(withoutStudentData) };
  });
}

/**
 * Право участника на страницу по приглашению (SPEC_NIGHT6 §2.2): личное право приглашения (старые записи),
 * затем право страницы проекта и роль. Старые роли edit/view — как в Ночах №3–5.
 */
export function invitePageRight(
  project: Pick<Project, 'permissions'>, invite: { defaultRole: StoredRole; pageRights: Record<string, PageRight> }, pageId: string,
): PageRight {
  const r = normalizeRole(invite.defaultRole) ?? { role: 'commenter' as const, legacy: true };
  return effectivePageAccess({
    owner: false, role: r.role, legacy: r.legacy,
    pageSetting: project.permissions?.pageRights?.[pageId], personal: invite.pageRights[pageId],
  });
}

/** Элемент клона: у задания нет ответа, решения, ввода и пометок ученика. */
function cloneElement(el: Element): Element {
  if (el.type !== 'task') return el;
  return withoutStudentData(projectTaskForRole(el, 'guest') as Element);
}

/**
 * Полная копия проекта для зрителя: новый id, тариф и права нового владельца, без комментариев,
 * скрытых страниц (их в проекте зрителя уже нет), ответов и ввода заданий.
 */
export function cloneProjectForViewer(project: Project, opts: { plan: PlanTier; id: string; now?: number }): Project {
  const now = opts.now ?? Date.now();
  const { permissions: _p, pinned: _pin, ...rest } = project;
  return {
    ...rest,
    id: opts.id,
    name: `${project.name} (копия)`,
    createdAt: now,
    updatedAt: now,
    ownerPlan: opts.plan,
    pages: project.pages.map(pg => {
      const { comments: _c, ...page } = pg;
      return { ...page, elements: page.elements.map(cloneElement) };
    }),
  };
}
